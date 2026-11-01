// 云函数：替小程序端向云存储取音频临时地址
// 原因：免费版存储权限固定为“仅创建者可读写”且控制台不允许改，控制台上传的文件
// 小程序端直接调 getTempFileURL 会被拒（STORAGE_EXCEED_AUTHORITY）。
// 云函数以管理员身份运行，不受该权限限制，取到的临时地址返回给前端播放（几小时内有效）。
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

// 期望的临时地址有效期（毫秒）。实测（2026-10-31）：不传 maxAge 时服务端给的链接
// 约 15 分钟内就会 403，前端已改为按链接自身签发时刻判新鲜度并重取；
// 这里再显式传一个较大值，若服务端采纳则能进一步减少重取次数。
// 注意：不保证一定生效（曾实测某些 maxAge 取值被忽略），因此前端的过期重取不可省。
const MAX_AGE = 2 * 60 * 60 * 1000

exports.main = async (event) => {
  // 批量换地址：event.fileIDs = [fileID, ...]（最多 50 个/次）→ { urls: { fileID: tempFileURL } }
  // 免费版存储“仅创建者可读写”，控制台上传的文件小程序端直读会被拒；
  // 封面 <image> 不能直接写 cloud://，必须经这里换成临时地址再显示（音频同理）。
  if (event && Array.isArray(event.fileIDs)) {
    const ids = [...new Set(event.fileIDs)].filter(Boolean).slice(0, 50)
    if (ids.length === 0) return { urls: {} }
    const res = await cloud.getTempFileURL({
      fileList: ids.map((fileID) => ({ fileID, maxAge: MAX_AGE })),
    })
    const urls = {}
    for (const f of (res && res.fileList) || []) {
      if (f && f.status === 0 && f.tempFileURL) urls[f.fileID] = f.tempFileURL
    }
    return { urls }
  }
  const fileID = event && event.fileID
  if (!fileID) {
    throw new Error('missing fileID')
  }
  const res = await cloud.getTempFileURL({
    fileList: [{ fileID, maxAge: MAX_AGE }],
  })
  const info = res && res.fileList && res.fileList[0]
  if (!info || info.status !== 0 || !info.tempFileURL) {
    throw new Error((info && info.errMsg) || 'getTempFileURL failed')
  }
  return { tempFileURL: info.tempFileURL }
}
