import { Global, Module, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Redis from 'ioredis'

@Global()
@Module({
  providers: [
    {
      provide: 'REDIS_CLIENT',
      useFactory: (config: ConfigService) => {
        const logger = new Logger('RedisModule')
        const redis = new Redis({
          host: config.get('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
          maxRetriesPerRequest: null,
          enableOfflineQueue: false,
          lazyConnect: true,
          retryStrategy() {
            return null // 不重试
          },
        })

        redis.on('error', () => {
          // 静默吞掉，避免 Unhandled error
        })

        redis.connect().catch(() => {
          logger.warn('Redis 不可用，缓存功能跳过')
        })

        return redis
      },
      inject: [ConfigService],
    },
  ],
  exports: ['REDIS_CLIENT'],
})
export class RedisModule {}
