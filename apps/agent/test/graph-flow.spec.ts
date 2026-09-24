/**
 * 图编排端到端测试（不联网、不依赖 Nest 容器）。
 *
 * 覆盖 Phase 3/4 的核心断言：
 * - 页面 + 提示词共同决定路由（含跨领域多步计划）；
 * - 子图里的 interrupt 能冒泡到父图，Command(resume) 能从正确的位置续跑；
 * - resume 不会重放已经执行过工具的那个节点（副作用只发生一次）；
 * - 声明式 HITL 检查点（beforeTool / afterTool）按目录定义触发；
 * - 未声明业务检查点的中高风险工具，走风险确认门（ToolGateway 语义）。
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { AIMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages'
import { createConnection, createPool, type Pool } from 'mysql2/promise'
import { z } from 'zod'
import { AgentCatalogService } from '../src/modules/graph/agent-catalog'
import { RouterService } from '../src/modules/graph/router.service'
import { PlanService } from '../src/modules/graph/plan.service'
import { AgentSubgraphFactory } from '../src/modules/graph/subgraph.factory'
import { AgentGraphService } from '../src/modules/graph/agent-graph.service'
import { GraphRunnerService } from '../src/modules/graph/graph-runner.service'
import { LangChainToolBridge } from '../src/modules/graph/tool-bridge.service'
import { MysqlCheckpointSaver } from '../src/modules/graph/mysql-checkpoint-saver'
import { MysqlExecutor } from '../src/modules/graph/sql-executor'
import type { GraphEvent } from '../src/modules/graph/graph-runner.service'

const TEST_DB = 'langgraph_graphflow_test'
const parsed = new URL(process.env.AGENT_DATABASE_URL!)
const conn = {
  host: parsed.hostname,
  port: parseInt(parsed.port || '3306', 10),
  user: decodeURIComponent(parsed.username),
  password: decodeURIComponent(parsed.password),
}
let pool: Pool
let saver: MysqlCheckpointSaver

beforeAll(async () => {
  const admin = await createConnection(conn)
  await admin.query(`CREATE DATABASE IF NOT EXISTS \`${TEST_DB}\` CHARACTER SET utf8mb4`)
  await admin.end()
  pool = createPool({ ...conn, database: TEST_DB, connectionLimit: 5 })
  saver = new MysqlCheckpointSaver(new MysqlExecutor(pool))
  await saver.setup()
})

afterAll(async () => {
  await pool.end()
  const admin = await createConnection(conn)
  await admin.query(`DROP DATABASE IF EXISTS \`${TEST_DB}\``)
  await admin.end()
})

// ==================== 测试替身 ====================

const TOOL_RISK: Record<string, 'low' | 'medium' | 'high'> = {
  form_search_field_pool: 'low',
  form_assemble_schema: 'low',
  form_validate_schema: 'low',
  form_preview: 'low',
  form_save: 'low',
  flow_create: 'low',
  flow_validate: 'low',
  flow_preview: 'low',
  flow_save: 'low',
  flow_bind_form: 'medium',
  template_search: 'low',
  template_get_detail: 'low',
  template_validate: 'low',
  template_instantiate: 'low',
  data_list_forms: 'low',
  data_query: 'low',
  data_analyze: 'low',
  // 高风险/中风险的通用替身：用来验检查点与工具级确认门，与具体领域无关
  data_export: 'high',
  data_merge: 'medium',
}

class FakeRegistry {
  get(name: string) {
    const risk = TOOL_RISK[name]
    if (!risk) return undefined
    return {
      name,
      description: `tool ${name}`,
      riskLevel: risk,
      parameters: { type: 'object', properties: {} },
      zodSchema: z.object({}).passthrough(),
      instance: {},
    }
  }
  getRisk(name: string) {
    return TOOL_RISK[name] ?? 'low'
  }
  list() {
    return Object.keys(TOOL_RISK).map((name) => ({ name, description: name, parameters: {} }))
  }
  listByNames(names: string[]) {
    return this.list().filter((t) => names.includes(t.name))
  }
}

interface GwCall {
  name: string
  args: Record<string, unknown>
  confirmed: boolean
}

class FakeGateway {
  calls: GwCall[] = []
  /** 放进来的工具名一律返回失败，用来验重试上限 / 降级 / 收尾 */
  failTools = new Set<string>()
  /** 失败时回给网关的 error 分类（默认按执行错处理） */
  failError = 'execution_error'
  async execute(name: string, args: Record<string, unknown>) {
    this.calls.push({ name, args, confirmed: false })
    if (this.failTools.has(name)) {
      return { ok: false, summary: `${name} failed`, error: this.failError }
    }
    return this.result(name, args)
  }
  async executeConfirmed(name: string, args: Record<string, unknown>) {
    this.calls.push({ name, args, confirmed: true })
    return this.result(name, args)
  }
  private result(name: string, args: Record<string, unknown> = {}) {
    // 组装的标题跟着 target 走，这样两张表各有各的标题，便于断言「各是各的」
    const title =
      typeof args.target === 'string' && args.target
        ? args.target
        : typeof args.formTitle === 'string' && args.formTitle
          ? args.formTitle
          : '新建表单'
    const payloads: Record<string, unknown> = {
      form_assemble_schema: {
        schema: { settings: { formTitle: title }, fields: [{ key: 'name', type: 'string' }] },
      },
      form_validate_schema: { passed: true, issues: [] },
      form_preview: { previewUrl: 'http://x/preview' },
      form_save: { formId: 'F-1' },
      flow_create: { nodes: [{ id: 'n1' }], edges: [] },
      data_analyze: { summary: '本月投诉集中在物流', insights: [] },
      template_instantiate: {
        templateId: 'T-9',
        name: '请假申请',
        schema: { fields: [{ key: 'days', type: 'number' }] },
      },
    }
    return { ok: true, summary: `${name} ok`, result: payloads[name] ?? { ok: true } }
  }
}

