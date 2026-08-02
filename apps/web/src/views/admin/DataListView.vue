<template>
  <div>
    <div class="page-header">
      <h2>提交数据</h2>
      <div class="header-actions">
        <el-button @click="exportCSV">导出 CSV</el-button>
        <el-button @click="exportExcel">导出 Excel</el-button>
      </div>
    </div>

    <el-table :data="list" stripe v-loading="loading">
      <el-table-column type="index" label="#" width="55" align="center" />
<el-table-column label="提交人" min-width="120" align="center" show-overflow-tooltip>
        <template #default="{ row }">
          <el-tooltip v-if="row.submitter" :content="'用户ID：' + row.submitterId" placement="top" effect="light">
            <span class="user-link">{{ row.submitter.nickname || row.submitter.email }}</span>
          </el-tooltip>
          <span v-else>匿名</span>
        </template>
      </el-table-column>
      <el-table-column label="提交时间" min-width="150" align="center">
        <template #default="{ row }">{{ formatDate(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="状态" min-width="120" align="center">
        <template #default="{ row }">
          <el-tag :type="row.status==='submitted'?'info':row.status==='reviewed'?'success':'warning'" size="small">
            {{ row.status }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" min-width="150" align="center" fixed="right">
        <template #default="{ row }">
          <el-button size="small" @click="viewDetail(row)">详情</el-button>
          <el-button size="small" type="danger" @click="deleteItem(row)">删除</el-button>
        </template>
      </el-table-column>
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
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import http from '@/api/client'

const route = useRoute()
const router = useRouter()
const wsId = computed(() => route.params.wsId as string)
const formId = route.params.formId as string

const list = ref<any[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = 20
const loading = ref(false)

async function fetchData() {
  loading.value = true
  try {
    const res = await http.get(`/forms/${formId}/submissions`, { params: { page: page.value, pageSize } }) as any
    const data = res.data || res
    list.value = data?.list || []
    total.value = data?.pagination?.total || 0
  } finally { loading.value = false }
}

onMounted(fetchData)
watch(page, fetchData)
watch(() => route.params.wsId, () => { page.value = 1; fetchData() })

function viewDetail(row: any) { router.push(`/workspace/${wsId.value}/forms/${formId}/data/${row.id}`) }
async function deleteItem(row: any) {
  try {
    await ElMessageBox.confirm('确定删除该提交记录？', '删除确认', { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' })
    await http.delete(`/forms/${formId}/submissions/${row.id}`)
    ElMessage.success('已删除')
    fetchData()
  } catch { /* 取消 */ }
}

function exportCSV() { ElMessage.info('导出 CSV 功能待接入') }
function exportExcel() { ElMessage.info('导出 Excel 功能待接入') }
function formatDate(d: string) { return d ? new Date(d).toLocaleString('zh-CN') : '-' }
</script>

<style scoped>
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-shrink: 0; }
.page-header h2 { margin: 0; }
.header-actions { display: flex; gap: 12px; }
.mono { font-family: monospace; font-size: 12px; }
.pagination { margin-top: 16px; justify-content: center; flex-shrink: 0; }
</style>
