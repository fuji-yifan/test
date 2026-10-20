<template>
  <div class="task-list-page">
    <div class="page-header">
      <div class="header-left">
        <h2>我的待办</h2>
        <TabSwitch
          v-model="activeTab"
          :options="tabOptions"
          @change="onTabChange"
        />
      </div>
      <div class="header-actions">
        <el-input
          v-model="searchKeyword"
          placeholder="搜索流程..."
          clearable
          class="search-input"
          @input="onSearch"
        />
        <!-- 状态细分只服务「已处理」；待处理视图里全是 pending，再筛没意义 -->
        <el-select
          v-if="activeTab === 'processed'"
          v-model="processedStatus"
          placeholder="状态"
          clearable
          style="width: 120px"
          @change="onFilterChange"
        >
          <el-option
            label="全部"
            value=""
          />
          <el-option
            label="已通过"
            value="approved"
          />
          <el-option
            label="已驳回"
            value="rejected"
          />
          <el-option
            label="已撤回"
            value="withdrawn"
          />
        </el-select>
      </div>
    </div>

    <el-table
      v-loading="loading"
      :data="list"
      stripe
      style="margin-top: 16px"
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
        label="表单数据"
        min-width="130"
        align="center"
        show-overflow-tooltip
      >
        <template #default="{ row }">
          <!-- 审批前先看发起人填了什么：点开的是那份表单数据，不是表单管理里的表单定义 -->
          <el-button
            v-if="row.instance?.submissionId"
            link
            type="primary"
            @click="viewSubmission(row)"
          >
            {{ row.formName || '查看表单数据' }}
          </el-button>
          <span v-else>{{ row.formName || '-' }}</span>
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
      <!-- 待处理任务还没有审批意见，评论列只在已处理视图展示 -->
      <el-table-column
        v-if="activeTab === 'processed'"
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
      <!-- 空态：放进表格内，替换掉 el-table 自带的「暂无数据」 -->
      <template #empty>
        <el-empty
          :description="activeTab === 'pending' ? '暂无待处理任务' : '暂无已处理任务'"
          :image-size="80"
        />
      </template>
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

    <!-- 通过对话框 -->
    <el-dialog
      v-model="showApproveDialog"
      title="通过"
      width="520px"
    >
      <el-form label-width="72px">
        <el-form-item label="审批意见">
          <el-input
            v-model="approveComment"
            type="textarea"
            :rows="3"
            placeholder="审批意见（可选）"
          />
        </el-form-item>
        <!-- 签名与附件二选一，只展示当前选择的方式 -->
        <el-form-item label="凭证">
          <TabSwitch
            v-model="approveProofType"
            :options="proofOptions"
          />
        </el-form-item>
        <el-form-item
          v-if="approveProofType === 'signature'"
          label="签名"
        >
          <SignaturePad v-model="approveSignature" />
        </el-form-item>
        <el-form-item
          v-else
          label="附件"
        >
          <el-upload
            v-model:file-list="approveFiles"
            :auto-upload="false"
            multiple
            :limit="3"
            :on-exceed="onExceed"
          >
            <el-button size="small">选择附件</el-button>
            <template #tip>
              <div class="el-upload__tip">最多 3 个，单个不超过 5MB</div>
            </template>
          </el-upload>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button size="small" @click="showApproveDialog = false">取消</el-button>
        <el-button size="small" type="success" :loading="approving" @click="doApprove">确认通过</el-button>
      </template>
    </el-dialog>

    <!-- 驳回对话框 -->
    <el-dialog
      v-model="showRejectDialog"
      title="驳回"
      width="520px"
    >
      <el-form label-width="72px">
        <el-form-item label="驳回原因">
          <el-input
            v-model="rejectComment"
            type="textarea"
            :rows="3"
            placeholder="驳回原因（可选）"
          />
        </el-form-item>
        <!-- 签名与附件二选一，只展示当前选择的方式 -->
        <el-form-item label="凭证">
          <TabSwitch
            v-model="rejectProofType"
            :options="proofOptions"
          />
        </el-form-item>
        <el-form-item
          v-if="rejectProofType === 'signature'"
          label="签名"
        >
          <SignaturePad v-model="rejectSignature" />
        </el-form-item>
        <el-form-item
          v-else
          label="附件"
        >
          <el-upload
            v-model:file-list="rejectFiles"
            :auto-upload="false"
            multiple
            :limit="3"
            :on-exceed="onExceed"
          >
            <el-button size="small">选择附件</el-button>
            <template #tip>
              <div class="el-upload__tip">最多 3 个，单个不超过 5MB</div>
            </template>
          </el-upload>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button size="small" @click="showRejectDialog = false">取消</el-button>
        <el-button size="small" type="danger" :loading="rejecting" @click="doReject">确认驳回</el-button>
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

    <!-- 发起人提交的表单数据（审批依据） -->
    <SubmissionDataDialog
      v-model="showData"
      :instance-id="dataInstanceId"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import type { UploadUserFile } from 'element-plus'
