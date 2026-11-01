// TTS 服务商链：elevenlabs（v4，免费额度优先）→ azure（F0 免费层）→ tencent（现网付费兜底）
// 整篇文章 pin 到同一个服务商（record.ttsProvider），避免一篇里混音色；
// 某句失败自动降级到下一个服务商并更新 pin（只在额度中途用尽这种小概率情况下，一篇可能混两个音色）。
//
// 环境变量（密钥只走环境变量，不进代码；去首尾空格）：
//   ELEVENLABS_API_KEY（配了才启用 elevenlabs）
//   ELEVENLABS_VOICE_ID（选填，默认 Rachel 21m00Tcm4TlvDq8ikWAM）
//   ELEVENLABS_MODEL_ID（选填，默认 eleven_v4）
//   AZURE_SPEECH_KEY + AZURE_SPEECH_REGION（两个都配了才启用 azure）
//   AZURE_VOICE_NAME（选填，默认 en-US-AvaNeural）
//   TENCENT_SECRET_ID / TENCENT_SECRET_KEY / VOICE_TYPE（原有，选填 TENCENT_REGION）
//   TTS_SPEECH_RATE（选填，默认 0.8：导入语音生成语速，0.8 适合基础薄弱；azure 走 SSML prosody，tencent 走 Speed，elevenlabs 走 speed）
// 注意：elevenlabs 免费层无商用授权、发布需署名；自用/测试没问题，正式商用请升级付费套餐。
const { synthesize: elevenlabs } = require('./elevenlabs-tts')
const { synthesize: azure } = require('./azure-tts')
const { synthesizeText: tencent } = require('./tencent-tts')

const trim = (v) => (v || '').trim()
const PRIORITY = ['elevenlabs', 'azure', 'tencent']

/** 生成语速（倍速）：默认 0.8；可用 TTS_SPEECH_RATE 覆盖 */
function speechRate() {
  const r = parseFloat(trim(process.env.TTS_SPEECH_RATE) || '0.8')
  return Number.isFinite(r) && r > 0 ? r : 0.8
}

function elevenlabsConfig() {
  const apiKey = trim(process.env.ELEVENLABS_API_KEY)
  if (!apiKey) return null
  return {
    apiKey,
    voiceId: trim(process.env.ELEVENLABS_VOICE_ID) || '21m00Tcm4TlvDq8ikWAM',
    modelId: trim(process.env.ELEVENLABS_MODEL_ID) || 'eleven_v4',
  }
}

function azureConfig() {
  const key = trim(process.env.AZURE_SPEECH_KEY)
  const region = trim(process.env.AZURE_SPEECH_REGION)
  if (!key || !region) return null
  return { key, region, voiceName: trim(process.env.AZURE_VOICE_NAME) || 'en-US-AvaNeural' }
}

function tencentConfig() {
  const secretId = trim(process.env.TENCENT_SECRET_ID)
  const secretKey = trim(process.env.TENCENT_SECRET_KEY)
  const voiceType = trim(process.env.VOICE_TYPE)
  if (!secretId || !secretKey || !voiceType) return null
  return { secretId, secretKey, voiceType, region: trim(process.env.TENCENT_REGION) || 'ap-guangzhou' }
}

function allConfigs() {
  return { elevenlabs: elevenlabsConfig(), azure: azureConfig(), tencent: tencentConfig() }
}

function isAnyProviderConfigured() {
  const c = allConfigs()
  return PRIORITY.some((p) => !!c[p])
}

function firstConfiguredProvider() {
  const c = allConfigs()
  return PRIORITY.find((p) => !!c[p]) || null
}

// 401/403 的服务商冷却 1 小时（密钥错/额度用尽时，不必每篇文章都去撞一次墙；
// 实例回收后失效，仅尽力而为，不影响正确性）
const cooldownUntil = {}

