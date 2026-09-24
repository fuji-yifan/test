/**
 * 基于 MySQL 的 LangGraph CheckpointSaver。
 *
 * 该实现已通过官方一致性套件 @langchain/langgraph-checkpoint-validation
 * （718 项全绿，见 test/checkpoint-saver.spec.ts）。
 *
 * 关键语义（与官方 MemorySaver 对齐，差异点都踩过坑）：
 * - put 时按 newVersions 只落「发生变化的 channel_values」（delta 存储）；
 * - 但真实运行时（langgraph 1.4.15）会传入「引用了 channel_values 中不存在 channel」
 *   的 newVersions（被消费掉的 branch:to:* / __start__ 仍带版本号），此时 newVersions
 *   不是可靠的 delta 描述，退化为全量存储；否则 resume 会因为 channel_values 缺
 *   __pregel_tasks 之类而无版本可依；
 * - getTuple/list 时沿 parent 链回填 channel_values 中缺失的 channel，且必须
 *   「祖先对该 channel 的版本与当前 checkpoint 记录的版本一致」才回填。
 *   仅按存在性回填会把已被消费/剪枝的 branch:to:* resurrect 出来，导致 resume
 *   从早期检查点重放节点（next 多出 __start__/step1）。
 * - checkpoint.v < 4 时执行 pending sends（__pregel_tasks）迁移；
 * - putWrites 中 idx >= 0 的普通写「先到先得」，负 idx 特殊 channel 可覆盖；
 * - list 的排序/before/limit/filter 在 JS 侧用 localeCompare 完成，
 *   避免 MySQL collation 与 JS 排序不一致导致行为偏差。
 *
 * 不直接依赖 PrismaClient，而是注入 SqlExecutor：
 * (1) 可在无 Prisma 环境做接口与逻辑测试；
 * (2) 表结构由 apps/server 的 Prisma migration 统一管理。
 */
import {
  BaseCheckpointSaver,
  type ChannelVersions,
  type Checkpoint,
  type CheckpointListOptions,
  type CheckpointMetadata,
  type CheckpointTuple,
  type PendingWrite,
  getCheckpointId,
  maxChannelVersion,
  WRITES_IDX_MAP,
  TASKS,
} from '@langchain/langgraph-checkpoint'
import type { RunnableConfig } from '@langchain/core/runnables'
import type { SqlExecutor } from './sql-executor'

interface CheckpointRow {
  thread_id: string
  checkpoint_ns: string
  checkpoint_id: string
  parent_checkpoint_id: string | null
  checkpoint_type: string
  checkpoint: string
  metadata: string
}

interface WriteRow {
  task_id: string
  idx: number
  channel: string
  type: string
  value: string
}

export class MysqlCheckpointSaver extends BaseCheckpointSaver<number> {
  constructor(private readonly db: SqlExecutor) {
    super() // 使用基类默认 serde (JsonPlusSerializer)
  }

  /**
   * 建表。幂等（CREATE TABLE IF NOT EXISTS）。
   * 正式环境的表结构以 apps/server/prisma/schema.prisma 为准，
   * 这里是为了本地/测试环境能零迁移直接跑起来。
   */
  async setup(): Promise<void> {
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS graph_checkpoints (
        thread_id VARCHAR(255) NOT NULL,
        checkpoint_ns VARCHAR(128) NOT NULL DEFAULT '',
        checkpoint_id VARCHAR(64) NOT NULL,
        parent_checkpoint_id VARCHAR(64) NULL,
        checkpoint_type VARCHAR(64) NOT NULL,
        checkpoint LONGTEXT NOT NULL,
        metadata LONGTEXT NOT NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS graph_checkpoint_writes (
        thread_id VARCHAR(255) NOT NULL,
        checkpoint_ns VARCHAR(128) NOT NULL DEFAULT '',
        checkpoint_id VARCHAR(64) NOT NULL,
        task_id VARCHAR(64) NOT NULL,
        idx INT NOT NULL,
        channel VARCHAR(255) NOT NULL,
        type VARCHAR(64) NOT NULL,
        value LONGTEXT NOT NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)
  }

  /** 清空所有 checkpoint 数据（测试用） */
  async clear(): Promise<void> {
    await this.db.execute(`DELETE FROM graph_checkpoint_writes`)
    await this.db.execute(`DELETE FROM graph_checkpoints`)
  }

  // ==================== 序列化 ====================

  private async dumps(data: unknown): Promise<{ type: string; data: string }> {
    const [type, bytes] = await this.serde.dumpsTyped(data)
    return { type, data: Buffer.from(bytes).toString('base64') }
  }

  private async loads(type: string, data: string): Promise<any> {
    return this.serde.loadsTyped(type, Buffer.from(data, 'base64'))
  }

  // ==================== 必实现方法 ====================

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const threadId = config.configurable?.thread_id as string | undefined
    const checkpointNs = (config.configurable?.checkpoint_ns as string) ?? ''
    const checkpointId = getCheckpointId(config)

    // 与 MemorySaver 一致：thread_id 缺失直接返回 undefined
    if (threadId === undefined) return undefined

    let rows: CheckpointRow[]
    if (checkpointId) {
      rows = await this.db.query<CheckpointRow>(
        `SELECT * FROM graph_checkpoints
           WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?`,
        [threadId, checkpointNs, checkpointId],
      )
    } else {
      // 排序在 JS 侧完成，避免依赖数据库 collation
      rows = await this.db.query<CheckpointRow>(
        `SELECT * FROM graph_checkpoints WHERE thread_id = ? AND checkpoint_ns = ?`,
        [threadId, checkpointNs],
      )
      rows.sort((a, b) => b.checkpoint_id.localeCompare(a.checkpoint_id))
      rows = rows.slice(0, 1)
    }

    if (!rows.length) return undefined
    return this.hydrate(rows[0])
  }

