<template>
  <template v-if="isLayoutField(field.type)">
    <!-- 布局控件：递归渲染子字段 -->
    <div
      v-if="field.type === 'card'"
      class="field-card"
    >
      <el-card
        :header="field.props.header || ''"
        :shadow="field.props.shadow || 'always'"
      >
        <template v-if="field.children">
          <FieldRenderer
            v-for="child in field.children"
            :key="child.id"
            :field="child"
            :form-data="formData"
            :depth="depth + 1"
            @update="(k, v) => emit('update', k, v)"
          />
        </template>
      </el-card>
    </div>

    <div
      v-else-if="field.type === 'divider'"
      class="field-divider"
    >
      <el-divider :direction="field.props.direction || 'horizontal'" />
    </div>

    <div
      v-else-if="String(field.type) === 'group'"
      class="field-group"
    >
      <h4 class="group-title">
        {{ field.props.title || field.name }}
      </h4>
      <template v-if="field.children">
        <FieldRenderer
          v-for="child in field.children"
          :key="child.id"
          :field="child"
          :form-data="formData"
          :depth="depth + 1"
          @update="(k, v) => emit('update', k, v)"
        />
      </template>
    </div>

    <div
      v-else-if="field.type === 'collapse'"
      class="field-collapse"
    >
      <el-collapse :accordion="field.props.accordion">
        <el-collapse-item :title="field.name">
          <template v-if="field.children">
            <FieldRenderer
              v-for="child in field.children"
              :key="child.id"
              :field="child"
              :form-data="formData"
              :depth="depth + 1"
              @update="(k, v) => emit('update', k, v)"
            />
          </template>
        </el-collapse-item>
      </el-collapse>
    </div>

    <div
      v-else
      class="layout-wrapper"
      :class="'layout-' + field.type"
    >
      <h4
        v-if="field.name"
        class="layout-title"
      >
        {{ field.name }}
      </h4>
      <div
        class="layout-children"
        :style="getLayoutStyle(field)"
      >
        <template v-if="field.children">
          <FieldRenderer
            v-for="child in field.children"
            :key="child.id"
            :field="child"
            :form-data="formData"
            :depth="depth + 1"
            @update="(k, v) => emit('update', k, v)"
          />
        </template>
      </div>
    </div>
  </template>

  <template v-else>
    <!-- 普通表单控件 -->
    <el-form-item
      :label="field.name"
      :prop="field.key"
      :size="fieldSize"
      class="field-item"
      :style="{ width: colWidth }"
    >
      <!-- Select 下拉选择 -->
      <template v-if="field.type === 'select'">
        <el-select
          :model-value="formData[field.key]"
          v-bind="selectProps(field)"
          @update:model-value="(v: any) => emit('update', field.key, v)"
        >
          <el-option
            v-for="opt in (propsOf(field).options || [])"
            :key="opt.value"
            :label="opt.label"
            :value="opt.value"
            :disabled="opt.disabled"
          />
        </el-select>
      </template>

      <!-- Radio 单选 -->
      <template v-else-if="field.type === 'radio'">
        <el-radio-group
          :model-value="formData[field.key]"
          v-bind="radioCheckboxProps(field)"
          @update:model-value="(v: any) => emit('update', field.key, v)"
        >
          <el-radio
            v-for="opt in (propsOf(field).options || [])"
            :key="String(opt.value)"
            :value="opt.value"
            :disabled="opt.disabled"
          >
            {{ opt.label }}
          </el-radio>
        </el-radio-group>
      </template>

      <!-- Checkbox 多选 -->
      <template v-else-if="field.type === 'checkbox'">
        <el-checkbox-group
          :model-value="formData[field.key]"
          v-bind="radioCheckboxProps(field)"
          @update:model-value="(v: any) => emit('update', field.key, v)"
        >
          <el-checkbox
            v-for="opt in (propsOf(field).options || [])"
            :key="String(opt.value)"
            :value="opt.value"
            :disabled="opt.disabled"
          >
            {{ opt.label }}
          </el-checkbox>
        </el-checkbox-group>
      </template>

      <!-- Textarea -->
      <template v-else-if="field.type === 'textarea'">
        <el-input
          :model-value="formData[field.key]"
          v-bind="textareaProps(field)"
          @update:model-value="(v: any) => emit('update', field.key, v)"
        />
      </template>

      <!-- Switch 开关 -->
      <template v-else-if="field.type === 'switch'">
        <el-switch
          :model-value="formData[field.key]"
          v-bind="switchProps(field)"
          @update:model-value="(v: any) => emit('update', field.key, v)"
        />
      </template>

      <!-- Upload -->
      <template v-else-if="field.type === 'upload'">
        <el-upload
          :file-list="uploadFiles[field.key] || []"
          :accept="field.props?.accept"
          :limit="field.props?.maxCount || 1"
          action="/api/v1/upload"
          :auto-upload="false"
          :on-change="(f: any, fs: any) => onUploadChange(field, f, fs)"
          :on-remove="(f: any, fs: any) => onUploadRemove(field.key, f, fs)"
          :on-exceed="onUploadExceed"
          drag
        >
          <div class="el-upload__text">
            拖拽文件到此处 或 <em>点击选择文件</em>
          </div>
          <div
            v-if="uploadHintText(field)"
            class="el-upload__tip"
          >
            <span v-html="uploadHintText(field)" />
          </div>
        </el-upload>
      </template>

      <!-- Rich Text 富文本 -->
      <template v-else-if="field.type === 'rich-text'">
        <div
          class="fr-richtext"
          :style="{ height: (field.props?.height || 400) + 'px' }"
        >
          <Toolbar
            v-if="richTextEditorRef"
            :editor="richTextEditorRef"
            :default-config="richToolbarConfig"
            mode="default"
            class="fr-richtext-toolbar"
          />
          <Editor
            :key="frRichEditorKey"
            v-model="frRichTextHtml"
            :default-config="frRichEditorConfig"
            mode="default"
            class="fr-richtext-editor"
            @on-created="onFrRichCreated"
          />
        </div>
      </template>

      <!-- 提示文本 -->
      <template v-else-if="field.type === 'tip-text'">
        <div
          class="fr-tip"
          :style="{ color: propsOf(field).color || '#909399', fontSize: (field.props?.fontSize || 14) + 'px', justifyContent: tipJustifyMap[propsOf(field).textAlign || 'left'], padding: '8px 0' }"
        >
          <span
            v-if="field.props?.tipType"
            class="fr-tip-icon"
          >{{ tipIconChars[propsOf(field).tipType] }}</span>
          <span>{{ field.props?.text }}</span>
        </div>
      </template>

      <!-- 级联选择 -->
      <template v-else-if="field.type === 'cascader'">
        <el-cascader
          :model-value="formData[field.key]"
          :options="frCascaderOpts"
          v-bind="frCascaderProps"
          :size="fieldSize"
          @update:model-value="(v: any) => emit('update', field.key, v)"
        />
      </template>

      <!-- 其余通用控件 -->
      <template v-else>
        <component
          :is="resolveControl(field.type)"
          :model-value="formData[field.key]"
          v-bind="field.props"
          @update:model-value="(v: any) => emit('update', field.key, v)"
        />
      </template>
    </el-form-item>
  </template>
