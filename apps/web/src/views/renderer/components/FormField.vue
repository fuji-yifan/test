<template>
  <div
    class="ff-outer"
    :style="{ gridColumn: `span ${spanCol}` }"
  >
    <div class="ff-inner" :class="[`ff-lp-${labelPos}`, `ff-sz-${sizeVal}`]">
      <label v-if="!isContainer && field.type !== 'tip-text'" class="ff-label">
        {{ field.name.length > 6 ? field.name.slice(0, 6) : field.name }}<span v-if="required" class="ff-req">*</span>
      </label>

      <!-- 布局容器：递归 -->
      <template v-if="isContainer">
        <div v-if="field.children?.length" class="ff-children" :style="childrenStyle">
          <FormField
            v-for="child in field.children"
            :key="child.id"
            :field="child"
            :schema-settings="schemaSettings"
            :model-value="modelValue"
            :max-cols="maxCols"
            @update:model-value="(v) => emit('update:modelValue', v)"
          />
        </div>
        <div v-else class="ff-empty">空容器</div>
      </template>

      <!-- 普通控件 -->
      <slot v-else name="control" :field="field" :size="sizeVal" :value="modelValue">
        <FieldControl
          :field="field"
          :model-value="modelValue"
          :size="sizeVal"
          class="ff-ctrl"
          @update:model-value="(v) => emit('update:modelValue', v)"
        />
      </slot>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { isLayoutField, getMinCol } from '@furmx/sdk'
import type { FieldSchema, FormSettings } from '@furmx/sdk'
import './field-shared.css'
import FieldControl from './FieldControl.vue'

const props = withDefaults(defineProps<{
  field: FieldSchema
  schemaSettings: FormSettings
  modelValue?: any
  maxCols?: number
  required?: boolean
}>(), {
  maxCols: 24,
})

const emit = defineEmits<{ 'update:modelValue': [v: any] }>()

const isContainer = computed(() => isLayoutField(props.field.type))

const labelPos = computed(() => 'left')
const sizeVal = computed(() =>
  props.field.size || props.schemaSettings.size || 'default'
)

/** 栅格跨度 = max(类型最小列宽, 字段 col)，评分/开关固定列宽 */
const spanCol = computed(() => {
  if (props.field.type === 'rate') {
    const labelLen = (props.field.name || '').length
    const stars = props.field.props?.max || 5
    return Math.max(3, Math.ceil(labelLen * 0.4 + stars * 0.75 + 0.8))
  }
  if (props.field.type === 'switch') {
    const labelLen = Math.min((props.field.name || '').length, 6)
    const activeLen = Math.min((props.field.props?.activeText || '').length, 6)
    const inactiveLen = Math.min((props.field.props?.inactiveText || '').length, 6)
    return Math.max(4, Math.ceil((labelLen + activeLen + inactiveLen) * 0.5 + 3))
  }
  const min = getMinCol(props.field.type)
  return Math.max(min, Math.min(props.field.col ?? (isContainer.value ? props.maxCols : 12), props.maxCols))
})

const childrenStyle = computed(() => ({}))
</script>
