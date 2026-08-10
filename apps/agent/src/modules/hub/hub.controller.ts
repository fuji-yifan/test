import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  Res,
  UseGuards,
  Req,
} from '@nestjs/common'
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger'
import { Response, Request } from 'express'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { Public } from '../../common/decorators/public.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { SseWriter, SseEventType, startHeartbeat } from '../../common/sse/sse.writer'
import { HubService } from './hub.service'
import { SessionService } from '../session/session.service'
import { FormDesignerAgent } from '../sub-agents/form-designer/form-designer.agent'
import { WorkflowAgent } from '../sub-agents/workflow/workflow.agent'
import { TemplateAgent } from '../sub-agents/template/template.agent'
import { SubmissionAgent } from '../sub-agents/submission/submission.agent'
import { ToolGateway } from '../harness/tool-gateway'
import { ToolRegistry } from '../harness/tool.registry'
import { HubStateBar } from './hub.state-bar'

@ApiTags('Agent')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('agent')
export class HubController {
  constructor(
    private hubService: HubService,
    private sessionService: SessionService,
    private formDesigner: FormDesignerAgent,
    private workflowAgent: WorkflowAgent,
    private templateAgent: TemplateAgent,
    private submissionAgent: SubmissionAgent,
    private toolGateway: ToolGateway,
    private toolRegistry: ToolRegistry,
    private stateBar: HubStateBar,
  ) {}

  /** POST /agent/chat — SSE 流式聊天（Hub-Agent 入口，支持多步骤编排） */
  @Post('chat')
  async chat(
    @CurrentUser() user: { userId: string; workspaceId: string },
    @Body()
    body: {
      sessionId?: string
      scenario: string
      message: string
      context?: Record<string, unknown>
      stream?: boolean
      confirmCallId?: string
    },
    @Res() res: Response,
    @Req() req: Request,
  ): Promise<void> {
    // 非流式走 sync 端点
    if (body.stream === false) {
      const result = await this.chatSync(user, body)
      res.json({ code: 0, data: result, message: 'ok', requestId: this.nanoid() })
      return
    }

    // SSE 流式
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders()

    const sse = new SseWriter(res)
    const heartbeat = startHeartbeat(res, 15000)
    let session: Awaited<ReturnType<typeof this.sessionService.getOrCreate>> | null = null

    try {
      // 提取原始 JWT token
      const authHeader = req.headers.authorization || ''
      const rawToken = authHeader.replace('Bearer ', '')

      // 获取或创建会话
      const effectiveWsId = (user.workspaceId || (body.context?.workspaceId as string) || '').trim()
      session = await this.sessionService.getOrCreate(body.sessionId, {
        userId: user.userId,
        workspaceId: effectiveWsId,
        scenario: body.scenario,
      })

      // 锁会话
      const locked = await this.sessionService.lock(session.id)
      if (!locked) {
        sse.writeEvent(SseEventType.ERROR, {
          code: 'SESSION_BUSY',
          message: '会话正在执行中，请等待完成',
        })
        sse.writeEvent(SseEventType.DONE, {
          sessionId: session.id,
          stopReason: 'locked',
          usage: { inputTokens: 0, outputTokens: 0 },
        })
        sse.end()
        heartbeat.stop()
        return
      }

      // 存储 token 到 metadata
      session.metadata = { ...(session.metadata || {}), userToken: rawToken }
      await this.sessionService.updateMetadata(session.id, { userToken: rawToken }).catch(() => {})

      // 发送 session 事件
      sse.writeEvent(SseEventType.SESSION, { sessionId: session.id })

      // 处理确认操作
      let confirmHandled = false
      if (body.confirmCallId && session.metadata?.pendingConfirms) {
        const confirms = session.metadata.pendingConfirms as any[]
        const target = confirms.find((c) => c.callId === body.confirmCallId)
        if (target) {
          const result = await this.toolGateway.executeConfirmed(target.tool, target.args)
          sse.writeEvent(SseEventType.TOOL_RESULT, {
            callId: target.callId,
            tool: target.tool,
            ok: result.ok,
            summary: result.summary || 'Confirmed and executed',
          })
          await this.sessionService.updateMetadata(session.id, {
            pendingConfirms: confirms.filter((c) => c.callId !== body.confirmCallId),
            lastConfirmAction: 'confirmed',
          })
          sse.writeEvent(SseEventType.MESSAGE, {
            role: 'assistant',
            content: result.ok
              ? `✅ ${target.tool} 执行成功`
              : `❌ ${target.tool} 执行失败：${result.summary || ''}`,
          })
          confirmHandled = true
        }
      }

      // 编排循环（纯确认消息跳过，避免死循环）
      if (!confirmHandled) {
        await this.runOrchestrationLoop(session, body.message, body.scenario, sse, req)
      }

    } catch (err: any) {
      try { sse.writeEvent(SseEventType.ERROR, { code: 'FATAL', message: err.message || '未知错误' }) } catch {}
      try { sse.writeEvent(SseEventType.DONE, { sessionId: session?.id, stopReason: 'error', usage: { inputTokens: 0, outputTokens: 0 } }) } catch {}
    } finally {
      if (session) {
        await this.sessionService.unlock(session.id).catch(() => {})
      }
      heartbeat.stop()
      sse.end()
    }
  }

