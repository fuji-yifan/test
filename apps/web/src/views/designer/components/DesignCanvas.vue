<template>
  <div class="canvas-outer">
    <div
      ref="canvasRef"
      class="design-canvas"
      :style="canvasStyle"
      :class="{ 'show-grid': store.showGrid, 'is-dragover': isDragging }"
      @dragover.prevent="onDragOver"
      @dragleave="onDragLeave"
      @drop.prevent="onDrop"
    >
      <div
        v-if="store.schema.settings.formTitle"
        class="canvas-title"
      >
        {{ store.schema.settings.formTitle }}
      </div>
      <div
        v-if="store.schema.fields.length === 0 && !isDragging"
        class="canvas-empty"
        @dragover.prevent
        @drop.prevent
      >
        <el-empty
          description="从左侧拖入控件开始搭建表单"
          :image-size="120"
        />
      </div>
      <div
        v-else
        class="canvas-fields"
        :style="gridStyle"
        @dragover.prevent
        @drop.prevent
      >
        <template
          v-for="item in displayList"
          :key="item._key"
        >
          <div
            v-if="item._indicator"
            class="drop-placeholder"
            :style="{ gridColumn: `span ${indicatorCol}` }"
          >
            <div class="drop-placeholder-inner" />
          </div>
          <CanvasField
            v-else
            :field="item.field"
            :parent-id="null"
            :depth="0"
          />
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useDesignerStore } from '../stores/designer'
import { getMinCol, getDefaultCol } from '@furmx/sdk'
import CanvasField from './CanvasField.vue'
import type { FieldSchema } from '@furmx/sdk'

const store = useDesignerStore()
const canvasRef = ref<HTMLElement>()

// ==================== 拖入插入逻辑 ====================

/** 当前是否有拖拽悬停（面板拖入 或 画布内重排） */
const isDragging = computed(() => store.dragComponentType !== null || store.dragSourceFieldId !== null)
const dropIndex = ref<number | null>(null)
const indicatorCol = computed(() => {
  if (store.dragSourceFieldId) {
    const f = store.schema.fields.find(f => f.id === store.dragSourceFieldId)
    return f?.col || 12
  }
  const t = store.dragComponentType
  if (!t) return 8
  return Math.max(getMinCol(t), getDefaultCol(t))
})

/** 每列像素（基准：800px / 24 列） */
const COL_PX = 800 / 24

/** 画布宽度 = 列数 × 每列像素，最小高度 = 用户设定值（0 = 自适应） */
const canvasStyle = computed(() => {
  const cols = store.schema.settings.canvasCols || 24
  const h = store.schema.settings.canvasHeight || 0
  return {
    width: `${Math.round(cols * COL_PX)}px`,
    ...(h > 0 ? { minHeight: `${h}px` } : {}),
  }
})

/** Grid 列模板 */
const gridStyle = computed(() => ({
  gridTemplateColumns: `repeat(${store.schema.settings.canvasCols || 24}, 1fr)`,
}))

type DisplayItem =
  | { _key: string; _indicator: true }
  | { _key: string; _indicator: false; field: FieldSchema }

/** 在字段列表中插入虚线占位标记，CSS Grid 按顺序自动渲染到正确位置 */
const displayList = computed<DisplayItem[]>(() => {
  const fields = store.schema.fields
  if (dropIndex.value === null) {
    return fields.map(f => ({ _key: f.id, _indicator: false as const, field: f }))
  }
  const idx = Math.min(dropIndex.value, fields.length)
  const list: DisplayItem[] = fields.map(f => ({ _key: f.id, _indicator: false as const, field: f }))
  list.splice(idx, 0, { _key: '__drop__', _indicator: true as const })
  return list
})

// ==================== 行感知插入算法 ====================

interface RowSlot {
  index: number      // 对应字段数组索引
  left: number       // 相对画布 X
  right: number      // 相对画布 X
}

interface RowBand {
  top: number        // 相对画布 Y
  bottom: number
  slots: RowSlot[]
}

/** 将已渲染字段元素按自然行分组（同一行 = top 差 ≤ 5px）*/
function groupIntoRows(canvasRect: DOMRect): RowBand[] {
  const fieldsEl = canvasRef.value!.querySelector('.canvas-fields')
  if (!fieldsEl) return []

  const nodes = fieldsEl.querySelectorAll(':scope > .canvas-field')
  const rows: RowBand[] = []

  nodes.forEach((el, i) => {
    const r = el.getBoundingClientRect()
    const top = r.top - canvasRect.top
    const bottom = r.bottom - canvasRect.top
    const left = r.left - canvasRect.left
    const right = r.right - canvasRect.left

    let row = rows.find(rr => Math.abs(rr.top - top) < 6)
    if (!row) { row = { top, bottom, slots: [] }; rows.push(row) }
    row.bottom = Math.max(row.bottom, bottom)
    row.slots.push({ index: i, left, right })
  })

  rows.forEach(r => r.slots.sort((a, b) => a.left - b.left))
  rows.sort((a, b) => a.top - b.top)
  return rows
}

/**
 * 行内：根据鼠标 X 坐标决定插在哪个控件的前/后
 */
