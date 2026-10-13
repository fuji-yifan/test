/**
 * LangGraph 引擎 SSE 适配层的单测（不联网、不依赖 Nest 容器与 MySQL）。
 *
 * 覆盖的是"接线"最容易出错的几处：
 * - GraphEvent → SSE 事件的映射，以及收尾补发的 message.result（前端预览卡片的数据源）；
 * - interrupt → confirm_required → 回执 → Command(resume) 的取值折返；
 * - 检查点的信息披露：confirm_required 要带上待审产物，不能只有按钮；
 * - 用户不答检查点、直接发新消息时，先 abort 收尾再跑新消息。
 */
import { describe, it, expect } from 'vitest'
import { SseEventType } from '../src/common/sse/sse.writer'
import {
  LangGraphTurnService,
  type PendingGraphInterrupt,
} from '../src/modules/hub/langgraph-turn.service'
import type {
  GraphEvent,
  GraphRunnerService,
  RunGraphResult,
  RunGraphParams,
} from '../src/modules/graph/graph-runner.service'
import type { SessionService } from '../src/modules/session/session.service'
import type { AgentSession } from '../src/modules/session/session.store'

// ==================== 测试替身 ====================

type Recorded = { type: string; payload: Record<string, any> }

interface RunnerCall {
  kind: 'run' | 'resume'
  params: RunGraphParams & { resume?: unknown }
}

/** 可控的假 runner：按脚本吐事件，然后返回脚本结果 */
function makeRunner(script: {
  events?: GraphEvent[]
  result: RunGraphResult
  onResumeEvents?: GraphEvent[]
}) {
  const calls: RunnerCall[] = []
  const runner = {
    async run(params: any): Promise<RunGraphResult> {
      calls.push({ kind: 'run', params })
      for (const e of script.events ?? []) await params.onEvent(e)
      return script.result
    },
    async resume(params: any): Promise<RunGraphResult> {
      calls.push({ kind: 'resume', params })
      for (const e of script.onResumeEvents ?? []) await params.onEvent(e)
      return script.result
    },
  }
  return { runner: runner as unknown as GraphRunnerService, calls }
}

function makeSessions(session: AgentSession) {
  const patches: Record<string, any>[] = []
  const sessions = {
    async get(id: string) {
      return id === session.id ? session : null
    },
    async updateMetadata(id: string, patch: Record<string, any>) {
      patches.push(patch)
      session.metadata = { ...session.metadata, ...patch }
      return session
    },
  }
  return { sessions: sessions as unknown as SessionService, patches }
}

function makeSse() {
  const events: Recorded[] = []
  const sse = {
    writeEvent(type: SseEventType, payload: Record<string, unknown>) {
      events.push({ type, payload })
    },
  }
  return { sse: sse as any, events }
}

function newSession(metadata: Record<string, any> = {}): AgentSession {
  return {
    id: 'sess_test01',
    userId: 'user_1',
    workspaceId: 'ws_1',
    scenario: 'form-builder',
    messages: [],
    metadata,
    locked: false,
    createdAt: 0,
    updatedAt: 0,
  }
}

function makeService(script: Parameters<typeof makeRunner>[0], session = newSession()) {
  const { runner, calls } = makeRunner(script)
  const { sessions, patches } = makeSessions(session)
  const { sse, events } = makeSse()
  const config = { get: (key: string) => (key === 'deepseek.model' ? 'deepseek-chat' : undefined) }
  const service = new LangGraphTurnService(runner, sessions, config as any)
  return { service, calls, patches, events, sse, session }
}

function typesOf(events: Recorded[]): string[] {
  return events.map((e) => e.type)
}

function lastOf(events: Recorded[], type: string): Recorded | undefined {
  return [...events].reverse().find((e) => e.type === type)
}

const OK_RESULT: RunGraphResult = {
  finalContent: '表单已经建好了',
  usage: { inputTokens: 12, outputTokens: 34 },
  halted: false,
  gaveUp: false,
}

const INTERRUPT_PAYLOAD = {
  kind: 'checkpoint' as const,
  checkpointId: 'space-approval',
  toolCallId: 'call_1',
  tool: 'form_save',
  prompt: '这个表单是否加入当前空间？',
  options: [
    { value: 'continue', label: '加入当前空间', style: 'primary' },
    { value: 'abort', label: '先不加入', style: 'danger' },
  ],
}

