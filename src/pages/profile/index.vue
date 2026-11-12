<template>
 <view class="profile-page">
  <view class="custom-nav" :style="{paddingTop:statusBarHeight+'px'}"><view class="custom-nav-body" :style="{height:navContentHeight+'px'}"><text class="nav-title">Your space</text></view></view>
  <view class="profile-hero">
   <view class="hero-orbit orbit-one"/><view class="hero-orbit orbit-two"/>
   <view class="identity-row">
    <button class="avatar-button" @click="goEdit"><image class="avatar" :src="avatarUrl" mode="aspectFill"/><view class="avatar-edit"><ProfileIcon name="edit" tone="purple"/></view></button>
    <view class="identity-copy"><text class="hero-eyebrow">YOUR LEARNING JOURNEY</text><text class="hero-name">{{profile?.nickName||'Hello, listener'}}</text><button class="edit-link" @click="goEdit">Edit profile <view class="tiny-icon"><ProfileIcon name="arrow" tone="white"/></view></button></view>
    <button class="inbox-button" @click="goMessages"><view class="inbox-icon"><ProfileIcon name="bell" tone="white"/></view><text v-if="unreadCount" class="notification-dot">{{unreadCount>9?'9+':unreadCount}}</text></button>
   </view>
   <view class="hero-bottom"><view class="checkin-chip"><view class="chip-icon"><ProfileIcon name="calendar" tone="white"/></view><text>{{checkinTotal===null?'A little practice, every day':checkinTotal+' days checked in'}}</text></view><text class="hero-signoff">Keep your rhythm.</text></view>
  </view>

  <view class="snapshot"><view class="stat" @click="goHistory"><text class="stat-value">{{learning.totalMinutes}}</text><text class="stat-label">MINUTES</text></view><view class="stat" @click="goHistory"><text class="stat-value">{{learning.completedCount}}</text><text class="stat-label">LESSONS</text></view><view class="stat" @click="goVocab"><text class="stat-value">{{vocabCount}}</text><text class="stat-label">WORDS</text></view></view>

  <view class="section-heading"><text>BACK TO YOUR PRACTICE</text><button @click="goHistory">History <view class="small-arrow"><ProfileIcon name="arrow" tone="muted"/></view></button></view>
  <button v-if="recentLesson" class="continue-card" @click="openRecent">
   <CoverImage class="continue-cover" :src="recentLesson.cover" compact />
   <view class="continue-copy"><text class="continue-kicker">{{recentLesson.completed?'RECENTLY COMPLETED':'CONTINUE LISTENING'}}</text><text class="continue-title">{{readableTitle(recentLesson.title)}}</text><view class="continue-progress"><view :style="{width:progressPercent+'%'}"/></view><text class="continue-time">{{formatTime(recentLesson.position)}} <text class="time-divider">/</text> {{formatTime(recentLesson.duration)}}</text></view>
   <view class="continue-play"><image src="/static/play-dark.png" mode="aspectFit"/></view>
  </button>
  <button v-else class="start-card" @click="goCourses"><view class="start-icon"><ProfileIcon name="headphones" tone="purple"/></view><view><text class="start-title">YOUR NEXT CHAPTER STARTS HERE.</text><text class="start-caption">Find a lesson. Make a little progress.</text></view><view class="small-arrow"><ProfileIcon name="arrow"/></view></button>

  <view class="section-heading toolkit-heading"><text>YOUR LEARNING TOOLKIT</text></view>
  <view class="toolkit">
   <button class="tool-card" @click="goVocab"><view class="tile-top"><view class="tool-icon icon-green"><ProfileIcon name="book" tone="green"/></view><view class="tile-arrow"><ProfileIcon name="arrow" tone="muted"/></view></view><text class="tool-title">Vocabulary</text><text class="tool-caption">{{vocabCount}} {{vocabCount===1?'word':'words'}} to make yours</text></button>
   <button class="tool-card" @click="goFavorites"><view class="tile-top"><view class="tool-icon icon-gold"><ProfileIcon name="bookmark" tone="gold"/></view><view class="tile-arrow"><ProfileIcon name="arrow" tone="muted"/></view></view><text class="tool-title">Saved lessons</text><text class="tool-caption">{{favCount===null?'Your favourites, together':favCount+' '+(favCount===1?'lesson':'lessons')+' for later'}}</text></button>
   <button class="tool-card" @click="goImports"><view class="tile-top"><view class="tool-icon icon-purple"><ProfileIcon name="library"/></view><view class="tile-arrow"><ProfileIcon name="arrow" tone="muted"/></view></view><text class="tool-title">My Library</text><text class="tool-caption">Your articles. Your listening.</text></button>
   <button class="tool-card" @click="goHistory"><view class="tile-top"><view class="tool-icon icon-neutral"><ProfileIcon name="history"/></view><view class="tile-arrow"><ProfileIcon name="arrow" tone="muted"/></view></view><text class="tool-title">Listening history</text><text class="tool-caption">Every listen counts.</text></button>
  </view>

  <button class="points-card" @click="goPoints"><view class="points-icon"><ProfileIcon name="coins" tone="gold"/></view><view class="points-copy"><text class="points-title">Your learning rewards</text><text class="points-caption">Check in. Collect points.</text></view><view class="points-value"><text>{{points}}</text><text class="points-unit">pts</text></view><view class="points-chevron"><ProfileIcon name="chevron" tone="gold"/></view></button>
  <button class="settings-card" @click="goSettings"><view class="settings-icon"><ProfileIcon name="settings" tone="muted"/></view><view><text class="settings-title">Make it your own</text><text class="settings-caption">Preferences, help & feedback</text></view><view class="settings-chevron"><ProfileIcon name="chevron" tone="muted"/></view></button>
  <view class="profile-footer"><view class="footer-rule"/><text>LISTEN. REPEAT. LEARN.</text><view class="footer-rule"/></view>
  <BottomNav active="profile"/>
 </view>
