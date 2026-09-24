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
import { END, START, StateGraph, getWriter } from '@langchain/langgraph'
import { RouterService } from './router.service'
import { PlanService } from './plan.service'
import { AgentCatalogService } from './agent-catalog'
import { AgentSubgraphFactory } from './subgraph.factory'
import { CheckpointService } from './checkpoint.module'
import { AgentState, type AgentKey, type AgentStateType, type RouteDecision } from './agent-state'
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

    // interrupt/resume 依赖 checkpointer；legacy 引擎下没有它，图本身仍可跑（只是不能续跑）
    const checkpointer = this.checkpoint.enabled ? this.checkpoint.saver : undefined
    if (!checkpointer) {
      this.logger.warn('未启用 checkpoint（AGENT_ENGINE != langgraph）：interrupt 无法持久化')
    }
    return builder.compile(checkpointer ? { checkpointer } : undefined)
  }

  // ==================== router ====================

  private async routerNode(state: AgentStateType): Promise<Partial<AgentStateType>> {
    const decision = await this.router.decide(state.userMessage, state.pageContext)

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

    return {
      route: decision,
      plan,
      // 每轮对话重建计划上下文
      stepIndex: 0,
      completedSteps: [],
      artifacts: {},
      halted: false,
      finalContent: '',
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
    const idx = state.stepIndex ?? 0

    if (state.halted || idx >= steps.length) {
      return {} // 由 nextAfterPlanDriver 送去 aggregate
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
    }
  }

  private nextAfterPlanDriver(state: AgentStateType): string {
    const steps = state.plan?.steps ?? []
    const idx = state.stepIndex ?? 0
    if (state.halted || idx >= steps.length) return 'aggregate'
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

    // 用户中断：不标记完成、不推进，直接收尾
    if (state.halted) return {}

    const draft = state.drafts[step.agent]
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
      steps: steps.map((s) => ({ id: s.id, agent: s.agent, done: done.includes(s.id) })),
      artifactKeys: Object.keys(artifacts),
    })

    // 最终话术沿用最后一个子图的回复；中断时子图已经给过话术
    return {}
  }
}
