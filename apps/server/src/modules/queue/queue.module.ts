import { Module } from '@nestjs/common'
import { QueueService } from './queue.service'
import { WebhookProcessor } from './processors/webhook.processor'
import { ExportProcessor } from './processors/export.processor'
import { NotificationProcessor } from './processors/notification.processor'

@Module({
  providers: [QueueService, WebhookProcessor, ExportProcessor, NotificationProcessor],
  exports: [QueueService],
})
export class QueueProcessorModule {}
