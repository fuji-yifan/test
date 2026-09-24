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
        return {
          agent,
          scenario: this.catalog.scenarioByAgent(agent),
          source: 'prompt',
          reason: `提示词命中 ${agent} 的强信号，覆盖页面身份 ${pageAgent}`,
          isCrossDomain: false,
        }
      }
    }

    return {
      agent: pageAgent,
      scenario: page.scenario || this.catalog.scenarioByAgent(pageAgent),
      source: 'page',
      reason: `沿用当前页面身份（${page.scenario || '未知页面'}）`,
      isCrossDomain: false,
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
   * 完整决策：确定性 → 歧义时 LLM 兜底。
   * LLM 失败/输出不合法时一律回退到确定性结论，绝不让路由变脆。
   */
  async decide(userMessage: string, page: PageContext): Promise<RouteDecision> {
    const base = this.decideDeterministic(userMessage, page)
    if (!this.isAmbiguous(userMessage, base.agent)) return base

    try {
      const llmDecision = await this.classify(userMessage, page)
      if (llmDecision) {
        this.logger.log(`路由由 LLM 兜底：${base.agent} -> ${llmDecision.agent} (${llmDecision.reason})`)
        return llmDecision
      }
    } catch (err: any) {
      this.logger.warn(`LLM 路由失败，沿用确定性结论：${err.message}`)
    }
    return base
  }

  // ==================== LLM 分类 ====================

  private async classify(userMessage: string, page: PageContext): Promise<RouteDecision | null> {
    const system = `你是低代码平台的意图分类器。根据「用户当前所在页面」和「用户这句话」，判断该交给哪个领域 Agent。

可选领域：
- template：搜索/浏览/使用模板（"搜索XX模板"、"有什么模板"）
- form-designer：设计/新建表单（"创建学生信息表"、"加一个手机号字段"）
- workflow：创建/配置审批流程（"创建三级审批流"）
- submission：数据分析（"分析本月提交数据"）

跨领域（同时涉及多个领域）时给出 steps，每个 step 用 agent 表示领域：
- "搜索客服工单模板，基于它创建表单" → template, form-designer
- "搜索请假模板，基于它建表单并配一个审批流" → template, form-designer, workflow

只输出 JSON（不要 markdown、不要解释）：
{"isCrossDomain": false, "targetAgent": "form-designer", "reason": "一句话理由", "steps": [{"agent": "template", "action": "search+instantiate"}]}`

    const res = await this.llm.chat.invoke([
      new SystemMessage(system),
      new HumanMessage(`当前页面：${page.scenario || '未知'}\n用户消息：${userMessage}`),
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
