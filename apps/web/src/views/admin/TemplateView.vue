<template>
  <div>
    <div class="header">
      <h2>模板市场</h2>
      <div class="header-right">
        <el-input
          v-model="keyword"
          placeholder="搜索模板..."
          style="width:260px"
          clearable
          @input="onSearch"
        />
        <el-button type="primary" @click="openCreate">创建模板</el-button>
      </div>
    </div>

    <el-tabs
      v-model="activeCategory"
      @tab-change="onCategoryChange"
    >
      <el-tab-pane
        label="全部"
        name=""
      />
      <el-tab-pane
        v-for="c in CATEGORIES"
        :key="c"
        :label="c"
        :name="c"
      />
    </el-tabs>

    <div
      v-loading="loading"
      class="tpl-grid"
    >
      <div
        v-for="tpl in templates"
        :key="tpl.id"
        class="tpl-card"
      >
        <div class="card-body">
          <div class="card-title-row">
            <h4>{{ tpl.name }}</h4>
            <el-tag
              size="small"
              effect="plain"
              class="template-badge"
            >
              模板
            </el-tag>
          </div>
          <p class="desc">
            {{ tpl.description || '暂无描述' }}
          </p>
          <!-- 标签行固定占位：有无标签的卡片高度保持一致；分类在前，标签最多展示 3 个 -->
          <div class="tpl-tags">
            <el-tag
              v-if="tpl.category"
              size="small"
            >
              {{ tpl.category }}
            </el-tag>
            <el-tag
              v-for="tag in (tpl.tags || []).slice(0, 3)"
              :key="tag"
              size="small"
              effect="plain"
            >
              {{ tag }}
            </el-tag>
          </div>
          <div class="meta">
            <span class="meta-item">
              已使用 {{ tpl.usageCount }} 次
            </span>
            <span class="time">{{ formatDate(tpl.createdAt) }}</span>
          </div>
        </div>

        <div class="card-actions">
          <el-button
            size="small"
            @click="previewTemplate(tpl)"
          >
            预览
          </el-button>
          <el-button
            size="small"
            @click="openEdit(tpl)"
          >
            修改
          </el-button>
          <el-button
            size="small"
            type="primary"
            @click="useTemplate(tpl)"
          >
            使用
          </el-button>
        </div>
      </div>
    </div>

    <el-empty
      v-if="!loading && templates.length === 0"
      description="暂无模板，点击「创建模板」添加"
    />
    <el-pagination
      v-if="total > pageSize"
      v-model:current-page="page"
      :page-size="pageSize"
      :total="total"
      layout="prev, pager, next"
      class="pagination"
    />

    <!-- ========== 预览弹窗 ========== -->
    <el-dialog
      v-model="previewVisible"
      :title="previewTpl ? `模板预览：${previewTpl.name}` : '模板预览'"
      width="960px"
    >
      <template v-if="previewTpl">
        <div class="form-preview-box">
          <PreviewPanel :schema="previewTpl.schema" hide-actions hide-title />
        </div>
      </template>
    </el-dialog>

    <!-- ========== 创建/编辑模板弹窗 ========== -->
    <el-dialog
      v-model="createVisible"
      :title="editingId ? '修改模板' : '创建模板'"
      width="650px"
    >
      <el-form
        :model="form"
        label-width="80px"
      >
        <el-form-item
          label="名称"
          required
        >
          <el-input
            v-model="form.name"
            placeholder="如：请假申请"
          />
        </el-form-item>
        <el-form-item label="描述">
          <el-input
            v-model="form.description"
            type="textarea"
            :rows="2"
            placeholder="简要描述模板用途"
          />
        </el-form-item>
        <el-form-item label="分类">
          <el-select
            v-model="form.category"
            placeholder="选择分类"
            clearable
          >
            <el-option
              v-for="c in CATEGORIES"
              :key="c"
              :label="c"
              :value="c"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="标签">
          <div class="tag-field">
            <el-select
              v-model="form.tags"
              multiple
              allow-create
              filterable
              :multiple-limit="3"
              placeholder="输入后回车添加标签"
            />
            <span class="tag-count">{{ form.tags.length }}/3</span>
          </div>
        </el-form-item>
        <el-form-item
          v-if="!editingId"
          label="来源表单"
          required
        >
          <el-select
            v-model="selectedFormId"
            filterable
            placeholder="选择一个已发布的表单"
            @change="onFormSelected"
          >
            <el-option
              v-for="f in publishedForms"
              :key="f.id"
              :label="f.name"
              :value="f.id"
            >
              <span>{{ f.name }}</span>
            </el-option>
          </el-select>
        </el-form-item>
        <!-- 新建时预览所选的来源表单；修改模板时不预览（内容已定型，要改直接进设计器） -->
        <el-form-item
          v-if="!editingId && selectedFormName && previewSchema?.fields?.length"
          label="表单预览"
        >
          <div class="form-preview-box">
            <PreviewPanel :schema="previewSchema" hide-actions hide-title />
          </div>
        </el-form-item>
        <el-form-item
          v-if="editingId"
          label="表单视图"
        >
          <el-button
            type="primary"
            size="small"
            @click="editTemplateInDesigner()"
          >
            在设计中修改视图
          </el-button>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">
          取消
        </el-button>
        <el-button
          type="primary"
          :loading="saving"
          @click="doSave"
        >
          保存
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onBeforeUnmount, watch, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import http from '@/api/client'
import PreviewPanel from '@/components/PreviewPanel.vue'
const CATEGORIES = ['人事', '财务', '行政', '销售', '运营', '项目']