</template>

<script setup lang="ts">
/**
 * FieldRenderer — 字段分发器（Component Bridge 的 Element Plus 实现层）
 *
 * 架构：Schema type → ComponentBridge（元数据） → elComponentMap（组件名）
 * - 控件逻辑（校验/联动/显隐）→ RendererEngine 处理
 * - 组件映射 → elComponentMap 处理（切换 UI 库只需换此文件 + adapter）
 * - 元数据（默认值/显示名/图标）→ ComponentBridge 提供
 */
import { computed, ref, shallowRef, watch, onBeforeUnmount } from 'vue'
import { ElMessage } from 'element-plus'
import type { FieldSchema } from '@furmx/sdk'
import { isLayoutField } from '@furmx/sdk'
import { resolveElComponent } from '@/bridge/element-plus-adapter'
import { regionData } from 'element-china-area-data'
import type { UploadFile, UploadFiles } from 'element-plus'
import { Editor, Toolbar } from '@wangeditor/editor-for-vue'
import type { IDomEditor } from '@wangeditor/editor'
import '@wangeditor/editor/dist/css/style.css'

const props = defineProps<{
  field: FieldSchema
  formData: Record<string, any>
  depth: number
}>()

const emit = defineEmits<{
  update: [key: string, value: any]
}>()

