// Cloudflare Workers AI 生图：按文章内容生成课程封面
// 首选 FLUX.2 klein 9B（multipart 入参，steps 固定 4 不可调），快速失败时自动降级 FLUX.1 schnell（JSON 入参）
// REST 返回为 JSON 包裹的 base64（result.image），兼容二进制直出
// 环境变量：CF_ACCOUNT_ID / CF_API_TOKEN（Workers AI 权限）；可选 CF_IMAGE_MODEL 覆盖首选模型
// 兜底链：智谱 cogview-3-flash（ZHIPU_API_KEY，官方免费模型，画质稳无乱码，
// 右下角"AI生成"角标靠裁掉底部 10% 去除，后台安全管理关水印后可免裁）
// → CF 两模型（如当日免费 neurons 用尽 429）→ 硅基流动 Z-Image-Turbo
// （SILICONFLOW_API_KEY，按张计费需有余额）→ Pollinations 匿名接口（无 key 无额度，
// 但限流约 1 张/40s 且右下角有水印，靠裁掉底部 10% 去除）
// 任何失败返回 null，调用方 fallback 到预设封面，不阻塞导入流程
const https = require('https')
const { compressCover } = require('./cover-compress')

const WIDTH = 960
const HEIGHT = 480

const KLEIN_9B = { id: '@cf/black-forest-labs/flux-2-klein-9b', kind: 'multipart' }
const SCHNELL = { id: '@cf/black-forest-labs/flux-1-schnell', kind: 'json' }

// 智谱 cogview 只认固定尺寸档（512/768/1024/1440/2048），1440x720 是最接近 2:1 的横版
const ZHIPU_SIZE = '1440x720'
const ZHIPU_DEFAULT_MODEL = 'cogview-3-flash'

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
  'You write image prompts for children storybook covers. ' +
  'Article title: "{TITLE}". Story keywords: {KEYWORDS}. ' +
  '{VARIANT}' +
  'Write ONE vivid English sentence (under 30 words) describing a concrete picture-book scene ' +
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

/** Pollinations 免费文本接口（GET 直出纯文本，无 key），作为 CF LLM 的兜底 */
function pollinationsText(prompt, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      {
        hostname: 'text.pollinations.ai',
        path: `/${encodeURIComponent(prompt)}`,
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: timeoutMs,
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume()
          reject(new Error(`pollinations-text HTTP ${res.statusCode}`))
          return
        }
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const buf = Buffer.concat(chunks)
          if (buf.length < 8) reject(new Error('pollinations-text empty'))
          else resolve(buf.toString('utf8'))
        })
      },
    )
    req.on('timeout', () =>
      req.destroy(Object.assign(new Error('pollinations-text timeout'), { code: 'TIMEOUT' })),
    )
    req.on('error', reject)
  })
}

