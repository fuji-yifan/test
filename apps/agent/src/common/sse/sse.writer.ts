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

/** 人机协作检查点的一个可选答复项 */
export interface ConfirmOption {
  value: string
  label: string
  style?: 'primary' | 'default' | 'danger'
  /**
   * 消歧候选的预览数据（仅 disambiguate 的候选可能带）。
   * 同名表光看标题分不出来，前端据此在候选行上直接打开预览。
   */
  form?: {
    title?: string
    schema?: unknown
    formId?: string
    fieldCount?: number
  }
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
