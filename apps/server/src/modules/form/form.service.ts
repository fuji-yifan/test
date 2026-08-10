import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import { CacheService } from '../cache/cache.service'

@Injectable()
export class FormService {
  constructor(
    private prisma: PrismaClient,
    private cache: CacheService,
  ) {}

  async list(workspaceId: string, query: { page?: number; pageSize?: number; status?: string; category?: string; keyword?: string }) {
    const page = Number(query.page) || 1
    const pageSize = Number(query.pageSize) || 20
    const where: any = { workspaceId, deletedAt: null }
    if (query.status) where.status = query.status
    if (query.category) where.category = query.category
    if (query.keyword) where.name = { contains: query.keyword }

    const [list, total] = await Promise.all([
      this.prisma.form.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.form.count({ where }),
    ])

    return {
      list,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    }
  }

  async create(workspaceId: string, userId: string, dto: { name: string; description?: string; category?: string }) {
    return this.prisma.form.create({
      data: {
        workspaceId,
        name: dto.name,
        description: dto.description || '',
        category: dto.category || null,
        createdBy: userId,
        updatedBy: userId,
      },
    })
  }

  async getById(id: string) {
    const form = await this.prisma.form.findUnique({
      where: { id },
      include: { versions: { orderBy: { version: 'desc' }, take: 10 } },
    })
    if (!form || form.deletedAt) throw new NotFoundException('表单不存在')
    return form
  }

  async update(id: string, userId: string, dto: { name?: string; description?: string; category?: string; schema?: any; settings?: any; targetVersion?: number }) {
    // 如果 Schema 更新，保存版本快照
    if (dto.schema) {
      // 指定目标版本 → 覆盖已有版本；否则 → 新建版本
      if (dto.targetVersion && dto.targetVersion > 0) {
        await this.prisma.formVersion.update({
          where: { formId_version: { formId: id, version: dto.targetVersion } },
          data: { schema: dto.schema, createdBy: userId },
        })
      } else {
        const lastVersion = await this.prisma.formVersion.findFirst({
          where: { formId: id },
          orderBy: { version: 'desc' },
          select: { version: true },
        })
        const nextVersion = (lastVersion?.version || 0) + 1

        await this.prisma.formVersion.upsert({
          where: { formId_version: { formId: id, version: nextVersion } },
          create: {
            formId: id,
            version: nextVersion,
            schema: dto.schema,
            createdBy: userId,
          },
          update: {
            schema: dto.schema,
            createdBy: userId,
          },
        })
      }

      // 失效 Schema 缓存
      await this.cache.invalidateFormSchema(id)
    }

    // 剥离 targetVersion（只用于版本快照，不是 Form 表的字段）
    const { targetVersion, ...formData } = dto
    return this.prisma.form.update({
      where: { id },
      data: { ...formData, updatedBy: userId },
    })
  }

  async remove(id: string) {
    return this.prisma.form.update({
      where: { id },
      data: { deletedAt: new Date() },
    })
  }

  async publish(id: string, userId: string) {
    // 将当前最新版本号记为已发布版本（而非独立自增计数器）
    const lastVersion = await this.prisma.formVersion.findFirst({
      where: { formId: id },
      orderBy: { version: 'desc' },
      select: { version: true },
    })
    const currentVersion = lastVersion?.version || 0

    const now = new Date()
    const result = await this.prisma.form.update({
      where: { id },
      data: {
        status: 'published',
        publishedAt: now,
        publishedVersion: currentVersion,
        updatedBy: userId,
      },
    })
    // 发布后失效缓存，新版本 Schema 需重新获取
    await this.cache.invalidateFormCache(id)
    return result
  }

  async archive(id: string) {
    return this.prisma.form.update({
      where: { id },
      data: { status: 'archived' },
    })
  }

  async fork(id: string, workspaceId: string, userId: string) {
    const source = await this.prisma.form.findUnique({ where: { id } })
    if (!source) throw new NotFoundException('源表单不存在')

    return this.prisma.form.create({
      data: {
        workspaceId,
        name: `${source.name} (副本)`,
        description: source.description,
        schema: source.schema as any,
        settings: { ...(source.settings as any), forkedFrom: id },
        createdBy: userId,
        updatedBy: userId,
      },
    })
  }

  async getVersions(formId: string) {
    return this.prisma.formVersion.findMany({
      where: { formId },
      orderBy: { version: 'desc' },
    })
  }

  async deleteVersion(formId: string, version: number) {
    // 不允许删除当前已发布版本
    const form = await this.prisma.form.findUnique({ where: { id: formId }, select: { publishedVersion: true } })
    if (form && form.publishedVersion === version) {
      throw new Error('不能删除当前已发布的版本')
    }
    return this.prisma.formVersion.delete({
      where: { formId_version: { formId, version } },
    })
  }

  /**
   * 获取已发布的表单 Schema（供 Renderer 公开访问）
   */
  async getPublished(id: string) {
    const form = await this.prisma.form.findFirst({
      where: { id, status: 'published', deletedAt: null },
      select: {
        id: true,
        name: true,
        schema: true,
        settings: true,
        publishedVersion: true,
      },
    })
    if (!form) throw new NotFoundException('表单不存在或未发布')
    return form
  }

  /**
   * Schema 版本兼容性检查
   * 当前端有历史数据（dataVersion）要渲染时，对比当前 Schema 版本
   * 返回是否需要兼容处理以及版本变更信息
   */
  async checkCompatibility(formId: string, dataVersion?: number) {
    const form = await this.prisma.form.findUnique({
      where: { id: formId },
      select: { publishedVersion: true, schema: true, deletedAt: true },
    })
    if (!form || form.deletedAt) throw new NotFoundException('表单不存在')

    const currentVersion = form.publishedVersion
    const requiresAdaptation = dataVersion !== undefined && dataVersion < currentVersion

    // 如果版本不一致，获取旧版本 Schema 快照
    let oldSchema = null
    if (requiresAdaptation && dataVersion !== undefined) {
      const oldVersion = await this.prisma.formVersion.findUnique({
        where: { formId_version: { formId, version: dataVersion } },
        select: { schema: true },
      })
      oldSchema = oldVersion?.schema || null
    }

    return {
      currentVersion,
      dataVersion: dataVersion || null,
      requiresAdaptation,
      oldSchema,
      currentSchema: form.schema,
    }
  }
}
