/**
 * 幻觉守卫（阶段 6 / S7.2）：收尾时校验「模型声称的产物」**必有对应工具结果**。
 *
 * 背景：模型可能编造产物 —— 声称「已保存表单 / 已创建流程」，但本轮根本没有对应写工具的
 * 成功结果。纯函数、可单测；只看「完成态声明」这一确定信号 + 本轮成功的写工具名单。
 *
 * 降噪原则：只对**强完成态**声明（已保存/已创建/保存成功 等）判定；含糊表述不判。
 */

/** 各产工具的「完成态声明」特征（命中即认为模型在声称该动作已完成） */
const CLAIM_PATTERNS: { tool: string; re: RegExp; note: string }[] = [
  { tool: 'form_save', re: /已(保存|发布|加入空间)|保存成功|表单已(建好|生成|创建)/, note: '表单保存' },
  { tool: 'flow_save', re: /流程已(保存|发布|创建)|已保存流程/, note: '流程保存' },
  {
    tool: 'form_rollback',
    re: /已(经)?(帮你)?回滚|回滚(成功|完成)/,
    note: '表单回滚',
  },
  // 版本删除需排在表单删除之前：更具体的「删除版本」先匹配
  {
    tool: 'form_version_delete',
    re: /已(经)?(帮你)?删除.{0,4}版本|版本已(经)?删除/,
    note: '版本删除',
  },
  {
    tool: 'form_delete',
    re: /已(经)?(帮你)?删除|删除成功|已移入回收站/,
    note: '表单删除',
  },
  {
    tool: 'template_instantiate',
    re: /已(用模板)?生成(一份)?表单|模板已(实例化|生成)/,
    note: '模板实例化',
  },
]

export interface HallucinationCheck {
  suspicious: boolean
  /** 命中的完成态声明原文（便于日志/展示） */
  claim?: string
  /** 该声明期望出现、但本轮未成功的写工具 */
  expectedTool?: string
  note?: string
}

/**
 * @param content      收尾文本
 * @param produceTools 该 Agent 的写工具白名单（AgentSpec.produceTools）
 * @param turnToolOk   本轮**成功执行**过的工具名（AgentState.turnToolOk）
 */
export function guardHallucination(
  content: string,
  produceTools: string[],
  turnToolOk: string[],
): HallucinationCheck {
  if (!content) return { suspicious: false }
  // 该 Agent 无写能力：不判（如 submission 只读）
  if (produceTools.length === 0) return { suspicious: false }
  const ok = new Set(turnToolOk)

  for (const { tool, re, note } of CLAIM_PATTERNS) {
    if (!produceTools.includes(tool)) continue
    const m = content.match(re)
    if (!m) continue
    if (ok.has(tool)) continue // 有对应工具结果 → 不是幻觉
    return { suspicious: true, claim: m[0], expectedTool: tool, note }
  }
  return { suspicious: false }
}

/** 命中幻觉时追加给用户的纠正说明 */
export function hallucinationCorrection(note?: string): string {
  return `\n\n（说明：本次尚未实际${note ?? '完成该操作'}并落库，请确认后再让我保存。）`
}
