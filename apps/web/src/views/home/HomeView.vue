<template>
  <div class="home">
    <h2>工作台</h2>
    <div class="stat-cards">
      <div class="stat-card">
        <div class="num">
          {{ stats.formCount }}
        </div><div class="label">
          我的表单
        </div>
      </div>
      <div class="stat-card">
        <div class="num">
          {{ stats.submissionCount }}
        </div><div class="label">
          本月提交
        </div>
      </div>
      <div class="stat-card">
        <div class="num">
          {{ stats.pendingCount }}
        </div><div class="label">
          待办任务
        </div>
      </div>
    </div>

    <el-card class="section">
      <template #header>
        <div class="ws-header">
          <span>我的工作空间</span>
          <el-button
            type="primary"
            size="small"
            @click="createWorkspace"
          >
            创建
          </el-button>
        </div>
      </template>
      <div
        v-if="ownedWorkspaces.length === 0"
        class="empty-hint"
      >
        暂无
      </div>
      <div
        v-else
        class="ws-grid"
      >
        <div
          v-for="ws in ownedWorkspaces"
          :key="ws.id"
          class="ws-card"
          @click="enterWorkspace(ws.id)"
        >
          <el-avatar
            :size="40"
            icon="OfficeBuilding"
          />
          <div class="ws-name">
            {{ ws.name }}
            <div
              v-if="ws.remark"
              class="ws-remark"
            >
              {{ ws.remark }}
            </div>
          </div>
          <el-button
            size="small"
            type="danger"
            class="ws-action"
            @click.stop="deleteWorkspace(ws)"
          >
            删除
          </el-button>
        </div>
      </div>
    </el-card>

    <el-card
      v-if="joinedWorkspaces.length > 0"
      class="section"
    >
      <template #header>
        <span>加入的工作空间</span>
      </template>
      <div class="ws-grid">
        <div
          v-for="ws in joinedWorkspaces"
          :key="ws.id"
          class="ws-card"
          @click="enterWorkspace(ws.id)"
        >
          <el-avatar
            :size="40"
            icon="OfficeBuilding"
          />
          <div class="ws-name">
            {{ ws.name }}
            <div
              v-if="ws.remark"
              class="ws-remark"
            >
              {{ ws.remark }}
            </div>
          </div>
          <el-button
            size="small"
            type="warning"
            class="ws-action"
            @click.stop="leaveWorkspace(ws)"
          >
            退出
          </el-button>
        </div>
      </div>
    </el-card>

    <el-card class="section">
      <template #header>
        <span>最近表单</span>
      </template>
      <el-table
        v-if="recentForms.length"
        :data="recentForms"
        style="width:100%"
      >
        <el-table-column
          prop="name"
          label="表单名称"
          min-width="150"
          show-overflow-tooltip
          align="center"
        />
        <el-table-column
          prop="status"
          label="状态"
          min-width="100"
          align="center"
        >
          <template #default="{ row }">
            <el-tag
              :type="row.status==='published'?'success':'info'"
              size="small"
            >
              {{ row.status }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column
          label="更新时间"
          min-width="150"
          align="center"
        >
          <template #default="{ row }">
            {{ formatDate(row.updatedAt) }}
          </template>
        </el-table-column>
        <el-table-column
          label="操作"
          min-width="150"
          align="center"
        >
          <template #default="{ row }">
            <el-button
              size="small"
              @click="openDesigner(row)"
            >
              编辑
            </el-button>
            <el-button
              size="small"
              @click="viewData(row)"
            >
              数据
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      <div
        v-else
        class="empty-hint"
      >
        还没有表单，去创建一个吧
      </div>
    </el-card>

    <!-- 创建空间弹窗 -->
    <el-dialog
      v-model="showCreateWS"
      title="创建工作空间"
      width="400px"
    >
      <el-form :model="wsForm">
        <el-form-item label="名称">
          <el-input
            v-model="wsForm.name"
            placeholder="如：我的团队"
          />
        </el-form-item>
        <el-form-item v-if="showRemark" label="备注">
          <el-input
            v-model="wsForm.remark"
            placeholder="用于区分同名工作空间"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreateWS = false">
          取消
        </el-button>
        <el-button
          type="primary"
          @click="doCreateWS"
        >
          创建
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useWorkspaceStore } from '@/stores/workspace'
import http from '@/api/client'

const router = useRouter()
const wsStore = useWorkspaceStore()

const stats = reactive({ formCount: 0, submissionCount: 0, pendingCount: 0 })
const recentForms = ref<any[]>([])
const showCreateWS = ref(false)
const wsForm = reactive({ name: '', remark: '' })
const showRemark = ref(false)

