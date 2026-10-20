<script setup lang="ts">
import { ref, watch, nextTick, computed, markRaw } from 'vue'
import { useAgentChat, type ConfirmOption } from '@/composables/useAgentChat'
import { marked } from 'marked'
import { ElMessageBox } from 'element-plus'
import PreviewPanel from '@/components/PreviewPanel.vue'
import FlowPreviewGraph from '@/components/flow/FlowPreviewGraph.vue'
import {
  DocumentCopy, ScaleToOriginal, Files, PieChart, Close, Coin,
  ArrowDown, ArrowUp, ArrowLeft, Link, ChatSquare, ChatLineSquare, Postcard, ChromeFilled, Top,
} from '@element-plus/icons-vue'

const props = defineProps<{
  visible: boolean
  scenario: string
  workspaceId: string
  getCurrentSchema?: () => Record<string, unknown> | null
}>()

const emit = defineEmits<{
  (e: 'update:visible', v: boolean): void
}>()

const SCENARIO_MAP: Record<string, { icon: any; label: string }> = {
  'form-builder':     { icon: markRaw(DocumentCopy),      label: '表单设计助手' },
  'workflow-node':    { icon: markRaw(Files),             label: '流程编排助手' },
  'template-creator': { icon: markRaw(ScaleToOriginal),   label: '模板市场助手' },
  'data-analysis':    { icon: markRaw(PieChart),          label: '数据分析助手' },
}
const AGENT_LABEL: Record<string, string> = {
  'form-designer': '表单设计助手', 'workflow': '流程编排助手',
  'template': '模板市场助手', 'submission': '数据分析助手', 'hub': '编排中',
}
// 动态显示当前工作的 Agent
const activeAgentLabel = computed(() => {
  if (!status.value) return null
  return AGENT_LABEL[status.value.agent] || status.value.agent
})

// 会话累计用量（阶段 4）：徽标数值 + tooltip 明细；无用量时不显示
const usageTotal = computed(() => (usage.value?.inputTokens || 0) + (usage.value?.outputTokens || 0))
/** 千分位：写死 zh-CN，别跟浏览器 locale 漂（德语环境会变成 1.234） */
function fmtTokens(n: number): string {
  return n.toLocaleString('zh-CN')
}
const usageLabel = computed(() => {
  const u = usage.value
  if (!u || (!u.inputTokens && !u.outputTokens)) return null
  return `会话累计 ≈ ${fmtTokens(usageTotal.value)} tokens（输入 ${fmtTokens(u.inputTokens)} / 输出 ${fmtTokens(u.outputTokens)}）`
})
/** 单条回答的 token 数（消息行小字用） */
function msgTokens(u?: { inputTokens: number; outputTokens: number }): number {
  return (u?.inputTokens || 0) + (u?.outputTokens || 0)
}

const inputText = ref('')
const messagesEl = ref<HTMLDivElement>()
const showHistory = ref(false)

// ===== 浮窗拖拽：拖动后改用 left/top 定位，重新打开时清空回默认位置 =====
const windowEl = ref<HTMLElement>()
const dragging = ref(false)
/** null = 未拖动，沿用 CSS 的 right/bottom 默认位置 */
const dragPos = ref<{ left: number; top: number } | null>(null)
const DRAG_MARGIN = 8

const dragStyle = computed(() =>
  dragPos.value
    ? { left: `${dragPos.value.left}px`, top: `${dragPos.value.top}px`, right: 'auto', bottom: 'auto' }
    : undefined,
)

function resetWindowPosition() {
  dragging.value = false
  dragPos.value = null
}

function startDrag(e: PointerEvent) {
  if (e.button !== 0 || !windowEl.value) return
  // 头部里的按钮/链接仍然保持点击行为，不触发拖拽
  if ((e.target as HTMLElement).closest('button, a, input')) return

  const rect = windowEl.value.getBoundingClientRect()
  const startX = e.clientX
  const startY = e.clientY
  const maxLeft = () => Math.max(DRAG_MARGIN, window.innerWidth - rect.width - DRAG_MARGIN)
  const maxTop = () => Math.max(DRAG_MARGIN, window.innerHeight - rect.height - DRAG_MARGIN)
  const clamp = (v: number, max: number) => Math.min(Math.max(DRAG_MARGIN, v), max)

  dragging.value = true
  dragPos.value = { left: rect.left, top: rect.top }

  const onMove = (ev: PointerEvent) => {
    dragPos.value = {
      left: clamp(rect.left + ev.clientX - startX, maxLeft()),
      top: clamp(rect.top + ev.clientY - startY, maxTop()),
    }
  }
  const onUp = () => {
    dragging.value = false
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onUp)
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onUp)
}

const expandedTools = ref<Record<string, boolean>>({})
const expandedPreview = ref<Record<string, boolean>>({})

// 表单预览弹窗：卡片本身只显示一行摘要，真实渲染放到弹窗里（和模板市场一致）
const previewVisible = ref(false)
const previewSchema = ref<any>(null)
/** 弹窗标题：调用方给了就用（如模板名，模板 schema 不一定有 formTitle），否则退回 schema 里的标题 */
const previewTitle = ref('表单结构')
/**
 * PreviewPanel 的 key：每次打开自增，逼出全新实例。
 * 该组件的画布几何在 setup 时按 schema 算一次、不随 prop 变，复用同一实例连续看不同表单会留下上一张的排版。
 * 不能用 schema 对象当 key——对象转字符串都是 "[object Object]"，等于没有 key。
 */
const previewSeq = ref(0)
// 入参可以是整条 message（result.schema）、多表清单里的一个 entry（schema），或一张模板（自带 name）
function openFormPreview(payload: any, title?: string) {
  const schema = payload?.schema ?? payload?.result?.schema
  if (!schema) return
  previewSchema.value = schema
  previewTitle.value = title || schema.settings?.formTitle || '表单结构'
  previewSeq.value++
  previewVisible.value = true
}

