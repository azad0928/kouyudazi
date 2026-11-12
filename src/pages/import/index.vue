<template>
  <view class="container">
    <view class="import-intro"><view class="intro-title"><text class="hero-line">YOUR WORDS.</text><text class="hero-line">YOUR NEXT LISTEN.</text></view><text class="intro-desc">Bring an English article. We will turn it into a listening lesson.</text><text class="intro-note">TXT, Markdown, DOCX or text-based PDF. Your lesson will appear in My Library.</text></view>
<view class="import-steps"><text :class="{current:!file}">1 <text>Choose</text></text><view/><text :class="{current:file && !uploaded}">2 <text>Preview</text></text><view/><text :class="{current:uploaded}">3 <text>Listen</text></text></view>
    <!-- 选文件 -->
    <button class="pick-btn" @click="chooseFile">{{file?'Change file':'＋ Choose an article'}}</button>

    <view v-if="file" class="file-card">
      <view class="file-name">{{ file.name }}</view>
      <view v-if="charCount !== null" class="file-meta">
        {{ charCount }} characters
        <text v-if="charCount > MAX_CHARS" class="over"> (over the 5,000-character limit)</text>
      </view>
      <view v-else class="file-meta">DOCX and PDF limits are checked during processing. Failed imports restore your credit.</view>
      <view v-if="previewText" class="preview"><text>ARTICLE PREVIEW</text><text>{{previewText}}</text></view>
    </view>

    <view v-if="errorMsg" class="error">{{errorMsg}}<text @click="loadQuota"> · Retry</text></view>
<view class="credit-summary" @click="creditsOpen=!creditsOpen"><view><text class="credit-label">IMPORT CREDITS</text><text>{{creditSummary}}</text></view><text class="manage-link">{{creditsOpen?'Close':'Manage'}} ›</text></view><view v-if="quotaSyncing && !creditsOpen" class="quota-syncing">Payment received. Updating your credits…</view><view v-if="creditsOpen" class="credit-details">    <!-- 额度卡片（M3：免费 + 单次 + 会员；扣次顺序：包月 → 免费 → 单次） -->
    <view class="quota-card">
      <view class="quota-title">YOUR IMPORT CREDITS</view>
      <view class="quota-text">
        <template v-if="quota">
          {{ Math.max(0, quota.freeTotal - quota.freeUsed) }} of {{ quota.freeTotal }} free credits left
        </template>
        <template v-else>Loading your credits…</template>
      </view>
      <view v-if="quota && quota.singleRemaining > 0" class="quota-text">
        {{ quota.singleRemaining }} single credits
      </view>
      <view v-if="quota && quota.pointsRemaining > 0" class="quota-text">
        {{ quota.pointsRemaining }} redeemed credits
      </view>
      <view v-if="membershipText" class="quota-text">{{ membershipText }}</view>
      <view v-if="quota" class="quota-row">
        <text class="quota-text">{{ quota.points || 0 }} points · 100 points per credit</text>
        <button v-if="!redeeming" class="redeem-btn" :class="{ 'redeem-btn-disabled': (quota.points || 0) < 100 }" @click="onRedeem">Redeem</button>
        <text v-if="redeeming" class="quota-text">Redeeming…</text>
      </view>
      <view v-if="quotaSyncing" class="quota-syncing">Payment received. Updating your credits…</view>
      <view class="quota-note">Up to 5,000 characters. Monthly credits are used first, then free, points and single credits.</view>
    </view>

    <!-- Get credits额度（M3：微信虚拟支付；价格以后台道具为准） -->
    <view class="buy-card">
      <view class="buy-title">Need more room?</view>
      <view v-if="isLifetime" class="buy-note">Your unlimited plan has you covered.</view>
      <template v-else>
        <view v-for="p in products" :key="p.id" class="buy-row">
          <view class="buy-info">
            <view class="buy-name">{{ p.name }} {{ p.price }}</view>
            <view class="buy-desc">{{ p.desc }}</view>
          </view>
          <button class="buy-btn" :disabled="!!purchasing" @click="buy(p.id)">
            {{ purchasing === p.id ? 'Processing…' : 'Get credits' }}
          </button>
        </view>
        <view class="buy-note">Credits appear after payment is confirmed. Monthly plans last 30 days.</view>
      </template>
      <view v-if="buyError" class="buy-error">{{ buyError }}</view>
      <view v-if="pendingOutTradeNo && !purchasing" class="requery-row">
        <text class="requery-text">Waiting for your last order?</text>
        <text class="requery-btn" :class="{ busy: requerying }" @click="onRequery">Check again</text>
      </view>
    </view>
