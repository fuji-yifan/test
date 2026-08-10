import { Injectable } from '@nestjs/common'
import { Tool } from '../../../harness/tool.decorator'
import { z } from 'zod'
import { ContextService } from '../../../context/context.service'

// MVP 阶段：使用结构化标签 + 关键词模糊匹配（无需向量数据库）
@Injectable()
@Tool({
  name: 'template_search',
  description: '从模板市场检索匹配的模板。支持按分类筛选和关键词搜索。',
  inputSchema: z.object({
    query: z.string().describe('搜索关键词'),
    category: z.string().optional().describe('分类筛选：HR/财务/客服/供应链/运营/通用'),
    token: z.string().optional(),
  }),
  riskLevel: 'low',
})
export class TemplateSearchTool {
  constructor(private contextService: ContextService) {}

  async execute(args: {
    query: string; category?: string; token?: string
  }): Promise<any> {
    const token = args.token || ''
    try {
      const result = await this.contextService.getTemplates(token, {
        category: args.category,
        keyword: args.query,
      })
      const list = result?.list || result || []
      const templates = Array.isArray(list) ? list : []
      return {
        summary: `Found ${templates.length} templates for "${args.query}"${args.category ? ` in ${args.category}` : ''}`,
        templates: templates.slice(0, 10).map((t: any) => ({
          id: t.id,
          name: t.name,
          description: t.description,
          category: t.category,
          tags: t.tags,
          usageCount: t.usageCount,
        })),
      }
    } catch (err: any) {
      const msg = err.message || ''
      const hint = msg.includes('ECONNREFUSED') || msg.includes('fetch failed')
        ? '后端服务未启动或不可达，请检查 server 是否在 localhost:3000 运行'
        : msg.includes('401') || msg.includes('403')
          ? '认证失败，请重新登录'
          : msg
      return {
        summary: `模板搜索失败：${hint}`,
        templates: [],
      }
    }
  }
}
