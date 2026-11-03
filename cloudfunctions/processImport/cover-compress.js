// 封面压缩：jpeg-js 纯 JS 解码 → 等比缩到宽 960 → q65 重编码；失败回退原图，不阻塞流程
// 背景：AI 直出的封面 150~400KB，列表加载慢；官方封面 v95 已验证 960×480 q65 体积减半且观感无损
let jpeg = null
try {
  jpeg = require('jpeg-js')
} catch (e) {
  console.error('[cover] jpeg-js not installed, skip compress (run npm install)')
}

const TARGET_W = 960
const QUALITY = 65

function bilinearDownscale(src, sw, sh, dw, dh) {
  const out = Buffer.alloc(dw * dh * 4)
  const xRatio = sw / dw
  const yRatio = sh / dh
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const gx = x * xRatio
      const gy = y * yRatio
      const x0 = Math.floor(gx)
      const y0 = Math.floor(gy)
      const x1 = Math.min(x0 + 1, sw - 1)
      const y1 = Math.min(y0 + 1, sh - 1)
      const fx = gx - x0
      const fy = gy - y0
      const i00 = (y0 * sw + x0) * 4
      const i10 = (y0 * sw + x1) * 4
      const i01 = (y1 * sw + x0) * 4
      const i11 = (y1 * sw + x1) * 4
      const o = (y * dw + x) * 4
      for (let c = 0; c < 4; c++) {
        const top = src[i00 + c] * (1 - fx) + src[i10 + c] * fx
        const bot = src[i01 + c] * (1 - fx) + src[i11 + c] * fx
        out[o + c] = Math.round(top * (1 - fy) + bot * fy)
      }
    }
  }
  return out
}

/**
 * 输入 JPEG Buffer，返回压缩后的 JPEG Buffer；任何失败返回原图
 * @param {Buffer} buf 原 JPEG
 * @param {object} opts 可选 { cropBottomRatio: 0~0.3 }：先裁掉底部比例的行
 *   （Pollinations 匿名图右下角有固定水印，裁 0.1 即可去除）
 */
async function compressCover(buf, opts) {
  if (!jpeg || !buf || buf.length < 100) return buf
  try {
    const decoded = jpeg.decode(buf, { maxMemoryUsageInMB: 512 })
    let sw = decoded.width
    let sh = decoded.height
    let data = Buffer.from(decoded.data)
    const cropRatio = Math.min(0.3, Math.max(0, Number(opts && opts.cropBottomRatio) || 0))
    if (cropRatio > 0 && sh > 100) {
      const keep = Math.floor(sh * (1 - cropRatio))
      data = data.subarray(0, keep * sw * 4)
      sh = keep
    }
    if (!sw || !sh) return buf
    const scale = Math.min(1, TARGET_W / sw)
    const dw = Math.max(1, Math.round(sw * scale))
    const dh = Math.max(1, Math.round(sh * scale))
    const rgba =
      dw === sw && dh === sh
        ? data
        : bilinearDownscale(data, sw, sh, dw, dh)
    const enc = jpeg.encode({ width: dw, height: dh, data: rgba }, QUALITY)
    console.log(
      `[cover] compressed ${sw}x${sh}(${Math.round(buf.length / 1024)}KB) -> ` +
        `${dw}x${dh}(${Math.round(enc.data.length / 1024)}KB)`,
    )
    return enc.data
  } catch (e) {
    console.error('[cover] compress failed, using original:', e && e.message)
    return buf
  }
}

module.exports = { compressCover }
