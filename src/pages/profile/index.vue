<template>
  <view class="container">
    <!-- 自定义导航栏：返回 + 标题 + 右上角信息铃铛（未读角标） -->
    <view class="custom-nav" :style="{ paddingTop: statusBarHeight + 'px' }">
      <view class="custom-nav-body" :style="{ height: navContentHeight + 'px' }">
        <text class="nav-back" @click="goBack">‹</text>
        <text class="nav-title">个人中心</text>
      </view>
    </view>

    <!-- 头像昵称居中（参考 B 站个人中心布局，配小程序主题色） -->
    <view class="hero">
      <view class="hero-msg" @click="goMessages">
        <text class="hero-msg-ico">🔔</text>
        <text v-if="unreadCount > 0" class="hero-badge">{{ unreadCount > 99 ? '99+' : unreadCount }}</text>
      </view>
      <image class="hero-avatar" :src="avatarUrl" mode="aspectFill" />
      <text class="hero-nick">{{ profile?.nickName || '未设置昵称' }}</text>
      <text class="hero-edit" @click="goEdit">编辑资料 ✎</text>
    </view>

    <!-- 账户 -->
    <view class="sec">账户</view>
    <view class="menu">
      <view class="item" @click="goPoints">
        <text class="item-ico">🪙</text>
        <text class="item-title">积分余额</text>
        <text class="item-value"><text class="points-num">{{ points }}</text> 分</text>
        <text class="arrow">›</text>
      </view>
    </view>

    <!-- 学习 -->
    <view class="sec">学习</view>
    <view class="menu">
      <view class="item" @click="goVocab">
        <text class="item-ico">📖</text>
        <text class="item-title">生词表</text>
        <text class="item-value">{{ vocabCount }} 词</text>
        <text class="arrow">›</text>
      </view>
      <view class="item" @click="goFavorites">
        <text class="item-ico">❤️</text>
        <text class="item-title">我的收藏</text>
        <text class="item-value">{{ favCount }} 篇</text>
        <text class="arrow">›</text>
      </view>
      <view class="item" @click="goImports">
        <text class="item-ico">📄</text>
        <text class="item-title">我的导入</text>
        <text class="arrow">›</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { useVocabStore } from '@/stores/vocab'

const DEFAULT_AVATARS = ['fox', 'cat', 'owl', 'panda', 'rabbit', 'penguin', 'frog', 'bear']
const PROFILE_CACHE_KEY = 'profileCacheV1'
const GOTO_IMPORT_TAB_KEY = 'gotoImportTab'

const profile = ref<any>(null)
const points = ref(0)
const vocabCount = ref(0)
const favCount = ref(0)
const unreadCount = ref(0)
const avatarUrl = ref('')

// 自定义导航栏高度（与首页同算法）
const statusBarHeight = ref(20)
const navContentHeight = ref(44)
try {
  const sys = uni.getSystemInfoSync()
  statusBarHeight.value = sys.statusBarHeight || 20
  const menu: any = (wx as any).getMenuButtonBoundingClientRect()
  if (menu && menu.height) {
    navContentHeight.value = (menu.top - statusBarHeight.value) * 2 + menu.height
  }
} catch {}

function resolveAvatar(p: any): string {
  if (!p) return '/static/avatars/fox.png'
  if (p.avatarType === 'custom' && p.avatarUrl) return p.avatarUrl
  return `/static/avatars/${DEFAULT_AVATARS[p.avatarIndex] || 'fox'}.png`
}