</view>
    <!-- 上传 -->
    <button
      v-if="file && !uploaded" class="upload-btn"
      :disabled="!canUpload || uploading"
      @click="upload"
    >
      {{ uploading ? (uploadProgress > 0 ? `Uploading ${uploadProgress}%` : 'Uploading…') : 'Create my lesson' }}
    </button>

    <!-- 成功态：上传后自动轮询处理进度 -->
    <view v-if="uploaded" class="success">
      <view class="success-title">
        {{ processStatus === 'done' ? 'Your lesson is ready.' : processStatus === 'failed' ? 'Unable to create this lesson' : 'Making it yours…' }}
      </view>
      <view v-if="processStatus === 'processing'" class="success-desc">
        {{ processProgress }}% ready. Creating your audio and vocabulary. You can return to My Library later.
      </view>
      <view v-else-if="processStatus === 'failed'" class="success-desc">{{ processErrorText }}</view>
      <view v-else-if="processStatus === 'done'" class="success-desc">
        Your audio is ready. Settle in and press play.
      </view>
      <button v-if="processStatus==='done' && completedLessonId" class="learn-btn" @click="learnNow">Start listening ▶</button>
      <button class="back-btn" @click="goBack">Back to My Library</button>
    </view>

  </view>
</template>

<script setup lang="ts">
import { requestId } from '@/utils/api';
import { ref, computed } from 'vue';
import { onShow, onHide, onUnload, onPullDownRefresh } from '@dcloudio/uni-app';
const creditsOpen = ref(false);
const creditSummary = computed(()=>{const q=quota.value;if(!q)return 'Loading your credits…';if(isLifetime.value)return 'Unlimited imports';const monthly=q.membership?.type==='monthly' && (q.membership.expiresAt || 0)>Date.now()?(q.monthlyRemaining || 0):0;const count=Math.max(0,q.freeTotal-q.freeUsed)+(q.singleRemaining||0)+(q.pointsRemaining||0)+monthly;return count+' '+(count===1?'credit':'credits')+' available';});
const previewText = ref(''),
  uploadNamespace = ref(''),
  completedLessonId = ref('');
let createRequestId = requestId(),
  redeemRequestId = '',
  pollVersion = 0,
  pageVisible = true;
function learnNow() {
  if (completedLessonId.value) uni.navigateTo({
    url: '/pages/lesson/detail?id=' + encodeURIComponent(completedLessonId.value)
  });
}
const MAX_CHARS = 5000;
// 上传体积上限：PDF 常内嵌大图，云端用 pdf.js 解析既慢又吃内存（云函数内存有限），
// 太大直接在本机拦掉，比传到云端再失败体验好。纯文字 PDF 一般远小于 10MB
const MAX_FILE_MB = 10;
const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;
interface Quota {
  freeTotal: number;
  freeUsed: number;
  singleRemaining: number;
  pointsRemaining: number;
  points: number;
  membership: {
    type: string;
    expiresAt?: number;
  } | null;
  monthlyRemaining: number | null;
}

/** 可Get credits的道具（价格以后台道具为准，这里只做展示；下单价格由云函数服务端定） */
const products = [{
  id: 'singleimport',
  name: 'Single import',
  desc: 'One extra lesson, whenever you need it.',
  price: '¥3'
}, {
  id: 'member30day',
  name: 'Monthly pass',
  desc: '30 imports. 30 days. Your pace.',
  price: '¥9'
}, {
  id: 'unlimitedmember',
  name: 'Unlimited pass',
  desc: 'Unlimited imports, for life.',
  price: '¥59'
}];
const isLifetime = computed(() => quota.value?.membership?.type === 'lifetime');

/** 会员状态文案（终身 / 包月剩余次数与到期日 / 已过期） */
const membershipText = computed(() => {
  const m = quota.value?.membership;
  if (!m) return '';
  if (m.type === 'lifetime') return 'Lifetime unlimited pass';
  if (m.type === 'monthly') {
    if (m.expiresAt && m.expiresAt > Date.now()) {
      const d = new Date(m.expiresAt);
      const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      return `Monthly pass: ${quota.value?.monthlyRemaining ?? 0} left, until ${date}`;
    }
    return 'Your monthly pass has expired';
  }
  return '';
});
const purchasing = ref('');
const buyError = ref('');
// 上次未确认到账的订单号（本地存着，页面重进还在；到账后清除）
// 补查只查本机下过的单，不会跨设备串单
const pendingOutTradeNo = ref('');
const requerying = ref(false);
try {
  pendingOutTradeNo.value = uni.getStorageSync('lastPayOutTradeNo') || '';
} catch {/* 存储不可用时补查入口直接不显示 */}
const quota = ref<Quota | null>(null);
const file = ref<{
  path: string;
  name: string;
} | null>(null);
const charCount = ref<number | null>(null);
const errorMsg = ref('');
const uploading = ref(false);
const uploadProgress = ref(0);
const uploaded = ref(false);
// 处理轮询状态（M2：上传后自动推进 processImport）
const importId = ref('');
const processStatus = ref<'idle' | 'processing' | 'done' | 'failed'>('idle');
const processProgress = ref(0);
const processError = ref('');
const processErrorDetail = ref(''); // 调用云函数抛错时的真实 errMsg（误诊修复用）
let pollTimer: any = null;
let pollFailCount = 0; // 连续调用失败计数（误诊修复：瞬时失败先Retry）