  async *list(
    config: RunnableConfig,
    options?: CheckpointListOptions,
  ): AsyncGenerator<CheckpointTuple> {
    const { before, limit, filter } = options ?? {}
    const threadId = config.configurable?.thread_id as string | undefined
    const nsFilter = config.configurable?.checkpoint_ns as string | undefined
    const cpFilter = getCheckpointId(config) || undefined

    let sql = `SELECT * FROM graph_checkpoints WHERE 1 = 1`
    const params: unknown[] = []
    if (threadId !== undefined) {
      sql += ` AND thread_id = ?`
      params.push(threadId)
    }
    if (nsFilter !== undefined) {
      sql += ` AND checkpoint_ns = ?`
      params.push(nsFilter)
    }

    const rows = await this.db.query<CheckpointRow>(sql, params)
    rows.sort((a, b) => {
      if (a.thread_id !== b.thread_id) return a.thread_id < b.thread_id ? -1 : 1
      if (a.checkpoint_ns !== b.checkpoint_ns) return a.checkpoint_ns < b.checkpoint_ns ? -1 : 1
      return b.checkpoint_id.localeCompare(a.checkpoint_id)
    })

    const beforeId = before?.configurable?.checkpoint_id as string | undefined
    let remaining = limit

    for (const row of rows) {
      if (cpFilter && row.checkpoint_id !== cpFilter) continue
      if (beforeId && row.checkpoint_id >= beforeId) continue

      const tuple = await this.hydrate(row)
      if (filter && !Object.entries(filter).every(([k, v]) => (tuple.metadata as any)?.[k] === v)) {
        continue
      }
      if (remaining !== undefined) {
        if (remaining <= 0) break
        remaining -= 1
      }
      yield tuple
    }
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    newVersions: ChannelVersions,
  ): Promise<RunnableConfig> {
    const threadId = config.configurable?.thread_id as string | undefined
    if (threadId === undefined) {
      throw new Error(
        `Failed to put checkpoint. The passed RunnableConfig is missing a required "thread_id" field in its "configurable" property.`,
      )
    }
    const checkpointNs = (config.configurable?.checkpoint_ns as string) ?? ''
    const parentCheckpointId = (config.configurable?.checkpoint_id as string) ?? null

    // delta 存储：只落此次发生变化的 channel_values。
    // 仅当 newVersions 的 key 都能在当前 channel_values 里找到时才可信；
    // 否则（运行时把已消费 channel 也列进 newVersions）退化为全量存储。
    const stored: Checkpoint = {
      v: checkpoint.v,
      id: checkpoint.id,
      ts: checkpoint.ts,
      channel_values: Object.keys(newVersions ?? {}).every((k) =>
        Object.prototype.hasOwnProperty.call(checkpoint.channel_values ?? {}, k),
      )
        ? filterChannelValues(checkpoint.channel_values, newVersions)
        : { ...(checkpoint.channel_values ?? {}) },
      channel_versions: { ...(checkpoint.channel_versions ?? {}) },
      versions_seen: checkpoint.versions_seen,
    }

    const c = await this.dumps(stored)
    // metadata 是纯 JSON 对象，直接 JSON 序列化，便于将来在 SQL 层做过滤
    const metadataJson = JSON.stringify(metadata)

    await this.db.execute(
      `INSERT INTO graph_checkpoints
         (thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, checkpoint_type, checkpoint, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         parent_checkpoint_id = VALUES(parent_checkpoint_id),
         checkpoint_type = VALUES(checkpoint_type),
         checkpoint = VALUES(checkpoint),
         metadata = VALUES(metadata)`,
      [threadId, checkpointNs, checkpoint.id, parentCheckpointId, c.type, c.data, metadataJson],
    )

    return {
      ...config,
      configurable: {
        ...config.configurable,
        thread_id: threadId,
        checkpoint_ns: checkpointNs,
        checkpoint_id: checkpoint.id,
      },
    }
  }

