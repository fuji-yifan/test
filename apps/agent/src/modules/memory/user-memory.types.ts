/**
 * 用户级长期记忆（阶段 8 §3.7）的类型。
 *
 * 与会话内记忆（§2.12 SessionContext）互补：那是「一次对话内」，这里是「跨对话、按用户」。
 * 只承载**结构化标量**（同 §2.12 Facts 口径），带 source 溯源、可软删。
 */

/** 记忆种类：偏好 / 身份事实 / 常用对象 / 已确认结论 */
export type UserMemoryKind = 'preference' | 'identity' | 'entity' | 'conclusion'

export const USER_MEMORY_KINDS: UserMemoryKind[] = ['preference', 'identity', 'entity', 'conclusion']

/** 落库后的一条记忆 */
export interface UserMemoryRecord {
  id: string
  userId: string
  workspaceId: string
  kind: UserMemoryKind
  key: string
  value: string
  confidence: number
  /** 来源会话 id（溯源；对象被删时可据此清理） */
  sourceSessionId?: string | null
  /** 软删标记（forgotten 不再召回/展示） */
  state?: 'active' | 'forgotten'
  createdAt?: number
  updatedAt?: number
}

/** 提取器产出的候选（尚未落库：无 id / 时间戳） */
export interface UserMemoryCandidate {
  kind: UserMemoryKind
  key: string
  value: string
  confidence: number
}

/** 值 / 键的长度上限（进 DB varchar 前的硬护栏） */
export const MEMORY_VALUE_MAX = 200
export const MEMORY_KEY_MAX = 64
