<template>
  <!-- 初始加载骨架屏 -->
  <div
    v-if="initLoading"
    class="designer-layout design-skeleton"
  >
    <header class="designer-header" style="padding: 12px 24px">
      <el-skeleton animated style="width: 100%">
        <template #template>
          <div style="display:flex;align-items:center;gap:16px">
            <el-skeleton-item variant="button" style="width:80px;height:32px" />
            <el-skeleton-item variant="text" style="width:200px;height:32px" />
            <div style="flex:1" />
            <el-skeleton-item variant="button" style="width:60px;height:32px" />
            <el-skeleton-item variant="button" style="width:60px;height:32px" />
          </div>
        </template>
      </el-skeleton>
    </header>
    <div style="display:flex;flex:1">
      <div style="width:260px;padding:16px;border-right:1px solid #e5e7eb">
        <el-skeleton :rows="8" animated />
      </div>
      <div style="flex:1;padding:24px;display:flex;align-items:center;justify-content:center;background:#f5f6f8">
        <el-skeleton style="width:70%;max-width:800px" animated>
          <template #template>
            <el-skeleton-item variant="text" style="width:40%;height:28px;margin:0 auto 24px" />
            <el-skeleton-item variant="rect" style="width:100%;height:200px;margin-bottom:16px" />
            <el-skeleton-item variant="rect" style="width:60%;height:40px;margin-bottom:12px" />
            <el-skeleton-item variant="rect" style="width:80%;height:40px" />
          </template>
        </el-skeleton>
      </div>
      <div style="width:320px;padding:16px;border-left:1px solid #e5e7eb">
        <el-skeleton :rows="6" animated />
      </div>
    </div>
  </div>

  <div
    v-else
    class="designer-layout"
    @mousemove="onResizeMove"
    @mouseup="onResizeUp"
    @mouseleave="onResizeUp"
  >
    <!-- ========== 顶部工具栏 ========== -->
    <header class="designer-header">
      <div class="header-left">
        <el-button
          text
          @click="goBack"
        >
          <el-icon><ArrowLeft /></el-icon> 返回
        </el-button>
      </div>
      <div class="header-center">
        <el-button-group class="header-btn-group">
          <el-button
            :type="viewMode === 'design' ? 'primary' : 'default'"
            @click="viewMode = 'design'"
          >
            设计
          </el-button>
          <el-button
            :type="viewMode === 'json' ? 'primary' : 'default'"
            @click="viewMode = 'json'"
          >
            JSON
          </el-button>
        </el-button-group>
        <el-button-group style="margin-left:12px">
          <el-button
            :disabled="!store.canUndo"
            @click="undo"
          >
            <el-icon><RefreshLeft /></el-icon>
          </el-button>
          <el-button
            :disabled="!store.canRedo"
            @click="redo"
          >
            <el-icon><RefreshRight /></el-icon>
          </el-button>
        </el-button-group>
      </div>
      <div class="header-right">
        <el-button @click="openPreview">
          预览
        </el-button>
        <template v-if="isTemplateMode">
          <el-button
            type="primary"
            :loading="savingToTemplate"
            @click="handleSaveToTemplate"
          >
            保存修改
          </el-button>
        </template>
        <template v-else>
          <el-dropdown
            trigger="click"
            @command="handleSaveCommand"
          >
            <el-button
              type="primary"
              :loading="saving"
            >
              保存 <el-icon class="el-icon--right"><ArrowDown /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="new">
                  <span style="font-weight:600">保存为新版本</span>
                  <span style="color:#909399;font-size:11px;margin-left:4px">v{{ nextVersionNumber }}</span>
                </el-dropdown-item>
                <el-dropdown-item
                  v-if="latestFormVersion > 0"
                  command="overwrite"
                >
                  <span>覆盖当前版本</span>
                  <span style="color:#909399;font-size:11px;margin-left:4px">v{{ latestFormVersion }}</span>
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </template>
      </div>
    </header>

    <!-- ========== 三列主体 ========== -->
    <div class="designer-body">
      <!-- 第一列：组件面板 -->
      <aside
        class="panel-left"
        :style="{ width: leftWidth + 'px' }"
      >
        <ComponentPalette />
      </aside>

      <!-- 拖拽分隔线 1→2 -->
      <div
        class="resize-divider"
        :class="{ active: resizing === 'left' }"
        @mousedown.prevent="onResizeStart('left', $event)"
      >
        <div class="divider-grip" />
      </div>

      <!-- 第二列：画布 -->
      <main class="canvas-area">
        <ErrorBoundary title="画布渲染异常" message="设计器画布发生异常，属性面板和工具栏仍可操作">
          <DesignCanvas v-if="viewMode === 'design'" />
          <JsonPreview v-else />
        </ErrorBoundary>
      </main>

      <!-- 拖拽分隔线 2→3 -->
      <div
        class="resize-divider"
        :class="{ active: resizing === 'right' }"
        @mousedown.prevent="onResizeStart('right', $event)"
      >
        <div class="divider-grip" />
      </div>

      <!-- 第三列：属性面板 -->
      <aside
        class="panel-right"
        :style="{ width: rightWidth + 'px' }"
      >
        <ErrorBoundary title="属性面板异常" message="属性面板渲染失败，画布操作不受影响">
          <PropertyPanel />
        </ErrorBoundary>
      </aside>
    </div>

    <!-- ========== 预览浮层 ========== -->
    <div
      v-if="showPreview"
      class="preview-overlay"
    >
      <div class="preview-overlay-header">
        <span>表单预览</span>
        <el-button
          text
          @click="showPreview = false"
        >
          <el-icon><Close /></el-icon> 关闭预览
        </el-button>
      </div>
      <div class="preview-overlay-body">
        <div class="form-preview-box">
          <PreviewPanel
            :schema="store.getSchema()"
            @save="handleSaveFromPreview"
          />
        </div>
      </div>
    </div>

    <!-- ========== 发布弹窗 ========== -->
    <el-dialog
      v-model="showPublishPrompt"
      title="保存成功"
      width="400px"
    >
      <p style="text-align:center;font-size:15px">
        是否立即发布表单？
      </p>
      <p style="text-align:center;font-size:13px;color:#909399">
        发布后生成公开填写链接，登录后即可填写
      </p>
      <template #footer>
        <el-button @click="handlePublishLater">
          稍后
        </el-button>
        <el-button
          type="primary"
          @click="handlePublishNow"
        >
          发布
        </el-button>
      </template>
    </el-dialog>

    <PublishLinkDialog
      v-model:visible="showLinkDialog"
      :form-id="currentFormId"
    />

  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRoute, onBeforeRouteUpdate } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useDesignerStore } from './stores/designer'
