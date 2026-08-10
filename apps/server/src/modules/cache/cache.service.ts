import { Inject, Injectable, Logger } from '@nestjs/common'
import Redis from 'ioredis'

const SCHEMA_TTL = 3600 // 1 hour
const PERMISSION_TTL = 300 // 5 minutes
const SCHEMA_PREFIX = 'schema:'
const PERMISSION_PREFIX = 'permission:'

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name)
  private readonly redis: Redis | null

  constructor(@Inject('REDIS_CLIENT') redis: Redis | null) {
    this.redis = redis
    if (!redis) {
      this.logger.warn('Redis 未配置，缓存功能已禁用')
    }
  }

  private get connected(): boolean {
    return this.redis !== null
  }

  // ==================== Schema 缓存 ====================

  async getFormSchema(formId: string): Promise<unknown | null> {
    if (!this.connected) return null
    const key = `${SCHEMA_PREFIX}${formId}`
    try {
      const cached = await this.redis!.get(key)
      if (cached) return JSON.parse(cached)
      return null
    } catch {
      return null
    }
  }

  async setFormSchema(formId: string, schema: unknown): Promise<void> {
    if (!this.connected) return
    const key = `${SCHEMA_PREFIX}${formId}`
    try {
      await this.redis!.set(key, JSON.stringify(schema), 'EX', SCHEMA_TTL)
    } catch {
      // 静默
    }
  }

  async invalidateFormSchema(formId: string): Promise<void> {
    if (!this.connected) return
    const key = `${SCHEMA_PREFIX}${formId}`
    try {
      await this.redis!.del(key)
    } catch {
      // 静默
    }
  }

  async invalidateFormCache(formId: string): Promise<void> {
    if (!this.connected) return
    try {
      const keys = await this.redis!.keys(`${SCHEMA_PREFIX}${formId}*`)
      if (keys.length > 0) await this.redis!.del(keys)
    } catch {
      // 静默
    }
  }

  // ==================== 权限缓存 ====================

  async getUserPermissions(_workspaceId: string, _userId: string): Promise<string[] | null> {
    if (!this.connected) return null
    const key = `${PERMISSION_PREFIX}${_workspaceId}:${_userId}`
    try {
      const cached = await this.redis!.get(key)
      return cached ? JSON.parse(cached) : null
    } catch {
      return null
    }
  }

  async setUserPermissions(_workspaceId: string, _userId: string, permissions: string[]): Promise<void> {
    if (!this.connected) return
    const key = `${PERMISSION_PREFIX}${_workspaceId}:${_userId}`
    try {
      await this.redis!.set(key, JSON.stringify(permissions), 'EX', PERMISSION_TTL)
    } catch {
      // 静默
    }
  }

  async invalidateUserPermissions(_workspaceId: string, _userId?: string): Promise<void> {
    if (!this.connected) return
    try {
      const pattern = _userId
        ? `${PERMISSION_PREFIX}${_workspaceId}:${_userId}`
        : `${PERMISSION_PREFIX}${_workspaceId}:*`
      const keys = await this.redis!.keys(pattern)
      if (keys.length > 0) await this.redis!.del(keys)
    } catch {
      // 静默
    }
  }

  async clearAllPermissionCache(): Promise<void> {
    if (!this.connected) return
    try {
      const keys = await this.redis!.keys(`${PERMISSION_PREFIX}*`)
      if (keys.length > 0) {
        await this.redis!.del(keys)
        this.logger.log(`Cleared ${keys.length} stale permission cache entries`)
      }
    } catch {
      // 静默
    }
  }
}