  /**
   * 编排循环：反复调用 orchestrate → run agent → advance plan → 直到计划完成。
   */
  private async runOrchestrationLoop(
    session: any,
    userMessage: string,
    scenario: string,
    sse: SseWriter,
    req: Request,
  ): Promise<void> {
    const abortController = new AbortController()
    req.on('close', () => abortController.abort())

    let currentMessage = userMessage
    let totalToolCalls = 0
    let totalInputTokens = 0
    let totalOutputTokens = 0
    let isFirstStep = true

    // 最多执行 MAX_PLAN_STEPS 步（防止无限循环）
    const MAX_PLAN_STEPS = 5

    for (let stepIndex = 0; stepIndex < MAX_PLAN_STEPS; stepIndex++) {
      if (abortController.signal.aborted) break

      // 重新加载 session（metadata 可能在之前步骤更新过）
      session = await this.sessionService.get(session.id)
      if (!session) break

      // 1. 编排：确定当前应该用哪个 Agent
      const orchestration = await this.hubService.orchestrate(session, currentMessage, scenario)

      // 2. 更新 metadata（plan + currentStepId）
      if (orchestration.plan && isFirstStep) {
        await this.hubService.updateMetadata(session.id, {
          plan: orchestration.plan,
          currentStepId: orchestration.plan.steps[0]?.id,
          activeSubAgent: orchestration.targetAgent,
          phase: 'executing',
          completedSteps: [],
          artifacts: {},
        })
        session = await this.sessionService.get(session.id)
      } else {
        await this.hubService.updateMetadata(session.id, {
          activeSubAgent: orchestration.targetAgent,
          phase: 'executing',
        })
      }

      // 3. 发送 status 事件
      const state = this.stateBar.generate(session!)
      sse.writeEvent(SseEventType.STATUS, {
        agent: state.agent,
        phase: state.phase,
        todo: state.todo.map((t) => t.text),
      })

      // 4. 执行 Sub-Agent
      const agent = this.pickAgent(orchestration.targetAgent)
      const runResult = await agent.run(session!, currentMessage, sse, abortController.signal)

      totalToolCalls += runResult.toolCalls
      totalInputTokens += runResult.usage.inputTokens
      totalOutputTokens += runResult.usage.outputTokens

      // 5. 记录产物（供下游步骤引用）
      if (orchestration.plan) {
        const currentStepId = session.metadata?.currentStepId
        if (currentStepId) {
          const artifactType = this.getArtifactType(orchestration.targetAgent)
          const artifactData = this.extractArtifactData(orchestration.targetAgent, session.metadata)
          if (artifactData) {
            await this.hubService.recordArtifact(session.id, currentStepId, artifactType, artifactData)
          }
        }
      }

      // 6. 推进计划
      if (orchestration.plan) {
        const currentStepId = session.metadata?.currentStepId
        if (currentStepId) {
          await this.hubService.completeStep(session.id, currentStepId)
        }

        // 重新加载 session 获取更新后的 metadata
        session = await this.sessionService.get(session.id)

        const advanced = this.hubService.advancePlan(session!)
        if (!advanced) break // 计划完成

        // 解析下一步的输入引用
        const resolvedInput = this.hubService.resolveStepInput(
          advanced.nextStep,
          session?.metadata?.artifacts || {},
        )

        // 准备下一步的消息
        currentMessage = this.buildStepMessage(advanced.nextStep, resolvedInput)
        isFirstStep = false
        scenario = '' // 后续步骤不再用前端 scenario
        continue
      }

      // 单步任务 → 完成
      break
    }

    // 汇总
    await this.hubService.updateMetadata(session!.id, {
      phase: 'completed',
      activeSubAgent: null,
      tokenUsage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
    })
  }

