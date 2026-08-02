import { Inject, Injectable, Logger } from '@nestjs/common'
import Redis from 'ioredis'

const SCHEMA_TTL = 3600 // 1 hour
const PERMISSION_TTL = 300 // 5 minutes
const SCHEMA_PREFIX = 'schema:'
const PERMISSION_PREFIX = 'permission:'

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name)

  constructor(@Inject('REDIS_CLIENT') private redis: Redis) {}

  // ==================== Schema 缓存 ====================

  async getFormSchema(formId: string): Promise<any | null> {
    const key = `${SCHEMA_PREFIX}${formId}`
    try {
      const cached = await this.redis.get(key)
      if (cached) {
        this.logger.debug(`Schema cache HIT: ${formId}`)
        return JSON.parse(cached)
      }
      this.logger.debug(`Schema cache MISS: ${formId}`)
      return null
    } catch (err) {
      this.logger.warn(`Redis get error for ${formId}: ${err}`)
      return null
    }
  }

  async setFormSchema(formId: string, schema: any): Promise<void> {
    const key = `${SCHEMA_PREFIX}${formId}`
    try {
      await this.redis.set(key, JSON.stringify(schema), 'EX', SCHEMA_TTL)
    } catch (err) {
      this.logger.warn(`Redis set error for ${formId}: ${err}`)
    }
  }

  async invalidateFormSchema(formId: string): Promise<void> {
    const key = `${SCHEMA_PREFIX}${formId}`
    try {
      await this.redis.del(key)
      this.logger.debug(`Schema cache INVALIDATED: ${formId}`)
    } catch (err) {
      this.logger.warn(`Redis del error for ${formId}: ${err}`)
    }
  }

  /** 批量失效：表单发布后，清除所有版本相关的缓存 */
  async invalidateFormCache(formId: string): Promise<void> {
    try {
      const keys = await this.redis.keys(`${SCHEMA_PREFIX}${formId}*`)
      if (keys.length > 0) {
        await this.redis.del(keys)
        this.logger.debug(`Schema cache BULK INVALIDATED: ${formId} (${keys.length} keys)`)
      }
    } catch (err) {
      this.logger.warn(`Redis keys/del error for ${formId}: ${err}`)
    }
  }

  // ==================== 权限缓存 ====================

  async getUserPermissions(workspaceId: string, userId: string): Promise<string[] | null> {
    const key = `${PERMISSION_PREFIX}${workspaceId}:${userId}`
    try {
      const cached = await this.redis.get(key)
      return cached ? JSON.parse(cached) : null
    } catch {
      return null
    }
  }

  async setUserPermissions(workspaceId: string, userId: string, permissions: string[]): Promise<void> {
    const key = `${PERMISSION_PREFIX}${workspaceId}:${userId}`
    try {
      await this.redis.set(key, JSON.stringify(permissions), 'EX', PERMISSION_TTL)
    } catch (err) {
      this.logger.warn(`Redis set permissions error: ${err}`)
    }
  }

  async invalidateUserPermissions(workspaceId: string, userId?: string): Promise<void> {
    try {
      const pattern = userId
        ? `${PERMISSION_PREFIX}${workspaceId}:${userId}`
        : `${PERMISSION_PREFIX}${workspaceId}:*`
      const keys = await this.redis.keys(pattern)
      if (keys.length > 0) {
        await this.redis.del(keys)
      }
    } catch (err) {
      this.logger.warn(`Redis invalidate permissions error: ${err}`)
    }
  }

  /** 启动时清空所有权限缓存，防止旧数据残留 */
  async clearAllPermissionCache(): Promise<void> {
    try {
      const keys = await this.redis.keys(`${PERMISSION_PREFIX}*`)
      if (keys.length > 0) {
        await this.redis.del(keys)
        this.logger.log(`Cleared ${keys.length} stale permission cache entries`)
      }
    } catch (err) {
      this.logger.warn(`Redis clear all permissions error: ${err}`)
    }
  }
}
