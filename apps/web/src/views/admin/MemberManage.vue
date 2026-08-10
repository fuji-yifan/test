<template>
  <div>
    <div class="page-header">
      <h2>成员管理</h2>
      <div class="header-actions">
        <el-select
          v-model="sortOrder"
          placeholder="排序"
          style="width:120px"
        >
          <el-option label="按时间最近" value="desc" />
          <el-option label="按时间最早" value="asc" />
        </el-select>
        <el-button type="primary" @click="openInvite">邀请成员</el-button>
      </div>
    </div>
    <div class="filter-bar">
      <el-tabs v-model="activeRole" @tab-change="onRoleChange">
        <el-tab-pane label="全部" name="" />
        <el-tab-pane
          v-for="r in filterRoles"
          :key="r.key"
          :label="r.name"
          :name="r.key"
        />
      </el-tabs>
    </div>
    <el-skeleton
      v-if="loading"
      :rows="5"
      animated
      style="padding: 20px"
    />
    <el-table
      v-else
      :data="filteredMembers"
      stripe
    >
      <el-table-column
        prop="user.email"
        label="邮箱"
        min-width="200"
        align="center"
        show-overflow-tooltip
      />
      <el-table-column
        label="昵称"
        min-width="140"
        align="center"
      >
        <template #default="{ row }">
          <el-tooltip
            :content="'用户ID：' + row.user.id"
            placement="top"
            effect="light"
          >
            <span class="user-link">{{ row.user.nickname || '-' }}</span>
          </el-tooltip>
        </template>
      </el-table-column>
      <el-table-column
        label="角色"
        min-width="140"
        align="center"
      >
        <template #default="{ row }">
          <span
            v-if="row.role === 'owner'"
            class="owner-tag"
          >创建者</span>
          <template v-else>
            <el-select
              :model-value="row.role"
              size="small"
              @change="(v: string) => changeRole(row, v)"
            >
              <el-option
                v-for="r in availableRoles"
                :key="r.key"
                :label="r.name"
                :value="r.key"
              />
            </el-select>
          </template>
        </template>
      </el-table-column>
      <el-table-column
        label="加入时间"
        min-width="180"
        align="center"
      >
        <template #default="{ row }">
          {{ row.createdAt ? new Date(row.createdAt).toLocaleString('zh-CN') : '-' }}
        </template>
      </el-table-column>
      <el-table-column
        label="操作"
        min-width="80"
        align="center"
        fixed="right"
      >
        <template #default="{ row }">
          <span v-if="row.role === 'owner'" class="system-hint">系统角色</span>
          <el-button
            v-else
            size="small"
            type="danger"
            @click="removeMember(row)"
          >
            移除
          </el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-empty
      v-if="!members.length"
      description="暂无成员"
    />

    <el-dialog
      v-model="showInvite"
      title="邀请成员"
      width="480px"
    >
      <el-form
        :model="inviteForm"
        label-width="60px"
      >
        <el-form-item label="用户">
          <el-select
            v-model="inviteForm.email"
            filterable
            remote
            :remote-method="searchUsers"
            :loading="searching"
            placeholder="输入邮箱或昵称搜索"
            clearable
            style="width:100%"
          >
            <el-option
              v-for="u in userOptions"
              :key="u.email"
              :label="`${u.nickname || u.email} (${u.email})`"
              :value="u.email"
            >
              <span>{{ u.nickname || u.email }}</span>
              <span style="color:#909399;float:right;font-size:12px">{{ u.email }}</span>
            </el-option>
          </el-select>
        </el-form-item>
        <el-form-item label="角色">
          <el-select v-model="inviteForm.role">
            <el-option
              v-for="r in availableRoles"
              :key="r.key"
              :label="r.name"
              :value="r.key"
            />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showInvite = false">
          取消
        </el-button>
        <el-button
          type="primary"
          :loading="inviting"
          @click="doInvite"
        >
          发送邀请
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import http from '@/api/client'
import type { Member, Role, User } from '@/types/models'

const route = useRoute()
const wsId = computed(() => route.params.wsId as string)
const loading = ref(true)
const members = ref<Member[]>([])
const availableRoles = ref<{ name: string; key: string }[]>([])
const activeRole = ref('')
const sortOrder = ref('desc')
const showInvite = ref(false)
const inviting = ref(false)
const searching = ref(false)
const inviteForm = reactive({ email: '', role: 'viewer' })
const userOptions = ref<any[]>([])

