<template>
  <view class="container">
    <view class="tabs">
      <text
        v-for="t in tabs"
        :key="t.key"
        :class="['tab', { active: currentTab === t.key }]"
        @click="switchTab(t.key)"
      >{{ t.label }}</text>
    </view>

    <view v-if="loading" class="empty"><text>加载中…</text></view>
    <view v-else-if="records.length === 0" class="empty"><text>暂无</text></view>
    <view v-else>
      <view v-for="r in records" :key="r._id" :id="'rec-' + r._id" class="card" :class="{ focused: focusedId === r._id }">
        <view class="title">{{ r.title }}</view>
        <view class="meta">
          <text v-if="r.authorNick">作者 {{ r.authorNick }}</text>
          <text>自评 {{ r.officialLevel || '—' }}</text>
          <text>{{ formatTime(r.appliedAt) }}</text>
        </view>
        <view class="actions">
          <text class="btn ghost" @click="onPreview(r)">预览</text>
          <template v-if="currentTab === 'pending'">
            <text class="btn primary" @click="onApprove(r)">通过</text>
            <text class="btn danger" @click="onReject(r)">拒绝</text>
          </template>
          <text v-else-if="currentTab === 'approved'" class="btn danger" @click="onReject(r)">下架</text>
          <text v-else class="btn primary" @click="onApprove(r)">重新通过</text>
        </view>
      </view>
    </view>

    <view class="foot">
      <text>本机 openid（配 ADMIN_OPENIDS 用）：{{ myOpenid || '…' }}</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'

const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']
const tabs = [
  { key: 'pending', label: '待审核' },
  { key: 'approved', label: '已上架' },
  { key: 'rejected', label: '已拒绝' },
]

const currentTab = ref('pending')
const records = ref<any[]>([])
const loading = ref(false)
const myOpenid = ref('')
const focusedId = ref('') // 从消息点进来时高亮的申请

async function callApi(data: any) {
  const res: any = await wx.cloud.callFunction({ name: 'importApi', data })
  return res.result
}

async function loadList() {
  loading.value = true
  try {
    const r = await callApi({ action: 'adminList', status: currentTab.value })
    let list = r.records || []
    // 从消息点进来：把这条申请置顶并高亮
    if (focusedId.value && currentTab.value === 'pending') {
      const i = list.findIndex((x: any) => x._id === focusedId.value)
      if (i > 0) {
        const [hit] = list.splice(i, 1)
        list = [hit, ...list]
      }
    }
    records.value = list
  } catch {
    records.value = []
  } finally {
    loading.value = false
  }
  // 高亮滚动到该卡片
  if (focusedId.value && currentTab.value === 'pending') {
    const id = focusedId.value
    setTimeout(() => {
      try {
        uni.pageScrollTo({ selector: `#rec-${id}`, duration: 300 })
      } catch {}
    }, 300)
  }
}

function switchTab(key: string) {
  if (currentTab.value === key) return
  currentTab.value = key
  loadList()
}

function formatTime(ts: number) {
  if (!ts) return ''
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 预览：以管理员身份打开课程详情（所见即用户所见） */
function onPreview(r: any) {
  if (!r.lessonId) {
    uni.showToast({ title: '该记录无课程', icon: 'none' })
    return
  }
  uni.navigateTo({ url: `/pages/lesson/detail?id=${r.lessonId}` })
}

/** 通过：确认最终级别（默认用自评级别） */
async function onApprove(r: any) {
  try {
    const defIdx = Math.max(0, LEVELS.indexOf(r.officialLevel))
    const { tapIndex } = await uni.showActionSheet({ itemList: LEVELS })
    const level = LEVELS[tapIndex ?? defIdx] ?? LEVELS[defIdx]
    await callApi({ action: 'adminReview', importId: r._id, decision: 'approved', level })
    uni.showToast({ title: '已上架，+200 积分已发放', icon: 'success' })
    loadList()
  } catch {
    // 取消或失败：静默
  }
}

async function onReject(r: any) {
  try {
    await callApi({ action: 'adminReview', importId: r._id, decision: 'rejected' })
    uni.showToast({ title: currentTab.value === 'approved' ? '已下架' : '已拒绝', icon: 'none' })
    loadList()
  } catch {
    uni.showToast({ title: '操作失败', icon: 'none' })
  }
}

onLoad(async (options: any) => {
  focusedId.value = (options && options.focus) || ''
  try {
    const r = await callApi({ action: 'adminCheck' })
    myOpenid.value = r.openid || ''
    if (!r.isAdmin) {
      uni.showToast({ title: '无权限', icon: 'none' })
      setTimeout(() => uni.navigateBack(), 1200)
      return
    }
    loadList()
  } catch {
    uni.showToast({ title: '管理服务未就绪', icon: 'none' })
    setTimeout(() => uni.navigateBack(), 1200)
  }
})
</script>

<style scoped>
.container {
  padding: 24rpx;
  background-color: #f5f5f5;
  min-height: 100vh;
}
.tabs {
  display: flex;
  gap: 16rpx;
  margin-bottom: 24rpx;
}
.tab {
  padding: 12rpx 32rpx;
  border-radius: 32rpx;
  background-color: #ffffff;
  font-size: 28rpx;
  color: #666666;
}
.tab.active {
  background-color: #ffd60a;
  color: #2b1b4d;
  font-weight: bold;
}
.card.focused { border: 3rpx solid #ffd60a; box-shadow: 0 0 0 3rpx rgba(255,214,10,.35); }
.card {
  background-color: #ffffff;
  border-radius: 16rpx;
  padding: 24rpx;
  margin-bottom: 20rpx;
}
.title {
  font-size: 32rpx;
  font-weight: bold;
  color: #2b1b4d;
  margin-bottom: 12rpx;
}
.meta {
  display: flex;
  flex-wrap: wrap;
  gap: 16rpx;
  font-size: 24rpx;
  color: #999999;
  margin-bottom: 16rpx;
}
.actions {
  display: flex;
  gap: 16rpx;
}
.btn {
  font-size: 26rpx;
  padding: 10rpx 28rpx;
  border-radius: 28rpx;
}
.btn.ghost {
  background-color: #f2f2f2;
  color: #2b1b4d;
}
.btn.primary {
  background-color: #ffd60a;
  color: #2b1b4d;
}
.btn.danger {
  background-color: #ffffff;
  color: #e64340;
  border: 2rpx solid #e64340;
}
.empty {
  text-align: center;
  color: #999999;
  padding: 80rpx 0;
  font-size: 28rpx;
}
.foot {
  margin-top: 40rpx;
  font-size: 22rpx;
  color: #bbbbbb;
  text-align: center;
  padding: 0 24rpx;
}
</style>
