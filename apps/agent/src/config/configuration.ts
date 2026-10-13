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
  // 执行权租约（阶段 3 切片 B）：仅 SESSION_STORE=mysql 时生效，memory 即降级/回滚。
  leaseEnabled: process.env.SESSION_LEASE_ENABLED !== 'false',
  leaseTtlMs: parseInt(process.env.SESSION_LEASE_TTL_MS || '30000', 10),
  leaseHeartbeatMs: parseInt(process.env.SESSION_LEASE_HEARTBEAT_MS || '10000', 10),
}))

export const contextConfig = registerAs('context', () => ({
  maxToolResultChars: parseInt(process.env.MAX_TOOL_RESULT_CHARS || '8000', 10),
  // 工具结果进 LLM 视图的 token 预算（阶段 4 / 4.3）：超预算先「摘要化」丢大字段，
  // 仍超再按 maxToolResultChars 头尾硬截。CJK 近似 2 字符/token（见 conversation-state）。
  maxToolResultTokens: parseInt(process.env.MAX_TOOL_RESULT_TOKENS || '2000', 10),
  maxOutputTokens: parseInt(process.env.MAX_OUTPUT_TOKENS || '2048', 10),
  maxRetries: parseInt(process.env.MAX_RETRIES || '2', 10),
  maxDegrades: parseInt(process.env.MAX_DEGRADE || '1', 10),
  // 会话记忆块 token 预算（projectMemory 的单一截断口径，手册 §2.12-D3）。
  // L2 摘要不再有独立开关：由本预算的「溢出」驱动（短会话零摘要）。置 0 = 关闭预算化投影
  // （记忆块仅剩 L1 状态栏）与摘要。
  memoryBudgetTokens: parseInt(process.env.MEMORY_BUDGET_TOKENS || '1600', 10),
  // 重复提问提示（可选增强，手册 §2.12-D4）；默认关
  memoryRepeatNotice: (process.env.MEMORY_REPEAT_NOTICE || 'false') === 'true',
  // 会话累计用量软上限（阶段 4 / 4.4）：done.usage 超阈值时给 DONE 打 usageAlert。
  // 默认 0 = 关闭（不告警）。
  usageSoftLimitTokens: parseInt(process.env.USAGE_SOFT_LIMIT_TOKENS || '0', 10),
}))

/** 只读工具结果缓存（阶段 4 / 4.5，Redis）。REDIS_HOST 未设 → 缓存整体 no-op。 */
export const cacheConfig = registerAs('cache', () => ({
  redisHost: process.env.REDIS_HOST || '',
  redisPort: parseInt(process.env.REDIS_PORT || '6379', 10),
  ttlSeconds: parseInt(process.env.TOOL_CACHE_TTL_SECONDS || '60', 10),
  enabled: (process.env.TOOL_CACHE_ENABLED || 'true') === 'true',
}))

/** LangGraph checkpoint 持久化（与 server 共库，表结构由 Prisma migration 管理） */
export const checkpointConfig = registerAs('checkpoint', () => ({
  databaseUrl: process.env.AGENT_DATABASE_URL || '',
  poolSize: parseInt(process.env.AGENT_DB_POOL_SIZE || '5', 10),
  autoSetup: (process.env.AGENT_CHECKPOINT_AUTO_SETUP || 'true') === 'true',
}))