import { useFormDirty } from '@/composables'
import http from '@/api/client'
import ComponentPalette from './components/ComponentPalette.vue'
import DesignCanvas from './components/DesignCanvas.vue'
import PropertyPanel from './components/PropertyPanel.vue'
import JsonPreview from './components/JsonPreview.vue'
import PreviewPanel from '@/components/PreviewPanel.vue'
import { isLayoutField } from '@furmx/sdk'
import type { FieldSchema } from '@furmx/sdk'
import { ArrowLeft, ArrowDown, RefreshLeft, RefreshRight, Close } from '@element-plus/icons-vue'
import ErrorBoundary from '@/components/ErrorBoundary.vue'
import PublishLinkDialog from '@/components/PublishLinkDialog.vue'


const route = useRoute()
const store = useDesignerStore()

// 表单脏状态追踪 — 离开时弹出确认
const { isDirty, markClean, enableUnloadGuard, enableRouteGuard } = useFormDirty()
enableUnloadGuard()
enableRouteGuard('你有未保存的更改，确定要离开吗？')
// 同步设计器 store 的 isDirty 到 composable
watch(() => store.isDirty, (dirty) => {
  if (dirty) isDirty.value = true
})

// ---- 顶部状态 ----
const viewMode = ref<'design' | 'json'>('design')
const initLoading = ref(true)  // 初始加载骨架屏
const formName = ref('未命名表单')
const showPreview = ref(false)
const saving = ref(false)
const savingToTemplate = ref(false)
const saveTargetVersion = ref<number>(0)  // 0 = 新版本, >0 = 覆盖指定版本
const latestFormVersion = ref(0)
const nextVersionNumber = computed(() => latestFormVersion.value + 1)
const showPublishPrompt = ref(false)
const showLinkDialog = ref(false)
const currentFormId = ref('')
const formId = route.params.formId as string
const wsId = (route.params.wsId as string) || ''

