<template>
  <div
    class="instance-viewer"
    :class="{ 'is-embedded': hideHeader }"
  >
    <header
      v-if="!hideHeader"
      class="viewer-header"
    >
      <el-tooltip content="返回" placement="top">
        <el-button
          text
          @click="goBack"
        >
          <el-icon><ArrowLeft /></el-icon>
        </el-button>
      </el-tooltip>
      <h2>{{ instance?.definition?.name || '流程实例' }} — 进度查看</h2>
      <el-tag
        :type="stateTagType"
        size="large"
      >
        {{ stateLabel }}
      </el-tag>
    </header>

    <div
      v-if="instance && nodes.length"
      class="viewer-body"
    >
      <div
        ref="canvasRef"
        class="canvas-area"
      >
        <div
          class="canvas-inner"
          :style="{ width: canvasW + 'px', height: canvasH + 'px' }"
        >
          <svg
            class="edges-layer"
            :view-box="'0 0 ' + canvasW + ' ' + canvasH"
            :width="canvasW"
            :height="canvasH"
          >
            <defs>
              <marker
                id="arrow-gray"
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
              <marker
                id="arrow-green"
                markerWidth="10"
                markerHeight="7"
                refX="10"
                refY="3.5"
                orient="auto"
                markerUnits="userSpaceOnUse"
              >
                <polygon
                  points="0 0, 10 3.5, 0 7"
                  fill="#67c23a"
                />
              </marker>
              <marker
                id="arrow-blue"
                markerWidth="10"
                markerHeight="7"
                refX="10"
                refY="3.5"
                orient="auto"
                markerUnits="userSpaceOnUse"
              >
                <polygon
                  points="0 0, 10 3.5, 0 7"
                  fill="#409eff"
                />
              </marker>
            </defs>
            <path
              v-for="ep in edgePaths"
              :key="ep.id"
              :d="ep.d"
              fill="none"
              :stroke="ep.edgeColor"
              :stroke-width="ep.edgeColor === '#67c23a' ? 2.5 : 2"
              :stroke-dasharray="ep.edgeColor === '#409eff' ? '8 4' : 'none'"
              :marker-end="'url(#' + ep.marker + ')'"
              :class="{ 'edge-active': ep.edgeColor === '#409eff' }"
            />
            <text
              v-for="ep in edgePaths.filter(e => e.label)"
              :key="'t' + ep.id"
              :x="ep.labelX"
              :y="ep.labelY"
              :fill="ep.edgeColor"
              font-size="11"
              text-anchor="middle"
            >{{ ep.label }}</text>
          </svg>

          <div
            class="nodes-layer"
            :style="{ width: canvasW + 'px', height: canvasH + 'px' }"
          >
            <div
              v-for="node in nodes"
              :key="node.id"
              class="canvas-node"
              :class="['node-' + node.type, 'node-state-' + getNodeState(node.id)]"
              :style="nodeStyle(node)"
            >
              <div
                v-if="getNodeState(node.id) === 'active'"
                class="state-badge"
              >
                <span class="pulse-dot" />
              </div>
              <div class="node-content">
                <el-icon :size="nodeIconSize(node.type)">
                  <component :is="nodeIcon(node.type)" />
                </el-icon>
                <span v-if="!isCircle(node.type)">{{ node.name }}</span>
              </div>
              <div
                v-if="getNodeTooltip(node.id)"
                class="node-tooltip"
              >
                {{ getNodeTooltip(node.id) }}
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 图例 -->
      <div class="legend">
        <div class="legend-item">
          <span
            class="dot"
            style="background:#67c23a"
          />已完成
        </div>
        <div class="legend-item">
          <span
            class="dot pulse"
            style="background:#409eff"
          />进行中
        </div>
        <div class="legend-item">
          <span
            class="dot"
            style="background:#dcdfe6"
          />未到达
        </div>
        <div class="legend-item">
          <span
            class="dot"
            style="background:#f56c6c"
          />已驳回
        </div>
      </div>

      <!-- 流程详情（基本信息 + 审批记录）：并入进度视图，不再单独开一个入口 -->
      <aside class="detail-panel">
        <h4>基本信息</h4>
        <el-descriptions
          :column="1"
          border
          size="small"
        >
          <el-descriptions-item label="状态">
            <el-tag
              :type="stateTagType"
              size="small"
            >
              {{ stateLabel }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item
            v-if="instance.initiator"
            label="发起人"
          >
            {{ instance.initiator.nickname || instance.initiator.email }}
          </el-descriptions-item>
          <el-descriptions-item label="发起时间">
            {{ formatDate(instance.createdAt) }}
          </el-descriptions-item>
          <el-descriptions-item label="完成时间">
            {{ formatDate(instance.completedAt) }}
          </el-descriptions-item>
        </el-descriptions>

        <h4>审批记录</h4>
        <el-timeline v-if="instance.tasks?.length">
          <el-timeline-item
            v-for="task in instance.tasks"
            :key="task.id"
            :timestamp="formatDate(task.processedAt || task.createdAt)"
            :color="task.status === 'approved' ? '#67c23a' : task.status === 'rejected' ? '#f56c6c' : '#909399'"
          >
            <div class="task-line">
              <span class="task-node">{{ nodeName(task.nodeId) }}</span>
              <span class="task-sep">——</span>
              <span class="task-assignee">{{ taskAssigneeName(task) }}</span>
              <span class="task-sep">——</span>
              <span
                class="task-status"
                :class="'is-' + task.status"
              >{{ taskStatusName(task.status) }}</span>
            </div>
            <div
              v-if="task.comment"
              class="task-comment"
            >
              <span class="task-comment-label">{{ taskCommentLabel(task.status) }}：</span>{{ task.comment }}
            </div>
            <div
              v-if="taskSignature(task)"
              class="task-signature"
            >
              <img
                :src="taskSignature(task)"
                alt="审批签名"
              >
            </div>
            <div
              v-if="taskAttachments(task).length"
              class="task-attachments"
            >
              附件：
              <a
                v-for="a in taskAttachments(task)"
                :key="a.url"
                :href="a.url"
                target="_blank"
                rel="noopener noreferrer"
              >{{ a.name }}</a>
            </div>
          </el-timeline-item>
        </el-timeline>
        <p
          v-else
          class="empty-hint"
        >
          暂无审批记录
        </p>
      </aside>
    </div>

    <div
      v-else-if="!instance"
      v-loading="true"
      class="loading-hint"
    >
      加载中...
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import {
  ArrowLeft, VideoPlay, VideoPause, User, Avatar,
  Connection, Link, Message, Setting, QuestionFilled, Rank,
} from '@element-plus/icons-vue'
import http from '@/api/client'
import { WorkflowEngine } from '@furmx/sdk'
import type { ProcessNode, ProcessEdge, TaskInstance } from '@furmx/sdk'

interface ProcessInstanceData {
  id: string; definitionId: string; currentState: string; currentNodeIds: string[]
  initiatorId: string; formId?: string; submissionId?: string
  context?: Record<string, any>
  definition: { name: string; nodes?: ProcessNode[]; edges?: ProcessEdge[] }
  tasks?: TaskInstance[]
  initiator?: { id: string; nickname?: string; email: string }
  createdAt: string; updatedAt?: string; completedAt?: string
}

interface TaskAttachment { name: string; url: string; size?: number; mimeType?: string }

/** API 在任务上附带审批人对象与审批签名/附件（SDK 类型未声明这些字段） */
type TaskWithAssignee = TaskInstance & {
  assignee?: { id: string; email: string; nickname?: string }
  signature?: string | null
  attachments?: TaskAttachment[] | null
}

function taskSignature(t: TaskInstance) {
  return (t as TaskWithAssignee).signature || ''
}

function taskAttachments(t: TaskInstance): TaskAttachment[] {
  return (t as TaskWithAssignee).attachments || []
}

const props = defineProps<{
  /** 不传则取路由参数（「流程进度」独立页）；我的流程的「进度」弹窗直接传实例 id */
  instanceId?: string
  /** 嵌入弹窗时隐藏自带的标题栏（返回按钮 + 标题 + 状态标签），由弹窗自己给标题 */
  hideHeader?: boolean
}>()

const route = useRoute()
const router = useRouter()
const currentInstanceId = computed(() => props.instanceId || (route.params.id as string) || '')

const instance = ref<ProcessInstanceData | null>(null)
const nodes = ref<ProcessNode[]>([])
const edges = ref<ProcessEdge[]>([])
const canvasW = ref(1000)
const canvasH = ref(600)

const NODE_W = 180; const NODE_H = 58; const CIRCLE_W = 60; const GW = 150; const GH = 80

function isCircle(t: string) { return t === 'start' || t === 'end' }
function isGateway(t: string) { return ['condition', 'parallel', 'join'].includes(t) }

function nodeStyle(node: ProcessNode) {
  if (isCircle(node.type)) return { left: node.position.x + 'px', top: node.position.y + 'px', width: CIRCLE_W + 'px', height: CIRCLE_W + 'px', borderRadius: '50%' }
  if (isGateway(node.type)) return { left: node.position.x + 'px', top: node.position.y + 'px', width: GW + 'px', height: GH + 'px' }
  return { left: node.position.x + 'px', top: node.position.y + 'px', width: NODE_W + 'px', height: NODE_H + 'px' }
}

function nodeIconSize(t: string) { return isCircle(t) ? 22 : isGateway(t) ? 18 : 16 }

function nodeIcon(t: string) {
  const m: Record<string, any> = {
    start: VideoPlay, end: VideoPause, 'direct-approval': User, 'role-approval': Avatar,
    countersign: Connection, 'or-sign': Link, approval: User, cc: Message, 'auto-task': Setting,
    condition: QuestionFilled, parallel: Rank, join: Connection,
  }
  return m[t] || QuestionFilled
}

const taskMap = computed(() => {
  if (!instance.value) return {}
  const map: Record<string, any[]> = {}
  for (const t of instance.value.tasks || []) {
    if (!map[t.nodeId]) map[t.nodeId] = []
    map[t.nodeId].push(t)
  }
  return map
})

function getNodeState(nodeId: string): string {
  const tasks = taskMap.value[nodeId]
  const node = nodes.value.find((n: ProcessNode) => n.id === nodeId)
  const currentNodeIds: string[] = instance.value?.currentNodeIds || []
  const isCompleted = instance.value?.currentState === 'completed'

  // 开始节点 — 流程已发起即视为已通过
  if (node?.type === 'start') return 'completed'

  // 结束节点 — 流程完成时变绿
  if (node?.type === 'end') return isCompleted ? 'completed' : 'pending'

  // 有任务的节点（审批类）
  if (tasks && tasks.length > 0) {
    const hasRejected = tasks.some((t: TaskInstance) => t.status === 'rejected')
    if (hasRejected) return 'rejected'
    const allApproved = tasks.every((t: TaskInstance) => t.status === 'approved')
    if (allApproved) return 'completed'
    const hasPending = tasks.some((t: TaskInstance) => t.status === 'pending')
    if (hasPending) return 'active'
    return 'completed'
  }

  // 无任务节点：是否在已穿越的路径上
  if (traversedNodeIds.value.has(nodeId)) return 'completed'

  // 当前活跃节点
  if (currentNodeIds.includes(nodeId)) return 'active'

  return 'pending'
}

/** 条件分支用运行时上下文复算，跟引擎当时的选择保持同源 */
const engine = new WorkflowEngine()

/** 计算遍历路径，返回被穿越的节点和边集合 */
function computeTraversal() {
  const nodeSet = new Set<string>()
  const edgeSet = new Set<string>()

  const allTasks = instance.value?.tasks || []
  const currentNodeIds: string[] = instance.value?.currentNodeIds || []
  const context = (instance.value?.context || {}) as Record<string, any>
  const reached = new Set<string>()
  for (const t of allTasks) {
    if (t.status === 'approved' || t.status === 'pending') reached.add(t.nodeId)
  }
  for (const id of currentNodeIds) reached.add(id)

  // 开始节点的 id 不一定是 'start'（设计器/历史模板里可能是 start_1 之类），按类型找
  const startNode = nodes.value.find((n: ProcessNode) => n.type === 'start')
  if (!startNode) return { nodes: nodeSet, edges: edgeSet }

  const visited = new Set<string>()
  function walk(nodeId: string) {
    if (visited.has(nodeId)) return
    visited.add(nodeId)
    nodeSet.add(nodeId)

    const tasks = taskMap.value[nodeId]
    if (tasks && tasks.length > 0) {
      if (!tasks.every((t: TaskInstance) => t.status === 'approved')) return
    }

    const srcNode = nodes.value.find((n: ProcessNode) => n.id === nodeId)
    const outEdges = edges.value.filter((e: ProcessEdge) => e.sourceNodeId === nodeId)

    // 条件分支：已经判过的分支只点亮真正走的那条，别把没走的分支也染绿
    if (srcNode?.type === 'condition') {
      const picked = engine.evaluateConditionEdges(
        outEdges as Array<ProcessEdge & { _isDefault?: boolean }>,
        context,
      )
      if (picked) {
        const chosen = outEdges.find((e: ProcessEdge) => e.targetNodeId === picked)
        if (chosen) {
          edgeSet.add(chosen.id)
          walk(chosen.targetNodeId)
        }
        return
      }
      // 兜底（老实例没有 context / 分支没配默认边）：按「目标已到达」判断
      for (const e of outEdges) {
        const tgtNode = nodes.value.find((n: ProcessNode) => n.id === e.targetNodeId)
        if (tgtNode && (reached.has(e.targetNodeId) || tgtNode.type === 'end')) {
          edgeSet.add(e.id)
          walk(e.targetNodeId)
        }
      }
      return
    }

    for (const e of outEdges) {
      const tgtNode = nodes.value.find((n: ProcessNode) => n.id === e.targetNodeId)
      if (!tgtNode) continue
      edgeSet.add(e.id)
      walk(e.targetNodeId)
    }
  }

  walk(startNode.id)
  return { nodes: nodeSet, edges: edgeSet }
}

const traversal = computed(() => computeTraversal())
const traversedNodeIds = computed(() => traversal.value.nodes)
const traversedEdgeIds = computed(() => traversal.value.edges)

function getNodeTooltip(nodeId: string): string {
  const tasks = taskMap.value[nodeId]
  if (!tasks || tasks.length === 0) return ''
  return tasks.map((t: TaskWithAssignee) => {
    const name = t.assignee?.nickname || t.assignee?.email || t.assigneeId
    const st = { pending: '待处理', approved: '已通过', rejected: '已驳回', transferred: '已转交', withdrawn: '已撤回' }[t.status] || t.status
    return `${name}: ${st}` + (t.comment ? ` (${t.comment})` : '')
  }).join('\n')
}

function formatDate(d?: string) {
  if (!d) return '-'
  return new Date(d).toLocaleString('zh-CN')
}

function nodeName(nodeId: string) {
  return nodes.value.find((n: ProcessNode) => n.id === nodeId)?.name || nodeId
}

function taskAssigneeName(t: TaskInstance) {
  const assignee = (t as TaskWithAssignee).assignee
  return assignee?.nickname || assignee?.email || t.assigneeId
}

/** 驳回时填的是驳回理由，通过/转交等填的是审批意见 */
function taskCommentLabel(status: string) {
  return status === 'rejected' ? '驳回理由' : '审批意见'
}

function taskStatusName(s: string) {
  const m: Record<string, string> = { pending: '待处理', approved: '已通过', rejected: '已驳回', transferred: '已转交', withdrawn: '已撤回' }
  return m[s] || s
}

const edgePaths = computed(() => {
  return edges.value.map((e: ProcessEdge) => {
    const src = nodes.value.find((n: ProcessNode) => n.id === e.sourceNodeId)
    const tgt = nodes.value.find((n: ProcessNode) => n.id === e.targetNodeId)
    if (!src || !tgt) return { id: e.id, d: '', edgeColor: '#c0c4cc', marker: 'arrow-gray', label: e.label || '', labelX: 0, labelY: 0 }

    const srcW = isCircle(src.type) ? CIRCLE_W : isGateway(src.type) ? GW : NODE_W
    const srcH = isCircle(src.type) ? CIRCLE_W : isGateway(src.type) ? GH : NODE_H
    const tgtW = isCircle(tgt.type) ? CIRCLE_W : isGateway(tgt.type) ? GW : NODE_W

    const x1 = src.position.x + srcW / 2; const y1 = src.position.y + srcH
    const x2 = tgt.position.x + tgtW / 2; const y2 = tgt.position.y
    const midY = (y1 + y2) / 2
    const d = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`

    const srcState = getNodeState(e.sourceNodeId)
    let edgeColor = '#c0c4cc'; let marker = 'arrow-gray'

    if (traversedEdgeIds.value.has(e.id)) {
      edgeColor = '#67c23a'; marker = 'arrow-green'
    } else if (srcState === 'active') {
      edgeColor = '#409eff'; marker = 'arrow-blue'
    }

    return { id: e.id, d, edgeColor, marker, label: e.label || '', labelX: (x1 + x2) / 2, labelY: midY - 6 }
  })
})

const stateLabel = computed(() => {
  const s = instance.value?.currentState
  const m: Record<string, string> = { approving: '审批中', completed: '已完成', rejected: '已驳回', withdrawn: '已撤回', timeout: '已超时' }
  return (s && m[s]) || s || ''
})

const stateTagType = computed(() => {
  const s = instance.value?.currentState
  const m: Record<string, string> = { approving: 'warning', completed: 'success', rejected: 'danger', withdrawn: 'info', timeout: 'danger' }
  return (s && m[s]) || 'info'
})

// 用 watch 而不是 onMounted：嵌在弹窗里时组件可能被复用，换一个实例必须重新拉数据
watch(currentInstanceId, async (id) => {
  if (!id) return
  instance.value = null
  nodes.value = []
  edges.value = []
  try {
    const res = await http.get(`/process-instances/${id}`) as any
    const data = res.data || res
    instance.value = data
    const def = data.definition || {}
    nodes.value = (def.nodes || []) as ProcessNode[]
    edges.value = (def.edges || []) as ProcessEdge[]
    // 画布宽度贴着流程本身算（不再固定 1000）：装得下就没有左右滑轮，装不下才滚
    let mx = 320, my = 600
    nodes.value.forEach((n: ProcessNode) => {
      const w = isCircle(n.type) ? CIRCLE_W : isGateway(n.type) ? GW : NODE_W
      const h = isCircle(n.type) ? CIRCLE_W : isGateway(n.type) ? GH : NODE_H
      if (n.position.x + w + 100 > mx) mx = n.position.x + w + 100
      if (n.position.y + h + 100 > my) my = n.position.y + h + 100
    })
    canvasW.value = Math.max(320, mx); canvasH.value = Math.max(600, my)
  } catch (e: unknown) {
    // 错误对象来自 HTTP 客户端，是未类型化的边界
    const err = e as { response?: { data?: { message?: string } }; message?: string }
    ElMessage.error('加载流程实例失败: ' + (err.response?.data?.message || err.message || '未知错误'))
  }
}, { immediate: true })

function goBack() { router.back() }
</script>

<style scoped>
.instance-viewer { display: flex; flex-direction: column; height: calc(100vh - 140px); }
/* 嵌进弹窗时高度交给弹窗分配（.progress-dialog 已把弹窗定高并让 body 占满剩余空间，见 MyProcessesView）：
   这里只管填满，不再自己扣标题栏——推算弹窗占多少像素必然算错，底边会被挤出可视区 */
.instance-viewer.is-embedded { height: 100%; }
.viewer-header { display: flex; align-items: center; gap: 16px; padding-bottom: 12px; border-bottom: 1px solid #e4e7ed; flex-shrink: 0; }
.viewer-header h2 { margin: 0; flex: 1; }
.viewer-body { flex: 1; display: flex; gap: 12px; overflow: hidden; position: relative; margin-top: 12px; }
/* box-sizing 必须写：默认 content-box 时 height:100% 不含上下两条 1px 边框，
   会多出 2px 溢出 viewer-body，被 overflow:hidden 把下边框整条裁掉（上边框看不出来，只有下边缘缺线） */
.canvas-area { box-sizing: border-box; flex: 1; min-width: 0; height: 100%; overflow: auto; background: #f5f6f8; border-radius: 8px; border: 1px solid #e4e7ed; }
/* 画布比容器窄时居中；宽过容器时 auto 边距归零，左边缘不会被顶出可视区（justify-content:center 会） */
.canvas-inner { position: relative; margin: 0 auto; }
.edges-layer { position: absolute; top: 0; left: 0; pointer-events: none; z-index: 1; }
.nodes-layer { position: relative; z-index: 2; }

.canvas-node {
  position: absolute; background: #fff; border: 2px solid #dcdfe6; cursor: default;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  transition: border-color 0.3s, background 0.3s;
}
.node-state-completed { border-color: #67c23a; background: #f0f9eb; }
.node-state-active { border-color: #409eff; background: #ecf5ff; }
.node-state-rejected { border-color: #f56c6c; background: #fef0f0; }
.node-state-pending { border-color: #dcdfe6; background: #fff; }

.canvas-node:not(.node-start):not(.node-end):not(.node-condition):not(.node-parallel):not(.node-join) { border-radius: 8px; }
.node-start { border-color: #67c23a; }
.node-end { border-color: #dcdfe6; }
.node-end.node-state-completed { border-color: #67c23a; }
.node-condition, .node-parallel, .node-join { border-radius: 4px; }
.node-condition::before, .node-parallel::before, .node-join::before {
  content: ''; position: absolute; top: 2px; left: 2px; right: 2px; bottom: 2px;
  border: 1px solid currentColor; border-radius: 2px; opacity: 0.3;
}
.node-cc { border-style: dashed; }
.node-content { display: flex; align-items: center; gap: 6px; padding: 8px; }

.state-badge { position: absolute; top: -6px; right: -6px; z-index: 5; }
.pulse-dot {
  width: 12px; height: 12px; border-radius: 50%; background: #409eff;
  display: block; animation: pulse 1.5s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(64,158,255,0.6); }
  50% { box-shadow: 0 0 0 8px rgba(64,158,255,0); }
}
.node-tooltip { display: none; position: absolute; top: 100%; left: 50%; transform: translateX(-50%); background: #303133; color: #fff; padding: 4px 8px; border-radius: 4px; font-size: 11px; white-space: nowrap; z-index: 10; margin-top: 4px; }
.canvas-node:hover .node-tooltip { display: block; }

.detail-panel { box-sizing: border-box; width: 300px; flex-shrink: 0; overflow: auto; background: #fff; border: 1px solid #e4e7ed; border-radius: 8px; padding: 12px; }
.detail-panel h4 { margin: 0 0 10px; }
.detail-panel h4:not(:first-child) { margin-top: 16px; }
/* Element Plus 的 timeline 是 ul，浏览器默认还有 40px 缩进，加上 wrapper 自身 28px，
   在 300px 宽的侧栏里会白掉一大块；这里把缩进压到贴着面板左缘 */
.detail-panel :deep(.el-timeline) { padding-left: 8px; }
.detail-panel :deep(.el-timeline-item__wrapper) { padding-left: 20px; }
.empty-hint { color: #909399; font-size: 12px; }
/* 审批记录首行：节点 —— 成员 —— 审批状态 */
.task-line {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  color: #303133;
  line-height: 1.6;
}
.task-sep { color: #c0c4cc; }
.task-status { font-weight: 500; }
.task-status.is-approved { color: #67c23a; }
.task-status.is-rejected { color: #f56c6c; }
.task-status.is-pending { color: #909399; }
/* 第二行：驳回理由 / 审批意见 */
.task-comment {
  margin-top: 2px;
  color: #606266;
  font-size: 13px;
  line-height: 1.6;
  word-break: break-word;
}
.task-comment-label { color: #909399; }
.task-signature { margin-top: 6px; }
.task-signature img { max-width: 160px; max-height: 80px; border: 1px solid #e4e7ed; border-radius: 4px; background: #fff; }
.task-attachments { margin-top: 4px; font-size: 12px; color: #606266; }
.task-attachments a { color: var(--el-color-primary); text-decoration: none; margin-right: 8px; }
.task-attachments a:hover { text-decoration: underline; }

.legend { position: absolute; left: 12px; bottom: 12px; display: flex; gap: 16px; background: rgba(255,255,255,0.92); padding: 8px 16px; border-radius: 8px; border: 1px solid #e4e7ed; z-index: 10; font-size: 12px; }
.legend-item { display: flex; align-items: center; gap: 4px; }
.dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
@keyframes legendPulse { 0%,100% { box-shadow: 0 0 0 0 rgba(64,158,255,0.5); } 50% { box-shadow: 0 0 0 6px rgba(64,158,255,0); } }
.dot.pulse { animation: legendPulse 1.5s ease-in-out infinite; }
.loading-hint { height: 200px; }
</style>
