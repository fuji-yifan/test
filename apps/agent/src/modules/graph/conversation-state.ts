/**
 * 会话级状态的纯函数层（阶段 1 上下文工程）。
 *
 * 设计原则（手册 §2.3）：状态由**代码**维护，不用大模型维护；状态栏作为
 * **末尾 user 消息**注入、用 `<agent_status>` 包裹，绝不改 system 前缀。
 *
 * 本文件只做「已知字段 → 文本」的确定性拼装，不调 LLM、不做推断，便于单测。
 */
import type { AgentKey, TurnLedgerEntry } from './agent-state'

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

/** 目标渲染截断上限（手册 §2.4-D4 修订：由 60 放宽到 120，长需求约束不丢） */
const GOAL_MAX = 120

/** 单行化 + 截断：多行空白折成一个空格，超长加 …（D4：存与显示共用同一口径） */
export function truncateGoal(goal: string | undefined): string {
  const oneLine = (goal ?? '').replace(/\s+/g, ' ').trim()
  if (!oneLine) return ''
  return oneLine.length > GOAL_MAX ? `${oneLine.slice(0, GOAL_MAX)}…` : oneLine
}

/**
 * 归一化一句请求，仅用于**确定性**的重复判定（手册 §2.12-D4）：
 * 去空白、去常见中英标点、转小写。刻意保守 —— 拿不准就当「不同」，宁可漏判不可误判。
 */
