<template>
  <view class="container">
    <!-- 额度卡片（M3：免费 + 单次 + 会员；扣次顺序：包月 → 免费 → 单次） -->
    <view class="quota-card">
      <view class="quota-title">导入额度</view>
      <view class="quota-text">
        <template v-if="quota">
          免费额度剩余 {{ Math.max(0, quota.freeTotal - quota.freeUsed) }} 次（共 {{ quota.freeTotal }} 次）
        </template>
        <template v-else>额度加载中…</template>
      </view>
      <view v-if="quota && quota.singleRemaining > 0" class="quota-text">
        单次额度剩余 {{ quota.singleRemaining }} 次
      </view>
      <view v-if="quota && quota.pointsRemaining > 0" class="quota-text">
        积分额度剩余 {{ quota.pointsRemaining }} 次
      </view>
      <view v-if="membershipText" class="quota-text">{{ membershipText }}</view>
      <view v-if="quota" class="quota-row">
        <text class="quota-text">积分：{{ quota.points || 0 }} 分（100 分兑 1 次）</text>
        <button v-if="!redeeming" class="redeem-btn" :class="{ 'redeem-btn-disabled': (quota.points || 0) < 100 }" @click="onRedeem">兑换</button>
        <text v-if="redeeming" class="quota-text">兑换中…</text>
      </view>
      <view v-if="quotaSyncing" class="quota-syncing">购买已支付，正在同步额度…</view>
      <view class="quota-note">单篇上限 5000 字；额度按包月 → 免费 → 积分 → 单次的顺序使用</view>
    </view>

    <!-- 购买额度（M3：微信虚拟支付；价格以后台道具为准） -->
    <view class="buy-card">
      <view class="buy-title">购买导入额度</view>
      <view v-if="isLifetime" class="buy-note">已是无限制会员，无需再购买</view>
      <template v-else>
        <view v-for="p in products" :key="p.id" class="buy-row">
          <view class="buy-info">
            <view class="buy-name">{{ p.name }} {{ p.price }}</view>
            <view class="buy-desc">{{ p.desc }}</view>
          </view>
          <button class="buy-btn" :disabled="!!purchasing" @click="buy(p.id)">
            {{ purchasing === p.id ? '购买中…' : '购买' }}
          </button>
        </view>
        <view class="buy-note">购买后额度到账以发货为准；包月自购买日起 30 天内有效。</view>
      </template>
      <view v-if="buyError" class="buy-error">{{ buyError }}</view>
      <view v-if="pendingOutTradeNo && !purchasing" class="requery-row">
        <text class="requery-text">上次订单未确认到账？</text>
        <text class="requery-btn" :class="{ busy: requerying }" @click="onRequery">重新查询</text>
      </view>
    </view>

    <!-- 选文件 -->
    <button class="pick-btn" @click="chooseFile">选择文件（txt / md / docx）</button>

    <view v-if="file" class="file-card">
      <view class="file-name">{{ file.name }}</view>
      <view v-if="charCount !== null" class="file-meta">
        共 {{ charCount }} 字
        <text v-if="charCount > MAX_CHARS" class="over">（超出 5000 字上限）</text>
      </view>
      <view v-else class="file-meta">docx 字数在处理时校验，超限自动返还额度</view>
      <view v-if="errorMsg" class="error">{{ errorMsg }}</view>
    </view>

    <!-- 上传 -->
    <button
      class="upload-btn"
      :disabled="!canUpload || uploading"
      @click="upload"
    >
      {{ uploading ? (uploadProgress > 0 ? `上传中 ${uploadProgress}%` : '上传中…') : '上传并开始处理' }}
    </button>

    <!-- 成功态：上传后自动轮询处理进度 -->
    <view v-if="uploaded" class="success">
      <view class="success-title">
        {{ processStatus === 'done' ? '处理完成，可以学习了' : processStatus === 'failed' ? '处理失败' : '已上传，正在处理' }}
      </view>
      <view v-if="processStatus === 'processing'" class="success-desc">
        处理进度 {{ processProgress }}%（解析、合成音频、标生词需要一点时间，请不要离开本页）
      </view>
      <view v-else-if="processStatus === 'failed'" class="success-desc">{{ processErrorText }}</view>
      <view v-else-if="processStatus === 'done'" class="success-desc">
        去“我的导入”里点它即可开始学习（播放、跟读、生词弹框都和官方课一样用）。
      </view>
      <button class="back-btn" @click="goBack">返回我的导入</button>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { onShow, onHide, onUnload } from '@dcloudio/uni-app'

