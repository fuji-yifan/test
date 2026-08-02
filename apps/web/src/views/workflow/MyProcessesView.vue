<template>
  <div class="my-processes">
    <h2>我的流程</h2>

    <el-table
      v-loading="loading"
      :data="list"
      stripe
    >
      <el-table-column
        label="流程名称"
        min-width="120"
        align="center"
        show-overflow-tooltip
      >
        <template #default="{ row }">
          {{ row.definition?.name || '-' }}
        </template>
      </el-table-column>
      <el-table-column
        label="当前状态"
        min-width="80"
        align="center"
      >
        <template #default="{ row }">
          <el-tag
            :type="stateType(row.currentState)"
            size="small"
          >
            {{ stateName(row.currentState) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column
        label="发起时间"
        min-width="180"
        align="center"
      >
        <template #default="{ row }">
          {{ formatDate(row.createdAt) }}
        </template>
      </el-table-column>
      <el-table-column
        label="完成时间"
        min-width="180"
        align="center"
      >
        <template #default="{ row }">
          {{ formatDate(row.completedAt) }}
        </template>
      </el-table-column>
      <el-table-column
        label="操作"
        min-width="200"
        align="center"
        fixed="right"
      >
        <template #default="{ row }">
          <el-button
            v-if="row.currentState === 'approving' && row.definition?.settings?.allowWithdraw !== false"
            size="small"
            type="warning"
            @click="withdraw(row)"
          >
            撤回
          </el-button>
          <el-button
            size="small"
            @click="viewProgress(row)"
          >
            进度
          </el-button>
          <el-button
            size="small"
            @click="viewDetail(row)"
          >
            详情
          </el-button>
          <el-button
            size="small"
            type="danger"
            @click="confirmDelete(row)"
          >
            删除
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-pagination
      v-if="total > 0"
      style="margin-top: 16px; text-align: right"
      background
      layout="total, prev, pager, next"
      :total="total"
      :page-size="pageSize"
      :current-page="page"
      @current-change="changePage"
    />

    <!-- 详情对话框 -->
    <el-dialog
      v-model="showDetail"
      title="流程详情"
      width="600px"
    >
      <div v-if="detailInstance">
        <el-descriptions
          :column="2"
          border
          size="small"
        >
          <el-descriptions-item label="流程名称">
            {{ detailInstance.definition?.name }}
          </el-descriptions-item>
          <el-descriptions-item label="状态">
            {{ stateName(detailInstance.currentState) }}
          </el-descriptions-item>
          <el-descriptions-item label="发起时间">
            {{ formatDate(detailInstance.createdAt) }}
          </el-descriptions-item>
          <el-descriptions-item label="完成时间">
            {{ formatDate(detailInstance.completedAt) }}
          </el-descriptions-item>
        </el-descriptions>
        <h4 style="margin-top:16px">
          审批记录
        </h4>
        <el-timeline>
          <el-timeline-item
            v-for="task in detailInstance.tasks"
            :key="task.id"
            :timestamp="formatDate(task.processedAt || task.createdAt)"
            :color="task.status === 'approved' ? '#67c23a' : task.status === 'rejected' ? '#f56c6c' : '#909399'"
          >
            {{ getNodeName(task.nodeId) }} — {{ task.assignee?.nickname || task.assignee?.email || task.assigneeId }} — {{ statusName(task.status) }}
            <span v-if="task.comment">：{{ task.comment }}</span>
          </el-timeline-item>
        </el-timeline>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import http from '@/api/client'

const route = useRoute()
const router = useRouter()
const wsId = computed(() => route.params.wsId as string)

const list = ref<any[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = 20
const loading = ref(false)

const showDetail = ref(false)
const detailInstance = ref<any>(null)

fetchList()

async function fetchList() {
  loading.value = true
  try {
    const res = await http.get('/my-instances', {
      params: { page: page.value, pageSize },
    }) as any
    const data = res.data || res
    list.value = data.list || []
    total.value = data.pagination?.total || 0
  } catch (e: any) {
    ElMessage.error('加载失败')
  } finally {
    loading.value = false
  }
}

function changePage(p: number) { page.value = p; fetchList() }

async function confirmDelete(row: any) {
  try {
    await ElMessageBox.confirm(
      `确定删除流程「${row.definition?.name || ''}」？删除后无法恢复。`,
      '删除确认',
      { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' },
    )
    await deleteInstance(row)
  } catch { /* 取消 */ }
}

async function deleteInstance(row: any) {
  try {
    await http.delete(`/process-instances/${row.id}`)
    ElMessage.success('已删除')
    fetchList()
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || '删除失败')
  }
}

async function withdraw(row: any) {
  try {
    await http.post(`/process-instances/${row.id}/withdraw`)
    ElMessage.success('已撤回')
    fetchList()
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || '撤回失败')
  }
}

function viewProgress(row: any) {
  router.push({ name: 'InstanceViewer', params: { id: row.id } })
}

function viewDetail(row: any) {
  detailInstance.value = row
  showDetail.value = true
}

function stateType(s: string) {
  const map: Record<string, string> = { approving: 'warning', completed: 'success', rejected: 'danger', withdrawn: 'info', draft: 'info', timeout: 'danger' }
  return map[s] || 'info'
}

function stateName(s: string) {
  const map: Record<string, string> = { draft: '草稿', approving: '审批中', completed: '已完成', rejected: '已驳回', withdrawn: '已撤回', timeout: '已超时' }
  return map[s] || s
}

function statusName(s: string) {
  const map: Record<string, string> = { pending: '待处理', approved: '已通过', rejected: '已驳回', transferred: '已转交', withdrawn: '已撤回' }
  return map[s] || s
}

function getNodeName(nodeId: string) {
  if (!detailInstance.value) return nodeId
  const nodes = (detailInstance.value.definition?.nodes as any[]) || []
  const node = nodes.find((n: any) => n.id === nodeId)
  return node?.name || nodeId
}

function formatDate(d: string) {
  if (!d) return '-'
  return new Date(d).toLocaleString('zh-CN')
}
</script>

<style scoped>
h2 { margin: 0 0 16px; }
</style>
