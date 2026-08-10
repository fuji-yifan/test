import { Injectable, Logger } from '@nestjs/common'

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
export class SessionStore {
  private readonly logger = new Logger(SessionStore.name)
  private memoryStore: Map<string, AgentSession>

  // SQL.js database reference（惰性初始化）
  private db: any = null
  private useSqlite: boolean

  constructor() {
    this.memoryStore = new Map()
    this.useSqlite = (process.env.SESSION_STORE || 'memory') === 'sqlite'
    this.logger.log(`Session store: ${this.useSqlite ? 'sqlite' : 'memory'} (TTL: ${process.env.SESSION_TTL_HOURS || 6}h)`)
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
        'UPDATE sessions SET messages=?, metadata=?, locked=?, scenario=?, updated_at=? WHERE id=?',
        [
          JSON.stringify(session.messages),
          JSON.stringify(session.metadata),
          session.locked ? 1 : 0,
          session.scenario,
          session.updatedAt,
          id,
        ],
      )
      this.persistDb()
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
  }

  async listByUser(userId: string): Promise<AgentSession[]> {
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