const filterRoles = computed(() => {
  const seen = new Set<string>()
  const list = [{ name: '创建者', key: 'owner' }, ...availableRoles.value]
  return list.filter(r => { if (seen.has(r.key)) return false; seen.add(r.key); return true })
})

const filteredMembers = computed(() => {
  let list = [...members.value]
  if (activeRole.value === 'owner') {
    list = list.filter(m => m.role === 'owner')
  } else if (activeRole.value) {
    list = list.filter(m => m.role === activeRole.value)
  }
  list.sort((a, b) => {
    const da = new Date(a.createdAt).getTime()
    const db = new Date(b.createdAt).getTime()
    return sortOrder.value === 'asc' ? da - db : db - da
  })
  return list
})

function onRoleChange() { /* 切换角色筛选 */ }

async function fetchMembers() {
  loading.value = true
  try {
    const res = await http.get(`/workspaces/${wsId.value}/members`)
    members.value = (res as { data: Member[] }).data ?? []
  } catch {
    members.value = []
  } finally {
    loading.value = false
  }
}

async function fetchRoles() {
  try {
    const res = await http.get(`/workspaces/${wsId.value}/roles`)
    const roles = ((res as { data?: Role[] }).data || res || []) as Role[]
    availableRoles.value = roles
      .filter((r) => r.name !== '创建者')
      .map((r) => ({ name: r.name, key: ROLE_MAP_REVERSE[r.name] || r.name }))
    inviteForm.role = availableRoles.value[0]?.key || 'viewer'
  } catch { /* ignore */ }
}

const ROLE_MAP_REVERSE: Record<string, string> = { '创建者': 'owner', '编辑者': 'editor', '查看者': 'viewer' }

onMounted(() => { fetchMembers(); fetchRoles() })
watch(() => route.params.wsId, () => { fetchMembers(); fetchRoles() })

async function searchUsers(query: string) {
  if (!query || query.length < 1) { userOptions.value = []; return }
  searching.value = true
  try {
    const res = await http.get('/auth/users', { params: { search: query } })
    userOptions.value = ((res as { data?: User[] }).data || res || []) as User[]
  } catch { userOptions.value = [] }
  finally { searching.value = false }
}

function openInvite() {
  inviteForm.email = ''
  userOptions.value = []
  showInvite.value = true
}

async function doInvite() {
  if (!inviteForm.email.trim()) {
    ElMessage.warning('请选择或输入用户邮箱')
    return
  }
  inviting.value = true
  try {
    await http.post(`/workspaces/${wsId.value}/invitations`, {
      email: inviteForm.email.trim(),
      role: inviteForm.role,
    })
    ElMessage.success('邀请已发送')
    showInvite.value = false
    fetchMembers()
  } catch (e: unknown) {
    ElMessage.error((e as { response?: { data?: { message?: string } } }).response?.data?.message || '添加失败')
  } finally {
    inviting.value = false
  }
}

async function changeRole(row: Member, role: string) {
  try {
    await http.patch(`/workspaces/${wsId.value}/members/${row.userId || row.user.id}`, { role })
    ElMessage.success('角色已更新')
    fetchMembers()
  } catch (e: unknown) {
    ElMessage.error((e as { response?: { data?: { message?: string } } }).response?.data?.message || '更新失败')
  }
}

async function removeMember(row: Member) {
  try {
    await ElMessageBox.confirm(
      `确定移除成员「${row.user?.nickname || row.user?.email || ''}」？`,
      '移除确认',
      { confirmButtonText: '移除', cancelButtonText: '取消', type: 'warning' },
    )
    await http.delete(`/workspaces/${wsId.value}/members/${row.userId || row.user.id}`)
    ElMessage.success('已移除')
    fetchMembers()
  } catch { /* 取消 */ }
}
</script>

<style scoped>
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.page-header h2 { margin: 0; }
.header-actions { display: flex; gap: 12px; }
.filter-bar { margin-bottom: 8px; }
.owner-tag { color: #909399; font-size: 13px; }
.system-hint { color: #909399; font-size: 12px; }
</style>
