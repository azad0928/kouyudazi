// ElevenLabs TTS（v4，免费额度优先）：api.elevenlabs.io，xi-api-key 鉴权，纯 Node https，无额外依赖
// 免费层：每月 10000 credits（v4 约 1 credit/字符 ≈ 10 分钟音频）；超额/限流时抛错，由调用方降级到下一个服务商。
const https = require('https')

function postBinary({ hostname, path, headers, body, timeoutMs, acceptJson }) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname, path, method: 'POST', headers, timeout: timeoutMs },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const buf = Buffer.concat(chunks)
          const ctype = String(res.headers['content-type'] || '')
          if (res.statusCode >= 200 && res.statusCode < 300) {
            if (acceptJson && /json/.test(ctype)) {
              try {
                resolve(JSON.parse(buf.toString('utf8')))
              } catch (e) {
                reject(new Error('ELEVENLABS_BAD_JSON'))
              }
              return
            }
            if (/audio|octet-stream/.test(ctype)) {
              resolve({ audio: buf, characterCost: res.headers['character-cost'] })
              return
            }
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

function buildBody({ text, modelId, speechRate }) {
  // speed 0.7~1.2；老模型不支持会 422，由调用方自动降级到 azure
  const sp = Math.max(0.7, Math.min(1.2, Number(speechRate) > 0 ? Number(speechRate) : 0.8))
  return JSON.stringify({ text, model_id: modelId, speed: sp })
}

/**
 * 合成一句英文，返回 { audio: Buffer }（MP3）
 * voiceId 默认 Rachel（21m00Tcm4TlvDq8ikWAM，清晰女声，与现有 YunMia 同为女声）；
 * modelId 默认 eleven_v4（质量优先；要低延迟可换 eleven_v4_turbo）。
 */
async function synthesize({ apiKey, voiceId, modelId, text, speechRate }) {
  const path = `/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`
  const body = buildBody({ text, modelId, speechRate })
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

/**
 * 从 with_timestamps 返回的字符级对齐里切出词级区间（相对该句音频的秒数）。
 * alignment.characters 与输入文本逐字符对应，按空格分组即得词区间；
 * 分组数与文本词数不一致（正常化改写了文本等）时返回 null，前端退回比例估算。
 */
function buildWordsFromAlignment(text, alignment) {
  const chars = alignment && alignment.characters
  const starts = alignment && alignment.character_start_times_seconds
  const ends = alignment && alignment.character_end_times_seconds
  if (!Array.isArray(chars) || !Array.isArray(starts) || !Array.isArray(ends)) return null
  if (chars.length !== starts.length || chars.length !== ends.length) return null
  const tokens = text.split(' ').filter(Boolean)
  const groups = []
  let cur = null
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] === ' ') {
      cur = null
      continue
    }
    if (!cur) {
      cur = { s: Number(starts[i]) || 0, e: Number(starts[i]) || 0 }
      groups.push(cur)
    }
    const e = Number(ends[i])
    if (e > cur.e) cur.e = e
  }
  if (groups.length !== tokens.length) return null
  return tokens.map((tok, i) => ({ text: tok, s: groups[i].s, e: groups[i].e }))
}

/**
 * 直接取 with_timestamps 的原始 JSON（诊断用：不解析、不吞错）
 * 返回 ElevenLabs 的完整响应体，便于排查"为什么没有词级时间戳"
 */
async function rawWithTimestamps({ apiKey, voiceId, modelId, text, speechRate }) {
  const path = `/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128&with_timestamps=true`
  const body = buildBody({ text, modelId, speechRate })
  return postBinary({
    hostname: 'api.elevenlabs.io',
    path,
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
    body,
    timeoutMs: 25000,
    acceptJson: true,
  })
}

/**
 * 合成一句英文并返回词级时间戳：{ audio: Buffer, words: [{text,s,e}] | null }
 * with_timestamps=true 时响应是 JSON（audio_base64 + alignment 字符级对齐）。
 * 时间戳解析不出来时 words 为 null（音频照常使用，前端按比例估算词时间）。
 */
async function synthesizeWithTimestamps({ apiKey, voiceId, modelId, text, speechRate }) {
  const data = await rawWithTimestamps({ apiKey, voiceId, modelId, text, speechRate })
  const audio = Buffer.from(String(data.audio_base64 || ''), 'base64')
  if (!audio.length) {
    const err = new Error('ELEVENLABS_EMPTY_AUDIO')
    err.status = 200
    throw err
  }
  let words = null
  try {
    words = buildWordsFromAlignment(text, data.alignment)
  } catch {
    words = null
  }
  return { audio, words }
}

/**
 * 查询账号剩余额度（字符）：GET /v1/user/subscription
 * 返回 { remaining, limit, used } 或 null（查询失败一律当"未知"，不阻塞导入）。
 * 用途：导入前预判整篇能不能用 elevenlabs 跑完——中途额度用尽会降级到 azure，
 * 两种服务商 MP3 采样率不同（44.1k / 16k），拼在一起播放器直接解不动。
 */
function getCredits({ apiKey }) {
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: 'api.elevenlabs.io',
        path: '/v1/user/subscription',
        method: 'GET',
        headers: { 'xi-api-key': apiKey, Accept: 'application/json' },
        timeout: 5000,
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            const used = Number(data.character_count)
            const limit = Number(data.character_limit)
            if (!Number.isFinite(used) || !Number.isFinite(limit)) return resolve(null)
            resolve({ used, limit, remaining: Math.max(0, limit - used) })
          } catch {
            resolve(null)
          }
        })
      },
    )
    req.on('timeout', () => req.destroy())
    req.on('error', () => resolve(null))
    req.end()
  })
}

module.exports = {
  synthesize,
  synthesizeWithTimestamps,
  rawWithTimestamps,
  buildWordsFromAlignment,
  getCredits,
}
