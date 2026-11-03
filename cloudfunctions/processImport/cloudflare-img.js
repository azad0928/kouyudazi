// Cloudflare Workers AI 生图：按文章内容生成课程封面
// 只用 Cloudflare（每日免费 1 万 neurons）：首选 FLUX.2 klein 9B（multipart 入参，
// steps 固定 4 不可调），快速失败时自动降级 FLUX.1 schnell（JSON 入参）
// REST 返回为 JSON 包裹的 base64（result.image），兼容二进制直出
// 环境变量：CF_ACCOUNT_ID / CF_API_TOKEN（Workers AI 权限）；可选 CF_IMAGE_MODEL 覆盖首选模型
// CF 失败/当日额度用尽 → 返回 null，调用方给缺省封面并提示用户上传自定义封面
// （历史上接过 智谱/硅基流动/Pollinations 三层兜底，用户明确只要 CF，已移除）
const https = require('https')
const { compressCover } = require('./cover-compress')

const WIDTH = 960
const HEIGHT = 480

const KLEIN_9B = { id: '@cf/black-forest-labs/flux-2-klein-9b', kind: 'multipart' }
const SCHNELL = { id: '@cf/black-forest-labs/flux-1-schnell', kind: 'json' }

// 最近一次 generateCover 的失败原因（'CF_QUOTA_EXCEEDED' / 'CF_ERROR' / 'NOT_CONFIGURED'），
// 供 regenCover 透出结构化错误给前端做差异化提示（模块级状态，单实例单请求内有效）
let lastCoverFail = ''

function primaryModel() {
  const custom = (process.env.CF_IMAGE_MODEL || '').trim()
  // schnell 走 JSON 入参、其余（FLUX.2 系）走 multipart —— 之前一律按 multipart 传，
  // 环境变量填 schnell 会直接 400，等于这个开关是坏的
  if (custom) return { id: custom, kind: /schnell/i.test(custom) ? 'json' : 'multipart' }
  return KLEIN_9B
}

// 重新生成时的风格变体轮换：固定手绘动漫场景基调，只换色调/时刻/氛围，
// 既避免"再生成一次长得一样"，又不会跑出别的画种
const COVER_VARIANTS = [
  'warm golden-hour palette, sunlit glowing atmosphere',
  'cool twilight palette, soft starry sky',
  'vivid spring palette, bright clear day with fluffy clouds',
  'gentle pastel palette, hazy dreamy morning light',
]

// 停用词：高频但画面感弱的词，不配当封面元素
const STOPWORDS = new Set(
  ('a,an,the,and,or,but,if,then,else,when,at,by,for,with,about,into,through,during,' +
    'before,after,above,below,to,from,up,down,in,out,on,off,over,under,again,further,once,' +
    'here,there,all,any,both,each,few,more,most,other,some,such,no,nor,not,only,own,same,' +
    'so,than,too,very,can,will,just,should,now,is,am,are,was,were,be,been,being,have,has,' +
    'had,having,do,does,did,doing,would,could,i,you,he,she,it,we,they,them,his,her,its,' +
    'our,their,this,that,these,those,my,your,as,of,because,while,where,which,who,whom,' +
    'what,how,also,even,ever,never,often,still,back,made,make,many,much,like,get,got,go,' +
    'goes,went,come,came,know,knew,say,said,see,saw,take,took,think,thought,feel,felt,' +
    'look,looked,use,used,want,wanted,day,time,way,people,man,woman,one,two,first,last,' +
    'new,old,good,bad,big,small,long,little,us,me,him,myself,yourself,don,t,s,' +
    'against,away,among,between,within,without,along,across,behind,beyond,toward,' +
    'towards,upon,until,since,despite,except,seem,seems,appeared,appears,become,became'
  ).split(','),
)

/**
 * 从正文提关键词：小写化 → 取单词（缩写只留 ' 前部分）→ 去停用词/短词 → 按词频取 TopN。
 * 只输出单个名词性实词，不喂整句——整句会被 FLUX "画"成乱码字（v2.10 的教训），
 * 单个词则只会被当成画面元素画出来。
 */