// 流程预览弹窗：卡片只显示一行摘要，真实分层图放到弹窗里（和表单预览一致）
const flowPreviewVisible = ref(false)
const flowPreview = ref<Record<string, unknown> | null>(null)
function openFlowPreview(result: unknown) {
  // result 是 SSE 传来的未类型化 JSON，这里只确认它是带节点的流程 artifact
  const artifact = result as Record<string, unknown> | null
  if (!Array.isArray(artifact?.nodes) || artifact.nodes.length === 0) return
  flowPreview.value = artifact
  flowPreviewVisible.value = true
}

/** 表单预览条目归一：多表走 forms[]，单表就是 result 本身 */
function formEntries(result: any): any[] {
  if (!result) return []
  return result.forms?.length ? result.forms : [result]
}

/** 结果里是否有可展示的预览内容——没有就整块不渲染，避免出现点开是空的「预览卡片」 */
function hasPreview(msg: any): boolean {
  const r = msg?.result
  if (!r) return false
  return !!(r.schema || r.templates?.length || r.nodes?.length || r.decision || r.insights || r.stats)
}

// 历史对话
interface ChatThread { id: string; title: string; scenario: string; messageCount: number; updatedAt: number }
const THREADS_KEY = 'agent_chat_threads'
const MSG_PREFIX = 'agent_chat_msgs_'
const threads = ref<ChatThread[]>([])

function loadThreads() {
  try { threads.value = JSON.parse(localStorage.getItem(THREADS_KEY) || '[]') } catch { threads.value = [] }
}
function saveThread(title: string) {
  loadThreads()
  const id = title || `thread_${Date.now()}`
  const idx = threads.value.findIndex((t) => t.id === id)
  const thread: ChatThread = { id, title: title || '(空)', scenario: props.scenario, messageCount: messages.value.length, updatedAt: Date.now() }
  if (idx >= 0) threads.value[idx] = thread
  else threads.value.unshift(thread)
  if (threads.value.length > 20) threads.value = threads.value.slice(0, 20)
  localStorage.setItem(THREADS_KEY, JSON.stringify(threads.value))
  if (messages.value.length > 0) localStorage.setItem(MSG_PREFIX + id, JSON.stringify(messages.value.slice(-50)))
}
async function deleteThread(id: string) {
  const t = threads.value.find((x) => x.id === id)
  try {
    await ElMessageBox.confirm(
      `确定删除对话「${(t?.title || '(空)').slice(0, 40)}」吗？删除后无法恢复。`,
      '删除对话',
      {
        type: 'warning',
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        // 浮窗 z-index 是 3000，MessageBox 默认层级会被整个盖住
        modalClass: 'chat-confirm-overlay',
      },
    )
  } catch {
    return // 用户取消
  }
  threads.value = threads.value.filter((x) => x.id !== id)
  localStorage.setItem(THREADS_KEY, JSON.stringify(threads.value))
  localStorage.removeItem(MSG_PREFIX + id)
}
function restoreThread(t: ChatThread) {
  showHistory.value = false
  nextTick(() => {
    try {
      let raw = localStorage.getItem(MSG_PREFIX + t.id)
      if (!raw) raw = localStorage.getItem(`agent_chat_${t.scenario}`)
      if (raw) messages.value = JSON.parse(raw) || []
      // 历史快照里的检查点卡片同样要用服务端待答状态校正，避免恢复出已答过的按钮
      void reconcilePendingConfirms()
    } catch { /* */ }
  })
}
loadThreads()

const { messages, isLoading, status, error, usage, sendMessage, cancel, clearMessages, activeMessageId, reconcilePendingConfirms } = useAgentChat({
  // 传取值函数而不是值：这两个 prop 随路由变化，而这个组合式只在 setup 时调一次，
  // 传值会把首次渲染（往往还没进工作空间路由）的空值定格住，之后一直发空 workspaceId。
  scenario: () => props.scenario,
  workspaceId: () => props.workspaceId,
})

/**
 * 人机协作检查点的选项。正常由后端下发 options（含「保存」这类自定义文案）；
 * 后端没带时回退成确认/取消。
 */
function confirmOptions(tc: any): ConfirmOption[] {
  if (tc.options?.length) return tc.options
  return [
    { value: 'continue', label: '确认', style: 'primary' },
    { value: 'abort', label: '取消', style: 'danger' },
  ]
}

function answerConfirm(tc: any, option: ConfirmOption) {
  // 回执复用 /agent/chat；message 只作聊天记录展示，后端以 confirmAction 为准
  sendMessage(option.label, tc.callId, undefined, option.value)
}

// 工具等级只有 low/medium/high 三档在用（critical 在类型里保留、暂无工具取到）。
// 文案用「较低/中等/较高」：说「低/中/高」容易被读成「这个调用有问题」，这里是系数不是结论。
const RISK_LABEL: Record<string, string> = {
  low: '较低',
  medium: '中等',
  high: '较高',
  critical: '极高',
}
function riskLabel(risk?: string): string {
  return risk ? RISK_LABEL[risk] || risk : ''
}

function handleSend() {
  if (!inputText.value.trim()) return
  const text = inputText.value
  sendMessage(text, undefined, props.scenario)
  inputText.value = ''
  if (messages.value.length <= 1) saveThread(text)
}
function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
}
function newChat() {
  const first = messages.value.find((m: any) => m.role === 'user')
  if (first) saveThread(first.content)
  clearMessages()
  showHistory.value = false
}
function handleClose() { emit('update:visible', false) }

/**
 * 手动开合的覆盖键：把「这条消息」细到「这条消息 + 待答复的检查点」。
 *
 * 一轮里可能出多个检查点，若覆盖只按 msg.id 记，用户对第一个检查点做过一次开合后，
 * 覆盖会一直留着，后面新冒出的检查点就不再走「待答复即默认展开」，表现为「检查点
 * 来了列表还是收起的」。按待答复的 callId 组合做键，新检查点就是新键 → 重新按默认
 * 走；答完（confirming 消失）键又变回空集 → 回到默认收起。
 */
function expandedKey(msg: any): string {
  const confirming = (msg.toolCalls || [])
    .filter((t: any) => t.status === 'confirming')
    .map((t: any) => t.callId)
    .join(',')
  return `${msg.id}|${confirming}`
}

