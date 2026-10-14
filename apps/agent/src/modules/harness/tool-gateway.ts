import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ToolRegistry } from './tool.registry'
import { SessionService } from '../session/session.service'
import { ToolResultCache } from '../cache/tool-cache.service'
import { AuditStore } from '../audit/audit.store'
import { withTimeout, isTimeoutError } from './timeout'
import { WRITE_TOOLS } from './write-tools'

export { WRITE_TOOLS }

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
  /** 归属会话（阶段 6 / S2）：用于凭 traceId/sessionId 追溯 */
  sessionId?: string
  /** 关联 id：优先复用 requestId，否则新生成 `tr_<nanoid>` */
  traceId: string
  /** 是否经过人工确认门（execute 路径 false，executeConfirmed 路径 true） */
  confirmed: boolean
  /** 工具执行耗时（ms），确认/缓存短路路径为 0 */
  durationMs: number
  timestamp: number
}

/** writeAudit 入参：traceId/confirmed/durationMs 之外的可选审计字段 */
type AuditInput = Omit<AuditEntry, 'id' | 'timestamp' | 'traceId'>

@Injectable()
export class ToolGateway {
  private readonly logger = new Logger(ToolGateway.name)
  /** 幂等性：已完成的 request_id 集合（内存，重启丢失） */
  private completedRequestIds: Set<string> = new Set()
  /** 审计日志环形缓冲（最多保留 1000 条，重启丢失；DB 落库见 AuditStore） */
  private auditLog: AuditEntry[] = []

  constructor(
    private registry: ToolRegistry,
    private sessionService: SessionService,
    private cache: ToolResultCache,
    private config: ConfigService,
    private audit: AuditStore,
  ) {}

  /** 工具风险等级（供上层——如直调端点的绕过防护——查询） */
  getRisk(name: string): 'low' | 'medium' | 'high' | 'critical' {
    return this.registry.getRisk(name)
  }

  /** 是否有副作用（写）工具：显式集合 ∪ 风险 ≥ medium */
  private isWrite(name: string): boolean {
    return WRITE_TOOLS.has(name) || this.registry.getRisk(name) !== 'low'
  }

  /** 工具执行超时上限（≤0 表示不设） */
  private toolTimeoutMs(): number {
    const v = this.config?.get<number>('context.toolTimeoutMs')
    return typeof v === 'number' ? v : 30000
  }

  /**
   * 工具网关执行流水线：
   * 参数校验 → 幂等检查 → 风险评级 → 确认门 → 执行 → 审计
   */
  async execute(
    toolName: string,
    args: Record<string, unknown>,
    opts?: { requestId?: string; userId?: string; workspaceId?: string; sessionId?: string },
  ): Promise<GatewayResult> {
    const tool = this.registry.get(toolName)
    if (!tool) {
      return { ok: false, error: `Unknown tool: ${toolName}`, summary: `Unknown tool: ${toolName}` }
    }

    // 幂等性检查：相同 request_id 不重复执行写操作
    if (opts?.requestId) {
      if (this.isWrite(toolName) && this.completedRequestIds.has(opts.requestId)) {
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
        sessionId: opts?.sessionId,
        confirmed: false,
        durationMs: 0,
      })

      return {
        ok: false,
        confirmRequired: true,
        confirmCallId: `confirm_${this.nanoid()}`,
        risk,
        summary,
      }
    }

    // 低风险直接执行。只读白名单工具先查缓存：命中即短路，跳过 registry.call（阶段 4 / 4.5）
    const workspaceId = opts?.workspaceId ?? ''
    const cached = await this.cache.get(toolName, workspaceId, args)
    if (cached) {
      this.logger.log(`Cache hit: ${toolName}`)
      await this.writeAudit({
        tool: toolName,
        args,
        ok: true,
        summary: cached.summary || 'CACHE_HIT',
        risk,
        userId: opts?.userId,
        workspaceId: opts?.workspaceId,
        requestId: opts?.requestId,
        sessionId: opts?.sessionId,
        confirmed: false,
        durationMs: 0,
      })
      return { ok: true, summary: cached.summary, result: cached.result }
    }

