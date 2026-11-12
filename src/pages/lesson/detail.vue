<template>
  <view class="container" :class="{ 'container-shadow': isShadowing }">
    <view v-if="lesson" class="lesson">
      <text class="article-topic">{{articleTopic}}</text>
      <!-- 标题区 -->
      <view class="header">
        <view class="title">{{ readableTitle(lesson.title) }}</view>
        <view v-if="showTranslation && lesson.titleCn" class="title-cn">{{ lesson.titleCn }}</view>
        <view class="meta">{{ lesson.level ? lesson.level + ' · ' : '' }}{{ formatTime(lesson.duration) }} · Progress saved automatically</view>
        <view class="transcript-toggle-row">
          <text class="transcript-toggle" @click="toggleTranscript">{{ hideTranscript ? 'Show transcript' : 'Hide transcript' }}</text>
          <text class="fav-btn" @click="onToggleFav">{{ favored ? '♥ Saved' : '♡ Save' }}</text>
        </view>
      </view>
      
      <view class="inline-player reference-player">
        <view class="reference-heading"><CoverImage class="reference-cover" :src="lesson.cover" compact /><view class="reference-copy"><text class="reference-title">{{readableTitle(lesson.title)}}</text><text class="reference-subtitle">{{lesson.level}} · English listening &amp; shadowing</text></view></view>
      <view v-if="dockWaveform.length" class="dock-waveform"><view class="dock-wave-bars" aria-hidden="true"><view v-for="(peak,i) in dockWaveform" :key="i" :class="{played:Number(i)/dockWaveform.length*100<=dockProgress}" :style="{height:Math.max(6,peak*.88)+'%'}"/></view><view class="dock-wave-cursor" :style="{left:dockProgress+'%'}"/><text class="dock-wave-time" :style="{left:Math.max(7,Math.min(93,dockProgress))+'%'}">{{formatTime(sliderValue)}}</text><slider class="dock-wave-seek" aria-label="Audio progress" :value="sliderValue" :max="audioStore.duration" :step=".1" block-size="12" block-color="#ffcf00" activeColor="transparent" backgroundColor="transparent" @changing="onSliderChanging" @change="onSliderChange"/></view>
      <slider v-else class="dock-plain-slider" aria-label="Audio progress" :value="sliderValue" :max="audioStore.duration" :step=".1" block-size="12" block-color="#ffcf00" activeColor="#ffcf00" backgroundColor="#61447f" @changing="onSliderChanging" @change="onSliderChange"/>
      <view class="dock-times"><text>{{dockWaveform.length?'':formatTime(sliderValue)}}</text><text>{{formatTime(audioStore.duration)}}</text></view>
      <view v-if="dockFocusIndex>=0" class="dock-loop-range">Sentence loop · {{formatTime(flatSentences[dockFocusIndex]?.startTime || 0)}} – {{formatTime(flatSentences[dockFocusIndex]?.endTime || 0)}}</view>
        <view class="reference-controls"><button class="reference-pill reference-shadow" :class="{active:isShadowing}" :aria-pressed="isShadowing" aria-label="Shadowing" @click="isShadowing?exitShadowing():enterShadowing()"><image :src="'/static/player-icons/'+(isShadowing?'active':'muted')+'/shadow.png'"/></button><button class="reference-skip" aria-label="Rewind 5 seconds" @click="seekRelative(-5)"><image src="/static/player-icons/muted/back5.png"/></button><button class="reference-play" :aria-label="isThisLessonLoading?'Loading audio':isThisLessonPlaying?'Pause':'Play'" @click="onTogglePlay"><PlaybackGlyph :loading="isThisLessonLoading" :playing="isThisLessonPlaying" :size="34"/></button><button class="reference-skip" aria-label="Forward 5 seconds" @click="seekRelative(5)"><image src="/static/player-icons/muted/forward5.png"/></button><button class="reference-pill" :class="{active:dockFocusIndex>=0}" :aria-pressed="dockFocusIndex>=0" aria-label="Focus loop" @click="toggleDockFocus"><image :src="'/static/player-icons/'+(dockFocusIndex>=0?'active':'muted')+'/focus.png'"/><text>Focus</text></button></view>
      </view>
      <view class="shadow-entry" :class="{active:isShadowing}"><view class="shadow-entry-head"><text class="shadow-entry-label">PRACTICE</text><button class="shadow-entry-button" :class="{selected:isShadowing}" :aria-pressed="isShadowing" @click="isShadowing?exitShadowing():enterShadowing()"><image src="/static/player-icons/active/shadowing.png"/><text>Shadowing</text></button><button class="shadow-help" aria-label="How shadowing works" @click="showShadowHelp">?</button></view><view v-if="isShadowing" class="shadow-entry-summary"><text>Speak along · {{shadowIndex+1}} / {{flatSentences.length}} · Repeat {{currentRepeat}} / {{repeatTimes}}</text><button @click="showShadowSettings=!showShadowSettings">Settings</button></view><text v-else class="shadow-entry-caption">Listen to each sentence. Speak along. Repeat.</text></view>
      <view class="lesson-sections"><text v-for="section in ['Transcript','Words','Practice']" :key="section" :class="{active:activeSection===section}" @click="jumpSection(section)">{{section}}</text><text class="appearance-link" @click="showSettings=!showSettings">Aa</text></view>
      <view v-if="showSettings" class="reading-settings"><view class="reading-options"><text @click="toggleTranslation">{{showTranslation?'Hide translation':'Translate'}}</text><text @click="autoScroll=!autoScroll">{{autoScroll?'Auto-follow on':'Auto-follow off'}}</text></view><view>Text size <text v-for="size in [28,32,36,40]" :key="size" :class="{selected:fontSize===size}" @click="fontSize=size">{{size}}</text></view><view><text @click="compact=!compact">{{compact?'Compact spacing':'Relaxed spacing'}}</text><text @click="showVocab=!showVocab">{{showVocab?'Hide highlights':'Show highlights'}}</text></view></view>

      <!-- 原文：整段排版（小节标题 + 流动段落，不再按句子拆卡片） -->
      <view v-if="!hideTranscript" class="article" id="article" :style="{fontSize:fontSize+'rpx'}" @touchstart="manualScrollUntil=Date.now()+5000">
        <view
          v-for="(para, pIndex) in processedParagraphs"
          :key="pIndex"
          class="para"
        >
          <view v-if="para.heading" class="para-heading">{{ para.heading }}</view>
          <text class="para-text" :style="{fontSize:fontSize+'rpx',lineHeight:compact?1.7:1.95}">
            <text
              v-for="item in para.sentences"
              :key="item.globalIndex"
              :id="'s-' + item.globalIndex"
              class="sentence" :style="showTranslation?'display:block;margin-bottom:20rpx':''"
              :class="{ current: item.globalIndex === highlightSentenceIndex }"
            ><text
              v-for="(word, wIndex) in item.words"
              :key="wIndex"
              :id="'w-' + word.globalWordIndex"
              class="word"
              @click="onWordClick(word, item)"
            ><text
              :class="{ 'word-current': word.globalWordIndex === highlightWordIndex, vocab: showVocab && word.vocabNo !== undefined }"
            >{{ word.text }}<text
              v-if="showVocab && word.vocabNo !== undefined"
              class="vocab-sup"
            >{{ word.vocabNo }}</text></text>{{ ' ' }}</text><text v-if="showTranslation" class="sentence-actions" @click="playSentence(item)">▶ Listen</text><text v-if="showTranslation" class="sentence-translation" @click="translateSentence(item)">{{translations[item.globalIndex] || (translationBusy===item.globalIndex?'Translating…':(translationErrors[item.globalIndex]||'Tap to translate'))}}</text></text>
          </text>
        </view>
        <view
          v-if="pillKind && pillSentenceIndex >= 0 && !pillHidden"
          id="pill"
          class="status-pill-float"
          :class="'status-pill-' + pillKind"
          :style="{ top: pillTop + 'px', left: pillLeft + 'px', transform: pillBelow ? 'none' : 'translateY(-100%)' }"
          @click="onPillClick"
        ><SentenceProgress v-if="isShadowing" :key="shadowIndex+'-'+currentRepeat+'-'+gapActive" :elapsed="gapActive?(gapTotalMs-gapRemainingMs)/1000:Math.max(0,audioStore.rawCurrentTime-(flatSentences[shadowIndex]?.startTime||0))" :duration="gapActive?gapTotalMs/1000:Math.max(.05,(flatSentences[shadowIndex]?.endTime||0)-(flatSentences[shadowIndex]?.startTime||0))" :running="!gapActive && isThisLessonPlaying && !isThisLessonLoading" :rate="audioStore.speed" :count="currentRepeat"/><text>{{ pillText }}</text></view>
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
            <text v-if="popupWord.saveRequested" class="word-saving">Saving…</text>
            <image v-else
              class="word-popup-star"
              :src="isPopupSaved ? '/static/star-filled.png' : '/static/star-outline.png'"
              @click.stop="onStarClick"
            />
            <text class="word-popup-close" @click.stop="closeVocabPopup">✕</text>
          </view>
          <view class="word-popup-meaning">{{ popupWord.meaningCn }}</view><text v-if="popupWord.error" class="word-retry" @click.stop="retryPopupLookup">Try again ↻</text>
        </view>
      </view>
      <!-- 原文隐藏时：只留提示 + 显示按钮（播放、Practice、控制条照常可用；悬浮 pill 跟原文一起藏起，因为它要锚在句首词上） -->
      <view v-else class="transcript-hidden">
        <text class="transcript-hidden-text">Just you and the audio.</text>
        <text class="transcript-hidden-btn" @click="toggleTranscript">Show transcript</text>
      </view>
      <view id="section-words"><LessonWords :lesson="lesson" @locate="openKeyWord"/></view>
      <view v-if="hasFinished" class="completion-card"><text class="section-title">One listen closer.</text><text>Keep the momentum. Try a few questions while it is fresh.</text><text @click="audioStore.playFrom(0)" class="again">Listen again ↻</text></view>
      <view id="section-practice"><StudyPractice :lesson="lesson" /></view>
    </view>
    <view v-else class="empty">
      <text>{{loadError || 'Opening your lesson…'}}</text><button v-if="loadError" @click="loadLessonPage">Try again</button>
    </view>

    <!-- Compact reading player: visible only after the inline player leaves the screen. -->
    <view v-if="lesson && dockVisible && !isShadowing" class="reading-player">
      <slider class="reading-progress" aria-label="Audio progress" :value="sliderValue" :max="Math.max(1,audioStore.duration)" :step=".1" block-size="14" block-color="#ffcf00" activeColor="#ffcf00" backgroundColor="#564172" @changing="onSliderChanging" @change="onSliderChange"/>
      <view class="reading-controls"><button class="reading-follow" :class="{active:autoScroll}" :aria-pressed="autoScroll" aria-label="Auto scroll" @click="autoScroll=!autoScroll"><image :src="'/static/player-icons/'+(autoScroll?'active':'white')+'/follow.png'"/></button><button class="reading-skip" aria-label="Rewind 5 seconds" @click="seekRelative(-5)"><image src="/static/player-icons/white/back5.png"/></button><button class="reading-play" :aria-label="isThisLessonLoading?'Loading audio':isThisLessonPlaying?'Pause':'Play'" @click="onTogglePlay"><PlaybackGlyph :loading="isThisLessonLoading" :playing="isThisLessonPlaying" :size="32"/></button><button class="reading-skip" aria-label="Forward 5 seconds" @click="seekRelative(5)"><image src="/static/player-icons/white/forward5.png"/></button><button class="reading-speed" aria-label="Playback speed" @click="chooseSpeed">{{audioStore.speed}}×</button></view>
    </view>

    <!-- Practice面板：开启Practice后替换底部控制条 -->
    <view v-if="lesson && isShadowing" class="shadow-panel">
      <view class="shadow-top">
        <view class="shadow-status-wrap">
          <text class="shadow-status">
            {{ shadowIndex + 1 }} / {{ flatSentences.length }} · Round {{ currentRepeat }}{{ focusLoop ? '' : ' / ' + repeatTimes }} · {{ gapActive ? 'Your turn' : (isThisLessonPlaying ? 'Playing' : 'Paused') }}
          </text>
          <canvas v-if="gapActive" canvas-id="gapRing" style="width:32px;height:32px" class="gap-ring" />
        </view>
        <text class="shadow-exit" @click="exitShadowing">Exit practice</text>
      </view>
      <slider
        class="shadow-slider"
        :value="sliderValue"
        :max="audioStore.duration"
        :step="1"
        block-size="12"
        activeColor="#d8ef92"
        block-color="#d8ef92"
        backgroundColor="rgba(255,255,255,0.3)"
        @changing="onSliderChanging"
        @change="onSliderChange"
      />
      <view class="shadow-controls">
        <image class="shadow-icon" src="/static/prev-white.png" @click="onShadowPrev" />
        <view class="shadow-btn-main" @click="onShadowToggle">
          <PlaybackGlyph :loading="isThisLessonLoading && !gapActive" :playing="!gapActive && isThisLessonPlaying" :size="36"/>
        </view>
        <image class="shadow-icon" src="/static/next-white.png" @click="onShadowNext" />
      </view>
      <view class="shadow-group"><text class="shadow-chip" @click="showShadowSettings=!showShadowSettings">{{showShadowSettings?'Hide options':'Practice options'}}</text><text class="shadow-chip" @click="chooseSpeed">Speed {{audioStore.speed}}×</text></view>
      <view v-if="showShadowSettings" class="shadow-group">
        <text class="shadow-label">Mode</text>
        <text class="shadow-chip" :class="{ active: shadowMode === 'shadow' }" @click="shadowMode = 'shadow'">Speak along</text>
        <text class="shadow-chip" :class="{ active: shadowMode === 'repeat' }" @click="shadowMode = 'repeat'">Listen & repeat</text>
      </view>
      <view v-if="showShadowSettings" class="shadow-group">
        <text class="shadow-label">Repeats</text>
        <text v-for="n in [1, 2, 3]" :key="n" class="shadow-chip" :class="{ active: repeatTimes === n }" @click="setRepeatTimes(n)">{{ n }}</text>
        <text class="shadow-label">Pause</text>
        <text v-for="p in [1, 1.5, 2]" :key="p" class="shadow-chip" :class="{ active: pauseRate === p }" @click="pauseRate = p">{{ p }}x</text>
      </view>
      <view v-if="showShadowSettings" class="shadow-group">
        <text class="shadow-chip" :class="{ active: loop }" @click="loop = !loop">Loop lesson</text>
        <text class="shadow-chip" :class="{ active: focusLoop }" @click="toggleFocusLoop">Loop sentence</text>
      </view>
      <text v-if="showShadowSettings" class="shadow-description">Speak along with the audio, or leave a pause after each sentence to repeat it.</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import CoverImage from '@/components/CoverImage.vue';
