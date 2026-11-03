<template>
  <view class="container">
    <!-- 自定义导航栏：站酷快乐体标题（原生导航栏不支持艺术字体） -->
    <view class="custom-nav" :style="{ paddingTop: statusBarHeight + 'px' }">
      <view class="custom-nav-body" :style="{ height: navContentHeight + 'px' }">
        <text class="nav-title">口语搭子</text>
      </view>
    </view>
    <!-- 顶栏（v75）：头像 + 昵称 + 打卡图标/天数 + 打卡按钮，一行 -->
    <view class="merge-row">
      <block v-if="profile">
        <view class="merge-avatar-wrap" @click="onAvatarTap">
          <image class="merge-avatar" :src="profileAvatarUrl" mode="aspectFill" />
          <text v-if="unreadCount > 0" class="avatar-badge">{{ unreadCount > 99 ? '99+' : unreadCount }}</text>
          <text class="avatar-edit">✎</text>
        </view>
        <text class="merge-nick" @click="onAvatarTap">{{ profile.nickName }}</text>
      </block>
      <view v-else class="merge-spacer" />
      <view class="days-pill">
        <image class="days-icon" src="/static/checkin-icon.png" mode="aspectFit" />
        <text>已打卡 {{ checkinTotal }} 天</text>
      </view>
      <view
        class="checkin-btn"
        :class="{ done: checkinToday, busy: checking }"
        @click="onCheckin"
      >{{ checkinToday ? '今日已打卡 ✓' : '今日打卡' }}</view>
    </view>
    <text v-if="checkinError" class="checkin-error">{{ checkinError }}</text>

    <!-- 搜索框：按标题关键词搜索 -->
    <view class="search-row">
      <input
        v-model="keyword"
        class="search-input"
        placeholder="搜索课程标题"
        confirm-type="search"
        @confirm="onSearchConfirm"
      />
      <button class="search-btn search-icon-btn" @click="onSearchConfirm">
        <image class="search-icon" src="/static/search.png" mode="aspectFit" />
      </button>
    </view>

    <!-- 栏目 tabs：共享课程 / 我的导入 -->
    <view class="tabs">
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
      <!-- 难度分组筛选（深色条 + 彩点 + 数量，选中黄色；横向可滑） -->
      <view class="level-bar">
        <text class="level-bar-label">Level:</text>
        <view
          v-for="group in levelGroups"
          :key="group.key"
          class="level-pill-item"
          :class="{ active: levelFilter === group.key }"
          @click="onLevelChange(group.key)"
        >
          <text v-if="group.key !== 'all'" class="level-dot" :style="{ backgroundColor: group.color }"></text>
          <text class="level-pill-name">{{ group.label }}</text>
          <text v-if="group.key !== 'all'" class="level-pill-count">{{ groupCounts[group.key] }}</text>
        </view>
      </view>

      <!-- 课程列表 -->
      <view v-if="displayedLessons.length > 0">
        <view
          v-for="lesson in displayedLessons"
          :key="lesson.id"
          class="lesson-card"
          @click="goDetail(lesson.id)"
        >
          <image class="lesson-card-img" :src="coverSrc(lesson.cover)" mode="aspectFill" @click.stop="goDetail(lesson.id)" @error="onCoverError(lesson.cover)" />
          <text v-if="lesson.date === latestDate" class="lesson-new-tag">NEW</text>
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
                <text class="level-pill-text">{{ levelPillText(lesson.level) }}</text>
              </view>
              <text class="lesson-title" @click.stop="goDetail(lesson.id)">{{ lesson.title }}</text>
            </view>
          </view>
        </view>
      </view>
      <view v-else class="empty">
        <text v-if="allOfficialLessons.length === 0">暂无共享课程</text>
        <text v-else>没有找到符合条件的课程</text>
        <text v-if="allOfficialLessons.length === 0" class="empty-desc">
          去「我的导入」上传一篇英文文章，处理完成后就能在这里开始学习
        </text>
      </view>

      <!-- 分页：滑到底部自动加载，也有手动按钮兜底 -->
      <view v-if="hasMore" class="load-more">
        <view class="wave-loading">
          <view class="wave-bar"></view>
          <view class="wave-bar"></view>
          <view class="wave-bar"></view>
          <view class="wave-bar"></view>
          <view class="wave-bar"></view>
        </view>
      </view>
    </block>

    <!-- 我的导入 -->
    <view v-else>
      <button class="import-btn" @click="goImport">＋ 导入文章（txt / md / docx / pdf）</button>
      <view v-if="importQuota" class="import-quota">
        剩余可用额度：{{ importAvailableText }}
      </view>
      <view v-if="importRecords.length > 0">
        <view
          v-for="record in importRecords"
          :key="record._id"
          class="import-record"
          @click="onImportTap(record)"
        >
          <image class="record-img" :src="coverSrc(recordCover(record))" mode="aspectFill" @click.stop="onImportTap(record)" @error="onCoverError(recordCover(record))" />
          <view class="record-info">
            <view class="record-title" @click.stop="onImportTap(record)">{{ record.title }}</view>
            <view class="record-meta">
              <text :class="'status-' + record.status">{{ statusText(record.status) }}</text>
              <text class="record-time">{{ formatDate(record.createdAt) }}</text>
            </view>
            <view v-if="record.status === 'done'" class="record-apply-row">
              <text v-if="!record.applyOfficial" class="apply-btn" @click.stop="onApplyTap(record)">申请共享</text>
              <text v-else-if="record.officialStatus === 'pending'" class="apply-pending">审核中</text>
              <text v-else-if="record.officialStatus === 'approved'" class="apply-approved">已共享 ✓</text>
              <text v-else class="apply-btn" @click.stop="onApplyTap(record)">重新申请</text>
            </view>
          </view>
          <text
            v-if="record.status === 'done' || record.status === 'failed'"
            :class="['record-delete', isDeleting ? 'record-delete-disabled' : '']"
            @click.stop="onDeleteTap(record)"
          >删除</text>
        </view>
      </view>
      <view v-else-if="importsLoading" class="empty import-empty">
        <text class="empty-title">加载中…</text>
      </view>
      <view v-else class="empty import-empty">
        <text class="empty-title">还没有导入的文件</text>
        <text class="empty-desc">点上面按钮导入一篇英文文章，处理完成后可点开学习</text>
      </view>
    </view>

  </view>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { onLoad, onReachBottom, onShow, onUnload } from '@dcloudio/uni-app'
