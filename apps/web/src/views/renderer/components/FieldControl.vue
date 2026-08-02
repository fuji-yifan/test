<template>
  <!-- 单个控件渲染（不含外层容器和标签），被 PreviewPanel / PublicFormView 共用 -->
  <el-input
    v-if="field.type === 'input'"
    :model-value="modelValue"
    v-bind="field.props"
    :size="size"
    class="fc-ctrl"
    @update:model-value="$emit('update:modelValue', $event)"
  />
  <el-input
    v-else-if="field.type === 'textarea'"
    :model-value="modelValue"
    type="textarea"
    v-bind="field.props"
    :size="size"
    class="fc-ctrl"
    @update:model-value="$emit('update:modelValue', $event)"
  />
  <el-input-number
    v-else-if="field.type === 'input-number'"
    :model-value="modelValue || null"
    v-bind="numProps"
    :size="size"
    class="fc-ctrl"
    @update:model-value="$emit('update:modelValue', $event)"
  />
  <el-select
    v-else-if="field.type === 'select'"
    :model-value="modelValue"
    v-bind="selectProps"
    :size="size"
    class="fc-ctrl"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <el-option v-for="opt in (field.props?.options || [])" :key="opt.value" :label="opt.label" :value="opt.value" />
  </el-select>
  <el-radio-group
    v-else-if="field.type === 'radio'"
    :model-value="modelValue"
    :size="size"
    class="fc-ctrl"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <el-radio v-for="opt in (field.props?.options || [])" :key="String(opt.value)" :value="opt.value">{{ opt.label }}</el-radio>
  </el-radio-group>
  <el-checkbox-group
    v-else-if="field.type === 'checkbox'"
    :model-value="modelValue"
    :size="size"
    class="fc-ctrl"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <el-checkbox v-for="opt in (field.props?.options || [])" :key="String(opt.value)" :value="opt.value">{{ opt.label }}</el-checkbox>
  </el-checkbox-group>
  <el-date-picker
    v-else-if="field.type === 'date-picker'"
    :model-value="modelValue"
    v-bind="field.props"
    :size="size"
    class="fc-ctrl"
    @update:model-value="$emit('update:modelValue', $event)"
  />
  <el-switch
    v-else-if="field.type === 'switch'"
    :model-value="modelValue"
    v-bind="switchProps"
    class="fc-ctrl"
    @update:model-value="$emit('update:modelValue', $event)"
  />
  <el-rate
    v-else-if="field.type === 'rate'"
    :model-value="modelValue"
    v-bind="field.props"
    @update:model-value="$emit('update:modelValue', $event)"
  />
  <el-slider
    v-else-if="field.type === 'slider'"
    :model-value="modelValue"
    v-bind="field.props"
    class="fc-ctrl"
    @update:model-value="$emit('update:modelValue', $event)"
  />
  <el-upload
    v-else-if="field.type === 'upload'"
    :file-list="fileList"
    :accept="field.props?.accept"
    :limit="field.props?.maxCount || 1"
    action="/api/v1/upload"
    :auto-upload="false"
    :on-change="onUploadChange"
    :on-remove="onUploadRemove"
    :on-exceed="onUploadExceed"
    class="fc-ctrl"
    drag
  >
    <div class="el-upload__text">拖拽文件到此处 或 <em>点击选择文件</em></div>
    <div class="el-upload__tip" v-if="uploadHint" v-html="uploadHint"></div>
  </el-upload>
  <!-- 富文本 -->
  <div v-else-if="field.type === 'rich-text'" class="fc-richtext" :style="{ height: (field.props?.height || 400) + 'px' }">
    <Toolbar
      v-if="richTextEditorRef"
      :editor="richTextEditorRef"
      :default-config="richToolbarConfig"
      mode="default"
      class="fc-richtext-toolbar"
    />
    <Editor
      v-model="richTextValue"
      :default-config="richEditorConfig"
      :key="richTextEditorKey"
      mode="default"
      class="fc-richtext-editor"
      @on-created="onRichTextCreated"
    />
  </div>
  <div
    v-else-if="field.type === 'tip-text'"
    class="fc-tip"
    :style="{
      color: field.props?.color || '#909399',
      fontSize: (field.props?.fontSize || 14) + 'px',
      justifyContent: tipJustifyMap[field.props?.textAlign || 'left'],
    }"
  >
    <span v-if="field.props?.tipType" class="fc-tip-icon">{{ tipIconChars[field.props.tipType] }}</span>
    <span>{{ field.props?.text }}</span>
  </div>
  <el-cascader
    v-else-if="field.type === 'cascader'"
    :model-value="modelValue"
    :options="cascaderOpts"
    v-bind="cascaderProps"
    :size="size"
    class="fc-ctrl"
    @update:model-value="$emit('update:modelValue', $event)"
  />
  <el-input
    v-else
    :model-value="modelValue"
    v-bind="field.props"
    :size="size"
    class="fc-ctrl"
    @update:model-value="$emit('update:modelValue', $event)"
  />
</template>