function turnParams(session: AgentSession, body: Record<string, any> = {}) {
  return {
    sse: undefined as any,
    session,
    body: { message: '创建客户登记表', scenario: 'form-builder', ...body },
    userToken: 'jwt_token',
    requestId: 'req_1',
    signal: new AbortController().signal,
  }
}

// ==================== 用例 ====================

describe('LangGraphTurnService — 事件映射', () => {
  it('把图事件逐个翻译成同名 SSE 事件', async () => {
    const { service, events, sse, session } = makeService({
      events: [
        { type: 'route', steps: [{ id: '1', agent: 'form-designer', action: '生成表单' }] },
        { type: 'meta', agent: 'form-designer', tools: ['form_save'] },
        { type: 'status', agent: 'form-designer', phase: 'executing', stepIndex: 0, totalSteps: 1 },
        { type: 'delta', content: '正在' },
        { type: 'tool_start', callId: 'call_1', tool: 'form_save', args: { a: 1 } },
        { type: 'tool_result', callId: 'call_1', tool: 'form_save', ok: true, summary: '已保存' },
        { type: 'message', role: 'assistant', content: '表单已经建好了' },
      ],
      result: OK_RESULT,
    })

    await service.runTurn({ ...turnParams(session), sse })

    expect(typesOf(events)).toEqual([
      'meta',
      'status',
      'delta',
      'tool_start',
      'tool_result',
      'message',
      'message', // 收尾补发的那条（带 result）
      'done',
    ])
    expect(events[0].payload).toMatchObject({
      model: 'deepseek-chat',
      requestId: 'req_1',
      activeAgent: 'form-designer',
      tools: ['form_save'],
    })
    // status.todo 由最近一次 route.steps 派生（legacy 的 todo 是纯文案数组）
    expect(events[1].payload).toMatchObject({ agent: 'form-designer', phase: 'executing', todo: ['1. 生成表单'] })
    expect(events[3].payload).toEqual({ callId: 'call_1', tool: 'form_save', args: { a: 1 } })
    expect(events[4].payload).toEqual({ callId: 'call_1', tool: 'form_save', ok: true, summary: '已保存' })
  })

  it('收尾补发带 result 的 message，供前端预览卡片使用', async () => {
    const session = newSession({
      activeSubAgent: 'form-designer',
      draftSchema: { fields: [{ name: '姓名' }] },
    })
    const { service, events, sse } = makeService({ result: OK_RESULT }, session)

    await service.runTurn({ ...turnParams(session), sse })

    const final = lastOf(events, 'message')
    expect(final?.payload).toMatchObject({
      role: 'assistant',
      content: '表单已经建好了',
      result: { schema: { fields: [{ name: '姓名' }] } },
    })
    expect(lastOf(events, 'done')?.payload).toMatchObject({
      sessionId: 'sess_test01',
      stopReason: 'completed',
      usage: { inputTokens: 12, outputTokens: 34 },
    })
  })

  it('activeSubAgent 缺失时按草稿键回退取产物', async () => {
    const session = newSession({ draftWorkflow: { nodes: [{ id: 'n1', type: 'approval' }] } })
    const { service, events, sse } = makeService({ result: OK_RESULT }, session)

    await service.runTurn({ ...turnParams(session), sse })

    expect(lastOf(events, 'message')?.payload.result).toEqual({ nodes: [{ id: 'n1', type: 'approval' }] })
  })

  it('把 new 消息与页面上下文原样交给 runner', async () => {
    const { service, calls, sse, session } = makeService({ result: OK_RESULT })

    await service.runTurn({
      ...turnParams(session, { context: { entityId: 'form_9', pageLabel: '表单设计器' } }),
      sse,
    })

    expect(calls).toHaveLength(1)
    expect(calls[0].kind).toBe('run')
    expect(calls[0].params).toMatchObject({
      sessionId: 'sess_test01',
      userId: 'user_1',
      workspaceId: 'ws_1',
      userToken: 'jwt_token',
      message: '创建客户登记表',
      pageContext: { scenario: 'form-builder', entityId: 'form_9', pageLabel: '表单设计器' },
    })
  })
})

