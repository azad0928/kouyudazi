// 云函数：虚拟支付 M3（个人主体道具直购）
// 下单签名（createOrder）+ 发货推送（HTTP 触发）+ 查单兜底（getOrder 内自愈）+ 额度开通
// 凭证全部走环境变量：VIRTUAL_APP_KEY（现网 AppKey）、VIRTUAL_APP_SECRET（AppSecret，
// 用于 code2Session 换 sessionKey 与查单 access_token）、VIRTUAL_PUSH_TOKEN（消息推送 Token，
// 必须与 MP 后台消息推送配置页填的 Token 一字不差，用于 Token 验证 GET 的验签）；OfferID 不是密钥，直接写常量。
// 价格以服务端 PRODUCTS 表为准，前端只传 productId，绝不信任前端传来的价格。
const cloud = require('wx-server-sdk')
const https = require('https')
const crypto = require('crypto')
const {
  PRODUCTS,
  MONTHLY_DAYS,
  MONTHLY_LIMIT,
  makeOutTradeNo,
  buildSignData,
  calcPaySig,
  calcSignature,
  calcQueryPaySig,
  parseDeliverNotify,
  SUCCESS_XML,
} = require('./util')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

const APPID = 'wxee0ed531ec8f79ba'
const OFFER_ID = '1450697849'

function appKey() {
  return (process.env.VIRTUAL_APP_KEY || '').trim()
}
function appSecret() {
  return (process.env.VIRTUAL_APP_SECRET || '').trim()
}

/** 消息推送 Token（与 MP 后台消息推送配置页填的 Token 必须一字不差；走环境变量） */
function pushToken() {
  return (process.env.VIRTUAL_PUSH_TOKEN || '').trim()
}

/** Token 验证用 sha1 */
function sha1Hex(s) {
  return crypto.createHash('sha1').update(s).digest('hex')
}

/** 从 HTTP 触发事件里取查询参数（兼容 queryStringParameters / queryString / query 三种形态） */
function queryParams(event) {
  if (event.queryStringParameters && typeof event.queryStringParameters === 'object') {
    return event.queryStringParameters
  }
  const qs = event.queryString || event.query || ''
  if (qs && typeof qs === 'object') return qs
  const out = {}
  if (typeof qs === 'string' && qs) {
    for (const pair of qs.split('&')) {
      const i = pair.indexOf('=')
      if (i > 0) out[decodeURIComponent(pair.slice(0, i))] = decodeURIComponent(pair.slice(i + 1))
    }
  }
  return out
}

function isMissingCollection(e) {
  return !!e && (e.code === -502005 || /COLLECTION_NOT_EXIST|collection not exists/i.test(e.message || ''))
}

/** 简易 https GET/POST（只依赖 Node 内置，不另装包） */
function httpsRequest(url, bodyStr) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const opts = {
      method: bodyStr ? 'POST' : 'GET',
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: bodyStr
        ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) }
        : {},
    }
    const req = https.request(opts, (res) => {
      let data = ''
      res.on('data', (c) => { data += c })
      res.on('end', () => resolve(data))
    })
    req.on('error', reject)
    if (bodyStr) req.write(bodyStr)
    req.end()
  })
}
async function httpsGetJson(url) {
  return JSON.parse(await httpsRequest(url))
}
async function httpsPostJson(url, bodyStr) {
  return JSON.parse(await httpsRequest(url, bodyStr))
}

/** code 换 sessionKey（登录接口通用做法：appid + secret + js_code） */
async function code2Session(code) {
  const url = 'https://api.weixin.qq.com/sns/jscode2session?appid=' + APPID
    + '&secret=' + encodeURIComponent(appSecret())
    + '&js_code=' + encodeURIComponent(code)
    + '&grant_type=authorization_code'
  const res = await httpsGetJson(url)
  if (!res || res.errcode || !res.session_key) {
    throw new Error('CODE2SESSION_FAILED: ' + (res && (res.errmsg || res.errcode) || 'empty'))
  }
  return res
}

