import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Job } from 'bullmq'
import * as crypto from 'crypto'
import { PrismaClient } from '@prisma/client'

interface WebhookJob {
  url: string
  secret: string
  event: string
  payload: any
  webhookId: string
  retryCount: number
}

@Processor('webhook')
export class WebhookProcessor extends WorkerHost {
  private prisma = new PrismaClient()

  async process(job: Job<WebhookJob>): Promise<{ status: number; duration: number }> {
    const { url, secret, event, payload, webhookId } = job.data
    const start = Date.now()

    const body = JSON.stringify(payload)

    const signature = secret
      ? crypto.createHmac('sha256', secret).update(body).digest('hex')
      : ''

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-FurmX-Signature': signature,
          'X-FurmX-Event': event,
          'X-FurmX-Delivery': job.id || '',
        },
        body,
        signal: AbortSignal.timeout(15000),
      })

      const duration = Date.now() - start

      // 记录投递结果
      await this.prisma.webhookDelivery.create({
        data: {
          webhookId,
          event,
          status: response.status,
          duration,
          error: response.ok ? null : `HTTP ${response.status}`,
        },
      })

      if (!response.ok && response.status >= 500) {
        throw new Error(`Webhook ${url} responded with ${response.status} (retry)`)
      }

      return { status: response.status, duration }
    } catch (err: any) {
      const duration = Date.now() - start
      // 只在最终失败时记录（非重试）
      if (job.attemptsMade >= (job.opts?.attempts || 1) - 1) {
        await this.prisma.webhookDelivery.create({
          data: {
            webhookId,
            event,
            status: 0,
            duration,
            error: err.message || 'Unknown error',
          },
        })
      }
      throw err
    }
  }
}