const MAX_CHARS = 5000

interface Quota {
  freeTotal: number
  freeUsed: number
  singleRemaining: number
  pointsRemaining: number
  points: number
  membership: { type: string; expiresAt?: number } | null
  monthlyRemaining: number | null
}

/** 可购买的道具（价格以后台道具为准，这里只做展示；下单价格由云函数服务端定） */
const products = [
  { id: 'singleimport', name: '单次导入', desc: '购买后加 1 次导入额度', price: '¥3' },
  { id: 'member30day', name: '30天会员', desc: '30 天内 30 次导入', price: '¥9' },
  { id: 'unlimitedmember', name: '无限制会员', desc: '终身不限次数', price: '¥59' },
]

const isLifetime = computed(() => quota.value?.membership?.type === 'lifetime')

/** 会员状态文案（终身 / 包月剩余次数与到期日 / 已过期） */
const membershipText = computed(() => {
  const m = quota.value?.membership
  if (!m) return ''
  if (m.type === 'lifetime') return '无限制会员（终身）'
  if (m.type === 'monthly') {
    if (m.expiresAt && m.expiresAt > Date.now()) {
      const d = new Date(m.expiresAt)
      const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      return `30天会员：剩余 ${quota.value?.monthlyRemaining ?? 0} 次，至 ${date}`
    }
    return '30天会员已过期'
  }
  return ''
})

const purchasing = ref('')
const buyError = ref('')
// 上次未确认到账的订单号（本地存着，页面重进还在；到账后清除）
// 补查只查本机下过的单，不会跨设备串单
const pendingOutTradeNo = ref('')
const requerying = ref(false)
try {
  pendingOutTradeNo.value = uni.getStorageSync('lastPayOutTradeNo') || ''
} catch { /* 存储不可用时补查入口直接不显示 */ }

const quota = ref<Quota | null>(null)
const file = ref<{ path: string; name: string } | null>(null)
const charCount = ref<number | null>(null)
const errorMsg = ref('')
const uploading = ref(false)
const uploadProgress = ref(0)
const uploaded = ref(false)
// 处理轮询状态（M2：上传后自动推进 processImport）
const importId = ref('')
const processStatus = ref<'idle' | 'processing' | 'done' | 'failed'>('idle')
const processProgress = ref(0)
const processError = ref('')
const processErrorDetail = ref('') // 调用云函数抛错时的真实 errMsg（误诊修复用）
let pollTimer: any = null
let pollFailCount = 0 // 连续调用失败计数（误诊修复：瞬时失败先重试）

/** 失败原因文案 */
const processErrorText = computed(() => {
  if (processError.value === 'TTS_NOT_CONFIGURED') {
    return '需要先配置腾讯云密钥和音色：云函数环境变量 TENCENT_SECRET_ID、TENCENT_SECRET_KEY、VOICE_TYPE（超自然大模型 2.0 女声的 ID）。配好后在“我的导入”里点这条记录重试，额度已返还。'
  }
  if (processError.value === 'OVER_LIMIT') return '超出单篇 5000 字上限，额度已返还。'
  if (processError.value === 'CONTENT_RISK') return '内容未通过安全审核，额度已返还。'
  if (processError.value === 'PROCESS_NOT_DEPLOYED') {
    return '处理函数 processImport 未部署：请先在开发者工具里部署它，部署后在“我的导入”里点这条记录可续跑。'
  }
  if (processError.value === 'PROCESS_CALL_FAILED') {
    return `调用处理函数失败（已自动重试 3 次）：${processErrorDetail.value || '未知错误'}。函数大概率已部署但执行中出错，请去云开发控制台看 processImport 的实时日志定位；也可在“我的导入”里点这条记录重试。`
  }
  return '处理失败，额度已返还，可在“我的导入”里点这条记录重试。'
})

