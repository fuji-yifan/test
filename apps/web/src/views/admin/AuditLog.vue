<template>
  <div>
    <h2>审计日志</h2>

    <!-- 筛选栏 -->
    <el-card class="filter-bar">
      <el-form
        :inline="true"
        size="default"
      >
        <el-form-item label="操作筛选">
          <el-cascader
            v-model="opCascade"
            :options="cascadeOptions"
            :props="{ expandTrigger: 'hover', value: 'value', label: 'label' }"
            clearable
            filterable
            placeholder="全部操作"
            style="width: 240px"
            @change="onCascadeChange"
          />
        </el-form-item>
        <el-form-item label="日期范围">
          <el-date-picker
            v-model="dateRange"
            type="daterange"
            range-separator="至"
            start-placeholder="开始"
            end-placeholder="结束"
            value-format="YYYY-MM-DD"
            @change="resetPage"
          />
        </el-form-item>
        <el-form-item>
          <el-button size="small" type="primary" @click="resetPage">查询</el-button>
          <el-button size="small" @click="clearFilters">重置</el-button>
          <el-button size="small" @click="exportCsv">导出 CSV</el-button>
          <el-dropdown
            style="margin-left: 8px"
            @command="doCleanup"
          >
            <el-button size="small" type="warning">
              清理日志 <el-icon><ArrowDown /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="1">
                  保留1天内记录
                </el-dropdown-item>
                <el-dropdown-item command="7">
                  保留7天内记录
                </el-dropdown-item>
                <el-dropdown-item command="30">
                  保留30天内记录
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 表格 -->
    <el-table
      v-loading="loading"
      :data="logs"
      stripe
    >
      <el-table-column
        prop="action"
        label="操作类型"
        min-width="80"
        align="center"
        show-overflow-tooltip
      />
      <el-table-column
        label="用户"
        min-width="120"
        align="center"
        show-overflow-tooltip
      >
        <template #default="{ row }">
          <el-tooltip
            v-if="row.user"
            :content="'用户ID：' + row.userId"
            placement="top"
            effect="light"
          >
            <span class="user-link">{{ row.user.nickname || row.user.email }}</span>
          </el-tooltip>
          <span v-else>-</span>
        </template>
      </el-table-column>
      <el-table-column
        label="时间"
        min-width="120"
        align="center"
      >
        <template #default="{ row }">
          {{ formatDate(row.createdAt) }}
        </template>
      </el-table-column>
    </el-table>

    <el-empty
      v-if="!loading && logs.length === 0"
      description="暂无审计日志"
    />

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
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowDown } from '@element-plus/icons-vue'
import http from '@/api/client'

const route = useRoute()
const wsId = computed(() => route.params.wsId as string)