function resolveIndexInRow(row: RowBand, mx: number): number {
  const ss = row.slots
  if (mx < ss[0].left) return ss[0].index

  for (let si = 0; si < ss.length; si++) {
    // 鼠标在当前 slot 内部 → 按中心点分前/后
    if (mx <= ss[si].right) {
      const mid = (ss[si].left + ss[si].right) / 2
      return mx < mid ? ss[si].index : ss[si].index + 1
    }
    // 鼠标在两个 slot 之间的间隙
    if (si < ss.length - 1 && mx < ss[si + 1].left) {
      return ss[si + 1].index
    }
  }
  // 最右 slot 的右侧
  return ss[ss.length - 1].index + 1
}

/**
 * 根据鼠标在画布内的相对坐标计算插入索引
 *
 * 三种落点区域：
 * ┌──────────────────────────────┐
 * │  Row 0: [A] [B]  [  空隙  ] │  ← 行内：按 X 位置插入
 * ├══════════════════════════════┤
 * │  ▔▔▔ 上半间隙 → 追到行尾    │  ← 追加到上行末尾（同行）
 * │  ▁▁▁ 下半间隙 → 新行行首    │  ← 强制另起一行
 * ├──────────────────────────────┤
 * │  Row 1: [     C     ]       │
 * └──────────────────────────────┘
 */
function calcDropIndex(e: DragEvent): number {
  const fields = store.schema.fields
  if (fields.length === 0) return 0

  const canvasRect = canvasRef.value!.getBoundingClientRect()
  const mx = e.clientX - canvasRect.left
  const my = e.clientY - canvasRect.top

  const rows = groupIntoRows(canvasRect)
  if (rows.length === 0) return fields.length

  // ---- 首行上方 ----
  if (my < rows[0].top) return 0

  for (let ri = 0; ri < rows.length; ri++) {
    const row = rows[ri]

    // ---- 行内 ----
    if (my <= row.bottom) {
      return resolveIndexInRow(row, mx)
    }

    // ---- 行下方 ----
    const nextRow = rows[ri + 1]
    if (!nextRow) {
      // 最后一行下方 → 追加
      return fields.length
    }

    // ---- 行间间隙（有下一行）吸附到更近的行 ----
    if (my < nextRow.top) {
      const gapMid = row.bottom + (nextRow.top - row.bottom) / 2
      if (my < gapMid) {
        return row.slots[row.slots.length - 1].index + 1
      } else {
        return nextRow.slots[0].index
      }
    }
    // my >= nextRow.top → 继续下一轮
  }

  return fields.length
}

// ==================== 事件处理 ====================

function onDragOver(e: DragEvent) {
  if (store.dragComponentType || store.dragSourceFieldId) {
    e.dataTransfer!.dropEffect = store.dragSourceFieldId ? 'move' : 'copy'
    dropIndex.value = calcDropIndex(e)
  }
}

function onDragLeave(e: DragEvent) {
  if (!canvasRef.value!.contains(e.relatedTarget as Node)) {
    dropIndex.value = null
  }
}

function onDrop(e: DragEvent) {
  const raw = e.dataTransfer!.getData('application/furm-component')
  if (!raw) return
  const data = JSON.parse(raw)

  if (data.fieldId) {
    // 手柄拖拽 → 画布内重排
    const fields = store.schema.fields
    const oldIdx = fields.findIndex(f => f.id === data.fieldId)
    if (oldIdx >= 0) {
      let newIdx = dropIndex.value ?? fields.length
      if (newIdx > oldIdx) newIdx--
      if (newIdx !== oldIdx) store.engine.moveField(data.fieldId, null, newIdx)
    }
  } else {
    // 面板拖入新控件
    store.addField(null, dropIndex.value ?? store.schema.fields.length, data.type)
  }

  dropIndex.value = null
}
</script>

<style scoped>
.canvas-outer { position: relative; }

.design-canvas {
  margin: 0 auto;
  background: #fff;
  border-radius: 4px;
  padding: 24px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
  transition: box-shadow 0.2s;
}
.design-canvas.is-dragover {
  box-shadow: 0 0 0 2px #409eff, 0 4px 16px rgba(64,158,255,0.15);
}
.design-canvas.show-grid {
  background-image:
    linear-gradient(rgba(0,0,0,0.04) 1px, transparent 1px),
    linear-gradient(90deg, rgba(0,0,0,0.04) 1px, transparent 1px);
  background-size: 20px 20px;
}
.canvas-title {
  text-align: center;
  font-size: 20px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 24px;
  padding-bottom: 16px;
  border-bottom: 1px solid #ebeef5;
}
.canvas-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 400px;
}

/* 栅格布局（列数由 JS inline style 动态设定） */
.canvas-fields {
  display: grid;
  gap: 12px 16px;
  align-items: start;
}

/* 虚线占位框 */
.drop-placeholder {
  min-height: 52px;
  display: flex;
  align-items: stretch;
  pointer-events: none;
}
.drop-placeholder-inner {
  width: 100%;
  border: 2px dashed #409eff;
  border-radius: 6px;
  background: rgba(64, 158, 255, 0.06);
  animation: drop-pulse 1.2s ease-in-out infinite;
}
@keyframes drop-pulse {
  0%, 100% { border-color: #409eff; background: rgba(64,158,255,0.06); }
  50% { border-color: #66b1ff; background: rgba(64,158,255,0.12); }
}
</style>
