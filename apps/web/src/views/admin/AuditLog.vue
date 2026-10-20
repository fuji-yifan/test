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
        <el-form-item label="用户">
          <el-select
            v-model="filters.userId"
            clearable
            filterable
            placeholder="全部用户"
            style="width: 180px"
            @change="resetPage"
          >
            <el-option
              v-for="u in userOptions"
              :key="u.id"
              :label="u.nickname || u.email"
              :value="u.id"
            />
          </el-select>
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
        <!-- 没有「查询」按钮：级联 / 日期都是 @change 即时查询 -->
        <el-form-item>
          <el-button size="small" type="info" @click="clearFilters">清空查询</el-button>
          <el-button size="small" @click="exportCsv">导出 CSV</el-button>
        </el-form-item>
        <!-- 保留期自由填（原先只有 1/7/30 天三个选项）。min=1 只是挡住误操作，真正的下限在服务端 -->
        <el-form-item>
          <div class="cleanup-row">
            <span>日志保留</span>
            <el-input-number
              v-model="cleanupAmount"
              :min="1"
              :step="1"
              size="small"
              controls-position="right"
              style="width: 110px"
            />
            <el-select
              v-model="cleanupUnit"
              size="small"
              style="width: 80px"
            >
              <el-option
                label="天"
                value="day"
              />
              <el-option
                label="月"
                value="month"
              />
              <el-option
                label="年"
                value="year"
              />
            </el-select>
            <span>内</span>
            <el-button
              size="small"
              type="warning"
              @click="doCleanup"
            >
              清理
            </el-button>
          </div>
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
      <!-- 空态：放进表格内，替换掉 el-table 自带的「暂无数据」 -->
      <template #empty>
        <el-empty
          v-if="!loading"
          description="暂无审计日志"
          :image-size="80"
        />
      </template>
    </el-table>

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
  userId: '',
})
const userOptions = ref<{ id: string; email: string; nickname: string | null }[]>([])
const dateRange = ref<[string, string] | null>(null)
/** 清理日志时要保留多久：数量 + 单位（天/月/年） */
const cleanupAmount = ref(30)
const cleanupUnit = ref<'day' | 'month' | 'year'>('day')
const CLEANUP_UNIT_LABEL = { day: '天', month: '个月', year: '年' } as const

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
      { value: '发布固有流程', label: '发布固有流程' },
      { value: '撤回固有流程', label: '撤回固有流程' },
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
        '发布固有流程': 'ProcessDefinition',
        '撤回固有流程': 'ProcessDefinition',
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
  filters.userId = ''
  opCascade.value = []
  dateRange.value = null
  resetPage()
}

async function fetchUsers() {
  try {
    const res = await http.get(`/workspaces/${wsId.value}/audit-logs/users`)
    userOptions.value = ((res as any).data || res || []) as typeof userOptions.value
  } catch {
    userOptions.value = []
  }
}

async function fetchLogs() {
  loading.value = true
  try {
    const params: Record<string, string | number> = { page: page.value, pageSize }
    if (filters.action) params.action = filters.action
    if (filters.resourceType) params.resourceType = filters.resourceType
    if (filters.userId) params.userId = filters.userId
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

async function doCleanup() {
  const amount = cleanupAmount.value
  const unit = cleanupUnit.value
  try {
    await ElMessageBox.confirm(
      `确定只保留最近 ${amount} ${CLEANUP_UNIT_LABEL[unit]}内的记录，更早的审计日志将被删除？此操作不可撤销。`,
      '清理确认',
      { confirmButtonText: '确定清理', cancelButtonText: '取消', type: 'warning' },
    )
    const res = await http.delete(`/workspaces/${wsId.value}/audit-logs/cleanup`, { params: { amount, unit } }) as any
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
    if (filters.userId) params.userId = filters.userId
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

onMounted(() => { fetchLogs(); fetchUsers() })
watch(page, fetchLogs)
watch(() => route.params.wsId, () => { page.value = 1; fetchLogs(); fetchUsers() })

function formatDate(d: string) { return d ? new Date(d).toLocaleString('zh-CN') : '-' }
</script>

<style scoped>
h2 { margin: 0 0 16px; }
.mono { font-family: monospace; font-size: 12px; }
.pagination { margin-top: 16px; justify-content: center; }
.filter-bar { margin-bottom: 16px; }
.filter-bar .el-form { margin-bottom: 0; }
/* 数字框与前后文案在同一基线上对齐（inline 表单里 span、输入框、按钮的基线并不一致） */
.cleanup-row { display: inline-flex; align-items: center; gap: 8px; }
pre { margin: 0; font-size: 12px; max-height: 200px; overflow: auto; background: #f5f5f5; padding: 8px; border-radius: 4px; }
</style>
