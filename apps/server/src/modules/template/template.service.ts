import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'

@Injectable()
export class TemplateService {
  constructor(private prisma: PrismaClient) {}

  async list(query: { page?: number; pageSize?: number; category?: string; keyword?: string }) {
    const page = Number(query.page) || 1
    const pageSize = Number(query.pageSize) || 20
    // 先按 category 过滤，keyword 在客户端做（因为 tags 是 JSON 数组无法用 Prisma contains）
    const where: any = { status: { in: ['approved', 'pending'] } }
    if (query.category) where.category = query.category

    const [list, total] = await Promise.all([
      this.prisma.template.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { usageCount: 'desc' },
      }),
      this.prisma.template.count({ where }),
    ])

    // 客户端过滤：同时搜 name、description、category、tags
    let filteredList = list
    if (query.keyword) {
      const kw = query.keyword
      filteredList = list.filter((t: any) => {
        if (t.name?.includes(kw) || t.description?.includes(kw) || t.category?.includes(kw)) return true
        const tags: string[] = Array.isArray(t.tags) ? t.tags : (typeof t.tags === 'string' ? JSON.parse(t.tags) : [])
        return tags.some((tag: string) => tag.includes(kw))
      })
    }

    return {
      list: filteredList,
      pagination: { page, pageSize, total: filteredList.length, totalPages: Math.ceil(filteredList.length / pageSize) },
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
    const { name, description, schema, category, tags } = dto
    return this.prisma.template.create({
      data: { name, description, schema, category, tags, authorId: userId },
    })
  }

  async update(id: string, dto: {
    name?: string; description?: string; schema?: any
    category?: string; tags?: string[]; status?: string
  }) {
    const { name, description, schema, category, tags, status } = dto
    return this.prisma.template.update({
      where: { id },
      data: { name, description, schema, category, tags, status },
    })
  }

  async remove(id: string) {
    return this.prisma.template.delete({ where: { id } })
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