import http from '@/api/client'
import SubmissionDataDialog from '@/components/SubmissionDataDialog.vue'
import SignaturePad from '@/components/SignaturePad.vue'
import TabSwitch from '@/components/TabSwitch.vue'
const route = useRoute()
const router = useRouter()
const wsId = (route.params.wsId as string) || ''

/** 已处理包含转交：后端把 transferred 也归入 processed 组 */
const PROCESSED_STATUSES = ['approved', 'rejected', 'withdrawn', 'transferred']
function queryStatus() {
  return typeof route.query.status === 'string' ? route.query.status : ''
}
/** 「processed」是已处理分组本身，不能漏判成待处理 */
function isProcessedQuery(s: string) {
  return s === 'processed' || PROCESSED_STATUSES.includes(s)
}

const list = ref<any[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = 20
const loading = ref(false)
const searchKeyword = ref('')
// 审批类通知带 ?status=pending 跳进来，默认落在「待处理」；带已处理状态则定位到「已处理」
const activeTab = ref<'pending' | 'processed'>(isProcessedQuery(queryStatus()) ? 'processed' : 'pending')
const processedStatus = ref(PROCESSED_STATUSES.includes(queryStatus()) ? queryStatus() : '')
const counts = ref({ pending: 0, processed: 0 })
const tabOptions = computed(() => [
  { value: 'pending', label: '待处理', count: counts.value.pending },
  { value: 'processed', label: '已处理', count: counts.value.processed },
])
// 审批凭证二选一：签名 / 附件
const proofOptions = [
  { value: 'signature', label: '签名' },
  { value: 'attachment', label: '附件' },
]

const currentTask = ref<any>(null)
const showApproveDialog = ref(false)
const approveComment = ref('')
const approveSignature = ref('')
const approveFiles = ref<UploadUserFile[]>([])
const approveProofType = ref('signature')
const approving = ref(false)
const showRejectDialog = ref(false)
const rejectComment = ref('')
const rejectSignature = ref('')
const rejectFiles = ref<UploadUserFile[]>([])
const rejectProofType = ref('signature')
const rejecting = ref(false)
const showTransferDialog = ref(false)
const transferUserId = ref('')
const showAddSignDialog = ref(false)
const addSignUserId = ref('')
const showData = ref(false)
const dataInstanceId = ref('')

const userOptions = ref<any[]>([])
const searching = ref(false)

fetchList()

// 已在本页时再点通知，组件不会重建，需要监听 query 手动切页签
watch(() => route.query.status, (status) => {
  const next = typeof status === 'string' ? status : ''
  const tab = isProcessedQuery(next) ? 'processed' : 'pending'
  const sub = PROCESSED_STATUSES.includes(next) ? next : ''
  if (tab === activeTab.value && sub === processedStatus.value) return
  activeTab.value = tab
  processedStatus.value = sub
  page.value = 1
  fetchList()
})

/** 页签/状态变化同步回 URL，刷新和再次点通知都能落到同一视图 */
function syncQuery() {
  const next = activeTab.value === 'pending' ? 'pending' : processedStatus.value || 'processed'
  if (route.query.status === next) return
  router.replace({ query: { ...route.query, status: next } })
}

// v-model 已先更新 activeTab，这里只负责同步 URL 与重新取数
function onTabChange() {
  page.value = 1
  syncQuery()
  fetchList()
}

// 搜索做 300ms 防抖，输入停顿后再请求；筛选切换立即请求，两者都回到第 1 页
let searchTimer: ReturnType<typeof setTimeout> | undefined
function onSearch() {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => { page.value = 1; fetchList() }, 300)
}
function onFilterChange() { page.value = 1; syncQuery(); fetchList() }
onBeforeUnmount(() => clearTimeout(searchTimer))