describe('LangGraphTurnService — interrupt 与回执', () => {
  const interrupted: RunGraphResult = {
    interrupted: { ...INTERRUPT_PAYLOAD, id: 'itr_1' },
    finalContent: '',
    usage: { inputTokens: 5, outputTokens: 6 },
    halted: false,
    gaveUp: false,
  }

  it('interrupt 折成 confirm_required，并把待答复项记进 session', async () => {
    const session = newSession()
    const { service, events, patches, sse } = makeService({ result: interrupted }, session)

    await service.runTurn({ ...turnParams(session), sse })

    const confirm = lastOf(events, 'confirm_required')
    expect(confirm?.payload).toMatchObject({
      tool: 'form_save',
      summary: '这个表单是否加入当前空间？',
      prompt: '这个表单是否加入当前空间？',
      kind: 'checkpoint',
      options: [
        { value: 'continue', label: '加入当前空间', style: 'primary' },
        { value: 'abort', label: '先不加入', style: 'danger' },
      ],
    })
    expect(confirm?.payload.callId).toMatch(/^graph_/)
    // 图里没给风险就别编一个出来：业务检查点不是风险门，假的风险等级是假披露
    expect(confirm?.payload).not.toHaveProperty('risk')

    const record = patches.at(-1)?.pendingGraphInterrupt as PendingGraphInterrupt
    expect(record).toMatchObject({
      callId: confirm?.payload.callId,
      kind: 'checkpoint',
      checkpointId: 'space-approval',
      toolCallId: 'call_1',
      options: INTERRUPT_PAYLOAD.options,
    })

    // 中断不算最终回答，不发补发的 message；done 要标明中断
    expect(typesOf(events)).not.toContain('message')
    expect(lastOf(events, 'done')?.payload).toMatchObject({ stopReason: 'interrupted' })
  })

  it('检查点带上待审产物作为披露依据（原样透传中断载荷里的 artifact）', async () => {
    // 产物由子图在中断载荷里带出来：子图挂起期间父图读不到它的 channel patch，
    // 所以这一刻 session.metadata 里还没有 draftSchema（故意不给 session 塞草稿）。
    const withArtifact: RunGraphResult = {
      ...interrupted,
      interrupted: {
        ...INTERRUPT_PAYLOAD,
        id: 'itr_1',
        artifact: { schema: { fields: [{ name: '姓名' }, { name: '工号' }] } },
      },
    }
    const session = newSession()
    const { service, events, sse } = makeService({ result: withArtifact }, session)

    await service.runTurn({ ...turnParams(session), sse })

    // 用户被问「是否加入空间」时得看得到那个表单，否则只有按钮没有依据
    expect(lastOf(events, 'confirm_required')?.payload.artifact).toEqual({
      schema: { fields: [{ name: '姓名' }, { name: '工号' }] },
    })
  })

  it('载荷里没有产物时不下发 artifact 键，也不回头去嗅 metadata', async () => {
    // metadata 里就算躺着草稿也不能当成本次要审的东西——那可能是上一轮遗留的，
    // 披露错的产物比不披露更糟。所以这里故意塞一份，断言它不会被用上。
    const session = newSession({
      activeSubAgent: 'form-designer',
      draftSchema: { fields: [{ name: '上一轮的表单' }] },
    })
    const { service, events, sse } = makeService({ result: interrupted }, session)

    await service.runTurn({ ...turnParams(session), sse })

    expect(lastOf(events, 'confirm_required')?.payload).not.toHaveProperty('artifact')
  })

  it('工具风险门的风险等级原样透传（用户要知道自己在放行多危险的操作）', async () => {
    const risky: RunGraphResult = {
      ...interrupted,
      interrupted: {
        kind: 'tool_confirm',
        toolCallId: 'call_2',
        tool: 'data_export',
        risk: 'high',
        summary: '即将执行 data_export（风险：high）',
        prompt: '即将执行 data_export（风险：high）',
        options: [
          { value: 'confirm', label: '确认回滚', style: 'danger' },
          { value: 'abort', label: '取消', style: 'default' },
        ],
      },
    }
    const session = newSession()
    const { service, events, sse } = makeService({ result: risky }, session)

    await service.runTurn({ ...turnParams(session), sse })

    expect(lastOf(events, 'confirm_required')?.payload).toMatchObject({ tool: 'data_export', risk: 'high' })
  })

  it('回执 confirmAction=continue 时 resume 收到 {action:"continue"}', async () => {
    const pending: PendingGraphInterrupt = {
      callId: 'graph_abc',
      kind: 'checkpoint',
      checkpointId: 'space-approval',
      toolCallId: 'call_1',
      tool: 'form_save',
      prompt: INTERRUPT_PAYLOAD.prompt,
      options: INTERRUPT_PAYLOAD.options,
    }
    const session = newSession({ pendingGraphInterrupt: pending })
    const { service, calls, sse, patches } = makeService({ result: OK_RESULT }, session)

    await service.runTurn({
      ...turnParams(session, { confirmCallId: 'graph_abc', confirmAction: 'continue' }),
      sse,
    })

    expect(calls).toHaveLength(1)
    expect(calls[0].kind).toBe('resume')
    expect(calls[0].params.resume).toEqual({ action: 'continue' })
    // 答完就清掉，避免下一轮误判为悬挂
    expect(patches.at(-1)?.pendingGraphInterrupt).toBeNull()
  })

  it('工具风险门的回执保留 confirm 语义', async () => {
    const pending: PendingGraphInterrupt = {
      callId: 'graph_risk',
      kind: 'tool_confirm',
      checkpointId: null,
      toolCallId: 'call_2',
      tool: 'data_export',
      prompt: '回滚会撤销这条提交记录，确定要回滚吗？',
      options: [
        { value: 'confirm', label: '确认回滚', style: 'danger' },
        { value: 'abort', label: '取消', style: 'default' },
      ],
    }
    const session = newSession({ pendingGraphInterrupt: pending })
    const { service, calls, sse } = makeService({ result: OK_RESULT }, session)

    await service.runTurn({
      ...turnParams(session, { confirmCallId: 'graph_risk', confirmAction: 'confirm' }),
      sse,
    })

    expect(calls[0].params.resume).toEqual({ action: 'confirm' })
  })

  it('前端没带 confirmAction 时退回第一个选项（继续）', async () => {
    const pending: PendingGraphInterrupt = {
      callId: 'graph_abc',
      kind: 'checkpoint',
      checkpointId: 'schema-review',
      toolCallId: 'call_3',
      tool: 'form_assemble_schema',
      prompt: '这个结构是否可行？',
      options: [
        { value: 'continue', label: '继续', style: 'primary' },
        { value: 'abort', label: '中断', style: 'danger' },
      ],
    }
    const session = newSession({ pendingGraphInterrupt: pending })
    const { service, calls, sse } = makeService({ result: OK_RESULT }, session)

    await service.runTurn({ ...turnParams(session, { confirmCallId: 'graph_abc' }), sse })

    expect(calls[0].params.resume).toEqual({ action: 'continue' })
  })

  it('callId 对不上时不当作回执，按新消息处理', async () => {
    const pending: PendingGraphInterrupt = {
      callId: 'graph_abc',
      kind: 'checkpoint',
      checkpointId: 'space-approval',
      toolCallId: 'call_1',
      tool: 'form_save',
      prompt: INTERRUPT_PAYLOAD.prompt,
      options: INTERRUPT_PAYLOAD.options,
    }
    const session = newSession({ pendingGraphInterrupt: pending })
    const { service, calls, sse } = makeService({ result: OK_RESULT }, session)

    await service.runTurn({
      ...turnParams(session, { confirmCallId: 'graph_stale', confirmAction: 'continue' }),
      sse,
    })

    // 走的是「悬挂中断」分支：先 abort，再跑新消息
    expect(calls.map((c) => c.kind)).toEqual(['resume', 'run'])
    expect(calls[0].params.resume).toEqual({ action: 'abort' })
  })
})