import SentenceProgress from '@/components/SentenceProgress.vue';
import { cachedCover, localCover, loadCoverSources, invalidateCover } from '@/utils/cover';
import {readableTitle,TOPICS} from '@/utils/catalogue';
import { AUDIO_WAVEFORMS } from '@/utils/audio-waveforms';
import PlaybackGlyph from '@/components/PlaybackGlyph.vue';
import LessonWords from '@/components/LessonWords.vue';
import StudyPractice from '@/components/StudyPractice.vue';
import { useLearningStore } from '@/stores/learning';
import { studyContent, studyError } from '@/utils/api';
import { ref, computed, watch, nextTick, getCurrentInstance } from 'vue';
import { onLoad, onUnload, onHide, onPageScroll, onShareAppMessage, onShareTimeline } from '@dcloudio/uni-app';
import { useAudioStore } from '@/stores/audio';
import { useVocabStore } from '@/stores/vocab';
import { lessons } from '@/mock/lessons';
import { lookupVocab } from '@/mock/vocab';
import { formatTime } from '@/utils/format';
import type { Lesson, LessonSentence } from '@/types/lesson';
const instance = getCurrentInstance();

/** 渲染用词：一个可点、可高亮的词；生词带角标序号 */
interface WordSpan {
  text: string;
  startTime: number;
  endTime: number;
  vocabNo?: number;
  globalWordIndex: number;
}

/** 渲染用句子：原句子 + 全课统一的全局下标 + 按词切分结果 */
interface ProcessedSentence {
  sentence: LessonSentence;
  globalIndex: number;
  words: WordSpan[];
}

/** 渲染用段落 */
interface ProcessedParagraph {
  heading?: string;
  translation: string;
  sentences: ProcessedSentence[];
}

/** 角标字符：生词序号 1–5 */
const learning = useLearningStore();
learning.load();
const showSettings = ref(false),
  showShadowSettings = ref(false),
  autoScroll = ref(learning.preferences.autoScroll),
  showTranslation = ref(false),
  fontSize = ref(learning.preferences.fontSize),
  compact = ref(learning.preferences.compact),
  showVocab = ref(learning.preferences.showVocab);
let manualScrollUntil = 0,
  pageAlive = true,
  lessonId = '',
  pageLoadVersion = 0;
const translationErrors=ref<Record<number,string>>({});
const loadError = ref(''),
  hasFinished = ref(false),
  translations = ref<Record<number, string>>({}),
  translationBusy = ref(-1),
  favBusy = ref(false);
