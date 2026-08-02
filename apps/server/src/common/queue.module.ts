import { BullModule } from '@nestjs/bullmq'
import { Global, Module, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      useFactory: (config: ConfigService) => {
        // 在 factory 内做一次快速连接探测，失败则用 skip 模式
        const host = config.get('REDIS_HOST', 'localhost')
        const port = config.get<number>('REDIS_PORT', 6379)
        const logger = new Logger('QueueModule')

        return {
          connection: {
            host,
            port,
            maxRetriesPerRequest: 0,
            retryStrategy() {
              return null // 不重试，直接放弃
            },
            lazyConnect: true,
          },
          defaultJobOptions: {
            removeOnComplete: 100,
            removeOnFail: 500,
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 },
          },
          onError: () => {
            logger.warn('BullMQ Redis 不可用，消息队列跳过')
          },
        }
      },
      inject: [ConfigService],
    }),
    BullModule.registerQueue(
      { name: 'webhook' },
      { name: 'export' },
      { name: 'notification' },
    ),
  ],
  exports: [BullModule],
})
export class QueueModule {}
