import { registerAs } from '@nestjs/config'

export default registerAs('agent', () => ({
  port: parseInt(process.env.AGENT_PORT || '3002', 10),
  nodeEnv: process.env.AGENT_NODE_ENV || 'development',
}))

export const deepseekConfig = registerAs('deepseek', () => ({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
  model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
}))

export const authConfig = registerAs('auth', () => ({
  jwtSecret: process.env.JWT_SECRET,
}))

export const serverConfig = registerAs('server', () => ({
  apiBaseURL: process.env.SERVER_API_BASE_URL || 'http://localhost:3000',
}))

export const corsConfig = registerAs('cors', () => ({
  origin: process.env.AGENT_CORS_ORIGIN || 'http://localhost:5173',
}))

export const throttleConfig = registerAs('throttle', () => ({
  rateLimit: parseInt(process.env.AGENT_RATE_LIMIT || '20', 10),
  maxConcurrent: parseInt(process.env.AGENT_MAX_CONCURRENT || '10', 10),
}))

export const sessionConfig = registerAs('session', () => ({
  store: process.env.SESSION_STORE || 'memory',
  ttlHours: parseInt(process.env.SESSION_TTL_HOURS || '6', 10),
}))

export const contextConfig = registerAs('context', () => ({
  maxToolResultChars: parseInt(process.env.MAX_TOOL_RESULT_CHARS || '8000', 10),
  maxIterations: parseInt(process.env.MAX_ITERATIONS || '8', 10),
  maxOutputTokens: parseInt(process.env.MAX_OUTPUT_TOKENS || '2048', 10),
  maxRetries: parseInt(process.env.MAX_RETRIES || '2', 10),
  maxDegrades: parseInt(process.env.MAX_DEGRADE || '1', 10),
}))

/**
 * 引擎开关：legacy = 手写 ReAct 编排；langgraph = LangGraph 图编排。
 *
 * 默认值必须是 langgraph：默认成 legacy 时，忘记配这个变量的环境会静默退回旧引擎，
 * 表现是「新功能（多表工作台 / 抢占 / 声明式检查点）全都不见了」而不是报错。
 * 取值合法性由 validateEnv() 兜住。
 */
export const engineConfig = registerAs('engine', () => ({
  mode: (process.env.AGENT_ENGINE || 'langgraph') as 'legacy' | 'langgraph',
}))

/** LangGraph checkpoint 持久化（与 server 共库，表结构由 Prisma migration 管理） */
export const checkpointConfig = registerAs('checkpoint', () => ({
  databaseUrl: process.env.AGENT_DATABASE_URL || '',
  poolSize: parseInt(process.env.AGENT_DB_POOL_SIZE || '5', 10),
  autoSetup: (process.env.AGENT_CHECKPOINT_AUTO_SETUP || 'true') === 'true',
}))
