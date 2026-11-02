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

/** 距签发超过 10 分钟即视为「将过期」（实测寿命约 15 分钟，留 5 分钟余量） */
export const COVER_URL_MAX_AGE = 10 * 60 * 1000

const LOCAL_COVER_COUNT = 8

/** 临时地址是否还算新鲜（非签名地址一律当作有效） */
export function coverUrlFresh(url: string): boolean {
  const m = /[?&]t=(\d+)/.exec(url || '')
  if (!m) return true
  return Date.now() - Number(m[1]) * 1000 < COVER_URL_MAX_AGE
}

/** 本地程序化封面：按 key 哈希固定取 8 张中的一张（同一 key 永远同一张） */
export function localCover(key: string): string {
  const s = String(key || '')
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return `/static/cover-import-${h % LOCAL_COVER_COUNT}.jpg`
}