<script setup lang="ts">
import { computed, ref, shallowRef, watch, onBeforeUnmount } from 'vue'
import { ElMessage } from 'element-plus'
import type { FieldSchema } from '@furmx/sdk'
import type { UploadFile, UploadFiles } from 'element-plus'
import { regionData } from 'element-china-area-data'
import { Editor, Toolbar } from '@wangeditor/editor-for-vue'
import type { IDomEditor } from '@wangeditor/editor'
import '@wangeditor/editor/dist/css/style.css'

const props = defineProps<{
  field: FieldSchema
  modelValue: any
  size?: string
}>()

const emit = defineEmits<{ 'update:modelValue': [value: any] }>()

// ---- 上传 ----
const fileList = ref<UploadFile[]>([])

const uploadHint = computed(() => {
  const parts: string[] = []
  if (props.field.props?.accept) {
    parts.push(`文件格式仅限 ${props.field.props.accept.replace(/,/g, '/')}`)
  }
  if (props.field.props?.maxSize) {
    parts.push(`单个文件容量上限为 ${props.field.props.maxSize}MB`)
  }
  return parts.join('<br>')
})

function onUploadChange(file: UploadFile, files: UploadFiles) {
  const maxSize = props.field.props?.maxSize
  if (maxSize && file.size && file.size / 1024 / 1024 > maxSize) {
    ElMessage.warning(`文件大小不能超过 ${maxSize}MB`)
    fileList.value = files.filter((f: UploadFile) => f.uid !== file.uid)
    return
  }
  fileList.value = [...files]
  const names = files.map((f: UploadFile) => f.name)
  emit('update:modelValue', names)
}

function onUploadRemove(file: UploadFile, files: UploadFiles) {
  fileList.value = [...files]
  const names = files.map((f: UploadFile) => f.name)
  emit('update:modelValue', names)
}

function onUploadExceed() {
  ElMessage.warning(`最多上传 ${props.field.props?.maxCount || 1} 个文件`)
}

const switchProps = computed(() => {
  const raw = { ...(props.field.props || {}) }
  if (raw.activeText && raw.activeText.length > 6) raw.activeText = raw.activeText.slice(0, 6)
  if (raw.inactiveText && raw.inactiveText.length > 6) raw.inactiveText = raw.inactiveText.slice(0, 6)
  return raw
})

const tipIconChars: Record<string, string> = { success: '\u2714', danger: '\u2716', warning: '\u26A0' }
const tipJustifyMap: Record<string, string> = { left: 'flex-start', center: 'center', right: 'flex-end' }

const cascaderOpts = computed(() => {
  if (props.field.props?.templateMode === 'region') return regionData
  return props.field.props?.options || []
})

const cascaderProps = computed(() => {
  const raw = (props.field.props || {}) as Record<string, any>
  const { options, ...rest } = raw
  return rest
})

const numProps = computed(() => {
  const raw = (props.field.props || {}) as Record<string, any>
  const { numberStyle, min, max, ...rest } = raw
  // 防御：如果 min > max 则丢弃 max（Element Plus 会抛错导致组件崩溃）
  const safe: Record<string, any> = { ...rest }
  if (min !== undefined) safe.min = min
  if (max !== undefined && (min === undefined || max >= min)) safe.max = max
  if (numberStyle === 'input') return { controls: false, ...safe }
  if (numberStyle === 'stepper') return { controlsPosition: 'right', ...safe }
  return safe
})

const selectProps = computed(() => {
  const { options, ...rest } = (props.field.props || {}) as Record<string, any>
  return rest
})

// ---- 富文本 (WangEditor) ----
const richTextEditorRef = shallowRef<IDomEditor | null>(null)
const richTextValue = ref(props.modelValue || '')
const richTextEditorKey = ref(0)

// 同步外部 modelValue → internal
watch(() => props.modelValue, (v) => {
  if (v !== richTextValue.value) {
    richTextValue.value = v || ''
  }
})

// 同步 internal → external
watch(richTextValue, (v) => {
  emit('update:modelValue', v)
})

// 占位文本变更时直接更新编辑器 DOM（不能依赖 defaultConfig 重建，WangEditor 只读一次）
watch(
  () => props.field.props?.placeholder,
  (val) => {
    if (richTextEditorRef.value) {
      const editable = richTextEditorRef.value.getEditableContainer()
      const el = editable?.querySelector('.w-e-text-placeholder') as HTMLElement | null
      if (el) el.textContent = val || ''
      // 同步更新 config 中的 placeholder 以便 editor.getConfig() 查询
      const cfg = richTextEditorRef.value.getConfig()
      if (cfg) cfg.placeholder = val || ''
    }
  },
)

// 工具栏模式变更时重建编辑器（模式只能在初始化时设定）
watch(
  () => props.field.props?.toolbarMode,
  () => {
    if (richTextEditorRef.value) {
      richTextEditorRef.value.destroy()
      richTextEditorRef.value = null
    }
    richTextEditorKey.value++
  },
)

function onRichTextCreated(editor: IDomEditor) {
  richTextEditorRef.value = editor
}

onBeforeUnmount(() => {
  if (richTextEditorRef.value) {
    richTextEditorRef.value.destroy()
    richTextEditorRef.value = null
  }
})

const richEditorConfig = computed(() => ({
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
</script>
