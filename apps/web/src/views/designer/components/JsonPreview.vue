<template>
  <div class="json-preview">
    <div class="toolbar">
      <span>JSON Schema 预览</span>
      <el-button
        size="small"
        @click="applyJson"
      >
        应用修改
      </el-button>
    </div>
    <textarea
      v-model="jsonText"
      class="json-editor"
      spellcheck="false"
    />
    <div
      v-if="errorMsg"
      class="json-error"
    >
      {{ errorMsg }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { useDesignerStore } from '../stores/designer'

const store = useDesignerStore()
const jsonText = ref('')
const errorMsg = ref('')

function syncFromStore() {
  jsonText.value = JSON.stringify(store.schema, null, 2)
}

function applyJson() {
  try {
    const parsed = JSON.parse(jsonText.value)
    store.loadSchema(parsed)
    errorMsg.value = ''
  } catch (e: any) {
    errorMsg.value = 'JSON 格式错误: ' + e.message
  }
}

watch(() => store.schema, syncFromStore, { deep: true })
onMounted(syncFromStore)
</script>

<style scoped>
.json-preview { padding: 16px; }
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  font-size: 14px;
  font-weight: 600;
}
.json-editor {
  width: 100%;
  height: calc(100vh - 160px);
  font-family: 'Menlo', 'Consolas', monospace;
  font-size: 12px;
  padding: 12px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  resize: none;
  outline: none;
}
.json-editor:focus { border-color: #409eff; }
.json-error {
  margin-top: 8px;
  color: #f56c6c;
  font-size: 13px;
}
</style>
