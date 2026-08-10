<template>
  <aside class="panel-left" :style="{ width: leftWidth + 'px' }">
    <h4>审批节点</h4>
    <div class="palette-list">
      <div
        v-for="nt in approvalNodeTypes"
        :key="nt.type"
        class="palette-item"
        draggable="true"
        @dragstart="onDragStart($event, nt.type)"
      >
        <el-icon :size="18" :color="nt.color"><component :is="nt.icon" /></el-icon>
        <span>{{ nt.label }}</span>
      </div>
    </div>
    <h4>处理节点</h4>
    <div class="palette-list">
      <div
        v-for="nt in actionNodeTypes"
        :key="nt.type"
        class="palette-item"
        draggable="true"
        @dragstart="onDragStart($event, nt.type)"
      >
        <el-icon :size="18" :color="nt.color"><component :is="nt.icon" /></el-icon>
        <span>{{ nt.label }}</span>
      </div>
    </div>
    <h4>路由控制</h4>
    <div class="palette-list">
      <div
        v-for="nt in gatewayNodeTypes"
        :key="nt.type"
        class="palette-item"
        draggable="true"
        @dragstart="onDragStart($event, nt.type)"
      >
        <el-icon :size="18" :color="nt.color"><component :is="nt.icon" /></el-icon>
        <span>{{ nt.label }}</span>
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import type { Component } from 'vue'

interface NodeTypeItem {
  type: string
  label: string
  icon: Component
  color: string
}

defineProps<{
  approvalNodeTypes: NodeTypeItem[]
  actionNodeTypes: NodeTypeItem[]
  gatewayNodeTypes: NodeTypeItem[]
  leftWidth: number
}>()

function onDragStart(e: DragEvent, nodeType: string) {
  e.dataTransfer!.effectAllowed = 'copy'
  e.dataTransfer!.setData('application/furmx-node-type', nodeType)
}
</script>

<style scoped>
.panel-left {
  padding: 12px;
  border-right: 1px solid #e4e7ed;
  background: #fff;
  overflow-y: auto;
}
.panel-left h4 {
  margin: 10px 0 6px;
  font-size: 12px;
  color: #909399;
}
.panel-left h4:first-child { margin-top: 0; }
.palette-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.palette-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  cursor: grab;
  font-size: 13px;
  color: #606266;
  background: #fff;
  transition: all 0.2s;
}
.palette-item:hover {
  border-color: #409eff;
  color: #409eff;
  background: #ecf5ff;
}
.palette-item:active { cursor: grabbing; }
</style>
