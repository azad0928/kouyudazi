<template>
  <view class="container">
    <view class="count-row">共 {{ list.length }} 篇收藏</view>
    <view v-if="loading" class="empty">加载中…</view>
    <view v-else-if="!list.length" class="empty">还没有收藏文章<br />在文章详情页点 🤍 即可收藏</view>
    <view v-else class="cards">
      <view v-for="f in list" :key="f._id" class="card" @click="goDetail(f.lessonId)">
        <image class="card-img" :src="coverSrc(f.cover)" mode="aspectFill" @error="onCoverError(f.cover)" />
        <view class="card-body">
          <text class="card-title">{{ f.title }}</text>
          <text v-if="f.level" class="card-level">{{ f.level }}</text>
        </view>
        <text class="unfav" @click.stop="unfav(f)">❤️</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { COVER_URLS_CACHE_KEY, coverUrlFresh, localCover } from '@/utils/cover'

const list = ref<any[]>([])
const loading = ref(true)
const coverUrlMap = ref<Record<string, string>>({})
// 失败次数 >1 判定为「云存储文件缺失」，改用本地兜底图（换地址救不回来）
const coverFailCount = ref<Record<string, number>>({})

function coverSrc(src: string | undefined | null): string {
  if (!src) return localCover('')
  if (!src.startsWith('cloud://')) return src
  if ((coverFailCount.value[src] || 0) > 1) return localCover(src)
  return coverUrlMap.value[src] || ''
}

function onCoverError(src: string | undefined | null) {
  if (!src || !src.startsWith('cloud://')) return
  const n = (coverFailCount.value[src] || 0) + 1
  coverFailCount.value = { ...coverFailCount.value, [src]: n }
  if (n > 1) return
  const next: Record<string, string> = {}
  for (const k of Object.keys(coverUrlMap.value)) {
    if (k !== src) next[k] = coverUrlMap.value[k]
  }
  coverUrlMap.value = next
  ensureCoverUrls()
}

/** 复用首页的封面地址缓存（同一 key），批量换临时地址 */
async function ensureCoverUrls() {
  try {
    const c: any = uni.getStorageSync(COVER_URLS_CACHE_KEY)
    // 按链接自身的 t（签发时刻）过滤：缓存里过期的地址一律丢弃，
    // 否则「缓存还在、链接已死」，收藏页会整片白图
    if (c && c.urls) {
      const alive: Record<string, string> = {}
      for (const k of Object.keys(c.urls)) {
        if (c.urls[k] && coverUrlFresh(c.urls[k])) alive[k] = c.urls[k]
      }
      coverUrlMap.value = alive
    }
  } catch {}
  const ids = new Set<string>()
  for (const f of list.value) {
    if (f.cover && f.cover.startsWith('cloud://') && !coverUrlMap.value[f.cover]) ids.add(f.cover)
  }
  if (ids.size === 0) return
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
      try { uni.setStorageSync(COVER_URLS_CACHE_KEY, { at: Date.now(), urls: coverUrlMap.value }) } catch {}
    }
  } catch {}
}

async function load() {
  loading.value = true
  try {
    const r: any = await wx.cloud.callFunction({ name: 'userApi', data: { action: 'listFavorites' } })
    list.value = (r.result && r.result.list) || []
    await ensureCoverUrls()
  } catch {} finally {
    loading.value = false
  }
}

onShow(() => { load() })

function goDetail(lessonId: string) {
  if (!lessonId) return
  uni.navigateTo({ url: `/pages/lesson/detail?id=${lessonId}` })
}

async function unfav(f: any) {
  try {
    await wx.cloud.callFunction({
      name: 'userApi',
      data: { action: 'toggleFavorite', lessonId: f.lessonId },
    })
    list.value = list.value.filter((x) => x._id !== f._id)
    uni.showToast({ title: '已取消收藏', icon: 'none' })
  } catch {
    uni.showToast({ title: '操作失败，请重试', icon: 'none' })
  }
}
</script>

<style>
.container { min-height: 100vh; background: #f5f5f5; padding-bottom: 40rpx; }
.count-row { font-size: 24rpx; color: #aaa; margin: 24rpx 48rpx 12rpx; }
.empty { text-align: center; color: #aaa; font-size: 26rpx; margin-top: 100rpx; line-height: 2; }
.cards { margin: 0 32rpx; }
.card { display: flex; align-items: center; background: #fff; border-radius: 24rpx; padding: 24rpx; margin-bottom: 20rpx; box-shadow: 0 4rpx 16rpx rgba(0,0,0,.05); }
.card-img { width: 140rpx; height: 100rpx; border-radius: 14rpx; background: #eee; flex-shrink: 0; }
.card-body { flex: 1; margin-left: 24rpx; display: flex; flex-direction: column; }
.card-title { font-size: 28rpx; font-weight: 700; color: #2b1b4d; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.card-level { font-size: 22rpx; color: #ab47bc; margin-top: 8rpx; }
.unfav { font-size: 36rpx; padding: 12rpx; }
</style>
