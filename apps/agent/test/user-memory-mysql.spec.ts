/**
 * UserMemoryStore 的 MySQL 后端（阶段 8 §3.7）。
 *
 * 验幂等 upsert（同唯一键改 value/复核）、按 (userId, workspaceId) 取列表、软删 + 越权防护、
 * 软删后重写复活。跑在独立临时库（默认 agent_memory_test），跑完 DROP，不碰 formpu。
 * 无 AGENT_DATABASE_URL 时整体跳过。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createConnection } from 'mysql2/promise'
import { UserMemoryStore } from '../src/modules/memory/user-memory.store'
import type { UserMemoryRecord } from '../src/modules/memory/user-memory.types'

const TEST_DB = process.env.USER_MEMORY_TEST_DB || 'agent_memory_test'
const baseUrl = process.env.AGENT_DATABASE_URL
const conn = baseUrl
  ? (() => {
      const u = new URL(baseUrl)
      return {
        host: u.hostname,
        port: parseInt(u.port || '3306', 10),
        user: decodeURIComponent(u.username),
        password: decodeURIComponent(u.password),
      }
    })()
  : null

const describeIf = baseUrl ? describe : describe.skip

describeIf('UserMemoryStore（MySQL）', () => {
  const created: UserMemoryStore[] = []
  const originalUrl = process.env.AGENT_DATABASE_URL

  function newStore(): UserMemoryStore {
    const s = new UserMemoryStore()
    created.push(s)
    return s
  }

  function makeRecord(over: Partial<UserMemoryRecord> = {}): UserMemoryRecord {
    const now = Date.now()
    return {
      id: `mem_${Math.random().toString(36).slice(2, 10)}`,
      userId: 'user_1',
      workspaceId: 'ws_1',
      kind: 'preference',
      key: '语言',
      value: '中文',
      confidence: 0.7,
      sourceSessionId: 'sess_1',
      state: 'active',
      createdAt: now,
      updatedAt: now,
      ...over,
    }
  }

  beforeAll(async () => {
    const admin = await createConnection(conn!)
    await admin.query(
      `CREATE DATABASE IF NOT EXISTS \`${TEST_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    )
    await admin.end()

    const testUrl = new URL(baseUrl!)
    testUrl.pathname = `/${TEST_DB}`
    process.env.AGENT_DATABASE_URL = testUrl.toString()
  })

  afterAll(async () => {
    for (const s of created) await s.onModuleDestroy()
    process.env.AGENT_DATABASE_URL = originalUrl
    const admin = await createConnection(conn!)
    await admin.query(`DROP DATABASE IF EXISTS \`${TEST_DB}\``)
    await admin.end()
  })

  it('available：配了库即就绪', async () => {
    expect(await newStore().available()).toBe(true)
  })

  it('upsert 幂等：同 (user,ws,kind,key) 再写即更新 value/confidence', async () => {
    const store = newStore()
    await store.upsertMany([makeRecord({ key: '语言', value: '中文', confidence: 0.5 })])
    await store.upsertMany([makeRecord({ key: '语言', value: '英文', confidence: 0.9 })])

    const list = await store.list('user_1', 'ws_1')
    const rows = list.filter((r) => r.key === '语言')
    expect(rows).toHaveLength(1)
    expect(rows[0].value).toBe('英文')
    expect(rows[0].confidence).toBeCloseTo(0.9)
    expect(rows[0].sourceSessionId).toBe('sess_1')
  })

  it('list 按 (userId, workspaceId) 严格隔离', async () => {
    const store = newStore()
    await store.upsertMany([makeRecord({ userId: 'user_a', workspaceId: 'ws_x', key: 'k1' })])
    await store.upsertMany([makeRecord({ userId: 'user_a', workspaceId: 'ws_y', key: 'k2' })])
    await store.upsertMany([makeRecord({ userId: 'user_b', workspaceId: 'ws_x', key: 'k3' })])

    const aX = await store.list('user_a', 'ws_x')
    expect(aX.map((r) => r.key)).toEqual(['k1'])
  })

  it('remove 软删后不再召回；重写同键则复活', async () => {
    const store = newStore()
    const r = makeRecord({ userId: 'user_del', workspaceId: 'ws_d', key: 'k', value: 'old' })
    await store.upsertMany([r])

    expect(await store.remove(r.id, 'user_del')).toBe(true)
    expect(await store.list('user_del', 'ws_d')).toHaveLength(0)

    // 用户又提到 → upsert 同唯一键把软删复活 + 更新值
    await store.upsertMany([makeRecord({ userId: 'user_del', workspaceId: 'ws_d', key: 'k', value: 'new' })])
    const list = await store.list('user_del', 'ws_d')
    expect(list).toHaveLength(1)
    expect(list[0].value).toBe('new')
    expect(list[0].state).toBe('active')
  })

  it('remove 作用域限 userId（越权删不到他人）', async () => {
    const store = newStore()
    const r = makeRecord({ userId: 'owner', workspaceId: 'ws_o', key: 'secret' })
    await store.upsertMany([r])

    expect(await store.remove(r.id, 'attacker')).toBe(false)
    expect(await store.list('owner', 'ws_o')).toHaveLength(1)
  })
})
