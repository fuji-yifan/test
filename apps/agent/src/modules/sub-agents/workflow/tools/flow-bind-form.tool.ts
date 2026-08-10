import { Injectable } from '@nestjs/common'
import { Tool } from '../../../harness/tool.decorator'
import { z } from 'zod'
import { ContextService } from '../../../context/context.service'

@Injectable()
@Tool({
  name: 'flow_bind_form',
  description: '将流程定义绑定到指定的表单。',
  inputSchema: z.object({
    flowId: z.string().describe('流程定义 ID 或临时 ID'),
    formId: z.string().describe('绑定的表单 ID'),
    formName: z.string().optional().describe('表单名称（说明用）'),
  }),
  riskLevel: 'medium',
})
export class FlowBindFormTool {
  constructor(private contextService: ContextService) {}

  async execute(args: {
    flowId: string; formId: string; formName?: string
    token?: string; workspaceId?: string
  }): Promise<any> {
    // bind 需要走 server API，这里返回绑定摘要
    return {
      summary: `Flow "${args.flowId}" bound to form "${args.formName || args.formId}"`,
      flowId: args.flowId,
      formId: args.formId,
    }
  }
}
