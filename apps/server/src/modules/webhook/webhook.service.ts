import { Injectable, NotFoundException, Optional } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import { QueueService } from '../queue/queue.service'
import * as crypto from 'crypto'

@Injectable()
export class WebhookService {
  constructor(
    private prisma: PrismaClient,
    @Optional() private queue?: QueueService,
  ) {}

  async list(formId: string) {
    return this.prisma.webhook.findMany({ where: { formId } })
  }

  async create(formId: string, dto: { url: string; events: string[]; secret?: string }) {
    return this.prisma.webhook.create({ data: { formId, ...dto } })
  }

  async update(id: string, dto: { url?: string; events?: string[]; isActive?: boolean; secret?: string }) {
    return this.prisma.webhook.update({ where: { id }, data: dto })
  }

  async remove(id: string) {
    return this.prisma.webhook.delete({ where: { id } })
  }

  async getById(id: string) {
    const webhook = await this.prisma.webhook.findUnique({ where: { id } })
    if (!webhook) throw new NotFoundException('Webhook 不存在')
    return webhook
  }

  /**
   * 触发 Webhook 事件 — 通过 BullMQ 异步投递
   */
  async trigger(formId: string, event: string, payload: any) {
    const allHooks = await this.prisma.webhook.findMany({
      where: { formId, isActive: true },
    })
    const webhooks = allHooks.filter((wh: any) => {
      const events: string[] = (wh.events as any) ?? []
      return events.includes(event)
    })

    for (const wh of webhooks) {
      if (this.queue) {
        await this.queue.enqueueWebhook({
          url: wh.url,
          secret: wh.secret || '',
          event,
          payload,
          webhookId: wh.id,
          retryCount: wh.retryCount,
        })
      } else {
        // 无消息队列时直接发送（fire-and-forget）
        this.sendDirect(wh.url, wh.secret || '', event, payload).catch(() => {})
      }
    }
  }

  private async sendDirect(url: string, secret: string, event: string, payload: any) {
    const body = JSON.stringify(payload)
    const signature = secret
      ? crypto.createHmac('sha256', secret).update(body).digest('hex')
      : ''
    await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-FurmX-Signature': signature,
        'X-FurmX-Event': event,
      },
      body,
      signal: AbortSignal.timeout(10000),
    })
  }

  /** 手动重试失败的投递 */
  async retryDelivery(deliveryId: string) {
    const delivery = await this.prisma.webhookDelivery.findUnique({
      where: { id: deliveryId },
      include: { webhook: true },
    })
    if (!delivery) throw new NotFoundException('投递记录不存在')
    if (!this.queue) throw new Error('消息队列不可用')

    return this.queue.enqueueWebhook({
      url: delivery.webhook.url,
      secret: delivery.webhook.secret || '',
      event: delivery.event,
      payload: {},
      webhookId: delivery.webhookId,
      retryCount: 1,
    })
  }

  /** 测试 Webhook（发送 ping 事件） */
  async test(id: string) {
    const webhook = await this.getById(id)

    const payload = { event: 'ping', timestamp: new Date().toISOString(), webhookId: id }
    const body = JSON.stringify(payload)
    const signature = webhook.secret
      ? crypto.createHmac('sha256', webhook.secret).update(body).digest('hex')
      : ''

    const start = Date.now()
    const response = await fetch(webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-FurmX-Signature': signature,
        'X-FurmX-Event': 'ping',
      },
      body,
      signal: AbortSignal.timeout(10000),
    })
    const duration = Date.now() - start

    await this.prisma.webhookDelivery.create({
      data: {
        webhookId: id,
        event: 'ping',
        status: response.status,
        duration,
        error: response.ok ? null : `HTTP ${response.status}`,
      },
    })

    return { status: response.status, duration }
  }

  /** 查询 Webhook 投递历史 */
  async getDeliveries(webhookId: string, query: { page?: number; pageSize?: number }) {
    const page = Number(query.page) || 1
    const pageSize = Number(query.pageSize) || 20

    const [list, total] = await Promise.all([
      this.prisma.webhookDelivery.findMany({
        where: { webhookId },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.webhookDelivery.count({ where: { webhookId } }),
    ])

    return {
      list,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    }
  }

  /** 记录投递结果（由 WebhookProcessor 调用） */
  async recordDelivery(data: {
    webhookId: string
    event: string
    status: number
    duration: number
    error?: string
  }) {
    return this.prisma.webhookDelivery.create({ data })
  }
}
