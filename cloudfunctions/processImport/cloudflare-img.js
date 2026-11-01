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
  if (custom) return { id: custom, kind: 'multipart' } // FLUX.2 系走 multipart
  return KLEIN_9B
}

function buildPrompt(title, excerpt) {
  // 注意：不要把文章正文喂给模型——FLUX 看到英文句子会直接"画"出乱码文字，
  // 之前封面上的乱码就是这么来的。只用标题点题；no-text 指令放最前并重复强调。
  // excerpt 参数保留（兼容旧调用），不再使用。
  const safeTitle = String(title || '').slice(0, 60)
  return (
    `STRICT RULE: this image must contain absolutely NO text, NO words, NO letters, ` +
    `NO numbers, NO captions, NO signs, NO watermark, NO signature. ` +
    `Pure illustration only — draw shapes and scenes, never any writing. ` +
    `Subject: a flat vector illustration inspired by an English learning article titled "${safeTitle}". ` +
    `Style: clean geometric shapes, bold flat colors, modern minimal editorial illustration. ` +
    `Remember: no text or letters anywhere in the image.`
  )
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
      body = Buffer.from(JSON.stringify({ prompt, width: WIDTH, height: HEIGHT, num_steps: 4 }))
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
 * @param {object} opts { title, excerpt, importId, uploadFile }
 */
async function generateCover({ title, excerpt, importId, uploadFile }) {
  const accountId = (process.env.CF_ACCOUNT_ID || '').trim()
  const apiToken = (process.env.CF_API_TOKEN || '').trim()
  if (!accountId || !apiToken) return null // 未配置则静默跳过，用预设封面
  const prompt = buildPrompt(title, excerpt)
  const primary = primaryModel()
  const chain = [{ model: primary, timeout: 40000 }]
  if (primary.id !== SCHNELL.id) chain.push({ model: SCHNELL, timeout: 20000 })
  for (const { model, timeout } of chain) {
    try {
      const img = await postImage(model, prompt, accountId, apiToken, timeout)
      const small = await compressCover(img)
      const up = await uploadFile({
        cloudPath: `covers/${importId}.jpg`,
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

module.exports = { generateCover, buildPrompt }
