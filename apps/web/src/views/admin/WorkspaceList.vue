<template>
  <div>
    <h2>工作空间</h2>
    <div class="ws-grid">
      <div
        v-for="ws in list"
        :key="ws.id"
        class="ws-card"
        @click="$router.push(`/workspace/${ws.id}/forms`)"
      >
        <el-avatar
          :size="48"
          icon="OfficeBuilding"
        />
        <div class="ws-name">
          {{ ws.name }}
        </div>
        <div class="ws-slug">
          {{ ws.slug }}
        </div>
      </div>
    </div>
    <el-empty
      v-if="!list.length"
      description="暂无工作空间"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import http from '@/api/client'
const list = ref<any[]>([])
onMounted(async () => {
  const res = await http.get('/workspaces') as any
  list.value = (res.data || res)?.list || res.data || res || []
})
</script>
<style scoped>
h2 { margin: 0 0 16px; }
.ws-grid { display: flex; gap: 16px; flex-wrap: wrap; }
.ws-card { text-align: center; padding: 24px; border: 1px solid #ebeef5; border-radius: 8px; cursor: pointer; width: 160px; }
.ws-card:hover { box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
.ws-name { font-weight: 600; margin-top: 12px; }
.ws-slug { color: #909399; font-size: 12px; }
</style>
