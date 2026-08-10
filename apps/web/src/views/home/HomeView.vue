<template>
  <div class="home">
    <h2>首页</h2>

    <el-card class="section">
      <template #header>
        <div class="ws-header">
          <span>我的工作空间</span>
          <el-button type="primary" size="small" @click="createWorkspace">创建</el-button>
        </div>
      </template>
      <div v-if="ownedWorkspaces.length === 0" class="empty-hint">暂无工作空间，点击「创建」开始</div>
      <div v-else class="ws-grid">
        <div v-for="ws in ownedWorkspaces" :key="ws.id" class="ws-card" @click="enterWorkspace(ws.id)">
          <el-avatar :size="40" icon="OfficeBuilding" />
          <div class="ws-name">
            {{ ws.name }}
            <div v-if="ws.remark" class="ws-remark">{{ ws.remark }}</div>
          </div>
          <el-button size="small" type="danger" class="ws-action" @click.stop="deleteWorkspace(ws)">删除</el-button>
        </div>
      </div>
    </el-card>

    <el-card class="section">
      <template #header>
        <span>加入的工作空间</span>
      </template>
      <div v-if="joinedWorkspaces.length === 0" class="empty-hint">暂未加入</div>
      <div v-else class="ws-grid">
        <div v-for="ws in joinedWorkspaces" :key="ws.id" class="ws-card" @click="enterWorkspace(ws.id)">
          <el-avatar :size="40" icon="OfficeBuilding" />
          <div class="ws-name">
            {{ ws.name }}
            <div v-if="ws.remark" class="ws-remark">{{ ws.remark }}</div>
          </div>
          <el-button size="small" type="warning" class="ws-action" @click.stop="leaveWorkspace(ws)">退出</el-button>
        </div>
      </div>
    </el-card>

    <el-card v-if="invitations.length > 0" class="section">
      <template #header>
        <div class="ws-header">
          <span>待处理的邀请</span>
          <el-tag size="small" type="warning">{{ invitations.length }}</el-tag>
        </div>
      </template>
      <div class="invitation-list">
        <div v-for="inv in invitations" :key="inv.id" class="invitation-item">
          <div class="invitation-info">
            <el-avatar :size="36" icon="UserFilled" />
            <div>
              <div class="invitation-text">
                <strong>{{ inv.workspace.name }}</strong> 邀请您加入，加入后角色为：{{ roleLabel(inv.role) }}
              </div>
              <div class="invitation-from">
                来自 {{ inv.inviter.nickname || inv.inviter.email }}（{{ inv.inviter.email }}）
              </div>
            </div>
          </div>
          <div class="invitation-actions">
            <el-button size="small" type="primary" :loading="inv._loading" @click="acceptInvitation(inv)">同意</el-button>
            <el-button size="small" :loading="inv._loading" @click="declineInvitation(inv)">拒绝</el-button>
          </div>
        </div>
      </div>
    </el-card>

    <!-- 创建空间弹窗 -->
    <el-dialog v-model="showCreateWS" title="创建工作空间" width="400px">
      <el-form :model="wsForm">
        <el-form-item label="名称">
          <el-input v-model="wsForm.name" placeholder="如：我的团队" />
        </el-form-item>
        <el-form-item v-if="showRemark" label="备注">
          <el-input v-model="wsForm.remark" placeholder="用于区分同名工作空间" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreateWS = false">取消</el-button>
        <el-button type="primary" @click="doCreateWS">创建</el-button>
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

const showCreateWS = ref(false)
const wsForm = reactive({ name: '', remark: '' })
const showRemark = ref(false)

const ownedWorkspaces = computed(() => wsStore.list.filter((w: any) => w.role === 'owner'))
const joinedWorkspaces = computed(() => wsStore.list.filter((w: any) => w.role !== 'owner'))

const invitations = ref<any[]>([])

onMounted(async () => {
  await wsStore.fetchList()
  await fetchInvitations()
})

async function fetchInvitations() {
  try {
    const res = await http.get('/invitations/mine') as any
    invitations.value = (res?.data || res || []).map((inv: any) => ({ ...inv, _loading: false }))
  } catch { /* ignore */ }
}

async function acceptInvitation(inv: any) {
  inv._loading = true
  try {
    await http.post(`/invitations/${inv.id}/accept`)
    ElMessage.success(`已加入「${inv.workspace.name}」`)
    await wsStore.fetchList()
    invitations.value = invitations.value.filter(i => i.id !== inv.id)
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || '操作失败')
    inv._loading = false
  }
}

async function declineInvitation(inv: any) {
  inv._loading = true
  try {
    await http.post(`/invitations/${inv.id}/decline`)
    ElMessage.success('已拒绝邀请')
    invitations.value = invitations.value.filter(i => i.id !== inv.id)
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || '操作失败')
    inv._loading = false
  }
}

function roleLabel(role: string) {
  const map: Record<string, string> = { owner: '创建者', editor: '编辑者', viewer: '查看者' }
  return map[role] || role
}

function enterWorkspace(id: string) {
  const ws = wsStore.list.find((w: any) => w.id === id)
  if (ws) wsStore.setCurrent(ws)
  router.push(`/workspace/${id}/home`)
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

async function doCreateWS() {
  if (!wsForm.name.trim()) return
  const dupName = wsStore.list.find((w: any) => w.name === wsForm.name.trim())
  if (dupName && !wsForm.remark) {
    showRemark.value = true
    ElMessage.warning('工作空间名称已存在，请添加备注以区分')
    return
  }
  if (dupName && wsForm.remark && dupName.remark === wsForm.remark.trim()) {
    ElMessage.warning('工作空间名称和备注与已有空间完全相同，请换一个备注')
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
.section { margin-bottom: 16px; }
.ws-header { display: flex; justify-content: space-between; align-items: center; }
.ws-grid { display: flex; gap: 16px; flex-wrap: wrap; }
.ws-card { width: 150px; padding: 20px 12px 12px; border: 1px solid #e5e7eb; border-radius: 12px; text-align: center; cursor: pointer; position: relative; transition: transform 0.15s, box-shadow 0.15s; }
.ws-card:hover { transform: translateY(-2px); box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
.ws-name { font-size: 13px; font-weight: 600; margin-top: 6px; }
.ws-remark { font-size: 11px; font-weight: 400; color: #909399; margin-top: 2px; }
.ws-action { margin-top: 8px; }
.empty-hint { color: #94a3b8; text-align: center; padding: 32px 0; }
.invitation-list { display: flex; flex-direction: column; }
.invitation-item { display: flex; align-items: center; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #f0f0f0; }
.invitation-item:last-child { border-bottom: none; }
.invitation-info { display: flex; align-items: center; gap: 12px; }
.invitation-text { font-size: 14px; margin-bottom: 2px; }
.invitation-from { font-size: 12px; color: #909399; }
.invitation-actions { display: flex; gap: 8px; flex-shrink: 0; }
</style>
