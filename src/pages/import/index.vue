<template>
  <view class="container">
    <view class="import-intro"><text class="intro-title">把文章变成听力课</text><view class="intro-desc"><text>导入你感兴趣的英文内容，</text><text>听读、跟读一起练。</text></view></view>
    <view class="import-steps"><view class="step" :class="{current:!file,complete:!!file}"><text class="step-number">1</text><text>选择文章</text></view><view class="step-connector"/><view class="step" :class="{current:file && !uploaded,complete:uploaded}"><text class="step-number">2</text><text>预览内容</text></view><view class="step-connector"/><view class="step" :class="{current:uploaded}"><text class="step-number">3</text><text>生成课程</text></view></view>
    <view v-if="!uploaded" class="upload-card" :class="{'has-file':file}">
      <view v-if="!file" class="file-intro"><view class="document-disc"><view class="document-icon"><view/><view/><view/></view></view><text class="pick-title">选择文章文件</text><text class="format-note">TXT / Markdown / DOCX / 文字型 PDF</text></view>
      <view v-else class="file-card"><text class="preview-label">已选择文件</text><text class="file-name">{{file.name}}</text><text v-if="charCount!==null" class="file-meta">{{charCount.toLocaleString()}} 字符<text v-if="charCount>MAX_CHARS" class="over"> · 超过 5,000 字符限制</text></text><text v-else class="file-meta">文件文字将在生成时校验，请使用文字型 PDF 或 DOCX。</text><view v-if="previewText" class="preview"><text class="preview-label">内容预览</text><text class="preview-body">{{previewText}}</text></view></view>
      <button class="pick-btn" :class="{secondary:file}" :disabled="uploading" @click="chooseFile"><text v-if="!file" class="pick-plus">＋</text>{{file?'更换文件':'选择文件'}}</button>
      <text v-if="!file" class="file-limit">每篇最多 5,000 字符，文件不超过 10 MB</text>
      <button v-if="file" class="upload-btn" :disabled="!canUpload || uploading" @click="upload">{{uploading?(uploadProgress>0?'正在上传 '+uploadProgress+'%':'正在上传…'):'生成我的听力课'}}</button>
      <text v-if="file && !canUpload && !uploading && quota && charCount!==null && charCount>MAX_CHARS" class="action-note">请精简文章后重新选择文件</text>
      <text v-else-if="file && !canUpload && !uploading && quota" class="action-note">生成次数不足，请在下方获取次数</text>
    </view>
    <view v-if="uploaded" class="success" :class="{'is-failed':processStatus==='failed'}"><text class="success-title">{{processStatus==='done'?'听力课已准备好':processStatus==='failed'?'这次生成未能完成':'正在生成你的听力课'}}</text><template v-if="processStatus==='processing'"><view class="generation-track"><view :style="{width:processProgress+'%'}"/></view><text class="success-desc">已完成 {{processProgress}}%，正在制作音频和词汇。你可以稍后到「我的课程」查看。</text></template><text v-else-if="processStatus==='failed'" class="success-desc">{{processErrorText}}</text><text v-else class="success-desc">戴上耳机，开始听读和跟读吧。</text><button v-if="processStatus==='done' && completedLessonId" class="learn-btn" @click="learnNow">开始学习 ▶</button><button class="back-btn" @click="goBack">查看我的课程 ›</button></view>
    <view v-if="errorMsg" class="error" role="alert"><text>{{errorMsg}}</text><text class="error-retry" @click="loadQuota">重试</text></view>
    <button class="credit-summary" :aria-expanded="creditsOpen" @click="creditsOpen=!creditsOpen"><view class="credits-icon"><view/><view/></view><view class="credit-copy"><text class="credit-label">可用生成次数</text><text class="credit-value">{{creditSummary}}</text></view><text class="manage-link">{{creditsOpen?'收起':'获取次数'}} ›</text></button>
    <text class="credit-reassurance">每次生成消耗 1 次额度，失败自动返还</text>
    <view v-if="quotaSyncing && !creditsOpen" class="quota-syncing">支付已完成，正在确认次数到账…</view>
    <view v-if="creditsOpen" class="credit-details">
      <view class="quota-card"><text class="quota-title">我的生成次数</text><text class="quota-text">{{quota?'免费次数：剩余 '+Math.max(0,quota.freeTotal-quota.freeUsed)+' / '+quota.freeTotal+' 次':'正在加载次数…'}}</text><text v-if="quota && quota.singleRemaining>0" class="quota-text">单次购买：{{quota.singleRemaining}} 次</text><text v-if="quota && quota.pointsRemaining>0" class="quota-text">积分兑换：{{quota.pointsRemaining}} 次</text><text v-if="membershipText" class="quota-text">{{membershipText}}</text><view v-if="quota" class="quota-row"><view><text class="quota-text">当前积分：{{quota.points||0}}</text><text class="quota-note">100 积分可兑换 1 次</text></view><button class="redeem-btn" :disabled="redeeming || (quota.points||0)<100" @click="onRedeem">{{redeeming?'兑换中…':'积分兑换'}}</button></view><text v-if="quotaSyncing" class="quota-syncing">支付已完成，正在确认次数到账…</text><text class="quota-note">优先使用套餐次数，再依次使用免费、积分兑换和单次购买的次数。</text></view>
      <view class="buy-card"><text class="buy-title">获取更多生成次数</text><text v-if="isLifetime" class="buy-note">你已开通无限导入，可直接生成课程。</text><template v-else><view v-for="p in products" :key="p.id" class="buy-row"><view class="buy-info"><view class="buy-heading"><text class="buy-name">{{p.name}}</text><text class="buy-price">{{p.price}}</text></view><text class="buy-desc">{{p.desc}}</text></view><button class="buy-btn" :disabled="!!purchasing" @click="buy(p.id)">{{purchasing===p.id?'处理中…':'购买'}}</button></view><text class="buy-note">支付确认后次数到账；30 天套餐包含 30 次生成机会。</text></template><text v-if="buyError" class="buy-error">{{buyError}}</text><view v-if="pendingOutTradeNo && !purchasing" class="requery-row"><text>已付款但次数未到账？</text><text class="requery-btn" @click="onRequery">{{requerying?'查询中…':'查询订单'}}</text></view></view>
    </view>
    <view class="library-footer"><text>已生成的课程保存在「我的课程」</text><button @click="goBack">查看我的课程 ›</button></view>
  </view>
