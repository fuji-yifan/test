import { Response } from 'express'

// SSE 事件类型枚举
export enum SseEventType {
  SESSION = 'session',
  STATUS = 'status',
  META = 'meta',
  DELTA = 'delta',
  TOOL_START = 'tool_start',
  TOOL_RESULT = 'tool_result',
  CONFIRM_REQUIRED = 'confirm_required',
  MESSAGE = 'message',
  ERROR = 'error',
  DONE = 'done',
}

// SSE 事件 payload 类型
export interface SessionPayload {
  sessionId: string
}

export interface StatusPayload {
  agent: string
  phase: string
  todo: string[]
}

export interface MetaPayload {
  model: string
  requestId: string
  activeAgent: string
  tools: string[]
}

export interface DeltaPayload {
  content: string
}

export interface ToolStartPayload {
  callId: string
  tool: string
  args: Record<string, unknown>
}

export interface ToolResultPayload {
  callId: string
  tool: string
  ok: boolean
  summary: string
}

export interface ConfirmRequiredPayload {
  callId: string
  tool: string
  risk: 'low' | 'medium' | 'high' | 'critical'
  summary: string
}

export interface MessagePayload {
  role: 'assistant'
  content: string
  result?: unknown
}

export interface ErrorPayload {
  code: string
  message: string
}

export interface DonePayload {
  sessionId: string
  stopReason: string
  usage: { inputTokens: number; outputTokens: number }
}

// SSE 写入工具
export class SseWriter {
  private res: Response

  constructor(res: Response) {
    this.res = res
  }

  writeEvent(type: SseEventType, payload: Record<string, unknown>): void {
    this.res.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`)
  }

  writeHeartbeat(): void {
    this.res.write(': ping\n\n')
  }

  end(): void {
    this.res.end()
  }
}

// 心跳定时器
export function startHeartbeat(
  res: Response,
  intervalMs = 15000,
): { stop: () => void } {
  const timer = setInterval(() => {
    try {
      res.write(': ping\n\n')
    } catch {
      clearInterval(timer)
    }
  }, intervalMs)

  return {
    stop: () => clearInterval(timer),
  }
}
