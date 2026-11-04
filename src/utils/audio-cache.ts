/**
 * 音频本地缓存：把「实际播放过」的课程音频持久存到用户目录
 * （wx.env.USER_DATA_PATH/audio/<hash>.mp3），之后播放直接读本地文件 ——
 * 起播不再等云函数换地址，也不受临时地址过期 / 微信 HTTP 缓存回收影响
 * （后者是「退出小程序再进来，点播放卡一下」的根因）。
 *
 * 下载策略：只在点播放（resolveSrc 单条解析）命中临时地址后下载；
 * 首页批量预取只换地址、不下载，避免一次性拉几十 MB 流量。
 *
 * 容量：微信用户目录约 200MB，这里保守限 150MB，超限按最旧淘汰（LRU）。
 */

const AUDIO_CACHE_LIMIT = 150 * 1024 * 1024
const AUDIO_META_KEY = 'audioFilesCacheV1'

/** fileID → 本地路径（模块级内存缓存，'' 表示已确认无本地缓存） */
const localMap = new Map<string, string>()

function wxFs(): any | null {
  const w = typeof wx !== 'undefined' ? (wx as any) : undefined
  if (!w || !w.env || !w.env.USER_DATA_PATH || typeof w.getFileSystemManager !== 'function') return null
  return w
}

function audioDir(): string | null {
  const w = wxFs()
  return w ? `${w.env.USER_DATA_PATH}/audio` : null
}

/** fileID → 本地缓存路径（hash 出稳定文件名，避免 fileID 里的特殊字符进路径） */
export function audioLocalPath(fileID: string): string {
  let h = 5381
  for (let i = 0; i < fileID.length; i++) h = ((h << 5) + h + fileID.charCodeAt(i)) | 0
  return `${audioDir()}/${(h >>> 0).toString(36)}.mp3`
}

function readMeta(): Record<string, { size: number; at: number }> {
  try {
    const m: any = uni.getStorageSync(AUDIO_META_KEY)
    if (m && typeof m === 'object') return m
  } catch {
    // ignore
  }
  return {}
}

function writeMeta(meta: Record<string, { size: number; at: number }>) {
  try {
    uni.setStorageSync(AUDIO_META_KEY, meta)
  } catch {
    // 写失败不影响播放
  }
}

/** 超容量时按最旧淘汰（LRU）：删文件 + 删元信息 */
function prune() {
  const meta = readMeta()
  const keys = Object.keys(meta)
  let total = 0
  for (const k of keys) total += meta[k].size || 0
  if (total <= AUDIO_CACHE_LIMIT) return
  const fs = (wxFs() as any).getFileSystemManager()
  const sorted = keys.slice().sort((a, b) => (meta[a].at || 0) - (meta[b].at || 0))
  for (const k of sorted) {
    if (total <= AUDIO_CACHE_LIMIT) break
    const size = meta[k].size || 0
    try {
      fs.unlink({ filePath: audioLocalPath(k), fail: () => {} })
    } catch {
      // ignore
    }
    delete meta[k]
    localMap.delete(k)
    total -= size
  }
  writeMeta(meta)
}

/** 该音频是否已缓存到本地（已缓存返回本地路径；结果做内存缓存，重复调用不重复 access） */
export function getLocalAudio(fileID: string): Promise<string> {
  return new Promise((resolve) => {
    if (!fileID || !fileID.startsWith('cloud://')) return resolve('')
    const hit = localMap.get(fileID)
    if (hit !== undefined) return resolve(hit)
    const dir = audioDir()
    if (!dir) return resolve('')
    try {
      ;(wxFs() as any)
        .getFileSystemManager()
        .access({
          path: audioLocalPath(fileID),
          success: () => {
            const p = audioLocalPath(fileID)
            localMap.set(fileID, p)
            // 播放即更新 LRU 时间
            const meta = readMeta()
            if (meta[fileID]) {
              meta[fileID].at = Date.now()
              writeMeta(meta)
            }
            resolve(p)
          },
          fail: () => {
            localMap.set(fileID, '')
            resolve('')
          },
        })
    } catch {
      resolve('')
    }
  })
}

/**
 * 下载音频并缓存到本地（已缓存直接返回本地路径，不重复下载）。
 * fire-and-forget 调用即可：当前这次播放仍用临时地址，下载完成后
 * 下次播放（含退出小程序再进来）直接走本地文件。
 */
export function cacheAudioLocally(fileID: string, tempUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const dir = audioDir()
    if (!dir || !fileID || !fileID.startsWith('cloud://') || !tempUrl) return resolve('')
    const fs = (wxFs() as any).getFileSystemManager()
    const path = audioLocalPath(fileID)
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
              success: () => {
                try {
                  const stat = fs.statSync(path) || {}
                  const meta = readMeta()
                  meta[fileID] = { size: (stat as any).size || 0, at: Date.now() }
                  writeMeta(meta)
                  prune()
                } catch {
                  // 元信息失败不影响缓存文件本身
                }
                localMap.set(fileID, path)
                resolve(path)
              },
              fail: () => resolve(''),
            })
          },
          fail: () => resolve(''),
        })
      },
    })
  })
}

/** 丢弃本地缓存（播放器 onError 时怀疑文件损坏：删掉，下次重新下载） */
export function dropLocalAudio(fileID: string) {
  if (!fileID || !fileID.startsWith('cloud://')) return
  localMap.delete(fileID)
  const dir = audioDir()
  if (!dir) return
  try {
    const meta = readMeta()
    if (meta[fileID]) {
      delete meta[fileID]
      writeMeta(meta)
    }
    ;(wxFs() as any).getFileSystemManager().unlink({ filePath: audioLocalPath(fileID), fail: () => {} })
  } catch {
    // ignore
  }
}
