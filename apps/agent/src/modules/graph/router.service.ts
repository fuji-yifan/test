/**
 * 路由节点：决定这句话交给哪个领域 Agent。
 *
 * 决策顺序（先确定性、后模型）：
 * 1. 消息里有明确的「跨领域」表达（模板 + 流程 + 创建/基于）→ 直接生成多步计划；
 * 2. 消息里有明确指向别的领域的强信号（如"搜索模板"）→ 覆盖当前页面；
 * 3. 否则当前页面就是默认身份（source=page）；
 * 4. 仅当消息出现「别的领域的弱信号」造成歧义时，才调用 LLM 兜底分类。
 *
 * 这样既满足「页面 + 提示词共同决定路由」，又不会每条消息都多花一次 LLM 调用。
 */
import { Injectable, Logger } from '@nestjs/common'
import { LangGraphLlmService } from '../llm/langgraph-llm.service'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import type { OrchestrationPlan, OrchestrationStep } from '../hub/hub.types'
import type { AgentKey, PageContext, RouteDecision } from './agent-state'
import { AgentCatalogService } from './agent-catalog'

/** 各领域的强信号（用户明确在说这个领域的事） */
const STRONG: { agent: AgentKey; re: RegExp }[] = [
  { agent: 'template', re: /搜索.*模板|查找.*模板|有什么模板|找.*模板|浏览.*模板/ },
  { agent: 'workflow', re: /创建.*审批|设计.*流程|搭建.*流程|配置.*审批|审批流|工作流/ },
  { agent: 'form-designer', re: /设计.*[表表单]|创建.*表单|做一个.*[表表单]|新建.*表单/ },
  { agent: 'submission', re: /分析.*数据|数据.*分析|统计.*数据|数据.*趋势/ },
]

/** 弱信号：出现只能说明"可能相关"，不足以单独改路由 */
const WEAK: Record<AgentKey, RegExp> = {
  template: /模板/,
  workflow: /流程|节点|审批/,
  'form-designer': /表单|字段|表/,
  submission: /数据|分析|提交/,
}

/** 跨领域：模板 + 流程 + 创建/基于 → 三步计划 */
const CROSS_TEMPLATE_FLOW = (msg: string): boolean => {
  const t = msg.toLowerCase()
  const hasTemplate = t.includes('模板') || t.includes('template')
  const hasFlow = t.includes('审批') || t.includes('流程')
  const hasCreate = t.includes('创建') || t.includes('基于') || t.includes('搭建')
  return hasTemplate && hasFlow && hasCreate
}

/** 模板 + 创建/基于 → 两步计划 */
const CROSS_TEMPLATE_FORM = (msg: string): boolean => {
  const t = msg.toLowerCase()
  return (t.includes('基于') || t.includes('模板')) && (t.includes('创建') || t.includes('生成'))
}

/** decide 的可选上下文：会话连续性所需的信息（手册 D5） */
export interface DecideOptions {
  /** 上一轮已经落地的领域身份（来自 checkpoint 的 state.route） */
  priorAgent?: AgentKey | null
  /** 上一轮以提问收尾、正在等待回答的领域（来自 state.pendingClarification） */
  pendingClarification?: { agent: AgentKey; question: string } | null
  /** 会话状态栏（<agent_status>…</agent_status>），拼进分类器的输入 */
  stateBar?: string
}

@Injectable()
export class RouterService {
  private readonly logger = new Logger(RouterService.name)

  constructor(
    private readonly catalog: AgentCatalogService,
    private readonly llm: LangGraphLlmService,
  ) {}

