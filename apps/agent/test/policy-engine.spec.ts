/**
 * 外部策略引擎适配器（阶段 6 / S3.1）：env-gated，未配置即 no-op（零外呼）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConfigService } from '@nestjs/config'
import { PolicyEngineService } from '../src/modules/infra/policy-engine.service'

function makeConfig(map: Record<string, unknown>) {
  return { get: (k: string) => map[k] } as unknown as ConfigService
}

const INPUT = { tool: 'form_delete', args: { formId: 'f1' }, risk: 'high', isWrite: true, workspaceId: 'ws1' }

afterEach(() => vi.unstubAllGlobals())

describe('PolicyEngineService', () => {
  it('未配置 URL → allow 且不发请求（no-op）', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const svc = new PolicyEngineService(makeConfig({ 'infra.policyEngineUrl': '' }))

    const d = await svc.check(INPUT)

    expect(d.decision).toBe('allow')
    expect(d.source).toBe('disabled')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('配了 URL → 转发 PDP，采纳其 decision', async () => {
    const fetchSpy = vi.fn(async () => ({
      status: 200,
      json: async () => ({ decision: 'deny', reason: 'blocked-by-policy' }),
    }))
    vi.stubGlobal('fetch', fetchSpy)
    const svc = new PolicyEngineService(makeConfig({ 'infra.policyEngineUrl': 'http://pdp.local/check' }))

    const d = await svc.check(INPUT)

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy.mock.calls[0][0]).toBe('http://pdp.local/check')
    expect(d).toMatchObject({ decision: 'deny', reason: 'blocked-by-policy', source: 'external' })
  })

  it('网络失败 → 默认 fail-open（allow）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('boom'))))
    const svc = new PolicyEngineService(makeConfig({ 'infra.policyEngineUrl': 'http://pdp.local/check' }))

    expect((await svc.check(INPUT)).decision).toBe('allow')
  })

  it('网络失败 + FAIL_CLOSED=true → deny', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('boom'))))
    const svc = new PolicyEngineService(
      makeConfig({ 'infra.policyEngineUrl': 'http://pdp.local/check', 'infra.policyEngineFailClosed': true }),
    )

    expect((await svc.check(INPUT)).decision).toBe('deny')
  })

  it('非 2xx → fail-open（除非 fail-closed）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 500, json: async () => ({}) })))
    const svc = new PolicyEngineService(makeConfig({ 'infra.policyEngineUrl': 'http://pdp.local/check' }))

    expect((await svc.check(INPUT)).decision).toBe('allow')
  })

  it('响应无可识别 decision → 放行', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 200, json: async () => ({ foo: 1 }) })))
    const svc = new PolicyEngineService(makeConfig({ 'infra.policyEngineUrl': 'http://pdp.local/check' }))

    expect((await svc.check(INPUT)).decision).toBe('allow')
  })
})
