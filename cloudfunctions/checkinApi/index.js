const cloud = require('wx-server-sdk');
const {
  key,
  read,
  legacyId,
  transaction
} = require('./common');
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});
const db = cloud.database();
const TIME_ZONE = process.env.CHECKIN_TIME_ZONE || 'Asia/Shanghai';
function businessDate() {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  return ['year', 'month', 'day'].map(k => p.find(x => x.type === k).value).join('-');
}
exports.main = async event => {
  const {
    OPENID: openid
  } = cloud.getWXContext();
  if (!openid) throw new Error('UNAUTHORIZED');
  const date = businessDate();
  if (!['getStatus', 'checkin'].includes(event.action)) throw new Error('UNKNOWN_ACTION');
  let result = {
    already: true,
    pointsAdded: 0
  };
  if (event.action === 'checkin') {
    const legacy = await db.collection('checkins').where({
      _openid: openid,
      date
    }).limit(1).get();
    const legacyToday = legacy.data.length > 0;
    const uid = await legacyId(db, 'users', openid);
    result = await transaction(db, async tx => {
      const ref = tx.collection('checkins').doc(key(openid, date));
      const existing = await read(ref);
      if (existing) return {
        already: true,
        pointsAdded: 0
      };
      // Older releases used random IDs. Preserve those check-ins too (queried before transaction below).
      if (legacyToday) return {
        already: true,
        pointsAdded: 0
      };
      const userRef = tx.collection('users').doc(uid),
        user = await read(userRef);
      await ref.set({
        data: {
          _openid: openid,
          date,
          createdAt: Date.now()
        }
      });
      if (user) await userRef.update({
        data: {
          points: db.command.inc(10)
        }
      });else await userRef.set({
        data: {
          _openid: openid,
          nickName: '英语学习者',
          points: 10,
          createdAt: Date.now()
        }
      });
      await tx.collection('pointLogs').doc(key('checkin', openid, date)).set({
        data: {
          _openid: openid,
          change: 10,
          reason: '每日打卡',
          createdAt: Date.now()
        }
      });
      return {
        already: false,
        pointsAdded: 10
      };
    });
  }
  const total = await db.collection('checkins').where({
    _openid: openid
  }).count();
  const today = await db.collection('checkins').where({
    _openid: openid,
    date
  }).limit(1).get();
  return {
    ...result,
    totalDays: total.total || 0,
    todayChecked: today.data.length > 0,
    date,
    timeZone: TIME_ZONE
  };
};
