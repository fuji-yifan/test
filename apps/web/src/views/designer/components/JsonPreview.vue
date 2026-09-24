<template>
  <div class="json-preview">
    <div class="toolbar">
      <span>JSON Schema 预览</span>
      <div class="toolbar-actions">
        <el-button
          size="small"
          @click="downloadJson"
        >
          下载
        </el-button>
        <el-button
          size="small"
          @click="applyJson"
        >
          应用修改
        </el-button>
      </div>
    </div>
    <textarea
      v-model="jsonText"
      class="json-editor"
      spellcheck="false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { ElMessageBox } from 'element-plus'
import type { FormSchema } from '@furmx/sdk'
import { useDesignerStore } from '../stores/designer'

const store = useDesignerStore()
const jsonText = ref('')

function syncFromStore() {
  jsonText.value = JSON.stringify(store.schema, null, 2)
}

/** 校验 JSON 文本，返回解析结果，失败时弹窗并返回 null */
function validateJson(): FormSchema | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText.value)
  } catch (e: unknown) {
    ElMessageBox.alert(
      e instanceof Error ? e.message : String(e),
      'JSON 格式错误',
      { confirmButtonText: '知道了', type: 'error' },
    )
    return null
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    ElMessageBox.alert(
      'Schema 必须是 JSON 对象，不能是数组或基本类型',
      '格式错误',
      { confirmButtonText: '知道了', type: 'warning' },
    )
    return null
  }
  if (!('fields' in (parsed as Record<string, unknown>))) {
    ElMessageBox.alert(
      'Schema 中缺少必需的 "fields" 数组',
      '格式错误',
      { confirmButtonText: '知道了', type: 'warning' },
    )
    return null
  }
  if (!Array.isArray((parsed as Record<string, unknown>).fields)) {
    ElMessageBox.alert(
      'Schema 中的 "fields" 必须是数组类型',
      '格式错误',
      { confirmButtonText: '知道了', type: 'warning' },
    )
    return null
  }

  // 边界处结构已做必要校验（对象 + fields 数组），其余字段由 store/schema 消费
  return parsed as FormSchema
}

function applyJson() {
  const parsed = validateJson()
  if (parsed) store.loadSchema(parsed)
}

function downloadJson() {
  const parsed = validateJson()
  if (!parsed) return
  const blob = new Blob([JSON.stringify(parsed, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `schema_${store.schema.id || 'export'}.json`
  a.click()
  URL.revokeObjectURL(url)
}

watch(() => store.schema, syncFromStore, { deep: true })
onMounted(syncFromStore)
</script>

<style scoped>
.json-preview { padding: 16px; display: flex; flex-direction: column; height: 100%; }
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  font-size: 14px;
  font-weight: 600;
  flex-shrink: 0;
}
.toolbar-actions { display: flex; gap: 8px; }
.json-editor {
  width: 100%;
  flex: 1;
  font-family: 'Menlo', 'Consolas', monospace;
  font-size: 12px;
  padding: 12px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  resize: none;
  outline: none;
}
.json-editor:focus { border-color: #409eff; }
</style>
