// 用户资料（个人中心前置）：getProfile / saveProfile。
// 以微信 openid 隔离，每人只能读写自己的 users 文档；
// 自选头像的云文件临时链接由服务端换取（免费版客户端无权直取）。
const cloud = require('wx-server-sdk');
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});
const db = cloud.database();
const _ = db.command;
const {
  key,
  read,
  legacyId,
  transaction,
  pageQuery,
  pageResult
} = require('./common');
function isMissingCollection(e) {
  return e && (e.code === -502005 || /COLLECTION_NOT_EXIST|collection not exists/i.test(e.message || ''));
}
async function getDoc(openid) {
  const r = await db.collection('users').where({
    _openid: openid
  }).limit(1).get();
  return r.data && r.data[0] || null;
}
exports.main = async event => {
  const {
    OPENID: openid
  } = cloud.getWXContext();
  if (!openid) throw new Error('no openid');
  const action = event.action;

  // 读资料（集合未建时视为无资料，不抛错；前端据此弹出设置卡）
  if (action === 'getProfile') {
    let doc = null;
    try {
      doc = await getDoc(openid);
    } catch (e) {
      if (isMissingCollection(e)) return {
        profile: null,
        openid
      };
      throw e;
    }
    let avatarUrl = null;
    if (doc && doc.avatarType === 'custom' && doc.avatarFileID) {
      try {
        const t = await cloud.getTempFileURL({
          fileList: [doc.avatarFileID]
        });
        const f = t.fileList && t.fileList[0];
        avatarUrl = f && f.tempFileURL;
      } catch (e) {
        // 链接换取失败不阻塞资料读取
      }
    }
    return {
      openid,
      profile: doc ? {
        nickName: doc.nickName || '',
        avatarType: doc.avatarType || 'default',
        avatarIndex: doc.avatarIndex || 0,
        avatarUrl,
        avatarFileID: doc.avatarFileID || '',
        points: doc.points || 0
      } : null
    };
  }

  // 写资料（新增或更新自己的文档；跳过=默认头像+默认昵称，由前端传值）
  if (action === 'saveProfile') {
    const nickName = String(event.nickName || '').slice(0, 20);
    const avatarType = event.avatarType === 'custom' ? 'custom' : 'default';
    const avatarIndex = Math.max(0, Number(event.avatarIndex) || 0);
    const avatarFileID = avatarType === 'custom' ? String(event.avatarFileID || '') : '';
    if (!nickName) throw new Error('missing nickName');
    if (avatarType === 'custom' && !avatarFileID) throw new Error('missing avatarFileID');
    if (avatarType === 'custom' && !avatarFileID.endsWith('/avatars/' + openid + '.png')) throw new Error('FORBIDDEN_AVATAR');
    // Old releases also sent randomly generated defaults through saveProfile.
    // Treat those writes as initialization unless the user explicitly edits a profile.
    const initializeOnly = event.initializeOnly === true || (event.profileEdit !== true && /^(Listener [A-Z0-9]{4}|学习搭子 [A-Z0-9]{4})$/.test(nickName));
    const now = Date.now();
    const data = {
      nickName,
      avatarType,
      avatarIndex,
      avatarFileID,
      updatedAt: now
    };
    try {
      const uid = await legacyId(db, 'users', openid);
      await transaction(db, async tx => {
        const ref = tx.collection('users').doc(uid),
          doc = await read(ref);
        if (initializeOnly && doc?.nickName && doc.nickName !== '英语学习者') return;
        if (doc) await ref.update({
          data
        });else await ref.set({
          data: {
            ...data,
            createdAt: now,
            _openid: openid,
            points: 0
          }
        });
      });
    } catch (e) {
      if (isMissingCollection(e)) throw new Error('USERS_COLLECTION_MISSING');
      throw e;
    }
    return {
      ok: true
    };
  }

  // Explicit, idempotent state; old toggle clients are retained during migration.
  if (action === 'setFavorite' || action === 'toggleFavorite') {
    const lessonId = String(event.lessonId || '');
    if (!lessonId) throw new Error('INVALID_LESSON');
    const old = await db.collection('favorites').where({
      _openid: openid,
      lessonId
    }).limit(1).get();
    const id = old.data[0] ? old.data[0]._id : key('favorite', openid, lessonId);
    const favored = await transaction(db, async tx => {
      const ref = tx.collection('favorites').doc(id),
        exists = await read(ref);
      const desired = action === 'setFavorite' ? event.favored === true : !exists || exists.deleted;
      if (!desired) {
        if (exists) await ref.update({
          data: {
            deleted: true
          }
        });
        return false;
      }
      const fields = {
        _openid: openid,
        lessonId,
        deleted: false,
        title: String(event.title || exists?.title || '').slice(0, 200),
        cover: String(event.cover || exists?.cover || ''),
        level: String(event.level || exists?.level || ''),
        source: String(event.source || exists?.source || ''),
        duration: Number(event.duration || exists?.duration) || 0,
        createdAt: exists?.createdAt || Date.now()
      };
      await ref.set({
        data: fields
      });
      return true;
    });
    return {
      favored
    };
  }

  // 是否已收藏
  if (action === 'isFavored') {
    const lessonId = String(event.lessonId || '');
    try {
      const r = await db.collection('favorites').where({
        _openid: openid,
        lessonId,
        deleted: _.neq(true)
      }).limit(1).get();
      return {
        favored: r.data && r.data.length > 0
      };
    } catch (e) {
      if (isMissingCollection(e)) return {
        favored: false
      };
      throw e;
    }
  }

  // 收藏列表（倒序）
  if (action === 'listFavorites') {
    const result = await pageQuery(db, 'favorites', {
      _openid: openid,
      deleted: _.neq(true)
    }, event.cursor).get();
    return pageResult(result.data);
  }
  if (action === 'syncStudy') {
    const uid = await legacyId(db, 'users', openid);
    const input = event.state || {},
      now = Date.now();
    if (Buffer.byteLength(JSON.stringify(input)) > 600000) throw new Error('STATE_TOO_LARGE');
    return transaction(db, async tx => {
      const ref = tx.collection('users').doc(uid),
        user = await read(ref);
      const state = user?.studyState || {
        progress: {},
        vocab: {}
      };
      // state is mutated in place below, so snapshot it before merging. A repeated
      // heartbeat often resends identical state; writing a no-op update inside a
      // transaction can degrade into an empty $set (-502001) on some SDK versions.
      const before = user ? JSON.stringify(user.studyState || {}) : '';
      for (const field of ['progress', 'vocab']) {
        state[field] = state[field] || {};
        for (const [id, value] of Object.entries(input[field] || {}).slice(0, 1000)) {
          if (!id || ['__proto__','constructor','prototype'].includes(id) || id.length>120 || typeof value !== 'object' || !value) continue;
          const stamp = Math.min(now, Number(value.updatedAt) || 0);
          if (stamp >= (state[field][id]?.updatedAt || 0)) state[field][id] = {
            ...value,
            updatedAt: stamp
          };
        }
        state[field] = Object.fromEntries(Object.entries(state[field]).sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0)).slice(0, 1000));
      }
      if (Buffer.byteLength(JSON.stringify(state)) > 700000) throw new Error('STATE_TOO_LARGE');
      if (user) {
        // Skip the write when nothing changed; an identical transaction update
        // produced `-502001 ... '$set' is empty` under repeated heartbeats.
        if (JSON.stringify(state) !== before) await ref.update({
          data: {
            studyState: state
          }
        });
      } else await ref.set({
        data: {
          _openid: openid,
          nickName: '英语学习者',
          points: 0,
          createdAt: now,
          studyState: state
        }
      });
      return {
        state,
        syncedAt: now
      };
    });
  }

  // 积分流水（倒序）
  if (action === 'listPointLogs') {
    try {
      const r = await db.collection('pointLogs').where({
        _openid: openid
      }).orderBy('createdAt', 'desc').limit(100).get();
      return {
        list: r.data || []
      };
    } catch (e) {
      if (isMissingCollection(e)) return {
        list: []
      };
      throw e;
    }
  }

  // 消息列表（倒序，附未读数）
  if (action === 'listMessages') {
    try {
      const r = await db.collection('messages').where({
        _openid: openid
      }).orderBy('createdAt', 'desc').limit(50).get();
      const list = r.data || [];
      const unread = list.filter(m => !m.read).length;
      return {
        list,
        unread
      };
    } catch (e) {
      if (isMissingCollection(e)) return {
        list: [],
        unread: 0
      };
      throw e;
    }
  }

  // 标为已读（不传 ids 则标全部未读）
  if (action === 'markMessagesRead') {
    try {
      // 必须带 _openid 条件：云函数是管理员身份，doc(id).update() 会绕过集合权限，
      // 任何人传别人的消息 _id 都能把对方消息标成已读（越权改写他人数据）。
      const ids = Array.isArray(event.ids) ? event.ids.slice(0, 50).map(String) : [];
      const query = ids.length > 0 ? {
        _id: _.in(ids),
        _openid: openid,
        read: false
      } : {
        _openid: openid,
        read: false
      };
      // Never issue an update that matches zero rows. When every message is
      // already read, where().update() can degrade into an empty bulk write
      // and the SDK reports `-502001 ... '$set' is empty`.
      const pending = await db.collection('messages').where(query).count();
      if (pending.total > 0) {
        await db.collection('messages').where(query).update({
          data: {
            read: true
          }
        });
      }
      return {
        ok: true
      };
    } catch (e) {
      if (isMissingCollection(e)) return {
        ok: true
      };
      throw e;
    }
  }
  throw new Error('unknown action');
};
