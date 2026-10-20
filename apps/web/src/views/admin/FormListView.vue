<template>
  <div class="form-list-page">
    <div class="page-header">
      <h2>表单管理</h2>
      <div class="header-actions">
        <el-input
          v-model="search"
          placeholder="搜索表单..."
          clearable
          class="search-input"
          @input="onSearch"
        />
        <el-select
          v-model="statusFilter"
          placeholder="状态"
          clearable
          style="width:120px"
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
        <el-select
          v-model="typeFilter"
          placeholder="类型"
          clearable
          style="width:120px"
        >
          <el-option
            label="全部"
            value=""
          />
          <el-option
            label="普通表单"
            value="normal"
          />
          <el-option
            label="流程表单"
            value="flow"
          />
        </el-select>
        <el-tooltip
          content="回收站"
          placement="top"
        >
          <el-button @click="goRecycle">
            <el-icon><Delete /></el-icon>
          </el-button>
        </el-tooltip>
        <el-button type="primary" @click="createForm">新建表单</el-button>
      </div>
    </div>

    <!-- 分类标签页（样式仿模板市场） -->
    <el-tabs
      v-model="activeCategory"
      @tab-change="onCategoryChange"
    >
      <el-tab-pane
        label="全部"
        name=""
      />
      <el-tab-pane
        v-for="c in FORM_CATEGORIES"
        :key="c"
        :label="c"
        :name="c"
      />
    </el-tabs>

    <!-- 骨架屏：只在「整个页面首次加载」时展示；之后任何刷新都不再换骨架，避免闪一下 -->
    <div
      v-if="loading && !loadedOnce"
      class="form-grid"
    >
      <div
        v-for="n in 6"
        :key="'sk-'+n"
        class="form-card skeleton-card"
      >
        <el-skeleton animated>
          <template #template>
            <div style="padding: 24px">
              <el-skeleton-item variant="text" style="width: 60%; height: 22px" />
              <el-skeleton-item variant="text" style="width: 90%; margin-top: 12px" />
              <el-skeleton-item variant="text" style="width: 40%; margin-top: 8px" />
              <div style="display: flex; justify-content: space-between; margin-top: 20px">
                <el-skeleton-item variant="button" style="width: 60px; height: 28px" />
                <el-skeleton-item variant="button" style="width: 60px; height: 28px" />
              </div>
            </div>
          </template>
        </el-skeleton>
      </div>
    </div>

    <!-- 卡片视图 -->
    <div
      v-else-if="filteredList.length"
      class="form-grid"
    >
      <div
        v-for="f in filteredList"
        :key="f.id"
        class="form-card"
      >
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
                <el-tag
                  size="small"
                  class="workflow-badge"
                  @click.stop
                >
                  流程表单
                </el-tag>
              </template>
              <div class="workflow-popover">
                <div
                  v-for="wf in boundWorkflows[f.id]"
                  :key="wf.id"
                  class="workflow-item"
                  @click="goWorkflowList(wf.name)"
                >
                  <span class="wf-name">{{ wf.name }}</span>
                  <el-tag
                    type="success"
                    size="small"
                  >
                    已发布
                  </el-tag>
                </div>
              </div>
            </el-popover>
          </div>
          <el-tooltip
            v-if="f.description"
            :content="f.description"
            placement="top"
            :show-after="300"
          >
            <p class="desc">{{ f.description }}</p>
          </el-tooltip>
          <p
            v-else
            class="desc"
          >
            暂无描述
          </p>
          <div class="meta">
            <el-tag
              v-if="f.category"
              size="small"
            >
              {{ f.category }}
            </el-tag>
            <el-tag
              :type="f.status==='published'?'success':f.status==='archived'?'warning':'info'"
              size="small"
            >
              {{ statusLabel(f.status) }}
            </el-tag>
            <span class="time">{{ formatDate(f.updatedAt) }}</span>
          </div>
        </div>
        <div class="card-actions">
          <el-button
            size="small"
            @click="openDesigner(f)"
          >
            设计
          </el-button>
          <el-button
            size="small"
            @click="viewData(f)"
          >
            数据
          </el-button>
          <el-button
            size="small"
            @click="goSettings(f)"
          >
            设置
          </el-button>
          <el-dropdown
            trigger="click"
            @visible-change="(v: boolean) => onMoreVisible(f.id, v)"
          >
            <el-button size="small">
              更多
              <el-icon
                class="more-arrow"
                :class="{ 'is-open': openMoreId === f.id }"
              ><ArrowDown /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item @click="copyForm(f)">
                  复制
                </el-dropdown-item>
                <el-dropdown-item
                  v-if="f.status==='draft' || f.status==='archived'"
                  @click="publishForm(f)"
                >
                  发布
                </el-dropdown-item>
                <el-dropdown-item
                  v-if="f.status==='published'"
                  @click="showPublishLink(f)"
                >
                  链接
                </el-dropdown-item>
                <el-dropdown-item
                  v-if="f.status==='published'"
                  @click="archiveForm(f)"
                >
                  归档
                </el-dropdown-item>
                <el-dropdown-item
                  divided
                  @click="deleteForm(f)"
                >
                  删除
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </div>
    </div>
    <el-empty
      v-else
      description="暂无表单"
    />

    <el-pagination
      v-if="total > pageSize"
      v-model:current-page="page"
      :page-size="pageSize"
      :total="total"
      layout="prev, pager, next"
      class="pagination"
    />

    <!-- 新建表单弹窗 -->
    <el-dialog
      v-model="showCreate"
      title="新建表单"
      width="420px"
    >
      <el-form
        :model="createFormData"
        @submit.prevent="doCreate"
      >
        <el-form-item label="表单名称">
          <el-input
            v-model="createFormData.name"
            placeholder="请输入表单名称"
            @keyup.enter="doCreate"
          />
        </el-form-item>
        <el-form-item label="描述">
          <el-input
            v-model="createFormData.description"
            type="textarea"
            :rows="2"
            placeholder="可选"
          />
        </el-form-item>
        <el-form-item label="分类">
          <el-select
            v-model="createFormData.category"
            placeholder="选择表单分类"
            clearable
          >
            <el-option
              v-for="c in FORM_CATEGORIES"
              :key="c"
              :label="c"
              :value="c"
            />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreate = false">
          取消
        </el-button>
        <el-button
          type="primary"
          :loading="creating"
          @click="doCreate"
        >
          创建
        </el-button>
      </template>
    </el-dialog>

    <!-- 发布成功链接弹窗 -->
    <PublishLinkDialog
      v-model:visible="showLink"
      :form-id="linkFormId"
    />

    <!-- 跨工作空间复制 -->
    <el-dialog
      v-model="showCopyDialog"
      title="复制表单到其他工作空间"
      width="460px"
    >
      <el-form label-width="80px">
        <el-form-item label="源空间">
          <el-tag>{{ wsStore.current?.name || '当前空间' }}</el-tag>
        </el-form-item>
        <el-form-item label="目标空间">
          <el-select
            v-model="copyTargetWsId"
            placeholder="选择目标工作空间"
            style="width:100%"
          >
            <el-option
              v-for="ws in otherWorkspaces"
              :key="ws.id"
              :label="ws.name"
              :value="ws.id"
            >
              <span>{{ ws.name }}</span>
              <span style="color:#909399;font-size:12px;margin-left:8px">{{ ws.role === 'owner' ? '创建者' : ws.role === 'editor' ? '编辑者' : '查看者' }}</span>
            </el-option>
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCopyDialog = false">取消</el-button>
        <el-button
          type="primary"
          :disabled="!copyTargetWsId"
          :loading="copying"
          @click="doCopyForm"
        >
          确认复制
        </el-button>
      </template>
    </el-dialog>

  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowDown, Delete } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import http from '@/api/client'
