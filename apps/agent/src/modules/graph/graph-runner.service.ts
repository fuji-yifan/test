/**
 * 图执行器：把 LangGraph 的流式输出翻译成平台自己的事件流。
 *
 * 一次 invoke = 一轮用户消息；interrupt 时把 gate 的载荷原样交回给上层，
 * 由 controller 通过 SSE 的 confirm_required / message 事件送到前端；
 * 前端点「继续/中断」后走 POST /agent/resume → Command({resume})。
 */
import { Injectable, Logger } from '@nestjs/common'
import { Command } from '@langchain/langgraph'
import { AIMessageChunk } from '@langchain/core/messages'
import { AgentGraphService } from './agent-graph.service'
import { SessionService } from '../session/session.service'
import type { InterruptPayload } from './subgraph.factory'
import type { PageContext } from './agent-state'

/** 图执行过程中向 SSE 吐出的事件 */
export interface GraphEvent {
  type: string
  [k: string]: unknown
}

export interface RunGraphParams {
  sessionId: string
  userId: string
  workspaceId: string
  userToken: string
  message: string
  pageContext: PageContext
  signal?: AbortSignal
  onEvent: (event: GraphEvent) => void | Promise<void>
}

export interface RunGraphResult {
  interrupted?: InterruptPayload & { id?: string }
  finalContent: string
  usage: { inputTokens: number; outputTokens: number }
  /** 用户主动中断（检查点上点了「中断」/ 拒绝风险确认） */
  halted: boolean
  /** 系统放弃本轮（工具反复失败超限 / 轮次用尽），与 halted 区分开以便排障 */
  gaveUp: boolean
}

/** drive 只依赖这几个字段，run/resume 的参数都能满足 */
interface DriveParams {
  sessionId: string
  signal?: AbortSignal
  onEvent: (event: GraphEvent) => void | Promise<void>
}

const AGENT_NODE_PREFIX = 'agent_'

@Injectable()
export class GraphRunnerService {
  private readonly logger = new Logger(GraphRunnerService.name)

  constructor(
    private readonly graphs: AgentGraphService,
    private readonly sessions: SessionService,
  ) {}

  /** 新的一轮用户消息 */
  async run(params: RunGraphParams): Promise<RunGraphResult> {
    const input = {
      sessionId: params.sessionId,
      userId: params.userId,
      workspaceId: params.workspaceId,
      userToken: params.userToken,
      userMessage: params.message,
      pageContext: params.pageContext,
    }
    return this.drive(input, params)
  }

  /** 用户对 interrupt 的答复 */
  async resume(
    params: Omit<RunGraphParams, 'message' | 'pageContext'> & { resume: unknown },
  ): Promise<RunGraphResult> {
    // resume 没有输入状态，一切从 checkpoint 恢复 —— 包括建 thread 那一刻的
    // workspaceId / userToken，它们可能已经过期（空值、或 token 刷新过）。
    // 所以把本次请求的身份随回执一起送进去，由被中断的 gate 节点写回图状态。
    //
    // 注意不能用 Command.update：它只更新父图的状态，而挂起的子图是从自己的
    // checkpoint 里恢复的，父图的 channel 更新到不了子图（实测如此）。
    return this.drive(
      new Command({
        resume: {
          ...(params.resume as Record<string, unknown>),
          identity: {
            sessionId: params.sessionId,
            userId: params.userId,
            workspaceId: params.workspaceId,
            userToken: params.userToken,
          },
        },
      }),
      params,
    )
  }

  // ==================== 内部 ====================

