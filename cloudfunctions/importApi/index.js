// 云函数：导入模块的数据接口（M1：额度 + 导入记录；M2：取课 + 失败重试）
// 所有读写走云函数（管理员身份），按 openid 隔离：用户只能看到自己的导入与额度，
// 因此不需要改数据库安全规则；集合由服务端首次写入时自动创建。
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

const FREE_TOTAL = 1
const POINTS_REDEEM_COST = 100 // 多少积分兑 1 次导入额度
const MONTHLY_LIMIT = 30
const MONTHLY_WINDOW_MS = 30 * 24 * 3600 * 1000

const _ = db.command
const OFFICIAL_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']
const OFFICIAL_REWARD_POINTS = 200 // 审核通过奖励给上传者的积分

/** 管理员 openid 白名单：环境变量 ADMIN_OPENIDS，逗号分隔 */
// 管理员 openid：写死（用户要求）+ 环境变量 ADMIN_OPENIDS（逗号分隔）合并
const HARDCODED_ADMIN_OPENIDS = ['oesNc5ZsgoNCmhunS0vYdWO3tmcY']
function adminOpenids() {
  const fromEnv = (process.env.ADMIN_OPENIDS || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
  return [...new Set([...HARDCODED_ADMIN_OPENIDS, ...fromEnv])]
}
function isAdmin(openid) {
  return !!openid && adminOpenids().includes(openid)
}

/** 积分流水：静默写，失败不影响主流程 */
async function addPointLog(openid, change, reason) {
  try {
    await db.collection('pointLogs').add({
      data: { _openid: openid, change, reason, createdAt: Date.now() },
    })
  } catch (e) {
    // 集合不存在等情况跳过
  }
}

/** 站内消息：静默写，失败不影响主流程（messages 集合未建时跳过） */
async function addMessage(openid, type, title, content, relatedId) {
  if (!openid) return
  try {
    await db.collection('messages').add({
      data: { _openid: openid, type, title, content, relatedId: relatedId || '', read: false, createdAt: Date.now() },
    })
  } catch (e) {
    // 集合不存在等情况跳过
  }
}

/** 官方上架奖励：给上传者 +200 积分（幂等，rewardGranted 标记防重发） */
async function grantOfficialReward(record) {
  if (!record || record.rewardGranted || !record._openid) return
  try {
    const r = await db
      .collection('users')
      .where({ _openid: record._openid })
      .update({ data: { points: _.inc(OFFICIAL_REWARD_POINTS) } })
    if (r.stats && r.stats.updated > 0) {
      await db
        .collection('imports')
        .doc(record._id)
        .update({ data: { rewardGranted: true } })
      await addPointLog(record._openid, OFFICIAL_REWARD_POINTS, '投稿上架官方奖励')
    }
  } catch (e) {
    // users 集合不存在等：跳过，不阻塞上架
  }
}

/** 查用户昵称（上架时记 authorNick；集合不存在返回空） */
async function lookupNickName(openid) {
  try {
    const u = await db.collection('users').where({ _openid: openid }).limit(1).get()
    return (u.data && u.data[0] && u.data[0].nickName) || ''
  } catch (e) {
    return ''
  }
}

/** 集合不存在（-502005）时读会直接抛错；新环境第一次调用时集合还没建，视为“空”而不是失败 */
function isMissingCollection(e) {
  return !!e && (e.code === -502005 || /COLLECTION_NOT_EXIST|collection not exists/i.test(e.message || ''))
}

/** 取当前用户的额度文档（没有则返回 null，不建文档；集合不存在也返回 null） */
async function getQuotaDoc(openid) {
  try {
    const res = await db
      .collection('quotas')
      .where({ _openid: openid })
      .limit(1)
      .get()
    return (res.data && res.data[0]) || null
  } catch (e) {
    if (isMissingCollection(e)) return null
    throw e
  }
}

/** 会员是否有效（终身一直有效；包月看过期时间；M3 再接包月 30 次计数） */
function membershipActive(membership) {
  if (!membership) return false
  if (membership.type === 'lifetime') return true
  if (membership.type === 'monthly') {
    return membership.expiresAt && membership.expiresAt > Date.now()
  }
  return false
}

/** 用户积分余额（users 集合；没有文档/集合时视为 0） */
async function getUserPoints(openid) {
  try {
    const u = await db.collection('users').where({ _openid: openid }).limit(1).get()
    return (u.data && u.data[0] && u.data[0].points) || 0
  } catch (e) {
    if (isMissingCollection(e)) return 0
    throw e
  }
}

/** 额度状态（给前端展示与校验共用；monthlyRemaining 只读计算，不改库） */
async function getQuota(openid) {
  const doc = await getQuotaDoc(openid)
  const membership = (doc && doc.membership) || null
  let monthlyRemaining = null
  if (membership && membership.type === 'monthly' && membershipActive(membership)) {
    const start = membership.monthlyStart || 0
    if (!start || Date.now() > start + MONTHLY_WINDOW_MS) {
      monthlyRemaining = MONTHLY_LIMIT // 窗口已过，下次使用时滚动重置，视为满额
    } else {
      monthlyRemaining = Math.max(0, MONTHLY_LIMIT - (membership.monthlyUsed || 0))
    }
  }
  return {
    freeTotal: FREE_TOTAL,
    freeUsed: (doc && doc.freeUsed) || 0,
    singleRemaining: (doc && doc.singleRemaining) || 0,
    pointsRemaining: (doc && doc.pointsRemaining) || 0,
    points: await getUserPoints(openid),
    membership,
    monthlyRemaining,
  }
}

/** 按顺序挑额度并预扣：会员（终身不扣次；包月 30 天窗口内 30 次，窗口滚动重置）→ 免费 → 积分 → 单次；都不够时抛 QUOTA_EXHAUSTED */
async function pickAndDeduct(openid) {
  const quota = await getQuota(openid)
  let quotaType = ''
  if (membershipActive(quota.membership)) {
    if (quota.membership.type === 'lifetime') {
      return 'lifetime'
    }
    // 包月：窗口内未用满则扣一次；用满则落到免费/单次（不断言会员就一定能用）
    const doc = await getQuotaDoc(openid)
    if (doc && doc.membership) {
      const now = Date.now()
      let monthlyStart = doc.membership.monthlyStart || 0
      let monthlyUsed = doc.membership.monthlyUsed || 0
      if (!monthlyStart || now > monthlyStart + MONTHLY_WINDOW_MS) {
        monthlyStart = now
        monthlyUsed = 0
      }
      if (monthlyUsed < MONTHLY_LIMIT) {
        await db.collection('quotas').doc(doc._id).update({
          data: {
            membership: {
              type: 'monthly',
              expiresAt: doc.membership.expiresAt,
              monthlyStart,
              monthlyUsed: monthlyUsed + 1,
            },
          },
        })
        return 'monthly'
      }
    }
  }
  if (quota.freeUsed < quota.freeTotal) {
    quotaType = 'free'
  } else if (quota.pointsRemaining > 0) {
    quotaType = 'points'
  } else if (quota.singleRemaining > 0) {
    quotaType = 'single'
  } else {
    throw new Error('QUOTA_EXHAUSTED')
  }
  if (quotaType === 'free' || quotaType === 'single' || quotaType === 'points') {
    const doc = await getQuotaDoc(openid)
    if (doc) {
      const patch = quotaType === 'free'
        ? { freeUsed: quota.freeUsed + 1 }
        : quotaType === 'points'
          ? { pointsRemaining: quota.pointsRemaining - 1 }
          : { singleRemaining: quota.singleRemaining - 1 }
      await db.collection('quotas').doc(doc._id).update({ data: patch })
    } else if (quotaType === 'free') {
      await db.collection('quotas').add({
        data: { _openid: openid, freeUsed: 1, singleRemaining: 0, pointsRemaining: 0, membership: null },
      })
    }
  }
  return quotaType
}

exports.main = async (event) => {
  const { OPENID: openid } = cloud.getWXContext()
  if (!openid) {
    throw new Error('missing openid')
  }
  const action = event && event.action

  // 额度查询
  if (action === 'getQuota') {
    return { quota: await getQuota(openid) }
  }

  // 积分兑换导入额度：POINTS_REDEEM_COST 积分 = 1 次，充入 pointsRemaining
  if (action === 'redeemPoints') {
    let userDoc = null
    try {
      const u = await db.collection('users').where({ _openid: openid }).limit(1).get()
      userDoc = (u.data && u.data[0]) || null
    } catch (e) {
      if (isMissingCollection(e)) throw new Error('POINTS_NOT_ENOUGH')
      throw e
    }
    const pts = (userDoc && userDoc.points) || 0
    if (!userDoc || pts < POINTS_REDEEM_COST) throw new Error('POINTS_NOT_ENOUGH')
    await db.collection('users').doc(userDoc._id).update({
      data: { points: pts - POINTS_REDEEM_COST, updatedAt: Date.now() },
    })
    await addPointLog(openid, -POINTS_REDEEM_COST, '积分兑换导入额度')
    const qdoc = await getQuotaDoc(openid)
    if (qdoc) {
      await db.collection('quotas').doc(qdoc._id).update({
        data: { pointsRemaining: (qdoc.pointsRemaining || 0) + 1 },
      })
    } else {
      await db.collection('quotas').add({
        data: { _openid: openid, freeUsed: 0, singleRemaining: 0, pointsRemaining: 1, membership: null },
      })
    }
    return { ok: true, quota: await getQuota(openid) }
  }

  // 我的导入列表（按创建时间倒序；集合不存在时返回空列表）
  if (action === 'list') {
    try {
      const res = await db
        .collection('imports')
        .where({ _openid: openid })
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get()
      return { records: res.data || [] }
    } catch (e) {
      if (isMissingCollection(e)) return { records: [] }
      throw e
    }
  }

  // 创建导入记录并预扣额度
  if (action === 'create') {
    const { fileID, fileName, title } = event
    if (!fileID || !fileName) {
      throw new Error('missing file')
    }
    const quotaType = await pickAndDeduct(openid)
    const added = await db.collection('imports').add({
      data: {
        _openid: openid,
        title: title || fileName.replace(/\.[^.]+$/, ''),
        fileName,
        fileID,
        status: 'processing',
        quotaType,
        lessonId: '',
        createdAt: Date.now(),
      },
    })
    return { id: added._id, quota: await getQuota(openid) }
  }

  // 取一条已完成导入的课程数据（详情页用；集合不存在时返回空）
  // 可见范围：本人 / 管理员 / 已上架为官方（公开）
  if (action === 'getLesson') {
    const lessonId = event.lessonId
    if (!lessonId) {
      return { lesson: null }
    }
    try {
      const conds = [
        { _openid: openid, lessonId, status: 'done' },
        { lessonId, status: 'done', officialStatus: 'approved' },
      ]
      if (isAdmin(openid)) conds.push({ lessonId, status: 'done' })
      const res = await db.collection('imports').where(_.or(conds)).limit(1).get()
      const rec = res.data && res.data[0]
      return { lesson: (rec && rec.lesson) || null }
    } catch (e) {
      if (isMissingCollection(e)) return { lesson: null }
      throw e
    }
  }

  // 重试失败的导入：重新校验并预扣额度，从断点续跑（prepare 已完成的不重做）
  if (action === 'retry') {
    const importId = event.importId
    if (!importId) {
      throw new Error('missing importId')
    }
    let snap
    try {
      snap = await db.collection('imports').doc(importId).get()
    } catch (e) {
      if (isMissingCollection(e)) {
        throw new Error('import not found')
      }
      throw e
    }
    const rec = snap.data
    if (!rec || rec._openid !== openid) {
      throw new Error('forbidden')
    }
    if (rec.status !== 'failed') {
      throw new Error('NOT_FAILED')
    }
    const quotaType = await pickAndDeduct(openid)
    await db.collection('imports').doc(importId).update({
      data: {
        status: 'processing',
        errorCode: '',
        quotaType,
        progressPct: rec.sentences ? rec.progressPct || 5 : 0,
      },
    })
    return { ok: true, quota: await getQuota(openid) }
  }

  // 删除一条导入：仅本人可删；先删记录、再删文件；
  // 只同步删源文件与成品音频（2 个），不删句级临时音频——已完成记录有 30 多个句音频，
  // 一起删会超过 importApi 默认 3 秒超时导致整个删除失败（这就是“已完成的删不掉”的原因；
  // 失败记录只有 1 个源文件所以删得掉）。句级临时文件留在 imports/tmp/ 下，不影响使用；
  // 额度不动（失败的本来已返还，成功的扣次不因删除而退回）。
  if (action === 'delete') {
    const importId = event.importId
    if (!importId) {
      throw new Error('missing importId')
    }
    let snap
    try {
      snap = await db.collection('imports').doc(importId).get()
    } catch (e) {
      if (isMissingCollection(e)) {
        throw new Error('import not found')
      }
      throw e
    }
    const rec = snap.data
    if (!rec || rec._openid !== openid) {
      throw new Error('forbidden')
    }
    await db.collection('imports').doc(importId).remove()
    const fileList = [rec.fileID, rec.finalFileID].filter(Boolean)
    if (fileList.length > 0) {
      try {
        await cloud.deleteFile({ fileList })
      } catch {
        // 文件已删/不存在等，不影响记录已删的结果
      }
    }
    return { ok: true }
  }

  // 用户申请把自己的导入上架为官方课程（仅本人、已完成的导入）
  if (action === 'applyOfficial') {
    const importId = event.importId
    const level = event.level
    if (!importId || !OFFICIAL_LEVELS.includes(level)) {
      throw new Error('INVALID_ARGS')
    }
    let snap
    try {
      snap = await db.collection('imports').doc(importId).get()
    } catch (e) {
      if (isMissingCollection(e)) throw new Error('import not found')
      throw e
    }
    const rec = snap.data
    if (!rec || rec._openid !== openid) throw new Error('forbidden')
    if (rec.status !== 'done') throw new Error('NOT_DONE')
    const authorNick = rec.authorNick || (await lookupNickName(openid))
    await db
      .collection('imports')
      .doc(importId)
      .update({
        data: {
          applyOfficial: true,
          officialStatus: 'pending',
          officialLevel: level,
          appliedAt: Date.now(),
          authorNick,
        },
      })
    // 通知管理员有新申请 + 给申请人确认回执（消息中心可见）
    const applyTitle = rec.title || '未命名文章'
    for (const adminId of adminOpenids()) {
      await addMessage(
        adminId,
        'official_applied',
        '有新的上架申请',
        `《${applyTitle}》（${authorNick || '用户'}，自评 ${level}）待审核`,
        importId,
      )
    }
    await addMessage(openid, 'official_submitted', '上架申请已提交', `《${applyTitle}》正在等待审核`, importId)
    return { ok: true }
  }

  // 是否管理员（管理页入口鉴权用）
  if (action === 'adminCheck') {
    return { isAdmin: isAdmin(openid), openid }
  }

  // 管理员：拉上架申请列表
  if (action === 'adminList') {
    if (!isAdmin(openid)) throw new Error('NOT_ADMIN')
    const status = event.status || 'pending'
    try {
      const res = await db
        .collection('imports')
        .where({ applyOfficial: true, officialStatus: status })
        .orderBy('appliedAt', 'desc')
        .limit(50)
        .get()
      return {
        records: res.data.map((r) => ({
          _id: r._id,
          title: r.title,
          authorNick: r.authorNick || '',
          officialLevel: r.officialLevel || '',
          appliedAt: r.appliedAt || 0,
          createdAt: r.createdAt || 0,
          lessonId: r.lessonId || '',
        })),
      }
    } catch (e) {
      if (isMissingCollection(e)) return { records: [] }
      throw e
    }
  }

  // 管理员：审核（通过则定级并立即发 200 积分奖励；拒绝/下架）
  if (action === 'adminReview') {
    if (!isAdmin(openid)) throw new Error('NOT_ADMIN')
    const importId = event.importId
    const decision = event.decision
    if (!importId || !['approved', 'rejected'].includes(decision)) {
      throw new Error('INVALID_ARGS')
    }
    let snap
    try {
      snap = await db.collection('imports').doc(importId).get()
    } catch (e) {
      if (isMissingCollection(e)) throw new Error('import not found')
      throw e
    }
    const rec = snap.data
    if (!rec) throw new Error('import not found')
    const finalLevel = OFFICIAL_LEVELS.includes(event.level) ? event.level : rec.officialLevel || ''
    await db
      .collection('imports')
      .doc(importId)
      .update({
        data: { officialStatus: decision, officialLevel: finalLevel, reviewedAt: Date.now() },
      })
    if (decision === 'approved') {
      await grantOfficialReward({ ...rec, _id: importId })
    }
    // 通知申请人（消息中心可见）
    const msgTitle = rec.title || '你的投稿'
    if (decision === 'approved') {
      await addMessage(
        rec._openid,
        'official_approved',
        '投稿上架申请已通过',
        `《${msgTitle}》已上架为官方课程，200 积分奖励已到账`,
        importId,
      )
    } else {
      await addMessage(
        rec._openid,
        'official_rejected',
        '投稿上架申请未通过',
        `《${msgTitle}》未通过审核，可修改后重新申请`,
        importId,
      )
    }
    return { ok: true }
  }

  // 公开：已上架的官方课程（所有人可见；官方 tab 用）
  if (action === 'listOfficial') {
    try {
      const res = await db
        .collection('imports')
        .where({ status: 'done', officialStatus: 'approved' })
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get()
      // 兜底发奖励：控制台直接上架的，首次被列出时补发（幂等）
      for (const r of res.data) {
        await grantOfficialReward(r)
      }
      return {
        records: res.data.map((r) => ({
          lessonId: r.lessonId,
          title: r.title,
          level: r.officialLevel || '',
          authorNick: r.authorNick || '',
          createdAt: r.createdAt || 0,
          cover: (r.lesson && r.lesson.cover) || null,
          duration: (r.lesson && r.lesson.duration) || 0,
        })),
      }
    } catch (e) {
      if (isMissingCollection(e)) return { records: [] }
      throw e
    }
  }

  throw new Error('unknown action: ' + action)
}
