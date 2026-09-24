import { Logger } from '@nestjs/common'

export function validateEnv(): void {
  const errors: string[] = []
  const logger = new Logger('EnvValidation')

  if (!process.env.DEEPSEEK_API_KEY) {
    errors.push('DEEPSEEK_API_KEY is required')
  }
  if (!process.env.JWT_SECRET) {
    errors.push('JWT_SECRET is required (must match apps/server/.env)')
  }
  // 引擎开关拼错会被 `?? 'langgraph'` 之外的路径当成未知值静默放行（配置里是
  // `|| 'langgraph'` 只管「没配」，不管「配错」），症状是「新功能都不见了」而不是报错，
  // 所以在这里硬拦。合法值：legacy / langgraph（不配则用默认值）。
  const engine = process.env.AGENT_ENGINE
  if (engine && engine !== 'legacy' && engine !== 'langgraph') {
    errors.push(`AGENT_ENGINE must be "legacy" or "langgraph"（当前值："${engine}"）`)
  }

  if (errors.length > 0) {
    logger.error('Environment validation failed:')
    errors.forEach((e) => logger.error(`  - ${e}`))
    throw new Error(`Agent startup aborted: invalid env\n${errors.join('\n')}`)
  }

  logger.log('Environment validation passed')
}
