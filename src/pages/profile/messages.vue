<template>
  <view class="container">
    <!-- 管理员：待审核申请入口（替代 5 连点头像手势） -->
    <view v-if="isAdmin" class="admin-card" @click="goReview">
      <text class="admin-ico">📋</text>
      <view class="admin-main">
        <text class="admin-title">上架申请审核</text>
        <text class="admin-sub">{{ pendingCount }} 条待审核</text>
      </view>
      <text class="arrow">›</text>
    </view>

    <view class="sec-row">
      <view class="sec">最近消息</view>
      <text v-if="hasUnread" class="read-all" @click="onMarkAllRead">{{ markingAll ? '处理中…' : '全部已读' }}</text>
    </view>
    <view v-if="loading" class="empty">加载中…</view>
    <view v-else-if="!messages.length" class="empty">暂无消息</view>
    <view v-else class="menu">
      <view v-for="m in messages" :key="m._id" class="item" @click="onMsgTap(m)">
        <text class="msg-ico">{{ iconFor(m.type) }}</text>
        <view class="msg-main">
          <view class="msg-title-row">
            <text class="msg-title">{{ m.title }}</text>
            <text v-if="!m.read" class="unread-dot" />
          </view>
          <text class="msg-content">{{ m.content }}</text>
          <text class="msg-date">{{ formatDate(m.createdAt) }}</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { onShow } from '@dcloudio/uni-app'

const messages = ref<any[]>([])
const loading = ref(true)
const isAdmin = ref(false)
const pendingCount = ref(0)
const markingAll = ref(false)
const hasUnread = computed(() => messages.value.some((m: any) => !m.read))

/** 全部已读：云函数 markMessagesRead 不传 ids 即标全部（带 _openid 条件，只能标自己的）。
 * 标完后红点消失；首页/个人中心角标在返回时由各自的 onShow → refreshUnread 自动刷新 */
async function onMarkAllRead() {
  if (markingAll.value) return
  markingAll.value = true
  try {
    await wx.cloud.callFunction({ name: 'userApi', data: { action: 'markMessagesRead' } })
    messages.value = messages.value.map((m: any) => ({ ...m, read: true }))
    uni.showToast({ title: '已全部标记为已读', icon: 'none' })
  } catch {
    uni.showToast({ title: '操作失败，请重试', icon: 'none' })
  } finally {
    markingAll.value = false
  }
}

function iconFor(type: string): string {
  if (type === 'official_approved') return '✅'
  if (type === 'official_rejected') return '❌'
  if (type === 'official_applied') return '📥'
  if (type === 'official_submitted') return '📤'
  return '📢'
}

function formatDate(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const dstr = `${d.getFullYear()}-${m}-${day}`
  return dstr === today ? `今天 ${hm}` : `${dstr} ${hm}`
}

async function load() {
  loading.value = true
  // 管理员身份 + 待审核数
  try {
    const chk: any = await wx.cloud.callFunction({ name: 'importApi', data: { action: 'adminCheck' } })
    isAdmin.value = !!(chk.result && chk.result.isAdmin)
    if (isAdmin.value) {
      try {
        const pl: any = await wx.cloud.callFunction({ name: 'importApi', data: { action: 'adminList', status: 'pending' } })
        pendingCount.value = ((pl.result && pl.result.records) || []).length
      } catch {}
    }
  } catch {}
  // 消息列表
  try {
    const r: any = await wx.cloud.callFunction({ name: 'userApi', data: { action: 'listMessages' } })
    messages.value = (r.result && r.result.list) || []
  } catch {} finally {
    loading.value = false
  }
}

onShow(() => { load() })

async function onMsgTap(m: any) {
  if (!m.read) {
    m.read = true
    try {
      await wx.cloud.callFunction({ name: 'userApi', data: { action: 'markMessagesRead', ids: [m._id] } })
    } catch {}
  }
  // 管理员点“有新的上架申请”：直达审核页并定位到这条申请
  if (m.type === 'official_applied') {
    if (isAdmin.value && m.relatedId) {
      uni.navigateTo({ url: `/pages/admin/review?focus=${m.relatedId}` })
      return
    }
    uni.showToast({ title: '当前账号无审核权限', icon: 'none' })
    return
  }
  // 上传者视角（已提交 / 已通过 / 已拒绝）：打开对应文章预览
  if (m.relatedId) {
    try {
      const r: any = await wx.cloud.callFunction({ name: 'importApi', data: { action: 'list' } })
      const hit = ((r.result && r.result.records) || []).find((x: any) => x._id === m.relatedId)
      if (hit && hit.lessonId) {
        uni.navigateTo({ url: `/pages/lesson/detail?id=${hit.lessonId}` })
        return
      }
    } catch {}
  }
  // 兜底：任何消息点了都要有反馈，不能“点了没反应”
  uni.showToast({
    title: m.type === 'official_submitted' ? '审核中，请耐心等待' : '暂无可查看的内容',
    icon: 'none',
  })
}

function goReview() {
  uni.navigateTo({ url: '/pages/admin/review' })
}
</script>

<style>
.container { min-height: 100vh; background: #f5f5f5; padding-bottom: 40rpx; }
.admin-card { display: flex; align-items: center; background: #2b1b4d; border-radius: 24rpx; margin: 24rpx 32rpx 0; padding: 30rpx 32rpx; box-shadow: 0 4rpx 16rpx rgba(0,0,0,.1); }
.admin-ico { font-size: 44rpx; margin-right: 20rpx; }
.admin-main { flex: 1; display: flex; flex-direction: column; }
.admin-title { font-size: 30rpx; font-weight: 700; color: #fff; }
.admin-sub { font-size: 24rpx; color: #ffd60a; margin-top: 6rpx; }
.admin-card .arrow { color: rgba(255,255,255,.6); font-size: 28rpx; }
.sec-row { display: flex; align-items: center; justify-content: space-between; margin: 36rpx 48rpx 16rpx; }
.sec { font-size: 24rpx; color: #aaa; }
.read-all { font-size: 24rpx; color: #2b1b4d; background-color: #efe9f7; border-radius: 24rpx; padding: 6rpx 20rpx; }
.empty { text-align: center; color: #aaa; font-size: 26rpx; margin-top: 80rpx; }
.menu { margin: 0 32rpx; background: #fff; border-radius: 24rpx; overflow: hidden; box-shadow: 0 4rpx 16rpx rgba(0,0,0,.05); }
.item { display: flex; padding: 28rpx 32rpx; border-bottom: 1px solid #f2f2f2; }
.item:last-child { border-bottom: none; }
.msg-ico { font-size: 36rpx; margin-right: 20rpx; margin-top: 4rpx; }
.msg-main { flex: 1; display: flex; flex-direction: column; }
.msg-title-row { display: flex; align-items: center; }
.msg-title { font-size: 28rpx; font-weight: 700; color: #2b1b4d; }
.unread-dot { width: 16rpx; height: 16rpx; border-radius: 50%; background: #fa5151; margin-left: 12rpx; }
.msg-content { font-size: 26rpx; color: #555; margin-top: 8rpx; line-height: 1.6; }
.msg-date { font-size: 22rpx; color: #aaa; margin-top: 8rpx; }
</style>
