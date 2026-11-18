<template>
 <view class="review-page"><AppHeader title="单词复习"/>
  <view class="review-subtitle">每天复习一点，让单词记得更牢。</view>
  <view class="review-stats"><view><text class="number">{{due.length}}</text><text>今日待复习</text></view><view><text class="number">{{store.saved.length}}</text><text>已收藏</text></view><view><text class="number">{{knownCount}}</text><text>已掌握</text></view></view>
  <view class="sync-line" @click="sync">{{store.syncing?'正在同步…':store.syncError?'同步暂不可用，单词已保存在本机 · 点击重试':'已保存在本机 · 点击同步'}}</view>
  <view v-if="!mode && store.saved.length" class="review-actions"><text class="ready-label">每天巩固一点</text><text class="ready-title">{{due.length ? "用几分钟，巩固今天的单词" : "再练一遍，让记忆更牢固"}}</text><button class="primary" :disabled="!store.saved.length" @click="startCards">复习 {{Math.min(20,due.length || store.saved.length)}} 个单词 <text>→</text></button><button class="secondary" :disabled="quizPool.length<4" @click="startQuiz">小测验</button></view>
  <view v-if="quizPool.length<4 && !mode && store.saved.length" class="hint">再收藏 {{4-quizPool.length}} 个释义不同的单词，即可解锁测验。</view>
  <view v-if="mode==='cards' && currentCard" class="practice-card">
   <view class="practice-top"><text>单词卡 {{cardIndex+1}} / {{cards.length}}</text><text @click="mode=''">退出</text></view>
   <view class="flashcard" @click="flipped=!flipped"><text class="flash-word">{{currentCard.word}}</text><text class="pos">{{currentCard.pos}}</text><view v-if="flipped" class="flash-back"><text class="meaning-zh flash-zh" @click.stop="ensureChinese(currentCard)">{{(currentCard.meaningZhVersion === 3 ? currentCard.meaningZh : '') || (zhBusy[currentCard.word] ? '中文释义加载中…' : '点击加载中文释义')}}</text><text class="flash-english">{{currentCard.meaningCn}}</text><text class="example">{{currentCard.example}}</text></view><text v-else class="flip-hint">点击卡片查看释义</text></view>
   <text class="source" @click="goLesson(currentCard)">来自 {{currentCard.lessonTitle}} ›</text>
   <view class="card-actions"><button :disabled="!flipped" class="secondary" @click="rate(false)">再记一次</button><button :disabled="!flipped" class="primary" @click="rate(true)">记住了</button></view>
  </view>
  <view v-if="mode==='quiz' && currentQuestion" class="practice-card">
   <view class="practice-top"><text>小测验 {{questionIndex+1}} / {{questions.length}}</text><text @click="mode=''">退出</text></view>
   <text class="quiz-word">{{currentQuestion.word.word}}</text><text class="quiz-instruction">请选择符合语境的释义。</text>
   <view v-for="(option,i) in currentQuestion.options" :key="i" class="option" :class="{chosen:selected===i,correct:selected!==null&&option===currentQuestion.word.meaningCn,wrong:selected===i&&option!==currentQuestion.word.meaningCn}" @click="answer(Number(i))">{{letters[i]}} · {{option}}</view>
   <text v-if="selected!==null" class="explain">{{currentQuestion.word.example || '回到原文，再听听这个单词的用法。'}}</text>
   <button class="primary" :disabled="selected===null" @click="nextQuestion">{{questionIndex===questions.length-1?'查看结果':'下一题'}}</button>
  </view>
  <view v-if="mode==='result'" class="practice-card result-card"><text class="result-title">又记牢了一点</text><text v-if="wasQuiz">答对 {{quizCorrect}} / {{questions.length}} 题</text><text v-else>已复习 {{cards.length}} 个单词</text><text class="hint">不熟悉的词会更早出现，记住的词会间隔更久再复习。</text><view v-if="mistakes.length" class="mistakes"><text>这些单词值得再练一次</text><view v-for="w in mistakes" :key="w.word" @click="goLesson(w)">{{w.word}} · {{w.meaningCn}} ›</view></view><button class="primary" @click="mode=''">返回单词列表</button></view>
  <template v-if="!mode">
   <view v-if="store.saved.length" class="list-tools"><text :class="{active:filter==='all'}" @click="filter='all'">全部</text><text :class="{active:filter==='due'}" @click="filter='due'">今日待复习</text><text :class="{active:filter==='known'}" @click="filter='known'">已掌握</text></view>
   <input v-if="store.saved.length" class="search" v-model="keyword" placeholder="搜索单词或释义"/>
   <view v-if="!filtered.length" class="empty"><view v-if="!store.saved.length" class="empty-art"><view/></view><text class="empty-title">{{store.saved.length?'没有找到相关单词':'从第一个单词开始积累'}}</text><text>{{store.saved.length?'换个关键词或筛选条件试试。':'在课程中点击单词并收藏，就可以在这里复习。'}}</text><button v-if="!store.saved.length" class="secondary" @click="goCourses">去发现课程</button></view>
   <view v-else class="word-list"><view v-for="w in filtered" :key="w.word" class="word-item"><view class="word-body" @click="goLesson(w)"><view><text class="word">{{w.word}}</text><text class="pos">{{w.pos}}</text><text v-if="w.known" class="known">已掌握</text></view><text class="meaning-zh" @click.stop="ensureChinese(w)">{{(w.meaningZhVersion === 3 ? w.meaningZh : '') || (zhBusy[w.word] ? '中文释义加载中…' : '点击加载中文释义')}}</text><text class="meaning">{{w.meaningCn}}</text><text class="source">{{w.lessonTitle}} ›</text></view><view class="saved-icon" @click="remove(w)"><ProfileIcon name="bookmark"/></view></view></view>
   <view v-if="undoWord" class="undo"><text>已移除 {{undoWord.word}}</text><text @click="undo">撤销</text></view>
  </template>
  <BottomNav active="review"/>
 </view>
