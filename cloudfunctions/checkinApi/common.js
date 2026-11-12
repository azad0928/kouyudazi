// Shared source: scripts/cloud-common.cjs. Synced into each independently deployed function.
const crypto = require('crypto')
const key = (...parts) => crypto.createHash('sha256').update(parts.join(':')).digest('hex').slice(0, 28)
async function read(ref) {
  try { const r = await ref.get(); return r.data || null }
  catch (e) { if (/DOCUMENT_NOT_EXIST|document.*not.*exist/i.test(e.message || '') || e.errCode === -502003) return null; throw e }
}
async function legacyId(db, collection, openid) {
  const r = await db.collection(collection).where({ _openid: openid }).limit(1).get()
  return r.data && r.data[0] ? r.data[0]._id : key(collection, openid)
}
async function transaction(db, fn) {
  const r = await db.runTransaction(fn)
  return r && Object.prototype.hasOwnProperty.call(r, 'result') ? r.result : r
}
function pageQuery(db, col, conditions, cursor, limit = 30) {
  let where = conditions
  if (cursor) {
    let c
    try { c = JSON.parse(Buffer.from(String(cursor), 'base64').toString()) } catch { throw new Error('INVALID_CURSOR') }
    if (!Number.isFinite(c.t) || typeof c.id !== 'string') throw new Error('INVALID_CURSOR')
    where = db.command.and([conditions, db.command.or([{ createdAt: db.command.lt(c.t) }, { createdAt: c.t, _id: db.command.lt(c.id) }])])
  }
  return db.collection(col).where(where).orderBy('createdAt', 'desc').orderBy('_id', 'desc').limit(limit + 1)
}
function pageResult(rows, limit = 30) {
  const more = rows.length > limit, list = rows.slice(0, limit), last = list[list.length - 1]
  return { list, nextCursor: more && last ? Buffer.from(JSON.stringify({ t: last.createdAt, id: last._id })).toString('base64') : '', hasMore: more }
}
module.exports = { key, read, legacyId, transaction, pageQuery, pageResult }
