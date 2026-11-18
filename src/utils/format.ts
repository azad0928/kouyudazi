/** 把秒数格式化为 mm:ss */
export function formatTime(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds || 0))
  const minutes = Math.floor(safe / 60)
  const seconds = safe % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

/**
 * 业务时区：服务端打卡、积分、榜单、会员到期统一用 Asia/Shanghai（UTC+8，无夏令时）。
 * 不要用 new Date(ts).getDate() 这类设备本地时区方法：EST 设备会把北京时间的
 * 11-18 显示成 11-17，造成「同一天两条打卡 +10」的错觉。
 * 若服务端通过 LEARNING_TIME_ZONE / CHECKIN_TIME_ZONE 环境变量改了时区，这里需同步修改。
 */
export const BUSINESS_TIME_ZONE = 'Asia/Shanghai'
const BUSINESS_OFFSET_MS = 8 * 60 * 60 * 1000

function businessParts(ts: number) {
  const t = Number(ts)
  if (!Number.isFinite(t) || t <= 0) return null
  const d = new Date(t + BUSINESS_OFFSET_MS)
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes()
  }
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/** YYYY-MM-DD（业务时区） */
export function formatBusinessDate(ts: number): string {
  const p = businessParts(ts)
  return p ? `${p.year}-${pad2(p.month)}-${pad2(p.day)}` : ''
}

/** HH:mm（业务时区） */
export function formatBusinessTime(ts: number): string {
  const p = businessParts(ts)
  return p ? `${pad2(p.hour)}:${pad2(p.minute)}` : ''
}

/** YYYY-MM-DD HH:mm（业务时区） */
export function formatBusinessDateTime(ts: number): string {
  const p = businessParts(ts)
  return p ? `${p.year}-${pad2(p.month)}-${pad2(p.day)} ${pad2(p.hour)}:${pad2(p.minute)}` : ''
}

/** YYYY年M月D日（业务时区） */
export function formatBusinessDateCN(ts: number): string {
  const p = businessParts(ts)
  return p ? `${p.year}年${p.month}月${p.day}日` : ''
}

/** 该时间戳是否为业务时区的「今天」 */
export function isBusinessToday(ts: number): boolean {
  const date = formatBusinessDate(ts)
  return !!date && date === formatBusinessDate(Date.now())
}
