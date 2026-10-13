import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common'
import { createPool, type Pool } from 'mysql2/promise'
import { MysqlExecutor, type SqlExecutor } from '../graph/sql-executor'

export interface AgentSession {
  id: string
  userId: string
  workspaceId: string
  scenario: string
  messages: ChatMessage[]
  metadata: Record<string, any>
  locked: boolean
  createdAt: number
  updatedAt: number
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  toolCalls?: ToolCallRecord[]
  toolResults?: ToolResultRecord[]
  timestamp: number
}

interface ToolCallRecord {
  callId: string
  tool: string
  args: Record<string, unknown>
}

interface ToolResultRecord {
  callId: string
  tool: string
  ok: boolean
  summary: string
}

@Injectable()
export class SessionStore implements OnModuleDestroy {
  private readonly logger = new Logger(SessionStore.name)
  private memoryStore: Map<string, AgentSession>

  // SQL.js database reference（惰性初始化）
  private db: any = null
  private useSqlite: boolean

  // MySQL（阶段 3 切片 A）：与 checkpoint 共库，表结构由 apps/server 的 Prisma 管理。
  // 内存 Map 仍是进程内快路径；DB 是权威，重启后按 id 找回会话（getOrCreate 不再另建新 id）。
  private useMysql: boolean
  private mysqlFailed = false
  private pool: Pool | null = null
  private mysqlExecutor: SqlExecutor | null = null

  constructor() {
    this.memoryStore = new Map()
    const store = (process.env.SESSION_STORE || 'memory').toLowerCase()
    this.useSqlite = store === 'sqlite'
    this.useMysql = store === 'mysql'
    const active = this.useMysql ? 'mysql' : this.useSqlite ? 'sqlite' : 'memory'
    this.logger.log(`Session store: ${active} (TTL: ${process.env.SESSION_TTL_HOURS || 6}h)`)
  }

  async onModuleDestroy(): Promise<void> {
    if (this.pool) await this.pool.end().catch(() => {})
  }

  /**
   * 惰性建 MySQL 连接池并确保表存在。
   *
   * 失败（未配 `AGENT_DATABASE_URL` / 连不上）时**降级回内存**并只告警一次，
   * 不让会话读写成为硬依赖 —— 与 sqlite 分支的失败处置一致。已失败则不再重试。
   */
  private async getMysql(): Promise<SqlExecutor | null> {
    if (!this.useMysql || this.mysqlFailed) return null
    if (this.mysqlExecutor) return this.mysqlExecutor

    const url = process.env.AGENT_DATABASE_URL
    if (!url) {
      this.mysqlFailed = true
      this.logger.warn('SESSION_STORE=mysql 但未配置 AGENT_DATABASE_URL，回退内存存储')
      return null
    }
    try {
      this.pool = createPool({
        uri: url,
        connectionLimit: parseInt(process.env.AGENT_DB_POOL_SIZE || '5', 10),
        waitForConnections: true,
      })
      this.mysqlExecutor = new MysqlExecutor(this.pool)
      await this.mysqlExecutor.execute(`
        CREATE TABLE IF NOT EXISTS agent_sessions (
          id VARCHAR(64) NOT NULL,
          user_id VARCHAR(64) NOT NULL,
          workspace_id VARCHAR(64) NOT NULL DEFAULT '',
          scenario VARCHAR(64) NOT NULL DEFAULT '',
          messages LONGTEXT NOT NULL,
          metadata LONGTEXT NOT NULL,
          locked TINYINT(1) NOT NULL DEFAULT 0,
          created_at BIGINT NOT NULL DEFAULT 0,
          updated_at BIGINT NOT NULL DEFAULT 0,
          PRIMARY KEY (id),
          KEY idx_agent_sessions_user (user_id),
          KEY idx_agent_sessions_workspace (workspace_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `)
      this.logger.log('Session store: MySQL 已就绪')
      return this.mysqlExecutor
    } catch (err) {
      this.logger.warn('MySQL 初始化失败，回退内存存储', (err as Error).message)
      this.mysqlFailed = true
      if (this.pool) await this.pool.end().catch(() => {})
      this.pool = null
      this.mysqlExecutor = null
      return null
    }
  }

