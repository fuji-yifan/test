/**
 * 链路追踪适配器（阶段 6 / S2.3）：traceId 恒贯通；OTLP 导出 env-gated、未配即零外呼。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import type { ConfigService } from '@nestjs/config'
import { TracingService } from '../src/modules/infra/tracing.service'

const hex32 = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 32)

function makeConfig(map: Record<string, unknown>) {
  return { get: (k: string) => map[k] } as unknown as ConfigService
}

afterEach(() => vi.unstubAllGlobals())

describe('TracingService', () => {
  it('未配 endpoint → 导出禁用，endSpan 零外呼', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const svc = new TracingService(makeConfig({ 'infra.tracingEnabled': true }))

    expect(svc.isEnabled).toBe(false)
    const span = svc.startSpan('tool.data_query', svc.currentTraceId('call_1'), { risk: 'low' })
    await svc.endSpan(span, { ok: true, durationMs: 3 })

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('TRACING_ENABLED=false 即使配了 endpoint 也不导出', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const svc = new TracingService(
      makeConfig({ 'infra.otlpEndpoint': 'http://otel.local', 'infra.tracingEnabled': false }),
    )

    expect(svc.isEnabled).toBe(false)
    await svc.endSpan(svc.startSpan('x', svc.currentTraceId()), { ok: true, durationMs: 1 })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('currentTraceId：恒为 32-hex；有 requestId 确定性派生、无则随机', () => {
    const svc = new TracingService(makeConfig({}))
    expect(svc.currentTraceId('call_x')).toBe(hex32('call_x'))
    expect(svc.currentTraceId('call_x')).toBe(hex32('call_x')) // 同一 requestId 恒得同一值
    expect(svc.currentTraceId()).toMatch(/^[0-9a-f]{32}$/)
    expect(svc.currentTraceId('  ')).toMatch(/^[0-9a-f]{32}$/)
  })

  it('配 OTLP → POST 到 <ep>/v1/traces，body 含 32-hex traceId + 属性', async () => {
    const fetchSpy = vi.fn(async () => ({ status: 200, json: async () => ({}) }))
    vi.stubGlobal('fetch', fetchSpy)
    const svc = new TracingService(
      makeConfig({ 'infra.otlpEndpoint': 'http://otel.local', 'infra.serviceName': 'furmx-agent' }),
    )

    const span = svc.startSpan('tool.form_save', 'call_42', { risk: 'medium', workspaceId: 'ws1' })
    await svc.endSpan(span, { ok: true, durationMs: 12 })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy.mock.calls[0][0]).toBe('http://otel.local/v1/traces')
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as any).body)
    const s = body.resourceSpans[0].scopeSpans[0].spans[0]
    expect(s.traceId).toBe(hex32('call_42'))
    expect(s.name).toBe('tool.form_save')
    expect(s.status.code).toBe(1)
    expect(JSON.stringify(s.attributes)).toContain('ws1')
  })

  it('Langfuse host 走 /api/public/otel/v1/traces', async () => {
    const fetchSpy = vi.fn(async () => ({ status: 200, json: async () => ({}) }))
    vi.stubGlobal('fetch', fetchSpy)
    const svc = new TracingService(makeConfig({ 'infra.langfuseHost': 'http://lf.local/' }))

    await svc.endSpan(svc.startSpan('x', 'call_9'), { ok: true, durationMs: 1 })
    expect(fetchSpy.mock.calls[0][0]).toBe('http://lf.local/api/public/otel/v1/traces')
  })

  it('配 Langfuse public/secret key → POST 带 Basic 鉴权头', async () => {
    const fetchSpy = vi.fn(async () => ({ status: 200, json: async () => ({}) }))
    vi.stubGlobal('fetch', fetchSpy)
    const svc = new TracingService(
      makeConfig({
        'infra.langfuseHost': 'http://lf.local',
        'infra.langfusePublicKey': 'pk-lf-abc',
        'infra.langfuseSecretKey': 'sk-lf-xyz',
      }),
    )

    await svc.endSpan(svc.startSpan('x', 'call_9'), { ok: true, durationMs: 1 })
    const headers = (fetchSpy.mock.calls[0][1] as any).headers
    expect(headers.authorization).toBe(
      `Basic ${Buffer.from('pk-lf-abc:sk-lf-xyz').toString('base64')}`,
    )
  })

  it('只配 host 不配 key → 不带 authorization 头', async () => {
    const fetchSpy = vi.fn(async () => ({ status: 200, json: async () => ({}) }))
    vi.stubGlobal('fetch', fetchSpy)
    const svc = new TracingService(makeConfig({ 'infra.langfuseHost': 'http://lf.local' }))

    await svc.endSpan(svc.startSpan('x', 'call_9'), { ok: true, durationMs: 1 })
    const headers = (fetchSpy.mock.calls[0][1] as any).headers
    expect(headers.authorization).toBeUndefined()
  })

  it('导出失败（fetch 抛错）被吞，不冒泡', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('boom'))))
    const svc = new TracingService(makeConfig({ 'infra.otlpEndpoint': 'http://otel.local' }))

    await expect(
      svc.endSpan(svc.startSpan('x', 'call_1'), { ok: false, durationMs: 1, error: 'e' }),
    ).resolves.toBeUndefined()
  })

  describe('整轮上下文（runInTurn）', () => {
    it('轮内所有 span 共享同一 traceId；子 span 的 parentSpanId = root.spanId', async () => {
      const svc = new TracingService(makeConfig({}))
      const seen: string[] = []
      let childParent: string | undefined

      await svc.runInTurn({ requestId: 'req_turn_1', userId: 'u1', sessionId: 's1' }, async () => {
        seen.push(svc.currentTraceId()) // 不传参 → 取轮上下文
        seen.push(svc.currentTraceId('ignored')) // 轮上下文优先于入参
        const child = svc.startSpan('llm.chat', svc.currentTraceId())
        childParent = child.parentSpanId
      })

      expect(seen[0]).toBe(hex32('req_turn_1'))
      expect(seen[1]).toBe(hex32('req_turn_1'))
      expect(childParent).toMatch(/^[0-9a-f]{16}$/)
    })

    it('子 span 自动带 langfuse.user.id / langfuse.session.id；root span 无 parentSpanId', async () => {
      const fetchSpy = vi.fn(async () => ({ status: 200, json: async () => ({}) }))
      vi.stubGlobal('fetch', fetchSpy)
      const svc = new TracingService(makeConfig({ 'infra.otlpEndpoint': 'http://otel.local' }))

      await svc.runInTurn({ requestId: 'req_turn_2', userId: 'u9', sessionId: 's9' }, async () => {
        await svc.endSpan(svc.startSpan('tool.data_query', svc.currentTraceId(), { risk: 'low' }), {
          ok: true,
          durationMs: 5,
        })
      })

      const calls = fetchSpy.mock.calls as any[]
      // 两次 POST：root(agent.turn) + 子(tool.data_query)，均同一 traceId
      const spans = calls.map((c) => JSON.parse(c[1].body).resourceSpans[0].scopeSpans[0].spans[0])
      expect(spans).toHaveLength(2)
      const root = spans.find((s) => s.name === 'agent.turn')
      const child = spans.find((s) => s.name === 'tool.data_query')
      expect(root.traceId).toBe(hex32('req_turn_2'))
      expect(child.traceId).toBe(root.traceId)
      expect(root.parentSpanId).toBeUndefined()
      expect(child.parentSpanId).toBe(root.spanId)
      const attrMap = Object.fromEntries(
        child.attributes.map((a: any) => [a.key, a.value.stringValue]),
      )
      expect(attrMap['langfuse.user.id']).toBe('u9')
      expect(attrMap['langfuse.session.id']).toBe('s9')
    })

    it('轮上下文退出后 currentTraceId 回落旧行为（不泄漏到下一轮）', async () => {
      const svc = new TracingService(makeConfig({}))
      await svc.runInTurn({ requestId: 'req_a' }, async () => {})
      expect(svc.currentTraceId('req_b')).toBe(hex32('req_b'))
    })

    it('fn 抛错 → root span 记为失败且异常重新抛出', async () => {
      const fetchSpy = vi.fn(async () => ({ status: 200, json: async () => ({}) }))
      vi.stubGlobal('fetch', fetchSpy)
      const svc = new TracingService(makeConfig({ 'infra.otlpEndpoint': 'http://otel.local' }))

      await expect(
        svc.runInTurn({ requestId: 'req_fail' }, async () => {
          throw new Error('boom')
        }),
      ).rejects.toThrow('boom')

      const s = JSON.parse((fetchSpy.mock.calls[0][1] as any).body).resourceSpans[0].scopeSpans[0]
        .spans[0]
      expect(s.status.code).toBe(2)
    })
  })
})
