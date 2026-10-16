/**
 * 父图：单入口 + 页面/提示词路由 + 多 Agent 顺序编排。
 *
 *   START → router → planDriver ─(done)→ aggregate → END
 *                       │
 *                       ├─(agent_form_designer)→ [子图] → planAdvance ─┐
 *                       ├─(agent_workflow)─────→ [子图] → planAdvance ─┤
 *                       ├─(agent_template)─────→ [子图] → planAdvance ─┼─→ planDriver
 *                       └─(agent_submission)───→ [子图] → planAdvance ─┘
 *
 * 单 Agent 任务与多 Agent 编排走的是同一条代码路径：
 * router 总会产出一个计划（单步或多步），planDriver 按计划分发。
 *
 * interrupt() 发生在子图的 gate 节点，会自然冒泡到父图；resume 时
 * LangGraph 只重跑被中断的 gate，不会重放已执行过工具的 act。
 */
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { END, START, StateGraph, getWriter } from '@langchain/langgraph'
import { RouterService } from './router.service'
import { PlanService } from './plan.service'
import { AgentCatalogService } from './agent-catalog'
import { AgentSubgraphFactory } from './subgraph.factory'
import { CheckpointService } from './checkpoint.module'
import { UserMemoryService } from '../memory/user-memory.service'
import {
  AgentState,
  type AgentKey,
  type AgentStateType,
  type RouteDecision,
  type TurnLedgerEntry,
  type LedgerOutcome,
} from './agent-state'
import { buildStateBar, truncateGoal, normalizeAsk, deriveGoal, turnsToSummarize } from './conversation-state'
import type { OrchestrationPlan } from '../hub/hub.types'

function emit(event: Record<string, unknown>): void {
  try {
    const w = getWriter()
    if (typeof w === 'function') w(event)
  } catch {
    /* 非图执行上下文 */
  }
}

/** AgentKey → 父图里的节点名（用下划线，避免与 checkpoint_ns 的分隔符混淆） */
export function nodeNameOf(key: AgentKey): string {
  return `agent_${key.replace(/-/g, '_')}`
}

/** L3 近期窗口在 checkpoint 里保留的最大条数（超出后由 L2 摘要兜底或直接丢弃） */
const HISTORY_MAX = 40

/** 轮次台账在 checkpoint 里保留的最大条数（超出后丢弃最旧的） */
const LEDGER_MAX = 20

@Injectable()
export class AgentGraphService {
  private readonly logger = new Logger(AgentGraphService.name)
  private compiled?: any

  constructor(
    private readonly router: RouterService,
    private readonly plan: PlanService,
    private readonly catalog: AgentCatalogService,
    private readonly subgraphs: AgentSubgraphFactory,
    private readonly checkpoint: CheckpointService,
    private readonly config: ConfigService,
    private readonly memory: UserMemoryService,
  ) {}

  /** 编译后的图（懒加载，只编译一次） */
  get graph(): any {
    if (!this.compiled) this.compiled = this.compile()
    return this.compiled
  }

  private compile(): any {
    const builder = new StateGraph(AgentState)
      .addNode('router', (s) => this.routerNode(s))
      .addNode('planDriver', (s) => this.planDriver(s))
      .addNode('planAdvance', (s) => this.planAdvance(s))
      .addNode('aggregate', (s) => this.aggregate(s))

    // 每个领域 Agent 的 ReAct 子图。节点名由目录动态生成，这里放开编译期节点名校验
    const dynamic = builder as any
    for (const spec of this.catalog.list()) {
      dynamic.addNode(nodeNameOf(spec.key), this.subgraphs.build(spec))
    }

    // 条件边的目标在编译期是动态的（每个 Agent 一个节点），这里放开类型约束
    const branches: Record<string, string> = { aggregate: 'aggregate' }
    for (const spec of this.catalog.list()) branches[nodeNameOf(spec.key)] = nodeNameOf(spec.key)

    builder
      .addEdge(START, 'router')
      .addEdge('router', 'planDriver')
      .addConditionalEdges(
        'planDriver',
        (s: AgentStateType) => this.nextAfterPlanDriver(s),
        branches as any,
      )
      .addEdge('planAdvance', 'planDriver')

    for (const spec of this.catalog.list()) {
      dynamic.addEdge(nodeNameOf(spec.key), 'planAdvance')
    }

    builder.addEdge('aggregate', END)

    // interrupt/resume 依赖 checkpointer，所以它现在是硬依赖（MySQL 持久化）
    const checkpointer = this.checkpoint.saver
    return builder.compile({ checkpointer })
  }

