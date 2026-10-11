<template>
  <div class="notif-page">
    <div class="page-header">
      <h2>消息通知</h2>
      <div class="header-actions">
        <el-button
          size="small"
          :loading="markingAll"
          @click="markAllRead"
        >
          全部已读
        </el-button>
        <el-button
          size="small"
          type="danger"
          @click="clearAll"
        >
          清除所有
        </el-button>
      </div>
    </div>

    <div class="table-wrapper">
      <el-table
        v-loading="loading"
        :data="list"
        stripe
        :height="tableHeight"
      >
        <el-table-column
          width="44"
          align="center"
        >
          <template #default="{ row }">
            <span
              v-if="!row.isRead"
              class="unread-dot"
            />
          </template>
        </el-table-column>
        <el-table-column
          label="类型"
          width="80"
          align="center"
        >
          <template #default="{ row }">
            <el-tag
              :type="typeTag(row.type)"
              size="small"
            >
              {{ typeLabel(row.type) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column
          prop="title"
          label="标题"
          min-width="120"
          align="center"
          show-overflow-tooltip
        />
        <el-table-column
          prop="content"
          label="内容"
          min-width="140"
          align="center"
          show-overflow-tooltip
        />
        <el-table-column
          label="时间"
          width="170"
          align="center"
        >
          <template #default="{ row }">
            {{ fmt(row.createdAt) }}
          </template>
        </el-table-column>
        <el-table-column
          label="操作"
          width="140"
          align="center"
          fixed="right"
        >
          <template #default="{ row }">
            <el-button
              v-if="!row.isRead"
              size="small"
              type="primary"
              @click="markRead(row.id)"
            >
              标为已读
            </el-button>
            <el-button
              size="small"
              type="danger"
              @click="del(row.id)"
            >
              删除
            </el-button>
          </template>
        </el-table-column>
        <!-- 空态：放进表格内，替换掉 el-table 自带的「暂无数据」 -->
        <template #empty>
          <el-empty
            v-if="!loading"
            description="暂无通知"
            :image-size="80"
          />
        </template>
      </el-table>
    </div>
    <el-pagination
      v-if="total > pageSize"
      v-model:current-page="page"
      :page-size="pageSize"
      :total="total"
      layout="prev, pager, next"
      class="pagination"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import http from '@/api/client'

const list = ref<any[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = 20
const loading = ref(false)
const markingAll = ref(false)
const tableHeight = ref(window.innerHeight - 260)

async function fetch() {
  loading.value = true
  try {
    const res = await http.get('/notifications', { params: { page: page.value, pageSize } }) as any
    const data = res?.data || res
    list.value = data?.list || []
    total.value = data?.pagination?.total || 0
  } finally { loading.value = false }
}
onMounted(fetch)
watch(page, fetch)

async function markRead(id: string) {
  try { await http.post(`/notifications/${id}/read`); fetch() } catch { /* ignore */ }
}

async function markAllRead() {
  markingAll.value = true
  try {
    await http.post('/notifications/read-all')
    ElMessage.success('全部已读')
    fetch()
  } catch (e: any) { if (e?.__handled) return; ElMessage.error('操作失败') }
  finally { markingAll.value = false }
}

async function clearAll() {
  try {
    await ElMessageBox.confirm('确定清除所有通知？此操作不可恢复。', '清除确认', {
      confirmButtonText: '清除', cancelButtonText: '取消', type: 'warning',
    })
    await http.delete('/notifications/clear-all')
    ElMessage.success('已清除')
    fetch()
  } catch { /* 取消 */ }
}

async function del(id: string) {
  try {
    await ElMessageBox.confirm('确定删除该通知？', '删除确认', { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' })
    await http.delete(`/notifications/${id}`)
    ElMessage.success('已删除')
    fetch()
  } catch { /* 取消 */ }
}

function typeLabel(t: string) {
  const m: Record<string, string> = { info: '信息', warning: '警告', approval: '审批', rejection: '驳回', '邀请': '邀请' }
  return m[t] || t
}
function typeTag(t: string) {
  const m: Record<string, string> = { info: 'info', warning: 'warning', approval: 'success', rejection: 'danger', '邀请': 'warning' }
  return m[t] || 'info'
}
function fmt(d: string) { return d ? new Date(d).toLocaleString('zh-CN') : '-' }
</script>

<style scoped>
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.page-header h2 { margin: 0; }
.header-actions { display: flex; gap: 8px; }
.table-wrapper { overflow: hidden; }
.unread-dot {
  display: inline-block; width: 8px; height: 8px; border-radius: 50%;
  background: #f56c6c; vertical-align: middle;
}
.pagination { margin-top: 16px; justify-content: center; }
</style>
