import { Injectable, Optional } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import { QueueService } from '../queue/queue.service'

@Injectable()
export class NotificationService {
  constructor(
    private prisma: PrismaClient,
    @Optional() private queue?: QueueService,
  ) {}

  async send(params: {
    userId: string
    workspaceId?: string
    type: string
    title: string
    content: string
    relatedType?: string
    relatedId?: string
    sendEmail?: boolean
    email?: string
  }) {
    // 1. 保存站内信
    const notification = await this.prisma.notification.create({
      data: {
        userId: params.userId,
        workspaceId: params.workspaceId,
        type: params.type,
        title: params.title,
        content: params.content,
        relatedType: params.relatedType,
        relatedId: params.relatedId,
      },
    })

    // 2. 如果需要发邮件，入队异步处理（队列不可用时跳过）
    if (this.queue && params.sendEmail && params.email) {
      await this.queue.enqueueNotification({
        type: params.type,
        userId: params.userId,
        title: params.title,
        content: params.content,
        email: params.email,
        relatedType: params.relatedType,
        relatedId: params.relatedId,
      })
    }

    return notification
  }

  async listForUser(userId: string, query: { page?: number; pageSize?: number; isRead?: boolean }) {
    const page = Number(query.page) || 1
    const pageSize = Number(query.pageSize) || 20
    const where: any = { userId }
    if (query.isRead !== undefined) where.isRead = query.isRead

    const [list, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.notification.count({ where }),
    ])

    return {
      list,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    }
  }

  async getUnreadCount(userId: string) {
    return this.prisma.notification.count({
      where: { userId, isRead: false },
    })
  }

  async markAsRead(id: string, userId: string) {
    return this.prisma.notification.updateMany({
      where: { id, userId },
      data: { isRead: true },
    })
  }

  async markAllAsRead(userId: string) {
    return this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    })
  }

  async remove(id: string, userId: string) {
    return this.prisma.notification.deleteMany({
      where: { id, userId },
    })
  }

  async clearAll(userId: string) {
    return this.prisma.notification.deleteMany({
      where: { userId },
    })
  }
}