import { lessons } from '@/mock/lessons'
import { useAudioStore } from '@/stores/audio'
const audioStore = useAudioStore()
import type { LessonLevel } from '@/types/lesson'
import { COVER_URLS_CACHE_KEY, coverUrlFresh, localCover } from '@/utils/cover'

// 自定义导航栏高度：状态栏 + 胶囊对齐的内容区
const statusBarHeight = ref(20)
const navContentHeight = ref(44)
try {
  const sys = uni.getSystemInfoSync()
  statusBarHeight.value = sys.statusBarHeight || 20
  const menu = wx.getMenuButtonBoundingClientRect()
  if (menu && menu.height) {
    navContentHeight.value = (menu.top - statusBarHeight.value) * 2 + menu.height
  }
} catch {
  // 取不到用默认值
}

// 栏目
const tabs = ['共享课程', '我的导入'] as const
const currentTab = ref(0)

// 难度分组筛选：全部 + 初级 A1-A2 / 中级 B1-B2 / 高级 C1-C2
// （样式对标参考图：深色条 + 彩点 + 数量，选中黄色；数量按实际课程数算）
type LevelGroup = 'all' | 'beginner' | 'intermediate' | 'advanced'
const levelGroups: { key: LevelGroup; label: string; levels: LessonLevel[] | null; color: string }[] = [
  { key: 'all', label: 'All levels', levels: null, color: '#ffd60a' },
  { key: 'beginner', label: 'Beginner A1-A2', levels: ['A1', 'A2'], color: '#66bb6a' },
  { key: 'intermediate', label: 'Intermediate B1-B2', levels: ['B1', 'B2'], color: '#42a5f5' },
  { key: 'advanced', label: 'Advanced C1-C2', levels: ['C1', 'C2'], color: '#ab47bc' },
]
const levelFilter = ref<LevelGroup>('all')

// 搜索关键词（按标题搜索）
const keyword = ref('')

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
const coverUrlMap = ref<Record<string, string>>({})
let coverResolving: Promise<void> | null = null
// 图片加载失败的自愈冷却，防止同一批坏图反复触发换地址
let coverRetryAt = 0
let coverRetryTimer: ReturnType<typeof setTimeout> | null = null
// 每张封面的失败次数：>1 判定为「文件缺失」，改用本地兜底图，不再无限换地址
const coverFailCount = ref<Record<string, number>>({})

function readCoverCache() {
  const alive: Record<string, string> = {}
  try {
    const c: any = uni.getStorageSync(COVER_URLS_CACHE_KEY)
    if (c && c.urls) {
      for (const k of Object.keys(c.urls)) {
        if (c.urls[k] && coverUrlFresh(c.urls[k])) alive[k] = c.urls[k]
      }
    }
  } catch {
    // 无缓存则走网络换地址
  }
  // 直接用过滤后的结果覆盖内存映射：过期的一律丢弃，
  // 否则 ensureCoverUrls 会因为“map 里已有值”跳过这些封面、一直用死链。
  coverUrlMap.value = alive
}

