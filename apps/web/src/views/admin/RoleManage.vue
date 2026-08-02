<template>
  <div>
    <div class="page-header">
      <h2>角色权限管理</h2>
      <el-button type="primary" @click="openCreate">新建角色</el-button>
    </div>

    <!-- 权限矩阵 -->
    <el-card class="section-card" v-if="matrix.roles && matrix.roles.length">
      <template #header><span>权限矩阵</span></template>
      <div class="matrix-scroll">
        <div class="matrix-wrapper">
        <table class="matrix-table">
          <thead>
            <tr class="tr-group">
              <th class="col-role" rowspan="2">角色权限</th>
              <template v-for="group in permGroups" :key="group.group">
                <th :colspan="group.perms.length" class="th-group">{{ group.group }}</th>
              </template>
            </tr>
            <tr>
              <template v-for="group in permGroups" :key="'sub-'+group.group">
                <th v-for="p in group.perms" :key="p.key" class="th-perm">{{ p.label }}</th>
              </template>
            </tr>
          </thead>
          <tbody>
            <tr v-for="role in matrix.roles" :key="role.id">
              <td class="col-role">{{ role.name }}</td>
              <template v-for="group in permGroups" :key="'body-'+group.group">
                <td
                  v-for="p in group.perms" :key="p.key"
                  class="td-check"
                  :class="{ 'td-check--active': hasPerm(role, p.key), 'td-check--locked': role.isSystem && !isOwner }"
                  @click="(role.isSystem && !isOwner) ? undefined : toggleMatrixPerm(role, p.key)"
                >
                  <el-icon v-if="hasPerm(role, p.key)" color="#409eff"><Check /></el-icon>
                </td>
              </template>
            </tr>
          </tbody>
        </table>
        </div>
      </div>
    </el-card>

    <!-- 角色列表 -->
    <el-card class="section-card">
      <template #header><span>角色列表</span></template>
      <el-table :data="roles" stripe>
        <el-table-column prop="name" label="角色名" width="120" align="center" />
        <el-table-column label="权限列表" min-width="400" align="center">
          <template #default="{ row }">
            <template v-if="(row.permissions || []).includes('*')">
              <el-tag size="small" type="danger">全部权限</el-tag>
            </template>
            <template v-else>
              <el-tag
                v-for="p in (row.permissions || [])" :key="p"
                size="small"
                style="margin-right: 4px; margin-bottom: 4px"
              >{{ permLabel(p) }}</el-tag>
            </template>
          </template>
        </el-table-column>
        <el-table-column label="用户数" min-width="60" align="center">
          <template #default="{ row }">{{ row.users?.length || 0 }}</template>
        </el-table-column>
        <el-table-column label="操作" width="160" align="center">
          <template #default="{ row }">
            <template v-if="row.isSystem && !isOwner">
              <span class="system-hint">系统角色</span>
            </template>
            <template v-if="!row.isSystem || isOwner">
              <el-button size="small" @click="openEdit(row)">编辑</el-button>
              <el-button size="small" type="danger" @click="deleteRole(row)">删除</el-button>
            </template>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 新建/编辑角色 -->
    <el-dialog v-model="showDialog" :title="editingRole ? '编辑角色' : '新建角色'" width="680px">
      <el-form :model="form" label-width="60px">
        <el-form-item label="名称">
          <el-input v-model="form.name" placeholder="如：数据管理员" />
        </el-form-item>
        <el-form-item label="权限">
          <div class="perm-container">
          <div v-for="group in mainGroups" :key="group.group" class="perm-group">
            <div class="perm-group-header">
              <el-checkbox :model-value="isGroupAllChecked(group)" :indeterminate="isGroupIndeterminate(group)" @change="(v: any) => toggleGroup(group, v)">
                <span class="group-name">{{ group.group }}</span>
              </el-checkbox>
            </div>
            <div class="perm-children">
              <el-checkbox v-for="p in group.perms" :key="p.key" :model-value="form.permissions.includes(p.key)" @change="(v: any) => togglePerm(p.key, v)">{{ p.label }}</el-checkbox>
            </div>
          </div>
          <div v-for="group in otherGroup" :key="group.group" class="perm-group">
            <div class="perm-group-header">
              <el-checkbox :model-value="isGroupAllChecked(group)" :indeterminate="isGroupIndeterminate(group)" @change="(v: any) => toggleGroup(group, v)">
                <span class="group-name">{{ group.group }}</span>
              </el-checkbox>
            </div>
            <div class="perm-children">
              <el-checkbox v-for="p in group.perms" :key="p.key" :model-value="form.permissions.includes(p.key)" @change="(v: any) => togglePerm(p.key, v)">{{ p.label }}</el-checkbox>
            </div>
          </div>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showDialog = false">取消</el-button>
        <el-button type="primary" @click="doSave">{{ editingRole ? '保存' : '创建' }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Check } from '@element-plus/icons-vue'
