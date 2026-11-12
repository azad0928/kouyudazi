<template>
 <view class="review-page"><AppHeader title="Review"/>
  <view class="review-subtitle">A little practice. A lasting vocabulary.</view>
  <view class="review-stats"><view><text class="number">{{due.length}}</text><text>Due today</text></view><view><text class="number">{{store.saved.length}}</text><text>Saved</text></view><view><text class="number">{{knownCount}}</text><text>Familiar</text></view></view>
  <view class="sync-line" @click="sync">{{store.syncing?'Syncing…':store.syncError||'Saved on this device · Tap to sync'}}</view>
  <view v-if="!mode && store.saved.length" class="review-actions"><text class="ready-label">MAKE IT STICK</text><text class="ready-title">{{due.length ? "Ready for a quick review?" : "Keep your words familiar."}}</text><button class="primary" :disabled="!store.saved.length" @click="startCards">Review {{Math.min(20,due.length || store.saved.length)}} words <text>→</text></button><button class="secondary" :disabled="quizPool.length<4" @click="startQuiz">Quick quiz</button></view>
  <view v-if="quizPool.length<4 && !mode && store.saved.length" class="hint">Save {{4-quizPool.length}}  more distinct words to unlock the quiz.</view>
  <view v-if="mode==='cards' && currentCard" class="practice-card">
   <view class="practice-top"><text>FLASHCARD {{cardIndex+1}} / {{cards.length}}</text><text @click="mode=''">Close</text></view>
   <view class="flashcard" @click="flipped=!flipped"><text class="flash-word">{{currentCard.word}}</text><text class="pos">{{currentCard.pos}}</text><view v-if="flipped" class="flash-back"><text>{{currentCard.meaningCn}}</text><text class="example">{{currentCard.example}}</text></view><text v-else class="flip-hint">Tap to reveal the meaning</text></view>
   <text class="source" @click="goLesson(currentCard)">From {{currentCard.lessonTitle}} ›</text>
   <view class="card-actions"><button :disabled="!flipped" class="secondary" @click="rate(false)">Again</button><button :disabled="!flipped" class="primary" @click="rate(true)">Got it</button></view>
  </view>
  <view v-if="mode==='quiz' && currentQuestion" class="practice-card">
   <view class="practice-top"><text>Quick quiz {{questionIndex+1}} / {{questions.length}}</text><text @click="mode=''">Close</text></view>
   <text class="quiz-word">{{currentQuestion.word.word}}</text><text class="quiz-instruction">Choose the meaning that fits the context.</text>
   <view v-for="(option,i) in currentQuestion.options" :key="i" class="option" :class="{chosen:selected===i,correct:selected!==null&&option===currentQuestion.word.meaningCn,wrong:selected===i&&option!==currentQuestion.word.meaningCn}" @click="answer(Number(i))">{{letters[i]}} · {{option}}</view>
   <text v-if="selected!==null" class="explain">{{currentQuestion.word.example || 'Revisit the lesson and listen for this word.'}}</text>
   <button class="primary" :disabled="selected===null" @click="nextQuestion">{{questionIndex===questions.length-1?'See results':'Next question'}}</button>
  </view>
  <view v-if="mode==='result'" class="practice-card result-card"><text class="result-title">A little more familiar.</text><text v-if="wasQuiz">{{quizCorrect}} / {{questions.length}} correct</text><text v-else>{{cards.length}} words reviewed</text><text class="hint">Tricky words return sooner. Familiar ones get more space.</text><view v-if="mistakes.length" class="mistakes"><text>WORTH ANOTHER LOOK</text><view v-for="w in mistakes" :key="w.word" @click="goLesson(w)">{{w.word}} · {{w.meaningCn}} ›</view></view><button class="primary" @click="mode=''">Back to vocabulary</button></view>
  <template v-if="!mode">
   <view v-if="store.saved.length" class="list-tools"><text :class="{active:filter==='all'}" @click="filter='all'">All</text><text :class="{active:filter==='due'}" @click="filter='due'">Due today</text><text :class="{active:filter==='known'}" @click="filter='known'">Familiar</text></view>
   <input v-if="store.saved.length" class="search" v-model="keyword" placeholder="Search your words"/>
   <view v-if="!filtered.length" class="empty"><view v-if="!store.saved.length" class="empty-art"><view/></view><text class="empty-title">{{store.saved.length?'No matching words':'Your words start here.'}}</text><text>{{store.saved.length?'Try a different search or filter.':'Tap a word in any lesson, then save it to build your collection.'}}</text><button v-if="!store.saved.length" class="secondary" @click="goCourses">Explore lessons</button></view>
   <view v-else class="word-list"><view v-for="w in filtered" :key="w.word" class="word-item"><view class="word-body" @click="goLesson(w)"><view><text class="word">{{w.word}}</text><text class="pos">{{w.pos}}</text><text v-if="w.known" class="known">Familiar</text></view><text class="meaning">{{w.meaningCn}}</text><text class="source">{{w.lessonTitle}} ›</text></view><view class="saved-icon" @click="remove(w)"><ProfileIcon name="bookmark"/></view></view></view>
   <view v-if="undoWord" class="undo"><text>Removed {{undoWord.word}}</text><text @click="undo">Undo</text></view>
  </template>
  <BottomNav active="review"/>
 </view>
</template>
<script setup lang="ts">
import { ref, computed } from 'vue';
import { onShow, onPullDownRefresh, onUnload } from '@dcloudio/uni-app';
import ProfileIcon from '@/components/ProfileIcon.vue';
import AppHeader from '@/components/AppHeader.vue';
import BottomNav from '@/components/BottomNav.vue';
import { useVocabStore, type SavedVocab } from '@/stores/vocab';
const store = useVocabStore();
store.load();
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
const filtered = computed(() => store.saved.filter(w => (filter.value === 'all' || filter.value === 'due' && (w.dueAt || 0) <= now.value || filter.value === 'known' && w.known) && (!keyword.value.trim() || w.word.toLowerCase().includes(keyword.value.trim().toLowerCase()) || w.meaningCn.includes(keyword.value.trim()))).sort((a, b) => b.savedAt - a.savedAt));
const currentCard = computed(() => cards.value[cardIndex.value]),
  currentQuestion = computed(() => questions.value[questionIndex.value]);
async function sync() {
  await store.sync();
  now.value = Date.now();
}
onShow(sync);
onPullDownRefresh(async () => {
  await sync();
  uni.stopPullDownRefresh();
});
onUnload(() => {
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
      title: 'Unable to remove. Try again.',
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
      title: 'Unable to restore. Try again.',
      icon: 'none'
    });
  }
}
function goLesson(w: SavedVocab) {
  uni.navigateTo({
    url: '/pages/lesson/detail?id=' + encodeURIComponent(w.lessonId) + '&sentence=' + (w.sentenceIndex ?? -1)
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