  /** 构建传递给下一步 Sub-Agent 的上下文消息 */
  private buildStepMessage(step: any, resolvedInput: Record<string, unknown>): string {
    const parts: string[] = [`[步骤 ${step.id}] ${step.action}`]
    for (const [key, value] of Object.entries(resolvedInput)) {
      if (key === 'query' || key === 'description') {
        parts.push(`${key}: ${value}`)
      } else if (typeof value === 'object') {
        parts.push(`${key}: ${JSON.stringify(value).slice(0, 500)}`)
      }
    }
    return parts.join('\n')
  }

  /** 从 session metadata 中提取产物数据 */
  private extractArtifactData(
    agent: string,
    metadata: Record<string, any>,
  ): Record<string, unknown> | null {
    switch (agent) {
      case 'form-designer':
        if (metadata?.draftSchema) return { schema: metadata.draftSchema }
        return null
      case 'workflow':
        if (metadata?.draftWorkflow) return metadata.draftWorkflow as Record<string, unknown>
        return null
      case 'template':
        if (metadata?.draftTemplate) return metadata.draftTemplate as Record<string, unknown>
        return null
      case 'submission':
        if (metadata?.lastAnalysis) return metadata.lastAnalysis as Record<string, unknown>
        return null
      default:
        return null
    }
  }

  private getArtifactType(agent: string): string {
    switch (agent) {
      case 'form-designer': return 'FormArtifact'
      case 'workflow': return 'WorkflowArtifact'
      case 'template': return 'TemplateArtifact'
      case 'submission': return 'AnalysisArtifact'
      default: return 'Artifact'
    }
  }

  /** POST /agent/chat/sync — 非流式聊天 */
  @Post('chat/sync')
  async chatSync(
    @CurrentUser() user: { userId: string; workspaceId: string },
    @Body()
    body: {
      sessionId?: string
      scenario: string
      message: string
      context?: Record<string, unknown>
    },
  ): Promise<any> {
    const session = await this.sessionService.getOrCreate(body.sessionId, {
      userId: user.userId,
      workspaceId: user.workspaceId || (body.context?.workspaceId as string) || '',
      scenario: body.scenario,
    })

    const orchestration = await this.hubService.orchestrate(session, body.message, body.scenario)

    return {
      sessionId: session.id,
      targetAgent: orchestration.targetAgent,
      scenario: orchestration.targetScenario,
      plan: orchestration.plan || null,
    }
  }

  /** GET /agent/sessions — 用户会话列表 */
  @Get('sessions')
  async listSessions(
    @CurrentUser() user: { userId: string },
  ): Promise<any> {
    const sessions = await this.sessionService.listByUser(user.userId)
    return sessions.map((s) => ({
      id: s.id,
      scenario: s.scenario,
      messageCount: s.messages.length,
      locked: s.locked,
      updatedAt: s.updatedAt,
    }))
  }

