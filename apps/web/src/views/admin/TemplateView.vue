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
          @change="fetchList"
        />
        <el-button
          type="primary"
          @click="openCreate"
        >
          创建模板
        </el-button>
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
      class="card-grid"
    >
      <el-card
        v-for="tpl in templates"
        :key="tpl.id"
        class="tpl-card"
        shadow="hover"
      >
        <template #header>
          <div class="card-title">
            <span>{{ tpl.name }}</span>
            <el-tag
              v-if="tpl.category"
              size="small"
            >
              {{ tpl.category }}
            </el-tag>
          </div>
        </template>
        <p class="tpl-desc">
          {{ tpl.description || '暂无描述' }}
        </p>
        <div
          v-if="tpl.tags?.length"
          class="tpl-tags"
        >
          <el-tag
            v-for="tag in tpl.tags"
            :key="tag"
            size="small"
            effect="plain"
          >
            {{ tag }}
          </el-tag>
        </div>
        <div class="tpl-meta">
          <span>已使用 {{ tpl.usageCount }} 次</span>
        </div>
        <div class="tpl-actions">
          <el-button
            size="small"
            @click="previewTemplate(tpl)"
          >
            预览
          </el-button>
          <el-button
            size="small"
            type="warning"
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
      </el-card>
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
      title="模板预览"
      width="750px"
    >
      <template v-if="previewTpl">
        <el-descriptions
          :column="2"
          border
          size="small"
        >
          <el-descriptions-item label="名称">
            {{ previewTpl.name }}
          </el-descriptions-item>
          <el-descriptions-item label="分类">
            {{ previewTpl.category || '-' }}
          </el-descriptions-item>
          <el-descriptions-item label="使用次数">
            {{ previewTpl.usageCount }}
          </el-descriptions-item>
          <el-descriptions-item label="标签">
            {{ (previewTpl.tags || []).join(', ') || '-' }}
          </el-descriptions-item>
        </el-descriptions>
        <h4 style="margin:16px 0 8px">
          表单预览
        </h4>
        <div class="form-preview-box">
          <FormPreview :schema="previewTpl.schema" />
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
          <el-select
            v-model="form.tags"
            multiple
            allow-create
            filterable
            placeholder="输入后回车添加标签"
          />
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
              <span style="color:#999;float:right;font-size:12px">{{ f.publishedVersion ? 'v' + f.publishedVersion : '' }}</span>
            </el-option>
          </el-select>
        </el-form-item>
        <!-- 表单预览 + 修改视图入口 -->
        <el-form-item
          v-if="selectedFormName && previewSchema?.fields?.length"
          label="表单预览"
        >
          <div class="form-preview-box">
            <FormPreview :schema="previewSchema" />
          </div>
          <div
            v-if="editingId"
            style="margin-top:10px;text-align:right"
          >
            <el-button
              type="primary"
              size="small"
              @click="editTemplateInDesigner()"
            >
              在设计中修改视图
            </el-button>
          </div>
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
import { ref, reactive, onMounted, watch, computed, h } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import http from '@/api/client'
import FormField from '@/views/renderer/components/FormField.vue'

// ---- 表单预览组件（使用真实 FormField，与 PublicFormView 一致） ----
const FormPreview = {
  name: 'FormPreview',
  props: { schema: { type: Object, default: () => ({ fields: [], settings: {} }) } },
  setup(props: { schema: any }) {
    const canvasCols = computed(() => (props.schema as any)?.settings?.canvasCols || 24)
    const gridStyle = computed(() => ({
      display: 'grid',
      gridTemplateColumns: `repeat(${canvasCols.value}, 1fr)`,
      gap: '12px',
    }))
    return () => {
      const s = props.schema as any
      if (!s?.fields?.length) return h('el-empty', { description: '无表单字段' })
      return h('div', { style: gridStyle.value },
        s.fields.map((f: any) =>
          h(FormField, { field: f, schemaSettings: s.settings || {}, maxCols: canvasCols.value, modelValue: '', key: f.id })
        )
      )
    }
  },
}

const CATEGORIES = ['人事', '财务', '行政', '销售', '运营', '项目']

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
  form.category = tpl.category || ''; form.tags = tpl.tags || []
  selectedFormId.value = ''; selectedFormName.value = tpl.name
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
  } catch { ElMessage.error('保存失败') }
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
    const res = await http.post(`/templates/${tpl.id}/use`, { workspaceId: wsId }) as any
    const form = res?.data || res
    ElMessage.success('模板已安装，正在跳转...')
    router.push(`/workspace/${wsId.value}/forms/${form.id}/designer`)
  } catch { /* cancel */ }
}

onMounted(() => { fetchList() })
watch(page, fetchList)
</script>

<style scoped>
.header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.header h2 { margin: 0; }
.header-right { display: flex; gap: 8px; align-items: center; }
.card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; margin-top: 16px; }
.tpl-card { cursor: default; }
.tpl-card .card-title { display: flex; justify-content: space-between; align-items: center; }
.tpl-desc { color: #666; min-height: 36px; margin: 0 0 8px; }
.tpl-tags { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 8px; }
.tpl-meta { font-size: 12px; color: #999; margin-bottom: 8px; }
.tpl-actions { display: flex; gap: 8px; justify-content: flex-end; }
.pagination { margin-top: 16px; justify-content: center; }
.form-preview-box { max-height: 420px; overflow-y: auto; border: 1px solid #e4e7ed; border-radius: 6px; padding: 16px; background: #fafbfc; }
h4 { margin: 0; }
</style>
