// LLM 模块类型定义

export interface ToolDef {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export class CircuitBreakerOpenError extends Error {
  constructor() {
    super('Circuit breaker is open — DeepSeek API temporarily unavailable')
    this.name = 'CircuitBreakerOpenError'
  }
}