/** 失败原因文案（面向用户：不出现云函数名、环境变量名、错误码等内部Inbox；
 *  原始错误统一 console.warn 留档，排查时过滤 [pay]/[import] 即可） */
const processErrorText = computed(() => {
  if (processError.value === 'TTS_NOT_CONFIGURED') {
    return 'Audio service unavailable. Your credit has been restored.';
  }
  if (processError.value === 'OVER_LIMIT') return 'Over the 5,000-character limit. Your credit has been restored.';
  if (processError.value === 'CONTENT_RISK') return 'This content could not be accepted. Your credit has been restored.';
  if (processError.value === 'PDF_NO_TEXT') {
    return 'No readable text found. Try a text-based PDF. Your credit has been restored.';
  }
  if (processError.value === 'PDF_PARSE_FAILED') {
    return 'Unable to read this PDF. Try an unlocked, valid file. Your credit has been restored.';
  }
  if (processError.value === 'TTS_MIXED_SAMPLE_RATES') {
    return 'Audio creation failed. Your credit has been restored. Retry to generate a new recording.';
  }
  if (processError.value === 'EMPTY_CONTENT') return 'No article text found. Try a different file. Your credit has been restored.';
  if (processError.value === 'PROCESS_NOT_DEPLOYED') {
    return 'Service unavailable. Your credit has been restored. Please try later.';
  }
  if (processError.value === 'PROCESS_CALL_FAILED') {
    return 'Import failed. Your credit has been restored. Retry from My Library.';
  }
  return 'Import failed. Your credit has been restored. Retry from My Library.';
});

/** 能否上传：已选文件、无字数超限、未在上传中，且任一额度可用
 *（终身直接可用；包月看剩余次数；免费/单次看剩余；服务端 pickAndDeduct 是最终校验） */
const canUpload = computed(() => {
  if (!file.value || uploading.value || uploaded.value) return false;
  if (charCount.value !== null && charCount.value > MAX_CHARS) return false;
  if (!quota.value) return false;
  if (quota.value.membership && quota.value.membership.type === 'lifetime') return true;
  if ((quota.value.monthlyRemaining ?? 0) > 0) return true;
  if (quota.value.freeUsed < quota.value.freeTotal) return true;
  if ((quota.value.pointsRemaining ?? 0) > 0) return true;
  if (quota.value.singleRemaining > 0) return true;
  return false;
});

/** 读 txt/md 文本（FileSystemManager 只支持回调，这里包一层 Promise） */
function readTextFile(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    uni.getFileSystemManager().readFile({
      filePath: path,
      encoding: 'utf8',
      success: (res: any) => resolve(res.data as string),
      fail: (err: any) => reject(err)
    });
  });
}

/** 拉额度 */
async function loadQuota() {
  try {
    const res: any = await wx.cloud.callFunction({
      name: 'importApi',
      data: {
        action: 'getQuota'
      }
    });
    quota.value = res.result.quota as Quota;
    uploadNamespace.value = res.result.uploadNamespace || uploadNamespace.value;
    errorMsg.value = '';
  } catch (e: any) {
    // 把真实报错露出来（未部署时是 function not found 之类），便于Follow
    logInternal('import', e);
    errorMsg.value = 'Unable to load credits. Pull down to try again.';
  }
}