/** 能否上传：已选文件、无字数超限、未在上传中，且任一额度可用
 *（终身直接可用；包月看剩余次数；免费/单次看剩余；服务端 pickAndDeduct 是最终校验） */
const canUpload = computed(() => {
  if (!file.value || uploading.value || uploaded.value) return false
  if (charCount.value !== null && charCount.value > MAX_CHARS) return false
  if (!quota.value) return false
  if (quota.value.membership && quota.value.membership.type === 'lifetime') return true
  if ((quota.value.monthlyRemaining ?? 0) > 0) return true
  if (quota.value.freeUsed < quota.value.freeTotal) return true
  if ((quota.value.pointsRemaining ?? 0) > 0) return true
  if (quota.value.singleRemaining > 0) return true
  return false
})

/** 读 txt/md 文本（FileSystemManager 只支持回调，这里包一层 Promise） */
function readTextFile(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    uni
      .getFileSystemManager()
      .readFile({
        filePath: path,
        encoding: 'utf8',
        success: (res: any) => resolve(res.data as string),
        fail: (err: any) => reject(err),
      })
  })
}

/** 拉额度 */
async function loadQuota() {
  try {
    const res: any = await wx.cloud.callFunction({
      name: 'importApi',
      data: { action: 'getQuota' },
    })
    quota.value = res.result.quota as Quota
  } catch (e: any) {
    // 把真实报错露出来（未部署时是 function not found 之类），便于定位
    errorMsg.value = `额度服务失败：${e?.errMsg || e?.message || '未知错误'}（若未部署 importApi，请先部署）`
  }
}

// 购买后额度同步：支付成功但 30 秒轮询未确认发货时（靠推送/定时扫单发货），
// 卡片会一直显示旧额度直到下次进页面；这里静默重拉配额直到额度变化或超时
const quotaSyncing = ref(false)
let quotaSyncTimer: any = null
let quotaSyncBaseline = ''
let quotaSyncDeadline = 0
function quotaFingerprint(q: any): string {
  if (!q) return ''
  return JSON.stringify({
    s: q.singleRemaining || 0,
    ps: q.pointsRemaining || 0,
    pb: q.points || 0,
    mt: (q.membership && q.membership.type) || '',
    me: (q.membership && q.membership.expiresAt) || 0,
    mr: q.monthlyRemaining ?? null,
  })
}
function stopQuotaSync() {
  quotaSyncing.value = false
  if (quotaSyncTimer) {
    clearInterval(quotaSyncTimer)
    quotaSyncTimer = null
  }
}
async function startQuotaSync() {
  stopQuotaSync()
  if (!quota.value) return
  quotaSyncBaseline = quotaFingerprint(quota.value)
  quotaSyncDeadline = Date.now() + 10 * 60 * 1000
  quotaSyncing.value = true
  quotaSyncTimer = setInterval(async () => {
    try {
      if (Date.now() > quotaSyncDeadline) {
        stopQuotaSync()
        return
      }
      const res: any = await wx.cloud.callFunction({
        name: 'importApi',
        data: { action: 'getQuota' },
      })
      const q = res.result && res.result.quota
      if (q && quotaFingerprint(q) !== quotaSyncBaseline) {
        stopQuotaSync()
        quota.value = q as Quota
        pendingOutTradeNo.value = ''
        try {
          uni.removeStorageSync('lastPayOutTradeNo')
        } catch {
          /* ignore */
        }
        uni.showToast({ title: '额度已到账', icon: 'success' })
      }
    } catch {
      /* 静默重试，下一次 tick 继续 */
    }
  }, 15000)
}

onShow(() => {
  loadQuota()
})

onHide(() => {
  stopQuotaSync()
})