function getCurrentSchema(): Record<string, unknown> | null {
  try {
    return designerStore.getSchema?.() || null
  } catch {
    return null
  }
}

function handleInsertSchema(schema: Record<string, unknown>) {
  if (schema.fields && Array.isArray(schema.fields)) {
    designerStore.loadSchema(schema as any)
    ElMessage.success('AI 生成的表单已加载到设计器，后续对话将基于此表单')
  }
}

// 模板编辑模式：路由 /template-designer?template=xxx
const isTemplateMode = computed(() => !!route.query.template)

// ---- 列宽拖拽 ----
const MIN_LEFT = 180
const MAX_LEFT = 400
const MIN_RIGHT = 240
const MAX_RIGHT = 500
const leftWidth = ref(240)
const rightWidth = ref(320)
const resizing = ref<'left' | 'right' | null>(null)
let resizeStartX = 0
let resizeStartW = 0

function onResizeStart(side: 'left' | 'right', e: MouseEvent) {
  resizing.value = side
  resizeStartX = e.clientX
  resizeStartW = side === 'left' ? leftWidth.value : rightWidth.value
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
}

function onResizeMove(e: MouseEvent) {
  if (!resizing.value) return
  const dx = e.clientX - resizeStartX

  if (resizing.value === 'left') {
    const w = Math.max(MIN_LEFT, Math.min(MAX_LEFT, resizeStartW + dx))
    leftWidth.value = w
  } else {
    // 右侧面板：向右拖 = 减小右侧宽度（dx 为正，w 应减）
    const w = Math.max(MIN_RIGHT, Math.min(MAX_RIGHT, resizeStartW - dx))
    rightWidth.value = w
  }
}

function onResizeUp() {
  if (resizing.value) {
    resizing.value = null
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }
}

// ---- 初始化 ----
async function initDesigner(queryTemplate?: string) {
  const tplId = queryTemplate ?? (route.query.template as string)

  if (tplId) {
    try {
      const res = await http.get(`/templates/${tplId}`) as any
      const tpl = res.data || res
      formName.value = tpl.name || ''
      currentFormId.value = tplId
      const schema = tpl.schema || {}
      // 补全必要默认值，避免画布组件崩溃
      if (!schema.settings) schema.settings = { canvasCols: 24 }
      if (!schema.settings.canvasCols) schema.settings.canvasCols = 24
      if (!schema.fields) schema.fields = []
      store.loadSchema(schema)
    } catch (e: unknown) {
      ElMessage.error((e as { response?: { data?: { message?: string } } }).response?.data?.message || '加载模板失败')
      initLoading.value = false
    }
  } else if (formId) {
    try {
      const res = await http.get(`/forms/${formId}`) as any
      const form = res.data || res
      currentFormId.value = form.id
      const fs = form.schema || {}
      if (!fs.settings) fs.settings = {}
      if (!fs.settings.canvasCols) fs.settings.canvasCols = 24
      if (!fs.settings.formTitle) fs.settings.formTitle = form.name
      formName.value = fs.settings.formTitle || form.name || '未命名表单'
      if (!fs.fields) fs.fields = []
      store.loadSchema(fs)
      fetchLatestVersion()
    } catch (e: unknown) {
      ElMessage.error((e as { response?: { data?: { message?: string } } }).response?.data?.message || '加载表单失败')
    }
  }
  initLoading.value = false
}

