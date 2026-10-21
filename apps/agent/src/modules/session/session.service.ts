import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common'
import { SessionStore, AgentSession } from './session.store'

/** 会话被另一副本占用（跨副本无法抢占，安全优先：直接回绝而非双写）。 */
export class SessionBusyError extends Error {
  constructor(message = '会话正在另一副本执行中，请稍后重试') {
    super(message)
    this.name = 'SessionBusyError'
  }
}

@Injectable()
export class SessionService implements OnModuleDestroy {
  private readonly logger = new Logger(SessionService.name)

  /**
   * 当前正在执行的那一轮请求的取消句柄。
   *
   * 用内存 Map 而不是 AgentSession.locked 当权威：抢占需要「找到上一轮并中止它」，
   * 布尔锁只有状态没有主体。store 里的 locked 仍会同步维护，仅用于会话列表展示。
   */
  private readonly inflight = new Map<string, AbortController>()

  /** 本进程标识（租约 owner）：同实例恒等，保证单实例路径不用等 DB。 */
  private readonly instanceId = process.env.SESSION_INSTANCE_ID || `inst_${this.nanoid()}`
  private readonly leaseTtlMs = parseInt(process.env.SESSION_LEASE_TTL_MS || '30000', 10)
  private readonly leaseHeartbeatMs = parseInt(process.env.SESSION_LEASE_HEARTBEAT_MS || '10000', 10)
  private readonly leaseEnabled = process.env.SESSION_LEASE_ENABLED !== 'false'

  /** 持租约期间的续期定时器（按会话）。 */
  private readonly leaseHeartbeats = new Map<string, ReturnType<typeof setInterval>>()

  constructor(private store: SessionStore) {}

  onModuleDestroy(): void {
    for (const timer of this.leaseHeartbeats.values()) clearInterval(timer)
    this.leaseHeartbeats.clear()
  }

  async create(params: {
    userId: string
    workspaceId: string
    scenario: string
    metadata?: Record<string, any>
  }): Promise<AgentSession> {
    const id = `sess_${this.nanoid()}`
    return this.store.create({
      id,
      userId: params.userId,
      workspaceId: params.workspaceId,
      scenario: params.scenario,
      messages: [],
      metadata: params.metadata || {},
      locked: false,
      createdAt: 0,
      updatedAt: 0,
    })
  }

  async get(id: string): Promise<AgentSession | null> {
    return this.store.get(id)
  }

  async getOrCreate(id: string | undefined, params: {
    userId: string
    workspaceId: string
    scenario: string
  }): Promise<AgentSession> {
    if (id) {
      const existing = await this.store.get(id)
      if (existing) return existing
    }
    return this.create(params)
  }

  /**
   * 纠正会话的 workspaceId。
   *
   * workspaceId 只在创建时定下来，但创建它的那次请求可能还没有这个值
   * （JWT 里没有该声明，靠前端 context 传），之后所有 serverTool 都会拿到空值。
   * 所以允许后续请求用可信值把它补回来。
   */
  async updateWorkspace(sessionId: string, workspaceId: string): Promise<AgentSession | null> {
    return this.store.update(sessionId, { workspaceId })
  }

  async addMessage(
    sessionId: string,
    message: {
      role: 'user' | 'assistant' | 'tool'
      content: string | null
      toolCalls?: any[]
      toolResults?: any[]
      /** 本条回答的 token（阶段 4 补充）：仅 assistant 用，刷新/翻历史后前端据此显示 */
      usage?: { inputTokens: number; outputTokens: number }
    },
  ): Promise<AgentSession | null> {
    const session = await this.store.get(sessionId)
    if (!session) return null

    session.messages.push({
      role: message.role,
      content: message.content,
      toolCalls: message.toolCalls || [],
      toolResults: message.toolResults || [],
      ...(message.usage ? { usage: message.usage } : {}),
      timestamp: Date.now(),
    })

    return this.store.update(sessionId, { messages: session.messages })
  }