/**
 * 工具调用列表的开合：默认跟随「有没有待答复的检查点」——待答复时摊开，让用户直接
 * 看到即将执行的是哪个工具、什么风险；做出选择后自动收起。手动点过就完全交给用户。
 *
 * 检查点卡片本身只讲「现在是什么状态、下方有什么」（不点工具名），工具身份就落在
 * 这里这颗 chip 上，所以它必须默认展开。
 */
function isToolsOpen(msg: any): boolean {
  const manual = expandedTools.value[expandedKey(msg)]
  if (manual !== undefined) return manual
  return (msg.toolCalls || []).some((t: any) => t.status === 'confirming')
}
function toggleTools(msg: any) { expandedTools.value[expandedKey(msg)] = !isToolsOpen(msg) }

/**
 * 预览卡片的开合：默认跟随「有没有待答复的检查点」——待答复时摊开给你看依据，
 * 做出选择后自动收起。用户手动点过就完全交给用户（undefined 表示还没碰过）。
 */
function isPreviewOpen(msg: any): boolean {
  const manual = expandedPreview.value[expandedKey(msg)]
  if (manual !== undefined) return manual
  return (msg.toolCalls || []).some((t: any) => t.status === 'confirming')
}
function togglePreview(msg: any) { expandedPreview.value[expandedKey(msg)] = !isPreviewOpen(msg) }

function fmtTime(ts: number): string {
  const d = new Date(ts), now = Date.now(), diff = now - ts
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}
function renderMarkdown(text: string): string {
  try { return marked.parse(text, { async: false }) as string }
  catch { return text.replace(/\n/g, '<br>') }
}
watch(() => props.visible, (v) => {
  // 每次开/关都归位，避免下次打开停在上次的拖动位置
  resetWindowPosition()
  if (v) loadThreads()
})
watch(() => messages.value.length, () => nextTick(() => { if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight }))
watch(() => isLoading.value, (l, was) => {
  if (was && !l && messages.value.length > 0) {
    const first = messages.value.find((m: any) => m.role === 'user')?.content || ''
    if (first) localStorage.setItem(MSG_PREFIX + first, JSON.stringify(messages.value.slice(-50)))
  }
})
</script>

