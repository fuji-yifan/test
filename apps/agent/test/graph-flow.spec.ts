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
import { createConnection, createPool, type Pool } from 'mysql2/promise'
import { AgentCatalogService } from '../src/modules/graph/agent-catalog'
import { RouterService } from '../src/modules/graph/router.service'
import { PlanService } from '../src/modules/graph/plan.service'
import { MysqlCheckpointSaver } from '../src/modules/graph/mysql-checkpoint-saver'
import { MysqlExecutor } from '../src/modules/graph/sql-executor'
import { FakeRegistry } from './harness/fakes'
import { createBuildHarness, submissionSpec, toolContentsOf, runTurn, resumeTurn } from './harness/harness'

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

// saver 在 beforeAll 里才建好，用闭包延迟取值；harness 本体与 eval 共用
const buildHarness = createBuildHarness(() => saver)

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

  it('模板没搜到结果：跳过落库步骤，不凭空造表', async () => {
    // FakeGateway 没有 template_search 的 payload → 回 {ok:true}（没有 templates），
    // 等价于「模板市场暂无相关模板」。这时第二步的 $1.schema 解析为空，整步跳过：
    // 绝不能让表单设计助手拿着空引用自己造一张跟请求无关的表。
    const h = buildHarness([
      { calls: [{ id: 'c1', name: 'template_search', args: { keyword: '客户' } }] },
      { content: '模板市场暂无相关模板' },
    ])

    const r = await runTurn(h, '寻找客户相关表单', 'template-creator')

    // 模板请求被扩成两步：模板 Agent 没有 form_save，落库得靠表单设计助手
    const route = h.events.find((e) => e.type === 'route')
    expect((route?.steps as any[]).map((s) => s.agent)).toEqual(['template', 'form-designer'])

    expect(r.interrupted).toBeUndefined()
    expect(r.finalContent).toContain('暂无相关模板')
    // 只搜了一次；表单设计助手一步没跑，更没碰 form_save
    expect(h.gateway.calls.map((c) => c.name)).toEqual(['template_search'])

    const agg = h.events.find((e) => e.type === 'aggregate')
    expect(agg?.artifactKeys).toEqual([])
    // 跳过的步骤也记成已完成，收敛报告才不会显示成「漏做了一步」
    expect((agg?.steps as any[]).map((s) => s.done)).toEqual([true, true])
  })

  it('上一轮的模板草稿不能替这一轮的落库步骤开路', async () => {
    // 跨轮残留的坑：drafts 是 merge 语义、跨轮从 checkpoint 恢复，所以
    // 「某个 Agent 有草稿」不等于「它这一轮产出过」。第二轮没搜到东西时，
    // 第一步登记的产物会从上一轮的模板草稿里拿到值 → 第二步照样跑起来，
    // 于是「搜索 xyzabc123 模板」也真的建出一张表（真机 T2 实测踩到）。
    const h = buildHarness([
      // 第一轮：搜到模板 → 实例化（落一份 TemplateArtifact 草稿）→ 设计助手接手组装
      { calls: [{ id: 'c1', name: 'template_search', args: { keyword: '请假' } }] },
      { calls: [{ id: 'c2', name: 'template_instantiate', args: {} }] },
      { content: '已按模板准备好表单结构' },
      { calls: [{ id: 'c3', name: 'form_assemble_schema', args: {} }] },
      // 第二轮：模板市场无结果
      { calls: [{ id: 'c4', name: 'template_search', args: { keyword: 'xyzabc123' } }] },
      { content: '模板市场暂无相关模板' },
      // 下面两条只有在「第二步被错误地执行」时才消费得到
      { calls: [{ id: 'c5', name: 'form_assemble_schema', args: {} }] },
      { content: '我已经帮你建好了' },
    ])

    const first = await runTurn(h, '搜索请假模板', 'template-creator')
    expect(first.interrupted?.checkpointId).toBe('instantiate-approval')
    const afterInstantiate = await resumeTurn(h, { action: 'continue' })
    expect(afterInstantiate.interrupted?.checkpointId).toBe('schema-review')
    // 用户在检查点上改主意、直接发下一条（生产里由 turn service 先 resume(abort) 收尾）
    await resumeTurn(h, { action: 'abort' })
    expect(h.gateway.calls.map((c) => c.name)).toEqual([
      'template_search',
      'template_instantiate',
      'form_assemble_schema',
    ])

    const second = await runTurn(h, '搜索 xyzabc123 模板', 'template-creator')
    expect(second.interrupted).toBeUndefined()
    expect(second.finalContent).toContain('暂无相关模板')
    // 这一轮的 template_search 一个模板都没搜到 → 落库步骤必须跳过，
    // 绝不能拿上一轮的模板草稿当输入
    expect(h.gateway.calls.map((c) => c.name)).toEqual([
      'template_search',
      'template_instantiate',
      'form_assemble_schema',
      'template_search',
    ])
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

  it('重名消歧（5.2）：目标命中多张同名表先弹候选，选完再执行（form_save 也不例外）', async () => {
    const h = buildHarness([
      { calls: [{ id: 'c1', name: 'form_assemble_schema', args: { target: '客户登记表', fields: [{ key: 'a' }] } }] },
      { calls: [{ id: 'c2', name: 'form_assemble_schema', args: { target: '员工登记表', fields: [{ key: 'b' }] } }] },
      { calls: [{ id: 'c3', name: 'form_save', args: { name: '登记表', target: '登记表' } }] },
      { content: '保存好了。' },
    ])

    // 两张表各自过 schema-review
    let r = await runTurn(h, '建两张表再保存')
    expect(r.interrupted?.checkpointId).toBe('schema-review')
    r = await resumeTurn(h, { action: 'continue' })
    expect(r.interrupted?.checkpointId).toBe('schema-review')

    // 第三问：form_save 的 target『登记表』同时命中两张 → 必须消歧。
    // （旧实现把消歧放在 beforeTool 检查点之后，检查点答完 gate 直接 act → 永远问不到，
    //  会静默写到 keys[0]，即错的表。）
    r = await resumeTurn(h, { action: 'continue' })
    expect(r.interrupted?.kind).toBe('disambiguate')
    const opts = (r.interrupted?.options ?? []) as any[]
    expect(opts.map((o) => o.value)).toEqual(['f1', 'f2'])
    expect(String(r.interrupted?.prompt)).toContain('2 张')

    // 选中 f2 → 改写 target 后执行；消歧那一步已合并放行保存确认，故不再多弹一次
    r = await resumeTurn(h, { action: 'f2' })
    expect(r.interrupted).toBeUndefined()

    const saves = h.gateway.calls.filter((c) => c.name === 'form_save')
    expect(saves).toHaveLength(1)
    // target 已被改写成用户选的那张 key
    expect(saves[0].args.target).toBe('f2')
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

  it('会话记忆：数据分析里补一句「教职工信息表单」仍落 submission，且子 Agent 看到状态栏', async () => {
    const h = buildHarness([
      { content: '要分析哪张表的数据？' },
      { content: '好的，我来分析教职工信息表单。' },
    ])

    // 第一轮：数据分析页提问收尾 → 记为 pendingClarification（本对话目标 = 首轮消息）
    const first = await runTurn(h, '分析本月提交数据', 'data-analysis')
    expect(first.finalContent).toContain('？')

    // 第二轮：用户只回一个片段「教职工信息表单」，不该被 form-designer 的弱信号改判
    const second = await runTurn(h, '教职工信息表单', 'data-analysis')
    const route = h.events.find((e) => e.type === 'route')
    expect(route?.agent).toBe('submission')
    expect(second.interrupted).toBeUndefined()

    // 子 Agent 的上下文末尾带上了 <agent_status> 状态栏（含首轮目标）
    const last = h.llm.seen[h.llm.seen.length - 1]
    const bar = last.find((m) => String((m as any).content).includes('<agent_status>'))
    expect(bar).toBeTruthy()
    expect(String((bar as any).content)).toContain('分析本月提交数据')
  })

  it('长会话：多轮之后仍带首轮目标（L1）与近期窗口（L3）', async () => {
    const script = Array.from({ length: 12 }, (_, i) => ({ content: `第${i + 1}轮答复。` }))
    const h = buildHarness(script)

    for (let i = 0; i < 10; i++) {
      await runTurn(h, `第${i + 1}个问题`, 'data-analysis')
    }

    const lastMessages = h.llm.seen[h.llm.seen.length - 1]
    const mem = lastMessages.find((m) => String((m as any).content).includes('<agent_status>'))
    expect(mem).toBeTruthy()
    const text = String((mem as any).content)
    // L1：首轮目标不随轮次丢失
    expect(text).toContain('本对话目标: 第1个问题')
    // L3：近期窗口带上了前面几轮原文（窗口上限 6 条 → 至少含第 9 轮）
    expect(text).toContain('<recent_context>')
    expect(text).toContain('第9个问题')
  })

  it('跨 Agent：换 Agent 后新 Agent 仍看到同一份会话记忆（首轮目标）', async () => {
    const h = buildHarness([
      { content: '要分析哪张表的数据？' },
      { content: '好的，我来创建三级审批流程。' },
    ])

    await runTurn(h, '分析本月提交数据', 'data-analysis')
    await runTurn(h, '创建一个三级审批流程', 'data-analysis')

    // 强信号把领域从 submission 切到 workflow
    const route = h.events.find((e) => e.type === 'route')
    expect(route?.agent).toBe('workflow')

    // workflow 子 Agent 的上下文里有同一份记忆块（含首轮目标）——换 Agent 不必重问已知信息
    const lastMessages = h.llm.seen[h.llm.seen.length - 1]
    const mem = lastMessages.find((m) => String((m as any).content).includes('<agent_status>'))
    expect(String((mem as any).content)).toContain('分析本月提交数据')
  })

  // ==================== §2.12 会话上下文治理（端到端接线） ====================

  // 从「本轮最后一次 think 收到的上下文」里取注入的记忆块文本（末尾那条 user 消息）
  function memoryBlockOf(h: Harness): string {
    const last = h.llm.seen[h.llm.seen.length - 1]
    const mem = last.find((m) => String((m as any).content).includes('<agent_status>'))
    return String((mem as any).content)
  }

  it('§2.12 Ledger：第二轮记忆块渲染上一轮的「会话进展」（已答复）', async () => {
    const h = buildHarness([{ content: '本月提交已分析完成。' }, { content: '好的，已再次核对。' }])

    await runTurn(h, '分析本月提交数据', 'data-analysis')
    await runTurn(h, '分析本月提交数据', 'data-analysis')

    // 第二轮 prepare 时，Ledger 里上一轮已定稿为 answered → 渲染进 <session_progress>
    const block = memoryBlockOf(h)
    expect(block).toContain('<session_progress>')
    expect(block).toContain('- submission: 分析本月提交数据 → 已答复')
    // 本轮（pending）也在台账里，但只以「进行中」出现，不误报已答复
    expect(block).toContain('→ 进行中')
  })

  it('§2.12 Facts：跨 Agent 后仍看得到上一棒产出的领域事实', async () => {
    const h = buildHarness([
      { calls: [{ id: 'c1', name: 'flow_create', args: { name: '三级审批', nodes: [{ id: 'n1' }] } }] },
      { content: '流程已创建。' },
      { content: '好的，我来建表。' },
    ])

    // 第一轮：workflow 建流程 → flow_create 回填 sessionFacts.workflow
    await runTurn(h, '创建一个三级审批流程', 'workflow-node')
    expect(memoryBlockOf(h)).not.toContain('<session_facts>') // 首轮尚未有事实（本轮才产出）

    // 第二轮：换回表单页 → form-designer 的记忆块里仍带 workflow 的事实（跨 Agent 交接）
    await runTurn(h, '再帮我建一张客户表', 'form-builder')
    const block = memoryBlockOf(h)
    expect(block).toContain('<session_facts>')
    expect(block).toContain('- workflow: nodes=1')
  })

  it('§2.12 D5：目标跳过寒暄，取首个实质消息（存全文）', async () => {
    const h = buildHarness([{ content: '你好，有什么可以帮你？' }, { content: '本月提交已分析完成。' }])

    // 首轮是纯寒暄 → 不占用目标
    await runTurn(h, '你好', 'data-analysis')
    expect(memoryBlockOf(h)).not.toContain('本对话目标')

    // 次轮是实质请求 → 目标落在它身上
    await runTurn(h, '分析本月提交数据', 'data-analysis')
    expect(memoryBlockOf(h)).toContain('本对话目标: 分析本月提交数据')
  })

  it('§2.12 D3：短会话零摘要；长会话预算溢出才触发 L2 摘要', async () => {
    // 每轮回复较长 + 中等预算：长会话必然溢出，且投影仍留有空间放摘要。
    // （预算过小 —— 如 60 token —— 会让状态栏 + 领域事实 + 进展台账先吃光预算，摘要段被饿死；
    //   那是 §2.12-D3 优先级（事实/台账 > 摘要）的预期结果，不是本用例要测的「触发」行为。）
    const turnReply =
      '本轮数据分析已完成。整体趋势保持平稳，各项指标处于正常区间，未发现明显异常，暂无需特别关注。'
    const h = buildHarness([{ content: turnReply }], { config: { 'context.memoryBudgetTokens': 300 } })
    // 路由/摘要共用 chat 通道；让摘要返回可断言的文本（非 JSON → 路由解析失败会稳妥回退确定性结论）
    ;(h.llm as any).chat = { invoke: async () => ({ content: '早前对话摘要。' }) }

    // 短会话：两轮远未溢出 → 不产生摘要
    await runTurn(h, '第一轮分析数据', 'data-analysis')
    await runTurn(h, '第二轮分析数据', 'data-analysis')
    expect(memoryBlockOf(h)).not.toContain('<conversation_summary>')

    // 长会话：继续跑，窗口溢出 → 最旧几轮压进 L2 摘要并注入记忆块
    for (let i = 3; i <= 12; i++) await runTurn(h, `第${i}轮分析这批提交数据`, 'data-analysis')
    const block = memoryBlockOf(h)
    expect(block).toContain('<conversation_summary>')
    expect(block).toContain('早前对话摘要。')
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

  it('单步模板请求补上表单设计助手落库（模板 Agent 没有 form_save）', () => {
    // 模板市场页上「寻找客户相关表单」：页面身份就是 template，
    // 但模板 Agent 只会拼 schema、不会落库，所以要扩成两步。
    const d = router.decideDeterministic('寻找客户相关表单', { scenario: 'template-creator' })
    expect(d.agent).toBe('template')
    expect(d.isCrossDomain).toBe(true)
    expect(d.plan?.steps.map((s) => s.agent)).toEqual(['template', 'form-designer'])
    expect(d.plan?.steps[1].input.templateRef).toBe('$1.schema')

    // 其他领域不受影响：落库步骤只加给模板
    const other = router.decideDeterministic('创建一个客户登记表', { scenario: 'form-builder' })
    expect(other.plan).toBeUndefined()
  })

  it('$1.schema 这类引用能解析到上游产物', () => {
    const plan = new PlanService()
    const artifacts = { '1': { type: 'TemplateArtifact', data: { schema: { fields: [1, 2] } } } }
    const ref = plan.resolveRef('$1.schema', artifacts)
    expect(ref).toEqual({ fields: [1, 2] })
    expect(plan.resolveRef('$2.schema', artifacts)).toBeNull()
  })

  it('hasUnresolvedRefs：引用全解析不到才算缺产物', () => {
    const plan = new PlanService()
    const step: any = { id: '2', agent: 'form-designer', input: { templateRef: '$1.schema' } }
    // 上游一步没登记产物 → 引用全空 → 该跳过
    expect(plan.hasUnresolvedRefs(step, {})).toBe(true)
    // 解析出来了就不跳过
    expect(
      plan.hasUnresolvedRefs(step, { '1': { type: 'TemplateArtifact', data: { schema: { fields: [] } } } }),
    ).toBe(false)
    // 没有引用的步骤永远不算缺产物（常量 input 不该被当成断链）
    expect(plan.hasUnresolvedRefs({ id: '1', input: { query: '客户' } } as any, {})).toBe(false)
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

  it('pendingClarification 存在且无强信号 → 直接沿用该领域，不调 LLM', async () => {
    const llm = {
      chat: {
        invoke: async () => {
          throw new Error('有 pendingClarification 时不该调用 LLM')
        },
      },
    } as any
    const router = new RouterService(catalog, llm)

    const d = await router.decide('教职工信息表单', { scenario: 'data-analysis' }, {
      priorAgent: 'submission',
      pendingClarification: { agent: 'submission', question: '要分析哪张表？' },
    })
    expect(d.agent).toBe('submission')
    expect(d.source).toBe('prompt')
    expect(d.reason).toContain('等待回答')
  })

  it('pendingClarification 存在但消息命中别的领域强信号 → 仍按强信号换领域', async () => {
    const router = new RouterService(catalog, {} as any)
    const d = await router.decide('创建一个三级审批流程', { scenario: 'data-analysis' }, {
      priorAgent: 'submission',
      pendingClarification: { agent: 'submission', question: '要分析哪张表？' },
    })
    expect(d.agent).toBe('workflow')
  })

  it('没有 pendingClarification 时行为不变（沿用页面/priorAgent）', async () => {
    const router = new RouterService(catalog, {} as any)
    const d = await router.decide('加一个手机号字段', { scenario: 'form-builder' }, {
      priorAgent: 'form-designer',
      pendingClarification: null,
    })
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
