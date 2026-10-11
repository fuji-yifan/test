<template>
  <div class="ws-home">
    <h2>工作台</h2>
    <div class="stat-cards">
      <div class="stat-card">
        <div class="num">{{ stats.formCount }}</div>
        <div class="label">我的表单</div>
      </div>
      <div class="stat-card">
        <div class="num">{{ stats.submissionCount }}</div>
        <div class="label">本月提交</div>
      </div>
      <div class="stat-card">
        <div class="num">{{ stats.pendingCount }}</div>
        <div class="label">待办任务</div>
      </div>
    </div>

    <el-card class="section">
      <template #header>
        <span>最近表单</span>
      </template>
      <el-table v-if="recentForms.length" :data="recentForms" style="width:100%">
        <el-table-column prop="name" label="表单名称" min-width="150" show-overflow-tooltip align="center" />
        <el-table-column prop="status" label="状态" min-width="100" align="center">
          <template #default="{ row }">
            <el-tag :type="row.status==='published'?'success':'info'" size="small">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="更新时间" min-width="150" align="center">
          <template #default="{ row }">{{ formatDate(row.updatedAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" min-width="150" align="center">
          <template #default="{ row }">
            <el-button size="small" @click="openDesigner(row)">设计</el-button>
            <el-button size="small" @click="viewData(row)">数据</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div v-else class="empty-hint">还没有表单，去创建一个吧</div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, onMounted, computed, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useWorkspaceStore } from '@/stores/workspace'
import http from '@/api/client'

const router = useRouter()
const route = useRoute()
const wsStore = useWorkspaceStore()

const wsId = computed(() => route.params.wsId as string)

const stats = reactive({ formCount: 0, submissionCount: 0, pendingCount: 0 })
const recentForms = ref<any[]>([])

async function load() {
  try {
    const overviewRes = await http.get(`/analytics/overview?workspaceId=${wsId.value}`) as any
    const overview = overviewRes.data || overviewRes
    stats.submissionCount = overview.monthlySubmissions ?? 0
    stats.pendingCount = overview.pendingTasks ?? 0
    stats.formCount = overview.totalForms ?? 0
  } catch { /* ignore */ }

  try {
    const res = await http.get(`/workspaces/${wsId.value}/forms?pageSize=5`) as any
    const data = res.data || res
    recentForms.value = data?.list || []
  } catch { /* ignore */ }
}

onMounted(load)
// 切换工作空间时路由参数变化，但组件实例被复用，需要手动重新拉数据
watch(wsId, load)

function openDesigner(form: any) {
  router.push(`/workspace/${wsId.value}/forms/${form.id}/designer`)
}
function viewData(form: any) {
  router.push(`/workspace/${wsId.value}/forms/${form.id}/data`)
}
function statusLabel(s: string) { return s === 'published' ? '已发布' : s === 'archived' ? '已归档' : '草稿' }
function formatDate(d: string) { return d ? new Date(d).toLocaleString('zh-CN') : '-' }
</script>

<style scoped>
.ws-home h2 { margin: 0 0 16px; }
.stat-cards { display: flex; gap: 16px; margin-bottom: 24px; }
.stat-card { flex: 1; background: #fff; border-radius: 12px; padding: 24px; text-align: center; border: 1px solid #e5e7eb; box-shadow: 0 1px 2px rgba(0,0,0,0.04); transition: transform 0.15s, box-shadow 0.15s; }
.stat-card:hover { transform: translateY(-2px); box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
.stat-card .num { font-size: 32px; font-weight: 700; color: var(--el-color-primary); }
.stat-card .label { font-size: 13px; color: #94a3b8; margin-top: 8px; }
.section { margin-bottom: 16px; }
.empty-hint { color: #94a3b8; text-align: center; padding: 32px 0; }
</style>
