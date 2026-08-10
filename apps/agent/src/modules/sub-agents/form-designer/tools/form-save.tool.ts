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
    token?: string
    workspaceId?: string
  }): Promise<any> {
    const token = args.token || ''
    const tokenPreview = token ? `${token.slice(0, 20)}...${token.slice(-10)}` : '(空)'

    if (!token) {
      return { summary: '保存失败：未获取到登录凭证，请重新登录后重试', ok: false, error: 'no_token_in_session' }
    }

    // 确保每个字段都有 id（DeepSeek 可能漏传嵌套 id）
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
      },
      args.workspaceId,
    )

    return {
      summary: `Form "${args.name}" saved successfully`,
      formId: result?.id,
      result,
    }
  }
}
