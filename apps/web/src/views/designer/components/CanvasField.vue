<template>
  <div
    class="canvas-field"
    :class="{
      'is-selected': isSelected,
      'is-layout': isLayout,
      [`depth-${depth}`]: true,
    }"
    :style="fieldStyle"
    :draggable="isSelected && depth === 0"
    @click.stop="selectField"
    @dragstart.stop="onFieldDragStart"
    @dragend="onFieldDragEnd"
  >
    <div class="field-inner" :class="[`label-${labelPos}`, `size-${formSize}`]">
      <div v-if="field.type !== 'tip-text'" class="field-label">{{ field.name.length > 6 ? field.name.slice(0, 6) : field.name }}<span v-if="isRequired" class="field-required">*</span></div>

      <!-- 布局容器：递归渲染子字段 -->
      <template v-if="isLayout">
        <div v-if="field.children?.length" class="field-children" :class="`layout-${field.type}`" :style="childrenStyle">
          <CanvasField
            v-for="(child, idx) in field.children"
            :key="child.id"
            :field="child"
            :parent-id="field.id"
            :index="idx"
            :depth="depth + 1"
          />
        </div>
        <div
          class="field-drop-zone"
          @dragover.prevent.stop="onChildDragOver"
          @drop.prevent.stop="onChildDrop"
        >
          拖入控件到此处
        </div>
      </template>

      <!-- 普通控件：占位渲染 -->
      <template v-else>
        <div class="field-placeholder">
          <FieldControl :field="field" :model-value="''" :size="formSize" />
        </div>
      </template>
    </div>

    <div v-if="isSelected" class="field-delete" @click.stop="removeField">&times;</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { isLayoutField, getMinCol } from '@furmx/sdk'
import type { FieldSchema } from '@furmx/sdk'
import { useDesignerStore } from '../stores/designer'
import '../../renderer/components/field-shared.css'
import FieldControl from '../../renderer/components/FieldControl.vue'

const props = defineProps<{
  field: FieldSchema
  parentId: string | null
  depth: number
}>()

const store = useDesignerStore()

const isSelected = computed(() => store.selectedFieldId === props.field.id)
const isLayout = computed(() => isLayoutField(props.field.type))
const isRequired = computed(() => props.field.rules?.some((r: any) => r.type === 'required') ?? false)

const labelPos = computed(() => 'left')
const formSize = computed(() =>
  props.field.size || store.schema.settings.size || 'default'
)

const fieldStyle = computed(() => {
  const maxCols = store.schema.settings.canvasCols || 24
  let col: number
  if (props.field.type === 'rate') {
    const labelLen = (props.field.name || '').length
    const stars = props.field.props?.max || 5
    col = Math.max(3, Math.ceil(labelLen * 0.4 + stars * 0.75 + 0.8))
  } else if (props.field.type === 'switch') {
    const labelLen = Math.min((props.field.name || '').length, 6)
    const activeLen = Math.min((props.field.props?.activeText || '').length, 6)
    const inactiveLen = Math.min((props.field.props?.inactiveText || '').length, 6)
    col = Math.max(4, Math.ceil((labelLen + activeLen + inactiveLen) * 0.5 + 3))
  } else {
    const min = getMinCol(props.field.type)
    col = Math.max(min, Math.min(props.field.col ?? (isLayout.value ? maxCols : 12), maxCols))
  }
  return { gridColumn: `span ${col}` }
})

const childrenStyle = computed(() => ({}))

function selectField() { store.selectField(props.field.id) }
function removeField() { store.removeField(props.field.id) }

function onFieldDragStart(e: DragEvent) {
  e.dataTransfer!.effectAllowed = 'move'
  e.dataTransfer!.setData('application/furm-component', JSON.stringify({ fieldId: props.field.id }))
  store.dragSourceFieldId = props.field.id
}
function onFieldDragEnd() { store.dragSourceFieldId = null }

function onChildDragOver(e: DragEvent) { e.stopPropagation(); e.dataTransfer!.dropEffect = 'copy' }
function onChildDrop(e: DragEvent) {
  e.stopPropagation()
  const raw = e.dataTransfer!.getData('application/furm-component')
  if (!raw) return
  const { type } = JSON.parse(raw)
  if (!props.field.children) props.field.children = []
  store.addField(props.field.id, props.field.children!.length, type)
}
</script>

<style scoped>
.canvas-field {
  cursor: default;
  min-width: 0;
  position: relative;
}
.canvas-field.is-selected > .field-inner {
  border: 2px solid #409eff !important;
  box-shadow: 0 2px 8px rgba(64,158,255,0.2);
}
.field-inner {
  cursor: pointer;
  position: relative;
  overflow: visible;
}
.field-inner:hover { border-color: #c0c4cc; }

.field-children {
  padding: 12px;
  background: #fff;
  border-radius: 4px;
  margin-top: 8px;
  min-height: 40px;
}
.field-children.layout-card    { display: flex; flex-wrap: wrap; gap: 8px; }
.field-children.layout-tabs    { border: 1px solid #e4e7ed; border-radius: 4px; padding: 16px 12px; }
.field-drop-zone {
  padding: 16px; border: 2px dashed #dcdfe6; border-radius: 4px;
  text-align: center; color: #909399; font-size: 13px;
}
.field-drop-zone:hover { border-color: #409eff; }

.field-children .canvas-field { width: 100% !important; min-width: 0; }

.field-delete {
  position: absolute; top: -6px; right: -6px;
  width: 18px; height: 18px; line-height: 18px; text-align: center;
  font-size: 14px; color: #fff; background: #f56c6c;
  border-radius: 50%; cursor: pointer; z-index: 5;
}
</style>
