import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { postJson } from './http'
import type { PolicyDecision, PolicyDecisionType } from '../harness/policy-rules'

export interface PolicyCheckInput {
  tool: string
  args: Record<string, unknown>
  risk: string
  isWrite: boolean
  userId?: string
  workspaceId?: string
}

/**
 * 外部策略引擎适配器（阶段 6 / S3.1：Cerbos / OPA）。
 *
 * **env-gated，零基建 no-op**：未配置 `POLICY_ENGINE_URL` 时 `check()` 直接返回 `allow`、
 * **不发任何请求**；配了才把工具调用上下文按 OPA Data API 约定包成 `{input: ...}` POST 给 PDP，
 * 期望返回 `{decision, reason}`。OPA 的 `/v1/data/...` 会把策略返回值包在 `{"result": ...}` 里，
 * 这里自动解包（两种形状都认）。
 * 网络错误/非 2xx 默认 **fail-open（allow）**；`POLICY_ENGINE_FAIL_CLOSED=true` 时改 fail-closed。
 *
 * 与内置纯规则（`harness/policy-rules.ts`，S3.2，恒开）**叠加**：内置永远跑，本适配器是可选增强。
 */
@Injectable()
export class PolicyEngineService {
  private readonly logger = new Logger(PolicyEngineService.name)
  private readonly enabled: boolean
  private readonly url: string
  private readonly timeoutMs: number
  private readonly failClosed: boolean
  private readonly token?: string
  private warned = false

  constructor(private readonly config: ConfigService) {
    this.url = (config.get<string>('infra.policyEngineUrl') || '').trim()
    this.enabled = !!this.url
    this.timeoutMs = config.get<number>('infra.policyEngineTimeoutMs') ?? 2000
    this.failClosed = config.get<boolean>('infra.policyEngineFailClosed') ?? false
    this.token = (config.get<string>('infra.policyEngineToken') || '').trim() || undefined
  }

  /** 是否已配置外部策略引擎（供上层短路判断 / 日志）。 */
  get isEnabled(): boolean {
    return this.enabled
  }

  /** 问一次 PDP；未配置 → `allow` 且不发请求。 */
  async check(input: PolicyCheckInput): Promise<PolicyDecision> {
    if (!this.enabled) {
      return { decision: 'allow', reason: 'policy-engine-disabled', source: 'disabled' }
    }

    // OPA Data API 约定：策略拿到的 `input` 来自请求体的 `input` 字段。
    // 平铺发送会让 Rego 里 `input` 为 undefined（策略静默全部不命中），故这里必须包一层。
    const res = await postJson(
      this.url,
      {
        input: {
          principal: { id: input.userId, workspaceId: input.workspaceId },
          resource: { kind: 'tool', tool: input.tool, risk: input.risk, isWrite: input.isWrite },
          action: input.tool,
          args: input.args,
        },
      },
      this.timeoutMs,
      this.token ? { authorization: `Bearer ${this.token}` } : undefined,
    )

    if (!res) return this.failSafe('unreachable')
    if (res.status < 200 || res.status >= 300) return this.failSafe(`http-${res.status}`)

    const json = unwrapPdpResponse(res.json)
    const decision = json?.decision
    if (isDecision(decision)) {
      return {
        decision,
        reason: typeof json?.reason === 'string' ? json.reason : 'policy-engine',
        source: 'external',
      }
    }
    // 响应格式不符 → 视作「无判定」，放行（除非 fail-closed）
    return this.failClosed
      ? { decision: 'deny', reason: 'malformed-response', source: 'external' }
      : { decision: 'allow', reason: 'no-decision', source: 'external' }
  }

  private failSafe(reason: string): PolicyDecision {
    this.warnOnce(reason)
    return this.failClosed
      ? { decision: 'deny', reason: `policy-engine-${reason}`, source: 'external' }
      : { decision: 'allow', reason: `policy-engine-${reason}`, source: 'external' }
  }

  private warnOnce(reason: string): void {
    if (this.warned) return
    this.warned = true
    this.logger.warn(
      `策略引擎不可用（${reason}），后续静默：${this.failClosed ? 'fail-closed（拒绝）' : 'fail-open（放行）'}`,
    )
  }
}

function isDecision(v: unknown): v is PolicyDecisionType {
  return v === 'allow' || v === 'deny' || v === 'requireConfirm' || v === 'warn'
}

/**
 * 兼容两种 PDP 响应形状：
 * - 扁平 `{decision, reason}`（自研/代理）；
 * - OPA `/v1/data/<pkg>/<rule>` 的 `{result: {decision, reason}}`。
 */
function unwrapPdpResponse(raw: unknown): { decision?: unknown; reason?: unknown } | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const obj = raw as Record<string, unknown>
  const inner = obj.result && typeof obj.result === 'object' ? obj.result : obj
  return inner as { decision?: unknown; reason?: unknown }
}
