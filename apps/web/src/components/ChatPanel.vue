<script setup lang="ts">
import { ref, watch, nextTick, computed, markRaw } from 'vue'
import { useRouter } from 'vue-router'
import { useAgentChat } from '@/composables/useAgentChat'
import { ElMessage } from 'element-plus'
import { marked } from 'marked'
import {
  DocumentCopy, ScaleToOriginal, Files, Message, PieChart, Close,
  ArrowDown, ArrowUp, ArrowLeft, Link, ChatSquare, ChatLineSquare, Postcard,
} from '@element-plus/icons-vue'

const router = useRouter()

const props = defineProps<{
  visible: boolean
  scenario: string
  workspaceId: string
  getCurrentSchema?: () => Record<string, unknown> | null
}>()

const emit = defineEmits<{
  (e: 'update:visible', v: boolean): void
  (e: 'insert-schema', schema: Record<string, unknown>): void
}>()

const SCENARIO_MAP: Record<string, { icon: any; label: string }> = {
  'form-builder':     { icon: markRaw(DocumentCopy),      label: '表单设计助手' },
  'workflow-node':    { icon: markRaw(Files),             label: '流程编排助手' },
  'template-creator': { icon: markRaw(ScaleToOriginal),   label: '模板市场助手' },
  'approval-assist':  { icon: markRaw(Message),           label: '审批辅助助手' },
  'data-analysis':    { icon: markRaw(PieChart),          label: '数据分析助手' },
}
const scenarioIcon = computed(() => SCENARIO_MAP[props.scenario]?.icon || markRaw(DocumentCopy))
const scenarioLabel = computed(() => SCENARIO_MAP[props.scenario]?.label || 'AI 助手')

const inputText = ref('')
const messagesEl = ref<HTMLDivElement>()
const showHistory = ref(false)

// 最后一条 assistant 消息是否还在等待首 token
const isLastMsgEmpty = computed(() => {
  if (!isLoading.value) return false
  const last = messages.value[messages.value.length - 1]
  return last && last.role === 'assistant' && !last.content && !last.toolCalls?.length
})
const expandedTools = ref<Record<string, boolean>>({})
const expandedPreview = ref<Record<string, boolean>>({})

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
function deleteThread(id: string) {
  threads.value = threads.value.filter((t) => t.id !== id)
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
    } catch { /* */ }
  })
}
loadThreads()

const { messages, isLoading, status, error, sendMessage, cancel, clearMessages } = useAgentChat({
  scenario: props.scenario,
  workspaceId: props.workspaceId,
  onConfirmRequired: (callId, tool, summary) => {
    ElMessage({ message: `Agent 要执行 ${tool}`, type: 'warning', duration: 0, showClose: true })
    sendMessage(`确认执行 ${tool}`, callId)
  },
})

function handleSend() {
  if (!inputText.value.trim()) return
  const text = inputText.value
  sendMessage(text)
  inputText.value = ''
  if (messages.value.length <= 1) saveThread(text)
}
function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
}
function newChat() {
  const first = messages.value.find((m) => m.role === 'user')
  if (first) saveThread(first.content)
  clearMessages()
  showHistory.value = false
}
function handleClose() { emit('update:visible', false) }
function toggleTools(id: string) { expandedTools.value[id] = !expandedTools.value[id] }
function togglePreview(id: string) { expandedPreview.value[id] = !expandedPreview.value[id] }

async function copySchemaJson(schema: Record<string, unknown>) {
  try { await navigator.clipboard.writeText(JSON.stringify(schema, null, 2)); ElMessage.success('已复制') }
  catch { ElMessage.error('复制失败') }
}
function handleInsertSchema() {
  const lastMsg = messages.value[messages.value.length - 1]
  const r = lastMsg?.result
  if (r?.formId && props.workspaceId) {
    router.push(`/workspace/${props.workspaceId}/forms/${r.formId}/designer`)
    ElMessage.success('已跳转到设计器')
  } else if (r?.schema) {
    emit('insert-schema', r.schema)
    ElMessage.success('已插入设计器')
  }
}
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
watch(() => props.visible, (v) => { if (v) loadThreads() })
watch(() => messages.value.length, () => nextTick(() => { if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight }))
watch(() => isLoading.value, (l, was) => {
  if (was && !l && messages.value.length > 0) {
    const first = messages.value.find((m) => m.role === 'user')?.content || ''
    if (first) localStorage.setItem(MSG_PREFIX + first, JSON.stringify(messages.value.slice(-50)))
  }
})
</script>

