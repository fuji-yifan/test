/**
 * LangGraph 引擎的 SSE 适配层。
 *
 * 职责边界：`GraphRunnerService` 只产出 GraphEvent 和「本轮结果」，不碰 HTTP；
 * 这一层负责把两者翻译成平台既有的 10 个 SSE 事件，前端只认这一套协议。
 *
 * 两处不能直通的差异在这里抹平：
 * 1. interrupt 不走 GraphEvent，而是作为 run/resume 的返回值出来 → 这里合成
 *    `confirm_required`；同时把 interrupt 记进 session.metadata，等前端回执。
 * 2. 图内的 `message` 事件只带 content，而前端预览卡片的数据源是
 *    `message.result` → 收尾时按 session.metadata 里的草稿补发一次。
 *
 * 前端回执契约（不新增端点）：再发一次 POST /agent/chat，带上 `confirmCallId`
 * （本层下发的 id）与 `confirmAction`（选中的 option.value）。
 */
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { SseEventType, SseWriter, type ConfirmOption } from '../../common/sse/sse.writer'
import { GraphRunnerService, type GraphEvent, type RunGraphResult } from '../graph/graph-runner.service'
import type { InterruptPayload } from '../graph/subgraph.factory'
import type { PageContext } from '../graph/agent-state'
import { SessionService } from '../session/session.service'
import { UserMemoryService } from '../memory/user-memory.service'
import type { AgentSession } from '../session/session.store'
import { extractArtifactData, extractLatestArtifact } from './hub.artifact'

/** 待答复的图中断。存在 session.metadata 里，供下一轮请求认领。 */
export interface PendingGraphInterrupt {
  callId: string
  kind: 'checkpoint' | 'tool_confirm' | 'disambiguate'
  checkpointId: string | null
  toolCallId: string
  tool: string | null
  prompt: string
  options: ConfirmOption[]
}

export interface LangGraphTurnBody {
  message: string
  scenario: string
  context?: Record<string, unknown>
  confirmCallId?: string
  confirmAction?: string
}

export interface LangGraphTurnParams {
  sse: SseWriter
  session: AgentSession
  body: LangGraphTurnBody
  userToken: string
  requestId: string
  signal: AbortSignal
}

/** 一轮请求内共享的临时状态（每轮新建，避免并发请求互相污染） */
interface TurnScope {
  requestId: string
  model: string
  todo: string[]
}

const PENDING_KEY = 'pendingGraphInterrupt'
const noop = (): void => {}

function shortId(length = 10): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let out = ''
  for (let i = 0; i < length; i++) out += chars[Math.floor(Math.random() * chars.length)]
  return out
}

/** 图里的 style 是宽松 string，前端按钮只认这三个；其余一律降级成 default */
function normalizeStyle(style?: string): ConfirmOption['style'] {
  return style === 'primary' || style === 'danger' ? style : 'default'
}

function toConfirmOptions(options: InterruptPayload['options']): ConfirmOption[] {
  return (options ?? []).map((o) => ({
    value: o.value,
    label: o.label,
    style: normalizeStyle(o.style),
  }))
}

@Injectable()
export class LangGraphTurnService {
  private readonly logger = new Logger(LangGraphTurnService.name)

  constructor(
    private readonly runner: GraphRunnerService,
    private readonly sessions: SessionService,
    private readonly config: ConfigService,
    private readonly memory: UserMemoryService,
  ) {}

  /**
   * 跑一轮。三种入口：
   * 1. 带 confirmCallId 且与待答复中断对得上 → 把它当 resume 值续跑；
   * 2. 有悬挂中断但用户没答，直接发了新消息 → 先 abort 收尾，再跑新消息；
   * 3. 普通新消息 → run。
   *
   * 本方法不发 `done` 之外的收尾动作：unlock / heartbeat / sse.end() 都由
   * HubController.chat 的 finally 统一负责。
   */
  async runTurn(params: LangGraphTurnParams): Promise<void> {
    const { sse, session, body } = params
    const scope: TurnScope = {
      requestId: params.requestId,
      model: this.config.get<string>('deepseek.model') ?? '',
      todo: [],
    }
    const onEvent = (event: GraphEvent): void => this.forward(event, sse, scope)

    const pending = session.metadata?.[PENDING_KEY] as PendingGraphInterrupt | undefined
    const base = {
      sessionId: session.id,
      userId: session.userId,
      workspaceId: session.workspaceId,
      userToken: params.userToken,
      signal: params.signal,
      onEvent,
    }

    let result: RunGraphResult
    try {
      if (body.confirmCallId && pending && pending.callId === body.confirmCallId) {
        // 用户点了检查点上的按钮
        const action = body.confirmAction || pending.options?.[0]?.value || 'abort'
        await this.clearPending(session.id)
        result = await this.runner.resume({ ...base, resume: { action } })
      } else if (pending) {
        // 悬挂中断：用户没答就发了新消息。先把图正常收尾，避免 checkpoint 卡在半途。
        this.logger.log(`会话 ${session.id} 存在未答复的检查点，先按 abort 收尾再处理新消息`)
        await this.runner.resume({ ...base, resume: { action: 'abort' }, onEvent: noop })
        await this.clearPending(session.id)
        result = await this.runner.run({ ...base, message: body.message, pageContext: this.pageContext(body) })
      } else {
        result = await this.runner.run({ ...base, message: body.message, pageContext: this.pageContext(body) })
      }
    } catch (err: any) {
      // 被新消息抢占、或客户端断开：图收到的就是中止信号，不是执行失败，
      // 别写成 FATAL 把日志搅浑（那一轮的 SSE 也已经没人听了）。
      if (params.signal.aborted) {
        this.logger.log(`会话 ${session.id} 本轮执行已中止（被新消息抢占或客户端断开）`)
        return
      }
      this.logger.error(`LangGraph 执行失败：${err?.message}`)
      this.safeWrite(sse, SseEventType.ERROR, { code: 'FATAL', message: err?.message || '未知错误' })
      this.safeWrite(sse, SseEventType.DONE, {
        sessionId: session.id,
        stopReason: 'error',
        usage: { inputTokens: 0, outputTokens: 0 },
      })
      return
    }

    await this.finish(session, result, sse, body.message)
  }

