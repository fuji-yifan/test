import { Injectable } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'

@Injectable()
export class NotificationService {
  constructor(private prisma: PrismaClient) {}

  async send(params: {
    userId: string
    workspaceId?: string
    type: string
    title: string
    content: string
    relatedType?: string
    relatedId?: string
  }) {
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
