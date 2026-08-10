<template>
  <div
    v-if="!schema.fields?.length"
    class="preview-empty"
  >
    <el-empty description="无表单字段" :image-size="60" />
  </div>
  <div
    v-else
    :style="canvasStyle"
  >
    <div :style="gridStyle">
    <!-- 标题 — 与画布 canvas-title 一致 -->
    <div
      v-if="!hideTitle && schema.settings.formTitle"
      class="pv-title"
      :style="{ gridColumn: `1 / span ${schema.settings.canvasCols || 24}` }"
    >
      {{ schema.settings.formTitle }}
    </div>
    <!-- 字段 — 与画布 CanvasField 使用完全相同的 DOM 结构和 CSS 类 -->
    <div
      v-for="field in schema.fields"
      :key="field.id"
      class="canvas-field"
      :style="{ gridColumn: `span ${spanCol(field)}` }"
    >
      <div
        class="field-inner"
        :class="[`label-${labelPos(field)}`, `size-${sizeVal(field)}`]"
      >
        <div
          v-if="field.type !== 'tip-text'"
          class="field-label"
        >
          {{ field.name && field.name.length > 6 ? field.name.slice(0, 6) : field.name }}<span
            v-if="field.rules?.some((r) => r.type === 'required')"
            class="field-required"
          >*</span>
        </div>
        <template v-if="isLayoutField(field.type)">
          <div
            v-if="field.children?.length"
            class="field-children"
            :class="`layout-${field.type}`"
          >
            <div
              v-for="child in field.children"
              :key="child.id"
              class="canvas-field"
            >
              <div
                class="field-inner"
                :class="[`label-${labelPos(child)}`, `size-${sizeVal(child)}`]"
              >
                <div
                  v-if="child.type !== 'tip-text'"
                  class="field-label"
                >
                  {{ child.name && child.name.length > 6 ? child.name.slice(0, 6) : child.name }}
                </div>
                <div class="field-placeholder">
                  <FieldControl
                    :field="child"
                    :model-value="formData[child.key]"
                    :size="sizeVal(child)"
                    @update:model-value="(v) => { if (child.key) formData[child.key] = v }"
                  />
                </div>
              </div>
            </div>
          </div>
        </template>
        <template v-else>
          <div class="field-placeholder">
            <FieldControl
              :field="field"
              :model-value="formData[field.key]"
              :size="sizeVal(field)"
              @update:model-value="(v) => { if (field.key) formData[field.key] = v }"
            />
          </div>
        </template>
      </div>
    </div>
  </div>
  </div>
  <div
    v-if="!hideActions"
    class="preview-footer"
  >
    <el-button
      type="primary"
      @click="onSave"
    >
      保存
    </el-button>
  </div>
</template>

<script setup lang="ts">
import { reactive, onMounted, watch } from 'vue'
import type { FormSchema, FieldSchema } from '@furmx/sdk'
import { isLayoutField, getMinCol } from '@furmx/sdk'
import FieldControl from '@/views/renderer/components/FieldControl.vue'
import '@/views/renderer/components/field-shared.css'

const props = defineProps<{
  schema: FormSchema
  hideActions?: boolean
  hideTitle?: boolean
}>()
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

function spanCol(field: FieldSchema): number {
  const maxCols = props.schema.settings.canvasCols || 24
  const min = getMinCol(field.type)
  return Math.max(min, Math.min(field.col ?? (isLayoutField(field.type) ? maxCols : 12), maxCols))
}

function labelPos(field: FieldSchema): string {
  return field.labelPosition || props.schema.settings.labelPosition || 'left'
}

function sizeVal(field: FieldSchema): string {
  return field.size || props.schema.settings.size || 'default'
}
</script>

<style scoped>
.pv-title {
  text-align: center; font-size: 20px; font-weight: 600; color: #303133;
  margin-bottom: 8px; padding-bottom: 16px; border-bottom: 1px solid #ebeef5;
}
.preview-empty { text-align: center; padding: 40px; }
.preview-footer { text-align: center; margin-top: 32px; }
</style>
