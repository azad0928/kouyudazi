<template>
  <view class="container">
    <view class="balance-card">
      <text class="balance-label">积分余额</text>
      <text class="balance-num">{{ points }} <text class="unit">分</text></text>
      <text class="balance-hint">100 分可兑换 1 次导入额度</text>
    </view>
    <view class="sec">积分明细</view>
    <view v-if="loading" class="empty">加载中…</view>
    <view v-else-if="!logs.length" class="empty">暂无积分记录，去打卡赚第一笔吧～</view>
    <view v-else class="menu">
      <view v-for="log in logs" :key="log._id" class="item">
        <view class="item-main">
          <text class="item-reason">{{ log.reason }}</text>
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
.balance-card { background: #2b1b4d; border-radius: 24rpx; margin: 24rpx 32rpx 0; padding: 36rpx 32rpx; display: flex; flex-direction: column; }
.balance-label { font-size: 24rpx; color: rgba(255,255,255,.65); }
.balance-num { font-size: 64rpx; font-weight: 800; color: #ffd60a; margin-top: 8rpx; }
.balance-num .unit { font-size: 26rpx; font-weight: 400; }
.balance-hint { font-size: 22rpx; color: rgba(255,255,255,.5); margin-top: 10rpx; }
.sec { font-size: 24rpx; color: #aaa; margin: 36rpx 48rpx 16rpx; }
.empty { text-align: center; color: #aaa; font-size: 26rpx; margin-top: 80rpx; }
.menu { margin: 0 32rpx; background: #fff; border-radius: 24rpx; overflow: hidden; box-shadow: 0 4rpx 16rpx rgba(0,0,0,.05); }
.item { display: flex; align-items: center; padding: 28rpx 32rpx; border-bottom: 1px solid #f2f2f2; }
.item:last-child { border-bottom: none; }
.item-main { flex: 1; display: flex; flex-direction: column; }
.item-reason { font-size: 28rpx; color: #2b1b4d; }
.item-date { font-size: 22rpx; color: #aaa; margin-top: 6rpx; }
.item-change { font-size: 32rpx; font-weight: 700; color: #07c160; }
.item-change.neg { color: #fa5151; }
</style>