  async putWrites(config: RunnableConfig, writes: PendingWrite[], taskId: string): Promise<void> {
    const threadId = config.configurable?.thread_id as string | undefined
    const checkpointNs = (config.configurable?.checkpoint_ns as string) ?? ''
    const checkpointId = config.configurable?.checkpoint_id as string | undefined
    if (threadId === undefined) {
      throw new Error(
        `Failed to put writes. The passed RunnableConfig is missing a required "thread_id" field in its "configurable" property.`,
      )
    }
    if (checkpointId === undefined) {
      throw new Error(
        `Failed to put writes. The passed RunnableConfig is missing a required "checkpoint_id" field in its "configurable" property.`,
      )
    }

    for (let i = 0; i < writes.length; i++) {
      const [channel, value] = writes[i]
      const idx = WRITES_IDX_MAP[channel] ?? i
      const v = await this.dumps(value)
      // 普通写（idx >= 0）先到先得；特殊 channel（负 idx）允许覆盖
      const onDuplicate = idx >= 0 ? `type = type` : `type = VALUES(type), value = VALUES(value)`
      await this.db.execute(
        `INSERT INTO graph_checkpoint_writes
           (thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, type, value)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE ${onDuplicate}`,
        [threadId, checkpointNs, checkpointId, taskId, idx, channel, v.type, v.data],
      )
    }
  }

  async deleteThread(threadId: string): Promise<void> {
    await this.db.execute(`DELETE FROM graph_checkpoint_writes WHERE thread_id = ?`, [threadId])
    await this.db.execute(`DELETE FROM graph_checkpoints WHERE thread_id = ?`, [threadId])
  }

  // ==================== 内部方法 ====================

  /** 读取 + pending sends 迁移 + 祖先 channel 回填 */
  private async hydrate(row: CheckpointRow): Promise<CheckpointTuple> {
    const tuple = await this.loadRaw(row)

    // v < 4 的旧 checkpoint：把父 checkpoint 上的 __pregel_tasks 写迁移进 channel_values
    if (tuple.checkpoint.v < 4 && tuple.parentConfig) {
      const parentId = tuple.parentConfig.configurable!.checkpoint_id as string
      await this.migratePendingSends(tuple.checkpoint, row.thread_id, row.checkpoint_ns, parentId)
    }

    // 回填：channel_versions 里存在、但本次 delta 未存的 channel，沿 parent 链找值
    await this.backfillChannels(tuple)
    return tuple
  }

  private async loadRaw(row: CheckpointRow): Promise<CheckpointTuple> {
    const checkpoint = (await this.loads(row.checkpoint_type, row.checkpoint)) as Checkpoint
    const metadata = JSON.parse(row.metadata) as CheckpointMetadata

    const config: RunnableConfig = {
      configurable: {
        thread_id: row.thread_id,
        checkpoint_ns: row.checkpoint_ns,
        checkpoint_id: row.checkpoint_id,
      },
    }

    const parentConfig = row.parent_checkpoint_id
      ? {
          configurable: {
            thread_id: row.thread_id,
            checkpoint_ns: row.checkpoint_ns,
            checkpoint_id: row.parent_checkpoint_id,
          },
        }
      : undefined

    const pendingWrites = await this.getPendingWrites(
      row.thread_id,
      row.checkpoint_ns,
      row.checkpoint_id,
    )

    return { config, checkpoint, metadata, parentConfig, pendingWrites }
  }

