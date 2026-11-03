// Cloudflare Workers AI 生图：按文章内容生成课程封面
// 首选 FLUX.2 klein 9B（multipart 入参，steps 固定 4 不可调），快速失败时自动降级 FLUX.1 schnell（JSON 入参）
// REST 返回为 JSON 包裹的 base64（result.image），兼容二进制直出
// 环境变量：CF_ACCOUNT_ID / CF_API_TOKEN（Workers AI 权限）；可选 CF_IMAGE_MODEL 覆盖首选模型
// 任何失败返回 null，调用方 fallback 到预设封面，不阻塞导入流程
const https = require('https')
const { compressCover } = require('./cover-compress')

const WIDTH = 960
const HEIGHT = 480

const KLEIN_9B = { id: '@cf/black-forest-labs/flux-2-klein-9b', kind: 'multipart' }
const SCHNELL = { id: '@cf/black-forest-labs/flux-1-schnell', kind: 'json' }

function primaryModel() {
  const custom = (process.env.CF_IMAGE_MODEL || '').trim()
  // schnell 走 JSON 入参、其余（FLUX.2 系）走 multipart —— 之前一律按 multipart 传，
  // 环境变量填 schnell 会直接 400，等于这个开关是坏的
  if (custom) return { id: custom, kind: /schnell/i.test(custom) ? 'json' : 'multipart' }
  return KLEIN_9B
}

// 重新生成时的风格变体轮换：每次换一种艺术走向，免得"再生成一次"长得和上一张一样
const COVER_VARIANTS = [
  'warm sunset color palette, cozy and inviting atmosphere',
  'cool teal and blue color palette, calm and fresh atmosphere',
  'vibrant highly saturated colors, dynamic diagonal composition',
  'soft pastel colors, serene minimal composition with generous negative space',
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

function buildPrompt(title, text, variant) {
  // text 是全文：只从中提关键词喂给模型，绝不喂整句——FLUX 看到英文句子会直接
  // "画"出乱码文字（之前封面上的乱码就是这么来的）。标题照旧只取前 60 字点题；
  // 标题里的双引号/反斜杠替换成空格——否则会提前闭合 titled "..." 引起嵌套，
  // 轻则 prompt 语义断裂，重则可借标题注入指令干扰生图。
  const safeTitle = String(title || '').slice(0, 60).replace(/["\\]/g, ' ')
  const keywords = extractKeywords(text, 5)
  let p =
    `STRICT RULE: this image must contain absolutely NO text, NO words, NO letters, ` +
    `NO numbers, NO captions, NO signs, NO watermark, NO signature. ` +
    `Pure illustration only — draw shapes and scenes, never any writing. ` +
    `Subject: a flat vector illustration inspired by an English learning article titled "${safeTitle}". ` +
    (keywords.length >= 2
      ? `Visual elements to depict (draw them as illustration, do NOT render as text): ${keywords.join(', ')}. `
      : '') +
    `Style: clean geometric shapes, bold flat colors, modern minimal editorial illustration. ` +
    `Remember: no text or letters anywhere in the image.`
  if (variant) p += ` Artistic direction for this version: ${variant}.`
  return p
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
 * @param {object} opts { title, text, importId, uploadFile, variant?, cloudPath? }
 * text 为全文：内部只提关键词，不喂整句（防乱码字）
 */
async function generateCover({ title, text, importId, uploadFile, variant, cloudPath }) {
  const accountId = (process.env.CF_ACCOUNT_ID || '').trim()
  const apiToken = (process.env.CF_API_TOKEN || '').trim()
  if (!accountId || !apiToken) return null // 未配置则静默跳过，用预设封面
  const prompt = buildPrompt(title, text, variant)
  const primary = primaryModel()
  const chain = [{ model: primary, timeout: 40000 }]
  if (primary.id !== SCHNELL.id) chain.push({ model: SCHNELL, timeout: 20000 })
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
      if (e && e.code === 'TIMEOUT') break // 超时不降级：留预算，下次导入再试
    }
  }
  return null
}

/**
 * 诊断（仅 owner）：封面生成链路的配置与真实错误，不吞错。
 * 返回 { configured, prompt, primaryModel, imageBytes | error }
 */
async function diagCover({ title, text, variant }) {
  const accountId = (process.env.CF_ACCOUNT_ID || '').trim()
  const apiToken = (process.env.CF_API_TOKEN || '').trim()
  const out = {
    configured: !!(accountId && apiToken),
    accountIdLen: accountId.length,
    tokenLen: apiToken.length,
    primaryModel: primaryModel().id,
    prompt: null,
  }
  if (!out.configured) return out
  out.prompt = buildPrompt(title, text, variant)
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
  out.error = errs.join(' | ')
  return out
}

module.exports = { generateCover, buildPrompt, extractKeywords, diagCover, COVER_VARIANTS }
