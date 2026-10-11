/**
 * eval：确定性路由回归网（见 docs/AGENT_IMPROVEMENT_PLAN.md §3.1）。
 *
 * 与 graph-flow.spec 共用 test/harness，跑在独立的 MySQL 临时库上。
 * 只断言确定性分支：route.agent / isCrossDomain / plan.steps；
 * **不断言 LLM 兜底质量**（那靠真机探针抽样）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createConnection, createPool, type Pool } from 'mysql2/promise'
import { MysqlCheckpointSaver } from '../../src/modules/graph/mysql-checkpoint-saver'
import { MysqlExecutor } from '../../src/modules/graph/sql-executor'
import { createBuildHarness, runTurn } from '../harness/harness'
import { routingCases } from './routing.cases'

const TEST_DB = 'langgraph_eval_test'
const parsed = new URL(process.env.AGENT_DATABASE_URL!)
const conn = {
  host: parsed.hostname,
  port: parseInt(parsed.port || '3306', 10),
  user: decodeURIComponent(parsed.username),
  password: decodeURIComponent(parsed.password),
}
let pool: Pool
let saver: MysqlCheckpointSaver

beforeAll(async () => {
  const admin = await createConnection(conn)
  await admin.query(`CREATE DATABASE IF NOT EXISTS \`${TEST_DB}\` CHARACTER SET utf8mb4`)
  await admin.end()
  pool = createPool({ ...conn, database: TEST_DB, connectionLimit: 5 })
  saver = new MysqlCheckpointSaver(new MysqlExecutor(pool))
  await saver.setup()
})

afterAll(async () => {
  await pool.end()
  const admin = await createConnection(conn)
  await admin.query(`DROP DATABASE IF EXISTS \`${TEST_DB}\``)
  await admin.end()
})

const buildHarness = createBuildHarness(() => saver)

describe('eval：确定性路由回归', () => {
  for (const c of routingCases) {
    it(`${c.name}${c.cases ? ` [${c.cases}]` : ''}`, async () => {
      const h = buildHarness(c.script ?? [{ content: '好的' }])
      for (const m of c.prior ?? []) await runTurn(h, m, c.page)
      await runTurn(h, c.input, c.page)

      const route = h.events.find((e) => e.type === 'route') as any
      expect(route, `未拿到 route 事件：${c.name}`).toBeTruthy()
      expect(route.agent).toBe(c.expect.agent)
      if (c.expect.isCrossDomain !== undefined) {
        expect(route.isCrossDomain).toBe(c.expect.isCrossDomain)
      }
      if (c.expect.planAgents) {
        expect((route.steps as any[]).map((s) => s.agent)).toEqual(c.expect.planAgents)
      }
    })
  }
})
