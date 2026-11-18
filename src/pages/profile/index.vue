<template>
 <view class="profile-page">
  <view class="custom-nav" :style="{paddingTop:statusBarHeight+'px'}"><view class="custom-nav-body" :style="{height:navContentHeight+'px'}"><text class="nav-title">个人中心</text></view></view>
  <view class="profile-hero">
   <view class="hero-orbit orbit-one"/><view class="hero-orbit orbit-two"/>
   <view class="identity-row">
    <button class="avatar-button" @click="goEdit"><image class="avatar" :src="avatarUrl" mode="aspectFill"/><view class="avatar-edit"><ProfileIcon name="edit" tone="purple"/></view></button>
    <view class="identity-copy"><text class="hero-name">{{profile?.nickName||'学习者'}}</text><button class="edit-link" @click="goEdit">编辑资料</button></view>
    <button class="inbox-button" @click="goMessages"><view class="inbox-icon"><ProfileIcon name="bell" tone="white"/></view><text v-if="unreadCount" class="notification-dot">{{unreadCount>9?'9+':unreadCount}}</text></button>
   </view>
   <view class="hero-bottom">
    <view class="checkin-chip"><view class="chip-icon"><ProfileIcon name="flame" tone="red"/></view><text v-if="checkinTotal===null">每天进步一点</text><view v-else class="checkin-copy"><text>已坚持 </text><text class="checkin-day-count">{{checkinTotal}}</text><text> 天</text></view></view>
    <button class="hero-points" aria-label="我的积分" @click="goPoints"><view class="points-value"><text class="points-number">{{points}}</text><text class="points-unit">积分</text></view><view class="points-chevron"><ProfileIcon name="chevron" tone="white"/></view></button>
   </view>
  </view>

  <view class="snapshot"><view class="stat" @click="goHistory"><text class="stat-value">{{learning.totalMinutes}}</text><text class="stat-label">学习分钟</text></view><view class="stat" @click="goHistory"><text class="stat-value">{{learning.completedCount}}</text><text class="stat-label">完成课程</text></view><view class="stat" @click="goVocab"><text class="stat-value">{{vocabCount}}</text><text class="stat-label">收藏单词</text></view></view>

  <view class="section-heading"><text>最近学习</text><button @click="goHistory">学习记录 <view class="small-arrow"><ProfileIcon name="arrow" tone="muted"/></view></button></view>
  <button v-if="recentLesson" class="continue-card" @click="openRecent">
   <LessonCover class="continue-cover" :src="recentLesson.cover" compact />
   <view class="continue-copy"><text class="continue-kicker">{{recentLesson.completed?'已完成':'继续学习'}}</text><text class="continue-title">{{readableTitle(recentLesson.title).toUpperCase()}}</text><view class="continue-progress"><view :style="{width:progressPercent+'%'}"/></view><text class="continue-time">{{formatTime(recentLesson.position)}} <text class="time-divider">/</text> {{formatTime(recentLesson.duration)}}</text></view>
   <view class="continue-play"><image src="/static/play-dark.png" mode="aspectFit"/></view>
  </button>
  <button v-else class="start-card" @click="goCourses"><view class="start-icon"><ProfileIcon name="headphones" tone="purple"/></view><view><text class="start-title">开始学习</text><text class="start-caption">选一篇感兴趣的课程，开始听读。</text></view><view class="small-arrow"><ProfileIcon name="arrow"/></view></button>

  <view class="section-heading toolkit-heading"><text>学习工具</text></view>
  <view class="toolkit">
   <button class="tool-card" @click="goVocab"><view class="tile-top"><view class="tool-icon icon-green"><ProfileIcon name="book" tone="green"/></view><view class="tile-arrow"><ProfileIcon name="arrow" tone="muted"/></view></view><text class="tool-title">我的单词</text></button>
   <button class="tool-card" @click="goFavorites"><view class="tile-top"><view class="tool-icon icon-gold"><ProfileIcon name="bookmark" tone="gold"/></view><view class="tile-arrow"><ProfileIcon name="arrow" tone="muted"/></view></view><text class="tool-title">收藏课程</text></button>
   <button class="tool-card" @click="goImports"><view class="tile-top"><view class="tool-icon icon-purple"><ProfileIcon name="library"/></view><view class="tile-arrow"><ProfileIcon name="arrow" tone="muted"/></view></view><text class="tool-title">我的课程</text></button>
   <button class="tool-card" @click="goHistory"><view class="tile-top"><view class="tool-icon icon-neutral"><ProfileIcon name="history"/></view><view class="tile-arrow"><ProfileIcon name="arrow" tone="muted"/></view></view><text class="tool-title">学习记录</text></button>
  </view>

  <BottomNav active="profile"/>
 </view>