const ownedWorkspaces = computed(() => wsStore.list.filter((w: any) => w.role === 'owner'))
const joinedWorkspaces = computed(() => wsStore.list.filter((w: any) => w.role !== 'owner'))

onMounted(async () => {
  await wsStore.fetchList()
  const wsId = wsStore.getCurrentId()
  if (!wsId) return

  try {
    const overviewRes = await http.get(`/analytics/overview?workspaceId=${wsId}`) as any
    const overview = overviewRes.data || overviewRes
    stats.submissionCount = overview.monthlySubmissions ?? 0
    stats.pendingCount = overview.pendingTasks ?? 0
    stats.formCount = overview.totalForms ?? 0
  } catch { /* ignore */ }

  try {
    const res = await http.get(`/workspaces/${wsId}/forms?pageSize=5`) as any
    const data = res.data || res
    recentForms.value = data?.list || []
  } catch { /* ignore */ }
})

function enterWorkspace(id: string) {
  wsStore.setCurrent(wsStore.list.find((w: any) => w.id === id))
  router.push(`/workspace/${id}/forms`)
}

function openDesigner(form: any) {
  const wsId = wsStore.getCurrentId()
  router.push(`/workspace/${wsId}/forms/${form.id}/designer`)
}

function viewData(form: any) {
  const wsId = wsStore.getCurrentId()
  router.push(`/workspace/${wsId}/forms/${form.id}/data`)
}

function createWorkspace() {
  wsForm.name = ''
  wsForm.remark = ''
  showRemark.value = false
  showCreateWS.value = true
}

async function deleteWorkspace(ws: any) {
  try {
    await ElMessageBox.confirm(`确定删除工作空间「${ws.name}」？此操作不可恢复。`, '删除确认', {
      confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning',
    })
  } catch { return }
  try {
    await http.delete(`/workspaces/${ws.id}`)
    ElMessage.success('已删除')
    await wsStore.fetchList()
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || '删除失败')
  }
}

async function leaveWorkspace(ws: any) {
  try {
    await ElMessageBox.confirm(`确定退出工作空间「${ws.name}」？`, '退出确认', {
      confirmButtonText: '退出', cancelButtonText: '取消', type: 'warning',
    })
  } catch { return }
  try {
    await http.post(`/workspaces/${ws.id}/leave`)
    ElMessage.success('已退出')
    await wsStore.fetchList()
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || '退出失败')
  }
}

function formatDate(d: string) { return d ? new Date(d).toLocaleString('zh-CN') : '-' }

async function doCreateWS() {
  if (!wsForm.name.trim()) return
  // 检测是否与已有工作空间重名
  const dup = wsStore.list.find((w: any) =>
    w.name === wsForm.name.trim() && (!wsForm.remark || w.remark === wsForm.remark))
  if (dup && !wsForm.remark) {
    showRemark.value = true
    ElMessage.warning('工作空间名称已存在，请添加备注以区分')
    return
  }
  try {
    await http.post('/workspaces', {
      name: wsForm.name.trim(),
      remark: wsForm.remark.trim() || undefined,
    })
    await wsStore.fetchList()
    showCreateWS.value = false
    wsForm.name = ''
    wsForm.remark = ''
    showRemark.value = false
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || '创建工作空间失败')
  }
}
</script>

<style scoped>
.home h2 { margin: 0 0 16px; }
.stat-cards { display: flex; gap: 16px; margin-bottom: 24px; }
.stat-card { flex: 1; background: #fff; border-radius: 12px; padding: 24px; text-align: center; border: 1px solid #e5e7eb; box-shadow: 0 1px 2px rgba(0,0,0,0.04); transition: transform 0.15s, box-shadow 0.15s; }
.stat-card:hover { transform: translateY(-2px); box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
.stat-card .num { font-size: 32px; font-weight: 700; color: var(--el-color-primary); }
.stat-card .label { font-size: 13px; color: #94a3b8; margin-top: 8px; }
.section { margin-bottom: 24px; }
.ws-grid { display: flex; gap: 16px; flex-wrap: wrap; }
.ws-card { padding: 20px 12px 12px; border: 1px solid #e5e7eb; border-radius: 12px; text-align: center; cursor: pointer; width: 150px; transition: transform 0.15s, box-shadow 0.15s; position: relative; }
.ws-card:hover { transform: translateY(-2px); box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
.ws-name { font-size: 13px; font-weight: 600; margin-top: 6px; }
.ws-remark { font-size: 11px; font-weight: 400; color: #909399; margin-top: 2px; }
.ws-header { display: flex; justify-content: space-between; align-items: center; }
.ws-action { margin-top: 8px; }
.empty-hint { color: #94a3b8; text-align: center; padding: 32px 0; }
</style>
