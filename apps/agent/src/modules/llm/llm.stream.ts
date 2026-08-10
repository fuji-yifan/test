import { Injectable, Logger } from '@nestjs/common'
import { LlmClient } from './llm.client'
import { ChatMessage, ToolDef, StreamChunk, CircuitBreakerOpenError } from './llm.types'

interface RetryPolicy {
  maxRetries: number
  baseDelayMs: number
  maxDelayMs: number
}

interface CircuitBreaker {
  failures: number
  threshold: number
  openUntil: number
  resetTimeoutMs: number
}

@Injectable()
export class LlmStreamService {
  private readonly logger = new Logger(LlmStreamService.name)
  private retry: RetryPolicy = {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 16000,
  }
  private breaker: CircuitBreaker = {
    failures: 0,
    threshold: 5,
    openUntil: 0,
    resetTimeoutMs: 30000,
  }

  constructor(private client: LlmClient) {}

  getModel(): string {
    return this.client.getModel()
  }

  /** Token 预算估算 (chars/4) */
  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4)
  }

  /** 检查 + 更新熔断器 */
  private checkBreaker(): void {
    if (this.breaker.failures >= this.breaker.threshold) {
      if (Date.now() < this.breaker.openUntil) {
        throw new CircuitBreakerOpenError()
      }
      // 超时后半开，重置
      this.breaker.failures = 0
    }
  }

  private recordSuccess(): void {
    this.breaker.failures = 0
  }

  private recordFailure(): void {
    this.breaker.failures++
    if (this.breaker.failures >= this.breaker.threshold) {
      this.breaker.openUntil = Date.now() + this.breaker.resetTimeoutMs
      this.logger.warn(`Circuit breaker OPEN for ${this.breaker.resetTimeoutMs}ms`)
    }
  }

  /** 带重试 + 熔断的流式调用 */
  async *streamWithRetry(params: {
    messages: ChatMessage[]
    tools?: ToolDef[]
    maxTokens?: number
    signal?: AbortSignal
  }): AsyncGenerator<StreamChunk> {
    this.checkBreaker()

    let lastError: Error | null = null

    for (let attempt = 0; attempt <= this.retry.maxRetries; attempt++) {
      try {
        for await (const chunk of this.client.streamComplete({
          messages: params.messages,
          tools: params.tools,
          maxTokens: params.maxTokens,
          signal: params.signal,
        })) {
          yield chunk
        }
        this.recordSuccess()
        return
      } catch (err: any) {
        lastError = err

        // 不重试的 HTTP 状态码
        if (err.status === 400 || err.status === 401 || err.status === 403) {
          this.logger.error(`Non-retryable error: ${err.status} ${err.message}`)
          throw err
        }

        // 客户端主动取消
        if (err.name === 'AbortError') {
          this.logger.log('Stream aborted by client')
          throw err
        }

        // 熔断器触发
        if (err instanceof CircuitBreakerOpenError) {
          throw err
        }

        // 最后一次不重试
        if (attempt === this.retry.maxRetries) {
          this.recordFailure()
          this.logger.error(`Exhausted ${this.retry.maxRetries + 1} retries: ${err.message}`)
          throw err
        }

        // 指数退避 + jitter
        const delay = Math.min(
          this.retry.baseDelayMs * Math.pow(2, attempt) + Math.random() * 1000,
          this.retry.maxDelayMs,
        )
        this.logger.warn(`LLM error (attempt ${attempt + 1}/${this.retry.maxRetries + 1}), retrying in ${Math.round(delay)}ms: ${err.message}`)
        await this.sleep(delay)
      }
    }

    this.recordFailure()
    throw lastError || new Error('LLM stream failed with unknown error')
  }

  /** 截断工具结果为摘要（控制上下文大小） */
  summarizeToolResult(result: string, maxChars: number): string {
    if (result.length <= maxChars) return result
    const half = Math.floor(maxChars / 2)
    return result.slice(0, half) + `\n... [truncated ${result.length - maxChars} chars] ...\n` + result.slice(-half)
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
