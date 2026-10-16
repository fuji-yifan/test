/**
 * ToolResultCache 单元测试（阶段 4 / 4.5）。
 *
 * 用假 Redis + 假 ConfigService 验缓存契约：
 * - 键含 workspaceId、去 token（同内容不同 token / 键序 → 同键）；
 * - get/set 往返、TTL 用配置值；
 * - invalidateWorkspace 只清本工作空间；
 * - 非只读白名单工具不读写；
 * - 无 Redis 客户端（REDIS_HOST 未设）→ 全部 no-op。
 */
import { describe, expect, it } from 'vitest'
import type { ConfigService } from '@nestjs/config'
import { ToolResultCache } from '../src/modules/cache/tool-cache.service'

class FakeRedis {
  store = new Map<string, string>()
  ttlCalls: { key: string; ttl: number }[] = []

  async get(key: string) {
    return this.store.get(key) ?? null
  }
  async set(key: string, value: string, _ex: string, ttl: number) {
    this.store.set(key, value)
    this.ttlCalls.push({ key, ttl })
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

function makeConfig(ttl = 60, enabled = true): ConfigService {
  return {
    get: (key: string) => ({ 'cache.ttlSeconds': ttl, 'cache.enabled': enabled } as Record<string, unknown>)[key],
  } as unknown as ConfigService
}

function makeCache(redis: FakeRedis | null, ttl = 60, enabled = true) {
  return new ToolResultCache(redis as any, makeConfig(ttl, enabled))
}

describe('ToolResultCache', () => {
  it('get/set 往返，TTL 用配置值', async () => {
    const redis = new FakeRedis()
    const cache = makeCache(redis, 30)
    await cache.set('data_query', 'ws1', { q: 'x' }, { summary: 's', result: { n: 1 } })

    expect(redis.ttlCalls[0].ttl).toBe(30)
    expect(await cache.get('data_query', 'ws1', { q: 'x' })).toEqual({ summary: 's', result: { n: 1 } })
  })

  it('键含 workspaceId：不同工作空间不串缓存', async () => {
    const redis = new FakeRedis()
    const cache = makeCache(redis)
    await cache.set('data_query', 'ws1', { q: 'x' }, { summary: 'a', result: 1 })
    await cache.set('data_query', 'ws2', { q: 'x' }, { summary: 'b', result: 2 })

    expect(redis.store.size).toBe(2)
    expect((await cache.get('data_query', 'ws1', { q: 'x' }))?.result).toBe(1)
    expect((await cache.get('data_query', 'ws2', { q: 'x' }))?.result).toBe(2)
  })

  it('去 token 且键序无关：token 不同 / 参数键序不同 → 命中同一键', async () => {
    const redis = new FakeRedis()
    const cache = makeCache(redis)
    await cache.set('data_query', 'ws1', { token: 'tok-a', q: 'x', page: 1 }, { summary: 'a', result: 1 })
    // 同内容、不同 token、键序打乱
    expect(await cache.get('data_query', 'ws1', { page: 1, token: 'tok-b', q: 'x' })).toEqual({
      summary: 'a',
      result: 1,
    })
    expect(redis.store.size).toBe(1)
  })

  it('invalidateWorkspace 只清本工作空间', async () => {
    const redis = new FakeRedis()
    const cache = makeCache(redis)
    await cache.set('data_query', 'ws1', { q: 'x' }, { summary: 'a', result: 1 })
    await cache.set('template_search', 'ws1', { q: 'y' }, { summary: 'b', result: 2 })
    await cache.set('data_query', 'ws2', { q: 'x' }, { summary: 'c', result: 3 })

    await cache.invalidateWorkspace('ws1')

    expect(await cache.get('data_query', 'ws1', { q: 'x' })).toBeNull()
    expect(await cache.get('template_search', 'ws1', { q: 'y' })).toBeNull()
    expect((await cache.get('data_query', 'ws2', { q: 'x' }))?.result).toBe(3)
  })

  it('非只读白名单工具不读写（写工具/未列举的只读工具）', async () => {
    const redis = new FakeRedis()
    const cache = makeCache(redis)
    await cache.set('form_save', 'ws1', {}, { summary: 'a', result: 1 })
    await cache.set('data_analyze', 'ws1', {}, { summary: 'b', result: 2 })

    expect(redis.store.size).toBe(0)
    expect(await cache.get('form_save', 'ws1', {})).toBeNull()

    expect(cache.isReadOnly('data_query')).toBe(true)
    expect(cache.isReadOnly('form_save')).toBe(false)
    expect(cache.isWrite('form_save')).toBe(true)
  })

  it('写工具名单与 harness 的 WRITE_TOOLS 同源（S4.2 对齐，含删除工具与 flow_bind_form）', async () => {
    const cache = makeCache(new FakeRedis())
    for (const t of ['form_save', 'form_rollback', 'form_delete', 'form_version_delete', 'flow_save', 'flow_bind_form', 'flow_publish', 'template_instantiate']) {
      expect(cache.isWrite(t)).toBe(true)
    }
    expect(cache.isWrite('data_query')).toBe(false)
    expect(cache.isWrite('form_preview')).toBe(false)
  })

  it('无 Redis 客户端时全部 no-op', async () => {
    const cache = makeCache(null)
    await cache.set('data_query', 'ws1', { q: 'x' }, { summary: 'a', result: 1 })
    expect(await cache.get('data_query', 'ws1', { q: 'x' })).toBeNull()
    await expect(cache.invalidateWorkspace('ws1')).resolves.toBeUndefined()
  })

  it('TOOL_CACHE_ENABLED=false 时 no-op（即使有客户端）', async () => {
    const redis = new FakeRedis()
    const cache = makeCache(redis, 60, false)
    await cache.set('data_query', 'ws1', { q: 'x' }, { summary: 'a', result: 1 })
    expect(redis.store.size).toBe(0)
    expect(await cache.get('data_query', 'ws1', { q: 'x' })).toBeNull()
  })
})
