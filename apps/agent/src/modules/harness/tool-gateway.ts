import { Injectable, Logger, Optional } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ToolRegistry } from './tool.registry'
import { SessionService } from '../session/session.service'
import { ToolResultCache } from '../cache/tool-cache.service'
import { AuditStore } from '../audit/audit.store'
import { withTimeout, isTimeoutError } from './timeout'
import { WRITE_TOOLS } from './write-tools'
import { combineDecisions, evaluateBuiltinPolicy, type PolicyDecision } from './policy-rules'
import { PolicyEngineService } from '../infra/policy-engine.service'
import { TracingService, normalizeTraceId } from '../infra/tracing.service'

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
  /** 关联 id：整轮统一 traceId 的 32-hex（与 span 同源）；无轮上下文时由 requestId 派生，见 normalizeTraceId */
  traceId: string
  /** 是否经过人工确认门（execute 路径 false，executeConfirmed 路径 true） */
  confirmed: boolean
  /** 工具执行耗时（ms），确认/缓存短路路径为 0 */
  durationMs: number
  timestamp: number
  /** 策略备注（阶段 6 / S3.2，如 pii_access）：随审计 details.note 落库 */
  auditNote?: string
}

/** writeAudit 入参：id/timestamp 之外的可选审计字段；`traceId` 可选传入（与 span 同源） */
type AuditInput = Omit<AuditEntry, 'id' | 'timestamp' | 'traceId'> & { traceId?: string }

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
    /** 外部策略引擎（S3.1，可选注入：未配置即 no-op）。内置纯规则（S3.2）恒跑、不依赖它。 */
    @Optional() private policy?: PolicyEngineService,
    /** 链路追踪（S2.3，可选注入：未配 endpoint 即零外呼；traceId 恒贯通）。 */
    @Optional() private tracing?: TracingService,
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

    // 策略门（阶段 6 / S3.1+S3.2）：内置纯规则恒跑 + 可选外部 PDP；deny 直接拦、requireConfirm 兜底确认
    const policyDecision = await this.evaluatePolicy(toolName, args, risk, opts)
    if (policyDecision.decision === 'deny') {
      this.logger.warn(`Policy denied: ${toolName} (${policyDecision.reason})`)
      await this.writeAudit({
        tool: toolName,
        args,
        ok: false,
        summary: `POLICY_DENIED (${policyDecision.reason})`,
        risk,
        userId: opts?.userId,
        workspaceId: opts?.workspaceId,
        requestId: opts?.requestId,
        sessionId: opts?.sessionId,
        confirmed: false,
        durationMs: 0,
      })
      return { ok: false, error: 'policy_denied', summary: `策略拒绝：${policyDecision.reason}`, risk }
    }
    if (policyDecision.decision === 'requireConfirm' && risk === 'low') {
      // 仅在内置兜底命中（删除类工具风险被误评 low）时触发；medium+ 交给下方风险门
      const summary = `Tool "${toolName}" requires confirmation (policy: ${policyDecision.reason})`
      await this.writeAudit({
        tool: toolName,
        args,
        ok: false,
        summary: `AWAITING_CONFIRMATION (policy: ${policyDecision.reason})`,
        risk,
        userId: opts?.userId,
        workspaceId: opts?.workspaceId,
        requestId: opts?.requestId,
        sessionId: opts?.sessionId,
        confirmed: false,
        durationMs: 0,
      })
      return { ok: false, confirmRequired: true, confirmCallId: `confirm_${this.nanoid()}`, risk, summary }
    }
    const policyNote = policyDecision.decision === 'warn' ? policyDecision.auditNote : undefined

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
        auditNote: policyNote,
      })
      return { ok: true, summary: cached.summary, result: cached.result }
    }

    // S2.3：traceId 与审计同源；span 包住真正的工具执行
    const traceId = this.resolveTraceId(opts?.requestId)
    const span = this.tracing?.startSpan(`tool.${toolName}`, traceId, {
      risk,
      workspaceId: opts?.workspaceId,
      userId: opts?.userId,
    })

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

    // S2.3：收口 span（未配 OTLP → 零外呼）；fire-and-forget，不阻塞
    if (this.tracing && span) {
      void this.tracing
        .endSpan(span, { ok: result.ok, durationMs: Date.now() - startedAt, error: result.error })
        .catch(() => {})
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
      auditNote: policyNote,
      traceId,
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

    // 策略门（确认后路径）：只处理 deny（requireConfirm 已被用户确认，不再拦）
    const policyDecision = await this.evaluatePolicy(toolName, args, risk, opts)
    if (policyDecision.decision === 'deny') {
      this.logger.warn(`Policy denied (confirmed): ${toolName} (${policyDecision.reason})`)
      await this.writeAudit({
        tool: toolName,
        args,
        ok: false,
        summary: `POLICY_DENIED (${policyDecision.reason})`,
        risk,
        userId: opts?.userId,
        workspaceId: opts?.workspaceId,
        requestId: opts?.requestId,
        sessionId: opts?.sessionId,
        confirmed: true,
        durationMs: 0,
      })
      return { ok: false, error: 'policy_denied', summary: `策略拒绝：${policyDecision.reason}`, risk }
    }
    const policyNote = policyDecision.decision === 'warn' ? policyDecision.auditNote : undefined

    // S2.3：traceId 与审计同源；span 包住确认后的真正执行
    const traceId = this.resolveTraceId(opts?.requestId)
    const span = this.tracing?.startSpan(`tool.${toolName}.confirmed`, traceId, {
      risk,
      workspaceId: opts?.workspaceId,
      userId: opts?.userId,
    })

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

    if (this.tracing && span) {
      void this.tracing
        .endSpan(span, { ok: result.ok, durationMs: Date.now() - startedAt, error: result.error })
        .catch(() => {})
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
      auditNote: policyNote,
      traceId,
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

  /**
   * 策略判定：内置纯规则（恒跑，S3.2）∪ 可选外部 PDP（S3.1）。取最严者。
   * 外部未配置时 `this.policy` 为空 → 只跑内置，零外呼。
   */
  private async evaluatePolicy(
    toolName: string,
    args: Record<string, unknown>,
    risk: string,
    opts?: { userId?: string; workspaceId?: string },
  ): Promise<PolicyDecision> {
    const isWrite = this.isWrite(toolName)
    const builtin = evaluateBuiltinPolicy({
      tool: toolName,
      args,
      risk,
      workspaceId: opts?.workspaceId,
      isWrite,
      bulkThreshold: this.config?.get<number>('infra.policyBulkThreshold'),
    })
    const external = this.policy
      ? await this.policy.check({
          tool: toolName,
          args,
          risk,
          isWrite,
          userId: opts?.userId,
          workspaceId: opts?.workspaceId,
        })
      : null
    return combineDecisions(builtin, external)
  }

  /**
   * S2.3：span 与审计共用的 traceId。处于整轮上下文时取该轮统一值（归一化由 TracingService 负责）；
   * 未注入 tracing（可选依赖）时退回纯函数归一 —— 两条路径都恒为 32-hex。
   */
  private resolveTraceId(requestId?: string): string {
    return this.tracing ? this.tracing.currentTraceId(requestId) : normalizeTraceId(requestId)
  }

  private async writeAudit(entry: AuditInput): Promise<void> {
    // 显式传入的 traceId 优先（可能来自已收口的 span），其次 requestId，最后随机
    const traceId = normalizeTraceId(entry.traceId || entry.requestId)
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
          note: entry.auditNote,
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
