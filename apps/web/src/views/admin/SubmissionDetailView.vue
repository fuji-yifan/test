<template>
  <div class="detail-page">
    <div class="page-header">
      <el-button
        text
        @click="$router.back()"
      >
        <el-icon><ArrowLeft /></el-icon> 返回
      </el-button>
      <h2>提交详情</h2>
    </div>

    <div
      v-if="!schema"
      v-loading="loading"
      class="loading-area"
    />

    <template v-else>
      <!-- 提交信息表格 -->
      <el-descriptions
        :column="3"
        border
        class="info-table"
      >
        <el-descriptions-item label="提交人">
          <template v-if="detail.submitter">
            <el-tooltip
              :content="'用户ID：' + detail.submitterId"
              placement="top"
              effect="light"
            >
              <span class="user-link">{{ detail.submitter.nickname || detail.submitter.email }}</span>
            </el-tooltip>
          </template>
          <span v-else>匿名</span>
        </el-descriptions-item>
        <el-descriptions-item label="提交人ID">
          {{ detail.submitterId || '-' }}
        </el-descriptions-item>
        <el-descriptions-item label="提交时间">
          {{ formatDate(detail.createdAt) }}
        </el-descriptions-item>
      </el-descriptions>

      <!-- 表单数据卡片 -->
      <div
        class="form-card"
        :style="{ width: canvasWidth + 'px' }"
      >
        <div
          v-if="schema.settings.formTitle"
          class="form-title"
        >
          {{ schema.settings.formTitle }}
        </div>
        <div
          v-if="!schema.fields?.length"
          class="empty-hint"
        >
          无控件
        </div>
        <div
          v-else
          class="form-fields"
          :style="gridStyle"
        >
          <FormField
            v-for="field in schema.fields"
            :key="field.id"
            :field="field"
            :schema-settings="schema.settings"
            :model-value="detail.data?.[field.key]"
            :max-cols="schema.settings.canvasCols || 24"
            :required="isRequired(field)"
          />
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { ArrowLeft } from '@element-plus/icons-vue'
import http from '@/api/client'
import type { FormSchema, FieldSchema } from '@furmx/sdk'

import FormField from '@/views/renderer/components/FormField.vue'

const route = useRoute()
const formId = route.params.formId as string
const submissionId = route.params.submissionId as string

const detail = ref<any>({})
const schema = ref<FormSchema | null>(null)
const loading = ref(false)

const COL_PX = 800 / 24
const canvasWidth = computed(() => Math.round((schema.value?.settings?.canvasCols || 24) * COL_PX))

const gridStyle = computed(() => ({
  display: 'grid',
  gridTemplateColumns: `repeat(${schema.value?.settings?.canvasCols || 24}, 1fr)`,
  gap: '12px 16px',
  alignItems: 'start' as const,
}))

onMounted(async () => {
  loading.value = true
  try {
    const [subRes, formRes] = await Promise.all([
      http.get(`/forms/${formId}/submissions/${submissionId}`) as any,
      http.get(`/forms/${formId}`) as any,
    ])
    detail.value = subRes.data || subRes
    const form = formRes.data || formRes
    schema.value = form.schema as FormSchema
  } finally { loading.value = false }
})

function isRequired(field: FieldSchema) {
  return (field.rules || []).some((r) => r.type === 'required')
}

function formatDate(d: string) { return d ? new Date(d).toLocaleString('zh-CN') : '-' }
</script>

<style scoped>
.detail-page {
  min-height: 100vh;
  padding: 24px 16px 80px;
  background: var(--app-bg-page);
  display: flex;
  flex-direction: column;
  align-items: center;
}

.page-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
  width: 100%;
  max-width: 800px;
}
.page-header h2 { margin: 0; font-size: 18px; }

.loading-area { max-width: 800px; width: 100%; min-height: 400px; }

/* 提交信息表格 */
.info-table {
  width: 100%;
  max-width: 800px;
  margin-bottom: 24px;
}

/* ---- 表单卡片 ---- */
.form-card {
  background: #fff;
  border-radius: 4px;
  padding: 24px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
  pointer-events: none;
}
.form-title {
  text-align: center;
  font-size: 20px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 24px;
  padding-bottom: 16px;
  border-bottom: 1px solid #ebeef5;
}
.form-fields { display: grid; gap: 12px 16px; align-items: start; }
.empty-hint { text-align: center; padding: 80px 0; color: #909399; }

html.dark .form-card { background: #1e293b; }
html.dark .form-title { color: #e2e8f0; border-bottom-color: #334155; }
html.dark .empty-hint { color: #64748b; }
</style>
