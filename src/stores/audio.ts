import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { Lesson } from '@/types/lesson'

/**
 * 全局音频状态
 *
 * 使用 uni.getBackgroundAudioManager（在微信小程序端对应 wx.getBackgroundAudioManager），
 * 支持切出小程序后继续播放、锁屏控制。
 *
 * 注意：本阶段不做断点续播，不把播放进度写入任何本地或云端存储，
 * 每次进入课程都从头开始（同一课正在后台播放时再次进入则不打断）。
 *
 * 跟读模式用 rawCurrentTime（不取整）做切句判断，避免取整后切句延迟可达 1 秒。
 */
export const useAudioStore = defineStore('audio', () => {
  /** 当前课程 */
  const currentLesson = ref<Lesson | null>(null)
  /** 是否正在播放 */
  const playing = ref(false)
  /** 当前播放位置（秒，取整，用于进度条显示） */
  const currentTime = ref(0)
  /** 当前播放位置（秒，不取整）；跟读模式的切句判断用它 */
  const rawCurrentTime = ref(0)
  /** 高亮同步偏移（秒）：时间轴整体比人耳听到的声音超前约 0.12s
   *（MP3 编码前置延迟 + whisper 词边界偏差 + 设备输出延迟），
   * 单词/句子高亮与自动滚动用 displayTime 对齐人耳；跟读切句仍用真实时钟 */
  const SYNC_OFFSET = 0.12
  const IMPORT_SYNC_OFFSET = 0.4
  const displayTime = computed(() => {
    const offset = currentLesson.value?.source === 'import' ? IMPORT_SYNC_OFFSET : SYNC_OFFSET
    return Math.max(0, rawCurrentTime.value - offset)
  })
  /** 当前课程总时长（秒，取课程数据值） */
  const duration = ref(0)
  /** 音频加载中：点播放后、真正出声前为 true（云函数换地址 + 首缓冲/卡顿缓冲期间）；
   * 之前这段时间按钮无任何反馈，看起来像"点了没反应"；光标也会跟着空跑 */
  const audioLoading = ref(false)
  /** seek 目标位置：seek 是异步的，seek 完成前播放器可能先回旧位置，须忽略这些过期时间更新，避免高亮闪回上一句、跟读切句重复推进 */
  const seekTarget = ref<number | null>(null)
  const freshStartAt = ref(0)
  const FRESH_START_JUMP = 0.6

  // ---------- 平滑时钟 ----------
  // onTimeUpdate 回报间隔不稳（iOS 上 250ms~1s 不等），光标会一格一格地跳，
  // 看起来"越走越慢"；且 iOS 临近结尾会提前停止上报（onEnded 前一两秒 currentTime
  // 不再更新），语音读完了光标却停在倒数几秒处走不完。
  // 播放中用本地时钟按真实流逝时间推进进度，让光标匀速走、结尾不停摆；
  // 每次 onTimeUpdate 回报都用播放器数值重新校准锚点，不会累计漂移。
  let clockTicker: ReturnType<typeof setInterval> | null = null
  let clockAnchorValue = 0
  let clockAnchorAt = 0
  // 锚点之后最多本地推进的秒数：兜底"播放器彻底停止上报但没触发 ended"的情况，
  // 正常结尾上报冻结约 1~3 秒，4 秒足够覆盖；真卡住时光标最多领先 4 秒停住
  const CLOCK_MAX_ADVANCE = 4

  /** 停止平滑时钟（暂停/停止/出错时调用） */
  function stopClockTicker() {
    if (clockTicker !== null) {
      clearInterval(clockTicker)
      clockTicker = null
    }
  }

  /** 重设时钟锚点：rawCurrentTime 被外部直接赋值（回报/seek）后调用 */
  function resyncClock(value: number) {
    clockAnchorValue = value
    clockAnchorAt = Date.now()
  }

  /** 启动平滑时钟：每 200ms 按锚点 + 真实流逝时间推进 rawCurrentTime（不超过音频时长） */
  function startClockTicker() {
    stopClockTicker()
    resyncClock(rawCurrentTime.value)
    clockTicker = setInterval(() => {
      if (!duration.value) return
      // 暂停 / 缓冲 / seek 未完成：光标冻结在当前位置，同时保持锚点新鲜，
      // 恢复后从当前位置继续推进，不会把暂停/缓冲的时间算进进度
      if (!playing.value || audioLoading.value || seekTarget.value !== null) {
        resyncClock(rawCurrentTime.value)
        return
      }
      const projected =
        clockAnchorValue + (Date.now() - clockAnchorAt) / 1000
      const clamped = Math.min(
        projected,
        clockAnchorValue + CLOCK_MAX_ADVANCE,
        duration.value,
      )
      if (clamped > rawCurrentTime.value) {
        rawCurrentTime.value = clamped
        currentTime.value = Math.floor(clamped)
      }
    }, 200)
  }

  // 后台音频管理器单例，懒创建
  let bgm: ReturnType<typeof uni.getBackgroundAudioManager> | null = null
  // 监听器只绑定一次，避免重复回调
  let listenersBound = false
  // 云文件临时地址缓存（同一课一节内只取一次；并发调用去重；取失败返回 null）
  const resolvedSrcCache = new Map<string, { url: string; at: number }>()
  const resolvingSrc = new Map<string, Promise<string | null>>()
  // 2026-10-31 实测：getAudioUrl 未显式传 maxAge 时，换出的临时地址约 15 分钟内就 403。
  // 原本这里缓存 50 分钟 → “暂停十几分钟后再点播放”会拿着已死的 URL 去播，
  // 表现为点了没声音或直接弹「音频加载失败」。
  // 改为按链接自身的签发时刻判断（URL 里的 t 参数 = 签发时间戳，实测成立），过期即重取。
  const SRC_MAX_AGE = 10 * 60 * 1000

  /** 临时地址是否还算新鲜（非签名地址一律当作有效） */
  function srcFresh(url: string): boolean {
    const m = /[?&]t=(\d+)/.exec(url || '')
    if (!m) return true
    return Date.now() - Number(m[1]) * 1000 < SRC_MAX_AGE
  }
 // 倍速切换时已调用 pause、等 onPause 回调再设值恢复

  /** 获取后台音频管理器并绑定一次监听器 */
  function ensureBgm() {
    if (!bgm) {
      bgm = uni.getBackgroundAudioManager()
    }
    if (!listenersBound) {
      listenersBound = true
      bgm.onPlay(() => {
        playing.value = true
        audioLoading.value = false
        startClockTicker()
      })
      bgm.onWaiting(() => {
        // 缓冲中（首播或播放中卡顿）：按钮转圈，光标冻结，等真正出声再走
        audioLoading.value = true
      })
      bgm.onPause(() => {
        playing.value = false
        audioLoading.value = false
        stopClockTicker()
      })
      bgm.onStop(() => {
        playing.value = false
        audioLoading.value = false
        stopClockTicker()
      })
      bgm.onEnded(() => {
        // 播完就停：回到开头等待再次播放，不自动跳下一课
        playing.value = false
        currentTime.value = 0
        audioLoading.value = false
        stopClockTicker()
        // rawCurrentTime 补到末尾之外：iOS 临近结尾会提前停止上报，光标会停在
        // 倒数几秒处（语音读完了光标还没走完）。补齐后 displayTime 超过最后一句
        // 的 endTime，词/句高亮自然清空、Paused pill 隐藏，收尾干净。
        // 注意：这里不能清回 0——跟读模式靠它判断最后一句是否播完；该值在
        // 下一次 seek / play / loadLesson 时会被覆盖，不会长期残留。
        rawCurrentTime.value = duration.value + 1
      })
      bgm.onTimeUpdate(() => {
        if (!bgm) return
        const t = bgm.currentTime || 0
        // seek 进行中时，只接受落到目标附近（1 秒内）的上报：seek 是异步的，
        // 完成前播放器可能先报旧位置；跟读重播、上一句都是向后 seek，旧位置比
        // 目标大很多（最短的一句都有 2.11 秒），旧逻辑只拦“比目标小”的上报，
        // 旧位置一放行，跟读切句就误判为“当前句又播完了”而重复推进，把重复
        // 遍数吃掉——Shadow 看起来像正常连续播放，Repeat after 的重复也没了。
        // 目标附近的上报视为 seek 已完成，接受并清除守卫。
        if (seekTarget.value !== null && Math.abs(t - seekTarget.value) > 1) {
          return
        }
        seekTarget.value = null
        audioLoading.value = false
        if (freshStartAt.value) {
          if (Date.now() - freshStartAt.value > 4000) {
            freshStartAt.value = 0
          } else if (t > FRESH_START_JUMP && duration.value > 0 && t < duration.value - 1) {
            freshStartAt.value = 0
            seekTarget.value = 0
            if (bgm) bgm.seek(0)
            currentTime.value = 0
            rawCurrentTime.value = 0
            return
          } else if (t <= FRESH_START_JUMP) {
            freshStartAt.value = 0
          }
        }
        currentTime.value = Math.floor(t)
        rawCurrentTime.value = t
        // 用播放器回报重新校准平滑时钟锚点（本地推进不累计漂移的关键）
        resyncClock(t)
      })
      // seek 完成时对齐到目标位置（部分旧机型可能没有 onSeeked，onTimeUpdate 的守卫同样能兜底）
      if (typeof bgm.onSeeked === 'function') {
        bgm.onSeeked(() => {
          if (seekTarget.value !== null) {
            currentTime.value = Math.floor(seekTarget.value)
            rawCurrentTime.value = seekTarget.value
            resyncClock(seekTarget.value)
            seekTarget.value = null
          }
        })
      }
      bgm.onError(() => {
        playing.value = false
        audioLoading.value = false
        stopClockTicker()
        uni.showToast({ title: '音频加载失败，请检查网络', icon: 'none' })
      })
    }
    return bgm
  }

  /**
   * 解析课程的实际播放地址（只换地址，不动播放器；供预取/预热用）
   * 云文件 ID（cloud://）先经云函数 getAudioUrl 换成临时 https 地址再播：
   * 免费版存储权限固定为“仅创建者可读写”且控制台不允许改，小程序端直接取地址
   * 会被拒（STORAGE_EXCEED_AUTHORITY）；云函数以管理员身份运行，不受该限制。
   * 新鲜的地址直接复用（判据见 SRC_MAX_AGE）；并发调用去重；取失败返回 null
   */
  async function resolveSrc(lesson: Lesson): Promise<string | null> {
    const src = lesson.audioUrl
    if (!src.startsWith('cloud://')) {
      return src
    }
    const w = typeof wx !== 'undefined' ? (wx as any) : undefined
    if (!w || !w.cloud || typeof w.cloud.callFunction !== 'function') {
      return src // 无云能力时（如非微信平台预览）直接用原地址，播放器自行处理
    }
    const hit = resolvedSrcCache.get(lesson.id)
    if (hit && srcFresh(hit.url)) {
      return hit.url
    }
    const inflight = resolvingSrc.get(lesson.id)
    if (inflight) {
      return inflight
    }
    const p: Promise<string | null> = (async () => {
      try {
        const res = await w.cloud.callFunction({ name: 'getAudioUrl', data: { fileID: src } })
        const url = res && (res as any).result && (res as any).result.tempFileURL
        if (!url) {
          throw new Error('empty tempFileURL')
        }
        resolvedSrcCache.set(lesson.id, { url, at: Date.now() })
        return url as string
      } catch (e: any) {
        console.error('getAudioUrl failed', e)
        return null
      } finally {
        resolvingSrc.delete(lesson.id)
      }
    })()
    resolvingSrc.set(lesson.id, p)
    return p
  }

  /** 预取地址：fire-and-forget，失败静默（点播放时再正常报错） */
  function prefetchLesson(lesson: Lesson) {
    resolveSrc(lesson).catch(() => {})
  }

  /**
   * 预热：只提前把播放地址换好、写入缓存，不碰播放器。
   * 注意：BackgroundAudioManager 设 src 会自动开始播放，所以这里不能预装 src
   * （之前预装导致进文章页自动播、缓冲中点暂停被吞）。点播放时 ensureSrc 再装载。
   */
  async function warmLesson(lesson: Lesson) {
    await resolveSrc(lesson).catch(() => {})
  }

  /**
   * 解析课程的实际播放地址并确保播放器已装载（地址未设置时才设置；已装载时不打断后台播放）
   * 取失败返回 null 并提示
   */
  async function ensureSrc(lesson: Lesson): Promise<string | null> {
    const player = ensureBgm()
    const src = await resolveSrc(lesson)
    if (!src) {
      uni.showToast({ title: '音频加载失败，请检查网络', icon: 'none' })
      return null
    }
    if (player.src !== src) {
      player.title = lesson.title
      player.src = src
    }
    return src
  }

  /**
   * 进入课程详情页时调用
   * 正在播同一课时不打断；切课时停掉旧音频并回到开头
   */
  function loadLesson(lesson: Lesson) {
    if (currentLesson.value?.id === lesson.id) {
      return
    }
    freshStartAt.value = 0
    if (bgm) {
      bgm.stop()
    }
    stopClockTicker()
    currentLesson.value = lesson
    duration.value = lesson.duration
    currentTime.value = 0
    rawCurrentTime.value = 0
    seekTarget.value = null
    playing.value = false
  }

  /** 播放指定课程（已是当前课时则从当前位置继续） */
  async function playLesson(lesson: Lesson) {
    audioLoading.value = true
    const player = ensureBgm()
    if (currentLesson.value?.id !== lesson.id) {
      player.stop()
      currentLesson.value = lesson
      duration.value = lesson.duration
      currentTime.value = 0
      rawCurrentTime.value = 0
      seekTarget.value = null
    }
    const src = await ensureSrc(lesson)
    if (!src) {
      audioLoading.value = false
      return
    }
    freshStartAt.value = Date.now()
    player.play()
  }

  /** 播放 / 暂停切换 */
  async function toggle() {
    const player = ensureBgm()
    const lesson = currentLesson.value
    if (!lesson) {
      return
    }
    if (playing.value) {
      player.pause()
      return
    }
    // 先确保音频地址已装载：进课时 loadLesson 只记课程、不设播放源，
    // 不设源直接 play 会静默无反应（无报错、无声音），这就是之前点了没反应的原因
    audioLoading.value = true
    const src = await ensureSrc(lesson)
    if (!src) {
      audioLoading.value = false
      return
    }
    // 播完后再次按播放，从头开始
    if (duration.value > 0 && currentTime.value >= duration.value) {
      seekTarget.value = 0
      player.seek(0)
      currentTime.value = 0
      rawCurrentTime.value = 0
    }
    if (currentTime.value < 0.5) freshStartAt.value = Date.now()
    player.play()
  }

  /** 暂停播放（跟读模式的留白等待用；不改变播放位置） */
  function pause() {
    if (bgm) {
      bgm.pause()
    }
    playing.value = false
  }

  /** 跳转到指定秒数 */
  function seek(seconds: number) {
    const player = ensureBgm()
    if (!currentLesson.value) {
      return
    }
    const target = Math.max(0, Math.min(seconds, duration.value))
    seekTarget.value = target
    player.seek(target)
    currentTime.value = Math.floor(target)
    rawCurrentTime.value = target
    resyncClock(target)
  }

  /** 从指定秒数开始播放（逐句点读用） */
  async function playFrom(seconds: number) {
    const player = ensureBgm()
    const lesson = currentLesson.value
    if (!lesson) {
      return
    }
    audioLoading.value = true
    const src = await ensureSrc(lesson)
    if (!src) {
      audioLoading.value = false
      return
    }
    seekTarget.value = seconds
    player.seek(seconds)
    currentTime.value = Math.floor(seconds)
    rawCurrentTime.value = seconds
    resyncClock(seconds)
    player.play()
  }

  /** 停止播放 */
  function stop() {
    audioLoading.value = false
    stopClockTicker()
    if (bgm) {
      bgm.stop()
    }
    seekTarget.value = null
    playing.value = false
  }

  return {
    currentLesson,
    playing,
    audioLoading,
    currentTime,
    rawCurrentTime,
    displayTime,
    duration,
    loadLesson,
    prefetchLesson,
    warmLesson,
    resolveSrc,
    playLesson,
    toggle,
    pause,
    seek,
    playFrom,
    stop,
  }
})
