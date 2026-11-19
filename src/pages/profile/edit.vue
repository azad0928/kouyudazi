<template>
  <view class="container">
    <!-- AVATAR -->
    <view class="sec">AVATAR</view>
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
        <text class="custom-label">Custom</text>
      </view>
    </view>

    <!-- YOUR NAME -->
    <view class="sec">YOUR NAME</view>
    <view class="nick-row">
      <input class="nick-input" v-model="nickName" placeholder="Your name" maxlength="20" />
    </view>

    <button class="save-btn" :disabled="saving" @click="onSave">Save</button>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
const DEFAULT_AVATARS = ['rat', 'ox', 'tiger', 'rabbit', 'dragon', 'snake', 'horse', 'goat', 'monkey', 'rooster', 'dog', 'pig'];
const PROFILE_CACHE_KEY = 'profileCacheV1';
const avatars = DEFAULT_AVATARS;
const nickName = ref('');
const avatarType = ref<'default' | 'custom'>('default');
const avatarIndex = ref(0);
const customUrl = ref(''); // 本地临时路径（选了未Save）或Saved的云端地址
const customFileID = ref(''); // Saved的云文件 ID（未改则复用，不重复上传）
const openid = ref('');
const saving = ref(false);
function pickDefault(i: number) {
  avatarType.value = 'default';
  avatarIndex.value = i;
}
async function pickCustom() {
  try {
    const r: any = await uni.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera']
    });
    const path = r.tempFilePaths && r.tempFilePaths[0];
    if (path) {
      avatarType.value = 'custom';
      customUrl.value = path;
      customFileID.value = ''; // 换了新图，Save时重新上传
    }
  } catch {}
}
onLoad(async () => {
  try {
    const cached: any = uni.getStorageSync(PROFILE_CACHE_KEY);
    if (cached && cached.nickName) {
      nickName.value = cached.nickName;
      avatarType.value = cached.avatarType === 'custom' ? 'custom' : 'default';
      avatarIndex.value = cached.avatarIndex || 0;
      if (cached.avatarType === 'custom' && cached.avatarUrl) {
        customUrl.value = cached.avatarUrl;
      }
    }
  } catch {}
  try {
    const res: any = await wx.cloud.callFunction({
      name: 'userApi',
      data: {
        action: 'getProfile'
      }
    });
    openid.value = res.result && res.result.openid || '';
    const p = res.result && res.result.profile;
    if (p) {
      nickName.value = p.nickName || nickName.value;
      avatarType.value = p.avatarType === 'custom' ? 'custom' : 'default';
      avatarIndex.value = p.avatarIndex || 0;
      if (p.avatarFileID) customFileID.value = p.avatarFileID;
    }
  } catch {}
});
async function onSave() {
  if (saving.value) return;
  const finalNick = (nickName.value || '').trim();
  if (!finalNick) {
    uni.showToast({
      title: 'Your name',
      icon: 'none'
    });
    return;
  }
  saving.value = true;
  try {
    let fileID = customFileID.value;
    if (avatarType.value === 'custom' && !fileID) {
      // 本地刚选的新图（tempFilePath）才需要上传；云端临时链接不能直接上传
      if (!customUrl.value || customUrl.value.startsWith('http')) throw new Error('Choose an avatar image');
      const up: any = await wx.cloud.uploadFile({
        cloudPath: `avatars/${openid.value || Date.now()}.png`,
        filePath: customUrl.value
      });
      fileID = up.fileID;
    }
    await wx.cloud.callFunction({
      name: 'userApi',
      data: {
        action: 'saveProfile',
        profileEdit: true,
        nickName: finalNick,
        avatarType: avatarType.value,
        avatarIndex: avatarIndex.value,
        avatarFileID: avatarType.value === 'custom' ? fileID : ''
      }
    });
    // 从云端拉 fresh 资料再缓存：CustomAVATAR拿到正式临时链接（本地临时路径可能失效），
    // 首页 onShow 重读缓存即显示新AVATARYOUR NAME
    try {
      const gp: any = await wx.cloud.callFunction({
        name: 'userApi',
        data: {
          action: 'getProfile'
        }
      });
      const p = gp.result && gp.result.profile;
      if (p) {
        try {
          const cached: any = uni.getStorageSync(PROFILE_CACHE_KEY) || {};
          uni.setStorageSync(PROFILE_CACHE_KEY, {
            ...cached,
            ...p,
            profileEditedAt: Date.now()
          });
        } catch {}
      }
    } catch {
      // 拉取失败则用本地值兜底
      try {
        const cached: any = uni.getStorageSync(PROFILE_CACHE_KEY) || {};
        uni.setStorageSync(PROFILE_CACHE_KEY, {
          ...cached,
          profileEditedAt: Date.now(),
          nickName: finalNick,
          avatarType: avatarType.value,
          avatarIndex: avatarIndex.value,
          avatarUrl: avatarType.value === 'custom' ? customUrl.value : null
        });
      } catch {}
    }
    uni.showToast({
      title: 'Saved',
      icon: 'success'
    });
    setTimeout(() => uni.navigateBack({
      delta: 1
    }), 800);
  } catch (e: any) {
    uni.showToast({
      title: 'Unable to save. Try again.',
      icon: 'none'
    });
  } finally {
    saving.value = false;
  }
}
</script>

