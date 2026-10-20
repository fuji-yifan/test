import { ref, readonly } from 'vue'

// SSE 事件类型
type SseEventType =
  | 'session' | 'status' | 'meta' | 'delta'
  | 'tool_start' | 'tool_result' | 'confirm_required'
  | 'message' | 'error' | 'done'

export interface ConfirmOption {
  value: string
  label: string
  style?: 'primary' | 'default' | 'danger'
  /** 消歧候选的预览数据：前端在候选行上直接渲染「预览」按钮 */
  form?: {
    title?: string
    schema?: unknown
    formId?: string
    fieldCount?: number
  }
}

export interface AgentToolCall {
  callId: string
  tool: string
  /** running / done / error / confirming / interrupted（被新消息抢占的检查点） */
  status: string
  summary?: string
  /** 人机协作检查点的问题文案 */
  prompt?: string
  /** 检查点的风险等级，用于在卡片上披露「批准的是什么」；不是风险门时后端不带 */
  risk?: string
  /** 检查点的可选项；没带时前端回退成确认/取消 */
  options?: ConfirmOption[]
}

interface AgentMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  result?: unknown
  toolCalls?: AgentToolCall[]
  /** 本条回答消耗的 token（阶段 4 补充）：来自 done.turnUsage，或 loadSession 映射的服务端落库值 */
  usage?: { inputTokens: number; outputTokens: number }
  timestamp: number
}

interface AgentStatus {
  agent: string
  phase: string
  products: { type: string; agent: string; status: string }[]
  todo: { id: string; text: string; status: string }[]
}

/**
 * 值或取值函数。
 *
 * scenario / workspaceId 都随路由变化，而 useAgentChat 只在组件 setup 时调一次，
 * 直接收值会把首次渲染那一刻的值定格住 —— 那时如果还没进工作空间路由，
 * 定格的空串会一直发下去（后端因此拿不到 workspaceId，form_save 会失败）。
 */
type Resolvable<T> = T | (() => T)

function resolve<T>(v: Resolvable<T>): T {
  return typeof v === 'function' ? (v as () => T)() : v
}

interface UseAgentChatOptions {
  scenario: Resolvable<string>
  workspaceId: Resolvable<string>
  getContext?: () => Record<string, unknown>
  onMessage?: (msg: AgentMessage) => void
  onStatus?: (status: AgentStatus) => void
}