function formatDate(d?: string): string {
  return d ? new Date(d).toLocaleDateString('zh-CN') : '-'
}

const route = useRoute()
const router = useRouter()
const wsId = computed(() => route.params.wsId as string)

const templates = ref<any[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = 12
const loading = ref(false)
const keyword = ref('')
const activeCategory = ref('')

const previewVisible = ref(false)
const previewTpl = ref<any>(null)

const createVisible = ref(false)
const editingId = ref<string | null>(null)
const saving = ref(false)
const form = reactive({ name: '', description: '', category: '', tags: [] as string[] })

const publishedForms = ref<any[]>([])
const selectedFormId = ref('')
const selectedFormName = ref('')
const previewSchema = ref<any>(null)

async function fetchPublishedForms() {
  try {
    const res = await http.get(`/workspaces/${wsId.value}/forms`, {
      params: { status: 'published', pageSize: 1000 },
    }) as any
    const data = res?.data || res
    publishedForms.value = (data?.list || []).filter((f: any) => f.status === 'published')
  } catch { publishedForms.value = [] }
}

async function onFormSelected(formId: string) {
  const f = publishedForms.value.find((x: any) => x.id === formId)
  if (f) {
    selectedFormName.value = f.name
    previewSchema.value = f.schema
    if (!form.name) form.name = f.name
  }
}

async function fetchList() {
  loading.value = true
  try {
    const params: any = { page: page.value, pageSize }
    if (activeCategory.value) params.category = activeCategory.value
    if (keyword.value) params.keyword = keyword.value
    const res = await http.get('/templates', { params }) as any
    const data = res?.data || res
    templates.value = data?.list || []
    total.value = data?.pagination?.total || 0
  } finally { loading.value = false }
}

function onCategoryChange() { page.value = 1; fetchList() }

// 搜索做 300ms 防抖，与表单管理一致：输入/删除都等停顿后再发请求，不走回车
let searchTimer: ReturnType<typeof setTimeout> | undefined
function onSearch() {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => { page.value = 1; fetchList() }, 300)
}
onBeforeUnmount(() => clearTimeout(searchTimer))

function previewTemplate(tpl: any) {
  previewTpl.value = tpl
  previewVisible.value = true
}

function openCreate() {
  editingId.value = null
  form.name = ''; form.description = ''; form.category = ''; form.tags = []
  selectedFormId.value = ''; selectedFormName.value = ''; previewSchema.value = null
  fetchPublishedForms()
  createVisible.value = true
}

function openEdit(tpl: any) {
  editingId.value = tpl.id
  form.name = tpl.name; form.description = tpl.description || ''
  form.category = tpl.category || ''; form.tags = (tpl.tags || []).slice(0, 3)
  selectedFormId.value = ''
  previewSchema.value = tpl.schema
  createVisible.value = true
}

async function doSave() {
  if (!form.name.trim()) { ElMessage.warning('请输入模板名称'); return }
  if (!editingId.value && !selectedFormId.value) { ElMessage.warning('请选择一个已发布的表单'); return }
  saving.value = true
  try {
    const body = {
      name: form.name,
      description: form.description,
      category: form.category || undefined,
      tags: form.tags,
      schema: previewSchema.value || {},
      workspaceId: wsId.value,
    }
    if (editingId.value) {
      await http.patch(`/templates/${editingId.value}`, body)
      ElMessage.success('模板已更新')
    } else {
      await http.post('/templates', body)
      ElMessage.success('模板已创建')
    }
    createVisible.value = false
    fetchList()
  } catch (e: any) { if (e?.__handled) return; ElMessage.error('保存失败') }
  finally { saving.value = false }
}

