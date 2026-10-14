import { describe, it, expect } from 'vitest'
import {
  buildStateBar,
  projectMemory,
  normalizeAsk,
  buildRepeatNotice,
  deriveGoal,
  isSmallTalk,
  turnsToSummarize,
  detectClarification,
} from '../src/modules/graph/conversation-state'

describe('buildStateBar — 会话状态栏纯函数', () => {
  it('空会话 → 返回空串（调用方据此不注入）', () => {
    expect(buildStateBar({})).toBe('')
    expect(buildStateBar({ activeSubAgent: null, conversationGoal: '', pendingClarification: null })).toBe('')
  })

  it('单轮完成 → 含「领域」「本对话目标」，并包在 <agent_status> 内', () => {
    const bar = buildStateBar({ activeSubAgent: 'form-designer', conversationGoal: '创建客户登记表' })
    expect(bar).toContain('<agent_status>')
    expect(bar).toContain('</agent_status>')
    expect(bar).toContain('领域: form-designer')
    expect(bar).toContain('本对话目标: 创建客户登记表')
  })

  it('等待用户 → 含「以提问收尾」与「阶段: waiting_user」', () => {
    const bar = buildStateBar({
      activeSubAgent: 'submission',
      conversationGoal: '分析本月提交',
      pendingClarification: { agent: 'submission', question: '要分析哪张表？' },
      lastOutcome: 'waiting_user',
    })
    expect(bar).toContain('上一轮: submission 以提问收尾，正在等待回答')
    expect(bar).toContain('要分析哪张表？')
    expect(bar).toContain('阶段: waiting_user')
  })

  it('目标超长 → 截断到 ≤ 120 字并加 …（§2.4-D4 由 60 放宽）', () => {
    const goal = '创'.repeat(200)
    const bar = buildStateBar({ conversationGoal: goal })
    expect(bar).toContain(`本对话目标: ${'创'.repeat(120)}…`)
  })

  it('多行/多余空白的目标被折成单行', () => {
    const bar = buildStateBar({ conversationGoal: '创建   客户\n登记表' })
    expect(bar).toContain('本对话目标: 创建 客户 登记表')
  })
})