import http from '@/api/client'
import { useWorkspaceStore } from '@/stores/workspace'

const route = useRoute()
const wsStore = useWorkspaceStore()
const wsId = computed(() => route.params.wsId as string)
const isOwner = computed(() => wsStore.current?.role === 'owner')
const roles = ref<any[]>([])
const matrix = ref<any>({})
const showDialog = ref(false)
const editingRole = ref<any>(null)
const form = reactive({ name: '', permissions: [] as string[] })

const permGroups = [
  { group: '表单', perms: [
    { key: 'form:create', label: '新建表单' }, { key: 'form:edit', label: '修改表单' },
    { key: 'form:publish', label: '发布表单' }, { key: 'form:archive', label: '归档表单' },
    { key: 'form:copy', label: '复制表单' }, { key: 'form:delete', label: '删除表单' },
  ]},
  { group: '数据', perms: [
    { key: 'submission:create', label: '提交表单数据' }, { key: 'submission:view', label: '查看表单数据' },
    { key: 'submission:delete', label: '删除表单数据' }, { key: 'submission:export', label: '导出表单数据' },
    { key: 'analytics:view', label: '查看数据分析' },
  ]},
  { group: '模板', perms: [
    { key: 'template:create', label: '创建模板' }, { key: 'template:edit', label: '修改模板' },
    { key: 'template:delete', label: '删除模板' },
  ]},
  { group: '流程', perms: [
    { key: 'workflow:manage', label: '新建固有流程' }, { key: 'workflow:edit', label: '修改固有流程' },
    { key: 'workflow:delete', label: '删除固有流程' }, { key: 'workflow:start', label: '发起我的流程' },
    { key: 'workflow:withdraw', label: '撤回我的流程' }, { key: 'workflow:remove', label: '删除我的流程' },
  ]},
  { group: '任务', perms: [
    { key: 'task:approve', label: '通过审批' }, { key: 'task:reject', label: '驳回审批' },
    { key: 'task:transfer', label: '转交审批' },
  ]},
  { group: '成员', perms: [
    { key: 'member:invite', label: '添加成员' }, { key: 'member:role', label: '修改成员角色' },
    { key: 'member:remove', label: '移除成员' },
  ]},
  { group: '角色', perms: [
    { key: 'role:create', label: '新建角色' }, { key: 'role:edit', label: '编辑角色权限' },
    { key: 'role:delete', label: '删除角色' },
  ]},
  { group: '日志', perms: [
    { key: 'audit:view', label: '查看审计日志' },
    { key: 'audit:export', label: '导出审计日志' },
  ]},
]
const mainGroups = computed(() => permGroups.slice(0, 7))
const otherGroup = computed(() => permGroups.slice(7))

const permLabelMapBase: Record<string, string> = { '*': '全部权限' }
for (const g of permGroups) for (const p of g.perms) permLabelMapBase[p.key] = p.label
const permLabelMap = ref({ ...permLabelMapBase })
function permLabel(key: string) { return permLabelMap.value[key] || key }
watch(() => matrix.value.allPermissions, (perms) => {
  if (perms) { const m = { ...permLabelMapBase }; for (const p of perms) m[p.key] = p.label; permLabelMap.value = m }
})

function hasPerm(role: any, key: string) {
  const perms = role.permissions || []
  return perms.includes('*') || perms.includes(key)
}

function isGroupAllChecked(g: typeof permGroups[0]) { return g.perms.every(p => form.permissions.includes(p.key)) }
function isGroupIndeterminate(g: typeof permGroups[0]) {
  const some = g.perms.some(p => form.permissions.includes(p.key))
  return some && !isGroupAllChecked(g)
}
function toggleGroup(g: typeof permGroups[0], checked: boolean) {
  if (checked) { for (const p of g.perms) { if (!form.permissions.includes(p.key)) form.permissions.push(p.key) } }
  else { form.permissions = form.permissions.filter(k => !g.perms.some(p => p.key === k)) }
}
function togglePerm(key: string, checked: boolean) {
  if (checked) { if (!form.permissions.includes(key)) form.permissions.push(key) }
  else { form.permissions = form.permissions.filter(k => k !== key) }
}

async function fetchData() {
  const [r, m] = await Promise.all([
    http.get(`/workspaces/${wsId.value}/roles`) as any,
    http.get(`/workspaces/${wsId.value}/roles/matrix`) as any,
  ])
  roles.value = (r.data || r)?.list || r.data || r || []
  matrix.value = m.data || m || {}
}

