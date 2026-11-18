<template>
  <view class="container">
    <!-- Custom导航栏：站酷快乐体标题（原生导航栏不支持艺术字体） -->
    <view class="custom-nav" :style="{ paddingTop: statusBarHeight + 'px' }">
      <view class="custom-nav-body" :style="{ height: navContentHeight + 'px' }">
        <view class="brand-mark"><view/><view/><view/></view><text class="nav-title">SWAG SPEAKING BUDDY</text>
      </view>
    </view>
    <!-- 顶栏（v75）：AVATAR + YOUR NAME + 打卡图标/天数 + 打卡按钮，一行 -->
    <view class="merge-row">
      <block v-if="profile">
        <view class="merge-avatar-wrap" @click="onAvatarTap">
          <image class="merge-avatar" :src="profileAvatarUrl" mode="aspectFill" />
          <text v-if="unreadCount > 0" class="avatar-badge">{{ unreadCount > 99 ? '99+' : unreadCount }}</text>
          
        </view>
        <view class="greeting" @click="onAvatarTap"><text class="greeting-label">GOOD TO SEE YOU</text><text class="merge-nick">{{ profile.nickName }}</text></view>
      </block>
      <view v-else class="merge-spacer" />
      <button class="learning-checkin" :class="{done:checkinToday,busy:checking}" :disabled="checking" :aria-label="checkinTotal+' learning days. '+(checkinToday?'Checked in today':'Check in today')" @click="onCheckin"><view class="learning-checkin-calendar"><view class="learning-calendar-sheet"><view class="learning-calendar-header"/><view class="learning-calendar-ring ring-left"/><view class="learning-calendar-ring ring-right"/><text class="learning-calendar-number" :class="{'calendar-count-small':checkinTotal>=100}">{{checkinTotal}}</text></view></view><view class="learning-checkin-copy"><text class="learning-checkin-title">LEARNING DAYS</text></view></button>
    </view>
    <text v-if="checkinError" class="checkin-error">{{ checkinError }}</text>

    <view v-if="!browseMode && currentTab===0" class="home-intro">
      <view class="intro-title"><text>YOUR NEXT LISTEN.</text></view>

      <view v-if="recentLesson" class="continue-card" @click="goDetail(recentLesson.id)"><LessonCover v-if="recentLesson.cover" class="resume-cover" :src="recentLesson.cover" compact /><view class="resume-copy"><text class="continue-label">{{recentLesson.completed?'再听一遍':'继续学习'}}</text><text class="continue-title">{{displayTitle(recentLesson.title)}}</text><text class="continue-meta">{{formatShortDuration(recentLesson.position)}} / {{formatShortDuration(recentLesson.duration)}}</text></view><view class="continue-play"><view class="play-triangle"/></view><view class="continue-progress"><view :style="{width:Math.min(100,recentLesson.position/Math.max(1,recentLesson.duration)*100)+'%'}"/></view></view>
      <view v-else class="starter" @click="showGuide"><text>Your first listen starts here.</text><text>See how it works ›</text></view>
    </view>

    <DailyLeaderboard v-if="!browseMode && currentTab===0" :data="dailyRanking.data" :loading="dailyRanking.loading" :error="dailyRanking.error" @retry="loadDailyLeaderboard(true)" />

    <!-- 搜索框：按标题关键词搜索 -->
    <view v-if="browseMode" class="search-row">
      <input
        v-model="keyword"
        class="search-input"
        placeholder="搜索感兴趣的课程"
        confirm-type="search"
        @confirm="onSearchConfirm"
      />
      <button class="search-btn search-icon-btn" @click="onSearchConfirm">
        <image class="search-icon" src="/static/search.png" mode="aspectFit" />
      </button>
    </view>

    <!-- Import remains a first-class action above the course/library tabs. -->
    <view v-if="browseMode" class="import-promo">
      <view class="import-promo-wave wave-back"/><view class="import-promo-wave wave-front"/>
      <view class="import-promo-copy">
        <view class="import-promo-title"><text>你的文章</text><text>就是下一节听力课</text></view>
        <text class="import-promo-description">导入英文文章，生成专属听力课程</text>
        <button class="import-promo-action" aria-label="导入文章，生成听力课程" @click="goImport"><view class="import-promo-plus"/><text>导入文章</text></button>
      </view>
      <view class="import-promo-art" aria-hidden="true">
        <view class="import-promo-conversion">
          <view class="import-promo-document"><view class="import-promo-fold"/><view class="import-promo-line line-short"/><view class="import-promo-line"/><view class="import-promo-line"/></view>
          <view class="import-promo-arrow"/>
          <view class="import-promo-audio"><view v-for="(height,index) in [13,26,38,28,17]" :key="index" :style="{height:height+'px'}"/></view>
        </view>
        <view class="import-promo-formats"><text>TXT</text><text>PDF</text><text>DOCX</text></view>
      </view>
    </view>

    <!-- 栏目 tabs：Discover / My Library -->
    <view v-if="browseMode || currentTab===1" class="tabs">
      <view
        v-for="(tab, index) in tabs"
        :key="tab"
        class="tab-item"
        :class="{ active: currentTab === index }"
        @click="onTabChange(index)"
      >
        {{ tab }}
      </view>
    </view>

    <!-- 官方课程 -->
    <block v-if="currentTab === 0">
      <!-- Level分组筛选（深色条 + 彩点 + 数量，选中黄色；横向可滑） -->
      <view v-if="browseMode" class="level-bar">
        <text class="level-bar-label">Level:</text>
        <view
          v-for="group in levelGroups"
          :key="group.key"
          class="level-pill-item"
          :class="{ active: levelFilter === group.key, unavailable:group.key!=='all' && groupCounts[group.key]===0 }"
          @click="onLevelChange(group.key)"
        >
          <text v-if="group.key !== 'all'" class="level-dot" :style="{ backgroundColor: group.color }"></text>
          <text class="level-pill-name">{{ group.label }}</text>
          <text v-if="group.key !== 'all'" class="level-pill-count">{{ groupCounts[group.key] }}</text>
        </view>
      </view>

      <view v-if="browseMode" class="topic-toolbar"><text class="selected-topic" @click="topicsOpen=!topicsOpen">{{topics.find(t=>t.key===topicFilter)?.label || 'All topics'}}</text><button class="topics-trigger" @click="topicsOpen=!topicsOpen">Topics <text>{{topicsOpen?'−':'+'}}</text></button></view><view v-if="browseMode && topicsOpen" class="topic-options"><view v-for="t in topics" :key="t.key" :class="{selected:topicFilter===t.key}" @click="topicFilter=t.key;page=1;topicsOpen=false"><text>{{t.label}}</text><text>{{topicFilter===t.key?'✓':'›'}}</text></view></view>
      <view class="list-heading"><text>{{browseMode?'ENGLISH LISTENING LESSONS':'LATEST LESSONS'}}</text></view>
      <view v-if="publishedLoading && !displayedLessons.length" class="catalogue-status">Finding something good…</view>
      <view v-if="publishedError" class="catalogue-status error" @click="loadPublished(true)">{{publishedError}} · Tap to retry</view>
      <!-- Discover -->
      <view v-if="displayedLessons.length > 0">
        <view
          v-for="(lesson, lessonIndex) in displayedLessons"
          :key="lesson.id"
          class="lesson-card" :class="{featured:lessonIndex===0 && !browseMode}"
          @click="goDetail(lesson.id)"
        >
          <LessonCover class="lesson-card-img" :src="lesson.cover" />
          <text class="lesson-new-tag">{{topicLabel(lesson.topic)}}</text>
          <view class="lesson-card-info">
            <view class="lesson-date-row">
              <text class="lesson-date">{{ formatCardDate(lesson.date) }}</text>
              <text v-if="lesson.authorNick" class="lesson-author">· {{ lesson.authorNick }}</text>
              <text class="lesson-duration">{{ formatShortDuration(lesson.duration) }}</text>
            </view>
            <view class="lesson-title-row">
              <view
                v-if="lesson.level"
                class="level-pill"
                :style="{ borderColor: (levelGroupOf(lesson.level)?.color ?? '#999999') }"
              >
                <text class="level-dot" :style="{ backgroundColor: (levelGroupOf(lesson.level)?.color ?? '#999999') }"></text>
                <text class="level-pill-text">{{ levelPillText(lesson.level) }}<text class="level-duration"> · {{formatShortDuration(lesson.duration)}}</text></text>
              </view>
              <text class="lesson-title" @click.stop="goDetail(lesson.id)">{{ displayTitle(lesson.title) }}</text>
            </view>
            
            <text v-if="englishSummary(lesson.summary)" class="lesson-summary">{{lesson.summary}}</text>
            <view class="lesson-footer"><text>{{topicLabel(lesson.topic)}}</text><text>{{learning.progress[lesson.id]?.completed?'已完成':learning.progress[lesson.id]?'继续学习':'开始学习'}} ›</text></view>
          </view>
        </view>
      </view>
      <view v-else-if="!publishedLoading && !publishedError" class="empty">
        <text v-if="allOfficialLessons.length === 0">Your next chapter is on its way.</text>
        <text v-else>No lessons found. Try another filter.</text>
        <text v-if="allOfficialLessons.length === 0" class="empty-desc">
          Import an English article to make it your next lesson.
        </text>
      </view>

      <!-- 分页：滑到底部自动加载，也有手动按钮兜底 -->
      <view v-if="hasMore" class="load-more"><button class="load-more-btn" @click="loadMore">Show more lessons <text>↓</text></button></view>
    </block>

    <!-- My Library -->
    <view v-else>
      <button class="import-btn" @click="goImport">＋ 导入文章</button>
      <view v-if="importQuota" class="import-quota">
        Available credits: {{ importAvailableText }}
      </view>
      <view v-if="importRecords.length > 0">
        <view
          v-for="record in importRecords"
          :key="record._id"
          class="import-record"
          @click="onImportTap(record)"
        >
          <LessonCover class="record-img" :src="recordCover(record)" />
          <view class="record-info">
            <view class="record-title" @click.stop="onImportTap(record)">{{ record.title }}</view>
            <view class="record-meta">
              <text :class="'status-' + record.status">{{ statusText(record.status) }}</text>
              <text class="record-time">{{ formatDate(record.createdAt) }}</text>
            </view>
            <view v-if="record.status === 'done'" class="record-apply-row">
              <text v-if="isCoverLocked(record)" class="cover-locked-hint">已共享 · 封面已锁定</text>
              <text v-else class="upload-cover-btn" @click.stop="onUploadCoverTap(record)">{{ uploadCoverId === record._id ? '上传中…' : (hasCover(record) ? '更换封面' : '添加封面') }}</text>
              <text v-if="!hasCover(record) && !isCoverLocked(record)" class="no-cover-hint">暂无封面</text>
              <text v-if="!record.applyOfficial" class="apply-btn" @click.stop="onApplyTap(record)">共享课程</text>
              <text v-else-if="record.officialStatus === 'pending'" class="apply-pending">审核中</text>
              <text v-else-if="record.officialStatus === 'approved'" class="apply-approved">已共享</text>
              <text v-else class="apply-btn" @click.stop="onApplyTap(record)">重新提交</text>
            </view>
          </view>
          <text
            v-if="(record.status === 'done' || record.status === 'failed') && !isCoverLocked(record)"
            :class="['record-delete', isDeleting ? 'record-delete-disabled' : '']"
            @click.stop="onDeleteTap(record)"
          >Remove</text>
        </view>
      </view>
      <view v-else-if="importsLoading" class="empty import-empty">
        <text class="empty-title">Loading…</text>
      </view>
      <view v-else class="empty import-empty">
        <text class="empty-title">Make a lesson of your own.</text>
        <text class="empty-desc">Bring an English article and turn it into your next listen.</text>
      </view>
    </view>
    <BottomNav :active="browseMode?'courses':'home'" />
  </view>
