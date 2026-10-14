import {
  Controller,
  Post,
  Get,
  Delete,
  Logger,
  Param,
  Query,
  Body,
  Res,
  UseGuards,
  Req,
} from '@nestjs/common'
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger'
import { Response, Request } from 'express'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { SseWriter, SseEventType, startHeartbeat } from '../../common/sse/sse.writer'
import { LangGraphTurnService } from './langgraph-turn.service'
import { RouterService } from '../graph/router.service'
import { SessionService } from '../session/session.service'
import { ToolGateway } from '../harness/tool-gateway'
import { UserMemoryService } from '../memory/user-memory.service'

@ApiTags('Agent')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('agent')
export class HubController {
  private readonly logger = new Logger(HubController.name)

  constructor(
    private sessionService: SessionService,
    private toolGateway: ToolGateway,
    private langGraphTurn: LangGraphTurnService,
    private router: RouterService,
    private userMemory: UserMemoryService,
  ) {}

  /** POST /agent/chat — SSE 流式聊天（LangGraph 编排入口） */
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
      /** 用户点检查点按钮时的回执：本层下发的 callId */
      confirmCallId?: string
      /** 用户点检查点按钮时选中的 option.value */
      confirmAction?: string
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

    // 本轮的取消句柄：既是「客户端断开」的传播源，也是被下一轮抢占时收到的中止信号。
    const abortController = new AbortController()
    req.on('close', () => abortController.abort())

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

      // 已存在的会话不会因为 getOrCreate 换掉 workspaceId。JWT 里没有这个声明
      // （登录只签 sub/email），只能靠前端 context 带 —— 首次请求若落在还没拿到
      // wsId 的页面，会话就被建成空的了，之后每次 form_save 都会「缺少工作空间 ID」。
      // 这里按本次请求的可信值补一次，把旧的坏会话救回来。
      if (effectiveWsId && session.workspaceId !== effectiveWsId) {
        session = (await this.sessionService.updateWorkspace(session.id, effectiveWsId)) ?? session
      }

      // 取执行权：同一会话上一轮还在跑时，自动中断它并接管，而不是回
      // SESSION_BUSY 让用户干等（用户视角：开新一段对话 = 上一段作废）。
      const { preempted } = await this.sessionService.acquireRun(session.id, abortController)
      if (preempted) {
        this.logger.log(`会话 ${session.id} 上一轮仍在执行，已中止并由本轮接管`)
      }

      // 存储 token 到 metadata
      session.metadata = { ...(session.metadata || {}), userToken: rawToken }
      await this.sessionService.updateMetadata(session.id, { userToken: rawToken }).catch(() => {})

      // 发送 session 事件
      sse.writeEvent(SseEventType.SESSION, { sessionId: session.id })

      // 检查点回执（confirmCallId / confirmAction）由这一层认领，命中就续跑断点
      await this.langGraphTurn.runTurn({
        sse,
        session,
        body,
        userToken: rawToken,
        requestId: this.nanoid(),
        signal: abortController.signal,
      })
    } catch (err: any) {
      try { sse.writeEvent(SseEventType.ERROR, { code: 'FATAL', message: err.message || '未知错误' }) } catch {}
      try { sse.writeEvent(SseEventType.DONE, { sessionId: session?.id, stopReason: 'error', usage: { inputTokens: 0, outputTokens: 0 } }) } catch {}
    } finally {
      // 被抢占的那一轮在这里什么都不做：锁已经易主，清了会把新一轮放跑
      if (session) {
        await this.sessionService.releaseRun(session.id, abortController).catch(() => {})
      }
      heartbeat.stop()
      sse.end()
    }
  }

  /** POST /agent/chat/sync — 非流式聊天（只做路由预览，不执行 Agent） */
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

    const decision = await this.router.decide(body.message, {
      scenario: body.scenario,
      entityId: body.context?.entityId as string | undefined,
      pageLabel: body.context?.pageLabel as string | undefined,
    })

    return {
      sessionId: session.id,
      targetAgent: decision.agent,
      scenario: decision.scenario,
      plan: decision.plan ?? null,
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

  /**
   * GET /agent/memory — 当前用户的长期记忆（阶段 8 / 8.4）。
   *
   * workspaceId 优先取 JWT 声明，缺省时用查询参数补（JWT 不签该声明，靠前端 context 带）。
   * 无库 / 降级时 store 返回空列表，与「还没有记忆」表现一致。
   */
  @Get('memory')
  async listMemory(
    @CurrentUser() user: { userId: string; workspaceId?: string },
    @Query('workspaceId') workspaceId?: string,
  ): Promise<any> {
    const ws = (user.workspaceId || workspaceId || '').trim()
    const records = await this.userMemory.list(user.userId, ws)
    return records.map((r) => ({
      id: r.id,
      kind: r.kind,
      key: r.key,
      value: r.value,
      confidence: r.confidence,
      updatedAt: r.updatedAt,
    }))
  }

  /** DELETE /agent/memory/:id — 软删一条长期记忆（作用域限当前用户，防越权） */
  @Delete('memory/:id')
  async deleteMemory(
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
  ): Promise<any> {
    const deleted = await this.userMemory.remove(id, user.userId)
    return { deleted }
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
          '统计各地区的提交量',
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

    // 直调端点为「设计器」这类内部调用准备，**只能调只读工具**：写工具必须走对话流程，
    // 才能经过 HITL 检查点与确认门。否则未确认的删除/保存可从这条路径绕过（阶段 6 / S3.3）。
    const risk = this.toolGateway.getRisk(name)
    if (risk !== 'low') {
      return {
        code: 40300,
        data: null,
        message: `工具 ${name} 风险等级为 ${risk}，需经对话流程执行（含确认门）`,
        requestId: this.nanoid(),
      }
    }

    const args = {
      ...body.args,
      token: rawToken,
      workspaceId: user.workspaceId,
    }

    // 直调无会话上下文（不传 requestId/sessionId）：审计仍带上身份，便于归属到用户/工作空间
    const result = await this.toolGateway.execute(name, args, {
      userId: user.userId,
      workspaceId: user.workspaceId,
    })
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

  private nanoid(length = 8): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
    let result = ''
    for (let i = 0; i < length; i++) result += chars[Math.floor(Math.random() * chars.length)]
    return result
  }
}
