/**
 * 会话级状态的纯函数层（阶段 1 上下文工程）。
 *
 * 设计原则（手册 §2.3）：状态由**代码**维护，不用大模型维护；状态栏作为
 * **末尾 user 消息**注入、用 `<agent_status>` 包裹，绝不改 system 前缀。
 *
 * 本文件只做「已知字段 → 文本」的确定性拼装，不调 LLM、不做推断，便于单测。
 */
import type { AgentKey } from './agent-state'

/** 会话级状态：跨轮保留，注入状态栏时只承载这些字段（表清单仍由 draftHint 贴 system） */
export interface ConversationMeta {
  /** 当前接管的领域 Agent */
  activeSubAgent?: AgentKey | null
  /** 本对话的初始目标（首轮用户消息原文，截断后） */
  conversationGoal?: string
  /** 上一轮以提问收尾、正在等待用户回答的领域 */
  pendingClarification?: { agent: AgentKey; question: string } | null
  /** 上一轮的结果 */
  lastOutcome?: 'completed' | 'waiting_user' | 'halted' | 'giveup'
}

/** 目标截断上限（手册 D4） */
const GOAL_MAX = 60

/** 单行化 + 截断：多行空白折成一个空格，超长加 …（D4：存与显示共用同一口径） */
export function truncateGoal(goal: string | undefined): string {
  const oneLine = (goal ?? '').replace(/\s+/g, ' ').trim()
  if (!oneLine) return ''
  return oneLine.length > GOAL_MAX ? `${oneLine.slice(0, GOAL_MAX)}…` : oneLine
}

/**
 * 生成 `<agent_status>…</agent_status>` 状态栏。
 * 空字段跳过；没有任何非空行时返回 `''`（调用方据此决定不注入）。
 */
export function buildStateBar(meta: ConversationMeta): string {
  const lines: string[] = []

  if (meta.activeSubAgent) lines.push(`领域: ${meta.activeSubAgent}`)

  const goal = truncateGoal(meta.conversationGoal)
  if (goal) lines.push(`本对话目标: ${goal}`)

  const pending = meta.pendingClarification
  if (pending) {
    const question = truncateGoal(pending.question)
    lines.push(`上一轮: ${pending.agent} 以提问收尾，正在等待回答${question ? `（${question}）` : ''}`)
  }

  if (meta.lastOutcome) lines.push(`阶段: ${meta.lastOutcome}`)

  if (lines.length === 0) return ''
  return `<agent_status>\n${lines.join('\n')}\n</agent_status>`
}

/** 三层会话记忆：L1 结构化 / L2 滚动摘要 / L3 近期窗口（手册 §2.11） */
export interface SessionMemory {
  /** L1 结构化状态（不随轮次长大） */
  l1: ConversationMeta
  /** L2 滚动摘要（超出窗口的旧对话压缩成一段） */
  summary?: string
  /** L3 近期窗口（最近 N 轮原文） */
  recent?: { role: 'user' | 'assistant'; content: string }[]
}

/** 单条近期上下文的最大字符数，避免一条长回复撑爆记忆块 */
const RECENT_LINE_MAX = 300

function recentLine(turn: { role: 'user' | 'assistant'; content: string }): string {
  const text = (turn.content ?? '').replace(/\s+/g, ' ').trim()
  const clipped = text.length > RECENT_LINE_MAX ? `${text.slice(0, RECENT_LINE_MAX)}…` : text
  return `- ${turn.role}: ${clipped}`
}

/**
 * 把三层记忆拼成注入末尾 user 消息的记忆块：L1 状态栏 + L2 摘要 + L3 近期窗口。
 * 空段跳过；全空返回 `''`（调用方据此不注入）。
 *
 * 关键顺序（手册 §2.11「隔离优于压缩」）：能结构化的绝不靠摘要 —— 目标/表/待办走 L1，
 * L2 只兜底纯对话叙事，L3 保最近原文。
 */
export function buildMemoryBlock(mem: SessionMemory): string {
  const parts: string[] = []

  const bar = buildStateBar(mem.l1)
  if (bar) parts.push(bar)

  const summary = (mem.summary ?? '').trim()
  if (summary) parts.push(`<conversation_summary>\n${summary}\n</conversation_summary>`)

  const recent = (mem.recent ?? []).filter((t) => (t.content ?? '').trim())
  if (recent.length > 0) {
    parts.push(`<recent_context>\n${recent.map(recentLine).join('\n')}\n</recent_context>`)
  }

  return parts.join('\n')
}

/**
 * 征询句式：真机实测（2026-10-10）DeepSeek 的追问常以「。」收尾而非「？」，
 * 只认问号会让 pendingClarification 沦为死路径。故追加「末尾在向用户要输入」的句式判定。
 * 仅在**无产物**前提下生效，故不会误伤「建好了，想调整告诉我」这类收尾（那种有产物）。
 */
const ASK_PATTERN =
  /请[描述告诉提供说明补充输入选择确认]|告诉我|你想|你需要|你希望|麻烦[你您]|等你.*告诉/

/**
 * 判定本轮是否以「提问/等待用户输入」收尾（纯代码，手册 D3）。
 *
 * 条件同时成立才记 pendingClarification：
 * (a) 本轮没产出产物；(b) 非 halted/gaveUp；(c) 有非空最后一行；
 * 且 (d) 最后一行**以 ？/? 结尾**，或命中征询句式（真机欠触发后的放宽，见 ASK_PATTERN）。
 * 否则返回 null —— 任何拿不准的情况都当作「不是提问」，避免污染路由状态。
 */
export function detectClarification(input: {
  agent: AgentKey
  finalContent: string
  producedArtifact: boolean
  haltedOrGaveUp: boolean
}): { agent: AgentKey; question: string } | null {
  if (input.haltedOrGaveUp) return null
  if (input.producedArtifact) return null

  const text = (input.finalContent ?? '').trim()
  if (!text) return null

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  const lastLine = lines.length > 0 ? lines[lines.length - 1] : text

  const last = lastLine[lastLine.length - 1]
  const isQuestion = last === '？' || last === '?'
  if (!isQuestion && !ASK_PATTERN.test(lastLine)) return null

  return { agent: input.agent, question: lastLine }
}
