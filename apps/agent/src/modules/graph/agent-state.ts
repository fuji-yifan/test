/**
 * LangGraph 编排的共享状态。
 *
 * 四张子图（form-designer / workflow / template / submission）与父图共用同一份
 * Annotation，这样子图可以直接读写父图的 channel，interrupt 也会自然冒泡到父图。
 *
 * 语义约定：
 * - messages 用「替换」语义：每个节点返回完整数组。图内只保留本次执行的
 *   LLM 对话（system + user + tool 往返），不携带整个 session 历史，避免膨胀。
 *   之所以不用 append，是因为跨节点 append 会让 interrupt 重放节点时重复追加。
 * - completedSteps / checkpointDone 用 append 语义，只做成员判断。
 */
import { Annotation } from '@langchain/langgraph'
import type { BaseMessage } from '@langchain/core/messages'
import type { OrchestrationPlan } from '../hub/hub.types'
import type { FormWorksheet } from './worksheet'

/** 平台里的四个领域 Agent */
export type AgentKey = 'form-designer' | 'workflow' | 'template' | 'submission'

export const AGENT_KEYS: AgentKey[] = ['form-designer', 'workflow', 'template', 'submission']

/** 路由来源，便于排查「为什么走到了这个 Agent」 */
export type RouteSource = 'plan' | 'prompt' | 'page' | 'llm' | 'default'

/** 路由结论 */
export interface RouteDecision {
  agent: AgentKey
  scenario: string
  source: RouteSource
  reason: string
  isCrossDomain: boolean
  plan?: OrchestrationPlan
}

/** 当前打开的页面（前端从路由推导后透传） */
export interface PageContext {
  scenario: string
  pageLabel?: string
  entityId?: string
}

/** LLM 产出的 tool_call（只保留图里需要的字段） */
export interface PendingCall {
  id: string
  name: string
  args: Record<string, unknown>
}

/** 上一次 act 的结果，供 afterTool 检查点判断 */
export interface LastToolResult {
  callId: string
  name: string
  ok: boolean
  summary: string
}

/** 产物：供下游步骤用 $1.schema 这类引用取值 */
export interface StepArtifact {
  type: string
  data: Record<string, unknown>
}

/** 已答复过的检查点。按 toolCallId 归零，保证同一调用只问一次 */
export interface CheckpointRecord {
  checkpointId: string
  toolCallId: string
  action: 'continue' | 'abort'
}

/** 检查点被答复后带回来的信息（resume 值） */
export interface CheckpointAnswer {
  checkpointId: string
  toolCallId: string
  action: 'continue' | 'abort'
  /** 用户在选项之外补充的自由文本 */
  note?: string
}

/** 工具级确认（风险门）被答复后带回来的信息 */
export interface ToolConfirmAnswer {
  action: 'confirm' | 'abort'
  /** 用户确认时可以改写参数（例如换一个表单名） */
  args?: Record<string, unknown>
}