/**
 * field.props 的 SDK 类型为 Record<string, unknown>（运行时 JSON 属性包）。
 * 读取时统一视为 any（Record<string, unknown> 可直接赋给 Record<string, any>），
 * 与原本的运行时行为一致，不做任何类型收窄或默认值改写。
 */
function propsOf(field: FieldSchema): Record<string, any> {
  return field.props
}

// ---- 上传 ----
const uploadFiles = ref<Record<string, UploadFile[]>>({})

function onUploadChange(field: FieldSchema, file: UploadFile, files: UploadFiles) {
  const maxSize = propsOf(field).maxSize
  if (maxSize && file.size && file.size / 1024 / 1024 > maxSize) {
    ElMessage.warning(`文件大小不能超过 ${maxSize}MB`)
    uploadFiles.value[field.key] = files.filter((f: UploadFile) => f.uid !== file.uid)
    return
  }
  uploadFiles.value[field.key] = [...files]
  const names = files.map((f: UploadFile) => f.name)
  emit('update', field.key, names)
}

function onUploadRemove(key: string, _file: UploadFile, files: UploadFiles) {
  uploadFiles.value[key] = [...files]
  const names = files.map((f: UploadFile) => f.name)
  emit('update', key, names)
}

function onUploadExceed() {
  ElMessage.warning('文件数量超出限制')
}

function uploadHintText(field: FieldSchema) {
  const parts: string[] = []
  if (field.props?.accept) parts.push(`文件格式仅限 ${propsOf(field).accept.replace(/,/g, '/')}`)
  if (field.props?.maxSize) parts.push(`单个文件容量上限为 ${propsOf(field).maxSize}MB`)
  return parts.join("<br>")
}

const colWidth = computed(() => {
  if (!props.field.col) return '100%'
  return `calc(${((props.field.col / 24) * 100).toFixed(2)}% - 8px)`
})

/** 字段级尺寸覆盖 */
const fieldSize = computed(() => props.field.size || undefined)

/** 通过 Component Bridge 解析控件组件名 */
function resolveControl(type: string): string {
  return resolveElComponent(type)
}

function selectProps(field: FieldSchema) {
  const { options: _, ...rest } = field.props
  return rest
}

function radioCheckboxProps(field: FieldSchema) {
  const { options: _, ...rest } = field.props
  return rest
}

function textareaProps(field: FieldSchema) {
  const { type: _t, ...rest } = field.props
  return { ...rest, type: 'textarea' }
}

function switchProps(field: FieldSchema) {
  const raw: Record<string, any> = { ...(field.props || {}) }
  if (raw.activeText && raw.activeText.length > 6) raw.activeText = raw.activeText.slice(0, 6)
  if (raw.inactiveText && raw.inactiveText.length > 6) raw.inactiveText = raw.inactiveText.slice(0, 6)
  return raw
}

const tipIconChars: Record<string, string> = { success: '\u2714', danger: '\u2716', warning: '\u26A0' }
const tipJustifyMap: Record<string, string> = { left: 'flex-start', center: 'center', right: 'flex-end' }

const frCascaderOpts = computed(() => {
  if (props.field.props?.templateMode === 'region') return regionData
  return props.field.props?.options || []
})

