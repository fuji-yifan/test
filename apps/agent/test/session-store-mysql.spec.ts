/**
 * SessionStore 的 MySQL 后端（阶段 3 切片 A）。
 *
 * 核心验收「服务重启后会话可继续」在这里用**两个实例**模拟：A 写入后，B（空内存 =
 * 刚重启的进程）仍能按同一个 id 读回会话。会话 id 就是 LangGraph 的 thread_id，
 * 读不回就会让 getOrCreate 另建新 id，把已落库的 checkpoint 变成孤儿。
 *
 * 跑在独立临时库（默认 agent_session_test），跑完 DROP，不碰 formpu。无 AGENT_DATABASE_URL 时整体跳过。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createConnection } from 'mysql2/promise'
import { SessionStore, type AgentSession } from '../src/modules/session/session.store'

const TEST_DB = process.env.SESSION_TEST_DB || 'agent_session_test'
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

describeIf('SessionStore（SESSION_STORE=mysql）', () => {
  const created: SessionStore[] = []
  const originalStore = process.env.SESSION_STORE
  const originalUrl = process.env.AGENT_DATABASE_URL

  /** 每个实例独立内存 Map；连续 new 两回即「重启一次」 */
  function newStore(): SessionStore {
    const s = new SessionStore()
    created.push(s)
    return s
  }

  function makeSession(over: Partial<AgentSession> = {}): AgentSession {
    return {
      id: 'sess_test_1',
      userId: 'user_1',
      workspaceId: 'ws_1',
      scenario: 'form-builder',
      messages: [],
      metadata: {},
      locked: false,
      createdAt: 0,
      updatedAt: 0,
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

  it('重启（新实例空内存）后按 id 读回同一条会话', async () => {
    const a = newStore()
    await a.create(
      makeSession({
        id: 'sess_restart',
        messages: [{ role: 'user', content: 'hi', timestamp: 1 }],
        metadata: { k: 'v' },
      }),
    )

    const b = newStore() // 空内存 = 模拟进程重启
    const got = await b.get('sess_restart')
    expect(got).not.toBeNull()
    expect(got!.userId).toBe('user_1')
    expect(got!.workspaceId).toBe('ws_1')
    expect(got!.messages[0].content).toBe('hi')
    expect(got!.metadata).toEqual({ k: 'v' })
  })

  it('update 落库，另一个实例可见', async () => {
    const a = newStore()
    await a.create(makeSession({ id: 'sess_update' }))
    await a.update('sess_update', { metadata: { k: 'v2' }, locked: true })

    const b = newStore()
    const got = await b.get('sess_update')
    expect(got!.metadata).toEqual({ k: 'v2' })
    expect(got!.locked).toBe(true)
  })

  it('listByUser 命中同用户会话；delete 后读不到', async () => {
    const a = newStore()
    await a.create(makeSession({ id: 'sess_list', userId: 'user_list' }))

    const list = await a.listByUser('user_list')
    expect(list.some((s) => s.id === 'sess_list')).toBe(true)

    await a.delete('sess_list')
    const b = newStore()
    expect(await b.get('sess_list')).toBeNull()
  })

  it('create 同一 id 走 upsert（不违反主键）', async () => {
    const a = newStore()
    await a.create(makeSession({ id: 'sess_upsert', scenario: 'first' }))
    await a.create(makeSession({ id: 'sess_upsert', scenario: 'second' }))

    const b = newStore()
    expect((await b.get('sess_upsert'))!.scenario).toBe('second')
  })
})
