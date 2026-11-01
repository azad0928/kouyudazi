<template>
  <view class="container">
    <view class="search-row">
      <input class="search-input" v-model="keyword" placeholder="搜索生词" />
    </view>
    <view class="count-row">共 {{ filtered.length }} 个生词</view>
    <view v-if="!filtered.length" class="empty">还没有收藏生词<br />在文章里点紫色单词 → ☆ 即可收藏</view>
    <view v-else class="menu">
      <view v-for="w in filtered" :key="w.word + w.lessonId" class="item">
        <view class="item-main" @click="goLesson(w.lessonId)">
          <view class="word-row">
            <text class="word">{{ w.word }}</text>
            <text v-if="w.pos" class="pos">{{ w.pos }}</text>
          </view>
          <text class="meaning">{{ w.meaningCn }}</text>
          <text class="from">出自《{{ w.lessonTitle }}》</text>
        </view>
        <text class="unstar" @click.stop="unstar(w)">★</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { useVocabStore, type SavedVocab } from '@/stores/vocab'

const keyword = ref('')
const words = ref<SavedVocab[]>([])

const filtered = computed(() => {
  const k = keyword.value.trim().toLowerCase()
  if (!k) return words.value
  return words.value.filter((w) => w.word.toLowerCase().includes(k) || (w.meaningCn || '').includes(keyword.value.trim()))
})

function reload() {
  const vs = useVocabStore()
  vs.load()
  // 按收藏时间倒序
  words.value = [...vs.saved].sort((a, b) => b.savedAt - a.savedAt)
}

onShow(() => { reload() })

function unstar(w: SavedVocab) {
  const vs = useVocabStore()
  vs.toggle({ word: w.word, pos: w.pos, meaningCn: w.meaningCn, lessonId: w.lessonId, lessonTitle: w.lessonTitle })
  reload()
}

function goLesson(lessonId: string) {
  if (!lessonId) return
  uni.navigateTo({ url: `/pages/lesson/detail?id=${lessonId}` })
}
</script>

<style>
.container { min-height: 100vh; background: #f5f5f5; padding-bottom: 40rpx; }
.search-row { margin: 24rpx 32rpx 0; background: #fff; border-radius: 24rpx; padding: 8rpx 28rpx; box-shadow: 0 4rpx 16rpx rgba(0,0,0,.05); }
.search-input { height: 80rpx; font-size: 28rpx; color: #2b1b4d; }
.count-row { font-size: 24rpx; color: #aaa; margin: 20rpx 48rpx 12rpx; }
.empty { text-align: center; color: #aaa; font-size: 26rpx; margin-top: 100rpx; line-height: 2; }
.menu { margin: 0 32rpx; background: #fff; border-radius: 24rpx; overflow: hidden; box-shadow: 0 4rpx 16rpx rgba(0,0,0,.05); }
.item { display: flex; align-items: center; padding: 24rpx 32rpx; border-bottom: 1px solid #f2f2f2; }
.item:last-child { border-bottom: none; }
.item-main { flex: 1; }
.word-row { display: flex; align-items: baseline; }
.word { font-size: 32rpx; font-weight: 700; color: #2b1b4d; }
.pos { font-size: 22rpx; color: #ab47bc; margin-left: 12rpx; }
.meaning { font-size: 26rpx; color: #555; margin-top: 6rpx; display: block; }
.from { font-size: 22rpx; color: #aaa; margin-top: 6rpx; display: block; }
.unstar { font-size: 40rpx; color: #ffd60a; padding: 12rpx; }
</style>
