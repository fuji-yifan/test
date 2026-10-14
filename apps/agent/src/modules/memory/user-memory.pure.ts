/**
 * 用户记忆的**纯函数层**（阶段 8 §3.7）：解析提取器输出、召回排序、护栏。
 * 不调 LLM、不碰 DB —— 便于单测。
 */
import {
  MEMORY_KEY_MAX,
  MEMORY_VALUE_MAX,
  USER_MEMORY_KINDS,
  type UserMemoryCandidate,
  type UserMemoryKind,
  type UserMemoryRecord,
} from './user-memory.types'

/**
 * 明显敏感的内容不入库（手册 §3.7「不存敏感明文」）。保守：只拦明确的凭据类，
 * 不拦「姓名/公司」这类正常业务事实。命中即丢弃该条候选。
 */
const SENSITIVE = /(密码|口令|passwd|password|token|secret|密钥|api[\s_-]?key|身份证|银行卡|信用卡)/i

function clampConfidence(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return 0.6
  return Math.min(1, Math.max(0, n))
}

function capText(s: string, max: number): string {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > max ? one.slice(0, max) : one
}

/** 从模型输出里剥出 JSON 数组文本：去 ``` 围栏、取首个 '[' 到末个 ']' */
function extractJsonArray(raw: string): string | null {
  const text = (raw ?? '').trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fence ? fence[1] : text
  const start = body.indexOf('[')
  const end = body.lastIndexOf(']')
  if (start === -1 || end === -1 || end < start) return null
  return body.slice(start, end + 1)
}

/**
 * 解析提取器的原始输出为候选列表。任何异常都返回 `[]`（拿不准就当没提取到）；
 * 逐条做类型/长度/敏感校验，批内按 `(kind, key)` 去重（保留 confidence 更高的）。
 */
export function parseExtraction(raw: string): UserMemoryCandidate[] {
  const json = extractJsonArray(raw)
  if (!json) return []
  let arr: unknown
  try {
    arr = JSON.parse(json)
  } catch {
    return []
  }
  if (!Array.isArray(arr)) return []

  const byKey = new Map<string, UserMemoryCandidate>()
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const kind = String(o.kind ?? '').trim() as UserMemoryKind
    if (!USER_MEMORY_KINDS.includes(kind)) continue
    const key = capText(String(o.key ?? ''), MEMORY_KEY_MAX)
    const value = capText(String(o.value ?? ''), MEMORY_VALUE_MAX)
    if (!key || !value) continue
    if (SENSITIVE.test(key) || SENSITIVE.test(value)) continue
    const candidate: UserMemoryCandidate = { kind, key, value, confidence: clampConfidence(o.confidence) }
    const id = `${kind}\u0000${key}`
    const prev = byKey.get(id)
    if (!prev || candidate.confidence > prev.confidence) byKey.set(id, candidate)
  }
  return Array.from(byKey.values())
}

/** 提取器每轮最多落几条的护栏（纯函数，便于测试；实际上限由调用方从配置传入） */
export function capCandidates(list: UserMemoryCandidate[], max: number): UserMemoryCandidate[] {
  if (max <= 0) return []
  return list.slice(0, max)
}

/** 词法切分：拉丁词（≥2 字符）+ 单个 CJK 字。用于无嵌入下的近似相关度。 */
function tokenize(text: string): string[] {
  const lower = (text ?? '').toLowerCase()
  const latin = lower.match(/[a-z0-9]{2,}/g) ?? []
  const cjk = lower.match(/[\u4e00-\u9fa5]/g) ?? []
  return [...latin, ...cjk]
}

/** 新近度衰减窗口（ms）：一周内的记忆给满加成，之后线性降到 0 */
const RECENCY_WINDOW_MS = 7 * 24 * 3600 * 1000
const W_OVERLAP = 1
const W_RECENCY = 0.5

/**
 * 召回排序（阶段 8 / 8.3）：无嵌入，用「词重合 + 新近度」近似相关度（同 template-search
 * 「不做向量」口径）。纯函数、确定性；query 为空时退化为纯新近度排序。返回前 topK 条。
 */
export function rankMemories(
  records: UserMemoryRecord[],
  query: string,
  now: number,
  topK: number,
): UserMemoryRecord[] {
  if (topK <= 0 || records.length === 0) return []
  const tokens = tokenize(query)
  const scored = records.map((r) => {
    const hay = `${r.key} ${r.value}`.toLowerCase()
    let overlap = 0
    for (const t of new Set(tokens)) if (hay.includes(t)) overlap += 1
    const age = Math.max(0, now - (r.updatedAt ?? 0))
    const recency = Math.max(0, 1 - age / RECENCY_WINDOW_MS)
    const score = overlap * W_OVERLAP + recency * W_RECENCY
    return { r, score }
  })
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return (b.r.updatedAt ?? 0) - (a.r.updatedAt ?? 0)
  })
  return scored.slice(0, topK).map((s) => s.r)
}