/** 查单用 access_token（client_credential，同样需要 AppSecret）。
 * 进程内缓存（提前 5 分钟刷新）：定时扫单一次要查多笔，不缓存会每笔都多一次外网往返，
 * 在 3 秒超时下很容易被杀。 */
let tokenCache = { token: '', expiresAt: 0 }
async function getAccessToken() {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt) return tokenCache.token
  const url = 'https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=' + APPID
    + '&secret=' + encodeURIComponent(appSecret())
  const res = await httpsGetJson(url)
  if (!res || res.errcode || !res.access_token) {
    throw new Error('TOKEN_FAILED: ' + (res && (res.errmsg || res.errcode) || 'empty'))
  }
  const ttl = Number(res.expires_in || 7200) - 300
  tokenCache = { token: res.access_token, expiresAt: Date.now() + ttl * 1000 }
  return tokenCache.token
}

/** 给任意 Promise 套一个超时，避免单个外网请求把整次调用拖死 */
function withTimeout(p, ms, label) {
  return Promise.race([
    p,
    new Promise((_, reject) => setTimeout(() => reject(new Error((label || 'task') + ' 超时 ' + ms + 'ms')), ms)),
  ])
}

/** 取用户额度文档（没有返回 null；集合不存在也返回 null） */
async function getQuotaDoc(openid) {
  try {
    const res = await db.collection('quotas').where({ _openid: openid }).limit(1).get()
    return (res.data && res.data[0]) || null
  } catch (e) {
    if (isMissingCollection(e)) return null
    throw e
  }
}

/**
 * 按道具开通额度（与 importApi 的 quotas 文档结构完全一致）：
 * 单次 → singleRemaining += 数量；包月 → 30 天会员（已是终身不降级；
 * 已有未过期包月则在原过期时间上再延 30 天，并重开一个 30 次计数窗口）；
 * 终身 → membership = { type: 'lifetime' }。
 */
async function grantQuota(openid, productId, quantity) {
  const now = Date.now()
  const doc = await getQuotaDoc(openid)
  if (!doc) {
    const membership = productId === 'unlimitedmember'
      ? { type: 'lifetime' }
      : productId === 'member30day'
        ? { type: 'monthly', expiresAt: now + MONTHLY_DAYS * 24 * 3600 * 1000, monthlyStart: now, monthlyUsed: 0 }
        : null
    await db.collection('quotas').add({
      data: {
        _openid: openid,
        freeUsed: 0,
        singleRemaining: productId === 'singleimport' ? quantity : 0,
        membership,
      },
    })
    return
  }
  const patch = {}
  if (productId === 'singleimport') {
    patch.singleRemaining = (doc.singleRemaining || 0) + quantity
  } else if (productId === 'member30day') {
    // 终身已开通时不降级，订单仍记为已发货
    if (!doc.membership || doc.membership.type !== 'lifetime') {
      const base = doc.membership && doc.membership.type === 'monthly' && doc.membership.expiresAt > now
        ? doc.membership.expiresAt
        : now
      patch.membership = {
        type: 'monthly',
        expiresAt: base + MONTHLY_DAYS * 24 * 3600 * 1000,
        monthlyStart: now,
        monthlyUsed: 0,
      }
    }
  } else if (productId === 'unlimitedmember') {
    patch.membership = { type: 'lifetime' }
  }
  if (Object.keys(patch).length > 0) {
    await db.collection('quotas').doc(doc._id).update({ data: patch })
  }
}

/** 发货（幂等：已发货的订单直接返回 false，不重复开通） */
async function deliverOrder(order, wxOrderId) {
  // 并发加固：推送/轮询/定时三个发货者可能同时在跑，按 _id 重读一次，
  // 以库里最新状态为准（并发窗口从秒级缩到毫秒级）。
  // 重读失败直接抛错（fail closed）：上层会重试或由定时扫单兜底，不会静默漏发。
  const fresh = await db.collection('orders').doc(order._id).get()
  if (fresh.data && fresh.data.status === 'delivered') return false
  if (order.status === 'delivered') return false
  const buyer = order._openid
  await grantQuota(buyer, order.productId, order.buyQuantity || 1)
  await db.collection('orders').doc(order._id).update({
    data: { status: 'delivered', wx_order_id: wxOrderId || '', deliveredAt: Date.now() },
  })
  return true
}

