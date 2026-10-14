import { Injectable } from '@nestjs/common'
import { Tool } from '../../../harness/tool.decorator'
import { z } from 'zod'
import { ContextService } from '../../../context/context.service'

/**
 * 表单历史版本软删除（阶段 6 / S4.2）：把某个版本快照移入回收站。
 *
 * server 侧 `DELETE /forms/:id/versions/:version` 写 `deletedAt`（软删，非物理删除），
 * 可在回收站恢复；仍不允许删除当前已发布版本。riskLevel `high` → `version-delete-approval`
 * 检查点（coversRisk）执行前必须人工确认。
 */
@Injectable()
@Tool({
  name: 'form_version_delete',
  description:
    '删除某张表单的指定历史版本快照（移入回收站，可恢复）。用户要求「删除某个版本 / 清掉历史版本 vN」时用。这是破坏性操作，执行前必须向用户说明影响并取得确认。',
  inputSchema: z.object({
    target: z
      .string()
      .optional()
      .describe('目标表：填【会话中的表单】里那张表的 key、标题或 formId'),
    formId: z.string().optional().describe('目标表单的 id（编排层会按 target 自动注入，一般不用手填）'),
    version: z.number().describe('要删除的版本号'),
  }),
  riskLevel: 'high',
})
export class FormVersionDeleteTool {
  constructor(private contextService: ContextService) {}

  async execute(args: {
    target?: string
    formId?: string
    version?: number
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
        summary: '没有确定要操作的表（或这张表还没保存过）。请先说明是哪张已保存的表。',
        ok: false,
        error: 'no_form_id',
      }
    }
    if (typeof args.version !== 'number') {
      return { summary: '请指定要删除的版本号。', ok: false, error: 'no_version' }
    }

    await this.contextService.deleteFormVersion(token, formId, args.version)
    return {
      summary: `已删除表单版本 v${args.version}（已移入回收站，可由管理员恢复）`,
      formId,
      version: args.version,
    }
  }
}
