import { Injectable, Logger } from '@nestjs/common'
import { SessionStore, AgentSession } from './session.store'

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name)

  /**
   * 当前正在执行的那一轮请求的取消句柄。
   *
   * 用内存 Map 而不是 AgentSession.locked 当权威：抢占需要「找到上一轮并中止它」，
   * 布尔锁只有状态没有主体。store 里的 locked 仍会同步维护，仅用于会话列表展示。
   */
  private readonly inflight = new Map<string, AbortController>()

  constructor(private store: SessionStore) {}

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
    message: { role: 'user' | 'assistant' | 'tool'; content: string | null; toolCalls?: any[]; toolResults?: any[] },
  ): Promise<AgentSession | null> {
    const session = await this.store.get(sessionId)
    if (!session) return null

    session.messages.push({
      role: message.role,
      content: message.content,
      toolCalls: message.toolCalls || [],
      toolResults: message.toolResults || [],
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
    const current = this.inflight.get(sessionId)
    if (!current) {
      this.inflight.set(sessionId, controller)
      await this.store.update(sessionId, { locked: true }).catch(() => {})
      return { preempted: false }
    }

    current.abort()
    const deadline = Date.now() + waitMs
    while (this.inflight.get(sessionId) === current && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50))
    }
    if (this.inflight.get(sessionId) === current) {
      this.logger.warn(`会话 ${sessionId} 上一轮 ${waitMs}ms 未让出执行权，本轮强制接管`)
    }
    this.inflight.set(sessionId, controller)
    await this.store.update(sessionId, { locked: true }).catch(() => {})
    return { preempted: true }
  }

  /**
   * 让出执行权。只有仍是持有者时才解锁：被抢占的那一轮退出时必须什么都不做，
   * 否则会把新一轮刚拿到的锁清掉，放进第三个并发请求。
   */
  async releaseRun(sessionId: string, controller: AbortController): Promise<void> {
    if (this.inflight.get(sessionId) !== controller) return
    this.inflight.delete(sessionId)
    await this.store.update(sessionId, { locked: false }).catch(() => {})
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
