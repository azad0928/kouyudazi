<template>
  <view class="container">
    <view class="count-row">已收藏 {{ list.length }} 门课程</view>
    <view v-if="loading" class="empty">正在加载…</view>
    <view v-else-if="error && !list.length" class="empty" @click="load">{{error}} · 点击重试</view>
    <view v-else-if="!list.length" class="empty">收藏喜欢的课程，随时回来继续学习。</view>
    <view v-else class="cards">
      <view v-for="f in list" :key="f._id" class="card" @click="goDetail(f.lessonId)">
        <LessonCover class="card-img" :src="f.cover" compact />
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
import LessonCover from '@/components/LessonCover.vue';
import { allPages } from '@/utils/api';
import { ref } from 'vue';
import { onLoad, onShow, onPullDownRefresh } from '@dcloudio/uni-app';
const list = ref<any[]>([]);
const loading = ref(true), error = ref(''), busy = ref('');
let loadVersion = 0;
onLoad(() => uni.setNavigationBarTitle({title:'收藏课程'}));
async function refreshCovers(records: any[], version: number) {
  // A favourite stores a snapshot; resolve the current lesson cover after replacement/migration.
  // 串行逐条刷新会让后面的课程封面等十几秒；改为有限并发（4），避免云函数调用被限流。
  const CONCURRENCY = 4;
  let cursor = 0;
  async function worker() {
    while (cursor < records.length) {
      const record = records[cursor++];
      if (version !== loadVersion) return;
      try {
        const response: any = await wx.cloud.callFunction({name:'importApi',data:{action:'getLesson',lessonId:record.lessonId}});
        if (version !== loadVersion) return;
        const current = response.result?.lesson;
        if (current?.cover) record.cover = current.cover;
      } catch { /* Keep the saved cover when the lesson cannot be refreshed. */ }
    }
  }
  await Promise.all(Array.from({length:Math.min(CONCURRENCY,records.length)},worker));
}
async function load() {
  const version = ++loadVersion;
  loading.value = true;
  try {
    error.value = '';
    const records = await allPages('userApi', 'listFavorites');
    if (version !== loadVersion) return;
    list.value = records;
    void refreshCovers(list.value, version);
  } catch {
    error.value = '收藏课程加载失败';
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
      title: '已取消收藏',
      icon: 'none'
    });
  } catch {
    uni.showToast({
      title: '操作失败，请稍后重试。',
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

<style scoped>
.container{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}.count-row{margin:8px 16px 14px;font-size:13px;line-height:1.6;color:#94859f}.cards{margin:0 8px}.card{padding:14px;gap:12px}.card-img{width:76px;height:62px;border-radius:9px;overflow:hidden}.card-body{min-width:0;margin-left:0}.card-title{font-size:15px;font-weight:600;line-height:1.45;letter-spacing:0}.card-level{font-size:12px;color:#9789a2}.unfav{font-size:20px;padding:8px;flex-shrink:0}.empty{background:#faf7fc;color:#94859f;font-size:14px;line-height:1.8}
</style>
