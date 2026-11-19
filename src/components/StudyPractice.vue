<template>
 <view class="study-card" :class="{'has-content':!!content}">
  <view class="course-practice-entry"><view class="course-entry-copy"><view class="section-title">课程巩固练习</view><text class="caption">做几道小题，巩固这节课的学习收获。</text></view><button v-if="!content" class="course-entry-button" :loading="loading" :disabled="loading" @click="prepare">{{loading?'正在准备练习…':'开始课程练习'}}</button></view>
  <view v-if="error" class="error">{{error}}<text @click="prepare"> · 点击重试</text></view>
  <view v-if="content" class="practice-content">
   <view v-if="content.summary" class="summary"><text class="summary-label">课程概述</text><text>{{content.summary}}</text></view>
   <view class="grammar" @click="grammarOpen=!grammarOpen"><text>语法要点</text><text class="expand-icon">{{grammarOpen?'−':'+'}}</text></view>
   <view v-if="grammarOpen" class="grammar-body"><text class="grammar-name">{{content.grammar.title}}</text><text>{{content.grammar.explanation}}</text><text class="example">{{content.grammar.example}}</text></view>
   <view class="grammar" @click="questionsOpen=!questionsOpen"><text>听力理解</text><text class="expand-icon">{{questionsOpen?'−':'+'}}</text></view>
   <template v-if="questionsOpen"><view v-for="(q,i) in content.questions" :key="i" class="question">
    <text class="prompt">{{Number(i)+1}}. {{q.prompt}}</text>
    <view v-for="(option,n) in q.options" :key="n" class="option" :class="{chosen:answers[i]===n,correct:submitted&&q.answer===n,wrong:submitted&&answers[i]===n&&q.answer!==n}" @click="choose(Number(i),Number(n))"><text class="letter">{{letters[n]}}</text>{{option}}</view>
    <view v-if="submitted" class="explanation">{{answers[i]===q.answer?'✓ 回答正确':'再听一遍试试'}} · {{q.explanation}}</view>
   </view>
   <view v-if="submitted" class="result">{{correct}} / {{content.questions.length}} 题正确 · {{Math.round(correct/content.questions.length*100)}}%</view>
   <button class="primary" :disabled="!submitted&&answered!==content.questions.length" @click="submit">{{submitted?'再练一次':`核对答案（${answered}/${content.questions.length}）`}}</button>
   </template><text class="machine-note">{{content.source==='website'?'练习内容来自原课程。':'练习由 AI 辅助生成，仅供学习参考。'}}</text>
  </view>
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
const assessmentCacheKey='assessment_zh_v2_'+props.lesson.id+(props.lesson.contentVersion?'_'+props.lesson.contentVersion:'');
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
    error.value = '练习暂未加载，请稍后重试。';
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
.study-card{margin:14px 0 24px;padding:0;background:#fff;border:1px solid #cfe4d7;border-radius:15px;overflow:hidden;box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;color:#698272}
.course-practice-entry{display:flex;align-items:center;gap:14px;background:#f1f8f4;padding:18px;box-sizing:border-box}.course-entry-copy{flex:1;min-width:0}.section-title{font-family:inherit;font-size:18px;font-weight:600;line-height:1.5;letter-spacing:0;color:#246b3d}.caption{display:block;font-size:12px;line-height:1.8;color:#89a091;margin-top:6px}
.course-entry-button,.primary{display:flex;align-items:center;justify-content:center;gap:7px;min-height:44px;box-sizing:border-box;margin:0;padding:0 13px;border:0;border-radius:10px;background:#27854d;color:#fff;font-family:inherit;font-size:13px;font-weight:500;line-height:1.6;letter-spacing:0}.course-entry-button{flex-shrink:0;min-width:88px}.course-entry-button::after,.primary::after{border:0}.course-entry-button[disabled],.primary[disabled]{opacity:.55}
.practice-content{padding:0 18px}.summary{display:flex;flex-direction:column;gap:6px;padding:18px 0;border-bottom:1px solid #deebe2;font-size:13px;line-height:1.85;color:#8c9b91;overflow-wrap:break-word}.summary-label{font-size:12px;line-height:1.6;font-weight:600;color:#698272}
.grammar{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:58px;padding:14px 0;box-sizing:border-box;border-bottom:1px solid #deebe2;color:#2b7043;font-size:15px;font-weight:600;line-height:1.5;letter-spacing:0}.expand-icon{display:flex;align-items:center;justify-content:center;flex:0 0 22px;width:22px;height:22px;box-sizing:border-box;border:1px solid #9bc9ac;border-radius:50%;color:#55996d;font-size:19px;font-weight:400;line-height:1}
.grammar-body{padding:14px;margin:12px 0 8px;border-radius:10px;background:#f3f9f5;font-size:13px;line-height:1.85;color:#82958a;overflow-wrap:break-word}.grammar-name{display:block;font-size:14px;line-height:1.6;font-weight:600;color:#3a7951;margin-bottom:6px}.example{display:block;font-family:Georgia,serif;font-size:14px;line-height:1.8;color:#688071;margin-top:10px}
.question{padding:17px 0;border-bottom:1px solid #e5eee8}.prompt{display:block;font-size:14px;font-weight:500;line-height:1.75;color:#46674f;margin-bottom:12px}.option{display:flex;align-items:baseline;gap:10px;border:1px solid #dce8e0;border-radius:9px;margin:9px 0;padding:11px 12px;font-size:13px;line-height:1.7;color:#7e9285;overflow-wrap:break-word}.letter{flex-shrink:0;font-size:11px;font-weight:600;color:#9db4a5}.chosen{background:#f0f8f2;border-color:#8bb69a}.correct{background:#edf8f0;border-color:#69ab7f}.wrong{background:#fff4f1;border-color:#cf978d}.explanation{font-size:12px;line-height:1.8;margin-top:12px;color:#859a8d}.result{margin:16px 0;padding:12px;text-align:center;background:#eef7f1;border-radius:9px;font-size:14px;font-weight:600;line-height:1.7;color:#3e8054}.practice-content .primary{width:100%;margin:16px 0}
.machine-note{display:block;border-top:0;font-size:10px;line-height:1.8;color:#a1afa6;margin-top:0;padding:14px 0 17px}.error{font-size:12px;line-height:1.8;padding:12px 18px;color:#af786e}
@media(max-width:350px){.course-practice-entry{padding:15px;gap:10px}.practice-content{padding:0 15px}.section-title{font-size:17px}.course-entry-button{min-width:78px;padding:0 10px}}
</style>

<style scoped>
.study-card{background:transparent;border:0;border-radius:0;overflow:visible;margin:22px 0 24px}.course-practice-entry{background:transparent;padding:0 0 14px;gap:14px}.practice-content{padding:0}.grammar-body{background:transparent;border:0;border-radius:0;padding:10px 0;margin:0 0 8px}.error{padding:10px 0}@media(max-width:350px){.course-practice-entry{padding:0 0 14px}.practice-content{padding:0}}
</style>

<style scoped>
.course-practice-entry{display:block;background:transparent;padding:0 0 8px}.course-practice-entry .section-title{font-size:20px;font-weight:600;line-height:1.5;color:#246b3d}.course-practice-entry .caption{font-size:13px;line-height:1.8;margin-top:12px;color:#89968d}.course-practice-entry .course-entry-button{display:flex;width:100%;min-height:48px;margin:22px 0 0;padding:12px 18px;border-radius:10px;background:#27854d;color:#fff;font-size:14px;font-weight:600;line-height:1.6;letter-spacing:0}@media(max-width:350px){.course-practice-entry{padding:0 0 8px}.course-practice-entry .section-title{font-size:19px}.course-practice-entry .course-entry-button{width:100%;padding:12px 18px}}
</style>
