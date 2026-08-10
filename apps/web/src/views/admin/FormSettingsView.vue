<template>
  <div class="settings-page">
    <div class="page-header">
      <el-button
        text
        @click="$router.back()"
      >
        <el-icon><ArrowLeft /></el-icon> 返回
      </el-button>
      <h2>{{ formName }}</h2>
    </div>

    <el-card class="section-card">
      <template #header>
        <span class="section-title">基本信息</span>
      </template>
      <el-form
        label-width="100px"
        :model="form"
        @submit.prevent
      >
        <el-form-item label="表单名称">
          <el-input
            v-model="form.name"
            placeholder="请输入表单名称"
          />
        </el-form-item>
        <el-form-item label="描述">
          <el-input
            v-model="form.description"
            type="textarea"
            :rows="3"
            placeholder="可选描述"
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
      </el-form>
    </el-card>

    <el-card class="section-card">
      <template #header>
        <span class="section-title">提交设置</span>
      </template>
      <el-form
        label-width="120px"
        :model="form"
      >
        <el-form-item label="提交上限">
          <el-input-number
            v-model="form.maxSubmissions"
            :min="0"
          />
          <span class="hint">0 表示不限制</span>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 版本历史 -->
    <el-card class="section-card">
      <template #header>
        <div class="card-header-row">
          <span class="section-title">版本历史</span>
          <div class="header-actions">
            <el-button
              size="small"
              @click="exportJson"
            >
              导出 JSON
            </el-button>
            <el-button
              size="small"
              @click="triggerImport"
            >
              导入 JSON
            </el-button>
            <input
              ref="fileInput"
              type="file"
              accept=".json"
              style="display:none"
              @change="onFileSelected"
            >
          </div>
        </div>
      </template>

      <el-table
        v-if="versions.length"
        :data="versions"
        stripe
        size="small"
      >
        <el-table-column
          label="版本号"
          min-width="60"
          align="center"
        >
          <template #default="{ row }">
            <el-tag
              size="small"
              :type="row.version === publishedVersion ? 'success' : ''"
            >
              v{{ row.version }}
            </el-tag>
            <el-tag
              v-if="row.version === latestVersion"
              size="small"
              type="primary"
              effect="dark"
              style="margin-left:4px"
            >
              当前编辑
            </el-tag>
            <el-tag
              v-if="row.version === publishedVersion"
              size="small"
              type="success"
              effect="dark"
              style="margin-left:4px"
            >
              已发布
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column
          label="更新时间"
          min-width="120"
          align="center"
        >
          <template #default="{ row }">
            {{ formatTime(row.createdAt) }}
          </template>
        </el-table-column>
        <el-table-column
          label="操作"
          min-width="80"
          align="center"
        >
          <template #default="{ row }">
            <el-button
              size="small"
              @click="previewVersion(row)"
            >
              预览
            </el-button>
            <el-button
              size="small"
              type="warning"
              :disabled="row.version === latestVersion"
              @click="restoreVersion(row)"
            >
              恢复
            </el-button>
            <el-button
              size="small"
              type="danger"
              :disabled="row.version === publishedVersion || versions.length <= 1"
              @click="deleteVersion(row)"
            >
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty
        v-else
        description="暂无版本记录，保存表单 Schema 后自动生成"
        :image-size="60"
      />
    </el-card>

    <!-- 版本预览弹窗 -->
    <el-dialog
      v-model="showPreview"
      title="版本预览"
      width="960px"
    >
      <div class="preview-toolbar">
        <el-radio-group
          v-model="previewMode"
          size="small"
        >
          <el-radio-button value="design">
            设计
          </el-radio-button>
          <el-radio-button value="json">
            JSON
          </el-radio-button>
        </el-radio-group>
      </div>

      <!-- 设计预览 -->
      <div
        v-if="previewMode === 'design'"
        class="form-preview-box"
      >
        <PreviewPanel :schema="previewSchema" hide-actions hide-title />
      </div>

      <!-- JSON 预览 -->
      <pre
        v-else
        class="schema-preview"
      >{{ previewJson }}</pre>

      <template #footer>
        <el-button @click="showPreview = false">关闭</el-button>
        <el-button
          type="primary"
          @click="doRestore"
        >
          恢复到此版本
        </el-button>
      </template>
    </el-dialog>

    <!-- 导入确认 -->
    <el-dialog
      v-model="showImportConfirm"
      title="导入 JSON 文件"
      width="500px"
    >
      <p>新导入的 JSON 文件将覆盖当前表单的 Schema 结构</p>
      <p class="warning-text">此操作会生成一个新版本快照，当前 Schema 仍可在历史版本中找回</p>
      <template #footer>
        <el-button @click="showImportConfirm = false">取消</el-button>
        <el-button
          type="primary"
          @click="doImport"
        >
          确认导入
        </el-button>
      </template>
    </el-dialog>

    <div class="save-bar">
      <el-button
        type="primary"
        :loading="saving"
        @click="save"
      >
        保存设置
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft } from '@element-plus/icons-vue'
import http from '@/api/client'
import PreviewPanel from '@/components/PreviewPanel.vue'
import type { FormSchema } from '@furmx/sdk'