    let result: Awaited<ReturnType<ToolRegistry['call']>>
    const startedAt = Date.now()
    try {
      result = await withTimeout(
        this.registry.call(toolName, args),
        this.toolTimeoutMs(),
        `工具 ${toolName}`,
      )
    } catch (err) {
      // 超时按可恢复失败收口（进重试 / 降级级联），不把整轮挂死
      if (isTimeoutError(err)) {
        this.logger.warn(`工具执行超时：${toolName}（${this.toolTimeoutMs()}ms）`)
        result = { ok: false, summary: `工具 ${toolName} 执行超时`, error: 'timeout' }
      } else {
        throw err
      }
    }

    // 幂等标记：成功的写操作
    if (result.ok && opts?.requestId && this.isWrite(toolName)) {
      this.completedRequestIds.add(opts.requestId)
    }

    // 缓存维护：只读命中结果写缓存；写工具成功后失效本工作空间缓存
    if (result.ok) {
      if (this.cache.isWrite(toolName)) {
        await this.cache.invalidateWorkspace(workspaceId)
      } else {
        await this.cache.set(toolName, workspaceId, args, {
          summary: result.summary || 'OK',
          result: result.data,
        })
      }
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
      sessionId: opts?.sessionId,
      confirmed: false,
      durationMs: Date.now() - startedAt,
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
    opts?: { requestId?: string; userId?: string; workspaceId?: string; sessionId?: string },
  ): Promise<GatewayResult> {
    const risk = this.registry.getRisk(toolName)

    let result: Awaited<ReturnType<ToolRegistry['call']>>
    const startedAt = Date.now()
    try {
      result = await withTimeout(
        this.registry.call(toolName, args),
        this.toolTimeoutMs(),
        `工具 ${toolName}`,
      )
    } catch (err) {
      if (isTimeoutError(err)) {
        this.logger.warn(`工具执行超时：${toolName}（${this.toolTimeoutMs()}ms）`)
        result = { ok: false, summary: `工具 ${toolName} 执行超时`, error: 'timeout' }
      } else {
        throw err
      }
    }

    if (result.ok && opts?.requestId) {
      this.completedRequestIds.add(opts.requestId)
    }

    // 确认后执行的都是写路径：成功后失效本工作空间缓存（只失效、不写缓存）
    if (result.ok) {
      await this.cache.invalidateWorkspace(opts?.workspaceId ?? '')
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
      sessionId: opts?.sessionId,
      confirmed: true,
      durationMs: Date.now() - startedAt,
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

  private async writeAudit(entry: AuditInput): Promise<void> {
    const traceId = entry.requestId || `tr_${this.nanoid(12)}`
    const record: AuditEntry = {
      ...entry,
      traceId,
      id: `audit_${this.nanoid()}`,
      timestamp: Date.now(),
    }

    // 内存环形缓冲
    this.auditLog.push(record)
    if (this.auditLog.length > 1000) {
      this.auditLog = this.auditLog.slice(-1000)
    }

    // 落库持久化（阶段 6 / S2）：fire-and-forget，不阻塞工具关键路径；
    // 无库 / 未配置 workspaceId / 写入失败一律在 AuditStore 内 no-op 降级（只 warn）。
    if (this.config?.get<boolean>('audit.enabled') !== false) {
      void this.audit
        .record({
          traceId,
          sessionId: entry.sessionId,
          userId: entry.userId,
          workspaceId: entry.workspaceId ?? '',
          toolName: entry.tool,
          riskLevel: entry.risk,
          confirmed: entry.confirmed,
          durationMs: entry.durationMs,
          ok: entry.ok,
          summary: entry.summary,
          args: entry.args,
        })
        .catch(() => {})
    }

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