  /**
   * 抢占式获取执行权：同一会话开始新一段对话时，自动中断上一段，而不是报
   * SESSION_BUSY（前端文案「会话正在执行中，请等待完成」）。
   *
   * 语义：最新一条消息总是赢。上一轮收到 abort 后会走到自己的 finally 让位；
   * 若它卡在不可中断的等待里（例如图已中断但 stream 没关，实测可达数分钟），
   * 等到 waitMs 后本轮直接接管 —— 此时上一轮的 signal 已 abort，不会再写入
   * 有效状态，接管是安全的。
   *
   * 抢占的等待只会发生在前一轮确实还在跑的时候；正常情况下这里没有任何延迟。
   */
  async acquireRun(
    sessionId: string,
    controller: AbortController,
    waitMs = 15000,
  ): Promise<{ preempted: boolean }> {
    // 抢占第一步：同步 abort 上一轮，让信号立刻传到 graph.stream（不因后面的 await 延后）。
    const current = this.inflight.get(sessionId)
    if (current) current.abort()

    // 进程内接管（单实例快路径，原样保留）：等待上一轮让位 / 超时强制接管，落位为持有者。
    let preempted: boolean
    if (!current) {
      this.inflight.set(sessionId, controller)
      await this.store.update(sessionId, { locked: true }).catch(() => {})
      preempted = false
    } else {
      const deadline = Date.now() + waitMs
      while (this.inflight.get(sessionId) === current && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 50))
      }
      if (this.inflight.get(sessionId) === current) {
        this.logger.warn(`会话 ${sessionId} 上一轮 ${waitMs}ms 未让出执行权，本轮强制接管`)
      }
      this.inflight.set(sessionId, controller)
      await this.store.update(sessionId, { locked: true }).catch(() => {})
      preempted = true
    }

    // 跨副本租约。安全优先：另一副本持**活**租约时，轮询等它释放/过期，等到 waitMs 仍拿不到
    // 就回绝（SessionBusyError）—— 绝不跨副本强制抢，因为跨进程无法 abort 对方正在跑的 run，
    // 硬抢会让两个副本同时写同一张图。崩溃留下的死锁由 TTL 过期回收。
    // 无 MySQL（memory/连接失败）或未启用时降级放行，等于纯内存现状。
    //
    // 必须**在进程内接管之后**取租约：owner 是进程级实例 id，被抢占的上一轮在让位时会走
    // releaseRun 释放「它以为的」租约；若本轮提前取好，会被上一轮顺手删掉、心跳也被清，
    // 于是本继任轮脱锁运行。放到接管之后，上一轮的释放先发生，本轮再取就是干净的。
    await this.ensureLease(sessionId, waitMs)

    return { preempted }
  }

  /**
   * 让出执行权。只有仍是持有者时才解锁：被抢占的那一轮退出时必须什么都不做，
   * 否则会把新一轮刚拿到的锁清掉，放进第三个并发请求。
   */
  async releaseRun(sessionId: string, controller: AbortController): Promise<void> {
    if (this.inflight.get(sessionId) !== controller) return
    this.inflight.delete(sessionId)
    this.clearHeartbeat(sessionId)
    try { await this.store.releaseLease?.(sessionId, this.instanceId) } catch {}
    await this.store.update(sessionId, { locked: false }).catch(() => {})
  }

  /** 抢租约；未实现（fake store）或关闭时降级为「直接放行」。 */
  private async tryAcquireLease(sessionId: string): Promise<{ granted: boolean; degraded: boolean }> {
    if (!this.leaseEnabled || this.leaseTtlMs <= 0) return { granted: true, degraded: true }
    if (typeof this.store.acquireLease !== 'function') return { granted: true, degraded: true }
    return this.store.acquireLease(sessionId, this.instanceId, this.leaseTtlMs)
  }

  /** 拿到租约才算进入本轮；抢不到（另一副本持活租约）→ 回绝。抢到且落库则开心跳。 */
  private async ensureLease(sessionId: string, waitMs: number): Promise<void> {
    let lease = await this.tryAcquireLease(sessionId)
    const deadline = Date.now() + waitMs
    while (!lease.granted && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100))
      lease = await this.tryAcquireLease(sessionId)
    }
    if (!lease.granted) {
      this.logger.warn(`会话 ${sessionId} 被其它副本占用且 ${waitMs}ms 内未释放，本轮回绝`)
      throw new SessionBusyError()
    }
    if (!lease.degraded) this.startHeartbeat(sessionId)
  }

  /** 持租约期间续期；续期发现已被夺走 → 让本进程自退，避免双写。 */
  private startHeartbeat(sessionId: string): void {
    this.clearHeartbeat(sessionId)
    const timer = setInterval(() => {
      this.store
        .renewLease(sessionId, this.instanceId, this.leaseTtlMs)
        .then((ok) => {
          if (!ok) {
            this.logger.warn(`会话 ${sessionId} 租约已被其它副本夺走，本进程中止该轮`)
            this.clearHeartbeat(sessionId)
            this.inflight.get(sessionId)?.abort()
          }
        })
        .catch(() => {})
    }, this.leaseHeartbeatMs)
    if (typeof timer.unref === 'function') timer.unref()
    this.leaseHeartbeats.set(sessionId, timer)
  }

  private clearHeartbeat(sessionId: string): void {
    const timer = this.leaseHeartbeats.get(sessionId)
    if (timer) {
      clearInterval(timer)
      this.leaseHeartbeats.delete(sessionId)
    }
  }

  async updateMetadata(sessionId: string, metadata: Record<string, any>): Promise<void> {
    const session = await this.store.get(sessionId)
    if (!session) return
    await this.store.update(sessionId, {
      metadata: { ...session.metadata, ...metadata },
    })
  }

  async delete(sessionId: string): Promise<void> {
    return this.store.delete(sessionId)
  }

  async listByUser(userId: string): Promise<AgentSession[]> {
    return this.store.listByUser(userId)
  }

  private nanoid(length = 12): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
    let result = ''
    for (let i = 0; i < length; i++) {
      result += chars[Math.floor(Math.random() * chars.length)]
    }
    return result
  }
}