/** 延迟触发一次批量换地址（多个封面同时失败时合并成一次调用） */
function scheduleCoverRefetch(delay: number) {
  if (coverRetryTimer) return
  coverRetryTimer = setTimeout(() => {
    coverRetryTimer = null
    ensureCoverUrls()
  }, Math.max(0, delay))
}

/**
 * 封面加载失败：第一次 → 丢掉死链、重新换地址；第二次仍失败 → 判定文件缺失，
 * 换成本地兜底图（否则每换一次地址都是 404，会一直白着且反复打云函数）。
 */
function onCoverError(src: string) {
  if (!src || !src.startsWith('cloud://')) return
  const n = (coverFailCount.value[src] || 0) + 1
  coverFailCount.value = { ...coverFailCount.value, [src]: n }
  if (n > 1) return
  const next: Record<string, string> = {}
  for (const k of Object.keys(coverUrlMap.value)) {
    if (k !== src) next[k] = coverUrlMap.value[k]
  }
  coverUrlMap.value = next
  const now = Date.now()
  const delay = now < coverRetryAt ? coverRetryAt - now : 0
  if (delay === 0) coverRetryAt = now + 5000
  scheduleCoverRefetch(delay)
}

/** 模板用：cloud:// 走中转后的临时地址，本地图原样返回，判定为缺失时用本地兜底图 */
function coverSrc(src: string | undefined | null): string {
  if (!src) return localCover('')
  if (!src.startsWith('cloud://')) return src
  if ((coverFailCount.value[src] || 0) > 1) return localCover(src)
  return coverUrlMap.value[src] || ''
}

/** 收集当前要显示的所有 cloud:// 封面，批量换临时地址（去重+并发合并） */
async function ensureCoverUrls() {
  readCoverCache()
  const ids = new Set<string>()
  for (const l of allOfficialLessons.value) {
    if (l.cover && l.cover.startsWith('cloud://') && !coverUrlMap.value[l.cover]) ids.add(l.cover)
  }
  for (const r of importRecords.value) {
    const c = recordCover(r)
    if (c && c.startsWith('cloud://') && !coverUrlMap.value[c]) ids.add(c)
  }
  if (ids.size === 0) return
  if (coverResolving) {
    await coverResolving
    return
  }
  coverResolving = (async () => {
    try {
      const res: any = await wx.cloud.callFunction({ name: 'getAudioUrl', data: { fileIDs: [...ids] } })
      const urls = (res && res.result && res.result.urls) || {}
      let changed = false
      for (const k of Object.keys(urls)) {
        if (urls[k] && !coverUrlMap.value[k]) {
          coverUrlMap.value[k] = urls[k]
          changed = true
        }
      }
      if (changed) {
        try {
          uni.setStorageSync(COVER_URLS_CACHE_KEY, { at: Date.now(), urls: coverUrlMap.value })
        } catch {
          // 缓存写失败不影响显示
        }
      }
    } catch {
      // 换地址失败不阻塞列表，封面暂时留白
    } finally {
      coverResolving = null
    }
  })()
  await coverResolving
}

// 打卡：今日是否已打 + 累计天数（云端 checkins 集合，一人一天一条，重复打卡不重复计天）
const checkinTotal = ref(0)
const checkinToday = ref(false)
const checking = ref(false)
const checkinError = ref('')
const unreadCount = ref(0)