<template>
  <Teleport to="body">
    <transition name="float-fade">
      <div v-if="visible" class="float-window">
        <!-- 头部 -->
        <div class="float-header">
          <div class="float-header-left">
            <div class="header-avatar">
              <el-icon :size="18"><component :is="scenarioIcon" /></el-icon>
            </div>
            <div>
              <div class="float-title">{{ scenarioLabel }}</div>
              <div class="float-subtitle" v-if="status">{{ status.phase === 'executing' ? '正在处理...' : '在线' }}</div>
              <div class="float-subtitle online" v-else>在线</div>
            </div>
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
              <span>历史对话 ({{ threads.length }})</span>
            </div>
            <div v-if="threads.length === 0" class="no-data">暂无历史对话</div>
            <div v-for="t in threads" :key="t.id" class="history-card" @click="restoreThread(t)">
              <div class="history-card-top">
                <span class="history-card-title">{{ t.title.slice(0, 40) || '(空)' }}</span>
                <span class="history-card-scenario">{{ SCENARIO_MAP[t.scenario]?.label || t.scenario }}</span>
              </div>
              <div class="history-card-meta">
                <span>{{ t.messageCount }} 条 · {{ fmtTime(t.updatedAt) }}</span>
                <el-icon class="delete-icon" :size="16" @click.stop="deleteThread(t.id)"><Close /></el-icon>
              </div>
            </div>
          </div>

          <!-- 聊天区域 -->
          <div v-else class="chat-content">
            <!-- 状态栏 -->
            <div v-if="status && status.phase === 'executing'" class="agent-status-bar">
              <span class="status-dot" />
              <span>{{ status.agent || 'Agent' }} 工作中</span>
              <span v-if="status.todo?.length" class="status-todo">
                <span v-for="t in status.todo.filter((x: any) => x.status === 'in_progress')" :key="t.id">{{ t.text }}</span>
              </span>
            </div>

            <div ref="messagesEl" class="messages-container">
              <!-- 空状态 -->
              <div v-if="messages.length === 0" class="empty-state">
                <p class="empty-greeting">你好，我是 {{ scenarioLabel }}</p>
                <p class="empty-hint">我可以帮助你：</p>
                <ul v-if="scenario === 'form-builder'">
                  <li>用自然语言描述需求，自动生成表单结构</li>
                  <li>支持多种控件：文本、数字、下拉、日期、单选等</li>
                  <li>自动校验字段类型和规则</li>
                  <li>一键保存到平台，支持多轮修改</li>
                </ul>
                <ul v-else-if="scenario === 'template-creator'">
                  <li>按分类或关键词搜索模板市场</li>
                  <li>查看模板详情与字段结构</li>
                  <li>基于模板快速创建表单</li>
                </ul>
                <ul v-else-if="scenario === 'workflow-node'">
                  <li>描述审批流程，自动生成节点和连线</li>
                  <li>支持审批、条件分支、并行等节点</li>
                  <li>校验 DAG 合法性</li>
                </ul>
                <ul v-else-if="scenario === 'approval-assist' || scenario === 'data-analysis'">
                  <li>分析表单提交数据</li>
                  <li>统计趋势与异常检测</li>
                  <li>输出可视化建议</li>
                </ul>
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
                    <!-- 纯打字动画（首 token 未到） -->
                    <div v-else-if="isLoading && msg === messages[messages.length - 1]" class="typing-row">
                      <span class="typing-dot" /><span class="typing-dot" /><span class="typing-dot" />
                    </div>

                    <!-- 工具调用（可折叠） -->
                    <div v-if="msg.toolCalls?.length" class="collapsible-wrap">
                      <div class="collapse-toggle" @click="toggleTools(msg.id)">
                        <span class="collapse-toggle-text">
                          <el-icon :size="14"><Link /></el-icon>
                          {{ msg.toolCalls.filter((t: any) => t.status === 'done').length }}/{{ msg.toolCalls.length }} 工具调用
                        </span>
                        <el-icon :size="12"><component :is="expandedTools[msg.id] ? ArrowUp : ArrowDown" /></el-icon>
                      </div>
                      <div v-if="expandedTools[msg.id]" class="collapse-body">
                        <div v-for="tc in msg.toolCalls" :key="tc.callId" :class="['tool-chip', tc.status]">
                          <span class="tool-chip-dot" />
                          <span class="tool-chip-name">{{ tc.tool }}</span>
                          <span v-if="tc.summary" class="tool-summary">{{ tc.summary }}</span>
                        </div>
                      </div>
                    </div>

                    <!-- 预览卡片（可折叠） -->
                    <div v-if="msg.result" class="collapsible-wrap">
                      <div class="collapse-toggle" @click="togglePreview(msg.id)">
                        <span class="collapse-toggle-text"><el-icon :size="14"><Postcard /></el-icon>预览卡片</span>
                        <el-icon :size="12"><component :is="expandedPreview[msg.id] ? ArrowUp : ArrowDown" /></el-icon>
                      </div>
                      <div v-if="expandedPreview[msg.id]" class="collapse-body">
                        <div v-if="msg.result.schema" class="preview-card form-preview">
                          <div class="card-title">{{ msg.result.schema.settings?.formTitle || '表单结构' }}</div>
                          <el-table :data="msg.result.schema.fields || []" size="small" stripe>
                            <el-table-column prop="name" label="字段" width="100" />
                            <el-table-column prop="type" label="类型" width="90" />
                            <el-table-column label="必填" width="55"><template #default="{ row }">{{ row.rules?.find((r: any) => r.type === 'required') ? '是' : '-' }}</template></el-table-column>
                            <el-table-column label="列宽" width="55"><template #default="{ row }">{{ row.col }}</template></el-table-column>
                          </el-table>
                          <div class="card-actions">
                            <el-button size="small" type="primary" @click="handleInsertSchema">插入设计器</el-button>
                            <el-button size="small" @click="copySchemaJson(msg.result.schema)">复制 JSON</el-button>
                          </div>
                        </div>
                        <div v-else-if="msg.result.nodes" class="preview-card flow-preview">
                          <div class="card-title">流程定义</div>
                          <div class="flow-nodes">
                            <div v-for="(n, i) in msg.result.nodes" :key="i" class="flow-node"><span :class="['node-badge', n.type]">{{ n.type }}</span> {{ n.label || n.id }}</div>
                          </div>
                          <div v-if="msg.result.edges?.length" class="flow-edges">
                            <div v-for="(e, i) in msg.result.edges.slice(0, 5)" :key="i" class="flow-edge">{{ e.source }} → {{ e.target }} <span v-if="e.label" class="edge-label">({{ e.label }})</span></div>
                            <div v-if="msg.result.edges.length > 5" class="more-hint">... 共 {{ msg.result.edges.length }} 条连线</div>
                          </div>
                        </div>
                        <div v-else-if="msg.result.decision" class="preview-card decision-preview">
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

                    <!-- 加载中：文字下方的持续打字动画 -->
                    <div v-if="isLoading && msg.content && msg === messages[messages.length - 1]" class="typing-row">
                      <span class="typing-dot" /><span class="typing-dot" /><span class="typing-dot" />
                    </div>
                    <div class="msg-time">{{ fmtTime(msg.timestamp) }}</div>
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
                  <el-icon :size="18"><ArrowUp /></el-icon>
                </el-button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </transition>
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
}
.header-avatar {
  width: 36px; height: 36px; border-radius: 10px;
  background: #409eff;
  display: flex; align-items: center; justify-content: center; color: #fff;
}
.float-header-left { display: flex; align-items: center; gap: 10px; }
.float-title { font-size: 15px; font-weight: 700; color: #1a1a2e; }
.float-subtitle { font-size: 11px; color: #909399; }
.float-subtitle.online { color: #67c23a; }
.float-header-right { display: flex; align-items: center; gap: 2px; }
.float-header-right .el-button { color: #6b8299; }

.float-fade-enter-active { transition: all 0.25s ease-out; }
.float-fade-leave-active { transition: all 0.18s ease-in; }
.float-fade-enter-from { opacity: 0; transform: translateY(16px) scale(0.96); }
.float-fade-leave-to { opacity: 0; transform: translateY(8px) scale(0.98); }

/* ===== 历史面板 ===== */
.float-body { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.history-panel { flex: 1; overflow-y: auto; padding: 12px 16px; }
.history-header { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; font-size: 14px; font-weight: 600; color: #303133; }
.history-back { cursor: pointer; padding: 4px; border-radius: 4px; }
.history-back:hover { background: #f0f2f5; color: #409eff; }
.history-card { padding: 10px 12px; border: 1px solid #ebeef5; border-radius: 10px; margin-bottom: 8px; cursor: pointer; transition: 0.15s; }
.history-card:hover { background: #f5f7fa; border-color: #c6d9f1; }
.history-card-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
.history-card-title { font-size: 13px; font-weight: 600; color: #303133; }
.history-card-scenario { font-size: 11px; color: #409eff; background: #ecf5ff; padding: 1px 8px; border-radius: 10px; }
.history-card-meta { font-size: 11px; color: #909399; display: flex; align-items: center; justify-content: space-between; }
.delete-icon { color: #c0c4cc; cursor: pointer; flex-shrink: 0; padding: 4px; border-radius: 4px; }
.delete-icon:hover { color: #f56c6c; background: #fef0f0; }
.no-data { color: #909399; font-size: 13px; text-align: center; padding: 24px 0; }

/* ===== 聊天区 ===== */
.chat-content { flex: 1; display: flex; flex-direction: column; overflow: hidden; }

/* 状态栏 */
.agent-status-bar {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 16px; background: #fafbfc; border-bottom: 1px solid #f0f0f0;
  font-size: 12px; color: #606266;
}
.status-dot {
  width: 7px; height: 7px; border-radius: 50%; background: #409eff;
  animation: status-pulse 1.5s ease-in-out infinite;
}
@keyframes status-pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.3 } }
.status-todo { color: #909399; margin-left: auto; }

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

/* 时间戳 */
.msg-time { font-size: 10px; color: #c0c4cc; margin-top: 6px; }
.user-msg .msg-time { color: rgba(255,255,255,0.6); text-align: right; }

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

.tool-chip-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.tool-chip.done .tool-chip-dot { background: #67c23a; }
.tool-chip.running .tool-chip-dot { background: #409eff; animation: dot-pulse 1s infinite; }
.tool-chip.error .tool-chip-dot { background: #f56c6c; }
.tool-chip.confirming .tool-chip-dot { background: #e6a23c; animation: dot-pulse 1s infinite; }
@keyframes dot-pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }

.tool-chip-name { font-weight: 600; color: #303133; font-family: 'SF Mono', Consolas, monospace; white-space: nowrap; flex-shrink: 0; }
.tool-summary { color: #909399; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1 1 0; min-width: 0; }

.preview-card {
  background: #fff; border: 1px solid #e4e7ed; border-radius: 10px; padding: 12px;
  overflow: hidden;
}
.preview-card :deep(.el-table) { width: 100% !important; }
.card-title { font-weight: 600; margin-bottom: 8px; font-size: 13px; color: #303133; }
.card-actions { margin-top: 10px; display: flex; gap: 8px; }

.flow-nodes { display: flex; flex-wrap: wrap; gap: 6px; }
.flow-node { font-size: 12px; display: flex; align-items: center; gap: 6px; }
.node-badge {
  display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 10px; color: #fff; font-weight: 600;
  text-transform: uppercase;
}
.node-badge.start { background: #67c23a; } .node-badge.end { background: #909399; }
.node-badge.approval { background: #409eff; } .node-badge.condition { background: #e6a23c; }
.node-badge.parallel { background: #b37feb; } .node-badge.notify { background: #f56c6c; }

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
