/**
 * 通用 Sub-Agent 子图：think → gate → act 的 ReAct 循环 + 声明式 HITL 检查点。
 *
 * 图结构（每个领域 Agent 一张，由 AgentCatalogService 的 spec 生成）：
 *
 *   START → prepare → think → gate ─┬─(act)────→ act ─┐
 *                                   ├─(think)──→ think │
 *                                   ├─(respond)→ respond → END
 *                                   └─(halt)───→ halt → END
 *                                            ↑___________| (act 执行完回到 gate，处理 afterTool 检查点)
 *
 * 三条硬约束：
 * 1. gate 里除 interrupt() 外无副作用，因为 resume 会从头重跑 gate；
 * 2. act 每次只执行「队首一个」tool_call —— 避免 resume 时重放已完成的副作用；
 * 3. 所有副作用只发生在 act（工具执行）与 planDriver（产物登记）。
 */
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { END, START, StateGraph, getWriter, interrupt } from '@langchain/langgraph'
import { AIMessage, HumanMessage, SystemMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { LangChainToolBridge, type ToolCallContext } from './tool-bridge.service'
import { ToolConfirmationRequiredError } from './tool-confirmation.error'
import type { AgentSpec, CheckpointDef } from './agent-catalog'
import { LangGraphLlmService } from '../llm/langgraph-llm.service'
import { CircuitBreakerOpenError } from '../llm/llm.types'
import { SkillsLoader } from '../harness/skills.loader'
import { ToolRegistry } from '../harness/tool.registry'
import type { AgentStateType, PendingCall } from './agent-state'
import { AgentState } from './agent-state'
import { resolveFormTarget, seedFromDraft, toFormArtifact, type TargetResolution } from './worksheet'

/** 图里用到的 LLM 能力（结构类型，便于测试注入假模型） */
export interface GraphLlm {
  withTools(tools: StructuredToolInterface[]): {
    invoke(messages: BaseMessage[], options?: Record<string, unknown>): Promise<AIMessage>
  }
}

/** 发给前端的 HITL 中断载荷 */
export interface InterruptPayload {
  kind: 'checkpoint' | 'tool_confirm'
  toolCallId: string
  prompt: string
  options: { value: string; label: string; style?: string }[]
  checkpointId?: string
  tool?: string
  args?: Record<string, unknown>
  risk?: string
  summary?: string
  /**
   * 本次检查点要审的产物（与前端 message.result 同构）。
   * 检查点不能只给按钮，用户得看到自己在批准什么。
   *
   * 必须由这里带出来，不能让上层回头去 session.metadata 里取：子图挂起期间
   * 它的 channel patch 还没冒泡到父图，metadata 里这一刻是空的。
   */
  artifact?: Record<string, unknown>
  /**
   * 挂起那一刻的 token 用量。
   *
   * 挂起的子图补丁不外泄到父图，上层 `values.usage` 这时还是上一轮的值，
   * 所以中断轮必须靠载荷把用量带出去，否则 `done.usage` 恒为 0/0。
   */
  usage?: { inputTokens: number; outputTokens: number }
}

/** gate 算出的"要不要问、问什么" */
interface PendingAsk {
  kind: 'checkpoint' | 'tool_confirm'
  checkpoint?: CheckpointDef
  checkpointId?: string
  call?: PendingCall
  coversRisk?: boolean
  payload: InterruptPayload
}

function emit(event: Record<string, unknown>): void {
  try {
    const w = getWriter()
    if (typeof w === 'function') w(event)
  } catch {
    // 不在图执行上下文中（例如单测直接调用节点函数）时静默忽略
  }
}

function toPendingCall(tc: any): PendingCall {
  return {
    id: tc?.id || `call_${Math.random().toString(36).slice(2, 10)}`,
    name: tc?.name || '',
    args: (tc?.args ?? {}) as Record<string, unknown>,
  }
}

/** 需要按 `target` 寻址的表单类工具 */
const FORM_TOOLS = new Set(['form_assemble_schema', 'form_save'])

/**
 * 该 Agent 当前草稿的产物形态。
 *
 * `drafts[agent].data` 与 hub.artifact 的 readDraft 输出同构（form-designer 是
 * `{schema}`，其余是完整产物对象），所以检查点可以直接把它当前端预览卡片的数据。
 * 取不到（还没有产物）时返回 null —— 上层据此决定整个 artifact 键下不下发。
 *
 * form-designer 例外：一旦工作台有表，就走 `toFormArtifact`（带 `forms[]`），
 * 让检查点的预览卡片天然是多行摘要列表。
 */
function draftArtifact(state: AgentStateType, spec: AgentSpec): Record<string, unknown> | null {
  if (spec.key === 'form-designer') {
    const art = toFormArtifact(state.formWorksheet)
    if (art) return art
  }
  const data = state.drafts?.[spec.key]?.data
  return data && Object.keys(data).length > 0 ? data : null
}

/** 允许随回执带进来的身份字段 */
const IDENTITY_KEYS = ['sessionId', 'userId', 'workspaceId', 'userToken'] as const

/**
 * 把回执里的身份字段转成状态补丁。
 *
 * 图状态是从 checkpoint 恢复的，里面存的是**建 thread 那一刻**的身份：workspaceId
 * 可能当时还没拿到（JWT 里没有这个声明），token 可能早就刷新过。而这两个值决定
 * serverTool 能不能成功调用，所以以本次请求为准，resume 时一并写回。
 * 只接白名单里的键，且只接受非空字符串 —— 空值意味着「没带」，不该覆盖已有的。
 */
function identityPatch(raw: unknown): Partial<AgentStateType> {
  const src = (raw ?? {}) as Record<string, unknown>
  const out: Partial<AgentStateType> = {}
  for (const key of IDENTITY_KEYS) {
    const value = src[key]
    if (typeof value === 'string' && value) out[key] = value
  }
  return out
}

@Injectable()
export class AgentSubgraphFactory {
  private readonly logger = new Logger(AgentSubgraphFactory.name)

  constructor(
    private readonly bridge: LangChainToolBridge,
    // 声明成具体类以便 Nest 注入；测试里可以直接塞一个符合 GraphLlm 的假模型
    private readonly llm: LangGraphLlmService,
    private readonly registry: ToolRegistry,
    private readonly skills: SkillsLoader,
    private readonly config: ConfigService,
  ) {}

  /** 为某个 Agent 编译子图（不带 checkpointer：状态与中断都由父图承载） */
  build(spec: AgentSpec): any {
    const graph = new StateGraph(AgentState)
      .addNode('prepare', (s) => this.prepare(s, spec))
      .addNode('think', (s) => this.think(s, spec))
      .addNode('gate', (s) => this.gate(s, spec))
      .addNode('act', (s) => this.act(s, spec))
      .addNode('respond', (s) => this.respond(s))
      .addNode('halt', (s) => this.halt(s, spec))
      .addEdge(START, 'prepare')
      .addEdge('prepare', 'think')
      .addEdge('think', 'gate')
      .addEdge('act', 'gate')
      .addConditionalEdges('gate', (s: AgentStateType) => s.gateOutcome, {
        act: 'act',
        think: 'think',
        respond: 'respond',
        halt: 'halt',
      })
      .addEdge('respond', END)
      .addEdge('halt', END)

    return graph.compile()
  }

  // ==================== prepare ====================

  private prepare(state: AgentStateType, spec: AgentSpec): Partial<AgentStateType> {
    // 旧线程迁移：07-xx 之前建的会话，checkpoint 里只有单槽草稿、没有 formWorksheet。
    // 补种一次，老会话的上下文不丢（prepare 只在 run 时跑，resume 不重跑，不会反复种）。
    let worksheet = state.formWorksheet ?? { forms: [], focusKey: null }
    if (spec.key === 'form-designer' && worksheet.forms.length === 0) {
      const seeded = seedFromDraft(state.drafts?.[spec.key]?.data?.schema)
      if (seeded) worksheet = seeded
    }

    const system = spec.systemPrompt({
      userId: state.userId,
      workspaceId: state.workspaceId,
      skillMetas: this.skills.getAllMeta(),
      skillFull: this.skills.loadFull(spec.label) || undefined,
    })

    emit({
      type: 'meta',
      agent: spec.key,
      tools: spec.toolNames.filter((n) => this.registry.get(n)),
    })

    // 表清单贴到 system 尾部而不是用户消息前缀：同一轮内多次 think 共用一份 system，
    // 内容稳定（利于缓存），也不会把系统提示词混进用户那句请求里。
    const hint = spec.draftHint
      ? spec.draftHint({ worksheet, draft: state.drafts?.[spec.key]?.data })
      : null
    const systemContent = hint ? `${system}\n\n${hint}` : system

    return {
      // 每个步骤用一份干净的 LLM 上下文；上游产物已经由 planDriver 写进指令里
      messages: [new SystemMessage(systemContent), new HumanMessage(state.userMessage)],
      pendingCalls: [],
      lastTool: null,
      approved: false,
      toolConfirm: null,
      needThink: false,
      iterations: 0,
      halted: false,
      finalContent: '',
      gateOutcome: 'think',
      ...(worksheet !== state.formWorksheet ? { formWorksheet: worksheet } : {}),
    }
  }

  // ==================== think ====================

  private async think(state: AgentStateType, spec: AgentSpec): Promise<Partial<AgentStateType>> {
    const iterations = (state.iterations ?? 0) + 1
    if (iterations > spec.maxIterations) {
      return {
        iterations,
        finalContent: `已经尝试了 ${spec.maxIterations} 轮仍未完成，请把需求说得更具体一些，或告诉我下一步怎么做。`,
        pendingCalls: [],
        needThink: false,
      }
    }

    const tools = this.bridge.build(spec.toolNames, toolCtx(state, spec))
    const bound = this.llm.withTools(tools)

    let res: AIMessage
    try {
      res = await bound.invoke(state.messages)
    } catch (err: any) {
      // 被抢占 / 客户端断开：交回上层静默收尾，绝不能当成「模型出错」重试
      if (err?.name === 'AbortError') throw err
      if (err instanceof CircuitBreakerOpenError || err?.name === 'CircuitBreakerOpenError') {
        // 上游明确不可用，再试也是白试：如实收尾，让用户知道是模型侧的问题
        const message = 'DeepSeek API 暂时不可用，请稍后重试。'
        emit({ type: 'error', code: 'CIRCUIT_BREAKER', message })
        return {
          iterations,
          pendingCalls: [],
          needThink: false,
          halted: true,
          finalContent: message,
        }
      }
      // 其余错误（超时、限流、网络抖动）：消耗一轮重试机会，跟 legacy 一样继续循环，
      // 实在不行由上面的 maxIterations 兜底给出「说得更具体一些」的收尾话术
      emit({
        type: 'error',
        code: 'RETRYING',
        message: `第 ${iterations} 轮调用模型失败，正在重试：${err?.message ?? err}`,
      })
      return { iterations, pendingCalls: [], needThink: true }
    }

    const calls = (res.tool_calls ?? []).map(toPendingCall).filter((c) => c.name)
    const messages = [...state.messages, res]
    // usage 是累加语义（agent-state.ts），每轮 think 回填一次；不填的话对外恒为 0/0
    const usage = this.usageOf(res)

    if (calls.length === 0) {
      const content = typeof res.content === 'string' ? res.content : JSON.stringify(res.content)
      return { messages, pendingCalls: [], needThink: false, iterations, finalContent: content, usage }
    }

    // 只把「已注册」的调用排进队列；未知工具直接回一条 tool 消息让模型自我纠正
    const known: PendingCall[] = []
    const rejectedMessages: BaseMessage[] = []
    for (const c of calls) {
      if (this.registry.get(c.name)) known.push(c)
      else
        rejectedMessages.push(
          new ToolMessage({
            tool_call_id: c.id,
            name: c.name,
            content: `工具 ${c.name} 不存在或不可用，请换一个可用工具。`,
          }),
        )
    }
    if (known.length === 0 && rejectedMessages.length > 0) {
      // 全部不可用：带着纠错信息再来一轮
      return { messages: [...messages, ...rejectedMessages], pendingCalls: [], needThink: true, iterations, usage }
    }

    return {
      messages: [...messages, ...rejectedMessages],
      pendingCalls: known,
      needThink: false,
      iterations,
      usage,
    }
  }

  /** AIMessage 上的 token 用量（LangChain 标准字段），缺省时记 0 */
  private usageOf(res: AIMessage): { inputTokens: number; outputTokens: number } {
    const u = (res as any)?.usage_metadata
    return {
      inputTokens: u?.input_tokens ?? 0,
      outputTokens: u?.output_tokens ?? 0,
    }
  }

  // ==================== gate（唯一的 HITL 入口，无副作用） ====================

  private gate(state: AgentStateType, spec: AgentSpec): Partial<AgentStateType> {
    const ask = this.firstPendingAsk(state, spec)

    if (!ask) {
      const outcome: AgentStateType['gateOutcome'] =
        state.pendingCalls.length > 0 ? 'act' : state.needThink ? 'think' : 'respond'
      return { gateOutcome: outcome }
    }

    const answer = interrupt({ ...ask.payload, usage: state.usage }) as any
    const action = answer?.action
    // 续跑时以本次请求的身份为准（见 identityPatch 的说明）
    const identity = identityPatch(answer?.identity)

    if (ask.kind === 'tool_confirm') {
      if (action === 'confirm') {
        return {
          ...identity,
          gateOutcome: 'act',
          approved: true,
          toolConfirm: {
            action: 'confirm',
            args: (answer?.args as Record<string, unknown>) ?? undefined,
          },
        }
      }
      return { ...identity, gateOutcome: 'halt', halted: true }
    }

    const checkpoint = ask.checkpoint!
    const record = {
      checkpointId: checkpoint.id,
      toolCallId: ask.payload.toolCallId,
      action: (action === 'continue' ? 'continue' : 'abort') as 'continue' | 'abort',
    }

    if (action === 'continue') {
      return {
        ...identity,
        checkpointDone: [record],
        // 业务检查点若声明了 coversRisk，就同时充当该工具的风险放行，避免问两遍
        approved: checkpoint.coversRisk ? true : state.approved,
        gateOutcome: state.pendingCalls.length > 0 ? 'act' : 'think',
      }
    }

    return { ...identity, checkpointDone: [record], gateOutcome: 'halt', halted: true }
  }

  /** 找出第一个待答复的问题（afterTool 业务检查点 → beforeTool 业务检查点 → 风险确认） */
  private firstPendingAsk(state: AgentStateType, spec: AgentSpec): PendingAsk | null {
    const answered = (checkpointId: string, toolCallId: string) =>
      state.checkpointDone.some((c) => c.checkpointId === checkpointId && c.toolCallId === toolCallId)

    // 业务检查点问的是「这个产物行不行」，所以都要带上当前的草稿
    const artifact = draftArtifact(state, spec)

    // 1) 刚执行完的工具触发的 afterTool 检查点
    if (state.lastTool) {
      for (const cp of spec.checkpoints) {
        if (cp.afterTool !== state.lastTool.name) continue
        if (answered(cp.id, state.lastTool.callId)) continue
        if (cp.when && !cp.when(state)) continue
        return {
          kind: 'checkpoint',
          checkpoint: cp,
          checkpointId: cp.id,
          coversRisk: cp.coversRisk,
          payload: {
            kind: 'checkpoint',
            checkpointId: cp.id,
            toolCallId: state.lastTool.callId,
            tool: state.lastTool.name,
            prompt: cp.prompt,
            options: cp.options,
            ...(artifact ? { artifact } : {}),
          },
        }
      }
    }

    // 2) 下一个待执行调用触发的 beforeTool 检查点
    const next = state.pendingCalls[0]
    if (!next) return null

    for (const cp of spec.checkpoints) {
      if (cp.beforeTool !== next.name) continue
      if (answered(cp.id, next.id)) continue
      if (cp.when && !cp.when(state)) continue
      return {
        kind: 'checkpoint',
        checkpoint: cp,
        checkpointId: cp.id,
        coversRisk: cp.coversRisk,
        payload: {
          kind: 'checkpoint',
          checkpointId: cp.id,
          toolCallId: next.id,
          tool: next.name,
          args: next.args,
          // 这个检查点站在「即将执行的工具」前面，所以要说清放行的是什么工具、
          // 它有多大风险。coversRisk 的检查点更是顶替了风险门，不报风险就是漏披露。
          risk: this.registry.getRisk(next.name),
          prompt: cp.prompt,
          options: cp.options,
          ...(artifact ? { artifact } : {}),
        },
      }
    }

    // 3) 兜底：工具网关的风险确认（与 ToolGateway 的判定规则一致）
    if (this.bridge.needsConfirmation(next.name)) {
      const risk = this.registry.getRisk(next.name)
      const summary = `即将执行 ${next.name}（风险：${risk}）`
      return {
        kind: 'tool_confirm',
        call: next,
        payload: {
          kind: 'tool_confirm',
          toolCallId: next.id,
          tool: next.name,
          args: next.args,
          risk,
          summary,
          prompt: summary,
          options: [
            { value: 'confirm', label: '确认执行', style: 'primary' },
            { value: 'abort', label: '取消', style: 'danger' },
          ],
        },
      }
    }

    return null
  }

  // ==================== act（唯一的工具副作用点） ====================

  private async act(state: AgentStateType, spec: AgentSpec): Promise<Partial<AgentStateType>> {
    const call = state.pendingCalls[0]
    if (!call) return { gateOutcome: 'think' }

    // 寻址放在 act：它同时握着 args 与图状态。bridge 只按解析结果决定注入什么。
    const resolved = FORM_TOOLS.has(call.name)
      ? resolveFormTarget(call.args?.target as string | undefined, state.formWorksheet)
      : null
    if (resolved?.kind === 'ambiguous') {
      this.logger.warn(
        `表单标题重名，先取最先命中的 ${resolved.keys[0]}（候选：${resolved.keys.join(', ')}）`,
      )
    }

    const ctx = toolCtx(state, spec, resolved)
    const opts = { requestId: call.id }

    emit({ type: 'tool_start', callId: call.id, tool: call.name, args: call.args })

    let ok = false
    let summary = ''
    let result: unknown
    /** 网关给的错误分类，用来区分「参数错（可修正重试）」与「执行错」 */
    let errorCode: string | undefined

    try {
      const executed = await this.bridge.run(call.name, call.args, ctx, {
        ...opts,
        confirmed: state.approved || state.toolConfirm?.action === 'confirm',
      })
      ok = executed.ok
      summary = executed.summary ?? (executed.ok ? 'OK' : 'failed')
      result = executed.result
      errorCode = executed.error
      if (!executed.ok) summary = executed.summary || executed.error || 'failed'
    } catch (err: any) {
      if (err instanceof ToolConfirmationRequiredError) {
        // gate 已经按 registry 的风险等级问过了，走到这里说明判定不一致；
        // 不绕过用户同意，直接把情况告诉模型。
        ok = false
        summary = `该工具需要人工确认才能执行：${err.summary}`
      } else {
        ok = false
        summary = `工具执行异常：${err.message}`
      }
    }

    emit({ type: 'tool_result', callId: call.id, tool: call.name, ok, summary })

    // === 错误恢复（与 legacy base.agent 的四级级联对齐，见 cases.md 的对照说明）===
    const maxRetries = this.config.get<number>('context.maxRetries') ?? 2
    const maxDegrades = this.config.get<number>('context.maxDegrades') ?? 1
    const prevErrors = state.toolErrors ?? {}
    const failures = ok ? 0 : (prevErrors[call.name] ?? 0) + 1
    const toolErrors = { ...prevErrors, [call.name]: failures }

    // 只在「刚刚越过重试上限」那一刻记一次降级；该工具成功后再失败会重新计
    const previouslyDegraded = (prevErrors[call.name] ?? 0) > maxRetries
    const degradedNow = failures > maxRetries
    const degradeCount = (state.degradeCount ?? 0) + (!previouslyDegraded && degradedNow ? 1 : 0)

    let content: string
    if (ok) {
      content = this.bridge.toToolMessageContent({ ok, summary, result })
    } else if (degradedNow) {
      // 同一工具已经错了 maxRetries 次：不再原样回灌失败，改成让模型换条路
      if (errorCode === 'validation_error') {
        emit({
          type: 'error',
          code: 'DEGRADE',
          message: `工具 ${call.name} 连续 ${failures} 次参数错误，尝试替代方案`,
        })
      }
      content = `[DEGRADE] 工具 ${call.name} 已连续失败 ${failures} 次（${summary}）。请换一种可行方式完成用户需求，或者直接问用户需要什么。`
    } else {
      // 还有重试额度：把失败原样回灌，模型据此修正参数再来一次
      if (errorCode === 'validation_error') {
        emit({
          type: 'error',
          code: 'RETRY',
          message: `工具 ${call.name} 参数校验失败：${summary}。请修正参数后重试。`,
        })
      }
      content = JSON.stringify({ ok, summary })
    }

    const toolMessage = new ToolMessage({ tool_call_id: call.id, name: call.name, content })

    // 降级次数超上限 → 整体收尾（legacy 的 FALLBACK）。清空待执行队列，
    // 让 gate 走 respond 而不是继续 act，避免明知不可行还往下打。
    if (degradeCount > maxDegrades) {
      const message = '当前方式多次尝试仍未成功，建议换一种描述，或把需求拆得更具体一些。'
      emit({ type: 'error', code: 'FALLBACK', message })
      this.logger.warn(`工具多次降级（degradeCount=${degradeCount}），收尾本轮`)
      return {
        messages: [...state.messages, toolMessage],
        pendingCalls: [],
        lastTool: { callId: call.id, name: call.name, ok, summary },
        needThink: false,
        halted: true,
        finalContent: message,
        toolErrors,
        degradeCount,
        approved: false,
        toolConfirm: null,
      }
    }

    const patch: Partial<AgentStateType> = {
      messages: [...state.messages, toolMessage],
      pendingCalls: state.pendingCalls.slice(1),
      lastTool: { callId: call.id, name: call.name, ok, summary },
      needThink: true,
      approved: false,
      toolConfirm: null,
      toolErrors,
      degradeCount,
    }

    // 抽产物（草稿 + 需要回写 session.metadata 的补丁 + 更新后的工作台）
    if (ok) {
      const extracted = spec.extractArtifact({
        toolName: call.name,
        result,
        state,
        resolved: resolved ?? undefined,
      })
      if (extracted?.draftUpdate) {
        patch.drafts = { [spec.key]: extracted.draftUpdate }
      }
      if (extracted?.metadata) {
        const clean: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(extracted.metadata)) if (v !== undefined) clean[k] = v
        if (Object.keys(clean).length > 0) patch.sessionMetadataPatch = clean
      }
      if (extracted?.worksheet) {
        patch.formWorksheet = extracted.worksheet
      }
    }

    return patch
  }

  // ==================== respond / halt ====================

  private respond(state: AgentStateType): Partial<AgentStateType> {
    emit({ type: 'message', role: 'assistant', content: state.finalContent })
    return {}
  }

  private halt(state: AgentStateType, spec: AgentSpec): Partial<AgentStateType> {
    // 把没执行的 tool_call 补上 tool 消息，避免留下「有 tool_calls 无 tool 响应」的非法历史
    const pendings = state.pendingCalls.map(
      (c) =>
        new ToolMessage({
          tool_call_id: c.id,
          name: c.name,
          content: '[用户中断，未执行]',
        }),
    )
    const content = '好的，已按你的要求中断，需要的话我们可以继续调整。'
    emit({ type: 'message', role: 'assistant', content })
    return {
      messages: pendings.length > 0 ? [...state.messages, ...pendings] : state.messages,
      pendingCalls: [],
      finalContent: content,
      halted: true,
      needThink: false,
    }
  }
}

/** 从图状态构造工具调用上下文（对齐 legacy base.agent 的注入字段） */
function toolCtx(
  state: AgentStateType,
  spec: AgentSpec,
  resolved: TargetResolution | null = null,
): ToolCallContext {
  // 本会话已生成的产物草稿（drafts 是 merge 语义，跨轮次从 checkpoint 恢复）。
  // form-designer 的草稿形态是 { schema }，取出来给 form_assemble_schema 做合并。
  const draft = state.drafts?.[spec.key]?.data as { schema?: Record<string, unknown> } | undefined
  return {
    userToken: state.userToken,
    workspaceId: state.workspaceId,
    userId: state.userId,
    savedFormId: state.sessionMetadataPatch?.savedFormId as string | undefined,
    currentSchema: draft?.schema,
    formWorksheet: state.formWorksheet,
    formTarget: resolved,
  }
}