<style>
.container { min-height: 100vh; background: #f5f5f5; padding-bottom: 60rpx; }
.sec { font-size: 24rpx; color: #aaa; margin: 36rpx 48rpx 16rpx; }
.avatar-grid { display: flex; flex-wrap: wrap; gap: 20rpx; margin: 0 32rpx; background: #fff; border-radius: 24rpx; padding: 28rpx; box-shadow: 0 4rpx 16rpx rgba(0,0,0,.05); }
.avatar-cell { width: 132rpx; height: 158rpx; border-radius: 18rpx; border: 4rpx solid transparent; display: flex; flex-direction: column; align-items: center; justify-content: center; background: #f7f7f7; position: relative; }
.avatar-cell.selected { border-color: #ffcf00; background: #fffbe8; }
.avatar-img { width: 104rpx; height: 104rpx; border-radius: 50%; }
.custom-plus { font-size: 52rpx; color: #bbb; }
.custom-label { font-size: 20rpx; color: #999; margin-top: 6rpx; }
.nick-row { margin: 0 32rpx; background: #fff; border-radius: 24rpx; padding: 8rpx 32rpx; box-shadow: 0 4rpx 16rpx rgba(0,0,0,.05); }
.nick-input { height: 88rpx; font-size: 30rpx; color: #281247; }
.save-btn { margin: 48rpx 32rpx 0; background: #ffcf00; color: #281247; font-weight: 700; border-radius: 24rpx; font-size: 30rpx; }
.save-btn[disabled] { opacity: .6; }
</style>

<style scoped>
.container,.settings,.history{background:#ffffff;min-height:100vh;padding:30rpx 30rpx 80rpx}.intro-title,.title{font-family:inherit;color:#281247;font-size:49rpx;font-weight:700;letter-spacing:-1.5rpx;line-height:1.12;white-space:pre-line}.intro-desc,.intro-note{color:#8c9b7e;font-size:24rpx;line-height:1.65}.card,.quota-card,.buy-card,.file-card,.import-record,.menu,.balance{background:#fff;border:1rpx solid #e5e2ec;border-radius:21rpx;box-shadow:none;padding:27rpx}.heading,.quota-title,.buy-title{font-size:28rpx;font-weight:650;letter-spacing:-.4rpx;color:#3b5634}.sec{font-size:19rpx;letter-spacing:1.4rpx;color:#93a182}.note,.quota-note,.buy-note,.step,.quota-text,.meta,.sync{font-size:23rpx;line-height:1.7;color:#8a9c77}.row,.item{font-size:25rpx;color:#5b754b;border-color:#edf1e5;min-height:94rpx}.step text:first-child{color:#4f703e}.primary,.pick-btn,.upload-btn,.save-btn,.back,.learn-btn{background:#281247;color:#fff;border-radius:15rpx;font-size:25rpx;padding:24rpx;font-family:inherit}.feedback,.back-btn,.redeem-btn,.buy-btn{background:#fff4c2;color:#5a7641;border-radius:14rpx;font-size:24rpx}.empty{background:#f0f4e6;color:#8c9d7b;border-radius:21rpx;font-size:25rpx;line-height:1.7;padding:60rpx 28rpx}.name,.record-title{font-family:inherit;font-size:30rpx;color:#3f5c35;font-weight:600;line-height:1.4}.nick-input,.search{background:#fff;border:1rpx solid #dde7d1;border-radius:15rpx;font-size:26rpx;padding:23rpx}.count-row,.stats{font-size:23rpx;color:#8a9b79}.filters .active,.active{color:#496939}.track{background:#f4f1f8}.track view{background:#f2ca26}.version{color:#a7b298;font-size:18rpx;letter-spacing:2rpx}.preview{background:#f5f7ef;border-radius:14rpx;color:#80956b}.import-intro{margin:5rpx 0 32rpx}.intro-note{font-size:21rpx;color:#a1ad93}.balance-num{color:#46653a}.unit{font-size:22rpx}.buy-name{font-size:27rpx;color:#4f6d3f}.buy-desc{font-size:22rpx;color:#92a37e}
</style>

<style scoped>
/* Native input text is centered by its explicit height, without vertical padding. */
.nick-row{display:flex;align-items:center;padding:8rpx 32rpx;box-sizing:border-box}.nick-input{flex:1;min-width:0;width:100%;height:88rpx;min-height:44px;line-height:normal;padding:0 22rpx;box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;font-size:30rpx;font-weight:400;letter-spacing:0;text-align:left}
</style>