</template>
<script setup lang="ts">
import CoverImage from '@/components/CoverImage.vue';
import {ref,computed,watch} from 'vue';
import {onShow,onUnload} from '@dcloudio/uni-app';
import BottomNav from '@/components/BottomNav.vue';
import ProfileIcon from '@/components/ProfileIcon.vue';
import {useLearningStore} from '@/stores/learning';
import {useVocabStore} from '@/stores/vocab';
import {allPages} from '@/utils/api';
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
  (async()=>{const r:any=await wx.cloud.callFunction({name:'userApi',data:{action:'getProfile'}});if(alive&&r.result?.profile){applyProfile(r.result.profile);try{uni.setStorageSync('profileCacheV1',r.result.profile)}catch{}}})(),
  (async()=>{const list=await allPages('userApi','listFavorites');if(alive)favCount.value=list.length})(),
  (async()=>{const r:any=await wx.cloud.callFunction({name:'userApi',data:{action:'listMessages'}});if(alive)unreadCount.value=r.result?.unread||0})(),
  (async()=>{const r:any=await wx.cloud.callFunction({name:'checkinApi',data:{action:'getStatus'}});if(alive&&typeof r.result?.totalDays==='number')checkinTotal.value=r.result.totalDays})()
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
.profile-page{min-height:100vh;background:#faf9fc;padding:0 28rpx calc(155rpx + env(safe-area-inset-bottom));color:#2b1b40;box-sizing:border-box}.custom-nav{margin:0 -28rpx;padding-left:30rpx;background:#faf9fc}.custom-nav-body{display:flex;align-items:center}.nav-title{font-size:32rpx;letter-spacing:-.6rpx;font-weight:650;color:#29183d}button{font-family:inherit;margin:0;line-height:1.35;padding:0;text-align:left;background:transparent;border:0;border-radius:0;box-sizing:border-box}button::after{border:0}.profile-hero{position:relative;overflow:hidden;background:linear-gradient(115deg,#311650,#190b30);border-radius:27rpx;margin-top:22rpx;padding:30rpx 28rpx 24rpx}.hero-orbit{position:absolute;border:1rpx solid rgba(255,255,255,.055);border-radius:50%;pointer-events:none}.orbit-one{width:310rpx;height:310rpx;right:-160rpx;top:-100rpx}.orbit-two{width:240rpx;height:240rpx;right:-105rpx;top:-65rpx}.identity-row{display:flex;align-items:center;gap:21rpx;position:relative}.avatar-button{width:105rpx;height:105rpx;min-width:105rpx;position:relative;overflow:visible}.avatar{width:100%;height:100%;border:4rpx solid rgba(255,255,255,.9);border-radius:50%;background:#fff;box-sizing:border-box}.avatar-edit{position:absolute;right:-3rpx;bottom:-1rpx;width:33rpx;height:33rpx;border-radius:50%;background:#ffcf00;padding:7rpx;border:2rpx solid #291243;box-sizing:border-box}.identity-copy{flex:1;min-width:0}.hero-eyebrow{display:block;color:#b09ac6;letter-spacing:2rpx;font-size:15rpx;font-weight:500;margin-bottom:9rpx;white-space:nowrap}.hero-name{display:block;font-family:ListHeading,sans-serif;color:#fff;font-size:49rpx;font-weight:700;line-height:1.05;letter-spacing:.4rpx;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.edit-link{display:flex;align-items:center;gap:7rpx;font-size:21rpx;color:#c3afd7;margin-top:10rpx;min-height:32rpx}.tiny-icon{width:19rpx;height:19rpx;opacity:.65}.inbox-button{width:63rpx;height:63rpx;min-width:63rpx;border:1rpx solid #68517c;border-radius:19rpx;background:rgba(255,255,255,.04);display:flex;align-items:center;justify-content:center;position:relative;overflow:visible;align-self:flex-start;margin-top:3rpx}.inbox-icon{width:30rpx;height:30rpx;opacity:.85}.notification-dot{position:absolute;right:-7rpx;top:-7rpx;min-width:25rpx;height:25rpx;border-radius:15rpx;background:#ffcf00;color:#402648;padding:0 5rpx;font-size:16rpx;font-weight:650;text-align:center;line-height:25rpx}.hero-bottom{display:flex;align-items:center;justify-content:space-between;border-top:1rpx solid rgba(255,255,255,.12);margin-top:29rpx;padding-top:20rpx;gap:10rpx;position:relative}.checkin-chip{display:flex;align-items:center;gap:9rpx;font-size:20rpx;color:#d1bfdc}.chip-icon{width:22rpx;height:22rpx;opacity:.65}.hero-signoff{font-family:Georgia,serif;font-style:italic;color:#a58cb9;font-size:22rpx}.snapshot{display:flex;background:#fff;border:1rpx solid #ece7f1;border-radius:21rpx;padding:24rpx 0;margin:18rpx 0 29rpx;box-shadow:0 6rpx 20rpx rgba(49,24,68,.025)}.stat{flex:1;display:flex;flex-direction:column;align-items:center;gap:7rpx;border-right:1rpx solid #eee9f2}.stat:last-child{border:0}.stat-value{font-family:ListHeading,sans-serif;font-size:42rpx;line-height:1;color:#412453;font-weight:700}.stat-label{font-size:16rpx;letter-spacing:1.7rpx;color:#a598b1;font-weight:500}.section-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:16rpx;font-size:18rpx;font-weight:600;letter-spacing:1.3rpx;color:#a697b2}.section-heading button{display:flex;align-items:center;gap:8rpx;font-size:20rpx;color:#a08cad;font-weight:400;letter-spacing:0;min-height:36rpx}.small-arrow{height:23rpx;width:23rpx;flex:none}.continue-card{display:flex;align-items:center;width:100%;background:#fff;border:1rpx solid #eae3ef;border-radius:21rpx;padding:22rpx;gap:18rpx}.continue-cover{width:105rpx;height:118rpx;min-width:105rpx;border-radius:13rpx}.continue-copy{flex:1;min-width:0}.continue-kicker{display:block;font-size:15rpx;font-weight:600;letter-spacing:1.8rpx;color:#b3a3be;margin-bottom:8rpx}.continue-title{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:27rpx;line-height:1.16;color:#513662;font-weight:600;letter-spacing:-.3rpx}.continue-progress{height:4rpx;background:#eee7f4;border-radius:5rpx;overflow:hidden;margin:15rpx 0 8rpx}.continue-progress view{height:100%;background:#bea0d2;border-radius:5rpx}.continue-time{display:block;font-size:18rpx;color:#ae9abc;line-height:1}.time-divider{color:#d1c5d8;margin:0 5rpx}.continue-play{width:58rpx;height:58rpx;min-width:58rpx;background:#ffcf00;border-radius:50%;display:flex;align-items:center;justify-content:center;margin-left:1rpx}.continue-play image{width:23rpx;height:23rpx}.toolkit-heading{margin-top:29rpx}.toolkit{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:15rpx}.tool-card{background:#fff;border:1rpx solid #ece6f1;border-radius:21rpx;padding:21rpx 22rpx 24rpx;min-width:0}.tile-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:18rpx}.tool-icon{height:54rpx;width:54rpx;padding:13rpx;border-radius:16rpx;box-sizing:border-box}.icon-green{background:#eaf5ef}.icon-gold{background:#fff6d8}.icon-purple{background:#f0e9f7}.icon-neutral{background:#f1eef5}.tile-arrow{width:21rpx;height:21rpx;opacity:.55}.tool-title{display:block;color:#5b426d;font-size:26rpx;font-weight:600;letter-spacing:-.3rpx}.tool-caption{display:block;color:#b0a0b9;font-size:20rpx;line-height:1.5;margin-top:7rpx;white-space:nowrap}.points-card{display:flex;align-items:center;gap:17rpx;background:#fff8e6;border:1rpx solid #f1e5c4;border-radius:20rpx;padding:24rpx 22rpx;margin-top:24rpx}.points-icon{width:47rpx;height:47rpx;min-width:47rpx;padding:7rpx;box-sizing:border-box}.points-copy{flex:1;min-width:0}.points-title{display:block;font-size:25rpx;font-weight:600;color:#806740;letter-spacing:-.3rpx}.points-caption{display:block;font-size:20rpx;color:#b8a47f;margin-top:6rpx}.points-value{display:flex;align-items:baseline;gap:7rpx;font-size:36rpx;color:#896b24;font-family:ListHeading,sans-serif;line-height:1}.points-unit{font-family:Arial,sans-serif;font-size:19rpx;font-weight:400;color:#bba66d}.points-chevron{width:18rpx;height:18rpx;opacity:.5}.settings-card{display:flex;align-items:center;width:100%;gap:20rpx;background:transparent;padding:27rpx 21rpx 19rpx}.settings-icon{height:32rpx;width:32rpx;min-width:32rpx;opacity:.85}.settings-title{display:block;color:#8c769c;font-size:24rpx;font-weight:500}.settings-caption{display:block;color:#bbafc3;font-size:19rpx;margin-top:5rpx}.settings-chevron{width:19rpx;height:19rpx;margin-left:auto;opacity:.6}.profile-footer{display:flex;align-items:center;justify-content:center;gap:17rpx;font-size:14rpx;letter-spacing:2.1rpx;color:#c8bdcf;margin:25rpx 0 5rpx}.footer-rule{height:1rpx;width:32rpx;background:#e5dcea}.start-card{display:flex;align-items:center;gap:19rpx;background:#fff;border:1rpx solid #ece5f3;border-radius:21rpx;padding:27rpx 23rpx}.start-icon{width:43rpx;height:43rpx;min-width:43rpx}.start-title{display:block;color:#644378;font-family:ListHeading,sans-serif;font-size:29rpx;line-height:1.1}.start-caption{display:block;color:#b39cbe;font-size:21rpx;margin-top:9rpx}
</style>