watch([autoScroll, showTranslation, fontSize, compact, showVocab], () => learning.preference({
  autoScroll: autoScroll.value,
  showTranslation: showTranslation.value,
  fontSize: fontSize.value,
  compact: compact.value,
  showVocab: showVocab.value
}));
function chooseSpeed() {
  const speeds = [.5, .75, 1, 1.25, 1.5, 2];
  uni.showActionSheet({
    itemList: speeds.map(n => n + '×' + (n === audioStore.speed ? ' · Current' : '')),
    success: r => audioStore.setSpeed(speeds[r.tapIndex])
  });
}
function goReview() {
  uni.navigateTo({
    url: '/pages/profile/vocab'
  });
}
function toggleTranslation() {
  showTranslation.value = !showTranslation.value;
  if (showTranslation.value) {
    const idx = Math.max(0, currentSentenceIndex.value);
    for (const p of processedParagraphs.value) {
      const s = p.sentences.find(s => s.globalIndex === idx);
      if (s) translateSentence(s);
    }
  }
}
async function translateSentence(item: ProcessedSentence) {
  if (translations.value[item.globalIndex] || translationBusy.value >= 0) return;
  const original = item.sentence.translation;
  if (original) {
    translations.value = {
      ...translations.value,
      [item.globalIndex]: original
    };
    return;
  }
  translationBusy.value = item.globalIndex;
  translationErrors.value={...translationErrors.value,[item.globalIndex]:''};
  try {
    const r = await studyContent(lesson.value!.id, 'translation', {
      index: item.globalIndex
    });
    if (pageAlive) {
      translations.value = {
        ...translations.value,
        [item.globalIndex]: r.translation
      };
      try {
        uni.setStorageSync(translationCacheKey(lesson.value!), translations.value);
      } catch {}
    }
  } catch (e) {
    translationErrors.value={...translationErrors.value,[item.globalIndex]:studyError(e)};
    uni.showToast({
      title: studyError(e),
      icon: 'none',
      duration: 2500
    });
  } finally {
    translationBusy.value = -1;
  }
}
function translationCacheKey(item:Lesson){return 'translations_'+item.id+(item.contentVersion?'_'+item.contentVersion:'')}
function openKeyWord(text: string) {
  activeSection.value='Transcript';
  hideTranscript.value=false;
  const w = flatWords.value.find(w => w.text.toLowerCase().replace(/[^a-z']/g, '') === text.toLowerCase());
  if (w) {
    const idx = flatSentences.value.findIndex(s => w.startTime >= s.startTime && w.startTime < s.endTime);
    scrollToSentence(idx);
    setTimeout(() => {
      if (pageAlive) openVocabPopup(w);
    }, 350);
  }
}
const audioStore = useAudioStore();
const lesson = ref<Lesson | null>(null);
const lessonCover=ref('');
const articleTopic=computed(()=>TOPICS.find(t=>t.key===lesson.value?.topic)?.label||'ENGLISH LISTENING');
let coverAttempts=0;
async function resolveLessonCover(cover:string){
 if(!cover)return;
 const id=lesson.value?.id;
 lessonCover.value=cachedCover(cover)||localCover();
 await loadCoverSources([cover],(_key,source)=>{if(pageAlive && lesson.value?.id===id)lessonCover.value=source});
}
function onLessonCoverError(){
 const cover=lesson.value?.cover;
 if(!cover?.startsWith('cloud://') || coverAttempts++>=1){lessonCover.value=localCover();return}
 invalidateCover(cover);void resolveLessonCover(cover);
}

// Hide transcript：听力时藏起原文只听不看；pill 跟原文一起藏（它要锚在句首词上），播放/Practice/控制条照常可用
const hideTranscript = ref(false);
// 底部控制条默认Hide为圆形按钮，点击Show为完整控制条；无Hide按钮，Show后无操作自动收回
const barExpanded = ref(false);
const dockVisible=ref(false);
const activeSection=ref('Transcript');
function jumpSection(section:string){
 activeSection.value=section;
 if(section==='Transcript')hideTranscript.value=false;
 nextTick(()=>{const selector=section==='Transcript'?'#article':section==='Words'?'#section-words':'#section-practice';uni.pageScrollTo({selector,offsetTop:-62,duration:260});});
}
const inlinePlayerBottom=ref(360);
watch(lesson,()=>nextTick(()=>{uni.createSelectorQuery().select('.inline-player').boundingClientRect().exec((res:any)=>{if(res?.[0])inlinePlayerBottom.value=res[0].bottom;});}));
let lastPillSync = 0;
onPageScroll(event=>{
 dockVisible.value=event.scrollTop>inlinePlayerBottom.value;
 // 滚动会改变句首与吸顶标签栏的相对位置，节流重算 pill 的挂载位置与可见性
 if(pillKind.value && Date.now()-lastPillSync>120){lastPillSync=Date.now();updatePillPosition();}
});
// Show后无操作自动收回的等待时长（毫秒）
const BAR_AUTO_COLLAPSE_MS = 5000;
let collapseTimer: ReturnType<typeof setTimeout> | null = null;

/** 清除自动收回计时器 */
function clearCollapseTimer() {
  if (collapseTimer) {
    clearTimeout(collapseTimer);
    collapseTimer = null;
  }
}

/** Show后有操作时刷新自动收回计时（仅普通控制条Show、且暂停时有效；Playing不Hide） */
function pokeBar() {
  barExpanded.value = true;
  clearCollapseTimer();
}
function expandBar() {
  barExpanded.value = true;
  pokeBar();
}

/** 点Hide的圆形按钮：Show完整控制条；若当前未播放则开始/继续播放 */
function onCircleTap() {
  expandBar();
  if (!isThisLessonPlaying.value && !isThisLessonLoading.value) {
    onTogglePlay();
  }
}
const dockFocusIndex=ref(-1);
let dockRestarting=false;
const dockWaveform=computed(()=>{const key=/\/([a-f0-9]{12})\.mp3(?:\?|$)/.exec(lesson.value?.audioUrl || '')?.[1];return key ? AUDIO_WAVEFORMS[key] || [] : []});
const dockProgress=computed(()=>Math.min(100,Math.max(0,sliderValue.value/Math.max(1,audioStore.duration)*100)));
function seekRelative(delta:number){dockFocusIndex.value=-1;audioStore.seek(Math.max(0,Math.min(audioStore.duration,audioStore.rawCurrentTime+delta)));pokeBar()}
function toggleDockFocus(){
 if(dockFocusIndex.value>=0){dockFocusIndex.value=-1;return}
 const index=Math.max(0,currentSentenceIndex.value),sentence=flatSentences.value[index];
 if(!sentence)return;
 dockFocusIndex.value=index;void audioStore.playFrom(sentence.startTime);
}
// slider 拖动状态：拖动时用拖动值显示，避免 onTimeUpdate 把进度条抢回去
const isDragging = ref(false);
const dragValue = ref(0);

// ---------- Practice（Shadowing）Mode状态 ----------
// Practice与普通播放互斥：开启后底部控制条切换为Practice面板
const isShadowing = ref(false);
// PracticeMode：shadow 边听边Practice；repeat 播完一句先暂停Pause再播Next
const shadowMode = ref<'shadow' | 'repeat'>('shadow');
// Repeats重复遍数（1 / 2 / 3）与当前第几遍
const repeatTimes = ref(3);
const currentRepeat = ref(1);
// 停顿倍率：Repeat after Pause时长 = 当前句时长 × 该倍率（1x 刚好够读完这句，2x 为两倍）
const pauseRate = ref(1);
// Loop：播完最后一句回到第一句；Focus loop：只循环当前一句
const loop = ref(false);
const focusLoop = ref(false);
// 当前Practice句子的全局下标
const shadowIndex = ref(0);
// Pause等待状态：Repeat after 播完一句后暂停等待用户复述
const gapActive = ref(false);
// Pause结束时要跳到的句子下标
const pendingNext = ref(-1);
// Pause结束时要设到的遍数
const pendingRepeat = ref(-1);
// Pause计时器（普通变量即可，模板不需要它）
let gapTimer: ReturnType<typeof setTimeout> | null = null;
// Pause倒计时：Your turn pill 里的剩余秒数与面板倒计时环共用同一计时器
const gapRemainingMs = ref(0);
const gapTotalMs = ref(0);
let gapTicker: ReturnType<typeof setInterval> | null = null;

/** 画Practice面板里的Pause倒计时环（剩余时间占比的黄色圆弧；canvas 不可用时静默失败） */
function drawGapRing() {
  if (!gapActive.value || gapTotalMs.value <= 0) return;
  try {
    const ctx = uni.createCanvasContext('gapRing', instance?.proxy as any);
    ctx.clearRect(0, 0, 32, 32);
    ctx.beginPath();
    ctx.arc(16, 16, 12, 0, 2 * Math.PI);
    ctx.setStrokeStyle('rgba(255,255,255,0.25)');
    ctx.setLineWidth(4);
    ctx.stroke();
    const frac = gapRemainingMs.value / gapTotalMs.value;
    ctx.beginPath();
    ctx.arc(16, 16, 12, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * frac);
    ctx.setStrokeStyle('#d8ef92');
    ctx.setLineWidth(4);
    ctx.setLineCap('round');
    ctx.stroke();
    ctx.draw();
  } catch {
    // canvas 不可用时静默失败，pill 里的秒数倒计时仍可正常显示
  }
}

/** 启动Pause倒计时（每 200ms 刷新 pill 秒数与倒计时环） */
function startGapTicker(totalMs: number) {
  stopGapTicker();
  gapTotalMs.value = totalMs;
  gapRemainingMs.value = totalMs;
  const endAt = Date.now() + totalMs;
  drawGapRing();
  gapTicker = setInterval(() => {
    gapRemainingMs.value = Math.max(0, endAt - Date.now());
    drawGapRing();
  }, 200);
}

/** 停止Pause倒计时 */
function stopGapTicker() {
  if (gapTicker !== null) {
    clearInterval(gapTicker);
    gapTicker = null;
  }
  gapRemainingMs.value = 0;
  gapTotalMs.value = 0;
}
// 用户主动暂停标记：用于区分“自然播完”与“用户暂停”
const userPaused = ref(false);

// slider 显示值：拖动时用拖动值，否则用实际播放位置
const sliderValue = computed(() => isDragging.value ? dragValue.value : audioStore.currentTime);

// 当前课是否正在播放
const isThisLessonPlaying = computed(() => audioStore.playing && audioStore.currentLesson?.id === lesson.value?.id);

// 本课是否在加载音频（点播放后、真正出声前）：按钮转圈、词/句高亮冻结，避免"点了没反应"和光标空跑
const isThisLessonLoading = computed(() => audioStore.audioLoading && audioStore.currentLesson?.id === lesson.value?.id);
// 加载中冻结高亮下标（恢复后继续走）
const frozenWordIndex = ref(-1);
const frozenSentenceIndex = ref(-1);

// 全课句子按段落顺序摊平（用于当前句Follow与Previous / Next跳转）
const flatSentences = computed<LessonSentence[]>(() => lesson.value ? lesson.value.paragraphs.flatMap(p => p.sentences) : []);

// 当前播到的句子全局下标（用于高亮；用未取整的 rawCurrentTime，避免取整后点句先闪回Previous）
const currentSentenceIndex = computed(() => {
  if (isThisLessonLoading.value) return frozenSentenceIndex.value;
  const t = audioStore.displayTime;
  const idx = flatSentences.value.findIndex(s => t >= s.startTime && t < s.endTime);
  frozenSentenceIndex.value = idx;
  return idx;
});

// 句首状态 pill 挂在哪一句：Practice中以Practice句为准（Pause期间Practice句仍是刚播完的那句），
// 否则以当前播放句为准
const pillSentenceIndex = computed(() => isShadowing.value ? shadowIndex.value : currentSentenceIndex.value);

// pill 类型：turn Pause（轮到用户）/ listen Playing / paused 用户暂停（未开始播放时不显示）
const pillKind = computed<'turn' | 'listen' | 'paused' | ''>(() => {
  if (gapActive.value) return 'turn';
  if (isShadowing.value) return isThisLessonPlaying.value ? 'listen' : 'paused';
  if (isThisLessonPlaying.value) return 'listen';
  if (pillSentenceIndex.value >= 0 && audioStore.currentLesson?.id === lesson.value?.id && audioStore.rawCurrentTime > 0) {
    return 'paused';
  }
  return '';
});

// pill 文案：Your turn 带遍数与倒计时秒数
const pillText = computed(() => {
  if (pillKind.value === 'turn') {
    const secs = Math.ceil(gapRemainingMs.value / 1000);
    return `Your turn ${currentRepeat.value}/${repeatTimes.value} · ${secs}s`;
  }
  if (isShadowing.value) return `${isThisLessonLoading.value?'Loading…':isThisLessonPlaying.value?'Speak along':'Paused'} ${currentRepeat.value}/${repeatTimes.value}`;
  if (pillKind.value === 'listen') return 'Listening';
  if (pillKind.value === 'paused') return 'Paused';
  return '';
});

// 句子高亮下标：Pause期间Practice句仍是刚播完的那句，但播放位置已到Next开头，
// 若按播放位置算高亮会跳到Next，所以Pause期间以Practice句为准
const highlightSentenceIndex = computed(() => isShadowing.value ? shadowIndex.value : currentSentenceIndex.value);

// 悬浮 pill 的位置（相对 .article，单位 px，与 boundingClientRect 的单位一致；初始藏在屏外）
const pillTop = ref(-9999);
const pillLeft = ref(0);
// 句首上方被吸顶标签栏挡住时，改为把 pill 挂在句首下方
const pillBelow = ref(false);
// 锚点句完全滚到标签栏上方时，pill 不再有可显示的位置，直接隐藏
const pillHidden = ref(false);

// Repeats首词的全局词下标（用于Follow句首：词是单行元素，外框 left/top 即句首位置；
// 直接量句子外框会在多行时取到最左行的 x，不等于句首）
const sentenceFirstWordIndex = computed(() => {
  const arr: number[] = [];
  for (const para of processedParagraphs.value) {
    for (const s of para.sentences) {
      arr[s.globalIndex] = s.words.length > 0 ? s.words[0].globalWordIndex : -1;
    }
  }
  return arr;
});

/** 测量当前句首词的位置，把悬浮 pill 放到该句上方（句首对齐，可盖住上一行文字）；
   句首太靠右时按 pill 实测宽度做右钳制，左移贴边、不超出文章右边缘 */
function updatePillPosition() {
  if (!pillKind.value || pillSentenceIndex.value < 0) return;
  const firstWord = sentenceFirstWordIndex.value[pillSentenceIndex.value];
  if (firstWord === undefined || firstWord < 0) return;
  const query = uni.createSelectorQuery();
  query.select('#article').boundingClientRect();
  query.select('#w-' + firstWord).boundingClientRect();
  query.select('#pill').boundingClientRect();
  query.select('.lesson-sections').boundingClientRect();
  query.exec((res: any) => {
    const articleRect = res?.[0];
    const wordRect = res?.[1];
    const pillRect = res?.[2];
    const barRect = res?.[3];
    if (!articleRect || !wordRect) return;
    // 锚点句已整体滚到吸顶标签栏上方：上下都放不下，直接隐藏，避免出现半截胶囊；
    // 位置仍照常更新，保证滚回来时 pill 立刻落在正确位置
    pillHidden.value = !!(barRect && wordRect.bottom < barRect.bottom - 4);
    let left = wordRect.left - articleRect.left;
    if (pillRect) {
      const maxLeft = articleRect.width - pillRect.width - 4;
      if (left > maxLeft) left = Math.max(0, maxLeft);
    }
    pillLeft.value = left;
    // 句首上方空间不足（会钻进 sticky 标签栏被切掉半截）时，改挂到句首下方
    const pillHeight = pillRect?.height || 34;
    const barBottom = barRect?.bottom || 0;
    if (wordRect.top - 4 - pillHeight < barBottom + 4) {
      pillBelow.value = true;
      pillTop.value = wordRect.bottom - articleRect.top + 4;
    } else {
      pillBelow.value = false;
      // 默认 translateY(-100%) 顶到句首上方，再留 4px 空隙
      pillTop.value = wordRect.top - articleRect.top - 4;
    }
  });
}

// pill 目标句或状态变化时重新测量位置；刚出现时先藏到屏外，避免先闪在Previous的位置
watch([pillSentenceIndex, pillKind], ([, newKind], [, oldKind]) => {
  if (!newKind) return;
  if (!oldKind) pillTop.value = -9999;
  nextTick(() => updatePillPosition());
});

/** 点悬浮 pill：从该句开头开始播放 */
function onPillClick() {
  closeVocabPopup();
  if (pillSentenceIndex.value < 0) return;
  for (const para of processedParagraphs.value) {
    const item = para.sentences.find(s => s.globalIndex === pillSentenceIndex.value);
    if (item) {
      playSentence(item);
      return;
    }
  }
}

// 生词弹框：点带下划线的生词（仅首次出现带角标）弹出词性 + 中文翻译；
// 普通词点按仍是从句首播放，两者按词类型分流，不冲突
const vocabStore = useVocabStore();
vocabStore.load();
interface PopupWord {
  ready?: boolean;
  loading?: boolean;
  saveRequested?: boolean;
  error?: boolean;
  sentenceIndex?: number;
  example?: string;
  word: string;
  pos: string;
  meaningCn: string;
}
const popupWord = ref<PopupWord | null>(null);
const popupAnchor = ref(-1);
const popupTop = ref(-9999);
const popupLeft = ref(0);

/** 弹框里的词是否Saved（星星实心/空心） */
const isPopupSaved = computed(() => popupWord.value ? vocabStore.isSaved(popupWord.value.word) : false);

/** 点生词：打开弹框（不触发播放）；显示的词去掉句尾标点（如 closet. 显示为 closet），弹框位置随后实测 */
function openVocabPopup(word: WordSpan) {
  const wasOpen = popupWord.value !== null;
  const displayWord = word.text.replace(/[^a-zA-Z']/g, '');
  // 导入课先查课自带的生词释义（词库匹配时生成），没有再查官方词典
  const dict = (lesson.value as any)?.vocabDict as Record<string, {
    pos: string;
    meaningCn: string;
  }> | undefined;
  const candidate = dict && dict[displayWord.toLowerCase()] || lookupVocab(displayWord);
  const entry = candidate && !/[\u4e00-\u9fff]/.test(candidate.meaningCn) ? candidate : undefined;
  popupWord.value = {
    ready: !!entry,
    loading: !entry,
    word: displayWord,
    pos: entry?.pos ?? '',
    meaningCn: entry?.meaningCn ?? 'Looking up this word…',
    sentenceIndex: flatSentences.value.findIndex(s => word.startTime >= s.startTime && word.startTime < s.endTime),
    example: flatSentences.value.find(s => word.startTime >= s.startTime && word.startTime < s.endTime)?.text || ''
  };
  popupAnchor.value = word.globalWordIndex;
  // 刚打开时先藏到屏外，测好位置再显示，避免闪在旧位置
  if (!wasOpen) popupTop.value = -9999;
  nextTick(() => updatePopupPosition());
  if (!entry) void loadPopupMeaning();
}
let popupLookupVersion=0;
async function loadPopupMeaning(){
  if(!popupWord.value || !lesson.value)return;
  const version=++popupLookupVersion;
  const target=popupWord.value;
  const anchor=popupAnchor.value;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  target.loading=true; target.error=false;
  try{
    const result=await Promise.race([
      studyContent(lesson.value.id,'word',{word:target.word}),
      new Promise<never>((_,reject)=>{timeout=setTimeout(()=>reject(new Error('WORD_LOOKUP_TIMEOUT')),45000)})
    ]);
    if(!pageAlive || version!==popupLookupVersion || popupAnchor.value!==anchor || popupWord.value!==target)return;
    if(typeof result?.meaningCn!=='string' || !result.meaningCn.trim())throw new Error('INVALID_STUDY_CONTENT');
    target.pos=result.pos || ''; target.meaningCn=result.meaningCn; target.ready=true; target.loading=false;
    const saveRequested=target.saveRequested;target.saveRequested=false;
    if(saveRequested)onStarClick();
    nextTick(updatePopupPosition);
  }catch(e){
    if(!pageAlive || version!==popupLookupVersion || popupWord.value!==target)return;
    target.loading=false;target.ready=false;target.saveRequested=false;target.error=true;
    target.meaningCn='Could not load the meaning. Please try again.';
    console.warn('[word lookup]',e);
    nextTick(updatePopupPosition);
  }finally{if(timeout)clearTimeout(timeout)}
}
function retryPopupLookup(){
  if(!popupWord.value || popupWord.value.loading)return;
  popupWord.value.meaningCn='Looking up this word…';
  void loadPopupMeaning();
}

/** 测量锚点词与弹框尺寸，算出完整显示的位置：
 * 横向以词为中心、左右钳制在文章内；纵向优先放词上方，上方会顶出屏幕时改放词下方 */
function updatePopupPosition() {
  if (!popupWord.value || popupAnchor.value < 0) return;
  const query = uni.createSelectorQuery();
  query.select('#article').boundingClientRect();
  query.select('#w-' + popupAnchor.value).boundingClientRect();
  query.select('#wordPopup').boundingClientRect();
  query.exec((res: any) => {
    const articleRect = res?.[0];
    const wordRect = res?.[1];
    const popupRect = res?.[2];
    if (!articleRect || !wordRect || !popupRect) return;
    const center = wordRect.left - articleRect.left + wordRect.width / 2;
    const maxLeft = Math.max(0, articleRect.width - popupRect.width);
    popupLeft.value = Math.min(Math.max(0, center - popupRect.width / 2), maxLeft);
    const gap = 8;
    const aboveTop = wordRect.top - articleRect.top - popupRect.height - gap;
    const belowTop = wordRect.bottom - articleRect.top + gap;
    // 词上方剩余高度不够放弹框时改放下方（词靠近顶部时下方一定有空间）
    popupTop.value = wordRect.top - popupRect.height - gap < 0 ? belowTop : aboveTop;
  });
}

/** 关闭生词弹框 */
function closeVocabPopup() {
  popupWord.value = null;
  popupAnchor.value = -1;
}

/** 隐藏/Show transcript：隐藏时先关弹框；恢复显示后下一帧重测 pill 位置（原文重渲染后旧位置失效） */
function toggleTranscript() {
  hideTranscript.value = !hideTranscript.value;
  if (hideTranscript.value) {
    closeVocabPopup();
  } else {
    nextTick(() => updatePillPosition());
  }
}

/** 点星星：收藏/Cancel收藏当前词（弹框不关闭，星星即时变实心/空心） */
function onStarClick() {
  if (!popupWord.value || !lesson.value) return;
  if (!popupWord.value.ready) {
    if(popupWord.value.saveRequested)return;
    popupWord.value.saveRequested=true;
    if(!popupWord.value.loading){popupWord.value.meaningCn='Looking up this word…';void loadPopupMeaning()}
    return;
  }
  try {
    const nowSaved = vocabStore.toggle({
      word: popupWord.value.word,
      pos: popupWord.value.pos,
      meaningCn: popupWord.value.meaningCn,
      lessonId: lesson.value.id,
      lessonTitle: lesson.value.title,
      sentenceIndex: popupWord.value.sentenceIndex,
      example: popupWord.value.example
    });
    uni.showToast({
      title: nowSaved ? 'Added to your words' : 'Removed from your words',
      icon: 'none',
      duration: 1500
    });
  } catch {
    uni.showToast({
      title: 'Unable to save this word. Try again.',
      icon: 'none'
    });
  }
}

// Practice切句：用未取整的 rawCurrentTime 判断，避免取整带来的 1 秒延迟
watch(() => audioStore.rawCurrentTime, t => {
  const focused=flatSentences.value[dockFocusIndex.value];
  if(focused && !isShadowing.value && audioStore.playing && t>=focused.endTime-.02 && !dockRestarting){
    dockRestarting=true;void audioStore.playFrom(focused.startTime).finally(()=>{dockRestarting=false});
  }
  if (!isShadowing.value || gapActive.value || !audioStore.playing) return;
  const cur = flatSentences.value[shadowIndex.value];
  if (!cur) return;
  // 切句点 = 句末 + 0.3s 尾音缓冲：whisper 词边界偏紧，直接按 endTime 切会把末词尾音切掉
  // （2026-10-29 用户反馈 repeat-after 末词老读不完整）；不超过Next开头，避免吃掉Next
  let cutAt = cur.endTime + 0.3;
  const next = flatSentences.value[shadowIndex.value + 1];
  if (next) {
    cutAt = Math.min(cutAt, Math.max(cur.endTime, next.startTime - 0.05));
  }
  if (t >= cutAt) {
    advanceShadow();
  }
});

// 自然播完的兜底：最后一句 endTime 等于音频总时长时，onEnded 可能先于
// 最后一次 onTimeUpdate 到达 endTime；此时用播放停止信号补一次切句判断。
// （store 的 onEnded 特意不重置 rawCurrentTime，就是为了保留这个判断依据）
watch(() => audioStore.playing, playing => {
  if (playing) {
    userPaused.value = false;
    // Playing不Hide控制条
    clearCollapseTimer();
    return;
  }
  // 暂停后 5 秒Hide控制条（pokeBar 内部只在普通条Show时生效）
  pokeBar();
  if (!isShadowing.value || gapActive.value || userPaused.value) return;
  const sentences = flatSentences.value;
  const last = sentences[sentences.length - 1];
  if (!last || shadowIndex.value !== sentences.length - 1) return;
  if (audioStore.rawCurrentTime >= last.endTime - 0.6) {
    advanceShadow();
  }
});

// Practice句切换时自动滚动到该句
watch(shadowIndex, idx => {
  if (isShadowing.value) {
    scrollToSentence(idx);
  }
});

/**
 * 段落预处理：把Repeats英文切成 token，Vocabulary中的词在全课首次出现时做标记。
 * 生词释义等卡片内容属后续阶段，本阶段只做黄色标记 + 角标序号。
 */
const processedParagraphs = computed<ProcessedParagraph[]>(() => {
  if (!lesson.value) return [];
  const vocabMap = new Map<string, number>();
  (lesson.value.vocabWords ?? []).slice(0, 12).forEach((word, index) => {
    vocabMap.set(word.toLowerCase(), index + 1);
  });
  const marked = new Set<string>();
  let globalIndex = 0;
  let globalWordIndex = 0;
  return lesson.value.paragraphs.map(para => ({
    heading: para.heading,
    translation: para.sentences.map(s => s.translation ?? '').join(''),
    sentences: para.sentences.map(sentence => ({
      sentence,
      globalIndex: globalIndex++,
      words: buildWords(sentence, vocabMap, marked, () => globalWordIndex++)
    }))
  }));
});

/** 全课按顺序排好的词（用于当前词高亮查找） */
const flatWords = computed<WordSpan[]>(() => processedParagraphs.value.flatMap(p => p.sentences.flatMap(s => s.words)));

/** 当前朗读到的词全局下标（用于单词高亮；用未取整时间，Follow精确到词） */
const currentWordIndex = computed(() => {
  if (isThisLessonLoading.value) return frozenWordIndex.value;
  const t = audioStore.displayTime;
  const found = flatWords.value.find(w => t >= w.startTime && t < w.endTime);
  const idx = found ? found.globalWordIndex : -1;
  frozenWordIndex.value = idx;
  return idx;
});

// 词高亮下标：Pause期间没有音频在读，不显示词高亮（否则会落在Next的第一个词上）
const highlightWordIndex = computed(() => gapActive.value ? -1 : currentWordIndex.value);

/** 把英文句子切成按词渲染的 WordSpan：优先用对齐实测的单词时间戳，
 * 缺省时按句内词长比例估算；生词首次出现时返回角标序号 */
function buildWords(sentence: LessonSentence, vocabMap: Map<string, number>, marked: Set<string>, nextIndex: () => number): WordSpan[] {
  const textWords = sentence.text.trim().split(/\s+/);
  const measured = sentence.words?.length === textWords.length ? sentence.words : undefined;
  const span = sentence.endTime - sentence.startTime;
  const totalChars = textWords.reduce((sum, w) => sum + w.length, 0) || 1;
  let t = sentence.startTime;
  return textWords.map((text, i) => {
    let startTime: number;
    let endTime: number;
    if (measured && measured[i]) {
      // 实测时间戳与文本词一一对应时直接采用
      startTime = measured[i].startTime;
      endTime = measured[i].endTime;
    } else {
      const dur = span * text.length / totalChars;
      startTime = t;
      endTime = i === textWords.length - 1 ? sentence.endTime : t + dur;
      t += dur;
    }
    // 生词匹配：去掉词尾标点再比对（如 "closet." 匹配 closet）
    const key = text.toLowerCase().replace(/[^a-z']/g, '');
    let vocabNo: number | undefined;
    if (vocabMap.has(key) && !marked.has(key)) {
      marked.add(key);
      vocabNo = vocabMap.get(key);
    }
    return {
      text,
      startTime,
      endTime,
      vocabNo,
      globalWordIndex: nextIndex()
    };
  });
}

// 进入页面：按 id 找课程；找不到则提示并返回
async function loadLessonPage() {
  const token = ++pageLoadVersion;
  loadError.value = '';
  try {
    let found = lessons.find(item => item.id === lessonId),
      url = '';
    if (!found) {
      const res: any = await wx.cloud.callFunction({
        name: 'importApi',
        data: {
          action: 'getLesson',
          lessonId
        }
      });
      found = res.result?.lesson;
      url = res.result?.audioTempUrl || '';
    }
    if (!pageAlive || token !== pageLoadVersion) return;
    if (!found) {
      loadError.value = 'This lesson is currently unavailable';
      return;
    }
    try{const meta=(uni.getStorageSync('catalogueV2')||[]).find((c:any)=>c.id===found!.id);if(meta)found={...found,level:found.level||meta.level,topic:found.topic||meta.topic,cover:found.cover||meta.cover}}catch{}
    lesson.value = found;
    resolveLessonCover(found.cover);

    if (url) audioStore.primeLessonSrc(found.id, url);
    audioStore.loadLesson(found);
    audioStore.warmLesson(found);
    refreshFavored();
    try {
      translations.value = uni.getStorageSync(translationCacheKey(found)) || {};
    } catch {}
    if (initialSentence >= 0) {
      const target = flatSentences.value[initialSentence];
      if (target) {
        audioStore.seek(target.startTime);
        scrollToSentence(initialSentence);
      }
    }
    vocabStore.sync();
  } catch {
    if (pageAlive) loadError.value = 'Unable to load this lesson. Check your connection.';
  }
}
let initialSentence = -1;
onLoad((options: any) => {
  lessonId = String(options?.id || '');
  initialSentence = Number.isFinite(Number(options?.sentence)) ? Number(options.sentence) : -1;
  loadLessonPage();
});
onShareAppMessage(() => ({
  title: lesson.value?.title || 'Listen with ListEnglish',
  path: '/pages/lesson/detail?id=' + encodeURIComponent(lessonId)
}));
onShareTimeline(() => ({
  title: lesson.value?.title || 'Listen with ListEnglish',
  query: 'id=' + encodeURIComponent(lessonId)
}));
watch(currentSentenceIndex, idx => {
  if (idx >= 0 && audioStore.playing && autoScroll.value && activeSection.value==='Transcript' && !isShadowing.value && Date.now() > manualScrollUntil) scrollToSentence(idx);
});
watch(() => audioStore.endedCount, () => {
  hasFinished.value = true;
});
onHide(() => {
  userPaused.value = true;
  clearGapTimer();
  audioStore.pause();
});

// 收藏
const favored = ref(false);
async function refreshFavored() {
  const id = lesson.value && lesson.value.id;
  if (!id) return;
  try {
    const r: any = await wx.cloud.callFunction({
      name: 'userApi',
      data: {
        action: 'isFavored',
        lessonId: id
      }
    });
    favored.value = !!(r.result && r.result.favored);
  } catch {}
}
async function onToggleFav() {
  const l = lesson.value;
  if (!l || favBusy.value) return;
  favBusy.value = true;
  try {
    const r: any = await wx.cloud.callFunction({
      name: 'userApi',
      data: {
        action: 'setFavorite',
        favored: !favored.value,
        lessonId: l.id,
        title: l.title || '',
        cover: (l as any).cover || '',
        level: (l as any).level || '',
        source: (l as any).source || '',
        duration: (l as any).duration || 0
      }
    });
    favored.value = !!(r.result && r.result.favored);
    uni.showToast({
      title: favored.value ? 'Saved' : 'Removed from saved lessons',
      icon: 'none'
    });
  } catch (e: any) {
    const msg = String(e && (e.errMsg || e.message) || '');
    console.warn('[favorite]', msg);
    uni.showToast({
      title: 'Unable to complete this action. Try again.',
      icon: 'none'
    });
  } finally {
    favBusy.value = false;
  }
}

// 播放 / 暂停
function onTogglePlay() {
  if (!lesson.value) return;
  if (audioStore.currentLesson?.id === lesson.value.id) {
    audioStore.toggle();
  } else {
    audioStore.playLesson(lesson.value);
  }
  if(dockVisible.value)pokeBar();
}

// 确保当前课已设为播放源（未设时先 playLesson 再跳转）
function ensurePlaying() {
  if (!lesson.value) return false;
  if (audioStore.currentLesson?.id !== lesson.value.id) {
    audioStore.playLesson(lesson.value);
  }
  return true;
}

// 点击句子：跳转到该句开始时间并播放；Practice中则Speak along下标并清除Pause计时器
/** 从指定句开头开始播放（PracticeMode下同时把Practice句切到该句） */
function playSentence(item: ProcessedSentence) {
  if (!ensurePlaying()) return;
  if (isShadowing.value) {
    clearGapTimer();
    shadowIndex.value = item.globalIndex;
    currentRepeat.value = 1;
  }
  audioStore.playFrom(item.sentence.startTime);
}

/** 点词：从该词所在的句开头开始播放 */
function onWordClick(word: WordSpan, _item: ProcessedSentence) {
  openVocabPopup(word);
}

// Previous：跳到Previous开始时间并播放
function onPrevSentence() {
  closeVocabPopup();
  const idx = currentSentenceIndex.value;
  const target = flatSentences.value[idx <= 0 ? 0 : idx - 1];
  if (!target || !ensurePlaying()) return;
  audioStore.playFrom(target.startTime);
  pokeBar();
}

// Next：跳到Next开始时间并播放
function onNextSentence() {
  closeVocabPopup();
  const idx = currentSentenceIndex.value;
  const target = flatSentences.value[idx < 0 ? 0 : Math.min(idx + 1, flatSentences.value.length - 1)];
  if (!target || !ensurePlaying()) return;
  audioStore.playFrom(target.startTime);
  pokeBar();
}

// Follow：跳转到正在朗读的句子位置（只滚动页面，不改变播放）
function onLocateCurrent() {
  if (!lesson.value) return;
  const t = audioStore.displayTime || audioStore.currentTime;
  let idx = flatSentences.value.findIndex(s => t >= s.startTime && t < s.endTime);
  if (idx < 0) {
    idx = flatSentences.value.findIndex(s => s.endTime > t);
    if (idx < 0) idx = flatSentences.value.length - 1;
  }
  if (idx < 0) return;
  scrollToSentence(idx);
  pokeBar();
}

// slider 拖动中
function onSliderChanging(e: any) {
  isDragging.value = true;
  dragValue.value = e.detail.value;
  pokeBar();
}

// slider 拖动结束：跳转播放位置；Practice中则清除Pause计时器并把Practice下标同步到拖动位置
function onSliderChange(e: any) {
  isDragging.value = false;
  const target = e.detail.value;
  const focus=flatSentences.value[dockFocusIndex.value];
  if(focus && (target<focus.startTime || target>=focus.endTime))dockFocusIndex.value=-1;
  audioStore.seek(target);
  if (isShadowing.value) {
    clearGapTimer();
    const idx = flatSentences.value.findIndex(s => target >= s.startTime && target < s.endTime);
    shadowIndex.value = idx >= 0 ? idx : flatSentences.value.length - 1;
    currentRepeat.value = 1;
  }
  pokeBar();
}

// ---------- Practice（Shadowing）状态机 ----------

/** 清除Pause计时器（手动拖动、点句跳转、暂停、Exit practice、页面卸载时调用） */
function clearGapTimer() {
  if (gapTimer !== null) {
    clearTimeout(gapTimer);
    gapTimer = null;
  }
  gapActive.value = false;
  pendingNext.value = -1;
  pendingRepeat.value = -1;
  stopGapTicker();
}

/**
 * Practice推进：当前句播完时调用（由 rawCurrentTime watch 或自然播完兜底触发）。
 * 先决定下一步：Focus loop（只循环当前句）→ 未播满遍数（重播当前句）→
 * 播满遍数（Next；到末尾时 Loop 回第一句，否则停住）。
 * Repeat after Mode下，每播完一遍都先暂停Pause（当前句时长 × 停顿倍率）再继续，
 * 即：播一遍 → 停顿 → 再播一遍 → 停顿 → Next；Shadow Mode直接播，不停顿。
 */
function advanceShadow() {
  if (!isShadowing.value || gapActive.value) return;
  const sentences = flatSentences.value;
  const cur = sentences[shadowIndex.value];
  if (!cur) return;
  // 决定下一步与下一遍的遍数（Pause结束时才生效，Pause期间面板仍显示刚播完的那一遍）
  let targetIndex: number;
  let targetRepeat: number;
  if (focusLoop.value) {
    // Focus loop：只循环当前一句（遍数计数继续累加显示）
    targetIndex = shadowIndex.value;
    targetRepeat = currentRepeat.value + 1;
  } else if (currentRepeat.value < repeatTimes.value) {
    // 未播满遍数：重播当前句
    targetIndex = shadowIndex.value;
    targetRepeat = currentRepeat.value + 1;
  } else {
    // 播满遍数：到Next
    const isLast = shadowIndex.value >= sentences.length - 1;
    if (isLast && !loop.value) {
      // 播完且不循环：停住，保持在最后一句，面板显示Paused
      if (shadowMode.value === 'shadow') {
        userPaused.value = true;
        audioStore.pause();
        hasFinished.value = true;
        return;
      }
      targetIndex = -1;
      targetRepeat = 1;
    } else {
      targetIndex = isLast ? 0 : shadowIndex.value + 1;
    }
    targetRepeat = 1;
  }
  if (shadowMode.value === 'repeat') {
    // Repeat after：先暂停Pause，再重播当前句或播Next
    audioStore.pause();
    gapActive.value = true;
    pendingNext.value = targetIndex;
    pendingRepeat.value = targetRepeat;
    const gapMs = Math.round((cur.endTime - cur.startTime) * 1000 * pauseRate.value / audioStore.speed);
    startGapTicker(gapMs);
    gapTimer = setTimeout(() => {
      gapActive.value = false;
      gapTimer = null;
      stopGapTicker();
      if (!isShadowing.value) return;
      const nextIndex = pendingNext.value;
      const nextRepeat = pendingRepeat.value;
      pendingNext.value = -1;
      pendingRepeat.value = -1;
      if (nextIndex < 0) {
        hasFinished.value = true;
        userPaused.value = true;
        return;
      }
      shadowIndex.value = nextIndex;
      currentRepeat.value = nextRepeat;
      const target = flatSentences.value[nextIndex];
      if (target) {
        audioStore.playFrom(target.startTime);
      }
    }, gapMs);
  } else {
    // Shadow：直接播Next / 重播当前句
    shadowIndex.value = targetIndex;
    currentRepeat.value = targetRepeat;
    audioStore.playFrom(sentences[targetIndex].startTime);
  }
}

/** 进入Practice：Follow到当前播放位置所在的句子；正在播放时从该句开头重播 */
function showShadowHelp(){uni.showModal({title:'Shadowing',content:'Listen and speak at the same time. Each sentence repeats three times by default. The ring follows the sentence audio and pauses when playback pauses. Change repeats or try Listen & repeat in Settings.',showCancel:false,confirmText:'Got it'})}
function enterShadowing() {
  if (!lesson.value) return;
  clearGapTimer();
  clearCollapseTimer();
  userPaused.value = false;
  const t = audioStore.displayTime || audioStore.currentTime;
  const idx = flatSentences.value.findIndex(s => t >= s.startTime && t < s.endTime);
  shadowIndex.value = idx >= 0 ? idx : 0;
  currentRepeat.value = 1;
  isShadowing.value = true;
  hideTranscript.value = false;
  dockFocusIndex.value = -1;
  scrollToSentence(shadowIndex.value);
  const target = flatSentences.value[shadowIndex.value];
  if (target) {
    if(audioStore.currentLesson?.id!==lesson.value.id)audioStore.loadLesson(lesson.value);
    void audioStore.playFrom(target.startTime);
  }
}

/** Exit practice：回到普通播放Mode，音频保持当前播放 / 暂停状态不变 */
function exitShadowing() {
  clearGapTimer();
  isShadowing.value = false;
  userPaused.value = false;
  pokeBar();
}

/** Practice中手动切句：清除Pause计时器，从目标句开始播放 */
function jumpShadowTo(index: number) {
  const target = flatSentences.value[index];
  if (!target || !ensurePlaying()) return;
  clearGapTimer();
  shadowIndex.value = index;
  currentRepeat.value = 1;
  audioStore.playFrom(target.startTime);
}

/** Practice面板：Previous */
function onShadowPrev() {
  closeVocabPopup();
  jumpShadowTo(shadowIndex.value <= 0 ? 0 : shadowIndex.value - 1);
}

/** Practice面板：Next */
function onShadowNext() {
  closeVocabPopup();
  jumpShadowTo(Math.min(shadowIndex.value + 1, flatSentences.value.length - 1));
}

/**
 * Practice面板播放 / 暂停（复用 audioStore.toggle 的语义，另处理两种特殊情况）：
 * Pause等待中按播放 = 跳过等待直接播下一步（重播当前句或Next）；
 * 暂停中按播放时，若当前位置已不在当前句范围内，从当前句开头重播，否则从中断处继续。
 */
function onShadowToggle() {
  if (!lesson.value) return;
  if (gapActive.value) {
    const next = pendingNext.value;
    const nextRepeat = pendingRepeat.value;
    clearGapTimer();
    if (next < 0) {
      hasFinished.value = true;
      userPaused.value = true;
      return;
    }
    shadowIndex.value = next;
    currentRepeat.value = nextRepeat > 0 ? nextRepeat : 1;
    const target = flatSentences.value[next];
    if (target) {
      ensurePlaying();
      audioStore.playFrom(target.startTime);
    }
    return;
  }
  if (audioStore.playing) {
    userPaused.value = true;
    audioStore.toggle();
    return;
  }
  userPaused.value = false;
  if (!ensurePlaying()) return;
  const cur = flatSentences.value[shadowIndex.value];
  if (!cur) return;
  const t = audioStore.rawCurrentTime;
  if (t < cur.startTime || t >= cur.endTime) {
    audioStore.playFrom(cur.startTime);
  } else {
    audioStore.toggle();
  }
}

/** 设置Repeats重复遍数（切换后当前遍数归 1） */
function setRepeatTimes(n: number) {
  repeatTimes.value = n;
  currentRepeat.value = 1;
}

/** 切换 Focus loop（切换后当前遍数归 1） */
function toggleFocusLoop() {
  focusLoop.value = !focusLoop.value;
  currentRepeat.value = 1;
}

/**
 * 自动滚动到指定句子：句子元素带 id（s-全局下标），用 selectorQuery 取位置后滚动，
 * 顶部留出 200rpx，避免句子贴到屏幕顶缘。
 */
function scrollToSentence(index: number) {
  nextTick(() => {
    const query = uni.createSelectorQuery();
    query.selectViewport().scrollOffset();
    query.select(`#s-${index}`).boundingClientRect();
    query.exec((res: any) => {
      const viewport = res?.[0];
      const rect = res?.[1];
      if (!viewport || !rect) return;
      const offset = 200 * uni.getWindowInfo().windowWidth / 750;
      uni.pageScrollTo({
        scrollTop: Math.max(0, viewport.scrollTop + rect.top - offset),
        duration: 300
      });
    });
  });
}

// 页面卸载时：停止播放 + 清除Pause计时器和自动收回计时器，避免后台回调错乱
onUnload(() => {
  pageAlive = false;
  pageLoadVersion++;
  userPaused.value = true;
  audioStore.stop();
  clearGapTimer();
  clearCollapseTimer();
});
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

.fav-btn { font-size: 26rpx; color: #77877b; margin-left: auto; padding: 8rpx 4rpx; }
.transcript-toggle-row {
  margin-top: 12rpx;
  display: flex;
  align-items: center;
}

.transcript-toggle {
  font-size: 26rpx;
  color: #edf1e8;
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
  color: #edf1e8;
  padding: 16rpx 40rpx;
  border: 2rpx solid #edf1e8;
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
   绝对Follow在句首上方（可盖住上一行文字），不占行内位置，句子不再因 pill 长度变化而移位 */
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
  background-color: #203b31;
  color: #ffffff;
}
.status-pill-turn {
  background-color: #d8ef92;
  color: #203b31;
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
  color: #edf1e8;
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
  background-color: #d8ef92;
  border-radius: 6rpx;
}

/* 生词：只改字色 + 下划线，不填充底色 */
.vocab {
  color: #edf1e8;
  text-decoration: underline;
}

.vocab-sup {
  font-size: 20rpx;
  color: #77877b;
  text-decoration: none;
}

/* 底部默认圆形控制：点击Show为完整控制条 */
/* 底部默认圆形控制：本身 98rpx，6rpx 深色边框往外加 12rpx，外径正好 110rpx，与Show条同高 */
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
  background-color: #d8ef92;
  border: 6rpx solid #203b31;
  border-radius: 50%;
  box-shadow: 0 8rpx 32rpx rgba(0, 0, 0, 0.35);
  z-index: 99;
}

.player-circle-icon {
  width: 60rpx;
  height: 60rpx;
}





/* 底部悬浮控制条：页面底部居中，占页面宽度的三分之二；进度条贴在模块底边、左右留边；条高约 110rpx，与Hide圆钮同高 */
.player-bar {
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  bottom: 28rpx;
  bottom: calc(28rpx + env(safe-area-inset-bottom));
  width: 84%;
  padding: 22rpx 20rpx;
  background-color: #203b31;
  border-radius: 999rpx;
  box-shadow: 0 8rpx 32rpx rgba(0, 0, 0, 0.25);
  z-index: 99;
}

/* 进度条：绝对Follow贴在模块底边上，左右各留 24rpx，不占模块高度 */
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

/* 左右两组各占一半空间，把播放键夹在条的正中：条本身居中，所以播放键中心与Hide圆钮中心完全重合，ShowHide时黄键不跳动 */
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

/* Speed展示：v1.4 起Speed切换下线，这里仅静态展示固定 1X，不可点击 */
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
  position: relative;
  width: 120rpx;
  height: 120rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: #d8ef92;
  border-radius: 50%;
}






.bar-btn-main-icon {
  width: 54rpx;
  height: 54rpx;
}


/* Practice入口：图标按钮（Material record_voice_over，金色） */
.bar-shadow-icon {
  width: 48rpx;
  height: 48rpx;
}

/* Follow入口：准星图标（自绘粗线条图片，与Practice图标同尺寸同色），点它跳回正在朗读的句子 */
.bar-locate-icon {
  width: 48rpx;
  height: 48rpx;
}

/* Practice面板比控制条高，容器底部多留空间，避免最后一段被遮住 */
.container-shadow {
  padding-bottom: 620rpx;
}

/* Practice面板：底部通栏深色面板，替换底部悬浮控制条 */
.shadow-panel {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 20rpx 28rpx calc(20rpx + env(safe-area-inset-bottom));
  background-color: #203b31;
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

/* Practice面板上一曲 / 下一曲图标（白色图片） */
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
  background-color: #d8ef92;
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
  background-color: #d8ef92;
  color: #203b31;
}

.empty {
  padding: 80rpx 0;
  text-align: center;
  font-size: 28rpx;
  color: #999999;
}
</style>

<style scoped>
.container{padding:30rpx 28rpx 330rpx;background:#f7f6f9}.eyebrow{font-size:20rpx;font-weight:700;letter-spacing:4rpx;color:#77877b;margin:10rpx 8rpx 20rpx}.header{padding:8rpx 8rpx 14rpx}.title{font-family:-apple-system,'PingFang SC',sans-serif;font-size:39rpx;line-height:1.35;color:#203b31}.meta{font-size:23rpx;color:#77877b;margin-top:20rpx}.reading-tools{display:flex;justify-content:space-between;padding:22rpx 8rpx;margin-bottom:24rpx;border-bottom:1rpx solid #e7e1ed;font-size:24rpx;color:#203b31}.reading-tools text{padding:8rpx 0}.reading-settings{padding:22rpx;background:#fff;border-radius:22rpx;margin-bottom:24rpx;color:#203b31;font-size:26rpx;line-height:2.4}.reading-settings text{padding:12rpx 18rpx}.reading-settings .selected{background:#fff1ac;border-radius:12rpx}.word{margin-right:0}.para{margin-bottom:32rpx}.sentence-translation{display:block;font-size:27rpx;line-height:1.7;color:#77877b;padding:12rpx 0 20rpx;font-family:-apple-system,sans-serif}.sentence-actions{font-size:22rpx;color:#77877b;margin-left:12rpx}.vocab-sup{font-size:16rpx;vertical-align:super}.bar-time{display:flex;justify-content:space-between;color:#dcd0ed;font-size:21rpx;padding:4rpx 16rpx}.bar-hints{display:flex;justify-content:space-around;font-size:19rpx;color:#edf1e8;padding-top:8rpx}.bar-hints text{padding:5rpx}.bar-speed{min-width:70rpx;text-align:center}.bar-controls{padding-top:4rpx}.player-bar{padding:12rpx 24rpx 18rpx;border-radius:34rpx;background:#203b31;box-shadow:0 12rpx 40rpx rgba(43,27,77,.18)}.shadow-panel{border-radius:28rpx 28rpx 0 0;background:#203b31}.shadow-description{display:block;color:#edf1e8;font-size:22rpx;line-height:1.6;margin-top:14rpx}.shadow-chip{font-size:23rpx}.container-shadow{padding-bottom:680rpx}.key-vocab{margin:40rpx 0;background:#fff;padding:30rpx;border-radius:28rpx;border:1rpx solid #eee9f3}.section-title{display:block;font-weight:700;font-size:33rpx;color:#203b31}.section-caption{display:block;font-size:24rpx;color:#77877b;line-height:1.7;margin:12rpx 0 22rpx}.key-vocab-list{display:flex;flex-wrap:wrap;gap:16rpx}.key-vocab-list>text{background:#f6f1fa;border-radius:15rpx;padding:16rpx 22rpx;color:#203b31;font-size:27rpx}.small-star{color:#a07a2e;margin-left:8rpx}.review-link{background:#fbf4cf;color:#68512f;font-size:26rpx;border-radius:18rpx;margin-top:24rpx}.review-link::after{border:0}.completion-card{display:flex;flex-direction:column;gap:18rpx;background:#fff6cd;padding:30rpx;border-radius:24rpx;font-size:26rpx;line-height:1.7;color:#776039}.again{color:#745224;font-weight:600}.empty button{margin:28rpx;background:#d8ef92;font-size:28rpx}.word-popup{box-sizing:border-box;max-width:100%}
</style>

<style scoped>

.container{background:#f8f9f5;min-height:100vh;padding:35rpx 32rpx calc(320rpx + env(safe-area-inset-bottom))}.eyebrow{color:#819072;letter-spacing:3rpx;font-size:17rpx;margin:12rpx 0 24rpx}.title{font-family:inherit;font-size:52rpx;font-weight:700;line-height:1.1;letter-spacing:-1.8rpx;color:#203b31}.title-cn{font-family:inherit;font-size:25rpx;color:#829078}.meta{font-size:21rpx;color:#8a977f;line-height:1.5;margin-top:22rpx}.transcript-toggle-row{margin-top:24rpx;padding:0}.transcript-toggle,.fav-btn{font-family:inherit;font-size:23rpx;color:#526f43}.reading-tools{border:0;background:#edf1e5;border-radius:15rpx;padding:19rpx 17rpx;margin:27rpx 0 38rpx;gap:14rpx;display:flex;justify-content:space-between}.reading-tools text{font-size:21rpx;color:#5e7352}.reading-settings{background:#fff;border:1rpx solid #e4eadb;border-radius:18rpx;color:#617651}.article{font-family:Georgia,'Times New Roman',serif;color:#344234}.para-heading{font-family:inherit;font-size:38rpx;line-height:1.3;font-weight:600;letter-spacing:-.8rpx;margin:38rpx 0 20rpx}.para-text{color:#344234}.vocab{color:#48673d;text-decoration-color:#b5c79a}.word-current{background:#e1ecbb;color:#203b31;border-radius:4rpx}.vocab-sup{color:#81966b;font-family:Arial,sans-serif}.sentence-actions{font-family:Arial,sans-serif;font-size:19rpx;color:#78925f;margin-left:9rpx}.sentence-translation{font-family:Arial,sans-serif;font-size:24rpx;line-height:1.65;color:#8a977e}.key-vocab{padding:28rpx;background:#eef2e6;border:0;border-radius:23rpx;margin-top:42rpx}.section-title{font-size:30rpx;color:#203b31;letter-spacing:-.5rpx}.section-caption{color:#849275;font-size:23rpx;line-height:1.6}.key-vocab-list>text{background:#fff;color:#506940;border:1rpx solid #e2e9d8;border-radius:12rpx;font-size:24rpx;padding:16rpx 18rpx}.small-star{color:#819760}.review-link{background:transparent;color:#526e42;font-size:24rpx;border:1rpx solid #cbd8bb;border-radius:14rpx}.player-bar,.shadow-panel{background:#203b31;border-radius:23rpx;left:28rpx;right:28rpx;width:auto;padding:21rpx 23rpx 20rpx;bottom:calc(18rpx + env(safe-area-inset-bottom));box-shadow:0 12rpx 40rpx rgba(28,50,35,.18)}.bar-controls{height:83rpx;margin:6rpx 0}.bar-btn-main{height:78rpx;width:78rpx;background:#d8ef92}.bar-btn-main-icon{height:33rpx;width:33rpx}.bar-time{font-size:19rpx;color:#b2c2a6}.bar-hints{font-size:17rpx;color:#b1c2a5;margin-top:11rpx}.bar-speed{background:#3d5744;font-size:23rpx;color:#e7eedf;border-radius:20rpx;min-width:72rpx;padding:12rpx 15rpx}.bar-shadow-icon,.bar-locate-icon{filter:grayscale(1) brightness(2);width:33rpx;height:33rpx}.bar-icon{width:29rpx;height:29rpx}.bar-side{gap:22rpx}.bar-slider{margin:0 5rpx}.word-popup{background:#fff;border:1rpx solid #dce6d1;border-radius:18rpx;box-shadow:0 15rpx 40rpx rgba(30,55,35,.12)}.word-popup-word{font-family:inherit;color:#203b31;font-size:32rpx}.word-popup-meaning{color:#6e7f60}.completion-card{border-radius:20rpx;background:#edf2df;color:#71835e}.transcript-hidden{padding:60rpx 25rpx;border:1rpx dashed #d1ddc4;border-radius:20rpx;color:#8c9b7e}

</style>
<style scoped>
.player-bar{transform:none;left:28rpx;right:28rpx;width:auto;max-width:none;margin:0}.bar-slider{position:static;transform:none;margin:0 4rpx;height:18rpx}.bar-speed{height:46rpx;line-height:46rpx;padding:0 13rpx}.bar-btn-main{flex:none}.para-text,.para-heading{font-family:Georgia,'Times New Roman',serif}.sentence.current{background:#eaf0de}.word-current{background:#d8e8b6}
</style>

<style scoped>

.container{background:#fff;padding-top:28rpx}.article-topic{display:inline-block;background:#ffcf00;color:#42351e;padding:10rpx 17rpx;font-size:18rpx;letter-spacing:.7rpx;font-weight:700;text-transform:uppercase;margin:0 0 22rpx}.header{padding:0}.title{font-family:ListHeading,'Arial Narrow',sans-serif;color:#1e1928;text-transform:uppercase;font-size:56rpx;line-height:1.03;letter-spacing:.2rpx}.meta{color:#93909c;font-size:22rpx;margin-top:20rpx}.transcript-toggle,.fav-btn{color:#796987;font-size:22rpx}.article-cover{width:100%;height:345rpx;border-radius:16rpx;margin:26rpx 0 27rpx}.inline-player{background:linear-gradient(120deg,#31165e,#140827);border-radius:19rpx;padding:26rpx 25rpx 22rpx;margin:0 0 25rpx}.inline-heading{display:flex;justify-content:space-between;font-size:17rpx;font-weight:600;letter-spacing:1rpx;color:#ab94c3}.inline-track{font-family:ListHeading,sans-serif;color:#fff;font-size:32rpx;display:block;margin:14rpx 0 19rpx;line-height:1.1}.inline-slider{margin:0}.inline-time{display:flex;justify-content:space-between;font-size:20rpx;color:#a693bc;margin:0 0 20rpx}.inline-controls{display:flex;align-items:center;justify-content:space-between;gap:12rpx}.inline-secondary{margin:0;background:#3b2260;border:1rpx solid #5a3c7d;color:#ccb6e4;border-radius:13rpx;font-size:20rpx;padding:17rpx 14rpx;line-height:1.2}.inline-speed{min-width:66rpx}.inline-skip{margin:0;background:transparent;color:#d6c5e7;font-size:50rpx;padding:0;width:45rpx;line-height:1}.inline-play{margin:0;width:78rpx;height:78rpx;min-width:78rpx;border-radius:50%;background:#ffcf00;display:flex;align-items:center;justify-content:center;padding:0}.inline-play image{width:31rpx;height:31rpx}.reading-tools{background:#faf9fc;border:1rpx solid #e8e1ef;border-left:5rpx solid #ffcf00;padding:14rpx 14rpx;border-radius:12rpx;margin-top:0;margin-bottom:35rpx}.reading-tools text{color:#887597;font-size:21rpx}.article{padding:0}.para-text{font-family:Arial,sans-serif;color:#65616c}.para-heading{font-family:ListHeading,sans-serif;font-size:42rpx;color:#211a2a;letter-spacing:.3rpx}.sentence.current{background:#f5f0fa}.vocab{color:#554161;text-decoration-color:#d9c6e4}.word-current{background:#ffe9a1;color:#34243f}.player-bar,.shadow-panel{background:#281247}.bar-btn-main,.shadow-btn-main{background:#ffcf00}.bar-time,.bar-hints{color:#bba6d0}.bar-speed{background:#493065;color:#e1d2ed}.player-circle{background:#ffcf00;border:8rpx solid #281247;box-shadow:0 6rpx 24rpx rgba(39,17,68,.22)}.dock-close{position:absolute;right:10rpx;top:-14rpx;background:#fff;border:1rpx solid #ddd2e7;border-radius:50%;width:33rpx;height:33rpx;text-align:center;line-height:30rpx;color:#947ca5;font-size:28rpx}.key-vocab{background:#fff;border:1rpx solid #d8e8dc;border-radius:17rpx}.section-title{font-family:ListHeading,sans-serif;text-transform:uppercase;color:#246336;font-size:38rpx;letter-spacing:.4rpx}.section-caption{color:#869c8c;font-size:23rpx}.key-vocab-list>text{background:#f1f8f2;border-color:#cce1d1;color:#2c7544;border-radius:12rpx}.review-link{background:#27854d;color:#fff;border:0}.word-popup{border-color:#e0d6e8}.word-popup-word{color:#3b2250}.word-popup-meaning{color:#897594}.completion-card{background:#fff9e2}.reading-settings{background:#faf8fc;color:#8e759e}.reading-settings .selected{background:#ffeeb2}

</style>

<style scoped>.header .title{font-size:48rpx;line-height:1.08}.meta{font-size:20rpx;line-height:1.5}.transcript-toggle-row{margin-bottom:22rpx}.inline-player{padding:24rpx;margin:0 0 22rpx}.compact-track{display:flex;align-items:center;gap:18rpx;margin:20rpx 0}.track-cover{width:85rpx;height:85rpx;border-radius:11rpx;flex-shrink:0}.track-caption{display:block;color:#ae96c5;font-size:15rpx;letter-spacing:1.2rpx}.track-description{display:block;color:#f3eafc;font-family:ListHeading,sans-serif;font-size:31rpx;margin-top:7rpx}.lesson-sections{position:sticky;top:0;z-index:15;background:#fff;display:flex;align-items:center;gap:30rpx;border-bottom:1rpx solid #e9e2ef;padding:0 0 3rpx;margin-bottom:30rpx}.lesson-sections>text{padding:21rpx 0;font-size:24rpx;color:#9a89a6;border-bottom:4rpx solid transparent}.lesson-sections>text.active{color:#281247;border-bottom-color:#ffcf00;font-weight:600}.lesson-sections .appearance-link{margin-left:auto;color:#281247;font-size:28rpx;padding-left:20rpx;padding-right:12rpx}.reading-settings{margin-bottom:28rpx}.reading-options{display:flex;justify-content:space-between}.para-text{text-align:left}.inline-heading{font-size:16rpx}.inline-controls{gap:9rpx}.inline-secondary{font-size:20rpx}</style>
<style scoped>.word-saving{color:#8d739e;font-size:20rpx;white-space:nowrap}.word-retry{display:block;color:#64417d;font-size:24rpx;padding:18rpx 0 4rpx;font-weight:600}</style>

<style scoped>
.player-bar.website-player{box-sizing:border-box;position:fixed;left:28rpx;right:28rpx;bottom:calc(18rpx + env(safe-area-inset-bottom));width:auto;transform:none;background:linear-gradient(145deg,#2e1358 0%,#120724 100%);border:1rpx solid #624184;border-radius:22rpx;padding:23rpx 23rpx 24rpx;box-shadow:0 12rpx 38rpx rgba(31,12,53,.2)}
.dock-header{display:flex;align-items:center;gap:13rpx;min-height:76rpx}.dock-cover{width:76rpx;height:76rpx;flex-shrink:0;border-radius:12rpx}.dock-meta{flex:1;min-width:0}.dock-title{display:block;font-size:26rpx;line-height:1.3;font-weight:650;color:#f2e8ff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dock-subtitle{display:block;color:#a88cc6;font-size:20rpx;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:8rpx}.dock-header-btn{flex-shrink:0;margin:0;padding:0;width:52rpx;height:52rpx;background:transparent;border:1rpx solid #634280;border-radius:12rpx;display:flex;align-items:center;justify-content:center}.dock-header-btn.active{border-color:#b48e18}.dock-header-btn image{width:29rpx;height:29rpx}.dock-collapse{margin:0;padding:0;background:transparent;flex-shrink:0;width:28rpx;height:52rpx;display:flex;align-items:center;justify-content:center}.dock-collapse image{width:26rpx;height:26rpx}.dock-header-btn::after,.dock-collapse::after,.dock-control::after,.dock-play::after{border:0}
.dock-waveform{position:relative;height:114rpx;margin:39rpx 0 5rpx}.dock-wave-bars{display:flex;align-items:center;justify-content:space-between;width:100%;height:100%;pointer-events:none}.dock-wave-bars>view{width:4rpx;min-height:5rpx;border-radius:2rpx;background:#79559d;flex-shrink:0}.dock-wave-bars>view.played{background:#ffcf00}.dock-wave-cursor{position:absolute;top:0;height:100%;width:3rpx;background:#ffcf00;pointer-events:none}.dock-wave-time{position:absolute;top:-28rpx;transform:translateX(-50%);background:#ffcf00;color:#281247;border-radius:5rpx;font-size:18rpx;line-height:1.3;font-weight:700;padding:3rpx 8rpx;pointer-events:none}.dock-wave-seek{position:absolute;left:0;right:0;top:0;height:100%;margin:0;opacity:.01}.dock-plain-slider{margin:30rpx 0 0}.dock-times{display:flex;justify-content:space-between;color:#ac91c4;font-size:20rpx;margin:0 0 16rpx}.dock-loop-range{color:#ffdf6c;font-size:20rpx;margin:10rpx 0 15rpx;text-align:center}.dock-controls{display:flex;align-items:center;justify-content:space-between;gap:12rpx}.dock-control{display:flex;align-items:center;justify-content:center;width:65rpx;height:65rpx;flex-shrink:0;padding:0;margin:0;background:#321653;border:1rpx solid #5d3d80;border-radius:15rpx}.dock-control.active{border-color:#b28f1a;background:#47311e}.dock-control image{width:35rpx;height:35rpx}.dock-play{width:85rpx;height:85rpx;flex-shrink:0;background:#ffcf00;border:0;border-radius:50%;display:flex;align-items:center;justify-content:center;padding:0;margin:0}.dock-speed-control{position:relative;flex-direction:column;gap:0}.dock-speed-control image{width:29rpx;height:29rpx}.dock-speed-control text{font-size:15rpx;line-height:1;color:#bda3d5;margin-top:1rpx}
</style>

<style scoped>
.reference-player{background:linear-gradient(150deg,#2d1256,#10071f);border:1rpx solid #513078;border-radius:24rpx;padding:25rpx 24rpx 23rpx;box-sizing:border-box}
.reference-heading{display:flex;align-items:center;gap:17rpx}.reference-cover{width:82rpx;height:82rpx;flex:none;border-radius:13rpx}.reference-copy{flex:1;min-width:0}.reference-title{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;color:#f4edff;font-size:27rpx;font-weight:650;line-height:1.25}.reference-subtitle{display:block;color:#b6a1cb;font-size:20rpx;line-height:1.4;margin-top:8rpx}
.reference-player button,.reading-player button{box-sizing:border-box;padding:0;margin:0;display:flex;align-items:center;justify-content:center;line-height:1.2}.reference-player button::after,.reading-player button::after{border:0}
.reference-player .dock-waveform{margin-top:36rpx;height:124rpx;margin-bottom:8rpx}.reference-player .dock-wave-bars>view{width:3rpx}.reference-player .dock-times{margin-bottom:19rpx}.reference-player .dock-wave-time{font-size:20rpx;top:-30rpx}.reference-player .dock-wave-seek{top:-12px;bottom:-12px;height:auto}
.reference-controls{display:grid;grid-template-columns:repeat(5,1fr);justify-items:center;align-items:center;margin:9rpx 0 21rpx}
.reference-skip{min-width:44px;min-height:44px;width:88rpx;height:88rpx;border:1rpx solid #573477;border-radius:16rpx;background:#30164f}.reference-skip image{width:40rpx;height:40rpx}
.reference-play{min-width:52px;min-height:52px;width:104rpx;height:104rpx;border-radius:50%;background:#ffcf00}
.reference-controls .reference-pill{display:flex;align-items:center;justify-content:center;gap:6rpx;padding:0 12rpx;height:88rpx;background:#2d164b;border:1rpx solid #533174;border-radius:13rpx;color:#b39acb;font-size:20rpx}
.reference-controls .reference-pill image{width:30rpx;height:30rpx}
.reference-controls .reference-pill text{white-space:nowrap}
.reference-controls .reference-pill.active{border-color:#b48f14;color:#ffcf00;background:#423026}
.reference-controls .reference-shadow{width:88rpx;padding:0}
.reading-player{position:fixed;z-index:40;left:50%;transform:translateX(-50%);bottom:calc(16px + env(safe-area-inset-bottom));width:calc(100% - 32px);max-width:360px;padding:12px 12px 11px;box-sizing:border-box;background:linear-gradient(180deg,#2b1450,#130925);border:1px solid #503175;border-radius:60px;box-shadow:0 6px 20px rgba(23,9,39,.2)}
.reading-progress{position:absolute;left:27px;right:27px;top:-12px;height:24px;margin:0}.reading-controls{display:grid;grid-template-columns:repeat(5,1fr);gap:4px;align-items:center;justify-items:center}.reading-player button{height:44px;min-width:44px;background:transparent;color:#f5edff;border:0;border-radius:24px}.reading-player .reading-follow.active{background:#43302f}.reading-follow image{width:27px;height:27px}.reading-skip image{width:26px;height:26px}.reading-player .reading-play{width:52px;height:52px;background:#ffcf00;justify-self:center}.reading-player .reading-speed{width:44px;background:#302044;font-size:17px;justify-self:center}
@media(min-width:370px){.reading-controls{grid-template-columns:repeat(5,1fr);gap:6px}.reading-player button{height:48px}.reading-player .reading-play{width:56px;height:56px}.reading-player .reading-speed{width:48px}}
.reference-subtitle{font-size:11px}.reference-controls .reference-pill{font-size:11px}.reference-player .dock-times,.reference-player .dock-wave-time{font-size:11px}
</style>

<style scoped>
.shadow-entry{background:#faf9fc;border:1rpx solid #e5ddec;border-left:6rpx solid #ffcf00;border-radius:14rpx;padding:17rpx 18rpx;margin:0 0 23rpx}.shadow-entry-head{display:flex;align-items:center;gap:16rpx}.shadow-entry-label{color:#94879f;font-size:10px;letter-spacing:1px;font-weight:600}.shadow-entry-button{display:flex;align-items:center;justify-content:center;gap:10rpx;margin:0;padding:0 20rpx;min-height:44px;background:#fff;border:1rpx solid #ded5e9;border-radius:12rpx;color:#352147;font-size:14px;font-weight:600}.shadow-entry-button.selected{background:#ffcf00;border-color:#ffcf00}.shadow-entry-button image{width:32rpx;height:32rpx}.shadow-help{margin:0 0 0 auto;padding:0;min-width:44px;height:44px;background:transparent;border:0;color:#9f7a12;font-size:20px}.shadow-entry button::after{border:0}.shadow-entry-caption{display:block;color:#978a9f;font-size:11px;line-height:1.5;margin-top:10rpx}.shadow-entry-summary{display:flex;gap:14rpx;align-items:center;justify-content:space-between;border-top:1rpx solid #e6deec;margin-top:14rpx;padding-top:12rpx;font-size:11px;color:#796987}.shadow-entry-summary text{flex:1}.shadow-entry-summary button{margin:0;padding:0 10rpx;min-height:44px;display:flex;align-items:center;background:transparent;color:#58406e;font-size:12px}.status-pill-float{display:flex;align-items:center;gap:7px;min-height:34px;box-sizing:border-box}.status-pill-listen,.status-pill-paused,.status-pill-turn{background:#ffcf00;color:#281247}.status-pill-float text{font-size:12px;white-space:nowrap}.sentence.current{border-radius:5rpx}.shadow-panel{padding-bottom:calc(18rpx + env(safe-area-inset-bottom))}
</style>
