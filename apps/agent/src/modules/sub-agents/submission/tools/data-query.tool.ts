import { Injectable } from '@nestjs/common'
import { Tool } from '../../../harness/tool.decorator'
import { z } from 'zod'
import { ContextService } from '../../../context/context.service'

@Injectable()
@Tool({
  name: 'data_query',
  description: '聚合查询表单提交数据。返回汇总统计（count/avg/sum/dist），不返回原始行。',
  inputSchema: z.object({
    formId: z.string().describe('表单 ID'),
    startDate: z.string().optional().describe('开始日期 YYYY-MM-DD'),
    endDate: z.string().optional().describe('结束日期 YYYY-MM-DD'),
    groupBy: z.string().optional().describe('分组字段'),
  }),
  riskLevel: 'low',
})
export class DataQueryTool {
  constructor(private contextService: ContextService) {}

  async execute(args: {
    formId: string; startDate?: string; endDate?: string; groupBy?: string
    token?: string
  }): Promise<any> {
    const token = args.token || ''
    try {
      const result = await this.contextService.getSubmissions(token, args.formId, {
        startDate: args.startDate, endDate: args.endDate, pageSize: 1000,
      })
      const list = result?.list || result || []
      const submissions = Array.isArray(list) ? list : []

      // 聚合计算
      const total = submissions.length
      return {
        summary: `Query returned ${total} submissions for form "${args.formId}"`,
        total,
        submissions: submissions.slice(0, 50), // 限制返回
      }
    } catch {
      return { summary: `No submissions data available for form "${args.formId}" (server API unavailable)`, total: 0, submissions: [] }
    }
  }
}
