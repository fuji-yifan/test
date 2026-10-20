<template>
  <div class="signature-pad">
    <canvas
      ref="canvasRef"
      class="pad-canvas"
      @pointerdown="startDraw"
      @pointermove="moveDraw"
      @pointerup="endDraw"
      @pointerleave="endDraw"
      @pointercancel="endDraw"
    />
    <div class="pad-foot">
      <span class="pad-hint">请在上方区域手写签名</span>
      <el-button
        class="pad-clear"
        size="small"
        @click="clear"
      >
        清除
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'

const props = defineProps<{ modelValue?: string }>()
const emit = defineEmits<{ 'update:modelValue': [string] }>()

const canvasRef = ref<HTMLCanvasElement>()
let ctx: CanvasRenderingContext2D | null = null
let drawing = false
let hasInk = false

function setupCanvas() {
  const canvas = canvasRef.value
  if (!canvas) return
  const rect = canvas.getBoundingClientRect()
  if (!rect.width || !rect.height) return
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.round(rect.width * dpr)
  canvas.height = Math.round(rect.height * dpr)
  ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.scale(dpr, dpr)
  ctx.lineWidth = 2
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = '#303133'
}

/** 画布坐标要按 CSS 尺寸换算（canvas 内部尺寸乘过 dpr） */
function pointOf(e: PointerEvent) {
  const rect = canvasRef.value!.getBoundingClientRect()
  return { x: e.clientX - rect.left, y: e.clientY - rect.top }
}

function startDraw(e: PointerEvent) {
  const canvas = canvasRef.value
  if (!canvas || !ctx) return
  drawing = true
  try { canvas.setPointerCapture(e.pointerId) } catch { /* ignore */ }
  const p = pointOf(e)
  ctx.beginPath()
  ctx.moveTo(p.x, p.y)
}

function moveDraw(e: PointerEvent) {
  if (!drawing || !ctx) return
  const p = pointOf(e)
  ctx.lineTo(p.x, p.y)
  ctx.stroke()
  hasInk = true
}

function endDraw(e: PointerEvent) {
  if (!drawing) return
  drawing = false
  const canvas = canvasRef.value
  if (canvas) {
    try { canvas.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
  }
  if (hasInk && canvas) emit('update:modelValue', canvas.toDataURL('image/png'))
}

function clearCanvas() {
  const canvas = canvasRef.value
  if (!canvas || !ctx) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  hasInk = false
}

function clear() {
  clearCanvas()
  emit('update:modelValue', '')
}

// 父组件重置为 '' 时（重新打开弹窗），同步清空画布
watch(() => props.modelValue, (v) => {
  if (!v && hasInk) clearCanvas()
})

onMounted(() => {
  // 弹窗刚展开时布局可能还没完成，等一帧再取尺寸
  requestAnimationFrame(setupCanvas)
})
</script>

<style scoped>
.signature-pad { width: 100%; }
.pad-canvas {
  display: block;
  width: 100%;
  height: 140px;
  border: 1px dashed var(--app-border-color, #dcdfe6);
  border-radius: 6px;
  background: #fff;
  cursor: crosshair;
  touch-action: none;
}
.pad-foot { display: flex; justify-content: space-between; align-items: center; margin-top: 4px; }
.pad-hint { font-size: 12px; color: var(--app-text-secondary, #909399); }
/* 清除：灰底 + 描边，和画板虚线框区分开，但别抢主按钮的视觉 */
.pad-foot .pad-clear {
  border-color: var(--el-border-color, #dcdfe6);
  background: var(--el-fill-color-light, #f5f7fa);
  color: var(--el-text-color-regular, #606266);
}
.pad-foot .pad-clear:hover {
  border-color: var(--el-border-color-hover, #c0c4cc);
  background: var(--el-fill-color, #f0f2f5);
  color: var(--el-text-color-primary, #303133);
}
</style>