function providerOrder(pinned) {
  const c = allConfigs()
  const now = Date.now()
  const avail = PRIORITY.filter((p) => c[p] && !(cooldownUntil[p] && cooldownUntil[p] > now))
  if (pinned && avail.includes(pinned)) return [pinned, ...avail.filter((p) => p !== pinned)]
  return avail
}

async function synthesizeWith(provider, text) {
  const c = allConfigs()
  const rate = speechRate()
  if (provider === 'elevenlabs') return elevenlabs({ ...c.elevenlabs, text, speechRate: rate })
  if (provider === 'azure') return azure({ ...c.azure, text, speechRate: rate })
  return tencent({ ...c.tencent, text, speechRate: rate })
}

/**
 * 按优先级逐个尝试，返回 { audio: Buffer, provider }。
 * pinned：本篇文章已 pin 的服务商（优先用它，保证一篇内音色一致）。
 * 全部失败时抛 TTS_ALL_PROVIDERS_FAILED（调用方按原有失败流程 failRecord + 返还额度）。
 */
async function synthesizeText(text, pinned, trace) {
  const order = providerOrder(pinned)
  let lastErr = null
  for (const p of order) {
    try {
      const { audio } = await synthesizeWith(p, text)
      if (!audio || !audio.length) throw new Error('TTS_EMPTY_AUDIO')
      return { audio, provider: p }
    } catch (e) {
      lastErr = e
      const msg = String((e && e.message) || e || 'unknown').slice(0, 200)
      console.error('[tts] provider', p, 'failed:', msg, e && (e.status || e.code || e.detail || ''))
      if (Array.isArray(trace)) trace.push({ provider: p, error: msg })
      if (e && (e.status === 401 || e.status === 403)) cooldownUntil[p] = Date.now() + 3600 * 1000
    }
  }
  const err = new Error('TTS_ALL_PROVIDERS_FAILED')
  err.cause = lastErr
  throw err
}

// 每轮 TTS 句数：串行执行，一句 = 一次合成 API + 一次上传，约 2~5 秒；
// 每轮必须远小于 60 秒函数超时（冷启动再占几秒）。之前 azure 配 20 句必超时（-504003）。
function chunkSizeFor(provider) {
  if (provider === 'elevenlabs') return 5 // 单句 2~6 秒，最慢
  if (provider === 'azure') return 8 // 单句约 2~4 秒，8 句约 30 秒
  return 12 // tencent 快，每轮 12 句
}

/** 链路诊断（写进 imports 记录，免云日志排查）：各服务商是否就绪、缺什么、首选是谁 */
function missingReason(p) {
  if (p === 'elevenlabs') return 'ELEVENLABS_API_KEY 未配置'
  if (p === 'azure') {
    const k = trim(process.env.AZURE_SPEECH_KEY)
    const r = trim(process.env.AZURE_SPEECH_REGION)
    if (!k && !r) return 'AZURE_SPEECH_KEY 与 AZURE_SPEECH_REGION 均未配置'
    if (!k) return 'AZURE_SPEECH_KEY 未配置'
    return 'AZURE_SPEECH_REGION 未配置'
  }
  const miss = []
  if (!trim(process.env.TENCENT_SECRET_ID)) miss.push('TENCENT_SECRET_ID')
  if (!trim(process.env.TENCENT_SECRET_KEY)) miss.push('TENCENT_SECRET_KEY')
  if (!trim(process.env.VOICE_TYPE)) miss.push('VOICE_TYPE')
  return miss.join('、') + ' 未配置'
}
function describeChain() {
  const c = allConfigs()
  const providers = {}
  for (const p of PRIORITY) {
    providers[p] = c[p] ? { configured: true } : { configured: false, reason: missingReason(p) }
  }
  return { order: PRIORITY.slice(), providers, first: firstConfiguredProvider() }
}

module.exports = {
  synthesizeText,
  isAnyProviderConfigured,
  firstConfiguredProvider,
  chunkSizeFor,
  providerOrder,
  describeChain,
}
