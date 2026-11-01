<template>
  <view class="container" :class="{ 'container-shadow': isShadowing }">
    <view v-if="lesson" class="lesson">
      <!-- 标题区 -->
      <view class="header">
        <view class="title">{{ lesson.title }}</view>
        <view v-if="lesson.titleCn" class="title-cn">{{ lesson.titleCn }}</view>
        <view class="meta">{{ lesson.level ? lesson.level + ' · ' : '' }}{{ formatTime(lesson.duration) }}</view>
        <view class="transcript-toggle-row">
          <text class="transcript-toggle" @click="toggleTranscript">{{ hideTranscript ? '显示原文' : '隐藏原文' }}</text>
          <text class="fav-btn" @click="onToggleFav">{{ favored ? '❤️ 已收藏' : '🤍 收藏' }}</text>
        </view>
      </view>

      <!-- 原文：整段排版（小节标题 + 流动段落，不再按句子拆卡片） -->
      <view v-if="!hideTranscript" class="article" id="article">
        <view
          v-for="(para, pIndex) in processedParagraphs"
          :key="pIndex"
          class="para"
        >
          <view v-if="para.heading" class="para-heading">{{ para.heading }}</view>
          <text class="para-text">
            <text
              v-for="item in para.sentences"
              :key="item.globalIndex"
              :id="'s-' + item.globalIndex"
              class="sentence"
              :class="{ current: item.globalIndex === highlightSentenceIndex }"
            ><text
              v-for="(word, wIndex) in item.words"
              :key="wIndex"
              :id="'w-' + word.globalWordIndex"
              class="word"
              @click="onWordClick(word, item)"
            ><text
              :class="{ 'word-current': word.globalWordIndex === highlightWordIndex, vocab: word.vocabNo !== undefined }"
            >{{ word.text }}<text
              v-if="word.vocabNo !== undefined"
              class="vocab-sup"
            >{{ supChars[word.vocabNo - 1] }}</text></text>{{ ' ' }}</text></text>
          </text>
        </view>
        <view
          v-if="pillKind && pillSentenceIndex >= 0"
          id="pill"
          class="status-pill-float"
          :class="'status-pill-' + pillKind"
          :style="{ top: pillTop + 'px', left: pillLeft + 'px' }"
          @click="onPillClick"
        >{{ pillText }}</view>
        <view
          v-if="popupWord"
          id="wordPopup"
          class="word-popup"
          :style="{ top: popupTop + 'px', left: popupLeft + 'px' }"
          @click="closeVocabPopup"
        >
          <view class="word-popup-head">
            <text class="word-popup-word">{{ popupWord.word }}</text>
            <text v-if="popupWord.pos" class="word-popup-pos">{{ popupWord.pos }}</text>
            <image
              class="word-popup-star"
              :src="isPopupSaved ? '/static/star-filled.png' : '/static/star-outline.png'"
              @click.stop="onStarClick"
            />
            <text class="word-popup-close" @click.stop="closeVocabPopup">✕</text>
          </view>
          <view class="word-popup-meaning">{{ popupWord.meaningCn }}</view>
        </view>
      </view>
      <!-- 原文隐藏时：只留提示 + 显示按钮（播放、跟读、控制条照常可用；悬浮 pill 跟原文一起藏起，因为它要锚在句首词上） -->
      <view v-else class="transcript-hidden">
        <text class="transcript-hidden-text">原文已隐藏，专心听吧</text>
        <text class="transcript-hidden-btn" @click="toggleTranscript">显示原文</text>
      </view>
    </view>
    <view v-else class="empty">
      <text>课程加载中…</text>
    </view>

    <!-- 底部默认圆形控制：点击展开为完整控制条 -->
    <view v-if="lesson && !isShadowing && !barExpanded" class="player-circle" @click="onCircleTap">
      <image class="player-circle-icon" :src="isThisLessonPlaying ? '/static/pause-dark.png' : '/static/play-dark.png'" />
    </view>

    <!-- 底部悬浮控制条：页面底部居中（跟读模式时替换为跟读面板） -->
    <view v-if="lesson && !isShadowing && barExpanded" class="player-bar">
      <slider
        class="bar-slider"
        :value="sliderValue"
        :max="audioStore.duration"
        :step="1"
        block-size="12"
        activeColor="#ffd60a"
        backgroundColor="rgba(255,255,255,0.3)"
        @changing="onSliderChanging"
        @change="onSliderChange"
      />
      <view class="bar-controls">
        <view class="bar-side bar-side-left">
          <image class="bar-shadow-icon" src="/static/shadowing.png" @click="enterShadowing" />
          <image class="bar-locate-icon" src="/static/locate.png" @click="onLocateCurrent" />
          <image class="bar-icon" src="/static/prev-white.png" @click="onPrevSentence" />
        </view>
        <view class="bar-btn-main" @click="onTogglePlay">
          <view v-if="isThisLessonLoading" class="bar-btn-loading" />
          <image v-else class="bar-btn-main-icon" :src="isThisLessonPlaying ? '/static/pause-dark.png' : '/static/play-dark.png'" />
        </view>
        <view class="bar-side bar-side-right">
          <image class="bar-icon" src="/static/next-white.png" @click="onNextSentence" />
          <text class="bar-speed">1X</text>
        </view>
      </view>
    </view>

    <!-- 跟读面板：开启跟读后替换底部控制条 -->
    <view v-if="lesson && isShadowing" class="shadow-panel">
      <view class="shadow-top">
        <view class="shadow-status-wrap">
          <text class="shadow-status">
            {{ shadowIndex + 1 }} / {{ flatSentences.length }} · 第 {{ currentRepeat }}{{ focusLoop ? '' : ' / ' + repeatTimes }} 遍 · {{ gapActive ? '请跟读' : (isThisLessonPlaying ? '播放中' : '已暂停') }}
          </text>
          <canvas v-if="gapActive" canvas-id="gapRing" style="width:32px;height:32px" class="gap-ring" />
        </view>
        <text class="shadow-exit" @click="exitShadowing">✕ Exit shadowing</text>
      </view>
      <slider
        class="shadow-slider"
        :value="sliderValue"
        :max="audioStore.duration"
        :step="1"
        block-size="12"
        activeColor="#ffd60a"
        backgroundColor="rgba(255,255,255,0.3)"
        @changing="onSliderChanging"
        @change="onSliderChange"
      />
      <view class="shadow-controls">
        <image class="shadow-icon" src="/static/prev-white.png" @click="onShadowPrev" />
        <view class="shadow-btn-main" @click="onShadowToggle">
          <image class="shadow-btn-main-icon" :src="gapActive || !isThisLessonPlaying ? '/static/play-dark.png' : '/static/pause-dark.png'" />
        </view>
        <image class="shadow-icon" src="/static/next-white.png" @click="onShadowNext" />
      </view>
      <view class="shadow-group">
        <text class="shadow-label">MODE</text>
        <text class="shadow-chip" :class="{ active: shadowMode === 'shadow' }" @click="shadowMode = 'shadow'">Shadow</text>
        <text class="shadow-chip" :class="{ active: shadowMode === 'repeat' }" @click="shadowMode = 'repeat'">Repeat after</text>
      </view>
      <view class="shadow-group">
        <text class="shadow-label">REPEAT</text>
        <text v-for="n in [1, 2, 3]" :key="n" class="shadow-chip" :class="{ active: repeatTimes === n }" @click="setRepeatTimes(n)">{{ n }}</text>
        <text class="shadow-label">PAUSE</text>
        <text v-for="p in [1, 1.5, 2]" :key="p" class="shadow-chip" :class="{ active: pauseRate === p }" @click="pauseRate = p">{{ p }}x</text>
      </view>
      <view class="shadow-group">
        <text class="shadow-chip" :class="{ active: loop }" @click="loop = !loop">LOOP</text>
        <text class="shadow-chip" :class="{ active: focusLoop }" @click="toggleFocusLoop">FOCUS LOOP</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, getCurrentInstance } from 'vue'
