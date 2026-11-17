// 云函数：导入模块的数据接口（M1：额度 + 导入记录；M2：取课 + 失败重试）
// 所有读写走云函数（管理员身份），按 openid 隔离：用户只能看到自己的导入与额度，
// 因此不需要改数据库安全规则；集合由服务端首次写入时自动创建。
const cloud = require('wx-server-sdk');
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});
const db = cloud.database();
const FREE_TOTAL = 1;
const POINTS_REDEEM_COST = 100; // 多少积分兑 1 次导入额度
const MONTHLY_LIMIT = 30;
const MONTHLY_WINDOW_MS = 30 * 24 * 3600 * 1000;
const {
  key,
  read,
  legacyId,
  transaction,
  pageQuery,
  pageResult
} = require('./common');
const _ = db.command;
const OFFICIAL_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const OFFICIAL_REWARD_POINTS = 200; // 审核通过奖励给上传者的积分

/** 管理员 openid 白名单：环境变量 ADMIN_OPENIDS，逗号分隔 */
// 管理员 openid：写死（用户要求）+ 环境变量 ADMIN_OPENIDS（逗号分隔）合并
const HARDCODED_ADMIN_OPENIDS = ['oesNc5ZsgoNCmhunS0vYdWO3tmcY'];
function adminOpenids() {
  const fromEnv = (process.env.ADMIN_OPENIDS || '').split(',').map(x => x.trim()).filter(Boolean);
  return [...new Set([...HARDCODED_ADMIN_OPENIDS, ...fromEnv])];
}
function isAdmin(openid) {
  return !!openid && adminOpenids().includes(openid);
}

/** 积分流水：静默写，失败不影响主流程 */
async function addPointLog(openid, change, reason) {
  try {
    await db.collection('pointLogs').add({
      data: {
        _openid: openid,
        change,
        reason,
        createdAt: Date.now()
      }
    });
  } catch (e) {
    // 集合不存在等情况跳过
  }
}

/** 站内消息：静默写，失败不影响主流程（messages 集合未建时跳过） */
async function addMessage(openid, type, title, content, relatedId) {
  if (!openid) return;
  try {
    await db.collection('messages').add({
      data: {
        _openid: openid,
        type,
        title,
        content,
        relatedId: relatedId || '',
        read: false,
        createdAt: Date.now()
      }
    });
  } catch (e) {
    // 集合不存在等情况跳过
  }
}

/** 官方上架奖励：给上传者 +200 积分（幂等，rewardGranted 标记防重发） */
async function grantOfficialReward(record) {
  if (!record || !record._openid) return;
  const uid = await legacyId(db, 'users', record._openid);
  await transaction(db, async tx => {
    const ref = tx.collection('imports').doc(record._id),
      fresh = await read(ref);
    if (!fresh || fresh.officialStatus !== 'approved' || fresh.rewardGranted) return;
    const user = tx.collection('users').doc(uid),
      u = await read(user);
    if (u) await user.update({
      data: {
        points: _.inc(OFFICIAL_REWARD_POINTS)
      }
    });else await user.set({
      data: {
        _openid: record._openid,
        points: OFFICIAL_REWARD_POINTS,
        nickName: '英语学习者',
        createdAt: Date.now()
      }
    });
    await ref.update({
      data: {
        rewardGranted: true
      }
    });
    await tx.collection('pointLogs').doc(key('reward', record._id)).set({
      data: {
        _openid: record._openid,
        change: OFFICIAL_REWARD_POINTS,
        reason: '投稿共享奖励',
        createdAt: Date.now()
      }
    });
  });
}

/** 查用户昵称（上架时记 authorNick；集合不存在返回空） */
async function lookupNickName(openid) {
  try {
    const u = await db.collection('users').where({
      _openid: openid
    }).limit(1).get();
    return u.data && u.data[0] && u.data[0].nickName || '';
  } catch (e) {
    return '';
  }
}

/** 集合不存在（-502005）时读会直接抛错；新环境第一次调用时集合还没建，视为“空”而不是失败 */
function isMissingCollection(e) {
  return !!e && (e.code === -502005 || /COLLECTION_NOT_EXIST|collection not exists/i.test(e.message || ''));
}

/** 取当前用户的额度文档（没有则返回 null，不建文档；集合不存在也返回 null） */
async function getQuotaDoc(openid) {
  try {
    const res = await db.collection('quotas').where({
      _openid: openid
    }).limit(1).get();
    return res.data && res.data[0] || null;
  } catch (e) {
    if (isMissingCollection(e)) return null;
    throw e;
  }
}