export const AgentState = Annotation.Root({
  /** 图内 LLM 对话（替换语义） */
  messages: Annotation<BaseMessage[]>({
    reducer: (_prev, next) => next ?? [],
    default: () => [],
  }),

  // ---- 会话/身份 ----
  sessionId: Annotation<string>({ reducer: (_p, n) => n, default: () => '' }),
  userId: Annotation<string>({ reducer: (_p, n) => n, default: () => '' }),
  workspaceId: Annotation<string>({ reducer: (_p, n) => n, default: () => '' }),
  userToken: Annotation<string>({ reducer: (_p, n) => n, default: () => '' }),

  /**
   * 会话级目标：首轮用户消息原文（截断 ≤60 字），不调 LLM 摘要（手册 D4）。
   * 跨轮从 checkpoint 恢复；仅在为空时由 routerNode 写入首轮值。
   */
  conversationGoal: Annotation<string>({ reducer: (_p, n) => n ?? '', default: () => '' }),
  /**
   * 上一轮以提问收尾、正在等待用户回答的领域（手册 D3）。
   * routerNode 每轮先读后清，本轮若仍以提问收尾由 respond 重新写入。
   */
  pendingClarification: Annotation<{ agent: AgentKey; question: string } | null>({
    reducer: (_p, n) => n ?? null,
    default: () => null,
  }),
  /**
   * L3 近期窗口：最近若干轮的 user/assistant 原文（替换语义）。
   * routerNode 每轮追加本轮 user，aggregate 收尾追加 assistant；README 见 §2.11。
   * 放 checkpoint 承载，无需额外持久层。
   */
  historyTurns: Annotation<{ role: 'user' | 'assistant'; content: string }[]>({
    reducer: (_p, n) => n ?? [],
    default: () => [],
  }),
  /**
   * L2 滚动摘要：超出窗口的旧对话压缩成一段（替换语义，配置门控，默认关）。
   */
  memorySummary: Annotation<string>({ reducer: (_p, n) => n ?? '', default: () => '' }),

  // ---- 本轮输入 ----
  userMessage: Annotation<string>({ reducer: (_p, n) => n, default: () => '' }),
  pageContext: Annotation<PageContext>({
    reducer: (_p, n) => n ?? { scenario: '' },
    default: () => ({ scenario: '' }),
  }),

  // ---- 路由 / 计划 ----
  route: Annotation<RouteDecision | null>({ reducer: (_p, n) => n, default: () => null }),
  plan: Annotation<OrchestrationPlan | null>({ reducer: (_p, n) => n, default: () => null }),
  /** 当前已推进到的步骤下标（比 currentStepId 更好用） */
  stepIndex: Annotation<number>({ reducer: (_p, n) => n, default: () => 0 }),
  /**
   * 已完成的步骤 id（替换语义）。
   * 必须能被 router 在每轮对话开始时清空 —— 计划的推进是「按轮次」而不是「按 thread」。
   */
  completedSteps: Annotation<string[]>({
    reducer: (_prev, next) => next ?? [],
    default: () => [],
  }),
  /** 产物表：stepId -> 产物（替换语义，同理由 router 按轮次清空后由 planAdvance 重建） */
  artifacts: Annotation<Record<string, StepArtifact>>({
    reducer: (_prev, next) => next ?? {},
    default: () => ({}),
  }),
  /** 各 Agent 的当前草稿（draftSchema / draftWorkflow / draftTemplate / lastAnalysis 的图内版本） */
  drafts: Annotation<Record<string, StepArtifact>>({
    reducer: (prev, next) => ({ ...(prev ?? {}), ...(next ?? {}) }),
    default: () => ({}),
  }),
  /**
   * 本轮真正写出过草稿的 Agent（替换语义，由 router 每轮清空）。
   *
   * `drafts` 是 merge 语义、且跨轮从 checkpoint 恢复，所以「某个 Agent 有草稿」
   * **不等于**「它这一轮产出过」。planAdvance 不能只看 drafts 有没有值来判断上游
   * 步骤是否成功 —— 否则上一轮的模板草稿会让「这一轮没搜到」的落库步骤照样拿到
   * $1.schema 并凭空建一张表（真机 T2 踩到过）。
   *
   * 与 drafts 的分工：drafts 保存内容（要跨轮给 prepare 播种、给工具做合并），
   * 本 channel 只记录「这一轮写过」，两者都保留才不会互相拖累。
   */
  turnDraftAgents: Annotation<string[]>({
    reducer: (_p, n) => n ?? [],
    default: () => [],
  }),
  /**
   * 会话级表单工作台（多张表 + 聚焦指针），form-designer 用。
   *
   * **替换语义**（不是 append）：act 每步返回完整的新工作台，resume 重放节点不会重复追加。
   * 跨轮从 checkpoint 恢复，所以「整段对话的表」天然可持续。
   */
  formWorksheet: Annotation<FormWorksheet>({
    reducer: (_p, n) => n ?? { forms: [], focusKey: null },
    default: () => ({ forms: [], focusKey: null }),
  }),
  /** 需要回写 session.metadata 的补丁（保持与 legacy 前端/接口兼容） */
  sessionMetadataPatch: Annotation<Record<string, unknown>>({
    reducer: (prev, next) => ({ ...(prev ?? {}), ...(next ?? {}) }),
    default: () => ({}),
  }),

  // ---- ReAct 循环 ----
  /** 尚未执行的 tool_call 队列（每次只执行队首一个） */
  pendingCalls: Annotation<PendingCall[]>({
    reducer: (_p, n) => n ?? [],
    default: () => [],
  }),
  lastTool: Annotation<LastToolResult | null>({ reducer: (_p, n) => n, default: () => null }),
  /** 本轮 tool_call 已获得用户放行（业务检查点或风险确认） */
  approved: Annotation<boolean>({ reducer: (_p, n) => n, default: () => false }),
  /** 该 tool_call 的风险确认已被答复，resume 后由 act 取用 */
  toolConfirm: Annotation<ToolConfirmAnswer | null>({ reducer: (_p, n) => n, default: () => null }),
  /** 刚执行过工具，需要 LLM 再看一眼结果（而不是直接收尾） */
  needThink: Annotation<boolean>({ reducer: (_p, n) => n, default: () => false }),
  /** 该子图内已进行的 LLM 轮次，用于兜底防死循环 */
  iterations: Annotation<number>({ reducer: (_p, n) => n, default: () => 0 }),
  /**
   * 工具名 -> 连续失败次数（成功即清零）。
   *
   * 迁移时漏掉的一环：legacy 的 base.agent 会数同一个工具连续错了几次，
   * 超过 MAX_RETRIES 就改成「换方案」提示、超过 MAX_DEGRADE 就整体收尾。
   * 图侧原先只有「失败就回一条 ToolMessage」——模型可以无限重试同一个坏工具。
   *
   * 替换语义（不是 merge）：act 是唯一写入者，每次返回的都是**全量 map**，
   * 所以替换才能让 routerNode 按轮清零 —— 用 merge 的话写 `{}` 只算空增量，
   * 上一轮的失败额度会带进下一轮。
   */
  toolErrors: Annotation<Record<string, number>>({
    reducer: (_p, n) => n ?? {},
    default: () => ({}),
  }),
  /**
   * 已进入「降级」状态的次数（替换语义）。
   *
   * 按「某个工具连续失败满 MAX_RETRIES+1 次」计一次，与 legacy 的 degradeCount 同义；
   * 该工具成功后再失败会重新计数，所以反复坏掉的工具最终仍会触发收尾。
   */
  degradeCount: Annotation<number>({ reducer: (_p, n) => n, default: () => 0 }),

  // ---- HITL ----
  checkpointDone: Annotation<CheckpointRecord[]>({
    reducer: (prev, next) => [...(prev ?? []), ...(next ?? [])],
    default: () => [],
  }),
  /** gate 节点算出的下一步走向 */
  gateOutcome: Annotation<'act' | 'think' | 'respond' | 'halt'>({
    reducer: (_p, n) => n,
    default: () => 'think',
  }),
  /**
   * 用户主动中断（点了检查点上的「中断」、或拒绝了风险确认）。
   *
   * 与 gaveUp 的分工：halted 是「用户让停」，gaveUp 是「系统放弃」。
   * 父图对两者的处置相同（都停整条计划、不登记产物），但对外话术与
   * `done.stopReason` 必须区分得开 —— 否则排障时分不清是用户叫停还是我们认输。
   */
  halted: Annotation<boolean>({ reducer: (_p, n) => n, default: () => false }),
  /**
   * 系统放弃本轮：工具反复失败（超过 MAX_DEGRADE）或轮次用尽（超过该 agent 的 maxIterations）。
   *
   * 这两个出口共用它，所以它们在父图看来是同一件事（停计划、不推进），
   * 而不是一个走 halted、另一个被当成正常完成继续往下跑。
   */
  gaveUp: Annotation<boolean>({ reducer: (_p, n) => n, default: () => false }),

  // ---- 汇总 ----
  finalContent: Annotation<string>({ reducer: (_p, n) => n, default: () => '' }),
  usage: Annotation<{ inputTokens: number; outputTokens: number }>({
    reducer: (prev, next) => ({
      inputTokens: (prev?.inputTokens ?? 0) + (next?.inputTokens ?? 0),
      outputTokens: (prev?.outputTokens ?? 0) + (next?.outputTokens ?? 0),
    }),
    default: () => ({ inputTokens: 0, outputTokens: 0 }),
  }),
})

export type AgentStateType = typeof AgentState.State
