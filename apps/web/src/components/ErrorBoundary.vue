<template>
  <slot v-if="!hasError" />
  <div
    v-else
    class="error-boundary-fallback"
  >
    <div class="error-boundary-content">
      <el-icon :size="40">
        <WarningFilled />
      </el-icon>
      <h3>{{ title || '页面组件加载异常' }}</h3>
      <p class="error-detail">
        {{ message || '当前区域渲染失败，其余功能不受影响' }}
      </p>
      <el-button
        type="primary"
        size="small"
        @click="retry"
      >
        尝试恢复
      </el-button>
      <el-button
        size="small"
        text
        @click="showDetail = !showDetail"
      >
        {{ showDetail ? '收起' : '查看详情' }}
      </el-button>
      <pre
        v-if="showDetail && error"
        class="error-stack"
      >{{ error }}</pre>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onErrorCaptured } from 'vue'
import { WarningFilled } from '@element-plus/icons-vue'

const props = defineProps<{
  title?: string
  message?: string
}>()

const hasError = ref(false)
const error = ref<string | null>(null)
const showDetail = ref(false)

onErrorCaptured((err: unknown, _instance, _info) => {
  hasError.value = true
  error.value = err instanceof Error
    ? `${err.message}\n\n${err.stack || ''}`
    : String(err)
  console.error('[ErrorBoundary]', props.title || 'unnamed', err)
  // 阻止错误继续向上冒泡
  return false
})

function retry() {
  hasError.value = false
  error.value = null
  showDetail.value = false
}
</script>

<style scoped>
.error-boundary-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 200px;
  padding: 32px;
  background: #fafbfc;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
}
.error-boundary-content {
  text-align: center;
  max-width: 420px;
}
.error-boundary-content h3 {
  margin: 12px 0 8px;
  font-size: 16px;
  color: #303133;
}
.error-detail {
  font-size: 13px;
  color: #909399;
  margin: 0 0 16px;
}
.error-stack {
  margin-top: 12px;
  padding: 12px;
  background: #f5f5f5;
  border-radius: 4px;
  font-size: 11px;
  line-height: 1.5;
  text-align: left;
  max-height: 200px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
