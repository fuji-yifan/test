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
import { Injectable, Logger, Optional } from '@nestjs/common'
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
import { projectMemory, detectClarification } from './conversation-state'
import {
  entryOf,
  registerSavedForm,
  resolveFormTarget,
  schemaTitle,
  seedFromDraft,
  toFormArtifact,
  type TargetResolution,
  type WorksheetEntry,
} from './worksheet'
import { ContextService } from '../context/context.service'
import { resolveExistingForm } from '../sub-agents/form-designer/tools/form-resolver'
import { guardHallucination, hallucinationCorrection } from './hallucination-guard'
import { degradeReply } from './degrade'

/** 图里用到的 LLM 能力（结构类型，便于测试注入假模型） */
export interface GraphLlm {
  withTools(tools: StructuredToolInterface[]): {
    invoke(messages: BaseMessage[], options?: Record<string, unknown>): Promise<AIMessage>
  }
}

/**
 * 消歧候选自带的预览数据。
 *
 * 同名表的标题一模一样，光看按钮分不出来；前端据此在候选行上直接「预览」，
 * 不用先选再后悔（2026-10-19 用户反馈）。
 */
export interface DisambiguationFormPreview {
  title?: string
  schema?: unknown
  formId?: string
  fieldCount?: number
}

/** 发给前端的 HITL 中断载荷 */
export interface InterruptPayload {
  kind: 'checkpoint' | 'tool_confirm' | 'disambiguate'
  toolCallId: string
  prompt: string
  options: { value: string; label: string; style?: string; form?: DisambiguationFormPreview }[]
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
  /**
   * 本轮开始前的累计用量（基线的基线，见 agent-state 的 `usageAtTurnStart`）。
   *
   * 与 usage 一起带出去，上层才能算出「这条回答」的用量 = `usage − usageAtTurnStart`，
   * 且父子两个值同源，不依赖子图补丁是否冒泡。
   */
  usageAtTurnStart?: { inputTokens: number; outputTokens: number }
}