  // ==================== router ====================

  private async routerNode(state: AgentStateType): Promise<Partial<AgentStateType>> {
    // state.route 来自 checkpoint，是上一轮落地的路由结果，用作会话连续性依据。
    // 先读 pendingClarification（新消息 = 用户已回答），交给路由后本轮清空；由 respond 按本轮
    // 是否仍以提问收尾重新写入（D6：先读后清）。
    const pending = state.pendingClarification ?? null
    const stateBar = buildStateBar({
      activeSubAgent: state.route?.agent ?? null,
      conversationGoal: state.conversationGoal,
      pendingClarification: pending,
      lastOutcome: pending ? 'waiting_user' : undefined,
    })
    const decision = await this.router.decide(state.userMessage, state.pageContext, {
      priorAgent: state.route?.agent ?? null,
      pendingClarification: pending,
      stateBar,
    })

    // 用户长期记忆召回（阶段 8 §3.7 / 8.3）：每轮一次，由 projectMemory 渲染进 <user_memory>
    // 注入子图。无库 / 开关关 / 失败 → []（降级为仅会话内记忆），不阻断路由。
    const userMemory = await this.memory
      .retrieve(state.userId, state.workspaceId, state.userMessage)
      .catch((err) => {
        this.logger.warn(`用户记忆召回失败：${(err as Error).message}`)
        return []
      })

    // 单 Agent 任务也包成一步计划，让后续只有一条代码路径
    const plan: OrchestrationPlan =
      decision.plan ?? {
        planId: `plan_${Math.random().toString(36).slice(2, 10)}`,
        description: state.userMessage,
        steps: [
          {
            id: '1',
            agent: decision.agent,
            action: 'execute',
            input: { description: state.userMessage },
            dependsOn: [],
            expects: 'Artifact',
          },
        ],
      }

    emit({
      type: 'route',
      agent: decision.agent,
      scenario: decision.scenario,
      source: decision.source,
      reason: decision.reason,
      isCrossDomain: decision.isCrossDomain,
      steps: plan.steps.map((s) => ({ id: s.id, agent: s.agent, action: s.action })),
    })

    // L3 近期窗口：追加本轮 user（assistant 由 aggregate 收尾追加）。窗口**预算溢出**时，把最旧的
    // 溢出部分压缩进 L2 摘要后再丢弃（§2.12-D3：触发由「固定轮次」改「预算溢出」，短会话零摘要）。
    // 预算与 projectMemory 同一口径（context.memoryBudgetTokens）；置 0 即关闭摘要。
    const prevTurns = state.historyTurns ?? []
    let summary = state.memorySummary ?? ''
    const budgetTokens = this.config?.get<number>('context.memoryBudgetTokens') ?? 0
    const overflow = turnsToSummarize(prevTurns, budgetTokens)
    let kept = prevTurns
    if (overflow > 0) {
      kept = prevTurns.slice(overflow)
      summary = await this.router.summarizeTurns(prevTurns.slice(0, overflow), summary)
    }
    const historyTurns = [...kept, { role: 'user' as const, content: state.userMessage }].slice(-HISTORY_MAX)

    // 轮次台账：先读旧数组、清掉可能残留的 pending（上一轮被抢占/中断没定稿的），再追加本轮
    // （outcome 先记 pending，由 aggregate 收尾定稿）。跨轮从 checkpoint 恢复，只保留最近 LEDGER_MAX 条。
    const turnLedger: TurnLedgerEntry[] = [
      ...(state.turnLedger ?? []).filter((e) => e.outcome !== 'pending'),
      {
        normAsk: normalizeAsk(state.userMessage),
        ask: truncateGoal(state.userMessage),
        agent: decision.agent,
        outcome: 'pending' as const,
      },
    ].slice(-LEDGER_MAX)

    return {
      route: decision,
      plan,
      // 会话级状态：目标仅在为空时写**首个实质消息**（跳过寒暄，存全文，渲染时截断 120，
      // 手册 §2.12-D5）；pendingClarification 先读后清（本轮若仍以提问收尾会由 respond 重写）。
      conversationGoal: state.conversationGoal || deriveGoal(state.userMessage),
      pendingClarification: null,
      historyTurns,
      turnLedger,
      memorySummary: summary,
      // 本轮召回到的用户长期记忆（阶段 8 / 8.3），供 projectMemory 渲染
      userMemory,
      // 每轮对话重建计划上下文
      stepIndex: 0,
      completedSteps: [],
      artifacts: {},
      // drafts 本身跨轮保留（旧线程播种 / 工具合并要用），但「本轮写过谁」必须清零：
      // 计划推进只看本轮，否则上一轮的草稿会替这一轮的步骤开路。
      turnDraftAgents: [],
      halted: false,
      gaveUp: false,
      // 一轮新消息 = 一次全新的尝试：上一轮攒下的失败额度不能带进来，
      // 否则用户换个说法重试时，模型第一次失败就直接吃 [DEGRADE]，白丢两次重试机会。
      //
      // 只能放这里，不能放子图的 prepare —— 多步计划的每个 step 都会重进 prepare，
      // 那样会把同一计划内前面步骤的计数也抹掉。resume 走 Command 直接恢复被中断的
      // gate，不过 routerNode，所以同一轮内的续跑不受影响。
      toolErrors: {},
      degradeCount: 0,
      finalContent: '',
      // 单条回答的用量基线（本轮开始前的累计值）：轮末相减得本轮用量。
      // 与 toolErrors 同理只能放这里 —— 放子图 prepare 会被多步计划的每一步覆盖掉。
      usageAtTurnStart: { ...state.usage },
      pendingCalls: [],
      lastTool: null,
      needThink: false,
      // 单步场景下不需要多花钱；多步计划里由 planDriver 覆盖成步骤指令
      userMessage: state.userMessage,
      sessionMetadataPatch: {
        engine: 'langgraph',
        planId: plan.planId,
        planDescription: plan.description,
      },
    }
  }

