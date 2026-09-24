import { Injectable, Logger } from '@nestjs/common'
import { SessionService } from '../session/session.service'
import { AgentSession } from '../session/session.store'
import { HubStateBar } from './hub.state-bar'
import { SkillsLoader } from '../harness/skills.loader'
import { ToolRegistry } from '../harness/tool.registry'
import { LlmClient } from '../llm/llm.client'
import { OrchestrationPlan, OrchestrationStep, ArtifactRef } from './hub.types'

export interface OrchestrationResult {
  targetAgent: string
  targetScenario: string
  context: Record<string, unknown>
  isCrossDomain: boolean
  plan?: OrchestrationPlan
}

@Injectable()
export class HubService {
  private readonly logger = new Logger(HubService.name)
  /** 已告警过的未知场景，避免每个请求刷一条日志 */
  private readonly warnedScenarios = new Set<string>()

  constructor(
    private sessionService: SessionService,
    private stateBar: HubStateBar,
    private skillsLoader: SkillsLoader,
    private toolRegistry: ToolRegistry,
    private llmClient: LlmClient,
  ) {}

  /**
   * Hub-Agent 编排入口：
   * 意图识别 → 任务分解 → 调度 Sub-Agent → 汇总结果
   *
   * 三级策略：
   * 1. 前端传入 scenario → 直接路由
   * 2. LLM 意图识别 → 关键词无法覆盖的复杂场景
   * 3. 关键词回退 → 快速、低成本
   */
  async orchestrate(
    session: AgentSession,
    userMessage: string,
    scenario: string,
  ): Promise<OrchestrationResult> {
    const metadata = session.metadata || {}
    const scenarioMap: Record<string, string> = {
      'form-builder': 'form-designer',
      'workflow-node': 'workflow',
      'template-creator': 'template',
      'data-analysis': 'submission',
    }

    // 0. 进行中的编排计划 → 继续执行（最高优先级）
    if (metadata.plan && metadata.currentStepId) {
      const plan = metadata.plan as OrchestrationPlan
      const currentStep = plan.steps.find((s) => s.id === metadata.currentStepId)
      if (currentStep) {
        const resolvedContext = this.resolveStepInput(currentStep, metadata.artifacts || {})
        return {
          targetAgent: currentStep.agent,
          targetScenario: this.agentToScenario(currentStep.agent),
          context: { ...currentStep.input, ...resolvedContext, planId: plan.planId },
          isCrossDomain: plan.steps.length > 1,
          plan,
        }
      }
    }

    // 1. 页面场景即为当前 Agent 身份
    if (scenario && !scenarioMap[scenario] && !this.warnedScenarios.has(scenario)) {
      // 与 langgraph 侧一致：未知场景会静默落到 form-designer，在这里喊一声
      this.warnedScenarios.add(scenario)
      this.logger.warn(`未知页面场景 "${scenario}"，默认身份落 form-designer`)
    }
    const pageAgent = scenarioMap[scenario] || 'form-designer'

    // 检测消息中的"跨页面"意图（用户在A页面说B页面的事）
    const crossIntent = this.detectCrossIntent(userMessage, pageAgent)
    if (crossIntent) {
      return crossIntent
    }

    // 默认：页面场景就是 Agent 身份
    return {
      targetAgent: pageAgent,
      targetScenario: scenario || this.agentToScenario(pageAgent),
      context: { userMessage },
      isCrossDomain: false,
    }
  }

