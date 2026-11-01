// 打卡云函数：checkinApi
// 集合 checkins，一人一天一条：{_openid, date: 'YYYY-MM-DD', createdAt}
// getStatus：累计天数 + 今天是否已打（集合不存在时返回 0/false，不报错）
// checkin：今天已打过返回 already，不重复计天；否则新增一条并返回新累计
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const POINTS_PER_CHECKIN = 10 // 每次打卡得的积分

/** 积分流水：静默写，失败不影响主流程（pointLogs 集合未建时跳过） */
async function addPointLog(openid, change, reason) {
  try {
    await db.collection('pointLogs').add({
      data: { _openid: openid, change, reason, createdAt: Date.now() },
    })
  } catch (e) {
    // 集合不存在等情况跳过
  }
}

function isMissingCollection(e) {
  const msg = (e && (e.message || e.errMsg || '')) + ''
  return msg.includes('-502005') || msg.includes('collection not exists')
}

async function getStatus(openid, date) {
  try {
    const totalRes = await db.collection('checkins').where({ _openid: openid }).count()
    const todayRes = await db
      .collection('checkins')
      .where({ _openid: openid, date })
      .limit(1)
      .get()
    return { totalDays: totalRes.total || 0, todayChecked: (todayRes.data || []).length > 0 }
  } catch (e) {
    if (isMissingCollection(e)) return { totalDays: 0, todayChecked: false }
    throw e
  }
}

async function checkin(openid, date) {
  // 先查今天是否已打（集合不存在时当作未打，后续 add 会报 -502005，客户端提示去控制台建集合）
  let already = false
  try {
    const res = await db
      .collection('checkins')
      .where({ _openid: openid, date })
      .limit(1)
      .get()
    already = (res.data || []).length > 0
  } catch (e) {
    if (!isMissingCollection(e)) throw e
  }
  if (already) {
    const s = await getStatus(openid, date)
    return { already: true, totalDays: s.totalDays }
  }
  await db.collection('checkins').add({ data: { _openid: openid, date, createdAt: Date.now() } })
  // 打卡成功发积分：只给已有 users 文档的用户（没设置过昵称头像的不建幽灵文档）；
  // users 集合不存在时静默跳过，不影响打卡本身
  try {
    const u = await db.collection('users').where({ _openid: openid }).limit(1).get()
    const doc = (u.data && u.data[0]) || null
    if (doc) {
      await db.collection('users').doc(doc._id).update({
        data: { points: _.inc(POINTS_PER_CHECKIN), updatedAt: Date.now() },
      })
      await addPointLog(openid, POINTS_PER_CHECKIN, '每日打卡')
    }
  } catch (e) {
    // 集合不存在等情况跳过
  }
  const s = await getStatus(openid, date)
  return { already: false, totalDays: s.totalDays, pointsAdded: POINTS_PER_CHECKIN }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const action = event.action
  const date = String(event.date || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('INVALID_DATE')
  if (action === 'getStatus') return getStatus(OPENID, date)
  if (action === 'checkin') return checkin(OPENID, date)
  throw new Error('UNKNOWN_ACTION')
}