  private async migratePendingSends(
    checkpoint: Checkpoint,
    threadId: string,
    checkpointNs: string,
    parentCheckpointId: string,
  ): Promise<void> {
    const rows = await this.db.query<WriteRow>(
      `SELECT task_id, idx, channel, type, value FROM graph_checkpoint_writes
         WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?
         ORDER BY task_id, idx`,
      [threadId, checkpointNs, parentCheckpointId],
    )
    const sends: unknown[] = []
    for (const r of rows) {
      if (r.channel === TASKS) sends.push(await this.loads(r.type, r.value))
    }
    checkpoint.channel_values ??= {}
    checkpoint.channel_values[TASKS] = sends
    checkpoint.channel_versions ??= {}
    const versions = Object.values(checkpoint.channel_versions)
    checkpoint.channel_versions[TASKS] =
      versions.length > 0 ? maxChannelVersion(...versions) : this.getNextVersion(undefined)
  }

  /**
   * 沿 parent 链把「有版本但没存值」的 channel 回填出来。
   *
   * 关键：这里只能读**原始行**，绝不能再调 `getTuple` —— getTuple 会 hydrate 出
   * 「已经回填过的」祖先，而每个祖先又会各自再走一遍 parent 链，工作量逐层翻倍：
   * 链长 ~20 时是几十万次 SQL（实测 getState 卡 256s，且每多一轮对话翻十倍）。
   * 直接读原始行是等价的：channel_versions 每个 checkpoint 都存全量，
   * 「祖先对该 channel 的版本与当前一致」用原始行就能判定（当前实现本来也只取
   * `parentValues[ch]`，那正是原始行里的值；祖先回填出来的值同样来自更上游的原始行）。
   */
  private async backfillChannels(tuple: CheckpointTuple): Promise<void> {
    const values = tuple.checkpoint.channel_values ?? {}
    const versions = tuple.checkpoint.channel_versions ?? {}
    const missing = Object.keys(versions).filter(
      (k) => !Object.prototype.hasOwnProperty.call(values, k),
    )
    if (missing.length === 0) return

    const remaining = new Set(missing)
    let cursor = tuple.parentConfig
    while (cursor && remaining.size > 0) {
      const checkpointId = cursor.configurable?.checkpoint_id as string | undefined
      if (checkpointId === undefined) break
      const rows = await this.db.query<CheckpointRow>(
        `SELECT * FROM graph_checkpoints
           WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?`,
        [
          cursor.configurable?.thread_id,
          (cursor.configurable?.checkpoint_ns as string) ?? '',
          checkpointId,
        ],
      )
      if (!rows.length) break
      const row = rows[0]
      const parent = (await this.loads(row.checkpoint_type, row.checkpoint)) as Checkpoint
      const parentValues = parent.channel_values ?? {}
      const parentVersions = parent.channel_versions ?? {}
      for (const ch of Array.from(remaining)) {
        // 必须存在且版本一致：版本不一致说明当前 checkpoint 已消费/剪枝该 channel，
        // 不能把祖先的旧值搬回来，否则 resume 会从错误的检查点重放。
        if (
          Object.prototype.hasOwnProperty.call(parentValues, ch) &&
          parentVersions[ch] === versions[ch]
        ) {
          values[ch] = parentValues[ch]
          remaining.delete(ch)
        }
      }
      cursor = row.parent_checkpoint_id
        ? {
            configurable: {
              thread_id: row.thread_id,
              checkpoint_ns: row.checkpoint_ns,
              checkpoint_id: row.parent_checkpoint_id,
            },
          }
        : undefined
    }
    tuple.checkpoint.channel_values = values
  }

  private async getPendingWrites(
    threadId: string,
    checkpointNs: string,
    checkpointId: string,
  ): Promise<[string, string, unknown][]> {
    const rows = await this.db.query<WriteRow>(
      `SELECT task_id, idx, channel, type, value FROM graph_checkpoint_writes
         WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?
         ORDER BY task_id, idx`,
      [threadId, checkpointNs, checkpointId],
    )
    const out: [string, string, unknown][] = []
    for (const r of rows) {
      out.push([r.task_id, r.channel, await this.loads(r.type, r.value)])
    }
    return out
  }
}

/** 只保留 newVersions 里出现的 channel（LangGraph 的 delta 存储语义） */
function filterChannelValues(
  channelValues: Checkpoint['channel_values'] | undefined,
  newVersions: ChannelVersions,
): Checkpoint['channel_values'] {
  const out: Record<string, unknown> = {}
  if (!channelValues || !newVersions) return out
  for (const key of Object.keys(newVersions)) {
    if (Object.prototype.hasOwnProperty.call(channelValues, key)) out[key] = channelValues[key]
  }
  return out
}
