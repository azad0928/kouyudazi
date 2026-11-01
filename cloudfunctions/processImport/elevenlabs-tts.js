// ElevenLabs TTS（v4，免费额度优先）：api.elevenlabs.io，xi-api-key 鉴权，纯 Node https，无额外依赖
// 免费层：每月 10000 credits（v4 约 1 credit/字符 ≈ 10 分钟音频）；超额/限流时抛错，由调用方降级到下一个服务商。
const https = require('https')

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
            resolve({ audio: buf, characterCost: res.headers['character-cost'] })
            return
          }
          const err = new Error('ELEVENLABS_API_ERROR')
          err.status = res.statusCode
          err.detail = buf.slice(0, 500).toString('utf8')
          reject(err)
        })
      },
    )
    req.on('timeout', () => req.destroy(new Error('ELEVENLABS_TIMEOUT')))
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

/**
 * 合成一句英文，返回 { audio: Buffer }（MP3）
 * voiceId 默认 Rachel（21m00Tcm4TlvDq8ikWAM，清晰女声，与现有 YunMia 同为女声）；
 * modelId 默认 eleven_v4（质量优先；要低延迟可换 eleven_v4_turbo）。
 */
async function synthesize({ apiKey, voiceId, modelId, text, speechRate }) {
  const path = `/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`
  // speed 0.7~1.2；老模型不支持会 422，由调用方自动降级到 azure
  const sp = Math.max(0.7, Math.min(1.2, Number(speechRate) > 0 ? Number(speechRate) : 0.8))
  const body = JSON.stringify({ text, model_id: modelId, speed: sp })
  const { audio, characterCost } = await postBinary({
    hostname: 'api.elevenlabs.io',
    path,
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
      'Content-Length': Buffer.byteLength(body),
    },
    body,
    timeoutMs: 25000,
  })
  if (characterCost) console.log(`[tts] elevenlabs ok, character-cost=${characterCost}`)
  return { audio }
}

module.exports = { synthesize }