/** 按脚本逐轮返回 AIMessage 的假模型 */
class ScriptedLlm {
  private cursor = 0
  calls = 0
  /** 每次 think 收到的完整上下文，用来断言步骤交接时指令里带了上游产物 */
  seen: BaseMessage[][] = []
  /** 路由兜底用的 chat 通道：这里统一「无意见」，让路由沿用确定性结论 */
  chat = { invoke: async () => new AIMessage({ content: '' }) }
  constructor(private readonly script: { content?: string; calls?: { id: string; name: string; args?: Record<string, unknown> }[] }[]) {}
  withTools() {
    return {
      invoke: async (messages: BaseMessage[]) => {
        this.seen.push(messages)
        const step = this.script[Math.min(this.cursor, this.script.length - 1)]
        this.cursor++
        this.calls++
        return new AIMessage({
          content: step.content ?? '',
          tool_calls: (step.calls ?? []).map((c) => ({ id: c.id, name: c.name, args: c.args ?? {} })),
        })
      },
    }
  }
}

interface Harness {
  runner: GraphRunnerService
  gateway: FakeGateway
  llm: ScriptedLlm
  events: GraphEvent[]
  sessionId: string
}

function buildHarness(script: ScriptedLlm[''] extends never ? never : ConstructorParameters<typeof ScriptedLlm>[0], overrides?: { catalogSpec?: any }) {
  const registry = new FakeRegistry() as any
  const gateway = new FakeGateway()
  const bridge = new LangChainToolBridge(registry, gateway as any)
  const skills = { getAllMeta: () => [], loadFull: () => null } as any
  const catalog = new AgentCatalogService(skills, registry)
  if (overrides?.catalogSpec) {
    catalog.list = () => [overrides.catalogSpec]
  }
  const llm = new ScriptedLlm(script)
  // 假配置：错误恢复的阈值与 .env.example 的默认值一致
  const config = {
    get: (key: string) =>
      ({ 'context.maxRetries': 2, 'context.maxDegrades': 1 } as Record<string, number>)[key],
  } as any
  const subgraphs = new AgentSubgraphFactory(bridge, llm as any, registry, skills, config)
  const router = new RouterService(catalog, llm as any)
  const plan = new PlanService()
  const checkpoint = { enabled: true, get saver() { return saver } } as any
  const graphs = new AgentGraphService(router, plan, catalog, subgraphs, checkpoint)
  const sessions = {
    updateMetadata: async () => undefined,
    addMessage: async () => undefined,
  } as any
  const runner = new GraphRunnerService(graphs, sessions)
  return { runner, gateway, llm, events: [], sessionId: `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }
}

/** 最小 submission spec：不带任何检查点，专门用来验工具失败后的错误恢复级联 */
function submissionSpec(toolNames: string[], maxIterations = 8) {
  return {
    key: 'submission',
    label: 'Submission Agent',
    scenario: 'data-analysis',
    toolNames,
    serverTools: toolNames,
    maxIterations,
    systemPrompt: () => 'submission',
    extractArtifact: () => null,
    checkpoints: [],
  }
}

/** 某次 think 收到的上下文里，ToolMessage 的文本内容 */
function toolContentsOf(msgs: BaseMessage[]): string[] {
  return msgs.filter((m) => ToolMessage.isInstance(m)).map((m) => String((m as ToolMessage).content))
}

async function runTurn(h: Harness, message: string, scenario = 'form-builder', workspaceId = 'w1') {
  const events: GraphEvent[] = []
  const result = await h.runner.run({
    sessionId: h.sessionId,
    userId: 'u1',
    workspaceId,
    userToken: 'tok',
    message,
    pageContext: { scenario },
    onEvent: (e) => events.push(e),
  })
  h.events = events
  return result
}

async function resumeTurn(h: Harness, resume: unknown, workspaceId = 'w1') {
  const events: GraphEvent[] = []
  const result = await h.runner.resume({
    sessionId: h.sessionId,
    userId: 'u1',
    workspaceId,
    userToken: 'tok',
    resume,
    onEvent: (e) => events.push(e),
  })
  h.events = events
  return result
}

// ==================== 用例 ====================

describe('LangGraph 编排', () => {
  // 注意：这里第二段用 form_preview 是桩模型随便挑的，真实链路是 assemble → validate → save，
  // 检查点文案也已不再承诺"继续则进入预览"。用例只验检查点机制本身。
  it('表单：生成结构 → 停下来问「是否可行」→ 继续后接着执行下一批调用', async () => {
    const h = buildHarness([
      { calls: [{ id: 'c1', name: 'form_assemble_schema', args: { fields: [{ key: 'name' }] } }] },
      { calls: [{ id: 'c2', name: 'form_preview', args: {} }] },
      { content: '表单结构和预览都好了，需要保存吗？' },
    ])

    const first = await runTurn(h, '创建一个客户登记表，包含姓名和手机号')
    expect(first.interrupted).toBeTruthy()
    expect(first.interrupted!.kind).toBe('checkpoint')
    expect(first.interrupted!.checkpointId).toBe('schema-review')
    expect(first.interrupted!.tool).toBe('form_assemble_schema')
    expect(first.interrupted!.options?.map((o) => o.value)).toEqual(['continue', 'abort'])
    // 检查点必须自带依据：刚组装出来的结构要随中断载荷一起出去，
    // 否则前端只有「继续/中断」两个按钮，用户不知道自己在批准什么
    const art = first.interrupted!.artifact as any
    expect(art.schema.fields[0]).toMatchObject({ key: 'name', type: 'string' })
    // 产物带上工作台的多表形态，前端据此渲染多行摘要列表
    expect(art.forms).toHaveLength(1)
    expect(art.forms[0].key).toBe('f1')

    // 组装工具只执行了一次，且尚未调 form_preview
    expect(h.gateway.calls.map((c) => c.name)).toEqual(['form_assemble_schema'])

    // 路由事件说明是页面/提示词决定的
    const route = h.events.find((e) => e.type === 'route')
    expect(route?.agent).toBe('form-designer')

    const second = await resumeTurn(h, { action: 'continue' })
    expect(second.interrupted).toBeUndefined()
    expect(second.finalContent).toContain('需要保存吗')

    // 关键：resume 没有重放 form_assemble_schema
    expect(h.gateway.calls.map((c) => c.name)).toEqual(['form_assemble_schema', 'form_preview'])
  })

  it('表单：保存前问「是否加入当前空间」，确认后走 executeConfirmed', async () => {
    const h = buildHarness([
      { calls: [{ id: 'c1', name: 'form_assemble_schema', args: {} }] },
      { calls: [{ id: 'c2', name: 'form_save', args: { name: '客户登记表' } }] },
      { content: '已保存到当前空间。' },
    ])

    const first = await runTurn(h, '创建客户登记表并保存')
    expect(first.interrupted?.checkpointId).toBe('schema-review')

    const second = await resumeTurn(h, { action: 'continue' })
    expect(second.interrupted?.checkpointId).toBe('space-approval')
    expect(second.interrupted?.tool).toBe('form_save')
    expect(second.interrupted?.options?.map((o) => o.label)).toEqual(['加入当前空间', '先不加入'])
    // 「是否加入空间」问的是这个表单，所以要把表单本身带出来（草稿跨 resume 还在）
    const art = second.interrupted?.artifact as any
    expect(art.schema.fields[0]).toMatchObject({ key: 'name', type: 'string' })
    expect(art.forms[0].key).toBe('f1')

    // 还没放行，所以 form_save 未执行
    expect(h.gateway.calls.map((c) => c.name)).toEqual(['form_assemble_schema'])

    const third = await resumeTurn(h, { action: 'continue' })
    expect(third.interrupted).toBeUndefined()
    const names = h.gateway.calls.map((c) => c.name)
    expect(names).toEqual(['form_assemble_schema', 'form_save'])
    expect(h.gateway.calls[1].confirmed).toBe(true) // 用户确认后走 executeConfirmed
    // token 注入仍然生效
    expect(h.gateway.calls[1].args.token).toBe('tok')
    expect(h.gateway.calls[1].args.workspaceId).toBe('w1')
  })

  it('用户在检查点选择中断：停止推进计划且不再调用工具', async () => {
    const h = buildHarness([
      { calls: [{ id: 'c1', name: 'form_assemble_schema', args: {} }] },
      { calls: [{ id: 'c2', name: 'form_preview', args: {} }] },
      { content: '不应该走到这里' },
    ])

    await runTurn(h, '创建客户登记表')
    const second = await resumeTurn(h, { action: 'abort' })

    expect(second.halted).toBe(true)
    expect(second.finalContent).toContain('中断')
    expect(h.gateway.calls.map((c) => c.name)).toEqual(['form_assemble_schema'])
  })

  it('跨领域：模板 + 流程 + 创建 → 三步计划依次交接', async () => {
    const h = buildHarness([
      { calls: [{ id: 'c1', name: 'template_search', args: { keyword: '请假' } }] },
      { calls: [{ id: 'c2', name: 'template_instantiate', args: {} }] },
      { content: '模板已实例化' },
      { calls: [{ id: 'c3', name: 'form_assemble_schema', args: {} }] },
      { content: '表单已完成' },
      { calls: [{ id: 'c4', name: 'flow_create', args: {} }] },
      { content: '流程已创建' },
    ])

    const r = await runTurn(h, '搜索请假模板，基于它创建表单并配一个审批流程')

    // 跨领域计划被识别，且第一步就是 template
    const route = h.events.find((e) => e.type === 'route')
    expect(route?.isCrossDomain).toBe(true)
    expect((route?.steps as any[]).map((s) => s.agent)).toEqual(['template', 'form-designer', 'workflow'])

    // template 步骤里 template_instantiate 前有检查点，会停下来问
    expect(r.interrupted?.checkpointId).toBe('instantiate-approval')
    expect(h.gateway.calls.map((c) => c.name)).toEqual(['template_search'])

    // 放行后 template 步骤跑完，产物交接给 form-designer；
    // 而 form-designer 自己也有 schema-review 检查点，于是在这里再次停下
    const afterTemplate = await resumeTurn(h, { action: 'continue' })
    expect(afterTemplate.interrupted?.checkpointId).toBe('schema-review')
    expect(h.gateway.calls.map((c) => c.name)).toEqual([
      'template_search',
      'template_instantiate',
      'form_assemble_schema',
    ])

    // 交接的证据：第 2 步拿到的指令里，带着第 1 步解析出来的模板 schema
    const formStep = h.llm.seen.find((msgs) => String(msgs[1]?.content ?? '').includes('[步骤 2]'))
    expect(formStep).toBeTruthy()
    expect(String(formStep![1].content)).toContain('"key":"days"')

    // 再放行，剩余的 form-designer 与 workflow 步骤一次跑完
    const afterForm = await resumeTurn(h, { action: 'continue' })
    expect(afterForm.interrupted).toBeUndefined()
    expect(h.gateway.calls.map((c) => c.name)).toEqual([
      'template_search',
      'template_instantiate',
      'form_assemble_schema',
      'flow_create',
    ])
    expect(afterForm.finalContent).toContain('流程已创建')

    // 三步都产出并登记了产物
    const agg = h.events.find((e) => e.type === 'aggregate')
    expect(agg?.artifactKeys).toEqual(['1', '2', '3'])
    expect((agg?.steps as any[]).map((s) => s.done)).toEqual([true, true, true])
  })

  it('resume 以本次请求的身份为准：建会话时 workspaceId 为空也能救回来', async () => {
    // 真实登录 JWT 只签 sub/email，workspaceId 靠前端 context 带；首次请求若落在
    // 还没拿到 wsId 的页面上，thread 就是在 workspaceId=空 的状态下建起来的。
    // resume 不带输入状态、一切从 checkpoint 恢复，所以身份必须由 resume 重新声明。
    const h = buildHarness([
      { calls: [{ id: 'c1', name: 'form_assemble_schema', args: {} }] },
      { calls: [{ id: 'c2', name: 'form_save', args: { name: '客户登记表' } }] },
      { content: '已保存' },
    ])

    const first = await runTurn(h, '创建客户登记表并保存', 'form-builder', '')
    expect(first.interrupted?.checkpointId).toBe('schema-review')

    // 第二轮开始用户已经在工作空间页面里了，身份字段能带全
    const second = await resumeTurn(h, { action: 'continue' }, 'w-fixed')
    expect(second.interrupted?.checkpointId).toBe('space-approval')

    const third = await resumeTurn(h, { action: 'continue' }, 'w-fixed')
    expect(third.interrupted).toBeUndefined()
    // 关键：form_save 拿到的是 resume 带上来的 wsId，而不是建会话时那个空值
    expect(h.gateway.calls.at(-1)!.name).toBe('form_save')
    expect(h.gateway.calls.at(-1)!.args.workspaceId).toBe('w-fixed')
  })

  it('高风险工具的业务检查点：报出真实风险等级，且不编造产物', async () => {
    // 用自定义 spec 验「在 catalog 里声明了业务检查点的高风险工具」，避免依赖
    // 任何具体 Agent 的声明——submission 已是纯只读，没有写检查点了。
    const h = buildHarness(
      [
        { calls: [{ id: 'c1', name: 'data_export', args: { formId: 'F1' } }] },
        { content: '已导出' },
      ],
      {
        catalogSpec: {
          key: 'submission',
          label: 'Submission Agent',
          scenario: 'data-analysis',
          toolNames: ['data_export'],
          serverTools: ['data_export'],
          maxIterations: 4,
          systemPrompt: () => 'submission',
          extractArtifact: () => null,
          checkpoints: [
            {
              id: 'export-approval',
              beforeTool: 'data_export',
              prompt: '要把这些数据导出吗？',
              options: [
                { value: 'continue', label: '继续', style: 'primary' },
                { value: 'abort', label: '中断', style: 'danger' },
              ],
              coversRisk: true,
            },
          ],
        },
      },
    )

    const first = await runTurn(h, '把这条记录导出', 'data-analysis')
    expect(first.interrupted?.checkpointId).toBe('export-approval')
    expect(first.interrupted?.tool).toBe('data_export')
    // 导出不可逆，用户必须看到真实风险等级（漏报或被默认成 'low' 都是误导）
    expect(first.interrupted?.risk).toBe('high')
    // 这一刻图里还没有产物，不能塞个空 artifact 让前端渲染空卡片
    expect(first.interrupted).not.toHaveProperty('artifact')
    // 还没放行，导出不能执行
    expect(h.gateway.calls).toHaveLength(0)
  })

  it('未声明业务检查点的中风险工具：走工具级风险确认门', async () => {
    // 造一个只有中风险工具、没有任何业务检查点的 Agent
    const h = buildHarness(
      [
        { calls: [{ id: 'c1', name: 'data_merge', args: { formId: 'F1' } }] },
        { content: '已合并' },
      ],
      {
        catalogSpec: {
          key: 'submission',
          label: 'Submission Agent',
          scenario: 'data-analysis',
          toolNames: ['data_merge'],
          serverTools: ['data_merge'],
          maxIterations: 4,
          systemPrompt: () => 'submission',
          extractArtifact: () => null,
          checkpoints: [],
        },
      },
    )

    const first = await runTurn(h, '合并 F1 的重复记录', 'data-analysis')
    expect(first.interrupted?.kind).toBe('tool_confirm')
    expect(first.interrupted?.tool).toBe('data_merge')
    expect(first.interrupted?.risk).toBe('medium')
    expect(h.gateway.calls).toHaveLength(0)

    const second = await resumeTurn(h, { action: 'confirm' })
    expect(second.interrupted).toBeUndefined()
    expect(h.gateway.calls.map((c) => c.name)).toEqual(['data_merge'])
    expect(h.gateway.calls[0].confirmed).toBe(true)
  })

  // ==================== 会话级表单工作台（多表） ====================
  //
  // 注意：本 harness 里「同一 thread 的第二次 run 之后再 resume」的 stream 不会关闭
  // （图其实已经跑到 END）。这是 vitest + 共享 checkpointer 连接池下的既有现象，
  // 真实栈上 run→resume→run→resume 实测正常返回（见 /mnt/d/agent-e2e/probe_second_resume.py）。
  // 因此多表用例都安排在同一轮内（同一 run 可以多次 resume），跨轮的注入语义由
  // tool-bridge.spec.ts 的目标注入单测覆盖。

  it('一轮内要求两张表：各自成套字段，第二张仍是新建（不混表）', async () => {
    const h = buildHarness([
      {
        calls: [
          { id: 'c1', name: 'form_assemble_schema', args: { target: '客户登记表', fields: [{ key: 'cust' }] } },
          { id: 'c2', name: 'form_assemble_schema', args: { target: '员工登记表', fields: [{ key: 'emp' }] } },
        ],
      },
      { content: '两张表都建好了。' },
    ])

    const first = await runTurn(h, '同时创建客户登记表和员工登记表')
    expect(first.interrupted?.checkpointId).toBe('schema-review')
    expect(first.interrupted?.toolCallId).toBe('c1')
    // c1 已执行，工作台登记了第一张
    expect((first.interrupted?.artifact as any)?.forms).toHaveLength(1)

    // 继续 → 执行 c1 → 立刻又撞上 c2 的检查点（每次产物都要人审，属预期）
    const second = await resumeTurn(h, { action: 'continue' })
    expect(second.interrupted?.checkpointId).toBe('schema-review')
    expect(second.interrupted?.toolCallId).toBe('c2')
    // c2 也已执行 → 工作台两张
    expect((second.interrupted?.artifact as any)?.forms).toHaveLength(2)

    await resumeTurn(h, { action: 'continue' })

    const assembleCalls = h.gateway.calls.filter((c) => c.name === 'form_assemble_schema')
    expect(assembleCalls).toHaveLength(2)
    // 两次都是「建新表」：都拿不到 existingSchema，两张各自独立
    // （旧代码会把第一张的 schema 无条件注入第二次 → 9 → 19 的混表）
    expect(assembleCalls[0].args.existingSchema).toBeUndefined()
    expect(assembleCalls[1].args.existingSchema).toBeUndefined()
  })

  it('同轮里保存表 A 再保存表 B：B 不带上 A 的 formId（修静默覆盖）', async () => {
    // 每批一次 think：真实链路里模型也是一步一步来的。同一批塞满 4 个调用会走
    // 「resume 后直接 act」的近路，跳过下一个调用自己的 beforeTool 检查点，与本用例无关。
    const h = buildHarness([
      { calls: [{ id: 'c1', name: 'form_assemble_schema', args: { target: '客户登记表', fields: [{ key: 'cust' }] } }] },
      { calls: [{ id: 'c2', name: 'form_save', args: { name: '客户登记表', target: '客户登记表' } }] },
      { calls: [{ id: 'c3', name: 'form_assemble_schema', args: { target: '员工登记表', fields: [{ key: 'emp' }] } }] },
      { calls: [{ id: 'c4', name: 'form_save', args: { name: '员工登记表', target: '员工登记表' } }] },
      { content: '两张表都保存好了。' },
    ])

    // 依次过 4 个检查点：schema-review(c1) → space-approval(c2) → schema-review(c3) → space-approval(c4)
    let r = await runTurn(h, '建客户登记表并保存，再建员工登记表并保存')
    for (let i = 0; i < 4; i++) {
      expect(r.interrupted, `第 ${i + 1} 次检查点`).toBeTruthy()
      r = await resumeTurn(h, { action: 'continue' })
    }
    expect(r.interrupted).toBeUndefined()

    const saves = h.gateway.calls.filter((c) => c.name === 'form_save')
    expect(saves).toHaveLength(2)
    // 旧代码把 savedFormId(=A 的 id) 无条件注入之后任何 form_save，导致 B 覆盖 A。
    // 现在只有解析到「已落库的那张表」才带 formId —— 两次都是新表，都不该带。
    expect(saves[0].args.formId).toBeUndefined()
    expect(saves[1].args.formId).toBeUndefined()
  })

  it('跨轮：第二轮的 system prompt 里带着上一轮的表清单', async () => {
    const h = buildHarness([
      { calls: [{ id: 'c1', name: 'form_assemble_schema', args: { target: '客户登记表', fields: [{ key: 'cust' }] } }] },
      { content: '客户登记表建好了。' },
      { calls: [{ id: 'c2', name: 'form_assemble_schema', args: { target: '员工登记表', fields: [{ key: 'emp' }] } }] },
      { content: '员工登记表也建好了。' },
    ])

    await runTurn(h, '创建一个客户登记表')
    await resumeTurn(h, { action: 'continue' })

    // 第二轮（新的 run）：模型在 think 之前就能从 system prompt 看到会话里已有的表
    const second = await runTurn(h, '再帮我做一个员工登记表')
    expect(second.interrupted?.checkpointId).toBe('schema-review')

    const lastMessages = h.llm.seen[h.llm.seen.length - 1]
    const system = String((lastMessages[0] as any).content)
    expect(system).toContain('共 1 张')
    expect(system).toContain('客户登记表')
    expect(system).toContain('target')
  })
})

describe('路由与计划（纯函数）', () => {
  const registry = new FakeRegistry() as any
  const catalog = new AgentCatalogService({ getAllMeta: () => [], loadFull: () => null } as any, registry)
  const router = new RouterService(catalog, {} as any)

  it('默认沿用当前页面身份', () => {
    const d = router.decideDeterministic('加一个手机号字段', { scenario: 'form-builder' })
    expect(d.agent).toBe('form-designer')
    expect(d.source).toBe('page')
    expect(d.isCrossDomain).toBe(false)
  })

  it('提示词强信号覆盖页面身份', () => {
    const d = router.decideDeterministic('帮我搜索客服工单模板', { scenario: 'form-builder' })
    expect(d.agent).toBe('template')
    expect(d.source).toBe('prompt')
  })

  it('任务页（/tasks、/my-tasks）默认身份给流程助手', () => {
    // DefaultLayout 把任务页归到 workflow-node；approval-assist 已永久下线，
    // 这两页不该再走到 form-designer 兜底上。
    expect(catalog.agentByScenario('workflow-node')).toBe('workflow')
    const d = router.decideDeterministic('看看我的待办', { scenario: 'workflow-node' })
    expect(d.agent).toBe('workflow')
    expect(d.source).toBe('page')
  })

  it('未知页面场景：落 form-designer 并告警（同一场景只喊一次）', () => {
    const warn = vi.spyOn((catalog as any).logger, 'warn').mockImplementation(() => {})
    expect(catalog.agentByScenario('brand-new-page')).toBe('form-designer')
    // 每次请求都会查一次身份，不能每个请求刷一条日志
    expect(catalog.agentByScenario('brand-new-page')).toBe('form-designer')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('brand-new-page')
    warn.mockRestore()
  })

  it('模板+流程+创建 生成三步跨领域计划', () => {
    const d = router.decideDeterministic('搜索请假模板，基于它创建表单并配一个审批流程', {
      scenario: 'form-builder',
    })
    expect(d.isCrossDomain).toBe(true)
    expect(d.plan?.steps.map((s) => s.agent)).toEqual(['template', 'form-designer', 'workflow'])
    expect(d.plan?.steps[1].input.templateRef).toBe('$1.schema')
  })

  it('$1.schema 这类引用能解析到上游产物', () => {
    const plan = new PlanService()
    const artifacts = { '1': { type: 'TemplateArtifact', data: { schema: { fields: [1, 2] } } } }
    const ref = plan.resolveRef('$1.schema', artifacts)
    expect(ref).toEqual({ fields: [1, 2] })
    expect(plan.resolveRef('$2.schema', artifacts)).toBeNull()
  })

  it('有歧义时才问 LLM，且 LLM 的跨领域结论能覆盖确定性结论', async () => {
    const llm = {
      chat: {
        invoke: async () => ({
          content:
            '{"isCrossDomain":true,"targetAgent":"template","reason":"先取模板再配流程","steps":[{"agent":"template"},{"agent":"workflow"}]}',
        }),
      },
    } as any
    const router = new RouterService(catalog, llm)

    // 页面是 form-builder，但「审批」是 workflow 的弱信号 → 有歧义 → 交给 LLM
    const d = await router.decide('帮我处理审批', { scenario: 'form-builder' })
    expect(d.source).toBe('llm')
    expect(d.isCrossDomain).toBe(true)
    expect(d.plan?.steps.map((s) => s.agent)).toEqual(['template', 'workflow'])
  })

  it('LLM 路由失败时回退到确定性结论', async () => {
    const llm = {
      chat: {
        invoke: async () => {
          throw new Error('boom')
        },
      },
    } as any
    const router = new RouterService(catalog, llm)

    const d = await router.decide('帮我处理审批', { scenario: 'form-builder' })
    expect(d.agent).toBe('form-designer')
    expect(d.source).toBe('page')
  })

  // ==================== 错误恢复（对齐 legacy base.agent 的四级级联）====================

  it('同一工具连续失败超过重试上限后，回给模型的是「换方案」提示而不是原始失败', async () => {
    const h = buildHarness(
      [
        { calls: [{ id: 'c1', name: 'data_query', args: {} }] },
        { calls: [{ id: 'c2', name: 'data_query', args: {} }] },
        { calls: [{ id: 'c3', name: 'data_query', args: {} }] },
        { content: '换个方式再查' },
      ],
      { catalogSpec: submissionSpec(['data_query']) },
    )
    h.gateway.failTools.add('data_query')

    const result = await runTurn(h, '查一下本月数据', 'data-analysis')

    // MAX_RETRIES=2：前两次失败原样回灌让模型自己修正，第三次越过上限才改成 [DEGRADE]
    expect(toolContentsOf(h.llm.seen[2]).some((c) => c.startsWith('[DEGRADE]'))).toBe(false)
    expect(toolContentsOf(h.llm.seen[3]).some((c) => c.startsWith('[DEGRADE]'))).toBe(true)
    // 只有一次降级，没到 MAX_DEGRADE=1 的上限 → 本轮正常收尾，不该被截断
    expect(result.halted).toBe(false)
    expect(result.interrupted).toBeUndefined()
  })

  it('失败一次后成功，不触发降级也不上报 DEGRADE', async () => {
    const h = buildHarness(
      [
        { calls: [{ id: 'c1', name: 'data_query', args: {} }] },
        { calls: [{ id: 'c2', name: 'data_query', args: {} }] },
        { calls: [{ id: 'c3', name: 'data_query', args: {} }] },
        { content: '查到了' },
      ],
      { catalogSpec: submissionSpec(['data_query']) },
    )
    // 只有第 2 次失败：失败计数 = 1，远没到上限
    const original = h.gateway.execute.bind(h.gateway)
    let n = 0
    h.gateway.execute = async (name: string, args: Record<string, unknown>) => {
      n++
      if (n === 2) return { ok: false, summary: 'data_query failed', error: 'execution_error' }
      return original(name, args)
    }

    const result = await runTurn(h, '查一下本月数据', 'data-analysis')

    expect(result.halted).toBe(false)
    expect(h.events.some((e) => e.type === 'error' && e.code === 'DEGRADE')).toBe(false)
  })

  it('多个工具都降到谷底时收尾：走 gaveUp，且不再下发 FALLBACK 错误事件', async () => {
    const fail = (id: string, name: string) => ({ calls: [{ id, name, args: {} }] })
    const h = buildHarness(
      [
        fail('c1', 'data_query'),
        fail('c2', 'data_query'),
        fail('c3', 'data_query'),
        fail('c4', 'data_list_forms'),
        fail('c5', 'data_list_forms'),
        fail('c6', 'data_list_forms'),
        { content: '还是不行' },
      ],
      { catalogSpec: submissionSpec(['data_query', 'data_list_forms'], 12) },
    )
    h.gateway.failTools.add('data_query')
    h.gateway.failTools.add('data_list_forms')

    const result = await runTurn(h, '查一下本月数据', 'data-analysis')

    // data_query 降级 1 次、data_list_forms 又降级 1 次 → 超过 MAX_DEGRADE=1 → 放弃本轮
    expect(result.gaveUp).toBe(true)
    // 放弃是「系统做不到」，不是用户叫停：halted 必须保持 false，两者不能混
    expect(result.halted).toBe(false)
    expect(result.finalContent).toContain('多次尝试')
    // 放弃不再下发终态 error：同一句「我做不到」不该既是红 banner 又是助手气泡。
    // 对外改由 done.stopReason='giveup' 表达（见 langgraph-turn 的用例）。
    expect(h.events.some((e) => e.type === 'error')).toBe(false)
    // 放弃后不该再继续打没有意义的调用
    expect(h.gateway.calls).toHaveLength(6)
  })

  it('上一轮攒下的失败额度不带进下一轮：换个说法重试仍有完整重试机会', async () => {
    // 同一 thread 跑两轮。第一轮把 data_query 错满 3 次（degradeCount 到 1，触及上限
    // 但未越过），第二轮再错 1 次 —— 若 toolErrors 跨轮残留，这第 4 次会被算成
    // 「已连续失败 4 次」，模型第一次失败就直接吃 [DEGRADE]，白丢两次自修机会。
    const h = buildHarness(
      [
        { calls: [{ id: 'c1', name: 'data_query', args: {} }] },
        { calls: [{ id: 'c2', name: 'data_query', args: {} }] },
        { calls: [{ id: 'c3', name: 'data_query', args: {} }] },
        { content: '第一轮结束' },
        { calls: [{ id: 'c4', name: 'data_query', args: {} }] },
        { content: '第二轮结束' },
      ],
      { catalogSpec: submissionSpec(['data_query']) },
    )
    h.gateway.failTools.add('data_query')

    await runTurn(h, '查一下本月数据', 'data-analysis')
    const second = await runTurn(h, '换个说法再查一次', 'data-analysis')

    // 先证明这套脚本确实能产生 [DEGRADE]（第一轮第 3 次失败后的那次 think）
    expect(toolContentsOf(h.llm.seen[3]).some((c) => c.startsWith('[DEGRADE]'))).toBe(true)
    // 第二轮第 1 次失败（seen[5]）回灌的必须是原始失败，让模型自己改
    const fedBack = toolContentsOf(h.llm.seen[5])
    expect(fedBack.some((c) => c.startsWith('[DEGRADE]'))).toBe(false)
    expect(fedBack[0]).toContain('"ok":false')
    expect(second.gaveUp).toBe(false)
    expect(second.halted).toBe(false)
  })

  it('单个工具从头坏到尾满 6 次也会收尾，不必等轮次用尽兜底', async () => {
    const fail = (id: string) => ({ calls: [{ id, name: 'data_query', args: {} }] })
    const h = buildHarness(
      [fail('c1'), fail('c2'), fail('c3'), fail('c4'), fail('c5'), fail('c6'), { content: '还是不行' }],
      // 轮次给足：这里要验的是「工具连续失败」这条出口，不是 MAX_ITERATIONS 兜底
      { catalogSpec: submissionSpec(['data_query'], 12) },
    )
    h.gateway.failTools.add('data_query')

    const result = await runTurn(h, '查一下本月数据', 'data-analysis')

    // 第 3 次失败降级 1 次、第 6 次再降级 1 次 → 越过 MAX_DEGRADE=1 → 放弃。
    // 旧实现里这里走不到：degradeCount 会卡在 1，只能靠 maxIterations 给别的文案。
    expect(result.gaveUp).toBe(true)
    expect(result.finalContent).toContain('多次尝试')
    expect(h.gateway.calls).toHaveLength(6)
  })

  it('轮次用尽与工具反复失败走同一个放弃出口', async () => {
    // 工具不失败：不靠失败额度，纯验 MAX_ITERATIONS 兜底也置 gaveUp
    const h = buildHarness(
      [
        { calls: [{ id: 'c1', name: 'data_query', args: {} }] },
        { calls: [{ id: 'c2', name: 'data_query', args: {} }] },
        { content: '第三轮不该被调用' },
      ],
      { catalogSpec: submissionSpec(['data_query'], 2) },
    )

    const result = await runTurn(h, '查一下本月数据', 'data-analysis')

    expect(result.gaveUp).toBe(true)
    // 与用户中断区分开：轮次用尽不是 halted
    expect(result.halted).toBe(false)
    expect(result.finalContent).toContain('已经尝试了 2 轮')
  })

  it('多步计划第一步就放弃：后续步骤不再执行，产物不登记', async () => {
    // 旧实现里放弃被当成「正常完成」，planAdvance 会把这个步骤记成 done、游标前推，
    // 于是多步计划带着缺失的产物继续空跑后面的步骤。
    const fail = (id: string) => ({ calls: [{ id, name: 'template_search', args: { keyword: '请假' } }] })
    const h = buildHarness([
      fail('c1'),
      fail('c2'),
      fail('c3'),
      fail('c4'),
      fail('c5'),
      fail('c6'),
      { content: '还是不行' },
    ])
    h.gateway.failTools.add('template_search')

    const r = await runTurn(h, '搜索请假模板，基于它创建表单并配一个审批流程')

    const route = h.events.find((e) => e.type === 'route')
    expect(route?.isCrossDomain).toBe(true)

    expect(r.gaveUp).toBe(true)
    expect(r.interrupted).toBeUndefined()
    // 只有第一步的工具被打过；form-designer / workflow 的工具一次都没出现
    expect(h.gateway.calls).toHaveLength(6)
    expect(h.gateway.calls.every((c) => c.name === 'template_search')).toBe(true)

    const agg = h.events.find((e) => e.type === 'aggregate')
    expect(agg?.gaveUp).toBe(true)
    expect((agg?.steps as any[]).map((s) => s.done)).toEqual([false, false, false])
    expect(agg?.artifactKeys).toEqual([])
  })
})