interface FormVersion {
  id: string
  formId: string
  version: number
  schema: Record<string, unknown>
  createdAt: string
}

const CATEGORIES = ['人事', '财务', '行政', '销售', '运营', '项目']

const route = useRoute()
const formId = route.params.formId as string
const formName = ref('')
const saving = ref(false)
const publishedVersion = ref(0)
const latestVersion = ref(0)

const form = reactive({
  name: '',
  description: '',
  category: '',
  maxSubmissions: 0,
})

// ---- 版本管理 ----
const versions = ref<FormVersion[]>([])
const showPreview = ref(false)
const previewMode = ref<'design' | 'json'>('design')
const previewJson = ref('')
const pendingRestore = ref<FormVersion | null>(null)
const previewSchema = computed<FormSchema>(() => {
  if (!pendingRestore.value) return { version: '2.0', id: '', settings: {} as FormSchema['settings'], fields: [] }
  const s = pendingRestore.value.schema || {}
  return {
    version: s.version || '2.0',
    id: s.id || '',
    settings: (s.settings || {}) as FormSchema['settings'],
    fields: (s.fields || []) as FormSchema['fields'],
  }
})

// ---- 导入/导出 ----
const fileInput = ref<HTMLInputElement>()
const showImportConfirm = ref(false)
const pendingImport = ref<Record<string, unknown> | null>(null)

onMounted(async () => {
  try {
    const res = await http.get(`/forms/${formId}`)
    const body = res as unknown as { data: Record<string, unknown> }
    const data = body.data || (res as unknown as Record<string, unknown>)
    formName.value = (data.name as string) || ''
    publishedVersion.value = (data.publishedVersion as number) || 0
    Object.assign(form, {
      name: data.name || '',
      description: data.description || '',
      category: data.category || '',
      maxSubmissions: data.maxSubmissions || 0,
    })
  } catch { /* */ }
  fetchVersions()
})

async function fetchVersions() {
  try {
    const res = await http.get(`/forms/${formId}/versions`)
    versions.value = ((res as unknown as { data: FormVersion[] }).data || res || []) as FormVersion[]
    // 最新版本 = 列表第一位（已按 version desc 排序）
    latestVersion.value = versions.value[0]?.version || 0
  } catch { /* */ }
}

async function save() {
  saving.value = true
  try {
    await http.patch(`/forms/${formId}`, {
      name: form.name,
      description: form.description,
      category: form.category || undefined,
      maxSubmissions: form.maxSubmissions,
    })
    formName.value = form.name
    ElMessage.success('保存成功')
  } catch {
    ElMessage.error('保存失败')
  } finally {
    saving.value = false
  }
}

// ---- 版本操作 ----