/**
 * 写画面：LLM 把标题+关键词转成一句具体场景描述（主题契合度的关键）。
 * 风格变体一并交给 LLM 消化（避免"蓝绿调色板"与"金色太阳"式指令打架）。
 * 三级降级：CF llama → Pollinations 文本 → null（调用方退回启发式拼接）。
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
  try {
    const scene = sanitizeScene(await pollinationsText(instruction, 25000))
    if (scene.split(/\s+/).length >= 5) return { scene, sceneBy: 'pollinations-text' }
  } catch (e) {
    console.error('writeScene pollinations-text failed:', e && e.message)
  }
  return { scene: null, sceneBy: 'heuristic' }
}

/** 启发式兜底：LLM 都挂了时，直接拿标题当主题（标题本身就是压缩过的故事） */
function heuristicScene(title, text) {
  const t = String(title || '').toLowerCase().replace(/["\\]/g, ' ').slice(0, 90)
  const kw = extractTitleFirstKeywords(title, text, 4).join(', ')
  return `a whimsical picture-book scene about ${t.trim()}${kw ? `, featuring ${kw}` : ''}`
}

/** 由场景句组装最终生图 prompt：风格词前置（提升 adherence），场景句次之，no-text 收尾 */
function buildPromptFromScene(scene, variant) {
  const s = String(scene || '').trim().replace(/[.、。]+$/, '') // 防双句号
  let p =
    `Flat children's storybook illustration: ${s}. ` +
    `Bold flat colors, clean vector shapes, whimsical cute character design. ` +
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

/** 智谱 cogview 生图：POST JSON 返回 { data: [{ url }] }，再下载图片（主力免费模型） */
function postZhipu(prompt, apiKey, timeoutMs) {
  return new Promise((resolve, reject) => {
    const model = (process.env.ZHIPU_IMAGE_MODEL || ZHIPU_DEFAULT_MODEL).trim()
    const body = Buffer.from(
      JSON.stringify({ model, prompt, size: ZHIPU_SIZE }),
    )
    const req = https.request(
      {
        hostname: 'open.bigmodel.cn',
        path: '/api/paas/v4/images/generations',
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
            const err = new Error(`zhipu ${model} HTTP ${res.statusCode}: ${buf.slice(0, 160).toString('utf8')}`)
            err.statusCode = res.statusCode
            reject(err)
            return
          }
          try {
            const j = JSON.parse(buf.toString('utf8'))
            const url = j.data && j.data[0] && j.data[0].url
            if (!url) {
              reject(new Error('zhipu: no image url in response'))
              return
            }
            resolve(downloadImage(url, timeoutMs))
          } catch (e) {
            reject(new Error('zhipu: bad JSON response'))
          }
        })
      },
    )
    req.on('timeout', () => req.destroy(Object.assign(new Error('zhipu timeout'), { code: 'TIMEOUT' })))
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
 * @param {object} opts { title, text, importId, uploadFile, variant?, cloudPath?, sceneHint? }
 * text 为全文：先由 LLM 写成一句具体画面（writeScene），再交给生图模型
 */
async function generateCover({ title, text, importId, uploadFile, variant, cloudPath, sceneHint }) {
  const accountId = (process.env.CF_ACCOUNT_ID || '').trim()
  const apiToken = (process.env.CF_API_TOKEN || '').trim()
  const sfKey = (process.env.SILICONFLOW_API_KEY || '').trim()
  const zhipuKey = (process.env.ZHIPU_API_KEY || '').trim()

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

  // 第一梯队：智谱 cogview-3-flash（官方免费、画质稳、主题遵循好；裁底部 10% 去"AI生成"角标）
  if (zhipuKey) {
    try {
      const img = await postZhipu(prompt, zhipuKey, 60000)
      const small = await compressCover(img, { cropBottomRatio: 0.1 })
      const up = await uploadFile({
        cloudPath: cloudPath || `covers/${importId}.jpg`,
        fileContent: small,
      })
      if (up.fileID) {
        console.log('generateCover: zhipu used')
        return up.fileID
      }
    } catch (e) {
      console.error('generateCover zhipu failed:', e && e.message)
    }
  }

  // 第二梯队：Cloudflare（klein → schnell）
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

  // 第三梯队：硅基流动（需配置 key 且账户有余额，按张计费）
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

  // 第四梯队：Pollinations 匿名接口（无 key 无额度，底部 10% 裁掉水印）
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
 * configOnly=true 时只返回配置与 prompt 预览（不耗 neurons 不出图）；
 * 否则依次实测 Cloudflare 两模型 → 硅基流动 → Pollinations，返回各层结果。
 */
async function diagCover({ title, text, variant, configOnly }) {
  const accountId = (process.env.CF_ACCOUNT_ID || '').trim()
  const apiToken = (process.env.CF_API_TOKEN || '').trim()
  const sfKey = (process.env.SILICONFLOW_API_KEY || '').trim()
  const zhipuKey = (process.env.ZHIPU_API_KEY || '').trim()
  const out = {
    zhipuConfigured: !!zhipuKey,
    zhipuModel: (process.env.ZHIPU_IMAGE_MODEL || ZHIPU_DEFAULT_MODEL).trim(),
    cfConfigured: !!(accountId && apiToken),
    siliconflowConfigured: !!sfKey,
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

  // 场景句真实产出（走完整三级降级）
  const r = await writeScene(title, text, accountId, apiToken)
  out.sceneBy = r.sceneBy
  out.scene = r.scene
  out.prompt = buildPromptFromScene(r.scene || heuristicScene(title, text), variant)

  // 智谱链（主力）
  if (zhipuKey) {
    try {
      const img = await postZhipu(out.prompt, zhipuKey, 60000)
      out.zhipuBytes = img.length
      out.usedModel = `zhipu/${(process.env.ZHIPU_IMAGE_MODEL || ZHIPU_DEFAULT_MODEL).trim()}`
      return out
    } catch (e) {
      out.zhipuError = String((e && e.message) || e).slice(0, 220)
    }
  }

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

module.exports = {
  generateCover,
  buildPrompt,
  buildPromptFromScene,
  writeScene,
  heuristicScene,
  extractKeywords,
  extractTitleFirstKeywords,
  diagCover,
  COVER_VARIANTS,
}
