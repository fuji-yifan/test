import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ChatDeepSeek } from '@langchain/deepseek'
import type { AIMessage } from '@langchain/core/messages'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { CircuitBreakerOpenError } from './llm.types'
import { TimeoutError } from '../harness/timeout'

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

  constructor(private readonly config: ConfigService) {
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

  /** 原始模型（用于直接 invoke/stream） */
  get chat(): ChatDeepSeek {
    return this.model
  }

  /** 绑定工具后的模型，产出带 tool_calls 的 AIMessage */
  withTools(tools: StructuredToolInterface[]): BoundGraphModel {
    const bound = this.model.bindTools(tools)
    return {
      invoke: async (messages, options) => {
        this.checkBreaker()
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
      },
    }
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