  /** 纯确定性路由（不联网、可单测） */
  decideDeterministic(userMessage: string, page: PageContext): RouteDecision {
    const pageAgent = this.catalog.agentByScenario(page.scenario)

    if (CROSS_TEMPLATE_FLOW(userMessage)) {
      return {
        agent: 'template',
        scenario: 'template-creator',
        source: 'prompt',
        reason: '模板 + 流程 + 创建 → 三步编排',
        isCrossDomain: true,
        plan: this.templateFlowPlan(userMessage),
      }
    }

    if (CROSS_TEMPLATE_FORM(userMessage) && pageAgent !== 'template') {
      return {
        agent: 'template',
        scenario: 'template-creator',
        source: 'prompt',
        reason: '基于模板创建 → 两步编排',
        isCrossDomain: true,
        plan: this.templateFormPlan(userMessage),
      }
    }

    for (const { agent, re } of STRONG) {
      if (agent !== pageAgent && re.test(userMessage)) {
        return this.withFormHandoff(
          {
            agent,
            scenario: this.catalog.scenarioByAgent(agent),
            source: 'prompt',
            reason: `提示词命中 ${agent} 的强信号，覆盖页面身份 ${pageAgent}`,
            isCrossDomain: false,
          },
          userMessage,
        )
      }
    }

    return this.withFormHandoff(
      {
        agent: pageAgent,
        scenario: page.scenario || this.catalog.scenarioByAgent(pageAgent),
        source: 'page',
        reason: `沿用当前页面身份（${page.scenario || '未知页面'}）`,
        isCrossDomain: false,
      },
      userMessage,
    )
  }

  /**
   * 模板请求补一步表单设计助手。
   *
   * 模板 Agent 只会 template_instantiate —— 那是在会话里按模板拼一份 schema，没有
   * 任何写接口（模板 Agent 的工具里根本没有 form_save）。而用户在「模板市场」页说
   * 「寻找客户相关表单」时想要的是表单管理里真出现一张表。所以单步的模板请求也扩成
   * [template, form-designer] 两步，落库交给拥有 form_save 的表单设计助手
   * （它自带「这个表单是否加入当前空间？」检查点）。
   *
   * 已有计划（跨领域模板/流程）不动，避免重复编排。
   */
  private withFormHandoff(decision: RouteDecision, userMessage: string): RouteDecision {
    if (decision.agent !== 'template' || decision.plan) return decision
    return {
      ...decision,
      isCrossDomain: true,
      reason: `${decision.reason}；模板需经表单设计助手落库`,
      plan: this.templateFormPlan(userMessage),
    }
  }

  /** 是否存在歧义（值得多花一次 LLM） */
  isAmbiguous(userMessage: string, pageAgent: AgentKey): boolean {
    if (CROSS_TEMPLATE_FLOW(userMessage) || CROSS_TEMPLATE_FORM(userMessage)) return false
    for (const { agent, re } of STRONG) {
      if (agent !== pageAgent && re.test(userMessage)) return false // 已有明确覆盖
    }
    // 只有出现别的领域的弱信号才算歧义
    return (Object.keys(WEAK) as AgentKey[]).some(
      (a) => a !== pageAgent && WEAK[a].test(userMessage),
    )
  }

  /**
   * 完整决策：确定性 → 待回答领域沿用 → 会话连续性 → 歧义时 LLM 兜底。
   * LLM 失败/输出不合法时一律回退到确定性结论，绝不让路由变脆。
   *
   * opts.priorAgent 是上一轮已经落地的领域身份（来自 checkpoint 的 state.route）。
   * opts.pendingClarification 是上一轮「以提问收尾、正在等用户回答」的领域
   * （来自 state.pendingClarification）。会话连续性靠它们维护：一段对话里补的
   * 片段（如"教职工信息表单"）是回答上一轮的追问，不该被别的领域的弱信号改判成
   * 「新建表单」而打断上下文。
   */
  async decide(
    userMessage: string,
    page: PageContext,
    opts?: DecideOptions,
  ): Promise<RouteDecision> {
    const priorAgent = opts?.priorAgent ?? null
    const base = this.decideDeterministic(userMessage, page)

    // D5 第 3 步：上一轮以提问收尾，且当前消息没有强换领域 → 直接回该领域，不调 LLM。
    const pending = opts?.pendingClarification?.agent
    if (pending && this.catalog.get(pending)) {
      const hitsStrongForOther = STRONG.some(({ agent, re }) => agent !== pending && re.test(userMessage))
      if (!hitsStrongForOther) {
        this.logger.log(`路由沿用上一轮等待回答的领域：${pending}`)
        return {
          agent: pending,
          scenario: this.catalog.scenarioByAgent(pending),
          source: 'prompt',
          reason: '沿用上一轮正在等待回答的领域',
          isCrossDomain: false,
        }
      }
    }

    if (!this.isAmbiguous(userMessage, base.agent)) return base

    // 当前页面身份与上一轮一致时，保持上下文，不因弱信号交给无状态分类器改判。
    // 真正的换领域会命中 STRONG，上面的 isAmbiguous 已判为不歧义，走不到这里。
    if (priorAgent && priorAgent === base.agent) {
      this.logger.log(`路由保持会话上下文：沿用上一轮 ${priorAgent}`)
      return base
    }

    try {
      const llmDecision = await this.classify(userMessage, page, opts)
      if (llmDecision) {
        this.logger.log(`路由由 LLM 兜底：${base.agent} -> ${llmDecision.agent} (${llmDecision.reason})`)
        return this.withFormHandoff(llmDecision, userMessage)
      }
    } catch (err: any) {
      this.logger.warn(`LLM 路由失败，沿用确定性结论：${err.message}`)
    }
    return base
  }