  // ==================== planDriver ====================

  /** 选择当前步骤并把它交给对应子图 */
  private planDriver(state: AgentStateType): Partial<AgentStateType> {
    const plan = state.plan
    const steps = plan?.steps ?? []
    let idx = state.stepIndex ?? 0

    if (state.halted || state.gaveUp) {
      return {} // 由 nextAfterPlanDriver 送去 aggregate
    }

    // 上游产物没到位（例如模板市场没搜到任何东西 → 第二步的 $1.schema 是 null）：
    // 这一步没有输入可做，整步跳过。不跳的话下游 Agent 会拿着空引用照常执行，
    // 凭空造一张跟请求无关的表，而用户还以为是自己要的那个。
    const skipped: string[] = []
    while (idx < steps.length && this.plan.hasUnresolvedRefs(steps[idx], state.artifacts)) {
      this.logger.warn(`计划步骤 ${steps[idx].id}(${steps[idx].agent}) 引用的上游产物缺失，跳过该步骤`)
      skipped.push(steps[idx].id)
      idx += 1
    }
    const completedSteps = skipped.length ? [...state.completedSteps, ...skipped] : state.completedSteps

    if (idx >= steps.length) {
      // 剩下的全被跳过了；登记完跳过的步骤，由 nextAfterPlanDriver 判空后送去 aggregate
      return { stepIndex: idx, completedSteps }
    }

    const step = steps[idx]
    const isFirstStep = idx === 0
    const built = this.plan.buildStepInput(step, state.artifacts, state.userMessage)

    emit({
      type: 'status',
      agent: step.agent,
      phase: state.halted ? 'halted' : 'executing',
      stepIndex: idx,
      totalSteps: steps.length,
      step: { id: step.id, agent: step.agent, action: step.action },
    })

    return {
      // 覆盖 route.agent，让条件边把控制权交给这一步的 Agent
      route: state.route ? ({ ...state.route, agent: step.agent } as RouteDecision) : null,
      stepIndex: idx,
      userMessage: isFirstStep ? state.userMessage : built.message,
      completedSteps,
    }
  }

