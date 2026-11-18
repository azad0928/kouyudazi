<template>
 <view class="daily-board" :aria-busy="loading">
  <view class="board-heading"><text>今日学习榜</text><text v-if="loading" class="board-loading">更新中…</text></view>
  <view class="podium">
   <view v-for="slot in slots" :key="slot.rank" class="podium-lane" :class="{winner:slot.rank===1,empty:!slot.person}">
    <view class="podium-person">
     <image v-if="slot.person" class="podium-avatar" :src="avatar(slot.person.avatarIndex)" mode="aspectFill"/>
     <view v-else class="podium-avatar empty-avatar"><text>—</text></view>
     <view class="person-copy"><text class="person-name">{{slot.person?.name||'—'}}</text><text class="person-time">{{slot.person?minutes(slot.person.seconds):'— 分钟'}}</text></view>
    </view>
    <view class="podium-step"><text>{{slot.rank}}</text></view>
   </view>
  </view>
  <view class="board-footer" @click="error?$emit('retry'):undefined">
   <text v-if="error" class="board-error">{{error}}</text>
   <view v-else class="board-standing"><text class="my-rank">{{data?(data.userRank?'我排第 '+data.userRank+' 名':'暂未上榜'):'我的排名 —'}}</text><text class="standing-dot">·</text><text>今日 {{data?data.participants:'—'}} 人学习</text></view>
  </view>
 </view>
</template>
<script setup lang="ts">
import {computed} from 'vue';
import type {DailyLeaderboard} from '@/utils/daily-learning';
const props=withDefaults(defineProps<{data:DailyLeaderboard|null;loading?:boolean;error?:string}>(),{loading:false,error:''});
defineEmits<{(event:'retry'):void}>();
const slots=computed(()=>[2,1,3].map(rank=>({rank,person:props.data?.top.find(p=>p.rank===rank)})));
const animals=['rat','ox','tiger','rabbit','dragon','snake','horse','goat','monkey','rooster','dog','pig'];
function avatar(index:number){return '/static/avatars/'+(animals[index]||'rat')+'.png'}
function minutes(seconds:number){return seconds<60?'不足1分钟':Math.floor(seconds/60)+' 分钟'}
</script>
<style scoped>
.daily-board{box-sizing:border-box;margin:0 0 30rpx;padding:11px 12px 9px;border:1rpx solid #e8def4;border-radius:18rpx;background:#fcfaff;color:#302043;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Helvetica Neue',Arial,sans-serif}
.board-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:17px;margin-bottom:9px;font-family:inherit;font-size:15px;font-weight:600;line-height:1.4;letter-spacing:0}
.board-loading{font-family:-apple-system,sans-serif;font-size:10px;font-weight:400;color:#a28cb3}
.podium{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;align-items:end}
.podium-lane{min-width:0}
.podium-person{display:flex;align-items:center;justify-content:center;gap:6px;height:28px;margin-bottom:5px;min-width:0}
.podium-avatar{display:block;flex:0 0 25px;width:25px;height:25px;border-radius:50%;background:#f0e9f8}
.empty-avatar{display:flex;align-items:center;justify-content:center;color:#b8a8c7;font-size:13px;border:1rpx solid #e9e1f0;box-sizing:border-box}
.person-copy{min-width:0}
.person-name{display:block;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:12px;font-weight:600;line-height:1.25;max-width:65px}
.person-time{display:block;font-size:10px;color:#8b799b;line-height:1.4;white-space:nowrap}
.podium-step{height:14px;border-radius:8px 8px 0 0;background:#eee5f8;display:flex;justify-content:center;align-items:center;color:#69468b;font-size:13px;font-weight:650;line-height:1}
.winner .podium-step{height:22px;background:#ffe99b;color:#362044}
.winner .podium-avatar{background:#fff3c8}
.empty .podium-step{opacity:.65}
.board-footer{margin-top:7px;padding-top:7px;border-top:1rpx solid #eae0f4;display:flex;justify-content:flex-end;align-items:center;min-height:15px;font-size:11px;color:#8b799c;line-height:1.5}
.board-standing{display:flex;justify-content:flex-end;align-items:baseline;flex-wrap:wrap;column-gap:5px;row-gap:2px;text-align:right}
.my-rank{font-weight:600;color:#6b428f}.standing-dot{color:#b4a1c5}.board-error{font-size:10.5px;color:#9478a9}
@media(max-width:350px){.daily-board{padding-left:10px;padding-right:10px}.podium{gap:4px}.podium-person{gap:4px}.podium-avatar{width:22px;height:22px;flex-basis:22px}.person-name{font-size:11px;max-width:49px}}
</style>
