// 腾讯云 TTS（TextToVoice）调用：TC3-HMAC-SHA256 签名，纯 Node https，无额外依赖
const crypto = require('crypto')
const https = require('https')

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex')
}
function hmac(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest()
}

function postJson(host, path, headers, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: host, path, method: 'POST', headers, timeout: 30000 },
      (res) => {
        let raw = ''
        res.on('data', (c) => (raw += c))
        res.on('end', () => {
          try {
            resolve(JSON.parse(raw))
          } catch {
            reject(new Error('TTS_BAD_RESPONSE'))
          }
        })
      },
    )
    req.on('timeout', () => req.destroy(new Error('TTS_TIMEOUT')))
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

/**
 * 合成一句英文，返回 { audio: Buffer, duration: number | null }
 * duration 由调用方用 mp3-duration 解析（TTS 接口本身不返回时长）
 */
async function synthesizeText({ secretId, secretKey, region, text, voiceType, speechRate }) {
  const host = 'tts.tencentcloudapi.com'
  const service = 'tts'
  const payload = JSON.stringify({
    Text: text,
    SessionId: `import_${Date.now()}_${Math.floor(Math.random() * 1e9)}`,
    VoiceType: Number(voiceType),
    Codec: 'mp3',
    SampleRate: 16000,
    // 语速映射：rate 0.8 → Speed -1（0.8x）；公式 (rate-1)/0.2，钳制 [-2, 2]
    Speed: Math.max(-2, Math.min(2, ((Number(speechRate) > 0 ? Number(speechRate) : 0.8) - 1) / 0.2)),
    Volume: 0,
    PrimaryLanguage: 2,
  })
  const timestamp = Math.floor(Date.now() / 1000)
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10)
  // 规范请求（TC3 官方格式，一字不能差）：
  //   POST\n + /\n + \n(空查询串) + 请求头块(每行以\n结尾) + \n(空行) + 签名头 + \n + 负载哈希
  // 注意：请求头块与签名头之间必须有一个空行，这是官方示例明确要求的；
  // v48 曾误把这个空行当 bug 删掉，导致任何密钥都报 SignatureFailure（10-29 复盘确认）。
  const canonicalHeaders = 'content-type:application/json; charset=utf-8\nhost:' + host + '\n'
  const signedHeaders = 'content-type;host'
  const canonicalRequest =
    'POST\n/\n\n' + canonicalHeaders + '\n' + signedHeaders + '\n' + sha256Hex(payload)
  const credentialScope = `${date}/${service}/tc3_request`
  const stringToSign = [
    'TC3-HMAC-SHA256', String(timestamp), credentialScope, sha256Hex(canonicalRequest),
  ].join('\n')
  const kDate = hmac('TC3' + secretKey, date)
  const kService = hmac(kDate, service)
  const kSigning = hmac(kService, 'tc3_request')
  const signature = hmac(kSigning, stringToSign).toString('hex')
  const authorization = `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`

  const res = await postJson(
    host,
    '/',
    {
      'Content-Type': 'application/json; charset=utf-8',
      Host: host,
      'X-TC-Action': 'TextToVoice',
      'X-TC-Version': '2019-08-23',
      'X-TC-Timestamp': String(timestamp),
      'X-TC-Region': region,
      Authorization: authorization,
    },
    payload,
  )
  const r = res && res.Response
  if (!r || r.Error) {
    const err = new Error('TTS_API_ERROR')
    err.code = r && r.Error ? r.Error.Code : 'UNKNOWN'
    err.detail = r && r.Error ? r.Error.Message : ''
    throw err
  }
  if (!r.Audio) {
    throw new Error('TTS_EMPTY_AUDIO')
  }
  return { audio: Buffer.from(r.Audio, 'base64') }
}

module.exports = { synthesizeText }