</template>

<script setup lang="ts">
import LessonCover from '@/components/LessonCover.vue';
import DailyLeaderboard from '@/components/DailyLeaderboard.vue';
import {dailyRanking,loadDailyLeaderboard,flushDailyListening} from '@/utils/daily-learning';
import {inferTopic,readableTitle} from '@/utils/catalogue';
import BottomNav from '@/components/BottomNav.vue';
import { useLearningStore } from '@/stores/learning';
import { useVocabStore } from '@/stores/vocab';
import { allPages } from '@/utils/api';
import { ref, computed, watch } from 'vue';
import { checkinState, ensureDailyCheckin } from '@/utils/checkin';
import { onLoad, onReachBottom, onShow, onUnload, onPullDownRefresh, onHide } from '@dcloudio/uni-app';
import { lessons } from '@/mock/lessons';
import { useAudioStore } from '@/stores/audio';
const audioStore = useAudioStore();
const learning = useLearningStore(),
  vocab = useVocabStore();
learning.load();
vocab.load();
const browseMode = ref(false),
  topicFilter = ref('all'),
  publishedLoading = ref(false),
  publishedError = ref('');
const topicsOpen = ref(false);
const recentLesson = computed(() => learning.recent[0]),
  dueCount = computed(() => vocab.saved.filter(w => (w.dueAt || 0) <= Date.now()).length);
const topics = [{
  key: 'all',
  label: 'All topics'
}, {
  key: 'health',
  label: 'Health & Lifestyle'
}, {
  key: 'history',
  label: 'History & Culture'
}, {
  key: 'news',
  label: 'News & Daily Life'
}, {
  key: 'psychology',
  label: 'Psychology'
}, {
  key: 'science',
  label: 'Science & Tech'
}, {
  key: 'stories',
  label: 'Stories'
}, {
  key: 'other',
  label: 'More'
}];
function topicLabel(key: string) {
  return topics.find(t => t.key === key)?.label || 'More';
}
const displayTitle=readableTitle;
function englishSummary(text?:string){return !!text && !/[\u4e00-\u9fff]/.test(text)}
function isNew(date: string) {
  const age = Date.now() - new Date(date + 'T00:00:00').getTime();
  return age >= 0 && age < 7 * 86400000;
}
function showGuide() {
  uni.navigateTo({
    url: '/pages/profile/settings?section=guide'
  });
}
function goReview() {
  uni.reLaunch({
    url: '/pages/profile/vocab'
  });
}
watch(keyword, () => {
  page.value = 1;
});
import type { LessonLevel } from '@/types/lesson';
import { localCover, cachedCover, loadCoverSources, invalidateCover } from '@/utils/cover';

// Custom导航栏高度：状态栏 + 胶囊对齐的内容区
const statusBarHeight = ref(20);
const navContentHeight = ref(44);
try {
  const sys = uni.getWindowInfo();
  statusBarHeight.value = sys.statusBarHeight || 20;
  const menu = wx.getMenuButtonBoundingClientRect();
  if (menu && menu.height) {
    navContentHeight.value = (menu.top - statusBarHeight.value) * 2 + menu.height;
  }
} catch {
  // 取不到用默认值
}

// 栏目
const tabs = ['发现课程', '我的课程'] as const;
const currentTab = ref(0);

// Level分组筛选：All + 初级 A1-A2 / 中级 B1-B2 / 高级 C1-C2
// （样式对标参考图：深色条 + 彩点 + 数量，选中黄色；数量按实际课程数算）
type LevelGroup = 'all' | 'beginner' | 'intermediate' | 'advanced';
const levelGroups: {
  key: LevelGroup;
  label: string;
  levels: LessonLevel[] | null;
  color: string;
}[] = [{
  key: 'all',
  label: 'All levels',
  levels: null,
  color: '#d8ef92'
}, {
  key: 'beginner',
  label: 'Beginner A1–A2',
  levels: ['A1', 'A2'],
  color: '#66bb6a'
}, {
  key: 'intermediate',
  label: 'Intermediate B1–B2',
  levels: ['B1', 'B2'],
  color: '#42a5f5'
}, {
  key: 'advanced',
  label: 'Advanced C1–C2',
  levels: ['C1', 'C2'],
  color: '#ab47bc'
}];
const levelFilter = ref<LevelGroup>('all');

// 搜索关键词（按标题搜索）
const keyword = ref('');

// 封面地址中转：免费版存储“仅创建者可读写”，<image> 不能直接写 cloud://
// （模拟器报 500、真机鉴权失败）；经 getAudioUrl 批量换成临时地址再显示。
//
// 2026-10-31 实测：getAudioUrl 未显式传 maxAge 时，换出的临时地址【约 15 分钟内就会 403】
// （同一时刻对照：刚签发的链接 curl 200，16 分钟前的同形链接 curl 403）。
// 而这里原本缓存 50 分钟 —— 缓存还活着、链接已经死了，
// 表现为「打开一会儿后封面全白，且要等缓存过期才恢复」。
// 因此改为按链接自身的签发时刻判断新鲜度：URL 里的 t 参数经实测等于签发时间戳，
// 超过 COVER_URL_MAX_AGE 就丢弃重取。这样即使服务端调整有效期也能自适应，
// 不依赖写死的猜测值；再加 @error 自愈兜底（工具在 utils/cover.ts，收藏页共用）。
const coverUrlMap = ref<Record<string,string>>({});
const coverFailCount = ref<Record<string,number>>({});
const coverFailAt: Record<string,number> = {};
function coverSrc(src?: string | null): string {
  if (!src) return localCover();
  if ((coverFailCount.value[src] || 0) > 1) return localCover();
  return coverUrlMap.value[src] || cachedCover(src) || localCover();
}
async function onCoverError(src?:string | null) {
  if (!src?.startsWith('cloud://')) return;
  coverFailCount.value = {...coverFailCount.value, [src]:(coverFailCount.value[src] || 0)+1};
  coverFailAt[src]=Date.now();
  invalidateCover(src);
  const next={...coverUrlMap.value}; delete next[src]; coverUrlMap.value=next;
  if(coverFailCount.value[src]<2) await ensureCoverUrls();
}
async function onCoverVisible(id?:string|null){
 if(!id || coverUrlMap.value[id] || (coverFailCount.value[id]||0)>1)return;
 await loadCoverSources([id],(key,source)=>{coverUrlMap.value={...coverUrlMap.value,[key]:source}});
}
async function ensureCoverUrls() {
  const covers = currentTab.value===0 ? displayedLessons.value.map(l=>l.cover) : importRecords.value.slice(0,6).map(recordCover);
  if(!browseMode.value && recentLesson.value?.cover)covers.push(recentLesson.value.cover);
  await loadCoverSources(covers.filter((id):id is string=>!!id && (coverFailCount.value[id]||0)<2), (id,source)=>{
    coverUrlMap.value={...coverUrlMap.value,[id]:source};
  });
}

// Shared with App.onShow: the server owns the check-in date and daily reward.
const checkinTotal = computed(() => checkinState.totalDays);
const checkinToday = computed(() => checkinState.todayChecked);
const checking = computed(() => checkinState.busy);
const checkinError = computed(() => checkinState.error);
const unreadCount = ref(0);
async function loadCheckin() {
  try { await ensureDailyCheckin(); } catch { /* Non-blocking; retry on next entry. */ }
}
/** Keep manual retry. Automatic checks never display a toast. */
async function onCheckin() {
  if (checking.value) return;
  try {
    const result = await ensureDailyCheckin();
    if (!result) return;
    uni.showToast({
      title: result.already ? 'Already checked in today' : result.pointsAdded ? `Checked in · +${result.pointsAdded} points` : 'Checked in',
      icon: 'success'
    });
  } catch { /* Shared state displays the retry message. */ }
}

// 分页：每页 2 条，滑到底部加载下一页（本地数据分页）
const page = ref(1);
const pageSize = 2;

// Level从易到难的顺序

/** 用户投稿并审核上架的官方课程（公开可见） */
const publishedLessons = ref<any[]>([]);
let publishedLoaded = false;
async function loadPublished(force = false) {
  if (publishedLoading.value || publishedLoaded && !force) return;
  publishedLoading.value = true;
  publishedError.value = '';
  try {
    const records = await allPages('importApi', 'listOfficial');
    publishedLessons.value = records.map((r: any) => ({
      id: r.lessonId,
      title: r.title,
      level: r.level || undefined,
      topic: r.topic || inferTopic(r.title),
      summary: r.summary || '',
      authorNick: r.authorNick || '',
      date: r.createdAt ? new Date(r.createdAt).toISOString().slice(0, 10) : '',
      cover: r.cover || '',
      duration: r.duration || 0,
      fromPublished: true
    }));
    publishedLoaded = true;
    ensureCoverUrls();
    try {
      uni.setStorageSync('catalogueV2', publishedLessons.value);
    } catch {}
  } catch {
    publishedError.value = 'Could not refresh. Showing your saved list.';
  } finally {
    publishedLoading.value = false;
  }
}
try {
  publishedLessons.value = uni.getStorageSync('catalogueV2') || [];
} catch {}

/** 官方课程 = 内置 + 用户投稿上架 */
const allOfficialLessons = computed(() => [...lessons, ...publishedLessons.value]);

/** 筛选 + 排序后的All课程 */
const filteredLessons = computed(() => {
  const kw = keyword.value.trim().toLowerCase();
  return allOfficialLessons.value.filter(lesson => {
    const g = levelGroups.find(x => x.key === levelFilter.value);
    return !g || g.levels === null || lesson.level !== undefined && g.levels.includes(lesson.level);
  }).filter(lesson => topicFilter.value === 'all' || (lesson.topic || 'other') === topicFilter.value).filter(lesson => !kw || lesson.title.toLowerCase().includes(kw) || (lesson.titleCn ?? '').includes(keyword.value.trim()) || lesson.id.toLowerCase().includes(kw) || topicLabel(lesson.topic).includes(keyword.value.trim())).sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
});

/** 官方课中的最新日期：new 徽章只打在日期最新的文章上（导入不参与） */
const latestDate = computed(() => allOfficialLessons.value.reduce((m, l) => (l.date ?? '') > m ? l.date as string : m, ''));

/** 当前页已展示的课程 */
const displayedLessons = computed(() => filteredLessons.value.slice(0, page.value * pageSize));

/** 是否还有更多 */
const hasMore = computed(() => displayedLessons.value.length < filteredLessons.value.length);
watch(()=>recentLesson.value?.cover,()=>{void ensureCoverUrls()});
watch(()=>displayedLessons.value.map(l=>l.cover).join('|'), ()=>{void ensureCoverUrls()});

