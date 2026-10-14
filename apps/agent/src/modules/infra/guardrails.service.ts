import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { postJson } from './http'

export interface GuardrailResult {
  allowed: boolean
  reason?: string
  source: 'disabled' | 'nemo'
}

/** 护栏拦截：输入/输出被 sidecar 判定为不允许。调用侧按各自策略降级（router 返 null / extractor 返 [] / subgraph catch）。 */
export class GuardrailBlockedError extends Error {
  constructor(
    public readonly stage: 'input' | 'output',
    public readonly reason?: string,
  ) {
    super(`Guardrail blocked (${stage}): ${reason || 'no reason'}`)
    this.name = 'GuardrailBlockedError'
  }
}

/**
 * 输入/输出护栏适配器（阶段 6 / S5.2，NeMo Guardrails sidecar）。
 *
 * **env-gated，零基建 no-op**：未配 `NEMO_GUARDRAILS_URL` → 两个 check 都返回 `{allowed:true}`、
 * **不发任何请求**（等于没这层）；配了才把输入文本 / 输出文本 POST 给 sidecar，期望 `{allowed, reason?}`。
 * 传输失败（超时/网络/非 2xx）→ **fail-open（放行）+ warnOnce**，绝不因护栏 sidecar 抖动而卡住主流程。
 *
 * 与纯函数 `graph/untrusted.ts` 的 `wrapUntrusted`（S5.1，提示词侧防注入）**互补**，不重复实现。
 */
@Injectable()
export class GuardrailsService {
  private readonly logger = new Logger(GuardrailsService.name)
  private readonly enabled: boolean
  private readonly url: string
  private readonly timeoutMs: number
  private warned = false

  constructor(private readonly config: ConfigService) {
    this.url = (config.get<string>('infra.guardrailsUrl') || '').trim()
    this.enabled = !!this.url
    this.timeoutMs = config.get<number>('infra.guardrailsTimeoutMs') ?? 2000
  }

  get isEnabled(): boolean {
    return this.enabled
  }

  /** 检查一段输入（取最后一条 human 消息文本）。未配 → 放行且零外呼。 */
  async checkInput(messages: unknown[]): Promise<GuardrailResult> {
    const text = lastHumanText(messages)
    return this.check('input', text)
  }

  /** 检查一段输出文本。未配 → 放行且零外呼。 */
  async checkOutput(text: string): Promise<GuardrailResult> {
    return this.check('output', text)
  }

  private async check(stage: 'input' | 'output', text?: string): Promise<GuardrailResult> {
    if (!this.enabled) return { allowed: true, source: 'disabled' }
    if (!text || !text.trim()) return { allowed: true, reason: 'empty', source: 'nemo' }

    const res = await postJson(this.url, { stage, text }, this.timeoutMs)
    if (!res) return this.failOpen('unreachable')
    if (res.status < 200 || res.status >= 300) return this.failOpen(`http-${res.status}`)

    const json = res.json as { allowed?: unknown; reason?: unknown } | undefined
    if (json && json.allowed === false) {
      return {
        allowed: false,
        reason: typeof json.reason === 'string' ? json.reason : 'blocked',
        source: 'nemo',
      }
    }
    return { allowed: true, source: 'nemo' }
  }

  private failOpen(reason: string): GuardrailResult {
    this.warnOnce(reason)
    return { allowed: true, reason: `guardrails-${reason}`, source: 'nemo' }
  }

  private warnOnce(reason: string): void {
    if (this.warned) return
    this.warned = true
    this.logger.warn(`护栏 sidecar 不可用（${reason}），后续静默：fail-open（放行）`)
  }
}

/** 取最后一条 human 消息的文本（兼容 LangChain `_getType` 与普通 `type`）。 */
function lastHumanText(messages: unknown[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as { _getType?: () => string; type?: string; content?: unknown } | undefined
    if (!m) continue
    const type = typeof m._getType === 'function' ? m._getType() : m.type
    if (type !== 'human') continue
    return typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '')
  }
  return undefined
}
