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
  /** 本条回答消耗的 token（仅 assistant 消息；老数据无此字段 = 前端不显示） */
  usage?: { inputTokens: number; outputTokens: number }
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

  // MySQL（阶段 3 切片 A）：与 checkpoint 共库，表结构由 apps/server 的 Prisma 管理。
  // 内存 Map 仍是进程内快路径；DB 是权威，重启后按 id 找回会话（getOrCreate 不再另建新 id）。
  private useMysql: boolean
  private mysqlFailed = false
  private pool: Pool | null = null
  private mysqlExecutor: SqlExecutor | null = null

  constructor() {
    this.memoryStore = new Map()
    const store = (process.env.SESSION_STORE || 'memory').toLowerCase()
    if (store !== 'memory' && store !== 'mysql') {
      this.logger.warn(`未知 SESSION_STORE=${store}，回退内存存储`)
    }
    this.useMysql = store === 'mysql'
    const active = this.useMysql ? 'mysql' : 'memory'
    this.logger.log(`Session store: ${active} (TTL: ${process.env.SESSION_TTL_HOURS || 6}h)`)
  }

  async onModuleDestroy(): Promise<void> {
    if (this.pool) await this.pool.end().catch(() => {})
  }

  /**
   * 惰性建 MySQL 连接池并确保表存在。
   *
   * 失败（未配 `AGENT_DATABASE_URL` / 连不上）时**降级回内存**并只告警一次，
   * 不让会话读写成为硬依赖。已失败则不再重试。
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
      // 执行权租约（阶段 3 切片 B）：独立表，幂等自建，不给已存在的 agent_sessions 加列。
      await this.mysqlExecutor.execute(`
        CREATE TABLE IF NOT EXISTS agent_session_leases (
          session_id VARCHAR(64) NOT NULL,
          owner VARCHAR(128) NOT NULL,
          expires_at BIGINT NOT NULL DEFAULT 0,
          updated_at BIGINT NOT NULL DEFAULT 0,
          PRIMARY KEY (session_id)
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

  async create(session: AgentSession): Promise<AgentSession> {
    const now = Date.now()
    session.createdAt = now
    session.updatedAt = now

    // 写内存
    this.setMemoryWithTTL(session.id, session)

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

    return null
  }

  async update(id: string, updates: Partial<AgentSession>): Promise<AgentSession | null> {
    const session = await this.get(id)
    if (!session) return null

    Object.assign(session, updates)
    session.updatedAt = Date.now()

    this.memoryStore.set(id, session)

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

    // 内存兜底
    return Array.from(this.memoryStore.values())
      .filter((s) => s.userId === userId && !this.isExpired(s))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  // ---- 执行权租约（阶段 3 切片 B）----
  // 跨副本互斥 + 崩溃自愈：owner + 过期时间。无 MySQL（memory / 连接失败）时
  // 全部降级为「直接放行」，等于纯内存现状，不阻断请求。

  /**
   * 抢租约。原子 upsert 做条件 steal：仅当「已过期」或「owner 就是自己」时才改写。
   *
   * MySQL 的 ON DUPLICATE KEY UPDATE 表达式按左→右、用**已更新值**求值，故 owner 必须
   * 写在 expires_at 之前（否则 owner 会读到刚刷新的 expires_at，误判成可抢）。
   * 写后回读判 owner==me：刚把自己 expires_at 设成 now+ttl，别的副本不可能立刻 steal，
   * 故回读无竞态；这样也无需让 SqlExecutor 暴露 affectedRows。
   */
  async acquireLease(
    sessionId: string,
    owner: string,
    ttlMs: number,
  ): Promise<{ granted: boolean; degraded: boolean }> {
    const mysql = await this.getMysql()
    if (!mysql) return { granted: true, degraded: true } // 无 DB：单实例语义，直接放行

    const now = Date.now()
    await mysql.execute(
      `INSERT INTO agent_session_leases (session_id, owner, expires_at, updated_at)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         owner      = IF(expires_at < ? OR owner = ?, VALUES(owner), owner),
         expires_at = IF(expires_at < ? OR owner = ?, VALUES(expires_at), expires_at),
         updated_at = IF(expires_at < ? OR owner = ?, VALUES(updated_at), updated_at)`,
      [sessionId, owner, now + ttlMs, now, now, owner, now, owner, now, owner],
    )
    const rows = await mysql.query<{ owner: string }>(
      'SELECT owner FROM agent_session_leases WHERE session_id = ?',
      [sessionId],
    )
    return { granted: rows[0]?.owner === owner, degraded: false }
  }

  /** 心跳续期。先 UPDATE 再回读：若期间被别的副本抢走，owner!=me → 返回 false。 */
  async renewLease(sessionId: string, owner: string, ttlMs: number): Promise<boolean> {
    const mysql = await this.getMysql()
    if (!mysql) return true

    const now = Date.now()
    await mysql.execute(
      'UPDATE agent_session_leases SET expires_at = ?, updated_at = ? WHERE session_id = ? AND owner = ?',
      [now + ttlMs, now, sessionId, owner],
    )
    const rows = await mysql.query<{ owner: string }>(
      'SELECT owner FROM agent_session_leases WHERE session_id = ?',
      [sessionId],
    )
    return rows[0]?.owner === owner
  }

  /** 释放租约。带 owner 条件：非持有者释放无效（镜像「只有持有者解锁」不变式）。 */
  async releaseLease(sessionId: string, owner: string): Promise<void> {
    const mysql = await this.getMysql()
    if (!mysql) return
    await mysql.execute(
      'DELETE FROM agent_session_leases WHERE session_id = ? AND owner = ?',
      [sessionId, owner],
    )
  }

  /** 只读探测（测试/诊断用）。 */
  async getLease(sessionId: string): Promise<{ owner: string; expiresAt: number } | null> {
    const mysql = await this.getMysql()
    if (!mysql) return null
    const rows = await mysql.query<{ owner: string; expires_at: unknown }>(
      'SELECT owner, expires_at FROM agent_session_leases WHERE session_id = ?',
      [sessionId],
    )
    if (!rows.length) return null
    return { owner: rows[0].owner, expiresAt: Number(rows[0].expires_at) || 0 }
  }

  // ---- 内部方法 ----

  private setMemoryWithTTL(id: string, session: AgentSession): void {
    const ttlMs = parseInt(process.env.SESSION_TTL_HOURS || '6', 10) * 3600 * 1000
    this.memoryStore.set(id, session)
    setTimeout(() => {
      const cached = this.memoryStore.get(id)
      if (cached && this.isExpired(cached)) {
        this.memoryStore.delete(id)
      }
    }, ttlMs)
  }

  private isExpired(session: AgentSession): boolean {
    const ttlMs = parseInt(process.env.SESSION_TTL_HOURS || '6', 10) * 3600 * 1000
    return Date.now() - session.updatedAt > ttlMs
  }

}