/** 查单兜底：订单仍是 created 时问平台状态；2=已支付待发货、4=已发货时补发货。
 * 返回 { status, error }：失败原因不再静默吞掉，getOrder 会把它带给客户端红字展示，
 * 否则客户端永远不知道查单为什么没成功。状态比较用 Number()，数字/字符串都认。 */
async function queryOrderFallback(order, openid) {
  try {
    const token = await getAccessToken()
    const bodyObj = { openid, env: 0, order_id: order.outTradeNo }
    const bodyStr = JSON.stringify(bodyObj)
    const paySig = calcQueryPaySig(appKey(), bodyStr)
    const url = 'https://api.weixin.qq.com/xpay/query_order?access_token='
      + encodeURIComponent(token) + '&pay_sig=' + paySig
    // 拿原始文本再解析：微信偶发返回空 body / 非 JSON，直接 parse 会把细节吞掉
    const raw = await httpsRequest(url, bodyStr)
    let res = null
    try {
      res = raw ? JSON.parse(raw) : null
    } catch (e) {
      console.error('queryOrder raw not json', String(raw).slice(0, 200))
      return { status: order.status, error: '查单返回非 JSON：' + String(raw).slice(0, 120) }
    }
    if (!res) {
      return { status: order.status, error: '查单返回空响应' }
    }
    if ((res.errcode === 0 || res.errcode === '0') && res.order) {
      // 官方 status 枚举：0初始化 1已创建 2已支付待发货 3发货中 4已发货
      // 5/7/8退款相关 6已关闭。
      // 之前只认 2 和 4，漏掉 3（发货中＝钱已付、平台在等我们确认发货），
      // 导致已付款的订单查单查到了也不发货——这是「付了钱额度不涨」的直接原因之一。
      const st = Number(res.order.status)
      if (st === 2 || st === 3 || st === 4) {
        await deliverOrder(order, res.order.wx_order_id || '')
        return { status: 'delivered', error: '' }
      }
    }
    // 平台回包但不是可发货状态：errcode + errmsg 一起带回去，否则只能靠猜
    const detail = 'errcode=' + res.errcode + '，errmsg=' + (res.errmsg || '')
      + '，status=' + (res.order ? res.order.status : 'undefined')
    console.error('queryOrder not deliverable', JSON.stringify({ outTradeNo: order.outTradeNo, errcode: res.errcode, errmsg: res.errmsg, orderStatus: res.order && res.order.status }))
    return { status: order.status, error: '查单未到可发货状态（' + detail + '）' }
  } catch (e) {
    console.error('queryOrderFallback failed', e)
    return { status: order.status, error: (e && e.message) || '查单异常' }
  }
}

/**
 * 云开发「消息推送 - 云函数模式」推送来的事件是【已解析好的对象】，不是 HTTP 触发的 XML：
 * { ToUserName, FromUserName, MsgType:'event', Event:'xpay_goods_deliver_notify',
 *   OpenId, OutTradeNo, Env, WeChatPayInfo:{MchOrderNo,...}, GoodsInfo:{ProductId,Quantity,...} }
 * 之前只认 HTTP 触发（event.body 是 XML），云函数模式下分流判断全落空，
 * 推送被当成普通云调用走到 action 分支 → 抛 unknown action → 发货永远不发生。
 */
function parseCloudPushEvent(event) {
  const pay = event.WeChatPayInfo && typeof event.WeChatPayInfo === 'object' ? event.WeChatPayInfo : {}
  const goods = event.GoodsInfo && typeof event.GoodsInfo === 'object' ? event.GoodsInfo : {}
  const pick = (obj, key) => (obj && obj[key]) || event[key] || ''
  return {
    event: event.Event || '',
    openId: pick(null, 'OpenId') || event.OpenId || '',
    outTradeNo: event.OutTradeNo || '',
    wxOrderId: pay.MchOrderNo || event.MchOrderNo || '',
    productId: goods.ProductId || event.ProductId || '',
    quantity: Number(goods.Quantity || event.Quantity || 1) || 1,
    attach: goods.Attach || event.Attach || '',
  }
}

