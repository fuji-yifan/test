<template>
  <div class="form-list-page">
    <div class="page-header">
      <h2>表单管理</h2>
      <div class="header-actions">
        <el-button type="primary" @click="createForm">新建表单</el-button>
        <el-input v-model="search" placeholder="搜索表单..." clearable class="search-input" />
        <el-select v-model="statusFilter" placeholder="状态" clearable style="width:120px">
          <el-option label="全部" value="" />
          <el-option label="草稿" value="draft" />
          <el-option label="已发布" value="published" />
          <el-option label="已归档" value="archived" />
        </el-select>
        <el-select v-model="workflowFilter" placeholder="流程" clearable style="width:120px">
          <el-option label="全部" value="" />
          <el-option label="已绑定" value="bound" />
          <el-option label="未绑定" value="unbound" />
        </el-select>
      </div>
    </div>

    <!-- 分类标签页（样式仿模板市场） -->
    <el-tabs v-model="activeCategory" @tab-change="onCategoryChange">
      <el-tab-pane label="全部" name="" />
      <el-tab-pane v-for="c in FORM_CATEGORIES" :key="c" :label="c" :name="c" />
    </el-tabs>

    <!-- 卡片视图 -->
    <div v-if="filteredList.length" class="form-grid">
      <div v-for="f in filteredList" :key="f.id" class="form-card">
        <div class="card-body">
          <div class="card-title-row">
            <h4>{{ f.name }}</h4>
            <el-popover
              v-if="boundWorkflows[f.id]?.length"
              placement="bottom"
              :width="260"
              trigger="click"
            >
              <template #reference>
                <el-tag type="warning" size="small" class="workflow-badge" @click.stop>
                  已绑定流程
                </el-tag>
              </template>
              <div class="workflow-popover">
                <div
                  v-for="wf in boundWorkflows[f.id]"
                  :key="wf.id"
                  class="workflow-item"
                  @click="goWorkflowDesigner(wf.id)"
                >
                  <span class="wf-name">{{ wf.name }}</span>
                  <el-tag :type="wf.status === 'published' ? 'success' : 'info'" size="small">
                    {{ wf.status === 'published' ? '已发布' : '草稿' }}
                  </el-tag>
                </div>
              </div>
            </el-popover>
          </div>
          <p v-if="f.description" class="desc">{{ f.description }}</p>
          <div class="meta">
            <el-tag size="small" v-if="f.category">{{ f.category }}</el-tag>
            <el-tag :type="f.status==='published'?'success':f.status==='archived'?'warning':'info'" size="small">
              {{ statusLabel(f.status) }}
            </el-tag>
            <span class="time">{{ formatDate(f.updatedAt) }}</span>
          </div>
        </div>
        <div class="card-actions">
          <el-button size="small" @click="openDesigner(f)">设计</el-button>
          <el-button size="small" @click="viewData(f)">数据</el-button>
          <el-button size="small" @click="goSettings(f)">设置</el-button>
          <el-dropdown trigger="click">
            <el-button size="small">更多 <el-icon><ArrowDown /></el-icon></el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item @click="copyForm(f)">复制</el-dropdown-item>
                <el-dropdown-item v-if="f.status==='draft' || f.status==='archived'" @click="publishForm(f)">发布</el-dropdown-item>
                <el-dropdown-item v-if="f.status==='published'" @click="showPublishLink(f)">链接</el-dropdown-item>
                <el-dropdown-item v-if="f.status==='published'" @click="archiveForm(f)">归档</el-dropdown-item>
                <el-dropdown-item divided @click="deleteForm(f)">删除</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </div>
    </div>
    <el-empty v-if="!filteredList.length" description="暂无表单" />

    <el-pagination
      v-if="total > pageSize"
      v-model:current-page="page"
      :page-size="pageSize"
      :total="total"
      layout="prev, pager, next"
      class="pagination"
    />

    <!-- 新建表单弹窗 -->
    <el-dialog v-model="showCreate" title="新建表单" width="420px">
      <el-form :model="createFormData" @submit.prevent="doCreate">
        <el-form-item label="表单名称">
          <el-input v-model="createFormData.name" placeholder="请输入表单名称" @keyup.enter="doCreate" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="createFormData.description" type="textarea" :rows="2" placeholder="可选" />
        </el-form-item>
        <el-form-item label="分类">
          <el-select v-model="createFormData.category" placeholder="选择表单分类" clearable>
            <el-option v-for="c in FORM_CATEGORIES" :key="c" :label="c" :value="c" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreate = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="doCreate">创建</el-button>
      </template>
    </el-dialog>

    <!-- 发布成功链接弹窗 -->
    <PublishLinkDialog v-model:visible="showLink" :form-id="linkFormId" />
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowDown } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import http from '@/api/client'
import PublishLinkDialog from '@/components/PublishLinkDialog.vue'

// ==================== 6 大表单分类 ====================
const FORM_CATEGORIES = ['人事', '财务', '行政', '销售', '运营', '项目']

// ==================== 页面状态 ====================
const route = useRoute()
const router = useRouter()
const wsId = computed(() => route.params.wsId as string)