  /** GET /agent/sessions/:id — 会话详情 */
  @Get('sessions/:id')
  async getSession(@Param('id') id: string): Promise<any> {
    const session = await this.sessionService.get(id)
    if (!session) return null
    return {
      id: session.id,
      scenario: session.scenario,
      messages: session.messages,
      metadata: session.metadata,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    }
  }

  /** DELETE /agent/sessions/:id — 删除会话 */
  @Delete('sessions/:id')
  async deleteSession(@Param('id') id: string): Promise<any> {
    await this.sessionService.delete(id)
    return { deleted: true }
  }

  /** GET /agent/scenarios — 可用 Sub-Agent 列表 + 示例提示 */
  @Get('scenarios')
  async listScenarios(): Promise<any> {
    return [
      {
        agent: 'form-designer',
        scenario: 'form-builder',
        label: '表单设计',
        description: '通过对话创建和编辑表单，支持字段池检索、schema 校验和预览',
        examplePrompts: [
          '创建一个客户登记表，包含姓名、手机号、邮箱',
          '给我的售后工单表加上紧急程度字段',
        ],
      },
      {
        agent: 'workflow',
        scenario: 'workflow-node',
        label: '流程编排',
        description: '创建审批工作流，支持条件分支、会签、或签',
        examplePrompts: [
          '创建一个三级审批流：组长→经理→总监',
          '金额超过5000时需要总监审批',
        ],
      },
      {
        agent: 'template',
        scenario: 'template-creator',
        label: '模板市场',
        description: '搜索和使用预置模板，快速搭建应用',
        examplePrompts: [
          '搜索客服工单相关的模板',
          '基于请假模板创建一个新表单',
        ],
      },
      {
        agent: 'submission',
        scenario: 'data-analysis',
        label: '数据分析',
        description: '分析表单提交数据，生成洞察和图表建议',
        examplePrompts: [
          '分析本月客户反馈数据，找出主要问题',
          '审批这个任务 T2026-001',
        ],
      },
    ]
  }

  /** POST /agent/tools/:name — 直接调用指定工具（给设计器用） */
  @Post('tools/:name')
  async callTool(
    @CurrentUser() user: { userId: string; workspaceId: string },
    @Param('name') name: string,
    @Body() body: { args: Record<string, unknown> },
    @Req() req: Request,
  ): Promise<any> {
    const authHeader = req.headers.authorization || ''
    const rawToken = authHeader.replace('Bearer ', '')

    const args = {
      ...body.args,
      token: rawToken,
      workspaceId: user.workspaceId,
    }

    const result = await this.toolGateway.execute(name, args)
    if (result.confirmRequired) {
      return {
        code: 0,
        data: {
          confirmRequired: true,
          confirmCallId: result.confirmCallId,
          risk: result.risk,
          summary: result.summary,
        },
        message: 'Confirmation required',
        requestId: this.nanoid(),
      }
    }

    return {
      code: 0,
      data: { ok: result.ok, result: result.result, summary: result.summary },
      message: 'ok',
      requestId: this.nanoid(),
    }
  }

  /** 根据编排结果选择对应的 Sub-Agent */
  private pickAgent(target: string): {
    run: (session: any, msg: string, sse: SseWriter, signal?: AbortSignal) => Promise<{
      finalContent: string; toolCalls: number; usage: { inputTokens: number; outputTokens: number }
    }>
  } {
    switch (target) {
      case 'workflow': return this.workflowAgent
      case 'template': return this.templateAgent
      case 'submission': return this.submissionAgent
      case 'form-designer':
      default: return this.formDesigner
    }
  }

  private nanoid(length = 8): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
    let result = ''
    for (let i = 0; i < length; i++) result += chars[Math.floor(Math.random() * chars.length)]
    return result
  }
}