</template>

<script setup lang="ts">
import { requestId } from '@/utils/api';
import { ref, computed } from 'vue';
import { onShow, onHide, onUnload, onPullDownRefresh } from '@dcloudio/uni-app';
const creditsOpen = ref(false);
const creditSummary = computed(()=>{const q=quota.value;if(!q)return '正在加载…';if(isLifetime.value)return '不限次数';const monthly=q.membership?.type==='monthly' && (q.membership.expiresAt || 0)>Date.now()?(q.monthlyRemaining || 0):0;const count=Math.max(0,q.freeTotal-q.freeUsed)+(q.singleRemaining||0)+(q.pointsRemaining||0)+monthly;return count+' 次';});
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
  name: '单次导入',
  desc: '增加 1 次生成机会，按需使用',
  price: '¥3'
}, {
  id: 'member30day',
  name: '30 天套餐',
  desc: '30 天内可生成 30 篇课程',
  price: '¥9'
}, {
  id: 'unlimitedmember',
  name: '无限导入',
  desc: '长期使用，不限生成次数',
  price: '¥59'
}];
const isLifetime = computed(() => quota.value?.membership?.type === 'lifetime');

/** 会员状态文案（终身 / 包月剩余次数与到期日 / 已过期） */
const membershipText = computed(() => {
  const m = quota.value?.membership;
  if (!m) return '';
  if (m.type === 'lifetime') return '已开通无限导入';
  if (m.type === 'monthly') {
    if (m.expiresAt && m.expiresAt > Date.now()) {
      const d = new Date(m.expiresAt);
      const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      return `套餐剩余 ${quota.value?.monthlyRemaining ?? 0} 次，有效期至 ${date}`;
    }
    return '30 天套餐已到期';
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
    return '音频服务暂不可用，生成次数已返还。';
  }
  if (processError.value === 'OVER_LIMIT') return '文章超过 5,000 字符，生成次数已返还。';
  if (processError.value === 'CONTENT_RISK') return '暂不支持导入这篇内容，生成次数已返还。';
  if (processError.value === 'PDF_NO_TEXT') {
    return '未能读取文字，请选择文字型 PDF。生成次数已返还。';
  }
  if (processError.value === 'PDF_PARSE_FAILED') {
    return '无法读取此 PDF，请使用未加密的有效文件。生成次数已返还。';
  }
  if (processError.value === 'TTS_MIXED_SAMPLE_RATES') {
    return '音频生成失败，次数已返还。可在我的课程中重试。';
  }
  if (processError.value === 'EMPTY_CONTENT') return '未找到文章正文，请更换文件。生成次数已返还。';
  if (processError.value === 'PROCESS_NOT_DEPLOYED') {
    return '服务暂不可用，次数已返还，请稍后重试。';
  }
  if (processError.value === 'PROCESS_CALL_FAILED') {
    return '导入失败，次数已返还，可在我的课程中重试。';
  }
  return '导入失败，次数已返还，可在我的课程中重试。';
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
    errorMsg.value = '次数加载失败，请下拉刷新或点击重试。';
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
          title: '生成次数已到账',
          icon: 'success'
        });
      }
    } catch {
      /* 静默Retry，下一次 tick 继续 */
    }
  }, 15000);
}
onShow(() => {
  uni.setNavigationBarTitle({title:'导入文章'});
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
      title: '请更新微信',
      content: '请将微信更新到最新版本后再购买。',
      showCancel: false
    });
    return;
  }
  if (typeof wx.canIUse === 'function' && !wx.canIUse('requestVirtualPayment')) {
    uni.showToast({
      title: '请更新微信后再购买',
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
        title: '生成次数已到账',
        icon: 'success'
      });
    } else {
      if (queryError) console.warn('[pay] 查单未确认', queryError);
      uni.showToast({
        title: '支付已完成，正在确认到账…',
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
        title: '已取消支付',
        icon: 'none'
      });
    } else if (msg.includes('PAY_NOT_CONFIGURED')) {
      buyError.value = '支付暂不可用，请稍后重试。';
    } else if (msg.includes('UNKNOWN_PRODUCT')) {
      buyError.value = '该套餐暂不可用，请稍后重试。';
    } else if (msg.includes('CODE2SESSION_FAILED')) {
      buyError.value = '登录状态已过期，请重新打开此页面。';
    } else {
      buyError.value = '支付未完成，请稍后重试。';
      uni.showToast({
        title: '支付未完成',
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
      title: `还差 ${100 - pts} 积分即可兑换`,
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
      title: '兑换成功，已增加 1 次',
      icon: 'success'
    });
  } catch (e: any) {
    const msg = String(e && (e.errMsg || e.message) || '');
    uni.showToast({
      title: msg.includes('POINTS_NOT_ENOUGH') ? '满 100 积分可兑换 1 次' : '兑换失败，请稍后重试',
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
        title: '未找到该订单',
        icon: 'none'
      });
    } else if (order.status === 'delivered') {
      pendingOutTradeNo.value = '';
      try {
        uni.removeStorageSync('lastPayOutTradeNo');
      } catch {/* ignore */}
      await loadQuota();
      uni.showToast({
        title: '订单已确认，次数已到账',
        icon: 'success'
      });
    } else {
      const qe = res.result && res.result.queryError;
      if (qe) console.warn('[pay] 查单未确认', qe);
      uni.showToast({
        title: '仍在确认中，将继续查询',
        icon: 'none'
      });
      startQuotaSync();
    }
  } catch (e: any) {
    logInternal('pay', e);
    buyError.value = '暂时无法查询订单，请稍后查看次数。';
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
      errorMsg.value = `文件超过 ${MAX_FILE_MB} MB，请选择较小的文件。`;
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
        errorMsg.value = `文章超过 ${MAX_CHARS} 字符，请精简后重新选择。`;
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
    errorMsg.value = '导入服务暂不可用，请稍后重试。';
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
      errorMsg.value = '生成次数不足，请获取次数后继续。';
    } else {
      errorMsg.value = '上传失败，请重试。';
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
  try { uni.setStorageSync('gotoImportTab', true); } catch {}
  uni.redirectTo({url:'/pages/index/index?browse=1'});
}
</script>