const frCascaderProps = computed(() => {
  const raw = (props.field.props || {}) as Record<string, any>
  const { options: _, ...rest } = raw
  return rest
})

// ---- 富文本 (WangEditor) ----
const richTextEditorRef = shallowRef<IDomEditor | null>(null)
const frRichTextHtml = ref('')
const frRichEditorKey = ref(0)

// Sync formData → internal rich text value
watch(
  () => props.formData[props.field.key],
  (v) => { frRichTextHtml.value = v || '' },
  { immediate: true },
)

// Sync internal → formData
watch(frRichTextHtml, (v) => {
  emit('update', props.field.key, v)
})

// 占位文本变更时直接更新编辑器 DOM
watch(
  () => propsOf(props.field).placeholder,
  (val) => {
    if (richTextEditorRef.value) {
      const editable = richTextEditorRef.value.getEditableContainer()
      const el = editable?.querySelector('.w-e-text-placeholder') as HTMLElement | null
      if (el) el.textContent = val || ''
      const cfg = richTextEditorRef.value.getConfig()
      if (cfg) cfg.placeholder = val || ''
    }
  },
)

// 工具栏模式变更时重建编辑器
watch(
  () => props.field.props?.toolbarMode,
  () => {
    if (richTextEditorRef.value) {
      richTextEditorRef.value.destroy()
      richTextEditorRef.value = null
    }
    frRichEditorKey.value++
  },
)

function onFrRichCreated(editor: IDomEditor) {
  richTextEditorRef.value = editor
}

onBeforeUnmount(() => {
  if (richTextEditorRef.value) {
    richTextEditorRef.value.destroy()
    richTextEditorRef.value = null
  }
})

const frRichEditorConfig = computed(() => ({
  placeholder: props.field.props?.placeholder || '请输入内容',
  maxLength: props.field.props?.maxLength || 200,
  autoFocus: false,
  scroll: true,
}))

const richToolbarConfig = computed(() => {
  const mode = props.field.props?.toolbarMode || 'full'
  if (mode === 'simple') {
    return {
      excludeKeys: [
        'group-image', 'group-video', 'group-code-block', 'divider',
        'fontFamily', 'lineHeight', 'bulletedList', 'numberedList',
        'todo', 'emotion', 'insertTable',
      ],
    }
  }
  return {}
})

function getLayoutStyle(field: FieldSchema): Record<string, any> {
  const type: string = field.type
  if (type === 'grid') {
    return {
      display: 'grid',
      gridTemplateColumns: `repeat(${field.props.columns || 2}, 1fr)`,
      gap: `${field.props.gutter || 16}px`,
    }
  }
  if (type === 'flex') {
    return {
      display: 'flex',
      flexDirection: field.props.direction || 'row',
      gap: `${field.props.gap || 12}px`,
      justifyContent: field.props.justify || 'flex-start',
    }
  }
  return {}
}
</script>

<style scoped>
.field-item {
  display: inline-flex;
  margin-right: 8px;
  vertical-align: top;
}
.field-card { margin-bottom: 16px; width: 100%; }
.field-divider { width: 100%; }
.field-group {
  width: 100%;
  margin-bottom: 12px;
}
.group-title {
  margin: 0 0 8px;
  font-size: 15px;
  color: #303133;
}
.layout-wrapper { width: 100%; margin-bottom: 12px; }
.layout-title { margin: 0 0 8px; font-size: 15px; color: #303133; }
.layout-children { display: flex; flex-wrap: wrap; }

/* Rich text */
.fr-richtext {
  display: flex;
  flex-direction: column;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  overflow: hidden;
  width: 100%;
}
.fr-richtext-toolbar {
  flex-shrink: 0;
  border-bottom: 1px solid #dcdfe6;
  background: #fafafa;
}
.fr-richtext-editor {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}
.fr-richtext-editor :deep(.w-e-text-container) {
  background: #fff;
}
</style>
