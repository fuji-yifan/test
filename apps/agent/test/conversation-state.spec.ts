import { describe, it, expect } from 'vitest'
import { buildStateBar, buildMemoryBlock, detectClarification } from '../src/modules/graph/conversation-state'

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

  it('目标超长 → 截断到 ≤ 60 字并加 …', () => {
    const goal = '创'.repeat(100)
    const bar = buildStateBar({ conversationGoal: goal })
    expect(bar).toContain(`本对话目标: ${'创'.repeat(60)}…`)
  })

  it('多行/多余空白的目标被折成单行', () => {
    const bar = buildStateBar({ conversationGoal: '创建   客户\n登记表' })
    expect(bar).toContain('本对话目标: 创建 客户 登记表')
  })
})

describe('buildMemoryBlock — 三层记忆块', () => {
  it('全空 → 空串', () => {
    expect(buildMemoryBlock({ l1: {} })).toBe('')
  })

  it('只有 L1 → 只含状态栏，不含摘要/近期窗口段', () => {
    const block = buildMemoryBlock({ l1: { activeSubAgent: 'form-designer', conversationGoal: '建客户表' } })
    expect(block).toContain('<agent_status>')
    expect(block).not.toContain('<conversation_summary>')
    expect(block).not.toContain('<recent_context>')
  })

  it('带 L2 摘要 → 含 <conversation_summary>', () => {
    const block = buildMemoryBlock({ l1: { conversationGoal: '建客户表' }, summary: '用户希望建一张客户登记表' })
    expect(block).toContain('<conversation_summary>')
    expect(block).toContain('用户希望建一张客户登记表')
  })

  it('带 L3 近期窗口 → 含 <recent_context> 与按角色标注的行', () => {
    const block = buildMemoryBlock({
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
    const block = buildMemoryBlock({
      l1: { activeSubAgent: 'submission' },
      summary: 'S',
      recent: [{ role: 'user', content: '   ' }, { role: 'user', content: 'Q' }],
    })
    expect(block).toContain('- user: Q')
    expect(block.match(/- user:/g)?.length).toBe(1)
    expect(block.indexOf('<agent_status>')).toBeLessThan(block.indexOf('<conversation_summary>'))
    expect(block.indexOf('<conversation_summary>')).toBeLessThan(block.indexOf('<recent_context>'))
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