function extractKeywords(text, maxN = 5) {
  const freq = new Map()
  const words = String(text || '').toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) || []
  for (let raw of words) {
    const w = raw.split("'")[0] // don't→don，cat's→cat
    if (w.length < 3 || STOPWORDS.has(w)) continue
    freq.set(w, (freq.get(w) || 0) + 1)
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, maxN)
    .map(([w]) => w)
}

/**
 * 标题优先的关键词：标题是作者压缩过的主题，画面感远强于正文词频 TopN。
 * 标题词占前排（最多 3 个），正文词频词补足剩余名额并去重。
 */
function extractTitleFirstKeywords(title, text, maxN = 5) {
  const pick = (t) =>
    (String(t || '').toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) || [])
      .map((w) => w.split("'")[0])
      .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
  const out = []
  for (const w of pick(title)) {
    if (!out.includes(w) && out.length < 3) out.push(w)
  }
  for (const w of extractKeywords(text, maxN + 6)) {
    if (out.length >= maxN) break
    if (!out.includes(w)) out.push(w)
  }
  return out
}

/** 清洗 LLM 产出：去引号/反斜杠/换行/星号，截断到 200 字符，取第一个非空行 */
function sanitizeScene(s) {
  const line = String(s || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)[0] || ''
  return line
    .replace(/^[#*\->\s"']+|["'*]+$/g, '') // 去首尾的 markdown 符号与引号
    .replace(/["\\]/g, ' ')
    .slice(0, 200)
    .trim()
}

const SCENE_INSTRUCTION =
  'You write image prompts for hand-painted anime story illustrations. ' +
  'Article title: "{TITLE}". Story keywords: {KEYWORDS}. ' +
  '{VARIANT}' +
  'Write ONE vivid English sentence (under 30 words) describing a concrete anime scene ' +
  'for this cover, with a clear main subject (an animal or a person) doing something in a place. ' +
  'The main subject must stay recognizable — do not turn it into an abstract shape or a hybrid creature. ' +
  'No text or letters in the image. Output only the sentence, nothing else.'

/** CF Workers AI 文本模型（与生图共用同一 token，消耗极少量 neurons） */
function cfChat(prompt, accountId, apiToken, timeoutMs) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(
      JSON.stringify({
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 120,
      }),
    )
    const req = https.request(
      {
        hostname: 'api.cloudflare.com',
        path: `/client/v4/accounts/${accountId}/ai/run/@cf/meta/llama-3.1-8b-instruct`,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
          'Content-Length': body.length,
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const buf = Buffer.concat(chunks)
          if (res.statusCode !== 200) {
            reject(new Error(`cf-chat HTTP ${res.statusCode}: ${buf.slice(0, 120).toString('utf8')}`))
            return
          }
          try {
            const j = JSON.parse(buf.toString('utf8'))
            const txt = j.result && j.result.response
            if (!txt) reject(new Error('cf-chat: empty response'))
            else resolve(txt)
          } catch (e) {
            reject(new Error('cf-chat: bad JSON'))
          }
        })
      },
    )
    req.on('timeout', () => req.destroy(Object.assign(new Error('cf-chat timeout'), { code: 'TIMEOUT' })))
    req.on('error', reject)
    req.end(body)
  })
}

/**
 * 写画面：CF llama 把标题+关键词转成一句具体场景描述（主题契合度的关键）。
 * 失败（未配置/额度用尽/超时）→ null，调用方退回启发式拼接。
 */
async function writeScene(title, text, accountId, apiToken, variant) {
  const keywords = extractTitleFirstKeywords(title, text, 5)
  const instruction = SCENE_INSTRUCTION.replace(
    '{TITLE}',
    String(title || '').slice(0, 80),
  )
    .replace('{KEYWORDS}', keywords.join(', ') || '(none)')
    .replace(
      '{VARIANT}',
      variant
        ? `Artistic direction for this version: ${variant}. `
        : '',
    )
  if (accountId && apiToken) {
    try {
      const scene = sanitizeScene(await cfChat(instruction, accountId, apiToken, 15000))
      if (scene.split(/\s+/).length >= 5) return { scene, sceneBy: 'cf-llama' }
    } catch (e) {
      console.error('writeScene cf-llama failed:', e && e.message)
    }
  }
  return { scene: null, sceneBy: 'heuristic' }
}

