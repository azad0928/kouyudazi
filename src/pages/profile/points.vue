<template>
  <view class="container">
    <view class="balance-card">
      <text class="balance-label">我的积分</text>
      <text class="balance-num">{{ points }} <text class="unit">积分</text></text>
      <text class="balance-hint">100 积分可兑换 1 次课程生成</text>
    </view>
    <view class="sec">积分明细</view>
    <view v-if="loading" class="empty">正在加载…</view>
    <view v-else-if="!logs.length" class="empty">开始学习，积累你的第一笔积分。</view>
    <view v-else class="menu">
      <view v-for="log in logs" :key="log._id" class="item" :class="{'reward-highlight':log._id===focusedLogId}" :id="'log-'+log._id">
        <view class="item-main">
          <text class="item-reason">{{ pointReason(log.reason) }}</text>
          <text v-if="log.type==='daily_ranking_reward'" class="reward-detail">{{log.rankingDate}} · {{Math.floor(log.seconds/60)}} 分钟 · 奖励 {{log.change}} 积分</text>
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
import { formatBusinessDate } from '@/utils/format'

function pointReason(reason: string) {
 const value = String(reason || '').trim();
 if (/[\u4e00-\u9fff]/.test(value)) return value;
 if (/daily.?check.?in|checkin/i.test(value)) return '每日打卡';
 if (/redeem|credit redeemed/i.test(value)) return '积分兑换课程生成次数';
 if (/contribution|shared|publish/i.test(value)) return '课程投稿奖励';
 if (/ranking|leaderboard/i.test(value)) return '每日学习榜奖励';
 if (/refund/i.test(value)) return '积分退还';
 return '积分调整';
}
const PROFILE_CACHE_KEY = 'profileCacheV1'
const focusedLogId=ref('')
const points = ref(0)
const logs = ref<any[]>([])
const loading = ref(true)

function formatDate(ts: number): string {
  // 服务端按 Asia/Shanghai 记业务日，这里必须同口径，否则设备时区会串日期
  return formatBusinessDate(ts)
}

onLoad(async (options) => {
  uni.setNavigationBarTitle({title:'积分明细'})
  focusedLogId.value=String(options?.logId||'')
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
    if(focusedLogId.value && logs.value.some(log=>log._id===focusedLogId.value)){
      await new Promise(resolve=>setTimeout(resolve,100))
      uni.pageScrollTo({selector:'#log-'+focusedLogId.value,duration:250})
    }
  } catch {} finally {
    loading.value = false
  }
})
</script>

<style scoped>
.container{min-height:100vh;box-sizing:border-box;background:#fff;padding:18px 16px calc(30px + env(safe-area-inset-bottom));font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;color:#281247}
.balance-card{display:flex;flex-direction:column;background:#281247;border-radius:14px;padding:20px}
.balance-label{font-size:13px;font-weight:500;line-height:1.6;color:#c1afcf}
.balance-num{display:block;font-size:38px;font-weight:700;line-height:1.3;color:#ffcf00;margin-top:5px;letter-spacing:0;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.balance-num .unit{font-size:12px;font-weight:500;margin-left:4px;white-space:nowrap;letter-spacing:0}
.balance-hint{font-size:12px;line-height:1.7;color:#ae97c1;margin-top:5px}
.sec{font-size:13px;font-weight:600;line-height:1.6;color:#8d779e;margin:20px 2px 10px;letter-spacing:0}
.menu{background:#fff;border:1px solid #e7deef;border-radius:13px;overflow:hidden;padding:0 14px}
.item{display:flex;align-items:center;gap:14px;padding:17px 4px;min-height:70px;box-sizing:border-box;border-bottom:1px solid #eee8f3}.item:last-child{border-bottom:0}
.item-main{flex:1;min-width:0;display:flex;flex-direction:column}.item-reason{font-size:14px;font-weight:500;line-height:1.65;color:#432b57;overflow-wrap:break-word}.item-date{font-size:11px;line-height:1.6;color:#a79aaf;margin-top:4px}
.item-change{flex-shrink:0;font-size:20px;font-weight:650;line-height:1.4;color:#07b965;font-variant-numeric:tabular-nums;white-space:nowrap}.item-change.neg{color:#ef6269}
.item.reward-highlight{background:#fff8df}.reward-detail{font-size:11px;line-height:1.7;color:#9b7b35;margin-top:4px}
.empty{text-align:center;background:#faf7fc;color:#a08bad;border-radius:13px;padding:30px 18px;font-size:13px;line-height:1.8}
</style>