/** iOS 支付要求微信 8.0.68+；不满足时不让下单（文档示例逻辑） */
function iosPayAllowed(): boolean {
  try {
    const sys: any = wx.getSystemInfoSync()
    if (sys.platform !== 'ios') return true
    const parts = String(sys.version || '').split('.').map((x: string) => parseInt(x, 10) || 0)
    const need = [8, 0, 68]
    for (let i = 0; i < 3; i++) {
      if ((parts[i] || 0) > need[i]) return true
      if ((parts[i] || 0) < need[i]) return false
    }
    return true
  } catch {
    return true
  }
}

/** wx.login 取 code（供云函数换 sessionKey 做用户态签名） */
function wxLogin(): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (res: any) => (res.code ? resolve(res.code) : reject(new Error('no code'))),
      fail: (err: any) => reject(err),
    })
  })
}

/** 支付后轮询查单：发货推送是主路径，查单是兜底；30 秒内未确认则让用户稍后查看 */
/** 轮询查单：返回是否已发货 + 最后一次查单失败原因（用于超时后红字展示） */
async function pollOrder(outTradeNo: string): Promise<{ delivered: boolean; queryError: string }> {
  let lastQueryError = ''
  for (let i = 0; i < 15; i++) {
    try {
      const res: any = await wx.cloud.callFunction({
        name: 'payApi',
        data: { action: 'getOrder', outTradeNo },
      })
      if (res.result && res.result.order && res.result.order.status === 'delivered') {
        return { delivered: true, queryError: '' }
      }
      if (res.result && res.result.queryError) lastQueryError = res.result.queryError
    } catch {
      // 查单失败不中断轮询（推送可能随后到）
    }
    await new Promise((r) => setTimeout(r, 2000))
  }
  return { delivered: false, queryError: lastQueryError }
}

/** 购买：下单签名 → 拉起虚拟支付 → 轮询确认发货（前端成功回调不作为发货依据） */
async function buy(productId: string) {
  if (purchasing.value) return
  if (!iosPayAllowed()) {
    uni.showModal({ title: '需要更新微信', content: '请将微信更新至最新版后再进行支付', showCancel: false })
    return
  }
  if (typeof wx.canIUse === 'function' && !wx.canIUse('requestVirtualPayment')) {
    uni.showToast({ title: '当前微信版本不支持虚拟支付，请更新微信', icon: 'none' })
    return
  }
  purchasing.value = productId
  buyError.value = ''
  try {
    const code = await wxLogin()
    const orderRes: any = await wx.cloud.callFunction({
      name: 'payApi',
      data: { action: 'createOrder', productId, code },
    })
    const payData = orderRes.result.payData
    const outTradeNo = orderRes.result.outTradeNo
    // 记下单号：轮询超时后还能补查，不用重新买（重新买会重复扣钱）
    try { uni.setStorageSync('lastPayOutTradeNo', outTradeNo) } catch { /* ignore */ }
    pendingOutTradeNo.value = outTradeNo
    await new Promise<void>((resolve, reject) => {
      wx.requestVirtualPayment({
        ...payData,
        success: () => resolve(),
        fail: (err: any) => reject(err),
      })
    })
    const { delivered, queryError } = await pollOrder(outTradeNo)
    await loadQuota()
    if (delivered) {
      pendingOutTradeNo.value = ''
      try { uni.removeStorageSync('lastPayOutTradeNo') } catch { /* ignore */ }
      uni.showToast({ title: '购买成功，额度已到账', icon: 'success' })
    } else {
      if (queryError) {
        buyError.value = `查单失败：${queryError}，请截图这行给我`
      }
      uni.showToast({ title: '支付成功，额度确认中，稍后在额度卡片查看', icon: 'none', duration: 3000 })
      startQuotaSync()
    }
  } catch (e: any) {
    const msg = (e && (e.message || e.errMsg)) || ''
    if (msg.includes('PAY_NOT_CONFIGURED')) {
      buyError.value = '支付服务未配置：请先在 payApi 云函数环境变量里填 VIRTUAL_APP_KEY 与 VIRTUAL_APP_SECRET，填好部署后再买。'
    } else if (msg.includes('UNKNOWN_PRODUCT')) {
      buyError.value = '商品不存在：请确认道具已发布（发布后约 10 分钟才生效）。'
    } else if (msg.includes('CODE2SESSION_FAILED')) {
      buyError.value = '登录态过期，请重新进入本页再买。'
    } else {
      // 购买失败的真正原因必须露出来（否则下次还是没法定位）：
      // requestVirtualPayment 失败带 errCode（如 -15006 签名错、-15014 道具未生效），
      // 云函数未部署则带 FUNCTION_NOT_FOUND；用户取消也会进这里
      const code = (e && (e.errCode ?? e.errcode)) || ''
      const em = (e && (e.errMsg || e.message)) || ''
      buyError.value = `支付失败${code !== '' ? '（错误码 ' + code + '）' : ''}：${em || '未知错误'}，请截图这行给我`
      uni.showToast({ title: '支付未完成', icon: 'none' })
    }
  } finally {
    purchasing.value = ''
  }
}

