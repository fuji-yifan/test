/**
 * 产物映射：把 session.metadata 里的草稿键翻译成前端预览卡片认的 result 结构。
 *
 * 图内的 `message` 事件只带 content，前端预览卡片的数据源却是 `message.result`，
 * 所以适配层在收尾时用它补发一次。
 */
import type { AgentKey } from '../graph/agent-state'

/** agent -> 该 agent 产物在 metadata 里的草稿键 */
const AGENT_DRAFT_KEY: Record<AgentKey, string> = {
  'form-designer': 'draftSchema',
  workflow: 'draftWorkflow',
  template: 'draftTemplate',
  submission: 'lastAnalysis',
}

/** 草稿键的声明顺序，用作「不知道是哪个 agent」时的回退顺序 */
const DRAFT_KEY_ORDER = Object.values(AGENT_DRAFT_KEY)

function readDraft(key: string, metadata: Record<string, any>): Record<string, unknown> | null {
  const value = metadata?.[key]
  if (!value || typeof value !== 'object') return null
  // form-designer 的草稿是裸 schema，其余是完整产物对象；前端预览卡片统一从 result 里嗅探。
  // 会话里有多张表时把清单一起带上（前端渲染多行摘要列表），单张时与旧形态一致。
  if (key === 'draftSchema') {
    const forms = metadata?.draftForms
    return {
      schema: value,
      ...(Array.isArray(forms) && forms.length > 0 ? { forms } : {}),
    }
  }
  return value as Record<string, unknown>
}

/** 按 agent 取产物：取不到就是 null，不回退。 */
export function extractArtifactData(
  agent: string | null | undefined,
  metadata: Record<string, any> | null | undefined,
): Record<string, unknown> | null {
  if (!metadata) return null
  const key = AGENT_DRAFT_KEY[agent as AgentKey]
  return key ? readDraft(key, metadata) : null
}

/**
 * 不指定 agent 时取「最近一份可用产物」，按声明顺序回退。
 *
 * langgraph 收尾时 metadata.activeSubAgent 可能为 null（halted 或计划已结束），
 * 此时前端仍需要拿到 result 才能渲染预览卡片。
 */
export function extractLatestArtifact(
  metadata: Record<string, any> | null | undefined,
): Record<string, unknown> | null {
  if (!metadata) return null
  for (const key of DRAFT_KEY_ORDER) {
    const hit = readDraft(key, metadata)
    if (hit) return hit
  }
  return null
}
