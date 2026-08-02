<template>
  <el-popover
    placement="bottom-end"
    :width="360"
    trigger="click"
    @show="fetchList"
  >
    <template #reference>
      <el-badge
        :value="unreadCount"
        :hidden="unreadCount === 0"
        :max="99"
        class="bell-badge"
      >
        <el-button circle>
          <el-icon :size="18">
            <ChatDotRound />
          </el-icon>
        </el-button>
      </el-badge>
    </template>
    <div
      v-if="notifications.length === 0"
      style="text-align:center;padding:20px;color:#999"
    >
      暂无新通知
    </div>
    <div
      v-else
      class="notif-popover"
    >
      <div
        v-for="n in notifications.slice(0, 8)"
        :key="n.id"
        class="notif-item"
        :class="{ unread: !n.isRead }"
        @click="markRead(n)"
      >
        <span
          v-if="!n.isRead"
          class="unread-dot"
        />
        <div class="notif-body">
          <div class="notif-header">
            <el-tag
              :type="typeTag(n.type)"
              size="small"
            >
              {{ typeLabel(n.type) }}
            </el-tag>
            <span class="notif-time">{{ fmt(n.createdAt) }}</span>
          </div>
          <div class="notif-title">
            {{ n.title }}
          </div>
          <div class="notif-content">
            {{ n.content }}
          </div>
        </div>
      </div>
      <div class="notif-footer">
        <el-button
          text
          size="small"
          @click="markAllRead"
        >
          全部已读
        </el-button>
        <el-button
          text
          size="small"
          @click="goToList"
        >
          查看全部
        </el-button>
      </div>
    </div>
  </el-popover>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ChatDotRound } from '@element-plus/icons-vue'
import http from '@/api/client'

const router = useRouter()
const unreadCount = ref(0)
const notifications = ref<any[]>([])

async function fetchUnreadCount() {
  try {
    const res = await http.get('/notifications/unread-count') as any
    const val = typeof res === 'number' ? res : (res?.data ?? res)
    unreadCount.value = Number(val) || 0
  } catch { /* ignore */ }
}

async function fetchList() {
  try {
    const res = await http.get('/notifications', { params: { pageSize: 8 } }) as any
    const data = res?.data ?? res
    notifications.value = data?.list || []
  } catch { /* ignore */ }
}

async function markRead(n: any) {
  if (!n.isRead) {
    try { await http.post(`/notifications/${n.id}/read`) } catch { /* ignore */ }
    n.isRead = true
    unreadCount.value = Math.max(0, unreadCount.value - 1)
  }
  // 跳转到关联内容
  if (n.relatedType === 'instance') {
    router.push(`/instance/${n.relatedId}`)
  } else if (n.relatedType === 'process') {
    router.push('/my-processes')
  }
}

async function markAllRead() {
  try { await http.post('/notifications/read-all') } catch { /* ignore */ }
  unreadCount.value = 0
  notifications.value.forEach(n => n.isRead = true)
}

function goToList() { router.push('/notifications') }

function typeLabel(t: string) {
  const m: Record<string, string> = { info: '信息', warning: '警告', approval: '审批', rejection: '驳回' }
  return m[t] || t
}
function typeTag(t: string) {
  const m: Record<string, string> = { info: 'info', warning: 'warning', approval: 'success', rejection: 'danger' }
  return m[t] || 'info'
}
function fmt(d: string) { return d ? new Date(d).toLocaleString('zh-CN') : '-' }

onMounted(fetchUnreadCount)
setInterval(fetchUnreadCount, 30000)
</script>

<style scoped>
.notif-popover { max-height: 400px; overflow-y: auto; }
.notif-item { display: flex; align-items: flex-start; gap: 8px; padding: 10px 0; border-bottom: 1px solid #eee; cursor: pointer; }
.notif-item:hover { background: #f5f5f5; }
.unread-dot {
  width: 8px; height: 8px; border-radius: 50%; background: #f56c6c;
  flex-shrink: 0; margin-top: 6px;
}
.notif-body { flex: 1; min-width: 0; }
.notif-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
.notif-time { font-size: 11px; color: #999; }
.notif-title { font-weight: 500; font-size: 14px; margin-bottom: 2px; }
.notif-content { font-size: 12px; color: #666; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.notif-footer { display: flex; justify-content: space-between; padding-top: 8px; }
.bell-badge { margin-right: 8px; }
</style>