async function fetchLatestVersion() {
  if (!currentFormId.value) return
  try {
    const res = await http.get(`/forms/${currentFormId.value}/versions`)
    const versions = ((res as { data?: { version: number }[] }).data || res || []) as { version: number }[]
    latestFormVersion.value = versions[0]?.version || 0
  } catch { /* */ }
}

onMounted(() => {
  const ct = document.querySelector('.default-layout .content') as HTMLElement
  if (ct) ct.style.overflow = 'hidden'
  initDesigner()
})

// 同路由 query 变化时重新初始化，传入新 query 值
onBeforeRouteUpdate((to) => {
  const newTplId = to.query.template as string
  if (newTplId) initDesigner(newTplId)
})

onUnmounted(() => {
  // 恢复外层 content 滚轮
  const ct = document.querySelector('.default-layout .content') as HTMLElement
  if (ct) ct.style.overflow = ''
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
})

function goBack() { window.history.back() }
function undo() { store.undo() }
function redo() { store.redo() }

// ---- 标签非空校验 ----
function findEmptyLabel(fields: FieldSchema[]): FieldSchema | null {
  for (const f of fields) {
    if (!isLayoutField(f.type) && !(f.name || '').trim()) return f
    if (f.children) {
      const found = findEmptyLabel(f.children)
      if (found) return found
    }
  }
  return null
}

function openPreview() {
  const empty = findEmptyLabel(store.schema.fields)
  if (empty) {
    ElMessage.warning(`「${empty.type}」控件标签名称为空，不可预览`)
    return
  }
  showPreview.value = true
}

function handleSaveCommand(cmd: string) {
  saveTargetVersion.value = cmd === 'overwrite' ? latestFormVersion.value : 0
  handleSave()
}

async function handleSave() {
  const empty = findEmptyLabel(store.schema.fields)
  if (empty) {
    ElMessage.warning(`「${empty.type}」控件标签名称为空，不可保存`)
    return
  }
  saving.value = true
  try {
    // 保存前同步：表单名与界面设置中的表单标题一致
    const title = (store.schema.settings as Record<string, any>).formTitle
    if (title) formName.value = title
    const payload: Record<string, unknown> = {
      name: formName.value,
      schema: store.getSchema(),
    }
    if (saveTargetVersion.value > 0) {
      payload.targetVersion = saveTargetVersion.value
    }
    await http.patch(`/forms/${currentFormId.value}`, payload)
    const label = saveTargetVersion.value > 0 ? `已覆盖 v${saveTargetVersion.value}` : `已保存 v${nextVersionNumber.value}`
    ElMessage.success(label)
    markClean()
    showPublishPrompt.value = true
    // 刷新版本信息
    if (saveTargetVersion.value === 0) {
      latestFormVersion.value = nextVersionNumber.value
    }
  } catch (e: unknown) {
    ElMessage.error((e as { response?: { data?: { message?: string } } }).response?.data?.message || '保存失败')
  } finally {
    saving.value = false
    saveTargetVersion.value = 0
  }
}

async function handlePublishNow() {
  showPublishPrompt.value = false
  try {
    await http.post(`/forms/${currentFormId.value}/publish`)
    showLinkDialog.value = true
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || '发布失败')
  }
}

async function handleSaveFromPreview() {
  showPreview.value = false
  await handleSave()
}

async function handleSaveToTemplate() {
  const empty = findEmptyLabel(store.schema.fields)
  if (empty) {
    ElMessage.warning(`「${empty.type}」控件标签名称为空，不可保存`)
    return
  }
  savingToTemplate.value = true
  try {
    const tplId = route.query.template as string
    await http.patch(`/templates/${tplId}`, {
      name: formName.value,
      schema: store.getSchema(),
    })
    ElMessage.success('模板已更新')
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || '保存到模板失败')
  } finally {
    savingToTemplate.value = false
  }
}