/** gate 算出的"要不要问、问什么" */
interface PendingAsk {
  kind: 'checkpoint' | 'tool_confirm' | 'disambiguate'
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
const FORM_TOOLS = new Set([
  'form_assemble_schema',
  'form_save',
  'form_rollback',
  'form_delete',
  'form_version_delete',
])

/**
 * 只对「已保存的表」有意义的工具：没有新建语义。
 * 目标不在会话工作台时必须去工作空间按名称找，同名就先消歧 ——
 * 否则 rollback / delete 会直接进入业务确认检查点，等用户确认完才报 form_ambiguous。
 */
const SAVED_FORM_ONLY_TOOLS = new Set(['form_rollback', 'form_delete', 'form_version_delete'])

/** 工作空间里的真实表单 id：同名消歧的候选 value 就是它 */
const FORM_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 同名消歧的候选标记：A / B / C…（超过 26 张就退回序号） */
function optionMarker(i: number): string {
  return i < 26 ? String.fromCharCode(65 + i) : `${i + 1}`
}

/** 候选选项文案：只留区分信息，不附着 id（用户 2026-10-19 反馈） */
function formOptionLabel(i: number, fieldCount?: number): string {
  return `${optionMarker(i)}. ${typeof fieldCount === 'number' ? `${fieldCount}个字段` : '已保存'}`
}

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
    // 可选：测试直接 new 时没有它，按名称解析「工作空间里已保存的表」随之关闭。
    @Optional() private readonly context?: ContextService,
  ) {}

  /** 为某个 Agent 编译子图（不带 checkpointer：状态与中断都由父图承载） */
  build(spec: AgentSpec): any {
    const graph = new StateGraph(AgentState)
      .addNode('prepare', (s) => this.prepare(s, spec))
      .addNode('think', (s) => this.think(s, spec))
      .addNode('gate', (s) => this.gate(s, spec))
      .addNode('act', (s) => this.act(s, spec))
      .addNode('respond', (s) => this.respond(s, spec))
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

    // 会话记忆块：作为**末尾 user 消息**注入（手册 D2/§2.11/§2.12），由 projectMemory 单出口
    // 渲染 L1 状态栏 + 进展台账 + L2 摘要 + L3 近期窗口，所有 sub-agent 看到同一份 ——
    // 换 Agent 不重问已知信息。只承载会话级字段，与 system 里的表清单（draftHint）不重叠；
    // 全空时不注入（老线程行为不变）。
    const memory = projectMemory(
      {
        l1: {
          activeSubAgent: spec.key,
          conversationGoal: state.conversationGoal,
          pendingClarification: state.pendingClarification,
          lastOutcome: state.pendingClarification ? 'waiting_user' : undefined,
        },
        summary: state.memorySummary,
        // historyTurns 末尾那条是本轮 user（routerNode 刚追加），注入时排除，避免与 userMessage 重复
        recent: recentTurns(state),
        ledger: state.turnLedger,
        facts: state.sessionFacts,
        // 用户长期记忆（阶段 8 §3.7）：routerNode 每轮召回到 channel 的跨会话记忆
        userMemory: state.userMemory,
      },
      {
        budgetTokens: this.config?.get<number>('context.memoryBudgetTokens'),
        repeatNotice: this.config?.get<boolean>('context.memoryRepeatNotice') ?? false,
      },
    )
    const messages: BaseMessage[] = [new SystemMessage(systemContent), new HumanMessage(state.userMessage)]
    if (memory) messages.push(new HumanMessage(memory))

    return {
      // 每个步骤用一份干净的 LLM 上下文；上游产物已经由 planDriver 写进指令里
      messages,
      pendingCalls: [],
      lastTool: null,
      turnToolOk: [],
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
      // 和工具反复失败那条出口共用 gaveUp：都是「系统放弃」，都该停掉整条计划，
      // 而不是被父图当成正常完成、带着缺失的产物继续跑后面的步骤。
      // 分级降级（S7.4）：有草稿走规则层（保留草稿），无草稿走静态话术。
      const reply = degradeReply({
        hasDraft: this.hasDraft(state, spec),
        reason: `达到最大迭代轮次 ${spec.maxIterations}`,
        modelUnavailable: false,
      })
      emit({ type: 'degrade', from: 'model', to: reply.to, reason: reply.reason })
      return {
        iterations,
        finalContent: reply.content,
        pendingCalls: [],
        needThink: false,
        gaveUp: true,
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
        // 上游明确不可用，再试也是白试：如实收尾，让用户知道是模型侧的问题。
        // 分级降级（S7.4）：有草稿走规则层（保留草稿），无草稿走静态话术。
        const reply = degradeReply({
          hasDraft: this.hasDraft(state, spec),
          reason: 'LLM 熔断（CircuitBreakerOpen）',
          modelUnavailable: true,
        })
        emit({ type: 'error', code: 'CIRCUIT_BREAKER', message: reply.content })
        emit({ type: 'degrade', from: 'model', to: reply.to, reason: reply.reason })
        return {
          iterations,
          pendingCalls: [],
          needThink: false,
          halted: true,
          finalContent: reply.content,
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

  /**
   * 本轮是否已有草稿（S7.4 分级降级的判据）。
   * form-designer 以工作台是否有表为准，其余 Agent 看本轮是否有 drafts 产物。
   */
  private hasDraft(state: AgentStateType, spec: AgentSpec): boolean {
    if (spec.key === 'form-designer') return (state.formWorksheet?.forms?.length ?? 0) > 0
    const data = state.drafts?.[spec.key]?.data
    return !!data && Object.keys(data).length > 0
  }

  // ==================== gate（唯一的 HITL 入口，无副作用） ====================

  private async gate(state: AgentStateType, spec: AgentSpec): Promise<Partial<AgentStateType>> {
    // 注意：消歧要查工作空间里的同名表，所以 gate 里有一次**只读**查询。
    // 它没有写副作用，resume 重跑 gate 也安全（写入仍只发生在 act）。
    const ask = await this.firstPendingAsk(state, spec)

    if (!ask) {
      const outcome: AgentStateType['gateOutcome'] =
        state.pendingCalls.length > 0 ? 'act' : state.needThink ? 'think' : 'respond'
      return { gateOutcome: outcome }
    }

    const answer = interrupt({
      ...ask.payload,
      usage: state.usage,
      usageAtTurnStart: state.usageAtTurnStart,
    }) as any
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

    // 重名消歧（阶段 5 / 5.2）：用户选中的 key 直接改写本次调用的 target，
    // 让 act 的 resolveFormTarget 按 key 精确命中 → 不再 ambiguous。
    // 会话工作台里没有这张表时，option 的 value 是工作空间里的真实 formId：
    // 同样改写进 target，act 的 loadSavedForm 会按 id 载入它。
    if (ask.kind === 'disambiguate') {
      const next = state.pendingCalls[0]
      const chosen = typeof action === 'string' ? action : ''
      const usable = !!chosen && (!!entryOf(state.formWorksheet, chosen) || FORM_ID_RE.test(chosen))
      if (!next || !usable) {
        // 非法回答（abort / 非候选）→ 按用户取消处理，绝不把脏值写进 target
        return { ...identity, gateOutcome: 'halt', halted: true }
      }
      const rewritten: PendingCall = { ...next, args: { ...next.args, target: chosen } }
      // 选中目标这一步同时充当该工具 beforeTool 检查点的放行（消歧与保存确认合并成一次询问）：
      // 记 checkpointDone + 按 coversRisk 置 approved，否则 act 会因缺放行被网关拦下，
      // 或（更糟）绕过确认直接写库。没有该检查点时就是一次纯寻址。
      const cp = spec.checkpoints.find(
        (c) =>
          c.beforeTool === next.name &&
          !state.checkpointDone.some((d) => d.checkpointId === c.id && d.toolCallId === next.id) &&
          (!c.when || c.when(state)),
      )
      return {
        ...identity,
        gateOutcome: 'act',
        pendingCalls: [rewritten, ...state.pendingCalls.slice(1)],
        ...(cp
          ? {
              checkpointDone: [
                { checkpointId: cp.id, toolCallId: next.id, action: 'continue' as const },
              ],
              approved: cp.coversRisk ? true : state.approved,
            }
          : {}),
      }
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
  private async firstPendingAsk(state: AgentStateType, spec: AgentSpec): Promise<PendingAsk | null> {
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

    const next = state.pendingCalls[0]
    if (!next) return null

    // 2) 重名消歧（阶段 5 / 5.2）：head 是表单工具、target 命中多张同名表。
    //    放在 beforeTool 检查点**之前**：目标没定下来，后面的保存确认其实无从谈起；
    //    选中目标那一步**同时**充当该工具的 beforeTool 放行（在 gate 里合并记 checkpointDone +
    //    approved），所以不存在「没批准就写库」。form_assemble_schema 无 beforeTool 检查点，
    //    消歧即唯一提问。
    //    注：不能放在检查点循环**之后**——检查点答复后 gate 直接返回 act，消歧将永远不被问到，
    //    form_save 会静默写到 keys[0]（错的表）。
    if (FORM_TOOLS.has(next.name)) {
      const resolved = resolveFormTarget(next.args?.target as string | undefined, state.formWorksheet)
      const targetText = typeof next.args?.target === 'string' ? next.args.target : '同名'
      const verb =
        next.name === 'form_save'
          ? '把改动保存到'
          : next.name === 'form_rollback'
            ? '回滚'
            : next.name === 'form_delete'
              ? '删除'
              : next.name === 'form_version_delete'
                ? '删除版本'
                : '操作'
      if (resolved.kind === 'ambiguous') {
        const candidates = resolved.keys
          .map((k) => entryOf(state.formWorksheet, k))
          .filter((e): e is WorksheetEntry => !!e)
        return {
          kind: 'disambiguate',
          payload: {
            kind: 'disambiguate',
            toolCallId: next.id,
            tool: next.name,
            args: next.args,
            // 标题在 prompt 里已经说过，且重名时它不具区分度；选项只给区分信息，
            // 避免长标题把按钮撑出容器。
            prompt: `会话中有 ${candidates.length} 张「${targetText}」，请选择要${verb}哪一张`,
            options: candidates.map((e, i) => {
              const fieldCount = Array.isArray((e.schema as any)?.fields)
                ? ((e.schema as any).fields as unknown[]).length
                : 0
              return {
                value: e.key,
                label: formOptionLabel(i, fieldCount),
                style: 'default',
                form: { title: e.title, schema: e.schema, formId: e.formId, fieldCount },
              }
            }),
            ...(artifact ? { artifact } : {}),
          },
        }
      }

      // 2b) 目标不在会话工作台，但工作空间里有同名已保存的表：
      //     唯一命中交给 act 载入；**多张同名必须先问**，绝不能静默新建
      //     （2026-10-19：空间里有两张「教职工信息登记表」，此前直接退回了新建）。
      if (
        resolved.kind === 'create' &&
        resolved.title &&
        this.shouldResolveWorkspaceForm(next.name, state.userMessage)
      ) {
        const lookup = await this.lookupSavedForm(state, resolved.title)
        if (lookup && 'ambiguous' in lookup) {
          // 同名时标题没有区分度，用户需要能先看内容再选。这里把每个候选的 schema
          // 一并带上（只取前 8 张，避免载荷失控），前端在候选行上直接「预览」。
          const MAX_PREVIEWS = 8
          const previews = await Promise.all(
            lookup.ambiguous.map(async (c, i) => {
              if (i >= MAX_PREVIEWS || !this.context) return { ...c }
              try {
                const form = await this.context.getForm(state.userToken, c.formId)
                const schema = form?.schema ?? null
                const fieldCount = Array.isArray((schema as any)?.fields)
                  ? ((schema as any).fields as unknown[]).length
                  : 0
                return {
                  ...c,
                  formName: form?.name || c.formName,
                  schema,
                  fieldCount,
                }
              } catch {
                // 单张读取失败不影响消歧本身：该候选仍可被选中
                return { ...c }
              }
            }),
          )
          return {
            kind: 'disambiguate',
            payload: {
              kind: 'disambiguate',
              toolCallId: next.id,
              tool: next.name,
              args: next.args,
              // 标题已在 prompt 里说过；选项只给 A/B/C + 字段数，且每行一个。
              prompt: `工作空间中有 ${previews.length} 张「${targetText}」，请选择要${verb}哪一张`,
              options: previews.map((c: any, i: number) => ({
                value: c.formId,
                label: formOptionLabel(i, c.fieldCount),
                style: 'default',
                ...(c.schema
                  ? {
                      form: {
                        title: c.formName,
                        schema: c.schema,
                        formId: c.formId,
                        fieldCount: c.fieldCount,
                      },
                    }
                  : {}),
              })),
              ...(artifact ? { artifact } : {}),
            },
          }
        }
      }
    }

    // 3) 下一个待执行调用触发的 beforeTool 检查点
    for (const cp of spec.checkpoints) {
      if (cp.beforeTool !== next.name) continue
      if (answered(cp.id, next.id)) continue
      if (cp.when && !cp.when(state)) continue
      const payload: InterruptPayload = {
        kind: 'checkpoint',
        checkpointId: cp.id,
        toolCallId: next.id,
        tool: next.name,
        args: next.args,
        // 检查点文案不点工具名：前端在检查点期间把工具调用列表默认展开，工具名与
        // 风险等级都在那颗 chip 上。这里仍要把风险报出去 —— coversRisk 的检查点顶替了
        // 风险门，不报风险就是漏披露。
        risk: this.registry.getRisk(next.name),
        prompt: cp.prompt,
        options: cp.options,
        ...(artifact ? { artifact } : {}),
      }
      return {
        kind: 'checkpoint',
        checkpoint: cp,
        checkpointId: cp.id,
        coversRisk: cp.coversRisk,
        payload,
      }
    }

    // 4) 兜底：工具网关的风险确认（与 ToolGateway 的判定规则一致）。
    // 同样不点工具名，工具与风险由默认展开的工具调用列表披露。
    if (this.bridge.needsConfirmation(next.name)) {
      return {
        kind: 'tool_confirm',
        call: next,
        payload: {
          kind: 'tool_confirm',
          toolCallId: next.id,
          tool: next.name,
          args: next.args,
          risk: this.registry.getRisk(next.name),
          prompt: '该操作需要你确认后才会执行',
          options: [
            { value: 'confirm', label: '确认执行', style: 'primary' },
            { value: 'abort', label: '取消', style: 'danger' },
          ],
        },
      }
    }

    return null
  }

  /**
   * 该不该去工作空间里按名称找一张已保存的表。
   *
   * 只在「改表」意图下找：消息里有明确的新建词、且没有任何修改词，就是真的要做新表，
   * 不能被同名的旧表劫持（用户说「新建请假申请表」时即使已有一张同名表，也应当建新表
   * —— 那由用户在重名消歧里决定，而不是这里静默改旧表）。其它情况（加/改/删/设置…）
   * 一律先查；查不到再按新建走，行为与原先一致。
   */
  /**
   * gate 阶段该不该去工作空间按名称查这张表。
   *
   * 回滚/删除没有「新建」语义，工作空间里的同名旧表就是唯一可能的操作对象，
   * 所以无条件查；assemble/save 还要看用户是不是明确要新建（见 shouldLoadSavedForm）。
   */
  private shouldResolveWorkspaceForm(toolName: string, userMessage: string): boolean {
    return SAVED_FORM_ONLY_TOOLS.has(toolName) || this.shouldLoadSavedForm(toolName, userMessage)
  }

  private shouldLoadSavedForm(toolName: string, userMessage: string): boolean {
    if (toolName !== 'form_assemble_schema' && toolName !== 'form_save') return false
    const create =
      /(新建|创建|建一[个张份]|建(表单|表)|做一[个张份]|做个|设计一[个张份]|设计个|生成一[个张份]|生成个|来一[个张份])/.test(
        userMessage,
      )
    const modify =
      /(添加|增加|新增|加入|加一|加个|加上|补充|修改|改成|改为|更新|删除|删掉|移除|去掉|精简|设置|设为|调整|重命名|排序)/.test(
        userMessage,
      )
    return modify || !create
  }

  /**
   * 在工作空间里按名称（或 uuid）找已保存的表，**不**读 schema。
   *
   * 有多个同名候选时把候选带出来 —— 调用方（gate）必须先问用户，绝不能默默新建；
   * 只有唯一命中时才交给 act 载入（2026-10-19：工作空间里恰有两张「教职工信息登记表」，
   * 之前直接退回新建，用户要求的消歧没有出现）。
   */
  private async lookupSavedForm(
    state: AgentStateType,
    target: string,
  ): Promise<
    | { formId: string; formName?: string }
    | { ambiguous: Array<{ formId: string; formName: string }> }
    | null
  > {
    if (!this.context || !state.userToken || !state.workspaceId) return null
    try {
      const found = await resolveExistingForm(
        this.context,
        state.userToken,
        state.workspaceId,
        undefined,
        target,
        { action: '修改' },
      )
      const candidates = found.failure?.candidates
      if (candidates && candidates.length > 0) return { ambiguous: candidates }
      if (found.failure || !found.formId) return null
      return { formId: found.formId, formName: found.formName }
    } catch (err: any) {
      this.logger.warn(`按名称查找已保存表单失败（${target}）：${err?.message ?? err}`)
      return null
    }
  }

  /**
   * 按名称把工作空间里已保存的表载入会话工作台。
   *
   * 用户点名的表往往是在**别的会话**里建的，不在【会话中的表单】里；不载入的话，
   * form_assemble_schema 只拿着补丁字段（例如一个备注字段）凭空生成一张新表
   * （2026-10-19 实测：变成 1 个字段的「新建表单」）。重名候选已由 gate 先行消歧，
   * 走到这里的一定是唯一命中。
   */
  private async loadSavedForm(
    state: AgentStateType,
    target: string,
  ): Promise<{ formId: string; title: string; schema: Record<string, unknown> } | null> {
    if (!this.context || !state.userToken) return null
    const found = await this.lookupSavedForm(state, target)
    if (!found || 'ambiguous' in found) return null
    try {
      const raw = await this.context.getFormSchema(state.userToken, found.formId)
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
      const title = found.formName || target
      const base = raw as Record<string, unknown>
      // 老 schema 可能没有 settings.formTitle（或为空）。不补的话，改表时
      // form_assemble_schema 会把它默认成「新建表单」，工作表条目也跟着改名，
      // 紧接着的 form_save 按表名就找不到这张表，又会被当成新建/重名。
      const schema = schemaTitle(base)
        ? base
        : {
            ...base,
            settings: {
              ...(base.settings && typeof base.settings === 'object' && !Array.isArray(base.settings)
                ? (base.settings as Record<string, unknown>)
                : {}),
              formTitle: title,
            },
          }
      return { formId: found.formId, title, schema }
    } catch (err: any) {
      // 读 schema 失败退回原来的「新建」路径，不阻断本轮
      this.logger.warn(`加载已保存表单失败（${target}）：${err?.message ?? err}`)
      return null
    }
  }

  // ==================== act（唯一的工具副作用点） ====================

  private async act(state: AgentStateType, spec: AgentSpec): Promise<Partial<AgentStateType>> {
    const call = state.pendingCalls[0]
    if (!call) return { gateOutcome: 'think' }

    // 寻址放在 act：它同时握着 args 与图状态。bridge 只按解析结果决定注入什么。
    let resolved = FORM_TOOLS.has(call.name)
      ? resolveFormTarget(call.args?.target as string | undefined, state.formWorksheet)
      : null
    let worksheet = state.formWorksheet

    // 目标不在【会话中的表单】里，但工作空间里确实有这张已保存的表 → 载入它的原
    // schema 与 formId，把「新建」改判成「改表」。否则模型只拿着补丁字段（比如
    // 一个备注字段）凭空生成一张新表（2026-10-19 实测：变成 1 个字段的「新建表单」）。
    if (
      resolved?.kind === 'create' &&
      resolved.title &&
      this.shouldLoadSavedForm(call.name, state.userMessage)
    ) {
      const loaded = await this.loadSavedForm(state, resolved.title)
      if (loaded) {
        const reg = registerSavedForm(worksheet, loaded)
        worksheet = reg.worksheet
        resolved = { kind: 'update', key: reg.key }
        this.logger.log(`目标「${loaded.title}」不在会话工作台，按工作空间名称解析为 ${loaded.formId}`)
      }
    }

    if (resolved?.kind === 'ambiguous') {
      this.logger.warn(
        `表单标题重名，先取最先命中的 ${resolved.keys[0]}（候选：${resolved.keys.join(', ')}）`,
      )
    }

    // extractArtifact 也看这份（补齐了已保存表的）工作台，这样 applyAssemble/markSaved
    // 能命中同一个 entry，保住 formId —— 否则保存时又会被当成新建。
    const callState = worksheet === state.formWorksheet ? state : { ...state, formWorksheet: worksheet }
    const ctx = toolCtx(callState, spec, resolved)
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

    // 每「连续失败满 maxRetries+1 次」记一次降级；该工具成功后再失败会重新计。
    //
    // 不能写成「刚跨过上限才记一次」：那样子在同一工具身上只会触发一次
    // （第 4 次起「上一次就已越线」恒为真），degradeCount 卡在 1、
    // `degradeCount > maxDegrades` 永远不成立 —— 一个工具从头坏到尾反倒不会收尾，
    // 只能等该 agent 的 maxIterations 兜底。
    const window = maxRetries + 1
    const prevFailures = prevErrors[call.name] ?? 0
    const crossed = Math.floor(failures / window) - Math.floor(prevFailures / window)
    const degradedNow = failures > maxRetries
    const degradeCount = (state.degradeCount ?? 0) + Math.max(0, crossed)

    let content: string
    if (ok) {
      content = this.bridge.toToolMessageContent({ ok, summary, result }, call.name)
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
    //
    // 走 gaveUp 而不是 halted：这是「系统放弃」，不是用户叫停。对外不发 error 事件
    // （文案本身是给用户的建议，不是系统故障，红色错误条会让人以为平台坏了），
    // 收尾语义改由 `done.stopReason = 'giveup'` 表达 —— 与 MAX_ITERATIONS 用尽那条
    // 出口共用同一个标记，两个「我做不到」从此长得一样。
    if (degradeCount > maxDegrades) {
      const message = '当前方式多次尝试仍未成功，建议换一种描述，或把需求拆得更具体一些。'
      this.logger.warn(`工具多次降级（degradeCount=${degradeCount}），收尾本轮`)
      return {
        messages: [...state.messages, toolMessage],
        pendingCalls: [],
        lastTool: { callId: call.id, name: call.name, ok, summary },
        needThink: false,
        gaveUp: true,
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
      // 幻觉守卫判据：本轮成功执行过的工具（S7.2）
      turnToolOk: ok ? [...(state.turnToolOk ?? []), call.name] : (state.turnToolOk ?? []),
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
        state: callState,
        resolved: resolved ?? undefined,
      })
      if (extracted?.draftUpdate) {
        // drafts 只写这一格（merge 语义，跨轮保留）；同时登记「本轮写过」，
        // 供 planAdvance 判断这一步是真的产出了产物，还是捡了上一轮的残留。
        patch.drafts = { [spec.key]: extracted.draftUpdate }
        patch.turnDraftAgents = [...(state.turnDraftAgents ?? []), spec.key]
      }
      if (extracted?.metadata) {
        const clean: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(extracted.metadata)) if (v !== undefined) clean[k] = v
        if (Object.keys(clean).length > 0) patch.sessionMetadataPatch = clean
      }
      if (extracted?.worksheet) {
        patch.formWorksheet = extracted.worksheet
      }
      if (extracted?.facts) {
        // 领域事实：与 agent 已有的 facts 做**内层合并**（顶层 reducer 只合一层），
        // 这样同一 Agent 多轮产出的事实能累加（先 templateCount、后 templateId…）。
        patch.sessionFacts = {
          [spec.key]: { ...(state.sessionFacts?.[spec.key] ?? {}), ...extracted.facts },
        }
      }
    }

    return patch
  }

  // ==================== respond / halt ====================

  private respond(state: AgentStateType, spec: AgentSpec): Partial<AgentStateType> {
    // 幻觉守卫（S7.2）：正常收尾（非中断/非放弃）时，校验「声称的产物必有工具结果」。
    // 命中则给收尾文本追加纠正说明，并广播一条告警事件。
    let content = state.finalContent
    let corrected = false
    if (!state.halted && !state.gaveUp) {
      const check = guardHallucination(content, spec.produceTools ?? [], state.turnToolOk ?? [])
      if (check.suspicious) {
        corrected = true
        content = content + hallucinationCorrection(check.note)
        emit({
          type: 'error',
          code: 'HALLUCINATION_GUARD',
          message: `检测到未经工具确认的完成声明（${check.claim}），已标注为未落库`,
        })
      }
    }

    const lastStep = (state.stepIndex ?? 0) >= ((state.plan?.steps?.length ?? 1) - 1)

    // 多步计划的中间步骤：只要这一步**成功产出并交接**给下一步，就不把它的收尾话术
    // 发给用户。否则会前后矛盾 —— 2026-10-19 实测：模板助手说「还没写进表单管理，
    // 需要交给表单设计助手…需要我继续帮你…」，但编排层紧接着就自动跑了下一步。
    // 进度由 planDriver 的 status 与工具事件体现；失败/无产物的步骤不抑制（它的说明
    // 是后续步骤被跳过的唯一解释）。
    const handedOff =
      !lastStep &&
      !state.halted &&
      !state.gaveUp &&
      (state.turnDraftAgents ?? []).includes(spec.key)
    if (!handedOff) emit({ type: 'message', role: 'assistant', content })

    // 只有计划**最后一步**（或单步）的收尾才写会话级状态：多步计划里 respond 每步都跑，
    // 共享 channel 是替换语义、后写覆盖先写，中间步若以问句结尾会污染 pendingClarification。
    if (!lastStep) return corrected ? { finalContent: content } : {}

    // gaveUp 也会走到 respond（gate 收尾），故必须把 halted || gaveUp 一起传进去，
    // 否则「认输话术」会被误判成「提问」（手册 D3 要点 2）。
    const clarification = detectClarification({
      agent: spec.key,
      finalContent: content,
      producedArtifact: (state.turnDraftAgents ?? []).includes(spec.key),
      haltedOrGaveUp: state.halted || state.gaveUp,
    })
    return {
      ...(corrected ? { finalContent: content } : {}),
      ...(clarification ? { pendingClarification: clarification } : {}),
    }
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

/**
 * 注入用的近期窗口候选：去掉末尾本轮 user（routerNode 刚追加）。
 * 只做条数**上限**兜底（防止极端长会话把整段历史塞进投影），真正的截断口径交给
 * projectMemory 的 token 预算（手册 §2.12-D3：由固定窗口 MEMORY_WINDOW=6 改为预算驱动）。
 */
const RECENT_CANDIDATE_MAX = 20
function recentTurns(state: AgentStateType): { role: 'user' | 'assistant'; content: string }[] {
  const turns = state.historyTurns ?? []
  const withoutCurrent = turns.length > 0 && turns[turns.length - 1].role === 'user' ? turns.slice(0, -1) : turns
  return withoutCurrent.slice(-RECENT_CANDIDATE_MAX)
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
    sessionId: state.sessionId,
    savedFormId: state.sessionMetadataPatch?.savedFormId as string | undefined,
    savedWorkflowId: state.sessionMetadataPatch?.savedWorkflowId as string | undefined,
    currentSchema: draft?.schema,
    formWorksheet: state.formWorksheet,
    formTarget: resolved,
  }
}
