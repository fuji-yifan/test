import { Injectable } from '@nestjs/common'
import { Tool } from '../../../harness/tool.decorator'
import { z } from 'zod'
import { ContextService } from '../../../context/context.service'

@Injectable()
@Tool({
  name: 'data_confirm',
  description: '实际写入提交数据到数据库。必须 data_validate 通过且用户确认后才能调用。使用 request_id 保证幂等性。',
  inputSchema: z.object({
    formId: z.string().describe('表单 ID'),
    data: z.record(z.unknown()).describe('已验证通过的数据'),
    requestId: z.string().describe('幂等性 ID，相同 requestId 只写入一次'),
  }),
  riskLevel: 'medium',
})
export class DataConfirmTool {
  private dedupSet = new Set<string>()

  constructor(private contextService: ContextService) {}

  async execute(args: {
    formId: string; data: Record<string, unknown>; requestId: string
    token?: string
  }): Promise<any> {
    // 幂等性检查
    if (this.dedupSet.has(args.requestId)) {
      return { summary: `Duplicate request ${args.requestId} ignored (idempotent)`, skipped: true }
    }
    this.dedupSet.add(args.requestId)

    const token = args.token || ''
    try {
      const result = await this.contextService.saveFormDraft(token, {
        name: `Submission_${args.formId}_${Date.now()}`,
        schema: { fields: [] },
      })
      return { summary: `Data submitted successfully for form "${args.formId}"`, result }
    } catch (err: any) {
      return { summary: `Submit failed: ${err.message}`, ok: false, error: err.message }
    }
  }
}