describe('projectMemory — 会话上下文统一投影', () => {
  it('全空 → 空串', () => {
    expect(projectMemory({ l1: {} })).toBe('')
  })

  it('只有 L1 → 只含状态栏，不含摘要/近期窗口段', () => {
    const block = projectMemory({ l1: { activeSubAgent: 'form-designer', conversationGoal: '建客户表' } })
    expect(block).toContain('<agent_status>')
    expect(block).not.toContain('<conversation_summary>')
    expect(block).not.toContain('<recent_context>')
  })

  it('带 L2 摘要 → 含 <conversation_summary>', () => {
    const block = projectMemory({ l1: { conversationGoal: '建客户表' }, summary: '用户希望建一张客户登记表' })
    expect(block).toContain('<conversation_summary>')
    expect(block).toContain('用户希望建一张客户登记表')
  })

  it('带 L3 近期窗口 → 含 <recent_context> 与按角色标注的行', () => {
    const block = projectMemory({
      l1: {},
      recent: [
        { role: 'user', content: '分析本月数据' },
        { role: 'assistant', content: '要分析哪张表？' },
      ],
    })
    expect(block).toContain('<recent_context>')
    expect(block).toContain('- user: 分析本月数据')
    expect(block).toContain('- assistant: 要分析哪张表？')
  })

  it('近期窗口里的空内容被过滤；顺序为 L1 → L2 → L3', () => {
    const block = projectMemory({
      l1: { activeSubAgent: 'submission' },
      summary: 'S',
      recent: [{ role: 'user', content: '   ' }, { role: 'user', content: 'Q' }],
    })
    expect(block).toContain('- user: Q')
    expect(block.match(/- user:/g)?.length).toBe(1)
    expect(block.indexOf('<agent_status>')).toBeLessThan(block.indexOf('<conversation_summary>'))
    expect(block.indexOf('<conversation_summary>')).toBeLessThan(block.indexOf('<recent_context>'))
  })

  it('带 Ledger → 渲染 <session_progress>，含 agent/结局标签/产物', () => {
    const block = projectMemory({
      l1: {},
      ledger: [
        { normAsk: '建表', ask: '建一张客户表', agent: 'form-designer', outcome: 'artifact', produced: ['1'] },
        { normAsk: '分析', ask: '分析本月提交', agent: 'submission', outcome: 'waiting' },
      ],
    })
    expect(block).toContain('<session_progress>')
    expect(block).toContain('- form-designer: 建一张客户表 → 已产出（1）')
    expect(block).toContain('- submission: 分析本月提交 → 待你回答')
  })

  it('Ledger 空 ask 被过滤；进度段在状态栏之后', () => {
    const block = projectMemory({
      l1: { conversationGoal: '目标X' },
      ledger: [{ normAsk: '', ask: '   ', agent: 'workflow', outcome: 'answered' }],
    })
    expect(block).not.toContain('<session_progress>')
    expect(block).toContain('<agent_status>')
  })

  it('token 预算很小时，近期窗口被截断而非整段注入', () => {
    const big = 'x'.repeat(3000)
    const block = projectMemory(
      { l1: {}, recent: [{ role: 'user', content: big }, { role: 'assistant', content: 'ok' }] },
      { budgetTokens: 50 },
    )
    expect(block).toContain('<recent_context>')
    // 预算 50 tokens ≈ 100 字符，远小于 3000，必须被截断
    expect(block.length).toBeLessThan(1000)
  })

  it('repeatNotice 默认关；开启且命中重复时注入 <repeat_notice>', () => {
    const ledger = [
      { normAsk: '分析教职工信息登记表', ask: '分析教职工信息登记表', agent: 'submission', outcome: 'answered' },
      { normAsk: '分析教职工信息登记表', ask: '分析教职工信息登记表', agent: 'submission', outcome: 'pending' },
    ] as const
    expect(projectMemory({ l1: {}, ledger: [...ledger] })).not.toContain('<repeat_notice>')
    const on = projectMemory({ l1: {}, ledger: [...ledger] }, { repeatNotice: true })
    expect(on).toContain('<repeat_notice>')
  })

  it('领域事实 → 渲染 <session_facts>，只列标量（对象/数组被跳过）', () => {
    const block = projectMemory({
      l1: {},
      facts: {
        workflow: { workflowName: '请假审批', nodes: 4, draft: { huge: true } },
        template: { templateCount: 3, tags: ['a', 'b'] },
      },
    })
    expect(block).toContain('<session_facts>')
    expect(block).toContain('- workflow: workflowName=请假审批 / nodes=4')
    expect(block).toContain('- template: templateCount=3')
    expect(block).not.toContain('huge')
    expect(block).not.toContain('tags=')
  })

  it('事实全为空标量 → 不渲染该段', () => {
    const block = projectMemory({ l1: { conversationGoal: 'G' }, facts: { submission: { x: undefined, y: '' } } })
    expect(block).not.toContain('<session_facts>')
  })

  it('用户长期记忆 → 渲染 <user_memory>，跳过空值/软删', () => {
    const block = projectMemory({
      l1: {},
      userMemory: [
        { id: '1', userId: 'u', workspaceId: 'w', kind: 'preference', key: '语言', value: '中文', confidence: 0.9 },
        { id: '2', userId: 'u', workspaceId: 'w', kind: 'identity', key: '公司', value: '', confidence: 0.5 },
        { id: '3', userId: 'u', workspaceId: 'w', kind: 'entity', key: '旧', value: 'x', confidence: 0.5, state: 'forgotten' },
      ],
    })
    expect(block).toContain('<user_memory>')
    expect(block).toContain('- preference: 语言 = 中文')
    expect(block).not.toContain('公司')
    expect(block).not.toContain('旧')
  })

  it('无长期记忆 → 不渲染该段', () => {
    const block = projectMemory({ l1: { conversationGoal: 'G' }, userMemory: [] })
    expect(block).not.toContain('<user_memory>')
  })

  it('渲染顺序：状态栏 → 事实 → 长期记忆 → 进展', () => {
    const block = projectMemory({
      l1: { conversationGoal: 'G' },
      facts: { template: { templateCount: 2 } },
      userMemory: [
        { id: '1', userId: 'u', workspaceId: 'w', kind: 'preference', key: '语言', value: '中文', confidence: 0.9 },
      ],
      ledger: [{ normAsk: 'a', ask: '找个模板', agent: 'template', outcome: 'artifact' }],
    })
    expect(block.indexOf('<agent_status>')).toBeLessThan(block.indexOf('<session_facts>'))
    expect(block.indexOf('<session_facts>')).toBeLessThan(block.indexOf('<user_memory>'))
    expect(block.indexOf('<user_memory>')).toBeLessThan(block.indexOf('<session_progress>'))
  })
})

describe('deriveGoal / isSmallTalk — 目标跳过寒暄（§2.12-D5）', () => {
  it('纯寒暄 → isSmallTalk=true，deriveGoal 返回空（让后续轮继续找目标）', () => {
    for (const g of ['你好', '在吗？', 'Hello!', '谢谢～', '  ']) {
      if (g.trim()) expect(isSmallTalk(g)).toBe(true)
      expect(deriveGoal(g)).toBe('')
    }
  })

  it('带实质请求的句子不被当寒暄', () => {
    expect(isSmallTalk('你好，帮我建一张客户表')).toBe(false)
    expect(deriveGoal('你好，帮我建一张客户表')).toBe('你好，帮我建一张客户表')
    expect(deriveGoal('分析教职工信息登记表')).toBe('分析教职工信息登记表')
  })

  it('目标存全文（不截断）；渲染时才截断', () => {
    const long = '需'.repeat(300)
    expect(deriveGoal(long)).toBe(long)
    expect(deriveGoal(long).length).toBe(300)
  })
})