async function load() {
  // 资料：缓存秒显 + 云端刷新（带积分余额）
  try {
    const cached: any = uni.getStorageSync(PROFILE_CACHE_KEY)
    if (cached && cached.nickName) {
      profile.value = cached
      avatarUrl.value = resolveAvatar(cached)
      if (typeof cached.points === 'number') points.value = cached.points
    }
  } catch {}
  try {
    const res: any = await wx.cloud.callFunction({ name: 'userApi', data: { action: 'getProfile' } })
    const p = res.result && res.result.profile
    if (p) {
      profile.value = p
      avatarUrl.value = resolveAvatar(p)
      points.value = p.points || 0
      try { uni.setStorageSync(PROFILE_CACHE_KEY, p) } catch {}
    }
  } catch {}
  // 生词数（本地）
  try {
    const vs = useVocabStore()
    vs.load()
    vocabCount.value = vs.saved.length
  } catch {}
  // 收藏数 + 未读消息数（云端）
  try {
    const r: any = await wx.cloud.callFunction({ name: 'userApi', data: { action: 'listFavorites' } })
    favCount.value = ((r.result && r.result.list) || []).length
  } catch {}
  try {
    const m: any = await wx.cloud.callFunction({ name: 'userApi', data: { action: 'listMessages' } })
    unreadCount.value = (m.result && m.result.unread) || 0
  } catch {}
}

onShow(() => { load() })

function goBack() { uni.navigateBack({ delta: 1 }) }
function goMessages() { uni.navigateTo({ url: '/pages/profile/messages' }) }
function goEdit() { uni.navigateTo({ url: '/pages/profile/edit' }) }
function goPoints() { uni.navigateTo({ url: '/pages/profile/points' }) }
function goVocab() { uni.navigateTo({ url: '/pages/profile/vocab' }) }
function goFavorites() { uni.navigateTo({ url: '/pages/profile/favorites' }) }
function goImports() {
  // 首页是 tab 式的“我的导入”分栏：打标记后返回，首页 onShow 切过去
  try { uni.setStorageSync(GOTO_IMPORT_TAB_KEY, 1) } catch {}
  uni.navigateBack({ delta: 1 })
}
</script>

<style>
.container { min-height: 100vh; background: #f5f5f5; padding-bottom: 40rpx; }
/* 自定义导航栏 */
.custom-nav { background: #ffffff; }
.custom-nav-body { display: flex; align-items: center; justify-content: center; position: relative; }
.nav-back { position: absolute; left: 24rpx; font-size: 52rpx; color: #2b1b4d; padding: 8rpx 16rpx; line-height: 1; }
.nav-title { font-size: 32rpx; font-weight: 700; color: #2b1b4d; }

/* 头像昵称居中 */
.hero { display: flex; flex-direction: column; align-items: center; padding: 36rpx 0 12rpx; position: relative; }
.hero-msg { position: absolute; top: 36rpx; right: 44rpx; padding: 8rpx; }
.hero-msg-ico { font-size: 44rpx; }
.hero-badge { position: absolute; top: 2rpx; right: 0; min-width: 32rpx; height: 32rpx; line-height: 32rpx; text-align: center; background: #fa5151; color: #fff; font-size: 20rpx; border-radius: 16rpx; padding: 0 8rpx; }
.hero-avatar { width: 168rpx; height: 168rpx; border-radius: 50%; background: #ffd60a; border: 6rpx solid #fff; box-shadow: 0 6rpx 20rpx rgba(0,0,0,.1); }
.hero-nick { font-size: 36rpx; font-weight: 700; color: #2b1b4d; margin-top: 20rpx; }
.hero-edit { font-size: 24rpx; color: #ab47bc; margin-top: 10rpx; padding: 6rpx 16rpx; }
.sec { font-size: 24rpx; color: #aaa; margin: 36rpx 48rpx 16rpx; }
.menu { margin: 0 32rpx; background: #fff; border-radius: 24rpx; overflow: hidden; box-shadow: 0 4rpx 16rpx rgba(0,0,0,.05); }
.item { display: flex; align-items: center; padding: 30rpx 32rpx; border-bottom: 1px solid #f2f2f2; }
.item:last-child { border-bottom: none; }
.item-ico { font-size: 32rpx; margin-right: 20rpx; }
.item-title { font-size: 28rpx; color: #2b1b4d; flex: 1; }
.item-value { font-size: 26rpx; color: #888; margin-right: 12rpx; }
.points-num { font-size: 32rpx; font-weight: 800; color: #2b1b4d; }
.arrow { color: #bbb; font-size: 28rpx; }
</style>
