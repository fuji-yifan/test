import { describe, expect, it } from 'vitest'
import { FormRollbackTool } from '../src/modules/sub-agents/form-designer/tools/form-rollback.tool'

/**
 * form_rollback（阶段 5 / 5.5）：读版本快照、把上一版 schema 再 PATCH 回去。
 * 版本列表按 version 倒序（[0] = 当前），所以「上一版」是 [1]。
 */
function makeTool(versions: any[]) {
  const saved: any[] = []
  const ctx = {
    getFormVersions: async () => versions,
    saveFormDraft: async (_token: string, data: any) => {
      saved.push(data)
      return { id: data.formId }
    },
  } as any
  return { tool: new FormRollbackTool(ctx), saved }
}

const V = (n: number) => ({ version: n, schema: { version: 1, settings: { formTitle: `v${n}` }, fields: [] } })

describe('form_rollback 回滚', () => {
  it('默认回滚到上一版（versions[1]），并把该 schema PATCH 回去', async () => {
    const { tool, saved } = makeTool([V(3), V(2), V(1)])
    const res = await tool.execute({ token: 't', formId: 'f1' })
    expect(res.version).toBe(2)
    expect(res.schema).toEqual(V(2).schema)
    expect(saved[0]).toMatchObject({ formId: 'f1', schema: V(2).schema })
    expect(res.summary).toContain('v2')
  })

  it('只有一个版本 → 明确报「没有上一版」', async () => {
    const { tool, saved } = makeTool([V(1)])
    const res = await tool.execute({ token: 't', formId: 'f1' })
    expect(res.ok).toBe(false)
    expect(res.error).toBe('no_previous_version')
    expect(saved).toHaveLength(0)
  })

  it('显式指定 version 时回滚到那版', async () => {
    const { tool, saved } = makeTool([V(3), V(2), V(1)])
    const res = await tool.execute({ token: 't', formId: 'f1', version: 1 })
    expect(res.version).toBe(1)
    expect(saved[0].schema).toEqual(V(1).schema)
  })

  it('指定的版本不存在 → 如实报错并列出可选版本', async () => {
    const { tool } = makeTool([V(3), V(2)])
    const res = await tool.execute({ token: 't', formId: 'f1', version: 9 })
    expect(res.ok).toBe(false)
    expect(res.error).toBe('version_not_found')
    expect(res.summary).toContain('v3')
  })

  it('没有 formId（没保存过）→ 明确提示先保存', async () => {
    const { tool } = makeTool([])
    const res = await tool.execute({ token: 't' })
    expect(res.error).toBe('not_saved')
  })

  it('没有 token → 报未登录', async () => {
    const { tool } = makeTool([V(3), V(2)])
    const res = await tool.execute({ formId: 'f1' })
    expect(res.error).toBe('no_token_in_session')
  })
})
