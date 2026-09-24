import { Injectable } from '@nestjs/common'
import { Tool } from '../../../harness/tool.decorator'
import { z } from 'zod'
import { ContextService } from '../../../context/context.service'

@Injectable()
@Tool({
  name: 'data_list_forms',
  description: '列出当前工作空间所有可用表单，含名称、状态、提交数量。当用户没有指定要分析哪个表单时，先调此工具。',
  inputSchema: z.object({
    token: z.string().optional(),
    workspaceId: z.string().optional(),
  }),
  riskLevel: 'low',
})
export class DataListFormsTool {
  constructor(private contextService: ContextService) {}

  async execute(args: { token?: string; workspaceId?: string }): Promise<any> {
    const token = args.token || ''
    const wsId = args.workspaceId || ''
    if (!wsId) return { summary: '请先进入工作空间', forms: [] }

    try {
      const result = await this.contextService.listForms(token, wsId)
      const list = result?.list || result || []
      const forms = (Array.isArray(list) ? list : []).map((f: any) => ({
        id: f.id,
        name: f.name,
        status: f.status,
      }))
      return { summary: `共有 ${forms.length} 个表单`, forms }
    } catch {
      return { summary: '获取表单列表失败，请检查后端服务', forms: [] }
    }
  }
}
