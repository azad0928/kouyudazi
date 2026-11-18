<template>
  <view class="container">
    <!-- 管理员：Pending申请入口（替代 5 连点AVATAR手势） -->
    <view v-if="isAdmin" class="admin-card" @click="goReview">
      <text class="admin-ico">📋</text>
      <view class="admin-main">
        <text class="admin-title">Course submissions</text>
        <text class="admin-sub">{{ pendingCount }} awaiting review</text>
      </view>
      <text class="arrow">›</text>
    </view>

    <view class="sec-row">
      <view class="sec">RECENT MESSAGES</view>
      <text v-if="hasUnread" class="read-all" @click="onMarkAllRead">{{ markingAll ? 'Marking…' : 'Mark all read' }}</text>
    </view>
    <view v-if="loading" class="empty">Loading…</view>
    <view v-else-if="!messages.length" class="empty">You are all caught up.</view>
    <view v-else class="menu">
      <view v-for="m in messages" :key="m._id" class="item" @click="onMsgTap(m)">
        <text class="msg-ico">{{ iconFor(m.type) }}</text>
        <view class="msg-main">
          <view class="msg-title-row">
            <text class="msg-title">{{ m.title }}</text>
            <text v-if="!m.read" class="unread-dot" />
          </view>
          <text class="msg-content">{{ m.content }}</text>
          <text class="msg-date">{{ formatDate(m.createdAt) }}</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { formatBusinessDate, formatBusinessTime, isBusinessToday } from '@/utils/format'

const messages = ref<any[]>([])
const loading = ref(true)
const isAdmin = ref(false)
const pendingCount = ref(0)
const markingAll = ref(false)
const hasUnread = computed(() => messages.value.some((m: any) => !m.read))

/** Mark all read：云函数 markMessagesRead 不传 ids 即标All（带 _openid 条件，只能标自己的）。
 * 标完后红点消失；首页/Your space角标在返回时由各自的 onShow → refreshUnread 自动刷新 */
async function onMarkAllRead() {
  if (markingAll.value) return
  markingAll.value = true
  try {
    await wx.cloud.callFunction({ name: 'userApi', data: { action: 'markMessagesRead' } })
    messages.value = messages.value.map((m: any) => ({ ...m, read: true }))
    uni.showToast({ title: 'All messages marked read', icon: 'none' })
  } catch {
    uni.showToast({ title: 'Unable to complete this action. Try again.', icon: 'none' })
  } finally {
    markingAll.value = false
  }
}

function iconFor(type: string): string {
  if (type === 'daily_ranking_reward') return '🏆'
  if (type === 'official_approved') return '✅'
  if (type === 'official_rejected') return '❌'
  if (type === 'official_applied') return '📥'
  if (type === 'official_submitted') return '📤'
  return '📢'
}

function formatDate(ts: number): string {
  const hm = formatBusinessTime(ts)
  if (!hm) return ''
  const dstr = formatBusinessDate(ts)
  return isBusinessToday(ts) ? `今天 ${hm}` : `${dstr} ${hm}`
}

async function load() {
  loading.value = true
  // 管理员身份 + Pending数
  try {
    const chk: any = await wx.cloud.callFunction({ name: 'importApi', data: { action: 'adminCheck' } })
    isAdmin.value = !!(chk.result && chk.result.isAdmin)
    if (isAdmin.value) {
      try {
        const pl: any = await wx.cloud.callFunction({ name: 'importApi', data: { action: 'adminList', status: 'pending' } })
        pendingCount.value = ((pl.result && pl.result.records) || []).length
      } catch {}
    }
  } catch {}
  // 消息列表
  try {
    const r: any = await wx.cloud.callFunction({ name: 'userApi', data: { action: 'listMessages' } })
    messages.value = (r.result && r.result.list) || []
  } catch {} finally {
    loading.value = false
  }
}

onShow(() => { load() })

async function onMsgTap(m: any) {
  if (!m.read) {
    m.read = true
    try {
      await wx.cloud.callFunction({ name: 'userApi', data: { action: 'markMessagesRead', ids: [m._id] } })
    } catch {}
  }
  if (m.type === 'daily_ranking_reward') {
    uni.navigateTo({url:'/pages/profile/points?logId='+encodeURIComponent(m.pointLogId||m._id)})
    return
  }
  // 管理员点“有新的上架申请”：直达审核页并Follow到这条申请
  if (m.type === 'official_applied') {
    if (isAdmin.value && m.relatedId) {
      uni.navigateTo({ url: `/pages/admin/review?focus=${m.relatedId}` })
      return
    }
    uni.showToast({ title: 'This account cannot review submissions', icon: 'none' })
    return
  }
  // 上传者视角（已提交 / 已Approve / Rejected）：打开对应ARTICLE PREVIEW
  if (m.relatedId) {
    try {
      const r: any = await wx.cloud.callFunction({ name: 'importApi', data: { action: 'list' } })
      const hit = ((r.result && r.result.records) || []).find((x: any) => x._id === m.relatedId)
      if (hit && hit.lessonId) {
        uni.navigateTo({ url: `/pages/lesson/detail?id=${hit.lessonId}` })
        return
      }
    } catch {}
  }
  // 兜底：任何消息点了都要有反馈，不能“点了没反应”
  uni.showToast({
    title: m.type === 'official_submitted' ? 'Your submission is being reviewed' : 'No content available',
    icon: 'none',
  })
}

