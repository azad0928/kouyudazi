// 云函数：导入处理流水线（M2）
// 状态机：prepare（解析/分句/内容审核/标词）→ TTS 分块（服务商链，见 tts.js）→ finalize（拼接/组装课程）
// 客户端轮询本函数推进；任意一步失败 → 记录 failed + 按设计返还额度（失败不扣额度）。
// TTS 服务商链：elevenlabs(v4 免费) → azure(F0 免费) → tencent(付费兜底)，整篇 pin 同一服务商。
// 密钥与音色走云函数环境变量（见 tts.js 头注释）；一个都没配时失败码为 TTS_NOT_CONFIGURED，
// 用户配好后点“重试”即可从断点续跑（prepare 已完成的不重做）。
const cloud = require('wx-server-sdk')
const mammoth = require('mammoth')
const wordlist = require('./wordlist.json')
const { stripMarkdown, splitParagraphs, splitSentences, matchVocab } = require('./text-process')
const { mp3Duration } = require('./mp3-duration')
const { synthesizeText, isAnyProviderConfigured, firstConfiguredProvider, chunkSizeFor, describeChain } = require('./tts')
const { generateCover } = require('./cloudflare-img')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const MAX_CHARS = 5000
// 每轮 TTS 句数按服务商动态定（tts.chunkSizeFor）：elevenlabs 5 / azure 8 / tencent 12，防 60 秒超时（-504003）
// 代码版本：每次失败记录里都写 diagVersion，下次一眼能看出跑的是哪个版本，
// 不用再猜部署生效没有（v49：环境变量去空格 + diagVersion）。
const CODE_VERSION = '1.4' // 1.4：封面 prompt 不再喂正文（防乱码字）+ no-text 强化

async function failRecord(id, errorCode, quotaType, openid, errorDetail) {
  const data = { status: 'failed', errorCode, diagVersion: CODE_VERSION }
  // 具体报错（如腾讯 API 返回的码）存进记录，客户端/日志看不到时也能从数据库定位
  if (errorDetail) data.errorDetail = errorDetail
  await db.collection('imports').doc(id).update({ data })
  // 返还额度：免费次 -1、单次/积分 +1；包月/终身不按次扣，无需返还（额度集合不存在时无可返还）
  if (quotaType === 'free' || quotaType === 'single' || quotaType === 'points') {
    try {
      const q = await db.collection('quotas').where({ _openid: openid }).limit(1).get()
      const doc = q.data && q.data[0]
      if (doc) {
        const patch = quotaType === 'free'
          ? { freeUsed: Math.max(0, (doc.freeUsed || 0) - 1) }
          : quotaType === 'points'
            ? { pointsRemaining: (doc.pointsRemaining || 0) + 1 }
            : { singleRemaining: (doc.singleRemaining || 0) + 1 }
        await db.collection('quotas').doc(doc._id).update({ data: patch })
      }
    } catch (e) {
      if (e && (e.code === -502005 || /COLLECTION_NOT_EXIST|collection not exists/i.test(e.message || ''))) {
        return
      }
      throw e
    }
  }
}

