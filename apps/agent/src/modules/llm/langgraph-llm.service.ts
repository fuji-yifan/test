import { Injectable, Logger, Optional } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ChatDeepSeek } from '@langchain/deepseek'
import type { AIMessage } from '@langchain/core/messages'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { CircuitBreakerOpenError } from './llm.types'
import { TimeoutError } from '../harness/timeout'
import { TracingService } from '../infra/tracing.service'
import { GuardrailsService, GuardrailBlockedError } from '../infra/guardrails.service'

/** 绑定工具后的模型；`invoke` 外面包了一层熔断 */
export interface BoundGraphModel {
  invoke(messages: unknown[], options?: Record<string, unknown>): Promise<AIMessage>
}

/**
 * 平台唯一的 LLM 接入层。
 *
 * 走 @langchain/deepseek 的 ChatDeepSeek，图节点直接消费它产出的 AIMessage.tool_calls。
 */
@Injectable()
export class LangGraphLlmService {
  private readonly logger = new Logger(LangGraphLlmService.name)
  private readonly model: ChatDeepSeek

  /** 熔断器：连续失败到阈值后短时间内直接拒绝，避免上游挂了还一直打 */
  private failures = 0
  private openUntil = 0
  private static readonly BREAKER_THRESHOLD = 5
  private static readonly BREAKER_RESET_MS = 30000

  constructor(
    private readonly config: ConfigService,
    /** 链路追踪（S2.3，可选注入：未配 endpoint 即零外呼）。 */
    @Optional() private readonly tracing?: TracingService,
    /** 输入/输出护栏（S5.2，可选注入：未配 sidecar 即直通）。 */
    @Optional() private readonly guardrails?: GuardrailsService,
  ) {
    const apiKey = this.config.get<string>('deepseek.apiKey')
    if (!apiKey) {
      throw new Error('DEEPSEEK_API_KEY 未配置，无法初始化 LangGraph LLM')
    }
    this.model = new ChatDeepSeek({
      apiKey,
      model: this.config.get<string>('deepseek.model') || 'deepseek-chat',
      temperature: 0,
      maxTokens: this.config.get<number>('context.maxOutputTokens') || 2048,
      configuration: {
        baseURL: this.config.get<string>('deepseek.baseURL') || 'https://api.deepseek.com',
      },
    })
    this.logger.log(`LangGraph LLM 已初始化: model=${this.config.get('deepseek.model')}`)
  }

  /**
   * 原始模型入口（router / 记忆提取等直接用原始模型的地方）。
   *
   * 返回一个**薄代理**：`invoke` 接进 `invokeChat`（熔断 + 可选 span），其余方法原样委托真实模型。
   * 保留 `this.llm.chat.invoke(...)` 的既有调用写法 —— 既有单测 mock 的正是 `chat.invoke`，
   * 故对测试透明；生产路径上则补齐了原本缺失的熔断与追踪。
   */
  get chat(): ChatDeepSeek {
    const model = this.model
    return new Proxy(model, {
      get: (target, prop, receiver) => {
        if (prop === 'invoke') {
          return (messages: unknown, options?: unknown) => this.invokeChat(messages, options)
        }
        return Reflect.get(target, prop, receiver)
      },
    })
  }

  /**
   * 原始模型调用（熔断 + 可选 span）。`chat.invoke(...)` 经代理落到这里。
   */
  async invokeChat(messages: unknown, options?: unknown): Promise<AIMessage> {
    this.checkBreaker()
    await this.guardInput(messages)
    const span = this.tracing?.startSpan('llm.chat', this.tracing.currentTraceId())
    const startedAt = Date.now()
    let res: AIMessage
    try {
      res = (await this.model.invoke(messages as never, options as never)) as AIMessage
      this.failures = 0
    } catch (err) {
      this.recordFailure()
      this.endSpan(span, { ok: false, durationMs: Date.now() - startedAt, error: (err as Error)?.message })
      throw err
    }
    // 护栏拦截不算 LLM 失败（不污染熔断计数），span 亦记为失败收口
    await this.guardOutput(res, span, startedAt)
    this.endSpan(span, { ok: true, durationMs: Date.now() - startedAt })
    return res
  }

