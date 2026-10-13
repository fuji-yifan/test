import { describe, expect, it } from 'vitest'
import { diffFields, isDiffEmpty } from '../src/modules/graph/form-diff'

function s(fields: any[]): Record<string, unknown> {
  return { version: 1, settings: { formTitle: 'T' }, fields }
}
const f = (key: string, extra: Record<string, unknown> = {}) => ({ id: `id_${key}`, key, name: key, type: 'input', ...extra })

describe('diffFields 字段级 diff（阶段 5 / 5.4）', () => {
  it('无变化 → 三组都空', () => {
    const base = s([f('name'), f('phone')])
    const diff = diffFields(base, s([f('name'), f('phone')]))
    expect(diff).toEqual({ added: [], modified: [], removed: [] })
    expect(isDiffEmpty(diff)).toBe(true)
  })

  it('新增字段', () => {
    const diff = diffFields(s([f('name')]), s([f('name'), f('phone')]))
    expect(diff.added).toEqual([{ key: 'phone', name: 'phone', type: 'input' }])
    expect(diff.modified).toEqual([])
    expect(diff.removed).toEqual([])
  })

  it('删除字段', () => {
    const diff = diffFields(s([f('name'), f('phone')]), s([f('name')]))
    expect(diff.removed).toEqual([{ key: 'phone', name: 'phone' }])
  })

  it('修改：报出改动的属性标签', () => {
    const base = s([f('name', { name: '姓名' })])
    const next = s([f('name', { name: '真实姓名', rules: [{ type: 'required', message: 'x' }] })])
    const diff = diffFields(base, next)
    expect(diff.modified).toEqual([{ key: 'name', name: '真实姓名', changes: ['标签', '必填'] }])
  })

  it('改选项 / 类型也计入 changes', () => {
    const base = s([f('city', { type: 'input' })])
    const next = s([f('city', { type: 'select', props: { options: [{ label: '北京', value: 'bj' }] } })])
    const diff = diffFields(base, next)
    expect(diff.modified[0].changes).toEqual(['类型', '选项'])
  })

  it('无基线（新建 / 老会话）→ 全部计新增', () => {
    const diff = diffFields(undefined, s([f('name'), f('phone')]))
    expect(diff.added.map((a) => a.key)).toEqual(['name', 'phone'])
  })

  it('空 key 的布局控件按 id 比对', () => {
    const base = s([{ id: 'id_card1', key: '', type: 'card', name: '分组' }])
    const next = s([{ id: 'id_card1', key: '', type: 'card', name: '个人信息' }])
    const diff = diffFields(base, next)
    expect(diff.modified).toEqual([{ key: 'id_card1', name: '个人信息', changes: ['标签'] }])
  })
})
