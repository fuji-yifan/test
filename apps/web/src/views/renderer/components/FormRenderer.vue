<template>
  <div class="form-renderer-wrapper">
    <h2
      v-if="title"
      class="form-title"
    >
      {{ title }}
    </h2>

    <el-form
      ref="formRef"
      :model="formData"
      :rules="formRules"
      :label-width="labelWidth"
      label-position="left"
      :size="engineRef.schema.settings.size"
      :disabled="engineRef.schema.settings.disabled"
    >
      <FieldRenderer
        v-for="field in aclFilteredFields"
        :key="field.id"
        :field="field"
        :form-data="formData"
        :depth="0"
        @update="(k, v) => updateField(k, v)"
      />
    </el-form>

    <div class="form-actions">
      <el-button
        v-if="engineRef.schema.settings.resetText"
        @click="resetForm"
      >
        {{ engineRef.schema.settings.resetText }}
      </el-button>
      <el-button
        type="primary"
        :loading="submitting"
        @click="handleSubmit"
      >
        {{ engineRef.schema.settings.submitText }}
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { FormSchema, CompatibilityWarning } from '@furmx/sdk'
import { walkFields } from '@furmx/sdk'
import { useRendererEngine } from '../composables/useRendererEngine'
import { useCompatibility } from '../composables/useCompatibility'
import FieldRenderer from './FieldRenderer.vue'

const props = withDefaults(defineProps<{
  schema: FormSchema
  title?: string
  initialData?: Record<string, any>
  /** 数据提交时的 Schema 版本号（历史数据渲染时传入，用于兼容检测） */
  dataVersion?: number
  /** 兼容性警告（由外部预先计算后传入） */
  compatWarnings?: CompatibilityWarning[]
  /** 当前用户角色列表（用于字段级 ACL 过滤），如 ["role:hr", "role:manager"] */
  userRoles?: string[]
}>(), {
  title: '',
  dataVersion: undefined,
  compatWarnings: () => [],
  userRoles: () => [],
})

const emit = defineEmits<{
  submit: [data: Record<string, any>]
}>()

// 自动兼容性检测：当传入 dataVersion 时，自动适配旧数据
const compatResult = props.dataVersion !== undefined && props.initialData
  ? useCompatibility(props.schema, props.initialData, props.dataVersion)
  : null

// 最终使用的数据：兼容适配后 > 原始 initialData
const resolvedInitialData = compatResult?.needed
  ? compatResult.data
  : (props.initialData || {})

// 警告合并：外部传入 + 自动检测
const warnings = computed(() => {
  const auto = compatResult?.warnings || []
  const manual = props.compatWarnings || []
  return [...auto, ...manual]
})

const {
  engineRef,
  formData,
  visibleFields,
  resetForm,
  submitForm,
  updateField,
} = useRendererEngine(props.schema, resolvedInitialData)

/** 标签宽度：schema 未设 labelWidth（老表单/手工建的）时交给 Element Plus 自适应 */
const labelWidth = computed(() => {
  const w = engineRef.value.schema.settings.labelWidth
  return w ? `${w}px` : 'auto'
})

// ACL 过滤后的可见字段
const aclFilteredFields = computed(() => {
  if (!props.userRoles || props.userRoles.length === 0) {
    return visibleFields.value
  }
  return engineRef.value.filterByACL(props.userRoles)
})

const formRef = ref()
const submitting = ref(false)

// 解析校验规则为 Element Plus 格式
const formRules = computed(() => {
  const rules: Record<string, any[]> = {}
  walkFields(props.schema.fields, (field) => {
    if (field.key) {
      if (field.rules?.length) {
        rules[field.key] = field.rules.map((r) => ({
          required: r.type === 'required',
          type: r.type === 'email' ? 'email' : r.type === 'url' ? 'url' : undefined,
          min: r.type === 'min' || r.type === 'minLength' ? r.value : undefined,
          max: r.type === 'max' || r.type === 'maxLength' ? r.value : undefined,
          message: r.message,
          trigger: 'blur',
        }))
      }
      // 从 props 中提取 maxLength 作为校验规则
      const maxLen = field.props?.maxLength || field.props?.maxlength
      if (maxLen) {
        if (!rules[field.key]) rules[field.key] = []
        rules[field.key].push({ max: maxLen, message: `输入内容不能超过 ${maxLen} 个字符`, trigger: 'blur' })
      }
    }
  })
  return rules
})

async function handleSubmit() {
  if (!formRef.value) return
  try {
    await formRef.value.validate()
    submitting.value = true
    const { valid, data } = await submitForm()
    if (valid) {
      emit('submit', data)
    }
  } catch {
    // Element Plus 校验失败
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.form-renderer-wrapper {
  background: #fff;
  padding: 32px;
  border-radius: 8px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
}
.form-title {
  text-align: center;
  margin: 0 0 24px;
  font-size: 20px;
  font-weight: 600;
}
.form-actions {
  text-align: center;
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid #ebeef5;
}
.compat-warning {
  margin-bottom: 16px;
}
</style>
