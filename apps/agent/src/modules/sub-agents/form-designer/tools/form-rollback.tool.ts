import { Injectable } from '@nestjs/common'
import { Tool } from '../../../harness/tool.decorator'
import { z } from 'zod'
import { ContextService } from '../../../context/context.service'

/**
 * 表单回滚（阶段 5 / 5.5）：把已保存的表单恢复到某个历史版本。
 *
 * 服务端每次 PATCH schema 都会追加一个 FormVersion 快照（`form.service.ts:99`），
 * 所以「回滚」= 读历史版本、把它的 schema 再 PATCH 回去（**追加一个新版本**，非破坏性，
 * 当前 Schema 仍能在版本历史里找回）。平台后台的版本历史/恢复 UI 已存在，这里补的是
 * **让 agent 也能回滚**的入口。
 */
@Injectable()
@Tool({
  name: 'form_rollback',
  description:
    '把已保存的表单回滚到上一个（或指定）版本。用户要求「撤销上次改动 / 回滚 / 恢复到上一版」时用。只能对已经保存过、且至少有两次保存记录的表单使用。',
  inputSchema: z.object({
    target: z
      .string()
      .optional()
      .describe('要回滚的表：填【会话中的表单】里那张表的 key、标题或 formId'),
    formId: z.string().optional().describe('已保存表单的 id（编排层会按 target 自动注入，一般不用手填）'),
    version: z.number().optional().describe('要回滚到的版本号。不填 = 上一个版本'),
  }),
  // 写库操作（追加新版本）：风险 ≥ medium（阶段 6 / S3.3）；rollback-approval 检查点 coversRisk。
  riskLevel: 'medium',
})
export class FormRollbackTool {
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
      return { summary: '回滚失败：未获取到登录凭证，请重新登录后重试', ok: false, error: 'no_token_in_session' }
    }
    const formId = args.formId
    if (!formId) {
      return {
        summary: '这张表还没有保存过，没有可回滚的版本。请先保存一次。',
        ok: false,
        error: 'not_saved',
      }
    }

    const versions = await this.contextService.getFormVersions(token, formId)
    // 按 version 倒序：[0] 是当前版本
    if (versions.length === 0) {
      return { summary: '没有找到版本记录，无法回滚。', ok: false, error: 'no_versions' }
    }

    let chosen: any
    if (typeof args.version === 'number') {
      chosen = versions.find((v) => v?.version === args.version)
      if (!chosen) {
        const list = versions.map((v) => `v${v?.version}`).join('、')
        return {
          summary: `没有 v${args.version} 这个版本。现有版本：${list}`,
          ok: false,
          error: 'version_not_found',
        }
      }
    } else {
      if (versions.length < 2) {
        return {
          summary: '只有一个版本记录，没有上一版可回滚。',
          ok: false,
          error: 'no_previous_version',
        }
      }
      chosen = versions[1]
    }

    const schema = chosen?.schema
    if (!schema || typeof schema !== 'object') {
      return { summary: `v${chosen?.version} 版本没有可用的表单结构。`, ok: false, error: 'empty_schema' }
    }

    const result = await this.contextService.saveFormDraft(token, { formId, schema }, args.workspaceId)

    return {
      summary: `已将表单回滚到 v${chosen.version}`,
      formId: result?.id || formId,
      version: chosen.version,
      schema,
    }
  }
}
