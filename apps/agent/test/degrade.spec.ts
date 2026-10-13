/**
 * 分级降级链纯函数（阶段 6 / S7.4）。
 */
import { describe, expect, it } from 'vitest'
import { degradeReply } from '../src/modules/graph/degrade'

describe('degradeReply', () => {
  it('模型不可用 + 有草稿 → 规则层（保留草稿）', () => {
    const r = degradeReply({ hasDraft: true, reason: 'x', modelUnavailable: true })
    expect(r.to).toBe('rule')
    expect(r.content).toContain('保留')
  })

  it('模型不可用 + 无草稿 → 静态话术', () => {
    const r = degradeReply({ hasDraft: false, reason: 'x', modelUnavailable: true })
    expect(r.to).toBe('static')
    expect(r.content).toContain('稍后重试')
  })

  it('迭代用尽 + 有草稿 → 规则层', () => {
    const r = degradeReply({ hasDraft: true, reason: 'y', modelUnavailable: false })
    expect(r.to).toBe('rule')
    expect(r.content).toContain('保留')
  })

  it('降级原因随结果外泄', () => {
    const r = degradeReply({ hasDraft: false, reason: 'LLM 熔断', modelUnavailable: true })
    expect(r.reason).toBe('LLM 熔断')
  })
})