<template>
  <Teleport to="body">
    <transition name="float-fade">
      <div
        v-if="visible"
        ref="windowEl"
        class="float-window"
        :class="{ dragging }"
        :style="dragStyle"
      >
        <!-- 头部：按住空白处可拖动整个浮窗 -->
        <div class="float-header" @pointerdown="startDrag">
          <div class="float-header-left">
            <div class="header-avatar">
              <el-icon :size="20"><ChromeFilled /></el-icon>
            </div>
            <span class="float-title brand-flowx">FlowX</span>
            <div class="agent-badge" :class="{ active: activeAgentLabel }">
              <template v-if="activeAgentLabel">
                <span class="agent-badge-dot" />
                <span>{{ activeAgentLabel }}</span>
              </template>
              <template v-else>
                <span class="agent-badge-dot-idle" />
                <span class="agent-badge-idle">空闲中</span>
              </template>
            </div>
            <!-- z-index 必须高于 .float-window(3000)：tooltip teleport 到 body 后默认 2000，会被浮窗整个盖住 -->
            <el-tooltip v-if="usageLabel" :content="usageLabel" placement="bottom" :z-index="3100">
              <div class="usage-badge" :class="{ 'usage-badge--alert': usage?.alert }">
                <el-icon class="usage-badge-icon" :size="11"><Coin /></el-icon>
                <span>{{ fmtTokens(usageTotal) }}</span>
              </div>
            </el-tooltip>
          </div>
          <div class="float-header-right">
            <el-button text circle size="small" title="新建对话" @click="newChat"><el-icon :size="16"><ChatSquare /></el-icon></el-button>
            <el-button text circle size="small" title="历史对话" @click="showHistory = !showHistory; if(showHistory) loadThreads()"><el-icon :size="16"><ChatLineSquare /></el-icon></el-button>
            <el-button text circle size="small" @click="handleClose"><el-icon><Close /></el-icon></el-button>
          </div>
        </div>

        <div class="float-body">
          <!-- 历史面板 -->
          <div v-if="showHistory" class="history-panel">
            <div class="history-header">
              <el-icon class="history-back" :size="18" @click="showHistory = false"><ArrowLeft /></el-icon>
              <span>历史对话</span>
              <span class="history-count">{{ threads.length }}</span>
            </div>
            <div v-if="threads.length === 0" class="history-empty">
              <el-icon :size="30"><ChatLineSquare /></el-icon>
              <p>暂无历史对话</p>
              <span>开始对话后，记录会保存在这里</span>
            </div>
            <div v-else class="history-list">
              <div v-for="t in threads" :key="t.id" class="history-card" @click="restoreThread(t)">
                <div class="history-card-top">
                  <span class="history-card-title">{{ t.title.slice(0, 40) || '(空)' }}</span>
                </div>
                <div class="history-card-meta">
                  <span class="history-card-info">
                    <span>{{ t.messageCount }} 条</span>
                    <span class="meta-dot" />
                    <span>{{ fmtTime(t.updatedAt) }}</span>
                  </span>
                  <el-icon class="delete-icon" :size="15" title="删除对话" @click.stop="deleteThread(t.id)"><Close /></el-icon>
                </div>
              </div>
            </div>
          </div>

          <!-- 聊天区域 -->
          <div v-else class="chat-content">
            <div ref="messagesEl" class="messages-container">
              <!-- 空状态 -->
              <div v-if="messages.length === 0" class="empty-state">
                <p class="empty-greeting">你好，我是 <span class="brand-flowx">FlowX</span> 智能助手</p>
                <p class="empty-hint">
                  {{ SCENARIO_MAP[scenario] ? `${SCENARIO_MAP[scenario].label}可为您提供以下能力：` : '可为您提供以下能力：' }}
                </p>
                <ul v-if="scenario === 'form-builder'">
                  <li>通过自然语言描述生成表单，支持多种控件类型</li>
                  <li>支持在会话中创建、修改和管理多张表单和维护已保存的表单</li>
                  <li>保存到空间之前提供人机协同确认与预览卡片</li>
                  <li>支持版本回滚及删除，提供回收站功能</li>
                </ul>
                <ul v-else-if="scenario === 'template-creator'">
                  <li>按关键词或分类检索模板</li>
                  <li>基于模板生成表单结构，交由表单设计助手保存</li>
                  <li>可衔接流程编排助手配置审批流程</li>
                </ul>
                <ul v-else-if="scenario === 'workflow-node'">
                  <li>根据流程描述生成节点与连线，并自动校验合法性</li>
                  <li>支持审批、条件分支、并行等多种节点类型</li>
                  <li>可关联已有表单并协同发布生效</li>
                </ul>
                <ul v-else-if="scenario === 'data-analysis'">
                  <li>汇总查看表单及提交数据</li>
                  <li>按时间范围与分组维度统计分析趋势与异常</li>
                  <li>输出分析洞察与图表建议</li>
                </ul>
                <ul v-else>
                  <li>支持表单设计、流程编排、模板检索与数据分析</li>
                  <li>跨领域任务自动切换至相应助手协同处理</li>
                  <li>可连续完成模板—表单—流程全过程任务的流转</li>
                </ul>
                <p v-if="scenario === 'data-analysis'" class="empty-hint">
                  仅支持只读分析，无法修改或删除数据。
                </p>
              </div>

              <!-- 消息列表 -->
              <div v-for="msg in messages" :key="msg.id" class="msg-wrapper">
                <!-- 用户消息 -->
                <div v-if="msg.role === 'user'" class="user-msg">
                  {{ msg.content }}
                  <div class="msg-time">{{ fmtTime(msg.timestamp) }}</div>
                </div>

                <!-- Agent 消息 -->
                <div v-else class="agent-msg">
                    <!-- 内容区 -->
                    <div v-if="msg.content" class="msg-content" v-html="renderMarkdown(msg.content)" />
                    <!-- 打字动画：锚在内容位置（本轮正在写的那条），所以它落在工具卡片上方 -->
                    <div v-if="isLoading && msg.id === activeMessageId" class="typing-row">
                      <span class="typing-dot" /><span class="typing-dot" /><span class="typing-dot" />
                    </div>

                    <!-- 人机协作检查点：待用户选择。不放进折叠区，否则会被默认收起 -->
                    <div
                      v-for="tc in (msg.toolCalls || []).filter((t: any) => t.status === 'confirming')"
                      :key="'confirm-' + tc.callId"
                      class="confirm-card"
                    >
                      <div class="confirm-prompt">{{ tc.prompt || tc.summary || '需要你的确认' }}</div>
                      <div class="confirm-actions">
                        <template v-for="opt in confirmOptions(tc)" :key="opt.value">
                          <!-- 消歧候选：一行一张表，先能预览再决定选哪张 -->
                          <div v-if="opt.form" class="confirm-option">
                            <span class="confirm-option-label">{{ opt.label }}</span>
                            <div class="confirm-option-btns">
                              <el-button size="small" @click="openFormPreview(opt.form, opt.form.title)">预览</el-button>
                              <el-button size="small" type="primary" @click="answerConfirm(tc, opt)">选这张</el-button>
                            </div>
                          </div>
                          <el-button
                            v-else
                            size="small"
                            :type="opt.style"
                            @click="answerConfirm(tc, opt)"
                          >{{ opt.label }}</el-button>
                        </template>
                      </div>
                    </div>

                    <!-- 被新消息抢占、已自动中断的检查点：只留痕，不可再选 -->
                    <div
                      v-for="tc in (msg.toolCalls || []).filter((t: any) => t.status === 'interrupted')"
                      :key="'interrupted-' + tc.callId"
                      class="confirm-card interrupted"
                    >
                      <div class="confirm-prompt">{{ tc.prompt || tc.summary || '需要你的确认' }}</div>
                      <div class="confirm-interrupted">
                        <el-icon :size="12"><Close /></el-icon>
                        <span>已自动中断</span>
                      </div>
                    </div>

                    <!-- 工具调用（可折叠）：有待答复检查点时默认展开，工具名与风险就在这里披露 -->
                    <div v-if="msg.toolCalls?.length" class="collapsible-wrap">
                      <div class="collapse-toggle" @click="toggleTools(msg)">
                        <span class="collapse-toggle-text">
                          <el-icon :size="14"><Link /></el-icon>
                          工具调用 ({{ msg.toolCalls.filter((t: any) => t.status === 'done').length }}/{{ msg.toolCalls.length }})
                        </span>
                        <el-icon :size="12"><component :is="isToolsOpen(msg) ? ArrowUp : ArrowDown" /></el-icon>
                      </div>
                      <div v-if="isToolsOpen(msg)" class="collapse-body">
                        <div v-for="tc in msg.toolCalls" :key="tc.callId" :class="['tool-chip', tc.status]">
                          <span class="tool-chip-dot" />
                          <span class="tool-chip-name">{{ tc.tool }}</span>
                          <span v-if="riskLabel(tc.risk)" class="confirm-risk">风险系数：{{ riskLabel(tc.risk) }}</span>
                          <!-- 待答复时文案已经在上面的检查点卡片里说过一遍，chip 只留工具与风险 -->
                          <!-- 后缀解释会被 flex 压成省略号，悬停看全文。z-index 必须高于
                               .float-window(3000)：tooltip teleport 到 body 后默认 2000，会被浮窗盖住 -->
                          <el-tooltip
                            v-if="tc.summary && tc.status !== 'confirming'"
                            :content="tc.summary"
                            placement="top"
                            :show-after="200"
                            :z-index="3100"
                          >
                            <span class="tool-summary">{{ tc.summary }}</span>
                          </el-tooltip>
                        </div>
                      </div>
                    </div>

                    <!-- 表单预览：默认收起（和工具调用一致），有待答复检查点时自动摊开当依据，
                         答完自动收起。展开后一表一行，点击弹出该表的真实预览 -->
                    <div v-if="msg.result?.schema" class="collapsible-wrap">
                      <div class="collapse-toggle" @click="togglePreview(msg)">
                        <span class="collapse-toggle-text">
                          <el-icon :size="14"><Postcard /></el-icon>
                          表单预览 ({{ formEntries(msg.result).length }})
                        </span>
                        <el-icon :size="12"><component :is="isPreviewOpen(msg) ? ArrowUp : ArrowDown" /></el-icon>
                      </div>
                      <div v-if="isPreviewOpen(msg)" class="collapse-body">
                        <div class="preview-summary-list">
                          <div
                            v-for="f in formEntries(msg.result)"
                            :key="f.key || f.schema?.settings?.formTitle || 'form'"
                            class="preview-summary"
                            @click="openFormPreview(f)"
                          >
                            <el-icon :size="14"><Postcard /></el-icon>
                            <span class="preview-summary-title">{{ f.title || f.schema?.settings?.formTitle || '表单结构' }}</span>
                            <span class="preview-summary-meta">{{ (f.fieldCount ?? f.schema?.fields?.length) || 0 }} 个字段</span>
                            <span v-if="f.formId" class="preview-summary-tag">已保存</span>
                            <span class="preview-summary-cta">点击预览 ›</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <!-- 模板预览：模板市场助手的搜索结果，默认收起、待确认时自动摊开。
                         一行一张模板，点开用表单结构弹窗看它长什么样 -->
                    <div v-else-if="msg.result?.templates?.length" class="collapsible-wrap">
                      <div class="collapse-toggle" @click="togglePreview(msg)">
                        <span class="collapse-toggle-text">
                          <el-icon :size="14"><Postcard /></el-icon>
                          模板预览 ({{ msg.result.templates.length }})
                        </span>
                        <el-icon :size="12"><component :is="isPreviewOpen(msg) ? ArrowUp : ArrowDown" /></el-icon>
                      </div>
                      <div v-if="isPreviewOpen(msg)" class="collapse-body">
                        <div class="preview-summary-list">
                          <div
                            v-for="t in msg.result.templates"
                            :key="t.id"
                            class="preview-summary"
                            @click="openFormPreview(t, t.name)"
                          >
                            <el-icon :size="14"><Postcard /></el-icon>
                            <span class="preview-summary-title">{{ t.name }}</span>
                            <span class="preview-summary-meta">{{ t.category || '未分类' }} · {{ t.schema?.fields?.length || 0 }} 个字段</span>
                            <span class="preview-summary-cta">点击预览 ›</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <!-- 流程预览：卡片只留一行摘要，点开用弹窗看分层图（和表单/模板预览一致） -->
                    <div v-else-if="msg.result?.nodes?.length" class="collapsible-wrap">
                      <div class="collapse-toggle" @click="togglePreview(msg)">
                        <span class="collapse-toggle-text">
                          <el-icon :size="14"><Postcard /></el-icon>
                          流程预览 ({{ msg.result.nodes.length }} 个节点)
                        </span>
                        <el-icon :size="12"><component :is="isPreviewOpen(msg) ? ArrowUp : ArrowDown" /></el-icon>
                      </div>
                      <div v-if="isPreviewOpen(msg)" class="collapse-body">
                        <div class="preview-summary-list">
                          <div class="preview-summary" @click="openFlowPreview(msg.result)">
                            <el-icon :size="14"><Postcard /></el-icon>
                            <span class="preview-summary-title">{{ msg.result.name || '流程定义' }}</span>
                            <span class="preview-summary-meta">{{ msg.result.nodes.length }} 节点 · {{ msg.result.edges?.length || 0 }} 连线</span>
                            <span class="preview-summary-cta">点击预览 ›</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <!-- 预览卡片（可折叠）：只有当结果里确有可展示内容时才出现 -->
                    <div v-else-if="hasPreview(msg)" class="collapsible-wrap">
                      <div class="collapse-toggle" @click="togglePreview(msg)">
                        <span class="collapse-toggle-text"><el-icon :size="14"><Postcard /></el-icon>预览卡片</span>
                        <el-icon :size="12"><component :is="isPreviewOpen(msg) ? ArrowUp : ArrowDown" /></el-icon>
                      </div>
                      <div v-if="isPreviewOpen(msg)" class="collapse-body">
                        <div v-if="msg.result.decision" class="preview-card decision-preview">
                          <div class="card-title">审批建议</div>
                          <div :class="['decision-badge', msg.result.decision]">{{ msg.result.decision === 'approve' ? '建议通过' : '建议驳回' }} <span class="confidence">{{ ((msg.result.confidence || 0) * 100).toFixed(0) }}%</span></div>
                          <div v-if="msg.result.reasons?.length" class="reasons"><div v-for="(r, i) in msg.result.reasons" :key="i">{{ r }}</div></div>
                          <div v-if="msg.result.riskFlags?.length" class="risks"><span v-for="(r, i) in msg.result.riskFlags" :key="i" class="risk-tag">{{ r }}</span></div>
                        </div>
                        <div v-else-if="msg.result.insights || msg.result.stats" class="preview-card analysis-preview">
                          <div class="card-title">分析结果</div>
                          <div v-if="msg.result.stats" class="stats-row">
                            <span class="stat-item">样本: {{ msg.result.stats.count }}</span>
                            <span class="stat-item">均值: {{ msg.result.stats.mean?.toFixed(2) }}</span>
                            <span class="stat-item">趋势: {{ msg.result.stats.direction }}</span>
                          </div>
                          <div v-if="msg.result.anomalies?.length" class="anomalies"><div v-for="a in msg.result.anomalies.slice(0, 3)" :key="a.index" class="anomaly-item">{{ a.label || a.index }}: {{ a.value }} (Z={{ a.zScore }})</div></div>
                        </div>
                      </div>
                    </div>

                    <div class="msg-time">
                      {{ fmtTime(msg.timestamp) }}
                      <!-- 本条回答的 token（阶段 4）：内容为空又没产物的轮次不挂，免得空气泡上飘个数字 -->
                      <span v-if="msg.usage && (msg.content || msg.result)" class="msg-tokens">
                        · {{ fmtTokens(msgTokens(msg.usage)) }} tokens
                      </span>
                    </div>
                </div>
              </div>

              <div v-if="error" class="error-banner">{{ error }}</div>
            </div>

            <!-- 输入区 -->
            <div class="input-area">
              <div class="input-row">
                <el-input
                  v-model="inputText"
                  type="textarea"
                  :rows="2"
                  placeholder="输入你的需求..."
                  :disabled="isLoading"
                  @keydown="handleKeydown"
                  class="chat-input"
                />
                <el-button
                  v-if="isLoading"
                  type="warning"
                  circle
                  class="send-btn stop-btn"
                  @click="cancel"
                >
                  <el-icon :size="18"><Close /></el-icon>
                </el-button>
                <el-button
                  v-else
                  type="primary"
                  circle
                  class="send-btn"
                  :disabled="!inputText.trim()"
                  @click="handleSend"
                >
                  <el-icon :size="18"><Top /></el-icon>
                </el-button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </transition>

    <!-- 真实表单预览弹窗。ChatPanel 浮窗是 z-index 3000，弹窗必须更高才不被盖住 -->
    <el-dialog
      v-model="previewVisible"
      :title="previewTitle"
      width="900px"
      append-to-body
      :z-index="3200"
    >
      <div class="form-preview-box">
        <PreviewPanel
          v-if="previewSchema"
          :key="previewSeq"
          :schema="previewSchema"
          hide-actions
          hide-title
        />
      </div>
    </el-dialog>

    <!-- 流程预览弹窗：artifact 没有坐标，图由 FlowPreviewGraph 自己算分层布局 -->
    <el-dialog
      v-model="flowPreviewVisible"
      :title="flowPreview?.name || '流程定义'"
      width="860px"
      append-to-body
      :z-index="3200"
    >
      <FlowPreviewGraph
        v-if="flowPreview"
        :nodes="flowPreview.nodes"
        :edges="flowPreview.edges"
      />
    </el-dialog>
  </Teleport>