describe('turnsToSummarize — L2 摘要的预算溢出触发（§2.12-D3）', () => {
  const turn = (content: string) => ({ role: 'user' as const, content })

  it('窗口在预算内 → 0（短会话零摘要）', () => {
    expect(turnsToSummarize([turn('短'), turn('也很短')], 1600)).toBe(0)
    expect(turnsToSummarize(undefined, 1600)).toBe(0)
    expect(turnsToSummarize([turn('x')], 1600)).toBe(0) // 只有 1 轮也不摘要
  })

  it('预算 ≤ 0 → 0（关闭）', () => {
    expect(turnsToSummarize([turn('a'.repeat(1000)), turn('b'.repeat(1000))], 0)).toBe(0)
  })

  it('超出预算 → 摘要最旧的若干轮，保留最新（少）到预算内', () => {
    // 预算 50 tokens ≈ 100 字符；每轮约 60 字符 → 只能容下约 1 轮
    const turns = [turn('a'.repeat(60)), turn('b'.repeat(60)), turn('c'.repeat(60)), turn('d'.repeat(60))]
    const n = turnsToSummarize(turns, 50)
    expect(n).toBeGreaterThan(0)
    expect(n).toBeLessThan(turns.length) // 至少留最新 1 轮
    // 保留的尾部必须落在预算内（约 100 字符）
    const kept = turns.slice(n)
    const keptChars = kept.reduce((s, t) => s + t.content.length, 0)
    expect(keptChars).toBeLessThanOrEqual(100)
  })

  it('单轮就超预算 → 仍保留最新 1 轮不摘要', () => {
    const turns = [turn('a'.repeat(10)), turn('b'.repeat(5000))]
    expect(turnsToSummarize(turns, 20)).toBe(turns.length - 1)
  })
})

describe('normalizeAsk — 重复判定归一化', () => {
  it('去空白与中英标点、转小写', () => {
    expect(normalizeAsk('分析 教职工信息登记表！')).toBe(normalizeAsk('分析教职工信息登记表'))
    expect(normalizeAsk('Hello, World!')).toBe('helloworld')
  })
})

describe('buildRepeatNotice — 保守精确匹配', () => {
  it('少于两条 / 未命中已作答 / 只命中 pending → 空', () => {
    expect(buildRepeatNotice([])).toBe('')
    expect(buildRepeatNotice([{ normAsk: 'a', ask: 'a', agent: 'template', outcome: 'answered' }])).toBe('')
    expect(
      buildRepeatNotice([
        { normAsk: 'a', ask: 'a', agent: 'template', outcome: 'waiting' },
        { normAsk: 'a', ask: 'a', agent: 'template', outcome: 'pending' },
      ]),
    ).toBe('')
  })
})

describe('detectClarification — 本轮是否以提问收尾', () => {
  const base = { agent: 'submission' as const, producedArtifact: false, haltedOrGaveUp: false }

  it('以 ？ 结尾、无产物、非 halted/gaveUp → 记为提问', () => {
    const r = detectClarification({ ...base, finalContent: '请问要分析哪张表的数据？' })
    expect(r).toEqual({ agent: 'submission', question: '请问要分析哪张表的数据？' })
  })

  it('半角 ? 结尾同样识别', () => {
    expect(detectClarification({ ...base, finalContent: 'which table?' })).not.toBeNull()
  })

  it('多段回复 → question 取最后一行非空文本', () => {
    const r = detectClarification({ ...base, finalContent: '好的，我可以帮你分析。\n请问要分析哪张表？' })
    expect(r?.question).toBe('请问要分析哪张表？')
  })

  it('本轮产出了产物 → null（即便以 ？ 结尾）', () => {
    expect(
      detectClarification({ ...base, producedArtifact: true, finalContent: '是否加入当前空间？' }),
    ).toBeNull()
  })

  it('以句号结尾 → null', () => {
    expect(detectClarification({ ...base, finalContent: '分析已完成。' })).toBeNull()
  })

  it('征询句式收尾（真机欠触发放宽）→ 记为提问', () => {
    const r1 = detectClarification({ ...base, finalContent: '请描述你想创建的表单，比如员工信息登记表含姓名手机号。' })
    expect(r1).not.toBeNull()
    expect(r1?.question).toContain('请描述')
  })

  it('「告诉我…」式收尾 → 记为提问', () => {
    expect(
      detectClarification({ ...base, finalContent: '等你准备好表单，告诉我表单名称或 ID，我就开始分析。' }),
    ).not.toBeNull()
  })

  it('产出产物后的「想调整告诉我」→ null（产物守卫优先）', () => {
    expect(
      detectClarification({
        ...base,
        producedArtifact: true,
        finalContent: '报名统计表已经建好了，如果还想调整直接告诉我就行。',
      }),
    ).toBeNull()
  })

  it('gaveUp / halted → null（认输话术、中断话术不算提问）', () => {
    expect(detectClarification({ ...base, haltedOrGaveUp: true, finalContent: '需要你换个说法？' })).toBeNull()
  })

  it('空内容 → null', () => {
    expect(detectClarification({ ...base, finalContent: '   ' })).toBeNull()
  })
})