/** 积分兑换：100 分 = 1 次导入额度（充入积分桶） */
const redeeming = ref(false)
async function onRedeem() {
  if (redeeming.value) return
  const pts = quota.value?.points || 0
  if (pts < 100) {
    uni.showToast({ title: `还差 ${100 - pts} 分（100 分兑 1 次）`, icon: 'none' })
    return
  }
  redeeming.value = true
  try {
    const res: any = await wx.cloud.callFunction({ name: 'importApi', data: { action: 'redeemPoints' } })
    quota.value = res.result.quota as Quota
    uni.showToast({ title: '兑换成功，积分额度 +1', icon: 'success' })
  } catch (e: any) {
    const msg = String((e && (e.errMsg || e.message)) || '')
    uni.showToast({
      title: msg.includes('POINTS_NOT_ENOUGH') ? '积分不足（100 分兑 1 次）' : '兑换失败，请重试',
      icon: 'none',
    })
  } finally {
    redeeming.value = false
  }
}

/** 补查上次订单：已支付但轮询超时没到账时用，不重新下单、不重复扣钱。
 * 查单本身也会触发发货（getOrder 内含查单兜底），所以补查成功就直接到账。 */
async function onRequery() {
  const outTradeNo = pendingOutTradeNo.value
  if (!outTradeNo || requerying.value || purchasing.value) return
  requerying.value = true
  buyError.value = ''
  try {
    const res: any = await wx.cloud.callFunction({
      name: 'payApi',
      data: { action: 'getOrder', outTradeNo },
    })
    const order = res.result && res.result.order
    if (!order) {
      pendingOutTradeNo.value = ''
      try { uni.removeStorageSync('lastPayOutTradeNo') } catch { /* ignore */ }
      uni.showToast({ title: '订单不存在', icon: 'none' })
    } else if (order.status === 'delivered') {
      pendingOutTradeNo.value = ''
      try { uni.removeStorageSync('lastPayOutTradeNo') } catch { /* ignore */ }
      await loadQuota()
      uni.showToast({ title: '补查成功，额度已到账', icon: 'success' })
    } else {
      const qe = res.result && res.result.queryError
      if (qe) buyError.value = `查单失败：${qe}，请截图这行给我`
      uni.showToast({ title: '仍未到账，继续自动同步中', icon: 'none' })
      startQuotaSync()
    }
  } catch (e: any) {
    const msg = (e && (e.message || e.errMsg)) || ''
    buyError.value = `补查失败：${msg || '未知错误'}，请截图这行给我`
  } finally {
    requerying.value = false
  }
}

