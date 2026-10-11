<template>
  <div>
    <h2>数据分析</h2>

    <!-- 统计卡片 -->
    <el-row
      :gutter="16"
      class="stat-row"
    >
      <el-col
        v-for="s in stats"
        :key="s.label"
        :span="6"
      >
        <el-card
          shadow="hover"
          class="stat-card"
        >
          <div class="stat-value">
            {{ s.value }}
          </div>
          <div class="stat-label">
            {{ s.label }}
          </div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 提交趋势图 -->
    <el-card class="chart-card">
      <template #header>
        <span>提交趋势（近30天）</span>
      </template>
      <div style="position:relative">
        <div
          ref="trendChartRef"
          :class="hasTrendData ? 'chart-box' : 'chart-box-sm'"
        />
        <div
          v-if="!hasTrendData"
          class="chart-empty"
        >
          <el-empty description="暂无提交数据" :image-size="80" />
        </div>
      </div>
    </el-card>

    <!-- 表单排名 + 状态分布 -->
    <el-row
      :gutter="16"
      class="bottom-row"
    >
      <el-col :span="14">
        <el-card>
          <template #header>
            <span>表单提交排名 TOP 10</span>
          </template>
          <div style="position:relative">
            <div
              ref="rankChartRef"
              :class="hasRankData ? 'chart-box' : 'chart-box-sm'"
            />
            <div
              v-if="!hasRankData"
              class="chart-empty"
            >
              <el-empty description="暂无排名数据" :image-size="80" />
            </div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="10">
        <el-card>
          <template #header>
            <span>表单状态分布</span>
          </template>
          <div style="position:relative">
            <div
              ref="pieChartRef"
              :class="hasPieData ? 'chart-box' : 'chart-box-sm'"
            />
            <div
              v-if="!hasPieData"
              class="chart-empty"
            >
              <el-empty description="暂无表单数据" :image-size="80" />
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick, onBeforeUnmount, watch } from 'vue'
import { useRoute } from 'vue-router'
import * as echarts from 'echarts'
import http from '@/api/client'
import type { TrendItem, FormRankingItem, StatusPieItem } from '@/types/models'

const route = useRoute()
const wsId = computed(() => route.params.wsId as string)

const stats = ref([
  { label: '表单总数', value: 0 },
  { label: '总提交数', value: 0 },
  { label: '本月新增', value: 0 },
  { label: '待办任务', value: 0 },
])

const trendChartRef = ref<HTMLElement | null>(null)
const rankChartRef = ref<HTMLElement | null>(null)
const pieChartRef = ref<HTMLElement | null>(null)

let trendChart: echarts.ECharts | null = null
let rankChart: echarts.ECharts | null = null
let pieChart: echarts.ECharts | null = null

const hasTrendData = ref(false)
const hasRankData = ref(false)
const hasPieData = ref(false)

async function fetchOverview() {
  try {
    const res = await http.get('/analytics/overview', { params: { workspaceId: wsId.value } })
    const d = (res.data || res) as Record<string, number>
    stats.value[0].value = d.totalForms || 0
    stats.value[1].value = d.totalSubmissions || 0
    stats.value[2].value = d.monthlySubmissions || 0
    stats.value[3].value = d.pendingTasks || 0
  } catch { /* ignore */ }
}

async function fetchTrend() {
  try {
    const res = await http.get('/analytics/submission-trend', {
      params: { workspaceId: wsId.value, days: 30 },
    })
    const data = ((res as { data?: TrendItem[] }).data || res || []) as TrendItem[]
    hasTrendData.value = Array.isArray(data) && data.some((d) => d.count > 0)
    if (trendChart && hasTrendData.value) {
      trendChart.setOption({
        tooltip: { trigger: 'axis' },
        xAxis: { type: 'category', data: data.map((d) => d.date?.substring(5) || d.date) },
        yAxis: { type: 'value', minInterval: 1 },
        series: [{
          name: '提交数', type: 'line', data: data.map((d) => d.count),
          smooth: true, areaStyle: { color: 'rgba(64,158,255,0.15)' },
          itemStyle: { color: '#409eff' },
        }],
        grid: { left: 40, right: 20, top: 20, bottom: 30 },
      })
    }
  } catch { /* ignore */ }
}

async function fetchRanking() {
  try {
    const res = await http.get('/analytics/form-ranking', { params: { workspaceId: wsId.value } })
    const data = ((res as { data?: FormRankingItem[] }).data || res || []) as FormRankingItem[]
    hasRankData.value = Array.isArray(data) && data.some((d) => d.submissionCount > 0)
    if (rankChart && hasRankData.value) {
      rankChart.setOption({
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
        xAxis: { type: 'value', minInterval: 1 },
        yAxis: {
          type: 'category',
          data: data.map((d) => d.name).reverse(),
          axisLabel: { width: 100, overflow: 'truncate' },
        },
        series: [{
          name: '提交数', type: 'bar',
          data: data.map((d) => d.submissionCount).reverse(),
          itemStyle: { color: '#67c23a' },
        }],
        grid: { left: 110, right: 20, top: 10, bottom: 20 },
      })
    }
  } catch { /* ignore */ }
}

async function fetchPie() {
  try {
    const res = await http.get('/analytics/form-status', { params: { workspaceId: wsId.value } })
    const data = ((res as { data?: StatusPieItem[] }).data || res || []) as StatusPieItem[]
    hasPieData.value = Array.isArray(data) && data.some((d) => d.count > 0)
    const labelMap: Record<string, string> = { draft: '草稿', published: '已发布', archived: '已归档' }
    if (pieChart && hasPieData.value) {
      pieChart.setOption({
        tooltip: { trigger: 'item' },
        series: [{
          type: 'pie', radius: ['45%', '70%'],
          center: ['50%', '50%'],
          data: data.map((d) => ({
            name: labelMap[d.status] || d.status,
            value: d.count,
          })),
          label: { show: true, formatter: '{b}: {c}' },
          emphasis: { itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: 'rgba(0, 0, 0, 0.5)' } },
        }],
      })
    }
  } catch { /* ignore */ }
}

onMounted(async () => {
  await fetchOverview()
  await nextTick()
  if (trendChartRef.value) trendChart = echarts.init(trendChartRef.value)
  if (rankChartRef.value) rankChart = echarts.init(rankChartRef.value)
  if (pieChartRef.value) pieChart = echarts.init(pieChartRef.value)
  fetchTrend()
  fetchRanking()
  fetchPie()
})

// 切换工作空间时路由参数变化，但组件实例被复用，需要手动重新拉数据（图表实例无需重建）
watch(wsId, () => {
  fetchOverview()
  fetchTrend()
  fetchRanking()
  fetchPie()
})

onBeforeUnmount(() => {
  trendChart?.dispose()
  rankChart?.dispose()
  pieChart?.dispose()
})
</script>

<style scoped>
h2 { margin: 0 0 16px; }
.stat-row { margin-bottom: 16px; }
.stat-card { text-align: center; cursor: default; }
.stat-value { font-size: 32px; font-weight: 700; color: #303133; }
.stat-label { font-size: 14px; color: #909399; margin-top: 4px; }
.chart-card { margin-bottom: 16px; }
.chart-box { width: 100%; height: 320px; }
.chart-box-sm { width: 100%; height: 200px; }
.chart-empty { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.85); }
.bottom-row { margin-top: 16px; }
</style>
