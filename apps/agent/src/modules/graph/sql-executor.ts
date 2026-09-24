import type { Pool } from 'mysql2/promise'

/**
 * Checkpointer 需要的最小 SQL 访问接口。
 * 抽成接口是为了让 saver 的逻辑可以脱离 mysql2 单独测试（官方一致性套件里就是这么用的）。
 */
export interface SqlExecutor {
  query<T = any>(sql: string, params?: unknown[]): Promise<T[]>
  execute(sql: string, params?: unknown[]): Promise<void>
}

/** SqlExecutor 的 mysql2 实现 */
export class MysqlExecutor implements SqlExecutor {
  constructor(private readonly pool: Pool) {}

  async query<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
    const [rows] = await this.pool.query(sql, params)
    return rows as T[]
  }

  async execute(sql: string, params: unknown[] = []): Promise<void> {
    await this.pool.query(sql, params)
  }
}
