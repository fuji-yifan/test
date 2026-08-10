<template>
  <el-popover
    placement="bottom-end"
    :width="380"
    trigger="click"
    :show-arrow="false"
    :offset="8"
    @show="fetchList"
  >
    <template #reference>
      <el-badge
        :value="unreadCount"
        :hidden="unreadCount === 0"
        :max="99"
        class="bell-badge"
      >
        <el-button circle :class="{ active: unreadCount > 0 }">
          <el-icon :size="18"><Bell /></el-icon>
        </el-button>
      </el-badge>
    </template>

    <div class="notif-panel">
      <div class="notif-head">
        <span class="notif-head-title">消息通知</span>
        <el-button :disabled="unreadCount === 0" text size="small" @click="markAllRead">全部已读</el-button>
      </div>

      <div v-if="notifications.length === 0" class="notif-empty">
        <el-icon :size="40" color="#c0c4cc"><Bell /></el-icon>
        <p>暂无消息</p>
      </div>

      <div v-else class="notif-list">
        <div
          v-for="n in notifications.slice(0, 8)"
          :key="n.id"
          class="notif-item"
          :class="{ unread: !n.isRead }"
          @click="markRead(n)"
        >
          <span v-if="!n.isRead" class="unread-bar" />
          <el-tag :type="typeTag(n.type)" size="small" class="notif-tag">{{ typeLabel(n.type) }}</el-tag>
          <div class="notif-body">
            <div class="notif-title">{{ n.title }}</div>
            <div class="notif-content">{{ n.content }}</div>
            <div class="notif-time">{{ fmt(n.createdAt) }}</div>
          </div>
        </div>
      </div>

      <div class="notif-foot">
        <el-button text size="small" @click="goToList">查看全部消息</el-button>
      </div>
    </div>
  </el-popover>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Bell } from '@element-plus/icons-vue'
import http from '@/api/client'

const router = useRouter()
const unreadCount = ref(0)
import type { Notification } from '@/types/models'

const notifications = ref<Notification[]>([])

async function fetchUnreadCount() {
  try {
    const res = await http.get('/notifications/unread-count')
    const val = typeof res === 'number' ? res : ((res as { data?: unknown }).data ?? res)
    unreadCount.value = Number(val) || 0
  } catch { /* ignore */ }
}

async function fetchList() {
  try {
    const res = await http.get('/notifications', { params: { pageSize: 8 } })
    const data = (res as { data?: { list?: Notification[] } }).data ?? (res as { list?: Notification[] })
    notifications.value = data?.list || []
  } catch { /* ignore */ }
}

async function markRead(n: Notification) {
  if (!n.isRead) {
    try { await http.post(`/notifications/${n.id}/read`) } catch { /* ignore */ }
    n.isRead = true
    unreadCount.value = Math.max(0, unreadCount.value - 1)
  }
  if (n.relatedType === 'instance') router.push(`/instance/${n.relatedId}`)
  else if (n.relatedType === 'process') router.push('/my-processes')
}

async function markAllRead() {
  try { await http.post('/notifications/read-all') } catch { /* ignore */ }
  unreadCount.value = 0
  notifications.value.forEach(n => n.isRead = true)
}

function goToList() { router.push('/notifications') }

function typeLabel(t: string) {
  const m: Record<string, string> = { info: '信息', warning: '警告', approval: '审批', rejection: '驳回', '邀请': '邀请' }
  return m[t] || t
}
function typeTag(t: string) {
  const m: Record<string, string> = { info: 'info', warning: 'warning', approval: 'success', rejection: 'danger', '邀请': 'warning' }
  return m[t] || 'info'
}
function fmt(d: string) { return d ? new Date(d).toLocaleString('zh-CN') : '-' }

onMounted(fetchUnreadCount)
setInterval(fetchUnreadCount, 30000)
</script>

<style scoped>
.notif-panel { display: flex; flex-direction: column; }

/* 头部 */
.notif-head { display: flex; justify-content: space-between; align-items: center; padding: 0 0 12px; border-bottom: 1px solid var(--app-border-color, #ebeef5); margin-bottom: 4px; }
.notif-head-title { font-size: 15px; font-weight: 600; color: var(--app-text-primary, #303133); }

/* 空状态 */
.notif-empty { display: flex; flex-direction: column; align-items: center; padding: 32px 0 24px; gap: 10px; color: #c0c4cc; }
.notif-empty p { margin: 0; font-size: 13px; }

/* 列表 */
.notif-list { display: flex; flex-direction: column; }
.notif-item { display: flex; align-items: flex-start; gap: 10px; padding: 12px 8px; border-radius: 8px; cursor: pointer; transition: background 0.15s; position: relative; }
.notif-item:hover { background: rgba(128,128,128,0.05); }
.notif-item + .notif-item { border-top: 1px solid var(--app-border-color, #f0f0f0); }

/* 未读指示条 */
.unread-bar { position: absolute; left: 0; top: 14px; bottom: 14px; width: 3px; border-radius: 0 2px 2px 0; background: var(--el-color-primary); }

/* 标签 */
.notif-tag { flex-shrink: 0; margin-top: 2px; }

/* 正文 */
.notif-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.notif-title { font-size: 14px; font-weight: 500; color: var(--app-text-primary, #303133); line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.notif-content { font-size: 13px; color: var(--app-text-secondary, #909399); line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.notif-time { font-size: 11px; color: var(--app-text-secondary, #c0c4cc); margin-top: 1px; }

/* 未读文字加粗 */
.notif-item.unread .notif-title { font-weight: 600; }

/* 底部 */
.notif-foot { border-top: 1px solid var(--app-border-color, #ebeef5); padding-top: 8px; margin-top: 4px; text-align: center; }

/* 铃铛 */
.bell-badge { margin-right: 8px; }
.bell-badge .el-button { transition: color 0.2s; }
.bell-badge .active .el-button { color: var(--el-color-primary); }
</style>
