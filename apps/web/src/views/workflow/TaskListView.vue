<template>
  <div class="task-list-page">
    <div class="page-header">
      <h2>我的待办</h2>
      <el-tabs
        v-model="activeTab"
        @tab-change="fetchList"
      >
        <el-tab-pane
          label="待处理"
          name="pending"
        />
        <el-tab-pane
          label="已处理"
          name="approved"
        />
        <el-tab-pane
          label="全部"
          name=""
        />
      </el-tabs>
    </div>

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
          {{ row.instance?.definition?.name || '-' }}
        </template>
      </el-table-column>
      <el-table-column
        label="发起人"
        min-width="120"
        align="center"
      >
        <template #default="{ row }">
          <el-tooltip
            v-if="row.instance?.initiator"
            :content="'用户ID：' + row.instance.initiatorId"
            placement="top"
            effect="light"
          >
            <span class="user-link">{{ row.instance.initiator.nickname || row.instance.initiator.email }}</span>
          </el-tooltip>
          <span v-else>-</span>
        </template>
      </el-table-column>
      <el-table-column
        label="状态"
        min-width="80"
        align="center"
      >
        <template #default="{ row }">
          <el-tag
            :type="statusType(row.status)"
            size="small"
          >
            {{ statusName(row.status) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column
        label="评论"
        align="center"
        show-overflow-tooltip
      >
        <template #default="{ row }">
          {{ row.comment || '-' }}
        </template>
      </el-table-column>
      <el-table-column
        label="创建时间"
        min-width="150"
        align="center"
      >
        <template #default="{ row }">
          {{ formatDate(row.createdAt) }}
        </template>
      </el-table-column>
      <el-table-column
        v-if="activeTab === 'pending'"
        label="操作"
        width="250"
        align="center"
        fixed="right"
      >
        <template #default="{ row }">
          <el-button
            size="small"
            type="success"
            @click="handleApprove(row)"
          >
            通过
          </el-button>
          <el-button
            size="small"
            type="danger"
            @click="showReject(row)"
          >
            驳回
          </el-button>
          <el-button
            v-if="canAddSign(row)"
            size="small"
            @click="openAddSign(row)"
          >
            加签
          </el-button>
          <el-button
            v-if="canTransfer(row)"
            size="small"
            @click="openTransfer(row)"
          >
            转交
          </el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-empty v-if="!list.length" description="暂无待办任务" />

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

    <!-- 驳回对话框 -->
    <el-dialog
      v-model="showRejectDialog"
      title="驳回"
      width="400px"
    >
      <el-input
        v-model="rejectComment"
        type="textarea"
        placeholder="驳回原因（可选）"
      />
      <template #footer>
        <el-button size="small" @click="showRejectDialog = false">取消</el-button>
        <el-button size="small" type="danger" @click="doReject">确认驳回</el-button>
      </template>
    </el-dialog>

    <!-- 转交对话框 -->
    <el-dialog
      v-model="showTransferDialog"
      title="转交"
      width="400px"
    >
      <el-select
        v-model="transferUserId"
        filterable
        remote
        reserve-keyword
        :remote-method="searchUsers"
        :loading="searching"
        placeholder="搜索用户姓名或邮箱"
        clearable
        style="width:100%"
      >
        <el-option
          v-for="u in userOptions"
          :key="u.id"
          :label="`${u.nickname || u.email} (${u.email})`"
          :value="u.id"
        />
      </el-select>
      <template #footer>
        <el-button size="small" @click="showTransferDialog = false">取消</el-button>
        <el-button size="small" type="primary" @click="doTransfer">确认转交</el-button>
      </template>
    </el-dialog>

    <!-- 加签对话框 -->
    <el-dialog
      v-model="showAddSignDialog"
      title="加签"
      width="400px"
    >
      <el-select
        v-model="addSignUserId"
        filterable
        remote
        reserve-keyword
        :remote-method="searchUsers"
        :loading="searching"
        placeholder="搜索用户姓名或邮箱"
        clearable
        style="width:100%"
      >
        <el-option
          v-for="u in userOptions"
          :key="u.id"
          :label="`${u.nickname || u.email} (${u.email})`"
          :value="u.id"
        />
      </el-select>
      <template #footer>
        <el-button size="small" @click="showAddSignDialog = false">取消</el-button>
        <el-button size="small" type="primary" @click="doAddSign">确认加签</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import http from '@/api/client'

const list = ref<any[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = 20
const loading = ref(false)
const activeTab = ref('pending')

const currentTask = ref<any>(null)
const showRejectDialog = ref(false)
const rejectComment = ref('')
const showTransferDialog = ref(false)
const transferUserId = ref('')
const showAddSignDialog = ref(false)
const addSignUserId = ref('')

const userOptions = ref<any[]>([])
const searching = ref(false)

fetchList()

async function fetchList() {
  loading.value = true
  try {
    const res = await http.get('/my-tasks', {
      params: { page: page.value, pageSize, status: activeTab.value || undefined },
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

async function searchUsers(query: string) {
  if (!query || query.length < 1) { userOptions.value = []; return }
  searching.value = true
  try {
    const res = await http.get('/auth/users', { params: { search: query } }) as any
    userOptions.value = (res.data || res) || []
  } catch { userOptions.value = [] }
  finally { searching.value = false }
}

function changePage(p: number) { page.value = p; fetchList() }

function canTransfer(row: any): boolean {
  const nodes = row.instance?.definition?.nodes || []
  const node = nodes.find((n: any) => n.id === row.nodeId)
  return node?.config?.allowTransfer !== false
}

function canAddSign(row: any): boolean {
  const nodes = row.instance?.definition?.nodes || []
  const node = nodes.find((n: any) => n.id === row.nodeId)
  return node?.config?.allowAddSign === true
}

function openTransfer(row: any) {
  currentTask.value = row
  transferUserId.value = ''
  userOptions.value = []
  showTransferDialog.value = true
}

function openAddSign(row: any) {
  currentTask.value = row
  addSignUserId.value = ''
  userOptions.value = []
  showAddSignDialog.value = true
}

async function doTransfer() {
  if (!transferUserId.value) return ElMessage.warning('请选择用户')
  try {
    await http.post(`/process-instances/${currentTask.value.instanceId}/transfer`, {
      nodeId: currentTask.value.nodeId,
      targetUserId: transferUserId.value,
    })
    ElMessage.success('已转交')
    showTransferDialog.value = false
    fetchList()
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || '转交失败')
  }
}

async function doAddSign() {
  if (!addSignUserId.value) return ElMessage.warning('请选择用户')
  try {
    await http.post(`/process-instances/${currentTask.value.instanceId}/add-sign`, {
      nodeId: currentTask.value.nodeId,
      targetUserId: addSignUserId.value,
    })
    ElMessage.success('已加签')
    showAddSignDialog.value = false
    fetchList()
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || '加签失败')
  }
}

async function handleApprove(row: any) {
  try {
    await http.post(`/process-instances/${row.instanceId}/approve`, { nodeId: row.nodeId })
    ElMessage.success('已通过')
    fetchList()
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || '操作失败')
  }
}

function showReject(row: any) {
  currentTask.value = row
  rejectComment.value = ''
  showRejectDialog.value = true
}

async function doReject() {
  try {
    await http.post(`/process-instances/${currentTask.value.instanceId}/reject`, {
      nodeId: currentTask.value.nodeId,
      comment: rejectComment.value,
    })
    ElMessage.success('已驳回')
    showRejectDialog.value = false
    fetchList()
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || '驳回失败')
  }
}

function statusType(s: string) {
  const map: Record<string, string> = { pending: 'warning', approved: 'success', rejected: 'danger', transferred: 'info', withdrawn: 'info' }
  return map[s] || 'info'
}

function statusName(s: string) {
  const map: Record<string, string> = { pending: '待处理', approved: '已通过', rejected: '已驳回', transferred: '已转交', withdrawn: '已撤回' }
  return map[s] || s
}

function formatDate(d: string) {
  if (!d) return '-'
  return new Date(d).toLocaleString('zh-CN')
}
</script>

<style scoped>
.page-header { margin-bottom: 16px; }
.page-header h2 { margin: 0 0 8px; }
</style>
