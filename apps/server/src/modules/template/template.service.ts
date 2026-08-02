import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'

@Injectable()
export class TemplateService {
  constructor(private prisma: PrismaClient) {}

  async list(query: { page?: number; pageSize?: number; category?: string; keyword?: string }) {
    const page = Number(query.page) || 1
    const pageSize = Number(query.pageSize) || 20
    const where: any = { status: { in: ['approved', 'pending'] } }
    if (query.category) where.category = query.category
    if (query.keyword) {
      where.OR = [
        { name: { contains: query.keyword } },
        { description: { contains: query.keyword } },
      ]
    }

    const [list, total] = await Promise.all([
      this.prisma.template.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { usageCount: 'desc' },
      }),
      this.prisma.template.count({ where }),
    ])

    return {
      list,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    }
  }

  async getById(id: string) {
    const tpl = await this.prisma.template.findUnique({ where: { id } })
    if (!tpl) throw new NotFoundException('模板不存在')
    return tpl
  }

  async create(userId: string, dto: {
    name: string; description?: string; schema: any
    category?: string; tags?: string[]
  }) {
    return this.prisma.template.create({
      data: { ...dto, authorId: userId },
    })
  }

  async update(id: string, dto: {
    name?: string; description?: string; schema?: any
    category?: string; tags?: string[]; status?: string
  }) {
    return this.prisma.template.update({ where: { id }, data: dto })
  }

  async remove(id: string) {
    return this.prisma.template.delete({ where: { id } })
  }

  async review(id: string, status: 'approved' | 'rejected') {
    return this.prisma.template.update({ where: { id }, data: { status } })
  }

  async getCategories() {
    const result = await this.prisma.template.groupBy({
      by: ['category'],
      where: { status: 'approved', category: { not: null } },
      _count: true,
    })
    return result
      .filter((r: any) => r.category)
      .map((r: any) => ({ name: r.category, count: r._count }))
  }

  async use(id: string, workspaceId: string, userId: string) {
    const template = await this.prisma.template.findUnique({ where: { id } })
    if (!template) throw new NotFoundException('模板不存在')

    // 增加使用次数
    await this.prisma.template.update({
      where: { id },
      data: { usageCount: { increment: 1 } },
    })

    // Fork 到工作空间
    return this.prisma.form.create({
      data: {
        workspaceId,
        name: template.name,
        description: template.description,
        schema: template.schema as any,
        category: template.category,
        tags: template.tags as any,
        createdBy: userId,
        updatedBy: userId,
      },
    })
  }
}
