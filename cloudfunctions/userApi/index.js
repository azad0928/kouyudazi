// 用户资料（个人中心前置）：getProfile / saveProfile。
// 以微信 openid 隔离，每人只能读写自己的 users 文档；
// 自选头像的云文件临时链接由服务端换取（免费版客户端无权直取）。
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

function isMissingCollection(e) {
  return e && (e.code === -502005 || /COLLECTION_NOT_EXIST|collection not exists/i.test(e.message || ''))
}

async function getDoc(openid) {
  const r = await db.collection('users').where({ _openid: openid }).limit(1).get()
  return (r.data && r.data[0]) || null
}

exports.main = async (event) => {
  const { OPENID: openid } = cloud.getWXContext()
  if (!openid) throw new Error('no openid')
  const action = event.action

  // 读资料（集合未建时视为无资料，不抛错；前端据此弹出设置卡）
  if (action === 'getProfile') {
    let doc = null
    try {
      doc = await getDoc(openid)
    } catch (e) {
      if (isMissingCollection(e)) return { profile: null, openid }
      throw e
    }
    let avatarUrl = null
    if (doc && doc.avatarType === 'custom' && doc.avatarFileID) {
      try {
        const t = await cloud.getTempFileURL({ fileList: [doc.avatarFileID] })
        const f = t.fileList && t.fileList[0]
        avatarUrl = f && f.tempFileURL
      } catch (e) {
        // 链接换取失败不阻塞资料读取
      }
    }
    return {
      openid,
      profile: doc
        ? {
            nickName: doc.nickName || '',
            avatarType: doc.avatarType || 'default',
            avatarIndex: doc.avatarIndex || 0,
            avatarUrl,
            avatarFileID: doc.avatarFileID || '',
            points: doc.points || 0,
          }
        : null,
    }
  }

  // 写资料（新增或更新自己的文档；跳过=默认头像+默认昵称，由前端传值）
  if (action === 'saveProfile') {
    const nickName = String(event.nickName || '').slice(0, 20)
    const avatarType = event.avatarType === 'custom' ? 'custom' : 'default'
    const avatarIndex = Math.max(0, Number(event.avatarIndex) || 0)
    const avatarFileID = avatarType === 'custom' ? String(event.avatarFileID || '') : ''
    if (!nickName) throw new Error('missing nickName')
    if (avatarType === 'custom' && !avatarFileID) throw new Error('missing avatarFileID')
    const now = Date.now()
    const data = { nickName, avatarType, avatarIndex, avatarFileID, updatedAt: now }
    try {
      const doc = await getDoc(openid)
      if (doc) {
        await db.collection('users').doc(doc._id).update({ data })
      } else {
        data.createdAt = now
        // _openid 必须显式写入（importApi 同样做法）；不可依赖自动填充，
        // 否则文档没有 openid，下次 where({_openid}) 查不到，会重复建文档
        data._openid = openid
        await db.collection('users').add({ data })
      }
    } catch (e) {
      if (isMissingCollection(e)) throw new Error('USERS_COLLECTION_MISSING')
      throw e
    }
    return { ok: true }
  }

  // 收藏/取消收藏文章
  if (action === 'toggleFavorite') {
    const lessonId = String(event.lessonId || '')
    if (!lessonId) throw new Error('missing lessonId')
    const col = db.collection('favorites')
    let exist = null
    try {
      const r = await col.where({ _openid: openid, lessonId }).limit(1).get()
      exist = (r.data && r.data[0]) || null
    } catch (e) {
      if (!isMissingCollection(e)) throw e
    }
    if (exist) {
      await col.doc(exist._id).remove()
      return { favored: false }
    }
    const now = Date.now()
    try {
      await col.add({
        data: {
          _openid: openid,
          lessonId,
          title: String(event.title || '').slice(0, 100),
          cover: String(event.cover || ''),
          level: String(event.level || ''),
          source: String(event.source || ''),
          duration: Number(event.duration) || 0,
          createdAt: now,
        },
      })
    } catch (e) {
      if (isMissingCollection(e)) throw new Error('FAVORITES_COLLECTION_MISSING')
      throw e
    }
    return { favored: true }
  }

  // 是否已收藏
  if (action === 'isFavored') {
    const lessonId = String(event.lessonId || '')
    try {
      const r = await db.collection('favorites').where({ _openid: openid, lessonId }).limit(1).get()
      return { favored: (r.data && r.data.length > 0) }
    } catch (e) {
      if (isMissingCollection(e)) return { favored: false }
      throw e
    }
  }

  // 收藏列表（倒序）
  if (action === 'listFavorites') {
    try {
      const r = await db
        .collection('favorites')
        .where({ _openid: openid })
        .orderBy('createdAt', 'desc')
        .limit(100)
        .get()
      return { list: r.data || [] }
    } catch (e) {
      if (isMissingCollection(e)) return { list: [] }
      throw e
    }
  }

  // 积分流水（倒序）
  if (action === 'listPointLogs') {
    try {
      const r = await db
        .collection('pointLogs')
        .where({ _openid: openid })
        .orderBy('createdAt', 'desc')
        .limit(100)
        .get()
      return { list: r.data || [] }
    } catch (e) {
      if (isMissingCollection(e)) return { list: [] }
      throw e
    }
  }

  // 消息列表（倒序，附未读数）
  if (action === 'listMessages') {
    try {
      const r = await db
        .collection('messages')
        .where({ _openid: openid })
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get()
      const list = r.data || []
      const unread = list.filter((m) => !m.read).length
      return { list, unread }
    } catch (e) {
      if (isMissingCollection(e)) return { list: [], unread: 0 }
      throw e
    }
  }

  // 标为已读（不传 ids 则标全部未读）
  if (action === 'markMessagesRead') {
    try {
      const ids = Array.isArray(event.ids) ? event.ids : []
      if (ids.length > 0) {
        // 必须带 _openid 条件：云函数是管理员身份，doc(id).update() 会绕过集合权限，
        // 任何人传别人的消息 _id 都能把对方消息标成已读（越权改写他人数据）。
        for (const id of ids.slice(0, 50)) {
          await db
            .collection('messages')
            .where({ _id: String(id), _openid: openid })
            .update({ data: { read: true } })
        }
      } else {
        await db.collection('messages').where({ _openid: openid, read: false }).update({
          data: { read: true },
        })
      }
      return { ok: true }
    } catch (e) {
      if (isMissingCollection(e)) return { ok: true }
      throw e
    }
  }

  throw new Error('unknown action')
}
