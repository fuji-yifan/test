import { Injectable } from '@nestjs/common'
import { Tool } from '../../../harness/tool.decorator'
import { z } from 'zod'

@Injectable()
@Tool({
  name: 'data_rollback',
  description: '回滚最近一次提交。仅支持在提交后 5 分钟内回滚。',
  inputSchema: z.object({
    formId: z.string().describe('表单 ID'),
    requestId: z.string().describe('要回滚的提交 requestId'),
  }),
  riskLevel: 'high',
})
export class DataRollbackTool {
  async execute(args: { formId: string; requestId: string }): Promise<any> {
    // 生产环境走 server API 回滚，这里返回摘要
    return {
      summary: `Rollback requested for form "${args.formId}", request "${args.requestId}". Rollback requires operator confirmation on server.`,
    }
  }
}