/**
 * 按推送内容发货（幂等）：平台单号已发货 / 业务单号已发货 → 直接成功；
 * 订单缺失时按推送里的 OpenId 直接开通并补记订单。
 * 返回 true 表示本次真实发货，false 表示已发过或无法发货。
 */
async function deliverByNotify(n) {
  if (!n.outTradeNo) {
    console.error('payNotify: missing outTradeNo', JSON.stringify(n))
    return false
  }
  // 幂等 1：平台单号维度
  if (n.wxOrderId) {
    try {
      const dup = await db.collection('orders')
        .where({ wx_order_id: n.wxOrderId, status: 'delivered' }).limit(1).get()
      if (dup.data && dup.data.length > 0) return false
    } catch (e) {
      console.error('payNotify: dup check failed', e)
    }
  }
  let order = null
  try {
    const snap = await db.collection('orders')
      .where({ outTradeNo: n.outTradeNo }).limit(1).get()
    order = snap.data && snap.data[0]
  } catch (e) {
    if (!isMissingCollection(e)) throw e
  }
  if (order) {
    if (order.status === 'delivered') return false
    await deliverOrder(order, n.wxOrderId)
    return true
  }
  // 订单记录缺失的安全网：以推送里的 OpenId 为准直接开通
  if (n.openId && PRODUCTS[n.productId]) {
    await grantQuota(n.openId, n.productId, n.quantity || 1)
    await db.collection('orders').add({
      data: {
        _openid: n.openId,
        outTradeNo: n.outTradeNo,
        productId: n.productId,
        goodsPrice: PRODUCTS[n.productId].price,
        buyQuantity: n.quantity || 1,
        status: 'delivered',
        wx_order_id: n.wxOrderId || '',
        createdAt: Date.now(),
        deliveredAt: Date.now(),
        source: 'notify',
      },
    })
    return true
  }
  console.error('payNotify: unknown product or missing openid', JSON.stringify(n))
  return false
}

/**
 * 核实推送对应的订单确实已支付（防伪造推送）：
 * 云函数推送事件与客户端云调用在形态上无法区分，推送只当触发器；
 * 用推送里的 outTradeNo + openId 直接问微信服务端，只认 2/3/4 为已支付。
 * 返回 true=已支付；false=未支付或查无此单；查询异常则抛错（上层回 -1 让平台重试）。
 */
async function verifyPushPaid(n) {
  if (!n.outTradeNo || !n.openId) return false
  const token = await getAccessToken()
  const bodyObj = { openid: n.openId, env: 0, order_id: n.outTradeNo }
  const bodyStr = JSON.stringify(bodyObj)
  const paySig = calcQueryPaySig(appKey(), bodyStr)
  const url = 'https://api.weixin.qq.com/xpay/query_order?access_token='
    + encodeURIComponent(token) + '&pay_sig=' + paySig
  const raw = await withTimeout(httpsRequest(url, bodyStr), 8000, 'verifyPushPaid')
  let res = null
  try {
    res = raw ? JSON.parse(raw) : null
  } catch (e) {
    console.error('verifyPushPaid raw not json', String(raw).slice(0, 200))
    throw new Error('查单返回非 JSON')
  }
  if (!res) throw new Error('查单返回空响应')
  if (!(res.errcode === 0 || res.errcode === '0') || !res.order) return false
  const st = Number(res.order.status)
  return st === 2 || st === 3 || st === 4
}

