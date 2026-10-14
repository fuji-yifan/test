import { Injectable } from '@nestjs/common'
import { Tool } from '../../../harness/tool.decorator'
import { z } from 'zod'
import { ContextService } from '../../../context/context.service'

/**
 * 表单软删除（阶段 6 / S4.2）：把表单移入回收站。
 *
 * server 侧 `DELETE /forms/:id` 写 `deletedAt`（软删，非物理删除），管理员可在回收站恢复，
 * 所以这里只做「移入回收站」，不做不可逆销毁。riskLevel `high` → form-designer 的
 * `delete-approval` 检查点（coversRisk）顶着风险门，执行前必须人工确认。
 *
 * 防误删：formId 由编排层按本次目标解析后注入（tool-bridge.injectContext），
 * 拿不到明确 formId 时工具直接报错，绝不靠模型猜 id。
 */
@Injectable()
@Tool({
  name: 'form_delete',
  description:
    '删除一张表单（移入回收站，可由管理员恢复）。用户明确要求「删除 / 删掉 / 移除」某张已保存的表时用。这是破坏性操作，执行前必须向用户说明影响并取得确认。',
  inputSchema: z.object({
    target: z
      .string()
      .optional()
      .describe('要删除的表：填【会话中的表单】里那张表的 key、标题或 formId'),
    formId: z.string().optional().describe('要删除表单的 id（编排层会按 target 自动注入，一般不用手填）'),
    reason: z.string().optional().describe('删除原因（会记入审计）'),
  }),
  riskLevel: 'high',
})
export class FormDeleteTool {
  constructor(private contextService: ContextService) {}

  async execute(args: {
    target?: string
    formId?: string
    reason?: string
    token?: string
    workspaceId?: string
  }): Promise<any> {
    const token = args.token || ''
    if (!token) {
      return { summary: '删除失败：未获取到登录凭证，请重新登录后重试', ok: false, error: 'no_token_in_session' }
    }
    const formId = args.formId
    if (!formId) {
      return {
        summary: '没有确定要删除的表（或这张表还没保存过）。请先说明要删除哪张已保存的表。',
        ok: false,
        error: 'no_form_id',
      }
    }

    await this.contextService.deleteForm(token, formId)
    return {
      summary: `已删除表单${args.target ? `「${args.target}」` : ''}（已移入回收站，可由管理员恢复）`,
      formId,
    }
  }
}
