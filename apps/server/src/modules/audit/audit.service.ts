import { Injectable } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'

/** 审计日志清理的保留期单位 */
export type CleanupUnit = 'day' | 'month' | 'year'

/**
 * 不在「操作筛选」里的动作，一律不进审计日志页面（列表/导出/统计/详情）。
 * - agent.tool_call：agent 调用本身不再审计（业务操作照常由 Prisma 中间件记录）
 * - auth.*：登录 / 登录失败 / 权限拒绝属于安全事件，不是业务操作
 * 数据仍保留在库中，只是不展示。
 */
const HIDDEN_ACTIONS = [
  'agent.tool_call',
  'auth.login',
  'auth.login_failed',
  'auth.register',
  'auth.permission_denied',
]
const HIDDEN_ACTION_FILTER = { notIn: HIDDEN_ACTIONS }

interface AuditQuery {
  page?: number
  pageSize?: number
  action?: string
  resourceType?: string
  userId?: string
  startDate?: string
  endDate?: string
  keyword?: string
}

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaClient) {}

  async log(params: {
    workspaceId: string
    userId?: string
    action: string
    resourceType?: string
    resourceId?: string
    details?: any
    ip?: string
  }) {
    return this.prisma.auditLog.create({ data: params })
  }

  async list(workspaceId: string, query: AuditQuery) {
    const page = Number(query.page) || 1
    const pageSize = Number(query.pageSize) || 50

    const where: any = { workspaceId, action: HIDDEN_ACTION_FILTER }

    if (query.action) where.action = query.action
    if (query.resourceType) where.resourceType = query.resourceType
    if (query.userId) where.userId = query.userId
    if (query.startDate || query.endDate) {
      where.createdAt = {}
      if (query.startDate) where.createdAt.gte = new Date(query.startDate)
      if (query.endDate) where.createdAt.lte = new Date(query.endDate + 'T23:59:59.999Z')
    }


    const [list, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.auditLog.count({ where }),
    ])

    const userIds = [...new Set(list.map(l => l.userId).filter(Boolean))] as string[]
    const users = await this.resolveUsers(userIds)
    const enriched = list.map(l => ({ ...l, user: l.userId ? users[l.userId] || null : null }))

    return {
      list: enriched,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    }
  }

  private async resolveUsers(ids: string[]) {
    if (!ids.length) return {} as Record<string, { id: string; nickname: string | null; email: string }>
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, nickname: true, email: true },
    })
    const map: Record<string, { id: string; nickname: string | null; email: string }> = {}
    for (const u of users) map[u.id] = u
    return map
  }

  async getDetail(id: string) {
    const log = await this.prisma.auditLog.findUnique({ where: { id } })
    return log && HIDDEN_ACTIONS.includes(log.action) ? null : log
  }

  /**
   * 「按用户筛选」下拉：当前空间成员 ∪ 审计日志中出现过的用户。
   * 只取日志用户的话，新空间/暂无日志时下拉是空的；成员并集保证总有可选用户，
   * 同时保留已离开空间但留下过操作记录的人。
   */
  async getUsers(workspaceId: string) {
    const [rows, members] = await Promise.all([
      this.prisma.auditLog.findMany({
        where: { workspaceId, userId: { not: null }, action: HIDDEN_ACTION_FILTER },
        select: { userId: true },
        distinct: ['userId'],
      }),
      this.prisma.workspaceMember.findMany({ where: { workspaceId }, select: { userId: true } }),
    ])
    const ids = [...new Set([...rows, ...members].map((r) => r.userId).filter((id): id is string => !!id))]
    if (!ids.length) return []
    return this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, email: true, nickname: true },
      orderBy: { nickname: 'asc' },
    })
  }

  async getActionTypes(workspaceId: string) {
    // 先把 DB 中已有的操作类型统计出来
    const existing = await this.prisma.auditLog.groupBy({
      by: ['action'],
      where: { workspaceId },
      _count: true,
    })
    const countMap: Record<string, number> = {}
    for (const r of existing) {
      countMap[r.action as string] = (r as any)._count
    }

    // 生成所有可能的操作类型（与 audit-middleware.ts 保持一致）
    // 与 audit-middleware.ts 保持一致
    const labelToKey: Record<string, string> = {
      Form: '表单', FormSubmission: '数据', ProcessDefinition: '流程', ProcessInstance: '流程', TaskInstance: '任务',
      WorkspaceMember: '成员', Role: '角色',
      Template: '模板',
    }
    const overrides: Record<string, Record<string, string>> = {
      Form: {
        create: '新建表单', update: '修改表单', delete: '删除表单',
        // 发布/归档/复制由中间件根据 data 细分，这里列全以便前端展示
      },
      ProcessDefinition: { create: '新建固有流程', update: '修改固有流程', delete: '删除固有流程' },
      ProcessInstance: { create: '发起我的流程', update: '撤回我的流程', delete: '删除我的流程' },
      FormSubmission: { create: '提交表单数据', delete: '删除表单数据' },
    }
    const actions = ['创建', '修改', '删除', '创建/更新']
    const skipActions: Record<string, string[]> = {
      FormSubmission: ['修改', '创建/更新'],
      ProcessInstance: ['创建/更新'],
    }
    const all: { action: string; count: number }[] = []
    for (const [key, label] of Object.entries(labelToKey)) {
      for (const a of actions) {
        if (skipActions[key]?.includes(a)) continue
        const override = overrides[key]?.[a]
        const name = override || a + label
        all.push({ action: name, count: countMap[name] || 0 })
      }
    }
    // 中间件根据 data 字段细分出来的子类型
    for (const act of ['发布表单', '归档表单', '复制表单', '发布固有流程', '撤回固有流程', '超时升级']) {
      all.push({ action: act, count: countMap[act] || 0 })
    }
    return all
  }

  async getStats(workspaceId: string, days: number = 7) {
    const since = new Date()
    since.setDate(since.getDate() - days)
    since.setHours(0, 0, 0, 0)

    const logs = await this.prisma.auditLog.findMany({
      where: { workspaceId, createdAt: { gte: since }, action: HIDDEN_ACTION_FILTER },
      select: { action: true, createdAt: true },
    })

    // 按日期聚合
    const dailyMap: Record<string, number> = {}
    for (let i = 0; i < days; i++) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      dailyMap[d.toISOString().split('T')[0]] = 0
    }

    for (const log of logs) {
      const day = log.createdAt.toISOString().split('T')[0]
      if (dailyMap[day] !== undefined) dailyMap[day]++
    }

    return Object.entries(dailyMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count }))
  }

  async cleanup(workspaceId: string, amount: number, unit: CleanupUnit = 'day') {
    const since = new Date()
    since.setHours(0, 0, 0, 0)
    // 月/年按日历推（1 个月 ≠ 30 天）。月末会向前溢出：10/31 减一个月落到 10/1 ——
    // 结果是 cutoff 偏晚、删得更少，不会误删更多，因此不做额外纠正。
    if (unit === 'year') since.setFullYear(since.getFullYear() - amount)
    else if (unit === 'month') since.setMonth(since.getMonth() - amount)
    else since.setDate(since.getDate() - amount)
    const result = await this.prisma.auditLog.deleteMany({
      where: { workspaceId, createdAt: { lt: since } },
    })
    return { deletedCount: result.count, keepAmount: amount, keepUnit: unit }
  }

  async exportCsv(workspaceId: string, query: AuditQuery): Promise<string> {
    const where: any = { workspaceId, action: HIDDEN_ACTION_FILTER }
    if (query.action) where.action = query.action
    if (query.resourceType) where.resourceType = query.resourceType
    if (query.userId) where.userId = query.userId
    if (query.startDate || query.endDate) {
      where.createdAt = {}
      if (query.startDate) where.createdAt.gte = new Date(query.startDate)
      if (query.endDate) where.createdAt.lte = new Date(query.endDate + 'T23:59:59.999Z')
    }

    const logs = await this.prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 10000,
    })

    const header = '操作,资源类型,资源ID,用户ID,IP,时间,详情\n'
    const rows = logs
      .map((l: any) => {
        const detail = l.details ? JSON.stringify(l.details).replace(/"/g, '""') : ''
        return `${l.action},${l.resourceType || ''},${l.resourceId || ''},${l.userId || ''},${l.ip || ''},${l.createdAt.toISOString()},"${detail}"`
      })
      .join('\n')

    return header + rows
  }
}