  /**
   * 检测消息是否表达了与当前页面不同的意图。
   * 只有"明确矛盾"才切换，否则保持页面 Agent。
   */
  private detectCrossIntent(userMessage: string, pageAgent: string): OrchestrationResult | null {
    const lower = userMessage.toLowerCase()

    // 跨领域优先（比单领域更具体）：模板 + 审批/流程 + 创建/基于
    if ((lower.includes('模板') || lower.includes('template')) &&
        (lower.includes('审批') || lower.includes('流程')) &&
        (lower.includes('创建') || lower.includes('基于'))) {
      const sessionId = this.nanoid()
      return {
        targetAgent: 'template',
        targetScenario: 'template-creator',
        context: { userMessage },
        isCrossDomain: true,
        plan: {
          planId: `plan_${sessionId}`,
          description: userMessage,
          steps: [
            { id: '1', agent: 'template', action: 'search+instantiate', input: { query: userMessage }, dependsOn: [], expects: 'TemplateArtifact' },
            { id: '2', agent: 'form-designer', action: 'customize', input: { templateRef: '$1.schema' }, dependsOn: ['1'], expects: 'FormArtifact' },
            { id: '3', agent: 'workflow', action: 'create', input: { formRef: '$2', description: userMessage }, dependsOn: ['2'], expects: 'WorkflowArtifact' },
          ],
        },
      }
    }

    // 在非模板页面说"搜索模板"
    if (pageAgent !== 'template' && /搜索.*模板|查找.*模板|有什么模板|找.*模板/.test(userMessage)) {
      return { targetAgent: 'template', targetScenario: 'template-creator', context: { userMessage }, isCrossDomain: false }
    }

    // 在非流程页面说"创建审批流"（排除已被跨领域捕获的消息）
    if (pageAgent !== 'workflow' && /创建.*审批|设计.*流程|搭建.*流程|配置.*审批/.test(userMessage)) {
      return { targetAgent: 'workflow', targetScenario: 'workflow-node', context: { userMessage }, isCrossDomain: false }
    }

    // 在非表单页面说"设计一个XX表/表单"
    if (pageAgent !== 'form-designer' && /设计.*[表表单]|创建.*表单|做一个.*[表表单]/.test(userMessage)) {
      return { targetAgent: 'form-designer', targetScenario: 'form-builder', context: { userMessage }, isCrossDomain: false }
    }

    return null
  }

