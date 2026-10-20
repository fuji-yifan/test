/**
 * 前端共享数据模型
 * 与后端 Prisma Schema 对齐，消除组件间的 any 传递
 */

// ==================== API 响应 ====================
export interface ApiResponse<T = unknown> {
  code: number
  data: T
  message: string
}

export interface Pagination {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export interface PaginatedData<T> {
  list: T[]
  pagination: Pagination
}

// ==================== 用户 ====================
export interface User {
  id: string
  email: string
  nickname?: string
  avatarUrl?: string
}

// ==================== 工作空间 ====================
export interface Workspace {
  id: string
  name: string
  slug: string
  remark?: string
  logoUrl?: string
  plan: string
  role: 'owner' | 'editor' | 'viewer'
  maxForms: number
  maxMembers: number
  createdAt: string
}

// ==================== 工作空间成员 ====================
export interface Member {
  userId: string
  role: 'owner' | 'editor' | 'viewer'
  user: User
  createdAt: string
}

// ==================== 角色 & 权限 ====================
export interface Role {
  id: string
  workspaceId: string
  name: string
  permissions: string[]
  isSystem: boolean
  /** 权限矩阵接口下发：该角色为系统角色，权限由系统固定、不可改（创建者恒为全权限、查看者恒为空），前端据此锁行 */
  permissionsLocked?: boolean
  users?: { user: User }[]
  createdAt: string
}

// ==================== 表单 ====================
export interface Form {
  id: string
  workspaceId: string
  name: string
  description?: string
  schema: Record<string, unknown>
  category?: string
  tags: string[]
  status: 'draft' | 'published' | 'archived'
  publishedAt?: string
  publishedVersion: number
  maxSubmissions: number
  enableCaptcha: boolean
  redirectUrl?: string
  settings: Record<string, unknown>
  createdBy?: string
  updatedBy?: string
  createdAt: string
  updatedAt: string
}

// ==================== 表单提交 ====================
export interface Submission {
  id: string
  formId: string
  formVersion: number
  data: Record<string, unknown>
  meta: Record<string, unknown>
  submitterId?: string
  status: 'submitted' | 'reviewed' | 'marked'
  createdAt: string
}

// ==================== 审计日志 ====================
export interface AuditLog {
  id: string
  userId?: string
  action: string
  resourceType?: string
  resourceId?: string
  details: Record<string, unknown>
  ip?: string
  createdAt: string
}

// ==================== 通知 ====================
export interface Notification {
  id: string
  userId: string
  type: string
  title: string
  content: string
  isRead: boolean
  relatedType?: string
  relatedId?: string
  createdAt: string
}

// ==================== 流程 ====================
export interface ProcessDefinition {
  id: string
  workspaceId: string
  name: string
  description?: string
  version: number
  status: 'draft' | 'published'
  nodes: Record<string, unknown>[]
  edges: Record<string, unknown>[]
  createdAt: string
  updatedAt: string
}

export interface TaskInstance {
  id: string
  instanceId: string
  nodeId: string
  assigneeId: string
  status: 'pending' | 'approved' | 'rejected' | 'transferred'
  comment?: string
  createdAt: string
}

// ==================== 模板 ====================
export interface Template {
  id: string
  name: string
  description?: string
  thumbnailUrl?: string
  schema: Record<string, unknown>
  category?: string
  tags: string[]
  usageCount: number
}

// ==================== 分析 ====================
export interface TrendItem {
  date: string
  count: number
}

export interface FormRankingItem {
  name: string
  submissionCount: number
}

export interface StatusPieItem {
  status: string
  count: number
}
