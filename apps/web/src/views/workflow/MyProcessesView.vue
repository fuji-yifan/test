<template>
  <div class="my-processes">
    <div class="page-header">
      <div class="header-left">
        <h2>我的流程</h2>
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
        <!-- 状态细分只服务「已结束」；审批中视图里全是 approving，再筛没意义 -->
        <el-select
          v-if="activeTab === 'finished'"
          v-model="finishedStatus"
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
            label="已完成"
            value="completed"
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
          {{ row.definition?.name || '-' }}
        </template>
      </el-table-column>
      <el-table-column
        label="表单数据"
        min-width="130"
        align="center"
        show-overflow-tooltip
      >
        <template #default="{ row }">
          <!-- 点开看发起时提交的那份表单数据（不是跳去表单管理改表单） -->
          <el-button
            v-if="row.submissionId"
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
            type="danger"
            @click="confirmDelete(row)"
          >
            删除
          </el-button>
        </template>
      </el-table-column>

      <!-- 空态：图标 + 文案放进表格内，替换掉 el-table 自带的「暂无数据」 -->
      <template #empty>
        <el-empty
          description="暂无流程"
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

    <!-- 发起时提交的表单数据 -->
    <SubmissionDataDialog
      v-model="showData"
      :instance-id="dataInstanceId"
    />

    <!-- 进度查看（弹窗，不再跳独立页）。高度由 .progress-dialog 撑满视口，见样式里的说明 -->
    <el-dialog
      v-model="showProgress"
      width="1000px"
      class="progress-dialog"
    >
      <template #header>
        <span>{{ progressName ? progressName + ' — ' : '' }}进度查看</span>
      </template>
      <InstanceViewer
        :instance-id="progressInstanceId"
        hide-header
      />
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import http from '@/api/client'
import SubmissionDataDialog from '@/components/SubmissionDataDialog.vue'
import InstanceViewer from '@/views/workflow/InstanceViewer.vue'
import TabSwitch from '@/components/TabSwitch.vue'

const route = useRoute()
const router = useRouter()

/** 已结束包含已完成、已驳回、已撤回 */
const FINISHED_STATUSES = ['completed', 'rejected', 'withdrawn']
function queryStatus() {
  return typeof route.query.status === 'string' ? route.query.status : ''
}
/** 「finished」是已结束分组本身，不能漏判成审批中 */
function isFinishedQuery(s: string) {
  return s === 'finished' || FINISHED_STATUSES.includes(s)
}

const list = ref<any[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = 20
const loading = ref(false)
const searchKeyword = ref('')
// 默认落在「审批中」；带已结束状态的历史链接则定位到「已结束」
const activeTab = ref<'approving' | 'finished'>(isFinishedQuery(queryStatus()) ? 'finished' : 'approving')
const finishedStatus = ref(FINISHED_STATUSES.includes(queryStatus()) ? queryStatus() : '')
const counts = ref({ approving: 0, finished: 0 })
const tabOptions = computed(() => [
  { value: 'approving', label: '审批中', count: counts.value.approving },
  { value: 'finished', label: '已结束', count: counts.value.finished },
])

const showData = ref(false)
const dataInstanceId = ref('')

const showProgress = ref(false)
const progressInstanceId = ref('')
const progressName = ref('')

fetchList()

async function fetchList() {
  loading.value = true
  try {
    const res = await http.get('/my-instances', {
      params: {
        page: page.value,
        pageSize,
        status: activeTab.value === 'approving' ? 'approving' : finishedStatus.value || 'finished',
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

function changePage(p: number) { page.value = p; fetchList() }

// 已在本页时再点通知，组件不会重建，需要监听 query 手动切页签
watch(() => route.query.status, (status) => {
  const next = typeof status === 'string' ? status : ''
  const tab = isFinishedQuery(next) ? 'finished' : 'approving'
  const sub = FINISHED_STATUSES.includes(next) ? next : ''
  if (tab === activeTab.value && sub === finishedStatus.value) return
  activeTab.value = tab
  finishedStatus.value = sub
  page.value = 1
  fetchList()
})

/** 页签/状态变化同步回 URL，刷新和再次点通知都能落到同一视图 */
function syncQuery() {
  const next = activeTab.value === 'approving' ? 'approving' : finishedStatus.value || 'finished'
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
  progressInstanceId.value = row.id
  progressName.value = row.definition?.name || ''
  showProgress.value = true
}

function viewSubmission(row: any) {
  dataInstanceId.value = row.id
  showData.value = true
}

function stateType(s: string) {
  const map: Record<string, string> = { approving: 'warning', completed: 'success', rejected: 'danger', withdrawn: 'info', draft: 'info', timeout: 'danger' }
  return map[s] || 'info'
}

function stateName(s: string) {
  const map: Record<string, string> = { draft: '草稿', approving: '审批中', completed: '已完成', rejected: '已驳回', withdrawn: '已撤回', timeout: '已超时' }
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

/* 弹窗被 teleport 到 body，scoped 选择器够不着，所以用 :global。
   画布要撑满并且底边不能出屏，靠「弹窗自身定高 + 内部 flex 分配」来保证：
   高度按 .el-overlay-dialog 算 —— 它是 fixed 定位，100% 就是真实可视区高度，
   比 100vh 可靠（100vh 不扣经典滚动条，页面有横向滚动条时会算出偏大的值，底边正好被裁）。
   减掉的 15vh / 50px 就是 .el-dialog 自己的上下 margin，跟它保持同一份数值即可，无需估算标题栏高度。 */
:global(.progress-dialog) {
  height: calc(100% - 15vh - 50px);
  display: flex;
  flex-direction: column;
}
:global(.progress-dialog .el-dialog__body) {
  flex: 1;
  min-height: 0;
}
</style>