/** 会员是否有效（终身一直有效；包月看过期时间；M3 再接包月 30 次计数） */
function membershipActive(membership) {
  if (!membership) return false;
  if (membership.type === 'lifetime') return true;
  if (membership.type === 'monthly') {
    return membership.expiresAt && membership.expiresAt > Date.now();
  }
  return false;
}

/** 用户积分余额（users 集合；没有文档/集合时视为 0） */
async function getUserPoints(openid) {
  try {
    const u = await db.collection('users').where({
      _openid: openid
    }).limit(1).get();
    return u.data && u.data[0] && u.data[0].points || 0;
  } catch (e) {
    if (isMissingCollection(e)) return 0;
    throw e;
  }
}

/** 额度状态（给前端展示与校验共用；monthlyRemaining 只读计算，不改库） */
async function getQuota(openid) {
  const doc = await getQuotaDoc(openid);
  const membership = doc && doc.membership || null;
  let monthlyRemaining = null;
  if (membership && membership.type === 'monthly' && membershipActive(membership)) {
    const start = membership.monthlyStart || 0;
    if (!start || Date.now() > start + MONTHLY_WINDOW_MS) {
      monthlyRemaining = MONTHLY_LIMIT; // 窗口已过，下次使用时滚动重置，视为满额
    } else {
      monthlyRemaining = Math.max(0, MONTHLY_LIMIT - (membership.monthlyUsed || 0));
    }
  }
  return {
    freeTotal: FREE_TOTAL,
    freeUsed: doc && doc.freeUsed || 0,
    singleRemaining: doc && doc.singleRemaining || 0,
    pointsRemaining: doc && doc.pointsRemaining || 0,
    points: await getUserPoints(openid),
    membership,
    monthlyRemaining
  };
}

