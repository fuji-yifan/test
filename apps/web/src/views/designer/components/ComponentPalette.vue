<template>
  <div class="component-palette">
    <el-input
      v-model="searchText"
      placeholder="搜索控件..."
      size="small"
      clearable
      class="search-input"
    />
    <template
      v-for="group in groupedComponents"
      :key="group.category"
    >
      <div class="category-title">
        {{ group.label }}
      </div>
      <div class="component-list">
        <div
          v-for="comp in group.items"
          :key="comp.type"
          class="component-item"
          draggable="true"
          @dragstart="onDragStart($event, comp)"
          @dragend="onDragEnd"
        >
          <el-icon class="comp-icon">
            <component :is="getIcon(comp.type)" />
          </el-icon>
          <span>{{ comp.display }}</span>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import {
  Edit,
  Document,
  Notification,
  Coin,
  ArrowDown,
  CircleCheck,
  CirclePlus,
  Calendar,
  SwitchButton,
  Star,
  Upload,
  Notebook,
  Connection,
  Open,
} from '@element-plus/icons-vue'
import { builtinComponents } from '../config/component-registry'
import { useDesignerStore } from '../stores/designer'
import type { ComponentMeta } from '@furmx/sdk'

const store = useDesignerStore()
const searchText = ref('')

const categories = [
  { category: 'basic' as const, label: '基础控件' },
  { category: 'advanced' as const, label: '高级控件' },
]

const groupedComponents = computed(() => {
  const search = searchText.value.toLowerCase()
  return categories
    .map(({ category, label }) => {
      let items = builtinComponents.filter((c) => c.category === category)
      if (search) {
        items = items.filter((c) => c.display.includes(search) || c.type.includes(search))
      }
      return { category, label, items }
    })
    .filter((g) => g.items.length > 0)
})

const iconMap: Record<string, any> = {
  'tip-text': Notification,
  input: Edit,
  textarea: Document,
  'input-number': Coin,
  select: ArrowDown,
  radio: CircleCheck,
  checkbox: CirclePlus,
  'date-picker': Calendar,
  switch: SwitchButton,
  rate: Star,
  slider: Open,
  upload: Upload,
  'rich-text': Notebook,
  cascader: Connection,
  'date-range-picker': Calendar,
}
function getIcon(type: string) { return iconMap[type] || CircleCheck }

function onDragStart(e: DragEvent, comp: ComponentMeta) {
  e.dataTransfer!.effectAllowed = 'copy'
  e.dataTransfer!.setData('application/furm-component', JSON.stringify({
    type: comp.type,
    display: comp.display,
    category: comp.category,
  }))
  store.dragComponentType = comp.type
}

function onDragEnd() {
  store.dragComponentType = null
}
</script>

<style scoped>
.component-palette { padding: 10px; }
.search-input { margin-bottom: 10px; }
.category-title {
  font-size: 12px;
  font-weight: 600;
  color: #909399;
  padding: 8px 0 4px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.component-list { display: flex; flex-wrap: wrap; gap: 6px; }
.comp-icon { font-size: 16px; line-height: 1; }
.component-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  /* 响应式宽度：两列自适应 */
  width: calc(50% - 3px);
  min-width: 64px;
  max-width: 80px;
  height: 60px;
  font-size: 11px;
  color: #606266;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  cursor: grab;
  background: #fff;
  gap: 2px;
  transition: all 0.2s;
  user-select: none;
}
.component-item:hover {
  border-color: #409eff;
  color: #409eff;
  box-shadow: 0 2px 6px rgba(64, 158, 255, 0.15);
}
.component-item:active { cursor: grabbing; }
</style>
