/**
 * 预览用的节点**图标规格** —— 逐项对齐 InstanceViewer.vue（「流程进度查看」页）。
 *
 * 尺寸与类型别名（notify→cc / service→auto-task）已上移到 SDK 共享纯函数
 * （`@furmx/sdk` 的 flowNodeSize / normalizeFlowType），这里只保留**各页允许不同**的
 * 图标与形状 —— 布局由 SDK 统一，图标风格各页自持。
 */

import type { Component } from 'vue'
import { normalizeFlowType } from '@furmx/sdk'
import {
  VideoPlay, VideoPause, User, QuestionFilled, Rank,
  Connection, Message, Setting,
} from '@element-plus/icons-vue'

export type NodeShape = 'circle' | 'gateway' | 'rect'

export interface FlowNodeVisual {
  /** 类名后缀，对应 InstanceViewer 的 `.node-xxx` 规则 */
  viewType: string
  icon: Component
  shape: NodeShape
  iconSize: number
}

/** 图标与形状逐个抄自 InstanceViewer.vue（nodeIcon + CIRCLE/GW） */
const VISUALS: Record<string, FlowNodeVisual> = {
  start: { viewType: 'start', icon: VideoPlay, shape: 'circle', iconSize: 22 },
  end: { viewType: 'end', icon: VideoPause, shape: 'circle', iconSize: 22 },
  approval: { viewType: 'approval', icon: User, shape: 'rect', iconSize: 16 },
  condition: { viewType: 'condition', icon: QuestionFilled, shape: 'gateway', iconSize: 18 },
  parallel: { viewType: 'parallel', icon: Rank, shape: 'gateway', iconSize: 18 },
  join: { viewType: 'join', icon: Connection, shape: 'gateway', iconSize: 18 },
  cc: { viewType: 'cc', icon: Message, shape: 'rect', iconSize: 16 },
  'auto-task': { viewType: 'auto-task', icon: Setting, shape: 'rect', iconSize: 16 },
}

/** InstanceViewer 认不出来的类型走它的图标兜底，形状按普通矩形 */
const FALLBACK: FlowNodeVisual = {
  viewType: 'unknown', icon: QuestionFilled, shape: 'rect', iconSize: 16,
}

export function nodeVisual(type: string | undefined): FlowNodeVisual {
  return VISUALS[normalizeFlowType(type)] || FALLBACK
}
