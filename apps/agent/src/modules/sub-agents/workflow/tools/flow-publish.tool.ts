import { Injectable } from '@nestjs/common'
import { Tool } from '../../../harness/tool.decorator'
import { z } from 'zod'
import { ContextService } from '../../../context/context.service'

/**
 * 发布流程（高风险）：只有发布后，开始节点关联的表单才真正绑定、表单提交才会自动发起本流程。
 *
 * 同名表单的独占冲突由 server 在发布时校验并返回 409，这里把 server 的中文文案原样透传。
 * riskLevel `high` → workflow 的 `publish-approval` 检查点（coversRisk）顶着风险门，执行前必须人工确认。
 */
@Injectable()
@Tool({
  name: 'flow_publish',
  description:
    '发布流程，使其真正生效。发布后，流程关联的表单被提交时会自动发起本流程。这是高风险操作，执行前必须向用户说明影响并取得确认。',
  inputSchema: z.object({
    flowId: z.string().optional().describe('要发布的流程 id（编排层会自动注入，一般不用手填）'),
    name: z.string().optional().describe('流程名称（说明用）'),
  }),
  riskLevel: 'high',
})
export class FlowPublishTool {
  constructor(private contextService: ContextService) {}

  async execute(args: {
    flowId?: string; name?: string
    token?: string; workspaceId?: string
  }): Promise<any> {
    const token = args.token || ''
    if (!token) {
      return { summary: '发布失败：未获取到登录凭证，请重新登录后重试', ok: false, error: 'no_token_in_session' }
    }
    const flowId = args.flowId
    if (!flowId) {
      return { summary: '没有确定要发布的流程。请先保存流程（flow_save）再发布。', ok: false, error: 'no_flow_id' }
    }

    try {
      await this.contextService.publishProcess(token, flowId)
    } catch (e: any) {
      // 409：同一张表单已被其他已发布流程绑定 —— 用 server 的文案（比通用兜底更有指导性）
      if (e?.status === 409) {
        return { ok: false, summary: String(e.message || '发布失败：该表单已被其他流程绑定'), error: 'publish_conflict' }
      }
      // 400：开始节点还没关联表单。这是可补救的前置条件，单独给个 error code，
      // 便于编排层/用户看出「该先 flow_bind_form」而不是把它当成未知失败。
      if (e?.status === 400) {
        return { ok: false, summary: String(e.message || '请先为该流程关联表单后再发布'), error: 'no_form_bound' }
      }
      return { ok: false, summary: `发布失败：${e?.message || '未知错误'}`, error: 'publish_failed' }
    }

    return {
      summary: args.name ? `流程「${args.name}」已发布，关联的表单提交后会自动发起本流程` : '流程已发布，关联的表单提交后会自动发起本流程',
      flowId,
      status: 'published',
    }
  }
}