export function normalizeAsk(ask: string | undefined): string {
  return (ask ?? '')
    .toLowerCase()
    .replace(/[\s，。、！？；：,.!?;:"'“”‘’（）()【】\[\]《》<>～~\-—_]/g, '')
}

/**
 * 纯寒暄/客套短句（手册 §2.12-D5）。只认**极短且整句就是客套**的消息，双重约束：
 * 长度 ≤ 12 且整句锚定。这样「你好，帮我建一张表」「谢谢，再改一版」都不会被误判成寒暄。
 */
const SMALL_TALK =
  /^(你好|您好|hi|hello|hey|嗨|哈喽|在吗|在不在|早上好|中午好|下午好|晚上好|谢谢|多谢|thanks|thank you|ok|okay|好的|嗯|哦|收到)[!！。.？?~～,，、；;\s]*$/i

export function isSmallTalk(msg: string | undefined): boolean {
  const text = (msg ?? '').trim()
  if (!text) return false
  return text.length <= 12 && SMALL_TALK.test(text)
}

/**
 * 取会话目标（手册 §2.12-D5）：跳过寒暄，返回**首个实质消息全文**（空串表示本轮仍不算目标，
 * 让后续轮继续找）。渲染时再由 buildStateBar 截断到 120 —— 存全文、显截断，两者分开。
 */
export function deriveGoal(msg: string | undefined): string {
  const text = (msg ?? '').trim()
  if (!text || isSmallTalk(text)) return ''
  return text
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
  /** 轮次台账：最后一条是本轮（outcome=pending），供「会话进展」与重复判定（§2.12.3） */
  ledger?: TurnLedgerEntry[]
  /** 领域事实：agentKey -> 标量键值（§2.12.3 Facts），供跨 Agent 交接 */
  facts?: Record<string, Record<string, unknown>>
}

/** projectMemory 的入参（手册 §2.12-D3） */
export interface ProjectMemoryOptions {
  /** 记忆块 token 预算；缺省用 DEFAULT_MEMORY_BUDGET_TOKENS */
  budgetTokens?: number
  /** 是否注入「重复提问」提示（可选增强，默认关，见 buildRepeatNotice） */
  repeatNotice?: boolean
}

/** 记忆块默认 token 预算（近似折算成字符预算，见 charsForTokens） */
export const DEFAULT_MEMORY_BUDGET_TOKENS = 1600
/**
 * 近似换算系数：CJK 正文约 2 字符/token（保守取值）。
 * 预算的意义是「有界 + 单一截断口径」，不追求精确 —— 留量靠下调预算，
 * 超长再靠各段自身字符硬上限兜底（手册 §2.12-D3）。
 */
const CHARS_PER_TOKEN = 2
export function charsForTokens(tokens: number | undefined): number {
  const t = Number.isFinite(tokens) ? (tokens as number) : DEFAULT_MEMORY_BUDGET_TOKENS
  return Math.max(0, Math.floor(t * CHARS_PER_TOKEN))
}

/**
 * 预算溢出判定（手册 §2.12-D3）：从最新往回累计近似 token，超出预算的最旧几轮应压进 L2 摘要。
 * 返回要摘要的**最旧轮数**；0 = 窗口在预算内（短会话零摘要）。始终保留最新 1 轮不摘要。
 * 纯函数、无 LLM —— 只回答「压几轮」，是否/如何摘要由调用方决定。
 */
export function turnsToSummarize(
  turns: { role: string; content: string }[] | undefined,
  budgetTokens: number,
): number {
  const list = turns ?? []
  if (budgetTokens <= 0 || list.length <= 1) return 0
  const budgetChars = charsForTokens(budgetTokens)
  let used = 0
  let i = list.length - 1
  for (; i >= 0; i--) {
    used += (list[i].content ?? '').length
    if (used > budgetChars) break
  }
  // i 是第一轮致溢出的；把它及更旧的 0..i 摘要，保留 i+1..末尾（至少留住最新 1 轮）
  return Math.min(i + 1, list.length - 1)
}

/** 单条近期上下文的默认字符上限；有预算时按剩余预算自适应收缩（§2.12-D3） */
const RECENT_LINE_MAX = 800
/** 「会话进展」段最多渲染多少条台账（取最近 N 条） */
const LEDGER_RENDER_MAX = 8
/** 摘要段字符硬上限 */
const SUMMARY_MAX = 800
/** 每个 Agent 最多渲染多少条领域事实 */
const FACTS_PER_AGENT_MAX = 5
/** 单条事实值的字符上限 */
const FACT_VALUE_MAX = 60

/** 台账结局 → 中文短标签 */
const OUTCOME_LABEL: Record<string, string> = {
  pending: '进行中',
  answered: '已答复',
  artifact: '已产出',
  waiting: '待你回答',
  halted: '已中断',
  gaveup: '未完成',
}

/** 领域事实段（Facts 渲染，手册 §2.12.3）：只渲染标量，让换 Agent 后仍看得到上一棒产出的对象 */
function buildFactsBlock(
  facts: Record<string, Record<string, unknown>> | undefined,
  budgetChars: number,
): string {
  const agents = Object.keys(facts ?? {})
  if (agents.length === 0 || budgetChars <= 0) return ''
  const lines: string[] = []
  let used = 0
  for (const agent of agents) {
    const f = facts?.[agent]
    if (!f || typeof f !== 'object') continue
    const pairs: string[] = []
    for (const [k, v] of Object.entries(f)) {
      if (v === undefined || v === null || v === '') continue
      if (typeof v === 'object') continue // 只渲染标量，避免把大对象塞进记忆
      const text = String(v)
      pairs.push(`${k}=${text.length > FACT_VALUE_MAX ? `${text.slice(0, FACT_VALUE_MAX)}…` : text}`)
      if (pairs.length >= FACTS_PER_AGENT_MAX) break
    }
    if (pairs.length === 0) continue
    const line = `- ${agent}: ${pairs.join(' / ')}`
    if (used + line.length > budgetChars && lines.length > 0) break
    lines.push(line)
    used += line.length + 1
  }
  if (lines.length === 0) return ''
  return `<session_facts>\n${lines.join('\n')}\n</session_facts>`
}

/** 会话进展段（Ledger 渲染，手册 §2.12.3/D4）：让「这句刚才答过、这轮做到哪」可见 */
function buildProgressBlock(ledger: TurnLedgerEntry[] | undefined, budgetChars: number): string {
  const entries = (ledger ?? []).filter((e) => (e?.ask ?? '').trim())
  if (entries.length === 0 || budgetChars <= 0) return ''
  const recent = entries.slice(-LEDGER_RENDER_MAX)
  const lines: string[] = []
  let used = 0
  // 从最近往前填，超预算就停；最后按时间正序输出
  for (let i = recent.length - 1; i >= 0; i--) {
    const e = recent[i]
    const label = OUTCOME_LABEL[e.outcome] ?? e.outcome
    const produced = e.produced && e.produced.length > 0 ? `（${e.produced.join('、')}）` : ''
    const line = `- ${e.agent}: ${truncateGoal(e.ask)} → ${label}${produced}`
    if (used + line.length > budgetChars && lines.length > 0) break
    lines.unshift(line)
    used += line.length + 1
  }
  if (lines.length === 0) return ''
  return `<session_progress>\n${lines.join('\n')}\n</session_progress>`
}

/** 近期窗口段：从最近往前填，单行按「剩余预算」与默认上限的较小值自适应（§2.12-D3） */
function buildRecentBlock(
  recent: { role: 'user' | 'assistant'; content: string }[] | undefined,
  budgetChars: number,
): string {
  const turns = (recent ?? []).filter((t) => (t?.content ?? '').trim())
  if (turns.length === 0) return ''
  const header = '<recent_context>\n'
  const footer = '\n</recent_context>'
  const avail = budgetChars - header.length - footer.length
  if (avail <= 0) return ''
  const lines: string[] = []
  let used = 0
  for (let i = turns.length - 1; i >= 0; i--) {
    const text = (turns[i].content ?? '').replace(/\s+/g, ' ').trim()
    const cap = Math.min(RECENT_LINE_MAX, Math.max(40, avail - used))
    const clipped = text.length > cap ? `${text.slice(0, cap)}…` : text
    const line = `- ${turns[i].role}: ${clipped}`
    if (used + line.length > avail && lines.length > 0) break
    lines.unshift(line)
    used += line.length + 1
  }
  if (lines.length === 0) return ''
  return `${header}${lines.join('\n')}${footer}`
}

/** 摘要段：按剩余预算与硬上限的较小值截断（§2.12-D3） */
function buildSummaryBlock(summary: string | undefined, budgetChars: number): string {
  const text = (summary ?? '').trim()
  if (!text) return ''
  const header = '<conversation_summary>\n'
  const footer = '\n</conversation_summary>'
  const avail = Math.min(SUMMARY_MAX, budgetChars - header.length - footer.length)
  if (avail <= 0) return ''
  const clipped = text.length > avail ? `${text.slice(0, avail)}…` : text
  return `${header}${clipped}${footer}`
}

/**
 * 可选增强（手册 §2.12-D4）：当前 ask 与**最近某轮已作答/已产出**的 ask 归一化后完全一致时，
 * 注入一条代码提示，提醒模型「这句刚答过，如无新信息勿整段复读」。
 * 只做精确匹配（保守），默认关；刻意**不做硬缓存短路** —— 用户可能就是要再说一遍或换角度。
 */
export function buildRepeatNotice(ledger: TurnLedgerEntry[] | undefined): string {
  const entries = (ledger ?? []).filter((e) => (e?.normAsk ?? '').trim())
  if (entries.length < 2) return ''
  const current = entries[entries.length - 1]
  const prior = entries
    .slice(0, -1)
    .some((e) => e.normAsk === current.normAsk && (e.outcome === 'answered' || e.outcome === 'artifact'))
  if (!prior) return ''
  return '<repeat_notice>\n这一句与上一轮已作答的请求相同。若无新增信息，请勿整段重复，直接说明「已就此作答」或给出本轮的差异/增量。\n</repeat_notice>'
}

/**
 * 会话上下文的**唯一投影出口**（手册 §2.12.3 Projection）：把会话工作集渲染成注入
 * 末尾 user 消息的记忆块。替换过去分散的 `buildMemoryBlock`，统一 L1/L2/L3/Ledger 的
 * 截断口径与 token 预算。
 *
 * 预算优先级（§2.11「隔离优于压缩」）：L1 结构 > 领域事实 > 进展台账 > 摘要 > 近期原文。
 * 渲染顺序：L1 状态栏 → 领域事实 → 重复提示 → 会话进展 → 摘要 → 近期窗口。
 *
 * 摘要在**预算分配**上排在近期原文之前：摘要承载的是已被裁掉、别处看不到的旧轮叙事，
 * 若把它排到最后，近期窗口一填满预算就会把它饿死 —— 那样「摘要」白算（花了 LLM 却不注入）。
 * 渲染顺序仍是时间序（旧摘要在前、新原文在后）。
 * 空段跳过；全空返回 `''`（调用方据此不注入）。
 */
export function projectMemory(mem: SessionMemory, opts: ProjectMemoryOptions = {}): string {
  const budget = charsForTokens(opts.budgetTokens)

  const bar = buildStateBar(mem.l1)
  const notice = opts.repeatNotice ? buildRepeatNotice(mem.ledger) : ''

  let used = bar ? bar.length + 1 : 0
  if (notice) used += notice.length + 1

  const facts = buildFactsBlock(mem.facts, budget - used)
  if (facts) used += facts.length + 1

  const progress = buildProgressBlock(mem.ledger, budget - used)
  if (progress) used += progress.length + 1

  const summary = buildSummaryBlock(mem.summary, budget - used)
  if (summary) used += summary.length + 1

  const recent = buildRecentBlock(mem.recent, budget - used)

  return [bar, facts, notice, progress, summary, recent].filter(Boolean).join('\n')
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
