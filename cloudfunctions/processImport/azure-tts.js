// Azure Speech TTS（F0 免费层备选）：REST 接口 + subscription key，SSML 入参，MP3 出参，纯 Node https，无额外依赖
// 免费层：每月 50 万神经字符；F0 限 20 请求/分钟（本函数串行调用，不会撞线）。
const https = require('https')

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function postBinary({ hostname, path, headers, body, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname, path, method: 'POST', headers, timeout: timeoutMs },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const buf = Buffer.concat(chunks)
          const ctype = String(res.headers['content-type'] || '')
          if (res.statusCode >= 200 && res.statusCode < 300 && /audio|octet-stream/.test(ctype)) {
            resolve({ audio: buf })
            return
          }
          const err = new Error('AZURE_API_ERROR')
          err.status = res.statusCode
          err.detail = buf.slice(0, 500).toString('utf8')
          reject(err)
        })
      },
    )
    req.on('timeout', () => req.destroy(new Error('AZURE_TIMEOUT')))
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

/**
 * 合成一句英文，返回 { audio: Buffer }（MP3, 16kHz）
 * voiceName 默认 en-US-AvaNeural（美音女声）；region 如 eastus / japaneast。
 */
async function synthesize({ key, region, voiceName, text, speechRate }) {
  const rate = Number(speechRate) > 0 ? Number(speechRate) : 0.8
  const ssml =
    `<speak version='1.0' xml:lang='en-US'>` +
    `<voice name='${voiceName}'><prosody rate='${rate}'>${escapeXml(text)}</prosody></voice>` +
    `</speak>`
  const { audio } = await postBinary({
    hostname: `${region}.tts.speech.microsoft.com`,
    path: '/cognitiveservices/v1',
    headers: {
      'Ocp-Apim-Subscription-Key': key,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'audio-16khz-64kbitrate-mono-mp3',
      'User-Agent': 'swag-kouyu-dazi',
      'Content-Length': Buffer.byteLength(ssml),
    },
    body: ssml,
    timeoutMs: 25000,
  })
  return { audio }
}

module.exports = { synthesize, escapeXml }
