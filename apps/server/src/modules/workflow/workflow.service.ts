import { Injectable, NotFoundException, ForbiddenException, ConflictException, BadRequestException, Logger } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import {
  WorkflowEngine,
  CountersignEvaluator,
  APPROVAL_NODE_TYPES,
  coerceJsonDeep,
} from '@furmx/sdk'
import type {
  ProcessNode,
  ApprovalConfig,
  CountersignStrategy,
} from '@furmx/sdk'
import { NotificationService } from '../notification/notification.service'
import { SLAService } from './sla.service'

@Injectable()
export class WorkflowService {
  private engine: WorkflowEngine
  private readonly logger = new Logger(WorkflowService.name)

  constructor(
    private prisma: PrismaClient,
    private notification: NotificationService,
    private sla: SLAService,
  ) {
    this.engine = new WorkflowEngine()
  }

  // ==================== 流程定义 ====================

  /**
   * 获取工作空间内流程→表单的绑定关系（供表单列表页展示）
   *
   * 只认已发布的流程：开始节点上选了表单只是设计意向，发布后才是真绑定。
   */
  async getFormBindings(workspaceId: string) {
    const definitions = await this.prisma.processDefinition.findMany({
      where: { workspaceId, status: 'published' },
      select: { id: true, name: true, status: true, nodes: true, updatedAt: true },
    })

    // 提取开始节点绑定的 formId → 流程列表映射
    const bindings: Record<string, { id: string; name: string; status: string; updatedAt: string }[]> = {}
    for (const def of definitions) {
      const formId = this.startFormId(def.nodes)
      if (formId) {
        if (!bindings[formId]) bindings[formId] = []
        bindings[formId].push({
          id: def.id,
          name: def.name,
          status: def.status,
          updatedAt: def.updatedAt.toISOString(),
        })
      }
    }
    return bindings
  }