// Get credits后额度同步：支付成功但 30 秒轮询未确认发货时（靠推送/定时扫单发货），
// 卡片会一直显示旧额度直到下次进页面；这里静默重拉配额直到额度变化或超时
const quotaSyncing = ref(false);
let quotaSyncTimer: any = null;
let quotaSyncBaseline = '';
let quotaSyncDeadline = 0;
function quotaFingerprint(q: any): string {
  if (!q) return '';
  return JSON.stringify({
    s: q.singleRemaining || 0,
    ps: q.pointsRemaining || 0,
    pb: q.points || 0,
    mt: q.membership && q.membership.type || '',
    me: q.membership && q.membership.expiresAt || 0,
    mr: q.monthlyRemaining ?? null
  });
}
function stopQuotaSync() {
  quotaSyncing.value = false;
  if (quotaSyncTimer) {
    clearInterval(quotaSyncTimer);
    quotaSyncTimer = null;
  }
}
async function startQuotaSync() {
  stopQuotaSync();
  if (!quota.value) return;
  quotaSyncBaseline = quotaFingerprint(quota.value);
  quotaSyncDeadline = Date.now() + 10 * 60 * 1000;
  quotaSyncing.value = true;
  quotaSyncTimer = setInterval(async () => {
    try {
      if (Date.now() > quotaSyncDeadline) {
        stopQuotaSync();
        return;
      }
      const res: any = await wx.cloud.callFunction({
        name: 'importApi',
        data: {
          action: 'getQuota'
        }
      });
      const q = res.result && res.result.quota;
      if (q && quotaFingerprint(q) !== quotaSyncBaseline) {
        stopQuotaSync();
        quota.value = q as Quota;
        pendingOutTradeNo.value = '';
        try {
          uni.removeStorageSync('lastPayOutTradeNo');
        } catch {
          /* ignore */
        }
        uni.showToast({
          title: 'Credits added',
          icon: 'success'
        });
      }
    } catch {
      /* 静默Retry，下一次 tick 继续 */
    }
  }, 15000);
}
onShow(() => {
  pageVisible = true;
  loadQuota();
  if (uploaded.value && processStatus.value === 'processing') startPolling();
});
onPullDownRefresh(async () => {
  await loadQuota();
  uni.stopPullDownRefresh();
});
onHide(() => {
  pageVisible = false;
  stopPolling();
  stopQuotaSync();
});

/** iOS 支付要求微信 8.0.68+；不满足时不让下单（文档示例逻辑） */
function iosPayAllowed(): boolean {
  try {
    const sys: any = wx.getSystemInfoSync();
    if (sys.platform !== 'ios') return true;
    const parts = String(sys.version || '').split('.').map((x: string) => parseInt(x, 10) || 0);
    const need = [8, 0, 68];
    for (let i = 0; i < 3; i++) {
      if ((parts[i] || 0) > need[i]) return true;
      if ((parts[i] || 0) < need[i]) return false;
    }
    return true;
  } catch {
    return true;
  }
}

/** wx.login 取 code（供云函数换 sessionKey 做用户态签名） */
function wxLogin(): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (res: any) => res.code ? resolve(res.code) : reject(new Error('no code')),
      fail: (err: any) => reject(err)
    });
  });
}

