<template>
  <div class="process-list-page">
    <div class="page-header">
      <h2>流程管理</h2>
      <div class="header-actions">
        <el-input
          v-model="searchKeyword"
          placeholder="搜索流程..."
          clearable
          class="search-input"
          @input="onSearch"
        />
        <el-select
          v-model="statusFilter"
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
            label="草稿"
            value="draft"
          />
          <el-option
            label="已发布"
            value="published"
          />
        </el-select>
        <el-button type="primary" @click="showCreate = true">新建流程</el-button>
      </div>
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
          <router-link
            class="table-link"
            :to="`/workspace/${wsId}/workflows/${row.id}/designer`"
          >
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
            :type="row.status === 'published' ? 'success' : 'info'"
            size="small"
          >
            {{ row.status === 'published' ? '已发布' : '草稿' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column
        label="关联表单"
        min-width="140"
        align="center"
        show-overflow-tooltip
      >
        <template #default="{ row }">
          <!-- 跳去表单管理并按表单名搜索：带的是名字而非 id，因为表单可能已被彻底删除（列表查不到 → 空态） -->
          <router-link
            v-if="row.formName"
            class="table-link"
            :to="{ name: 'FormList', params: { wsId }, query: { keyword: row.formName } }"
          >
            {{ row.formName }}
          </router-link>
          <span v-else>-</span>
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

      <!-- 空态：图标 + 文案放进表格内，替换掉 el-table 自带的「暂无数据」 -->
      <template #empty>
        <el-empty
          description="暂无流程"
          :image-size="80"
        />
      </template>
    </el-table>

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
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import http from '@/api/client'

const route = useRoute()
const router = useRouter()
const wsId = computed(() => route.params.wsId as string)

const list = ref<any[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = 20
const loading = ref(false)
/** 初值取自 ?keyword=（表单管理的「流程表单」徽章点过来会带上流程名），首次 fetch 就用它过滤 */
const searchKeyword = ref(typeof route.query.keyword === 'string' ? route.query.keyword : '')
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

// 搜索做 300ms 防抖：输入/删除都等停顿后再发请求，避免每敲一键刷一次；并重置到第 1 页
let searchTimer: ReturnType<typeof setTimeout> | undefined
function onSearch() {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => { page.value = 1; fetchList() }, 300)
}
function onFilterChange() { page.value = 1; fetchList() }
onBeforeUnmount(() => clearTimeout(searchTimer))

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
    if (e !== 'cancel' && !e?.__handled) ElMessage.error(e.response?.data?.message || '删除失败')
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
.header-actions { display: flex; gap: 12px; }
.search-input { width: 200px; }

/* 表格里的链接：裸 <a> 是浏览器默认的蓝字 + 下划线，跟 Element Plus 表格不搭。
   对齐 el-link 的主色样式：静止无下划线，hover 变浅色并补上下划线。 */
.table-link { color: var(--el-color-primary); text-decoration: none; transition: color 0.15s; }
.table-link:hover { color: var(--el-color-primary-light-3); text-decoration: underline; }
</style>
