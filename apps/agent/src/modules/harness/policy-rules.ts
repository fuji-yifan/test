/**
 * 内置业务策略（阶段 6 / S3.2）。
 *
 * 「策略内容」是本项目的业务判断，**不需要任何外部基建**，故恒开、用纯函数实现
 * （同 S5.1 `untrusted.ts` 的风格）：删除类强制确认、跨租户一律拒、批量写/导出超阈值拦截、
 * 敏感字段访问记审计。外部策略引擎（Cerbos/OPA，S3.1）只在其之上**叠加**更严的判定。
 *
 * 降噪原则：只对**显式信号**判定，未触发即静默 `allow` —— 保证对既有调用零影响。
 */
export type PolicyDecisionType = 'allow' | 'deny' | 'requireConfirm' | 'warn'

export interface PolicyInput {
  tool: string
  args: Record<string, unknown>
  risk: string
  workspaceId?: string
  /** 是否有副作用（写）工具：由网关的 `isWrite` 传入（显式集合 ∪ 风险 ≥ medium） */
  isWrite: boolean
  /** 批量阈值（未传用默认 100） */
  bulkThreshold?: number
}

export interface PolicyDecision {
  decision: PolicyDecisionType
  reason: string
  /** 命中敏感字段时给出的审计备注（透传进审计 details.note） */
  auditNote?: string
  source: 'builtin' | 'external' | 'disabled'
}

const DEFAULT_BULK_THRESHOLD = 100

/** 批量量级字段名（数组长度或显式数字） */
const MAGNITUDE_ARRAY_KEYS = ['items', 'rows', 'records', 'ids']
const MAGNITUDE_NUM_KEYS = ['limit', 'count', 'size']

/** 敏感字段名（PII 线索）：命中即记审计，不阻断 */
const SENSITIVE_FIELDS = new Set([
  'password',
  'passwd',
  'phone',
  'mobile',
  'idcard',
  'id_card',
  'email',
  'bankcard',
  'bank_card',
  'ssn',
])

const RANK: Record<PolicyDecisionType, number> = { allow: 0, warn: 1, requireConfirm: 2, deny: 3 }

/** 删除类工具：与风险门冗余，仅作「风险被误评 low」时的兜底确认（见网关调用点）。 */
const DELETE_TOOLS = new Set(['form_delete', 'form_version_delete'])

/**
 * 内置策略判定（纯函数）。返回最严的一条命中；未命中任何规则 → `allow`。
 */
export function evaluateBuiltinPolicy(input: PolicyInput): PolicyDecision {
  const { tool, args, risk, workspaceId, isWrite } = input
  const a = (args ?? {}) as Record<string, unknown>

  // ① 跨租户：args 里显式带了**别的** workspaceId → 一律拒（不可信身份参数）
  const argWs = a.workspaceId
  if (typeof argWs === 'string' && argWs && workspaceId && argWs !== workspaceId) {
    return { decision: 'deny', reason: 'cross-tenant', source: 'builtin' }
  }

  // ② 删除类：medium+ 风险已由风险门确认；此处只兜底「删除工具却被评成 low」
  if (DELETE_TOOLS.has(tool) && risk === 'low') {
    return { decision: 'requireConfirm', reason: 'delete-tool', source: 'builtin' }
  }

  // ③ 批量写/导出超阈值 → 拒
  if (isWrite) {
    const threshold = input.bulkThreshold ?? DEFAULT_BULK_THRESHOLD
    const magnitude = bulkMagnitude(a)
    if (magnitude > threshold) {
      return { decision: 'deny', reason: `bulk-over-threshold(${magnitude}>${threshold})`, source: 'builtin' }
    }
  }

  // ④ 敏感字段访问 → 记审计（不阻断）
  const fields = collectFieldNames(a)
  if (fields.some((f) => SENSITIVE_FIELDS.has(f.toLowerCase()))) {
    return { decision: 'warn', reason: 'pii_access', auditNote: 'pii_access', source: 'builtin' }
  }

  return { decision: 'allow', reason: 'ok', source: 'builtin' }
}

/**
 * 合并多条判定（内置 ∪ 外部 PDP）：取**最严**者；同级时优先带 `auditNote` 的。
 * 传 `null`/`undefined` 的条目忽略。全空 → `allow`。
 */
export function combineDecisions(
  ...decisions: (PolicyDecision | null | undefined)[]
): PolicyDecision {
  let best: PolicyDecision = { decision: 'allow', reason: 'ok', source: 'disabled' }
  for (const d of decisions) {
    if (!d) continue
    if (RANK[d.decision] > RANK[best.decision]) best = d
    else if (RANK[d.decision] === RANK[best.decision] && !best.auditNote && d.auditNote) best = d
  }
  return best
}

function bulkMagnitude(args: Record<string, unknown>): number {
  let max = 0
  for (const k of MAGNITUDE_ARRAY_KEYS) {
    const v = args[k]
    if (Array.isArray(v)) max = Math.max(max, v.length)
  }
  for (const k of MAGNITUDE_NUM_KEYS) {
    const v = args[k]
    if (typeof v === 'number' && Number.isFinite(v)) max = Math.max(max, v)
  }
  return max
}

function collectFieldNames(args: Record<string, unknown>): string[] {
  const out: string[] = []
  for (const k of ['fields', 'columns']) {
    const v = args[k]
    if (Array.isArray(v)) out.push(...v.filter((x): x is string => typeof x === 'string'))
    else if (typeof v === 'string') out.push(...v.split(',').map((s) => s.trim()))
  }
  return out
}