/** 当天日期（本地 YYYY-MM-DD，按用户所在时区算一天） */
function todayStr() {
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** 拉打卡状态（附加功能，失败不阻塞课程列表） */
async function loadCheckin() {
  const today = todayStr()
  try {
    const cached: any = uni.getStorageSync(CHECKIN_CACHE_KEY)
    if (cached && typeof cached.totalDays === 'number') {
      checkinTotal.value = cached.totalDays
      if (cached.date === today) checkinToday.value = !!cached.todayChecked
    }
  } catch {
    // 无缓存则等云端
  }
  try {
    const res: any = await wx.cloud.callFunction({
      name: 'checkinApi',
      data: { action: 'getStatus', date: today },
    })
    const r = res?.result ?? {}
    checkinTotal.value = r.totalDays || 0
    checkinToday.value = !!r.todayChecked
    try {
      uni.setStorageSync(CHECKIN_CACHE_KEY, {
        totalDays: checkinTotal.value,
        todayChecked: checkinToday.value,
        date: today,
      })
    } catch {}
  } catch (e) {
    console.error('loadCheckin failed', e)
  }
}

/** 点打卡 */
async function onCheckin() {
  if (checkinToday.value || checking.value) return
  checking.value = true
  checkinError.value = ''
  try {
    const res: any = await wx.cloud.callFunction({
      name: 'checkinApi',
      data: { action: 'checkin', date: todayStr() },
    })
    const r = res?.result ?? {}
    checkinTotal.value = r.totalDays ?? checkinTotal.value
    checkinToday.value = true
    try {
      uni.setStorageSync(CHECKIN_CACHE_KEY, {
        totalDays: checkinTotal.value,
        todayChecked: true,
        date: todayStr(),
      })
    } catch {}
    uni.showToast({
      title: r.already ? '今日已打过卡' : (r.pointsAdded ? `打卡成功，+${r.pointsAdded} 积分` : '打卡成功'),
      icon: 'success',
    })
  } catch (e: any) {
    const msg = (e && (e.message || e.errMsg)) || ''
    console.warn('[checkin]', msg)
    checkinError.value = '打卡失败，请稍后重试。'
  } finally {
    checking.value = false
  }
}

loadCheckin()

// 分页：每页 2 条，滑到底部加载下一页（本地数据分页）
const page = ref(1)
const pageSize = 2

// 难度从易到难的顺序

/** 用户投稿并审核上架的官方课程（公开可见） */
const publishedLessons = ref<any[]>([])
let publishedLoaded = false
async function loadPublished() {
  if (publishedLoaded) return
  publishedLoaded = true
  try {
    const res: any = await wx.cloud.callFunction({ name: 'importApi', data: { action: 'listOfficial' } })
    const records = res.result.records || []
    publishedLessons.value = records.map((r: any) => ({
      id: r.lessonId,
      title: r.title,
      level: r.level || undefined,
      authorNick: r.authorNick || '',
      date: r.createdAt ? new Date(r.createdAt).toISOString().slice(0, 10) : '',
      cover: r.cover || '',
      duration: r.duration || 0,
      fromPublished: true,
    }))
    ensureCoverUrls()
  } catch {
    // 拉取失败不阻塞官方课
  }
}

/** 官方课程 = 内置 + 用户投稿上架 */
const allOfficialLessons = computed(() => [...lessons, ...publishedLessons.value])

/** 筛选 + 排序后的全部课程 */
const filteredLessons = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  return allOfficialLessons.value
    .filter((lesson) => {
      const g = levelGroups.find((x) => x.key === levelFilter.value)
      return !g || g.levels === null || (lesson.level !== undefined && g.levels.includes(lesson.level))
    })
    .filter(
      (lesson) =>
        !kw ||
        lesson.title.toLowerCase().includes(kw) ||
        (lesson.titleCn ?? '').includes(keyword.value.trim()),
    )
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
})

/** 官方课中的最新日期：new 徽章只打在日期最新的文章上（导入不参与） */
const latestDate = computed(() =>
  allOfficialLessons.value.reduce((m, l) => ((l.date ?? '') > m ? (l.date as string) : m), ''),
)

/** 当前页已展示的课程 */
const displayedLessons = computed(() =>
  filteredLessons.value.slice(0, page.value * pageSize),
)

/** 是否还有更多 */
const hasMore = computed(
  () => displayedLessons.value.length < filteredLessons.value.length,
)

/** 搜索确认：回到第一页 */
function onSearchConfirm() {
  page.value = 1
}

/** 切换难度分组：回到第一页 */
function onLevelChange(group: LevelGroup) {
  levelFilter.value = group
  page.value = 1
}

/** 各分组课程数（按全部课程算，不受搜索关键词影响；内置课已清空，这里统计的是内置+上架投稿） */
const groupCounts = computed(() => {
  const all = allOfficialLessons.value
  const counts: Record<LevelGroup, number> = { all: all.length, beginner: 0, intermediate: 0, advanced: 0 }
  for (const lesson of all) {
    const g = levelGroups.find(
      (x) => x.levels !== null && lesson.level !== undefined && x.levels.includes(lesson.level),
    )
    if (g) counts[g.key] += 1
  }
  return counts
})

/** 加载下一页 */
function loadMore() {
  if (hasMore.value) {
    page.value += 1
  }
}

/** 滑到底部自动加载下一页 */
onReachBottom(() => {
  loadMore()
})

/** 跳转课程详情 */
function goDetail(id: string) {
  uni.navigateTo({
    url: `/pages/lesson/detail?id=${id}`,
  })
}

// ---------- 我的导入（M1：列表 + 额度；处理流水线在 M2 接） ----------

