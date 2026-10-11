<script lang="ts">
// 每个实例一套唯一 id，多个图同时挂载时 marker 不会互相覆盖。
// 放模块作用域（而非 script setup 里）才会在多次实例化间累加。
let uidSeq = 0
</script>

<script setup lang="ts">
import { computed } from 'vue'
import { layoutFlow } from '@furmx/sdk'
import { nodeVisual } from './flowNodeVisual'

const props = defineProps<{
  /** agent artifact 的原始 nodes/edges，形状不确定，交给 layoutFlow 归一 */
  nodes?: unknown
  edges?: unknown
}>()

const uid = `flow-preview-${++uidSeq}`
const arrowId = `${uid}-arrowhead`

const layout = computed(() => layoutFlow(props.nodes, props.edges))
const labeledEdges = computed(() => layout.value.edges.filter((e) => e.label))

/** 节点连视觉规格一起备好，模板里就不用反复调 nodeVisual */
const renderNodes = computed(() =>
  layout.value.nodes.map((n) => ({ ...n, v: nodeVisual(n.type) })),
)

/**
 * 预览的是还没发布的定义，没有运行状态可言。InstanceViewer 的 getNodeState
 * 对开始节点恒返回 completed，其余默认 pending —— 这里照同一个口径，
 * 于是画面就是一条「刚发起、还没走到任何审批」的流程。
 */
function stateOf(viewType: string) {
  return viewType === 'start' ? 'completed' : 'pending'
}

function nodeStyle(n: (typeof renderNodes.value)[number]) {
  return {
    left: `${n.x}px`,
    top: `${n.y}px`,
    width: `${n.w}px`,
    height: `${n.h}px`,
    ...(n.v.shape === 'circle' ? { borderRadius: '50%' } : {}),
  }
}
</script>

<template>
  <div class="flow-canvas">
    <div
      class="flow-canvas-inner"
      :style="{ width: `${layout.width}px`, height: `${layout.height}px` }"
    >
      <svg
        class="edges-layer"
        :width="layout.width"
        :height="layout.height"
        :viewBox="`0 0 ${layout.width} ${layout.height}`"
      >
        <defs>
          <!-- SVG 呈现属性必须 camelCase（markerWidth/refX/…）；写成 kebab 会被浏览器忽略，
               箭头退化成默认 3×3、refX/refY=0，于是「看不见箭头」。与设计器保持一致。 -->
          <marker
            :id="arrowId"
            markerWidth="10"
            markerHeight="7"
            refX="10"
            refY="3.5"
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <polygon
              points="0 0, 10 3.5, 0 7"
              fill="#c0c4cc"
            />
          </marker>
        </defs>

        <path
          v-for="e in layout.edges"
          :key="e.id"
          :d="e.d"
          fill="none"
          stroke="#c0c4cc"
          stroke-width="2"
          :marker-end="`url(#${arrowId})`"
        />

        <text
          v-for="e in labeledEdges"
          :key="`label-${e.id}`"
          :x="e.labelX"
          :y="e.labelY"
          fill="#909399"
          font-size="11"
          text-anchor="middle"
        >{{ e.label }}</text>
      </svg>

      <div
        class="nodes-layer"
        :style="{ width: `${layout.width}px`, height: `${layout.height}px` }"
      >
        <div
          v-for="n in renderNodes"
          :key="n.id"
          class="canvas-node"
          :class="[`node-${n.v.viewType}`, `node-state-${stateOf(n.v.viewType)}`]"
          :style="nodeStyle(n)"
        >
          <div class="node-content">
            <el-icon :size="n.v.iconSize">
              <component :is="n.v.icon" />
            </el-icon>
            <span v-if="n.v.shape !== 'circle'">{{ n.label }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/*
 * 以下样式逐条抄自 InstanceViewer.vue 的画布（「流程进度查看」页）。
 * 改动那个页面时请同步这里。
 * 刻意省略的：图例、节点 tooltip、进行中的脉冲点 —— 预览是静态的，
 * 没有运行状态可展示，也不需要额外的节点说明。
 */
.flow-canvas {
  max-height: 62vh;
  overflow: auto;
  background: #f5f6f8;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
}
/* auto 边距而非 flex 居中：内容比容器宽时自动退化为 0，左侧不会被裁掉 */
.flow-canvas-inner {
  position: relative;
  margin: 0 auto;
}
.edges-layer { position: absolute; top: 0; left: 0; pointer-events: none; z-index: 1; }
.nodes-layer { position: relative; z-index: 2; }

.canvas-node {
  position: absolute; background: #fff; border: 2px solid #dcdfe6;
  box-sizing: border-box;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
}
.node-state-completed { border-color: #67c23a; background: #f0f9eb; }
.node-state-pending { border-color: #dcdfe6; background: #fff; }

/* 圆角矩形（审批/抄送/自动处理） */
.canvas-node:not(.node-start):not(.node-end):not(.node-condition):not(.node-parallel):not(.node-join) {
  border-radius: 8px;
}
/* 开始/结束 */
.node-start { border-color: #67c23a; }
.node-end { border-color: #dcdfe6; }
/* 网关：内嵌第二层描边 */
.node-condition, .node-parallel, .node-join { border-radius: 4px; }
.node-condition::before, .node-parallel::before, .node-join::before {
  content: ''; position: absolute; top: 2px; left: 2px; right: 2px; bottom: 2px;
  border: 1px solid currentColor; border-radius: 2px; opacity: 0.3;
}
/* 抄送（agent 的 notify 映射到这里） */
.node-cc { border-style: dashed; }

.node-content { display: flex; align-items: center; gap: 6px; padding: 8px; min-width: 0; }
/* 审批查看里节点名会直接溢出，预览按盒子裁掉更好看 */
.node-content span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
