/**
 * 链路追踪适配器（阶段 6 / S2.3）：traceId 恒贯通；OTLP 导出 env-gated、未配即零外呼。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConfigService } from '@nestjs/config'
import { TracingService } from '../src/modules/infra/tracing.service'

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

  it('currentTraceId：有 requestId 原样复用，无则 tr_ 前缀', () => {
    const svc = new TracingService(makeConfig({}))
    expect(svc.currentTraceId('call_x')).toBe('call_x')
    expect(svc.currentTraceId()).toMatch(/^tr_[0-9a-f]+$/)
    expect(svc.currentTraceId('  ')).toMatch(/^tr_/)
  })

  it('配 OTLP → POST 到 <ep>/v1/traces，body 含透传 traceId + 属性', async () => {
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
    expect(s.traceId).toBe('call_42')
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

  it('导出失败（fetch 抛错）被吞，不冒泡', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('boom'))))
    const svc = new TracingService(makeConfig({ 'infra.otlpEndpoint': 'http://otel.local' }))

    await expect(
      svc.endSpan(svc.startSpan('x', 'call_1'), { ok: false, durationMs: 1, error: 'e' }),
    ).resolves.toBeUndefined()
  })
})
