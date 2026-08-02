import { Injectable } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bullmq'
import { Queue } from 'bullmq'

@Injectable()
export class QueueService {
  constructor(
    @InjectQueue('webhook') private webhookQueue: Queue,
    @InjectQueue('export') private exportQueue: Queue,
    @InjectQueue('notification') private notificationQueue: Queue,
  ) {}

  async enqueueWebhook(params: {
    url: string
    secret: string
    event: string
    payload: any
    webhookId: string
    retryCount: number
  }) {
    return this.webhookQueue.add('webhook-delivery', params, {
      attempts: params.retryCount + 1,
      backoff: { type: 'exponential', delay: 2000 },
    })
  }

  async enqueueExport(params: {
    workspaceId: string
    formId: string
    format: 'csv' | 'excel'
    userId: string
  }) {
    return this.exportQueue.add('data-export', params)
  }

  async enqueueNotification(params: {
    type: string
    userId: string
    workspaceId?: string
    title: string
    content: string
    email?: string
    relatedType?: string
    relatedId?: string
  }) {
    return this.notificationQueue.add('send-notification', params)
  }
}