export function useAgentChat(options: UseAgentChatOptions) {
  const messages = ref<AgentMessage[]>([])
  const isLoading = ref(false)
  const status = ref<AgentStatus | null>(null)
  const sessionId = ref<string | null>(null)
  const error = ref<string | null>(null)
  /**
   * 会话累计用量（阶段 4）：done.usage 就是**会话累计**（后端 usage channel 是累加器，跨轮不清零），
   * 所以这里是覆盖而非累加。alert 由 done.usageAlert 置位（软上限告警）。
   */
  const usage = ref<{ inputTokens: number; outputTokens: number; alert: boolean } | null>(null)
  let abortController: AbortController | null = null
  let currentAssistantMsg: AgentMessage | null = null
  /** 正在被写入的那条消息——打字动画要锚在它身上，而不是数组最后一条 */
  const activeMessageId = ref<string | null>(null)

  function nanoid() {
    return Math.random().toString(36).slice(2, 10)
  }

  function getToken(): string {
    return localStorage.getItem('access_token') || ''
  }

  async function sendMessage(
    text: string,
    confirmCallId?: string,
    scenarioOverride?: string,
    confirmAction?: string,
  ) {
    if (!text.trim() && !confirmCallId) return
    isLoading.value = true
    error.value = null

    // 乐观收掉检查点卡片：图侧续跑不一定再为该 callId 发 tool_result
    if (confirmCallId) markConfirmAnswered(confirmCallId, confirmAction)

    // 发新消息 = 上一段作废（后端会对悬挂中断 resume(abort)，见 langgraph-turn.service.ts）。
    // 前端不能继续把上一段的检查点留成可点状态，否则用户点到的是一段已被放弃的检查点。
    // 回执（confirmCallId）是答检查点、属于同一段，不算新一轮，所以跳过。
    if (!confirmCallId) interruptPendingConfirms()

    const scenario = scenarioOverride || resolve(options.scenario)

    // 检查点回执是「续跑」不是「新的一轮」：不追加用户气泡、也不另起助手消息，
    // 直接把 currentAssistantMsg 指回持有该 chip 的那条消息——delta/tool/message
    // 事件都走 target() 落点，所以原地续写不用改各个 handler。
    const owner = confirmCallId ? findMessageByToolCall(confirmCallId) : null
    let createdPlaceholder = false

    if (owner) {
      currentAssistantMsg = owner
    } else {
      // 添加用户消息
      const userMsg: AgentMessage = {
        id: nanoid(),
        role: 'user',
        content: text,
        timestamp: Date.now(),
      }
      messages.value = [...messages.value, userMsg]

      // 创建 assistant 占位消息
      currentAssistantMsg = {
        id: nanoid(),
        role: 'assistant',
        content: '',
        toolCalls: [],
        timestamp: Date.now(),
      }
      messages.value = [...messages.value, currentAssistantMsg]
      createdPlaceholder = true
    }
    activeMessageId.value = currentAssistantMsg?.id ?? null

    // 上一轮还没结束就发了新消息（例如用户先「停止」再发、或流被挂住时重发）：
    // 先把它断掉。不这么做的话浏览器会留着僵尸请求，和服务端的新一轮抢同一个
    // 会话，服务端只能回「会话正在执行中」。新消息开始 = 上一段作废。
    abortController?.abort()
    const controller = new AbortController()
    abortController = controller
    const token = getToken()
    // 构建动态上下文（含设计器当前 schema 等）
    const dynamicContext = options.getContext ? options.getContext() : {}
    const body: Record<string, unknown> = {
      scenario,
      message: text,
      stream: true,
      context: { workspaceId: resolve(options.workspaceId), ...dynamicContext },
    }
    if (sessionId.value) body.sessionId = sessionId.value
    if (confirmCallId) body.confirmCallId = confirmCallId
    if (confirmAction) body.confirmAction = confirmAction

    try {
      const response = await fetch('/agent-api/api/v1/agent/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      if (!response.ok) {
        const errBody = await response.text().catch(() => '')
        throw new Error(`Agent ${response.status}: ${errBody || response.statusText}`)
      }

      const reader = response.body?.getReader()
      if (!reader) throw new Error('No response body')

      const decoder = new TextDecoder()
      let buffer = ''

      for (;;) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        // 解析 SSE 帧
        const frames = buffer.split('\n\n')
        buffer = frames.pop() || ''

        for (const frame of frames) {
          if (!frame.trim() || frame.startsWith(':')) continue // heartbeat

          const lines = frame.split('\n')
          let eventType = ''
          let eventData = ''

          for (const line of lines) {
            if (line.startsWith('event: ')) eventType = line.slice(7)
            if (line.startsWith('data: ')) eventData = line.slice(6)
          }

          if (!eventData) continue

          try {
            const data = JSON.parse(eventData)
            handleSseEvent(eventType as SseEventType, data)
          } catch {
            // malformed JSON, skip
          }
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        const msg = err.message || ''
        error.value = msg.includes('Failed to fetch') || msg.includes('NetworkError')
          ? '网络连接失败，请检查 Agent(3002) 和 Server(3000) 是否都已启动'
          : msg || '请求失败'
        // 移除空的 assistant 占位消息：只管本轮新建的那条，续跑轮没有占位、
        // 持有的消息上还挂着检查点卡片，误删会把用户正在看的那条一起清掉。
        if (createdPlaceholder && currentAssistantMsg
            && !currentAssistantMsg.content && !currentAssistantMsg.toolCalls?.length) {
          messages.value = messages.value.filter((m) => m.id !== currentAssistantMsg!.id)
        }
      }
    } finally {
      // 只清理自己那一份：被新一轮抢占的旧请求退出时，不能把新请求的
      // loading 状态、打字动画锚点和取消句柄一起抹掉。
      if (abortController === controller) {
        isLoading.value = false
        activeMessageId.value = null
        abortController = null
      }
      persistToLocal()
    }
  }

  function handleSseEvent(type: SseEventType, data: any) {
    switch (type) {
      case 'session':
        sessionId.value = data.sessionId
        break

      case 'status':
        status.value = {
          agent: data.agent || '',
          phase: data.phase || '',
          products: data.products || [],
          todo: data.todo || [],
        }
        break

      case 'delta':
        if (currentAssistantMsg && data.content) {
          const msg = target()
          if (msg) msg.content += data.content
        }
        break

      case 'tool_start':
        if (currentAssistantMsg) {
          const msg = target()
          if (msg) {
            msg.toolCalls = msg.toolCalls || []
            msg.toolCalls.push({
              callId: data.callId,
              tool: data.tool,
              status: 'running',
            })
          }
        }
        break

      case 'tool_result':
        {
          // 工具调用可能属于上一轮的消息（确认后才会执行），所以跨消息查找。
          // 优先找还在 running 的那条，避免命中已被答复的检查点卡片。
          const tc = findToolCall(data.callId, 'running') || findToolCall(data.callId)
          if (tc) {
            tc.status = data.ok ? 'done' : 'error'
            tc.summary = data.summary
          }
        }
        break

      case 'confirm_required':
        {
          const msg = target()
          if (msg) {
            msg.toolCalls = msg.toolCalls || []
            msg.toolCalls.push({
              callId: data.callId,
              tool: data.tool,
              status: 'confirming',
              summary: data.summary,
              prompt: data.prompt,
              risk: data.risk,
              options: data.options,
            })
            // 检查点的依据：待审产物复用预览卡片渲染（只有 langgraph 下发）
            if (data.artifact) msg.result = data.artifact
          }
        }
        break

      case 'message':
        {
          const msg = target()
          if (msg) {
            msg.content = data.content
            msg.result = data.result
          }
          if (options.onMessage && msg) {
            options.onMessage({ ...msg })
          }
        }
        break

      case 'error':
        // RETRY/DEGRADE 是内部修正不显示，只显示最终失败
        if (data.code !== 'RETRY' && data.code !== 'RETRYING' && data.code !== 'DEGRADE') {
          error.value = data.message
        }
        break

      case 'done':
        if (data.usage) {
          usage.value = {
            inputTokens: data.usage.inputTokens || 0,
            outputTokens: data.usage.outputTokens || 0,
            alert: !!data.usageAlert,
          }
        }
        // 本条回答的 token（阶段 4）：中断轮先给「已跑部分」，续跑轮再覆盖成整轮值。
        // 错误分支没有 turnUsage → 保持 undefined，前端不显示。
        if (data.turnUsage) {
          const msg = target()
          if (msg) msg.usage = { ...data.turnUsage }
        }
        status.value = null
        persistToLocal()
        break
    }
  }

  /** 跨消息查找某个工具调用（确认/续跑会让同一次调用横跨两条消息） */
  function findToolCall(callId: string, status?: string): AgentToolCall | null {
    for (const msg of messages.value) {
      const hit = msg.toolCalls?.find((t) => t.callId === callId && (!status || t.status === status))
      if (hit) return hit
    }
    return null
  }

  /** 持有某个 chip 的那条消息——检查点回执要续写到它上面，而不是另起一条 */
  function findMessageByToolCall(callId: string): AgentMessage | null {
    for (const msg of messages.value) {
      if (msg.toolCalls?.some((t) => t.callId === callId)) return msg
    }
    return null
  }

  /** 用户答完检查点后立刻收掉按钮，不必等后端回话 */
  function markConfirmAnswered(callId: string, action?: string): void {
    const tc = findToolCall(callId, 'confirming')
    if (!tc) return
    tc.status = 'done'
    tc.summary = tc.options?.find((o) => o.value === action)?.label || '已答复'
  }

  /**
   * 把所有还挂着（confirming）的检查点标记为「已自动中断」。
   *
   * 由新消息触发：上一段的检查点已被后端按 abort 收尾，前端只剩视觉残留——
   * 若不清掉按钮，用户还能点进一段已被放弃的检查点，发出无主的回执。
   */
  function interruptPendingConfirms(): void {
    for (const msg of messages.value) {
      for (const tc of msg.toolCalls || []) {
        if (tc.status === 'confirming') {
          tc.status = 'interrupted'
          tc.summary = '已自动中断'
        }
      }
    }
  }

  /** 从响应式数组中获取最后一条 assistant 消息（确保响应式更新） */
  function getLastAssistant(): AgentMessage | null {
    const msgs = messages.value
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'assistant') return msgs[i]
    }
    return null
  }

  /**
   * 本轮事件该落到哪条消息。
   *
   * 续跑轮持有卡片的那条往往不是数组最后一条（例如从历史里恢复的旧线程，
   * 末尾已经挂着别的助手消息），按最后一条落点会让文字跑到卡片下面的新气泡里。
   */
  function target(): AgentMessage | null {
    return currentAssistantMsg ?? getLastAssistant()
  }

  function cancel() {
    if (abortController) {
      abortController.abort()
      abortController = null
      isLoading.value = false
    }
  }

  const LS_KEY = () => `agent_chat_${resolve(options.scenario)}`

  function persistToLocal() {
    try {
      const data = messages.value.slice(-50) // 保留最近50条
      localStorage.setItem(LS_KEY(), JSON.stringify(data))
      if (sessionId.value) localStorage.setItem(`${LS_KEY()}_sid`, sessionId.value)
    } catch { /* ignore quota errors */ }
  }

  function restoreFromLocal() {
    try {
      const raw = localStorage.getItem(LS_KEY())
      if (raw) {
        messages.value = JSON.parse(raw)
        sessionId.value = localStorage.getItem(`${LS_KEY()}_sid`) || null
      }
    } catch { /* ignore */ }
  }

  function clearMessages() {
    messages.value = []
    sessionId.value = null
    error.value = null
    usage.value = null
    try { localStorage.removeItem(LS_KEY()); localStorage.removeItem(`${LS_KEY()}_sid`) } catch { /* */ }
  }

  /**
   * 用服务端真实的待答状态校正从 localStorage 恢复出来的检查点卡片。
   *
   * 为什么必须有这一步：localStorage 快照是在上一轮 `done` 时写的。用户点「保存」后
   * 立刻退出/刷新时，这次确认还没写进快照，回来就会看到一张已经答过的可点卡片；
   * 再点一下，后端拿到的 callId 早已失效（幂等收尾已清掉 pending）。
   * 只保留与 metadata.pendingGraphInterrupt.callId 对得上的那张，其余标成已处理。
   */
  async function reconcilePendingConfirms(): Promise<void> {
    // 只校正调用时已经存在的卡片，避免慢请求把这一瞬间新收到的检查点误标失效
    const restored: AgentToolCall[] = []
    for (const msg of messages.value) {
      for (const tc of msg.toolCalls || []) {
        if (tc.status === 'confirming') restored.push(tc)
      }
    }
    if (!restored.length) return

    let pendingCallId: string | undefined
    const sid = sessionId.value
    if (sid) {
      try {
        const res = await fetch(`/agent-api/api/v1/agent/sessions/${sid}`, {
          headers: { Authorization: `Bearer ${getToken()}` },
        })
        if (!res.ok) return // 拿不到权威状态时不乱动，后端对失效回执也有兜底
        const body = await res.json()
        const data = body?.data || body
        pendingCallId = data?.metadata?.pendingGraphInterrupt?.callId
      } catch {
        return // 网络失败同上
      }
    }

    let changed = false
    for (const tc of restored) {
      if (tc.status === 'confirming' && tc.callId !== pendingCallId) {
        tc.status = 'interrupted'
        tc.summary = '已处理'
        changed = true
      }
    }
    if (changed) persistToLocal()
  }

  // 初始化时恢复
  restoreFromLocal()
  void reconcilePendingConfirms()

  async function loadSession(sessId: string) {
    const token = getToken()
    const res = await fetch(`/agent-api/api/v1/agent/sessions/${sessId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error(`Failed to load session: ${res.status}`)
    const body = await res.json()
    const data = body.data || body
    sessionId.value = data.id
    // 历史会话成本（阶段 4）：从落库的 metadata.usageTotals 恢复累计用量初值
    const totals = data.metadata?.usageTotals
    usage.value = totals
      ? { inputTokens: totals.inputTokens || 0, outputTokens: totals.outputTokens || 0, alert: false }
      : null
    messages.value = (data.messages || []).map((m: any) => ({
      id: nanoid(),
      role: m.role,
      content: m.content || '',
      toolCalls: (m.toolCalls || []).map((tc: any) => ({
        callId: tc.id || tc.callId,
        tool: tc.function?.name || tc.tool || tc.name || '',
        status: 'done',
        summary: '',
      })),
      result: m.content?.includes('"schema"') ? tryParseResult(m.content) : undefined,
      // 单条回答的 token 由后端随消息落库；刷新/翻历史后小字仍能显示
      usage: m.usage || undefined,
      timestamp: m.timestamp || Date.now(),
    }))
  }

  async function listSessions(): Promise<Array<{ id: string; scenario: string; messageCount: number; updatedAt: number }>> {
    const token = getToken()
    console.log('[listSessions] token length:', token.length)
    try {
      const res = await fetch('/agent-api/api/v1/agent/sessions', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        console.log('[listSessions] status:', res.status)
        return []
      }
      const body = await res.json()
      const list = body.data || body || []
      return Array.isArray(list) ? list : []
    } catch (err: any) {
      console.log('[listSessions] error:', err.message)
      return []
    }
  }

  function tryParseResult(content: string): Record<string, unknown> | undefined {
    try {
      // 非贪婪：历史内容里可能串了多段 JSON，贪婪匹配会把后面的一起吞进来导致解析失败
      const match = content.match(/\{[\s\S]*?"schema"[\s\S]*?\}/)
      return match ? JSON.parse(match[0]) : undefined
    } catch { return undefined }
  }

  return {
    messages: messages as any,
    isLoading: readonly(isLoading),
    activeMessageId: readonly(activeMessageId),
    status: readonly(status),
    sessionId: readonly(sessionId),
    error: readonly(error),
    usage: readonly(usage),
    sendMessage,
    cancel,
    clearMessages,
    loadSession,
    reconcilePendingConfirms,
    listSessions,
  }
}
