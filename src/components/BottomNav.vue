<template>
  <view class="bottom-nav">
    <button v-for="item in items" :key="item.key" class="nav-item" :class="{selected:active===item.key}" @click="go(item)">
      <view class="nav-icon" :class="'icon-'+item.key"><view v-if="active===item.key" class="nav-selection"/><view class="nav-inner"/></view><text>{{ item.label }}</text>
    </button>
  </view>
</template>
<script setup lang="ts">
defineProps<{
  active: string;
}>();
const items = [{
  key: 'home',
  label: 'Home',
  icon: '⌂',
  url: '/pages/index/index'
}, {
  key: 'courses',
  label: 'Courses',
  icon: '▤',
  url: '/pages/index/index?browse=1'
}, {
  key: 'review',
  label: 'Review',
  icon: '↻',
  url: '/pages/profile/vocab'
}, {
  key: 'profile',
  label: 'You',
  icon: '○',
  url: '/pages/profile/index'
}];
function go(item: any) {
  uni.reLaunch({
    url: item.url
  });
}
</script>
<style scoped>
.bottom-nav{position:fixed;bottom:0;left:0;right:0;z-index:80;display:flex;background:#fff;border-top:1rpx solid #e8e5ed;padding:16rpx 26rpx calc(12rpx + env(safe-area-inset-bottom))}.nav-item{flex:1;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:10rpx;font-size:20rpx;font-weight:500;letter-spacing:.2rpx;color:#8b9790;min-height:74rpx}.nav-icon{width:36rpx;height:36rpx;position:relative;margin:3rpx 0}.selected{color:#281247;font-weight:700}.nav-selection{position:absolute;width:74rpx;height:46rpx;left:50%;top:50%;transform:translate(-50%,-50%);background:#fff1b3;border-radius:24rpx;z-index:-1;pointer-events:none}.icon-home{border:3rpx solid currentColor;border-top:0;border-radius:3rpx;width:27rpx;height:25rpx;margin-top:14rpx}.icon-home:before{content:'';position:absolute;width:21rpx;height:21rpx;border-left:3rpx solid currentColor;border-top:3rpx solid currentColor;transform:rotate(45deg);top:-12rpx;left:0}.icon-home .nav-inner{height:13rpx;width:8rpx;border:2rpx solid currentColor;border-bottom:0;position:absolute;bottom:0;left:7rpx}.icon-courses{border:3rpx solid currentColor;border-radius:5rpx;width:30rpx;height:32rpx}.icon-courses:before,.icon-courses:after{content:'';position:absolute;height:2rpx;left:6rpx;right:5rpx;top:8rpx;background:currentColor}.icon-courses:after{top:17rpx}.icon-review{border:3rpx solid currentColor;border-radius:50%;border-right-color:transparent;width:32rpx;height:32rpx}.icon-review:before{content:'';position:absolute;right:-4rpx;top:-1rpx;width:10rpx;height:10rpx;border-right:3rpx solid currentColor;border-bottom:3rpx solid currentColor;transform:rotate(14deg)}.icon-profile{border:3rpx solid currentColor;border-radius:50%;width:16rpx;height:16rpx;margin-bottom:20rpx}.icon-profile:before{content:'';position:absolute;top:18rpx;left:-9rpx;width:28rpx;height:15rpx;border:3rpx solid currentColor;border-bottom:0;border-radius:20rpx 20rpx 0 0}
</style>
<style scoped>.nav-item{margin:0;padding:0;background:transparent;border:0;line-height:1.1;overflow:visible}.nav-item::after{border:0}</style>