import type { Form, Workspace } from '@/types/models'
import { usePagedList, useConfirmAction } from '@/composables'
import { useWorkspaceStore } from '@/stores/workspace'
import PublishLinkDialog from '@/components/PublishLinkDialog.vue'

// ==================== 6 大表单分类 ====================
const FORM_CATEGORIES = ['人事', '财务', '行政', '销售', '运营', '项目']

// ==================== 页面状态 ====================
const route = useRoute()
const router = useRouter()
const wsId = computed(() => route.params.wsId as string)
const { confirm } = useConfirmAction()

// 分页列表 — usePagedList 接管 loading/list/total/page/fetch
const { list, total, page, pageSize, loading, fetch: _fetch } = usePagedList<Form>(
  (params) => http.get(`/workspaces/${wsId.value}/forms`, { params }),
  12,
)

/** 初值取自 ?keyword=（流程管理的「关联表单」点过来会带上表单名），首次 fetch 就用它过滤 */
const search = ref(typeof route.query.keyword === 'string' ? route.query.keyword : '')
/** 是否完成过至少一次加载 —— 用来把骨架屏限定在首次进入，避免空列表时反复闪骨架 */
const loadedOnce = ref(false)
const statusFilter = ref('')
const activeCategory = ref('')
const showCreate = ref(false)
const creating = ref(false)
const createFormData = reactive({ name: '', description: '', category: '' })
const showLink = ref(false)
const linkFormId = ref('')
/** 表单绑定的流程（`/workspaces/:id/workflow-bindings` 的返回项，只用到这三个字段） */
interface BoundWorkflow {
  id: string
  name: string
  status: string
}
const boundWorkflows = ref<Record<string, BoundWorkflow[]>>({})
/** 表单类型：'' 全部 / 'normal' 普通表单 / 'flow' 流程表单（被已发布流程绑定的表单） */
const typeFilter = ref('')