  private async drive(input: unknown, params: DriveParams): Promise<RunGraphResult> {
    const graph = this.graphs.graph
    const config = {
      configurable: { thread_id: params.sessionId },
      signal: params.signal,
      recursionLimit: 60,
    }

    const stream = (await graph.stream(input as any, {
      ...config,
      streamMode: ['messages', 'custom', 'updates'] as any,
    })) as any

    for await (const chunk of stream) {
      const [mode, payload] = (Array.isArray(chunk) ? chunk : ['updates', chunk]) as [string, any]
      if (mode === 'messages') {
        const [msg, meta] = payload as [AIMessageChunk, any]
        // messages 流模式不只推 LLM 的 token：任何写进 messages channel 的消息都会被推出来
        // （prepare 的 SystemMessage+HumanMessage、act 写入的 ToolMessage 结果）。
        // 不过滤的话，前端会看到系统提示词被逐字打出来。只认 assistant 的流式分片。
        if (!AIMessageChunk.isInstance(msg)) continue
        const node: string = meta?.langgraph_node ?? ''
        // 只转发领域 Agent 子图产生的 token；deepseek-reasoner 的思维链走 reasoning 字段，忽略。
        // LLM 是在子图的 think 节点里调用的，此时 langgraph_node 是 'think'（不以 agent_ 开头），
        // 领域身份体现在 checkpoint 命名空间里：'agent_form_designer:xxx|think:yyy'。
        // 只看 langgraph_node 会把所有 token 都过滤掉（一条 delta 都没有）。
        const ns: string = meta?.langgraph_checkpoint_ns ?? ''
        const fromAgentSubgraph =
          node.startsWith(AGENT_NODE_PREFIX) ||
          ns.split('|').some((seg) => seg.startsWith(AGENT_NODE_PREFIX))
        if (!fromAgentSubgraph) continue
        const text = typeof msg?.content === 'string' ? msg.content : ''
        if (text) await params.onEvent({ type: 'delta', content: text })
        continue
      }
      if (mode === 'custom') {
        await params.onEvent(payload as GraphEvent)
      }
      // updates 模式暂时不用：status/tool 事件都由节点内的 custom writer 负责
    }

    // 读最终快照：拿 interrupt 载荷 / 最终话术 / 用量
    const snapshot: any = await graph.getState({ configurable: { thread_id: params.sessionId } })
    const values = snapshot?.values ?? {}

    const tasks: any[] = snapshot?.tasks ?? []
    for (const task of tasks) {
      for (const itr of task?.interrupts ?? []) {
        if (itr?.value) {
          // 中断时也要落一次会话状态：前端拿到 plan/产物才能渲染状态栏
          await this.persist(params.sessionId, values, true)
          const payload = itr.value as InterruptPayload
          return {
            interrupted: { ...payload, id: itr.id },
            finalContent: values.finalContent ?? '',
            // 挂起的子图不会把补丁冒泡到父图，所以优先用载荷里带出来的用量
            usage: payload.usage ?? values.usage ?? { inputTokens: 0, outputTokens: 0 },
            halted: !!values.halted,
            gaveUp: !!values.gaveUp,
          }
        }
      }
    }

    const result: RunGraphResult = {
      finalContent: values.finalContent ?? '',
      usage: values.usage ?? { inputTokens: 0, outputTokens: 0 },
      halted: !!values.halted,
      gaveUp: !!values.gaveUp,
    }

    // 回写会话：产物草稿 + 兼容 legacy 的 metadata 键
    await this.persist(params.sessionId, values)

    return result
  }

  private async persist(sessionId: string, values: any, waiting = false): Promise<void> {
    const patch = values?.sessionMetadataPatch ?? {}
    const plan = values?.plan
    const artifacts = values?.artifacts ?? {}
    const completed = values?.completedSteps ?? []
    if (!plan) return

    const total = plan.steps?.length ?? 0
    // 放弃（gaveUp）与用户中断（halted）对会话状态的处置相同：都不是「正常在跑」，
    // 都该把 activeSubAgent 摘掉，否则前端状态栏会永远显示一个已经停下的 Agent。
    const stopped = !!(values?.halted || values?.gaveUp)
    const metadata: Record<string, unknown> = {
      ...patch,
      engine: 'langgraph',
      plan,
      currentStepId: plan.steps?.[completed.length]?.id ?? null,
      completedSteps: completed,
      artifacts,
      // 会话级状态从 **channel** 读（不是 sessionMetadataPatch）：供对外读取与前端状态栏（手册 D1/D4）
      conversationGoal: values?.conversationGoal ?? undefined,
      pendingClarification: values?.pendingClarification ?? null,
      activeSubAgent: stopped ? null : (values?.route?.agent ?? null),
      phase: waiting
        ? 'waiting_user'
        : values?.halted
          ? 'halted'
          : values?.gaveUp
            ? 'gave_up'
            : completed.length >= total
              ? 'completed'
              : 'executing',
    }

    await this.sessions.updateMetadata(sessionId, metadata).catch((err) => {
      this.logger.warn(`回写 session metadata 失败：${(err as Error).message}`)
    })

    // 中断时不要把中间话术当成最终回复写进历史
    if (!waiting && values?.finalContent) {
      await this.sessions
        .addMessage(sessionId, { role: 'assistant', content: values.finalContent })
        .catch(() => {})
    }
  }
}