/** 启发式兜底：LLM 都挂了时，直接拿标题当主题（标题本身就是压缩过的故事） */
function heuristicScene(title, text) {
  const t = String(title || '').toLowerCase().replace(/["\\]/g, ' ').slice(0, 90)
  const kw = extractTitleFirstKeywords(title, text, 4).join(', ')
  return `a heartwarming anime scene about ${t.trim()}${kw ? `, featuring ${kw}` : ''}`
}

/** 由场景句组装最终生图 prompt：风格词前置（提升 adherence），场景句次之，no-text 收尾 */
function buildPromptFromScene(scene, variant) {
  const s = String(scene || '').trim().replace(/[.、。]+$/, '') // 防双句号
  let p =
    `Hand-painted anime illustration: ${s}. ` +
    `Lush detailed scenery, soft painterly brushwork, warm cinematic lighting, dreamy atmosphere. ` +
    `No text, no letters.`
  if (variant) p += ` Artistic direction for this version: ${variant}.`
  return p
}

function buildPrompt(title, text, variant) {
  // 同步版（无 LLM）：启发式场景，用于 diagCover 快速预览和 LLM 全挂时的兜底
  return buildPromptFromScene(heuristicScene(title, text), variant)
}

function buildMultipart(fields) {
  const boundary = '----cfimg' + Date.now().toString(36) + Math.random().toString(36).slice(2)
  const parts = []
  for (const k of Object.keys(fields)) {
    parts.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${fields[k]}\r\n`),
    )
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`))
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` }
}

/** 从响应中提取图片：二进制直出 或 JSON 包裹的 base64（result.image） */
function extractImage(buf, contentType) {
  const ct = String(contentType || '')
  if (ct.includes('image')) return buf
  try {
    const j = JSON.parse(buf.toString('utf8'))
    const b64 =
      (j.result && j.result.image) || j.image || (j.data && j.data[0] && j.data[0].b64_json)
    if (b64) return Buffer.from(String(b64), 'base64')
  } catch (e) {
    /* 非 JSON，视为无图 */
  }
  return null
}

function postImage(model, prompt, accountId, apiToken, timeoutMs) {
  return new Promise((resolve, reject) => {
    let body
    let contentType
    if (model.kind === 'multipart') {
      // klein 9B：multipart，steps 固定 4，不可传 num_steps
      const m = buildMultipart({ prompt, width: String(WIDTH), height: String(HEIGHT) })
      body = m.body
      contentType = m.contentType
    } else {
      // schnell 的 JSON 接口只认 prompt——传 width/height/num_steps 会 400
      // "Additional or unevaluated properties not allowed"（降级链路实测踩坑）
      body = Buffer.from(JSON.stringify({ prompt }))
      contentType = 'application/json'
    }
    const req = https.request(
      {
        hostname: 'api.cloudflare.com',
        path: `/client/v4/accounts/${accountId}/ai/run/${model.id}`,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': contentType,
          'Content-Length': body.length,
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const buf = Buffer.concat(chunks)
          if (res.statusCode !== 200) {
            const err = new Error(`${model.id} HTTP ${res.statusCode}: ${buf.slice(0, 200).toString('utf8')}`)
            err.statusCode = res.statusCode
            reject(err)
            return
          }
          const img = extractImage(buf, res.headers['content-type'])
          if (!img || img.length < 1024) {
            reject(new Error(`${model.id}: empty image response`))
            return
          }
          resolve(img)
        })
      },
    )
    req.on('timeout', () => req.destroy(Object.assign(new Error('cf-img timeout'), { code: 'TIMEOUT' })))
    req.on('error', reject)
    req.end(body)
  })
}

/**
 * 按文章生成封面并上传云存储，返回 cloud fileID；任何失败返回 null
 * @param {object} opts { title, text, importId, uploadFile, variant?, cloudPath?, sceneHint? }
 * text 为全文：先由 LLM 写成一句具体画面（writeScene），再交给生图模型
 */
async function generateCover({ title, text, importId, uploadFile, variant, cloudPath, sceneHint }) {
  const accountId = (process.env.CF_ACCOUNT_ID || '').trim()
  const apiToken = (process.env.CF_API_TOKEN || '').trim()
  lastCoverFail = ''

  // 场景句：外部已写好（diagCover 预览）就直接用，否则现写；LLM 全挂退启发式
  let scene = sceneHint || null
  let sceneBy = sceneHint ? 'hint' : null
  if (!scene) {
    const r = await writeScene(title, text, accountId, apiToken, variant)
    scene = r.scene
    sceneBy = r.sceneBy
  }
  if (!scene) scene = heuristicScene(title, text)
  // variant 已在场景句中消化，这里不再追加，防指令冲突
  const prompt = buildPromptFromScene(scene)
  console.log(`generateCover: sceneBy=${sceneBy} prompt="${prompt.slice(0, 180)}"`)

  // 只用 Cloudflare（klein → schnell）；失败/额度用尽 → null，前端给缺省图并提示上传自定义封面
  if (!(accountId && apiToken)) {
    lastCoverFail = 'NOT_CONFIGURED'
    return null
  }
  const primary = primaryModel()
  const chain = [{ model: primary, timeout: 40000 }]
  if (primary.id !== SCHNELL.id) chain.push({ model: SCHNELL, timeout: 20000 })
  let sawQuota = false
  for (const { model, timeout } of chain) {
    try {
      const img = await postImage(model, prompt, accountId, apiToken, timeout)
      const small = await compressCover(img)
      const up = await uploadFile({
        cloudPath: cloudPath || `covers/${importId}.jpg`,
        fileContent: small,
      })
      if (up.fileID) {
        if (model.id !== primary.id) console.log('generateCover: primary failed, fallback schnell used')
        return up.fileID
      }
    } catch (e) {
      console.error('generateCover failed:', model.id, e && e.message)
      if (e && e.statusCode === 429) sawQuota = true
      if (e && e.code === 'TIMEOUT') break // 超时：留预算，下次导入再试
    }
  }
  lastCoverFail = sawQuota ? 'CF_QUOTA_EXCEEDED' : 'CF_ERROR'
  return null
}

/** 最近一次 generateCover 的失败原因：CF_QUOTA_EXCEEDED / CF_ERROR / NOT_CONFIGURED / '' */
function getLastCoverFail() {
  return lastCoverFail
}

/**
 * 诊断（仅 owner）：封面生成链路的配置与真实错误，不吞错。
 * configOnly=true 时只返回配置与 prompt 预览（不耗 neurons 不出图）；
 * 否则真实走一遍 CF llama 场景句 + klein → schnell 生图。
 */
async function diagCover({ title, text, variant, configOnly }) {
  const accountId = (process.env.CF_ACCOUNT_ID || '').trim()
  const apiToken = (process.env.CF_API_TOKEN || '').trim()
  const out = {
    cfConfigured: !!(accountId && apiToken),
    primaryModel: primaryModel().id,
    prompt: null,
    sceneBy: null,
  }

  if (configOnly) {
    // 只做配置与 prompt 体检：不调 LLM 不出图
    out.prompt = buildPrompt(title, text, variant) // 启发式预览
    out.sceneFallback = heuristicScene(title, text)
    out.titleFirstKeywords = extractTitleFirstKeywords(title, text, 5)
    return out
  }

  // 场景句真实产出（CF llama → 启发式）
  const r = await writeScene(title, text, accountId, apiToken, variant)
  out.sceneBy = r.sceneBy
  out.scene = r.scene
  out.prompt = buildPromptFromScene(r.scene || heuristicScene(title, text), variant)

  // Cloudflare 链（唯一生图通道）
  if (out.cfConfigured) {
    const chain = [{ model: primaryModel(), timeout: 40000 }]
    if (primaryModel().id !== SCHNELL.id) chain.push({ model: SCHNELL, timeout: 20000 })
    const errs = []
    for (const { model, timeout } of chain) {
      try {
        const img = await postImage(model, out.prompt, accountId, apiToken, timeout)
        out.imageBytes = img.length
        out.usedModel = model.id
        return out
      } catch (e) {
        errs.push(`${model.id}: ${String((e && e.message) || e).slice(0, 200)}`)
      }
    }
    out.cfError = errs.join(' | ')
  } else {
    out.cfError = 'not configured'
  }
  return out
}

module.exports = {
  generateCover,
  getLastCoverFail,
  buildPrompt,
  buildPromptFromScene,
  writeScene,
  heuristicScene,
  extractKeywords,
  extractTitleFirstKeywords,
  diagCover,
  COVER_VARIANTS,
}
