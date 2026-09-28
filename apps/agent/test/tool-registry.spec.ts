import { describe, it, expect } from 'vitest'
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
