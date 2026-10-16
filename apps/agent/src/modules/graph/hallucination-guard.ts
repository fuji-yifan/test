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
  // 保存与发布分成两个工具，正则必须互斥：flow_save 只在「保存/创建」时判（去掉「发布」），
  // 否则只调了 flow_save 却说「流程已发布」（未真正发布）会被 flow_save 的正则兜住而漏判。
  { tool: 'flow_save', re: /流程已(保存|创建)|已保存流程/, note: '流程保存' },
  { tool: 'flow_publish', re: /流程已发布|发布成功|已上线/, note: '流程发布' },
  {
    tool: 'form_rollback',
    re: /已(经)?(帮你)?回滚|回滚(成功|完成)/,
    note: '表单回滚',
  },
  // 版本删除与表单删除在同一 Agent 的 produceTools 里共存，两个正则必须互斥：
  // 表单删除用负向断言排除「删除…版本 / 版本删除」措辞，否则一次成功的版本删除
  // 会在 form_version_delete（有结果→continue）之后又被 form_delete 误判（见 spec）。
  {
    tool: 'form_version_delete',
    re: /已(经)?(帮你)?删除.{0,4}版本|版本已(经)?删除/,
    note: '版本删除',
  },
  {
    tool: 'form_delete',
    re: /已(经)?(帮你)?删除(?!.{0,4}版本)|(?<!版本)删除成功|已移入回收站/,
    note: '表单删除',
  },
  {
    tool: 'template_instantiate',
    re: /已(用模板)?生成(一份)?表单|模板已(实例化|生成)/,
    note: '模板实例化',
  },
]

/**
 * 失败叙述的标记词：同一句里出现这些词，说明模型在**转述失败**而非声称完成。
 *
 * 背景（2026-10-16 实测）：form_save 因工作空间被删而 404 后，模型把 server 的文案
 * 「工作空间不存在或已删除（404）」原样回给用户 —— 其中的「已删除」被 form_delete 的
 * 完成态正则命中，于是守卫误报「未经工具确认的完成声明（已删除）」并追加一通驴唇
 * 不对马嘴的「尚未实际表单删除并落库」。转述错误 ≠ 幻觉，必须排除。
 *
 * 用「失败/无法/不存在/返回错误」等**实指失败**的词，而不是泛化的「错误」，否则
 * 「已保存成功，没有任何错误」这类正常收尾会被误排除（漏报）。
 */
const FAILURE_MARKERS = /失败|无法|不能|不存在|超时|拒绝|异常|报错|出错|错误[:：]|返回错误|未成功/

/** 只扫描「非失败叙述」的句子（按句切开，丢掉带失败标记的整句） */
function scannable(content: string): string {
  return content
    .split(/[。！？!?\n]/)
    .filter((s) => !FAILURE_MARKERS.test(s))
    .join('。')
}

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
  // 先剔除「失败叙述」的句子，避免把转述的错误文案当成完成态声明
  const text = scannable(content)

  for (const { tool, re, note } of CLAIM_PATTERNS) {
    if (!produceTools.includes(tool)) continue
    const m = text.match(re)
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
