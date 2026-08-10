import { Injectable } from '@nestjs/common'
import { Tool } from '../../../harness/tool.decorator'
import { z } from 'zod'
import { ContextService } from '../../../context/context.service'

function nanoid(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let r = ''
  for (let i = 0; i < 8; i++) r += chars[Math.floor(Math.random() * chars.length)]
  return r
}

@Injectable()
@Tool({
  name: 'form_save',
  description: '将最终确认的表单 Schema 保存到平台。调用此工具会立即写入数据库。',
  inputSchema: z.object({
    name: z.string().describe('表单名称'),
    description: z.string().optional().describe('表单描述'),
    schema: z.record(z.unknown()).describe('完整的 FormSchema 对象'),
    category: z.string().optional().describe('分类'),
    tags: z.array(z.string()).optional().describe('标签'),
    formId: z.string().optional().describe('如果要更新已有表单，传入上次 form_save 返回的 formId'),
  }),
  riskLevel: 'low',
})
export class FormSaveTool {
  constructor(private contextService: ContextService) {}

  async execute(args: {
    name: string
    description?: string
    schema: Record<string, unknown>
    category?: string
    tags?: string[]
    formId?: string
    token?: string
    workspaceId?: string
  }): Promise<any> {
    const token = args.token || ''

    if (!token) {
      return { summary: '保存失败：未获取到登录凭证，请重新登录后重试', ok: false, error: 'no_token_in_session' }
    }

    // 确保每个字段都有 id
    if (args.schema && Array.isArray(args.schema.fields)) {
      for (const f of args.schema.fields as any[]) {
        if (!f.id) f.id = `field_${nanoid()}`
      }
    }

    const result = await this.contextService.saveFormDraft(
      token,
      {
        name: args.name,
        description: args.description || '',
        schema: args.schema,
        category: args.category,
        tags: args.tags,
        formId: args.formId,
      },
      args.workspaceId,
    )

    return {
      summary: args.formId ? `Form "${args.name}" updated` : `Form "${args.name}" saved`,
      formId: result?.id || args.formId,
      result,
    }
  }
}