/** 搜索确认：回到第一页 */
function onSearchConfirm() {
  page.value = 1;
}

/** 切换Level分组：回到第一页 */
function onLevelChange(group: LevelGroup) {
  if (group !== 'all' && groupCounts.value[group] === 0) {
    uni.showToast({
      title: 'More lessons coming soon',
      icon: 'none'
    });
    return;
  }
  levelFilter.value = group;
  page.value = 1;
}

/** 各分组课程数（按All课程算，不受搜索关键词影响；内置课已清空，这里统计的是内置+上架投稿） */
const groupCounts = computed(() => {
  const all = allOfficialLessons.value;
  const counts: Record<LevelGroup, number> = {
    all: all.length,
    beginner: 0,
    intermediate: 0,
    advanced: 0
  };
  for (const lesson of all) {
    const g = levelGroups.find(x => x.levels !== null && lesson.level !== undefined && x.levels.includes(lesson.level));
    if (g) counts[g.key] += 1;
  }
  return counts;
});

/** 加载下一页 */
function loadMore() {
  if (hasMore.value) {
    page.value += 1;
  }
}

/** 滑到底部自动加载下一页 */
onReachBottom(() => {
  loadMore();
});

/** 跳转Listening room */
function goDetail(id: string) {
  uni.navigateTo({
    url: `/pages/lesson/detail?id=${id}`
  });
}

// ---------- My Library（M1：列表 + 额度；处理流水线在 M2 接） ----------

interface ImportRecord {
  _id: string;
  title: string;
  status: 'processing' | 'done' | 'failed';
  lessonId: string;
  createdAt: number;
  applyOfficial?: boolean;
  officialStatus?: string;
}
const importRecords = ref<ImportRecord[]>([]);
const importQuota = ref<{
  freeTotal: number;
  freeUsed: number;
  singleRemaining: number;
  membership: {
    type: string;
    expiresAt?: number;
  } | null;
  monthlyRemaining: number | null;
} | null>(null);

/** 剩余可用额度（三态）：永久会员→Unlimited；包月会员→包月剩余额度；其余→免费剩余额度 */
const importAvailableText = computed(() => {
  const q = importQuota.value;
  if (!q) return '';
  if (q.membership && q.membership.type === 'lifetime') return 'Unlimited';
  if (q.monthlyRemaining != null) return `${q.monthlyRemaining} monthly`;
  return `${Math.max(0, q.freeTotal - q.freeUsed)} free`;
});
const IMPORTS_CACHE_KEY = 'importsCacheV1';
const importsLoading = ref(false); // 无缓存冷启动时显示"加载中"，而不是"还没有导入"
let importsInflight = false;
let importsSessionReady = false;

/** 从本地缓存恢复列表（只存渲染用字段，秒开） */
function restoreImportsCache(): boolean {
  try {
    const c: any = uni.getStorageSync(IMPORTS_CACHE_KEY);
    if (c && Array.isArray(c.records)) {
      importRecords.value = c.records as ImportRecord[];
      if (c.quota) importQuota.value = c.quota;
      return true;
    }
  } catch {
    // 存储不可用就走网络
  }
  return false;
}

/** 拉取My Library列表与额度：缓存秒开 + 后台静默刷新。
 * 云函数冷启动要几秒，点 tab 时不再干等；失败时静默，有缓存就展示缓存。 */
async function loadImports() {
  if (!importsSessionReady) {
    const hit = restoreImportsCache();
    importsSessionReady = true;
    if (!hit && importRecords.value.length === 0) importsLoading.value = true;
  }
  if (importsInflight) return;
  importsInflight = true;
  try {
    const [listRes, quotaRes]: any[] = await Promise.all([allPages('importApi', 'list').then(records => ({
      result: records
    })), wx.cloud.callFunction({
      name: 'importApi',
      data: {
        action: 'getQuota'
      }
    })]);
    const records = (listRes.result || []) as ImportRecord[];
    importRecords.value = records;
    importQuota.value = quotaRes.result.quota;
    try {
      uni.setStorageSync(IMPORTS_CACHE_KEY, {
        records: records.map((r: any) => ({
          _id: r._id,
          lessonId: r.lessonId,
          title: r.title,
          status: r.status,
          createdAt: r.createdAt,
          cover: r.lesson && r.lesson.cover || null,
          applyOfficial: !!r.applyOfficial,
          officialStatus: r.officialStatus || ''
        })),
        quota: quotaRes.result.quota,
        at: Date.now()
      });
    } catch {
      // 缓存写失败不影响展示
    }
    ensureCoverUrls();
  } catch {
    // 云函数未部署时不弹错，列表保持空态/缓存
  } finally {
    importsInflight = false;
    importsLoading.value = false;
  }
}

/** 切换栏目：切到“My Library”时刷新列表 */
function onTabChange(index: number) {
  currentTab.value = index;
  if (index === 1) {
    loadImports();
  }
}

/* ---------- 个人资料：静默默认资料（合规：启动不索取微信AVATARYOUR NAME） ---------- */
const DEFAULT_AVATARS = ['rat', 'ox', 'tiger', 'rabbit', 'dragon', 'snake', 'horse', 'goat', 'monkey', 'rooster', 'dog', 'pig'];
let profileChecked = false;
const PROFILE_CACHE_KEY = 'profileCacheV1';
const profile = ref<{
  nickName: string;
  avatarType: string;
  avatarIndex: number;
  avatarUrl: string | null;
} | null>(null);
const profileAvatarUrl = computed(() => {
  const p = profile.value;
  if (!p) return '';
  if (p.avatarType === 'custom' && p.avatarUrl) return p.avatarUrl;
  return `/static/avatars/${DEFAULT_AVATARS[p.avatarIndex] || 'rat'}.png`;
});
function genDefaultNick() {
  return 'Listener ' + Math.random().toString(36).slice(2, 6).toUpperCase();
}
/** 首次进入时查资料：没有则静默生成默认资料（随机小动物AVATAR + 默认YOUR NAME），不弹窗。
 * 合规：小程序启动时不得索取微信AVATAR/YOUR NAME；chooseAvatar 与 nickname 输入框只保留在用户主动进入的"Edit profile"页。 */
async function ensureProfile() {
  // 缓存每次都重读：编辑页Save后返回，首页左上角立即显示新AVATARYOUR NAME
  try {
    const cached: any = uni.getStorageSync(PROFILE_CACHE_KEY);
    if (cached && cached.nickName) profile.value = cached;
  } catch {
    // 无缓存则等云端
  }
  if (profileChecked) return;
  profileChecked = true;
  // 云端只查一次（冷启动慢，缓存已秒显）
  try {
    const res: any = await wx.cloud.callFunction({
      name: 'userApi',
      data: {
        action: 'getProfile'
      }
    });
    const cp = res.result && res.result.profile;
    if (!cp) {
      // 无资料：静默建默认，不等用户、不弹窗、不收集微信AVATARYOUR NAME
      const idx = Math.floor(Math.random() * DEFAULT_AVATARS.length);
      const fresh = {
        nickName: genDefaultNick(),
        avatarType: 'default',
        avatarIndex: idx,
        avatarUrl: null as string | null
      };
      profile.value = fresh;
      try {
        uni.setStorageSync(PROFILE_CACHE_KEY, fresh);
      } catch {}
      // 后台写云端；失败静默（如下次冷启动再试；users 集合未建时也不打扰用户）
      wx.cloud.callFunction({
        name: 'userApi',
        data: {
          action: 'saveProfile',
          nickName: fresh.nickName,
          avatarType: 'default',
          avatarIndex: idx,
          avatarFileID: ''
        }
      }).catch(() => {});
    } else {
      profile.value = cp;
      try {
        uni.setStorageSync(PROFILE_CACHE_KEY, cp);
      } catch {}
    }
  } catch {
    // 出错不阻塞首页；云函数未部署时静默跳过（有缓存则继续显示缓存）
  }
}

/** 管理员隐藏入口：AVATAR 3 秒内连点 5 次；鉴权Approve才进管理页，普通用户无任何感知 */
let avatarTapTimes: number[] = [];
async function refreshUnread() {
  try {
    const m: any = await wx.cloud.callFunction({
      name: 'userApi',
      data: {
        action: 'listMessages'
      }
    });
    unreadCount.value = m.result && m.result.unread || 0;
  } catch {
    // 未部署/无集合时静默为 0
  }
}
let avatarTapTimer: any = null;
async function onAvatarTap() {
  const now = Date.now();
  avatarTapTimes = avatarTapTimes.filter(t => now - t < 3000);
  avatarTapTimes.push(now);
  if (avatarTapTimes.length >= 5) {
    // 5 连点：进管理页（管理员），Cancel待发的Your space跳转
    avatarTapTimes = [];
    if (avatarTapTimer) {
      clearTimeout(avatarTapTimer);
      avatarTapTimer = null;
    }
    try {
      const res: any = await wx.cloud.callFunction({
        name: 'importApi',
        data: {
          action: 'adminCheck'
        }
      });
      if (res.result && res.result.isAdmin) {
        uni.navigateTo({
          url: '/pages/admin/review'
        });
      }
    } catch {
      // 非管理员或未部署：静默无事发生
    }
    return;
  }
  // 单点：延迟 350ms 进Your space；连点中则Cancel，留给 5 连点手势
  if (avatarTapTimer) clearTimeout(avatarTapTimer);
  avatarTapTimer = setTimeout(() => {
    avatarTapTimer = null;
    avatarTapTimes = [];
    uni.navigateTo({
      url: '/pages/profile/index'
    });
  }, 350);
}
const OFFICIAL_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
/** 是否已有真封面（cloud:// 开头）；否则显示"No cover yet + Add cover"入口 */
function hasCover(record: any) {
  const c = record.lesson && record.lesson.cover || record.cover || record.coverFileID || '';
  return typeof c === 'string' && c.startsWith('cloud://');
}
/** 封面是否锁定：已提交共享（In review/已共享）后不再允许更换，保证审核内容与线上展示一致 */
function isCoverLocked(record: any) {
  const s = record && record.officialStatus;
  return s === 'pending' || s === 'approved';
}
const uploadCoverId = ref('');
/** 上传Custom封面（唯一的封面来源）：选图 → 压缩 → 传云存储 → setCover 落库（后端自动删旧图） */
async function onUploadCoverTap(record: any) {
  if (uploadCoverId.value) return;
  if (isCoverLocked(record)) {
    uni.showToast({
      title: '已共享 · 封面已锁定',
      icon: 'none'
    });
    return;
  }
  let picked = '';
  try {
    const pick: any = await wx.chooseImage({
      count: 1,
      sizeType: ['compressed']
    });
    picked = pick && pick.tempFilePaths && pick.tempFilePaths[0] || '';
  } catch {
    return; // 用户Cancel选图
  }
  if (!picked) return;
  uploadCoverId.value = record._id;
  try {
    let filePath = picked;
    try {
      const cp: any = await wx.compressImage({
        src: picked,
        quality: 70
      });
      if (cp && cp.tempFilePath) filePath = cp.tempFilePath;
    } catch {
      // 压缩失败（格式不支持等）直接用原图
    }
    const up: any = await wx.cloud.uploadFile({
      cloudPath: `covers/${record._id}_u${Date.now()}.jpg`,
      filePath
    });
    if (!up || !up.fileID) throw new Error('upload failed');
    const res: any = await wx.cloud.callFunction({
      name: 'processImport',
      data: {
        action: 'setCover',
        importId: record._id,
        fileID: up.fileID
      }
    });
    const result = res && res.result || {};
    if (result.error) throw new Error(String(result.error));
    if (record.lesson) record.lesson.cover = up.fileID;
    record.cover = up.fileID;
    record.coverFileID = up.fileID;
    await ensureCoverUrls();
    uni.showToast({
      title: 'Cover updated',
      icon: 'success'
    });
  } catch (e: any) {
    const msg = String(e && e.message || e || '');
    let title = 'Unable to upload. Try again.';
    if (msg.includes('bad cover path')) title = 'Invalid cover file';else if (msg.includes('import not done')) title = 'This lesson is still processing';else if (msg.includes('cover locked')) title = '已共享 · 封面已锁定';else if (msg) title = 'Failed: ' + msg.slice(0, 36);
    uni.showToast({
      title,
      icon: 'none'
    });
  } finally {
    uploadCoverId.value = '';
  }
}
async function onApplyTap(record: ImportRecord) {
  try {
    const {
      tapIndex
    } = await uni.showActionSheet({
      itemList: OFFICIAL_LEVELS
    });
    const level = OFFICIAL_LEVELS[tapIndex];
    await wx.cloud.callFunction({
      name: 'importApi',
      data: {
        action: 'applyOfficial',
        importId: record._id,
        level
      }
    });
    record.applyOfficial = true;
    record.officialStatus = 'pending';
    uni.showToast({
      title: 'Submitted for review',
      icon: 'success'
    });
  } catch (e: any) {
    if (!String(e?.errMsg || '').includes('cancel')) uni.showToast({
      title: 'Could not submit. Try again.',
      icon: 'none'
    });
  }
}
let firstShow = true;
/** 回到本页时，若停在“My Library”也刷新（刚上传完回来能看到新记录）；
 * 首次进入时顺手预热导入列表缓存，点 tab 秒开 */
