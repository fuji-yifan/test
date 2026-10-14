/**
 * form_delete / form_version_delete（阶段 6 / S4.2）：agent 侧删除工具。
 *
 * 只做「移入回收站」的软删除转发：拿不到明确 formId / version 时**直接报错**，
 * 绝不靠模型猜 id；成功时经 ContextService 打对应 server 端点。
 */
import { describe, expect, it } from 'vitest'
import { FormDeleteTool } from '../src/modules/sub-agents/form-designer/tools/form-delete.tool'
import { FormVersionDeleteTool } from '../src/modules/sub-agents/form-designer/tools/form-version-delete.tool'

function makeDelete() {
  const calls: Array<{ token: string; formId: string }> = []
  const ctx = {
    deleteForm: async (token: string, formId: string) => {
      calls.push({ token, formId })
      return {}
    },
  } as any
  return { tool: new FormDeleteTool(ctx), calls }
}

function makeVersionDelete() {
  const calls: Array<{ token: string; formId: string; version: number }> = []
  const ctx = {
    deleteFormVersion: async (token: string, formId: string, version: number) => {
      calls.push({ token, formId, version })
      return {}
    },
  } as any
  return { tool: new FormVersionDeleteTool(ctx), calls }
}

describe('form_delete', () => {
  it('成功：转发 deleteForm，摘要提示已移入回收站', async () => {
    const { tool, calls } = makeDelete()
    const res = await tool.execute({ token: 't', formId: 'f1', target: '客户登记表' })
    expect(res.ok).toBeUndefined() // 成功路径不写 ok（网关判定）
    expect(res.formId).toBe('f1')
    expect(res.summary).toContain('回收站')
    expect(calls).toEqual([{ token: 't', formId: 'f1' }])
  })

  it('没有 token → 未登录，不调 server', async () => {
    const { tool, calls } = makeDelete()
    const res = await tool.execute({ formId: 'f1' })
    expect(res.ok).toBe(false)
    expect(res.error).toBe('no_token_in_session')
    expect(calls).toHaveLength(0)
  })

  it('没有 formId → 直接报错，绝不猜 id', async () => {
    const { tool, calls } = makeDelete()
    const res = await tool.execute({ token: 't' })
    expect(res.ok).toBe(false)
    expect(res.error).toBe('no_form_id')
    expect(calls).toHaveLength(0)
  })
})

describe('form_version_delete', () => {
  it('成功：转发 deleteFormVersion（含版本号）', async () => {
    const { tool, calls } = makeVersionDelete()
    const res = await tool.execute({ token: 't', formId: 'f1', version: 3 })
    expect(res.formId).toBe('f1')
    expect(res.version).toBe(3)
    expect(res.summary).toContain('v3')
    expect(calls).toEqual([{ token: 't', formId: 'f1', version: 3 }])
  })

  it('没有 token → 未登录', async () => {
    const { tool, calls } = makeVersionDelete()
    const res = await tool.execute({ formId: 'f1', version: 3 })
    expect(res.error).toBe('no_token_in_session')
    expect(calls).toHaveLength(0)
  })

  it('没有 formId → 报错', async () => {
    const { tool, calls } = makeVersionDelete()
    const res = await tool.execute({ token: 't', version: 3 })
    expect(res.error).toBe('no_form_id')
    expect(calls).toHaveLength(0)
  })

  it('没有 version → 报错', async () => {
    const { tool, calls } = makeVersionDelete()
    const res = await tool.execute({ token: 't', formId: 'f1' })
    expect(res.error).toBe('no_version')
    expect(calls).toHaveLength(0)
  })
})
