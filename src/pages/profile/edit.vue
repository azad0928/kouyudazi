<template>
  <view class="container">
    <!-- 头像 -->
    <view class="sec">头像</view>
    <view class="avatar-grid">
      <view
        v-for="(name, i) in avatars"
        :key="name"
        class="avatar-cell"
        :class="{ selected: avatarType === 'default' && avatarIndex === i }"
        @click="pickDefault(i)"
      >
        <image class="avatar-img" :src="`/static/avatars/${name}.png`" mode="aspectFill" />
      </view>
      <view
        class="avatar-cell custom"
        :class="{ selected: avatarType === 'custom' }"
        @click="pickCustom"
      >
        <image v-if="customUrl" class="avatar-img" :src="customUrl" mode="aspectFill" />
        <text v-else class="custom-plus">＋</text>
        <text class="custom-label">自定义</text>
      </view>
    </view>

    <!-- 昵称 -->
    <view class="sec">昵称</view>
    <view class="nick-row">
      <input class="nick-input" v-model="nickName" placeholder="请输入昵称" maxlength="20" />
    </view>

    <button class="save-btn" :disabled="saving" @click="onSave">保存</button>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'

const DEFAULT_AVATARS = ['rat', 'ox', 'tiger', 'rabbit', 'dragon', 'snake', 'horse', 'goat', 'monkey', 'rooster', 'dog', 'pig']
const PROFILE_CACHE_KEY = 'profileCacheV1'
const avatars = DEFAULT_AVATARS

const nickName = ref('')
const avatarType = ref<'default' | 'custom'>('default')
const avatarIndex = ref(0)
const customUrl = ref('') // 本地临时路径（选了未保存）或已保存的云端地址
const customFileID = ref('') // 已保存的云文件 ID（未改则复用，不重复上传）
const openid = ref('')
const saving = ref(false)

function pickDefault(i: number) {
  avatarType.value = 'default'
  avatarIndex.value = i
}

async function pickCustom() {
  try {
    const r: any = await uni.chooseImage({ count: 1, sizeType: ['compressed'], sourceType: ['album', 'camera'] })
    const path = r.tempFilePaths && r.tempFilePaths[0]
    if (path) {
      avatarType.value = 'custom'
      customUrl.value = path
      customFileID.value = '' // 换了新图，保存时重新上传
    }
  } catch {}
}

onLoad(async () => {
  try {
    const cached: any = uni.getStorageSync(PROFILE_CACHE_KEY)
    if (cached && cached.nickName) {
      nickName.value = cached.nickName
      avatarType.value = cached.avatarType === 'custom' ? 'custom' : 'default'
      avatarIndex.value = cached.avatarIndex || 0
      if (cached.avatarType === 'custom' && cached.avatarUrl) {
        customUrl.value = cached.avatarUrl
      }
    }
  } catch {}
  try {
    const res: any = await wx.cloud.callFunction({ name: 'userApi', data: { action: 'getProfile' } })
    openid.value = (res.result && res.result.openid) || ''
    const p = res.result && res.result.profile
    if (p) {
      nickName.value = p.nickName || nickName.value
      avatarType.value = p.avatarType === 'custom' ? 'custom' : 'default'
      avatarIndex.value = p.avatarIndex || 0
      if (p.avatarFileID) customFileID.value = p.avatarFileID
    }
  } catch {}
})

async function onSave() {
  if (saving.value) return
  const finalNick = (nickName.value || '').trim()
  if (!finalNick) {
    uni.showToast({ title: '请输入昵称', icon: 'none' })
    return
  }
  saving.value = true
  try {
    let fileID = customFileID.value
    if (avatarType.value === 'custom' && !fileID) {
      // 本地刚选的新图（tempFilePath）才需要上传；云端临时链接不能直接上传
      if (!customUrl.value || customUrl.value.startsWith('http')) throw new Error('请选择头像图片')
      const up: any = await wx.cloud.uploadFile({
        cloudPath: `avatars/${openid.value || Date.now()}.png`,
        filePath: customUrl.value,
      })
      fileID = up.fileID
    }
    await wx.cloud.callFunction({
      name: 'userApi',
      data: {
        action: 'saveProfile',
        nickName: finalNick,
        avatarType: avatarType.value,
        avatarIndex: avatarIndex.value,
        avatarFileID: avatarType.value === 'custom' ? fileID : '',
      },
    })
    // 从云端拉 fresh 资料再缓存：自定义头像拿到正式临时链接（本地临时路径可能失效），
    // 首页 onShow 重读缓存即显示新头像昵称
    try {
      const gp: any = await wx.cloud.callFunction({ name: 'userApi', data: { action: 'getProfile' } })
      const p = gp.result && gp.result.profile
      if (p) {
        try {
          const cached: any = uni.getStorageSync(PROFILE_CACHE_KEY) || {}
          uni.setStorageSync(PROFILE_CACHE_KEY, { ...cached, ...p })
        } catch {}
      }
    } catch {
      // 拉取失败则用本地值兜底
      try {
        const cached: any = uni.getStorageSync(PROFILE_CACHE_KEY) || {}
        uni.setStorageSync(PROFILE_CACHE_KEY, {
          ...cached,
          nickName: finalNick,
          avatarType: avatarType.value,
          avatarIndex: avatarIndex.value,
          avatarUrl: avatarType.value === 'custom' ? customUrl.value : null,
        })
      } catch {}
    }
    uni.showToast({ title: '已保存', icon: 'success' })
    setTimeout(() => uni.navigateBack({ delta: 1 }), 800)
  } catch (e: any) {
    uni.showToast({ title: '保存失败，请重试', icon: 'none' })
  } finally {
    saving.value = false
  }
}
</script>

<style>
.container { min-height: 100vh; background: #f5f5f5; padding-bottom: 60rpx; }
.sec { font-size: 24rpx; color: #aaa; margin: 36rpx 48rpx 16rpx; }
.avatar-grid { display: flex; flex-wrap: wrap; gap: 20rpx; margin: 0 32rpx; background: #fff; border-radius: 24rpx; padding: 28rpx; box-shadow: 0 4rpx 16rpx rgba(0,0,0,.05); }
.avatar-cell { width: 132rpx; height: 158rpx; border-radius: 18rpx; border: 4rpx solid transparent; display: flex; flex-direction: column; align-items: center; justify-content: center; background: #f7f7f7; position: relative; }
.avatar-cell.selected { border-color: #ffd60a; background: #fffbe8; }
.avatar-img { width: 104rpx; height: 104rpx; border-radius: 50%; }
.custom-plus { font-size: 52rpx; color: #bbb; }
.custom-label { font-size: 20rpx; color: #999; margin-top: 6rpx; }
.nick-row { margin: 0 32rpx; background: #fff; border-radius: 24rpx; padding: 8rpx 32rpx; box-shadow: 0 4rpx 16rpx rgba(0,0,0,.05); }
.nick-input { height: 88rpx; font-size: 30rpx; color: #2b1b4d; }
.save-btn { margin: 48rpx 32rpx 0; background: #ffd60a; color: #2b1b4d; font-weight: 700; border-radius: 24rpx; font-size: 30rpx; }
.save-btn[disabled] { opacity: .6; }
</style>
