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
//   ELEVENLABS_CONCURRENCY（选填，并发句数；不填按模型自动取：Flash/Turbo 4，其余 2 —— 对应免费层并发上限）
// 注意：elevenlabs 免费层无商用授权、发布需署名；自用/测试没问题，正式商用请升级付费套餐。
const { synthesize: elevenlabs, synthesizeWithTimestamps: elevenlabsTs, getCredits } = require('./elevenlabs-tts')
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

/** 套餐/额度类错误：重试和"换下一句再试"都没有意义，本实例内直接熔断（免费层撞一次就整篇降级） */
function isFatalPlanError(e) {
  const d = String((e && (e.detail || e.message)) || '')
  return /paid_plan_required|quota_exceeded|insufficient|upgrade|credits|too_many_concurrent/i.test(d)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// 429（并发超限/限流）与 5xx 属于瞬时错误：并发化之后必须退避重试，
// 否则一句撞上 429 就会整篇降级换音色，音色前后不一致。
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504])
const MAX_RETRY = 2

function providerOrder(pinned) {
  const c = allConfigs()
  const now = Date.now()
  const avail = PRIORITY.filter((p) => c[p] && !(cooldownUntil[p] && cooldownUntil[p] > now))
  if (pinned && avail.includes(pinned)) return [pinned, ...avail.filter((p) => p !== pinned)]
  return avail
}

async function synthesizeWith(provider, text, trace) {
  const c = allConfigs()
  const rate = speechRate()
  if (provider === 'elevenlabs') {
    // 优先带词级时间戳（with_timestamps）：响应为 JSON，耗时与纯音频基本一致，
    // 词高亮从"句内按词长比例估算"升级为实测对齐。仅对"接口不支持时间戳"这类
    // 错误退回纯音频；429/5xx/套餐类错误原样抛出，交给上层的退避重试与熔断。
    try {
      return await elevenlabsTs({ ...c.elevenlabs, text, speechRate: rate })
    } catch (e) {
      const status = (e && e.status) || 0
      if (status === 429 || status >= 500 || isFatalPlanError(e) || status === 401 || status === 403) {
        throw e
      }
      const why = String((e && e.detail) || e.message || e).slice(0, 200)
      console.error('[tts] elevenlabs with_timestamps failed, fallback to plain audio:', why)
      // 记进 trace（落库），否则"这次为什么没有词级时间戳"只能翻云日志
      if (Array.isArray(trace) && trace.length < 20) {
        trace.push({ provider: 'elevenlabs', kind: 'timestamps_fallback', status, error: why })
      }
      return elevenlabs({ ...c.elevenlabs, text, speechRate: rate })
    }
  }
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
    for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
      try {
        const { audio, words } = await synthesizeWith(p, text, trace)
        if (!audio || !audio.length) throw new Error('TTS_EMPTY_AUDIO')
        return { audio, provider: p, words: Array.isArray(words) ? words : null }
      } catch (e) {
        lastErr = e
        const status = (e && e.status) || 0
        // 瞬时错误先退避重试，避免并发下的一句 429 把整篇推去降级（换音色 / 烧付费额度）。
        // 429 多来自「每分钟请求数」限制（Azure F0 就是 20 次/分钟），退避要比 5xx 长。
        if (RETRYABLE_STATUS.has(status) && attempt < MAX_RETRY) {
          const base = status === 429 ? 1200 : 400
          await sleep(base * (attempt + 1) + Math.floor(Math.random() * 400))
          continue
        }
        const msg = String((e && e.message) || e || 'unknown').slice(0, 200)
        console.error('[tts] provider', p, 'failed:', msg, status || (e && e.code) || '')
        if (Array.isArray(trace)) {
          const dup = trace.some((t) => t.provider === p && t.error === msg)
          if (!dup && trace.length < 20) {
            trace.push({ provider: p, status, error: msg, detail: String((e && e.detail) || '').slice(0, 300) })
          }
        }
        if (isFatalPlanError(e)) cooldownUntil[p] = Number.MAX_SAFE_INTEGER
        else if (status === 401 || status === 403) cooldownUntil[p] = Date.now() + 3600 * 1000
        break
      }
    }
  }
  const err = new Error('TTS_ALL_PROVIDERS_FAILED')
  err.cause = lastErr
  throw err
}

/**
 * 整篇统一服务商的额度预判（每篇只在第一轮查一次）
 *
 * 背景：句级降级是必要的，但 elevenlabs(44.1kHz) 与 azure(16kHz) 的 MP3 采样率不同，
 * 混拼出来的合并音频播放器直接解不动（实测 CoreAudio 报 ExtAudioFileRead failed）。
 * 所以导入开始前先查 elevenlabs 剩余额度，不够整篇就整篇改用下一个可用服务商，
 * 保证一篇里采样率始终一致。查询失败（网络/权限）时保持原选择，不阻塞导入。
 */
async function pickProviderForArticle(pinned, totalChars) {
  const provider = pinned || firstConfiguredProvider()
  if (provider !== 'elevenlabs') return { provider, guard: null }
  const c = elevenlabsConfig()
  if (!c) return { provider, guard: null }
  const credits = await getCredits({ apiKey: c.apiKey })
  if (!credits) return { provider, guard: { checked: false } }
  const need = Math.ceil(totalChars * 1.05)
  if (credits.remaining >= need) {
    return { provider, guard: { checked: true, remaining: credits.remaining, need } }
  }
  const cfg = allConfigs()
  const next = PRIORITY.filter((p) => p !== 'elevenlabs').find((p) => !!cfg[p])
  if (!next) return { provider, guard: { checked: true, remaining: credits.remaining, need, noAlternative: true } }
  return {
    provider: next,
    guard: { checked: true, remaining: credits.remaining, need, switchedTo: next },
  }
}

// 单轮最多处理句数。原来按"串行 + 每轮固定句数"防 60 秒超时（azure 20 句必超时 -504003）；
// 现在改为时间预算驱动（index.js 的 TTS_BUDGET_MS）+ 句级并发，这里只防止单轮过大、
// 进度条刷新太慢，取一个远大于常见文章句数的值，让一篇短文一轮跑完。
function maxChunkFor(provider) {
  return provider === 'elevenlabs' ? 40 : 48
}

// 句级并发上限
//  elevenlabs：免费层普通模型 2 并发、Flash/Turbo 4 并发（超了返回 429 too_many_concurrent_requests）
//  azure F0：20 次/分钟，4 并发足够，再高也只会在同一分钟内排队
//  tencent：接口快，5 并发
// 可用 ELEVENLABS_CONCURRENCY 覆盖 elevenlabs 的取值（升级套餐后调大）
function concurrencyFor(provider) {
  if (provider === 'elevenlabs') {
    const env = parseInt(trim(process.env.ELEVENLABS_CONCURRENCY), 10)
    if (Number.isFinite(env) && env > 0) return Math.min(8, env)
    const model = (trim(process.env.ELEVENLABS_MODEL_ID) || 'eleven_v4').toLowerCase()
    return /flash|turbo/.test(model) ? 4 : 2
  }
  if (provider === 'azure') return 4
  return 5
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
  pickProviderForArticle,
  isAnyProviderConfigured,
  firstConfiguredProvider,
  maxChunkFor,
  concurrencyFor,
  providerOrder,
  describeChain,
}