// 跨工作空间复制
const wsStore = useWorkspaceStore()
/** 当前展开「更多」下拉的表单 id：用于切换箭头方向 */
const openMoreId = ref('')
function onMoreVisible(id: string, visible: boolean) {
  if (visible) openMoreId.value = id
  else if (openMoreId.value === id) openMoreId.value = ''
}

const showCopyDialog = ref(false)
const copyTargetWsId = ref('')
const copyingForm = ref<Form | null>(null)
const copying = ref(false)
const otherWorkspaces = computed(() =>
  (wsStore.list as Workspace[]).filter((w) => w.id !== wsId.value),
)

const filteredList = computed(() => {
  if (!typeFilter.value) return list.value
  const isFlowForm = (f: Form) => !!boundWorkflows.value[f.id]?.length
  return list.value.filter(f => typeFilter.value === 'flow' ? isFlowForm(f) : !isFlowForm(f))
})

// 将筛选参数传入 fetch
function fetchList() {
  const extra: Record<string, string | number> = {}
  if (statusFilter.value) extra.status = statusFilter.value
  if (activeCategory.value) extra.category = activeCategory.value
  if (search.value) extra.keyword = search.value
  return _fetch(extra).finally(() => { loadedOnce.value = true })
}

async function fetchBindings() {
  try {
    const res = await http.get(`/workspaces/${wsId.value}/workflow-bindings`)
    boundWorkflows.value = ((res.data || res) || {}) as Record<string, BoundWorkflow[]>
  } catch { /* ignore */ }
}

onMounted(() => { fetchList(); fetchBindings(); wsStore.fetchList() })
watch([page, statusFilter], () => fetchList())
watch(() => route.params.wsId, () => { page.value = 1; fetchList(); fetchBindings() })

function onCategoryChange() { page.value = 1; fetchList() }
// 搜索框原来没绑事件、watch 里也没有 search，导致输入不触发请求。
// 这里做 300ms 防抖：输入/删除都等停顿后再发一次请求，避免每敲一键刷一次。
let searchTimer: ReturnType<typeof setTimeout> | undefined
function onSearch() {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => { page.value = 1; fetchList() }, 300)
}
onBeforeUnmount(() => clearTimeout(searchTimer))

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
  } catch (e: unknown) {
    const err = e as { response?: { data?: { message?: string } }; message?: string }
    const msg = err.response?.data?.message || err.message || '创建失败'
    ElMessage.error('创建失败: ' + msg)
  } finally {
    creating.value = false
  }
}

