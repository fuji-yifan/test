<template>
  <div
    class="form-card"
    :style="{ width: canvasWidth + 'px' }"
  >
    <div
      v-if="schema.settings?.formTitle"
      class="form-title"
    >
      {{ schema.settings.formTitle }}
    </div>
    <div
      v-if="!schema.fields?.length"
      class="empty-hint"
    >
      无控件
    </div>
    <div
      v-else
      class="form-fields"
      :style="gridStyle"
    >
      <FormField
        v-for="field in schema.fields"
        :key="field.id"
        :field="field"
        :schema-settings="schema.settings"
        :model-value="data?.[field.key]"
        :max-cols="schema.settings.canvasCols || 24"
        :required="isRequired(field)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { FormSchema, FieldSchema } from '@furmx/sdk'
import FormField from '@/views/renderer/components/FormField.vue'

/** 只读展示一份表单数据（提交详情页、流程里的「表单数据」弹窗共用） */
const props = defineProps<{
  schema: FormSchema
  data?: Record<string, unknown> | null
}>()

/** 画布列宽像素：按内容宽 800px 折算（24 列 = 正好 800px），与提交详情页同一口径 */
const COL_PX = 800 / 24
const canvasWidth = computed(() => Math.round((props.schema.settings?.canvasCols || 24) * COL_PX))

const gridStyle = computed(() => ({
  display: 'grid',
  gridTemplateColumns: `repeat(${props.schema.settings?.canvasCols || 24}, 1fr)`,
  gap: '12px 16px',
  alignItems: 'start' as const,
}))

function isRequired(field: FieldSchema) {
  return (field.rules || []).some((r) => r.type === 'required')
}
</script>

<style scoped>
/* ---- 表单卡片 ---- */
.form-card {
  background: #fff;
  border-radius: 4px;
  padding: 24px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
  pointer-events: none;
}
.form-title {
  text-align: center;
  font-size: 20px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 24px;
  padding-bottom: 16px;
  border-bottom: 1px solid #ebeef5;
}
.form-fields { display: grid; gap: 12px 16px; align-items: start; }
.empty-hint { text-align: center; padding: 80px 0; color: #909399; }

html.dark .form-card { background: #1e293b; }
html.dark .form-title { color: #e2e8f0; border-bottom-color: #334155; }
html.dark .empty-hint { color: #64748b; }
</style>