import { onLoad, onUnload } from '@dcloudio/uni-app'
import { useAudioStore } from '@/stores/audio'
import { useVocabStore } from '@/stores/vocab'
import { lessons } from '@/mock/lessons'
import { lookupVocab } from '@/mock/vocab'
import { formatTime } from '@/utils/format'
import type { Lesson, LessonSentence } from '@/types/lesson'

const instance = getCurrentInstance()

/** 渲染用词：一个可点、可高亮的词；生词带角标序号 */
interface WordSpan {
  text: string
  startTime: number
  endTime: number
  vocabNo?: number
  globalWordIndex: number
}

/** 渲染用句子：原句子 + 全课统一的全局下标 + 按词切分结果 */
interface ProcessedSentence {
  sentence: LessonSentence
  globalIndex: number
  words: WordSpan[]
}

/** 渲染用段落 */
interface ProcessedParagraph {
  heading?: string
  translation: string
  sentences: ProcessedSentence[]
}

/** 角标字符：生词序号 1–5 */
const supChars = ['¹', '²', '³', '⁴', '⁵']

const audioStore = useAudioStore()
const lesson = ref<Lesson | null>(null)
// 隐藏原文：听力时藏起原文只听不看；pill 跟原文一起藏（它要锚在句首词上），播放/跟读/控制条照常可用
const hideTranscript = ref(false)
// 底部控制条默认收起为圆形按钮，点击展开为完整控制条；无收起按钮，展开后无操作自动收回
const barExpanded = ref(false)
// 展开后无操作自动收回的等待时长（毫秒）
const BAR_AUTO_COLLAPSE_MS = 5000
let collapseTimer: ReturnType<typeof setTimeout> | null = null

/** 清除自动收回计时器 */
function clearCollapseTimer() {
  if (collapseTimer) {
    clearTimeout(collapseTimer)
    collapseTimer = null
  }
}

/** 展开后有操作时刷新自动收回计时（仅普通控制条展开、且暂停时有效；播放中不收起） */
function pokeBar() {
  if (!barExpanded.value || isShadowing.value) return
  clearCollapseTimer()
  // 只有暂停时才自动收起；播放中、或正在加载准备播放（点播放后、onPlay 回调到达前）
  // 都不启动收回计时。之前在这里只查 playing，而 onTogglePlay 调 pokeBar 时 playing
  // 还是 false（toggle 是异步的），导致慢网络下 5 秒 timer 在播放已开始后开火收起。
  if (isThisLessonPlaying.value || isThisLessonLoading.value) return
  collapseTimer = setTimeout(() => {
    collapseTimer = null
    // 开火时再确认一次：若已恢复播放（慢网络下 onPlay 晚于 5 秒到达），不收起；
    // 暂停后会由 pokeBar 重新计时
    if (isThisLessonPlaying.value || isThisLessonLoading.value) return
    barExpanded.value = false
  }, BAR_AUTO_COLLAPSE_MS)
}

/** 点圆形按钮：展开完整控制条并开始自动收回计时 */
function expandBar() {
  barExpanded.value = true
  pokeBar()
}

/** 点收起的圆形按钮：展开完整控制条；若当前未播放则开始/继续播放 */
function onCircleTap() {
  expandBar()
  if (!isThisLessonPlaying.value) {
    onTogglePlay()
  }
}
// slider 拖动状态：拖动时用拖动值显示，避免 onTimeUpdate 把进度条抢回去
const isDragging = ref(false)
const dragValue = ref(0)

// ---------- 跟读（Shadowing）模式状态 ----------
// 跟读与普通播放互斥：开启后底部控制条切换为跟读面板
const isShadowing = ref(false)
// 跟读模式：shadow 边听边跟读；repeat 播完一句先暂停留白再播下一句
const shadowMode = ref<'shadow' | 'repeat'>('shadow')
// 每句重复遍数（1 / 2 / 3）与当前第几遍
const repeatTimes = ref(2)
const currentRepeat = ref(1)
// 停顿倍率：Repeat after 留白时长 = 当前句时长 × 该倍率（1x 刚好够读完这句，2x 为两倍）
const pauseRate = ref(1)
// Loop：播完最后一句回到第一句；Focus loop：只循环当前一句
const loop = ref(false)
const focusLoop = ref(false)
// 当前跟读句子的全局下标
const shadowIndex = ref(0)
// 留白等待状态：Repeat after 播完一句后暂停等待用户复述
const gapActive = ref(false)
// 留白结束时要跳到的句子下标
const pendingNext = ref(-1)
// 留白结束时要设到的遍数
const pendingRepeat = ref(-1)
// 留白计时器（普通变量即可，模板不需要它）
let gapTimer: ReturnType<typeof setTimeout> | null = null
// 留白倒计时：Your turn pill 里的剩余秒数与面板倒计时环共用同一计时器
const gapRemainingMs = ref(0)
const gapTotalMs = ref(0)
let gapTicker: ReturnType<typeof setInterval> | null = null

