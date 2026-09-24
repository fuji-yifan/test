<template>
  <div class="preview-page">
    <div
      v-if="schema"
      class="preview-content"
    >
      <div class="preview-toolbar">
        <el-tag type="warning">
          预览模式 — 未保存
        </el-tag>
        <span class="toolbar-title">表单预览</span>
        <el-button
          size="small"
          @click="closeWindow"
        >
          关闭
        </el-button>
      </div>

      <!-- 画布式预览：24列栅格 -->
      <div class="preview-canvas">
        <div
          v-if="schema.settings.formTitle"
          class="preview-title"
        >
          {{ schema.settings.formTitle }}
        </div>
        <div class="preview-fields">
          <div
            v-for="field in schema.fields"
            :key="field.id"
            class="preview-field"
            :style="getFieldStyle(field)"
          >
            <el-form-item
              :label="field.name"
              :size="fieldSize(field)"
            >
              <el-upload
                v-if="field.type === 'upload'"
                class="pv-ctrl"
                :accept="field.props?.accept"
                :limit="field.props?.maxCount || 1"
                action="/api/v1/upload"
                :auto-upload="false"
                drag
              >
                <div class="el-upload__text">
                  拖拽文件到此处 或 <em>点击选择文件</em>
                </div>
                <div
                  v-if="uploadHint(field)"
                  class="el-upload__tip"
                >
                  <span v-html="uploadHint(field)" />
                </div>
              </el-upload>
              <component
                :is="resolveControl(field.type)"
                v-else
                v-model="formData[field.key]"
                v-bind="field.props"
              />
            </el-form-item>
          </div>
        </div>
      </div>

      <div class="preview-actions">
        <el-button
          type="primary"
          @click="onSubmit"
        >
          提交（预览）
        </el-button>
      </div>
    </div>
    <div
      v-else
      class="no-schema"
    >
      <el-empty description="没有可预览的表单" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import type { FormSchema, FieldSchema } from '@furmx/sdk'

const schema = ref<FormSchema | null>(null)
const formData = reactive<Record<string, any>>({})

onMounted(() => {
  const raw = localStorage.getItem('__preview_schema')
  if (raw) {
    try {
      schema.value = JSON.parse(raw) as FormSchema
      schema.value.fields.forEach((f) => {
        if (f.key) formData[f.key] = f.defaultValue ?? ''
      })
    } catch { /* */ }
  }
})

function getFieldStyle(field: FieldSchema) {
  return {
    gridColumn: `span ${Math.min(field.col || 12, 24)}`,
  }
}

function fieldSize(field: FieldSchema) {
  return field.size || schema.value?.settings.size || 'default'
}

function resolveControl(type: string): string {
  const map: Record<string, string> = {
    input: 'el-input', textarea: 'el-input', 'input-number': 'el-input-number',
    select: 'el-select', radio: 'el-radio-group', checkbox: 'el-checkbox-group',
    'date-picker': 'el-date-picker', switch: 'el-switch', rate: 'el-rate',
    slider: 'el-slider',
  }
  return map[type] || 'el-input'
}

function uploadHint(field: FieldSchema) {
  const parts: string[] = []
  // field.props 为运行时 JSON 属性包（SDK 类型 Record<string, unknown>），按 any 读取
  const fp: Record<string, any> = field.props
  if (fp.accept) parts.push(`文件格式仅限 ${fp.accept.replace(/,/g, '/')}`)
  if (fp.maxSize) parts.push(`单个文件容量上限为 ${fp.maxSize}MB`)
  return parts.join("<br>")
}

function closeWindow() {
  window.close()
}

function onSubmit() {
  ElMessage.info('预览模式 — 数据不会保存')
}
</script>

<style scoped>
.preview-page { min-height: 100vh; background: #f0f2f5; }
.preview-toolbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 20px; background: #fff; border-bottom: 1px solid #ebeef5;
  position: sticky; top: 0; z-index: 100;
}
.toolbar-title { font-weight: 600; }
.preview-content { padding: 20px 0 60px; }
.preview-canvas {
  max-width: 100%;
  margin: 0 auto;
  background: #fff;
  border-radius: 8px;
  padding: 24px;
  box-shadow: 0 2px 12px rgba(0,0,0,0.06);
}
.preview-title {
  text-align: center;
  font-size: 20px;
  font-weight: 600;
  margin-bottom: 24px;
  padding-bottom: 16px;
  border-bottom: 1px solid #ebeef5;
}
.preview-fields {
  display: grid;
  grid-template-columns: repeat(24, 1fr);
  gap: 12px 16px;
  align-items: start;
}
.preview-field { box-sizing: border-box; min-width: 0; }
.preview-actions { text-align: center; margin-top: 40px; }
.no-schema { display: flex; justify-content: center; padding-top: 100px; }
</style>
