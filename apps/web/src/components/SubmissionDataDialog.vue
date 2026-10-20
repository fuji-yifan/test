<template>
  <el-dialog
    :model-value="modelValue"
    :title="title"
    width="900px"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div
      v-loading="loading"
      class="data-body"
    >
      <el-empty
        v-if="loadError"
        :description="loadError"
        :image-size="80"
      />
      <template v-else-if="detail">
        <el-descriptions
          :column="3"
          border
          size="small"
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
          <el-descriptions-item label="提交时间">
            {{ formatDate(detail.createdAt) }}
          </el-descriptions-item>
          <el-descriptions-item label="提交表单">
            {{ form?.name || '-' }}
          </el-descriptions-item>
        </el-descriptions>

        <SubmissionFormView
          v-if="schema"
          :schema="schema"
          :data="detail.data"
        />
        <!-- 表单已被删除/回收时 schema 取不到，退回原始键值 -->
        <template v-else>
          <el-alert
            type="warning"
            :closable="false"
            show-icon
            title="原表单已不存在，以下是提交时的原始数据"
          />
          <pre class="raw-data">{{ JSON.stringify(detail.data, null, 2) }}</pre>
        </template>
      </template>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import http from '@/api/client'
import type { FormSchema } from '@furmx/sdk'
import SubmissionFormView from '@/components/SubmissionFormView.vue'

const props = defineProps<{
  modelValue: boolean
  /** 流程实例 id —— 后端按「发起人本人 / 该实例上有任务的人」授权 */
  instanceId: string
}>()
const emit = defineEmits<{ 'update:modelValue': [v: boolean] }>()

const loading = ref(false)
const detail = ref<any>(null)
const form = ref<{ id: string; name: string; schema: FormSchema } | null>(null)
const loadError = ref('')

const schema = computed(() => form.value?.schema?.fields ? form.value.schema : null)
const title = computed(() => (form.value?.name ? `表单数据：${form.value.name}` : '表单数据'))

watch(() => props.modelValue, (open) => { if (open) load() })

async function load() {
  loading.value = true
  loadError.value = ''
  detail.value = null
  form.value = null
  try {
    const res = await http.get(`/process-instances/${props.instanceId}/submission`) as any
    const data = res.data || res
    detail.value = data.submission
    form.value = data.form
  } catch (e: any) {
    if (e?.__handled) return
    loadError.value = e?.response?.data?.message || '表单数据加载失败'
  } finally { loading.value = false }
}

function formatDate(d: string) { return d ? new Date(d).toLocaleString('zh-CN') : '-' }
</script>

<style scoped>
/* 弹窗高度不要被长表单顶破：内容区内滚动，标题栏留出固定位置 */
.data-body { max-height: 62vh; overflow-y: auto; }
.info-table { max-width: 800px; margin: 0 auto 20px; }
.raw-data { background: #f5f5f7; padding: 12px; border-radius: 4px; font-size: 12px; max-height: 40vh; overflow: auto; }
html.dark .raw-data { background: #0f172a; }
</style>
