import { Global, Module, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Redis from 'ioredis'

@Global()
@Module({
  providers: [
    {
      provide: 'REDIS_CLIENT',
      useFactory: (config: ConfigService) => {
        const host = config.get<string>('REDIS_HOST')
        // 未配置 Redis 时直接跳过，不尝试连接
        if (!host) {
          return null
        }

        const logger = new Logger('RedisModule')
        const redis = new Redis({
          host,
          port: config.get<number>('REDIS_PORT', 6379),
          maxRetriesPerRequest: null,
          enableOfflineQueue: false,
          lazyConnect: true,
          retryStrategy() {
            return null
          },
        })

        redis.on('error', () => {
          // 静默吞掉连接错误
        })

        redis.connect().catch(() => {
          logger.warn('Redis 不可用，缓存功能禁用')
        })

        return redis
      },
      inject: [ConfigService],
    },
  ],
  exports: ['REDIS_CLIENT'],
})
export class RedisModule {}
