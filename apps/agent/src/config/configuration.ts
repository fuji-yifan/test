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
  // 超时熔断（阶段 6 / S7.1）：工具调用 / LLM 调用的上限，超时按可恢复失败收口，不挂死整轮。
  // ≤ 0 = 不设超时（回退到无熔断行为）。
  toolTimeoutMs: parseInt(process.env.TOOL_TIMEOUT_MS || '30000', 10),
  llmTimeoutMs: parseInt(process.env.LLM_TIMEOUT_MS || '60000', 10),
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

/**
 * 用户长期记忆（阶段 8 §3.7）。
 *
 * 无 MySQL（无 AGENT_DATABASE_URL / 连不上）时 store 自动 no-op 降级，等于本阶段未启用。
 * `enabled=false` 一键回滚（召回 + 提取全停）；`extractEnabled=false` 只停写、保留召回。
 */
export const userMemoryConfig = registerAs('userMemory', () => ({
  enabled: (process.env.USER_MEMORY_ENABLED || 'true') === 'true',
  extractEnabled: (process.env.USER_MEMORY_EXTRACT_ENABLED || 'true') === 'true',
  recallTopK: parseInt(process.env.USER_MEMORY_RECALL_TOP_K || '5', 10),
  extractMaxPerTurn: parseInt(process.env.USER_MEMORY_EXTRACT_MAX_PER_TURN || '5', 10),
  maxScan: parseInt(process.env.USER_MEMORY_MAX_SCAN || '200', 10),
}))

/**
 * 外部基建适配（阶段 6）：观测 / 策略引擎 / 护栏。
 *
 * 一律 **env-gated、不配即 no-op**，默认值与「未引入这些基建」的现状完全一致。
 * - 追踪（S2.3）：`otlpEndpoint`（OTEL_EXPORTER_OTLP_ENDPOINT）或 `langfuseHost` 之一 → 导出 span；均空 → 只透传 traceId。
 * - 策略引擎（S3.1）：`policyEngineUrl` 空 → 只跑内置纯规则（policy-rules.ts）。
 * - 护栏（S5.2）：`guardrailsUrl` 空 → 跳过输入/输出护栏。
 */
export const infraConfig = registerAs('infra', () => ({
  // S2.3 追踪 / Langfuse
  otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || '',
  langfuseHost: process.env.LANGFUSE_HOST || '',
  serviceName: process.env.OTEL_SERVICE_NAME || 'furmx-agent',
  tracingEnabled: (process.env.TRACING_ENABLED || 'true') === 'true',
  tracingTimeoutMs: parseInt(process.env.TRACING_TIMEOUT_MS || '2000', 10),
  // S3.1 外部策略引擎（Cerbos / OPA）
  policyEngineUrl: process.env.POLICY_ENGINE_URL || '',
  policyEngineToken: process.env.POLICY_ENGINE_TOKEN || '',
  policyEngineTimeoutMs: parseInt(process.env.POLICY_ENGINE_TIMEOUT_MS || '2000', 10),
  policyEngineFailClosed: (process.env.POLICY_ENGINE_FAIL_CLOSED || 'false') === 'true',
  // S3.2 内置策略阈值（恒开；只影响触发点）
  policyBulkThreshold: parseInt(process.env.POLICY_BULK_THRESHOLD || '100', 10),
  // S5.2 NeMo Guardrails sidecar
  guardrailsUrl: process.env.NEMO_GUARDRAILS_URL || '',
  guardrailsTimeoutMs: parseInt(process.env.NEMO_GUARDRAILS_TIMEOUT_MS || '2000', 10),
}))

/**
 * 工具调用审计（阶段 6 / S2）：落 server 的 `audit_logs` 表（agent 只写不建）。
 * 无 `AGENT_DATABASE_URL` / 连不上 → store 自动 no-op 降级。`enabled=false` 一键回滚（仅留内存缓冲）。
 */
export const auditConfig = registerAs('audit', () => ({
  enabled: (process.env.AUDIT_ENABLED || 'true') === 'true',
}))

/** LangGraph checkpoint 持久化（与 server 共库，表结构由 Prisma migration 管理） */
export const checkpointConfig = registerAs('checkpoint', () => ({
  databaseUrl: process.env.AGENT_DATABASE_URL || '',
  poolSize: parseInt(process.env.AGENT_DB_POOL_SIZE || '5', 10),
  autoSetup: (process.env.AGENT_CHECKPOINT_AUTO_SETUP || 'true') === 'true',
}))
