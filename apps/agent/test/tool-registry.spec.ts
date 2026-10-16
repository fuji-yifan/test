import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { ToolRegistry } from '../src/modules/harness/tool.registry'

// fixupArgs 是 ToolRegistry 的私有方法，这里直接取来做单元测试（不依赖 Nest DI）。
describe('ToolRegistry.fixupArgs — form_assemble_schema 的 placeholder→text 别名', () => {
  const registry = new ToolRegistry({} as any)
  const fix = (args: Record<string, unknown>) => (registry as any).fixupArgs('form_assemble_schema', args) as any

  it('字段只给了 placeholder 时，归一成 text（否则会被 zod 静默丢掉）', () => {
    const out = fix({ fields: [{ key: 'a', name: 'A', type: 'input', placeholder: '请输入姓名' }] })
    expect(out.fields[0].text).toBe('请输入姓名')
  })

  it('同时给了 text 与 placeholder 时，以 text 为准', () => {
    const out = fix({ fields: [{ key: 'a', name: 'A', type: 'input', text: '真提示', placeholder: '假提示' }] })
    expect(out.fields[0].text).toBe('真提示')
  })

  it('拍平/嵌套 schema 的改写分支也归一 placeholder', () => {
    const nested = fix({ schema: { fields: [{ key: 'a', name: 'A', type: 'input', placeholder: '嵌套提示' }] } })
    expect(nested.fields[0].text).toBe('嵌套提示')
  })

  it('非字符串 placeholder 不动（避免把对象/数字当文案）', () => {
    const out = fix({ fields: [{ key: 'a', name: 'A', type: 'input', placeholder: { x: 1 } }] })
    expect(out.fields[0].text).toBeUndefined()
  })
})

// S7.3 输出校验：声明了 outputSchema 的工具，结果不合法 → fail-closed 判失败，不喂给模型。
describe('ToolRegistry.call — 工具输出 schema 校验（fail-closed）', () => {
  const registry = new ToolRegistry({} as any)
  const register = (tool: Record<string, unknown>) =>
    (registry as any).tools.set((tool as any).name, tool)

  it('输出不符合约定 → 返回 output_validation_error', async () => {
    register({
      name: 'demo_bad',
      description: 'demo',
      riskLevel: 'low',
      parameters: {},
      zodSchema: z.object({}).passthrough(),
      outputSchema: z.object({ summary: z.string() }).passthrough(),
      instance: { execute: async () => ({ wrong: 1 }) },
    })

    const res = await registry.call('demo_bad', {})
    expect(res.ok).toBe(false)
    expect(res.error).toBe('output_validation_error')
    expect(res.summary).toContain('输出校验失败')
  })

  it('输出符合约定 → 正常返回', async () => {
    register({
      name: 'demo_ok',
      description: 'demo',
      riskLevel: 'low',
      parameters: {},
      zodSchema: z.object({}).passthrough(),
      outputSchema: z.object({ summary: z.string() }).passthrough(),
      instance: { execute: async () => ({ summary: 'ok', data: 1 }) },
    })

    const res = await registry.call('demo_ok', {})
    expect(res.ok).toBe(true)
    expect(res.summary).toBe('ok')
  })

  it('未声明 outputSchema 的工具不校验（保持现行为）', async () => {
    register({
      name: 'demo_plain',
      description: 'demo',
      riskLevel: 'low',
      parameters: {},
      zodSchema: z.object({}).passthrough(),
      instance: { execute: async () => ({ anything: true }) },
    })

    const res = await registry.call('demo_plain', {})
    expect(res.ok).toBe(true)
  })
})

// 工具主动回 ok:false 就是失败：注册表不能替它盖章成功，否则幻觉守卫失效、用户收到假报喜。
describe('ToolRegistry.call — 尊重工具自报的 ok:false', () => {
  const registry = new ToolRegistry({} as any)
  const register = (tool: Record<string, unknown>) =>
    (registry as any).tools.set((tool as any).name, tool)

  it('工具回 ok:false → registry 也判失败，并带出 error', async () => {
    register({
      name: 'save_fails',
      description: 'demo',
      riskLevel: 'low',
      parameters: {},
      zodSchema: z.object({}).passthrough(),
      instance: { execute: async () => ({ ok: false, summary: '保存失败', error: 'save_failed' }) },
    })

    const res = await registry.call('save_fails', {})
    expect(res.ok).toBe(false)
    expect(res.error).toBe('save_failed')
    expect(res.summary).toBe('保存失败')
  })

  it('工具回 ok:false 但没带 error → 兜底 tool_reported_failure', async () => {
    register({
      name: 'save_fails_bare',
      description: 'demo',
      riskLevel: 'low',
      parameters: {},
      zodSchema: z.object({}).passthrough(),
      instance: { execute: async () => ({ ok: false }) },
    })

    const res = await registry.call('save_fails_bare', {})
    expect(res.ok).toBe(false)
    expect(res.error).toBe('tool_reported_failure')
  })

  it('返回体没有 ok 字段 → 仍判成功（零回归）', async () => {
    register({
      name: 'no_ok_field',
      description: 'demo',
      riskLevel: 'low',
      parameters: {},
      zodSchema: z.object({}).passthrough(),
      instance: { execute: async () => ({ summary: 'done' }) },
    })

    const res = await registry.call('no_ok_field', {})
    expect(res.ok).toBe(true)
    expect(res.summary).toBe('done')
  })
})
