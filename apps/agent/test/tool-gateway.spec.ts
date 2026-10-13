/**
 * ToolGateway × ToolResultCache 集成测试（阶段 4 / 4.5）。
 *
 * 验网关流水线里的缓存插桩：
 * - 只读白名单命中 → 短路，跳过 registry.call；
 * - 只读白名单未命中 → 执行并写缓存，二次相同调用命中；
 * - 未列举的只读工具 → 不缓存；
 * - 写工具成功后 → 失效本工作空间缓存；
 * - 高风险工具走确认门（不进缓存）；executeConfirmed 成功后失效。
 */
import { describe, expect, it } from 'vitest'
import type { ConfigService } from '@nestjs/config'
import { ToolGateway } from '../src/modules/harness/tool-gateway'
import { ToolResultCache } from '../src/modules/cache/tool-cache.service'

const RISK: Record<string, 'low' | 'medium' | 'high' | 'critical'> = {
  data_query: 'low',
  data_list_forms: 'low',
  template_search: 'low',
  template_get_detail: 'low',
  data_analyze: 'low',
  form_save: 'low',
  template_instantiate: 'low',
  flow_save: 'low',
  data_export: 'high',
}

class StubRegistry {
  calls: string[] = []
  result: { ok: boolean; summary: string; data?: unknown; error?: string } = {
    ok: true,
    summary: 'ok',
    data: { v: 1 },
  }
  get(name: string) {
    return { name, riskLevel: RISK[name] ?? 'low' }
  }
  getRisk(name: string) {
    return RISK[name] ?? 'low'
  }
  async call(name: string) {
    this.calls.push(name)
    return this.result
  }
}

class FakeRedis {
  store = new Map<string, string>()
  async get(key: string) {
    return this.store.get(key) ?? null
  }
  async set(key: string, value: string) {
    this.store.set(key, value)
    return 'OK'
  }
  async keys(pattern: string) {
    const re = new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$')
    return [...this.store.keys()].filter((k) => re.test(k))
  }
  async del(...keys: string[]) {
    for (const k of keys) this.store.delete(k)
    return keys.length
  }
}

function makeGateway(redis = new FakeRedis()) {
  const registry = new StubRegistry()
  const config = {
    get: (key: string) =>
      ({ 'cache.ttlSeconds': 60, 'cache.enabled': true } as Record<string, unknown>)[key],
  } as unknown as ConfigService
  const cache = new ToolResultCache(redis as any, config)
  const gateway = new ToolGateway(registry as any, {} as any, cache)
  return { gateway, registry, cache, redis }
}

describe('ToolGateway × ToolResultCache', () => {
  it('只读白名单命中缓存 → 短路，不打 registry', async () => {
    const { gateway, registry, cache } = makeGateway()
    await cache.set('data_query', 'ws1', { token: 't', q: 'x' }, { summary: 'cached', result: { n: 1 } })

    const res = await gateway.execute('data_query', { token: 't', q: 'x' }, { workspaceId: 'ws1' })

    expect(res).toEqual({ ok: true, summary: 'cached', result: { n: 1 } })
    expect(registry.calls).toEqual([])
  })

  it('只读白名单未命中 → 执行并写缓存，同内容二次调用命中', async () => {
    const { gateway, registry } = makeGateway()

    const first = await gateway.execute('data_query', { token: 't', q: 'x' }, { workspaceId: 'ws1' })
    expect(first.result).toEqual({ v: 1 })
    expect(registry.calls).toEqual(['data_query'])

    const second = await gateway.execute('data_query', { token: 't2', q: 'x' }, { workspaceId: 'ws1' })
    expect(second.result).toEqual({ v: 1 })
    expect(registry.calls).toEqual(['data_query']) // 第二次没再打后端
  })

  it('未列举的只读工具（data_analyze）不缓存', async () => {
    const { gateway, registry } = makeGateway()

    await gateway.execute('data_analyze', {}, { workspaceId: 'ws1' })
    await gateway.execute('data_analyze', {}, { workspaceId: 'ws1' })

    expect(registry.calls).toEqual(['data_analyze', 'data_analyze'])
  })

  it('写工具（form_save）成功后失效本工作空间缓存', async () => {
    const { gateway, registry, cache } = makeGateway()
    await cache.set('data_query', 'ws1', { q: 'x' }, { summary: 'a', result: 1 })

    await gateway.execute('form_save', { token: 't', title: '报名表' }, { workspaceId: 'ws1' })

    expect(registry.calls).toEqual(['form_save'])
    expect(await cache.get('data_query', 'ws1', { q: 'x' })).toBeNull()
  })

  it('高风险工具走确认门，不进缓存', async () => {
    const { gateway, registry } = makeGateway()

    const res = await gateway.execute('data_export', {}, { workspaceId: 'ws1' })

    expect(res.confirmRequired).toBe(true)
    expect(registry.calls).toEqual([])
  })

  it('executeConfirmed 成功后失效本工作空间缓存', async () => {
    const { gateway, cache } = makeGateway()
    await cache.set('data_query', 'ws1', { q: 'x' }, { summary: 'a', result: 1 })

    await gateway.executeConfirmed('data_export', { token: 't' }, { workspaceId: 'ws1' })

    expect(await cache.get('data_query', 'ws1', { q: 'x' })).toBeNull()
  })
})