interface ImportRecord {
  _id: string
  title: string
  status: 'processing' | 'done' | 'failed'
  lessonId: string
  createdAt: number
  applyOfficial?: boolean
  officialStatus?: string
}

const importRecords = ref<ImportRecord[]>([])
const importQuota = ref<{
  freeTotal: number
  freeUsed: number
  singleRemaining: number
  membership: { type: string; expiresAt?: number } | null
  monthlyRemaining: number | null
} | null>(null)

/** 剩余可用额度（三态）：永久会员→无限制；包月会员→包月剩余额度；其余→免费剩余额度 */
const importAvailableText = computed(() => {
  const q = importQuota.value
  if (!q) return ''
  if (q.membership && q.membership.type === 'lifetime') return '无限制'
  if (q.monthlyRemaining != null) return `${q.monthlyRemaining}（包月剩余额度）`
  return `${Math.max(0, q.freeTotal - q.freeUsed)}（免费）`
})

const IMPORTS_CACHE_KEY = 'importsCacheV1'
const importsLoading = ref(false) // 无缓存冷启动时显示"加载中"，而不是"还没有导入"
let importsInflight = false
let importsSessionReady = false

/** 从本地缓存恢复列表（只存渲染用字段，秒开） */
function restoreImportsCache(): boolean {
  try {
    const c: any = uni.getStorageSync(IMPORTS_CACHE_KEY)
    if (c && Array.isArray(c.records)) {
      importRecords.value = c.records as ImportRecord[]
      if (c.quota) importQuota.value = c.quota
      return true
    }
  } catch {
    // 存储不可用就走网络
  }
  return false
}

/** 拉取我的导入列表与额度：缓存秒开 + 后台静默刷新。
 * 云函数冷启动要几秒，点 tab 时不再干等；失败时静默，有缓存就展示缓存。 */
async function loadImports() {
  if (!importsSessionReady) {
    const hit = restoreImportsCache()
    importsSessionReady = true
    if (!hit && importRecords.value.length === 0) importsLoading.value = true
  }
  if (importsInflight) return
  importsInflight = true
  try {
    const [listRes, quotaRes]: any[] = await Promise.all([
      wx.cloud.callFunction({ name: 'importApi', data: { action: 'list' } }),
      wx.cloud.callFunction({ name: 'importApi', data: { action: 'getQuota' } }),
    ])
    const records = (listRes.result.records || []) as ImportRecord[]
    importRecords.value = records
    importQuota.value = quotaRes.result.quota
    try {
      uni.setStorageSync(IMPORTS_CACHE_KEY, {
        records: records.map((r: any) => ({ _id: r._id, title: r.title, status: r.status, createdAt: r.createdAt, cover: (r.lesson && r.lesson.cover) || null, applyOfficial: !!r.applyOfficial, officialStatus: r.officialStatus || '' })),
        quota: quotaRes.result.quota,
        at: Date.now(),
      })
    } catch {
      // 缓存写失败不影响展示
    }
    ensureCoverUrls()
  } catch {
    // 云函数未部署时不弹错，列表保持空态/缓存
  } finally {
    importsInflight = false
    importsLoading.value = false
  }
}

/** 切换栏目：切到“我的导入”时刷新列表 */
function onTabChange(index: number) {
  currentTab.value = index
  if (index === 1) {
    loadImports()
  }
}

/* ---------- 个人资料：静默默认资料（合规：启动不索取微信头像昵称） ---------- */
const DEFAULT_AVATARS = ['rat', 'ox', 'tiger', 'rabbit', 'dragon', 'snake', 'horse', 'goat', 'monkey', 'rooster', 'dog', 'pig']

let profileChecked = false
const PROFILE_CACHE_KEY = 'profileCacheV1'
const CHECKIN_CACHE_KEY = 'checkinCacheV1'
const profile = ref<{
  nickName: string
  avatarType: string
  avatarIndex: number
  avatarUrl: string | null
} | null>(null)
const profileAvatarUrl = computed(() => {
  const p = profile.value
  if (!p) return ''
  if (p.avatarType === 'custom' && p.avatarUrl) return p.avatarUrl
  return `/static/avatars/${DEFAULT_AVATARS[p.avatarIndex] || 'rat'}.png`
})
function genDefaultNick() {
  return '学习搭子 ' + Math.random().toString(36).slice(2, 6).toUpperCase()
}
/** 首次进入时查资料：没有则静默生成默认资料（随机小动物头像 + 默认昵称），不弹窗。
 * 合规：小程序启动时不得索取微信头像/昵称；chooseAvatar 与 nickname 输入框只保留在用户主动进入的"编辑资料"页。 */
