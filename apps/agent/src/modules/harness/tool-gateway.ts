import { Injectable, Logger } from '@nestjs/common'
import { ToolRegistry } from './tool.registry'
import { SessionService } from '../session/session.service'

export interface GatewayResult {
  ok: boolean
  result?: unknown
  summary?: string
  error?: string
  confirmRequired?: boolean
  confirmCallId?: string
  risk?: 'low' | 'medium' | 'high' | 'critical'
}

interface AuditEntry {
  id: string
  tool: string
  args: Record<string, unknown>
  ok: boolean
  summary: string
  risk: string
  userId?: string
  workspaceId?: string
  requestId?: string
  timestamp: number
}

@Injectable()
export class ToolGateway {
  private readonly logger = new Logger(ToolGateway.name)
  /** 幂等性：已完成的 request_id 集合（内存，重启丢失） */
  private completedRequestIds: Set<string> = new Set()
  /** 审计日志环形缓冲（最多保留 1000 条） */
  private auditLog: AuditEntry[] = []

  constructor(
    private registry: ToolRegistry,
    private sessionService: SessionService,
  ) {}

  /**
   * 工具网关执行流水线：
   * 参数校验 → 幂等检查 → 风险评级 → 确认门 → 执行 → 审计
   */
  async execute(
    toolName: string,
    args: Record<string, unknown>,
    opts?: { requestId?: string; userId?: string; workspaceId?: string },
  ): Promise<GatewayResult> {
    const tool = this.registry.get(toolName)
    if (!tool) {
      return { ok: false, error: `Unknown tool: ${toolName}`, summary: `Unknown tool: ${toolName}` }
    }

    // 幂等性检查：相同 request_id 不重复执行写操作
    if (opts?.requestId) {
      const risk = this.registry.getRisk(toolName)
      if (risk !== 'low' && this.completedRequestIds.has(opts.requestId)) {
        this.logger.log(`Idempotency: skipping duplicate request ${opts.requestId} for ${toolName}`)
        return {
          ok: true,
          summary: `Skipped (idempotent): ${toolName} already executed for request ${opts.requestId}`,
        }
      }
    }

    // 风险评级
    const risk = this.registry.getRisk(toolName)

    // medium+ 风险需确认门
    if (risk !== 'low') {
      const summary = `Tool "${toolName}" requires confirmation (risk: ${risk})\nArgs: ${JSON.stringify(args, null, 2)}`
      this.logger.log(`Confirm required: ${toolName} (risk=${risk})`)

      // 审计：记录确认请求
      await this.writeAudit({
        tool: toolName,
        args,
        ok: false,
        summary: `AWAITING_CONFIRMATION (risk: ${risk})`,
        risk,
        userId: opts?.userId,
        workspaceId: opts?.workspaceId,
        requestId: opts?.requestId,
      })

      return {
        ok: false,
        confirmRequired: true,
        confirmCallId: `confirm_${this.nanoid()}`,
        risk,
        summary,
      }
    }

    // 低风险直接执行
    const result = await this.registry.call(toolName, args)

    // 幂等标记：成功的写操作
    if (result.ok && opts?.requestId && risk !== 'low') {
      this.completedRequestIds.add(opts.requestId)
    }

    // 审计
    await this.writeAudit({
      tool: toolName,
      args,
      ok: result.ok,
      summary: result.summary || 'OK',
      risk,
      userId: opts?.userId,
      workspaceId: opts?.workspaceId,
      requestId: opts?.requestId,
    })

    return {
      ok: result.ok,
      result: result.data,
      summary: result.summary,
      error: result.error,
    }
  }

  /** 用户确认后执行（跳过确认门 + 幂等检查） */
  async executeConfirmed(
    toolName: string,
    args: Record<string, unknown>,
    opts?: { requestId?: string; userId?: string; workspaceId?: string },
  ): Promise<GatewayResult> {
    const risk = this.registry.getRisk(toolName)

    const result = await this.registry.call(toolName, args)

    if (result.ok && opts?.requestId) {
      this.completedRequestIds.add(opts.requestId)
    }

    await this.writeAudit({
      tool: toolName,
      args,
      ok: result.ok,
      summary: result.summary || 'CONFIRMED',
      risk,
      userId: opts?.userId,
      workspaceId: opts?.workspaceId,
      requestId: opts?.requestId,
    })

    return {
      ok: result.ok,
      result: result.data,
      summary: result.summary,
      error: result.error,
    }
  }

  /** 获取审计日志（用于调试/监控） */
  getAuditLog(limit = 100): AuditEntry[] {
    return this.auditLog.slice(-limit).reverse()
  }

  /** 检查 request_id 是否已处理 */
  isCompleted(requestId: string): boolean {
    return this.completedRequestIds.has(requestId)
  }

  // ==================== 内部方法 ====================

  private async writeAudit(entry: Omit<AuditEntry, 'id' | 'timestamp'>): Promise<void> {
    const record: AuditEntry = {
      ...entry,
      id: `audit_${this.nanoid()}`,
      timestamp: Date.now(),
    }

    // 内存环形缓冲
    this.auditLog.push(record)
    if (this.auditLog.length > 1000) {
      this.auditLog = this.auditLog.slice(-1000)
    }

    // 持久化到 session metadata（如果提供了 sessionId 则通过 args 传递）
    // 注意：Gateway 不持有 session 引用，实际持久化由 Agent 的 onToolSuccess 钩子完成

    this.logger.log(
      `[AUDIT] ${record.tool} | ok=${record.ok} | risk=${record.risk} | requestId=${record.requestId || 'N/A'}`,
    )
  }

  private nanoid(length = 8): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
    let result = ''
    for (let i = 0; i < length; i++) {
      result += chars[Math.floor(Math.random() * chars.length)]
    }
    return result
  }
}