/** 云函数模式推送：必须回 { ErrCode: 0 }，回 XML 字符串会被判失败并重试 15 次 */
async function handleCloudPush(event) {
  const success = () => ({ ErrCode: 0, ErrMsg: 'success' })
  if (event.Event !== 'xpay_goods_deliver_notify') {
    console.log('push ignored, event =', event.Event)
    return success()
  }
  const n = parseCloudPushEvent(event)
  console.log('push received', JSON.stringify(n))
  try {
    // 先核实确实已支付才发货（防伪造推送）；未支付回成功避免平台重试风暴，
    // 延迟到账由 5 分钟定时扫单兜底；异常走 catch 回 -1 让平台重试
    const paid = await verifyPushPaid(n)
    if (!paid) {
      console.log('push verify not paid, skip deliver', n.outTradeNo)
      return success()
    }
    await deliverByNotify(n)
  } catch (e) {
    // 异常时回非 0，让平台重试（幂等保证不会重复发货）
    console.error('cloudPush deliver failed', e)
    return { ErrCode: -1, ErrMsg: (e && e.message) || 'deliver failed' }
  }
  return success()
}

/**
 * 定时兜底：扫描「超过 N 分钟仍是 created」的订单，逐个查单补发货。
 * 覆盖「推送没配/推送丢失 + 前端轮询 30 秒超时」这两种都没兜住的情况，
 * 官方建议每 5 分钟跑一次。
 */
async function scanPendingOrders() {
  const start = Date.now()
  const now = start
  const minAge = 3 * 60 * 1000 // 3 分钟内的可能是刚下单还在支付，先不动
  const maxAge = 7 * 24 * 3600 * 1000 // 最多回溯 7 天
  const BUDGET_MS = 20000 // 总时间预算：超时设成 60s 时安全，函数超时仍是 3s 时也能抢救前几笔
  const out = { scanned: 0, delivered: 0, skipped: 0, errors: [] }
  try {
    const res = await db.collection('orders')
      .where({
        status: 'created',
        createdAt: db.command.lt(now - minAge).and(db.command.gt(now - maxAge)),
      })
      .limit(10)
      .get()
    const list = res.data || []
    out.scanned = list.length
    for (const order of list) {
      if (Date.now() - start > BUDGET_MS) {
        out.errors.push({ outTradeNo: '-', error: '超出时间预算，剩余订单下次再扫' })
        break
      }
      try {
        const q = await withTimeout(queryOrderFallback(order, order._openid), 6000, 'queryOrder')
        if (q.status === 'delivered') out.delivered += 1
        else {
          out.skipped += 1
          if (q.error) out.errors.push({ outTradeNo: order.outTradeNo, error: q.error })
        }
      } catch (e) {
        out.errors.push({ outTradeNo: order.outTradeNo, error: (e && e.message) || String(e) })
      }
    }
  } catch (e) {
    if (isMissingCollection(e)) return out
    out.errors.push({ scan: (e && e.message) || String(e) })
  }
  console.log('scanPendingOrders', JSON.stringify(out))
  return out
}

/** 发货推送（HTTP 触发）：先处理 Token 验证 GET，再解析 XML → 幂等 → 开通 → 回成功 XML（否则平台重试最多 15 次） */
async function handleNotify(event) {
  const ok = () => ({
    statusCode: 200,
    headers: { 'Content-Type': 'application/xml' },
    body: SUCCESS_XML,
  })
  // 非发货推送的通用消息直接回 success（微信认 success 为已收到，不重试；回 XML 反而可能被重推）
  const okText = () => ({
    statusCode: 200,
    headers: { 'Content-Type': 'text/plain' },
    body: 'success',
  })

  // Token 验证：MP 后台配消息推送时，微信发 GET 校验（signature/timestamp/nonce/echostr）。
  // 验签 = sha1(字典序排 [Token, timestamp, nonce] 拼起来)，通过才回 echostr，否则提交不过。
  const method = (event.httpMethod || event.method || '').toUpperCase()
  const qp = queryParams(event)
  if (method === 'GET' || (qp.signature && qp.echostr)) {
    const token = pushToken()
    const arr = [token, qp.timestamp || '', qp.nonce || ''].sort()
    if (token && sha1Hex(arr.join('')) === qp.signature) {
      return { statusCode: 200, headers: { 'Content-Type': 'text/plain' }, body: qp.echostr }
    }
    return { statusCode: 403, body: 'forbidden' }
  }

  let bodyStr = ''
  if (typeof event.body === 'string') {
    bodyStr = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body
  }
  if (!bodyStr || bodyStr.indexOf('xpay_goods_deliver_notify') === -1) {
    return okText() // 不是发货推送的事件直接回 success，不触发重试
  }
  const n = parseDeliverNotify(bodyStr)
  if (!n.outTradeNo) {
    console.error('payNotify: missing outTradeNo')
    return ok()
  }
  // 幂等发货逻辑与云函数推送模式共用一份（deliverByNotify）
  try {
    // 同云函数模式：推送只当触发器，先核实已支付（防伪造）；异常走下方 catch 触发平台重试
    const paid = await verifyPushPaid(n)
    if (!paid) {
      console.log('http push verify not paid, skip deliver', n.outTradeNo)
      return ok()
    }
    await deliverByNotify(n)
  } catch (e) {
    // 处理异常时不回成功，让平台重试（最多 15 次）；幂等保证重试不重复开通
    console.error('payNotify failed', e)
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/xml' },
      body: '<xml><ErrCode>1</ErrCode><ErrMsg><![CDATA[retry]]></ErrMsg></xml>',
    }
  }
  return ok()
}