/** 支付后轮询查单：发货推送是主路径，查单是兜底；30 秒内未确认则让用户稍后查看 */
/** 轮询查单：返回是否已发货 + 最后一次查单失败原因（用于超时后红字展示） */
async function pollOrder(outTradeNo: string): Promise<{
  delivered: boolean;
  queryError: string;
}> {
  let lastQueryError = '';
  for (let i = 0; i < 15; i++) {
    try {
      const res: any = await wx.cloud.callFunction({
        name: 'payApi',
        data: {
          action: 'getOrder',
          outTradeNo
        }
      });
      if (res.result && res.result.order && res.result.order.status === 'delivered') {
        return {
          delivered: true,
          queryError: ''
        };
      }
      if (res.result && res.result.queryError) lastQueryError = res.result.queryError;
    } catch {
      // 查单失败不中断轮询（推送可能随后到）
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  return {
    delivered: false,
    queryError: lastQueryError
  };
}

/**
 * 内部错误明细只写控制台，不上屏。
 * 正式版给用户看的是人话；排查时在开发者工具 console 过滤 [pay] / [import] 拿原始Inbox。
 */
function logInternal(tag: string, e: any) {
  const code = (e && (e.errCode ?? e.errcode)) ?? '';
  const msg = e && (e.errMsg || e.message) || '';
  console.warn(`[${tag}]`, code, msg);
}

/** 用户主动Cancel支付：各端 errCode 与文案不统一，统一兜底判断 */
function isPayCancel(e: any): boolean {
  const code = e && (e.errCode ?? e.errcode);
  if (code === -2) return true;
  const msg = String(e && (e.errMsg || e.message) || '');
  return /cancel/i.test(msg) || msg.indexOf('Cancel') >= 0;
}

/** Get credits：下单签名 → 拉起虚拟支付 → 轮询确认发货（前端成功回调不作为发货依据） */
async function buy(productId: string) {
  if (purchasing.value) return;
  if (!iosPayAllowed()) {
    uni.showModal({
      title: 'Update WeChat',
      content: 'Update WeChat to continue with payment.',
      showCancel: false
    });
    return;
  }
  if (typeof wx.canIUse === 'function' && !wx.canIUse('requestVirtualPayment')) {
    uni.showToast({
      title: 'Update WeChat to use this payment method.',
      icon: 'none'
    });
    return;
  }
  purchasing.value = productId;
  buyError.value = '';
  try {
    const code = await wxLogin();
    const orderRes: any = await wx.cloud.callFunction({
      name: 'payApi',
      data: {
        action: 'createOrder',
        productId,
        code
      }
    });
    const payData = orderRes.result.payData;
    const outTradeNo = orderRes.result.outTradeNo;
    // 记下单号：轮询超时后还能补查，不用重新买（重新买会重复扣钱）
    try {
      uni.setStorageSync('lastPayOutTradeNo', outTradeNo);
    } catch {/* ignore */}
    pendingOutTradeNo.value = outTradeNo;
    await new Promise<void>((resolve, reject) => {
      wx.requestVirtualPayment({
        ...payData,
        success: () => resolve(),
        fail: (err: any) => reject(err)
      });
    });
    const {
      delivered,
      queryError
    } = await pollOrder(outTradeNo);
    await loadQuota();
    if (delivered) {
      pendingOutTradeNo.value = '';
      try {
        uni.removeStorageSync('lastPayOutTradeNo');
      } catch {/* ignore */}
      uni.showToast({
        title: 'Your credits are ready',
        icon: 'success'
      });
    } else {
      if (queryError) console.warn('[pay] 查单未确认', queryError);
      uni.showToast({
        title: 'Payment received. Confirming your credits…',
        icon: 'none',
        duration: 3000
      });
      startQuotaSync();
    }
  } catch (e: any) {
    const msg = e && (e.message || e.errMsg) || '';
    logInternal('pay', e);
    // 用户点了Cancel：不算失败，更不把错误码/errMsg 甩到界面上；
    // 顺手清掉待补查单号，否则页面会一直挂着「已付款未到账？点这里补查」的入口
    if (isPayCancel(e)) {
      buyError.value = '';
      pendingOutTradeNo.value = '';
      try {
        uni.removeStorageSync('lastPayOutTradeNo');
      } catch {/* ignore */}
      uni.showToast({
        title: 'Payment cancelled',
        icon: 'none'
      });
    } else if (msg.includes('PAY_NOT_CONFIGURED')) {
      buyError.value = 'Payment unavailable. Please try later.';
    } else if (msg.includes('UNKNOWN_PRODUCT')) {
      buyError.value = 'This plan is unavailable. Please try later.';
    } else if (msg.includes('CODE2SESSION_FAILED')) {
      buyError.value = 'Your session expired. Reopen this page to continue.';
    } else {
      buyError.value = 'Payment incomplete. Please try again.';
      uni.showToast({
        title: 'Payment incomplete',
        icon: 'none'
      });
    }
  } finally {
    purchasing.value = '';
  }
}

/** 积分Redeem：100 分 = 1 次YOUR IMPORT CREDITS（充入积分桶） */
const redeeming = ref(false);
async function onRedeem() {
  if (redeeming.value) return;
  const pts = quota.value?.points || 0;
  if (pts < 100) {
    uni.showToast({
      title: `You need ${100 - pts} more points.`,
      icon: 'none'
    });
    return;
  }
  redeeming.value = true;
  try {
    const res: any = await wx.cloud.callFunction({
      name: 'importApi',
      data: {
        action: 'redeemPoints',
        requestId: redeemRequestId || (redeemRequestId = requestId())
      }
    });
    quota.value = res.result.quota as Quota;
    uploadNamespace.value = res.result.uploadNamespace || uploadNamespace.value;
    errorMsg.value = '';
    redeemRequestId = '';
    uni.showToast({
      title: 'Redeemed. One credit added.',
      icon: 'success'
    });
  } catch (e: any) {
    const msg = String(e && (e.errMsg || e.message) || '');
    uni.showToast({
      title: msg.includes('POINTS_NOT_ENOUGH') ? 'You need 100 points to redeem a credit.' : 'Unable to redeem. Please try again.',
      icon: 'none'
    });
  } finally {
    redeeming.value = false;
  }
}

/** 补查上次订单：已支付但轮询超时没到账时用，不重新下单、不重复扣钱。
 * 查单本身也会触发发货（getOrder 内含查单兜底），所以补查成功就直接到账。 */
async function onRequery() {
  const outTradeNo = pendingOutTradeNo.value;
  if (!outTradeNo || requerying.value || purchasing.value) return;
  requerying.value = true;
  buyError.value = '';
  try {
    const res: any = await wx.cloud.callFunction({
      name: 'payApi',
      data: {
        action: 'getOrder',
        outTradeNo
      }
    });
    const order = res.result && res.result.order;
    if (!order) {
      pendingOutTradeNo.value = '';
      try {
        uni.removeStorageSync('lastPayOutTradeNo');
      } catch {/* ignore */}
      uni.showToast({
        title: 'Order not found',
        icon: 'none'
      });
    } else if (order.status === 'delivered') {
      pendingOutTradeNo.value = '';
      try {
        uni.removeStorageSync('lastPayOutTradeNo');
      } catch {/* ignore */}
      await loadQuota();
      uni.showToast({
        title: 'Order confirmed. Credits added.',
        icon: 'success'
      });
    } else {
      const qe = res.result && res.result.queryError;
      if (qe) console.warn('[pay] 查单未确认', qe);
      uni.showToast({
        title: 'Still confirming. We will keep checking.',
        icon: 'none'
      });
      startQuotaSync();
    }
  } catch (e: any) {
    logInternal('pay', e);
    buyError.value = 'Order status unavailable. Check your credits later.';
  } finally {
    requerying.value = false;
  }
}

/** 选文件：仅 txt/md/docx/pdf；txt/md 当场数字数校验，docx/pdf 由云端解析后校验 */
async function chooseFile() {
  errorMsg.value = '';
  uploaded.value = false;
  previewText.value = '';
  createRequestId = requestId();
  try {
    const res: any = await uni.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['txt', 'md', 'docx', 'pdf']
    });
    const picked = res.tempFiles && res.tempFiles[0];
    if (!picked) return;
    // PDF 常带大图，超大文件在云端解析既慢又吃内存，先在本机拦掉
    if (picked.size && picked.size > MAX_FILE_BYTES) {
      file.value = null;
      charCount.value = null;
      errorMsg.value = `File exceeds ${MAX_FILE_MB} MB. Choose a smaller file.`;
      return;
    }
    file.value = {
      path: picked.path,
      name: picked.name
    };
    const ext = picked.name.split('.').pop()?.toLowerCase() ?? '';
    if (ext === 'txt' || ext === 'md') {
      const text = await readTextFile(picked.path);
      charCount.value = text.length;
      previewText.value = text.slice(0, 650);
      if (text.length > MAX_CHARS) {
        errorMsg.value = `Article exceeds ${MAX_CHARS} characters. Shorten it and try again.`;
      }
    } else {
      charCount.value = null;
    }
  } catch {
    // 用户Cancel选文件时不提示
  }
}

