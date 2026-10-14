/**
 * 内置业务策略纯函数（阶段 6 / S3.2）。
 *
 * 恒开、零基建；只对显式信号判定 —— 未触发即 allow（对既有调用零影响）。
 */
import { describe, expect, it } from 'vitest'
import { combineDecisions, evaluateBuiltinPolicy } from '../src/modules/harness/policy-rules'

const base = { risk: 'low' as const, isWrite: false }

describe('evaluateBuiltinPolicy', () => {
  it('普通只读工具 → allow（不触发任何规则）', () => {
    const r = evaluateBuiltinPolicy({ tool: 'data_query', args: { token: 't', q: 'x' }, ...base, workspaceId: 'ws1' })
    expect(r.decision).toBe('allow')
  })

  it('写工具 form_save 正常参数 → allow', () => {
    const r = evaluateBuiltinPolicy({
      tool: 'form_save',
      args: { token: 't', title: '报名表' },
      risk: 'low',
      isWrite: true,
      workspaceId: 'ws1',
    })
    expect(r.decision).toBe('allow')
  })

  it('删除类工具被误评 low → requireConfirm（兜底）', () => {
    const r = evaluateBuiltinPolicy({ tool: 'form_delete', args: {}, risk: 'low', isWrite: true, workspaceId: 'ws1' })
    expect(r.decision).toBe('requireConfirm')
    expect(r.reason).toBe('delete-tool')
  })

  it('删除类工具 risk=high → 不预判（交给风险门）', () => {
    const r = evaluateBuiltinPolicy({ tool: 'form_delete', args: {}, risk: 'high', isWrite: true, workspaceId: 'ws1' })
    expect(r.decision).toBe('allow')
  })

  it('跨租户：args.workspaceId 与上下文不一致 → deny', () => {
    const r = evaluateBuiltinPolicy({
      tool: 'data_query',
      args: { workspaceId: 'ws-other', q: 'x' },
      ...base,
      workspaceId: 'ws1',
    })
    expect(r.decision).toBe('deny')
    expect(r.reason).toBe('cross-tenant')
  })

  it('args.workspaceId 与上下文一致 → 不判', () => {
    const r = evaluateBuiltinPolicy({
      tool: 'data_query',
      args: { workspaceId: 'ws1', q: 'x' },
      ...base,
      workspaceId: 'ws1',
    })
    expect(r.decision).toBe('allow')
  })

  it('批量写超阈值 → deny', () => {
    const items = Array.from({ length: 101 }, (_, i) => ({ id: i }))
    const r = evaluateBuiltinPolicy({
      tool: 'form_save',
      args: { items },
      risk: 'low',
      isWrite: true,
      workspaceId: 'ws1',
    })
    expect(r.decision).toBe('deny')
    expect(r.reason).toContain('bulk-over-threshold')
  })

  it('阈值可配：小于阈值不判', () => {
    const r = evaluateBuiltinPolicy({
      tool: 'form_save',
      args: { count: 50 },
      risk: 'low',
      isWrite: true,
      workspaceId: 'ws1',
      bulkThreshold: 100,
    })
    expect(r.decision).toBe('allow')
  })

  it('敏感字段访问 → warn + auditNote（不阻断）', () => {
    const r = evaluateBuiltinPolicy({
      tool: 'data_query',
      args: { fields: ['email', 'name'] },
      ...base,
      workspaceId: 'ws1',
    })
    expect(r.decision).toBe('warn')
    expect(r.auditNote).toBe('pii_access')
  })
})

describe('combineDecisions', () => {
  it('取最严者（deny > requireConfirm > warn > allow）', () => {
    const allow = evaluateBuiltinPolicy({ tool: 'data_query', args: {}, risk: 'low', isWrite: false })
    const deny = { decision: 'deny', reason: 'x', source: 'external' } as const
    expect(combineDecisions(allow, deny).decision).toBe('deny')
    expect(combineDecisions(deny, allow).decision).toBe('deny')
  })

  it('忽略 null/undefined；全空 → allow', () => {
    expect(combineDecisions(null, undefined).decision).toBe('allow')
  })

  it('同级时保留带 auditNote 的', () => {
    const a = { decision: 'warn', reason: 'a', source: 'external' } as const
    const b = { decision: 'warn', reason: 'b', auditNote: 'pii_access', source: 'external' } as const
    expect(combineDecisions(a, b).auditNote).toBe('pii_access')
  })
})