async function ensureProfile() {
  // 缓存每次都重读：编辑页保存后返回，首页左上角立即显示新头像昵称
  try {
    const cached: any = uni.getStorageSync(PROFILE_CACHE_KEY)
    if (cached && cached.nickName) profile.value = cached
  } catch {
    // 无缓存则等云端
  }
  if (profileChecked) return
  profileChecked = true
  // 云端只查一次（冷启动慢，缓存已秒显）
  try {
    const res: any = await wx.cloud.callFunction({ name: 'userApi', data: { action: 'getProfile' } })
    const cp = res.result && res.result.profile
    if (!cp) {
      // 无资料：静默建默认，不等用户、不弹窗、不收集微信头像昵称
      const idx = Math.floor(Math.random() * DEFAULT_AVATARS.length)
      const fresh = { nickName: genDefaultNick(), avatarType: 'default', avatarIndex: idx, avatarUrl: null as string | null }
      profile.value = fresh
      try { uni.setStorageSync(PROFILE_CACHE_KEY, fresh) } catch {}
      // 后台写云端；失败静默（如下次冷启动再试；users 集合未建时也不打扰用户）
      wx.cloud.callFunction({
        name: 'userApi',
        data: { action: 'saveProfile', nickName: fresh.nickName, avatarType: 'default', avatarIndex: idx, avatarFileID: '' },
      }).catch(() => {})
    } else {
      profile.value = cp
      try { uni.setStorageSync(PROFILE_CACHE_KEY, cp) } catch {}
    }
  } catch {
    // 出错不阻塞首页；云函数未部署时静默跳过（有缓存则继续显示缓存）
  }
}

/** 管理员隐藏入口：头像 3 秒内连点 5 次；鉴权通过才进管理页，普通用户无任何感知 */
let avatarTapTimes: number[] = []
async function refreshUnread() {
  try {
    const m: any = await wx.cloud.callFunction({ name: 'userApi', data: { action: 'listMessages' } })
    unreadCount.value = (m.result && m.result.unread) || 0
  } catch {
    // 未部署/无集合时静默为 0
  }
}
let avatarTapTimer: any = null
async function onAvatarTap() {
  const now = Date.now()
  avatarTapTimes = avatarTapTimes.filter((t) => now - t < 3000)
  avatarTapTimes.push(now)
  if (avatarTapTimes.length >= 5) {
    // 5 连点：进管理页（管理员），取消待发的个人中心跳转
    avatarTapTimes = []
    if (avatarTapTimer) { clearTimeout(avatarTapTimer); avatarTapTimer = null }
    try {
      const res: any = await wx.cloud.callFunction({ name: 'importApi', data: { action: 'adminCheck' } })
      if (res.result && res.result.isAdmin) {
        uni.navigateTo({ url: '/pages/admin/review' })
      }
    } catch {
      // 非管理员或未部署：静默无事发生
    }
    return
  }
  // 单点：延迟 350ms 进个人中心；连点中则取消，留给 5 连点手势
  if (avatarTapTimer) clearTimeout(avatarTapTimer)
  avatarTapTimer = setTimeout(() => {
    avatarTapTimer = null
    avatarTapTimes = []
    uni.navigateTo({ url: '/pages/profile/index' })
  }, 350)
}

const OFFICIAL_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']
/** 申请把导入上架为官方课程：选自评级别 → 提交审核 */
async function onApplyTap(record: ImportRecord) {
  try {
    const { tapIndex } = await uni.showActionSheet({ itemList: OFFICIAL_LEVELS })
    const level = OFFICIAL_LEVELS[tapIndex]
    await wx.cloud.callFunction({
      name: 'importApi',
      data: { action: 'applyOfficial', importId: record._id, level },
    })
    record.applyOfficial = true
    record.officialStatus = 'pending'
    uni.showToast({ title: '已提交审核', icon: 'success' })
  } catch {
    // 取消选择或提交失败：静默
  }
}

let firstShow = true
/** 回到本页时，若停在“我的导入”也刷新（刚上传完回来能看到新记录）；
 * 首次进入时顺手预热导入列表缓存，点 tab 秒开 */
onShow(() => {
  loadCheckin()
  ensureProfile()
  refreshUnread()
  loadPublished()
  ensureCoverUrls()
  // 个人中心“我的导入”行返回：切到导入 tab
  try {
    if (uni.getStorageSync('gotoImportTab')) {
      uni.removeStorageSync('gotoImportTab')
      currentTab.value = 1
    }
  } catch {}
  if (currentTab.value === 1 || firstShow) {
    firstShow = false
    loadImports()
  }
})