function openDesigner(f: Form) { router.push(`/workspace/${wsId.value}/forms/${f.id}/designer`) }
function viewData(f: Form) { router.push(`/workspace/${wsId.value}/forms/${f.id}/data`) }
function goSettings(f: Form) { router.push(`/workspace/${wsId.value}/forms/${f.id}/settings`) }
/** 跳去流程管理并按流程名搜索（与流程管理「关联表单」跳过来互为反向） */
function goWorkflowList(name: string) {
  router.push({ name: 'ProcessList', params: { wsId: wsId.value }, query: { keyword: name } })
}
function copyForm(f: Form) {
  copyingForm.value = f
  copyTargetWsId.value = ''
  showCopyDialog.value = true
}

async function doCopyForm() {
  if (!copyingForm.value || !copyTargetWsId.value) return
  copying.value = true
  try {
    await http.post(`/workspaces/${copyTargetWsId.value}/forms/${copyingForm.value.id}/fork`)
    showCopyDialog.value = false
    ElMessage.success('已复制到目标空间')
  } catch (e: unknown) {
    ElMessage.error((e as { response?: { data?: { message?: string } } }).response?.data?.message || '复制失败')
  } finally {
    copying.value = false
  }
}
async function publishForm(f: Form) {
  await http.post(`/forms/${f.id}/publish`)
  fetchList()
  linkFormId.value = f.id
  showLink.value = true
}
function showPublishLink(f: Form) {
  linkFormId.value = f.id
  showLink.value = true
}
async function archiveForm(f: Form) { await http.post(`/forms/${f.id}/archive`); fetchList() }
function deleteForm(f: Form) {
  confirm(
    () => http.delete(`/forms/${f.id}`),
    {
      title: '删除确认',
      message: `确定删除表单「${f.name}」？将移入回收站，可由回收站恢复。`,
      confirmText: '删除',
      successMsg: '已移入回收站',
      type: 'warning',
    },
    () => fetchList(),
  )
}

function goRecycle() { router.push(`/workspace/${wsId.value}/forms/recycle`) }

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
.skeleton-card { pointer-events: none; box-shadow: 0 1px 4px rgba(0,0,0,0.04); }
/* 正文撑满剩余高度：底部分类/状态行始终贴底，描述字数多少都不改变其位置 */
.card-body { flex: 1; display: flex; flex-direction: column; }
.card-title-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
.card-title-row h4 { margin: 0; font-size: 16px; flex: 1; }
/* 流程表单徽章用紫色：Element Plus 没有紫色预设，而内置的 warning 已被「已归档」占用。
   选择器带 .el-tag 是为压过 .el-tag.el-tag--* 那几个同优先级的变量赋值 */
.workflow-badge.el-tag {
  --el-tag-bg-color: #f9f0ff;
  --el-tag-border-color: #d3adf7;
  --el-tag-text-color: #722ed1;
}
.workflow-badge { cursor: pointer; flex-shrink: 0; }
/* 描述最多两行，超出省略；完整内容通过悬停 tooltip 查看 */
.desc {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  min-height: 39px;
  overflow: hidden;
  font-size: 13px;
  line-height: 1.5;
  color: #909399;
  margin: 0 0 12px;
  word-break: break-word;
}
/* 分类、状态、时间固定在卡片底部，与模板卡片保持一致 */
.meta { display: flex; align-items: center; gap: 12px; margin-top: auto; }
.time { font-size: 12px; color: #c0c4cc; }
.card-actions { display: flex; gap: 8px; margin-top: 12px; padding-top: 12px; border-top: 1px solid #f0f0f0; }
/* Element Plus 给相邻的 .el-button 额外加 12px margin-left，而「更多」外面套着 el-dropdown、
   不在兄弟选择器里 —— 结果前三个间距 16px、和「更多」之间只有 gap 的 4px。归零，统一交给 gap 管 */
.card-actions .el-button + .el-button { margin-left: 0; }
/* 「更多」下拉展开时箭头翻转 */
.more-arrow { margin-left: 2px; transition: transform 0.2s; }
.more-arrow.is-open { transform: rotate(180deg); }
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
