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

  // 2026-10-19 实测：表单名较长时「已删除「教职工信息登记表」的 V2 版本」不匹配
  // 「删除后 4 字内是版本」的旧正则，被 form_delete 认领 → 成功的版本删除被误报「未落库」。
  it('长表单名 + V2 版本：归因为版本删除，成功后不误报', () => {
    const tools = ['form_delete', 'form_version_delete']
    const reply = '已删除「教职工信息登记表」的 V2 版本，该版本已移入回收站，管理员可恢复。'
    expect(guardHallucination(reply, tools, ['form_version_delete']).suspicious).toBe(false)

    const r = guardHallucination(reply, tools, [])
    expect(r.suspicious).toBe(true)
    expect(r.expectedTool).toBe('form_version_delete')
  })

  it('版本声明在前、回收站在后的分句也归为版本删除', () => {
    const tools = ['form_delete', 'form_version_delete']
    const r = guardHallucination('该版本已移入回收站。', tools, [])
    expect(r.suspicious).toBe(true)
    expect(r.expectedTool).toBe('form_version_delete')
  })

  it('只成功删了版本、却声称删了整张表 → 仍按表单删除判', () => {
    const tools = ['form_delete', 'form_version_delete']
    const r = guardHallucination('已经帮你删除这张表单了。', tools, ['form_version_delete'])
    expect(r.suspicious).toBe(true)
    expect(r.expectedTool).toBe('form_delete')
  })

  it('成功删除表单后不被版本正则误判', () => {
    const tools = ['form_delete', 'form_version_delete']
    expect(guardHallucination('已经帮你删除这张表单了，可在回收站恢复。', tools, ['form_delete']).suspicious).toBe(
      false,
    )
  })

  // 2026-10-16：form_save 因工作空间已删而 404，模型原样转述 server 文案
  // 「工作空间不存在或已删除（404）」→「已删除」曾误命中 form_delete 完成态。
  it('转述失败文案（含「已删除」）→ 不判幻觉', () => {
    const tools = ['form_save', 'form_delete']
    const reply =
      '表单结构已生成并通过校验，但保存时平台返回错误：工作空间不存在或已删除（404），所以暂时无法写入数据库。'
    const r = guardHallucination(reply, tools, [])
    expect(r.suspicious).toBe(false)
  })

  it('同一句里的「不存在」不影响另一句的真实完成声明', () => {
    const tools = ['form_delete']
    // 第二句是干净的完成态声明，且本轮无 form_delete 结果 → 仍判
    const r = guardHallucination('刚才那次失败了。已经帮你删除这张表单了。', tools, [])
    expect(r.suspicious).toBe(true)
    expect(r.expectedTool).toBe('form_delete')
  })

  it('「没有任何错误」的收尾不被当作失败叙述（不漏报）', () => {
    const tools = ['form_save']
    const r = guardHallucination('表单已保存成功，没有任何错误。', tools, [])
    expect(r.suspicious).toBe(true)
  })
})
