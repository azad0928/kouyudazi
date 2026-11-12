<template>
  <view class="container">
    <view class="balance-card">
      <text class="balance-label">Your points</text>
      <text class="balance-num">{{ points }} <text class="unit">pts</text></text>
      <text class="balance-hint">100 points = 1 import credit</text>
    </view>
    <view class="sec">ACTIVITY</view>
    <view v-if="loading" class="empty">Loading…</view>
    <view v-else-if="!logs.length" class="empty">Check in to earn your first points.</view>
    <view v-else class="menu">
      <view v-for="log in logs" :key="log._id" class="item">
        <view class="item-main">
          <text class="item-reason">{{ pointReason(log.reason) }}</text>
          <text class="item-date">{{ formatDate(log.createdAt) }}</text>
        </view>
        <text class="item-change" :class="{ neg: log.change < 0 }">{{ log.change > 0 ? '+' + log.change : log.change }}</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'

function pointReason(reason: string) {
 if (!/[\u4e00-\u9fff]/.test(reason || '')) return reason;
 if (/打卡/.test(reason)) return 'Daily check-in';
 if (/兑换/.test(reason)) return 'Import credit redeemed';
 if (/共享|上架|投稿/.test(reason)) return 'Lesson contribution';
 return 'Points adjustment';
}
const PROFILE_CACHE_KEY = 'profileCacheV1'
const points = ref(0)
const logs = ref<any[]>([])
const loading = ref(true)

function formatDate(ts: number): string {
  const d = new Date(ts)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

onLoad(async () => {
  try {
    const cached: any = uni.getStorageSync(PROFILE_CACHE_KEY)
    if (cached && typeof cached.points === 'number') points.value = cached.points
  } catch {}
  try {
    const res: any = await wx.cloud.callFunction({ name: 'userApi', data: { action: 'getProfile' } })
    const p = res.result && res.result.profile
    if (p && typeof p.points === 'number') {
      points.value = p.points
      try {
        const cached: any = uni.getStorageSync(PROFILE_CACHE_KEY) || {}
        uni.setStorageSync(PROFILE_CACHE_KEY, { ...cached, points: p.points })
      } catch {}
    }
  } catch {}
  try {
    const r: any = await wx.cloud.callFunction({ name: 'userApi', data: { action: 'listPointLogs' } })
    logs.value = (r.result && r.result.list) || []
  } catch {} finally {
    loading.value = false
  }
})
</script>

<style>
.container { min-height: 100vh; background: #f5f5f5; padding-bottom: 40rpx; }
.balance-card { background: #281247; border-radius: 24rpx; margin: 24rpx 32rpx 0; padding: 36rpx 32rpx; display: flex; flex-direction: column; }
.balance-label { font-size: 24rpx; color: rgba(255,255,255,.65); }
.balance-num { font-size: 64rpx; font-weight: 800; color: #ffcf00; margin-top: 8rpx; }
.balance-num .unit { font-size: 26rpx; font-weight: 400; }
.balance-hint { font-size: 22rpx; color: rgba(255,255,255,.5); margin-top: 10rpx; }
.sec { font-size: 24rpx; color: #aaa; margin: 36rpx 48rpx 16rpx; }
.empty { text-align: center; color: #aaa; font-size: 26rpx; margin-top: 80rpx; }
.menu { margin: 0 32rpx; background: #fff; border-radius: 24rpx; overflow: hidden; box-shadow: 0 4rpx 16rpx rgba(0,0,0,.05); }
.item { display: flex; align-items: center; padding: 28rpx 32rpx; border-bottom: 1px solid #f2f2f2; }
.item:last-child { border-bottom: none; }
.item-main { flex: 1; display: flex; flex-direction: column; }
.item-reason { font-size: 28rpx; color: #281247; }
.item-date { font-size: 22rpx; color: #aaa; margin-top: 6rpx; }
.item-change { font-size: 32rpx; font-weight: 700; color: #07c160; }
.item-change.neg { color: #fa5151; }
</style>

<style scoped>
.container,.settings,.history{background:#ffffff;min-height:100vh;padding:30rpx 30rpx 80rpx}.intro-title,.title{font-family:inherit;color:#281247;font-size:49rpx;font-weight:700;letter-spacing:-1.5rpx;line-height:1.12;white-space:pre-line}.intro-desc,.intro-note{color:#8c9b7e;font-size:24rpx;line-height:1.65}.card,.quota-card,.buy-card,.file-card,.import-record,.menu,.balance{background:#fff;border:1rpx solid #e5e2ec;border-radius:21rpx;box-shadow:none;padding:27rpx}.heading,.quota-title,.buy-title{font-size:28rpx;font-weight:650;letter-spacing:-.4rpx;color:#3b5634}.sec{font-size:19rpx;letter-spacing:1.4rpx;color:#93a182}.note,.quota-note,.buy-note,.step,.quota-text,.meta,.sync{font-size:23rpx;line-height:1.7;color:#8a9c77}.row,.item{font-size:25rpx;color:#5b754b;border-color:#edf1e5;min-height:94rpx}.step text:first-child{color:#4f703e}.primary,.pick-btn,.upload-btn,.save-btn,.back,.learn-btn{background:#281247;color:#fff;border-radius:15rpx;font-size:25rpx;padding:24rpx;font-family:inherit}.feedback,.back-btn,.redeem-btn,.buy-btn{background:#fff4c2;color:#5a7641;border-radius:14rpx;font-size:24rpx}.empty{background:#f0f4e6;color:#8c9d7b;border-radius:21rpx;font-size:25rpx;line-height:1.7;padding:60rpx 28rpx}.name,.record-title{font-family:inherit;font-size:30rpx;color:#3f5c35;font-weight:600;line-height:1.4}.nick-input,.search{background:#fff;border:1rpx solid #dde7d1;border-radius:15rpx;font-size:26rpx;padding:23rpx}.count-row,.stats{font-size:23rpx;color:#8a9b79}.filters .active,.active{color:#496939}.track{background:#f4f1f8}.track view{background:#f2ca26}.version{color:#a7b298;font-size:18rpx;letter-spacing:2rpx}.preview{background:#f5f7ef;border-radius:14rpx;color:#80956b}.import-intro{margin:5rpx 0 32rpx}.intro-note{font-size:21rpx;color:#a1ad93}.balance-num{color:#46653a}.unit{font-size:22rpx}.buy-name{font-size:27rpx;color:#4f6d3f}.buy-desc{font-size:22rpx;color:#92a37e}
</style>

<style scoped>.balance-num{color:#ffcf00}.balance-card{margin:0;padding:35rpx;border-radius:22rpx}.menu{margin:0}.sec{margin:30rpx 0 16rpx}</style>