</template>
<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { studyContent } from '@/utils/api';
import { onShow, onPullDownRefresh, onUnload } from '@dcloudio/uni-app';
import ProfileIcon from '@/components/ProfileIcon.vue';
import AppHeader from '@/components/AppHeader.vue';
import BottomNav from '@/components/BottomNav.vue';
import { useVocabStore, type SavedVocab } from '@/stores/vocab';
const store = useVocabStore();
store.load();
let pageActive = true;
const zhBusy = ref<Record<string, boolean>>({});
async function ensureChinese(word: SavedVocab, silent = false) {
  if (!word || (word.meaningZh && word.meaningZhVersion === 3) || zhBusy.value[word.word]) return;
  zhBusy.value[word.word] = true;
  try {
    const content = await studyContent(word.lessonId, 'word', { word: word.word });
    if (typeof content.meaningZh !== 'string' || !/[\u4e00-\u9fff]/.test(content.meaningZh)) throw new Error('INVALID_TRANSLATION');
    const saved = store.saved.find(w => w.word === word.word);
    if (saved) {
      saved.meaningZh = content.meaningZh.trim();
      saved.meaningZhVersion = 3;
      saved.updatedAt = Date.now();
      store.persist();
      void store.sync();
    }
    word.meaningZh = content.meaningZh.trim();
    word.meaningZhVersion = 3;
  } catch {
    if (!silent) uni.showToast({ title: '中文释义暂未加载，请稍后点击重试', icon: 'none' });
  } finally { zhBusy.value[word.word] = false; }
}
const keyword = ref(''),
  filter = ref('all'),
  mode = ref(''),
  cards = ref<SavedVocab[]>([]),
  cardIndex = ref(0),
  flipped = ref(false),
  questions = ref<{
    word: SavedVocab;
    options: string[];
  }[]>([]),
  questionIndex = ref(0),
  selected = ref<number | null>(null),
  quizCorrect = ref(0),
  mistakes = ref<SavedVocab[]>([]),
  wasQuiz = ref(false),
  undoWord = ref<SavedVocab | null>(null),
  now = ref(Date.now()),
  letters = ['A', 'B', 'C', 'D'];
let undoTimer: ReturnType<typeof setTimeout> | null = null;
const due = computed(() => store.saved.filter(w => (w.dueAt || 0) <= now.value)),
  knownCount = computed(() => store.saved.filter(w => w.known).length),
  quizPool = computed(() => {
    const seen = new Set();
    return store.saved.filter(w => {
      if (!w.meaningCn || seen.has(w.meaningCn)) return false;
      seen.add(w.meaningCn);
      return true;
    });
  });