onMounted(fetchData)
watch(() => route.params.wsId, fetchData)

function openCreate() {
  editingRole.value = null
  form.name = ''
  form.permissions = []
  showDialog.value = true
}

function openEdit(role: any) {
  editingRole.value = role
  form.name = role.name
  form.permissions = [...(role.permissions || [])]
  showDialog.value = true
}

async function doSave() {
  if (!form.name.trim()) { ElMessage.warning('请输入角色名'); return }
  try {
    if (editingRole.value) {
      await http.patch(`/workspaces/${wsId.value}/roles/${editingRole.value.id}`, {
        name: form.name.trim(),
        permissions: form.permissions,
      })
      ElMessage.success('已更新')
    } else {
      await http.post(`/workspaces/${wsId.value}/roles`, { name: form.name.trim(), permissions: form.permissions })
      ElMessage.success('已创建')
    }
    showDialog.value = false
    editingRole.value = null
    form.name = ''; form.permissions = []
    fetchData()
  } catch (e: any) { ElMessage.error(e.response?.data?.message || '保存失败') }
}

async function toggleMatrixPerm(role: any, permKey: string) {
  const perms = [...(role.permissions || [])]
  if (perms.includes('*')) return // 全部权限不允许直接修改
  const idx = perms.indexOf(permKey)
  if (idx >= 0) {
    perms.splice(idx, 1)
  } else {
    perms.push(permKey)
  }
  try {
    await http.patch(`/workspaces/${wsId.value}/roles/${role.id}`, { permissions: perms })
    role.permissions = perms
    ElMessage.success('权限已更新')
  } catch (e: any) { ElMessage.error(e.response?.data?.message || '更新失败') }
}

async function deleteRole(row: any) {
  try {
    await ElMessageBox.confirm(`确定删除角色「${row.name}」？`, '删除确认', {
      confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning',
    })
    await http.delete(`/workspaces/${wsId.value}/roles/${row.id}`)
    ElMessage.success('已删除')
    fetchData()
  } catch { /* 取消 */ }
}
</script>

<style scoped>
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.page-header h2 { margin: 0; }
.section-card { margin-bottom: 20px; }

/* 矩阵 */
.matrix-scroll { overflow-x: auto; }
.matrix-wrapper { border-radius: 8px; border: 1px solid var(--app-border-color); display: inline-block; min-width: 100%; }
.matrix-table { border-collapse: separate; border-spacing: 0; font-size: 12px; }
.matrix-table th, .matrix-table td { border-right: 1px solid var(--app-border-color); border-bottom: 1px solid var(--app-border-color); padding: 6px 10px; white-space: nowrap; text-align: center; }
.matrix-table th:last-child, .matrix-table td:last-child { border-right: none; }
.matrix-table tr:last-child td { border-bottom: none; }
.matrix-table thead th { background: #fafbfc; font-weight: 600; color: #303133; }
.col-role { min-width: 100px; text-align: center; font-weight: 600; }
.tr-group th { border-bottom-width: 2px; }
.th-group { text-align: center; font-size: 13px; padding: 8px 16px; color: #1f2937; }
.th-perm { text-align: center; font-size: 11px; font-weight: 500; color: #606266; padding: 4px 10px; }
.td-check { text-align: center; cursor: pointer; transition: background 0.15s; }
.td-check:hover { background: #ecf5ff; }
.td-check--active { background: #ecf5ff; }
.td-check--locked { cursor: not-allowed; opacity: 0.5; }
.td-check--locked:hover { background: transparent; }
.edit-btn { margin-left: 4px; }
.system-hint { color: #909399; font-size: 12px; }

/* 新建对话框 */
.perm-container { display: flex; flex-direction: column; }
.perm-group { border: 1px solid var(--app-border-color); border-radius: 8px; padding: 12px 16px; margin-bottom: 12px; }
.perm-group-header { padding-bottom: 8px; margin-bottom: 8px; border-bottom: 1px solid #f2f3f5; }
.group-name { font-weight: 600; font-size: 14px; color: #303133; }
.perm-children { display: flex; flex-wrap: wrap; gap: 4px 20px; }

html.dark .matrix-table th, html.dark .matrix-table td { border-color: #334155; }
html.dark .matrix-table thead th { background: #1e293b; color: #cbd5e1; }
html.dark .perm-group { border-color: #334155; }
html.dark .perm-group-header { border-bottom-color: #334155; }
html.dark .group-name { color: #e2e8f0; }
html.dark .th-group { color: #e2e8f0; }
html.dark .td-check:hover { background: #1a3a5c; }
html.dark .td-check--active { background: #1a3a5c; }
</style>
