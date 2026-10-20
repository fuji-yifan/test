<template>
  <div
    ref="trackRef"
    class="tab-switch"
  >
    <span
      class="tab-switch__indicator"
      :class="{ 'is-ready': ready }"
      :style="indicatorStyle"
      aria-hidden="true"
    />
    <button
      v-for="opt in options"
      :key="opt.value"
      ref="itemRefs"
      type="button"
      class="tab-switch__item"
      :class="{ 'is-active': modelValue === opt.value }"
      :aria-pressed="modelValue === opt.value"
      @click="select(opt.value)"
    >
      {{ opt.label }}<span
        v-if="opt.count !== undefined"
        class="tab-count"
      >{{ opt.count }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'

export interface TabSwitchOption {
  value: string
  label: string
  /** 可选的角标数字；不传则不显示角标 */
  count?: number
}

const props = defineProps<{
  modelValue: string
  options: TabSwitchOption[]
}>()
const emit = defineEmits<{
  'update:modelValue': [string]
  change: [string]
}>()

const trackRef = ref<HTMLElement>()
const itemRefs = ref<HTMLButtonElement[]>([])
const ready = ref(false)
const indicatorStyle = ref({ width: '0px', transform: 'translateX(0px)' })
let resizeObserver: ResizeObserver | undefined

/** 滑块按当前页签实测宽度/偏移移动（角标位数变化时也能贴合） */
function updateIndicator() {
  const idx = props.options.findIndex(o => o.value === props.modelValue)
  const el = itemRefs.value[idx]
  if (!el) return
  indicatorStyle.value = {
    width: `${el.offsetWidth}px`,
    transform: `translateX(${el.offsetLeft}px)`,
  }
  ready.value = true
}

function select(value: string) {
  if (value === props.modelValue) return
  emit('update:modelValue', value)
  emit('change', value)
}

watch(
  [() => props.modelValue, () => props.options.map(o => o.count).join('|')],
  () => { nextTick(updateIndicator) },
)

onMounted(() => {
  nextTick(updateIndicator)
  if (trackRef.value && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(updateIndicator)
    resizeObserver.observe(trackRef.value)
  }
  window.addEventListener('resize', updateIndicator)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  window.removeEventListener('resize', updateIndicator)
})
</script>

<style scoped>
/* 分段式页签：浅灰轨道 + 白色滑块，选中项文字用主题色 */
.tab-switch {
  position: relative;
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  border-radius: 8px;
  background: var(--el-fill-color-light, #f5f7fa);
}
.tab-switch__indicator {
  position: absolute;
  top: 3px;
  bottom: 3px;
  left: 0;
  z-index: 0;
  border-radius: 6px;
  background: var(--el-bg-color, #fff);
  box-shadow: 0 1px 3px rgba(0, 0, 0, .1);
  pointer-events: none;
}
.tab-switch__indicator.is-ready {
  transition: transform .22s cubic-bezier(.4, 0, .2, 1), width .22s cubic-bezier(.4, 0, .2, 1);
}
.tab-switch__item {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 14px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--el-text-color-regular, #606266);
  font-size: 14px;
  font-weight: 500;
  line-height: 20px;
  cursor: pointer;
  transition: color .15s;
}
.tab-switch__item:hover { color: var(--el-color-primary, #409eff); }
.tab-switch__item.is-active { color: var(--el-color-primary, #409eff); }
.tab-count {
  display: inline-block;
  min-width: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--el-fill-color, #f0f2f5);
  color: var(--el-text-color-secondary, #909399);
  font-size: 12px;
  font-weight: 400;
  line-height: 18px;
  text-align: center;
  transition: background-color .15s, color .15s;
}
.tab-switch__item.is-active .tab-count {
  background: var(--el-color-primary-light-9, #ecf5ff);
  color: var(--el-color-primary, #409eff);
}
@media (prefers-reduced-motion: reduce) {
  .tab-switch__indicator.is-ready { transition: none; }
}
</style>