</template>
<script setup lang="ts">
import LessonCover from '@/components/LessonCover.vue';
import {ref,computed,watch} from 'vue';
import {onShow,onUnload} from '@dcloudio/uni-app';
import BottomNav from '@/components/BottomNav.vue';
import ProfileIcon from '@/components/ProfileIcon.vue';
import {useLearningStore} from '@/stores/learning';
import {useVocabStore} from '@/stores/vocab';
import {allPages} from '@/utils/api';
import {ensureDailyCheckin} from '@/utils/checkin';
import {cachedCover,localCover,loadCoverSources} from '@/utils/cover';
import {readableTitle} from '@/utils/catalogue';
import {formatTime} from '@/utils/format';
const learning=useLearningStore(),vocab=useVocabStore();learning.load();vocab.load();
const profile=ref<any>(null),points=ref(0),favCount=ref<number|null>(null),unreadCount=ref(0),checkinTotal=ref<number|null>(null),avatarUrl=ref('/static/avatars/rat.png');
const vocabCount=computed(()=>vocab.saved.length);
const recentLesson=computed(()=>learning.recent.find(p=>!p.completed)||learning.recent[0]);
const progressPercent=computed(()=>recentLesson.value?Math.min(100,recentLesson.value.position/Math.max(1,recentLesson.value.duration)*100):0);
const recentCover=ref(localCover());
let alive=true;
watch(()=>recentLesson.value?.cover,cover=>{recentCover.value=cachedCover(cover||'')||localCover();if(cover)void loadCoverSources([cover],(id,path)=>{if(alive&&recentLesson.value?.cover===id)recentCover.value=path})},{immediate:true});
const avatars=['rat','ox','tiger','rabbit','dragon','snake','horse','goat','monkey','rooster','dog','pig'];
const statusBarHeight=ref(20),navContentHeight=ref(44);
try{const info=uni.getWindowInfo();statusBarHeight.value=info.statusBarHeight||20;const menu=(wx as any).getMenuButtonBoundingClientRect();if(menu?.height)navContentHeight.value=(menu.top-statusBarHeight.value)*2+menu.height}catch{}
function applyProfile(p:any){if(!p)return;profile.value=p;points.value=p.points||0;avatarUrl.value=p.avatarType==='custom'&&p.avatarUrl?p.avatarUrl:`/static/avatars/${avatars[p.avatarIndex]||'rat'}.png`}
try{applyProfile(uni.getStorageSync('profileCacheV1'));const cached=uni.getStorageSync('checkinCacheV1');if(typeof cached?.totalDays==='number')checkinTotal.value=cached.totalDays}catch{}
async function load(){
 await Promise.allSettled([
  (async()=>{try{await ensureDailyCheckin()}catch{}const r:any=await wx.cloud.callFunction({name:'userApi',data:{action:'getProfile'}});if(alive&&r.result?.profile){applyProfile(r.result.profile);try{uni.setStorageSync('profileCacheV1',r.result.profile)}catch{}}})(),
  (async()=>{const list=await allPages('userApi','listFavorites');if(alive)favCount.value=list.length})(),
  (async()=>{const r:any=await wx.cloud.callFunction({name:'userApi',data:{action:'listMessages'}});if(alive)unreadCount.value=r.result?.unread||0})(),
  (async()=>{const r=await ensureDailyCheckin();if(alive&&r)checkinTotal.value=r.totalDays})()
 ]);
}
onShow(()=>{void load();void learning.sync()});onUnload(()=>{alive=false});
function goHistory(){uni.navigateTo({url:'/pages/profile/history'})}
function goSettings(){uni.navigateTo({url:'/pages/profile/settings'})}
function goMessages(){uni.navigateTo({url:'/pages/profile/messages'})}
function goEdit(){uni.navigateTo({url:'/pages/profile/edit'})}
function goPoints(){uni.navigateTo({url:'/pages/profile/points'})}
function goVocab(){uni.navigateTo({url:'/pages/profile/vocab'})}
function goFavorites(){uni.navigateTo({url:'/pages/profile/favorites'})}
function goImports(){try{uni.setStorageSync('gotoImportTab',1)}catch{}uni.reLaunch({url:'/pages/index/index'})}
function goCourses(){uni.reLaunch({url:'/pages/index/index?browse=1'})}
function openRecent(){if(recentLesson.value)uni.navigateTo({url:'/pages/lesson/detail?id='+encodeURIComponent(recentLesson.value.id)})}
</script>
<style scoped>
.profile-page{min-height:100vh;background:#faf9fc;padding:0 32rpx calc(190rpx + env(safe-area-inset-bottom));color:#2b1b40;box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,'PingFang SC',sans-serif}.custom-nav{margin:0 -32rpx;padding-left:32rpx;background:#faf9fc}.custom-nav-body{display:flex;align-items:center}.nav-title{font-size:34rpx;letter-spacing:-.4rpx;font-weight:600;color:#29183d}button{font-family:inherit;margin:0;line-height:1.35;padding:0;text-align:left;background:transparent;border:0;border-radius:0;box-sizing:border-box}button::after{border:0}.profile-hero{position:relative;overflow:hidden;background:linear-gradient(115deg,#311650,#190b30);border-radius:27rpx;margin-top:28rpx;padding:36rpx 32rpx 28rpx}.hero-orbit{position:absolute;border:1rpx solid rgba(255,255,255,.055);border-radius:50%;pointer-events:none}.orbit-one{width:310rpx;height:310rpx;right:-160rpx;top:-100rpx}.orbit-two{width:240rpx;height:240rpx;right:-105rpx;top:-65rpx}.identity-row{display:flex;align-items:center;gap:24rpx;position:relative}.avatar-button{width:105rpx;height:105rpx;min-width:105rpx;position:relative;overflow:visible}.avatar{width:100%;height:100%;border:4rpx solid rgba(255,255,255,.9);border-radius:50%;background:#fff;box-sizing:border-box}.avatar-edit{position:absolute;right:-3rpx;bottom:-1rpx;width:33rpx;height:33rpx;border-radius:50%;background:#ffcf00;padding:7rpx;border:2rpx solid #291243;box-sizing:border-box}.identity-copy{flex:1;min-width:0}.hero-eyebrow{display:block;color:#baa7cc;letter-spacing:0;font-size:20rpx;font-weight:400;margin-bottom:8rpx;white-space:nowrap}.hero-name{display:block;font-family:inherit;color:#fff;font-size:44rpx;font-weight:650;line-height:1.2;letter-spacing:-.4rpx;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.edit-link{display:flex;align-items:center;gap:7rpx;font-size:23rpx;color:#cdbbdb;margin-top:10rpx;min-height:32rpx;line-height:1.4}.tiny-icon{width:19rpx;height:19rpx;opacity:.65}.inbox-button{width:63rpx;height:63rpx;min-width:63rpx;border:1rpx solid #68517c;border-radius:19rpx;background:rgba(255,255,255,.04);display:flex;align-items:center;justify-content:center;position:relative;overflow:visible;align-self:flex-start;margin-top:3rpx}.inbox-icon{width:30rpx;height:30rpx;opacity:.85}.notification-dot{position:absolute;right:-7rpx;top:-7rpx;min-width:25rpx;height:25rpx;border-radius:15rpx;background:#ffcf00;color:#402648;padding:0 5rpx;font-size:16rpx;font-weight:650;text-align:center;line-height:25rpx}.hero-bottom{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;border-top:1rpx solid rgba(255,255,255,.12);margin-top:34rpx;padding-top:24rpx;gap:12rpx 20rpx;position:relative}.checkin-chip{white-space:nowrap;min-width:0;display:flex;align-items:center;gap:9rpx;font-size:24rpx;color:#e4d7ed;font-family:inherit;font-weight:550;line-height:1.4;letter-spacing:.1rpx}.chip-icon{width:34rpx;height:38rpx;flex:0 0 34rpx;opacity:1}.hero-signoff{font-family:Georgia,serif;font-style:italic;color:#a58cb9;font-size:22rpx}.snapshot{display:flex;background:#fff;border:1rpx solid #ece7f1;border-radius:21rpx;padding:32rpx 0;margin:28rpx 0 40rpx;box-shadow:0 6rpx 20rpx rgba(49,24,68,.025)}.stat{flex:1;display:flex;flex-direction:column;align-items:center;gap:7rpx;border-right:1rpx solid #eee9f2}.stat:last-child{border:0}.stat-value{font-family:inherit;font-size:44rpx;line-height:1;color:#412453;font-weight:650;letter-spacing:-.5rpx;font-variant-numeric:tabular-nums}.stat-label{font-size:22rpx;letter-spacing:0;color:#8c7c99;font-weight:400}.section-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:22rpx;font-size:25rpx;font-weight:550;letter-spacing:0;color:#7d688d;line-height:1.4}.section-heading button{display:flex;align-items:center;gap:8rpx;font-size:22rpx;color:#8c789c;font-weight:400;letter-spacing:0;min-height:36rpx}.small-arrow{height:23rpx;width:23rpx;flex:none}.continue-card{display:flex;align-items:center;width:100%;background:#fff;border:1rpx solid #eae3ef;border-radius:21rpx;padding:28rpx;gap:22rpx}.continue-cover{width:105rpx;height:118rpx;min-width:105rpx;border-radius:13rpx}.continue-copy{flex:1;min-width:0}.continue-kicker{display:block;font-size:19rpx;font-weight:600;letter-spacing:0;color:#9985a8;margin-bottom:8rpx;line-height:1.4}.continue-title{display:block;overflow:hidden;font-size:27rpx;line-height:1.35;color:#513762;font-weight:550;letter-spacing:-.2rpx;width:100%;min-width:0;white-space:nowrap;text-overflow:ellipsis}.continue-progress{height:4rpx;background:#eee7f4;border-radius:5rpx;overflow:hidden;margin:15rpx 0 8rpx}.continue-progress view{height:100%;background:#bea0d2;border-radius:5rpx}.continue-time{display:block;font-size:21rpx;color:#92809f;line-height:1.3;font-variant-numeric:tabular-nums}.time-divider{color:#d1c5d8;margin:0 5rpx}.continue-play{width:58rpx;height:58rpx;min-width:58rpx;background:#ffcf00;border-radius:50%;display:flex;align-items:center;justify-content:center;margin-left:1rpx}.continue-play image{width:23rpx;height:23rpx}.toolkit-heading{margin-top:40rpx}.toolkit{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22rpx}.tool-card{background:#fff;border:1rpx solid #ece6f1;border-radius:21rpx;padding:28rpx 24rpx 32rpx;min-width:0;min-height:168rpx}.tile-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:26rpx}.tool-icon{height:54rpx;width:54rpx;padding:13rpx;border-radius:16rpx;box-sizing:border-box}.icon-green{background:#eaf5ef}.icon-gold{background:#fff6d8}.icon-purple{background:#f0e9f7}.icon-neutral{background:#f1eef5}.tile-arrow{width:21rpx;height:21rpx;opacity:.55}.tool-title{display:block;color:#553d66;font-size:28rpx;font-weight:550;letter-spacing:-.2rpx;line-height:1.35;white-space:normal;word-break:normal;overflow-wrap:break-word}.points-value{display:flex;align-items:baseline;gap:6rpx;min-width:0;font-family:inherit;font-size:34rpx;font-weight:650;letter-spacing:-.4rpx;line-height:1.2;color:#ffe274;font-variant-numeric:tabular-nums}.points-unit{font-family:inherit;font-size:22rpx;font-weight:400;letter-spacing:0;color:#d8c9e3;line-height:1.2}.points-chevron{width:22rpx;height:22rpx;flex:0 0 22rpx;opacity:.8}.profile-footer{display:flex;align-items:center;justify-content:center;gap:17rpx;font-size:14rpx;letter-spacing:2.1rpx;color:#c8bdcf;margin:25rpx 0 5rpx}.footer-rule{height:1rpx;width:32rpx;background:#e5dcea}.start-card{display:flex;align-items:center;gap:19rpx;background:#fff;border:1rpx solid #ece5f3;border-radius:21rpx;padding:27rpx 23rpx}.start-icon{width:43rpx;height:43rpx;min-width:43rpx}.start-title{display:block;color:#644378;font-family:inherit;font-size:29rpx;line-height:1.35;font-weight:550}.start-caption{display:block;color:#92829e;font-size:22rpx;margin-top:9rpx}
.hero-points{display:flex;align-items:center;justify-content:flex-end;gap:8rpx;min-height:36px;margin-left:auto;padding:0;flex:0 0 auto;max-width:100%;font-family:inherit;background:transparent;white-space:nowrap;overflow:visible}
.points-number{font-family:inherit;font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* Let short screens scroll naturally; retain comfortable gutters on narrow devices. */
@media(max-width:350px){
 .profile-page{padding-left:28rpx;padding-right:28rpx}
 .custom-nav{margin-left:-28rpx;margin-right:-28rpx;padding-left:28rpx}
 .profile-hero{padding:32rpx 28rpx 26rpx}
 .identity-row{gap:20rpx}
 .toolkit{gap:20rpx}
 .tool-card{padding-left:22rpx;padding-right:22rpx}
}
</style>

<style scoped>
/* Natural Chinese rhythm; keep the existing profile structure and bottom navigation. */
.profile-page .nav-title{font-size:19px;font-weight:600;line-height:1.4;letter-spacing:0}
.identity-copy{display:flex;flex-direction:column;justify-content:center}
.hero-name{font-size:25px;line-height:1.25;font-weight:650;letter-spacing:0}
.edit-link{font-size:13px;line-height:1.5;margin-top:8px;letter-spacing:0;min-height:24px}
.checkin-chip{font-size:13px;font-weight:550;line-height:1.5;letter-spacing:0;gap:5px}
.points-unit{font-size:12px;letter-spacing:0}
.stat-label{font-size:12px;font-weight:400;line-height:1.5;letter-spacing:0}
.section-heading{font-size:15px;font-weight:600;line-height:1.5;letter-spacing:0}
.section-heading button{font-size:12px;font-weight:400;line-height:1.5;letter-spacing:0}
.continue-kicker{font-size:11px;font-weight:500;line-height:1.5;letter-spacing:0}
.tool-title{font-size:16px;font-weight:550;line-height:1.5;letter-spacing:0}
.start-title{font-size:16px;font-weight:600;line-height:1.5;letter-spacing:0}
.start-caption{font-size:12px;line-height:1.7;letter-spacing:0}
@media(max-width:350px){.checkin-chip{font-size:12px}.tool-title{font-size:15px}}
</style>

<style scoped>
/* Align section labels with the inset content of the cards below. */
.section-heading{padding-left:12px;padding-right:12px;box-sizing:border-box}
</style>

<style scoped>
/* Calm the identity and learning-day hierarchy without changing the hero layout. */
.identity-copy{align-self:center;justify-content:center}
.edit-link{margin-top:5px;font-size:12px;font-weight:400;line-height:1.5;min-height:22px;color:#baa7cc}
.hero-bottom{align-items:center}
.checkin-chip{gap:6px;font-size:13px;font-weight:400;line-height:1.5;letter-spacing:0;align-items:center}
.chip-icon{width:17px;height:20px;flex:0 0 17px}
.checkin-copy{display:flex;align-items:baseline;white-space:pre;line-height:1.5}
.checkin-day-count{font-weight:600;font-variant-numeric:tabular-nums}
@media(max-width:350px){.checkin-chip{font-size:12px}}
</style>