  async listDefinitions(workspaceId: string, query: { page?: number; pageSize?: number; status?: string; keyword?: string }) {
    const page = Number(query.page) || 1
    const pageSize = Number(query.pageSize) || 20
    const where: any = { workspaceId }
    if (query.status) where.status = query.status
    if (query.keyword) where.name = { contains: query.keyword }

    const [list, total] = await Promise.all([
      this.prisma.processDefinition.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { updatedAt: 'desc' },
        select: { id: true, name: true, description: true, status: true, publishedAt: true, createdAt: true, updatedAt: true },
      }),
      this.prisma.processDefinition.count({ where }),
    ])

    return {
      list,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    }
  }

  async createDefinition(workspaceId: string, userId: string, dto: { name: string; description?: string; nodes?: any; edges?: any }) {
    const defaultNodes: ProcessNode[] = [
      { id: 'start', type: 'start', name: '开始', position: { x: 200, y: 50 }, config: {} },
      { id: 'end', type: 'end', name: '结束', position: { x: 200, y: 400 }, config: {} },
    ]
    const defaultEdges = [{ id: 'e1', sourceNodeId: 'start', targetNodeId: 'end' }]

    // 使用 Agent 传入的节点/边，否则使用默认值。落库前统一深度归一，
    // 挡住「config 被序列化成字符串」（见 @furmx/sdk 的 coerceJsonDeep）
    const nodes = coerceJsonDeep(dto.nodes?.length ? dto.nodes : defaultNodes)
    const edges = coerceJsonDeep(dto.edges?.length ? dto.edges : defaultEdges)

    return this.prisma.processDefinition.create({
      data: {
        workspaceId,
        name: dto.name,
        description: dto.description || '',
        nodes: nodes as any,
        edges: edges as any,
        settings: { allowWithdraw: true, allowUrge: true, urgeTimeout: 48 } as any,
        createdBy: userId,
      },
    })
  }

  async getDefinition(id: string) {
    const def = await this.prisma.processDefinition.findUnique({ where: { id } })
    if (!def) throw new NotFoundException('流程定义不存在')
    return def
  }

  async updateDefinition(id: string, dto: { name?: string; description?: string; nodes?: any; edges?: any; settings?: any }) {
    const current = await this.prisma.processDefinition.findUnique({
      where: { id },
      select: { workspaceId: true, status: true },
    })
    if (!current) throw new NotFoundException('流程定义不存在')

    // 与 createDefinition 同理：任何写入方（web 设计器 / agent）都可能在 config 里塞字符串化 JSON
    const next = coerceJsonDeep(dto)

    // 已发布流程的改动即时生效（没有版本快照），所以这里也要挡重复绑定；草稿只是意向，不来抢。
    if (current.status === 'published' && next.nodes) {
      await this.assertFormBindingFree(current.workspaceId, next.nodes, id)
    }

    return this.prisma.processDefinition.update({ where: { id }, data: next as any })
  }

  async removeDefinition(id: string) {
    return this.prisma.processDefinition.delete({ where: { id } })
  }

  /**
   * 发布 = 让开始节点上关联的表单成为真绑定。同一张表单同时只能被一个已发布流程绑定。
   *
   * 开始节点没有关联表单的流程**不允许发布**：发起入口只有「表单提交」一条（没有手动
   * 发起界面），发出去也永远不会被触发，只会让人误以为流程在跑。挡在发布这一步，
   * 比发完再让人困惑为什么没反应好。
   */
  async publishDefinition(id: string) {
    const def = await this.prisma.processDefinition.findUnique({
      where: { id },
      select: { workspaceId: true, nodes: true },
    })
    if (!def) throw new NotFoundException('流程定义不存在')

    if (!this.startFormId(def.nodes)) {
      throw new BadRequestException('请先为该流程关联表单后再发布')
    }

    await this.assertFormBindingFree(def.workspaceId, def.nodes, id)

    return this.prisma.processDefinition.update({
      where: { id },
      data: { status: 'published', publishedAt: new Date() },
    })
  }

  /** 撤销发布只改状态：关联的表单留在开始节点上作为设计意向，解绑是由 status 派生的 */
  async unpublishDefinition(id: string) {
    return this.prisma.processDefinition.update({
      where: { id },
      data: { status: 'draft', publishedAt: null },
    })
  }

  // ==================== 流程实例 ====================

  /**
   * 发起流程（表单提交后调用）
   */
  async startProcess(
    definitionId: string,
    initiatorId: string,
    formId?: string,
    submissionId?: string,
    formData?: Record<string, any>,
  ) {
    const definition = await this.prisma.processDefinition.findUnique({ where: { id: definitionId } })
    if (!definition) throw new NotFoundException('流程定义不存在')
    if (definition.status !== 'published') throw new ForbiddenException('流程未发布')

    const nodes = (definition.nodes as any) as ProcessNode[]
    const edges = (definition.edges as any) as any[]
    const settings = (definition.settings as any) || {}

    const def = {
      ...definition,
      nodes,
      edges,
      settings,
      workspaceId: definition.workspaceId,
      createdAt: definition.createdAt.toISOString(),
      updatedAt: definition.updatedAt.toISOString(),
    }

    // 从表单数据中提取流程变量（根据开始节点的 variables 配置过滤）
    const context = formData
      ? this.engine.extractProcessVariables(def as any, formData)
      : {}

    const { instance, tasks, ccRecipients, autoTaskActions } = this.engine.startProcess(def as any, initiatorId, context)

    const created = await this.prisma.processInstance.create({
      data: {
        definitionId: definition.id,
        definitionVersion: definition.version,
        formId: formId || '',
        submissionId: submissionId || '',
        initiatorId,
        currentState: instance.currentState,
        currentNodeIds: instance.currentNodeIds as any,
        context: instance.context as any,
        completedAt: instance.currentState === 'completed' ? new Date() : null,
      },
    })

    // 创建待办任务（逐个创建以获取 ID 用于 SLA 调度）
    const createdTaskIds: { id: string; nodeId: string; assigneeId: string }[] = []
    for (const t of tasks) {
      const createdTask = await this.prisma.taskInstance.create({
        data: {
          instanceId: created.id,
          nodeId: t.nodeId,
          assigneeId: t.assigneeId,
          status: t.status,
        },
      })
      createdTaskIds.push({ id: createdTask.id, nodeId: t.nodeId, assigneeId: t.assigneeId })
      const node = nodes.find((n: any) => n.id === t.nodeId)
      this.notification.send({
        userId: t.assigneeId,
        workspaceId: definition.workspaceId,
        type: 'approval',
        title: `新的审批任务: ${definition.name}`,
        content: `节点「${node?.name || t.nodeId}」需要你审批`,
        relatedType: 'instance',
        relatedId: created.id,
      }).catch(() => {})
    }
    this.registerSLAForTasks(created.id, createdTaskIds, nodes, definition.name, definition.workspaceId)

    // 抄送通知
    for (const cc of ccRecipients) {
      this.notification.send({
        userId: cc.userId,
        workspaceId: definition.workspaceId,
        type: 'info',
        title: `流程通知: ${definition.name}`,
        content: `流程已发起，你被「${cc.nodeName}」节点抄送`,
        relatedType: 'instance',
        relatedId: created.id,
      }).catch(() => {})
    }

    // 自动处理节点
    await this.processAutoTaskActions(autoTaskActions, definition.workspaceId, definition.name)

    return this.getInstanceWithTasks(created.id)
  }

  /**
   * 审批通过
   */
  async approveTask(instanceId: string, nodeId: string, operatorId: string, comment?: string) {
    const instance = await this.prisma.processInstance.findUnique({
      where: { id: instanceId },
      include: { definition: true, tasks: true },
    })
    if (!instance) throw new NotFoundException('流程实例不存在')

    // 更新当前任务状态
    const currentTask = await this.prisma.taskInstance.findFirst({
      where: { instanceId, nodeId, assigneeId: operatorId, status: 'pending' },
    })
    if (currentTask) {
      await this.prisma.taskInstance.update({
        where: { id: currentTask.id },
        data: { status: 'approved', comment, processedAt: new Date() },
      })
    }
    // 取消该节点的 SLA 定时器
    const pendingTasks = await this.prisma.taskInstance.findMany({
      where: { instanceId, nodeId, status: 'pending' },
    })
    for (const t of pendingTasks) {
      this.sla.cancel(t.id)
    }

    // 重新查询该节点所有任务的最新状态（updateMany 后内存中的数据已过时）
    const refreshedTasks = await this.prisma.taskInstance.findMany({
      where: { instanceId, nodeId },
    })

    // 检查该节点的会签策略
    const defNodes = (instance.definition.nodes as any) as ProcessNode[]
    const node = defNodes.find((n: ProcessNode) => n.id === nodeId)
    if (node && APPROVAL_NODE_TYPES.includes(node.type as any)) {
      const config = node.config as ApprovalConfig
      const nodeTasks = refreshedTasks
        .map((t: any) => ({ status: t.status as any, assigneeId: t.assigneeId }))
      const result = CountersignEvaluator.evaluate(config.strategy, nodeTasks)
      if (result === 'pending') {
        // 会签未完成，等待其他审批人
        return this.getInstanceWithTasks(instanceId)
      }
    }

    // 流转到下一节点
    const def = {
      ...instance.definition,
      nodes: defNodes,
      edges: instance.definition.edges as any,
      settings: instance.definition.settings as any,
      workspaceId: instance.definition.workspaceId,
      createdAt: instance.definition.createdAt.toISOString(),
      updatedAt: instance.definition.updatedAt.toISOString(),
    }

    const { newState, nextNodeIds, newTasks, finished, ccRecipients, autoTaskActions } = this.engine.approveTask(
      def as any,
      {
        ...(instance as any),
        currentNodeIds: instance.currentNodeIds as string[],
        context: instance.context as Record<string, any>,
        currentState: instance.currentState as any,
        createdAt: instance.createdAt.toISOString(),
        updatedAt: instance.updatedAt.toISOString(),
      } as any,
      nodeId,
      operatorId,
      comment,
    )

    const updateData: any = {
      currentState: newState,
      currentNodeIds: nextNodeIds as any,
    }
    if (finished) {
      updateData.completedAt = new Date()
    }

    await this.prisma.processInstance.update({
      where: { id: instanceId },
      data: updateData,
    })

    // 创建下一节点的待办任务
    const newTaskIds: { id: string; nodeId: string; assigneeId: string }[] = []
    for (const t of newTasks) {
      const createdTask = await this.prisma.taskInstance.create({
        data: {
          instanceId,
          nodeId: t.nodeId,
          assigneeId: t.assigneeId,
          status: t.status,
        },
      })
      newTaskIds.push({ id: createdTask.id, nodeId: t.nodeId, assigneeId: t.assigneeId })
      const n = defNodes.find((nd: any) => nd.id === t.nodeId)
      this.notification.send({
        userId: t.assigneeId,
        workspaceId: instance.definition.workspaceId,
        type: 'approval',
        title: `新的审批任务: ${instance.definition.name}`,
        content: `节点「${n?.name || t.nodeId}」需要你审批`,
        relatedType: 'instance',
        relatedId: instanceId,
      }).catch(() => {})
    }
    if (newTaskIds.length > 0) {
      this.registerSLAForTasks(instanceId, newTaskIds, defNodes, instance.definition.name, instance.definition.workspaceId)
    } else if (finished) {
      // 流程完成，通知发起人
      this.notification.send({
        userId: instance.initiatorId,
        workspaceId: instance.definition.workspaceId,
        type: 'info',
        title: `流程已完成: ${instance.definition.name}`,
        content: '你的流程已审批通过',
        relatedType: 'instance',
        relatedId: instanceId,
      }).catch(() => {})
    }

    // 抄送通知
    for (const cc of ccRecipients) {
      this.notification.send({
        userId: cc.userId,
        workspaceId: instance.definition.workspaceId,
        type: 'info',
        title: `流程通知: ${instance.definition.name}`,
        content: `流程已流转至下一节点，你被「${cc.nodeName}」节点抄送`,
        relatedType: 'instance',
        relatedId: instanceId,
      }).catch(() => {})
    }

    // 自动处理节点
    await this.processAutoTaskActions(autoTaskActions, instance.definition.workspaceId, instance.definition.name)

    return this.getInstanceWithTasks(instanceId)
  }

  /**
   * 驳回
   */
  async rejectTask(instanceId: string, nodeId: string, operatorId: string, comment?: string, targetNodeId?: string) {
    const instance = await this.prisma.processInstance.findUnique({
      where: { id: instanceId },
      include: { definition: true, tasks: true },
    })
    if (!instance) throw new NotFoundException('流程实例不存在')

    const currentTask = await this.prisma.taskInstance.findFirst({
      where: { instanceId, nodeId, assigneeId: operatorId, status: 'pending' },
    })
    if (currentTask) {
      await this.prisma.taskInstance.update({
        where: { id: currentTask.id },
        data: { status: 'rejected', comment, processedAt: new Date() },
      })
    }

    // 将所有该节点的 pending 任务标记为 withdrawn
    await this.prisma.taskInstance.updateMany({
      where: { instanceId, nodeId, status: 'pending' },
      data: { status: 'withdrawn' },
    })

    const defNodes = (instance.definition.nodes as any) as ProcessNode[]
    const def = {
      ...instance.definition,
      nodes: defNodes,
      edges: instance.definition.edges as any,
      settings: instance.definition.settings as any,
      workspaceId: instance.definition.workspaceId,
      createdAt: instance.definition.createdAt.toISOString(),
      updatedAt: instance.definition.updatedAt.toISOString(),
    }

    const { targetNodeIds } = this.engine.rejectTask(
      def as any,
      {
        ...(instance as any),
        currentNodeIds: instance.currentNodeIds as string[],
        context: instance.context as Record<string, any>,
        currentState: instance.currentState as any,
        createdAt: instance.createdAt.toISOString(),
        updatedAt: instance.updatedAt.toISOString(),
      } as any,
      nodeId,
      targetNodeId,
      comment,
    )

    await this.prisma.processInstance.update({
      where: { id: instanceId },
      data: {
        currentState: 'rejected',
        currentNodeIds: targetNodeIds as any,
      },
    })

    return this.getInstanceWithTasks(instanceId)
  }

  /**
   * 撤回流程（仅发起人可操作）
   */
  async withdrawProcess(instanceId: string, operatorId: string) {
    const instance = await this.prisma.processInstance.findUnique({
      where: { id: instanceId },
      include: { definition: true },
    })
    if (!instance) throw new NotFoundException('流程实例不存在')
    if ((instance.definition?.settings as any)?.allowWithdraw === false) throw new ForbiddenException('该流程不允许撤回')
    if (instance.initiatorId !== operatorId) throw new ForbiddenException('仅发起人可撤回')
    if (instance.currentState !== 'approving') throw new ForbiddenException('当前状态不可撤回')

    // 将所有 pending 任务标为 withdrawn
    await this.prisma.taskInstance.updateMany({
      where: { instanceId, status: 'pending' },
      data: { status: 'withdrawn' },
    })

    await this.prisma.processInstance.update({
      where: { id: instanceId },
      data: { currentState: 'withdrawn' },
    })

    return this.getInstanceWithTasks(instanceId)
  }

  /**
   * 转交任务
   */
  async transferTask(instanceId: string, nodeId: string, fromUserId: string, toUserId: string) {
    const instance = await this.prisma.processInstance.findUnique({
      where: { id: instanceId },
      include: { definition: { select: { nodes: true } } },
    })
    if (!instance) throw new NotFoundException('流程实例不存在')

    const nodes = (instance.definition?.nodes as any[]) || []
    const node = nodes.find((n: any) => n.id === nodeId)
    if (node?.config?.allowTransfer === false) {
      throw new ForbiddenException('该节点不允许转交')
    }

    const task = await this.prisma.taskInstance.findFirst({
      where: { instanceId, nodeId, assigneeId: fromUserId, status: 'pending' },
    })
    if (!task) throw new NotFoundException('待办任务不存在')

    await this.prisma.taskInstance.update({
      where: { id: task.id },
      data: { status: 'transferred' },
    })

    await this.prisma.taskInstance.create({
      data: {
        instanceId,
        nodeId,
        assigneeId: toUserId,
        status: 'pending',
        transferredFrom: fromUserId,
      },
    })

    return this.getInstanceWithTasks(instanceId)
  }

  /**
   * 加签
   */
  async addSign(instanceId: string, nodeId: string, operatorId: string, targetUserId: string) {
    const instance = await this.prisma.processInstance.findUnique({
      where: { id: instanceId },
      include: { definition: true },
    })
    if (!instance) throw new NotFoundException('流程实例不存在')

    const defNodes = (instance.definition.nodes as any) as ProcessNode[]
    const node = defNodes.find((n: ProcessNode) => n.id === nodeId)
    if (!node || !APPROVAL_NODE_TYPES.includes(node.type as any)) throw new ForbiddenException('仅审批节点可加签')

    await this.prisma.taskInstance.create({
      data: {
        instanceId,
        nodeId,
        assigneeId: targetUserId,
        status: 'pending',
        addedBySign: true,
      },
    })

    return this.getInstanceWithTasks(instanceId)
  }

  // ==================== 待办查询 ====================

  async getMyTasks(userId: string, query: { page?: number; pageSize?: number; status?: string }) {
    const page = Number(query.page) || 1
    const pageSize = Number(query.pageSize) || 20
    const where: any = { assigneeId: userId }
    if (query.status === 'processed') {
      where.status = { in: ['approved', 'rejected', 'transferred', 'withdrawn'] }
    } else if (query.status) {
      where.status = query.status
    }

    const [list, total] = await Promise.all([
      this.prisma.taskInstance.findMany({
        where,
        include: {
          instance: {
            select: {
              id: true,
              definitionId: true,
              definitionVersion: true,
              initiatorId: true,
              currentState: true,
              formId: true,
              createdAt: true,
              definition: { select: { name: true, nodes: true, settings: true } },
            },
          },
        },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.taskInstance.count({ where }),
    ])

    const users = await this.resolveUsers(list.map(t => t.instance.initiatorId))
    const enriched = list.map(t => ({
      ...t,
      instance: { ...t.instance, initiator: users[t.instance.initiatorId] || null },
    }))

    return {
      list: enriched,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    }
  }

  async getMyInstances(userId: string, query: { page?: number; pageSize?: number }) {
    const page = Number(query.page) || 1
    const pageSize = Number(query.pageSize) || 20
    const where: any = { initiatorId: userId }

    const [list, total] = await Promise.all([
      this.prisma.processInstance.findMany({
        where,
        include: {
          definition: { select: { name: true, nodes: true, settings: true } },
          tasks: { select: { id: true, nodeId: true, assigneeId: true, status: true, comment: true, processedAt: true } },
        },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.processInstance.count({ where }),
    ])

    const userIds = new Set<string>()
    list.forEach(i => {
      userIds.add(i.initiatorId)
      i.tasks.forEach(t => userIds.add(t.assigneeId))
    })
    const users = await this.resolveUsers([...userIds])
    const enriched = list.map(i => ({
      ...i,
      initiator: users[i.initiatorId] || null,
      tasks: i.tasks.map(t => ({ ...t, assignee: users[t.assigneeId] || null })),
    }))

    return {
      list: enriched,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    }
  }

  async deleteInstance(instanceId: string) {
    // 先删除关联的任务
    await this.prisma.taskInstance.deleteMany({ where: { instanceId } })
    return this.prisma.processInstance.delete({ where: { id: instanceId } })
  }

  async getInstanceDetail(id: string) {
    return this.getInstanceWithTasks(id)
  }

  // ==================== 辅助 ====================

  /** 执行自动处理节点的动作 */
  private async processAutoTaskActions(
    actions: { nodeId: string; nodeName: string; actionType: string; actionConfig: any }[],
    workspaceId: string,
    defName: string,
  ) {
    for (const action of actions) {
      try {
        switch (action.actionType) {
          case 'notify': {
            const config = action.actionConfig || {}
            const userIds: string[] = config.userIds || []
            for (const uid of userIds) {
              await this.notification.send({
                userId: uid,
                workspaceId,
                type: 'info',
                title: config.title || `流程通知: ${defName}`,
                content: config.content || `自动处理节点「${action.nodeName}」发送的通知`,
              }).catch(() => {})
            }
            break
          }
          case 'webhook': {
            const config = action.actionConfig || {}
            if (config.url) {
              await fetch(config.url, {
                method: config.method || 'POST',
                headers: { 'Content-Type': 'application/json', ...(config.headers || {}) },
                body: JSON.stringify(config.body || { nodeName: action.nodeName, defName, workspaceId }),
              }).catch((e: any) => this.logger.warn(`自动处理 webhook 失败: ${e.message}`))
            }
            break
          }
          case 'update': {
            const config = action.actionConfig || {}
            // 更新表单提交数据的指定字段
            if (config.submissionId && config.field) {
              const submission = await this.prisma.formSubmission.findUnique({
                where: { id: config.submissionId },
                select: { data: true },
              })
              if (submission) {
                const newData = { ...(submission.data as any || {}), [config.field]: config.value }
                await this.prisma.formSubmission.update({
                  where: { id: config.submissionId },
                  data: { data: newData },
                })
              }
            }
            break
          }
        }
      } catch (e: any) {
        this.logger.warn(`自动处理节点「${action.nodeName}」执行失败: ${e.message}`)
      }
    }
  }

  /** 为审批任务注册 SLA 超时检测 */
  private registerSLAForTasks(
    instanceId: string,
    createdTaskIds: { id: string; nodeId: string; assigneeId: string }[],
    defNodes: ProcessNode[],
    defName: string,
    workspaceId: string,
  ) {
    for (const t of createdTaskIds) {
      const node = defNodes.find((n: any) => n.id === t.nodeId)
      if (!node) continue
      const config = (node.config || {}) as any
      if (config.timeout > 0 && config.escalateTo) {
        this.sla.register(
          t.id, instanceId, t.nodeId, config.escalateTo, t.assigneeId,
          defName, workspaceId, config.timeout, config.warnAt || 0, node.name || '',
        )
      }
    }
  }

  private async getInstanceWithTasks(id: string) {
    const instance = await this.prisma.processInstance.findUnique({
      where: { id },
      include: {
        definition: { select: { name: true, nodes: true, edges: true, settings: true } },
        tasks: { orderBy: { createdAt: 'asc' } },
      },
    })
    if (!instance) return null

    const userIds = new Set<string>()
    userIds.add(instance.initiatorId)
    instance.tasks.forEach(t => userIds.add(t.assigneeId))
    const users = await this.resolveUsers([...userIds])

    return {
      ...instance,
      initiator: users[instance.initiatorId] || null,
      tasks: instance.tasks.map(t => ({ ...t, assignee: users[t.assigneeId] || null })),
    }
  }

  /**
   * 开始节点关联的表单（设计期写入 config.formId；发布后才算真绑定）。
   * 读时也做一次深度归一：历史脏数据里 config 可能是字符串 `"{\"formId\":…}"`，
   * 若不还原，`start?.config?.formId` 会取到 undefined —— 表现为「绑了表单也不发起」。
   */
  private startFormId(nodes: unknown): string | null {
    const start = (coerceJsonDeep((nodes as any[]) || [])).find((n: any) => n.type === 'start')
    return start?.config?.formId || null
  }

  /** 同工作空间内除 exceptId 外，已有【已发布】流程绑定了同一个表单时抛 409 */
  private async assertFormBindingFree(workspaceId: string, nodes: unknown, exceptId: string) {
    const formId = this.startFormId(nodes)
    if (!formId) return // 没关联表单的流程（手动发起）不受限

    const others = await this.prisma.processDefinition.findMany({
      where: { workspaceId, status: 'published', id: { not: exceptId } },
      select: { id: true, name: true, nodes: true },
    })
    const conflict = others.find((d) => this.startFormId(d.nodes) === formId)
    if (!conflict) return

    const form = await this.prisma.form.findUnique({ where: { id: formId }, select: { name: true } })
    throw new ConflictException(
      `表单「${form?.name || formId}」已被流程「${conflict.name}」绑定，请先撤销发布或改为关联其他表单`,
    )
  }

  private async resolveUsers(ids: string[]) {
    const unique = [...new Set(ids.filter(Boolean))]
    if (!unique.length) return {} as Record<string, { id: string; nickname: string | null; email: string }>
    const users = await this.prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, nickname: true, email: true },
    })
    const map: Record<string, { id: string; nickname: string | null; email: string }> = {}
    for (const u of users) map[u.id] = u
    return map
  }
}
