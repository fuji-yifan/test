/**
 * 分级降级链（阶段 6 / S7.4）：`模型 → 规则/模板 → 静态话术`。
 *
 * 在此之前的收尾只有「全成 / 全弃」：模型不可用或迭代用尽就直接给一句静态话术，
 * 即使用户本轮已经产出了草稿也照丢。这里按「本轮有无草稿」这一确定信号分两档：
 * - 有草稿 → 规则/模板层：明确告知，但**已保留当前草稿**，稍后可继续；
 * - 无草稿 → 静态话术层。
 *
 * 纯函数、可单测；降级原因随 SSE `degrade` 事件与日志外泄（审计落库属阶段 6 推迟项）。
 */

export type DegradeTo = 'rule' | 'static'

export interface DegradeContext {
  /** 本轮是否已产出草稿（有东西可保） */
  hasDraft: boolean
  /** 触发降级的原因，写进事件/日志 */
  reason: string
  /** 触发源：模型本身不可用（熔断）还是迭代用尽。只为区分措辞 */
  modelUnavailable: boolean
}

export interface DegradeReply {
  to: DegradeTo
  content: string
  reason: string
}

export function degradeReply(ctx: DegradeContext): DegradeReply {
  if (ctx.modelUnavailable) {
    return ctx.hasDraft
      ? {
          to: 'rule',
          content:
            '模型暂时不可用，但本轮已经生成的内容我帮你保留着。稍后可以让我继续调整或保存，不会丢。',
          reason: ctx.reason,
        }
      : {
          to: 'static',
          content: '模型暂时不可用，请稍后重试；也可以把需求说得更具体一些，或告诉我下一步怎么做。',
          reason: ctx.reason,
        }
  }
  return ctx.hasDraft
    ? {
        to: 'rule',
        content:
          '已经尝试了多轮仍未完成，不过本轮生成的内容我帮你保留着。可以把需求拆得更具体一些，我接着做。',
        reason: ctx.reason,
      }
    : {
        to: 'static',
        content: '已经尝试了多轮仍未完成，请把需求说得更具体一些，或告诉我下一步怎么做。',
        reason: ctx.reason,
      }
}
