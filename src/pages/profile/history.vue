<template><view class="history"><text class="title">Every listen counts.</text><view class="stats">{{store.totalMinutes}} min listened · {{store.completedCount}} lessons completed</view><view class="filters"><text :class="{active:!completedOnly}" @click="completedOnly=false">All activity</text><text :class="{active:completedOnly}" @click="completedOnly=true">Completed</text></view><view v-if="!list.length" class="empty">Your next chapter starts with a listen.</view><view v-for="p in list" :key="p.id" class="card" @click="open(p.id)"><text class="name">{{p.title}}</text><text class="meta">{{p.completed?'Completed':'In progress'}} · {{formatTime(p.position)}} / {{formatTime(p.duration)}}</text><view class="track"><view :style="{width:Math.min(100,p.position/Math.max(1,p.duration)*100)+'%'}"/></view><view class="bottom"><text>{{new Date(p.updatedAt).toLocaleDateString('en-US')}}</text><text>{{p.quizScore!==undefined?'Quiz: '+p.quizScore+'%':'Continue ›'}}</text></view></view><button class="back" @click="courses">Explore lessons</button><text class="sync" @click="store.sync()">{{store.syncError||'Saved here · Tap to sync'}}</text></view></template>
<script setup lang="ts">
import { ref, computed } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { useLearningStore } from '@/stores/learning';
import { formatTime } from '@/utils/format';
const store = useLearningStore();
store.load();
const completedOnly = ref(false),
  list = computed(() => store.recent.filter(p => !completedOnly.value || p.completed));
onShow(() => store.sync());
function open(id: string) {
  uni.navigateTo({
    url: '/pages/lesson/detail?id=' + encodeURIComponent(id)
  });
}
function courses() {
  uni.reLaunch({
    url: '/pages/index/index?browse=1'
  });
}
</script><style scoped>.history{padding:35rpx 30rpx}.title{font-size:40rpx;color:#281247;font-weight:700}.stats{font-size:26rpx;color:#77877b;margin:24rpx 0}.filters{display:flex;gap:28rpx;font-size:26rpx;color:#77877b;margin:32rpx 0}.active{color:#281247;font-weight:700}.card{background:#fff;padding:28rpx;border-radius:24rpx;margin:24rpx 0}.name{font-size:31rpx;color:#281247;font-weight:600;display:block;line-height:1.5}.meta{font-size:24rpx;color:#77877b;display:block;margin:20rpx 0}.track{height:8rpx;border-radius:8rpx;background:#f3edf8;overflow:hidden}.track view{height:100%;background:#ffcf00}.bottom{display:flex;justify-content:space-between;font-size:22rpx;color:#77877b;margin-top:18rpx}.empty{padding:80rpx 0;text-align:center;color:#77877b;font-size:26rpx}.back{background:#ffcf00;color:#281247;font-size:27rpx;border-radius:20rpx;margin-top:35rpx}.back::after{border:0}.sync{display:block;color:#77877b;font-size:22rpx;text-align:center;padding:30rpx}</style>

<style scoped>
.container,.settings,.history{background:#ffffff;min-height:100vh;padding:30rpx 30rpx 80rpx}.intro-title,.title{font-family:inherit;color:#281247;font-size:49rpx;font-weight:700;letter-spacing:-1.5rpx;line-height:1.12;white-space:pre-line}.intro-desc,.intro-note{color:#8c9b7e;font-size:24rpx;line-height:1.65}.card,.quota-card,.buy-card,.file-card,.import-record,.menu,.balance{background:#fff;border:1rpx solid #e5e2ec;border-radius:21rpx;box-shadow:none;padding:27rpx}.heading,.quota-title,.buy-title{font-size:28rpx;font-weight:650;letter-spacing:-.4rpx;color:#3b5634}.sec{font-size:19rpx;letter-spacing:1.4rpx;color:#93a182}.note,.quota-note,.buy-note,.step,.quota-text,.meta,.sync{font-size:23rpx;line-height:1.7;color:#8a9c77}.row,.item{font-size:25rpx;color:#5b754b;border-color:#edf1e5;min-height:94rpx}.step text:first-child{color:#4f703e}.primary,.pick-btn,.upload-btn,.save-btn,.back,.learn-btn{background:#281247;color:#fff;border-radius:15rpx;font-size:25rpx;padding:24rpx;font-family:inherit}.feedback,.back-btn,.redeem-btn,.buy-btn{background:#fff4c2;color:#5a7641;border-radius:14rpx;font-size:24rpx}.empty{background:#f0f4e6;color:#8c9d7b;border-radius:21rpx;font-size:25rpx;line-height:1.7;padding:60rpx 28rpx}.name,.record-title{font-family:inherit;font-size:30rpx;color:#3f5c35;font-weight:600;line-height:1.4}.nick-input,.search{background:#fff;border:1rpx solid #dde7d1;border-radius:15rpx;font-size:26rpx;padding:23rpx}.count-row,.stats{font-size:23rpx;color:#8a9b79}.filters .active,.active{color:#496939}.track{background:#f4f1f8}.track view{background:#f2ca26}.version{color:#a7b298;font-size:18rpx;letter-spacing:2rpx}.preview{background:#f5f7ef;border-radius:14rpx;color:#80956b}.import-intro{margin:5rpx 0 32rpx}.intro-note{font-size:21rpx;color:#a1ad93}.balance-num{color:#46653a}.unit{font-size:22rpx}.buy-name{font-size:27rpx;color:#4f6d3f}.buy-desc{font-size:22rpx;color:#92a37e}
</style>