onShow(() => {
  if(!browseMode.value && currentTab.value===0)void flushDailyListening().then(()=>loadDailyLeaderboard());
  loadCheckin();
  learning.sync();
  vocab.sync();
  ensureProfile();
  refreshUnread();
  // 占位图冷却恢复：被判「文件缺失」的封面 5 分钟后允许Retry一次
  // （文件可能补传/恢复，或当初只是网络抖动）；重置后 ensureCoverUrls 会重新换地址
  const fc = coverFailCount.value;
  const stale = Object.keys(fc).filter(k => fc[k] > 1 && Date.now() - (coverFailAt[k] || 0) > 5 * 60 * 1000);
  if (stale.length) {
    const next = {
      ...fc
    };
    for (const k of stale) delete next[k];
    coverFailCount.value = next;
  }

  // 审核页刚上架/Unpublish过：强制刷新一次Discover（平时仍只加载一次，省云调用）
  try {
    if (uni.getStorageSync('refreshPublished')) {
      uni.removeStorageSync('refreshPublished');
      loadPublished(true);
    } else {
      loadPublished();
    }
  } catch {
    loadPublished();
  }
  ensureCoverUrls();
  // Your space“My Library”行返回：切到导入 tab
  try {
    if (uni.getStorageSync('gotoImportTab')) {
      uni.removeStorageSync('gotoImportTab');
      currentTab.value = 1;
    }
  } catch {}
  if (currentTab.value === 1 || firstShow) {
    firstShow = false;
    loadImports();
  }
});

/** 页面销毁时必须停掉导入进度轮询：
 * stopListPoll() 之前定义了却没有任何调用点，页面被 reLaunch/redirectTo/退出小程序时
 * listPollTimer 仍会每 3 秒继续调 processImport（最多 200 次），白耗云调用配额。
 * 这里只绑 onUnload：navigateTo 详情页时本页不销毁，轮询能继续跑（处理完照常提示），
 * 返回后由 onShow 接管，不影响原有体验。 */
onHide(() => stopListPoll());
onPullDownRefresh(async () => {
  await Promise.all([loadPublished(true), loadImports(), loadCheckin(), !browseMode.value?flushDailyListening().then(()=>loadDailyLeaderboard(true)):Promise.resolve()]);
  uni.stopPullDownRefresh();
});
onUnload(() => {
  stopListPoll();
});

/** 首次进入时后台批量预取All官方课的播放地址：点文章时不用再等云函数换地址 */
let audioPrefetched = false;
onLoad((options: any) => {
  browseMode.value = options?.browse === '1';
  if (audioPrefetched) return;
  audioPrefetched = true;
  try {
    // 一次云函数调用换完All地址（原先逐课调用 = N 次冷启动）
    audioStore.prefetchLessons(lessons as any);
  } catch {
    // 预取失败不影响正常播放
  }
});

/** 去导入页 */
function goImport() {
  uni.navigateTo({
    url: '/pages/import/index'
  });
}

/** 点导入记录：Completed进详情；Processing轮询推进；失败先Retry再轮询 */
function onImportTap(record: ImportRecord) {
  if (record.status === 'done' && record.lessonId) {
    goDetail(record.lessonId);
  } else if (record.status === 'processing') {
    pollRecord(record._id);
  } else {
    retryRecord(record);
  }
}

// 列表页轮询：防重复点，单条记录同一时间只跑一个轮询；上限 200 次（约 10 分钟），
// 超限停掉、记录仍是Processing，用户再点可续跑（processImport 本身可断点续跑）
const pollingRecordId = ref('');
let listPollVersion = 0;
let listPollTimer: any = null;
function stopListPoll() {
  listPollVersion++;
  pollingRecordId.value = '';
  uni.hideLoading();
  if (listPollTimer) {
    clearTimeout(listPollTimer);
    listPollTimer = null;
  }
}
async function pollRecord(importId: string) {
  if (pollingRecordId.value) return;
  pollingRecordId.value = importId;
  const version = ++listPollVersion;
  let count = 0;
  uni.showLoading({
    title: 'Creating your lesson…'
  });
  const tick = async () => {
    try {
      const res: any = await wx.cloud.callFunction({
        name: 'processImport',
        data: {
          importId
        }
      });
      if (version !== listPollVersion) return;
      const r = res.result;
      if (r.status === 'done' || r.status === 'failed') {
        uni.hideLoading();
        pollingRecordId.value = '';
        await loadImports();
        uni.showToast({
          title: r.status === 'done' ? 'Your lesson is ready. Tap to listen.' : 'Import failed. Your credit has been restored.',
          icon: 'none'
        });
        return;
      }
      count += 1;
      if (count >= 200) {
        uni.hideLoading();
        pollingRecordId.value = '';
        uni.showToast({
          title: 'Still working. Check back shortly.',
          icon: 'none'
        });
        return;
      }
      listPollTimer = setTimeout(tick, 3000);
    } catch (e: any) {
      console.warn('[import] 续跑请求失败', e && (e.errMsg || e.message) || '');
      uni.hideLoading();
      pollingRecordId.value = '';
      uni.showToast({
        title: 'Service unavailable. Please try again.',
        icon: 'none'
      });
    }
  };
  tick();
}

/** 失败Retry：重新扣额度后轮询推进 */
async function retryRecord(record: ImportRecord) {
  try {
    uni.showLoading({
      title: 'Trying again…'
    });
    await wx.cloud.callFunction({
      name: 'importApi',
      data: {
        action: 'retry',
        importId: record._id
      }
    });
    uni.hideLoading();
    await loadImports();
    pollRecord(record._id);
  } catch (e: any) {
    uni.hideLoading();
    const msg = e && e.message || '';
    uni.showToast({
      title: msg.includes('QUOTA_EXHAUSTED') ? 'You need more import credits.' : 'Could not retry. Please try later.',
      icon: 'none'
    });
  }
}

/** Remove一条导入：二次确认后调云函数删记录与文件，额度不动；
 * Remove进行中（弹确认框 + 加载）时再点直接忽略，防止重复提交导致第二次失败 */
const isDeleting = ref(false);
async function onDeleteTap(record: ImportRecord) {
  if (isCoverLocked(record)) {
    uni.showToast({
      title: 'Shared lessons cannot be removed here.',
      icon: 'none'
    });
    return;
  }
  if (isDeleting.value) return;
  isDeleting.value = true;
  try {
    const ok = await new Promise<boolean>(resolve => {
      uni.showModal({
        title: 'Remove import',
        content: `Remove "${record.title}" and its source file and audio? This cannot be undone.`,
        confirmText: 'Remove',
        confirmColor: '#e64340',
        cancelText: 'Cancel',
        success: res => resolve(!!res.confirm),
        fail: () => resolve(false)
      });
    });
    if (!ok) return;
    uni.showLoading({
      title: 'Removing…'
    });
    await wx.cloud.callFunction({
      name: 'importApi',
      data: {
        action: 'delete',
        importId: record._id
      }
    });
    uni.hideLoading();
    uni.showToast({
      title: 'Removed',
      icon: 'none'
    });
    await loadImports();
  } catch {
    uni.hideLoading();
    uni.showToast({
      title: 'Unable to remove. Try again later.',
      icon: 'none'
    });
  } finally {
    isDeleting.value = false;
  }
}

/** 导入封面：统一缺省封面（占位插画） */
function importCover(title: string) {
  return localCover(title);
}

/** 导入记录封面：有 AI 生成的用生成图（cloud:// 经 ensureCoverUrls 换临时地址），否则回退预设 */
function recordCover(record: any) {
  const c = record.lesson && record.lesson.cover || record.cover || null;
  return c || importCover(record.title);
}

/** 状态文案 */
function statusText(status: string) {
  if (status === 'done') return '已完成';
  if (status === 'failed') return '生成失败';
  return '生成中…';
}

/** 等级 → 所属分组（卡片等级 pill 用） */
function levelGroupOf(level: LessonLevel | undefined) {
  return levelGroups.find(x => x.levels !== null && level !== undefined && x.levels.includes(level));
}

/** 等级 pill 文案：等级 + 分组名，如 A2 Beginner */
function levelPillText(level: LessonLevel | undefined) {
  const g = levelGroupOf(level);
  if (!g || !level) return level ?? '';
  return `${level} · ${g.key==='beginner'?'Beginner':g.key==='intermediate'?'Intermediate':'Advanced'}`;
}
const CARD_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** YYYY-MM-DD → October 28, 2026（卡片封面下方日期，样式对标参考图） */
function formatCardDate(iso: string | undefined) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return `${CARD_MONTHS[m - 1]} ${d}, ${y}`;
}