const filtered = computed(() => store.saved.filter(w => (filter.value === 'all' || filter.value === 'due' && (w.dueAt || 0) <= now.value || filter.value === 'known' && w.known) && (!keyword.value.trim() || w.word.toLowerCase().includes(keyword.value.trim().toLowerCase()) || w.meaningCn.includes(keyword.value.trim()) || (w.meaningZh || '').includes(keyword.value.trim()))).sort((a, b) => b.savedAt - a.savedAt));
const currentCard = computed(() => cards.value[cardIndex.value]),
  currentQuestion = computed(() => questions.value[questionIndex.value]);
watch([currentCard, flipped], ([card, revealed]) => { if (card && revealed) void ensureChinese(card); });
async function sync() {
  await store.sync();
  now.value = Date.now();
  for (const word of store.saved.slice(0, 20)) {
    if (!pageActive) break;
    await ensureChinese(word, true);
  }
}
onShow(sync);
onPullDownRefresh(async () => {
  await sync();
  uni.stopPullDownRefresh();
});
onUnload(() => {
  pageActive = false;
  if (undoTimer) clearTimeout(undoTimer);
});
function shuffle<T>(arr: T[]) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
function startCards() {
  cards.value = shuffle(due.value.length ? due.value : store.saved).slice(0, 20);
  cardIndex.value = 0;
  flipped.value = false;
  mistakes.value = [];
  wasQuiz.value = false;
  mode.value = 'cards';
}
function rate(known: boolean) {
  const w = currentCard.value;
  if (!w || !flipped.value) return;
  store.review(w.word, known);
  if (!known) mistakes.value.push(w);
  if (cardIndex.value >= cards.value.length - 1) {
    mode.value = 'result';
    now.value = Date.now();
  } else {
    cardIndex.value++;
    flipped.value = false;
  }
}
function startQuiz() {
  const pool = quizPool.value;
  if (pool.length < 4) return;
  questions.value = shuffle(pool).slice(0, 10).map(word => ({
    word,
    options: shuffle([word.meaningCn, ...shuffle(pool.filter(w => w.meaningCn !== word.meaningCn)).slice(0, 3).map(w => w.meaningCn)])
  }));
  questionIndex.value = 0;
  selected.value = null;
  quizCorrect.value = 0;
  mistakes.value = [];
  wasQuiz.value = true;
  mode.value = 'quiz';
}
function answer(i: number) {
  if (selected.value !== null) return;
  selected.value = i;
  const q = currentQuestion.value,
    known = q.options[i] === q.word.meaningCn;
  store.review(q.word.word, known);
  if (known) quizCorrect.value++;else mistakes.value.push(q.word);
}
function nextQuestion() {
  if (selected.value === null) return;
  if (questionIndex.value >= questions.value.length - 1) {
    mode.value = 'result';
    now.value = Date.now();
  } else {
    questionIndex.value++;
    selected.value = null;
  }
}
function remove(w: SavedVocab) {
  try {
    store.toggle(w);
    undoWord.value = {
      ...w
    };
    if (undoTimer) clearTimeout(undoTimer);
    undoTimer = setTimeout(() => undoWord.value = null, 7000);
  } catch {
    uni.showToast({
      title: '移除失败，请重试',
      icon: 'none'
    });
  }
}
function undo() {
  const w = undoWord.value;
  if (!w) return;
  try {
    store.toggle(w);
    undoWord.value = null;
    if (undoTimer) clearTimeout(undoTimer);
  } catch {
    uni.showToast({
      title: '恢复失败，请重试',
      icon: 'none'
    });
  }
}
function goLesson(w: SavedVocab) {
  uni.navigateTo({
    url: '/pages/lesson/detail?id=' + encodeURIComponent(w.lessonId) + '&sentence=' + (w.sentenceIndex ?? -1) + '&word=' + encodeURIComponent(w.word)
  });
}
function goCourses() {
  uni.reLaunch({
    url: '/pages/index/index?browse=1'
  });
}
</script>
<style scoped>
.review-page{min-height:100vh;background:#f7f6f9;padding:38rpx 30rpx calc(170rpx + env(safe-area-inset-bottom));box-sizing:border-box}.eyebrow{font-size:20rpx;letter-spacing:3rpx;color:#77877b}.hero-title{font-size:42rpx;font-weight:700;color:#281247;margin:20rpx 0 30rpx}.review-stats{display:flex;justify-content:space-between;background:#fff;padding:32rpx;border-radius:26rpx}.review-stats>view{display:flex;flex:1;flex-direction:column;text-align:center;gap:8rpx;font-size:23rpx;color:#77877b}.number{font-size:48rpx;font-weight:700;color:#281247}.sync-line{font-size:21rpx;color:#77877b;padding:22rpx 2rpx}.review-actions{display:flex;gap:16rpx}.primary,.secondary{font-size:27rpx;border-radius:20rpx;line-height:1.5;padding:23rpx 24rpx}.primary{background:#ffcf00;color:#281247;flex:1;font-weight:650}.secondary{background:#eee7f5;color:#281247}.primary::after,.secondary::after{border:0}.hint{font-size:23rpx;color:#77877b;line-height:1.7;margin:20rpx 0;display:block}.practice-card{background:#fff;border-radius:28rpx;padding:30rpx;margin:20rpx 0;border:1rpx solid #ece6f1}.practice-top{display:flex;justify-content:space-between;font-size:23rpx;color:#77877b}.practice-top text:last-child{color:#281247}.flashcard{min-height:340rpx;background:#f9f7fc;border-radius:22rpx;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:36rpx 24rpx;margin:28rpx 0;text-align:center}.flash-word{font-size:56rpx;font-weight:700;color:#281247}.pos{font-size:22rpx;color:#77877b;margin-left:14rpx}.flip-hint{font-size:24rpx;color:#77877b;margin-top:44rpx}.flash-back{font-size:32rpx;color:#281247;margin-top:24rpx;line-height:1.7}.example{display:block;font-size:26rpx;color:#77877b;margin-top:20rpx}.source{display:block;font-size:21rpx;color:#77877b;line-height:1.6;margin-top:12rpx}.card-actions{display:flex;gap:18rpx;margin-top:26rpx}.card-actions button{flex:1}.quiz-word{display:block;font-size:48rpx;font-weight:700;color:#281247;margin:38rpx 0 12rpx}.quiz-instruction{font-size:24rpx;color:#77877b;display:block;margin-bottom:28rpx}.option{font-size:28rpx;border:2rpx solid #ece6f2;border-radius:18rpx;padding:24rpx 18rpx;margin:16rpx 0;color:#281247}.chosen{background:#f5eefc;border-color:#77877b}.correct{background:#eff8f0;border-color:#73b386}.wrong{background:#fff2f0;border-color:#ce8d84}.explain{font-size:24rpx;color:#77877b;line-height:1.7;display:block;margin:22rpx 0}.result-card{text-align:center;display:flex;flex-direction:column;gap:20rpx;font-size:31rpx;color:#281247}.result-title{font-size:37rpx;color:#281247;font-weight:700}.result-card button{width:100%;flex:none}.mistakes{text-align:left;font-size:25rpx;color:#a07160;background:#fff7ed;border-radius:18rpx;padding:22rpx;line-height:1.8}.mistakes view{padding:14rpx 0;border-bottom:1rpx solid #f0e2d9}.list-tools{display:flex;gap:26rpx;margin:40rpx 0 24rpx;font-size:27rpx;color:#77877b}.list-tools text{padding:10rpx 2rpx}.list-tools .active{color:#281247;border-bottom:4rpx solid #ffcf00;font-weight:650}.search{height:80rpx;padding:0 24rpx;border-radius:20rpx;background:#fff;font-size:26rpx;margin-bottom:24rpx}.empty{text-align:center;display:flex;flex-direction:column;gap:20rpx;padding:55rpx 24rpx;color:#77877b;font-size:25rpx;line-height:1.7}.empty-title{font-size:32rpx;color:#281247}.word-list{background:#fff;border-radius:24rpx;overflow:hidden}.word-item{display:flex;align-items:center;padding:26rpx;border-bottom:1rpx solid #f1edf5}.word-body{flex:1;min-width:0}.word{font-size:33rpx;color:#281247;font-weight:650}.meaning{font-size:27rpx;color:#77877b;margin-top:10rpx;display:block}.known{font-size:19rpx;color:#7b9d7c;background:#f1f7ed;margin-left:14rpx;padding:3rpx 8rpx;border-radius:8rpx}.star{color:#ffcf00;font-size:39rpx;padding:24rpx 8rpx 24rpx 22rpx}.undo{position:fixed;bottom:180rpx;left:45rpx;right:45rpx;background:#281247;color:#fff;padding:26rpx;border-radius:20rpx;display:flex;justify-content:space-between;font-size:26rpx;z-index:70}.undo text:last-child{color:#ffcf00}
</style>

<style scoped>

.review-page{background:#ffffff;padding:32rpx 30rpx calc(160rpx + env(safe-area-inset-bottom));min-height:100vh}.eyebrow{color:#87977b;letter-spacing:3rpx;font-size:17rpx;margin:10rpx 0 24rpx}.hero-title{font-size:55rpx;line-height:1.08;letter-spacing:-2rpx;font-weight:700;white-space:pre-line;color:#281247}.review-stats{background:transparent;border:0;border-top:1rpx solid #e0e8d8;border-bottom:1rpx solid #e0e8d8;border-radius:0;padding:27rpx 0;margin:35rpx 0 17rpx;box-shadow:none}.review-stats>view{gap:10rpx;color:#89987b;font-size:21rpx}.number{color:#314c36;font-size:43rpx;font-weight:600;letter-spacing:-1rpx}.sync-line{color:#a1ac96;font-size:19rpx;margin-bottom:30rpx}.primary{background:#281247;color:#fff;font-size:25rpx;border-radius:15rpx;padding:24rpx;font-weight:600}.secondary{border:1rpx solid #dce6cd;color:#607b4b;background:#f0f4e8;font-size:25rpx;border-radius:15rpx;padding:24rpx}.review-actions{gap:13rpx;display:flex}.review-actions .primary{flex:1.7}.review-actions .secondary{flex:1}.list-tools{margin-top:40rpx;color:#8c9b7d;font-size:24rpx;gap:29rpx;border-bottom:1rpx solid #e3ebd9;padding-bottom:19rpx}.list-tools .active{color:#365434}.search{background:#fff;border:1rpx solid #e4eadb;border-radius:15rpx;padding:23rpx;font-size:24rpx;margin-top:24rpx}.empty{background:#f8f6fb;border:0;border-radius:23rpx;margin-top:25rpx;padding:65rpx 35rpx;color:#93a182;font-size:24rpx;line-height:1.7}.empty-title{font-size:32rpx;color:#536e42;letter-spacing:-.6rpx;margin-bottom:15rpx}.empty button{background:#281247;color:#fff;border:0;margin-top:28rpx;padding:20rpx 35rpx}.word-item{background:#fff;border:1rpx solid #e4ebdb;border-radius:17rpx;padding:25rpx;margin:16rpx 0}.word{font-size:32rpx;color:#2a4532;letter-spacing:-.5rpx}.pos,.source{color:#a0ad91;font-size:20rpx}.meaning{font-size:24rpx;color:#7a8f68}.star{color:#8da867}.practice-card{background:#fff;border:1rpx solid #e3ebd9;border-radius:23rpx;padding:28rpx;margin-top:27rpx}.flashcard{background:#f1f5e8;border-radius:19rpx;min-height:340rpx}.flash-word{font-family:Georgia,serif;font-size:70rpx;color:#28432f}.practice-top{font-size:19rpx;color:#8e9e7e;letter-spacing:1rpx}.flip-hint{font-size:22rpx;color:#9aaa8b}.flash-back{font-size:30rpx;color:#5b754b}.card-actions{gap:15rpx}.option{border-color:#dfe9d2;border-radius:14rpx;color:#5f7950}.chosen{background:#eff5df;border-color:#9cb477}.hint{font-size:22rpx;line-height:1.7;color:#94a382}.result-title{color:#365631;font-size:39rpx;letter-spacing:-1rpx}

</style>

<style scoped>.hero-line{display:block}</style>

<style scoped>.review-page{padding-top:0}.eyebrow{margin-top:35rpx}.empty{gap:17rpx;padding:45rpx 35rpx}.empty-title{font-weight:600}.empty-art{position:relative;width:85rpx;height:98rpx;margin:0 auto 15rpx;background:#fff;border:2rpx solid #d5dfc5;border-radius:13rpx;transform:rotate(8deg)}.empty-art:before{content:"";position:absolute;width:85rpx;height:98rpx;top:-8rpx;left:-13rpx;border:2rpx solid #c9d8b6;border-radius:13rpx;background:#f6f9f0;transform:rotate(-17deg);z-index:-1}.empty-art:after{content:"";position:absolute;left:19rpx;right:18rpx;height:3rpx;top:31rpx;background:#b9cca0;box-shadow:0 15rpx 0 #d5e0c4,0 30rpx 0 #d5e0c4}.empty button{margin-top:15rpx}</style>

<style scoped>
.hero-title{font-family:ListHeading,sans-serif;font-size:59rpx;letter-spacing:.1rpx;text-transform:uppercase;line-height:1.02;color:#21162f}.number{color:#392452}.primary{background:#281247;color:#fff}.empty-title{font-family:ListHeading,sans-serif;font-size:37rpx;color:#3f2b54}.review-stats{border-color:#e5e1eb}.empty-art{border-color:#dbd1e9}.list-tools .active{color:#392452}.secondary{background:#fff8df;border-color:#efdf9e;color:#856d2e}
</style>

<style scoped>
.review-page{background:#fff}.review-subtitle{font-size:25rpx;color:#8d8297;margin:14rpx 0 32rpx}.review-stats{border:1rpx solid #e9e2ef;background:#faf8fc;border-radius:20rpx;padding:25rpx 0}.review-stats .number{font-family:ListHeading,sans-serif;font-size:44rpx;color:#281247}.review-stats>view>text:last-child{font-size:21rpx;color:#8b8096}.review-actions{display:flex;flex-wrap:wrap;background:#281247;border-radius:22rpx;padding:28rpx;gap:18rpx;margin:24rpx 0 14rpx}.ready-label{width:100%;color:#b7a2ce;font-size:17rpx;letter-spacing:2rpx}.ready-title{width:100%;font-family:ListHeading,sans-serif;color:#fff;font-size:37rpx;line-height:1.1;margin-bottom:10rpx}.review-actions .primary{background:#ffcf00;color:#281247;flex:1;font-size:25rpx}.review-actions .secondary{background:#3d225b;color:#e4d7ed;border-color:#634878;font-size:25rpx}.review-actions .secondary[disabled]{opacity:.45}.saved-icon{width:34rpx;height:34rpx;padding:18rpx}.word-item{border-bottom:1rpx solid #ece6f0;padding:27rpx 0}.word{color:#281247}.meaning{color:#655c70}.source{color:#9a8ea4}.list-tools{margin-top:35rpx}.list-tools .active{color:#281247;border-bottom:3rpx solid #ffcf00}.search{background:#faf8fc;border-color:#e9e2ef}.sync-line{font-size:20rpx;color:#9a8ea4;text-align:center}
</style>

<style scoped>
/* Chinese interface typography, with English learning content kept intact. */
.review-page{font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Helvetica Neue',Arial,sans-serif;padding-left:17px;padding-right:17px;background:#fff;box-sizing:border-box}
.review-page :deep(.header-title){font-size:19px;font-weight:600;line-height:1.4;letter-spacing:0}
.review-subtitle{font-size:13px;line-height:1.7;letter-spacing:0;color:#91829e;margin:8px 0 16px}
.review-stats{margin:0 0 12px;padding:16px 0;border-radius:12px;background:#faf8fd;border:1px solid #e8dff1}
.review-stats>view{gap:6px}.review-stats .number{font-family:inherit;font-size:25px;font-weight:650;line-height:1.15;letter-spacing:0;font-variant-numeric:tabular-nums}.review-stats>view>text:last-child{font-size:12px;line-height:1.5;letter-spacing:0}
.sync-line{font-size:11px;line-height:1.7;color:#9b8ba8;margin:0 4px 18px;padding:6px 0;letter-spacing:0;text-align:center}
.review-actions{padding:17px 15px;gap:12px 10px;margin:0 0 11px;border-radius:14px;align-items:stretch}
.ready-label{font-size:11px;line-height:1.5;letter-spacing:0;font-weight:400;color:#bca8d0}
.ready-title{font-family:inherit;font-size:18px;font-weight:600;line-height:1.5;letter-spacing:0;margin:0 0 2px}
.primary,.secondary{font-family:inherit;min-height:44px;padding:10px 12px;font-size:14px;line-height:1.5;letter-spacing:0;border-radius:10px;box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:5px;margin:0}
.review-actions .primary{font-size:14px;flex:1.2;font-weight:600}.review-actions .secondary{font-size:14px;flex:1;font-weight:500;border:1px solid #60437d}
.hint{display:block;font-size:11px;line-height:1.8;letter-spacing:0;color:#9b8ba7;margin:0 2px 0}
.list-tools{display:flex;align-items:center;gap:24px;margin:22px 0 14px;padding:0;border-bottom:1px solid #eee7f4;font-size:14px;line-height:1.5;color:#a08fac;letter-spacing:0}
.list-tools>text{position:relative;min-height:40px;display:flex;align-items:center;box-sizing:border-box;padding:6px 0 10px;border:0}
.list-tools .active{font-weight:600;border:0;color:#281247}.list-tools .active::after{content:'';position:absolute;left:0;right:0;bottom:0;height:2px;background:#ffcf00;border-radius:2px}
.search{box-sizing:border-box;height:43px;margin:0 0 17px;padding:0 13px;border:1px solid #e7ddf0;border-radius:11px;font-family:inherit;font-size:13px;line-height:1.5;letter-spacing:0;background:#faf8fd}
.word-list{background:transparent;overflow:visible;border-radius:0}.word-item{padding:15px 14px;margin:0 0 12px;background:#fff;border:1px solid #e8e0ef;border-radius:12px;gap:9px}.word-body{flex:1;min-width:0}.word-body>view{display:flex;align-items:baseline;flex-wrap:wrap;gap:5px 8px}.word{font-family:inherit;font-size:19px;line-height:1.4;font-weight:600;letter-spacing:0;overflow-wrap:break-word}.pos{margin:0;font-size:11px;line-height:1.5;color:#a38eaf}.meaning{font-size:13px;line-height:1.7;letter-spacing:0;margin-top:6px}.source{font-size:10.5px;line-height:1.6;letter-spacing:0;color:#a08cad;margin-top:7px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:normal;overflow-wrap:break-word}.known{margin:0;font-size:10px;line-height:1.5}.saved-icon{width:18px;height:18px;flex:0 0 18px;padding:12px;box-sizing:content-box}
.practice-card{padding:17px 15px;border-radius:14px;border:1px solid #e7ddf0;margin-top:16px}.practice-top{font-size:12px;line-height:1.5;letter-spacing:0;gap:12px}.practice-top>text:last-child{padding:5px 0 5px 12px;color:#8c73a3}.flashcard{background:#f7f2fc;min-height:205px;border-radius:12px}.flash-word{font-family:inherit;font-size:34px;font-weight:600;line-height:1.4;letter-spacing:0;overflow-wrap:break-word}.flash-back{font-family:inherit;font-size:17px;line-height:1.8;color:#594466}.flip-hint,.quiz-instruction,.explain{font-size:12px;line-height:1.8;letter-spacing:0;color:#9a86a9}.example{font-size:14px;line-height:1.8;color:#8f7c9e}.card-actions{gap:10px;margin-top:18px}.quiz-word{font-size:25px;line-height:1.4;letter-spacing:0;margin:24px 0 8px}.quiz-instruction{margin-bottom:17px}.option{font-size:14px;line-height:1.7;padding:12px;border-radius:10px;margin:10px 0}.result-card{font-size:15px;line-height:1.7;gap:14px}.result-title{font-family:inherit;font-size:21px;font-weight:600;line-height:1.5;letter-spacing:0}.mistakes{font-size:13px;line-height:1.8;border-radius:10px;padding:13px}.empty-title{font-family:inherit;font-size:18px;line-height:1.5;letter-spacing:0}.empty{font-size:13px;line-height:1.8;color:#9582a4}.undo{font-size:13px;line-height:1.6;letter-spacing:0;gap:12px;align-items:center}.undo>text:first-child{min-width:0;overflow-wrap:break-word}.undo>text:last-child{flex:none}
@media(max-width:350px){.review-page{padding-left:15px;padding-right:15px}.ready-title{font-size:17px}.review-actions{padding:16px 13px}.review-actions .primary,.review-actions .secondary{font-size:13px}.list-tools{gap:20px}.word-item{padding:14px 12px}}
</style>

<style scoped>
.meaning-zh{display:block;font-family:inherit;font-size:13px;font-weight:500;line-height:1.75;color:#80658f;margin-top:3px;letter-spacing:0;overflow-wrap:break-word}.flash-zh{font-size:15px;line-height:1.8;margin-top:6px;color:#80658f}.flash-back{width:100%}.flash-back .example{margin-top:18px}
</style>

<style scoped>
.word-body .meaning-zh{margin-top:6px;font-size:14px;font-weight:500;line-height:1.6;color:#695078}.word-body .meaning{margin-top:4px;color:#8c7f96}.flash-zh{margin-top:0;font-size:18px;font-weight:600;color:#594466}.flash-english{display:block;margin-top:9px;font-size:15px;line-height:1.7;color:#8c7f96}
</style>