exports.main = async (event) => {
  const { OPENID: openid } = cloud.getWXContext()
  const importId = event && event.importId
  if (!openid || !importId) {
    throw new Error('missing importId')
  }
  const docRef = db.collection('imports').doc(importId)
  const snap = await docRef.get()
  const record = snap.data
  if (!record) {
    throw new Error('import not found')
  }
  if (record._openid !== openid) {
    throw new Error('forbidden')
  }
  if (record.status === 'done' || record.status === 'failed') {
    return {
      status: record.status,
      progressPct: record.progressPct || 0,
      lessonId: record.lessonId || '',
      errorCode: record.errorCode || '',
    }
  }

  try {
    // ---------- prepare：解析 / 校验 / 审核 / 标词（只跑一次） ----------
    if (!record.sentences) {
      const dl = await cloud.downloadFile({ fileID: record.fileID })
      const buf = dl.fileContent
      const ext = (record.fileName.split('.').pop() || '').toLowerCase()
      let text = ''
      if (ext === 'docx') {
        const parsed = await mammoth.extractRawText({ buffer: buf })
        text = parsed.value || ''
      } else if (ext === 'md') {
        text = stripMarkdown(buf.toString('utf8'))
      } else {
        text = buf.toString('utf8')
      }
      if (text.length > MAX_CHARS) {
        await failRecord(importId, 'OVER_LIMIT', record.quotaType, openid)
        return { status: 'failed', errorCode: 'OVER_LIMIT' }
      }
      const paragraphs = splitParagraphs(text)
      const sentences = []
      const paraMeta = []
      for (const p of paragraphs) {
        const list = splitSentences(p.text)
        if (list.length === 0) continue
        paraMeta.push({ heading: p.heading, start: sentences.length, count: list.length })
        for (const s of list) {
          sentences.push({ text: s, paragraphIndex: paraMeta.length - 1 })
        }
      }
      if (sentences.length === 0) {
        await failRecord(importId, 'EMPTY_CONTENT', record.quotaType, openid)
        return { status: 'failed', errorCode: 'EMPTY_CONTENT' }
      }
      // 内容安全审核：按段送检，任一段命中即失败（微信上架硬要求；失败返还额度）
      for (const p of paragraphs) {
        if (!p.text) continue
        await cloud.openapi.security.msgSecCheck({ content: p.text.slice(0, 2000) })
      }
      const { vocabWords, vocabDict } = matchVocab(sentences, wordlist)
      await docRef.update({
        data: {
          sentences,
          paragraphs: paraMeta,
          vocabWords,
          vocabDict,
          totalSentences: sentences.length,
          nextIndex: 0,
          sentenceFileIDs: [],
          sentenceDurations: [],
          progressPct: 5,
        },
      })
      return { status: 'processing', progressPct: 5, total: sentences.length, done: 0 }
    }

    const total = record.totalSentences || record.sentences.length
    const nextIndex = record.nextIndex || 0

    // ---------- TTS 分块：服务商链 elevenlabs → azure → tencent ----------
    if (nextIndex < total) {
      // 至少配了一个服务商才能跑；整篇 pin 到同一服务商（record.ttsProvider），
      // 避免一篇里混音色；某句失败自动降级并更新 pin（见 tts.js）。
      if (!isAnyProviderConfigured()) {
        await failRecord(importId, 'TTS_NOT_CONFIGURED', record.quotaType, openid)
        return { status: 'failed', errorCode: 'TTS_NOT_CONFIGURED' }
      }
      let provider = record.ttsProvider || firstConfiguredProvider()
      const CHUNK = chunkSizeFor(provider)
      const fileIDs = record.sentenceFileIDs || []
      const durations = record.sentenceDurations || []
      const end = Math.min(nextIndex + CHUNK, total)
      const trace = []
      for (let i = nextIndex; i < end; i++) {
        const { audio, provider: used } = await synthesizeText(record.sentences[i].text, provider, trace)
        provider = used
        const up = await cloud.uploadFile({
          cloudPath: `imports/tmp/${importId}/s${i}.mp3`,
          fileContent: audio,
        })
        fileIDs[i] = up.fileID
        const d = mp3Duration(audio)
        durations[i] = d !== null && d > 0 ? d : Math.max(1, record.sentences[i].text.length / 15)
      }
      const progressPct = 5 + Math.round((90 * end) / total)
      const chainUpdate = { sentenceFileIDs: fileIDs, sentenceDurations: durations, nextIndex: end, progressPct, ttsProvider: provider }
      if (trace.length) chainUpdate.ttsTrace = (record.ttsTrace || []).concat(trace)
      if (!record.ttsChain) chainUpdate.ttsChain = describeChain()
      await docRef.update({ data: chainUpdate })
      return { status: 'processing', progressPct, total, done: end, ttsProvider: provider }
    }

    // ---------- cover：按文章内容生成封面（只跑一次；失败/未配置则跳过，用预设封面） ----------
    if (!record.coverFileID && !record.coverSkipped) {
      const excerpt = (record.sentences || []).slice(0, 5).map((s) => s.text).join(' ')
      const coverFileID = await generateCover({
        title: record.title,
        excerpt,
        importId,
        uploadFile: (opts) => cloud.uploadFile(opts),
      })
      if (coverFileID) {
        await docRef.update({ data: { coverFileID, progressPct: 96 } })
      } else {
        await docRef.update({ data: { coverSkipped: true, progressPct: 96 } })
      }
      return { status: 'processing', progressPct: 96 }
    }

    // ---------- finalize：拼接音频 + 组装课程 ----------
    const buffers = []
    for (let i = 0; i < total; i++) {
      const dl = await cloud.downloadFile({ fileID: record.sentenceFileIDs[i] })
      buffers.push(dl.fileContent)
    }
    const finalUp = await cloud.uploadFile({
      cloudPath: `imports/${openid}/${importId}.mp3`,
      fileContent: Buffer.concat(buffers),
    })
    const durations = record.sentenceDurations || []
    let t = 0
    const timed = record.sentences.map((s, i) => {
      const start = t
      const dur = durations[i] || 1
      t += dur
      return { text: s.text, paragraphIndex: s.paragraphIndex, startTime: start, endTime: t }
    })
    const lessonParagraphs = (record.paragraphs || []).map((p) => ({
      heading: p.heading,
      sentences: timed.slice(p.start, p.start + p.count).map((s) => ({
        text: s.text,
        startTime: s.startTime,
        endTime: s.endTime,
      })),
    }))
    const lessonId = `import_${importId}`
    const lesson = {
      id: lessonId,
      title: record.title,
      cover: record.coverFileID || null,
      duration: t,
      audioUrl: finalUp.fileID,
      isNew: false,
      paragraphs: lessonParagraphs,
      vocabWords: record.vocabWords || [],
      vocabDict: record.vocabDict || {},
      source: 'import',
      ttsProvider: record.ttsProvider || 'tencent',
    }
    await docRef.update({
      data: { status: 'done', progressPct: 100, lessonId, lesson, finalFileID: finalUp.fileID },
    })
    return { status: 'done', progressPct: 100, lessonId }
  } catch (e) {
    console.error('processImport failed', e)
    // TTS 接口报错等：失败 + 返还额度（prepare 已做的不重做，重试从断点续跑）
    // 把具体报错存进记录（v47：全量抓取 code/errCode/detail/errMsg/message，兜底 JSON；
    // v46 只抓 code/detail/message，微信服务端 SDK 的 errMsg 形状会漏掉导致 errorDetail 为空）
    // 失败时一定存 errorDetail（哪怕是 UNKNOWN），它是部署是否生效的标志：
    // v47 跑过且失败，记录里必有 errorDetail；没有就说明跑的还是旧代码。
    let detail = ''
    if (e) {
      const parts = [e.code || e.errCode, e.detail || e.errMsg || e.message].filter(Boolean)
      detail = parts.join(' ')
      if (!detail) {
        try { detail = JSON.stringify(e) } catch { detail = '' }
      }
      detail = (detail || 'UNKNOWN_ERROR').slice(0, 300)
    } else {
      detail = 'UNKNOWN_ERROR'
    }
    await failRecord(importId, 'PROCESS_ERROR', record.quotaType, openid, detail)
    return { status: 'failed', errorCode: 'PROCESS_ERROR', errorDetail: detail }
  }
}
