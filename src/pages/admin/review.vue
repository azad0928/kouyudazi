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

    <view v-if="loading" class="empty"><text>Loading…</text></view>
    <view v-else-if="records.length === 0" class="empty"><text>Nothing here yet</text></view>
    <view v-else>
      <view v-for="r in records" :key="r._id" :id="'rec-' + r._id" class="card" :class="{ focused: focusedId === r._id }">
        <view class="title">{{ r.title }}</view>
        <view class="meta">
          <text v-if="r.authorNick">By {{ r.authorNick }}</text>
          <text>Level {{ r.officialLevel || '—' }}</text>
          <text>{{ formatTime(r.appliedAt) }}</text>
        </view>
        <view class="topic-editor" @click="setTopic(r)">Topic: {{topicLabel(r.topic)}} · Edit</view>
        <view class="actions">
          <text class="btn ghost" @click="onPreview(r)">Preview</text>
          <template v-if="currentTab === 'pending'">
            <text class="btn primary" @click="onApprove(r)">Approve</text>
            <text class="btn danger" @click="onReject(r)">Reject</text>
          </template>
          <text v-else-if="currentTab === 'approved'" class="btn danger" @click="onReject(r)">Unpublish</text>
          <text v-else class="btn primary" @click="onApprove(r)">Approve again</text>
        </view>
      </view>
    </view>

    <view class="foot">
      <text>Administrator identifier: {{ myOpenid || '…' }}</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import {TOPICS} from '@/utils/catalogue'
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'

function topicLabel(key:string){return TOPICS.find(t=>t.key===key)?.label||'More'}
async function setTopic(r:any){try{const choice=await uni.showActionSheet({itemList:TOPICS.map(t=>t.label)});const topic=TOPICS[choice.tapIndex].key;await callApi({action:'adminMetadata',importId:r._id,topic});r.topic=topic;uni.showToast({title:'Topic updated',icon:'success'});uni.setStorageSync('refreshPublished',1)}catch(e:any){if(!String(e?.errMsg||'').includes('cancel'))uni.showToast({title:'Unable to update topic',icon:'none'})}}
const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']
const tabs = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Published' },
  { key: 'rejected', label: 'Rejected' },
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

/** Preview：以管理员身份打开Listening room（所见即用户所见） */
function onPreview(r: any) {
  if (!r.lessonId) {
    uni.showToast({ title: 'No lesson is attached', icon: 'none' })
    return
  }
  uni.navigateTo({ url: `/pages/lesson/detail?id=${r.lessonId}` })
}

/** Approve：确认最终级别（默认用自评级别） */
async function onApprove(r: any) {
  try {
    const defIdx = Math.max(0, LEVELS.indexOf(r.officialLevel))
    const { tapIndex } = await uni.showActionSheet({ itemList: LEVELS })
    const level = LEVELS[tapIndex ?? defIdx] ?? LEVELS[defIdx]
    await callApi({ action: 'adminReview', importId: r._id, decision: 'approved', level })
    uni.showToast({ title: 'Published. 200 points awarded.', icon: 'success' })
    try { uni.setStorageSync('refreshPublished', '1') } catch {}
    loadList()
  } catch {
    // Cancel或Failed: 静默
  }
}

async function onReject(r: any) {
  try {
    await callApi({ action: 'adminReview', importId: r._id, decision: 'rejected' })
    uni.showToast({ title: currentTab.value === 'approved' ? 'Unpublished' : 'Rejected', icon: 'none' })
    try { uni.setStorageSync('refreshPublished', '1') } catch {}
    loadList()
  } catch {
    uni.showToast({ title: 'Unable to complete this action', icon: 'none' })
  }
}

onLoad(async (options: any) => {
  focusedId.value = (options && options.focus) || ''
  try {
    const r = await callApi({ action: 'adminCheck' })
    myOpenid.value = r.openid || ''
    if (!r.isAdmin) {
      uni.showToast({ title: 'Access unavailable', icon: 'none' })
      setTimeout(() => uni.navigateBack(), 1200)
      return
    }
    loadList()
  } catch {
    uni.showToast({ title: 'Access unavailable', icon: 'none' })
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
  background-color: #d8ef92;
  color: #203b31;
  font-weight: bold;
}
.card.focused { border: 3rpx solid #d8ef92; box-shadow: 0 0 0 3rpx rgba(255,214,10,.35); }
.card {
  background-color: #ffffff;
  border-radius: 16rpx;
  padding: 24rpx;
  margin-bottom: 20rpx;
}
.title {
  font-size: 32rpx;
  font-weight: bold;
  color: #203b31;
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
  color: #203b31;
}
.btn.primary {
  background-color: #d8ef92;
  color: #203b31;
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
<style scoped>.topic-editor{font-size:24rpx;color:#77877b;background:#f5edf9;padding:16rpx 20rpx;border-radius:14rpx;margin-top:20rpx}</style>
<style scoped>
.container,.settings,.history{background:#f8f9f5;min-height:100vh;padding:30rpx 30rpx 80rpx}.intro-title,.title{font-family:inherit;color:#203b31;font-size:49rpx;font-weight:700;letter-spacing:-1.5rpx;line-height:1.12;white-space:pre-line}.intro-desc,.intro-note{color:#8c9b7e;font-size:24rpx;line-height:1.65}.card,.quota-card,.buy-card,.file-card,.import-record,.menu,.balance{background:#fff;border:1rpx solid #e4ebd9;border-radius:21rpx;box-shadow:none;padding:27rpx}.heading,.quota-title,.buy-title{font-size:28rpx;font-weight:650;letter-spacing:-.4rpx;color:#3b5634}.sec{font-size:19rpx;letter-spacing:1.4rpx;color:#93a182}.note,.quota-note,.buy-note,.step,.quota-text,.meta,.sync{font-size:23rpx;line-height:1.7;color:#8a9c77}.row,.item{font-size:25rpx;color:#5b754b;border-color:#edf1e5;min-height:94rpx}.step text:first-child{color:#4f703e}.primary,.pick-btn,.upload-btn,.save-btn,.back,.learn-btn{background:#203b31;color:#fff;border-radius:15rpx;font-size:25rpx;padding:24rpx;font-family:inherit}.feedback,.back-btn,.redeem-btn,.buy-btn{background:#eaf1d9;color:#5a7641;border-radius:14rpx;font-size:24rpx}.empty{background:#f0f4e6;color:#8c9d7b;border-radius:21rpx;font-size:25rpx;line-height:1.7;padding:60rpx 28rpx}.name,.record-title{font-family:inherit;font-size:30rpx;color:#3f5c35;font-weight:600;line-height:1.4}.nick-input,.search{background:#fff;border:1rpx solid #dde7d1;border-radius:15rpx;font-size:26rpx;padding:23rpx}.count-row,.stats{font-size:23rpx;color:#8a9b79}.filters .active,.active{color:#496939}.track{background:#eaf0df}.track view{background:#a5be75}.version{color:#a7b298;font-size:18rpx;letter-spacing:2rpx}.preview{background:#f5f7ef;border-radius:14rpx;color:#80956b}.import-intro{margin:5rpx 0 32rpx}.intro-note{font-size:21rpx;color:#a1ad93}.balance-num{color:#46653a}.unit{font-size:22rpx}.buy-name{font-size:27rpx;color:#4f6d3f}.buy-desc{font-size:22rpx;color:#92a37e}
</style>
