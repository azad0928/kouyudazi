/**
 * 封面工具：临时地址新鲜度判断 + 本地兜底图（首页 / 收藏页共用）
 *
 * 背景：免费版云存储「仅创建者可读写」，封面必须经 getAudioUrl 换成临时 https 地址。
 * 这个地址有两个坑：
 *   ① 寿命短（2026-10-31 实测约 15 分钟后 403），URL 里的 t 参数等于「签发时刻」；
 *   ② 云存储里的文件本身可能缺失（换地址照样成功，但打开是 404），
 *      此时无论换多少次地址都救不回来，只能显示本地兜底图。
 */

export const COVER_URLS_CACHE_KEY = 'coverUrlsCacheV1'

/**
 * 距签发超过 55 分钟视为「将过期」。
 * 云函数已显式请求 maxAge=2 小时（服务端若采纳则链接寿命更长），
 * 55 分钟留足余量；即使偶尔失效，也有 @error 自愈兜底（丢掉死链重取一次）。
 * 以前是 10 分钟 —— 每次进来都判过期、整批重取，白屏等一轮云函数，这是「封面加载慢」的主因。
 */
export const COVER_URL_MAX_AGE = 55 * 60 * 1000

/** 临时地址是否还算新鲜（非签名地址一律当作有效） */
export function coverUrlFresh(url: string): boolean {
  const m = /[?&]t=(\d+)/.exec(url || '')
  if (!m) return true
  return Date.now() - Number(m[1]) * 1000 < COVER_URL_MAX_AGE
}

/** 本地缺省封面：统一一张占位插画（原 8 张程序化封面已删除） */
export function localCover(_key: string): string {
  return '/static/cover-default.jpg'
}

/* ------------------------------------------------------------------ */
/* 封面本地缓存：把封面图永久缓存到用户目录，之后显示不再依赖临时地址    */
/* ------------------------------------------------------------------ */

/** 用户目录下的封面缓存目录（不支持文件系统的环境返回 null） */
function coverLocalDir(): string | null {
  const w = typeof wx !== 'undefined' ? (wx as any) : undefined
  if (!w || !w.env || !w.env.USER_DATA_PATH || typeof w.getFileSystemManager !== 'function') return null
  return `${w.env.USER_DATA_PATH}/covers`
}

/** fileID → 本地缓存路径（hash 出稳定文件名，避免 fileID 里的特殊字符进路径） */
export function coverLocalPath(fileID: string): string {
  let h = 5381
  for (let i = 0; i < fileID.length; i++) h = ((h << 5) + h + fileID.charCodeAt(i)) | 0
  return `${coverLocalDir()}/${(h >>> 0).toString(36)}.jpg`
}

/** 该封面是否已缓存到本地（已缓存返回本地路径，否则空串） */
export function checkLocalCover(fileID: string): Promise<string> {
  return new Promise((resolve) => {
    const dir = coverLocalDir()
    if (!dir || !fileID || !fileID.startsWith('cloud://')) return resolve('')
    const path = coverLocalPath(fileID)
    try {
      ;(wx as any)
        .getFileSystemManager()
        .access({ path, success: () => resolve(path), fail: () => resolve('') })
    } catch {
      resolve('')
    }
  })
}

/**
 * 把封面下载并缓存到本地（已缓存直接返回本地路径，不重复下载）。
 * 临时地址只在首次下载时用一次，之后显示全走本地文件 —— 封面永不过期、
 * 进小程序不用等换地址，也不消耗 getTempFileURL 调用。
 */
export function cacheCoverLocally(fileID: string, tempUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const dir = coverLocalDir()
    if (!dir || !fileID || !fileID.startsWith('cloud://') || !tempUrl) return resolve('')
    const fs = (wx as any).getFileSystemManager()
    const path = coverLocalPath(fileID)
    fs.access({
      path,
      success: () => resolve(path),
      fail: () => {
        try {
          fs.mkdirSync(dir, true)
        } catch {
          // 目录已存在等情况忽略
        }
        uni.downloadFile({
          url: tempUrl,
          success: (res: any) => {
            if (!res || res.statusCode !== 200 || !res.tempFilePath) return resolve('')
            fs.copyFile({
              srcPath: res.tempFilePath,
              destPath: path,
              success: () => resolve(path),
              fail: () => resolve(''),
            })
          },
          fail: () => resolve(''),
        })
      },
    })
  })
}