describe('LangGraphTurnService — 悬挂中断', () => {
  const pending: PendingGraphInterrupt = {
    callId: 'graph_abc',
    kind: 'checkpoint',
    checkpointId: 'space-approval',
    toolCallId: 'call_1',
    tool: 'form_save',
    prompt: INTERRUPT_PAYLOAD.prompt,
    options: INTERRUPT_PAYLOAD.options,
  }

  it('先 abort 收尾再跑新消息，且 abort 那次的事件不下发', async () => {
    const session = newSession({ pendingGraphInterrupt: pending })
    const { service, calls, events, sse, patches } = makeService(
      {
        // abort 那次会吐垃圾话术，必须被丢弃，不能混进本轮 UI
        onResumeEvents: [{ type: 'delta', content: '（上一轮已取消）' }],
        events: [{ type: 'delta', content: '好的' }],
        result: OK_RESULT,
      },
      session,
    )

    await service.runTurn({ ...turnParams(session, { message: '换个话题，创建报销表' }), sse })

    expect(calls.map((c) => c.kind)).toEqual(['resume', 'run'])
    expect(calls[0].params.resume).toEqual({ action: 'abort' })
    expect(calls[1].params.message).toBe('换个话题，创建报销表')

    const deltas = events.filter((e) => e.type === 'delta')
    expect(deltas).toHaveLength(1)
    expect(deltas[0].payload).toEqual({ content: '好的' })

    expect(patches.some((p) => p.pendingGraphInterrupt === null)).toBe(true)
  })

  it('没有悬挂中断时只 run 一次', async () => {
    const session = newSession()
    const { service, calls, sse } = makeService({ result: OK_RESULT }, session)

    await service.runTurn({ ...turnParams(session), sse })

    expect(calls.map((c) => c.kind)).toEqual(['run'])
  })
})