</template>

<style scoped>
/* ===== 窗口 ===== */
.float-window {
  position: fixed; right: 24px; bottom: 24px;
  width: 460px; height: 640px; max-height: calc(100vh - 80px);
  background: #fff; border-radius: 16px;
  box-shadow: 0 12px 48px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.05);
  display: flex; flex-direction: column; z-index: 3000; overflow: hidden;
}

/* ===== 头部 ===== */
.float-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 18px;
  background: linear-gradient(135deg, #f0f5ff 0%, #e8f2fc 100%);
  border-bottom: 1px solid #dce8f5;
  flex-shrink: 0;
  cursor: grab;
  touch-action: none;
}
.float-window.dragging { user-select: none; }
.float-window.dragging .float-header { cursor: grabbing; }
.header-avatar {
  width: 38px; height: 38px; border-radius: 12px; flex-shrink: 0;
  background: #409eff;
  display: flex; align-items: center; justify-content: center; color: #fff;
}
.float-header-left { display: flex; align-items: center; gap: 10px; }
/*
 * FlowX 品牌字：凡是出现 "FlowX" 这三个字母的地方（悬浮窗标题、空状态问候语）都挂这类，
 * 与主页面右上角入口一致。
 *
 * font-family 必须写 Arial：入口是原生 <button>，字体取自浏览器 UA 样式表而不是继承
 * 文档字体 —— Chromium/Edge 上实测就是 Arial，而普通 <span> 用的是文档默认字体
 * （Noto Sans SC / 微软雅黑），两边本来不是一个字体。这里对齐入口那个。
 */
