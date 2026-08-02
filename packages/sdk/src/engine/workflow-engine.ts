/**
 * WorkflowEngine — 轻量级流程引擎
 *
 * 实现 BPMN 2.0 核心子集：审批/条件分支/会签/或签/撤回/驳回/加签/转交。
 * 纯 TypeScript 逻辑，零 UI 依赖，可作为 Headless 引擎在任意环境运行。
 */

import type {
  ProcessDefinition,
  ProcessInstance,
  TaskInstance,
  ApprovalConfig,
  CountersignStrategy,
} from '../types/workflow.js'
import { ProcessState, TaskStatus, ProcessTransition, STATE_TRANSITIONS, TRANSITION_TARGET, APPROVAL_NODE_TYPES } from '../types/workflow.js'
import { ExpressionEngine } from '../utils/expression-eval.js'

// ==================== 状态机 ====================

export class WorkflowStateMachine {
  constructor(private currentState: ProcessState) {}

  get state(): ProcessState {
    return this.currentState
  }

  getAvailableTransitions(): ProcessTransition[] {
    return STATE_TRANSITIONS[this.currentState] || []
  }

  canTransition(transition: ProcessTransition): boolean {
    return this.getAvailableTransitions().includes(transition)
  }

  transition(transition: ProcessTransition): ProcessState {
    if (!this.canTransition(transition)) {
      throw new Error(
        `Cannot transition from "${this.currentState}" via "${transition}". ` +
        `Allowed: ${this.getAvailableTransitions().join(', ')}`
      )
    }
    const target = TRANSITION_TARGET[transition]
    if (target) {
      this.currentState = target
    }
    return this.currentState
  }
}

// ==================== 会签/或签评估 ====================

export class CountersignEvaluator {
  /**
   * 评估会签结果
   * @returns 'approved' | 'rejected' | 'pending'
   */
  static evaluate(
    strategy: CountersignStrategy,
    tasks: Pick<TaskInstance, 'status' | 'assigneeId'>[],
  ): 'approved' | 'rejected' | 'pending' {
    const total = tasks.length
    const approved = tasks.filter((t) => t.status === TaskStatus.APPROVED).length
    const rejected = tasks.filter((t) => t.status === TaskStatus.REJECTED).length

    // 任一驳回 → 整体驳回
    if (rejected > 0) {
      return 'rejected'
    }

    switch (strategy.type) {
      case 'all':
        return approved === total ? 'approved' : 'pending'
      case 'any':
        return approved > 0 ? 'approved' : 'pending'
      case 'ratio': {
        const ratio = strategy.ratio ?? 0.5
        return approved / total >= ratio ? 'approved' : 'pending'
      }
      default:
        return 'pending'
    }
  }
}

// ==================== 流程引擎 ====================

export interface WorkflowEngineOptions {
  expressionEngine?: ExpressionEngine
}

export class WorkflowEngine {
  private expressionEngine: ExpressionEngine

  /** 无任务节点类型——这些节点不需要人工处理，引擎自动穿越 */
  private static readonly GATEWAY_TYPES = ['condition', 'parallel', 'join', 'cc', 'auto-task']

  constructor(options: WorkflowEngineOptions = {}) {
    this.expressionEngine = options.expressionEngine || ExpressionEngine.getInstance()
  }

  // ==================== 流程发起 ====================

