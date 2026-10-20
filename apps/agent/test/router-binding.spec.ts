/**
 * 路由回归：新建流程 + 绑定「已有表单」不应再派给 form-designer。
 *
 * 2026-10-18 实测：LLM 分类器把「新建一个流程并绑定教职工信息登记表」判成
 * [workflow, form-designer]，流程建完后表单设计助手又生成了一张表。
 */
import { describe, expect, it } from 'vitest'
import { RouterService, isBindExistingForm } from '../src/modules/graph/router.service'

function makeRouter(llmContent: string, pageAgent: string = 'form-designer') {
  const catalog = {
    agentByScenario: () => pageAgent,
    scenarioByAgent: (agent: string) => (agent === 'workflow' ? 'workflow-node' : 'form-builder'),
    get: () => true,
  } as any
  const llm = { chat: { invoke: async () => ({ content: llmContent }) } } as any
  return new RouterService(catalog, llm)
}

describe('isBindExistingForm', () => {
  it('新建流程 + 绑定已存在登记表 → true', () => {
    expect(isBindExistingForm('新建一个教职工信息登记确认流程并绑定教职工信息登记表')).toBe(true)
  })

  it('只提绑定、没提流程 → false', () => {
    expect(isBindExistingForm('绑定教职工信息登记表')).toBe(false)
  })

  it('明确要创建表单并配流程 → false（仍需要 form-designer）', () => {
    expect(isBindExistingForm('创建教职工信息登记表并配一个审批流程')).toBe(false)
    expect(isBindExistingForm('设计一个表单并配审批流')).toBe(false)
  })
})

describe('RouterService：绑定已有表单', () => {
  it('LLM 给出 [workflow, form-designer] → 去掉 form-designer，按单步 workflow 执行', async () => {
    const router = makeRouter(JSON.stringify({
      isCrossDomain: true,
      targetAgent: 'workflow',
      reason: '涉及流程配置与表单关联',
      steps: [{ agent: 'workflow' }, { agent: 'form-designer' }],
    }))
    const decision = await router.decide(
      '新建一个教职工信息登记确认流程并绑定教职工信息登记表',
      { scenario: 'form-builder' } as any,
    )
    expect(decision.agent).toBe('workflow')
    expect(decision.isCrossDomain).toBe(false)
    expect(decision.plan).toBeUndefined()
  })

  it('「删除某张表」是 form-designer 的强信号，哪怕当前在流程页', () => {
    const router = makeRouter('', 'workflow')
    const decision = router.decideDeterministic('删除报名统计表', { scenario: 'workflow-node' } as any)
    expect(decision.agent).toBe('form-designer')
  })

  it('删除流程节点不该被当成删表', () => {
    const router = makeRouter('', 'workflow')
    const decision = router.decideDeterministic('删除流程节点', { scenario: 'workflow-node' } as any)
    expect(decision.agent).toBe('workflow')
  })

  it('LLM 把 targetAgent 直接判成 form-designer → 修正为 workflow', async () => {
    const router = makeRouter(JSON.stringify({
      isCrossDomain: false,
      targetAgent: 'form-designer',
      reason: '绑定表单',
    }))
    const decision = await router.decide(
      '给新建的审批流程关联教职工信息登记表',
      { scenario: 'form-builder' } as any,
    )
    expect(decision.agent).toBe('workflow')
  })
})