  // ==================== 会话摘要（§2.11 L2）====================

  /**
   * 把若干轮旧对话压缩成一段摘要（便宜模型）。失败时沿用旧摘要，绝不让记忆层变脆。
   * 仅在 `context.memorySummaryTrigger` 打开且窗口溢出时被调用。
   */
  async summarizeTurns(
    turns: { role: string; content: string }[],
    prevSummary: string,
  ): Promise<string> {
    const transcript = turns.map((t) => `${t.role}: ${t.content}`).join('\n')
    const system =
      '把下面的多轮对话压缩成一段不超过 200 字的要点，保留已确认的目标、表单名、关键决策与结论。只输出摘要正文，不要解释。'
    try {
      const res = await this.llm.chat.invoke([new SystemMessage(system), new HumanMessage(transcript)])
      const text = typeof res.content === 'string' ? res.content : JSON.stringify(res.content)
      const merged = [prevSummary, text].map((s) => (s ?? '').trim()).filter(Boolean).join(' ')
      return merged
    } catch (err: any) {
      this.logger.warn(`会话摘要失败，沿用旧摘要：${err?.message ?? err}`)
      return prevSummary
    }
  }

  // ==================== LLM 分类 ====================

  private async classify(
    userMessage: string,
    page: PageContext,
    opts?: DecideOptions,
  ): Promise<RouteDecision | null> {
    const priorAgent = opts?.priorAgent ?? null
    const system = `你是低代码平台的意图分类器。根据「用户当前所在页面」「会话状态栏」「上一轮对话的领域」和「用户这句话」，判断该交给哪个领域 Agent。

每个领域都按「何时用 / 何时不用」判断，并给出反例：

- submission：用户在询问某张表的提交数据、趋势、异常时使用。
  不要用于「建表 / 改字段」（→ form-designer）；
  也不要用于用户只是在回答上一轮追问的短片段（应沿用上一轮领域）。
- form-designer：用户在创建新表单、增删字段时使用。
  不要用于「分析数据 / 统计趋势」（→ submission）；
  不要用于只是提及「表单」二字却在回答别的问题的场景。
- workflow：用户要创建/配置审批流程时使用。
- template：用户要搜索/浏览/套用模板时使用。

跨领域（同时涉及多个领域）时给出 steps，每个 step 用 agent 表示领域：
- "搜索客服工单模板，基于它创建表单" → template, form-designer
- "搜索请假模板，基于它建表单并配一个审批流" → template, form-designer, workflow

会话连续性（最高优先级）：若用户这句话只是对上一轮追问的补充或回答（例如状态栏显示上一轮在数据分析里问"要分析哪张表"，用户回"教职工信息表单"），应沿用「上一轮领域」，不要仅凭出现"表单/数据"等词就改判领域。真正换领域会明确说出「创建/设计表单」「搜索模板」这类意图。

只输出 JSON（不要 markdown、不要解释）：
{"isCrossDomain": false, "targetAgent": "form-designer", "reason": "一句话理由", "steps": [{"agent": "template", "action": "search+instantiate"}]}`

    const bar = opts?.stateBar ? `${opts.stateBar}\n` : ''
    const res = await this.llm.chat.invoke([
      new SystemMessage(system),
      new HumanMessage(
        `${bar}当前页面：${page.scenario || '未知'}\n上一轮领域：${priorAgent || '无'}\n用户消息：${userMessage}`,
      ),
    ])
    const text = typeof res.content === 'string' ? res.content : JSON.stringify(res.content)
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return null

    let parsed: any
    try {
      parsed = JSON.parse(match[0])
    } catch {
      return null
    }

    const agent = parsed?.targetAgent as AgentKey | undefined
    if (!agent || !this.catalog.get(agent)) return null

    const steps = (parsed?.steps as any[] | undefined)?.map((s) => s.agent).filter((a) => this.catalog.get(a))
    if (parsed?.isCrossDomain && steps && steps.length > 1) {
      return {
        agent: steps[0] as AgentKey,
        scenario: this.catalog.scenarioByAgent(steps[0] as AgentKey),
        source: 'llm',
        reason: parsed?.reason || 'LLM 判定为跨领域任务',
        isCrossDomain: true,
        plan: this.planFromAgents(steps as AgentKey[], userMessage),
      }
    }

    return {
      agent,
      scenario: this.catalog.scenarioByAgent(agent),
      source: 'llm',
      reason: parsed?.reason || 'LLM 分类',
      isCrossDomain: false,
    }
  }