/** 画跟读面板里的留白倒计时环（剩余时间占比的黄色圆弧；canvas 不可用时静默失败） */
function drawGapRing() {
  if (!gapActive.value || gapTotalMs.value <= 0) return
  try {
    const ctx = uni.createCanvasContext('gapRing', instance?.proxy as any)
    ctx.clearRect(0, 0, 32, 32)
    ctx.beginPath()
    ctx.arc(16, 16, 12, 0, 2 * Math.PI)
    ctx.setStrokeStyle('rgba(255,255,255,0.25)')
    ctx.setLineWidth(4)
    ctx.stroke()
    const frac = gapRemainingMs.value / gapTotalMs.value
    ctx.beginPath()
    ctx.arc(16, 16, 12, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * frac)
    ctx.setStrokeStyle('#ffd60a')
    ctx.setLineWidth(4)
    ctx.setLineCap('round')
    ctx.stroke()
    ctx.draw()
  } catch {
    // canvas 不可用时静默失败，pill 里的秒数倒计时仍可正常显示
  }
}

/** 启动留白倒计时（每 200ms 刷新 pill 秒数与倒计时环） */
function startGapTicker(totalMs: number) {
  stopGapTicker()
  gapTotalMs.value = totalMs
  gapRemainingMs.value = totalMs
  const endAt = Date.now() + totalMs
  drawGapRing()
  gapTicker = setInterval(() => {
    gapRemainingMs.value = Math.max(0, endAt - Date.now())
    drawGapRing()
  }, 200)
}

/** 停止留白倒计时 */
function stopGapTicker() {
  if (gapTicker !== null) {
    clearInterval(gapTicker)
    gapTicker = null
  }
  gapRemainingMs.value = 0
  gapTotalMs.value = 0
}
// 用户主动暂停标记：用于区分“自然播完”与“用户暂停”
const userPaused = ref(false)

// slider 显示值：拖动时用拖动值，否则用实际播放位置
const sliderValue = computed(() =>
  isDragging.value ? dragValue.value : audioStore.currentTime,
)

// 当前课是否正在播放
const isThisLessonPlaying = computed(
  () => audioStore.playing && audioStore.currentLesson?.id === lesson.value?.id,
)

// 本课是否在加载音频（点播放后、真正出声前）：按钮转圈、词/句高亮冻结，避免"点了没反应"和光标空跑
const isThisLessonLoading = computed(
  () => audioStore.audioLoading && audioStore.currentLesson?.id === lesson.value?.id,
)
// 加载中冻结高亮下标（恢复后继续走）
const frozenWordIndex = ref(-1)
const frozenSentenceIndex = ref(-1)

// 全课句子按段落顺序摊平（用于当前句定位与上一句 / 下一句跳转）
const flatSentences = computed<LessonSentence[]>(() =>
  lesson.value ? lesson.value.paragraphs.flatMap((p) => p.sentences) : [],
)

// 当前播到的句子全局下标（用于高亮；用未取整的 rawCurrentTime，避免取整后点句先闪回上一句）
const currentSentenceIndex = computed(() => {
  if (isThisLessonLoading.value) return frozenSentenceIndex.value
  const t = audioStore.displayTime
  const idx = flatSentences.value.findIndex((s) => t >= s.startTime && t < s.endTime)
  frozenSentenceIndex.value = idx
  return idx
})

// 句首状态 pill 挂在哪一句：跟读中以跟读句为准（留白期间跟读句仍是刚播完的那句），
// 否则以当前播放句为准
const pillSentenceIndex = computed(() =>
  isShadowing.value ? shadowIndex.value : currentSentenceIndex.value,
)

// pill 类型：turn 留白（轮到用户）/ listen 播放中 / paused 用户暂停（未开始播放时不显示）
const pillKind = computed<'turn' | 'listen' | 'paused' | ''>(() => {
  if (gapActive.value) return 'turn'
  if (isThisLessonPlaying.value) return 'listen'
  if (
    pillSentenceIndex.value >= 0 &&
    audioStore.currentLesson?.id === lesson.value?.id &&
    audioStore.rawCurrentTime > 0
  ) {
    return 'paused'
  }
  return ''
})

// pill 文案：Your turn 带遍数与倒计时秒数
const pillText = computed(() => {
  if (pillKind.value === 'turn') {
    const secs = Math.ceil(gapRemainingMs.value / 1000)
    return `Your turn ${currentRepeat.value}/${repeatTimes.value} · ${secs}s`
  }
  if (pillKind.value === 'listen') return 'Listen'
  if (pillKind.value === 'paused') return 'Paused'
  return ''
})

// 句子高亮下标：留白期间跟读句仍是刚播完的那句，但播放位置已到下一句开头，
// 若按播放位置算高亮会跳到下一句，所以留白期间以跟读句为准
const highlightSentenceIndex = computed(() =>
  gapActive.value ? shadowIndex.value : currentSentenceIndex.value,
)

// 悬浮 pill 的位置（相对 .article，单位 px，与 boundingClientRect 的单位一致；初始藏在屏外）
const pillTop = ref(-9999)
const pillLeft = ref(0)

// 每句首词的全局词下标（用于定位句首：词是单行元素，外框 left/top 即句首位置；
// 直接量句子外框会在多行时取到最左行的 x，不等于句首）
const sentenceFirstWordIndex = computed(() => {
  const arr: number[] = []
  for (const para of processedParagraphs.value) {
    for (const s of para.sentences) {
      arr[s.globalIndex] = s.words.length > 0 ? s.words[0].globalWordIndex : -1
    }
  }
  return arr
})

/** 测量当前句首词的位置，把悬浮 pill 放到该句上方（句首对齐，可盖住上一行文字）；
   句首太靠右时按 pill 实测宽度做右钳制，左移贴边、不超出文章右边缘 */
function updatePillPosition() {
  if (!pillKind.value || pillSentenceIndex.value < 0) return
  const firstWord = sentenceFirstWordIndex.value[pillSentenceIndex.value]
  if (firstWord === undefined || firstWord < 0) return
  const query = uni.createSelectorQuery()
  query.select('#article').boundingClientRect()
  query.select('#w-' + firstWord).boundingClientRect()
  query.select('#pill').boundingClientRect()
  query.exec((res: any) => {
    const articleRect = res?.[0]
    const wordRect = res?.[1]
    const pillRect = res?.[2]
    if (!articleRect || !wordRect) return
    let left = wordRect.left - articleRect.left
    if (pillRect) {
      const maxLeft = articleRect.width - pillRect.width - 4
      if (left > maxLeft) left = Math.max(0, maxLeft)
    }
    pillLeft.value = left
    // pill 用 translateY(-100%) 顶到句首上方，这里再留 4px 空隙
    pillTop.value = wordRect.top - articleRect.top - 4
  })
}