/** 上传到云存储，再调云函数建记录并预扣额度 */
async function upload() {
  if (!file.value || !canUpload.value || uploading.value) return;
  if (!uploadNamespace.value) {
    errorMsg.value = 'Import service unavailable. Please contact support.';
    return;
  }
  errorMsg.value = '';
  uploading.value = true;
  uploadProgress.value = 0;
  try {
    // 云存储路径只留安全字符：文件名里的空格、中文、括号等直接拼进去可能让上传失败；
    // 展示用的标题和记录里的文件名仍用原始文件名，不受影响
    const safeName = file.value.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const cloudPath = `imports/source/${uploadNamespace.value}/${createRequestId}_${safeName}`;
    const task: any = wx.cloud.uploadFile({
      cloudPath,
      filePath: file.value.path
    });
    // 模拟器里 uploadFile 返回的不是带 onProgressUpdate 的任务对象，直接调用会抛错；
    // 有这个方法才接进度，没有就只等结果（任务本身可 await，两种形态都通）
    if (typeof task.onProgressUpdate === 'function') {
      task.onProgressUpdate((p: any) => {
        uploadProgress.value = p.progress || 0;
      });
    }
    const upRes: any = await task;
    const title = file.value.name.replace(/\.[^.]+$/, '');
    const createRes: any = await wx.cloud.callFunction({
      name: 'importApi',
      data: {
        action: 'create',
        requestId: createRequestId,
        fileID: upRes.fileID,
        fileName: file.value.name,
        title
      }
    });
    importId.value = createRes.result.id;
    uploaded.value = true;
    uploadProgress.value = 100;
    await loadQuota();
    startPolling();
  } catch (e: any) {
    const msg = e && e.message || '';
    logInternal('import', e);
    if (msg.includes('QUOTA_EXHAUSTED')) {
      errorMsg.value = 'You need more credits to create this lesson.';
    } else {
      errorMsg.value = 'Unable to upload. Try again.。';
    }
  } finally {
    uploading.value = false;
  }
}

/** 轮询 processImport 推进处理：上一 call 完成后再约 0.8 秒发下一 call
 *（原来是 3 秒：每轮之间白等 3 秒，一篇 7 轮就浪费 20 秒）。
 * 仍必须等上一轮返回再发：云函数内部有并发预算，重叠调用只会重复合成。 */
function stopPolling() {
  pollVersion++;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}
