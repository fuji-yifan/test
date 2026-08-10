import { ref, readonly } from 'vue'

// SSE 事件类型
type SseEventType =
  | 'session' | 'status' | 'meta' | 'delta'
  | 'tool_start' | 'tool_result' | 'confirm_required'
  | 'message' | 'error' | 'done'

interface AgentMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  result?: unknown
  toolCalls?: { callId: string; tool: string; status: string; summary?: string }[]
  timestamp: number
}

interface AgentStatus {
  agent: string
  phase: string
  products: { type: string; agent: string; status: string }[]
  pendingConfirms: number
  todo: { id: string; text: string; status: string }[]
}

interface UseAgentChatOptions {
  scenario: string
  workspaceId: string
  getContext?: () => Record<string, unknown>
  onMessage?: (msg: AgentMessage) => void
  onStatus?: (status: AgentStatus) => void
  onConfirmRequired?: (callId: string, tool: string, summary: string) => void
}

export function useAgentChat(options: UseAgentChatOptions) {
  const messages = ref<AgentMessage[]>([])
  const isLoading = ref(false)
  const status = ref<AgentStatus | null>(null)
  const sessionId = ref<string | null>(null)
  const error = ref<string | null>(null)
  let abortController: AbortController | null = null
  let currentAssistantMsg: AgentMessage | null = null

  function nanoid() {
    return Math.random().toString(36).slice(2, 10)
  }

  function getToken(): string {
    return localStorage.getItem('access_token') || ''
  }

  async function sendMessage(text: string, confirmCallId?: string) {
    if (!text.trim() && !confirmCallId) return
    isLoading.value = true
    error.value = null

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

    abortController = new AbortController()
    const token = getToken()
    // 构建动态上下文（含设计器当前 schema 等）
    const dynamicContext = options.getContext ? options.getContext() : {}
    const body: Record<string, unknown> = {
      scenario: options.scenario,
      message: text,
      stream: true,
      context: { workspaceId: options.workspaceId, ...dynamicContext },
    }
    if (sessionId.value) body.sessionId = sessionId.value
    if (confirmCallId) body.confirmCallId = confirmCallId

    try {
      const response = await fetch('/agent-api/api/v1/agent/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
        signal: abortController.signal,
      })

      if (!response.ok) {
        const errBody = await response.text().catch(() => '')
        throw new Error(`Agent ${response.status}: ${errBody || response.statusText}`)
      }

      const reader = response.body?.getReader()
      if (!reader) throw new Error('No response body')

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
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
        error.value = err.message || 'Agent request failed'
        // 移除空的 assistant 占位消息
        const last = getLastAssistant()
        if (last && !last.content && !last.toolCalls?.length) {
          messages.value = messages.value.filter((m) => m.id !== last.id)
        }
      }
    } finally {
      isLoading.value = false
      abortController = null
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
          pendingConfirms: data.pendingConfirms || 0,
          todo: data.todo || [],
        }
        break

      case 'delta':
        if (currentAssistantMsg && data.content) {
          const msg = getLastAssistant()
          if (msg) msg.content += data.content
        }
        break

      case 'tool_start':
        if (currentAssistantMsg) {
          const msg = getLastAssistant()
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
          const msg = getLastAssistant()
          if (msg?.toolCalls) {
            const tc = msg.toolCalls.find((t) => t.callId === data.callId)
            if (tc) {
              tc.status = data.ok ? 'done' : 'error'
              tc.summary = data.summary
            }
          }
        }
        break

      case 'confirm_required':
        if (options.onConfirmRequired) {
          options.onConfirmRequired(data.callId, data.tool, data.summary)
        }
        {
          const msg = getLastAssistant()
          if (msg) {
            msg.toolCalls = msg.toolCalls || []
            msg.toolCalls.push({
              callId: data.callId,
              tool: data.tool,
              status: 'confirming',
              summary: data.summary,
            })
          }
        }
        break

      case 'message':
        {
          const msg = getLastAssistant()
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
        error.value = data.message
        {
          const msg = getLastAssistant()
          if (msg) {
            msg.content += `\n\n[错误] ${data.code}: ${data.message}`
          }
        }
        break

      case 'done':
        status.value = null
        persistToLocal()
        break
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

  function cancel() {
    if (abortController) {
      abortController.abort()
      abortController = null
      isLoading.value = false
    }
  }

  const LS_KEY = () => `agent_chat_${options.scenario}`

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
    try { localStorage.removeItem(LS_KEY()); localStorage.removeItem(`${LS_KEY()}_sid`) } catch { /* */ }
  }

  // 初始化时恢复
  restoreFromLocal()

  async function loadSession(sessId: string) {
    const token = getToken()
    const res = await fetch(`/agent-api/api/v1/agent/sessions/${sessId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error(`Failed to load session: ${res.status}`)
    const body = await res.json()
    const data = body.data || body
    sessionId.value = data.id
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
      const match = content.match(/\{[\s\S]*"schema"[\s\S]*\}/)
      return match ? JSON.parse(match[0]) : undefined
    } catch { return undefined }
  }

  return {
    messages: messages as any,
    isLoading: readonly(isLoading),
    status: readonly(status),
    sessionId: readonly(sessionId),
    error: readonly(error),
    sendMessage,
    cancel,
    clearMessages,
    loadSession,
    listSessions,
  }
}
