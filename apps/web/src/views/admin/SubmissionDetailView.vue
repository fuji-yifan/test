<template>
  <div class="detail-page">
    <div class="page-header">
      <el-tooltip content="返回" placement="top">
        <el-button
          text
          @click="$router.back()"
        >
          <el-icon><ArrowLeft /></el-icon>
        </el-button>
      </el-tooltip>
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
      <SubmissionFormView
        class="centered"
        :schema="schema"
        :data="detail.data"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { ArrowLeft } from '@element-plus/icons-vue'
import http from '@/api/client'
import type { FormSchema } from '@furmx/sdk'

import SubmissionFormView from '@/components/SubmissionFormView.vue'

const route = useRoute()
const formId = route.params.formId as string
const submissionId = route.params.submissionId as string

const detail = ref<any>({})
const schema = ref<FormSchema | null>(null)
const loading = ref(false)

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

function formatDate(d: string) { return d ? new Date(d).toLocaleString('zh-CN') : '-' }
</script>

<style scoped>
.detail-page { display: contents; }

.page-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  flex-shrink: 0;
}
.page-header h2 { margin: 0; }

/* .content 是 flex column：定宽/带 max-width 的子项在 stretch 到上限后会退化成 flex-start（贴左），
   所以下面三块要显式 align-self: center。.page-header 不设，返回与标题保持贴左。 */
.loading-area { max-width: 800px; width: 100%; min-height: 400px; align-self: center; }
.centered { align-self: center; }

/* 提交信息表格 */
.info-table {
  width: 100%;
  max-width: 800px;
  margin-bottom: 24px;
  align-self: center;
}
</style>