function previewVersion(row: FormVersion) {
  pendingRestore.value = row
  previewJson.value = JSON.stringify(row.schema, null, 2)
  showPreview.value = true
}

function restoreVersion(row: FormVersion) {
  ElMessageBox.confirm(
    `确认将当前 Schema 恢复为 v${row.version} 版本的快照`,
    '恢复版本',
    { confirmButtonText: '确定恢复', cancelButtonText: '取消', type: 'warning' },
  ).then(() => {
    doRestoreInternal(row)
  }).catch(() => { /* 取消 */ })
}

function doRestore() {
  if (pendingRestore.value) {
    doRestoreInternal(pendingRestore.value)
    showPreview.value = false
  }
}

async function doRestoreInternal(row: FormVersion) {
  try {
    await http.patch(`/forms/${formId}`, { schema: row.schema })
    ElMessage.success(`已恢复到 v${row.version}`)
    fetchVersions()
  } catch {
    ElMessage.error('恢复失败')
  }
}

function deleteVersion(row: FormVersion) {
  ElMessageBox.confirm(
    `确定删除 v${row.version} 版本快照？此操作不可恢复。`,
    '删除版本',
    { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' },
  ).then(async () => {
    try {
      await http.delete(`/forms/${formId}/versions/${row.version}`)
      ElMessage.success(`v${row.version} 已删除`)
      fetchVersions()
    } catch (e: unknown) {
      ElMessage.error((e as { response?: { data?: { message?: string } } }).response?.data?.message || '删除失败')
    }
  }).catch(() => { /* 取消 */ })
}

// ---- 导入/导出 ----

function exportJson() {
  // 导出当前 Schema
  http.get(`/forms/${formId}`).then((res) => {
    const form = ((res as unknown as { data: Record<string, unknown> }).data || res) as Record<string, unknown>
    const schema = form.schema || {}
    const blob = new Blob([JSON.stringify(schema, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${formName.value || 'form'}_schema.json`
    a.click()
    URL.revokeObjectURL(url)
    ElMessage.success('导出成功')
  }).catch(() => ElMessage.error('导出失败'))
}

function triggerImport() {
  fileInput.value?.click()
}

function onFileSelected(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result as string)
      if (!parsed.fields && !parsed.settings) {
        ElMessage.error('无效的 Schema 文件：缺少 fields 或 settings')
        return
      }
      pendingImport.value = parsed
      showImportConfirm.value = true
    } catch {
      ElMessage.error('JSON 解析失败，请检查文件格式')
    }
  }
  reader.readAsText(file)
  // 重置 input，允许重复选择同一文件
  if (fileInput.value) fileInput.value.value = ''
}

async function doImport() {
  if (!pendingImport.value) return
  try {
    await http.patch(`/forms/${formId}`, { schema: pendingImport.value })
    showImportConfirm.value = false
    pendingImport.value = null
    ElMessage.success('Schema 已导入，新版本快照已保存')
    fetchVersions()
  } catch {
    ElMessage.error('导入失败')
  }
}

function formatTime(d: string) {
  return d ? new Date(d).toLocaleString('zh-CN') : '-'
}
</script>

<style scoped>
.page-header { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
.page-header h2 { margin: 0; }
.section-card { margin-bottom: 16px; }
.section-title { font-weight: 600; font-size: 15px; }
.hint { color: #909399; font-size: 12px; margin-left: 8px; }
.save-bar { margin-top: 8px; }
.card-header-row { display: flex; align-items: center; justify-content: space-between; }
.header-actions { display: flex; gap: 8px; }
.preview-toolbar { margin-bottom: 16px; }
.form-preview-box { max-height: 420px; overflow-y: auto; border: 1px solid #e4e7ed; border-radius: 6px; padding: 16px; background: #fafbfc; }
.schema-preview {
  max-height: 450px;
  overflow: auto;
  background: #f5f7fa;
  padding: 16px;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
}
.warning-text { color: #e6a23c; font-size: 13px; }
</style>