<style scoped>
.container{min-height:100vh;box-sizing:border-box;padding:29px 22px calc(40px + env(safe-area-inset-bottom));background:#fbf9fe;color:#281247;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Helvetica Neue',Arial,sans-serif}
button{font-family:inherit;margin:0;box-sizing:border-box}button::after{border:0}
.import-intro{margin:0 0 30px;padding:0 3px}.intro-title{display:block;font-size:23px;font-weight:650;line-height:1.4;letter-spacing:0}.intro-desc{display:block;margin-top:10px;white-space:pre-line;color:#8a7a99;font-size:13px;line-height:1.75;font-weight:400}
.intro-desc>text{display:block}
.import-steps{display:flex;align-items:center;gap:10px;margin:0 3px 23px}.step{display:flex;align-items:center;gap:6px;white-space:nowrap;font-size:12px;color:#9a8ba9;line-height:1.3}.step-number{display:flex;align-items:center;justify-content:center;flex:none;width:22px;height:22px;border-radius:50%;font-size:12px;font-weight:500;background:#eee8f6;color:#513568}.step.current{color:#281247;font-weight:600}.step.current .step-number{background:#ffcf00;color:#281247}.step.complete .step-number{background:#e7ddf1;color:#56337b}.step-connector{height:1px;flex:1;min-width:8px;background:#ded1ed}
.upload-card{padding:22px 17px 18px;border:1px dashed #d5bde9;border-radius:18px;background:#fff;box-sizing:border-box}.file-intro{display:flex;align-items:center;flex-direction:column}.document-disc{width:54px;height:54px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:#f0e8fd;margin-bottom:14px}.document-icon{width:27px;height:34px;border:2px solid #452264;border-radius:4px;display:flex;flex-direction:column;justify-content:center;gap:4px;padding:6px 5px;box-sizing:border-box}.document-icon>view{height:2px;flex:none;background:#452264;border-radius:1px}.document-icon>view:last-child{width:65%}.pick-title{font-size:18px;line-height:1.4;font-weight:600}.format-note{margin-top:8px;font-size:11px;line-height:1.6;color:#8d7c9d;text-align:center}.pick-btn,.upload-btn,.learn-btn{display:flex;align-items:center;justify-content:center;gap:7px;width:100%;min-height:44px;padding:10px 14px;border:0;border-radius:12px;background:#ffcf00;color:#281247;font-size:16px;font-weight:600;line-height:1.4;box-shadow:none}.pick-btn{margin-top:22px}.pick-plus{font-size:24px;font-weight:400;line-height:1}.file-limit{display:block;margin-top:12px;text-align:center;color:#9886a6;font-size:11px;line-height:1.6}.pick-btn.secondary{background:#f3edf9;font-size:14px;margin-top:16px}.upload-btn{margin-top:12px}.upload-btn[disabled]{background:#ede6f3;color:#ac9bbb}.action-note{display:block;margin-top:10px;color:#9b778c;font-size:12px;line-height:1.6}.file-name{display:block;word-break:normal;overflow-wrap:break-word;font-size:16px;font-weight:600;line-height:1.5;margin-top:6px}.preview-label{display:block;color:#947da7;font-size:11px;line-height:1.4}.file-meta{display:block;color:#8c7a9c;font-size:12px;line-height:1.7;margin-top:8px}.over{color:#bb506c}.preview{margin-top:16px;border-radius:10px;background:#faf7fd;padding:13px;max-height:200px;overflow:auto}.preview-body{display:block;font-size:14px;line-height:1.8;color:#675873;margin-top:8px;white-space:pre-wrap;word-break:break-word}
.credit-summary{display:flex;align-items:center;gap:15px;width:100%;min-height:70px;text-align:left;padding:14px 17px;margin:20px 0 0;background:#f1eaf9;border:0;border-radius:14px;line-height:1.4;overflow:visible}.credits-icon{position:relative;flex:0 0 30px;width:30px;height:30px}.credits-icon>view{position:absolute;width:19px;height:23px;border:2px solid #543273;border-radius:5px;box-sizing:border-box;background:#f1eaf9}.credits-icon>view:first-child{left:7px;top:0}.credits-icon>view:last-child{left:1px;top:6px}.credits-icon>view:last-child::before,.credits-icon>view:last-child::after{content:'';position:absolute;height:2px;width:8px;left:3px;top:6px;border-radius:1px;background:#543273}.credits-icon>view:last-child::after{top:11px;width:5px}.credit-copy{flex:1;min-width:0;border-left:1px solid #d6c3e6;padding-left:15px}.credit-label{display:block;color:#8d779f;font-size:12px;line-height:1.4}.credit-value{display:block;font-size:23px;font-weight:650;line-height:1.25;margin-top:4px;white-space:nowrap}.manage-link{flex:none;color:#412157;font-size:13px;font-weight:500}.credit-reassurance{display:block;margin:12px 4px 0;color:#9987a6;font-size:11px;line-height:1.7}
.credit-details{margin-top:18px;display:flex;flex-direction:column;gap:15px}.quota-card,.buy-card{padding:18px 16px;background:#fff;border:1px solid #e9dff1;border-radius:14px}.quota-title,.buy-title{display:block;font-size:16px;font-weight:600;line-height:1.5;margin-bottom:12px}.quota-text{display:block;font-size:13px;line-height:1.7;color:#786487;margin-top:4px}.quota-note,.buy-note{display:block;font-size:11px;color:#a08aac;line-height:1.7;margin-top:9px}.quota-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 0;margin-top:10px;border-top:1px solid #f0e9f5}.quota-row .quota-note{margin-top:3px}.redeem-btn,.buy-btn{background:#fff1bb;color:#5a3b39;border:0;border-radius:9px;padding:9px 12px;min-height:38px;font-size:12px;line-height:1.4;flex:none}.buy-row{display:flex;align-items:center;gap:12px;padding:15px 0;border-top:1px solid #f0e9f5}.buy-info{flex:1;min-width:0}.buy-heading{display:flex;align-items:baseline;flex-wrap:wrap;gap:9px}.buy-name{font-size:14px;font-weight:600}.buy-price{font-size:16px;font-weight:650;color:#674078}.buy-desc{display:block;margin-top:5px;color:#9985a7;font-size:11px;line-height:1.6}.buy-btn{background:#281247;color:#fff;min-width:60px}.redeem-btn{background:#ffcf00;color:#281247;font-weight:600}.redeem-btn:active{background:#f2c200}.redeem-btn[disabled]{background:#ece6f2;color:#a492b4;opacity:1}.quota-syncing{display:block;font-size:12px;line-height:1.7;color:#856699;padding:10px 3px}.buy-error,.error{color:#b04d68;font-size:12px;line-height:1.7}.error{padding:12px 4px}.error-retry{margin-left:10px;text-decoration:underline}.buy-error{display:block;margin-top:9px}.requery-row{display:flex;justify-content:space-between;gap:12px;color:#9a84a9;font-size:11px;line-height:1.7;margin-top:15px}.requery-btn{color:#583673;text-decoration:underline;flex:none}
.library-footer{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:9px 15px;margin-top:23px;padding:17px 3px 0;border-top:1px solid #e9e0f1;color:#9b89a9;font-size:11px;line-height:1.7}.library-footer button{padding:6px 0;min-height:32px;background:transparent;color:#48245e;font-size:12px;line-height:1.5;border:0;font-weight:500;flex:none}
.success{background:#fff;border:1px solid #e6d8f0;border-radius:18px;padding:22px 18px}.success-title{display:block;font-size:20px;font-weight:600;line-height:1.5;color:#3d2154}.success-desc{display:block;font-size:13px;line-height:1.8;color:#8d7a9f;margin-top:10px}.generation-track{height:5px;background:#eee6f5;border-radius:4px;overflow:hidden;margin-top:17px}.generation-track>view{height:100%;background:#ffcf00;border-radius:4px;transition:width .3s}.learn-btn{margin-top:18px}.back-btn{margin-top:12px;padding:9px 0;background:transparent;color:#62417c;font-size:13px;border:0}.is-failed{border-color:#edd6df;background:#fffafb}
@media(max-width:350px){.container{padding:25px 17px calc(35px + env(safe-area-inset-bottom))}.intro-title{font-size:21px}.import-steps{gap:7px}.step{font-size:11px;gap:4px}.step-number{width:20px;height:20px}.upload-card{padding-left:13px;padding-right:13px}.credit-summary{gap:10px;padding-left:13px;padding-right:13px}.credit-copy{padding-left:11px}.manage-link{font-size:12px}.credit-value{font-size:21px}}
</style>