  /** LLM 意图识别 */
  private async llmClassify(userMessage: string): Promise<OrchestrationResult | null> {
    const prompt = `你是一个低代码平台的意图分类器。分析用户消息，判断属于哪个领域。

领域选项与关键信号词：
- template: 搜索、查找、浏览、下载模板；消息含"搜索XX模板""找模板""有什么模板"
- form-designer: 创建、设计、制作、搭建表单；消息含"创建XX表""设计表单""做一个XX"
- workflow: 创建、配置审批流、流程；消息含"审批流""流程""审批节点"
- submission: 数据分析

关键区分（重要）：
- "搜索学生模板" → template（在模板市场搜索）
- "创建学生信息表" → form-designer（设计新表单）
- "搜索客服工单模板，基于它创建表单" → template + form-designer（跨领域）
- "分析本月提交数据" → submission

严格返回 JSON（不要 markdown）：
{
  "isCrossDomain": false,
  "targetAgent": "form-designer",
  "targetScenario": "form-builder"
}`

    const result = await this.llmClient.complete({
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: userMessage },
      ],
      maxTokens: 500,
      temperature: 0.1,
    })

    const text = result.content || ''
    // 提取 JSON（可能被 markdown 包裹）
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null

    const parsed = JSON.parse(jsonMatch[0])
    if (!parsed.targetAgent) return null

    // 跨领域 → 构建编排计划
    if (parsed.isCrossDomain && parsed.steps?.length > 1) {
      const steps: OrchestrationStep[] = parsed.steps.map((s: any, i: number) => ({
        id: String(i + 1),
        agent: s.agent,
        action: s.action || 'execute',
        input: s.input || {},
        dependsOn: i > 0 ? [String(i)] : [],
        expects: this.agentExpects(s.agent),
      }))

      return {
        targetAgent: steps[0].agent,
        targetScenario: this.agentToScenario(steps[0].agent),
        context: { userMessage },
        isCrossDomain: true,
        plan: {
          planId: `plan_${this.nanoid()}`,
          description: userMessage,
          steps,
        },
      }
    }

    // 单领域
    return {
      targetAgent: parsed.targetAgent,
      targetScenario: parsed.targetScenario || this.agentToScenario(parsed.targetAgent),
      context: { userMessage },
      isCrossDomain: false,
    }
  }

  /** 关键词回退分类，未命中返回 null */
  private keywordClassify(userMessage: string, sessionId: string): OrchestrationResult | null {
    const lower = userMessage.toLowerCase()

    // 模板搜索："搜索...模板" / "查找模板" / "有什么模板"
    if (
      (lower.includes('搜索') || lower.includes('查找') || lower.includes('找') || lower.includes('有什么')) &&
      (lower.includes('模板') || lower.includes('template'))
    ) {
      return {
        targetAgent: 'template',
        targetScenario: 'template-creator',
        context: { userMessage },
        isCrossDomain: false,
      }
    }

    // 跨领域：模板 + 审批/流程
    if (
      (lower.includes('模板') || lower.includes('template')) &&
      (lower.includes('审批') || lower.includes('流程'))
    ) {
      const steps: OrchestrationStep[] = [
        { id: '1', agent: 'template', action: 'search+instantiate', input: { query: userMessage }, dependsOn: [], expects: 'TemplateArtifact' },
        { id: '2', agent: 'form-designer', action: 'customize', input: { templateRef: '$1.schema' }, dependsOn: ['1'], expects: 'FormArtifact' },
        { id: '3', agent: 'workflow', action: 'create', input: { formRef: '$2', description: userMessage }, dependsOn: ['2'], expects: 'WorkflowArtifact' },
      ]
      return {
        targetAgent: 'template',
        targetScenario: 'template-creator',
        context: { userMessage },
        isCrossDomain: true,
        plan: { planId: `plan_${sessionId}`, description: userMessage, steps },
      }
    }

    if (
      (lower.includes('基于') || lower.includes('模板')) &&
      lower.includes('创建')
    ) {
      const steps: OrchestrationStep[] = [
        { id: '1', agent: 'template', action: 'search+instantiate', input: { query: userMessage }, dependsOn: [], expects: 'TemplateArtifact' },
        { id: '2', agent: 'form-designer', action: 'customize', input: { templateRef: '$1.schema' }, dependsOn: ['1'], expects: 'FormArtifact' },
      ]
      return {
        targetAgent: 'template',
        targetScenario: 'template-creator',
        context: { userMessage },
        isCrossDomain: true,
        plan: { planId: `plan_${sessionId}`, description: userMessage, steps },
      }
    }

    // 单领域：模板
    if (lower.includes('模板') || lower.includes('template')) {
      return { targetAgent: 'template', targetScenario: 'template-creator', context: { userMessage }, isCrossDomain: false }
    }

    // 单领域：流程（排除"设计XX表""填写表""信息表"等表单场景）
    const isFormIntent = /设计.*[表表单]|填写表|信息表|登记表|创建.*表单/.test(userMessage)
    if (!isFormIntent && (lower.includes('审批') || lower.includes('流程') || lower.includes('节点'))) {
      return { targetAgent: 'workflow', targetScenario: 'workflow-node', context: { userMessage }, isCrossDomain: false }
    }

    // 单领域：数据
    if (lower.includes('分析') || lower.includes('数据') || lower.includes('趋势')) {
      return {
        targetAgent: 'submission',
        targetScenario: 'data-analysis',
        context: { userMessage },
        isCrossDomain: false,
      }
    }

    // 无关键词匹配 → 交给 LLM 处理
    return null
  }

  // ==================== 计划推进 ====================

  /**
   * 完成当前步骤，推进到下一步。
   * 返回下一步信息，如果计划已完成则返回 null。
   */
  advancePlan(session: AgentSession): { nextStep: OrchestrationStep; plan: OrchestrationPlan } | null {
    const metadata = session.metadata || {}
    const plan = metadata.plan as OrchestrationPlan | undefined
    if (!plan || !plan.steps.length) return null

    const currentStepId = metadata.currentStepId as string
    const completedSteps: string[] = metadata.completedSteps || []

    // 找到下一个待执行的步骤（依赖已满足且未完成）
    const nextStep = plan.steps.find((s) => {
      if (completedSteps.includes(s.id)) return false
      return s.dependsOn.every((depId) => completedSteps.includes(depId))
    })

    if (!nextStep) return null
    return { nextStep, plan }
  }

  /**
   * 根据 ArtifactRef 解析步骤输入中的引用。
   * 将 "$1.schema" 解析为 artifacts["1"].data.schema 的实际值。
   */
  resolveStepInput(
    step: OrchestrationStep,
    artifacts: Record<string, { type: string; data: Record<string, unknown> }>,
  ): Record<string, unknown> {
    const resolved: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(step.input)) {
      if (typeof value === 'string' && value.startsWith('$')) {
        resolved[key] = this.resolveRef(value, artifacts)
      } else {
        resolved[key] = value
      }
    }
    return resolved
  }

  /** 解析单个引用如 "$1.schema" 或 "$2" */
  private resolveRef(
    ref: string,
    artifacts: Record<string, { type: string; data: Record<string, unknown> }>,
  ): unknown {
    const parts = ref.replace(/^\$/, '').split('.')
    const stepId = parts[0]
    const artifact = artifacts[stepId]
    if (!artifact) return null

    if (parts.length === 1) return artifact.data
    // 沿着路径取值: $.schema → artifact.data.schema
    let value: any = artifact.data
    for (let i = 1; i < parts.length; i++) {
      if (value == null) return null
      value = value[parts[i]]
    }
    return value
  }

  /**
   * 记录 Sub-Agent 的产出物，供下游步骤引用。
   */
  async recordArtifact(
    sessionId: string,
    stepId: string,
    artifactType: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const session = await this.sessionService.get(sessionId)
    if (!session) return

    const artifacts = { ...(session.metadata?.artifacts || {}) }
    artifacts[stepId] = { type: artifactType, data }
    await this.sessionService.updateMetadata(sessionId, { artifacts })
    this.logger.log(`Recorded artifact for step ${stepId}: ${artifactType}`)
  }

  /**
   * 标记步骤完成，推进 currentStepId。
   */
  async completeStep(sessionId: string, stepId: string): Promise<void> {
    const session = await this.sessionService.get(sessionId)
    if (!session) return

    const metadata = session.metadata || {}
    const completedSteps: string[] = [...(metadata.completedSteps || []), stepId]

    const plan = metadata.plan as OrchestrationPlan | undefined
    const next = plan
      ? plan.steps.find((s) => {
          if (completedSteps.includes(s.id)) return false
          return s.dependsOn.every((depId) => completedSteps.includes(depId))
        })
      : null

    await this.sessionService.updateMetadata(sessionId, {
      completedSteps,
      currentStepId: next?.id || null,
      activeSubAgent: next?.agent || null,
      phase: next ? 'executing' : 'completed',
    })
  }

  /** 更新会话 metadata */
  async updateMetadata(sessionId: string, updates: Record<string, unknown>): Promise<void> {
    await this.sessionService.updateMetadata(sessionId, updates)
  }

  // ==================== 辅助方法 ====================

  private agentToScenario(agent: string): string {
    switch (agent) {
      case 'form-designer': return 'form-builder'
      case 'workflow': return 'workflow-node'
      case 'template': return 'template-creator'
      case 'submission': return 'data-analysis'
      default: return 'form-builder'
    }
  }

  private agentExpects(agent: string): string {
    switch (agent) {
      case 'form-designer': return 'FormArtifact'
      case 'workflow': return 'WorkflowArtifact'
      case 'template': return 'TemplateArtifact'
      case 'submission': return 'AnalysisArtifact'
      default: return 'Artifact'
    }
  }

  private getSession(id: string): ReturnType<SessionService['get']> {
    return this.sessionService.get(id)
  }

  private nanoid(length = 8): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
    let result = ''
    for (let i = 0; i < length; i++) result += chars[Math.floor(Math.random() * chars.length)]
    return result
  }
}