describe('LangGraphTurnService — 用量软上限告警（阶段 4 / 4.4）', () => {
  function makeWithLimit(limit: number, usage: { inputTokens: number; outputTokens: number }) {
    const { runner } = makeRunner({ result: { finalContent: '', usage, halted: false, gaveUp: false } })
    const session = newSession()
    const { sessions } = makeSessions(session)
    const { sse, events } = makeSse()
    const config = {
      get: (key: string) => (key === 'context.usageSoftLimitTokens' ? limit : undefined),
    }
    const service = new LangGraphTurnService(runner, sessions, config as any)
    return { service, events, sse, session }
  }

  it('累计用量达到阈值时 done 带 usageAlert=true', async () => {
    const { service, events, sse, session } = makeWithLimit(100, { inputTokens: 80, outputTokens: 40 })
    await service.runTurn({ ...turnParams(session), sse })
    expect(lastOf(events, 'done')?.payload).toMatchObject({ usageAlert: true })
  })

  it('未达阈值时不带 usageAlert', async () => {
    const { service, events, sse, session } = makeWithLimit(100, { inputTokens: 10, outputTokens: 20 })
    await service.runTurn({ ...turnParams(session), sse })
    expect(lastOf(events, 'done')?.payload).not.toHaveProperty('usageAlert')
  })

  it('阈值为 0（默认关）时不告警', async () => {
    const { service, events, sse, session } = makeWithLimit(0, { inputTokens: 99999, outputTokens: 99999 })
    await service.runTurn({ ...turnParams(session), sse })
    expect(lastOf(events, 'done')?.payload).not.toHaveProperty('usageAlert')
  })
})

describe('LangGraphTurnService — 异常', () => {
  it('runner 抛错时下发 FATAL + done(error)，且不把异常抛给 controller', async () => {
    const session = newSession()
    const { runner } = makeRunner({ result: OK_RESULT })
    runner.run = (async () => {
      throw new Error('checkpoint 表不存在')
    }) as any
    const { sessions } = makeSessions(session)
    const config = { get: () => undefined }
    const service = new LangGraphTurnService(runner, sessions, config as any)
    const { sse, events } = makeSse()

    await expect(service.runTurn({ ...turnParams(session), sse })).resolves.toBeUndefined()

    expect(lastOf(events, 'error')?.payload).toEqual({
      code: 'FATAL',
      message: 'checkpoint 表不存在',
    })
    expect(lastOf(events, 'done')?.payload).toMatchObject({ stopReason: 'error' })
  })
})