async function editTemplateInDesigner() {
  const tplId = editingId.value
  if (!tplId) return
  createVisible.value = false
  router.push(`/workspace/${wsId.value}/template-designer?template=${tplId}`)
}

async function useTemplate(tpl: any) {
  try {
    await ElMessageBox.confirm(`确定使用「${tpl.name}」模板？将在当前工作空间创建表单。`, '确认', { type: 'info' })
    const res = await http.post(`/templates/${tpl.id}/use`, { workspaceId: wsId.value }) as any
    const form = res?.data || res
    ElMessage.success('模板已安装，正在跳转...')
    router.push(`/workspace/${wsId.value}/forms/${form.id}/designer`)
  } catch (e: any) {
    if (e === 'cancel' || e === 'close' || e?.__handled) return
    ElMessage.error(e?.response?.data?.message || e?.message || '使用模板失败')
  }
}

onMounted(() => { fetchList() })
watch(page, fetchList)
</script>

<style scoped>
.header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.header h2 { margin: 0; }
.header-right { display: flex; gap: 8px; align-items: center; }
/* 标签输入：右侧常驻计数，输入后也始终可见 */
.tag-field { display: flex; align-items: center; gap: 8px; width: 100%; }
.tag-field .el-select { flex: 1; min-width: 0; }
.tag-count { flex-shrink: 0; font-size: 12px; color: #909399; font-variant-numeric: tabular-nums; }
/* 与表单管理同一套栅格与卡片密度（间距交给 el-tabs 默认的 15px，不再额外加 margin） */
.tpl-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; }
.tpl-card {
  background: #fff;
  border-radius: 8px;
  padding: 20px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
  display: flex;
  flex-direction: column;
  transition: box-shadow 0.2s;
}
.tpl-card:hover { box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1); }

/* ---- 卡片正文：与表单管理的表单卡片同构，只在元信息上体现「模板」 ---- */
/* 撑满剩余高度，保证同一行卡片的操作栏底部对齐 */
.card-body { flex: 1; display: flex; flex-direction: column; }
.card-title-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
.card-title-row .el-tag { flex-shrink: 0; }
/* 「模板」标识：中性灰，弱于分类标签，只做轻提示 */
.template-badge.el-tag {
  --el-tag-bg-color: #f4f4f5;
  --el-tag-border-color: #e9e9eb;
  --el-tag-text-color: #909399;
}
.card-title-row h4 {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #303133;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 描述固定两行高度：每张卡片大小一致，操作栏也在同一水平线 */
.desc {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  min-height: 39px;
  margin: 0 0 8px;
  overflow: hidden;
  font-size: 13px;
  line-height: 1.5;
  color: #909399;
}
/* 保留标签行：固定最小高度，保证有无标签时卡片仍然等宽等高 */
/* margin-top:auto 让分类/标签行连同元信息始终贴在卡片底部，描述字数多少都不影响其位置 */
.tpl-tags { display: flex; align-items: center; gap: 4px; flex-wrap: nowrap; min-height: 24px; margin-top: auto; margin-bottom: 8px; overflow: hidden; }
/* 分类是「归属」，用主色实标签；标签是「补充」，改成中性灰描边，拉开层级 */
.tpl-tags .el-tag:not(.el-tag--plain) { font-weight: 500; }
.tpl-tags .el-tag--plain {
  --el-tag-bg-color: #fff;
  --el-tag-border-color: #e4e7ed;
  --el-tag-text-color: #909399;
}
.meta { display: flex; align-items: center; gap: 12px; font-size: 12px; color: #c0c4cc; }
.meta-item { display: inline-flex; align-items: center; gap: 4px; color: #909399; }
.time { font-size: 12px; color: #c0c4cc; }

.card-actions { display: flex; gap: 8px; margin-top: 12px; padding-top: 12px; border-top: 1px solid #f0f0f0; }
/* 同表单管理：EP 给相邻 .el-button 加的 12px margin-left 会叠在 gap 上（实渲染 20px），归零交给 gap */
.card-actions .el-button + .el-button { margin-left: 0; }
.pagination { margin-top: 20px; justify-content: center; }
.form-preview-box { max-height: 420px; overflow-y: auto; border: 1px solid #e4e7ed; border-radius: 6px; padding: 16px; background: #fafbfc; }
</style>
