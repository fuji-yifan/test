import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common'
import { createPool, type Pool } from 'mysql2/promise'
import { MysqlExecutor, type SqlExecutor } from '../graph/sql-executor'
import type { UserMemoryKind, UserMemoryRecord } from './user-memory.types'

/**
 * 用户长期记忆的 MySQL 存储（阶段 8 §3.7 / 8.1）。
 *
 * 照 session.store.ts 的 mysql 模式：agent 用 `mysql2` 直连（不经 Prisma），惰性建池 +
 * 运行时 `CREATE TABLE IF NOT EXISTS`，表结构在 apps/server/prisma/schema.prisma 声明
 * （让 `db push` 不把它当多余表删掉）。无 `AGENT_DATABASE_URL` / 连不上 → **no-op 降级**
 * （list 返回空、写入丢弃），等于本阶段未启用，不阻断请求。
 */
@Injectable()
export class UserMemoryStore implements OnModuleDestroy {
  private readonly logger = new Logger(UserMemoryStore.name)
  private failed = false
  private pool: Pool | null = null
  private executor: SqlExecutor | null = null

  async onModuleDestroy(): Promise<void> {
    if (this.pool) await this.pool.end().catch(() => {})
  }

  /** 惰性建池并确保表存在；不可用返回 null（此后一律 no-op）。 */
  private async getMysql(): Promise<SqlExecutor | null> {
    if (this.failed) return null
    if (this.executor) return this.executor

    const url = process.env.AGENT_DATABASE_URL
    if (!url) {
      this.failed = true
      this.logger.warn('未配置 AGENT_DATABASE_URL，用户长期记忆降级为 no-op')
      return null
    }
    try {
      this.pool = createPool({
        uri: url,
        connectionLimit: parseInt(process.env.AGENT_DB_POOL_SIZE || '5', 10),
        waitForConnections: true,
      })
      this.executor = new MysqlExecutor(this.pool)
      await this.executor.execute(`
        CREATE TABLE IF NOT EXISTS user_memory (
          id VARCHAR(64) NOT NULL,
          user_id VARCHAR(64) NOT NULL,
          workspace_id VARCHAR(64) NOT NULL DEFAULT '',
          kind VARCHAR(32) NOT NULL,
          \`key\` VARCHAR(128) NOT NULL,
          \`value\` VARCHAR(512) NOT NULL,
          confidence DOUBLE NOT NULL DEFAULT 0.6,
          source_session_id VARCHAR(64) NULL,
          state VARCHAR(16) NOT NULL DEFAULT 'active',
          created_at BIGINT NOT NULL DEFAULT 0,
          updated_at BIGINT NOT NULL DEFAULT 0,
          PRIMARY KEY (id),
          UNIQUE KEY uniq_user_memory (user_id, workspace_id, kind, \`key\`),
          KEY idx_user_memory_user_ws (user_id, workspace_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `)
      this.logger.log('UserMemory store: MySQL 已就绪')
      return this.executor
    } catch (err) {
      this.logger.warn('用户长期记忆 MySQL 初始化失败，降级 no-op', (err as Error).message)
      this.failed = true
      if (this.pool) await this.pool.end().catch(() => {})
      this.pool = null
      this.executor = null
      return null
    }
  }

  /** 存储是否可用（供 Service 决定要不要跑提取，避免白发 LLM 调用）。 */
  async available(): Promise<boolean> {
    return (await this.getMysql()) !== null
  }

  private rowToRecord(row: any): UserMemoryRecord {
    return {
      id: row.id,
      userId: row.user_id,
      workspaceId: row.workspace_id || '',
      kind: row.kind as UserMemoryKind,
      key: row.key,
      value: row.value,
      confidence: Number(row.confidence) || 0,
      sourceSessionId: row.source_session_id ?? null,
      state: row.state === 'forgotten' ? 'forgotten' : 'active',
      createdAt: Number(row.created_at) || 0,
      updatedAt: Number(row.updated_at) || 0,
    }
  }

  /**
   * 批量 upsert。按唯一键 `(user_id, workspace_id, kind, key)` 幂等：同键再写即更新 value/
   * confidence/来源，并把软删的重新激活（用户又提到了 = 仍然有效）。
   */
  async upsertMany(records: UserMemoryRecord[]): Promise<void> {
    if (records.length === 0) return
    const mysql = await this.getMysql()
    if (!mysql) return
    for (const r of records) {
      const now = Date.now()
      await mysql.execute(
        `INSERT INTO user_memory
           (id, user_id, workspace_id, kind, \`key\`, \`value\`, confidence, source_session_id, state, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
         ON DUPLICATE KEY UPDATE
           \`value\` = VALUES(\`value\`),
           confidence = VALUES(confidence),
           source_session_id = VALUES(source_session_id),
           state = 'active',
           updated_at = VALUES(updated_at)`,
        [r.id, r.userId, r.workspaceId, r.kind, r.key, r.value, r.confidence, r.sourceSessionId ?? null, now, now],
      )
    }
  }

  /** 按用户 + 工作空间取活跃记忆（最近更新在前，最多 limit 条）。 */
  async list(userId: string, workspaceId: string, limit = 200): Promise<UserMemoryRecord[]> {
    const mysql = await this.getMysql()
    if (!mysql) return []
    const rows = await mysql.query<any>(
      `SELECT id, user_id, workspace_id, kind, \`key\`, \`value\`, confidence, source_session_id, state, created_at, updated_at
         FROM user_memory
        WHERE user_id = ? AND workspace_id = ? AND state = 'active'
        ORDER BY updated_at DESC
        LIMIT ?`,
      [userId, workspaceId, limit],
    )
    return rows.map((r) => this.rowToRecord(r))
  }

  /** 软删一条：作用域限 userId，防越权删他人记忆。返回是否命中。 */
  async remove(id: string, userId: string): Promise<boolean> {
    const mysql = await this.getMysql()
    if (!mysql) return false
    const before = await mysql.query<any>('SELECT id FROM user_memory WHERE id = ? AND user_id = ?', [id, userId])
    if (!before.length) return false
    await mysql.execute('UPDATE user_memory SET state = ?, updated_at = ? WHERE id = ? AND user_id = ?', [
      'forgotten',
      Date.now(),
      id,
      userId,
    ])
    return true
  }
}
