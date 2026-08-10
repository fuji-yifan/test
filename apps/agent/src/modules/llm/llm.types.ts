// LLM 模块类型定义

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
  name?: string
}

export interface ToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export interface ToolResult {
  callId: string
  tool: string
  ok: boolean
  summary: string
  data?: unknown
}

export interface ToolDef {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface CompletionParams {
  messages: ChatMessage[]
  tools?: ToolDef[]
  maxTokens?: number
  temperature?: number
}

export interface CompletionResult {
  content: string | null
  toolCalls: ToolCall[]
  usage: { inputTokens: number; outputTokens: number }
}

export interface StreamChunk {
  type: 'delta' | 'tool_call'
  delta?: string
  toolCall?: Partial<ToolCall>
}

export class CircuitBreakerOpenError extends Error {
  constructor() {
    super('Circuit breaker is open — DeepSeek API temporarily unavailable')
    this.name = 'CircuitBreakerOpenError'
  }
}