// pill 目标句或状态变化时重新测量位置；刚出现时先藏到屏外，避免先闪在上一句的位置
watch(
  [pillSentenceIndex, pillKind],
  ([, newKind], [, oldKind]) => {
    if (!newKind) return
    if (!oldKind) pillTop.value = -9999
    nextTick(() => updatePillPosition())
  },
)

/** 点悬浮 pill：从该句开头开始播放 */
function onPillClick() {
  closeVocabPopup()
  if (pillSentenceIndex.value < 0) return
  for (const para of processedParagraphs.value) {
    const item = para.sentences.find((s) => s.globalIndex === pillSentenceIndex.value)
    if (item) {
      playSentence(item)
      return
    }
  }
}

// 生词弹框：点带下划线的生词（仅首次出现带角标）弹出词性 + 中文翻译；
// 普通词点按仍是从句首播放，两者按词类型分流，不冲突
const vocabStore = useVocabStore()
vocabStore.load()

interface PopupWord {
  word: string
  pos: string
  meaningCn: string
}
const popupWord = ref<PopupWord | null>(null)
const popupAnchor = ref(-1)
const popupTop = ref(-9999)
const popupLeft = ref(0)

/** 弹框里的词是否已收藏（星星实心/空心） */
const isPopupSaved = computed(() =>
  popupWord.value ? vocabStore.isSaved(popupWord.value.word) : false,
)

