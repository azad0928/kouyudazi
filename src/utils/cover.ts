/** Shared, full-resolution cover cache. Cloud file IDs are immutable cache keys. */
export const COVER_URLS_CACHE_KEY = 'coverUrlsCacheV1'
/** Local-only diagnostics: never record signed query strings or account information. */
export function reportCover(stage:string, id:string, error:any='', source='') {
 const host=/^https:\/\/([^/?#]+)/.exec(source)?.[1] || '';
 const message=String(error?.errMsg || error?.message || error || '').replace(/https?:\/\/[^\s"']+/g, value=>value.split('?')[0]).slice(0,220);
 const item={at:Date.now(),stage,file:id.split('/').pop()?.split('?')[0] || '',host,message};
 console.warn('[Cover]',JSON.stringify(item));
 try {const old=uni.getStorageSync('coverDiagnosticsV1');uni.setStorageSync('coverDiagnosticsV1',[...(Array.isArray(old)?old:[]).slice(-39),item])}catch{}
}
// Be conservative only for uncached files; locally saved images never need re-signing.
export const COVER_URL_MAX_AGE = 10 * 60 * 1000
export function coverUrlFresh(url: string): boolean {
  const m = /[?&]t=(\d+)/.exec(url || '')
  return !!url && (!m || Date.now() - Number(m[1]) * 1000 < COVER_URL_MAX_AGE)
}
export function localCover(_key = '') { return '/static/cover-default.jpg' }
function api(): any { return typeof wx === 'undefined' ? null : wx }
function coverLocalDir(): string | null {
  const w = api()
  return w?.env?.USER_DATA_PATH && w.getFileSystemManager ? `${w.env.USER_DATA_PATH}/covers` : null
}
export function coverLocalPath(fileID: string): string {
  let h = 5381
  for (let i = 0; i < fileID.length; i++) h = ((h << 5) + h + fileID.charCodeAt(i)) | 0
  return `${coverLocalDir()}/${(h >>> 0).toString(36)}.jpg`
}
const knownLocal = new Map<string, string>()
/** Synchronous first paint; do not scan unrelated files before showing a cached image. */
export function cachedCover(fileID: string): string {
  if (!fileID?.startsWith('cloud://')) return fileID || ''
  const path = knownLocal.get(fileID) || coverLocalPath(fileID)
  try {
    if (!coverLocalDir()) return ''
    api().getFileSystemManager().accessSync(path)
    knownLocal.set(fileID, path)
    return path
  } catch { knownLocal.delete(fileID); return '' }
}
export async function checkLocalCover(fileID: string): Promise<string> { return cachedCover(fileID) }
function readUrls(): Record<string, string> {
  try { return uni.getStorageSync(COVER_URLS_CACHE_KEY)?.urls || {} } catch { return {} }
}
function storeUrls(urls: Record<string, string>) {
  try { uni.setStorageSync(COVER_URLS_CACHE_KEY, {at: Date.now(), urls: {...readUrls(), ...urls}}) } catch {}
}
const downloads = new Map<string, Promise<string>>()
const queue: Array<() => void> = []
let active = 0
function drain() { while (active < 2 && queue.length) { active++; queue.shift()!() } }
/** At most two full-resolution downloads; a file is downloaded once, not once per image node. */
export function cacheCoverLocally(fileID: string, tempUrl: string): Promise<string> {
  const hit = cachedCover(fileID)
  if (hit) return Promise.resolve(hit)
  if (!coverLocalDir() || !fileID?.startsWith('cloud://') || !tempUrl) return Promise.resolve('')
  const pending = downloads.get(fileID)
  if (pending) return pending
  const job = new Promise<string>(resolve => {
    queue.push(() => {
      const finish = (path = '') => { active--; downloads.delete(fileID); resolve(path); drain() }
      try {
        const fs = api().getFileSystemManager(), path = coverLocalPath(fileID)
        try { fs.mkdirSync(coverLocalDir(), true) } catch {}
        uni.downloadFile({url: tempUrl, timeout: 20000,
          success: (result: any) => {
            if (result.statusCode !== 200 || !result.tempFilePath) {reportCover('download-http',fileID,'HTTP '+result.statusCode,tempUrl);return finish()}
            try { fs.copyFile({srcPath: result.tempFilePath, destPath: path,
              success: () => {knownLocal.set(fileID, path); finish(path)}, fail: (error:any) => {reportCover('save-file',fileID,error,tempUrl);finish(result.tempFilePath)}}) } catch(error) {reportCover('save-file',fileID,error,tempUrl);finish(result.tempFilePath)}
          }, fail: (error:any) => {reportCover('download',fileID,error,tempUrl);finish()}})
      } catch(error) {reportCover('download',fileID,error,tempUrl);finish()}
    })
  })
  downloads.set(fileID, job)
  drain()
  return job
}
const signing = new Map<string, Promise<string>>()
const batch = new Map<string, (url: string) => void>()
let batchTimer: ReturnType<typeof setTimeout> | null = null
function signedUrl(fileID: string): Promise<string> {
  const cached = readUrls()[fileID]
  if (coverUrlFresh(cached)) return Promise.resolve(cached)
  if (signing.has(fileID)) return signing.get(fileID)!
  const job = new Promise<string>(resolve => batch.set(fileID, resolve))
  signing.set(fileID, job)
  if (!batchTimer) batchTimer = setTimeout(async () => {
    batchTimer = null
    const entries = [...batch.entries()]; batch.clear()
    let urls: Record<string, string> = {}
    try {
      const response = await api().cloud.callFunction({name: 'getAudioUrl', data: {fileIDs: entries.map(([id]) => id)}})
      urls = response.result?.urls || {}; storeUrls(urls)
    } catch(error) {for(const [id] of entries)reportCover('sign-function',id,error)} finally {
      for (const [id, resolve] of entries) {signing.delete(id); resolve(urls[id] || '')}
    }
  }, 0)
  return job
}
const preparing = new Map<string, Promise<string>>()
async function prepareCover(fileID: string): Promise<string> {
  const cached = cachedCover(fileID)
  if (cached) return cached
  if (!fileID.startsWith('cloud://')) return fileID
  if (preparing.has(fileID)) return preparing.get(fileID)!
  const job = (async () => {
    const url = await signedUrl(fileID)
    if (!url) return ''
    // Render the downloaded local file: avoids a second simultaneous image-network download.
    return await cacheCoverLocally(fileID, url) || url
  })()
  preparing.set(fileID, job)
  try { return await job } finally { preparing.delete(fileID) }
}
/** Notify each ready image individually. A slow image never holds up its neighbours. */
export async function loadCoverSources(ids: string[], ready: (id: string, source: string) => void): Promise<void> {
  await Promise.all([...new Set(ids.filter(Boolean))].map(async id => {
    const local = cachedCover(id)
    if (local) {ready(id, local); return}
    const source = await prepareCover(id)
    if (source) ready(id, source)
  }))
}
/** Only discard this generated cache file; the original cloud cover stays untouched. */
export function invalidateCover(fileID: string) {
  knownLocal.delete(fileID)
  try { api().getFileSystemManager().unlinkSync(coverLocalPath(fileID)) } catch {}
  try { const urls = {...readUrls()}; delete urls[fileID]; uni.setStorageSync(COVER_URLS_CACHE_KEY, {at: Date.now(), urls}) } catch {}
}