const logs = ref<any[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = 20
const loading = ref(false)

const filters = reactive({
  action: '',
  resourceType: '',
})
const dateRange = ref<[string, string] | null>(null)

const opCascade = ref<string[]>([])
const cascadeOptions = buildCascade()

function buildCascade() {
  return [
    { value: 'Form', label: '表单', children: [
      { value: '新建表单', label: '新建表单' },
      { value: '修改表单', label: '修改表单' },
      { value: '发布表单', label: '发布表单' },
      { value: '归档表单', label: '归档表单' },
      { value: '复制表单', label: '复制表单' },
      { value: '删除表单', label: '删除表单' },
    ]},
    { value: 'FormSubmission', label: '数据', children: [
      { value: '提交表单数据', label: '提交表单数据' },
      { value: '删除表单数据', label: '删除表单数据' },
      { value: '导出表单数据', label: '导出表单数据' },
    ]},
    { value: 'Template', label: '模板', children: [
      { value: '创建模板', label: '创建模板' },
      { value: '修改模板', label: '修改模板' },
      { value: '删除模板', label: '删除模板' },
    ]},
    { value: '_flow', label: '流程', children: [
      { value: '新建固有流程', label: '新建固有流程' },
      { value: '修改固有流程', label: '修改固有流程' },
      { value: '删除固有流程', label: '删除固有流程' },
      { value: '发起我的流程', label: '发起我的流程' },
      { value: '撤回我的流程', label: '撤回我的流程' },
      { value: '删除我的流程', label: '删除我的流程' },
    ]},
    { value: 'TaskInstance', label: '任务', children: [
      { value: '通过审批', label: '通过审批' },
      { value: '驳回审批', label: '驳回审批' },
      { value: '转交审批', label: '转交审批' },
      { value: '超时升级', label: '超时升级' },
    ]},
    { value: 'WorkspaceMember', label: '成员', children: [
      { value: '邀请成员', label: '邀请成员' },
      { value: '修改成员角色', label: '修改成员角色' },
      { value: '移除成员', label: '移除成员' },
    ]},
    { value: 'Role', label: '角色', children: [
      { value: '新建角色', label: '新建角色' },
      { value: '编辑角色权限', label: '编辑角色权限' },
      { value: '删除角色', label: '删除角色' },
    ]},
    { value: '_audit', label: '日志', children: [
      { value: '清理审计日志', label: '清理审计日志' },
      { value: '导出审计日志', label: '导出审计日志' },
    ]},
  ]
}

function onCascadeChange(val: string[]) {
  if (val && val.length === 2) {
    if (val[0] === '_flow') {
      const flowMap: Record<string, string> = {
        '新建固有流程': 'ProcessDefinition',
        '修改固有流程': 'ProcessDefinition',
        '删除固有流程': 'ProcessDefinition',
        '发起我的流程': 'ProcessInstance',
        '撤回我的流程': 'ProcessInstance',
        '删除我的流程': 'ProcessInstance',
      }
      filters.resourceType = flowMap[val[1]] || ''
      filters.action = val[1] as string
    } else if (val[0] === '_audit') {
      filters.resourceType = 'AuditLog'
      filters.action = val[1] as string
    } else {
      filters.resourceType = val[0] as string
      filters.action = val[1] as string
    }
  } else {
    filters.resourceType = ''
    filters.action = ''
  }
  resetPage()
}

function resetPage() { page.value = 1; fetchLogs() }

function clearFilters() {
  filters.action = ''
  filters.resourceType = ''
  opCascade.value = []
  dateRange.value = null
  resetPage()
}

async function fetchLogs() {
  loading.value = true
  try {
    const params: Record<string, string | number> = { page: page.value, pageSize }
    if (filters.action) params.action = filters.action
    if (filters.resourceType) params.resourceType = filters.resourceType
    if (dateRange.value) {
      params.startDate = dateRange.value[0]
      params.endDate = dateRange.value[1]
    }
    const res = await http.get(`/workspaces/${wsId.value}/audit-logs`, { params })
    const data = res.data || res
    logs.value = data?.list || []
    total.value = data?.pagination?.total || 0
  } finally { loading.value = false }
}

async function doCleanup(days: string) {
  try {
    await ElMessageBox.confirm(
      `确定删除 ${days} 天前的所有审计日志？此操作不可撤销。`,
      '清理确认',
      { confirmButtonText: '确定清理', cancelButtonText: '取消', type: 'warning' },
    )
    const res = await http.delete(`/workspaces/${wsId.value}/audit-logs/cleanup`, { params: { days: +days } }) as any
    const data = res.data || res
    ElMessage.success(`已清理 ${data.deletedCount || 0} 条记录`)
    fetchLogs()
  } catch { /* 取消 */ }
}

async function exportCsv() {
  try {
    const params: any = {}
    if (filters.action) params.action = filters.action
    if (filters.resourceType) params.resourceType = filters.resourceType
    if (dateRange.value) {
      params.startDate = dateRange.value[0]
      params.endDate = dateRange.value[1]
    }
    const res = await http.get(`/workspaces/${wsId.value}/audit-logs/export`, {
      params,
      responseType: 'blob',
    }) as any
    const blob = res instanceof Blob ? res : new Blob([res], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'audit-logs.csv'
    a.click()
    URL.revokeObjectURL(url)
    ElMessage.success('导出成功')
  } catch (e: any) { if (e?.__handled) return; ElMessage.error('导出失败') }
}

onMounted(() => { fetchLogs() })
watch(page, fetchLogs)
watch(() => route.params.wsId, () => { page.value = 1; fetchLogs() })

function formatDate(d: string) { return d ? new Date(d).toLocaleString('zh-CN') : '-' }
</script>

<style scoped>
h2 { margin: 0 0 16px; }
.mono { font-family: monospace; font-size: 12px; }
.pagination { margin-top: 16px; justify-content: center; }
.filter-bar { margin-bottom: 16px; }
.filter-bar .el-form { margin-bottom: 0; }
pre { margin: 0; font-size: 12px; max-height: 200px; overflow: auto; background: #f5f5f5; padding: 8px; border-radius: 4px; }
</style>