function handlePublishLater() { showPublishPrompt.value = false }
</script>

<style scoped>
.designer-layout {
  display: flex;
  flex-direction: column;
  height: 100%;
}

/* ---- 顶部工具栏 ---- */
.designer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 20px;
  background: var(--app-bg-card, #fff);
  border: 1px solid var(--app-border-color, #e4e7ed);
  border-radius: 8px;
  flex-shrink: 0;
}
.header-left { display: flex; align-items: center; gap: 14px; min-width: 0; flex: 1; }
.header-center { display: flex; align-items: center; justify-content: center; gap: 10px; flex: 0 0 auto; }
.header-right { display: flex; align-items: center; justify-content: flex-end; gap: 10px; flex: 1; min-width: 0; }
.form-name-input { width: 240px; }

/* ---- 主体三列 ---- */
.designer-body {
  display: flex;
  flex: 1;
  overflow: hidden;
  margin-top: 12px;
  gap: 10px;
}

/* 左侧面板 */
.panel-left {
  flex-shrink: 0;
  overflow-y: auto;
  overflow-x: hidden;
  background: var(--app-bg-card, #fff);
  border: 1px solid var(--app-border-color, #e4e7ed);
  border-radius: 8px;
  padding: 10px;
}
.panel-left::-webkit-scrollbar { width: 6px; }
.panel-left::-webkit-scrollbar-thumb { background: transparent; border-radius: 3px; }
.panel-left:hover::-webkit-scrollbar-thumb { background: #c0c4cc; }

/* 右侧面板 */
.panel-right {
  flex-shrink: 0;
  overflow-y: auto;
  overflow-x: hidden;
  background: var(--app-bg-card, #fff);
  border: 1px solid var(--app-border-color, #e4e7ed);
  border-radius: 8px;
  padding: 10px;
}
.panel-right::-webkit-scrollbar { width: 6px; }
.panel-right::-webkit-scrollbar-thumb { background: transparent; border-radius: 3px; }
.panel-right:hover::-webkit-scrollbar-thumb { background: #c0c4cc; }

/* 画布区域 */
.canvas-area {
  flex: 1;
  overflow: auto;
  background: var(--app-bg-page, #f5f6f8);
  border: 1px solid var(--app-border-color, #e4e7ed);
  border-radius: 8px;
  padding: 20px;
}
.canvas-area::-webkit-scrollbar { width: 6px; height: 6px; }
.canvas-area::-webkit-scrollbar-thumb { background: transparent; border-radius: 3px; }
.canvas-area:hover::-webkit-scrollbar-thumb { background: #c0c4cc; }
.canvas-area::-webkit-scrollbar-corner { background: transparent; }

/* ---- 拖拽分隔线 ---- */
.resize-divider {
  width: 6px;
  flex-shrink: 0;
  cursor: col-resize;
  background: transparent;
  transition: background 0.15s;
  position: relative;
  z-index: 5;
}
.resize-divider:hover,
.resize-divider.active {
  background: rgba(64,158,255,0.15);
}
.divider-grip {
  width: 3px;
  height: 32px;
  border-radius: 2px;
  background: #c0c4cc;
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  transition: background 0.15s;
}
.resize-divider:hover .divider-grip,
.resize-divider.active .divider-grip {
  background: #409eff;
}

/* ---- 预览浮层 ---- */
.preview-overlay {
  position: fixed; top: 0; left: 0; right: 0; bottom: 0;
  z-index: 1000; background: #f0f2f5;
  display: flex; flex-direction: column;
}
.preview-overlay-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 12px 24px; background: #fff; border-bottom: 1px solid #e4e7ed;
  flex-shrink: 0;
}
.preview-overlay-header span { font-size: 18px; font-weight: 600; }
.preview-overlay-body {
  flex: 1; overflow-y: auto; padding: 24px;
}
.form-preview-box { border: 1px solid #e4e7ed; border-radius: 6px; padding: 16px; background: #fafbfc; }
</style>