  private nextAfterPlanDriver(state: AgentStateType): string {
    const steps = state.plan?.steps ?? []
    const idx = state.stepIndex ?? 0
    if (state.halted || state.gaveUp || idx >= steps.length) return 'aggregate'
    const agent = steps[idx].agent
    if (!this.catalog.get(agent)) {
      this.logger.warn(`计划里的 agent "${agent}" 不在目录中，跳过该步骤`)
      return 'aggregate'
    }
    return nodeNameOf(agent)
  }

  // ==================== planAdvance ====================

  /** 子图跑完后的收尾：登记产物、推进游标 */
  private planAdvance(state: AgentStateType): Partial<AgentStateType> {
    const steps = state.plan?.steps ?? []
    const idx = state.stepIndex ?? 0
    const step = steps[idx]
    if (!step) return {}

    // 用户中断 / 系统放弃：不标记完成、不推进、不登记产物，直接收尾
    if (state.halted || state.gaveUp) return {}

    // 只登记**本轮**写出过的草稿。drafts 跨轮保留（prepare 要用它给旧线程播种、
    // 工具要拿它做合并），所以上一轮的模板草稿在这里还看得到 —— 直接取会把
    // 「这一轮什么都没搜到」伪装成「有产物」，下游步骤拿到 $1.schema 就建出表来。
    const producedThisTurn = (state.turnDraftAgents ?? []).includes(step.agent)
    const draft = producedThisTurn ? state.drafts[step.agent] : undefined
    const artifacts = draft ? { ...state.artifacts, [step.id]: draft } : state.artifacts

    return {
      artifacts,
      completedSteps: [...state.completedSteps, step.id],
      stepIndex: idx + 1,
      // 下一步会重新 prepare，这里把残留清掉
      pendingCalls: [],
      lastTool: null,
      needThink: false,
      approved: false,
    }
  }

  // ==================== aggregate ====================

  private aggregate(state: AgentStateType): Partial<AgentStateType> {
    const plan = state.plan
    const artifacts = state.artifacts
    const steps = plan?.steps ?? []
    const done = state.completedSteps

    emit({
      type: 'aggregate',
      planId: plan?.planId ?? null,
      halted: state.halted,
      gaveUp: state.gaveUp,
      steps: steps.map((s) => ({ id: s.id, agent: s.agent, done: done.includes(s.id) })),
      artifactKeys: Object.keys(artifacts),
    })

    // 收尾时把本轮 assistant 回复追加进 L3 近期窗口（中断/放弃的话术不具记忆价值，不入）。
    // 每轮只跑一次 aggregate，故这里也是 assistant 轮的唯一追加点。
    const patch: Partial<AgentStateType> = { turnLedger: this.finalizeLedger(state) }
    if (!state.halted && !state.gaveUp && state.finalContent) {
      patch.historyTurns = [
        ...(state.historyTurns ?? []),
        { role: 'assistant' as const, content: state.finalContent },
      ].slice(-HISTORY_MAX)
    }

    // 最终话术沿用最后一个子图的回复；中断时子图已经给过话术
    return patch
  }

  /**
   * 台账定稿（手册 §2.12-D2）：每轮只跑一次 aggregate，是 assistant 轮的唯一收尾点，
   * 也就在这里把 routerNode 记下的 pending 条目按本轮实际结局定稿。
   * 结局判定全部确定性（无 LLM）：中断 > 放弃 > 待用户 > 有产物 > 已答复。
   */
  private finalizeLedger(state: AgentStateType): TurnLedgerEntry[] {
    const ledger = state.turnLedger ?? []
    if (ledger.length === 0) return ledger
    const last = ledger[ledger.length - 1]
    if (last.outcome !== 'pending') return ledger

    const outcome: LedgerOutcome = state.halted
      ? 'halted'
      : state.gaveUp
        ? 'gaveup'
        : state.pendingClarification
          ? 'waiting'
          : (state.turnDraftAgents?.length ?? 0) > 0
            ? 'artifact'
            : 'answered'
    const produced =
      outcome === 'artifact' ? Object.keys(state.artifacts ?? {}) : undefined

    return [...ledger.slice(0, -1), { ...last, outcome, produced }]
  }
}
