import { Injectable } from '@nestjs/common'
import { Tool } from '../../../harness/tool.decorator'
import { z } from 'zod'
import { ContextService } from '../../../context/context.service'

@Injectable()
@Tool({
  name: 'flow_save',
  description: '保存流程定义到平台。',
  inputSchema: z.object({
    name: z.string().describe('流程名称'),
    description: z.string().optional().describe('流程描述'),
    nodes: z.array(z.record(z.unknown())),
    edges: z.array(z.record(z.unknown())),
  }),
  riskLevel: 'low',
})
export class FlowPublishTool {
  constructor(private contextService: ContextService) {}

  async execute(args: {
    name: string; description?: string
    nodes: any[]; edges: any[]
    token?: string; workspaceId?: string
  }): Promise<any> {
    const token = args.token || ''
    const wsId = args.workspaceId || 'default'

    const result = await this.contextService.saveProcessDraft(token, {
      name: args.name,
      description: args.description || '',
      nodes: args.nodes,
      edges: args.edges,
      workspaceId: wsId,
    })

    return {
      summary: `Flow "${args.name}" published successfully`,
      processId: result?.id,
      result,
    }
  }
}
