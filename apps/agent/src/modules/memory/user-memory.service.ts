import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { UserMemoryStore } from './user-memory.store'
import { UserMemoryExtractor, type ExtractionInput } from './user-memory.extractor'
import { capCandidates, rankMemories } from './user-memory.pure'
import type { UserMemoryRecord } from './user-memory.types'
import type { AgentSession } from '../session/session.store'
import type { RunGraphResult } from '../graph/graph-runner.service'

function shortId(length = 12): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let out = ''
  for (let i = 0; i < length; i++) out += chars[Math.floor(Math.random() * chars.length)]
  return out
}

/**
 * 用户长期记忆的对外门面（阶段 8）。
 *
 * 组合 store(存取) + extractor(提取) + pure(解析/排序)，把开关与护栏收敛在这一层：
 * 召回给图用（8.3）、轮末提取给收尾用（8.2）、查看/删除给 API 用（8.4）。
 */
@Injectable()
export class UserMemoryService {
  private readonly logger = new Logger(UserMemoryService.name)

  /** 进程内并发去重：同一会话同一时刻只跑一次提取（轮末异步触发可能叠加）。 */
  private readonly inflight = new Set<string>()

  constructor(
    private readonly store: UserMemoryStore,
    private readonly extractor: UserMemoryExtractor,
    private readonly config: ConfigService,
  ) {}

  private flag(key: string, def: boolean): boolean {
    const v = this.config.get<boolean>(key)
    return typeof v === 'boolean' ? v : def
  }

  private num(key: string, def: number): number {
    const v = this.config.get<number>(key)
    return typeof v === 'number' && Number.isFinite(v) ? v : def
  }

  /** 整体开关开启且底层存储可用，才值得跑召回/提取（否则白发模型调用）。 */
  async available(): Promise<boolean> {
    if (!this.flag('userMemory.enabled', true)) return false
    return this.store.available()
  }

  /** 召回：取最近 maxScan 条 → 词法相关度排序 → 前 topK 条（每轮路由用一次）。 */
  async retrieve(
    userId: string,
    workspaceId: string,
    query: string,
    topK?: number,
  ): Promise<UserMemoryRecord[]> {
    if (!this.flag('userMemory.enabled', true)) return []
    const k = topK ?? this.num('userMemory.recallTopK', 5)
    if (k <= 0) return []
    const records = await this.store.list(userId, workspaceId, this.num('userMemory.maxScan', 200))
    return rankMemories(records, query, Date.now(), k)
  }

  /** 列表（管理 API 用）：按最近更新在前。 */
  async list(userId: string, workspaceId: string): Promise<UserMemoryRecord[]> {
    return this.store.list(userId, workspaceId, this.num('userMemory.maxScan', 200))
  }

  /** 软删一条（作用域限 userId）。 */
  async remove(id: string, userId: string): Promise<boolean> {
    return this.store.remove(id, userId)
  }

  /**
   * 轮末异步提取并落库（fire-and-forget 调用，不 await）。任何失败只 warn，不影响本轮。
   * 只在开关开 + 存储可用 + 该会话没有在跑的提取时才工作。
   */
  async extractAndStore(
    session: AgentSession,
    result: RunGraphResult,
    userMessage: string,
  ): Promise<void> {
    if (!this.flag('userMemory.enabled', true) || !this.flag('userMemory.extractEnabled', true)) {
      return
    }
    if (!(await this.store.available())) return
    if (this.inflight.has(session.id)) return

    this.inflight.add(session.id)
    try {
      const candidates = await this.extractor.extract(this.buildInput(session, result, userMessage))
      const capped = capCandidates(candidates, this.num('userMemory.extractMaxPerTurn', 5))
      if (capped.length === 0) return

      const now = Date.now()
      const records: UserMemoryRecord[] = capped.map((c) => ({
        id: `mem_${shortId()}`,
        userId: session.userId,
        workspaceId: session.workspaceId,
        kind: c.kind,
        key: c.key,
        value: c.value,
        confidence: c.confidence,
        sourceSessionId: session.id,
        state: 'active',
        createdAt: now,
        updatedAt: now,
      }))
      await this.store.upsertMany(records)
      this.logger.log(`用户 ${session.userId} 落库 ${records.length} 条长期记忆`)
    } catch (err) {
      this.logger.warn(`用户记忆落库失败：${(err as Error).message}`)
    } finally {
      this.inflight.delete(session.id)
    }
  }

  /** 从会话状态里凑提取输入：台账里的近轮问答 + 领域事实 + 产物。 */
  private buildInput(session: AgentSession, result: RunGraphResult, userMessage: string): ExtractionInput {
    const metadata = session.metadata ?? {}
    const ledger = Array.isArray(metadata.turnLedger) ? (metadata.turnLedger as any[]) : []
    const recentTurns: { role: string; content: string }[] = []
    for (const entry of ledger.slice(-8)) {
      const ask = typeof entry?.ask === 'string' ? entry.ask : entry?.normAsk
      if (typeof ask === 'string' && ask.trim()) recentTurns.push({ role: 'user', content: ask.trim() })
    }
    // 台账可能没跟上（比如首轮），补上本轮用户原话。
    if (userMessage?.trim()) recentTurns.push({ role: 'user', content: userMessage.trim() })
    if (result.finalContent?.trim()) recentTurns.push({ role: 'assistant', content: result.finalContent.trim() })

    return {
      recentTurns,
      facts: (metadata.sessionFacts ?? {}) as Record<string, unknown>,
      artifacts: metadata.artifacts ?? {},
    }
  }
}
