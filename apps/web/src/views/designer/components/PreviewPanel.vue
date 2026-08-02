<template>
  <div class="preview-wrapper">
    <div class="preview-canvas" :style="canvasStyle">
      <div v-if="schema.settings.formTitle" class="pv-title">{{ schema.settings.formTitle }}</div>
      <div v-if="!schema.fields.length" class="empty">无控件</div>
      <div v-else class="pv-fields" :style="gridStyle">
        <FormField
          v-for="field in schema.fields"
          :key="field.id"
          :field="field"
          :schema-settings="schema.settings"
          :model-value="formData[field.key]"
          :max-cols="schema.settings.canvasCols || 24"
          :required="field.rules?.some((r: any) => r.type === 'required') ?? false"
          @update:model-value="(v) => { if (field.key) formData[field.key] = v }"
        />
      </div>
    </div>
    <div class="preview-footer">
      <el-button type="primary" @click="onSave">保存</el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, onMounted, watch } from 'vue'
import type { FormSchema, FieldSchema } from '@furmx/sdk'
import { isLayoutField } from '@furmx/sdk'
import FormField from '../../renderer/components/FormField.vue'

const props = defineProps<{ schema: FormSchema }>()
const emit = defineEmits<{ save: [] }>()

const formData = reactive<Record<string, any>>({})

function initData(s: FormSchema) {
  Object.keys(formData).forEach(k => delete formData[k])
  const walk = (fields: FieldSchema[]) => {
    for (const f of fields) {
      if (f.key && !isLayoutField(f.type)) formData[f.key] = f.defaultValue ?? (f.type === 'checkbox' ? [] : '')
      if (f.children) walk(f.children)
    }
  }
  walk(s.fields)
}

onMounted(() => initData(props.schema))
watch(() => props.schema, (s) => initData(s), { deep: true })

const COL_PX = 800 / 24

const canvasStyle = {
  width: `${Math.round((props.schema.settings.canvasCols || 24) * COL_PX)}px`,
  margin: '0 auto',
  background: '#fff',
  borderRadius: '4px',
  padding: '24px',
  boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
}

const gridStyle = {
  display: 'grid',
  gridTemplateColumns: `repeat(${props.schema.settings.canvasCols || 24}, 1fr)`,
  gap: '12px 16px',
  alignItems: 'start',
}

function onSave() { emit('save') }
</script>

<style scoped>
.preview-wrapper { padding-bottom: 60px; }
.preview-canvas { max-width: 100%; }
.pv-title {
  text-align: center; font-size: 20px; font-weight: 600; color: #303133;
  margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid #ebeef5;
}
.empty { text-align: center; padding: 80px; color: #909399; }
.preview-footer { text-align: center; margin-top: 32px; }
</style>