/** 按顺序挑额度并预扣：会员（终身不扣次；包月 30 天窗口内 30 次，窗口滚动重置）→ 免费 → 积分 → 单次；都不够时抛 QUOTA_EXHAUSTED */
// Quota debit and import record are committed together. Each attempt records the original window.
async function debit(tx, qid, openid) {
  const ref = tx.collection('quotas').doc(qid);
  const q = (await read(ref)) || {
    _openid: openid,
    freeUsed: 0,
    singleRemaining: 0,
    pointsRemaining: 0,
    membership: null
  };
  const m = q.membership,
    now = Date.now();
  let type = '',
    window = 0;
  if (membershipActive(m) && m.type === 'lifetime') return {
    type: 'lifetime',
    qid,
    window: 0
  };
  if (membershipActive(m) && m.type === 'monthly') {
    if (!m.monthlyStart || now >= m.monthlyStart + MONTHLY_WINDOW_MS) {
      m.monthlyStart = now;
      m.monthlyUsed = 0;
    }
    if ((m.monthlyUsed || 0) < MONTHLY_LIMIT) {
      type = 'monthly';
      window = m.monthlyStart;
      m.monthlyUsed = (m.monthlyUsed || 0) + 1;
    }
  }
  if (!type && (q.freeUsed || 0) < FREE_TOTAL) {
    type = 'free';
    q.freeUsed = (q.freeUsed || 0) + 1;
  }
  if (!type && (q.pointsRemaining || 0) > 0) {
    type = 'points';
    q.pointsRemaining--;
  }
  if (!type && (q.singleRemaining || 0) > 0) {
    type = 'single';
    q.singleRemaining--;
  }
  if (!type) throw new Error('QUOTA_EXHAUSTED');
  const {
    _id,
    ...data
  } = q;
  await ref.set({
    data
  });
  return {
    type,
    qid,
    window,
    refunded: false
  };
}
exports.main = async event => {
  const {
    OPENID: openid
  } = cloud.getWXContext();
  if (!openid) {
    throw new Error('missing openid');
  }
  const action = event && event.action;

  // 额度查询
  if (action === 'getQuota') {
    return {
      quota: await getQuota(openid),
      uploadNamespace: key(openid)
    };
  }

  // 积分兑换导入额度：POINTS_REDEEM_COST 积分 = 1 次，充入 pointsRemaining
  if (action === 'redeemPoints') {
    const requestId = String(event.requestId || '');
    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(requestId)) throw new Error('INVALID_REQUEST_ID');
    const uid = await legacyId(db, 'users', openid),
      qid = await legacyId(db, 'quotas', openid);
    await transaction(db, async tx => {
      const log = tx.collection('pointLogs').doc(key('redeem', openid, requestId));
      if (await read(log)) return;
      const ur = tx.collection('users').doc(uid),
        u = await read(ur);
      if (!u || (u.points || 0) < POINTS_REDEEM_COST) throw new Error('POINTS_NOT_ENOUGH');
      const qr = tx.collection('quotas').doc(qid),
        q = (await read(qr)) || {
          _openid: openid,
          freeUsed: 0,
          singleRemaining: 0
        };
      await ur.update({
        data: {
          points: _.inc(-POINTS_REDEEM_COST)
        }
      });
      const {
        _id,
        ...data
      } = q;
      await qr.set({
        data: {
          ...data,
          pointsRemaining: (q.pointsRemaining || 0) + 1
        }
      });
      await log.set({
        data: {
          _openid: openid,
          change: -POINTS_REDEEM_COST,
          reason: '积分兑换导入额度',
          createdAt: Date.now()
        }
      });
    });
    return {
      ok: true,
      quota: await getQuota(openid)
    };
  }

  // 我的导入列表（按创建时间倒序；集合不存在时返回空列表）
  if (action === 'list') {
    const res = await pageQuery(db, 'imports', {
      _openid: openid,
      status: _.neq('deleted')
    }, event.cursor).get();
    const page = pageResult(res.data);
    return {
      records: page.list,
      nextCursor: page.nextCursor,
      hasMore: page.hasMore
    };
  }
  if (action === 'create') {
    const {
        fileID,
        fileName,
        title
      } = event,
      requestId = String(event.requestId || '');
    if (!fileID || !fileName || !/^[a-zA-Z0-9_-]{8,100}$/.test(requestId)) throw new Error('INVALID_ARGS');
    if (!/\.(txt|md|docx|pdf)$/i.test(fileName)) throw new Error('INVALID_FILE_TYPE');
    // Bind source uploads to the authenticated user's namespace.
    if (!String(fileID).includes('/imports/source/' + key(openid) + '/')) throw new Error('FORBIDDEN_FILE');
    const qid = await legacyId(db, 'quotas', openid),
      id = key('import', openid, requestId);
    await transaction(db, async tx => {
      const ref = tx.collection('imports').doc(id);
      if (await read(ref)) return;
      // Internal uploads by an admin (e.g. the daily course pipeline)
      // do not consume import quota. refunded:true so failRecord skips
      // the refund path (nothing was taken).
      const quotaDebit = isAdmin(openid) ? { type: 'admin', refunded: true } : await debit(tx, qid, openid);
      await ref.set({
        data: {
          _openid: openid,
          title: String(title || fileName.replace(/\.[^.]+$/, '')).slice(0, 200),
          fileName,
          fileID,
          status: 'processing',
          quotaType: quotaDebit.type,
          quotaDebit,
          attempt: 1,
          lessonId: '',
          createdAt: Date.now()
        }
      });
    });
    return {
      id,
      quota: await getQuota(openid)
    };
  }

  // 取一条已完成导入的课程数据（详情页用；集合不存在时返回空）
  // 可见范围：本人 / 管理员 / 已上架为官方（公开）
  if (action === 'getLesson') {
    const lessonId = event.lessonId;
    if (!lessonId) {
      return {
        lesson: null
      };
    }
    try {
      const conds = [{
        _openid: openid,
        lessonId,
        status: 'done'
      }, {
        lessonId,
        status: 'done',
        officialStatus: 'approved'
      }];
      if (isAdmin(openid)) conds.push({
        lessonId,
        status: 'done'
      });
      const res = await db.collection('imports').where(_.or(conds)).limit(1).get();
      const rec = res.data && res.data[0];
      const lesson = rec && rec.lesson ? {
        ...rec.lesson,
        level: rec.officialLevel || rec.lesson.level || undefined,
        topic: rec.topic || rec.lesson.topic || '',
        published: rec.officialStatus === 'approved'
      } : null;
      if (!lesson) return {
        lesson: null
      };
      // 顺手把音频临时地址一起换好返回：详情页拿到课就能直接播，
      // 不必再串一次 getAudioUrl 云函数往返（少一轮冷启动/网络等待）
      let audioTempUrl = '';
      try {
        const src = String(lesson.audioUrl || '');
        if (src.startsWith('cloud://')) {
          const u = await cloud.getTempFileURL({
            fileList: [{
              fileID: src,
              maxAge: 2 * 60 * 60 * 1000
            }]
          });
          const info = u && u.fileList && u.fileList[0];
          if (info && info.status === 0 && info.tempFileURL) audioTempUrl = info.tempFileURL;
        } else if (src) {
          audioTempUrl = src;
        }
      } catch (e) {
        // 换地址失败不阻塞：前端会退回自己调 getAudioUrl
        console.warn('getLesson: temp url failed', e && e.message);
      }
      return {
        lesson,
        audioTempUrl
      };
    } catch (e) {
      if (isMissingCollection(e)) return {
        lesson: null
      };
      throw e;
    }
  }

  // 重试失败的导入：重新校验并预扣额度，从断点续跑（prepare 已完成的不重做）
  if (action === 'retry') {
    const id = String(event.importId || ''),
      qid = await legacyId(db, 'quotas', openid);
    await transaction(db, async tx => {
      const ref = tx.collection('imports').doc(id),
        rec = await read(ref);
      if (!rec || rec._openid !== openid) throw new Error('forbidden');
      if (rec.status === 'processing') return;
      if (rec.status !== 'failed') throw new Error('NOT_FAILED');
      // Admin retry of an internal upload: same quota exemption as create.
      const quotaDebit = isAdmin(openid) ? { type: 'admin', refunded: true } : await debit(tx, qid, openid);
      await ref.update({
        data: {
          status: 'processing',
          errorCode: '',
          quotaType: quotaDebit.type,
          quotaDebit,
          attempt: (rec.attempt || 1) + 1,
          progressPct: rec.sentences ? rec.progressPct || 5 : 0
        }
      });
    });
    return {
      ok: true,
      quota: await getQuota(openid)
    };
  }

  // 删除一条导入：仅本人可删；先删记录、再删文件；
  // 只同步删源文件与成品音频（2 个），不删句级临时音频——已完成记录有 30 多个句音频，
  // 一起删会超过 importApi 默认 3 秒超时导致整个删除失败（这就是“已完成的删不掉”的原因；
  // 失败记录只有 1 个源文件所以删得掉）。句级临时文件留在 imports/tmp/ 下，不影响使用；
  // 额度不动（失败的本来已返还，成功的扣次不因删除而退回）。
  if (action === 'delete') {
    const importId = event.importId;
    if (!importId) {
      throw new Error('missing importId');
    }
    let snap;
    try {
      snap = await db.collection('imports').doc(importId).get();
    } catch (e) {
      if (isMissingCollection(e)) {
        throw new Error('import not found');
      }
      throw e;
    }
    const rec = snap.data;
    if (!rec || rec._openid !== openid) {
      throw new Error('forbidden');
    }
    await transaction(db, async tx => {
      const ref = tx.collection('imports').doc(importId),
        fresh = await read(ref);
      if (!fresh || fresh._openid !== openid) throw new Error('forbidden');
      if (['pending', 'approved'].includes(fresh.officialStatus)) throw new Error('SHARED_RECORD_LOCKED');
      if (fresh.status === 'processing') throw new Error('IMPORT_PROCESSING');
      await ref.update({
        data: {
          status: 'deleted',
          deletedAt: Date.now()
        }
      });
    });
    const fileList = [rec.fileID, rec.finalFileID].filter(Boolean);
    if (fileList.length > 0) {
      try {
        await cloud.deleteFile({
          fileList
        });
      } catch {
        // 文件已删/不存在等，不影响记录已删的结果
      }
    }
    return {
      ok: true
    };
  }

  // 用户申请把自己的导入上架为官方课程（仅本人、已完成的导入）
  if (action === 'applyOfficial') {
    const importId = event.importId;
    const level = event.level;
    if (!importId || !OFFICIAL_LEVELS.includes(level)) {
      throw new Error('INVALID_ARGS');
    }
    let snap;
    try {
      snap = await db.collection('imports').doc(importId).get();
    } catch (e) {
      if (isMissingCollection(e)) throw new Error('import not found');
      throw e;
    }
    const rec = snap.data;
    if (!rec || rec._openid !== openid) throw new Error('forbidden');
    if (rec.status !== 'done') throw new Error('NOT_DONE');
    if (['pending', 'approved'].includes(rec.officialStatus)) throw new Error('ALREADY_SHARED');
    const authorNick = rec.authorNick || (await lookupNickName(openid));
    await transaction(db, async tx => {
      const ref = tx.collection('imports').doc(importId),
        fresh = await read(ref);
      if (!fresh || fresh._openid !== openid || fresh.status !== 'done') throw new Error('NOT_DONE');
      if (['pending', 'approved'].includes(fresh.officialStatus)) throw new Error('ALREADY_SHARED');
      await ref.update({
        data: {
          applyOfficial: true,
          officialStatus: 'pending',
          officialLevel: level,
          appliedAt: Date.now(),
          authorNick
        }
      });
    });
    // 通知管理员有新申请 + 给申请人确认回执（消息中心可见）
    const applyTitle = rec.title || '未命名文章';
    for (const adminId of adminOpenids()) {
      await addMessage(adminId, 'official_applied', '有新的上架申请', `《${applyTitle}》（${authorNick || '用户'}，自评 ${level}）待审核`, importId);
    }
    await addMessage(openid, 'official_submitted', '上架申请已提交', `《${applyTitle}》正在等待审核`, importId);
    return {
      ok: true
    };
  }

  // 是否管理员（管理页入口鉴权用）
  if (action === 'adminCheck') {
    return {
      isAdmin: isAdmin(openid),
      openid
    };
  }

  // 管理员：拉上架申请列表
  if (action === 'adminList') {
    if (!isAdmin(openid)) throw new Error('NOT_ADMIN');
    const status = event.status || 'pending';
    try {
      const res = await db.collection('imports').where({
        applyOfficial: true,
        officialStatus: status
      }).orderBy('appliedAt', 'desc').limit(50).get();
      return {
        records: res.data.map(r => ({
          _id: r._id,
          title: r.title,
          authorNick: r.authorNick || '',
          officialLevel: r.officialLevel || '',
          appliedAt: r.appliedAt || 0,
          createdAt: r.createdAt || 0,
          lessonId: r.lessonId || ''
        }))
      };
    } catch (e) {
      if (isMissingCollection(e)) return {
        records: []
      };
      throw e;
    }
  }

  // 管理员：审核（通过则定级并立即发 200 积分奖励；拒绝/下架）
  if (action === 'adminReview') {
    if (!isAdmin(openid)) throw new Error('NOT_ADMIN');
    const importId = event.importId;
    const decision = event.decision;
    if (!importId || !['approved', 'rejected'].includes(decision)) {
      throw new Error('INVALID_ARGS');
    }
    let snap;
    try {
      snap = await db.collection('imports').doc(importId).get();
    } catch (e) {
      if (isMissingCollection(e)) throw new Error('import not found');
      throw e;
    }
    const rec = snap.data;
    if (!rec) throw new Error('import not found');
    const finalLevel = OFFICIAL_LEVELS.includes(event.level) ? event.level : rec.officialLevel || '';
    if (decision === 'approved' && !OFFICIAL_LEVELS.includes(finalLevel)) throw new Error('INVALID_LEVEL');
    await db.collection('imports').doc(importId).update({
      data: {
        officialStatus: decision,
        officialLevel: finalLevel,
        reviewedAt: Date.now()
      }
    });
    if (decision === 'approved') {
      await grantOfficialReward({
        ...rec,
        _id: importId
      });
    }
    // 通知申请人（消息中心可见）
    const msgTitle = rec.title || '你的投稿';
    if (decision === 'approved') {
      await addMessage(rec._openid, 'official_approved', '投稿上架申请已通过', `《${msgTitle}》已上架为官方课程，200 积分奖励已到账`, importId);
    } else {
      await addMessage(rec._openid, 'official_rejected', '投稿上架申请未通过', `《${msgTitle}》未通过审核，可修改后重新申请`, importId);
    }
    return {
      ok: true
    };
  }

  if(action==='adminMetadata'){
    if(!isAdmin(openid))throw new Error('NOT_ADMIN')
    if(!['health','history','news','psychology','science','stories'].includes(event.topic))throw new Error('INVALID_TOPIC')
    await transaction(db,async tx=>{const ref=tx.collection('imports').doc(String(event.importId||'')),rec=await read(ref);if(!rec||rec.status!=='done')throw new Error('NOT_DONE');await ref.update({data:{topic:event.topic}})})
    return {ok:true}
  }

  // 公开：已上架的官方课程（所有人可见；官方 tab 用）
  if (action === 'listOfficial') {
    const conditions = {
      status: 'done',
      officialStatus: 'approved'
    };
    const res = await pageQuery(db, 'imports', conditions, event.cursor).get(),
      page = pageResult(res.data);
    return {
      records: page.list.map(r => ({
        lessonId: r.lessonId,
        title: r.title,
        level: r.officialLevel || '',
        topic: r.topic || r.lesson?.topic || '',
        summary: r.summary || r.lesson?.summary || '',
        authorNick: r.authorNick || '',
        createdAt: r.createdAt,
        cover: r.lesson?.cover || '',
        duration: r.lesson?.duration || 0
      })),
      nextCursor: page.nextCursor,
      hasMore: page.hasMore
    };
  }
  throw new Error('unknown action: ' + action);
};