exports.main = async (event) => {
  // 事件形态分流（顺序不能乱）：
  //  1) 定时触发器（兜底扫单）  2) 云开发消息推送（云函数模式，event 是已解析对象）
  //  3) HTTP 触发（自建/云托管形态，XML body + Token 验证）  4) 小程序端云调用（action）
  if (event && (event.Type === 'Timer' || event.TriggerName)) {
    return scanPendingOrders()
  }
  if (event && (event.MsgType || event.Event)) {
    return handleCloudPush(event)
  }
  const qp = (event && event.queryStringParameters) || {}
  if (event && (event.httpMethod || qp.echostr || qp.signature || (typeof event.body === 'string' && event.body.indexOf('xpay_goods_deliver_notify') !== -1))) {
    return handleNotify(event)
  }

  const { OPENID: openid } = cloud.getWXContext()
  if (!openid) {
    throw new Error('missing openid')
  }
  const action = event && event.action

  // 下单：生成业务单号 + signData + 两套签名，建 orders 记录（待支付）
  if (action === 'createOrder') {
    const product = PRODUCTS[event.productId]
    if (!product) {
      throw new Error('UNKNOWN_PRODUCT')
    }
    if (!event.code) {
      throw new Error('missing code')
    }
    if (!appKey() || !appSecret()) {
      throw new Error('PAY_NOT_CONFIGURED')
    }
    const session = await code2Session(event.code)
    const outTradeNo = makeOutTradeNo()
    const signDataStr = buildSignData(OFFER_ID, event.productId, product.price, outTradeNo)
    const paySig = calcPaySig(appKey(), signDataStr)
    const signature = calcSignature(session.session_key, signDataStr)
    await db.collection('orders').add({
      data: {
        _openid: openid,
        outTradeNo,
        productId: event.productId,
        goodsPrice: product.price,
        buyQuantity: 1,
        status: 'created',
        wx_order_id: '',
        createdAt: Date.now(),
      },
    })
    return {
      payData: {
        signData: signDataStr,
        mode: 'short_series_goods',
        paySig,
        signature,
      },
      outTradeNo,
    }
  }

  // 查单（客户端支付后轮询）：created 时自动走查单兜底自愈
  if (action === 'getOrder') {
    if (!event.outTradeNo) {
      throw new Error('missing outTradeNo')
    }
    let order = null
    try {
      const res = await db.collection('orders')
        .where({ _openid: openid, outTradeNo: event.outTradeNo }).limit(1).get()
      order = res.data && res.data[0]
    } catch (e) {
      if (isMissingCollection(e)) return { order: null }
      throw e
    }
    if (!order) return { order: null }
    let status = order.status
    let queryError = ''
    if (status === 'created' && appKey() && appSecret()) {
      const q = await queryOrderFallback(order, openid)
      status = q.status
      queryError = q.error || ''
    }
    return {
      order: {
        outTradeNo: order.outTradeNo,
        productId: order.productId,
        status,
        wx_order_id: order.wx_order_id || '',
      },
      queryError,
    }
  }

  throw new Error('unknown action: ' + action)
}
