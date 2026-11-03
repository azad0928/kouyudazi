// 云函数：导入处理流水线（M2）
// 状态机：prepare（解析/分句/内容审核/标词）→ TTS 分块（服务商链，见 tts.js）→ finalize（拼接/组装课程）
// 客户端轮询本函数推进；任意一步失败 → 记录 failed + 按设计返还额度（失败不扣额度）。
// TTS 服务商链：elevenlabs(v4 免费) → azure(F0 免费) → tencent(付费兜底)，整篇 pin 同一服务商。
// 密钥与音色走云函数环境变量（见 tts.js 头注释）；一个都没配时失败码为 TTS_NOT_CONFIGURED，
// 用户配好后点“重试”即可从断点续跑（prepare 已完成的不重做）。
const cloud = require('wx-server-sdk')
const mammoth = require('mammoth')
// PDF 文字层提取（pdf.js 内核）。只能取「文字层」：扫描件/纯图片 PDF 会返回空文本，
// 走 PDF_NO_TEXT 失败码（不扣额度），提示用户换文件，不做 OCR（体积与耗时都不划算）。
const pdfParse = require('pdf-parse')
const wordlist = require('./wordlist.json')
const { stripMarkdown, normalizePdfText, splitParagraphs, splitSentences, matchVocab } = require('./text-process')
const { mp3Duration } = require('./mp3-duration')
const { synthesizeText, isAnyProviderConfigured, firstConfiguredProvider, maxChunkFor, concurrencyFor, describeChain } = require('./tts')
const { generateCover, COVER_VARIANTS } = require('./cloudflare-img')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const MAX_CHARS = 5000
// 每轮耗时用「时间预算」控制（见 TTS_BUDGET_MS），不再按固定句数切；
// 代码版本：每次失败/成功记录里都写 diagVersion，下次一眼能看出跑的是哪个版本，
// 不用再猜部署生效没有（v49：环境变量去空格 + diagVersion；1.5：并发 + 时间预算）。
const CODE_VERSION = '1.6' // 1.6：elevenlabs with_timestamps 词级时间戳 + 切句器缩写误判修复（1.5：TTS 句级并发 + 时间预算防超时 + 封面与 TTS 重叠 + finalize 并行下载）

// 时间预算：函数硬超时 60 秒。预算到点后不再派发新句，但「已派发未返回」的请求最多还要
// 25 秒（各服务商的单句超时上限）→ 25 + 25 ≈ 50 秒，仍在 60 秒内，不会再有 -504003，
// 也不会因为被杀掉而丢失这一轮已经消耗掉的 TTS 额度。
const TTS_BUDGET_MS = 25000
// 封面与 TTS 并行时，TTS 跑完后最多再等封面这么久（封面已在跑，等 8 秒足够）；
// 硬上限：函数启动后 45 秒，避免等封面把 60 秒函数超时撞穿、连带丢掉这一轮已生成的音频。
const COVER_WAIT_MAX_MS = 8000
const COVER_HARD_DEADLINE_MS = 45000

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 云函数旧运行时（Node 10）没有 Promise.allSettled，自己实现，避免依赖运行时版本
function settleAll(promises) {
  return Promise.all(
    promises.map((p) =>
      Promise.resolve(p).then(
        (value) => ({ status: 'fulfilled', value }),
        (reason) => ({ status: 'rejected', reason }),
      ),
    ),
  )
}

/**
 * 并发执行 worker(0..count-1)。
 * budget：{ start, ms } 到点后不再派发新任务（在途的仍等它结束），保证 0..dispatched-1
 * 全部有结果 —— 这样 nextIndex 可以只往前推 dispatched，既不重做也不跳句。
 * 任一任务失败立即停止派发新任务，等在途任务收尾后抛出第一个错误（不产生 unhandled rejection）。
 */
async function runPool(count, concurrency, worker, budget) {
  let cursor = 0
  let stop = false
  const results = new Array(count)
  const runners = []
  const n = Math.max(1, Math.min(concurrency, count))
  for (let w = 0; w < n; w++) {
    runners.push(
      (async () => {
        for (;;) {
          if (stop) return
          // cursor > 0：至少派发一个，避免冷启动吃掉预算时整轮空转
          if (budget && cursor > 0 && Date.now() - budget.start > budget.ms) {
            stop = true
            return
          }
          const i = cursor++
          if (i >= count) return
          try {
            results[i] = await worker(i)
          } catch (e) {
            stop = true
            throw e
          }
        }
      })(),
    )
  }
  const settled = await settleAll(runners)
  const failed = settled.find((s) => s.status === 'rejected')
  if (failed) throw failed.reason
  return { results, dispatched: Math.min(cursor, count) }
}

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

/**
 * 重新生成封面（action=regenCover）：校验已在 main 入口完成（本人 + 记录存在）。
 * 要求导入已完成；每次轮换 COVER_VARIANTS 换一种画风；新图存独立路径拿新 fileID，
 * 成功后删掉上一张省存储。任一步失败抛错，前端 toast 提示。
 */
