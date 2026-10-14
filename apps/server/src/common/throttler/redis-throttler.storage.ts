import { Inject, Injectable, Logger } from '@nestjs/common'
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler'
import type Redis from 'ioredis'

/** `ThrottlerStorageRecord` 未从包根导出，从接口方法推导。 */
type ThrottlerStorageRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>

/**
 * 限流计数器存储（阶段 6 / S6.1）：**Redis 有则用、无则回退内存**。
 *
 * - `REDIS_HOST` 未设 / 未连上 → 委托 `ThrottlerStorageService`（进程内，等价于「没配 Redis 的现状」）；
 * - Redis 就绪 → `INCR`（首次 `PEXPIRE`，窗口 TTL 单位 ms），`PTTL` 换算成秒返回。
 *
 * 与仓内 `REDIS_CLIENT` 可空范式一致：Redis 抖动时**不抛**，回退内存并 `warnOnce`。
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name)
  private readonly fallback = new ThrottlerStorageService()
  private warned = false

  constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis | null) {}

  async increment(key: string, ttl: number): Promise<ThrottlerStorageRecord> {
    const redis = this.redis
    if (!redis || redis.status !== 'ready') {
      return this.fallback.increment(key, ttl)
    }
    try {
      const redisKey = `throttle:${key}`
      const totalHits = await redis.incr(redisKey)
      if (totalHits === 1) await redis.pexpire(redisKey, ttl)
      const pttl = await redis.pttl(redisKey)
      return { totalHits, timeToExpire: Math.ceil(Math.max(pttl, 0) / 1000) }
    } catch (err) {
      this.warnOnce((err as Error)?.message ?? String(err))
      return this.fallback.increment(key, ttl)
    }
  }

  private warnOnce(msg: string): void {
    if (this.warned) return
    this.warned = true
    this.logger.warn(`限流 Redis 存储不可用（${msg}），回退内存计数`)
  }
}
