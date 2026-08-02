<template>
  <div class="preview-page">
    <div class="preview-header">
      <span>预览模式</span>
      <el-button @click="closePreview">关闭预览</el-button>
    </div>
    <div class="preview-body">
      <FormRenderer v-if="schema" :schema="schema" />
      <el-empty v-else description="暂无表单数据" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import type { FormSchema } from '@furmx/sdk'
import { useDesignerStore } from '../stores/designer'

const store = useDesignerStore()
const schema = ref<FormSchema | null>(null)

onMounted(() => {
  schema.value = store.getSchema()
})

function closePreview() { window.close() }
</script>

<style scoped>
.preview-page {
  min-height: 100vh;
  background: #f0f2f5;
}
.preview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 24px;
  background: #fff;
  border-bottom: 1px solid #e4e7ed;
}
.preview-body {
  max-width: 800px;
  margin: 40px auto;
  padding: 32px;
  background: #fff;
  border-radius: 8px;
}
</style>