  // ==================== GraphEvent → SSE ====================

  private forward(event: GraphEvent, sse: SseWriter, scope: TurnScope): void {
    switch (event.type) {
      case 'delta':
        this.safeWrite(sse, SseEventType.DELTA, { content: event.content })
        return
      case 'tool_start':
        this.safeWrite(sse, SseEventType.TOOL_START, {
          callId: event.callId,
          tool: event.tool,
          args: event.args,
        })
        return
      case 'tool_result':
        this.safeWrite(sse, SseEventType.TOOL_RESULT, {
          callId: event.callId,
          tool: event.tool,
          ok: event.ok,
          summary: event.summary,
        })
        return
      case 'message':
        // 只带 content。最终那条带 result 的由 finish() 补发。
        this.safeWrite(sse, SseEventType.MESSAGE, { role: 'assistant', content: event.content })
        return
      case 'meta':
        this.safeWrite(sse, SseEventType.META, {
          model: scope.model,
          requestId: scope.requestId,
          activeAgent: event.agent,
          tools: event.tools ?? [],
        })
        return
      case 'status':
        // todo 是纯文案数组，进度信息在 phase 里表达
        this.safeWrite(sse, SseEventType.STATUS, {
          agent: event.agent,
          phase: event.phase,
          todo: scope.todo,
        })
        return
      case 'route': {
        const steps = (event.steps ?? []) as { id: string; action: string }[]
        scope.todo = steps.map((s) => `${s.id}. ${s.action}`)
        return
      }
      case 'error':
        // 图内上报的错误：RETRY/RETRYING/DEGRADE 是内部修正过程，前端按 code 自行过滤不提示；
        // 只有 CIRCUIT_BREAKER 是终态，必须让用户看到。
        // （FALLBACK 原先也走这里，2026-09-24 起不再下发 —— 放弃本轮改由
        //  `stopReason: 'giveup'` + 助手气泡表达，不再叠一个红 banner。）
        this.safeWrite(sse, SseEventType.ERROR, {
          code: (event.code as string) ?? 'UNKNOWN',
          message: (event.message as string) ?? '',
        })
        return
      default:
        // aggregate 等仅供内部使用的载荷，不下发；用量从 run/resume 的返回值取
        return
    }
  }

  // ==================== 收尾 ====================

  private async finish(
    session: AgentSession,
    result: RunGraphResult,
    sse: SseWriter,
    userMessage: string,
  ): Promise<void> {
    if (result.interrupted) {
      await this.askConfirm(session, result.interrupted, sse)
    } else {
      await this.sendFinalMessage(session, result, sse)
    }

    // 轮末异步提取长期记忆（阶段 8 §3.7）：fire-and-forget，不 await、不阻塞 SSE 收尾。
    // 只在正常完成的一轮触发（中断/放弃的话术不具记忆价值）；开关与降级都在 service 内部判。
    if (!result.interrupted && !result.halted && !result.gaveUp) {
      void this.memory
        .extractAndStore(session, result, userMessage)
        .catch((err) => this.logger.warn(`用户记忆提取失败：${err?.message ?? err}`))
    }

    sse.writeEvent(SseEventType.DONE, {
      sessionId: session.id,
      stopReason: result.interrupted
        ? 'interrupted'
        : result.halted
          ? 'halted'
          : result.gaveUp
            ? 'giveup'
            : 'completed',
      usage: result.usage,
      // 会话累计用量超软上限（阶段 4 / 4.4）：前端据此把用量徽标置为告警样式
      ...(this.usageAlert(result.usage) ? { usageAlert: true } : {}),
    })
  }

