import { Injectable, Logger } from '@nestjs/common'
import { SessionStore, AgentSession } from './session.store'

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name)

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

  async lock(sessionId: string): Promise<boolean> {
    const session = await this.store.get(sessionId)
    if (!session) return false
    if (session.locked) return false
    await this.store.update(sessionId, { locked: true })
    return true
  }

  async unlock(sessionId: string): Promise<void> {
    await this.store.update(sessionId, { locked: false })
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
