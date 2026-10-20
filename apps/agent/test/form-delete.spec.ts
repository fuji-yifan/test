/**
 * form_delete / form_version_delete（阶段 6 / S4.2）：agent 侧删除工具。
 *
 * 只做「移入回收站」的软删除转发：拿不到唯一明确的 formId / version 时**直接报错**，
 * 绝不靠模型猜 id；目标不在本会话时按表名在当前工作空间解析真实 id。
 * 成功时经 ContextService 打对应 server 端点。
 */
import { describe, expect, it } from 'vitest'
import { FormDeleteTool } from '../src/modules/sub-agents/form-designer/tools/form-delete.tool'
import { FormVersionDeleteTool } from '../src/modules/sub-agents/form-designer/tools/form-version-delete.tool'

function httpError(status: number, message: string) {
  const e: any = new Error(message)
  e.status = status
  return e
}

function makeDelete(opts?: {
  form?: any
  getThrows?: any
  formList?: any
}) {
  const calls: Array<{ token: string; formId: string }> = []
  const lookups: Array<{ formId?: string; workspaceId?: string; query?: any }> = []
  const ctx = {
    deleteForm: async (token: string, formId: string) => {
      calls.push({ token, formId })
      return {}
    },
    getForm: async (_token: string, formId: string) => {
      lookups.push({ formId })
      if (opts?.getThrows) throw opts.getThrows
      return opts?.form ?? { id: formId, name: '客户登记表', workspaceId: 'ws1' }
    },
    listForms: async (_token: string, workspaceId: string, query?: any) => {
      lookups.push({ workspaceId, query })
      return opts?.formList ?? { list: [] }
    },
  } as any
  return { tool: new FormDeleteTool(ctx), calls, lookups }
}

function makeVersionDelete(opts?: { formList?: any }) {
  const calls: Array<{ token: string; formId: string; version: number }> = []
  const ctx = {
    deleteFormVersion: async (token: string, formId: string, version: number) => {
      calls.push({ token, formId, version })
      return {}
    },
    getForm: async (_token: string, formId: string) => ({ id: formId, name: '客户登记表' }),
    listForms: async () => opts?.formList ?? { list: [] },
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

  it('目标不在本会话（只给表名）→ 按名称在工作空间里解析真实 id 再删', async () => {
    const { tool, calls, lookups } = makeDelete({
      formList: { list: [{ id: 'real-form-id', name: '报名统计表' }] },
    })
    const res = await tool.execute({ token: 't', workspaceId: 'ws1', target: '报名统计表' })
    expect(res.formId).toBe('real-form-id')
    expect(res.summary).toContain('报名统计表')
    expect(calls).toEqual([{ token: 't', formId: 'real-form-id' }])
    expect(lookups[0]).toMatchObject({ workspaceId: 'ws1', query: { keyword: '报名统计表' } })
  })

  it('模型编造的 formId（404）→ 有正确表名时按名称解析', async () => {
    const { tool, calls } = makeDelete({
      getThrows: httpError(404, '表单不存在'),
      formList: { list: [{ id: 'real-form-id', name: '报名统计表' }] },
    })
    const res = await tool.execute({ token: 't', workspaceId: 'ws1', formId: 'fake-id', target: '报名统计表' })
    expect(res.formId).toBe('real-form-id')
    expect(calls).toEqual([{ token: 't', formId: 'real-form-id' }])
  })

  it('名称找不到 → form_not_found，不移入回收站', async () => {
    const { tool, calls } = makeDelete({ formList: { list: [] } })
    const res = await tool.execute({ token: 't', workspaceId: 'ws1', target: '不存在的表' })
    expect(res.ok).toBe(false)
    expect(res.error).toBe('form_not_found')
    expect(res.summary).toContain('没有名为')
    expect(calls).toHaveLength(0)
  })

  it('同名多张 → form_ambiguous，不删任何一张', async () => {
    const { tool, calls } = makeDelete({
      formList: { list: [
        { id: 'f-a', name: '登记表' },
        { id: 'f-b', name: '登记表' },
      ] },
    })
    const res = await tool.execute({ token: 't', workspaceId: 'ws1', target: '登记表' })
    expect(res.error).toBe('form_ambiguous')
    expect(res.summary).toContain('f-a')
    expect(res.summary).toContain('f-b')
    expect(calls).toHaveLength(0)
  })

  it('表单属于别的工作空间 → 拒绝，不删', async () => {
    const { tool, calls } = makeDelete({ form: { id: 'f1', name: '报名统计表', workspaceId: 'ws-other' } })
    const res = await tool.execute({ token: 't', workspaceId: 'ws1', formId: 'f1' })
    expect(res.error).toBe('form_workspace_mismatch')
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

  it('目标不在本会话（只给表名）→ 按名称解析真实 id 再删版本', async () => {
    const { tool, calls } = makeVersionDelete({
      formList: { list: [{ id: 'real-form-id', name: '报名统计表' }] },
    })
    const res = await tool.execute({ token: 't', workspaceId: 'ws1', target: '报名统计表', version: 2 })
    expect(res.formId).toBe('real-form-id')
    expect(calls).toEqual([{ token: 't', formId: 'real-form-id', version: 2 }])
  })
})
