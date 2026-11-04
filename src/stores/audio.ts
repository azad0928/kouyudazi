import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { Lesson } from '@/types/lesson'
import { getLocalAudio, cacheAudioLocally, dropLocalAudio } from '@/utils/audio-cache'

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
   * 单词/句子高亮与自动滚动用 displayTime 对齐人耳；跟读切句仍用真实时钟。
   * 导入课 0.4 → 0.15：实测 elevenlabs 每句实际出声只比时间轴晚约 0.08s
   *（62 句逐句验证，前后半篇无漂移），再叠加设备输出延迟约 0.1s，
   * 0.15 已能对齐人耳；0.4 会造成光标恒定慢半拍约 0.3s。 */
  const SYNC_OFFSET = 0.12
  const IMPORT_SYNC_OFFSET = 0.15
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

  // 后台音频管理器单例，懒创建
  let bgm: ReturnType<typeof uni.getBackgroundAudioManager> | null = null
  // 监听器只绑定一次，避免重复回调
  let listenersBound = false
  // 云文件临时地址缓存（同一课一节内只取一次；并发调用去重；取失败返回 null）
  const resolvedSrcCache = new Map<string, { url: string; at: number }>()
  const resolvingSrc = new Map<string, Promise<string | null>>()
  // 临时地址有效期：云函数已显式请求 maxAge=2 小时，55 分钟只作保守上限。
  // 真正的过期兜底是播放器的 onError：万一 URL 已死，清掉该课缓存，下次播放自动重取。
  // 以前是 10 分钟 —— 稍微放一会儿再点播放就要重新等一轮云函数换地址，这是“点播放等好久”的主因之一。
  const SRC_MAX_AGE = 55 * 60 * 1000
  // 地址缓存持久化：冷启动/二次进入文章时直接命中，不用再等云函数
  const SRC_CACHE_KEY = 'audioUrlsCacheV1'
  let srcCacheLoaded = false
  let srcCacheSaveTimer: ReturnType<typeof setTimeout> | null = null
  // 当前正在用本地缓存文件播放的课程 id（onError 时据此降级回临时地址重试）
  let playingLocalFor = ''

  /** 本地文件路径（本地缓存）vs 网络/云地址 */
  function isLocalPath(src: string) {
    return !!src && !src.startsWith('http://') && !src.startsWith('https://') && !src.startsWith('cloud://')
  }

  /** 首次解析前把本地持久化的临时地址读回内存（只读新鲜的） */
  function loadSrcCache() {
    if (srcCacheLoaded) return
    srcCacheLoaded = true
    try {
      const c: any = uni.getStorageSync(SRC_CACHE_KEY)
      if (c && typeof c === 'object') {
        for (const k of Object.keys(c)) {
          const v = c[k]
          if (v && v.url && srcFresh(v.url)) {
            resolvedSrcCache.set(k, { url: v.url, at: v.at || Date.now() })
          }
        }
      }
    } catch {
      // 无缓存则走网络换地址
    }
  }

  /** 合并写回本地缓存（节流：批量预取时只写一次） */
  function saveSrcCacheSoon() {
    if (srcCacheSaveTimer) return
    srcCacheSaveTimer = setTimeout(() => {
      srcCacheSaveTimer = null
      try {
        const obj: Record<string, { url: string; at: number }> = {}
        resolvedSrcCache.forEach((v, k) => {
          if (srcFresh(v.url)) obj[k] = v
        })
        uni.setStorageSync(SRC_CACHE_KEY, obj)
      } catch {
        // 写缓存失败不影响播放
      }
    }, 600)
  }

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
      })
      bgm.onWaiting(() => {
        // 缓冲中（首播或播放中卡顿）：按钮转圈，光标冻结，等真正出声再走
        audioLoading.value = true
      })
      bgm.onPause(() => {
        playing.value = false
        audioLoading.value = false
      })
      bgm.onStop(() => {
        playing.value = false
        audioLoading.value = false
      })
      bgm.onEnded(() => {
        // 播完就停：回到开头等待再次播放，不自动跳下一课
        playing.value = false
        currentTime.value = 0
        audioLoading.value = false
        // 注意：这里特意不重置 rawCurrentTime。跟读模式靠它判断最后一句
        // 是否播完（最后一句 endTime 等于音频总时长时，onEnded 可能先于
        // 最后一次 onTimeUpdate 到达 endTime）；该值在下一次 seek / play /
        // loadLesson 时会被覆盖，不会长期残留。
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
      })
      // seek 完成时对齐到目标位置（部分旧机型可能没有 onSeeked，onTimeUpdate 的守卫同样能兜底）
      if (typeof bgm.onSeeked === 'function') {
        bgm.onSeeked(() => {
          if (seekTarget.value !== null) {
            currentTime.value = Math.floor(seekTarget.value)
            rawCurrentTime.value = seekTarget.value
            seekTarget.value = null
          }
        })
      }
      bgm.onError(() => {
        playing.value = false
        audioLoading.value = false
        const lesson = currentLesson.value
        // 本地缓存文件播放失败（个别机型不支持下发给后台播放器 / 文件损坏）：
        // 丢弃本地缓存、改回临时地址静默重试一次，不弹错误打扰用户
        if (lesson && playingLocalFor === lesson.id) {
          playingLocalFor = ''
          if (lesson.audioUrl && lesson.audioUrl.startsWith('cloud://')) dropLocalAudio(lesson.audioUrl)
          resolvedSrcCache.delete(lesson.id)
          audioLoading.value = true
          resolveSrc(lesson, false)
            .then((u) => {
              if (!u || !bgm) {
                audioLoading.value = false
                uni.showToast({ title: '音频加载失败，请检查网络', icon: 'none' })
                return
              }
              bgm.title = lesson.title
              bgm.src = u
              bgm.play()
            })
            .catch(() => {
              audioLoading.value = false
            })
          return
        }
        // 地址过期/文件异常：丢掉该课缓存，下次播放（或重新点播放）会重新换地址，
        // 不再拿着死链反复失败
        const id = currentLesson.value && currentLesson.value.id
        if (id) {
          resolvedSrcCache.delete(id)
          saveSrcCacheSoon()
        }
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
  async function resolveSrc(lesson: Lesson, allowDownload = false): Promise<string | null> {
    const src = lesson.audioUrl
    if (!src.startsWith('cloud://')) {
      return src
    }
    const w = typeof wx !== 'undefined' ? (wx as any) : undefined
    if (!w || !w.cloud || typeof w.cloud.callFunction !== 'function') {
      return src // 无云能力时（如非微信平台预览）直接用原地址，播放器自行处理
    }
    // 本地缓存优先：播放过的课直接读用户目录里的文件，
    // 不走云函数、不受临时地址过期 / 微信 HTTP 缓存回收影响（退出再进来秒起播）
    const local = await getLocalAudio(src)
    if (local) {
      return local
    }
    loadSrcCache()
    const hit = resolvedSrcCache.get(lesson.id)
    if (hit && srcFresh(hit.url)) {
      // 只在真正播放时触发下载：进页预取（warmLesson）只换地址，避免只浏览也拉几 MB 流量
      if (allowDownload) cacheAudioLocally(src, hit.url).catch(() => {})
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
        saveSrcCacheSoon()
        // 当前这次先用临时地址播，同时后台把音频下载到本地：
        // 之后播放（含退出小程序再进来）直接走本地文件，不再等换地址+缓冲
        if (allowDownload) cacheAudioLocally(src, url).catch(() => {})
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
   * 外部已经拿到临时地址时直接写缓存（例如 importApi getLesson 把地址一并返回），
   * 进详情页点播放就不用再多等一次 getAudioUrl 云函数往返。
   */
  function primeLessonSrc(lessonId: string, url: string) {
    if (!lessonId || !url) return
    if (!srcFresh(url)) return
    resolvedSrcCache.set(lessonId, { url, at: Date.now() })
    saveSrcCacheSoon()
  }

  /**
   * 批量预取：所有课的 cloud:// 音频地址合并成【一次】云函数调用。
   * 以前首页是 forEach 逐课调 prefetchLesson —— N 节课就是 N 次云函数调用，
   * 每次都排冷启动，既慢又费调用次数；这里改成一次批量换地址。
   */
  async function prefetchLessons(list: Lesson[]) {
    const w = typeof wx !== 'undefined' ? (wx as any) : undefined
    if (!w || !w.cloud || typeof w.cloud.callFunction !== 'function') return
    loadSrcCache()
    const cloudIds = new Set<string>()
    // cloud:// 地址 → 用到它的课程（多节课可能共用同一份音频）
    const byCloudId = new Map<string, Lesson[]>()
    for (const l of list) {
      const src = l && l.audioUrl
      if (!src || !src.startsWith('cloud://')) continue
      const hit = resolvedSrcCache.get(l.id)
      if (hit && srcFresh(hit.url)) continue
      cloudIds.add(src)
      const arr = byCloudId.get(src) || []
      arr.push(l)
      byCloudId.set(src, arr)
    }
    if (cloudIds.size === 0) return
    try {
      const res: any = await w.cloud.callFunction({
        name: 'getAudioUrl',
        data: { fileIDs: [...cloudIds].slice(0, 50) },
      })
      const urls: Record<string, string> = (res && res.result && res.result.urls) || {}
      let changed = false
      for (const cloudId of Object.keys(urls)) {
        const url = urls[cloudId]
        if (!url) continue
        for (const l of byCloudId.get(cloudId) || []) {
          resolvedSrcCache.set(l.id, { url, at: Date.now() })
          changed = true
        }
      }
      if (changed) saveSrcCacheSoon()
    } catch {
      // 预取失败静默：点播放时走单条解析并正常提示
    }
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
    const src = await resolveSrc(lesson, true)
    if (!src) {
      uni.showToast({ title: '音频加载失败，请检查网络', icon: 'none' })
      return null
    }
    if (player.src !== src) {
      player.title = lesson.title
      player.src = src
    }
    playingLocalFor = isLocalPath(src) ? lesson.id : ''
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
    player.play()
  }

  /** 停止播放 */
  function stop() {
    audioLoading.value = false
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
    prefetchLessons,
    primeLessonSrc,
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
