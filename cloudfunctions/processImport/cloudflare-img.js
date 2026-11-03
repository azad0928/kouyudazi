// Cloudflare Workers AI 生图：按文章内容生成课程封面
// 首选 FLUX.2 klein 9B（multipart 入参，steps 固定 4 不可调），快速失败时自动降级 FLUX.1 schnell（JSON 入参）
// REST 返回为 JSON 包裹的 base64（result.image），兼容二进制直出
// 环境变量：CF_ACCOUNT_ID / CF_API_TOKEN（Workers AI 权限）；可选 CF_IMAGE_MODEL 覆盖首选模型
// 兜底链：CF 两模型都失败（如当日免费 neurons 用尽 429）→ 硅基流动 Z-Image-Turbo
// （SILICONFLOW_API_KEY，按张计费需有余额）→ Pollinations 匿名接口（无 key 无额度，
// 但限流约 1 张/40s 且右下角有水印，靠裁掉底部 10% 去除）
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

/** 下载一个图片 URL（硅基流动返回临时 URL，24h 有效，只取一次） */
function downloadImage(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      if (res.statusCode !== 200) {
        res.resume()
        reject(new Error(`image url HTTP ${res.statusCode}`))
        return
      }
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        const buf = Buffer.concat(chunks)
        if (buf.length < 1024) reject(new Error('image url empty body'))
        else resolve(buf)
      })
    })
    req.on('timeout', () => req.destroy(Object.assign(new Error('image url timeout'), { code: 'TIMEOUT' })))
    req.on('error', reject)
  })
}

/** 硅基流动生图（Z-Image-Turbo 等）：POST JSON 返回 { images: [{ url }] }，再下载图片 */
function postSiliconflow(model, prompt, apiKey, timeoutMs) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(
      JSON.stringify({ model, prompt, image_size: `${WIDTH}x${HEIGHT}` }),
    )
    const req = https.request(
      {
        hostname: 'api.siliconflow.cn',
        path: '/v1/images/generations',
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
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
            const err = new Error(`siliconflow ${model} HTTP ${res.statusCode}: ${buf.slice(0, 160).toString('utf8')}`)
            err.statusCode = res.statusCode
            reject(err)
            return
          }
          try {
            const j = JSON.parse(buf.toString('utf8'))
            const url = j.images && j.images[0] && j.images[0].url
            if (!url) {
              reject(new Error('siliconflow: no image url in response'))
              return
            }
            resolve(downloadImage(url, timeoutMs))
          } catch (e) {
            reject(new Error('siliconflow: bad JSON response'))
          }
        })
      },
    )
    req.on('timeout', () => req.destroy(Object.assign(new Error('siliconflow timeout'), { code: 'TIMEOUT' })))
    req.on('error', reject)
    req.end(body)
  })
}

/** Pollinations 匿名生图：GET URL 直出 JPEG，无 key；seed 随机保证"再生成一次"有新图 */
function getPollinations(prompt, timeoutMs) {
  const seed = Date.now() % 1000000
  const path =
    `/prompt/${encodeURIComponent(prompt)}?width=${WIDTH}&height=${HEIGHT}` +
    `&nologo=true&seed=${seed}`
  return new Promise((resolve, reject) => {
    const req = https.get(
      { hostname: 'image.pollinations.ai', path, headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: timeoutMs },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume()
          reject(new Error(`pollinations HTTP ${res.statusCode}`))
          return
        }
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const buf = Buffer.concat(chunks)
          if (buf.length < 1024) reject(new Error('pollinations empty body'))
          else resolve(buf)
        })
      },
    )
    req.on('timeout', () => req.destroy(Object.assign(new Error('pollinations timeout'), { code: 'TIMEOUT' })))
    req.on('error', reject)
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
  const sfKey = (process.env.SILICONFLOW_API_KEY || '').trim()
  const prompt = buildPrompt(title, text, variant)

  // 第一梯队：Cloudflare（klein → schnell）
  if (accountId && apiToken) {
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
  }

  // 第二梯队：硅基流动（需配置 key 且账户有余额，按张计费）
  if (sfKey) {
    const sfModel = (process.env.SF_IMAGE_MODEL || 'Tongyi-MAI/Z-Image-Turbo').trim()
    try {
      const img = await postSiliconflow(sfModel, prompt, sfKey, 60000)
      const small = await compressCover(img)
      const up = await uploadFile({
        cloudPath: cloudPath || `covers/${importId}.jpg`,
        fileContent: small,
      })
      if (up.fileID) {
        console.log('generateCover: siliconflow fallback used')
        return up.fileID
      }
    } catch (e) {
      console.error('generateCover siliconflow failed:', e && e.message)
    }
  }

  // 第三梯队：Pollinations 匿名接口（无 key 无额度，底部 10% 裁掉水印）
  try {
    const img = await getPollinations(prompt, 60000)
    const small = await compressCover(img, { cropBottomRatio: 0.1 })
    const up = await uploadFile({
      cloudPath: cloudPath || `covers/${importId}.jpg`,
      fileContent: small,
    })
    if (up.fileID) {
      console.log('generateCover: pollinations fallback used')
      return up.fileID
    }
  } catch (e) {
    console.error('generateCover pollinations failed:', e && e.message)
  }

  return null
}

/**
 * 诊断（仅 owner）：封面生成链路的配置与真实错误，不吞错。
 * 依次实测 Cloudflare 两模型 → 硅基流动 → Pollinations，返回各层结果。
 */
async function diagCover({ title, text, variant }) {
  const accountId = (process.env.CF_ACCOUNT_ID || '').trim()
  const apiToken = (process.env.CF_API_TOKEN || '').trim()
  const sfKey = (process.env.SILICONFLOW_API_KEY || '').trim()
  const out = {
    cfConfigured: !!(accountId && apiToken),
    siliconflowConfigured: !!sfKey,
    primaryModel: primaryModel().id,
    prompt: null,
  }
  out.prompt = buildPrompt(title, text, variant)

  // Cloudflare 链
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

  // 硅基流动
  if (sfKey) {
    const sfModel = (process.env.SF_IMAGE_MODEL || 'Tongyi-MAI/Z-Image-Turbo').trim()
    out.siliconflowModel = sfModel
    try {
      const img = await postSiliconflow(sfModel, out.prompt, sfKey, 60000)
      out.siliconflowBytes = img.length
      out.usedModel = `siliconflow/${sfModel}`
      return out
    } catch (e) {
      out.siliconflowError = String((e && e.message) || e).slice(0, 220)
    }
  }

  // Pollinations（无 key 兜底，必测）
  try {
    const img = await getPollinations(out.prompt, 60000)
    out.pollinationsBytes = img.length
    if (!out.usedModel) out.usedModel = 'pollinations'
    return out
  } catch (e) {
    out.pollinationsError = String((e && e.message) || e).slice(0, 220)
  }
  return out
}

module.exports = { generateCover, buildPrompt, extractKeywords, diagCover, COVER_VARIANTS }
