/**
 * 审计参数脱敏（阶段 6 / S2）。
 *
 * 纯函数，供 `ToolGateway` 在写审计前调用：保证落库到 `audit_logs` 的 args
 * **无明文 token / 密码 / 密钥**，且大字段被截断，避免审计本身成为泄露面。
 *
 * 与 server 侧 `audit-middleware.ts` 里那个**从未被调用**的 `sanitizeArgs` 不同，
 * 这里是 agent 侧新建并**真正调用**的版本（agent 不能 import server 代码）。
 */

/** 敏感键名（大小写不敏感）：命中即整体替换，不看值 */
const SENSITIVE_KEY = /token|password|passwd|secret|api[_-]?key|authorization/i
/** 单个字符串值的最大保留长度，超出只留长度提示 */
const MAX_STR = 500
/** 递归深度上限（防深层对象爆栈） */
const MAX_DEPTH = 4
/** 单层对象/数组的条目上限 */
const MAX_ENTRIES = 100

export function sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  return sanitizeValue(args, 0) as Record<string, unknown>
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (value === null || typeof value !== 'object') {
    return typeof value === 'string' ? truncate(value) : value
  }
  if (depth >= MAX_DEPTH) return '[max depth reached]'
  if (Array.isArray(value)) {
    const out = value.slice(0, MAX_ENTRIES).map((v) => sanitizeValue(v, depth + 1))
    if (value.length > MAX_ENTRIES) out.push(`[+${value.length - MAX_ENTRIES} more]`)
    return out
  }
  const out: Record<string, unknown> = {}
  let count = 0
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (count >= MAX_ENTRIES) {
      out['[+more]'] = true
      break
    }
    count++
    out[k] = SENSITIVE_KEY.test(k) ? '[REDACTED]' : sanitizeValue(v, depth + 1)
  }
  return out
}

function truncate(s: string): string {
  return s.length > MAX_STR ? `[truncated ${s.length} chars]` : s
}

/** 脱敏后序列化成可放进 `details.argsPreview` 的字符串（再整体截断） */
export function serializeArgsPreview(args: Record<string, unknown>, max = 1000): string {
  let s: string
  try {
    s = JSON.stringify(sanitizeArgs(args))
  } catch {
    s = '{}'
  }
  return s.length > max ? `${s.slice(0, max)}…[truncated ${s.length} chars]` : s
}
