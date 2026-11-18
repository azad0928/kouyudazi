<template>
 <view class="container">
  <text class="page-note">核对课程内容、分类和等级后，再选择上架。</text>
  <view class="tabs"><button v-for="t in tabs" :key="t.key" class="tab" :class="{active:currentTab===t.key}" :aria-pressed="currentTab===t.key" @click="switchTab(t.key)">{{t.label}}</button></view>
  <view v-if="loading" class="empty"><text>正在加载课程…</text></view>
  <view v-else-if="loadError" class="empty error"><text>{{loadError}}</text><button @click="loadList">重新加载</button></view>
  <view v-else-if="!records.length" class="empty"><text>{{currentTab==='pending'?'暂无待审核课程':currentTab==='approved'?'暂无已上架课程':'暂无未通过的课程'}}</text></view>
  <view v-else>
   <view v-for="r in records" :key="r._id" :id="'rec-'+r._id" class="card" :class="{focused:focusedId===r._id}">
    <text class="title">{{r.title}}</text>
    <view class="meta"><text class="author">提交者 · {{r.authorNick||'未设置昵称'}}</text><text class="level-badge">{{r.officialLevel||'待定级'}}</text></view>
    <text class="record-date">申请时间 · {{formatTime(r.appliedAt)||'—'}}</text>
    <button class="topic-editor" @click="setTopic(r)"><view class="topic-copy"><text class="topic-label">课程分类</text><text class="topic-name">{{topicLabel(r.topic)}}</text></view><text class="topic-edit">修改 ›</text></button>
    <view class="actions" :class="{'two-actions':currentTab!=='pending'}">
     <button class="btn ghost" @click="onPreview(r)">预览课程</button>
     <template v-if="currentTab==='pending'"><button class="btn primary" @click="onApprove(r)">通过上架</button><button class="btn danger" @click="onReject(r)">不通过</button></template>
     <button v-else-if="currentTab==='approved'" class="btn danger" @click="onReject(r)">下架课程</button>
     <button v-else class="btn primary" @click="onApprove(r)">重新上架</button>
    </view>
   </view>
  </view>
  <view class="foot"><text>课程审核 · 仅管理员可见</text></view>
 </view>
</template>

<script setup lang="ts">
import {TOPICS} from '@/utils/catalogue'
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'

const topicNames:Record<string,string>={health:'健康与生活',history:'历史与文化',news:'新闻与生活',psychology:'心理与思维',science:'科学与科技',stories:'故事',other:'其他'}
function topicLabel(key:string){return topicNames[key]||'其他'}
async function setTopic(r:any){try{const choice=await uni.showActionSheet({itemList:TOPICS.map(t=>topicLabel(t.key))});const topic=TOPICS[choice.tapIndex].key;await callApi({action:'adminMetadata',importId:r._id,topic});r.topic=topic;uni.showToast({title:'分类已更新',icon:'success'});uni.setStorageSync('refreshPublished',1)}catch(e:any){if(!String(e?.errMsg||'').includes('cancel'))uni.showToast({title:'分类更新失败，请重试',icon:'none'})}}
const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']
const tabs = [
  { key: 'pending', label: '待审核' },
  { key: 'approved', label: '已上架' },
  { key: 'rejected', label: '未通过' },
]

const currentTab = ref('pending')
const records = ref<any[]>([])
const loading = ref(false)
const loadError = ref('')
const focusedId = ref('') // 从消息点进来时高亮的申请

async function callApi(data: any) {
  const res: any = await wx.cloud.callFunction({ name: 'importApi', data })
  return res.result
}

async function loadList() {
  loading.value = true
  loadError.value = ''
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
    loadError.value = '列表加载失败，请稍后重试'
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
    uni.showToast({ title: '课程尚未生成，暂时无法预览', icon: 'none' })
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
    uni.showToast({ title: '审核通过，课程已上架', icon: 'success' })
    try { uni.setStorageSync('refreshPublished', '1') } catch {}
    loadList()
  } catch (e:any) {
    if(!/cancel/i.test(String(e?.errMsg||e?.message||'')))uni.showToast({title:'上架失败，请稍后重试',icon:'none'})
  }
}

async function onReject(r: any) {
  try {
    await callApi({ action: 'adminReview', importId: r._id, decision: 'rejected' })
    uni.showToast({ title: currentTab.value === 'approved' ? '课程已下架' : '已标记为未通过', icon: 'none' })
    try { uni.setStorageSync('refreshPublished', '1') } catch {}
    loadList()
  } catch {
    uni.showToast({ title: '操作失败，请稍后重试', icon: 'none' })
  }
}

