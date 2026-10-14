import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { createPool, type Pool } from 'mysql2/promise'
import { MysqlExecutor, type SqlExecutor } from '../graph/sql-executor'
import { serializeArgsPreview } from './sanitize-args'

/** 一条工具调用审计记录（阶段 6 / S2）。 */
export interface AuditRecord {
  /** 追溯 id（本实现 = 工具的 tool_call id；无则生成 tr_xxx） */
  traceId: string
  sessionId?: string
  userId?: string
  workspaceId: string
  toolName: string
  riskLevel: string
  /** 是否经用户确认后执行（executeConfirmed 路径） */
  confirmed: boolean
  durationMs: number
  ok: boolean
  summary: string
  /** 原始 args（写库前由本 store 脱敏） */
  args: Record<string, unknown>
  error?: string
  /** 策略备注（阶段 6 / S3.2，如 pii_access）：落 details.note，不单独建列 */
  note?: string
}

/**
 * 工具调用审计落库（阶段 6 / S2）。
 *
 * 写进 **server 的 `audit_logs` 表**（统一审计，同 `graph_checkpoint`「server 声明、agent 直写」先例）：
 * 表结构归 server（Prisma）所有，**agent 只 INSERT（append-only）**，不自建、不 ALTER、不删除。
 * 照 `user-memory.store.ts` 的 mysql2 直连模式，无 `AGENT_DATABASE_URL` / 连不上 → **no-op 降级**。
 * 写入失败（含列缺失 / FK 违约）只 warn，**绝不影响工具执行**（调用方 fire-and-forget）。
 */
@Injectable()
export class AuditStore implements OnModuleDestroy {
  private readonly logger = new Logger(AuditStore.name)
  private failed = false
  private pool: Pool | null = null
  private executor: SqlExecutor | null = null

  async onModuleDestroy(): Promise<void> {
    if (this.pool) await this.pool.end().catch(() => {})
  }

  /** 惰性建池；不可用返回 null（此后一律 no-op）。 */
  private async getMysql(): Promise<SqlExecutor | null> {
    if (this.failed) return null
    if (this.executor) return this.executor

    const url = process.env.AGENT_DATABASE_URL
    if (!url) {
      this.failed = true
      this.logger.warn('未配置 AGENT_DATABASE_URL，工具审计降级为 no-op')
      return null
    }
    try {
      this.pool = createPool({
        uri: url,
        connectionLimit: parseInt(process.env.AGENT_DB_POOL_SIZE || '5', 10),
        waitForConnections: true,
      })
      this.executor = new MysqlExecutor(this.pool)
      this.logger.log('Audit store: MySQL 已就绪')
      return this.executor
    } catch (err) {
      this.logger.warn('工具审计 MySQL 初始化失败，降级 no-op', (err as Error).message)
      this.failed = true
      if (this.pool) await this.pool.end().catch(() => {})
      this.pool = null
      this.executor = null
      return null
    }
  }

  /** 存储是否可用。 */
  async available(): Promise<boolean> {
    return (await this.getMysql()) !== null
  }

  /**
   * 落一条审计。append-only。
   *
   * `workspaceId` 为空则跳过（`audit_logs.workspace_id` NOT NULL + FK → Workspace，硬写会违约）。
   * 其余异常（表/列缺失、连不上）只 warn —— 调用方不应因此中断。
   */
  async record(entry: AuditRecord): Promise<void> {
    if (!entry.workspaceId) {
      this.logger.warn(`工具审计跳过（缺少 workspaceId）：${entry.toolName}`)
      return
    }
    const mysql = await this.getMysql()
    if (!mysql) return

    const details = JSON.stringify({
      summary: entry.summary,
      argsPreview: serializeArgsPreview(entry.args),
      ...(entry.error ? { error: entry.error } : {}),
      ...(entry.note ? { note: entry.note } : {}),
    })

    try {
      await mysql.execute(
        `INSERT INTO audit_logs
           (id, workspace_id, user_id, action, resource_type, resource_id, details, ip, created_at,
            trace_id, session_id, tool_name, risk_level, confirmed, duration_ms, result_ok)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          randomUUID(),
          entry.workspaceId,
          entry.userId ?? null,
          'agent.tool_call',
          'AgentTool',
          null,
          details,
          null,
          new Date(),
          entry.traceId,
          entry.sessionId ?? null,
          entry.toolName,
          entry.riskLevel,
          entry.confirmed ? 1 : 0,
          entry.durationMs,
          entry.ok ? 1 : 0,
        ],
      )
    } catch (err) {
      this.logger.warn(`工具审计写入失败（${entry.toolName}）：${(err as Error).message}`)
    }
  }
}