async function handleRegenCover({ docRef, record, importId }) {
  if (record.status !== 'done') throw new Error('import not done')
  const count = record.coverRegenCount || 0
  const excerpt = (record.sentences || []).slice(0, 5).map((s) => s.text).join(' ')
  const fileID = await generateCover({
    title: record.title,
    excerpt,
    importId,
    uploadFile: (opts) => cloud.uploadFile(opts),
    variant: COVER_VARIANTS[count % COVER_VARIANTS.length],
    cloudPath: `covers/${importId}_r${count + 1}.jpg`,
  })
  if (!fileID) throw new Error('cover regen failed')
  const lesson = Object.assign({}, record.lesson, { cover: fileID })
  await docRef.update({
    data: { coverFileID: fileID, coverSkipped: false, coverRegenCount: count + 1, lesson },
  })
  const oldID = record.coverFileID
  if (oldID && oldID !== fileID) {
    try {
      await cloud.deleteFile({ fileList: [oldID] })
    } catch (e) {
      console.error('regenCover: delete old cover failed', e && e.message)
    }
  }
  return { coverFileID: fileID }
}

exports.main = async (event) => {
  const startedAt = Date.now()
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
  // 重新生成封面：仅本人、已完成的导入；每次轮换风格变体，存为新文件
  if (event.action === 'regenCover') {
    return await handleRegenCover({ docRef, record, importId })
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
      } else if (ext === 'pdf') {
        // 解析失败（文件损坏/加密）和「解析成功但没文字」（扫描件）分开报，
        // 用户看到的话术不同，排查也不用翻日志
        let raw = ''
        try {
          const parsed = await pdfParse(buf)
          raw = (parsed && parsed.text) || ''
        } catch (e) {
          const detail = String((e && (e.message || e)) || '').slice(0, 200)
          console.error('[import] pdf parse failed:', detail)
          await failRecord(importId, 'PDF_PARSE_FAILED', record.quotaType, openid, detail)
          return { status: 'failed', errorCode: 'PDF_PARSE_FAILED' }
        }
        text = normalizePdfText(raw)
        // 少于 20 个字符基本等于没提取到（扫描件/图片型 PDF）
        if (text.length < 20) {
          await failRecord(importId, 'PDF_NO_TEXT', record.quotaType, openid, `textLen=${text.length}`)
          return { status: 'failed', errorCode: 'PDF_NO_TEXT' }
        }
      } else if (ext === 'md') {
        text = stripMarkdown(buf.toString('utf8'))
      } else {
        text = buf.toString('utf8')
      }
      if (text.length > MAX_CHARS) {
        await failRecord(importId, 'OVER_LIMIT', record.quotaType, openid)
        return { status: 'failed', errorCode: 'OVER_LIMIT' }
      }
      // PDF 没有 md 的 # 标记，用「短、独行、不以句末标点结尾」识别标题
      const paragraphs = splitParagraphs(text, { bareHeadings: ext === 'pdf' })
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
      // 并发送检（原来逐段串行，每段一次 RTT，长文光审核就要 1~3 秒）
      const checkResults = await settleAll(
        paragraphs.filter((p) => p.text).map((p) => cloud.openapi.security.msgSecCheck({ content: p.text.slice(0, 2000) })),
      )
      const checkFail = checkResults.find((r) => r.status === 'rejected')
      if (checkFail) throw checkFail.reason
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
          sentenceWords: [],
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
      const provider = record.ttsProvider || firstConfiguredProvider()
      const concurrency = concurrencyFor(provider)
      const count = Math.min(total - nextIndex, maxChunkFor(provider))
      const fileIDs = (record.sentenceFileIDs || []).slice()
      const durations = (record.sentenceDurations || []).slice()
      const sentWords = (record.sentenceWords || []).slice()
      const trace = []
      const usedBy = {}

      // 封面与 TTS 并行：生图 10~20 秒，正好藏在 TTS 这几轮里，省掉一整轮往返（原来封面单独占一轮）
      const coverPromise =
        !record.coverFileID && !record.coverSkipped
          ? generateCover({
              title: record.title,
              excerpt: (record.sentences || []).slice(0, 5).map((s) => s.text).join(' '),
              importId,
              uploadFile: (opts) => cloud.uploadFile(opts),
            }).catch((e) => {
              console.error('generateCover failed:', e && e.message)
              return null
            })
          : null

      // 句级并发：句与句之间互不依赖，串行是纯浪费。合成与上传在同一条任务里流水，
      // 上传的等待同时也被其它句的合成掩盖。
      const { dispatched } = await runPool(
        count,
        concurrency,
        async (k) => {
          const i = nextIndex + k
          const { audio, provider: used, words } = await synthesizeText(record.sentences[i].text, provider, trace)
          const up = await cloud.uploadFile({
            cloudPath: `imports/tmp/${importId}/s${i}.mp3`,
            fileContent: audio,
          })
          fileIDs[i] = up.fileID
          const d = mp3Duration(audio)
          durations[i] = d !== null && d > 0 ? d : Math.max(1, record.sentences[i].text.length / 15)
          // 词级时间戳（elevenlabs with_timestamps，相对该句音频的秒数）；其它服务商为 null
          sentWords[i] = Array.isArray(words) && words.length ? words : null
          usedBy[used] = (usedBy[used] || 0) + 1
        },
        { start: startedAt, ms: TTS_BUDGET_MS },
      )

      // 大多数句用的是同一个服务商就继续 pin 它；中途降级以「用得最多的那个」为准，保证一篇内音色一致
      let nextProvider = provider
      let best = usedBy[provider] || 0
      for (const p of Object.keys(usedBy)) {
        if (usedBy[p] > best) {
          best = usedBy[p]
          nextProvider = p
        }
      }

      // 封面：TTS 跑完时它通常已经好了；没好的话最多再等一会儿，超时就不写库，留到 finalize 前那一轮重试
      let coverFields = {}
      if (coverPromise) {
        const wait = Math.min(COVER_WAIT_MAX_MS, Math.max(0, startedAt + COVER_HARD_DEADLINE_MS - Date.now()))
        const timeoutTag = { coverTimeout: true }
        const r = await Promise.race([coverPromise, sleep(wait).then(() => timeoutTag)])
        if (r && r.coverTimeout) {
          // 超时：不写 coverSkipped，下一轮（finalize 前）还会再试一次
        } else if (r) {
          coverFields = { coverFileID: r }
        } else {
          coverFields = { coverSkipped: true }
        }
      }

      const end = nextIndex + dispatched
      const progressPct = 5 + Math.round((90 * end) / total)
      const chainUpdate = {
        sentenceFileIDs: fileIDs,
        sentenceDurations: durations,
        sentenceWords: sentWords,
        nextIndex: end,
        progressPct,
        ttsProvider: nextProvider,
        diagVersion: CODE_VERSION,
        ...coverFields,
      }
      if (trace.length) chainUpdate.ttsTrace = (record.ttsTrace || []).concat(trace).slice(-40)
      if (!record.ttsChain) chainUpdate.ttsChain = describeChain()
      await docRef.update({ data: chainUpdate })
      return { status: 'processing', progressPct, total, done: end, ttsProvider: nextProvider, concurrency }
    }

    // ---------- cover（兜底轮）：正常情况封面已在 TTS 轮里并行生成完，
    // 只有「没配置生图 / 生图比 TTS 慢太多」才会走到这里，单独一轮补一次 ----------
    if (!record.coverFileID && !record.coverSkipped) {
      const excerpt = (record.sentences || []).slice(0, 5).map((s) => s.text).join(' ')
      // 硬超时 30 秒：生图链路本身最长可到 40s + 20s（主模型 + 降级），没有上限会直接撞穿 60 秒函数超时
      const coverFileID = await Promise.race([
        generateCover({
          title: record.title,
          excerpt,
          importId,
          uploadFile: (opts) => cloud.uploadFile(opts),
        }),
        sleep(30000).then(() => null),
      ])
      if (coverFileID) {
        await docRef.update({ data: { coverFileID, progressPct: 96 } })
      } else {
        await docRef.update({ data: { coverSkipped: true, progressPct: 96 } })
      }
      return { status: 'processing', progressPct: 96 }
    }

    // ---------- finalize：拼接音频 + 组装课程 ----------
    // 并行下载（原来 33 句串行下载约 10 秒，现在 6 并发约 2 秒）；顺序由 runPool 的索引保证
    const { results: buffers } = await runPool(total, 6, async (i) => {
      const dl = await cloud.downloadFile({ fileID: record.sentenceFileIDs[i] })
      return dl.fileContent
    })
    const finalUp = await cloud.uploadFile({
      cloudPath: `imports/${openid}/${importId}.mp3`,
      fileContent: Buffer.concat(buffers),
    })
    const durations = record.sentenceDurations || []
    const sentWords = record.sentenceWords || []
    let t = 0
    const timed = record.sentences.map((s, i) => {
      const start = t
      const dur = durations[i] || 1
      t += dur
      // 词级时间戳换算成全篇绝对时间（clamp 到句子区间内，防对齐值越界）
      const rel = sentWords[i]
      let words
      if (Array.isArray(rel) && rel.length) {
        words = rel
          .map((w) => ({
            text: w.text,
            startTime: start + Math.max(0, Math.min(Number(w.s) || 0, dur)),
            endTime: start + Math.max(0, Math.min(Number(w.e) || 0, dur)),
          }))
          .filter((w) => w.endTime > w.startTime)
      }
      return {
        text: s.text,
        paragraphIndex: s.paragraphIndex,
        startTime: start,
        endTime: t,
        ...(words && words.length ? { words } : {}),
      }
    })
    const lessonParagraphs = (record.paragraphs || []).map((p) => ({
      heading: p.heading,
      sentences: timed.slice(p.start, p.start + p.count).map((s) => ({
        text: s.text,
        startTime: s.startTime,
        endTime: s.endTime,
        ...(s.words ? { words: s.words } : {}),
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