/** 页面销毁时必须停掉导入进度轮询：
 * stopListPoll() 之前定义了却没有任何调用点，页面被 reLaunch/redirectTo/退出小程序时
 * listPollTimer 仍会每 3 秒继续调 processImport（最多 200 次），白耗云调用配额。
 * 这里只绑 onUnload：navigateTo 详情页时本页不销毁，轮询能继续跑（处理完照常提示），
 * 返回后由 onShow 接管，不影响原有体验。 */
onUnload(() => {
  stopListPoll()
  if (coverRetryTimer) {
    clearTimeout(coverRetryTimer)
    coverRetryTimer = null
  }
})

/** 首次进入时后台预取全部官方课的播放地址：点文章时不用再等云函数换地址 */
let audioPrefetched = false
onLoad(() => {
  if (audioPrefetched) return
  audioPrefetched = true
  try {
    lessons.forEach((l) => audioStore.prefetchLesson(l as any))
  } catch {
    // 预取失败不影响正常播放
  }
})

/** 去导入页 */
function goImport() {
  uni.navigateTo({ url: '/pages/import/index' })
}

/** 点导入记录：已完成进详情；处理中轮询推进；失败先重试再轮询 */
function onImportTap(record: ImportRecord) {
  if (record.status === 'done' && record.lessonId) {
    goDetail(record.lessonId)
  } else if (record.status === 'processing') {
    pollRecord(record._id)
  } else {
    retryRecord(record)
  }
}

// 列表页轮询：防重复点，单条记录同一时间只跑一个轮询；上限 200 次（约 10 分钟），
// 超限停掉、记录仍是处理中，用户再点可续跑（processImport 本身可断点续跑）
const pollingRecordId = ref('')
let listPollTimer: any = null
function stopListPoll() {
  if (listPollTimer) {
    clearTimeout(listPollTimer)
    listPollTimer = null
  }
}
async function pollRecord(importId: string) {
  if (pollingRecordId.value) return
  pollingRecordId.value = importId
  let count = 0
  uni.showLoading({ title: '处理中…' })
  const tick = async () => {
    try {
      const res: any = await wx.cloud.callFunction({
        name: 'processImport',
        data: { importId },
      })
      const r = res.result
      if (r.status === 'done' || r.status === 'failed') {
        uni.hideLoading()
        pollingRecordId.value = ''
        await loadImports()
        uni.showToast({
          title: r.status === 'done' ? '处理完成，点它开始学习' : '处理失败，额度已返还',
          icon: 'none',
        })
        return
      }
      count += 1
      if (count >= 200) {
        uni.hideLoading()
        pollingRecordId.value = ''
        uni.showToast({ title: '还在处理中，稍后再点它继续', icon: 'none' })
        return
      }
      listPollTimer = setTimeout(tick, 1000)
    } catch (e: any) {
      console.warn('[import] 续跑请求失败', (e && (e.errMsg || e.message)) || '')
      uni.hideLoading()
      pollingRecordId.value = ''
      uni.showToast({ title: '处理服务暂时不可用，请稍后重试', icon: 'none' })
    }
  }
  tick()
}

/** 失败重试：重新扣额度后轮询推进 */
async function retryRecord(record: ImportRecord) {
  try {
    uni.showLoading({ title: '重试中…' })
    await wx.cloud.callFunction({
      name: 'importApi',
      data: { action: 'retry', importId: record._id },
    })
    uni.hideLoading()
    await loadImports()
    pollRecord(record._id)
  } catch (e: any) {
    uni.hideLoading()
    const msg = (e && e.message) || ''
    uni.showToast({
      title: msg.includes('QUOTA_EXHAUSTED') ? '额度不足，购买功能下一步开放' : '重试失败，请稍后再试',
      icon: 'none',
    })
  }
}

/** 删除一条导入：二次确认后调云函数删记录与文件，额度不动；
 * 删除进行中（弹确认框 + 加载）时再点直接忽略，防止重复提交导致第二次失败 */
const isDeleting = ref(false)
async function onDeleteTap(record: ImportRecord) {
  if (isDeleting.value) return
  isDeleting.value = true
  try {
    const ok = await new Promise<boolean>((resolve) => {
      uni.showModal({
        title: '删除导入',
        content: `确定删除《${record.title}》吗？记录和相关的源文件、音频会一起删掉，删除后不可恢复。`,
        confirmText: '删除',
        confirmColor: '#e64340',
        cancelText: '取消',
        success: (res) => resolve(!!res.confirm),
        fail: () => resolve(false),
      })
    })
    if (!ok) return
    uni.showLoading({ title: '删除中…' })
    await wx.cloud.callFunction({
      name: 'importApi',
      data: { action: 'delete', importId: record._id },
    })
    uni.hideLoading()
    uni.showToast({ title: '已删除', icon: 'none' })
    await loadImports()
  } catch {
    uni.hideLoading()
    uni.showToast({ title: '删除失败，请稍后再试', icon: 'none' })
  } finally {
    isDeleting.value = false
  }
}

