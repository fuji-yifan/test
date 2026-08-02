<template>
  <div>
    <div class="page-header">
      <h2>成员管理</h2>
      <el-button
        type="primary"
        @click="openInvite"
      >
        添加成员
      </el-button>
    </div>
    <el-table
      :data="members"
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
                label="编辑者"
                value="editor"
              />
              <el-option
                label="查看者"
                value="viewer"
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
      title="添加成员"
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
              label="编辑者"
              value="editor"
            />
            <el-option
              label="查看者"
              value="viewer"
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
          添加
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

const route = useRoute()
const wsId = computed(() => route.params.wsId as string)
const members = ref<any[]>([])
const showInvite = ref(false)
const inviting = ref(false)
const searching = ref(false)
const inviteForm = reactive({ email: '', role: 'viewer' })
const userOptions = ref<any[]>([])

async function fetchMembers() {
  const res = await http.get(`/workspaces/${wsId.value}/members`) as any
  members.value = (res.data || res)?.list || res.data || res || []
}

onMounted(fetchMembers)
watch(() => route.params.wsId, fetchMembers)

async function searchUsers(query: string) {
  if (!query || query.length < 1) { userOptions.value = []; return }
  searching.value = true
  try {
    const res = await http.get('/auth/users', { params: { search: query } }) as any
    userOptions.value = (res.data || res) || []
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
    await http.post(`/workspaces/${wsId.value}/members`, {
      email: inviteForm.email.trim(),
      role: inviteForm.role,
    })
    ElMessage.success('已添加')
    showInvite.value = false
    fetchMembers()
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || '添加失败')
  } finally {
    inviting.value = false
  }
}

async function changeRole(row: any, role: string) {
  try {
    await http.patch(`/workspaces/${wsId.value}/members/${row.userId || row.user.id}`, { role })
    ElMessage.success('角色已更新')
    fetchMembers()
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || '更新失败')
  }
}

async function removeMember(row: any) {
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
.owner-tag { color: #909399; font-size: 13px; }
.system-hint { color: #909399; font-size: 12px; }
</style>