const list = ref<any[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = 12
const search = ref('')
const statusFilter = ref('')
const activeCategory = ref('')
const showCreate = ref(false)
const creating = ref(false)
const createFormData = reactive({ name: '', description: '', category: '' })
const showLink = ref(false)
const linkFormId = ref('')
const boundWorkflows = ref<Record<string, any[]>>({})
const workflowFilter = ref('')

const filteredList = computed(() => {
  if (!workflowFilter.value) return list.value
  const bound = workflowFilter.value === 'bound'
  return list.value.filter(f => bound ? !!boundWorkflows.value[f.id]?.length : !boundWorkflows.value[f.id]?.length)
})

// ==================== 数据加载 ====================
async function fetchList() {
  try {
    const params: any = { page: page.value, pageSize }
    if (statusFilter.value) params.status = statusFilter.value
    if (activeCategory.value) params.category = activeCategory.value
    if (search.value) params.keyword = search.value
    const res = await http.get(`/workspaces/${wsId.value}/forms`, { params }) as any
    const data = res.data || res
    list.value = data?.list || []
    total.value = data?.pagination?.total || 0
  } catch (e: any) {
    console.error('获取表单列表失败:', e)
  }
}

async function fetchBindings() {
  try {
    const res = await http.get(`/workspaces/${wsId.value}/workflow-bindings`) as any
    boundWorkflows.value = res.data || res || {}
  } catch { /* ignore */ }
}

onMounted(() => { fetchList(); fetchBindings() })
watch([page, statusFilter], fetchList)
watch(() => route.params.wsId, () => { page.value = 1; fetchList(); fetchBindings() })

function onCategoryChange() { page.value = 1; fetchList() }

// ==================== 表单操作 ====================
function createForm() { showCreate.value = true }

async function doCreate() {
  if (!createFormData.name.trim()) {
    ElMessage.warning('请输入表单名称')
    return
  }
  creating.value = true
  try {
    await http.post(`/workspaces/${wsId.value}/forms`, {
      name: createFormData.name.trim(),
      description: createFormData.description || undefined,
      category: createFormData.category || undefined,
    })
    showCreate.value = false
    createFormData.name = ''
    createFormData.description = ''
    createFormData.category = ''
    await fetchList()
  } catch (e: any) {
    const msg = e.response?.data?.message || e.message || '创建失败'
    ElMessage.error('创建失败: ' + msg)
  } finally {
    creating.value = false
  }
}

function openDesigner(f: any) { router.push(`/workspace/${wsId}/forms/${f.id}/designer`) }
function viewData(f: any) { router.push(`/workspace/${wsId}/forms/${f.id}/data`) }
function goSettings(f: any) { router.push(`/workspace/${wsId}/forms/${f.id}/settings`) }
function goWorkflowDesigner(wfId: string) { router.push(`/workspace/${wsId}/workflows/${wfId}/designer`) }
async function copyForm(f: any) { await http.post(`/workspaces/${wsId}/forms/${f.id}/fork`); fetchList() }
async function publishForm(f: any) {
  await http.post(`/forms/${f.id}/publish`)
  fetchList()
  linkFormId.value = f.id
  showLink.value = true
}
function showPublishLink(f: any) {
  linkFormId.value = f.id
  showLink.value = true
}
async function archiveForm(f: any) { await http.post(`/forms/${f.id}/archive`); fetchList() }
async function deleteForm(f: any) {
  try {
    await ElMessageBox.confirm(`确定删除表单「${f.name}」？删除后无法恢复。`, '删除确认', { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' })
    await http.delete(`/forms/${f.id}`)
    ElMessage.success('已删除')
    fetchList()
  } catch { /* 取消 */ }
}

function statusLabel(s: string) { return s === 'published' ? '已发布' : s === 'archived' ? '已归档' : '草稿' }
function formatDate(d: string) { return d ? new Date(d).toLocaleDateString('zh-CN') : '-' }
</script>

<style scoped>
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.page-header h2 { margin: 0; }
.header-actions { display: flex; gap: 12px; }
.search-input { width: 200px; }

.form-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; }
.form-card { background: #fff; border-radius: 8px; padding: 20px; box-shadow: 0 1px 4px rgba(0,0,0,0.06); display: flex; flex-direction: column; justify-content: space-between; transition: box-shadow 0.2s; }
.form-card:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
.card-title-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
.card-title-row h4 { margin: 0; font-size: 16px; flex: 1; }
.workflow-badge { cursor: pointer; flex-shrink: 0; }
.desc { font-size: 13px; color: #909399; margin: 0 0 12px; }
.meta { display: flex; align-items: center; gap: 12px; }
.time { font-size: 12px; color: #c0c4cc; }
.card-actions { display: flex; gap: 4px; margin-top: 12px; padding-top: 12px; border-top: 1px solid #f0f0f0; }
.pagination { margin-top: 20px; justify-content: center; }

.workflow-popover { display: flex; flex-direction: column; gap: 6px; }
.workflow-item {
  display: flex; align-items: center; justify-content: space-between;
  padding: 6px 0; border-bottom: 1px solid #f0f0f0; cursor: pointer;
}
.workflow-item:last-child { border-bottom: none; }
.workflow-item:hover .wf-name { color: #409eff; }
.wf-name { font-size: 13px; color: #303133; }
</style>