/** 选文件：仅 txt/md/docx；txt/md 当场数字数校验 */
async function chooseFile() {
  errorMsg.value = ''
  uploaded.value = false
  try {
    const res: any = await uni.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['txt', 'md', 'docx'],
    })
    const picked = res.tempFiles && res.tempFiles[0]
    if (!picked) return
    file.value = { path: picked.path, name: picked.name }
    const ext = picked.name.split('.').pop()?.toLowerCase() ?? ''
    if (ext === 'txt' || ext === 'md') {
      const text = await readTextFile(picked.path)
      charCount.value = text.length
      if (text.length > MAX_CHARS) {
        errorMsg.value = `超出单篇 ${MAX_CHARS} 字上限，请缩短后再传`
      }
    } else {
      charCount.value = null
    }
  } catch {
    // 用户取消选文件时不提示
  }
}

/** 上传到云存储，再调云函数建记录并预扣额度 */
async function upload() {
  if (!file.value || !canUpload.value) return
  errorMsg.value = ''
  uploading.value = true
  uploadProgress.value = 0
  try {
    // 云存储路径只留安全字符：文件名里的空格、中文、括号等直接拼进去可能让上传失败；
    // 展示用的标题和记录里的文件名仍用原始文件名，不受影响
    const safeName = file.value.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const cloudPath = `imports/tmp/${Date.now()}_${safeName}`
    const task: any = wx.cloud.uploadFile({
      cloudPath,
      filePath: file.value.path,
    })
    // 模拟器里 uploadFile 返回的不是带 onProgressUpdate 的任务对象，直接调用会抛错；
    // 有这个方法才接进度，没有就只等结果（任务本身可 await，两种形态都通）
    if (typeof task.onProgressUpdate === 'function') {
      task.onProgressUpdate((p: any) => {
        uploadProgress.value = p.progress || 0
      })
    }
    const upRes: any = await task
    const title = file.value.name.replace(/\.[^.]+$/, '')
    const createRes: any = await wx.cloud.callFunction({
      name: 'importApi',
      data: {
        action: 'create',
        fileID: upRes.fileID,
        fileName: file.value.name,
        title,
      },
    })
    importId.value = createRes.result.id
    uploaded.value = true
    uploadProgress.value = 100
    await loadQuota()
    startPolling()
  } catch (e: any) {
    const msg = (e && e.message) || ''
    if (msg.includes('QUOTA_EXHAUSTED')) {
      errorMsg.value = '额度已用完，请先购买（购买入口在额度卡片下方）'
    } else {
      // 显示真实报错（上传失败还是建记录失败、具体错误码），便于定位
      errorMsg.value = `上传失败：${e?.errMsg || msg || '未知错误'}，请重试`
    }
  } finally {
    uploading.value = false
  }
}

/** 轮询 processImport 推进处理：上一 call 完成后再约 3 秒发下一 call，避免重叠调用重复合成 */
function stopPolling() {
  if (pollTimer) {
    clearTimeout(pollTimer)
    pollTimer = null
  }
}
async function pollOnce() {
  if (!importId.value) return
  try {
    const res: any = await wx.cloud.callFunction({
      name: 'processImport',
      data: { importId: importId.value },
    })
    const r = res.result
    if (r.status === 'done') {
      processStatus.value = 'done'
      processProgress.value = 100
      stopPolling()
    } else if (r.status === 'failed') {
      processStatus.value = 'failed'
      processError.value = r.errorCode || 'PROCESS_ERROR'
      stopPolling()
    } else {
      processProgress.value = r.progressPct || 0
      pollTimer = setTimeout(pollOnce, 3000)
    }
  } catch (e: any) {
    const msg = String((e && (e.errMsg || e.message)) || '')
    // 真没部署：函数不存在（之前所有异常都误报成未部署，修掉）
    if (/not found|FUNCTION_NOT_FOUND|not exist/i.test(msg)) {
      processStatus.value = 'failed'
      processError.value = 'PROCESS_NOT_DEPLOYED'
      processErrorDetail.value = ''
      stopPolling()
      return
    }
    // 瞬时失败（超时/网络抖动/函数内报错）：重试 3 次再判死刑
    pollFailCount += 1
    if (pollFailCount >= 3) {
      processStatus.value = 'failed'
      processError.value = 'PROCESS_CALL_FAILED'
      processErrorDetail.value = msg.slice(0, 200)
      stopPolling()
    } else {
      pollTimer = setTimeout(pollOnce, 3000)
    }
  }
}
function startPolling() {
  stopPolling()
  pollFailCount = 0
  processErrorDetail.value = ''
  processStatus.value = 'processing'
  processProgress.value = 0
  pollOnce()
}

