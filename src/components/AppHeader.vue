<template><view class="app-header" :style="{paddingTop:statusBar+'px'}"><view class="header-body" :style="{height:navHeight+'px'}"><text class="header-title">{{title}}</text></view></view></template>
<script setup lang="ts">
import {ref} from 'vue';
defineProps<{title:string}>();
const statusBar=ref(20),navHeight=ref(44);
try{const sys=uni.getWindowInfo();statusBar.value=sys.statusBarHeight||20;const menu=(wx as any).getMenuButtonBoundingClientRect();if(menu?.height)navHeight.value=(menu.top-statusBar.value)*2+menu.height}catch{}
</script>
<style scoped>.app-header{background:transparent}.header-body{display:flex;align-items:center;padding:0 2rpx}.header-title{font-size:30rpx;font-weight:650;color:#281247;letter-spacing:-.6rpx}</style>