async function fetchList() {
  loading.value = true
  try {
    const res = await http.get('/my-tasks', {
      params: {
        page: page.value,
        pageSize,
        status: activeTab.value === 'pending' ? 'pending' : processedStatus.value || 'processed',
        keyword: searchKeyword.value || undefined,
      },
    }) as any
    const data = res.data || res
    list.value = data.list || []
    total.value = data.pagination?.total || 0
    if (data.counts) counts.value = data.counts
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

function viewSubmission(row: any) {
  dataInstanceId.value = row.instance.id
  showData.value = true
}

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

function handleApprove(row: any) {
  currentTask.value = row
  approveComment.value = ''
  approveSignature.value = ''
  approveFiles.value = []
  approveProofType.value = 'signature'
  showApproveDialog.value = true
}

function showReject(row: any) {
  currentTask.value = row
  rejectComment.value = ''
  rejectSignature.value = ''
  rejectFiles.value = []
  rejectProofType.value = 'signature'
  showRejectDialog.value = true
}

/** 单个附件/签名上传到 server 本地磁盘，返回 { name, url, size, mimeType } */
async function uploadApprovalFile(file: Blob, filename: string) {
  const form = new FormData()
  form.append('file', file, filename)
  const res = await http.post('/upload/approval-file', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }) as any
  return res.data ?? res
}

/** 先把选中的凭证（签名或附件，二选一）传完，再随审批请求一起提交 */
async function buildDecision(
  comment: string,
  signature: string,
  files: UploadUserFile[],
  proofType: string,
) {
  const attachments: any[] = []
  if (proofType === 'attachment') {
    for (const f of files) {
      if (f.raw) attachments.push(await uploadApprovalFile(f.raw, f.name))
    }
  }
  let signatureUrl: string | undefined
  if (proofType === 'signature' && signature) {
    const blob = await (await fetch(signature)).blob()
    const uploaded = await uploadApprovalFile(blob, `signature-${Date.now()}.png`)
    signatureUrl = uploaded.url
  }
  return {
    comment,
    signature: signatureUrl,
    attachments: attachments.length ? attachments : undefined,
  }
}

function onExceed() {
  ElMessage.warning('最多上传 3 个附件')
}

async function doApprove() {
  if (approving.value) return
  approving.value = true
  try {
    const decision = await buildDecision(
      approveComment.value,
      approveSignature.value,
      approveFiles.value,
      approveProofType.value,
    )
    await http.post(`/process-instances/${currentTask.value.instanceId}/approve`, {
      nodeId: currentTask.value.nodeId,
      ...decision,
    })
    ElMessage.success('已通过')
    showApproveDialog.value = false
    fetchList()
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || e.message || '操作失败')
  } finally {
    approving.value = false
  }
}

async function doReject() {
  if (rejecting.value) return
  rejecting.value = true
  try {
    const decision = await buildDecision(
      rejectComment.value,
      rejectSignature.value,
      rejectFiles.value,
      rejectProofType.value,
    )
    await http.post(`/process-instances/${currentTask.value.instanceId}/reject`, {
      nodeId: currentTask.value.nodeId,
      ...decision,
    })
    ElMessage.success('已驳回')
    showRejectDialog.value = false
    fetchList()
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || e.message || '驳回失败')
  } finally {
    rejecting.value = false
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
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}
.page-header h2 { margin: 0; }
.header-left { display: flex; align-items: center; gap: 16px; }
.header-actions { display: flex; gap: 12px; }
.search-input { width: 200px; }

</style>