.brand-flowx { font-family: Arial; }
.float-title { font-size: 15px; font-weight: 700; color: #2c3e50; white-space: nowrap; }
.agent-badge {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 3px 10px; border-radius: 12px; min-height: 22px;
  background: #f5f7fa; font-size: 11px; color: #909399; font-weight: 500;
  transition: background .3s, color .3s;
}
.agent-badge.active {
  background: #ecf5ff; color: #409eff;
}
.agent-badge-dot {
  width: 6px; height: 6px; border-radius: 50%; background: #409eff;
  animation: badge-pulse 1.2s ease-in-out infinite;
  flex-shrink: 0;
}
@keyframes badge-pulse { 0%,100% { opacity: 1; transform: scale(1) } 50% { opacity: 0.4; transform: scale(1.3) } }
.agent-badge-dot-idle {
  width: 6px; height: 6px; border-radius: 50%; background: #c0c4cc; flex-shrink: 0;
}
.agent-badge-idle { opacity: 0.7; }
/* 会话累计用量徽标（阶段 4）：默认灰；超软上限时转橙告警 */
.usage-badge {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 8px; border-radius: 12px; min-height: 22px;
  background: #f5f7fa; font-size: 11px; color: #909399; font-weight: 500;
  cursor: default;
}
.usage-badge-icon { color: #b1b3b8; flex-shrink: 0; }
.usage-badge--alert { background: #fdf6ec; color: #e6a23c; }
.usage-badge--alert .usage-badge-icon { color: #e6a23c; }
.float-header-right { display: flex; align-items: center; gap: 2px; }
.float-header-right .el-button { color: #6b8299; }

.float-fade-enter-active { transition: all 0.25s ease-out; }
.float-fade-leave-active { transition: all 0.18s ease-in; }
.float-fade-enter-from { opacity: 0; transform: translateY(16px) scale(0.96); }
.float-fade-leave-to { opacity: 0; transform: translateY(8px) scale(0.98); }

/* 删除确认框挂在 body 上，必须高于浮窗（3000），否则会被挡住 */
:global(.chat-confirm-overlay) { z-index: 3100 !important; }

/* ===== 历史面板 ===== */
.float-body { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.history-panel { flex: 1; overflow-y: auto; padding: 14px 16px 16px; }
.history-panel::-webkit-scrollbar { width: 6px; }
.history-panel::-webkit-scrollbar-thumb { background: #dcdfe6; border-radius: 3px; }
.history-panel::-webkit-scrollbar-thumb:hover { background: #c0c4cc; }
.history-header { display: flex; align-items: center; gap: 8px; margin: 0 2px 14px; font-size: 15px; font-weight: 600; color: #303133; }
.history-count { padding: 1px 8px; border-radius: 999px; background: #ecf5ff; color: #409eff; font-size: 11px; font-weight: 600; line-height: 18px; }
.history-back { cursor: pointer; padding: 4px; margin-left: -4px; border-radius: 6px; color: #6b8299; transition: background-color .15s, color .15s; }
.history-back:hover { background: #f0f2f5; color: #409eff; }

.history-list { display: flex; flex-direction: column; gap: 10px; }
.history-card {
  padding: 12px 14px;
  border: 1px solid #ebeef5;
  border-radius: 12px;
  background: #fff;
  cursor: pointer;
  transition: background-color .18s, border-color .18s, box-shadow .18s, transform .18s;
}
.history-card:hover {
  background: #f9fbfe;
  border-color: #c6d9f1;
  box-shadow: 0 4px 14px rgba(64, 158, 255, 0.08);
  transform: translateY(-1px);
}
.history-card:active { transform: translateY(0); }
.history-card-top { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 6px; }
.history-card-title { font-size: 13px; font-weight: 600; color: #303133; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.history-card-meta { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 11px; color: #a0a6b1; }
.history-card-info { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
.meta-dot { width: 2px; height: 2px; border-radius: 50%; background: currentColor; opacity: .7; }
.delete-icon {
  flex-shrink: 0;
  padding: 4px;
  border-radius: 6px;
  color: #c0c4cc;
  cursor: pointer;
  opacity: .4;
  transition: opacity .15s, color .15s, background-color .15s;
}
.history-card:hover .delete-icon { opacity: 1; }
.delete-icon:hover { color: #f56c6c; background: #fef0f0; }

.history-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 56px 16px; text-align: center; }
.history-empty .el-icon { margin-bottom: 8px; color: #d0d4da; }
.history-empty p { margin: 0 0 4px; font-size: 13px; color: #909399; }
.history-empty span { font-size: 12px; color: #b1b3b8; }
.no-data { color: #909399; font-size: 13px; text-align: center; padding: 24px 0; }

/* ===== 聊天区 ===== */
.chat-content { flex: 1; display: flex; flex-direction: column; overflow: hidden; }

/* 消息容器 */
.messages-container { flex: 1; overflow-y: auto; padding: 16px 18px; }

/* ===== 空状态 ===== */
.empty-state { padding: 24px 8px; }
.empty-greeting { font-size: 16px; font-weight: 600; color: #1a1a2e; margin-bottom: 4px; }
.empty-hint { font-size: 13px; color: #909399; margin-bottom: 12px; }
.empty-state ul { font-size: 13px; color: #606266; line-height: 2; padding-left: 20px; }
.empty-state li::marker { color: #409eff; }

/* ===== 消息 ===== */
.msg-wrapper { margin-bottom: 4px; animation: msg-in 0.25s ease-out; }
.msg-wrapper:last-child { margin-bottom: 0; }
@keyframes msg-in { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: translateY(0) } }

/* 用户气泡 — max-width 直接挂在此元素，无嵌套 */
.user-msg {
  background: #409eff; color: #fff;
  padding: 10px 14px; border-radius: 14px 14px 4px 14px;
  margin-left: auto; max-width: 85%; word-break: break-word;
  font-size: 13px; line-height: 1.65; margin-bottom: 16px;
}

/* Agent 气泡 — max-width 直接挂在此元素，无嵌套 */
.agent-msg {
  background: #f5f7fa; color: #303133;
  padding: 10px 14px; border-radius: 14px 14px 14px 4px;
  max-width: 90%; word-break: break-word; overflow: hidden;
  font-size: 13px; line-height: 1.65;
  border: 1px solid #eaecf0; margin-bottom: 16px;
}

/* 时间戳 + 本条回答用量小字（同一行） */
.msg-time { font-size: 10px; color: #c0c4cc; margin-top: 6px; }
.user-msg .msg-time { color: rgba(255,255,255,0.6); text-align: right; }
.msg-tokens { margin-left: 2px; }

/* ===== 打字动画 ===== */
.typing-row {
  display: flex; align-items: center; gap: 4px; padding: 4px 0;
}
.typing-dot {
  width: 7px; height: 7px; border-radius: 50%; background: #c0c4cc;
  animation: typing-bounce 1.4s ease-in-out infinite;
}
.typing-dot:nth-child(2) { animation-delay: 0.2s; }
.typing-dot:nth-child(3) { animation-delay: 0.4s; }
@keyframes typing-bounce { 0%,60%,100% { transform: translateY(0); opacity: 0.4 } 30% { transform: translateY(-6px); opacity: 1 } }

/* ===== Markdown 内容 ===== */
.msg-content :deep(h2) { font-size: 15px; font-weight: 700; margin: 10px 0 4px; }
.msg-content :deep(h3) { font-size: 14px; font-weight: 700; margin: 8px 0 4px; }
.msg-content :deep(p) { margin: 4px 0; }
.msg-content :deep(ul), .msg-content :deep(ol) { padding-left: 20px; margin: 4px 0; }
.msg-content :deep(li) { margin: 2px 0; }
.msg-content :deep(code) { background: #e4e7ed; padding: 1px 5px; border-radius: 3px; font-size: 12px; font-family: 'SF Mono', Consolas, monospace; }
.msg-content :deep(pre) { background: #1e1e2e; color: #cdd6f4; padding: 10px 14px; border-radius: 8px; overflow-x: auto; font-size: 12px; margin: 8px 0; }
.msg-content :deep(pre code) { background: none; padding: 0; }
.msg-content :deep(table) { border-collapse: collapse; width: 100%; margin: 8px 0; font-size: 12px; }
.msg-content :deep(th), .msg-content :deep(td) { border: 1px solid #e4e7ed; padding: 4px 10px; text-align: left; }
.msg-content :deep(th) { background: #f5f7fa; font-weight: 600; color: #606266; }
.msg-content :deep(strong) { font-weight: 700; color: #1a1a2e; }
.msg-content :deep(blockquote) { border-left: 3px solid #409eff; padding-left: 10px; margin: 6px 0; color: #606266; }

/* ===== 人机协作检查点（常显，不折叠） ===== */
.confirm-card { margin-top: 8px; padding: 10px 12px; border-radius: 8px; background: #fdf6ec; border: 1px solid #f5dab1; }
/* pre-line：后端 prompt 用 \n 断行（"现状一句 + 问句一句"），这里得把换行渲染出来 */
.confirm-prompt { font-size: 13px; color: #303133; line-height: 1.5; white-space: pre-line; }
.confirm-risk { color: #b88230; font-size: 11px; flex-shrink: 0; }
/* 普通检查点（确认/取消）横排；消歧候选独占一行，长标题不会再顶出容器 */
.confirm-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.confirm-option {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 10px;
  flex: 1 1 100%;
  min-width: 0;
  padding: 7px 10px;
  border: 1px solid #e4e7ed;
  border-radius: 6px;
  background: #fff;
}
.confirm-option-label { font-size: 13px; color: #303133; overflow-wrap: anywhere; }
.confirm-option-btns { display: flex; flex-shrink: 0; gap: 6px; }

/* 被抢占后自动中断的检查点：灰化留痕，不可交互 */
.confirm-card.interrupted { background: #f4f4f5; border-color: #e4e7ed; }
.confirm-card.interrupted .confirm-prompt { color: #909399; }
.confirm-interrupted { display: flex; align-items: center; gap: 4px; margin-top: 6px; font-size: 12px; color: #909399; }

/* ===== 工具调用 & 预览卡片（可折叠） ===== */
.collapsible-wrap { margin-top: 8px; overflow: hidden; }
.collapse-toggle { display: flex; align-items: center; justify-content: space-between; font-size: 11px; color: #909399; cursor: pointer; padding: 2px 0; user-select: none; }
.collapse-toggle-text { display: flex; align-items: center; gap: 4px; overflow: hidden; }
.collapse-toggle:hover { color: #409eff; }
.collapse-body { margin-top: 6px; display: flex; flex-direction: column; gap: 4px; overflow: hidden; }

.tool-chip { font-size: 12px; padding: 6px 10px; border-radius: 6px; background: #fafbfc; border: 1px solid #ebeef5; display: flex; align-items: center; gap: 8px; overflow: hidden; }
.tool-chip.error { background: #fef0f0; }
.tool-chip.running { background: #ecf5ff; }
.tool-chip.confirming { background: #fdf6ec; }
.tool-chip.interrupted { background: #f4f4f5; }

.tool-chip-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.tool-chip.done .tool-chip-dot { background: #67c23a; }
.tool-chip.running .tool-chip-dot { background: #409eff; animation: dot-pulse 1s infinite; }
.tool-chip.error .tool-chip-dot { background: #f56c6c; }
.tool-chip.confirming .tool-chip-dot { background: #e6a23c; animation: dot-pulse 1s infinite; }
.tool-chip.interrupted .tool-chip-dot { background: #c0c4cc; }
@keyframes dot-pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }

.tool-chip-name { font-weight: 600; color: #303133; font-family: 'SF Mono', Consolas, monospace; white-space: nowrap; flex-shrink: 0; }
.tool-summary { color: #909399; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1 1 0; min-width: 0; }

.preview-card {
  background: #fff; border: 1px solid #e4e7ed; border-radius: 10px; padding: 12px;
  overflow: hidden;
}
.card-title { font-weight: 600; margin-bottom: 8px; font-size: 13px; color: #303133; }

/* 表单摘要行：整行可点，点开弹真实预览。多张表时按列表纵向排列 */
.preview-summary-list { display: flex; flex-direction: column; gap: 6px; }
.preview-summary {
  display: flex; align-items: center; gap: 6px;
  margin-top: 8px; padding: 8px 12px; border-radius: 10px;
  background: #fff; border: 1px solid #e4e7ed;
  font-size: 12px; color: #303133; cursor: pointer;
  transition: border-color .15s, background .15s;
}
.preview-summary-list .preview-summary { margin-top: 0; }
.preview-summary:hover { border-color: #409eff; background: #f5f9ff; }
.preview-summary-title { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.preview-summary-meta { color: #909399; flex-shrink: 0; }
.preview-summary-tag {
  flex-shrink: 0; padding: 0 6px; border-radius: 6px; line-height: 16px;
  font-size: 11px; color: #67c23a; background: #f0f9eb;
}
.preview-summary-cta { margin-left: auto; color: #409eff; flex-shrink: 0; }

/* 弹窗里的真实渲染容器 */
.form-preview-box { max-height: 60vh; overflow: auto; }

.decision-badge {
  display: inline-flex; align-items: center; gap: 8px; padding: 6px 14px;
  border-radius: 6px; font-size: 14px; font-weight: 600;
}
.decision-badge.approve { background: #f0f9eb; color: #67c23a; }
.decision-badge.reject { background: #fef0f0; color: #f56c6c; }
.confidence { font-size: 12px; font-weight: 400; opacity: 0.7; }
.reasons { margin-top: 8px; font-size: 13px; color: #606266; line-height: 1.8; }

/* ===== 错误 ===== */
.error-banner {
  margin: 8px 0; padding: 10px 14px; background: #fef0f0; color: #f56c6c;
  font-size: 12px; border-radius: 8px; border: 1px solid #fde2e2;
}

/* ===== 输入区 ===== */
.input-area { flex-shrink: 0; padding: 12px 18px 16px; border-top: 1px solid #f0f0f0; background: #fff; }
.input-row { display: flex; align-items: flex-end; gap: 8px; }
.chat-input :deep(.el-textarea__inner) {
  border-radius: 14px; padding: 10px 16px; font-size: 13px;
  background: #f5f7fa; border-color: transparent; resize: none;
  line-height: 1.6; transition: 0.2s;
}
.chat-input :deep(.el-textarea__inner:focus) { background: #fff; border-color: #409eff; box-shadow: 0 0 0 3px rgba(64,158,255,.1); }
.send-btn {
  width: 40px; height: 40px; flex-shrink: 0; margin-bottom: 10px;
  background: #409eff; border-color: #409eff;
  transition: 0.2s;
}
.send-btn:hover { background: #337ecc; transform: scale(1.05); }
.stop-btn, .stop-btn:hover { background: #e6a23c !important; border-color: #e6a23c !important; }
.send-btn.is-disabled { background: #c0c4cc; border-color: #c0c4cc; }
</style>
