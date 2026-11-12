<template>
  <view class="playback-glyph" :style="{width:size+'rpx',height:size+'rpx'}" :aria-label="loading ? 'Loading audio' : playing ? 'Pause' : 'Play'">
    <view v-if="loading && !edgeLoading" class="playback-spinner" :style="{width:size+'rpx',height:size+'rpx'}" />
    <view v-else-if="playing && !loading" class="playback-pause" :style="{height:size*.76+'rpx',gap:size*.2+'rpx'}"><view class="playback-bar" :style="{width:size*.2+'rpx'}"/><view class="playback-bar" :style="{width:size*.2+'rpx'}"/></view>
    <view v-else class="playback-triangle" :style="{borderTopWidth:size*.38+'rpx',borderBottomWidth:size*.38+'rpx',borderLeftWidth:size*.6+'rpx',marginLeft:size*.12+'rpx'}"/>
  </view>
</template>
<script setup lang="ts">
defineProps<{loading?:boolean;playing?:boolean;size:number;edgeLoading?:boolean}>();
</script>
<style scoped>
.playback-glyph{width:100%;height:100%;display:flex;align-items:center;justify-content:center;pointer-events:none;box-sizing:border-box}
.playback-spinner{box-sizing:border-box;flex-shrink:0;border:3rpx solid rgba(40,18,71,.22);border-top-color:#281247;border-radius:50%;animation:playback-spin .85s linear infinite}
.playback-pause{display:flex;align-items:stretch;justify-content:center}.playback-pause>.playback-bar{height:100%;background:#281247;border-radius:1rpx}
.playback-triangle{width:0;height:0;border-top-style:solid;border-bottom-style:solid;border-left-style:solid;border-top-color:transparent;border-bottom-color:transparent;border-left-color:#281247}
@keyframes playback-spin{to{transform:rotate(360deg)}}
</style>
