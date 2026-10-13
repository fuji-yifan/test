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

/** 人机协作检查点的一个可选答复项 */
export interface ConfirmOption {
  value: string
  label: string
  style?: 'primary' | 'default' | 'danger'
}

export interface ConfirmRequiredPayload {
  callId: string
  tool: string
  /**
   * 只在图里真算得出风险时才带：`afterTool` 类的业务检查点不是风险门，
   * 补一个假值等于假披露。运行时本来就可能不带，所以类型上也是可选。
   */
  risk?: 'low' | 'medium' | 'high' | 'critical'
  summary: string
  /** 检查点的提问文案（按钮文案在 options 里，不由前端硬编码） */
  prompt?: string
  kind?: 'checkpoint' | 'tool_confirm'
  options?: ConfirmOption[]
  /** 本次检查点要审的产物（与 message.result 同构，前端复用预览卡片渲染） */
  artifact?: Record<string, unknown>
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
  /** 会话累计用量超过软上限（阶段 4）：前端据此把用量徽标置为告警样式 */
  usageAlert?: boolean
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
