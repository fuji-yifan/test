import { Module, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Redis from 'ioredis'

/** Redis 客户端注入令牌（与 server 的 common/redis.module.ts 对齐） */
export const REDIS_CLIENT = 'REDIS_CLIENT'

/**
 * Agent 侧 Redis 客户端（阶段 4 / 4.5）。
 *
 * 只服务「只读工具结果缓存」这一处用途。与 server 同款语义：
 * - `cache.redisHost` 未配置 → 提供 `null`（缓存整体 no-op，等于未引入 Redis 的现状）；
 * - `lazyConnect` + `enableOfflineQueue:false` + `retryStrategy→null`，连不上就静默降级，
 *   绝不让 Redis 抖动拖垮 agent 主流程。
 */
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: (config: ConfigService) => {
        const host = config.get<string>('cache.redisHost')
        if (!host) return null

        const logger = new Logger('AgentRedisModule')
        const redis = new Redis({
          host,
          port: config.get<number>('cache.redisPort') ?? 6379,
          maxRetriesPerRequest: null,
          enableOfflineQueue: false,
          lazyConnect: true,
          retryStrategy() {
            return null
          },
        })

        // 静默吞掉连接错误；连接失败时缓存自动退化为 no-op
        redis.on('error', () => {})
        redis.connect().catch(() => logger.warn('Redis 不可用，只读工具缓存禁用'))

        return redis
      },
      inject: [ConfigService],
    },
  ],
  exports: [REDIS_CLIENT],
})
export class AgentRedisModule {}
