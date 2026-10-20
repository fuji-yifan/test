import { Global, Module } from '@nestjs/common'
import { QueueService } from './queue.service'
import { WebhookProcessor } from './processors/webhook.processor'
import { ExportProcessor } from './processors/export.processor'
import { NotificationProcessor } from './processors/notification.processor'

/**
 * 全局导出 QueueService，WebhookService / NotificationService 无需逐个 import 即可注入。
 * 此前因 Redis 不可用被移出 AppModule，QueueService 以 @Optional() 降级；Redis 就绪后恢复。
 */
@Global()
@Module({
  providers: [QueueService, WebhookProcessor, ExportProcessor, NotificationProcessor],
  exports: [QueueService],
})
export class QueueProcessorModule {}