  /**
   * 发起流程：从开始节点找到第一个实际处理节点，自动穿越条件/并行等网关
   */
  startProcess(definition: ProcessDefinition, initiatorId: string, formData: Record<string, any>): {
    instance: Omit<ProcessInstance, 'id' | 'createdAt' | 'updatedAt'>
    tasks: Omit<TaskInstance, 'id' | 'createdAt'>[]
    ccRecipients: { userId: string; nodeName: string }[]
    autoTaskActions: { nodeId: string; nodeName: string; actionType: string; actionConfig: any }[]
  } {
    const startNode = definition.nodes.find((n) => n.type === 'start')
    if (!startNode) throw new Error('Process definition has no start node')

    const nextEdges = definition.edges.filter((e) => e.sourceNodeId === startNode.id)
    if (nextEdges.length === 0) throw new Error('Start node has no outgoing edges')

    const firstNodeId = nextEdges[0].targetNodeId
    let currentNodeIds = this.expandParallelBranches(definition, [firstNodeId])
    const completedGateways: string[] = []
    currentNodeIds = this.advanceThroughGateways(definition, currentNodeIds, formData, completedGateways)
    const ccRecipients = this.collectCCRecipients(definition, completedGateways)
    const tasks = this.createTasksForNodes(definition, currentNodeIds, initiatorId)

    const finished = currentNodeIds.length === 0 || currentNodeIds.every((id) => {
      const node = definition.nodes.find((n) => n.id === id)
      return !node || node.type === 'end'
    })

    const instance = {
      definitionId: definition.id,
      definitionVersion: definition.version,
      formId: '',
      submissionId: '',
      initiatorId,
      currentState: finished ? ProcessState.COMPLETED : ProcessState.APPROVING,
      currentNodeIds,
      context: formData,
    }

    const autoTaskActions = this.collectAutoTaskActions(definition, completedGateways)

    return { instance, tasks, ccRecipients, autoTaskActions }
  }

  // ==================== 审批通过 ====================

  /**
   * 处理审批通过：当前任务完成，自动穿越条件/并行/抄送等无任务节点，直到抵达审批节点或结束
   */
  approveTask(
    definition: ProcessDefinition,
    instance: ProcessInstance,
    currentNodeId: string,
    operatorId: string,
    comment?: string,
  ): {
    newState: ProcessState
    nextNodeIds: string[]
    completedTasks: string[]
    ccRecipients: { userId: string; nodeName: string }[]
    autoTaskActions: { nodeId: string; nodeName: string; actionType: string; actionConfig: any }[]
    newTasks: Omit<TaskInstance, 'id' | 'createdAt'>[]
    finished: boolean
  } {
    const completedTasks = [currentNodeId]

    let nextIds = this.findNextNodeIds(definition, currentNodeId, instance.context)
    nextIds = this.advanceThroughGateways(definition, nextIds, instance.context, completedTasks)

    const finished = nextIds.length === 0 || nextIds.every((id) => {
      const node = definition.nodes.find((n) => n.id === id)
      return !node || node.type === 'end'
    })

    const newState = finished ? ProcessState.COMPLETED : ProcessState.APPROVING
    const newTasks = finished ? [] : this.createTasksForNodes(definition, nextIds, instance.initiatorId)
    const ccRecipients = this.collectCCRecipients(definition, completedTasks)
    const autoTaskActions = this.collectAutoTaskActions(definition, completedTasks)

    return { newState, nextNodeIds: nextIds, completedTasks, ccRecipients, autoTaskActions, newTasks, finished }
  }

  // ==================== 驳回 ====================

  rejectTask(
    definition: ProcessDefinition,
    instance: ProcessInstance,
    currentNodeId: string,
    targetNodeId?: string,
    comment?: string,
  ): {
    newState: ProcessState
    targetNodeIds: string[]
  } {
    let targetIds: string[]
    if (targetNodeId) {
      targetIds = [targetNodeId]
    } else {
      const incomingEdges = definition.edges.filter((e) => e.targetNodeId === currentNodeId)
      targetIds = incomingEdges.map((e) => e.sourceNodeId).filter((id) => {
        const node = definition.nodes.find((n) => n.id === id)
        return node && node.type !== 'start'
      })
    }

    return {
      newState: ProcessState.REJECTED,
      targetNodeIds: targetIds,
    }
  }

  // ==================== 条件分支求值 ====================