async function pollOnce() {
  if (!importId.value || !pageVisible) return;
  const version = pollVersion;
  try {
    const res: any = await wx.cloud.callFunction({
      name: 'processImport',
      data: {
        importId: importId.value
      }
    });
    if (version !== pollVersion || !pageVisible) return;
    pollFailCount = 0;
    const r = res.result;
    if (r.status === 'done') {
      completedLessonId.value = r.lessonId || '';
      processStatus.value = 'done';
      processProgress.value = 100;
      stopPolling();
    } else if (r.status === 'failed') {
      processStatus.value = 'failed';
      processError.value = r.errorCode || 'PROCESS_ERROR';
      stopPolling();
    } else {
      processProgress.value = r.progressPct || 0;
      pollTimer = setTimeout(pollOnce, 2500);
    }
  } catch (e: any) {
    if (version !== pollVersion || !pageVisible) return;
    const msg = String(e && (e.errMsg || e.message) || '');
    // 真没部署：函数不存在（之前所有异常都误报成未部署，修掉）
    if (/not found|FUNCTION_NOT_FOUND|not exist/i.test(msg)) {
      processStatus.value = 'failed';
      processError.value = 'PROCESS_NOT_DEPLOYED';
      processErrorDetail.value = '';
      stopPolling();
      return;
    }
    // 瞬时失败（超时/网络抖动/函数内报错）：Retry 3 次再判死刑
    pollFailCount += 1;
    if (pollFailCount >= 3) {
      processStatus.value = 'failed';
      processError.value = 'PROCESS_CALL_FAILED';
      processErrorDetail.value = msg.slice(0, 200);
      stopPolling();
    } else {
      pollTimer = setTimeout(pollOnce, 2500);
    }
  }
}
function startPolling() {
  stopPolling();
  pollFailCount = 0;
  processErrorDetail.value = '';
  processStatus.value = 'processing';
  processProgress.value = 0;
  pollOnce();
}
onUnload(() => {
  pageVisible = false;
  stopPolling();
  stopQuotaSync();
});