onLoad(async (options: any) => {
  uni.setNavigationBarTitle({title:'课程审核'})
  focusedId.value = (options && options.focus) || ''
  try {
    const r = await callApi({ action: 'adminCheck' })
    if (!r.isAdmin) {
      uni.showToast({ title: '此页面仅限管理员访问', icon: 'none' })
      setTimeout(() => uni.navigateBack(), 1200)
      return
    }
    loadList()
  } catch {
    uni.showToast({ title: '此页面仅限管理员访问', icon: 'none' })
    setTimeout(() => uni.navigateBack(), 1200)
  }
})
</script>

<style scoped>
.container{min-height:100vh;box-sizing:border-box;padding:18px 17px calc(40px + env(safe-area-inset-bottom));background:#faf9fc;color:#281247;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Helvetica Neue',Arial,sans-serif}
button{font-family:inherit;margin:0;box-sizing:border-box;border:0;box-shadow:none;letter-spacing:0}button::after{border:0}
.page-note{display:block;margin:0 2px 16px;color:#9a88a9;font-size:12px;line-height:1.8}
.tabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px;padding:4px;margin-bottom:16px;background:#eee8f5;border:1px solid #e9e0f1;border-radius:13px}
.tab{display:flex;align-items:center;justify-content:center;min-height:40px;padding:8px 6px;font-size:14px;font-weight:500;line-height:1.5;background:transparent;color:#9a87ab;border-radius:9px;white-space:nowrap}
.tab.active{background:#fff;color:#281247;font-weight:600;box-shadow:0 2px 6px rgba(49,24,68,.05)}
.card{padding:18px 16px 16px;border:1px solid #e8dfef;border-radius:15px;background:#fff;margin:0 0 15px;box-sizing:border-box}
.card.focused{border-color:#d0b9e7;box-shadow:0 0 0 2px rgba(255,207,0,.22)}
.title{display:block;color:#33203f;font-size:20px;font-weight:600;line-height:1.45;letter-spacing:0;word-break:normal;overflow-wrap:break-word;margin:0 0 11px}
.meta{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:12px;line-height:1.5;color:#8c789c}
.author{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.level-badge{flex:none;padding:3px 9px;background:#f3edf9;border:1px solid #e9def3;border-radius:7px;font-size:11px;font-weight:600;color:#73518c;line-height:1.4}
.record-date{display:block;font-size:11px;color:#b09ebc;line-height:1.7;margin-top:6px;font-variant-numeric:tabular-nums}
.topic-editor{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;min-height:46px;margin-top:16px;padding:11px 12px;background:#f7f2fc;border-radius:10px;text-align:left;line-height:1.5}
.topic-copy{display:flex;align-items:center;flex-wrap:wrap;gap:5px 10px;flex:1;min-width:0}.topic-label{font-size:11px;color:#ac97bb}.topic-name{font-size:13px;color:#705285;font-weight:500;word-break:normal;overflow-wrap:break-word}.topic-edit{flex:none;font-size:12px;color:#8f74a4}
.actions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:16px;padding-top:15px;border-top:1px solid #f0e9f5}.actions.two-actions{grid-template-columns:repeat(2,minmax(0,1fr))}
.actions .btn{display:flex;align-items:center;justify-content:center;min-width:0;min-height:42px;padding:9px 5px;border-radius:10px;font-size:13px;font-weight:500;line-height:1.5;white-space:nowrap}
.actions .ghost{background:#f2edf8;color:#77558f;border:1px solid #ebe2f3}.actions .primary{background:#ffcf00;color:#281247;font-weight:600;border:1px solid #ffcf00}.actions .danger{background:#fffafb;color:#b95c75;border:1px solid #efd5dd}
.empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:46px 18px;border:1px solid #ece3f3;border-radius:14px;background:#fff;font-size:13px;line-height:1.8;color:#a28db2;text-align:center}.empty button{padding:9px 20px;border-radius:9px;background:#eee6f7;color:#70508b;font-size:13px;line-height:1.5}.error{color:#b16c86}
.foot{margin-top:22px;padding:0 12px;text-align:center;font-size:10px;color:#baabc4;line-height:1.8;letter-spacing:0}
@media(max-width:350px){.container{padding-left:14px;padding-right:14px}.card{padding-left:14px;padding-right:14px}.title{font-size:19px}.actions{gap:6px}.actions .btn{font-size:12px}.tab{font-size:13px}}
</style>