  /**
   * 自动穿越无任务节点，直到遇到审批节点或结束
   */
  private advanceThroughGateways(
    definition: ProcessDefinition,
    startNodeIds: string[],
    context: Record<string, any>,
    completedLog: string[],
  ): string[] {
    let current = startNodeIds
    const visited = new Set<string>()

    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (current.length === 0) return []
      if (current.every((id) => {
        const node = definition.nodes.find((n) => n.id === id)
        return !node || node.type === 'end'
      })) return current

      let hasGateway = false
      const nextIds: string[] = []

      for (const id of current) {
        const node = definition.nodes.find((n) => n.id === id)
        if (!node) continue

        if (WorkflowEngine.GATEWAY_TYPES.includes(node.type)) {
          hasGateway = true
          completedLog.push(id)
          const next = this.findNextNodeIds(definition, id, context)
          nextIds.push(...next)
        } else {
          nextIds.push(id)
        }
      }

      if (!hasGateway) return current

      // 防止死循环
      const fingerprint = nextIds.sort().join(',')
      if (visited.has(fingerprint)) return nextIds
      visited.add(fingerprint)

      current = nextIds
    }
  }

  /**
   * 从条件节点的出边中求值，决定走哪个分支。
   * edges 上存有 condition（表达式）和 _isDefault（是否默认分支）。
   */
  evaluateConditionEdges(
    edges: { targetNodeId: string; condition?: string; _isDefault?: boolean }[],
    context: Record<string, any>,
  ): string | null {
    let defaultTarget: string | null = null

    for (const edge of edges) {
      if (edge._isDefault || !edge.condition) {
        defaultTarget = edge.targetNodeId
        continue
      }

      const expr = edge.condition.replace(/\$\{(\w+)\}/g, '$1')
      try {
        const result = this.expressionEngine.evaluate(expr, context)
        if (result) return edge.targetNodeId
      } catch { continue }
    }

    return defaultTarget
  }

  // ==================== 流程撤回 ====================

  canWithdraw(definition: ProcessDefinition, instance: ProcessInstance, operatorId: string): boolean {
    if (!definition.settings?.allowWithdraw) return false
    if (instance.initiatorId !== operatorId) return false
    if (instance.currentState !== ProcessState.APPROVING) return false
    return true
  }

  // ==================== 内部辅助方法 ====================

  /**
   * 从指定节点找到所有后续节点（处理条件分支、并行分支）
   */
  private findNextNodeIds(definition: ProcessDefinition, nodeId: string, context: Record<string, any>): string[] {
    const currentNode = definition.nodes.find((n) => n.id === nodeId)
    if (!currentNode) return []

    const outgoingEdges = definition.edges.filter((e) => e.sourceNodeId === nodeId)

    // 条件分支：从 edges 上的条件表达式求值决定走哪条路
    if (currentNode.type === 'condition') {
      const targetId = this.evaluateConditionEdges(outgoingEdges, context)
      if (!targetId) return []
      const node = definition.nodes.find((n) => n.id === targetId)
      if (node?.type === 'parallel') {
        return this.expandParallelBranches(definition, [targetId])
      }
      return [targetId]
    }

    // 并行分支：展开所有目标
    if (currentNode.type === 'parallel') {
      return this.expandParallelBranches(definition, [nodeId])
    }

    // 正常流转
    return outgoingEdges.map((e) => e.targetNodeId)
  }

  /**
   * 展开并行分支：从一个并行节点出发，展开所有子分支的下一层节点
   */
  private expandParallelBranches(definition: ProcessDefinition, nodeIds: string[]): string[] {
    const result: string[] = []
    for (const id of nodeIds) {
      const node = definition.nodes.find((n) => n.id === id)
      if (!node) continue
      if (node.type === 'parallel') {
        const edges = definition.edges.filter((e) => e.sourceNodeId === id)
        result.push(...edges.map((e) => e.targetNodeId))
      } else {
        result.push(id)
      }
    }
    return result
  }

  /**
   * 为节点创建待办任务
   */
  private createTasksForNodes(
    definition: ProcessDefinition,
    nodeIds: string[],
    _initiatorId: string,
  ): Omit<TaskInstance, 'id' | 'createdAt'>[] {
    const tasks: Omit<TaskInstance, 'id' | 'createdAt'>[] = []
    for (const nodeId of nodeIds) {
      const node = definition.nodes.find((n) => n.id === nodeId)
      if (!node || node.type === 'start' || node.type === 'end' || node.type === 'condition' || node.type === 'cc') continue

      if (APPROVAL_NODE_TYPES.includes(node.type)) {
        const config = node.config as ApprovalConfig
        for (const assigneeId of config.assignees) {
          if (assigneeId.startsWith('${')) continue
          tasks.push({
            instanceId: '',
            nodeId,
            assigneeId,
            status: TaskStatus.PENDING,
          })
        }
      }
    }
    return tasks
  }

  // ==================== 工具方法 ====================

  getNodeApprovalConfig(definition: ProcessDefinition, nodeId: string): ApprovalConfig | null {
    const node = definition.nodes.find((n) => n.id === nodeId)
    if (!node || node.type !== 'approval') return null
    return node.config as ApprovalConfig
  }

  /**
   * 从穿越的网关节点中提取自动处理动作。
   */
  collectAutoTaskActions(
    definition: ProcessDefinition,
    completedGatewayIds: string[],
  ): { nodeId: string; nodeName: string; actionType: string; actionConfig: any }[] {
    const actions: { nodeId: string; nodeName: string; actionType: string; actionConfig: any }[] = []
    for (const nodeId of completedGatewayIds) {
      const node = definition.nodes.find((n) => n.id === nodeId)
      if (node?.type !== 'auto-task') continue
      const config = node.config || {}
      if (config.actionType) {
        let actionConfig = config.actionConfig || {}
        if (typeof actionConfig === 'string') {
          try { actionConfig = JSON.parse(actionConfig) } catch { actionConfig = {} }
        }
        actions.push({
          nodeId,
          nodeName: node.name || '自动处理',
          actionType: config.actionType as string,
          actionConfig,
        })
      }
    }
    return actions
  }

  /**
   * 从穿越的网关节点中提取抄送目标。
   * 返回需要通知的 userId 列表（含节点名称，用于通知内容）。
   */
  collectCCRecipients(
    definition: ProcessDefinition,
    completedGatewayIds: string[],
  ): { userId: string; nodeName: string }[] {
    const recipients: { userId: string; nodeName: string }[] = []
    for (const nodeId of completedGatewayIds) {
      const node = definition.nodes.find((n) => n.id === nodeId)
      if (node?.type !== 'cc') continue
      const ccList: string[] = node.config?.ccList || []
      for (const userId of ccList) {
        if (userId && !userId.startsWith('${')) {
          recipients.push({ userId, nodeName: node.name || '抄送节点' })
        }
      }
    }
    return recipients
  }

  /**
   * 从表单提交数据中提取流程变量。
   * 根据开始节点配置的 variables 列表，过滤出需要的字段注入流程上下文。
   */
  extractProcessVariables(definition: ProcessDefinition, submissionData: Record<string, any>): Record<string, any> {
    const startNode = definition.nodes.find((n) => n.type === 'start')
    if (!startNode?.config?.variables?.length) return submissionData

    const varKeys: string[] = startNode.config.variables
    const result: Record<string, any> = {}
    for (const key of varKeys) {
      if (key in submissionData) {
        result[key] = submissionData[key]
      }
    }
    return result
  }

  resolveAssigneeExpression(expression: string, context: Record<string, any>): string {
    if (!expression.startsWith('${') || !expression.endsWith('}')) return expression
    const varName = expression.slice(2, -1)
    return context[varName] ?? expression
  }
}