function goReview() {
  uni.navigateTo({ url: '/pages/admin/review' })
}
</script>

<style>
.container { min-height: 100vh; background: #f5f5f5; padding-bottom: 40rpx; }
.admin-card { display: flex; align-items: center; background: #281247; border-radius: 24rpx; margin: 24rpx 32rpx 0; padding: 30rpx 32rpx; box-shadow: 0 4rpx 16rpx rgba(0,0,0,.1); }
.admin-ico { font-size: 44rpx; margin-right: 20rpx; }
.admin-main { flex: 1; display: flex; flex-direction: column; }
.admin-title { font-size: 30rpx; font-weight: 700; color: #fff; }
.admin-sub { font-size: 24rpx; color: #ffcf00; margin-top: 6rpx; }
.admin-card .arrow { color: rgba(255,255,255,.6); font-size: 28rpx; }
.sec-row { display: flex; align-items: center; justify-content: space-between; margin: 36rpx 48rpx 16rpx; }
.sec { font-size: 24rpx; color: #aaa; }
.read-all { font-size: 24rpx; color: #281247; background-color: #efe9f7; border-radius: 24rpx; padding: 6rpx 20rpx; }
.empty { text-align: center; color: #aaa; font-size: 26rpx; margin-top: 80rpx; }
.menu { margin: 0 32rpx; background: #fff; border-radius: 24rpx; overflow: hidden; box-shadow: 0 4rpx 16rpx rgba(0,0,0,.05); }
.item { display: flex; padding: 28rpx 32rpx; border-bottom: 1px solid #f2f2f2; }
.item:last-child { border-bottom: none; }
.msg-ico { font-size: 36rpx; margin-right: 20rpx; margin-top: 4rpx; }
.msg-main { flex: 1; display: flex; flex-direction: column; }
.msg-title-row { display: flex; align-items: center; }
.msg-title { font-size: 28rpx; font-weight: 700; color: #281247; }
.unread-dot { width: 16rpx; height: 16rpx; border-radius: 50%; background: #fa5151; margin-left: 12rpx; }
.msg-content { font-size: 26rpx; color: #555; margin-top: 8rpx; line-height: 1.6; }
.msg-date { font-size: 22rpx; color: #aaa; margin-top: 8rpx; }
</style>

<style scoped>
.container,.settings,.history{background:#ffffff;min-height:100vh;padding:30rpx 30rpx 80rpx}.intro-title,.title{font-family:inherit;color:#281247;font-size:49rpx;font-weight:700;letter-spacing:-1.5rpx;line-height:1.12;white-space:pre-line}.intro-desc,.intro-note{color:#8c9b7e;font-size:24rpx;line-height:1.65}.card,.quota-card,.buy-card,.file-card,.import-record,.menu,.balance{background:#fff;border:1rpx solid #e5e2ec;border-radius:21rpx;box-shadow:none;padding:27rpx}.heading,.quota-title,.buy-title{font-size:28rpx;font-weight:650;letter-spacing:-.4rpx;color:#3b5634}.sec{font-size:19rpx;letter-spacing:1.4rpx;color:#93a182}.note,.quota-note,.buy-note,.step,.quota-text,.meta,.sync{font-size:23rpx;line-height:1.7;color:#8a9c77}.row,.item{font-size:25rpx;color:#5b754b;border-color:#edf1e5;min-height:94rpx}.step text:first-child{color:#4f703e}.primary,.pick-btn,.upload-btn,.save-btn,.back,.learn-btn{background:#281247;color:#fff;border-radius:15rpx;font-size:25rpx;padding:24rpx;font-family:inherit}.feedback,.back-btn,.redeem-btn,.buy-btn{background:#fff4c2;color:#5a7641;border-radius:14rpx;font-size:24rpx}.empty{background:#f0f4e6;color:#8c9d7b;border-radius:21rpx;font-size:25rpx;line-height:1.7;padding:60rpx 28rpx}.name,.record-title{font-family:inherit;font-size:30rpx;color:#3f5c35;font-weight:600;line-height:1.4}.nick-input,.search{background:#fff;border:1rpx solid #dde7d1;border-radius:15rpx;font-size:26rpx;padding:23rpx}.count-row,.stats{font-size:23rpx;color:#8a9b79}.filters .active,.active{color:#496939}.track{background:#f4f1f8}.track view{background:#f2ca26}.version{color:#a7b298;font-size:18rpx;letter-spacing:2rpx}.preview{background:#f5f7ef;border-radius:14rpx;color:#80956b}.import-intro{margin:5rpx 0 32rpx}.intro-note{font-size:21rpx;color:#a1ad93}.balance-num{color:#46653a}.unit{font-size:22rpx}.buy-name{font-size:27rpx;color:#4f6d3f}.buy-desc{font-size:22rpx;color:#92a37e}
</style>
