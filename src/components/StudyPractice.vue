<template>
 <view class="study-card">
  <view class="section-title">PRACTICE THIS LESSON</view><text class="caption">A few questions. A little reflection. Make this lesson stick.</text>
  <button v-if="!content" class="primary" :loading="loading" :disabled="loading" @click="prepare">{{ loading?'Preparing your practice…':'Try this lesson' }}</button>
  <view v-if="error" class="error">{{error}}<text @click="prepare"> · Retry</text></view>
  <template v-if="content">
   <view v-if="content.summary" class="summary">{{content.summary}}</view>
   <view class="grammar" @click="grammarOpen=!grammarOpen"><text>GRAMMAR IN CONTEXT</text><text class="expand-icon">{{grammarOpen?'−':'+'}}</text></view>
   <view v-if="grammarOpen" class="grammar-body"><text class="grammar-name">{{content.grammar.title}}</text><text>{{content.grammar.explanation}}</text><text class="example">{{content.grammar.example}}</text></view>
   <view class="grammar" @click="questionsOpen=!questionsOpen"><text>LISTENING COMPREHENSION</text><text class="expand-icon">{{questionsOpen?'−':'+'}}</text></view>
   <template v-if="questionsOpen"><view v-for="(q,i) in content.questions" :key="i" class="question">
    <text class="prompt">{{Number(i)+1}}. {{q.prompt}}</text>
    <view v-for="(option,n) in q.options" :key="n" class="option" :class="{chosen:answers[i]===n,correct:submitted&&q.answer===n,wrong:submitted&&answers[i]===n&&q.answer!==n}" @click="choose(Number(i),Number(n))"><text class="letter">{{letters[n]}}</text>{{option}}</view>
    <view v-if="submitted" class="explanation">{{answers[i]===q.answer?'✓ You got it':'Give it another listen'}} · {{q.explanation}}</view>
   </view>
   <view v-if="submitted" class="result">{{correct}} / {{content.questions.length}} correct · {{Math.round(correct/content.questions.length*100)}}%</view>
   <button class="primary" :disabled="!submitted&&answered!==content.questions.length" @click="submit">{{submitted?'Try again':`Check answers（${answered}/${content.questions.length}）`}}</button>
   </template><text class="machine-note">{{content.source==='website'?'Practice from the original lesson.':'AI-assisted practice. Something off? Let us know in Settings & help.'}}</text>
  </template>
 </view>
</template>
<script setup lang="ts">
import { ref, computed } from 'vue';
import { studyContent, studyError } from '@/utils/api';
import { useLearningStore } from '@/stores/learning';
const props = defineProps<{
    lesson: any;
  }>(),
  content = ref<any>(null),
  loading = ref(false),
  error = ref(''),
  answers = ref<Record<number, number>>({}),
  submitted = ref(false),
  grammarOpen = ref(false),
  questionsOpen = ref(false),
  letters = ['A', 'B', 'C', 'D'];
const answered = computed(() => Object.keys(answers.value).length),
  correct = computed(() => content.value?.questions.filter((q: any, i: number) => answers.value[i] === q.answer).length || 0);