  /** 会话累计用量是否超软上限（阶段 4 / 4.4）；阈值 ≤ 0 = 关闭告警 */
  private usageAlert(usage: { inputTokens: number; outputTokens: number }): boolean {
    const limit = this.config.get<number>('context.usageSoftLimitTokens') ?? 0
    if (!Number.isFinite(limit) || limit <= 0) return false
    return usage.inputTokens + usage.outputTokens >= limit
  }

  /** 中断：记下待答复项并下发检查点（含 options 与待审产物，前端据此渲染按钮和依据） */
  private async askConfirm(
    session: AgentSession,
    payload: InterruptPayload & { id?: string },
    sse: SseWriter,
  ): Promise<void> {
    const callId = `graph_${shortId()}`
    const options = toConfirmOptions(payload.options)
    const prompt = payload.prompt || payload.summary || '需要你的确认'
    // 检查点不能只给按钮：用户得看到自己在批准什么。
    // 产物只能从载荷里拿 —— 子图挂起期间它的 channel patch 还没冒泡到父图，
    // session.metadata 这一刻还是上一轮的旧值（或干脆没有），拿它披露是错的。
    const artifact = payload.artifact ?? null

    const record: PendingGraphInterrupt = {
      callId,
      kind: payload.kind,
      checkpointId: payload.checkpointId ?? null,
      toolCallId: payload.toolCallId,
      tool: payload.tool ?? null,
      prompt,
      options,
    }
    await this.sessions
      .updateMetadata(session.id, { [PENDING_KEY]: record, phase: 'waiting_user' })
      .catch((err) => this.logger.warn(`写入待答复检查点失败：${err.message}`))

    sse.writeEvent(SseEventType.CONFIRM_REQUIRED, {
      callId,
      tool: payload.tool ?? payload.checkpointId ?? 'checkpoint',
      // 风险只在图里算得出来时才带上：afterTool 的业务检查点不是风险门，
      // 编一个 'low' 出来会变成假披露。前端按「有没有值」决定渲不渲染。
      ...(payload.risk ? { risk: payload.risk } : {}),
      summary: payload.summary ?? prompt,
      prompt,
      kind: payload.kind,
      options,
      ...(artifact ? { artifact } : {}),
      // 保存前的字段级 diff（阶段 5 / 5.4）：必须显式转发，否则载荷在网关这一层被丢掉
      ...(payload.diff ? { diff: payload.diff } : {}),
    })
  }

  /**
   * 正常收尾：补发一条带 result 的 message。
   *
   * 前端的预览卡片（schema 表格 / 流程节点 / 分析洞察）只认 message.result，
   * 而图内发出的 message 事件不带这个字段，所以这里按 metadata 里的草稿重建。
   */
  private async sendFinalMessage(
    session: AgentSession,
    result: RunGraphResult,
    sse: SseWriter,
  ): Promise<void> {
    const artifact = await this.loadArtifact(session.id)

    sse.writeEvent(SseEventType.MESSAGE, {
      role: 'assistant',
      content: result.finalContent,
      ...(artifact ? { result: artifact } : {}),
    })
  }

  /**
   * 按 session.metadata 重建当前产物（收尾补发的 message.result 用）。
   *
   * 只在收尾时用：那一刻子图已经跑完，patch 已由 GraphRunnerService.persist
   * 回写进 metadata。检查点中断时 metadata 还没这份数据，所以 askConfirm 走的
   * 是中断载荷里的 artifact，不走这里。
   */
  private async loadArtifact(sessionId: string): Promise<Record<string, unknown> | null> {
    const fresh = await this.sessions.get(sessionId)
    const metadata = fresh?.metadata ?? {}
    const agent = metadata.activeSubAgent as string | undefined
    return extractArtifactData(agent, metadata) ?? extractLatestArtifact(metadata)
  }

  private async clearPending(sessionId: string): Promise<void> {
    await this.sessions
      .updateMetadata(sessionId, { [PENDING_KEY]: null })
      .catch((err) => this.logger.warn(`清除待答复检查点失败：${err.message}`))
  }

  private pageContext(body: LangGraphTurnBody): PageContext {
    return {
      scenario: body.scenario,
      entityId: body.context?.entityId as string | undefined,
      pageLabel: body.context?.pageLabel as string | undefined,
    }
  }

  /** 客户端可能已经断开，写 SSE 不该把整轮执行带崩 */
  private safeWrite(sse: SseWriter, type: SseEventType, payload: Record<string, unknown>): void {
    try {
      sse.writeEvent(type, payload)
    } catch (err: any) {
      this.logger.warn(`写 SSE 事件 ${type} 失败：${err?.message}`)
    }
  }
}
