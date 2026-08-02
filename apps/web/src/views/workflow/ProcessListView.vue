<template>
  <div class="process-list-page">
    <div class="page-header">
      <h2>流程管理</h2>
      <el-button size="small" type="primary" @click="showCreate = true">
        <el-icon><Plus /></el-icon> 新建流程
      </el-button>
    </div>

    <!-- 搜索&筛选 -->
    <div class="filters">
      <el-input
        v-model="searchKeyword"
        placeholder="搜索流程名称"
        clearable
        style="width: 240px"
        @input="fetchList"
      />
      <el-select
        v-model="statusFilter"
        placeholder="状态筛选"
        clearable
        style="width: 140px"
        @change="fetchList"
      >
        <el-option
          label="全部"
          value=""
        />
        <el-option
          label="草稿"
          value="draft"
        />
        <el-option
          label="已发布"
          value="published"
        />
        <el-option
          label="已归档"
          value="archived"
        />
      </el-select>
    </div>

    <!-- 列表 -->
    <el-table
      v-loading="loading"
      :data="list"
      stripe
      style="margin-top: 16px"
    >
      <el-table-column
        prop="name"
        label="流程名称"
        min-width="120"
        align="center"
        show-overflow-tooltip
      >
        <template #default="{ row }">
          <router-link :to="`/workspace/${wsId}/workflows/${row.id}/designer`">
            {{ row.name }}
          </router-link>
        </template>
      </el-table-column>
      <el-table-column
        prop="description"
        label="描述"
        min-width="300"
        align="center"
        show-overflow-tooltip
      />
      <el-table-column
        prop="status"
        label="状态"
        min-width="90"
        align="center"
      >
        <template #default="{ row }">
          <el-tag
            :type="row.status === 'published' ? 'success' : row.status === 'draft' ? 'info' : 'warning'"
            size="small"
          >
            {{ row.status === 'published' ? '已发布' : row.status === 'draft' ? '草稿' : '已归档' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column
        label="发布时间"
        min-width="150"
        align="center"
      >
        <template #default="{ row }">
          {{ row.publishedAt ? formatDate(row.publishedAt) : '-' }}
        </template>
      </el-table-column>
      <el-table-column
        label="操作"
        min-width="150"
        align="center"
        fixed="right"
      >
        <template #default="{ row }">
          <el-button
            size="small"
            @click="openDesigner(row)"
          >
            设计
          </el-button>
          <el-button
            v-if="row.status === 'draft'"
            size="small"
            type="success"
            @click="publishDef(row)"
          >
            发布
          </el-button>
          <el-button
            v-if="row.status === 'published'"
            size="small"
            type="warning"
            @click="unpublishDef(row)"
          >
            撤销发布
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
    </el-table>
    <el-empty v-if="!list.length" description="暂无流程" />

    <!-- 分页 -->
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

    <!-- 新建对话框 -->
    <el-dialog
      v-model="showCreate"
      title="新建流程"
      width="420px"
      @closed="resetForm"
    >
      <el-form
        :model="createForm"
        label-width="80px"
        @submit.prevent="doCreate"
      >
        <el-form-item
          label="名称"
          required
        >
          <el-input
            v-model="createForm.name"
            placeholder="如：请假审批流程"
          />
        </el-form-item>
        <el-form-item label="描述">
          <el-input
            v-model="createForm.description"
            type="textarea"
            placeholder="流程用途说明"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button size="small" @click="showCreate = false">取消</el-button>
        <el-button size="small" type="primary" :loading="creating" @click="doCreate">创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import http from '@/api/client'

const route = useRoute()
const router = useRouter()
const wsId = computed(() => route.params.wsId as string)

const list = ref<any[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = 20
const loading = ref(false)
const searchKeyword = ref('')
const statusFilter = ref('')

const showCreate = ref(false)
const creating = ref(false)
const createForm = ref({ name: '', description: '' })

onMounted(() => fetchList())
watch(() => route.params.wsId, fetchList)

async function fetchList() {
  loading.value = true
  try {
    const res = await http.get(`/workspaces/${wsId.value}/workflows`, {
      params: { page: page.value, pageSize, keyword: searchKeyword.value || undefined, status: statusFilter.value || undefined },
    }) as any
    const data = res.data || res
    list.value = data.list || []
    total.value = data.pagination?.total || 0
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || '加载失败')
  } finally {
    loading.value = false
  }
}

function changePage(p: number) { page.value = p; fetchList() }

async function doCreate() {
  if (!createForm.value.name.trim()) return ElMessage.warning('请输入流程名称')
  creating.value = true
  try {
    await http.post(`/workspaces/${wsId.value}/workflows`, createForm.value)
    ElMessage.success('创建成功')
    showCreate.value = false
    fetchList()
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || '创建失败')
  } finally {
    creating.value = false
  }
}

function resetForm() { createForm.value = { name: '', description: '' } }

function openDesigner(row: any) {
  router.push(`/workspace/${wsId.value}/workflows/${row.id}/designer`)
}

async function publishDef(row: any) {
  try {
    await http.post(`/workflows/${row.id}/publish`)
    ElMessage.success('已发布')
    fetchList()
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || '发布失败')
  }
}

async function unpublishDef(row: any) {
  try {
    await http.post(`/workflows/${row.id}/unpublish`)
    ElMessage.success('已撤销发布')
    fetchList()
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || '撤销失败')
  }
}

async function confirmDelete(row: any) {
  try {
    await ElMessageBox.confirm(
      `确定删除流程「${row.name}」？删除后无法恢复。`,
      '删除确认',
      { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' },
    )
    await http.delete(`/workflows/${row.id}`)
    ElMessage.success('已删除')
    fetchList()
  } catch (e: any) {
    if (e !== 'cancel') ElMessage.error(e.response?.data?.message || '删除失败')
  }
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
.filters { display: flex; gap: 12px; }
</style>
