// MP3 时长解析：逐帧读 MPEG 头求总时长（腾讯 TTS 返回标准 MP3，无需 ffmpeg）
// MPEG1 Layer III 每帧 1152 采样；MPEG2/2.5 Layer III 每帧 576 采样

const BITRATE_MPEG1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
const BITRATE_MPEG2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
const SAMPLERATE = {
  3: [44100, 48000, 32000], // MPEG1
  2: [22050, 24000, 16000], // MPEG2
  0: [11025, 12000, 8000], // MPEG2.5
}

/** 返回秒数；解析失败返回 null（调用方再用码率估算兜底） */
function mp3Duration(buf) {
  if (!buf || buf.length < 4) return null
  let offset = 0
  // 跳过 ID3v2 标签（10 字节头 + synchsafe 长度）
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
    const size = (buf[6] & 0x7f) * 0x200000 + (buf[7] & 0x7f) * 0x4000 +
      (buf[8] & 0x7f) * 0x80 + (buf[9] & 0x7f)
    offset = 10 + size
  }
  let frames = 0
  let sampleRate = 0
  let samplesPerFrame = 0
  while (offset + 4 <= buf.length) {
    // 找帧同步 0xFFE
    if (buf[offset] !== 0xff || (buf[offset + 1] & 0xe0) !== 0xe0) {
      offset += 1
      continue
    }
    const versionBits = (buf[offset + 1] >> 3) & 0x03
    const layerBits = (buf[offset + 1] >> 1) & 0x03
    if (versionBits === 1 || layerBits !== 1) {
      // 非 MPEG Layer III：跳过本字节继续找（Xing 帧等仍是 Layer III，不会走到这里）
      offset += 1
      continue
    }
    const bitrateIdx = (buf[offset + 2] >> 4) & 0x0f
    const sampleIdx = (buf[offset + 2] >> 2) & 0x03
    const padding = (buf[offset + 2] >> 1) & 0x01
    if (bitrateIdx === 0 || bitrateIdx === 15 || sampleIdx === 3) {
      offset += 1
      continue
    }
    const table = versionBits === 3 ? BITRATE_MPEG1_L3 : BITRATE_MPEG2_L3
    const bitrate = table[bitrateIdx] * 1000
    sampleRate = SAMPLERATE[versionBits][sampleIdx]
    samplesPerFrame = versionBits === 3 ? 1152 : 576
    const frameLen = Math.floor((samplesPerFrame / 8) * bitrate / sampleRate) + padding
    if (frameLen <= 0) break
    frames += 1
    offset += frameLen
  }
  if (frames === 0 || !sampleRate) return null
  return (frames * samplesPerFrame) / sampleRate
}

/** 首个有效帧的采样率（Hz）；解析失败返回 0
 *  用途：finalize 拼接前检查各句采样率是否一致——不同服务商输出格式不同
 *  （elevenlabs 44.1kHz / azure 16kHz），混拼出来的文件播放器会解不动 */
function mp3SampleRate(buf) {
  if (!buf || buf.length < 4) return 0
  let offset = 0
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
    const size = (buf[6] & 0x7f) * 0x200000 + (buf[7] & 0x7f) * 0x4000 +
      (buf[8] & 0x7f) * 0x80 + (buf[9] & 0x7f)
    offset = 10 + size
  }
  while (offset + 4 <= buf.length) {
    if (buf[offset] !== 0xff || (buf[offset + 1] & 0xe0) !== 0xe0) {
      offset += 1
      continue
    }
    const versionBits = (buf[offset + 1] >> 3) & 0x03
    const layerBits = (buf[offset + 1] >> 1) & 0x03
    if (versionBits === 1 || layerBits !== 1) {
      offset += 1
      continue
    }
    const sampleIdx = (buf[offset + 2] >> 2) & 0x03
    if (sampleIdx === 3) {
      offset += 1
      continue
    }
    return SAMPLERATE[versionBits][sampleIdx]
  }
  return 0
}

module.exports = { mp3Duration, mp3SampleRate }
