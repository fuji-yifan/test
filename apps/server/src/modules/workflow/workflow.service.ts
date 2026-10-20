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

    const [rows, total] = await Promise.all([
      this.prisma.processDefinition.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { updatedAt: 'desc' },
        select: { id: true, name: true, description: true, status: true, publishedAt: true, createdAt: true, updatedAt: true, nodes: true },
      }),
      this.prisma.processDefinition.count({ where }),
    ])

    const startForms = await this.resolveStartForms(rows.map((d) => d.nodes))
    const list = rows.map(({ nodes, ...rest }, idx) => ({ ...rest, ...startForms[idx] }))

    return {
      list,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    }
  }

  async createDefinition(workspaceId: string, userId: string, dto: { name: string; description?: string; nodes?: any; edges?: any }) {
    const defaultNodes: ProcessNode[] = [
      { id: 'start', type: 'start', name: '开始', position: { x: 195, y: 45 }, config: {} },
      { id: 'end', type: 'end', name: '结束', position: { x: 195, y: 405 }, config: {} },
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

    const formId = this.startFormId(def.nodes)
    if (!formId) {
      throw new BadRequestException('请先为该流程关联表单后再发布')
    }

    // 绑定的表单必须真实存在且属于当前空间：agent 曾把模型编造的 id 写进开始节点，
    // 不校验的话流程能发布成功、但提交表单永远不会触发。
    const boundForm = await this.prisma.form.findFirst({
      where: { id: formId, workspaceId: def.workspaceId, deletedAt: null },
      select: { id: true },
    })
    if (!boundForm) {
      throw new BadRequestException('关联的表单不存在或已删除，请重新关联后再发布')
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
        // 发起即定格：之后在设计器里改流程，不影响这条实例的展示与流转
        definitionSnapshot: { name: definition.name, nodes, edges, settings } as any,
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
  async approveTask(
    instanceId: string,
    nodeId: string,
    operatorId: string,
    comment?: string,
    signature?: string,
    attachments?: { name: string; url: string; size?: number; mimeType?: string }[],
  ) {
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
      const decision: any = { status: 'approved', comment, processedAt: new Date() }
      if (signature) decision.signature = signature
      if (attachments?.length) decision.attachments = attachments
      await this.prisma.taskInstance.update({
        where: { id: currentTask.id },
        data: decision,
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

    // 检查该节点的会签策略（用实例冻结的那版定义，流程管理里改了定义不影响已发起的实例）
    const defSource = this.instanceDefinition(instance)
    const defNodes = (defSource.nodes as any) as ProcessNode[]
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
      ...defSource,
      nodes: defNodes,
      edges: defSource.edges as any,
      settings: defSource.settings as any,
      workspaceId: defSource.workspaceId,
      createdAt: defSource.createdAt.toISOString(),
      updatedAt: defSource.updatedAt.toISOString(),
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
        workspaceId: defSource.workspaceId,
        type: 'approval',
        title: `新的审批任务: ${defSource.name}`,
        content: `节点「${n?.name || t.nodeId}」需要你审批`,
        relatedType: 'instance',
        relatedId: instanceId,
      }).catch(() => {})
    }
    if (newTaskIds.length > 0) {
      this.registerSLAForTasks(instanceId, newTaskIds, defNodes, defSource.name, defSource.workspaceId)
    } else if (finished) {
      // 流程完成，通知发起人
      this.notification.send({
        userId: instance.initiatorId,
        workspaceId: defSource.workspaceId,
        type: 'info',
        title: `流程已完成: ${defSource.name}`,
        content: '你的流程已审批通过',
        relatedType: 'instance',
        relatedId: instanceId,
      }).catch(() => {})
    }

    // 抄送通知
    for (const cc of ccRecipients) {
      this.notification.send({
        userId: cc.userId,
        workspaceId: defSource.workspaceId,
        type: 'info',
        title: `流程通知: ${defSource.name}`,
        content: `流程已流转至下一节点，你被「${cc.nodeName}」节点抄送`,
        relatedType: 'instance',
        relatedId: instanceId,
      }).catch(() => {})
    }

    // 自动处理节点
    await this.processAutoTaskActions(autoTaskActions, defSource.workspaceId, defSource.name)

    return this.getInstanceWithTasks(instanceId)
  }

  /**
   * 驳回
   */
  async rejectTask(
    instanceId: string,
    nodeId: string,
    operatorId: string,
    comment?: string,
    targetNodeId?: string,
    signature?: string,
    attachments?: { name: string; url: string; size?: number; mimeType?: string }[],
  ) {
    const instance = await this.prisma.processInstance.findUnique({
      where: { id: instanceId },
      include: { definition: true, tasks: true },
    })
    if (!instance) throw new NotFoundException('流程实例不存在')

    const currentTask = await this.prisma.taskInstance.findFirst({
      where: { instanceId, nodeId, assigneeId: operatorId, status: 'pending' },
    })
    if (currentTask) {
      const decision: any = { status: 'rejected', comment, processedAt: new Date() }
      if (signature) decision.signature = signature
      if (attachments?.length) decision.attachments = attachments
      await this.prisma.taskInstance.update({
        where: { id: currentTask.id },
        data: decision,
      })
    }

    // 将所有该节点的 pending 任务标记为 withdrawn
    await this.prisma.taskInstance.updateMany({
      where: { instanceId, nodeId, status: 'pending' },
      data: { status: 'withdrawn' },
    })

    const defSource = this.instanceDefinition(instance)
    const defNodes = (defSource.nodes as any) as ProcessNode[]
    const def = {
      ...defSource,
      nodes: defNodes,
      edges: defSource.edges as any,
      settings: defSource.settings as any,
      workspaceId: defSource.workspaceId,
      createdAt: defSource.createdAt.toISOString(),
      updatedAt: defSource.updatedAt.toISOString(),
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
    if ((this.instanceDefinition(instance).settings as any)?.allowWithdraw === false) throw new ForbiddenException('该流程不允许撤回')
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

    const nodes = (this.instanceDefinition(instance).nodes as any[]) || []
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

    const defNodes = (this.instanceDefinition(instance).nodes as any) as ProcessNode[]
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

  async getMyTasks(userId: string, query: { page?: number; pageSize?: number; status?: string; keyword?: string }) {
    const page = Number(query.page) || 1
    const pageSize = Number(query.pageSize) || 20
    const where: any = { assigneeId: userId }
    if (query.status === 'processed') {
      where.status = { in: ['approved', 'rejected', 'transferred', 'withdrawn'] }
    } else if (query.status) {
      where.status = query.status
    }
    const keyword = (query.keyword || '').trim()
    // 分页签角标要在同一搜索词下统计两个状态组的数量，故复制一份不含 status 的 where
    const countWhere: any = { assigneeId: userId }
    if (keyword) {
      // 以发起时冻结的快照名为准（定义改名不影响历史实例），并兼容仍在用的定义名
      where.instance = {
        OR: [
          { definitionSnapshot: { path: '$.name', string_contains: keyword } },
          { definition: { name: { contains: keyword } } },
        ],
      }
      countWhere.instance = where.instance
    }

    const [list, total, groups] = await Promise.all([
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
              submissionId: true,
              createdAt: true,
              definitionSnapshot: true,
              definition: { select: { name: true, nodes: true, settings: true } },
            },
          },
        },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.taskInstance.count({ where }),
      this.prisma.taskInstance.groupBy({
        by: ['status'],
        where: countWhere,
        _count: { _all: true },
      }),
    ])

    // 「表单数据」列要的 formId/formName 放在待办行自己身上，前端不必再往里挖 instance
    const [users, forms] = await Promise.all([
      this.resolveUsers(list.map(t => t.instance.initiatorId)),
      this.resolveFormNames(list.map(t => t.instance.formId)),
    ])
    const enriched = list.map((t, idx) => {
      const { definitionSnapshot, ...instanceRest } = t.instance as any
      return {
        ...t,
        ...forms[idx],
        instance: {
          ...instanceRest,
          definition: this.instanceDefinition(t.instance),
          initiator: users[t.instance.initiatorId] || null,
        },
      }
    })

    const countOf = (s: string) => groups.find(g => g.status === s)?._count._all || 0
    const counts = {
      pending: countOf('pending'),
      processed: groups
        .filter(g => g.status !== 'pending')
        .reduce((sum, g) => sum + g._count._all, 0),
    }

    return {
      list: enriched,
      counts,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    }
  }

  async getMyInstances(userId: string, query: { page?: number; pageSize?: number; status?: string; keyword?: string }) {
    const page = Number(query.page) || 1
    const pageSize = Number(query.pageSize) || 20
    const where: any = { initiatorId: userId }
    if (query.status === 'finished') {
      where.currentState = { in: ['completed', 'rejected', 'withdrawn'] }
    } else if (query.status) {
      where.currentState = query.status
    }
    const keyword = (query.keyword || '').trim()
    // 页签角标要在同一搜索词下统计「审批中 / 已结束」两组数量
    const countWhere: any = { initiatorId: userId }
    if (keyword) {
      // 与「我的待办」一致：优先按发起时冻结的流程名匹配，兼容当前定义名
      where.OR = [
        { definitionSnapshot: { path: '$.name', string_contains: keyword } },
        { definition: { name: { contains: keyword } } },
      ]
      countWhere.OR = where.OR
    }

    const [list, total, groups] = await Promise.all([
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
      this.prisma.processInstance.groupBy({
        by: ['currentState'],
        where: countWhere,
        _count: { _all: true },
      }),
    ])

    const userIds = new Set<string>()
    list.forEach(i => {
      userIds.add(i.initiatorId)
      i.tasks.forEach(t => userIds.add(t.assigneeId))
    })
    const [users, forms] = await Promise.all([
      this.resolveUsers([...userIds]),
      this.resolveFormNames(list.map(i => i.formId)),
    ])
    const enriched = list.map((inst, idx) => {
      const { definitionSnapshot, ...rest } = inst as any
      return {
        ...rest,
        ...forms[idx],
        definition: this.instanceDefinition(inst),
        initiator: users[inst.initiatorId] || null,
        tasks: inst.tasks.map(t => ({ ...t, assignee: users[t.assigneeId] || null })),
      }
    })

    const countOf = (s: string) => groups.find(g => g.currentState === s)?._count._all || 0
    const counts = {
      approving: countOf('approving'),
      finished: countOf('completed') + countOf('rejected') + countOf('withdrawn'),
    }

    return {
      list: enriched,
      counts,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    }
  }

  async deleteInstance(instanceId: string, userId: string) {
    const instance = await this.prisma.processInstance.findUnique({
      where: { id: instanceId },
      select: { initiatorId: true },
    })
    if (!instance) throw new NotFoundException('流程实例不存在')
    if (instance.initiatorId !== userId) throw new ForbiddenException('只能删除自己发起的流程')

    // 先删除关联的任务
    await this.prisma.taskInstance.deleteMany({ where: { instanceId } })
    return this.prisma.processInstance.delete({ where: { id: instanceId } })
  }

  async getInstanceDetail(id: string) {
    return this.getInstanceWithTasks(id)
  }

  /**
   * 流程实例对应的表单数据（审批人要看到发起人当时填了什么才能判断是否通过）。
   *
   * 授权只认「发起人本人 / 该实例上有任务的人」，**不要求 submission:view**：
   * 审批角色未必配了表单数据权限（如「流程管理员」只有 task:approve/workflow:manage），
   * 而「被指派了这条任务」本身就是看这份数据的凭据。反过来，凭实例 id 硬猜也拿不到
   * 别人的数据 —— 两个条件都不满足一律 403。
   */
  async getInstanceSubmission(instanceId: string, userId: string) {
    const instance = await this.prisma.processInstance.findUnique({
      where: { id: instanceId },
      select: { initiatorId: true, formId: true, submissionId: true, tasks: { select: { assigneeId: true } } },
    })
    if (!instance) throw new NotFoundException('流程实例不存在')
    if (instance.initiatorId !== userId && !instance.tasks.some((t) => t.assigneeId === userId)) {
      throw new ForbiddenException('只能查看自己发起、或自己参与审批的流程表单数据')
    }
    if (!instance.submissionId) throw new NotFoundException('该流程没有关联的表单数据')

    const submission = await this.prisma.formSubmission.findUnique({
      where: { id: instance.submissionId },
      select: {
        id: true, formId: true, submitterId: true, data: true, createdAt: true,
        submitter: { select: { id: true, nickname: true, email: true } },
      },
    })
    if (!submission) throw new NotFoundException('表单数据不存在')

    // 表单可能被删除/归档，schema 取不到时前端仍能按原始键值展示
    const form = await this.prisma.form.findUnique({
      where: { id: instance.formId || submission.formId },
      select: { id: true, name: true, schema: true },
    })
    return { submission, form }
  }

  // ==================== 辅助 ====================

  /**
   * 实例自己的流程定义：优先返回发起时冻结的快照。
   * 快照是后加的，历史实例没有；对它们退回当前定义（无法还原历史版本）。
   * workspaceId 等非快照字段仍取关系行（这些字段本身不随编辑变化）。
   */
  private instanceDefinition(instance: { definition?: any; definitionSnapshot?: any }) {
    const live = instance.definition || {}
    const snapshot = instance.definitionSnapshot as any
    return snapshot ? { ...live, ...snapshot } : live
  }

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

    const { definitionSnapshot, ...rest } = instance as any
    return {
      ...rest,
      definition: this.instanceDefinition(instance),
      initiator: users[instance.initiatorId] || null,
      tasks: instance.tasks.map(t => ({ ...t, assignee: users[t.assigneeId] || null })),
    }
  }

  /**
   * 开始节点关联的表单（设计期写入 config.formId）；没关联返回 null。
   * 读时也做一次深度归一：历史脏数据里 config 可能是字符串 `"{\"formId\":…}"`，
   * 若不还原，`start?.config?.formId` 会取到 undefined —— 表现为「绑了表单也不发起」。
   */
  private startFormId(nodes: unknown): string | null {
    return this.startForm(nodes)?.id || null
  }

  /** 与 startFormId 同一处解析，额外带出 config.formName（仅用于展示，可能是空串） */
  private startForm(nodes: unknown): { id: string; name: string } | null {
    const start = (coerceJsonDeep((nodes as any[]) || [])).find((n: any) => n.type === 'start')
    const id = start?.config?.formId
    if (!id) return null
    return { id, name: start?.config?.formName || '' }
  }

  /**
   * 批量解析一批流程定义「开始节点关联的表单」，供流程管理列表展示。
   * 名称以 forms 表当前值为准，查不到（表单已被软删）退回 config.formName，再退回 formId。
   * 开始节点选了表单只是设计意向、发布后才真绑定，两种状态都照常展示（与设计器里看到的一致）。
   */
  private async resolveStartForms(nodesList: unknown[]): Promise<{ formId: string | null; formName: string | null }[]> {
    const startForms = nodesList.map((nodes) => this.startForm(nodes))
    const formIds = [...new Set(startForms.map((f) => f?.id).filter((v): v is string => !!v))]
    const forms = formIds.length
      ? await this.prisma.form.findMany({ where: { id: { in: formIds } }, select: { id: true, name: true } })
      : []
    const formNameById = new Map(forms.map((f) => [f.id, f.name]))
    return startForms.map((form) => form
      ? { formId: form.id, formName: formNameById.get(form.id) || form.name || form.id }
      : { formId: null, formName: null })
  }

  /**
   * 按 formId 批量取表单名（「我的流程 / 我的待办」用）。
   *
   * 这里认的是**流程实例自己记的 formId**（发起时提交的那份表单），而不是流程定义此刻绑的表单：
   * 流程事后改绑过表单时，只有前者才和「实例对应的那份提交数据」对得上。名称查不到退回 id。
   */
  private async resolveFormNames(formIds: (string | null)[]): Promise<{ formId: string | null; formName: string | null }[]> {
    const ids = [...new Set(formIds.filter((v): v is string => !!v))]
    const forms = ids.length
      ? await this.prisma.form.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
      : []
    const formNameById = new Map(forms.map((f) => [f.id, f.name]))
    return formIds.map((id) => (id ? { formId: id, formName: formNameById.get(id) || id } : { formId: null, formName: null }))
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
