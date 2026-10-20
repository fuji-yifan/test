// ==================== 流程定义 ====================

export type NodeType =
  | 'start'
  | 'end'
  | 'approval'
  | 'direct-approval'
  | 'role-approval'
  | 'countersign'
  | 'or-sign'
  | 'cc'
  | 'auto-task'
  | 'condition'
  | 'parallel'
  | 'join'
  | 'subprocess'

/** 所有审批类节点类型 */
export const APPROVAL_NODE_TYPES: NodeType[] = [
  'approval', 'direct-approval', 'role-approval', 'countersign', 'or-sign',
]

export interface ProcessDefinition {
  id: string
  workspaceId: string
  name: string
  description?: string
  version: number
  status: 'draft' | 'published'
  nodes: ProcessNode[]
  edges: ProcessEdge[]
  settings: ProcessSettings
  createdAt: string
  updatedAt: string
}

export interface ProcessNode {
  id: string
  type: NodeType
  name: string
  position: { x: number; y: number }
  config: Record<string, any>
}

// ==================== 开始节点配置 ====================

export interface StartNodeConfig {
  /** 绑定的表单 ID */
  formId: string
  /** 绑定的表单名称（冗余存储，方便展示） */
  formName: string
  /** 提取为流程变量的表单字段 key 列表（供条件节点使用） */
  variables: string[]
}

// ==================== 审批节点配置 ====================

export interface ApprovalConfig {
  type: 'single' | 'multi'
  /** 审批人 ID 列表，支持表达式如 "${deptManager}" */
  assignees: string[]
  strategy: CountersignStrategy
  /** 超时时间（小时），0 = 不限制 */
  timeout: number
  allowTransfer: boolean
  allowAddSign: boolean
}

export interface CountersignStrategy {
  /** all = 会签(全部通过), any = 或签(任一通过), ratio = 比例通过 */
  type: 'all' | 'any' | 'ratio'
  /** 比例模式下通过率，如 0.6 = 60% */
  ratio?: number
}

// ==================== 流程设置 ====================

export interface ProcessSettings {
  allowWithdraw: boolean
  allowUrge: boolean
  urgeTimeout: number
}

// ==================== 流程连线 ====================

export interface ProcessEdge {
  id: string
  sourceNodeId: string
  targetNodeId: string
  condition?: string
  label?: string
}

// ==================== 流程实例 ====================

export enum ProcessState {
  DRAFT = 'draft',
  APPROVING = 'approving',
  COMPLETED = 'completed',
  REJECTED = 'rejected',
  WITHDRAWN = 'withdrawn',
  TIMEOUT = 'timeout',
}

export interface ProcessInstance {
  id: string
  definitionId: string
  definitionVersion: number
  formId: string | null
  submissionId: string | null
  initiatorId: string
  currentState: ProcessState
  currentNodeIds: string[]
  context: Record<string, any>
  createdAt: string
  updatedAt: string
  completedAt?: string | null
}

// ==================== 任务实例 ====================

export enum TaskStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  TRANSFERRED = 'transferred',
  WITHDRAWN = 'withdrawn',
}

export interface TaskInstance {
  id: string
  instanceId: string
  nodeId: string
  assigneeId: string
  status: TaskStatus
  comment?: string
  createdAt: string
  processedAt?: string
  transferredFrom?: string
  addedBySign?: boolean
}

// ==================== 流程转换 ====================

export enum ProcessTransition {
  SUBMIT = 'submit',
  APPROVE = 'approve',
  REJECT = 'reject',
  WITHDRAW = 'withdraw',
  TRANSFER = 'transfer',
  ADD_SIGN = 'add_sign',
  URGE = 'urge',
  TIMEOUT = 'timeout',
}

export interface TransitionContext {
  operatorId: string
  comment?: string
  targetUserId?: string
  targetNodeId?: string
}

// ==================== 状态转换映射 ====================

export const STATE_TRANSITIONS: Record<ProcessState, ProcessTransition[]> = {
  [ProcessState.DRAFT]: [ProcessTransition.SUBMIT],
  [ProcessState.APPROVING]: [
    ProcessTransition.APPROVE,
    ProcessTransition.REJECT,
    ProcessTransition.WITHDRAW,
    ProcessTransition.TRANSFER,
    ProcessTransition.ADD_SIGN,
    ProcessTransition.TIMEOUT,
  ],
  [ProcessState.COMPLETED]: [],
  [ProcessState.REJECTED]: [],
  [ProcessState.WITHDRAWN]: [],
  [ProcessState.TIMEOUT]: [ProcessTransition.URGE],
}

/** 转换后的目标状态 */
export const TRANSITION_TARGET: Record<ProcessTransition, ProcessState | null> = {
  [ProcessTransition.SUBMIT]: ProcessState.APPROVING,
  [ProcessTransition.APPROVE]: null,      // 取决于是否所有节点完成
  [ProcessTransition.REJECT]: ProcessState.REJECTED,
  [ProcessTransition.WITHDRAW]: ProcessState.WITHDRAWN,
  [ProcessTransition.TRANSFER]: null,     // 状态不变，转交任务
  [ProcessTransition.ADD_SIGN]: null,     // 状态不变，增加协办人
  [ProcessTransition.URGE]: null,         // 状态不变，发送提醒
  [ProcessTransition.TIMEOUT]: ProcessState.TIMEOUT,
}