/** 返回列表页（用户再点“My Library”tab 即可看到新记录） */
function goBack() {
  uni.navigateBack();
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
  color: #281247;
  background-color: #ffcf00;
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
  background-color: #ffcf00;
  color: #281247;
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
  color: #f5f3f8;
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
  background-color: #f5f3f8;
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
<style scoped>.container{padding:24rpx 28rpx 60rpx;background:#f7f6f9}.import-intro{margin:10rpx 0 30rpx}.intro-title{display:block;font-size:39rpx;font-weight:700;color:#281247}.intro-desc{display:block;font-size:26rpx;color:#77877b;margin:20rpx 0}.intro-note{display:block;font-size:23rpx;color:#77877b;line-height:1.7}.quota-card,.buy-card{border-radius:24rpx;padding:26rpx;box-shadow:none;border:1rpx solid #ece4f3}.quota-title,.buy-title{color:#281247;font-size:29rpx}.quota-text,.quota-note,.buy-note{color:#77877b}.pick-btn,.upload-btn,.learn-btn{border-radius:20rpx;font-size:29rpx;background:#ffcf00;color:#281247;margin:24rpx 0}.pick-btn{background:#fff;border:2rpx dashed #f5f3f8;color:#77877b;padding:25rpx 0}.learn-btn::after{border:0}.buy-card{margin-top:40rpx}.buy-btn{font-size:25rpx;background:#f2e8f8;color:#77877b}.preview{display:flex;flex-direction:column;gap:16rpx;font-size:25rpx;color:#77877b;line-height:1.8;padding-top:22rpx;max-height:380rpx;overflow:hidden}.preview text:first-child{font-size:23rpx;color:#77877b}.success{border-radius:24rpx}.error{padding:20rpx 8rpx;color:#77877b;font-size:26rpx}.error text{font-weight:600}.quota-row{align-items:center}</style>
<style scoped>
.container,.settings,.history{background:#ffffff;min-height:100vh;padding:30rpx 30rpx 80rpx}.intro-title,.title{font-family:inherit;color:#281247;font-size:49rpx;font-weight:700;letter-spacing:-1.5rpx;line-height:1.12;white-space:pre-line}.intro-desc,.intro-note{color:#8c9b7e;font-size:24rpx;line-height:1.65}.card,.quota-card,.buy-card,.file-card,.import-record,.menu,.balance{background:#fff;border:1rpx solid #e5e2ec;border-radius:21rpx;box-shadow:none;padding:27rpx}.heading,.quota-title,.buy-title{font-size:28rpx;font-weight:650;letter-spacing:-.4rpx;color:#3b5634}.sec{font-size:19rpx;letter-spacing:1.4rpx;color:#93a182}.note,.quota-note,.buy-note,.step,.quota-text,.meta,.sync{font-size:23rpx;line-height:1.7;color:#8a9c77}.row,.item{font-size:25rpx;color:#5b754b;border-color:#edf1e5;min-height:94rpx}.step text:first-child{color:#4f703e}.primary,.pick-btn,.upload-btn,.save-btn,.back,.learn-btn{background:#281247;color:#fff;border-radius:15rpx;font-size:25rpx;padding:24rpx;font-family:inherit}.feedback,.back-btn,.redeem-btn,.buy-btn{background:#fff4c2;color:#5a7641;border-radius:14rpx;font-size:24rpx}.empty{background:#f0f4e6;color:#8c9d7b;border-radius:21rpx;font-size:25rpx;line-height:1.7;padding:60rpx 28rpx}.name,.record-title{font-family:inherit;font-size:30rpx;color:#3f5c35;font-weight:600;line-height:1.4}.nick-input,.search{background:#fff;border:1rpx solid #dde7d1;border-radius:15rpx;font-size:26rpx;padding:23rpx}.count-row,.stats{font-size:23rpx;color:#8a9b79}.filters .active,.active{color:#496939}.track{background:#f4f1f8}.track view{background:#f2ca26}.version{color:#a7b298;font-size:18rpx;letter-spacing:2rpx}.preview{background:#f5f7ef;border-radius:14rpx;color:#80956b}.import-intro{margin:5rpx 0 32rpx}.intro-note{font-size:21rpx;color:#a1ad93}.balance-num{color:#46653a}.unit{font-size:22rpx}.buy-name{font-size:27rpx;color:#4f6d3f}.buy-desc{font-size:22rpx;color:#92a37e}
</style>

<style scoped>.hero-line{display:block}</style>

<style scoped>
.container{padding:30rpx 30rpx 80rpx;background:#fff}.import-intro{margin:10rpx 0 30rpx}.intro-title{font-family:ListHeading,sans-serif;font-size:58rpx;color:#281247;line-height:1}.intro-desc{display:block;color:#81758e;font-size:25rpx;margin-top:20rpx}.intro-note{display:block;color:#a093ac;font-size:21rpx;margin-top:12rpx}.import-steps{display:flex;align-items:center;gap:14rpx;margin:34rpx 0;color:#ada2b7;font-size:23rpx}.import-steps>view{height:1rpx;background:#e8e0ef;flex:1}.import-steps>text.current{color:#281247;font-weight:700}.import-steps text text{margin-left:8rpx}.pick-btn{background:#faf8fc;color:#281247;border:2rpx dashed #dcd0e6;padding:40rpx 20rpx;border-radius:20rpx;font-size:27rpx;margin-bottom:24rpx}.pick-btn::after{border:0}.file-card{padding:26rpx;border:1rpx solid #e7deed;border-radius:20rpx;background:#fff}.file-name{font-size:28rpx;color:#281247;font-weight:600}.file-meta{color:#94859f;font-size:22rpx;margin-top:10rpx}.preview{background:#faf8fc;padding:24rpx;border-radius:14rpx;margin-top:24rpx;max-height:430rpx;overflow:auto}.preview>text:first-child{display:block;color:#aa9bb6;font-size:18rpx;letter-spacing:2rpx;margin-bottom:15rpx}.preview>text:last-child{color:#68606f;font-size:26rpx;line-height:1.85}.credit-summary{display:flex;align-items:center;justify-content:space-between;padding:27rpx 0;margin:20rpx 0;border-top:1rpx solid #eee8f2;border-bottom:1rpx solid #eee8f2;font-size:25rpx;color:#554361}.credit-summary>view>text{display:block}.credit-label{font-size:17rpx;color:#a495af;letter-spacing:1.5rpx;margin-bottom:8rpx}.manage-link{font-size:23rpx;color:#281247}.credit-details{background:#faf8fc;padding:12rpx;border-radius:20rpx}.credit-details .quota-card,.credit-details .buy-card{margin:12rpx 0;border-color:#e8e0ee}.upload-btn{position:sticky;bottom:calc(18rpx + env(safe-area-inset-bottom));background:#281247;color:#fff;padding:25rpx;font-size:27rpx;border-radius:17rpx;margin-top:26rpx;box-shadow:0 0 0 14rpx #fff;z-index:5}.upload-btn[disabled]{background:#ece6f1;color:#a89ab3}.success{border:1rpx solid #d7e8dc;background:#f3faf5;border-radius:20rpx;padding:30rpx}.success-title{font-family:ListHeading,sans-serif;font-size:40rpx;color:#246b3f}.success-desc{color:#718879;font-size:25rpx;line-height:1.7}
</style>