const assessmentCacheKey='assessment_en_v1_'+props.lesson.id+(props.lesson.contentVersion?'_'+props.lesson.contentVersion:'');
try {
  content.value = uni.getStorageSync(assessmentCacheKey) || null;
} catch {}
async function prepare() {
  if (loading.value) return;
  loading.value = true;
  error.value = '';
  try {
    content.value = await studyContent(props.lesson.id, 'assessment');
    try {
      uni.setStorageSync(assessmentCacheKey, content.value);
    } catch {}
  } catch (e) {
    error.value = studyError(e);
  } finally {
    loading.value = false;
  }
}
function choose(i: number, n: number) {
  if (!submitted.value) answers.value = {
    ...answers.value,
    [i]: n
  };
}
function submit() {
  if (submitted.value) {
    answers.value = {};
    submitted.value = false;
    return;
  }
  if (answered.value !== content.value.questions.length) return;
  submitted.value = true;
  useLearningStore().score(props.lesson, Math.round(correct.value / content.value.questions.length * 100));
}
</script>
<style scoped>
.study-card{margin:36rpx 0;padding:32rpx;background:#fff;border:1rpx solid #eee9f3;border-radius:28rpx}.section-title{font-size:34rpx;font-weight:700;color:#203b31}.caption{display:block;color:#203b31;font-size:25rpx;line-height:1.6;margin:12rpx 0 24rpx}.primary{background:#d8ef92;color:#203b31;border-radius:22rpx;font-size:28rpx;margin:20rpx 0}.primary::after{border:0}.error{color:#b94d4d;font-size:25rpx;line-height:1.7}.summary{font-size:27rpx;line-height:1.7;margin:20rpx 0;color:#203b31}.grammar{display:flex;justify-content:space-between;font-size:27rpx;color:#203b31;padding:22rpx 0;border-bottom:1rpx solid #eee}.grammar-body{font-size:27rpx;line-height:1.8;background:#f7f4fa;padding:22rpx;border-radius:16rpx}.example{display:block;color:#203b31;margin-top:16rpx}.question{margin-top:36rpx}.prompt{font-size:29rpx;font-weight:600;line-height:1.6;display:block;margin-bottom:18rpx}.option{padding:22rpx 18rpx;border:2rpx solid #eeeaf2;border-radius:18rpx;margin:14rpx 0;font-size:27rpx;color:#203b31;display:flex;align-items:baseline}.letter{margin-right:18rpx;font-weight:700}.chosen{border-color:#77877b;background:#f4effa}.correct{border-color:#62a681;background:#eff8f2}.wrong{border-color:#cb8787;background:#fff3f1}.explanation{font-size:25rpx;color:#203b31;line-height:1.7}.result{text-align:center;padding:30rpx;background:#f5f1fb;color:#203b31;border-radius:18rpx;margin-top:30rpx;font-weight:700}.machine-note{font-size:21rpx;line-height:1.7;color:#aaa;display:block;margin-top:20rpx}
</style>

<style scoped>

.study-card{background:#fff;border:1rpx solid #e5ebdc;border-radius:23rpx;padding:29rpx;margin:32rpx 0}.section-title{font-size:36rpx;font-weight:700;letter-spacing:-1rpx;color:#203b31}.caption{font-size:24rpx;color:#8b987e;line-height:1.6;margin:12rpx 0 27rpx}.primary{background:#203b31;color:#fff;font-size:25rpx;font-weight:550;border-radius:15rpx;padding:23rpx;margin-top:25rpx}.summary{color:#78896b;font-size:24rpx;line-height:1.7}.grammar{font-size:20rpx;font-weight:600;letter-spacing:.8rpx;color:#6e8559;border-color:#e9eddf;padding:24rpx 0}.grammar-body{font-size:25rpx;background:#f2f5eb;color:#6f815f;line-height:1.7;border-radius:13rpx}.example{color:#4b6540;font-family:Georgia,serif;font-size:28rpx;line-height:1.5}.prompt{font-size:27rpx;color:#2b4031;line-height:1.5;font-weight:600}.question{margin-top:35rpx}.option{font-size:24rpx;color:#6b7d5e;border-color:#e6eddd;border-radius:14rpx;padding:22rpx 19rpx;margin:12rpx 0}.chosen{background:#f0f6e3;border-color:#a3bc7f}.letter{font-size:20rpx;color:#98aa86;margin-right:16rpx}.explanation{font-size:22rpx;color:#7d8f6e;line-height:1.7;margin-top:18rpx}.result{background:#edf4df;color:#416032;border-radius:14rpx;font-size:28rpx}.machine-note{color:#a3ad98;font-size:19rpx;line-height:1.65}.error{font-size:23rpx;color:#ab6f5c}

</style>

<style scoped>

.study-card{padding:0;border:0;background:transparent;margin:42rpx 0}.section-title{font-family:ListHeading,sans-serif;font-size:38rpx;color:#246336;text-transform:uppercase;letter-spacing:.3rpx}.caption,.summary{font-size:24rpx;color:#859187;line-height:1.65}.primary{background:#27854d;color:#fff;border-radius:12rpx;font-size:23rpx;letter-spacing:.4rpx}.grammar{font-family:ListHeading,sans-serif;font-size:35rpx;color:#246336;padding:26rpx 0;border-bottom:1rpx solid #dce8df;letter-spacing:.3rpx;align-items:center;gap:15rpx}.expand-icon{border:1rpx solid #8fc2a0;border-radius:50%;font-family:Arial,sans-serif;min-width:40rpx;width:40rpx;height:40rpx;line-height:34rpx;text-align:center;font-size:30rpx;font-weight:400}.grammar-body{background:#f4faf5;border:1rpx solid #d7e8dc;color:#73917b;padding:24rpx;border-radius:12rpx;margin-top:18rpx}.grammar-name{display:block;color:#366e48;font-weight:600;margin-bottom:12rpx}.example{color:#558064}.question{background:#fff;border-bottom:1rpx solid #e2eae4;padding:8rpx 0 28rpx}.prompt{color:#46634e;font-size:26rpx}.option{border-color:#dfe9e2;color:#738b79;border-radius:12rpx}.chosen{background:#eff8f0;border-color:#86b496}.letter{color:#9ab4a2}.machine-note{font-size:19rpx;color:#a2aca5;margin-top:25rpx}.result{background:#eaf6ed;color:#4d825d}

</style>
