<template>
  <view class="container">
    <view class="count-row">{{ list.length }} saved lessons</view>
    <view v-if="loading" class="empty">Loading…</view>
    <view v-else-if="error && !list.length" class="empty" @click="load">{{error}} · Tap to retry</view>
    <view v-else-if="!list.length" class="empty">Keep your favourites close.<br />Save a lesson to find it here.</view>
    <view v-else class="cards">
      <view v-for="f in list" :key="f._id" class="card" @click="goDetail(f.lessonId)">
        <CoverImage class="card-img" :src="f.cover" />
        <view class="card-body">
          <text class="card-title">{{ f.title }}</text>
          <text v-if="f.level" class="card-level">{{ f.level }}</text>
        </view>
        <text class="unfav" @click.stop="unfav(f)">❤️</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import CoverImage from '@/components/CoverImage.vue';
import { allPages } from '@/utils/api';
import { ref } from 'vue';
import { onShow, onPullDownRefresh } from '@dcloudio/uni-app';
import { localCover, cachedCover, loadCoverSources, invalidateCover } from '@/utils/cover';
const list = ref<any[]>([]);
const loading = ref(true),
  error = ref(''),
  busy = ref('');
const coverUrlMap = ref<Record<string, string>>({});
// 失败次数 >1 判定为「云存储文件缺失」，改用本地兜底图（换地址救不回来）
const coverFailCount = ref<Record<string, number>>({});
function coverSrc(src?:string|null):string {
 if(!src || (coverFailCount.value[src]||0)>1)return localCover();
 return coverUrlMap.value[src] || cachedCover(src) || localCover();
}
async function onCoverError(src?:string|null){
 if(!src?.startsWith('cloud://'))return;
 coverFailCount.value={...coverFailCount.value,[src]:(coverFailCount.value[src]||0)+1};
 invalidateCover(src); const next={...coverUrlMap.value}; delete next[src];coverUrlMap.value=next;
 if(coverFailCount.value[src]<2)await ensureCoverUrls();
}
async function onCoverVisible(id?:string|null){
 if(!id || coverUrlMap.value[id] || (coverFailCount.value[id]||0)>1)return;
 await loadCoverSources([id],(key,source)=>{coverUrlMap.value={...coverUrlMap.value,[key]:source}});
}
async function ensureCoverUrls(){
 await loadCoverSources(list.value.slice(0,6).map(f=>f.cover).filter(id=>id && (coverFailCount.value[id]||0)<2), (id,source)=>{
 coverUrlMap.value={...coverUrlMap.value,[id]:source};
 });
}
async function load() {
  loading.value = true;
  try {
    error.value = '';
    list.value = await allPages('userApi', 'listFavorites');
    void ensureCoverUrls();
  } catch {
    error.value = 'Unable to load saved lessons';
  } finally {
    loading.value = false;
  }
}
onShow(() => {
  load();
});
onPullDownRefresh(async () => {
  await load();
  uni.stopPullDownRefresh();
});
function goDetail(lessonId: string) {
  if (!lessonId) return;
  uni.navigateTo({
    url: `/pages/lesson/detail?id=${lessonId}`
  });
}
async function unfav(f: any) {
  if (busy.value) return;
  busy.value = f._id;
  try {
    await wx.cloud.callFunction({
      name: 'userApi',
      data: {
        action: 'setFavorite',
        favored: false,
        lessonId: f.lessonId
      }
    });
    list.value = list.value.filter(x => x._id !== f._id);
    uni.showToast({
      title: 'Removed from saved lessons',
      icon: 'none'
    });
  } catch {
    uni.showToast({
      title: 'Unable to complete this action. Try again.',
      icon: 'none'
    });
  } finally {
    busy.value = '';
  }
}
</script>

<style>
.container { min-height: 100vh; background: #f5f5f5; padding-bottom: 40rpx; }
.count-row { font-size: 24rpx; color: #aaa; margin: 24rpx 48rpx 12rpx; }
.empty { text-align: center; color: #aaa; font-size: 26rpx; margin-top: 100rpx; line-height: 2; }
.cards { margin: 0 32rpx; }
.card { display: flex; align-items: center; background: #fff; border-radius: 24rpx; padding: 24rpx; margin-bottom: 20rpx; box-shadow: 0 4rpx 16rpx rgba(0,0,0,.05); }
.card-img { width: 140rpx; height: 100rpx; border-radius: 14rpx; background: #eee; flex-shrink: 0; }
.card-body { flex: 1; margin-left: 24rpx; display: flex; flex-direction: column; }
.card-title { font-size: 28rpx; font-weight: 700; color: #281247; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.card-level { font-size: 22rpx; color: #77877b; margin-top: 8rpx; }
.unfav { font-size: 36rpx; padding: 12rpx; }
</style>

<style scoped>
.container,.settings,.history{background:#ffffff;min-height:100vh;padding:30rpx 30rpx 80rpx}.intro-title,.title{font-family:inherit;color:#281247;font-size:49rpx;font-weight:700;letter-spacing:-1.5rpx;line-height:1.12;white-space:pre-line}.intro-desc,.intro-note{color:#8c9b7e;font-size:24rpx;line-height:1.65}.card,.quota-card,.buy-card,.file-card,.import-record,.menu,.balance{background:#fff;border:1rpx solid #e5e2ec;border-radius:21rpx;box-shadow:none;padding:27rpx}.heading,.quota-title,.buy-title{font-size:28rpx;font-weight:650;letter-spacing:-.4rpx;color:#3b5634}.sec{font-size:19rpx;letter-spacing:1.4rpx;color:#93a182}.note,.quota-note,.buy-note,.step,.quota-text,.meta,.sync{font-size:23rpx;line-height:1.7;color:#8a9c77}.row,.item{font-size:25rpx;color:#5b754b;border-color:#edf1e5;min-height:94rpx}.step text:first-child{color:#4f703e}.primary,.pick-btn,.upload-btn,.save-btn,.back,.learn-btn{background:#281247;color:#fff;border-radius:15rpx;font-size:25rpx;padding:24rpx;font-family:inherit}.feedback,.back-btn,.redeem-btn,.buy-btn{background:#fff4c2;color:#5a7641;border-radius:14rpx;font-size:24rpx}.empty{background:#f0f4e6;color:#8c9d7b;border-radius:21rpx;font-size:25rpx;line-height:1.7;padding:60rpx 28rpx}.name,.record-title{font-family:inherit;font-size:30rpx;color:#3f5c35;font-weight:600;line-height:1.4}.nick-input,.search{background:#fff;border:1rpx solid #dde7d1;border-radius:15rpx;font-size:26rpx;padding:23rpx}.count-row,.stats{font-size:23rpx;color:#8a9b79}.filters .active,.active{color:#496939}.track{background:#f4f1f8}.track view{background:#f2ca26}.version{color:#a7b298;font-size:18rpx;letter-spacing:2rpx}.preview{background:#f5f7ef;border-radius:14rpx;color:#80956b}.import-intro{margin:5rpx 0 32rpx}.intro-note{font-size:21rpx;color:#a1ad93}.balance-num{color:#46653a}.unit{font-size:22rpx}.buy-name{font-size:27rpx;color:#4f6d3f}.buy-desc{font-size:22rpx;color:#92a37e}
</style>