/** 导入封面：程序化封面，按标题哈希固定取 8 张中的一张，同一标题永远同一张 */
function importCover(title: string) {
  return localCover(title)
}

/** 导入记录封面：有 AI 生成的用生成图（cloud:// 经 ensureCoverUrls 换临时地址），否则回退预设 */
function recordCover(record: any) {
  const c = (record.lesson && record.lesson.cover) || record.cover || null
  return c || importCover(record.title)
}

/** 状态文案 */
function statusText(status: string) {
  if (status === 'done') return '已完成'
  if (status === 'failed') return '处理失败'
  return '处理中'
}

/** 等级 → 所属分组（卡片等级 pill 用） */
function levelGroupOf(level: LessonLevel | undefined) {
  return levelGroups.find(
    (x) => x.levels !== null && level !== undefined && x.levels.includes(level),
  )
}

/** 等级 pill 文案：等级 + 分组名，如 A2 Beginner */
function levelPillText(level: LessonLevel | undefined) {
  const g = levelGroupOf(level)
  if (!g || !level) return level ?? ''
  return `${level} ${g.label.split(' ')[0]}`
}

const CARD_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** YYYY-MM-DD → October 28, 2026（卡片封面下方日期，样式对标参考图） */
function formatCardDate(iso: string | undefined) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  return `${CARD_MONTHS[m - 1]} ${d}, ${y}`
}

/** 秒 → m:ss（卡片封面下方时长，如 0:50；分钟不补零，与参考图一致） */
function formatShortDuration(totalSeconds: number) {
  const safe = Math.max(0, Math.floor(totalSeconds || 0))
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`
}

/** 时间戳 → YYYY-MM-DD HH:mm */
function formatDate(ts: number) {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
</script>

<style scoped>
.merge-row {
  display: flex;
  align-items: center;
  padding: 8rpx 8rpx 20rpx;
}
.merge-avatar-wrap { position: relative; }
.avatar-edit { position: absolute; bottom: -4rpx; right: -4rpx; width: 34rpx; height: 34rpx; line-height: 30rpx; text-align: center; background: #ffd60a; border: 3rpx solid #fff; border-radius: 50%; color: #2b1b4d; font-size: 18rpx; }
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
  color: #2b1b4d;
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
  font-family: 'ZCKL-Title', sans-serif;
  font-size: 44rpx;
  color: #2b1b4d;
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
  font-family: 'Cormorant Garamond', serif;
  font-size: 28rpx;
  color: #2b1b4d;
  background-color: #ffd60a;
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
  font-family: 'Cormorant Garamond', serif;
  flex: 1;
  text-align: center;
  padding: 16rpx 0;
  font-size: 30rpx;
  color: #666666;
  border-radius: 28rpx;
}

.tab-item.active {
  color: #2b1b4d;
  font-weight: bold;
  background-color: #ffd60a;
  box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.08);
}

.import-btn {
  font-family: 'Cormorant Garamond', serif;
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
  font-family: 'Cormorant Garamond', serif;
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
  color: #2b1b4d;
  background-color: #ffd60a;
  border-radius: 24rpx;
  padding: 6rpx 20rpx;
}
.apply-pending {
  font-size: 26rpx;
  color: #999999;
}
.apply-approved {
  font-size: 26rpx;
  color: #66bb6a;
}

/* 官方卡片作者昵称 */
.lesson-author {
  font-size: 26rpx;
  color: #999999;
  margin-left: 8rpx;
}

.record-title {
  font-family: 'Cormorant Garamond', serif;
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
  font-family: 'Cormorant Garamond', serif;
  background-color: #f2f2f2;
  border-radius: 32rpx;
  padding: 12rpx 24rpx;
}

.level-pill-item.active {
  background-color: #ffd60a;
}

.level-pill-name {
  color: #333333;
  font-size: 26rpx;
  font-weight: bold;
}

.level-pill-item.active .level-pill-name {
  color: #2b1b4d;
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
  font-family: 'Cormorant Garamond', serif;
  font-size: 26rpx;
  font-weight: bold;
}

.lesson-title {
  font-family: 'Cormorant Garamond', serif;
  font-size: 43rpx;
  font-weight: bold;
  color: #333333;
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
  font-family: 'Cormorant Garamond', serif;
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
  background-color: #42a5f5;
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
