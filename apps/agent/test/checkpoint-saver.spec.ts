/**
 * 用官方一致性套件验证 MysqlCheckpointSaver。
 *
 * 跑在独立的临时库（默认 langgraph_checkpoint_test）里，跑完自动 DROP，
 * 不会碰 formpu 里的真实 checkpoint 数据。
 *
 * 运行：pnpm --filter @furmx/agent test:checkpoint
 */
import { createConnection, createPool, type Pool } from 'mysql2/promise'
import { validate } from '@langchain/langgraph-checkpoint-validation'
import { MysqlCheckpointSaver } from '../src/modules/graph/mysql-checkpoint-saver'
import { MysqlExecutor } from '../src/modules/graph/sql-executor'

const TEST_DB = process.env.CHECKPOINT_TEST_DB || 'langgraph_checkpoint_test'
const baseUrl = process.env.AGENT_DATABASE_URL

if (!baseUrl) {
  throw new Error('AGENT_DATABASE_URL 未配置，无法运行 checkpoint 一致性套件')
}

const parsed = new URL(baseUrl)
const conn = {
  host: parsed.hostname,
  port: parseInt(parsed.port || '3306', 10),
  user: decodeURIComponent(parsed.username),
  password: decodeURIComponent(parsed.password),
}

let pool: Pool
let executor: MysqlExecutor

validate({
  checkpointerName: 'MysqlCheckpointSaver',

  async beforeAll() {
    const admin = await createConnection(conn)
    await admin.query(
      `CREATE DATABASE IF NOT EXISTS \`${TEST_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    )
    await admin.end()

    pool = createPool({ ...conn, database: TEST_DB, connectionLimit: 5, waitForConnections: true })
    executor = new MysqlExecutor(pool)
    const saver = new MysqlCheckpointSaver(executor)
    await saver.setup()
  },

  async createCheckpointer() {
    return new MysqlCheckpointSaver(executor)
  },

  async destroyCheckpointer() {
    await executor.execute('DELETE FROM graph_checkpoint_writes')
    await executor.execute('DELETE FROM graph_checkpoints')
  },

  async afterAll() {
    if (pool) await pool.end()
    const admin = await createConnection(conn)
    await admin.query(`DROP DATABASE IF EXISTS \`${TEST_DB}\``)
    await admin.end()
  },
})