  // ==================== 计划构造 ====================

  private planId(): string {
    return `plan_${this.nanoid(8)}`
  }

  private templateFlowPlan(userMessage: string): OrchestrationPlan {
    return {
      planId: this.planId(),
      description: userMessage,
      steps: [
        {
          id: '1',
          agent: 'template',
          action: 'search+instantiate',
          input: { query: userMessage },
          dependsOn: [],
          expects: 'TemplateArtifact',
        },
        {
          id: '2',
          agent: 'form-designer',
          action: 'customize',
          input: { templateRef: '$1.schema' },
          dependsOn: ['1'],
          expects: 'FormArtifact',
        },
        {
          id: '3',
          agent: 'workflow',
          action: 'create',
          input: { formRef: '$2', description: userMessage },
          dependsOn: ['2'],
          expects: 'WorkflowArtifact',
        },
      ],
    }
  }

  private templateFormPlan(userMessage: string): OrchestrationPlan {
    return {
      planId: this.planId(),
      description: userMessage,
      steps: [
        {
          id: '1',
          agent: 'template',
          action: 'search+instantiate',
          input: { query: userMessage },
          dependsOn: [],
          expects: 'TemplateArtifact',
        },
        {
          id: '2',
          agent: 'form-designer',
          action: 'customize',
          input: { templateRef: '$1.schema' },
          dependsOn: ['1'],
          expects: 'FormArtifact',
        },
      ],
    }
  }

  /** 把 LLM 给出的 agent 序列变成计划（步与步之间串行依赖） */
  private planFromAgents(agents: AgentKey[], userMessage: string): OrchestrationPlan {
    const steps: OrchestrationStep[] = agents.map((agent, i) => ({
      id: String(i + 1),
      agent,
      action: i === 0 ? 'execute' : 'continue',
      input: i === 0 ? { query: userMessage, description: userMessage } : { priorRef: `$${i}`, description: userMessage },
      dependsOn: i > 0 ? [String(i)] : [],
      expects: this.expectsOf(agent),
    }))
    return { planId: this.planId(), description: userMessage, steps }
  }

  private expectsOf(agent: AgentKey): string {
    switch (agent) {
      case 'form-designer':
        return 'FormArtifact'
      case 'workflow':
        return 'WorkflowArtifact'
      case 'template':
        return 'TemplateArtifact'
      default:
        return 'AnalysisArtifact'
    }
  }

  private nanoid(length = 8): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
    let out = ''
    for (let i = 0; i < length; i++) out += chars[Math.floor(Math.random() * chars.length)]
    return out
  }
}
