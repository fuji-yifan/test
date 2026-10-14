/**
 * 幻觉守卫纯函数（阶段 6 / S7.2）。
 */
import { describe, expect, it } from 'vitest'
import { guardHallucination, hallucinationCorrection } from '../src/modules/graph/hallucination-guard'

const FORMS = ['form_save', 'form_rollback']

describe('guardHallucination', () => {
  it('声称已保存且有 form_save 成功结果 → 不判', () => {
    const r = guardHallucination('表单已保存到当前空间了。', FORMS, ['form_save'])
    expect(r.suspicious).toBe(false)
  })

  it('声称已保存但本轮无 form_save 结果 → 判为幻觉', () => {
    const r = guardHallucination('表单已保存到当前空间了。', FORMS, ['form_assemble_schema'])
    expect(r.suspicious).toBe(true)
    expect(r.expectedTool).toBe('form_save')
  })

  it('无 produceTools（只读 Agent）→ 不判', () => {
    const r = guardHallucination('表单已保存。', [], [])
    expect(r.suspicious).toBe(false)
  })

  it('含糊表述（未完成态）→ 不判', () => {
    const r = guardHallucination('我可以帮你保存这张表单吗？', FORMS, [])
    expect(r.suspicious).toBe(false)
  })

  it('回滚声明无 form_rollback 结果 → 判为幻觉', () => {
    const r = guardHallucination('已经帮你回滚到上一版了。', FORMS, [])
    expect(r.suspicious).toBe(true)
    expect(r.expectedTool).toBe('form_rollback')
  })

  it('纠正文案含「尚未实际」提示', () => {
    expect(hallucinationCorrection('表单保存')).toContain('尚未实际')
  })

  it('删除声明无对应结果 → 判为幻觉（S4.2）', () => {
    const tools = ['form_save', 'form_rollback', 'form_delete', 'form_version_delete']
    const del = guardHallucination('已经帮你删除这张表单了，可在回收站恢复。', tools, [])
    expect(del.suspicious).toBe(true)
    expect(del.expectedTool).toBe('form_delete')

    // 有 form_delete 成功结果 → 不判
    expect(guardHallucination('已删除该表单。', tools, ['form_delete']).suspicious).toBe(false)
  })

  it('版本删除的声明匹配到 form_version_delete（更具体者优先）', () => {
    const tools = ['form_delete', 'form_version_delete']
    const r = guardHallucination('已经帮你删除 v2 版本了。', tools, [])
    expect(r.suspicious).toBe(true)
    expect(r.expectedTool).toBe('form_version_delete')
  })

  it('成功删除版本后不被误判为表单删除幻觉（两正则互斥）', () => {
    const tools = ['form_delete', 'form_version_delete']
    // 本轮 form_version_delete 成功 → 版本声明命中并有结果 → 不应再落到 form_delete
    expect(guardHallucination('已经帮你删除 v2 版本了。', tools, ['form_version_delete']).suspicious).toBe(
      false,
    )
    expect(guardHallucination('版本删除成功。', tools, ['form_version_delete']).suspicious).toBe(false)
  })

  it('成功删除表单后不被版本正则误判', () => {
    const tools = ['form_delete', 'form_version_delete']
    expect(guardHallucination('已经帮你删除这张表单了，可在回收站恢复。', tools, ['form_delete']).suspicious).toBe(
      false,
    )
  })
})