  private mysqlRowToSession(row: any): AgentSession {
    return {
      id: row.id,
      userId: row.user_id,
      workspaceId: row.workspace_id || '',
      scenario: row.scenario || '',
      messages: JSON.parse(String(row.messages ?? '[]')),
      metadata: JSON.parse(String(row.metadata ?? '{}')),
      locked: row.locked === 1 || row.locked === true,
      createdAt: Number(row.created_at) || 0,
      updatedAt: Number(row.updated_at) || 0,
    }
  }

  private async getDb(): Promise<any> {
    if (this.db) return this.db
    if (!this.useSqlite) return null

    try {
      const initSqlJs = require('sql.js')
      const SQL = await initSqlJs()
      const fs = require('fs')
      const path = require('path')
      const dataDir = path.join(process.cwd(), 'data')
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })

      const dbPath = path.join(dataDir, 'agent.db')
      if (fs.existsSync(dbPath)) {
        const buffer = fs.readFileSync(dbPath)
        this.db = new SQL.Database(buffer)
      } else {
        this.db = new SQL.Database()
      }

      this.db.run(`
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          workspace_id TEXT DEFAULT '',
          scenario TEXT DEFAULT '',
          messages TEXT DEFAULT '[]',
          metadata TEXT DEFAULT '{}',
          locked INTEGER DEFAULT 0,
          created_at INTEGER DEFAULT 0,
          updated_at INTEGER DEFAULT 0
        )
      `)
      this.db.run('CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)')
      this.logger.log(`SQLite initialized at ${dbPath}`)
      return this.db
    } catch (err) {
      this.logger.warn('SQLite init failed, falling back to memory-only', (err as Error).message)
      this.useSqlite = false
      return null
    }
  }

  async create(session: AgentSession): Promise<AgentSession> {
    const now = Date.now()
    session.createdAt = now
    session.updatedAt = now

    // 写内存
    this.setMemoryWithTTL(session.id, session)

    // 写 SQLite
    const db = await this.getDb()
    if (db) {
      db.run(
        'INSERT OR REPLACE INTO sessions (id, user_id, workspace_id, scenario, messages, metadata, locked, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          session.id,
          session.userId,
          session.workspaceId,
          session.scenario,
          JSON.stringify(session.messages),
          JSON.stringify(session.metadata),
          session.locked ? 1 : 0,
          session.createdAt,
          session.updatedAt,
        ],
      )
      this.persistDb()
    }

    // 写 MySQL
    const mysql = await this.getMysql()
    if (mysql) {
      await mysql.execute(
        `INSERT INTO agent_sessions
           (id, user_id, workspace_id, scenario, messages, metadata, locked, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           user_id = VALUES(user_id), workspace_id = VALUES(workspace_id), scenario = VALUES(scenario),
           messages = VALUES(messages), metadata = VALUES(metadata), locked = VALUES(locked),
           updated_at = VALUES(updated_at)`,
        [
          session.id,
          session.userId,
          session.workspaceId,
          session.scenario,
          JSON.stringify(session.messages),
          JSON.stringify(session.metadata),
          session.locked ? 1 : 0,
          session.createdAt,
          session.updatedAt,
        ],
      )
    }

    return session
  }

  async get(id: string): Promise<AgentSession | null> {
    // 先查内存
    const cached = this.memoryStore.get(id)
    if (cached) {
      if (this.isExpired(cached)) {
        this.memoryStore.delete(id)
        return null
      }
      return cached
    }

    // 查 MySQL
    const mysql = await this.getMysql()
    if (mysql) {
      const rows = await mysql.query<any>('SELECT * FROM agent_sessions WHERE id = ?', [id])
      if (!rows.length) return null
      const session = this.mysqlRowToSession(rows[0])
      if (this.isExpired(session)) return null
      this.memoryStore.set(id, session)
      return session
    }

    // 查 SQLite
    const db = await this.getDb()
    if (!db) return null

    const rows = db.exec('SELECT * FROM sessions WHERE id = ?', [id])
    if (!rows.length || !rows[0].values.length) return null

    const row = rows[0].values[0] as any[]
    const session = this.rowToSession(row)
    if (this.isExpired(session)) return null

    // 回填内存
    this.memoryStore.set(id, session)
    return session
  }

  async update(id: string, updates: Partial<AgentSession>): Promise<AgentSession | null> {
    const session = await this.get(id)
    if (!session) return null

    Object.assign(session, updates)
    session.updatedAt = Date.now()

    this.memoryStore.set(id, session)

    const db = await this.getDb()
    if (db) {
      db.run(
        'UPDATE sessions SET messages=?, metadata=?, locked=?, scenario=?, workspace_id=?, updated_at=? WHERE id=?',
        [
          JSON.stringify(session.messages),
          JSON.stringify(session.metadata),
          session.locked ? 1 : 0,
          session.scenario,
          session.workspaceId,
          session.updatedAt,
          id,
        ],
      )
      this.persistDb()
    }

    const mysql = await this.getMysql()
    if (mysql) {
      await mysql.execute(
        'UPDATE agent_sessions SET messages=?, metadata=?, locked=?, scenario=?, workspace_id=?, updated_at=? WHERE id=?',
        [
          JSON.stringify(session.messages),
          JSON.stringify(session.metadata),
          session.locked ? 1 : 0,
          session.scenario,
          session.workspaceId,
          session.updatedAt,
          id,
        ],
      )
    }

    return session
  }

  async delete(id: string): Promise<void> {
    this.memoryStore.delete(id)
    const db = await this.getDb()
    if (db) {
      db.run('DELETE FROM sessions WHERE id = ?', [id])
      this.persistDb()
    }
    const mysql = await this.getMysql()
    if (mysql) {
      await mysql.execute('DELETE FROM agent_sessions WHERE id = ?', [id])
    }
  }

  async listByUser(userId: string): Promise<AgentSession[]> {
    const mysql = await this.getMysql()
    if (mysql) {
      const rows = await mysql.query<any>(
        'SELECT * FROM agent_sessions WHERE user_id = ? ORDER BY updated_at DESC LIMIT 50',
        [userId],
      )
      return rows
        .map((row) => this.mysqlRowToSession(row))
        .filter((s) => !this.isExpired(s))
    }

    const db = await this.getDb()
    if (!db) {
      // 内存兜底
      return Array.from(this.memoryStore.values())
        .filter((s) => s.userId === userId && !this.isExpired(s))
        .sort((a, b) => b.updatedAt - a.updatedAt)
    }

    const rows = db.exec(
      'SELECT * FROM sessions WHERE user_id = ? ORDER BY updated_at DESC LIMIT 50',
      [userId],
    )
    if (!rows.length || !rows[0].values.length) return []

    return rows[0].values
      .map((row: any[]) => this.rowToSession(row))
      .filter((s: AgentSession) => !this.isExpired(s))
  }

  // ---- 内部方法 ----

  private setMemoryWithTTL(id: string, session: AgentSession): void {
    const ttlMs = parseInt(process.env.SESSION_TTL_HOURS || '6', 10) * 3600 * 1000
    this.memoryStore.set(id, session)
    setTimeout(() => {
      const cached = this.memoryStore.get(id)
      if (cached && this.isExpired(cached)) {
        this.memoryStore.delete(id)
        this.logger.log(`Session ${id} TTL expired`)
      }
    }, ttlMs)
  }

  private isExpired(session: AgentSession): boolean {
    const ttlMs = parseInt(process.env.SESSION_TTL_HOURS || '6', 10) * 3600 * 1000
    return Date.now() - session.updatedAt > ttlMs
  }

  private rowToSession(row: any[]): AgentSession {
    return {
      id: row[0],
      userId: row[1],
      workspaceId: row[2] || '',
      scenario: row[3] || '',
      messages: JSON.parse(row[4] || '[]'),
      metadata: JSON.parse(row[5] || '{}'),
      locked: row[6] === 1,
      createdAt: row[7] || 0,
      updatedAt: row[8] || 0,
    }
  }

  private persistDb(): void {
    if (!this.db) return
    try {
      const data = this.db.export()
      const buffer = Buffer.from(data)
      const fs = require('fs')
      const path = require('path')
      const dbPath = path.join(process.cwd(), 'data', 'agent.db')
      fs.writeFileSync(dbPath, buffer)
    } catch (err) {
      this.logger.error('Failed to persist SQLite DB', (err as Error).message)
    }
  }
}
