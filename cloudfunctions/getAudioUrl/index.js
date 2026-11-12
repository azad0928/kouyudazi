const cloud = require('wx-server-sdk');
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});
const db = cloud.database(),
  _ = db.command;
exports.main = async event => {
  const {
    OPENID: openid
  } = cloud.getWXContext();
  if (!openid) throw new Error('UNAUTHORIZED');
  const ids = [...new Set(Array.isArray(event.fileIDs) ? event.fileIDs : [event.fileID])].filter(x => typeof x === 'string' && x.startsWith('cloud://')).slice(0, 50);
  if (!ids.length) return {
    urls: {}
  };
  const admin = ['oesNc5ZsgoNCmhunS0vYdWO3tmcY', ...(process.env.ADMIN_OPENIDS || '').split(',').map(s => s.trim())].includes(openid);
  const visibility = admin ? {} : _.or([{
    _openid: openid
  }, {
    officialStatus: 'approved',
    status: 'done'
  }]);
  const matching = _.or([{
    'lesson.audioUrl': _.in(ids)
  }, {
    'lesson.cover': _.in(ids)
  }, {
    coverFileID: _.in(ids)
  }]);
  const records = await db.collection('imports').where(_.and([visibility, matching])).limit(100).get();
  const allowed = new Set();
  for (const r of records.data) for (const f of [r.lesson && r.lesson.audioUrl, r.lesson && r.lesson.cover, r.coverFileID]) if (ids.includes(f)) allowed.add(f);
  const own = await db.collection('users').where({
    _openid: openid,
    avatarFileID: _.in(ids)
  }).limit(1).get();
  for (const r of own.data) allowed.add(r.avatarFileID);
  if (!Array.isArray(event.fileIDs) && !allowed.has(event.fileID)) throw new Error('FORBIDDEN_FILE');
  if (!allowed.size) return {
    urls: {}
  };
  const res = await cloud.getTempFileURL({
    fileList: [...allowed].map(fileID => ({
      fileID,
      maxAge: 2 * 3600 * 1000
    }))
  });
  const urls = {};
  for (const f of res.fileList || []) if (f.status === 0 && f.tempFileURL) urls[f.fileID] = f.tempFileURL;
  return Array.isArray(event.fileIDs) ? {
    urls
  } : {
    tempFileURL: urls[event.fileID] || ''
  };
};
