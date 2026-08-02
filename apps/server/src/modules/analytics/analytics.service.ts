import { Injectable } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'

@Injectable()
export class AnalyticsService {
  constructor(private prisma: PrismaClient) {}

  async overview(workspaceId: string, userId: string) {
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

    const [totalForms, totalSubmissions, monthlySubmissions, pendingTasks] = await Promise.all([
      this.prisma.form.count({ where: { workspaceId, deletedAt: null } }),
      this.prisma.formSubmission.count({
        where: { form: { workspaceId } },
      }),
      this.prisma.formSubmission.count({
        where: {
          form: { workspaceId },
          createdAt: { gte: monthStart },
        },
      }),
      this.prisma.taskInstance.count({
        where: {
          assigneeId: userId,
          status: 'pending',
          instance: { definition: { workspaceId } },
        },
      }),
    ])

    return {
      totalForms,
      totalSubmissions,
      monthlySubmissions,
      pendingTasks,
    }
  }

  async submissionTrend(workspaceId: string, days: number = 30) {
    const since = new Date()
    since.setDate(since.getDate() - days)
    since.setHours(0, 0, 0, 0)

    const submissions = await this.prisma.formSubmission.findMany({
      where: {
        form: { workspaceId },
        createdAt: { gte: since },
      },
      select: { createdAt: true },
    })

    // 按日聚合
    const dailyMap: Record<string, number> = {}
    for (let i = 0; i < days; i++) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      dailyMap[d.toISOString().split('T')[0]] = 0
    }

    for (const s of submissions) {
      const day = s.createdAt.toISOString().split('T')[0]
      if (dailyMap[day] !== undefined) dailyMap[day]++
    }

    return Object.entries(dailyMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count }))
  }

  async formRanking(workspaceId: string) {
    const forms = await this.prisma.form.findMany({
      where: { workspaceId, deletedAt: null },
      select: {
        id: true,
        name: true,
        _count: { select: { submissions: true } },
      },
      orderBy: { submissions: { _count: 'desc' } },
      take: 10,
    })

    return forms.map((f: any) => ({
      id: f.id,
      name: f.name,
      submissionCount: f._count.submissions,
    }))
  }

  async formStatusDistribution(workspaceId: string) {
    const result = await this.prisma.form.groupBy({
      by: ['status'],
      where: { workspaceId, deletedAt: null },
      _count: true,
    })
    return result.map((r: any) => ({ status: r.status, count: r._count }))
  }
}