onUnload(() => {
  stopPolling()
  stopQuotaSync()
})

/** 返回列表页（用户再点“我的导入”tab 即可看到新记录） */
function goBack() {
  uni.navigateBack()
}
</script>

<style scoped>
.container {
  padding: 24rpx;
}
.quota-card {
  background-color: #ffffff;
  border-radius: 16rpx;
  padding: 28rpx;
  margin-bottom: 24rpx;
}
.quota-title {
  font-size: 30rpx;
  font-weight: bold;
  margin-bottom: 12rpx;
}
.quota-text {
  font-size: 28rpx;
  color: #333333;
  margin-bottom: 8rpx;
}
.quota-syncing {
  font-size: 24rpx;
  color: #999;
  margin-top: 8rpx;
}
.quota-row {
  display: flex;
  align-items: center;
  gap: 16rpx;
}
.redeem-btn {
  font-size: 24rpx;
  color: #2b1b4d;
  background-color: #ffd60a;
  border-radius: 30rpx;
  padding: 8rpx 24rpx;
  margin: 0;
  line-height: 1.6;
}
.redeem-btn::after {
  border: none;
}
.redeem-btn-disabled {
  background-color: #e0e0e0;
  color: #999;
}
.quota-note {
  font-size: 24rpx;
  color: #999999;
}
.buy-card {
  background-color: #ffffff;
  border-radius: 16rpx;
  padding: 28rpx;
  margin-bottom: 24rpx;
}
.buy-title {
  font-size: 30rpx;
  font-weight: bold;
  margin-bottom: 12rpx;
}
.buy-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16rpx 0;
}
.buy-name {
  font-size: 28rpx;
  font-weight: bold;
}
.buy-desc {
  font-size: 24rpx;
  color: #666666;
  margin-top: 4rpx;
}
.buy-btn {
  width: auto;
  margin: 0;
  padding: 0 28rpx;
  height: 64rpx;
  line-height: 64rpx;
  font-size: 28rpx;
  background-color: #ffd60a;
  color: #2b1b4d;
}
.buy-btn[disabled] {
  background-color: #cccccc;
  color: #ffffff;
}
.buy-note {
  font-size: 24rpx;
  color: #999999;
  margin-top: 8rpx;
}
.buy-error {
  font-size: 26rpx;
  color: #e64340;
  margin-top: 8rpx;
  line-height: 1.5;
}
.requery-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 12rpx;
}
.requery-text {
  font-size: 26rpx;
  color: #999999;
}
.requery-btn {
  font-size: 26rpx;
  color: #7c5cd6;
}
.requery-btn.busy {
  opacity: 0.6;
}
.pick-btn {
  margin-bottom: 24rpx;
}
.file-card {
  background-color: #ffffff;
  border-radius: 16rpx;
  padding: 28rpx;
  margin-bottom: 24rpx;
}
.file-name {
  font-size: 28rpx;
  font-weight: bold;
  margin-bottom: 8rpx;
}
.file-meta {
  font-size: 26rpx;
  color: #666666;
}
.over {
  color: #e64340;
}
.error {
  font-size: 26rpx;
  color: #e64340;
  margin-top: 8rpx;
}
.upload-btn {
  background-color: #007aff;
  color: #ffffff;
}
.upload-btn[disabled] {
  background-color: #cccccc;
  color: #ffffff;
}
.success {
  background-color: #ffffff;
  border-radius: 16rpx;
  padding: 28rpx;
  margin-top: 24rpx;
}
.success-title {
  font-size: 30rpx;
  font-weight: bold;
  margin-bottom: 12rpx;
}
.success-desc {
  font-size: 26rpx;
  color: #666666;
  line-height: 1.6;
  margin-bottom: 20rpx;
}
.back-btn {
  font-size: 28rpx;
}
</style>