/** 点生词：打开弹框（不触发播放）；显示的词去掉句尾标点（如 closet. 显示为 closet），弹框位置随后实测 */
function openVocabPopup(word: WordSpan) {
  const wasOpen = popupWord.value !== null
  const displayWord = word.text.replace(/[^a-zA-Z']/g, '')
  // 导入课先查课自带的生词释义（词库匹配时生成），没有再查官方词典
  const dict = (lesson.value as any)?.vocabDict as
    | Record<string, { pos: string; meaningCn: string }>
    | undefined
  const entry = (dict && dict[displayWord.toLowerCase()]) || lookupVocab(displayWord)
  popupWord.value = {
    word: displayWord,
    pos: entry?.pos ?? '',
    meaningCn: entry?.meaningCn ?? '暂无释义',
  }
  popupAnchor.value = word.globalWordIndex
  // 刚打开时先藏到屏外，测好位置再显示，避免闪在旧位置
  if (!wasOpen) popupTop.value = -9999
  nextTick(() => updatePopupPosition())
}

/** 测量锚点词与弹框尺寸，算出完整显示的位置：
 * 横向以词为中心、左右钳制在文章内；纵向优先放词上方，上方会顶出屏幕时改放词下方 */
function updatePopupPosition() {
  if (!popupWord.value || popupAnchor.value < 0) return
  const query = uni.createSelectorQuery()
  query.select('#article').boundingClientRect()
  query.select('#w-' + popupAnchor.value).boundingClientRect()
  query.select('#wordPopup').boundingClientRect()
  query.exec((res: any) => {
    const articleRect = res?.[0]
    const wordRect = res?.[1]
    const popupRect = res?.[2]
    if (!articleRect || !wordRect || !popupRect) return
    const center = wordRect.left - articleRect.left + wordRect.width / 2
    const maxLeft = Math.max(0, articleRect.width - popupRect.width)
    popupLeft.value = Math.min(Math.max(0, center - popupRect.width / 2), maxLeft)
    const gap = 8
    const aboveTop = wordRect.top - articleRect.top - popupRect.height - gap
    const belowTop = wordRect.bottom - articleRect.top + gap
    // 词上方剩余高度不够放弹框时改放下方（词靠近顶部时下方一定有空间）
    popupTop.value = wordRect.top - popupRect.height - gap < 0 ? belowTop : aboveTop
  })
}

/** 关闭生词弹框 */
function closeVocabPopup() {
  popupWord.value = null
  popupAnchor.value = -1
}

/** 隐藏/显示原文：隐藏时先关弹框；恢复显示后下一帧重测 pill 位置（原文重渲染后旧位置失效） */
function toggleTranscript() {
  hideTranscript.value = !hideTranscript.value
  if (hideTranscript.value) {
    closeVocabPopup()
  } else {
    nextTick(() => updatePillPosition())
  }
}

/** 点星星：收藏/取消收藏当前词（弹框不关闭，星星即时变实心/空心） */
function onStarClick() {
  if (!popupWord.value || !lesson.value) return
  const nowSaved = vocabStore.toggle({
    word: popupWord.value.word,
    pos: popupWord.value.pos,
    meaningCn: popupWord.value.meaningCn,
    lessonId: lesson.value.id,
    lessonTitle: lesson.value.title,
  })
  uni.showToast({
    title: nowSaved ? '已加入生词表' : '已移出生词表',
    icon: 'none',
    duration: 1500,
  })
}

// 跟读切句：用未取整的 rawCurrentTime 判断，避免取整带来的 1 秒延迟
watch(
  () => audioStore.rawCurrentTime,
  (t) => {
    if (!isShadowing.value || gapActive.value || !audioStore.playing) return
    const cur = flatSentences.value[shadowIndex.value]
    if (!cur) return
    // 切句点 = 句末 + 0.3s 尾音缓冲：whisper 词边界偏紧，直接按 endTime 切会把末词尾音切掉
    // （2026-10-29 用户反馈 repeat-after 末词老读不完整）；不超过下一句开头，避免吃掉下一句
    let cutAt = cur.endTime + 0.3
    const next = flatSentences.value[shadowIndex.value + 1]
    if (next) {
      cutAt = Math.min(cutAt, Math.max(cur.endTime, next.startTime - 0.05))
    }
    if (t >= cutAt) {
      advanceShadow()
    }
  },
)

// 自然播完的兜底：最后一句 endTime 等于音频总时长时，onEnded 可能先于
// 最后一次 onTimeUpdate 到达 endTime；此时用播放停止信号补一次切句判断。
// （store 的 onEnded 特意不重置 rawCurrentTime，就是为了保留这个判断依据）
watch(
  () => audioStore.playing,
  (playing) => {
    if (playing) {
      userPaused.value = false
      // 播放中不收起控制条
      clearCollapseTimer()
      return
    }
    // 暂停后 5 秒收起控制条（pokeBar 内部只在普通条展开时生效）
    pokeBar()
    if (!isShadowing.value || gapActive.value || userPaused.value) return
    const sentences = flatSentences.value
    const last = sentences[sentences.length - 1]
    if (!last || shadowIndex.value !== sentences.length - 1) return
    if (audioStore.rawCurrentTime >= last.endTime - 0.6) {
      advanceShadow()
    }
  },
)

// 跟读句切换时自动滚动到该句
watch(shadowIndex, (idx) => {
  if (isShadowing.value) {
    scrollToSentence(idx)
  }
})

/**
 * 段落预处理：把每句英文切成 token，生词表中的词在全课首次出现时做标记。
 * 生词释义等卡片内容属后续阶段，本阶段只做黄色标记 + 角标序号。
 */
const processedParagraphs = computed<ProcessedParagraph[]>(() => {
  if (!lesson.value) return []
  const vocabMap = new Map<string, number>()
  ;(lesson.value.vocabWords ?? []).forEach((word, index) => {
    vocabMap.set(word.toLowerCase(), index + 1)
  })
  const marked = new Set<string>()
  let globalIndex = 0
  let globalWordIndex = 0
  return lesson.value.paragraphs.map((para) => ({
    heading: para.heading,
    translation: para.sentences.map((s) => s.translation ?? '').join(''),
    sentences: para.sentences.map((sentence) => ({
      sentence,
      globalIndex: globalIndex++,
      words: buildWords(sentence, vocabMap, marked, () => globalWordIndex++),
    })),
  }))
})

/** 全课按顺序排好的词（用于当前词高亮查找） */
const flatWords = computed<WordSpan[]>(() =>
  processedParagraphs.value.flatMap((p) => p.sentences.flatMap((s) => s.words)),
)

/** 当前朗读到的词全局下标（用于单词高亮；用未取整时间，定位精确到词） */
const currentWordIndex = computed(() => {
  if (isThisLessonLoading.value) return frozenWordIndex.value
  const t = audioStore.displayTime
  const found = flatWords.value.find((w) => t >= w.startTime && t < w.endTime)
  const idx = found ? found.globalWordIndex : -1
  frozenWordIndex.value = idx
  return idx
})

// 词高亮下标：留白期间没有音频在读，不显示词高亮（否则会落在下一句的第一个词上）
const highlightWordIndex = computed(() =>
  gapActive.value ? -1 : currentWordIndex.value,
)

/** 把英文句子切成按词渲染的 WordSpan：优先用对齐实测的单词时间戳，
 * 缺省时按句内词长比例估算；生词首次出现时返回角标序号 */
function buildWords(
  sentence: LessonSentence,
  vocabMap: Map<string, number>,
  marked: Set<string>,
  nextIndex: () => number,
): WordSpan[] {
  const textWords = sentence.text.split(' ')
  const measured = sentence.words
  const span = sentence.endTime - sentence.startTime
  const totalChars = textWords.reduce((sum, w) => sum + w.length, 0) || 1
  let t = sentence.startTime
  return textWords.map((text, i) => {
    let startTime: number
    let endTime: number
    if (measured && measured[i]) {
      // 实测时间戳与文本词一一对应时直接采用
      startTime = measured[i].startTime
      endTime = measured[i].endTime
    } else {
      const dur = (span * text.length) / totalChars
      startTime = t
      endTime = i === textWords.length - 1 ? sentence.endTime : t + dur
      t += dur
    }
    // 生词匹配：去掉词尾标点再比对（如 "closet." 匹配 closet）
    const key = text.toLowerCase().replace(/[^a-z']/g, '')
    let vocabNo: number | undefined
    if (vocabMap.has(key) && !marked.has(key)) {
      marked.add(key)
      vocabNo = vocabMap.get(key)
    }
    return { text, startTime, endTime, vocabNo, globalWordIndex: nextIndex() }
  })
}

// 进入页面：按 id 找课程；找不到则提示并返回
onLoad(async (options: any) => {
  closeVocabPopup()
  const found = lessons.find((item) => item.id === options?.id)
  if (found) {
    lesson.value = found
    // 不做断点续播：切课时回到开头；同一课正在后台播放时不打断
    audioStore.loadLesson(found)
    audioStore.warmLesson(found) // 预热：提前换地址+缓冲，点播放直接出声
    refreshFavored()
    return
  }
  // 不在官方课里：试着当导入课从云端取（仅本人已完成的导入）
  try {
    const res: any = await wx.cloud.callFunction({
      name: 'importApi',
      data: { action: 'getLesson', lessonId: options?.id },
    })
    const imported = res.result.lesson as Lesson | null
    if (imported) {
      lesson.value = imported
      audioStore.loadLesson(imported)
      audioStore.warmLesson(imported)
      refreshFavored()
      return
    }
  } catch {
    // 云函数未部署时走下面的不存在分支
  }
  uni.showToast({ title: '课程不存在', icon: 'none' })
  setTimeout(() => uni.navigateBack(), 1500)
})

// 收藏
const favored = ref(false)
async function refreshFavored() {
  const id = lesson.value && lesson.value.id
  if (!id) return
  try {
    const r: any = await wx.cloud.callFunction({ name: 'userApi', data: { action: 'isFavored', lessonId: id } })
    favored.value = !!(r.result && r.result.favored)
  } catch {}
}
async function onToggleFav() {
  const l = lesson.value
  if (!l) return
  try {
    const r: any = await wx.cloud.callFunction({
      name: 'userApi',
      data: {
        action: 'toggleFavorite',
        lessonId: l.id,
        title: l.title || '',
        cover: (l as any).cover || '',
        level: (l as any).level || '',
        source: (l as any).source || '',
        duration: (l as any).duration || 0,
      },
    })
    favored.value = !!(r.result && r.result.favored)
    uni.showToast({ title: favored.value ? '已收藏' : '已取消收藏', icon: 'none' })
  } catch (e: any) {
    const msg = String((e && (e.errMsg || e.message)) || '')
    uni.showToast({
      title: msg.includes('FAVORITES_COLLECTION_MISSING') ? '请先在云开发控制台新建 favorites 集合' : '操作失败，请重试',
      icon: 'none',
    })
  }
}

// 播放 / 暂停
function onTogglePlay() {
  if (!lesson.value) return
  if (audioStore.currentLesson?.id === lesson.value.id) {
    audioStore.toggle()
  } else {
    audioStore.playLesson(lesson.value)
  }
  pokeBar()
}

// 确保当前课已设为播放源（未设时先 playLesson 再跳转）
function ensurePlaying() {
  if (!lesson.value) return false
  if (audioStore.currentLesson?.id !== lesson.value.id) {
    audioStore.playLesson(lesson.value)
  }
  return true
}

// 点击句子：跳转到该句开始时间并播放；跟读中则同步跟读下标并清除留白计时器
/** 从指定句开头开始播放（跟读模式下同时把跟读句切到该句） */
function playSentence(item: ProcessedSentence) {
  if (!ensurePlaying()) return
  if (isShadowing.value) {
    clearGapTimer()
    shadowIndex.value = item.globalIndex
    currentRepeat.value = 1
  }
  audioStore.playFrom(item.sentence.startTime)
}

/** 点词：从该词所在的句开头开始播放 */
function onWordClick(word: WordSpan, item: ProcessedSentence) {
  // 带下划线的生词：弹词性 + 中文翻译，不触发播放；普通词：从句首播放并关掉已开的弹框
  if (word.vocabNo !== undefined) {
    openVocabPopup(word)
  } else {
    closeVocabPopup()
    playSentence(item)
  }
}

// 上一句：跳到上一句开始时间并播放
function onPrevSentence() {
  closeVocabPopup()
  const idx = currentSentenceIndex.value
  const target = flatSentences.value[idx <= 0 ? 0 : idx - 1]
  if (!target || !ensurePlaying()) return
  audioStore.playFrom(target.startTime)
  pokeBar()
}

// 下一句：跳到下一句开始时间并播放
function onNextSentence() {
  closeVocabPopup()
  const idx = currentSentenceIndex.value
  const target =
    flatSentences.value[
      idx < 0 ? 0 : Math.min(idx + 1, flatSentences.value.length - 1)
    ]
  if (!target || !ensurePlaying()) return
  audioStore.playFrom(target.startTime)
  pokeBar()
}

// 定位：跳转到正在朗读的句子位置（只滚动页面，不改变播放）
function onLocateCurrent() {
  if (!lesson.value) return
  const t = audioStore.displayTime || audioStore.currentTime
  let idx = flatSentences.value.findIndex(
    (s) => t >= s.startTime && t < s.endTime,
  )
  if (idx < 0) {
    idx = flatSentences.value.findIndex((s) => s.endTime > t)
    if (idx < 0) idx = flatSentences.value.length - 1
  }
  if (idx < 0) return
  scrollToSentence(idx)
  pokeBar()
}

// slider 拖动中
function onSliderChanging(e: any) {
  isDragging.value = true
  dragValue.value = e.detail.value
  pokeBar()
}

// slider 拖动结束：跳转播放位置；跟读中则清除留白计时器并把跟读下标同步到拖动位置
function onSliderChange(e: any) {
  isDragging.value = false
  const target = e.detail.value
  audioStore.seek(target)
  if (isShadowing.value) {
    clearGapTimer()
    const idx = flatSentences.value.findIndex(
      (s) => target >= s.startTime && target < s.endTime,
    )
    shadowIndex.value = idx >= 0 ? idx : flatSentences.value.length - 1
    currentRepeat.value = 1
  }
  pokeBar()
}

// ---------- 跟读（Shadowing）状态机 ----------

/** 清除留白计时器（手动拖动、点句跳转、暂停、退出跟读、页面卸载时调用） */
function clearGapTimer() {
  if (gapTimer !== null) {
    clearTimeout(gapTimer)
    gapTimer = null
  }
  gapActive.value = false
  pendingNext.value = -1
  pendingRepeat.value = -1
  stopGapTicker()
}

/**
 * 跟读推进：当前句播完时调用（由 rawCurrentTime watch 或自然播完兜底触发）。
 * 先决定下一步：Focus loop（只循环当前句）→ 未播满遍数（重播当前句）→
 * 播满遍数（下一句；到末尾时 Loop 回第一句，否则停住）。
 * Repeat after 模式下，每播完一遍都先暂停留白（当前句时长 × 停顿倍率）再继续，
 * 即：播一遍 → 停顿 → 再播一遍 → 停顿 → 下一句；Shadow 模式直接播，不停顿。
 */
function advanceShadow() {
  if (!isShadowing.value || gapActive.value) return
  const sentences = flatSentences.value
  const cur = sentences[shadowIndex.value]
  if (!cur) return
  // 决定下一步与下一遍的遍数（留白结束时才生效，留白期间面板仍显示刚播完的那一遍）
  let targetIndex: number
  let targetRepeat: number
  if (focusLoop.value) {
    // Focus loop：只循环当前一句（遍数计数继续累加显示）
    targetIndex = shadowIndex.value
    targetRepeat = currentRepeat.value + 1
  } else if (currentRepeat.value < repeatTimes.value) {
    // 未播满遍数：重播当前句
    targetIndex = shadowIndex.value
    targetRepeat = currentRepeat.value + 1
  } else {
    // 播满遍数：到下一句
    const isLast = shadowIndex.value >= sentences.length - 1
    if (isLast && !loop.value) {
      // 播完且不循环：停住，保持在最后一句，面板显示已暂停
      audioStore.pause()
      return
    }
    targetIndex = isLast ? 0 : shadowIndex.value + 1
    targetRepeat = 1
  }
  if (shadowMode.value === 'repeat') {
    // Repeat after：先暂停留白，再重播当前句或播下一句
    audioStore.pause()
    gapActive.value = true
    pendingNext.value = targetIndex
    pendingRepeat.value = targetRepeat
    const gapMs = Math.round((cur.endTime - cur.startTime) * 1000 * pauseRate.value)
    startGapTicker(gapMs)
    gapTimer = setTimeout(() => {
      gapActive.value = false
      gapTimer = null
      stopGapTicker()
      if (!isShadowing.value) return
      const nextIndex = pendingNext.value
      const nextRepeat = pendingRepeat.value
      pendingNext.value = -1
      pendingRepeat.value = -1
      shadowIndex.value = nextIndex
      currentRepeat.value = nextRepeat
      const target = flatSentences.value[nextIndex]
      if (target) {
        audioStore.playFrom(target.startTime)
      }
    }, gapMs)
  } else {
    // Shadow：直接播下一句 / 重播当前句
    shadowIndex.value = targetIndex
    currentRepeat.value = targetRepeat
    audioStore.playFrom(sentences[targetIndex].startTime)
  }
}

/** 进入跟读：定位到当前播放位置所在的句子；正在播放时从该句开头重播 */
function enterShadowing() {
  if (!lesson.value) return
  clearGapTimer()
  clearCollapseTimer()
  userPaused.value = false
  const t = audioStore.displayTime || audioStore.currentTime
  const idx = flatSentences.value.findIndex(
    (s) => t >= s.startTime && t < s.endTime,
  )
  shadowIndex.value = idx >= 0 ? idx : 0
  currentRepeat.value = 1
  isShadowing.value = true
  scrollToSentence(shadowIndex.value)
  if (audioStore.playing) {
    ensurePlaying()
    const target = flatSentences.value[shadowIndex.value]
    if (target) {
      audioStore.playFrom(target.startTime)
    }
  }
}

/** 退出跟读：回到普通播放模式，音频保持当前播放 / 暂停状态不变 */
function exitShadowing() {
  clearGapTimer()
  isShadowing.value = false
  userPaused.value = false
  pokeBar()
}

/** 跟读中手动切句：清除留白计时器，从目标句开始播放 */
function jumpShadowTo(index: number) {
  const target = flatSentences.value[index]
  if (!target || !ensurePlaying()) return
  clearGapTimer()
  shadowIndex.value = index
  currentRepeat.value = 1
  audioStore.playFrom(target.startTime)
}

/** 跟读面板：上一句 */
function onShadowPrev() {
  closeVocabPopup()
  jumpShadowTo(shadowIndex.value <= 0 ? 0 : shadowIndex.value - 1)
}

/** 跟读面板：下一句 */
function onShadowNext() {
  closeVocabPopup()
  jumpShadowTo(
    Math.min(shadowIndex.value + 1, flatSentences.value.length - 1),
  )
}

/**
 * 跟读面板播放 / 暂停（复用 audioStore.toggle 的语义，另处理两种特殊情况）：
 * 留白等待中按播放 = 跳过等待直接播下一步（重播当前句或下一句）；
 * 暂停中按播放时，若当前位置已不在当前句范围内，从当前句开头重播，否则从中断处继续。
 */
function onShadowToggle() {
  if (!lesson.value) return
  if (gapActive.value) {
    const next = pendingNext.value
    const nextRepeat = pendingRepeat.value
    clearGapTimer()
    shadowIndex.value = next
    currentRepeat.value = nextRepeat > 0 ? nextRepeat : 1
    const target = flatSentences.value[next]
    if (target) {
      ensurePlaying()
      audioStore.playFrom(target.startTime)
    }
    return
  }
  if (audioStore.playing) {
    userPaused.value = true
    audioStore.toggle()
    return
  }
  userPaused.value = false
  if (!ensurePlaying()) return
  const cur = flatSentences.value[shadowIndex.value]
  if (!cur) return
  const t = audioStore.rawCurrentTime
  if (t < cur.startTime || t >= cur.endTime) {
    audioStore.playFrom(cur.startTime)
  } else {
    audioStore.toggle()
  }
}

/** 设置每句重复遍数（切换后当前遍数归 1） */
function setRepeatTimes(n: number) {
  repeatTimes.value = n
  currentRepeat.value = 1
}

/** 切换 Focus loop（切换后当前遍数归 1） */
function toggleFocusLoop() {
  focusLoop.value = !focusLoop.value
  currentRepeat.value = 1
}

/**
 * 自动滚动到指定句子：句子元素带 id（s-全局下标），用 selectorQuery 取位置后滚动，
 * 顶部留出 200rpx，避免句子贴到屏幕顶缘。
 */
function scrollToSentence(index: number) {
  nextTick(() => {
    const query = uni.createSelectorQuery()
    query.selectViewport().scrollOffset()
    query.select(`#s-${index}`).boundingClientRect()
    query.exec((res: any) => {
      const viewport = res?.[0]
      const rect = res?.[1]
      if (!viewport || !rect) return
      const offset = (200 * uni.getSystemInfoSync().windowWidth) / 750
      uni.pageScrollTo({
        scrollTop: Math.max(0, viewport.scrollTop + rect.top - offset),
        duration: 300,
      })
    })
  })
}

// 页面卸载时：停止播放 + 清除留白计时器和自动收回计时器，避免后台回调错乱
onUnload(() => {
  audioStore.stop()
  clearGapTimer()
  clearCollapseTimer()
})
</script>

<style scoped>
/* 底部留出悬浮控制条的位置，避免最后一段被遮住 */
.container {
  padding: 24rpx 24rpx 280rpx;
}

.header {
  padding: 8rpx 8rpx 24rpx;
}

.title {
  font-size: 36rpx;
  font-weight: bold;
  color: #333333;
  font-family: 'Lora', -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;
}

.title-cn {
  margin-top: 8rpx;
  font-size: 28rpx;
  color: #666666;
}

.meta {
  margin-top: 8rpx;
  font-size: 24rpx;
  color: #999999;
}

.fav-btn { font-size: 26rpx; color: #ab47bc; margin-left: auto; padding: 8rpx 4rpx; }
.transcript-toggle-row {
  margin-top: 12rpx;
  display: flex;
  align-items: center;
}

.transcript-toggle {
  font-size: 26rpx;
  color: #7c5cd6;
}

.transcript-hidden {
  padding: 80rpx 8rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24rpx;
}

.transcript-hidden-text {
  font-size: 30rpx;
  color: #999999;
}

.transcript-hidden-btn {
  font-size: 28rpx;
  color: #7c5cd6;
  padding: 16rpx 40rpx;
  border: 2rpx solid #7c5cd6;
  border-radius: 36rpx;
}

.article {
  position: relative;
  padding: 0 8rpx;
}

.para {
  margin-bottom: 56rpx;
}

.para-heading {
  margin-bottom: 16rpx;
  font-size: 34rpx;
  font-weight: bold;
  color: #222222;
  font-family: 'Lora', -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;
}

.para-text {
  font-size: 30rpx;
  line-height: 2.2;
  color: #333333;
  font-family: 'Lora', -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;
}

.sentence.current {
  background-color: #ede7f6;
  border-radius: 6rpx;
}

/* 句首悬浮状态 pill：朗读 Listen / 暂停 Paused 为深色，轮到用户 Your turn 为黄色；
   绝对定位在句首上方（可盖住上一行文字），不占行内位置，句子不再因 pill 长度变化而移位 */
.status-pill-float {
  position: absolute;
  transform: translateY(-100%);
  z-index: 10;
  font-size: 20rpx;
  line-height: 1;
  padding: 8rpx 16rpx;
  border-radius: 24rpx;
  white-space: nowrap;
  margin-left: -8rpx;
}
.status-pill-listen,
.status-pill-paused {
  background-color: #2b1b4d;
  color: #ffffff;
}
.status-pill-turn {
  background-color: #ffd60a;
  color: #2b1b4d;
  font-weight: bold;
}

/* 生词弹框：白底卡片，悬在锚点词附近；横向以词为中心并钳制在文章内，纵向优先上方、不够时放下方 */
.word-popup {
  position: absolute;
  width: 420rpx;
  z-index: 20;
  background: #fff;
  border-radius: 20rpx;
  padding: 24rpx;
  box-shadow: 0 8rpx 30rpx rgba(0, 0, 0, 0.18);
  margin-left: -8rpx;
}
.word-popup-head {
  display: flex;
  align-items: center;
}
.word-popup-word {
  font-size: 34rpx;
  font-weight: bold;
  color: #1a1a1a;
}
.word-popup-pos {
  font-size: 24rpx;
  color: #7c5cd6;
  margin-left: 16rpx;
}
.word-popup-star {
  width: 44rpx;
  height: 44rpx;
  margin-left: auto;
}
.word-popup-close {
  font-size: 32rpx;
  color: #999;
  margin-left: 20rpx;
  padding: 4rpx 8rpx;
}
.word-popup-meaning {
  font-size: 30rpx;
  color: #333;
  margin-top: 16rpx;
  line-height: 1.5;
}

/* 词间距：词后空格之外再加一点间距，读起来不挤 */
.word {
  margin-right: 6rpx;
}

/* 当前朗读到的词：黄色标记笔高亮，盖在句子浅紫底色之上 */
.word-current {
  background-color: #ffd60a;
  border-radius: 6rpx;
}

/* 生词：只改字色 + 下划线，不填充底色 */
.vocab {
  color: #6c5ce7;
  text-decoration: underline;
}

.vocab-sup {
  font-size: 20rpx;
  color: #7c6aae;
  text-decoration: none;
}

/* 底部默认圆形控制：点击展开为完整控制条 */
/* 底部默认圆形控制：本身 98rpx，6rpx 深色边框往外加 12rpx，外径正好 110rpx，与展开条同高 */
.player-circle {
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  bottom: 40rpx;
  bottom: calc(40rpx + env(safe-area-inset-bottom));
  width: 128rpx;
  height: 128rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: #ffd60a;
  border: 6rpx solid #2b1b4d;
  border-radius: 50%;
  box-shadow: 0 8rpx 32rpx rgba(0, 0, 0, 0.35);
  z-index: 99;
}

.player-circle-icon {
  width: 60rpx;
  height: 60rpx;
}

/* 底部悬浮控制条：页面底部居中，占页面宽度的三分之二；进度条贴在模块底边、左右留边；条高约 110rpx，与收起圆钮同高 */
.player-bar {
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  bottom: 28rpx;
  bottom: calc(28rpx + env(safe-area-inset-bottom));
  width: 84%;
  padding: 22rpx 20rpx;
  background-color: #2b1b4d;
  border-radius: 999rpx;
  box-shadow: 0 8rpx 32rpx rgba(0, 0, 0, 0.25);
  z-index: 99;
}

/* 进度条：绝对定位贴在模块底边上，左右各留 24rpx，不占模块高度 */
.bar-slider {
  position: absolute;
  bottom: 0;
  left: 24rpx;
  right: 24rpx;
  transform: translateY(50%);
}

.bar-controls {
  display: flex;
  align-items: center;
  margin-top: 0;
}

/* 左右两组各占一半空间，把播放键夹在条的正中：条本身居中，所以播放键中心与收起圆钮中心完全重合，展开收起时黄键不跳动 */
.bar-side {
  flex: 1;
  display: flex;
  align-items: center;
}

.bar-side-left {
  justify-content: space-around;
}

.bar-side-right {
  justify-content: space-around;
}

/* 倍速展示：v1.4 起倍速切换下线，这里仅静态展示固定 1X，不可点击 */
.bar-speed {
  min-width: 96rpx;
  height: 54rpx;
  line-height: 54rpx;
  text-align: center;
  background-color: rgba(255, 255, 255, 0.18);
  color: #ffffff;
  font-size: 28rpx;
  border-radius: 27rpx;
  padding: 0 16rpx;
}

/* 控制条上一曲 / 下一曲图标（白色图片，不再用文字符号，避免 iOS 按 emoji 渲染） */
.bar-icon {
  width: 44rpx;
  height: 44rpx;
}

.bar-btn-main {
  width: 120rpx;
  height: 120rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: #ffd60a;
  border-radius: 50%;
}

.bar-btn-loading {
  width: 52rpx;
  height: 52rpx;
  border: 6rpx solid rgba(43, 27, 77, 0.18);
  border-top-color: #2b1b4d;
  border-radius: 50%;
  animation: bar-btn-spin 0.8s linear infinite;
}
@keyframes bar-btn-spin {
  to { transform: rotate(360deg); }
}
.bar-btn-main-icon {
  width: 54rpx;
  height: 54rpx;
}


/* 跟读入口：图标按钮（Material record_voice_over，金色） */
.bar-shadow-icon {
  width: 48rpx;
  height: 48rpx;
}

/* 定位入口：准星图标（自绘粗线条图片，与跟读图标同尺寸同色），点它跳回正在朗读的句子 */
.bar-locate-icon {
  width: 48rpx;
  height: 48rpx;
}

/* 跟读面板比控制条高，容器底部多留空间，避免最后一段被遮住 */
.container-shadow {
  padding-bottom: 620rpx;
}

/* 跟读面板：底部通栏深色面板，替换底部悬浮控制条 */
.shadow-panel {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 20rpx 28rpx calc(20rpx + env(safe-area-inset-bottom));
  background-color: #2b1b4d;
  border-radius: 24rpx 24rpx 0 0;
  box-shadow: 0 -4rpx 32rpx rgba(0, 0, 0, 0.25);
  z-index: 99;
}

.shadow-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8rpx;
}
.shadow-status-wrap {
  display: flex;
  align-items: center;
}
.gap-ring {
  flex-shrink: 0;
  margin-left: 12rpx;
}

.shadow-status {
  font-size: 26rpx;
  color: #ffffff;
}

.shadow-exit {
  flex-shrink: 0;
  padding: 8rpx 20rpx;
  background-color: rgba(255, 255, 255, 0.15);
  border-radius: 24rpx;
  font-size: 24rpx;
  color: #ffffff;
}

.shadow-slider {
  width: 100%;
  margin: 0;
}

.shadow-controls {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 48rpx;
  margin: 12rpx 0;
}

/* 跟读面板上一曲 / 下一曲图标（白色图片） */
.shadow-icon {
  width: 44rpx;
  height: 44rpx;
}

.shadow-btn-main {
  width: 96rpx;
  height: 96rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: #ffd60a;
  border-radius: 50%;
}

.shadow-btn-main-icon {
  width: 44rpx;
  height: 44rpx;
}

.shadow-group {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 16rpx;
  margin-top: 16rpx;
}

.shadow-label {
  width: 110rpx;
  font-size: 22rpx;
  color: rgba(255, 255, 255, 0.6);
}

.shadow-chip {
  padding: 8rpx 22rpx;
  background-color: rgba(255, 255, 255, 0.12);
  border-radius: 24rpx;
  font-size: 24rpx;
  color: #ffffff;
}

.shadow-chip.active {
  background-color: #ffd60a;
  color: #2b1b4d;
}

.empty {
  padding: 80rpx 0;
  text-align: center;
  font-size: 28rpx;
  color: #999999;
}
</style>
