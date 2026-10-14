/**
 * AuditStore 的 MySQL 后端（阶段 6 / S2）。
 *
 * 验：INSERT 到 `audit_logs` 的字段映射（含 S2 新列）、`details` 内 **无明文 token**（脱敏）、
 * 缺 workspaceId 时跳过。跑在独立临时库（默认 agent_audit_test），自建一张 **无 FK** 的兼容表，
 * 跑完 DROP，不碰 formpu。无 AGENT_DATABASE_URL 时整体跳过。
 *
 * 注：agent 不自建生产表（归 server Prisma 所有），这里仅为测试自建无 FK 兼容表，
 * 以规避「workspace_id → Workspace 外键」在临时库不可满足的问题。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createConnection, type Connection } from 'mysql2/promise'
import { AuditStore } from '../src/modules/audit/audit.store'

const TEST_DB = process.env.AUDIT_TEST_DB || 'agent_audit_test'
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

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS audit_logs (
    id            VARCHAR(36)  NOT NULL PRIMARY KEY,
    workspace_id  VARCHAR(36)  NOT NULL,
    user_id       VARCHAR(36)  NULL,
    action        VARCHAR(50)  NOT NULL,
    resource_type VARCHAR(50)  NULL,
    resource_id   VARCHAR(36)  NULL,
    details       JSON         NULL,
    ip            VARCHAR(45)  NULL,
    created_at    DATETIME     NOT NULL,
    trace_id      VARCHAR(64)  NULL,
    session_id    VARCHAR(64)  NULL,
    tool_name     VARCHAR(64)  NULL,
    risk_level    VARCHAR(16)  NULL,
    confirmed     TINYINT(1)   NULL,
    duration_ms   INT          NULL,
    result_ok     TINYINT(1)   NULL
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
`

describeIf('AuditStore（MySQL）', () => {
  const created: AuditStore[] = []
  const originalUrl = process.env.AGENT_DATABASE_URL

  function newStore(): AuditStore {
    const s = new AuditStore()
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
    process.env.AGENT_DATABASE_URL = testUrl.toString()

    const dbConn = await createConnection(conn!)
    await dbConn.query(`USE \`${TEST_DB}\``)
    await dbConn.query(CREATE_TABLE)
    await dbConn.end()
  })

  afterAll(async () => {
    for (const s of created) await s.onModuleDestroy()
    process.env.AGENT_DATABASE_URL = originalUrl
    const admin = await createConnection(conn!)
    await admin.query(`DROP DATABASE IF EXISTS \`${TEST_DB}\``)
    await admin.end()
  })

  async function fetchRow(traceId: string): Promise<any | null> {
    const dbConn: Connection = await createConnection({
      ...conn!,
      database: TEST_DB,
    })
    const [rows] = await dbConn.query('SELECT * FROM audit_logs WHERE trace_id = ?', [traceId])
    await dbConn.end()
    return (rows as any[])[0] ?? null
  }

  it('available：配了库即就绪', async () => {
    expect(await newStore().available()).toBe(true)
  })

  it('record：写入全部 S2 字段，details 无明文 token', async () => {
    const store = newStore()
    const traceId = `tr_${Math.random().toString(36).slice(2, 12)}`

    await store.record({
      traceId,
      sessionId: 'sess_audit_1',
      userId: 'user_9',
      workspaceId: 'ws_audit_1',
      toolName: 'form_save',
      riskLevel: 'medium',
      confirmed: true,
      durationMs: 42,
      ok: true,
      summary: '已保存表单',
      args: { token: 'super-secret-jwt', title: '报名表', nested: { password: 'p@ss' } },
    })

    const row = await fetchRow(traceId)
    expect(row).toBeTruthy()
    expect(row.workspace_id).toBe('ws_audit_1')
    expect(row.user_id).toBe('user_9')
    expect(row.action).toBe('agent.tool_call')
    expect(row.resource_type).toBe('AgentTool')
    expect(row.trace_id).toBe(traceId)
    expect(row.session_id).toBe('sess_audit_1')
    expect(row.tool_name).toBe('form_save')
    expect(row.risk_level).toBe('medium')
    expect(row.confirmed).toBe(1)
    expect(row.duration_ms).toBe(42)
    expect(row.result_ok).toBe(1)

    const details = typeof row.details === 'string' ? JSON.parse(row.details) : row.details
    expect(details.summary).toBe('已保存表单')

    // 脱敏：details 全串不得含明文 token / 密码
    const raw = JSON.stringify(details)
    expect(raw).not.toContain('super-secret-jwt')
    expect(raw).not.toContain('p@ss')
    expect(details.argsPreview).toContain('[REDACTED]')
    expect(details.argsPreview).toContain('报名表')
  })

  it('record：workspaceId 为空 → 跳过不写', async () => {
    const store = newStore()
    const traceId = `tr_${Math.random().toString(36).slice(2, 12)}`

    await store.record({
      traceId,
      workspaceId: '',
      toolName: 'data_query',
      riskLevel: 'low',
      confirmed: false,
      durationMs: 1,
      ok: true,
      summary: 'ok',
      args: { token: 'x' },
    })

    expect(await fetchRow(traceId)).toBeNull()
  })
})
