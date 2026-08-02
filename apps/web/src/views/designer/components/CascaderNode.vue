<template>
  <div
    class="cn-node"
    :style="{ marginLeft: depth * 20 + 'px' }"
  >
    <div class="cn-row">
      <el-input
        :model-value="node.label"
        size="small"
        placeholder="选项名"
        style="width: 120px"
        @input="(v) => $emit('update', path, { label: v, value: v })"
      />
      <el-button
        size="small"
        text
        type="primary"
        @click="$emit('add-child', path)"
      >
        +子级
      </el-button>
      <el-button
        size="small"
        text
        type="danger"
        @click="$emit('remove', path)"
      >
        ×
      </el-button>
    </div>
    <template v-if="node.children?.length">
      <CascaderNode
        v-for="(child, i) in node.children"
        :key="i"
        :node="child"
        :index="i"
        :depth="depth + 1"
        :path="[...path, i]"
        @update="(p, v) => $emit('update', p, v)"
        @add-child="(p) => $emit('add-child', p)"
        @remove="(p) => $emit('remove', p)"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  node: { label: string; value: string; children?: any[] }
  index: number
  depth: number
  path: number[]
}>()

defineEmits<{
  update: [path: number[], patch: Record<string, any>]
  'add-child': [path: number[]]
  remove: [path: number[]]
}>()
</script>