  /** 绑定工具后的模型，产出带 tool_calls 的 AIMessage（外包一层可选 span） */
  withTools(tools: StructuredToolInterface[]): BoundGraphModel {
    const bound = this.model.bindTools(tools)
    return {
      invoke: async (messages, options) => {
        this.checkBreaker()
        await this.guardInput(messages)
        const span = this.tracing?.startSpan('llm.withTools', this.tracing.currentTraceId())
        const startedAt = Date.now()
        try {
          const res = await this.invokeBound(bound, messages, options)
          this.endSpan(span, { ok: true, durationMs: Date.now() - startedAt })
          return res
        } catch (err) {
          this.endSpan(span, { ok: false, durationMs: Date.now() - startedAt, error: (err as Error)?.message })
          throw err
        }
      },
    }
  }

  /** 输入护栏：未注入即直通；被拦抛 `GuardrailBlockedError`（调用侧自行降级）。 */
  private async guardInput(messages: unknown): Promise<void> {
    if (!this.guardrails) return
    const list = Array.isArray(messages) ? messages : [messages]
    const r = await this.guardrails.checkInput(list)
    if (!r.allowed) throw new GuardrailBlockedError('input', r.reason)
  }

  /** 输出护栏：未注入即直通；被拦记 span 为失败并抛 `GuardrailBlockedError`。 */
  private async guardOutput(
    res: AIMessage,
    span: ReturnType<TracingService['startSpan']> | undefined,
    startedAt: number,
  ): Promise<void> {
    if (!this.guardrails) return
    const text = typeof res.content === 'string' ? res.content : JSON.stringify(res.content ?? '')
    const r = await this.guardrails.checkOutput(text)
    if (!r.allowed) {
      this.endSpan(span, { ok: false, durationMs: Date.now() - startedAt, error: `guardrail:${r.reason}` })
      throw new GuardrailBlockedError('output', r.reason)
    }
  }

  /** withTools 的真实调用体（熔断记录 + 超时 abort 逻辑，与原实现等价）。 */
  private async invokeBound(
    bound: ReturnType<ChatDeepSeek['bindTools']>,
    messages: unknown[],
    options?: Record<string, unknown>,
  ): Promise<AIMessage> {
    const timeoutMs = this.llmTimeoutMs()
    // 无超时预算：原路径（保持单测与未配置时的行为不变）
    if (timeoutMs <= 0) {
      try {
        const res = await bound.invoke(messages as never, options as never)
        this.failures = 0
        return res as AIMessage
      } catch (err) {
        this.recordFailure()
        throw err
      }
    }

    // S7.1：超时后 abort 掉上游请求释放连接，并抛 TimeoutError（区别于 AbortError，
    // 后者仍按「被抢占」原样冒泡）。底层随后的 AbortError 用 catch 吞掉，避免 unhandled。
    const controller = new AbortController()
    const call = bound.invoke(messages as never, {
      ...(options as Record<string, unknown> | undefined),
      signal: controller.signal,
    } as never)
    call.catch(() => {})
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort()
        reject(new TimeoutError('LLM 调用', timeoutMs))
      }, timeoutMs)
    })
    try {
      const res = (await Promise.race([call, timeout])) as AIMessage
      this.failures = 0
      return res
    } catch (err) {
      this.recordFailure()
      throw err
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  /** 收口 span（未注入 tracing / 未配 endpoint → 零外呼）；fire-and-forget，不阻塞。 */
  private endSpan(span: ReturnType<TracingService['startSpan']> | undefined, end: { ok: boolean; durationMs: number; error?: string }): void {
    if (!this.tracing || !span) return
    void this.tracing.endSpan(span, end).catch(() => {})
  }

  /** LLM 调用超时上限（≤0 表示不设） */
  private llmTimeoutMs(): number {
    const v = this.config.get<number>('context.llmTimeoutMs')
    return typeof v === 'number' ? v : 60000
  }

  /** 熔断打开期间直接抛错，不再打上游；到点后半开放行一次 */
  private checkBreaker(): void {
    if (this.failures < LangGraphLlmService.BREAKER_THRESHOLD) return
    if (Date.now() < this.openUntil) throw new CircuitBreakerOpenError()
    this.failures = 0
  }

  private recordFailure(): void {
    this.failures++
    if (this.failures >= LangGraphLlmService.BREAKER_THRESHOLD) {
      this.openUntil = Date.now() + LangGraphLlmService.BREAKER_RESET_MS
      this.logger.warn(
        `LLM 连续失败 ${this.failures} 次，熔断 ${LangGraphLlmService.BREAKER_RESET_MS}ms`,
      )
    }
  }
}
