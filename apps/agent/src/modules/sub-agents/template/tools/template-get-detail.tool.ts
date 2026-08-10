import { Injectable } from '@nestjs/common'
import { Tool } from '../../../harness/tool.decorator'
import { z } from 'zod'
import { ContextService } from '../../../context/context.service'

@Injectable()
@Tool({
  name: 'template_get_detail',
  description: '获取指定模板的完整定义，包括表单 Schema 和流程定义。',
  inputSchema: z.object({
    templateId: z.string().describe('模板 ID'),
    token: z.string().optional(),
  }),
  riskLevel: 'low',
})
export class TemplateGetDetailTool {
  constructor(private contextService: ContextService) {}

  async execute(args: { templateId: string; token?: string }): Promise<any> {
    const token = args.token || ''
    try {
      const template = await this.contextService.getTemplates(token, { keyword: args.templateId })
      return {
        summary: `Template "${args.templateId}" detail fetched`,
        template: template?.list?.[0] || template,
      }
    } catch (err: any) {
      return {
        summary: `模板详情获取失败：${err.message}`,
        template: null,
      }
    }
  }
}