/** 秒 → m:ss（卡片封面下方时长，如 0:50；分钟不补零，与参考图一致） */
function formatShortDuration(totalSeconds: number) {
  const safe = Math.max(0, Math.floor(totalSeconds || 0));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

/** 时间戳 → YYYY-MM-DD HH:mm */
function formatDate(ts: number) {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
</script>

<style scoped>
.merge-row {
  display: flex;
  align-items: center;
  padding: 8rpx 8rpx 20rpx;
}
.merge-avatar-wrap { position: relative; }
.avatar-edit { position: absolute; bottom: -4rpx; right: -4rpx; width: 34rpx; height: 34rpx; line-height: 30rpx; text-align: center; background: #d8ef92; border: 3rpx solid #fff; border-radius: 50%; color: #203b31; font-size: 18rpx; }
.avatar-badge { position: absolute; top: -8rpx; right: -8rpx; min-width: 32rpx; height: 32rpx; line-height: 32rpx; text-align: center; background: #fa5151; color: #fff; font-size: 20rpx; border-radius: 16rpx; padding: 0 8rpx; }
.merge-avatar {
  width: 88rpx;
  height: 88rpx;
  border-radius: 50%;
  margin-right: 14rpx;
  background: #f2f2f2;
  flex: none;
}
.merge-nick {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 36rpx;
  color: #203b31;
  font-weight: bold;
}
.merge-spacer {
  flex: 1;
}
.days-pill {
  display: flex;
  align-items: center;
  background: #ffffff;
  border-radius: 36rpx;
  padding: 10rpx 18rpx;
  margin-right: 12rpx;
  font-size: 24rpx;
  color: #555555;
  flex: none;
  box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.05);
}
.days-icon {
  width: 30rpx;
  height: 30rpx;
  margin-right: 8rpx;
}
.custom-nav {
  background-color: #f5f5f5;
}
.custom-nav-body {
  display: flex;
  align-items: center;
  justify-content: center;
}
.nav-title {
  font-family: inherit;
  font-size: 44rpx;
  color: #203b31;
  letter-spacing: 4rpx;
}

.container {
  padding: 24rpx;
}

.checkin-error {
  font-size: 24rpx;
  color: #e64340;
}

.checkin-btn {
  font-family: inherit;
  font-size: 28rpx;
  color: #203b31;
  background-color: #d8ef92;
  padding: 16rpx 32rpx;
  border-radius: 36rpx;
}

.checkin-btn.done {
  background-color: #eeeeee;
  color: #999999;
}

.checkin-btn.busy {
  opacity: 0.6;
}

.search-row {
  display: flex;
  gap: 16rpx;
  margin-bottom: 24rpx;
}

.search-input {
  flex: 1;
  height: 72rpx;
  padding: 0 24rpx;
  background-color: #ffffff;
  border-radius: 36rpx;
  font-size: 28rpx;
}

.search-icon-btn {
  width: 72rpx;
  height: 72rpx;
  padding: 0;
  border-radius: 50%;
  background-color: #f5f5f5;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.search-icon-btn::after {
  border: none;
}
.search-icon {
  width: 40rpx;
  height: 40rpx;
}

.tabs {
  display: flex;
  margin-bottom: 24rpx;
  background-color: #f2f2f2;
  border-radius: 36rpx;
  padding: 8rpx;
}

.tab-item {
  font-family: inherit;
  flex: 1;
  text-align: center;
  padding: 16rpx 0;
  font-size: 30rpx;
  color: #666666;
  border-radius: 28rpx;
}

.tab-item.active {
  color: #203b31;
  font-weight: bold;
  background-color: #d8ef92;
  box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.08);
}

.import-btn {
  font-family: inherit;
  margin-bottom: 24rpx;
}

.import-quota {
  font-size: 26rpx;
  color: #666666;
  margin-bottom: 24rpx;
}

.import-record {
  position: relative;
  background-color: #ffffff;
  border-radius: 16rpx;
  overflow: hidden;
  margin-bottom: 36rpx;
  box-shadow: 0 4rpx 16rpx rgba(0, 0, 0, 0.06);
}

.record-img {
  width: 100%;
  height: 300rpx;
  display: block;
  background: #f0f0f0;
}

.record-info {
  padding: 24rpx 28rpx 28rpx;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}

.record-delete {
  font-family: inherit;
  position: absolute;
  top: 20rpx;
  right: 20rpx;
  background-color: rgba(255, 255, 255, 0.92);
  color: #e64340;
  font-size: 26rpx;
  padding: 10rpx 22rpx;
  border-radius: 24rpx;
}

.record-delete-disabled {
  opacity: 0.5;
}

/* 上架申请行 */
.record-apply-row {
  margin-top: 8rpx;
}
.apply-btn {
  font-size: 26rpx;
  color: #203b31;
  background-color: #d8ef92;
  border-radius: 24rpx;
  padding: 6rpx 20rpx;
}
/* 上传/Change cover：黄底强调（封面唯一来源是用户上传，AI 换封面入口已下线） */
.upload-cover-btn {
  font-size: 26rpx;
  color: #203b31;
  background-color: #d8ef92;
  border-radius: 24rpx;
  padding: 6rpx 20rpx;
  margin-right: 16rpx;
}
/* 已共享（In review/已共享）后封面锁定，只提示不提供入口 */
.cover-locked-hint {
  font-size: 24rpx;
  color: #999999;
  margin-right: 16rpx;
}
.no-cover-hint {
  font-size: 24rpx;
  color: #edf1e8;
  margin-right: 16rpx;
}
.apply-pending {
  font-size: 26rpx;
  color: #999999;
}
.apply-approved {
  font-size: 26rpx;
  color: #66bb6a;
}

/* 官方卡片作者YOUR NAME */
.lesson-author {
  font-size: 26rpx;
  color: #999999;
  margin-left: 8rpx;
}

.record-title {
  font-family: inherit;
  font-size: 39rpx;
  font-weight: bold;
  margin-bottom: 8rpx;
  word-break: normal;
  overflow-wrap: break-word;
}

.record-meta {
  display: flex;
  justify-content: space-between;
  font-size: 26rpx;
  color: #666666;
}

.status-processing {
  color: #e6a23c;
}

.status-done {
  color: #67c23a;
}

.status-failed {
  color: #e64340;
}

.level-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16rpx;
  background-color: #ffffff;
  border-radius: 16rpx;
  padding: 16rpx 20rpx;
  margin-bottom: 24rpx;
}

.level-bar-label {
  color: #333333;
  font-size: 28rpx;
  font-weight: bold;
}

.level-pill-item {
  display: flex;
  align-items: center;
  font-family: inherit;
  background-color: #f2f2f2;
  border-radius: 32rpx;
  padding: 12rpx 24rpx;
}

.level-pill-item.active {
  background-color: #d8ef92;
}

.level-pill-name {
  color: #333333;
  font-size: 26rpx;
  font-weight: bold;
}

.level-pill-item.active .level-pill-name {
  color: #203b31;
}

.level-pill-count {
  color: #999999;
  font-size: 26rpx;
  margin-left: 10rpx;
}

.level-pill-item.active .level-pill-count {
  color: #5a4a00;
}

.level-dot {
  width: 16rpx;
  height: 16rpx;
  border-radius: 50%;
  flex-shrink: 0;
  margin-right: 10rpx;
}

.lesson-card {
  position: relative;
  margin-bottom: 36rpx;
  background-color: #ffffff;
  border-radius: 16rpx;
  overflow: hidden;
  box-shadow: 0 4rpx 16rpx rgba(0, 0, 0, 0.06);
}

.lesson-card-img {
  width: 100%;
  height: 340rpx;
  display: block;
  background: #f0f0f0;
}

.lesson-card-info {
  padding: 24rpx 28rpx 28rpx;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}

.lesson-title-row {
  display: flex;
  align-items: center;
  gap: 16rpx;
}

.level-pill {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  background-color: #f2f2f2;
  border: 2rpx solid #999999;
  border-radius: 24rpx;
  padding: 8rpx 18rpx;
}

.level-pill-text {
  color: #333333;
  font-family: inherit;
  font-size: 26rpx;
  font-weight: bold;
}

.lesson-title {
  font-family: inherit;
  font-size: 43rpx;
  font-weight: bold;
  color: #333333;
  text-decoration: underline;
  text-decoration-color: rgba(51, 51, 51, 0.6);
  text-decoration-thickness: 1px;
  text-underline-offset: 3rpx;
  flex: 1;
  min-width: 0;
  word-break: normal;
  overflow-wrap: break-word;
}

.lesson-new-tag {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 10;
  background-color: #d81e06;
  color: #ffffff;
  font-family: inherit;
  font-size: 26rpx;
  font-weight: bold;
  padding: 10rpx 18rpx;
  border-radius: 0 0 16rpx 0;
}

.lesson-date-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.lesson-date {
  font-size: 26rpx;
  color: #999999;
}

.lesson-duration {
  background-color: #f2f2f2;
  color: #333333;
  font-size: 24rpx;
  padding: 6rpx 18rpx;
  border-radius: 24rpx;
}

.empty {
  padding: 80rpx 0;
  text-align: center;
  font-size: 28rpx;
  color: #999999;
}

.import-empty {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}

.empty-title {
  font-size: 32rpx;
  color: #666666;
}

.empty-desc {
  font-size: 26rpx;
  color: #999999;
}

.load-more {
  margin: 24rpx 0;
}
.wave-loading {
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 10rpx;
  height: 56rpx;
}
.wave-bar {
  width: 10rpx;
  border-radius: 5rpx;
  background-color: #edf1e8;
  transform-origin: bottom;
  animation: wave-bounce 0.9s ease-in-out infinite;
}
.wave-bar:nth-child(1) {
  height: 28rpx;
  animation-delay: 0s;
}
.wave-bar:nth-child(2) {
  height: 48rpx;
  animation-delay: 0.12s;
}
.wave-bar:nth-child(3) {
  height: 56rpx;
  animation-delay: 0.24s;
}
.wave-bar:nth-child(4) {
  height: 40rpx;
  animation-delay: 0.36s;
}
.wave-bar:nth-child(5) {
  height: 24rpx;
  animation-delay: 0.48s;
}
@keyframes wave-bounce {
  0%,
  100% {
    transform: scaleY(0.35);
  }
  50% {
    transform: scaleY(1);
  }
}


</style>

<style scoped>
.container{padding:24rpx 28rpx calc(160rpx + env(safe-area-inset-bottom));background:#f7f6f9;min-height:100vh;box-sizing:border-box}.custom-nav{background:#f7f6f9}.nav-title{font-family:-apple-system,'PingFang SC',sans-serif;font-size:34rpx;font-weight:700;letter-spacing:2rpx}.merge-row{padding:8rpx 0 12rpx}.merge-avatar{width:72rpx;height:72rpx}.merge-nick{font-size:29rpx}.avatar-edit{font-size:15rpx;width:44rpx;height:25rpx;line-height:25rpx;right:0;bottom:-8rpx;background:#e9e2f2;color:#203b31;border:0}.days-pill{font-size:21rpx;padding:8rpx 12rpx;margin-right:10rpx;box-shadow:none}.days-icon{width:25rpx;height:25rpx}.checkin-btn{font-size:23rpx;padding:14rpx 22rpx;background:#eee7f6;color:#203b31}.home-intro{margin:26rpx 0 30rpx}.intro-eyebrow{display:block;font-size:23rpx;color:#77877b;margin-bottom:12rpx}.intro-title{display:block;font-size:49rpx;font-weight:750;color:#203b31;letter-spacing:1rpx}.intro-stats{display:flex;gap:25rpx;color:#77877b;font-size:22rpx;margin:22rpx 0}.continue-card{display:flex;align-items:center;justify-content:space-between;background:#203b31;color:#fff;padding:28rpx 30rpx;border-radius:26rpx;margin-top:24rpx;box-shadow:0 12rpx 28rpx rgba(49,29,74,.1)}.continue-card>view{flex:1;min-width:0}.continue-label{display:block;color:#edf1e8;font-size:21rpx;margin-bottom:12rpx}.continue-title{display:block;font-size:29rpx;font-weight:600;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.continue-meta{display:block;font-size:22rpx;color:#77877b;margin-top:14rpx}.continue-play{background:#d8ef92;color:#203b31;border-radius:50%;width:80rpx;height:80rpx;line-height:80rpx;text-align:center;font-size:29rpx;margin-left:24rpx}.starter{display:flex;justify-content:space-between;background:#fff3bf;border-radius:20rpx;color:#8b7133;font-size:23rpx;padding:24rpx}.search-row{gap:12rpx;margin-bottom:24rpx}.search-input{height:80rpx;border:1rpx solid #eee9f3;border-radius:22rpx;font-size:25rpx}.search-icon-btn{height:80rpx;width:70rpx;background:transparent}.search-icon{width:35rpx;height:35rpx}.tabs{padding:0;background:transparent;border-bottom:1rpx solid #e8e2ec;border-radius:0;gap:28rpx;justify-content:flex-start;margin-bottom:24rpx}.tab-item{flex:none;font-family:inherit;font-size:29rpx;color:#77877b;padding:16rpx 0 20rpx;border-radius:0}.tab-item.active{background:transparent;color:#203b31;border-bottom:5rpx solid #d8ef92;box-shadow:none}.level-bar{padding:0;background:transparent;gap:12rpx;margin-bottom:18rpx}.level-bar-label{display:none}.level-pill-item{padding:12rpx 18rpx;background:#fff;font-family:inherit;border:1rpx solid #eae4ef}.level-pill-item.active{background:#203b31;border-color:#203b31}.level-pill-item.active .level-pill-name,.level-pill-item.active .level-pill-count{color:#fff}.level-pill-name,.level-pill-count{font-size:22rpx}.level-dot{width:12rpx;height:12rpx;margin-right:7rpx}.unavailable{opacity:.45}.topic-scroll{white-space:nowrap;width:100%;margin:8rpx 0 28rpx}.topic-row{display:inline-flex;gap:14rpx}.topic-row text{font-size:23rpx;color:#77877b;padding:12rpx 18rpx;border-radius:14rpx}.topic-row .active{color:#795c2b;background:#fff1b7}.list-heading{display:flex;justify-content:space-between;align-items:center;margin:10rpx 0 24rpx;font-size:31rpx;font-weight:650;color:#203b31}.list-count{font-size:22rpx;color:#77877b;font-weight:400}.catalogue-status{font-size:26rpx;color:#77877b;text-align:center;padding:30rpx}.catalogue-status.error{color:#77877b}.lesson-card{border-radius:24rpx;margin-bottom:26rpx;box-shadow:0 5rpx 20rpx rgba(43,27,77,.035);border:1rpx solid #eee9f3}.lesson-card-img{height:240rpx}.lesson-card-info{padding:22rpx 26rpx 24rpx;gap:16rpx}.lesson-title-row{flex-direction:column;align-items:flex-start;gap:14rpx}.level-pill{padding:4rpx 12rpx;border:0;background:#f5f1f9;order:2}.level-pill-text{font-family:inherit;font-size:21rpx;color:#77877b}.lesson-title{font-family:-apple-system,'PingFang SC',sans-serif;font-size:33rpx;line-height:1.35;text-decoration:none;flex:none;width:100%;color:#203b31}.lesson-date{font-size:21rpx}.lesson-author{font-size:21rpx;margin-left:auto;margin-right:14rpx}.lesson-duration{font-size:22rpx;padding:4rpx 12rpx}.lesson-new-tag{font-family:inherit;font-size:20rpx;background:#d8ef92;color:#fff;border-radius:0 0 15rpx 0;padding:9rpx 15rpx}.lesson-summary{font-size:24rpx;line-height:1.6;color:#77877b}.lesson-footer{display:flex;justify-content:space-between;font-size:22rpx;color:#77877b;margin-top:4rpx}.lesson-footer text:last-child{color:#203b31}.record-img{height:220rpx}.record-title{font-family:inherit;font-size:31rpx;line-height:1.4}.import-btn{font-family:inherit;font-size:28rpx;background:#d8ef92;border-radius:22rpx}.record-delete{font-family:inherit;font-size:23rpx}.record-apply-row{display:flex;gap:12rpx;flex-wrap:wrap}.load-more{margin:20rpx}
</style>

<style scoped>

.container{padding:0 30rpx calc(160rpx + env(safe-area-inset-bottom));background:#f8f9f5;min-height:100vh}.custom-nav{background:transparent;margin:0 -2rpx}.custom-nav-body{justify-content:flex-start;gap:11rpx;padding:0 0 0 2rpx}.nav-title{font-family:inherit;font-size:32rpx;letter-spacing:-1rpx;font-weight:750;text-align:left;margin:0;width:auto;color:#203b31}.brand-dot{color:#77994a}.brand-mark{display:flex;gap:4rpx;align-items:center;width:28rpx;height:30rpx}.brand-mark view{width:5rpx;border-radius:5rpx;background:#203b31;height:15rpx}.brand-mark view:nth-child(2){height:28rpx}.brand-mark view:nth-child(3){height:21rpx}.merge-row{padding:24rpx 0 0;gap:12rpx}.merge-avatar{width:62rpx;height:62rpx;margin:0;background:#edf1e7;border:3rpx solid #fff}.greeting{flex:1;display:flex;flex-direction:column;gap:4rpx}.greeting-label{font-size:16rpx;letter-spacing:2rpx;color:#929c90;font-weight:600}.merge-nick{font-size:28rpx;font-weight:650;color:#273b31;line-height:1.2}.days-pill{background:transparent;padding:0;font-size:20rpx;color:#6b796b;margin:0;gap:5rpx}.days-icon{display:none}.checkin-btn{background:#e9efdf;color:#416039;padding:14rpx 19rpx;font-size:21rpx;font-weight:600;border:1rpx solid #dde7d3;border-radius:30rpx}.checkin-btn.done{background:#edf1e6;color:#77866d}.home-intro{margin:44rpx 0 30rpx}.intro-eyebrow{font-size:18rpx;color:#839078;font-weight:600;letter-spacing:3rpx;margin-bottom:18rpx}.intro-title{font-family:inherit;white-space:pre-line;font-size:64rpx;line-height:1.05;letter-spacing:-3rpx;font-weight:750;color:#20372d;max-width:620rpx}.intro-stats{margin:24rpx 0 30rpx;font-size:21rpx;gap:16rpx;color:#7c8977;align-items:center}.stats-separator{color:#c5cdba}.continue-card{background:#203b31;position:relative;padding:27rpx 28rpx 38rpx;border-radius:24rpx;min-height:178rpx;box-shadow:0 14rpx 28rpx rgba(29,54,39,.09);overflow:hidden}.continue-label{font-size:16rpx;font-weight:500;letter-spacing:2rpx;color:#b4c9ac;margin-bottom:13rpx}.continue-title{font-family:inherit;color:#fff;font-size:29rpx;font-weight:550;line-height:1.3;white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;letter-spacing:-.4rpx}.continue-meta{font-size:20rpx;color:#a6bc9f;margin-top:12rpx}.continue-play{width:72rpx;height:72rpx;min-width:72rpx;background:#d8ef92;margin-left:22rpx;display:flex;align-items:center;justify-content:center}.play-triangle{width:0;height:0;border-top:12rpx solid transparent;border-bottom:12rpx solid transparent;border-left:18rpx solid #203b31;margin-left:5rpx}.continue-progress{position:absolute;bottom:0;left:0;right:0;height:5rpx;background:#3c5745}.continue-progress view{height:100%;background:#d8ef92}.starter{background:#ebf0df;color:#536742;font-size:24rpx}.search-row{background:#fff;border:1rpx solid #e7ebdf;border-radius:19rpx;gap:0;padding:0 8rpx 0 8rpx;height:83rpx;margin:26rpx 0 27rpx;box-shadow:0 4rpx 12rpx rgba(32,59,49,.015)}.search-input{background:transparent;border:0;height:80rpx;padding:0 17rpx;font-size:25rpx;border-radius:0}.search-icon-btn{height:80rpx;width:64rpx;display:flex;align-items:center;justify-content:center;padding:0;margin:0}.search-icon{width:30rpx;height:30rpx;opacity:.6;filter:grayscale(1)}.tabs{border:0;display:flex;gap:32rpx;margin:0 0 28rpx;align-items:center}.tab-item{padding:11rpx 0 13rpx;color:#9ca594;font-size:26rpx;font-weight:500;border-bottom:3rpx solid transparent}.tab-item.active{color:#203b31;font-weight:700;border-color:#203b31}.level-bar{display:flex;flex-wrap:nowrap;gap:8rpx;margin:6rpx 0 17rpx;width:100%;overflow:hidden}.level-pill-item{flex:1;min-width:0;justify-content:center;gap:0;padding:13rpx 8rpx;border-radius:13rpx;background:#edf1e6;border:0}.level-pill-item.active{background:#203b31}.level-pill-name{font-size:20rpx;font-weight:550;white-space:nowrap}.level-pill-count{font-size:18rpx;opacity:.6;margin-left:5rpx}.level-pill-item .level-dot{display:none}.topic-scroll{margin:0 0 26rpx}.topic-row{gap:7rpx}.topic-row text{padding:12rpx 16rpx;font-size:22rpx;color:#7e8c76;border-radius:12rpx}.topic-row .active{background:#e7efcf;color:#456034}.list-heading{font-size:31rpx;font-weight:700;color:#20372d;letter-spacing:-.8rpx;margin:12rpx 0 21rpx}.list-count{font-size:20rpx;color:#8d9983;font-weight:400;letter-spacing:0}.lesson-card{display:flex;position:relative;border:0;background:transparent;border-bottom:1rpx solid #e5eadd;border-radius:0;padding:0 0 26rpx;margin:0 0 26rpx;box-shadow:none;overflow:hidden}.lesson-card-img{width:178rpx;height:178rpx;flex:none;border-radius:18rpx}.lesson-card-info{flex:1;min-width:0;padding:5rpx 0 0 23rpx;display:flex;flex-direction:column;gap:12rpx}.lesson-date-row{display:flex;order:2;color:#8f9987;gap:7rpx;line-height:1.2}.lesson-date{font-size:18rpx;display:none}.lesson-author{display:none}.lesson-duration{font-size:19rpx;background:transparent;padding:0;margin:0;color:#7d8b72}.lesson-title-row{gap:10rpx;align-items:flex-start}.lesson-title{font-family:inherit;font-size:28rpx;line-height:1.25;letter-spacing:-.6rpx;font-weight:650;color:#263d30}.level-pill{border:0;padding:0;background:transparent;order:2;border-radius:0}.level-pill .level-dot{width:8rpx;height:8rpx;margin-right:7rpx;background:#8ba768!important}.level-pill-text{font-size:18rpx;font-weight:500;color:#728566;font-family:inherit}.lesson-footer{margin-top:auto;font-size:19rpx;gap:10rpx;color:#89977e}.lesson-footer text:last-child{color:#405f38;font-weight:600}.lesson-new-tag{display:none}.featured{display:block;border:1rpx solid #e5eadd;background:#fff;border-radius:23rpx;padding:0;margin-bottom:29rpx}.featured .lesson-card-img{width:100%;height:276rpx;border-radius:0}.featured .lesson-card-info{padding:23rpx 25rpx 24rpx;gap:15rpx}.featured .lesson-title{font-size:36rpx;letter-spacing:-1rpx;line-height:1.18}.featured .lesson-title-row{gap:14rpx}.featured .lesson-date-row{position:absolute;top:229rpx;right:18rpx;order:0}.featured .lesson-duration{background:rgba(255,255,255,.93);color:#263d30;padding:6rpx 12rpx;border-radius:10rpx;font-size:19rpx}.featured .lesson-footer{margin-top:2rpx}.featured .lesson-new-tag{display:block;background:#d8ef92;color:#294326;top:17rpx;left:17rpx;border-radius:8rpx;font-size:16rpx;letter-spacing:1rpx;padding:7rpx 11rpx;font-weight:700}.empty{font-size:26rpx;color:#77866d;padding:55rpx 20rpx}.empty-desc{font-size:23rpx;line-height:1.7;color:#95a08e}.import-record{border-radius:21rpx;border:1rpx solid #e5eadd;box-shadow:none}.import-btn{font-size:26rpx;background:#203b31;color:#fff;border-radius:17rpx;padding:24rpx}.record-title{font-family:inherit;font-weight:650;color:#203b31}.record-img{height:220rpx}.import-quota{color:#7c8b72;font-size:23rpx}.record-delete{color:#8e6262}.import-empty{margin-top:36rpx}

</style>

<style scoped>.intro-title text{display:block}.continue-card>.continue-play{flex:none;min-width:72rpx;width:72rpx;height:72rpx}.continue-card>.continue-progress{flex:none}.checkin-btn{font-family:inherit}.intro-title{font-size:60rpx;letter-spacing:-2.5rpx}</style>

<style scoped>.lesson-date-row{display:none}.featured .lesson-date-row{display:flex}.featured .level-duration{display:none}.load-more-btn{background:transparent;border:1rpx solid #dbe5ce;color:#637d4e;font-size:24rpx;border-radius:15rpx;padding:23rpx 25rpx;display:flex;justify-content:center;gap:20rpx;margin:5rpx 0 20rpx}.load-more-btn::after{border:0}</style>

<style scoped>

.container{background:#fff;padding-left:28rpx;padding-right:28rpx}.custom-nav{background:linear-gradient(110deg,#1d0b40,#0e071c);margin:0 -28rpx;padding-left:28rpx;padding-right:28rpx}.nav-title{color:#fff;font-family:ListHeading,'Arial Narrow',sans-serif;font-size:39rpx;font-weight:700;letter-spacing:0}.brand-dot{color:#ffcf00}.brand-mark view{background:#ffcf00}.merge-row{padding-top:26rpx}.greeting-label{color:#9295a0}.merge-nick{color:#22222c}.checkin-btn{background:#ffcf00;color:#292131;border:0}.days-pill{color:#7a7c87}.home-intro{margin:32rpx 0 27rpx}.intro-eyebrow{color:#8a7b62;font-size:17rpx;letter-spacing:2rpx}.intro-title{font-family:ListHeading,'Arial Narrow',sans-serif;font-size:51rpx;line-height:1.04;letter-spacing:0;color:#17151f}.intro-stats{color:#85858f;font-size:20rpx;margin:20rpx 0 24rpx}.continue-card{background:linear-gradient(120deg,#2b1458,#16092e);padding:25rpx 26rpx 32rpx;border-radius:19rpx;box-shadow:none}.continue-label{color:#b8a9d2;font-size:16rpx;letter-spacing:1.7rpx}.continue-title{font-family:ListHeading,sans-serif;font-size:31rpx;line-height:1.13;font-weight:700;letter-spacing:.2rpx}.continue-meta{color:#aaa0bc;font-size:20rpx}.continue-play{background:#ffcf00}.play-triangle{border-left-color:#24123e}.continue-progress{background:#412b63}.continue-progress view{background:#ffcf00}.search-row{border-color:#e2e4eb;background:#fafbfc;box-shadow:none;border-radius:13rpx}.tabs{gap:30rpx}.tab-item{color:#92919c;font-size:25rpx}.tab-item.active{color:#25143e;border-color:#ffce00}.list-heading{font-family:ListHeading,sans-serif;color:#18171e;font-weight:700;font-size:36rpx;letter-spacing:0;align-items:baseline;margin-top:30rpx}.list-count{font-family:Arial,sans-serif;font-size:20rpx;color:#9295a1}.level-bar{background:#f7f8fa;border:1rpx solid #dfe4ed;border-radius:14rpx;padding:18rpx;display:flex;flex-wrap:wrap;gap:10rpx}.level-bar-label{display:block;font-size:22rpx;color:#555969;padding:12rpx 6rpx;font-weight:600}.level-pill-item{flex:none;border:1rpx solid #dce2eb;border-radius:28rpx;padding:12rpx 17rpx;background:#fff}.level-pill-item.active{background:#ffcf00;border-color:#ffcf00}.level-pill-item.active .level-pill-name,.level-pill-item.active .level-pill-count{color:#3a311a}.level-pill-name{font-size:21rpx;color:#5d6070}.level-pill-count{color:#9a9eaa}.topic-scroll{background:#f8f9fb;border:1rpx solid #e1e5ed;border-radius:14rpx;margin-top:14rpx;padding:13rpx}.topic-row{display:flex;flex-wrap:wrap;width:100%;gap:6rpx;white-space:normal}.topic-row text{padding:11rpx 14rpx;border:1rpx solid #e0e4ec;border-radius:25rpx;font-size:20rpx;color:#757887;background:#fff}.topic-row .active{background:#ffcf00;border-color:#ffcf00;color:#3f3422}.lesson-card,.featured{display:block;background:transparent;border:0;border-bottom:1rpx solid #e1e4eb;border-radius:0;padding:0 0 28rpx;margin-bottom:32rpx}.lesson-card-img,.featured .lesson-card-img{width:100%;height:330rpx;border-radius:17rpx}.lesson-card-info,.featured .lesson-card-info{display:flex;padding:20rpx 0 0;gap:15rpx}.lesson-title-row{display:flex;gap:15rpx}.lesson-title,.featured .lesson-title{font-family:ListHeading,'Arial Narrow',sans-serif;text-transform:uppercase;font-size:38rpx;line-height:1.05;font-weight:700;letter-spacing:.2rpx;color:#191820}.lesson-date-row,.featured .lesson-date-row{display:flex;position:static;top:auto;right:auto;order:-1;align-items:center;justify-content:space-between;gap:10rpx}.lesson-date{display:block;font-size:20rpx;color:#9599a5}.lesson-author{display:none}.lesson-duration,.featured .lesson-duration{padding:5rpx 12rpx;border:1rpx solid #dce0e7;border-radius:20rpx;background:#f7f8fa;font-size:19rpx;color:#6d7180;line-height:1.1}.lesson-new-tag,.featured .lesson-new-tag{display:block;position:absolute;top:20rpx;left:18rpx;padding:10rpx 15rpx;background:#ffcf00;color:#3a3017;border-radius:0;font-size:18rpx;font-weight:700;letter-spacing:.5rpx;text-transform:uppercase;max-width:85%}.level-pill{background:#edf8f0;border:1rpx solid #79b48c!important;padding:5rpx 12rpx;border-radius:25rpx;order:2}.level-pill-text{color:#3e7652;font-size:19rpx;font-weight:600}.level-pill .level-dot{background:#38a965!important}.level-duration{display:none}.lesson-summary{display:block;color:#80828d;font-size:25rpx;line-height:1.6}.lesson-footer{font-size:21rpx;color:#9a9ca7}.lesson-footer text:first-child{display:none}.lesson-footer text:last-child{color:#514069;margin-left:auto}.load-more-btn{border-color:#ddd7e7;color:#58476c;background:#faf8fd}.empty{background:#faf9fc;color:#8e869b}.import-btn{background:#ffcf00;color:#30233d}.record-title{font-family:ListHeading,sans-serif;color:#25202f;font-size:35rpx}

</style>

<style scoped>
/* Original level selector: full labels, colored dots and naturally wrapping pills. */
.level-bar{display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-start;gap:14rpx;background:#fff;border:0;border-radius:16rpx;padding:16rpx 14rpx;margin-bottom:20rpx;overflow:visible}
.level-bar-label{display:block;color:#333;font-size:26rpx;font-weight:600;padding:0;margin-right:2rpx}
.level-pill-item{display:flex;align-items:center;justify-content:flex-start;flex:none;min-width:0;background:#f2f2f2;border:0;border-radius:32rpx;padding:11rpx 20rpx;gap:0;font-family:inherit}
.level-pill-item.active{background:#ffcf00;border:0}
.level-pill-name{font-size:24rpx;font-weight:600;color:#333;white-space:nowrap}
.level-pill-count{font-size:22rpx;font-weight:400;color:#999;margin-left:9rpx;opacity:1}
.level-pill-item.active .level-pill-name{color:#2b1b4d}.level-pill-item.active .level-pill-count{color:#766000}
.level-bar .level-dot{display:inline-block;width:13rpx;height:13rpx;flex:none;border-radius:50%;margin-right:9rpx}
.level-pill-item.unavailable{opacity:.45}
</style>

<style scoped>
.home-intro{margin-bottom:30rpx}.intro-title{font-size:48rpx;margin:12rpx 0 22rpx}.intro-stats{margin:20rpx 0 0;font-size:21rpx}.continue-card{margin-top:0;padding:26rpx 25rpx;min-height:125rpx}.continue-title{font-size:30rpx;line-height:1.15}.continue-label{font-size:17rpx}.topic-toolbar{display:flex;align-items:center;justify-content:space-between;margin:12rpx 0 28rpx}.selected-topic{background:#fff4bf;color:#493e20;border-radius:30rpx;padding:14rpx 22rpx;font-size:23rpx}.topics-trigger{margin:0;border:1rpx solid #e4dfeb;background:#fff;color:#281247;font-size:23rpx;border-radius:30rpx;padding:10rpx 22rpx;line-height:1.6}.topics-trigger text{margin-left:20rpx}.topic-options{background:#faf8fc;border:1rpx solid #e9e2ef;border-radius:18rpx;padding:8rpx 22rpx;margin:-10rpx 0 26rpx}.topic-options>view{display:flex;justify-content:space-between;min-height:82rpx;align-items:center;font-size:25rpx;color:#70657b;border-bottom:1rpx solid #ede7f2}.topic-options>view:last-child{border:0}.topic-options .selected{color:#281247;font-weight:600}.list-heading{margin-top:25rpx}
</style>

<style scoped>.resume-cover{width:100rpx;height:115rpx;border-radius:12rpx;flex-shrink:0;margin-right:18rpx}.continue-card .resume-copy{flex:1;min-width:0}.continue-card .continue-play{flex-shrink:0;margin-left:15rpx;width:66rpx;height:66rpx}.continue-title{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}</style>
<style scoped>
.learning-checkin{display:flex;align-items:center;justify-content:flex-start;flex:none;gap:9px;margin:0 0 0 auto;padding:0;min-height:46px;background:transparent;border:0;border-radius:12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.3;text-align:left}
.learning-checkin::after{border:0}.learning-checkin-number{display:flex;align-items:center;justify-content:center;min-width:42px;height:46px;padding:0 7px;box-sizing:border-box;background:#fff0a6;border-radius:12px;color:#39264b;font-size:24px;font-weight:650;font-variant-numeric:tabular-nums}.learning-checkin-copy{display:flex;flex-direction:column;gap:5px}.learning-checkin-title{font-size:12px;font-weight:500;color:#25212d;white-space:nowrap;letter-spacing:0}.learning-checkin-status{font-size:11px;color:#4a2b68;white-space:nowrap}.learning-checkin.busy{opacity:.65}
</style>

<style scoped>
.learning-checkin-sun{position:relative;width:46px;height:46px;flex:none;display:flex;align-items:center;justify-content:center}
.learning-sun-ray{position:absolute;inset:0;margin:auto;width:2px;height:46px;pointer-events:none}.learning-sun-ray::before{content:'';position:absolute;top:0;left:0;width:2px;height:4px;border-radius:2px;background:#e5b72e}
.learning-checkin-sun .learning-checkin-number{position:relative;min-width:32px;width:32px;height:32px;padding:0;border-radius:50%;background:#fff0a6;border:1px solid #f0d26a;font-size:20px;color:#503852;line-height:1}
.learning-checkin-sun .sun-count-small{font-size:14px}
</style>

<style scoped>
.learning-checkin-calendar{width:46px;height:46px;flex:none;display:flex;align-items:center;justify-content:center}
.learning-calendar-sheet{position:relative;width:36px;height:38px;margin-top:3px;border:1px solid #e8cd72;border-radius:8px;background:#fff6cf;box-sizing:border-box}
.learning-calendar-header{position:absolute;top:0;left:0;right:0;height:11px;background:#ffdc66;border-radius:7px 7px 0 0;border-bottom:1px solid #edcf73}
.learning-calendar-ring{position:absolute;top:-4px;width:3px;height:8px;background:#aa8033;border-radius:2px}.learning-calendar-ring.ring-left{left:8px}.learning-calendar-ring.ring-right{right:8px}
.learning-calendar-number{position:absolute;left:0;right:0;top:12px;bottom:0;display:flex;align-items:center;justify-content:center;color:#503852;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:19px;font-weight:650;font-variant-numeric:tabular-nums;line-height:1}.learning-calendar-number.calendar-count-small{font-size:14px}
</style>

<style scoped>
/* Keep the compact calendar intact, with a single centered label. */
.custom-nav-body .nav-title{font-size:34rpx;max-width:calc(100vw - 140px);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex-shrink:1}
.greeting{min-width:0}.greeting-label,.merge-nick{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.learning-checkin-copy{justify-content:center;align-self:stretch;gap:0}
.learning-checkin-title{font-size:11px;font-weight:600;letter-spacing:.25px;line-height:1.35}
@media(max-width:350px){.learning-checkin{gap:5px}.learning-checkin-title{font-size:10px;letter-spacing:0}}
</style>

<style scoped>
/* Native, scalable artwork keeps the import entry crisp without another image request. */
.import-promo{position:relative;isolation:isolate;overflow:hidden;display:flex;align-items:center;justify-content:space-between;gap:14px;margin:2px 0 22px;padding:17px 18px 16px;border:1px solid #4e2b6b;border-radius:14px;background:linear-gradient(118deg,#421957 0%,#2b1045 65%,#34114f 100%);color:#fff;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Helvetica Neue',sans-serif;box-sizing:border-box}
.import-promo-copy{position:relative;z-index:1;flex:1;min-width:0}
.import-promo-title{font-size:20px;line-height:1.3;font-weight:650;letter-spacing:.2px;color:#fff}
.import-promo-title text{display:block;white-space:nowrap}
.import-promo-description{display:block;margin-top:7px;color:#ddcce9;font-size:11px;font-weight:400;line-height:1.6;letter-spacing:0;white-space:nowrap}
.import-promo-action{display:flex;align-items:center;justify-content:center;gap:9px;width:144px;min-height:40px;padding:0 15px;margin:11px 0 0;border:0;border-radius:23px;background:#ffcf00;color:#241039;font-family:inherit;font-size:15px;font-weight:650;line-height:1.3;box-sizing:border-box}
.import-promo-action::after{border:0}.import-promo-action:active{background:#f5c600}
.import-promo-plus{position:relative;width:15px;height:15px;flex:0 0 15px}.import-promo-plus::before,.import-promo-plus::after{content:'';position:absolute;background:currentColor;border-radius:1px;left:0;right:0;top:0;bottom:0;margin:auto}.import-promo-plus::before{height:2px;width:15px}.import-promo-plus::after{width:2px;height:15px}
.import-promo-art{position:relative;z-index:1;flex:0 0 104px;min-width:0;margin-top:3px}
.import-promo-conversion{display:flex;align-items:center;justify-content:space-between;gap:7px;height:57px}
.import-promo-document{position:relative;display:flex;flex-direction:column;justify-content:flex-end;gap:6px;width:35px;height:45px;flex:0 0 35px;padding:0 6px 8px;border:2px solid #f2e8fc;border-radius:5px;box-sizing:border-box}
.import-promo-fold{position:absolute;right:-2px;top:-2px;width:12px;height:12px;background:#34134c;border-left:2px solid #f2e8fc;border-bottom:2px solid #f2e8fc;border-bottom-left-radius:3px}.import-promo-fold::after{content:'';position:absolute;left:-2px;top:4px;width:16px;height:2px;background:#f2e8fc;transform:rotate(45deg);transform-origin:center}
.import-promo-line{width:100%;height:2px;border-radius:2px;background:#f2e8fc}.import-promo-line.line-short{width:65%}
.import-promo-arrow{position:relative;width:14px;height:2px;flex:0 0 14px;background:#ffcf00;border-radius:2px}.import-promo-arrow::after{content:'';position:absolute;right:0;top:-3px;width:6px;height:6px;border-right:2px solid #ffcf00;border-top:2px solid #ffcf00;transform:rotate(45deg)}
.import-promo-audio{display:flex;align-items:center;justify-content:center;gap:3px;height:45px;flex:1}.import-promo-audio>view{width:3px;background:#ffcf00;border-radius:3px}
.import-promo-formats{display:flex;align-items:center;justify-content:space-between;gap:4px;margin-top:6px}.import-promo-formats text{display:flex;align-items:center;justify-content:center;flex:1;min-width:0;padding:3px 4px;border:1px solid rgba(238,220,255,.66);border-radius:12px;color:#f2e7ff;font-size:8px;line-height:1;font-weight:600;letter-spacing:.1px}
.import-promo-wave{position:absolute;z-index:0;pointer-events:none;width:300px;height:110px;border-radius:50%;right:-140px;bottom:-92px;background:rgba(139,84,192,.25);transform:rotate(-13deg)}.import-promo-wave.wave-back{right:-30px;bottom:-100px;transform:rotate(10deg);background:rgba(139,84,192,.17)}
@media(max-width:390px){.import-promo{gap:10px;padding-left:16px;padding-right:15px}.import-promo-title{font-size:19px}.import-promo-art{flex-basis:90px}.import-promo-conversion{gap:5px}.import-promo-document{width:31px;flex-basis:31px;height:41px}.import-promo-description{font-size:10px}.import-promo-audio{gap:2px}}
@media(max-width:350px){.import-promo{gap:8px;padding:16px 13px}.import-promo-title{font-size:18px;letter-spacing:0}.import-promo-description{white-space:normal;max-width:175px;font-size:10px;line-height:1.5}.import-promo-art{flex-basis:76px}.import-promo-document{width:27px;flex-basis:27px;padding-left:4px;padding-right:4px}.import-promo-arrow{width:10px;flex-basis:10px}.import-promo-audio>view{width:2px}.import-promo-formats{gap:3px}.import-promo-formats text{font-size:7px;padding:3px 2px}.import-promo-action{width:130px;font-size:14px}}
</style>

<style scoped>
/* Localized copy uses natural Chinese spacing while keeping the compact player proportions. */
.continue-card .continue-label{font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Helvetica Neue',Arial,sans-serif;font-size:12px;font-weight:400;line-height:1.4;letter-spacing:0;margin-bottom:6px;color:#c1afd8}
.continue-card .continue-title{font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Helvetica Neue',Arial,sans-serif;font-size:17px;font-weight:600;line-height:1.3;letter-spacing:0;white-space:normal;word-break:normal;overflow-wrap:break-word;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.continue-card .continue-meta{font-size:11px;line-height:1.4;letter-spacing:0;margin-top:5px;font-variant-numeric:tabular-nums;color:#ad9bc5}
@media(max-width:350px){.continue-card .continue-title{font-size:15px}.continue-card .continue-label{font-size:11px}}
</style>

<style scoped>
.lesson-footer text:last-child{font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Helvetica Neue',Arial,sans-serif;font-size:12px;font-weight:500;line-height:1.5;letter-spacing:0;white-space:nowrap}
</style>

<style scoped>
.search-input,.tab-item{font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Helvetica Neue',Arial,sans-serif;letter-spacing:0}.search-input{font-size:14px}.tab-item{font-size:14px;line-height:1.5;font-weight:500}.tab-item.active{font-weight:600}
</style>

<style scoped>
/* Give the course/library switch a clear, stable hierarchy on phone screens. */
.tabs{gap:28px;align-items:stretch;margin:0 0 18px;padding:0;border:0;background:transparent}
.tab-item{position:relative;display:flex;align-items:center;justify-content:center;flex:none;min-height:48px;box-sizing:border-box;padding:6px 0 10px;border:0;border-radius:0;font-size:17px;font-weight:500;line-height:1.5;letter-spacing:0;color:#94899f}
.tab-item.active{border:0;color:#281247;font-weight:650;background:transparent;box-shadow:none}
.tab-item::after{content:'';position:absolute;left:0;right:0;bottom:0;height:3px;border-radius:3px;background:transparent}
.tab-item.active::after{background:#ffcf00}
@media(max-width:350px){.tabs{gap:24px}.tab-item{font-size:16px}}
</style>

<style scoped>
.import-btn{font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Helvetica Neue',Arial,sans-serif;font-size:15px;font-weight:650;letter-spacing:0;color:#241039}
</style>

<style scoped>
.record-meta,.record-apply-row{font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Helvetica Neue',Arial,sans-serif;font-size:12px;line-height:1.6;letter-spacing:0}
.record-apply-row{display:flex;align-items:center;flex-wrap:wrap;gap:6px 12px}
.cover-locked-hint{font-size:11px;line-height:1.6;letter-spacing:0}
</style>
