import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import { NotificationService } from '../notification/notification.service'

@Injectable()
export class SLAService implements OnModuleInit {
  private readonly logger = new Logger(SLAService.name)
  private escalateTimers = new Map<string, NodeJS.Timeout>()
  private warnTimers = new Map<string, NodeJS.Timeout>()

  constructor(
    private prisma: PrismaClient,
    private notification: NotificationService,
  ) {}

  /** 服务启动时，恢复所有待处理任务的 SLA 定时器 */
  async onModuleInit() {
    try {
      const pendingTasks = await (this.prisma as any).taskInstance.findMany({
        where: { status: 'pending' },
        include: {
          instance: {
            include: {
              definition: { select: { name: true, nodes: true, workspaceId: true } },
            },
          },
        },
      })

      for (const task of pendingTasks as any[]) {
        try {
          const nodes = (task.instance?.definition?.nodes || []) as any[]
          const node = nodes.find((n: any) => n.id === task.nodeId)
          const config = (node?.config || {}) as any
          const wsId: string = task.instance?.definition?.workspaceId || ''
          const defName: string = task.instance?.definition?.name || ''
          if (config?.timeout > 0 && config?.escalateTo) {
            const elapsed = Date.now() - new Date(task.createdAt).getTime()
            const timeoutMs = config.timeout * 3600 * 1000
            const escalateRemaining = Math.max(1000, timeoutMs - elapsed)
            this.setEscalateTimer(task.id, task.instanceId, task.nodeId, config.escalateTo, task.assigneeId, defName, wsId, escalateRemaining)
            this.logger.log(`恢复 SLA 升级定时器: task=${task.id} 剩余=${Math.round(escalateRemaining / 3600000)}h`)

            if (config.warnAt > 0) {
              const warnMs = (config.timeout - config.warnAt) * 3600 * 1000
              const warnRemaining = Math.max(1000, warnMs - elapsed)
              if (warnRemaining > 0 && warnRemaining < escalateRemaining) {
                this.setWarnTimer(task.id, task.assigneeId, defName, wsId, node.name || task.nodeId, config.warnAt, warnRemaining)
                this.logger.log(`恢复 SLA 预警定时器: task=${task.id} 剩余=${Math.round(warnRemaining / 3600000)}h`)
              }
            }
          }
        } catch { /* 单个任务恢复失败不影响整体 */ }
      }
    } catch (e: any) {
      this.logger.warn(`SLA 定时器恢复失败: ${e.message}`)
    }
  }

  /** 为新创建的审批任务注册 SLA（超时升级 + 提前预警） */
  register(
    taskId: string,
    instanceId: string,
    nodeId: string,
    escalateTo: string,
    originalAssignee: string,
    workflowName: string,
    workspaceId: string,
    timeoutHours: number,
    warnAtHours: number = 0,
    nodeName: string = '',
  ) {
    if (timeoutHours <= 0 || !escalateTo) return

    const escalateMs = timeoutHours * 3600 * 1000
    this.setEscalateTimer(taskId, instanceId, nodeId, escalateTo, originalAssignee, workflowName, workspaceId, escalateMs)

    if (warnAtHours > 0 && warnAtHours < timeoutHours) {
      const warnMs = (timeoutHours - warnAtHours) * 3600 * 1000
      this.setWarnTimer(taskId, originalAssignee, workflowName, workspaceId, nodeName || nodeId, warnAtHours, warnMs)
    }
  }

  /** 取消某个任务的所有 SLA 定时器 */
  cancel(taskId: string) {
    const es = this.escalateTimers.get(taskId)
    if (es) { clearTimeout(es); this.escalateTimers.delete(taskId) }
    const ws = this.warnTimers.get(taskId)
    if (ws) { clearTimeout(ws); this.warnTimers.delete(taskId) }
  }

  // ============ 内部 ============

  private setEscalateTimer(
    taskId: string, instanceId: string, nodeId: string, escalateTo: string,
    originalAssignee: string, workflowName: string, workspaceId: string, delayMs: number,
  ) {
    this.clearTimer(this.escalateTimers, taskId)
    const safeDelay = Math.min(delayMs, 2147483647)
    const timer = setTimeout(async () => {
      try { await this.doEscalate(taskId, instanceId, nodeId, escalateTo, originalAssignee, workflowName, workspaceId) }
      finally { this.escalateTimers.delete(taskId) }
    }, safeDelay)
    this.escalateTimers.set(taskId, timer)
  }

  private setWarnTimer(
    taskId: string, assigneeId: string, workflowName: string,
    workspaceId: string, nodeName: string, warnAtHours: number, delayMs: number,
  ) {
    this.clearTimer(this.warnTimers, taskId)
    const safeDelay = Math.min(delayMs, 2147483647)
    const timer = setTimeout(async () => {
      try { await this.doWarn(taskId, assigneeId, workflowName, workspaceId, nodeName, warnAtHours) }
      finally { this.warnTimers.delete(taskId) }
    }, safeDelay)
    this.warnTimers.set(taskId, timer)
  }

  private clearTimer(map: Map<string, NodeJS.Timeout>, taskId: string) {
    const existing = map.get(taskId)
    if (existing) { clearTimeout(existing); map.delete(taskId) }
  }

  private async doEscalate(
    taskId: string, instanceId: string, nodeId: string, escalateTo: string,
    originalAssignee: string, workflowName: string, workspaceId: string,
  ) {
    const task = await this.prisma.taskInstance.findUnique({ where: { id: taskId } })
    if (!task || task.status !== 'pending') return

    await this.prisma.taskInstance.update({
      where: { id: taskId },
      data: { status: 'transferred', comment: '超时自动升级', processedAt: new Date() },
    })
    await this.prisma.taskInstance.create({
      data: { instanceId, nodeId, assigneeId: escalateTo, status: 'pending', transferredFrom: originalAssignee },
    })

    await this.notification.send({
      userId: escalateTo, workspaceId, type: 'warning',
      title: `SLA 超时升级: ${workflowName}`,
      content: `审批人 ${originalAssignee} 超时未处理，已将「${nodeId}」节点升级转交给你`,
      relatedType: 'instance', relatedId: instanceId,
    }).catch(() => {})
    await this.notification.send({
      userId: originalAssignee, workspaceId, type: 'warning',
      title: `任务已升级: ${workflowName}`,
      content: `你未在时限内处理「${nodeId}」节点，已自动转交他人处理`,
      relatedType: 'instance', relatedId: instanceId,
    }).catch(() => {})

    this.logger.log(`SLA 超时升级: task=${taskId} → ${escalateTo}`)
  }

  private async doWarn(
    taskId: string, assigneeId: string, workflowName: string,
    workspaceId: string, nodeName: string, warnAtHours: number,
  ) {
    const task = await this.prisma.taskInstance.findUnique({ where: { id: taskId } })
    if (!task || task.status !== 'pending') return

    await this.notification.send({
      userId: assigneeId, workspaceId, type: 'warning',
      title: `审批预警: ${workflowName}`,
      content: `「${nodeName}」节点还有 ${warnAtHours} 小时超时，请尽快处理`,
      relatedType: 'instance', relatedId: task.instanceId,
    }).catch(() => {})

    this.logger.log(`SLA 预警: task=${taskId} 剩余=${warnAtHours}h`)
  }
}
