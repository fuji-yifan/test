/**
 * 执行权租约的 MySQL 原语（阶段 3 切片 B）。
 *
 * 用**两个 SessionStore 实例**（各自连接池）模拟两个副本，验跨副本互斥与崩溃自愈：
 * 并发只一个授予、TTL 过期后可抢、非 owner 释放/续期无效。跑在独立临时库，跑完 DROP，
 * 不碰 formpu。无 AGENT_DATABASE_URL 时整体跳过。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createConnection } from 'mysql2/promise'
import { SessionStore } from '../src/modules/session/session.store'

const TEST_DB = process.env.SESSION_LEASE_TEST_DB || 'agent_lease_test'
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

describeIf('SessionStore 租约（SESSION_STORE=mysql）', () => {
  const created: SessionStore[] = []
  const originalStore = process.env.SESSION_STORE
  const originalUrl = process.env.AGENT_DATABASE_URL

  function newStore(): SessionStore {
    const s = new SessionStore()
    created.push(s)
    return s
  }

  beforeAll(async () => {
    const admin = await createConnection(conn!)
    await admin.query(
      `CREATE DATABASE IF NOT EXISTS \`${TEST_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    )
    await admin.end()

    const testUrl = new URL(baseUrl!)
    testUrl.pathname = `/${TEST_DB}`
    process.env.SESSION_STORE = 'mysql'
    process.env.AGENT_DATABASE_URL = testUrl.toString()
  })

  afterAll(async () => {
    for (const s of created) await s.onModuleDestroy()
    process.env.SESSION_STORE = originalStore
    process.env.AGENT_DATABASE_URL = originalUrl
    const admin = await createConnection(conn!)
    await admin.query(`DROP DATABASE IF EXISTS \`${TEST_DB}\``)
    await admin.end()
  })

  it('并发抢占：两个副本只有一个拿到租约', async () => {
    const a = newStore()
    const b = newStore()

    const ra = await a.acquireLease('sess_x', 'replicaA', 30000)
    const rb = await b.acquireLease('sess_x', 'replicaB', 30000)

    expect(ra).toEqual({ granted: true, degraded: false })
    expect(rb).toEqual({ granted: false, degraded: false })
    expect((await a.getLease('sess_x'))!.owner).toBe('replicaA')
  })

  it('同一 owner 重复抢占恒授予（单实例快路径不打 DB 也无法互斥自己）', async () => {
    const a = newStore()
    expect((await a.acquireLease('sess_same', 'replicaA', 30000)).granted).toBe(true)
    expect((await a.acquireLease('sess_same', 'replicaA', 30000)).granted).toBe(true)
  })

  it('TTL 过期后另一副本可抢（模拟持有者崩溃、租约自愈）', async () => {
    const a = newStore()
    const b = newStore()

    // A 抢到短 TTL 租约后「崩溃」（不再续期）
    expect((await a.acquireLease('sess_crash', 'replicaA', 30)).granted).toBe(true)
    await new Promise((r) => setTimeout(r, 80))

    const rb = await b.acquireLease('sess_crash', 'replicaB', 30000)
    expect(rb.granted).toBe(true)
    expect((await b.getLease('sess_crash'))!.owner).toBe('replicaB')
  })

  it('非 owner 释放/续期无效；owner 释放后租约消失', async () => {
    const a = newStore()
    const b = newStore()
    await a.acquireLease('sess_own', 'replicaA', 30000)

    await b.releaseLease('sess_own', 'replicaB') // 非 owner
    expect((await a.getLease('sess_own'))!.owner).toBe('replicaA')
    expect(await b.renewLease('sess_own', 'replicaB', 30000)).toBe(false)

    expect(await a.renewLease('sess_own', 'replicaA', 30000)).toBe(true)
    await a.releaseLease('sess_own', 'replicaA')
    expect(await a.getLease('sess_own')).toBeNull()
  })
})
