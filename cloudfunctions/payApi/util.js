// payApi 纯函数（无云依赖，可本地单测）：签名、单号、发货推送 XML 解析
const crypto = require('crypto')

/** 道具表（服务端定价为准，前端只传 productId，价格绝不信任前端） */
const PRODUCTS = {
  singleimport: { price: 300, name: '单次导入' },
  member30day: { price: 900, name: '30天会员' },
  unlimitedmember: { price: 5900, name: '无限制会员' },
}

const MONTHLY_DAYS = 30
const MONTHLY_LIMIT = 30

/** HMAC-SHA256 十六进制小写摘要 */
function hmacHex(key, msg) {
  return crypto.createHmac('sha256', key).update(msg, 'utf8').digest('hex')
}

/** 业务单号：T + 时间戳 + 4 位随机（8-32 位内、字符集合法、不以下划线开头） */
function makeOutTradeNo() {
  const rand = Math.floor(1000 + Math.random() * 9000)
  return 'T' + Date.now() + rand
}

/**
 * 组装 signData（键顺序固定，JSON.stringify 不加空格；
 * 签名用的原始字符串必须与实际传给前端的字符串完全一致）
 */
function buildSignData(offerId, productId, price, outTradeNo) {
  const obj = {
    offerId: String(offerId),
    buyQuantity: 1,
    env: 0,
    currencyType: 'CNY',
    productId,
    goodsPrice: price,
    outTradeNo,
    attach: productId,
  }
  return JSON.stringify(obj)
}

/** 支付签名：HMAC(AppKey, 'requestVirtualPayment' + '&' + signDataStr) */
function calcPaySig(appKey, signDataStr) {
  return hmacHex(appKey, 'requestVirtualPayment' + '&' + signDataStr)
}

/** 用户态签名：HMAC(sessionKey, signDataStr)，不加 uri */
function calcSignature(sessionKey, signDataStr) {
  return hmacHex(sessionKey, signDataStr)
}

/** 查单签名：HMAC(AppKey, '/xpay/query_order' + '&' + 请求体原始字符串) */
function calcQueryPaySig(appKey, bodyStr) {
  return hmacHex(appKey, '/xpay/query_order' + '&' + bodyStr)
}

/** 取 XML 标签内文（兼容 <t>v</t> 与 <t><![CDATA[v]]></t> 两种写法） */
function extractXmlValue(xml, tag) {
  if (!xml) return ''
  const re = new RegExp('<' + tag + '>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</' + tag + '>')
  const m = xml.match(re)
  return m ? m[1] : ''
}

/** 取 XML 一段子结构（如 <WeChatPayInfo>…</WeChatPayInfo>）的内文 */
function extractSection(xml, tag) {
  if (!xml) return ''
  const re = new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>')
  const m = xml.match(re)
  return m ? m[1] : ''
}

/**
 * 解析发货推送 xpay_goods_deliver_notify：
 * 买家在 OpenId 字段（FromUserName 是微信官方 openid，不要当成买家）；
 * 平台单号 wx_order_id 在 WeChatPayInfo.MchOrderNo（嵌套不到时回退平铺字段）
 */
function parseDeliverNotify(xml) {
  const paySection = extractSection(xml, 'WeChatPayInfo')
  const goodsSection = extractSection(xml, 'GoodsInfo')
  const pick = (section, tag) => extractXmlValue(section, tag) || extractXmlValue(xml, tag)
  return {
    event: extractXmlValue(xml, 'Event'),
    openId: extractXmlValue(xml, 'OpenId'),
    outTradeNo: extractXmlValue(xml, 'OutTradeNo'),
    wxOrderId: pick(paySection, 'MchOrderNo'),
    productId: pick(goodsSection, 'ProductId'),
    quantity: Number(pick(goodsSection, 'Quantity') || 1) || 1,
    attach: pick(goodsSection, 'Attach'),
  }
}

const SUCCESS_XML = '<xml><ErrCode>0</ErrCode><ErrMsg><![CDATA[success]]></ErrMsg></xml>'

module.exports = {
  PRODUCTS,
  MONTHLY_DAYS,
  MONTHLY_LIMIT,
  hmacHex,
  makeOutTradeNo,
  buildSignData,
  calcPaySig,
  calcSignature,
  calcQueryPaySig,
  extractXmlValue,
  extractSection,
  parseDeliverNotify,
  SUCCESS_XML,
}
