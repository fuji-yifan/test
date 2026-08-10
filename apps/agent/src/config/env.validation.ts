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

  if (errors.length > 0) {
    logger.error('Environment validation failed:')
    errors.forEach((e) => logger.error(`  - ${e}`))
    throw new Error(`Agent startup aborted: missing required env vars\n${errors.join('\n')}`)
  }

  logger.log('Environment validation passed')
}
