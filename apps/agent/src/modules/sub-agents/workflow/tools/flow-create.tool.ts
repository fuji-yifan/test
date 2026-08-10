import { Injectable } from '@nestjs/common'
import { Tool } from '../../../harness/tool.decorator'
import { z } from 'zod'

@Injectable()
@Tool({
  name: 'flow_create',
  description: '创建流程定义（nodes + edges）。nodes 是节点数组，每条有 id/type/label/config；edges 是连线数组，每条有 id/source/target/condition。',
  inputSchema: z.object({
    name: z.string().describe('流程名称'),
    description: z.string().optional().describe('流程描述'),
    nodes: z.array(z.object({
      id: z.string(),
      type: z.enum(['start','end','approval','condition','parallel','notify','service']),
      label: z.string(),
      config: z.record(z.unknown()).optional().default({}),
    })),
    edges: z.array(z.object({
      id: z.string(),
      source: z.string(),
      target: z.string(),
      label: z.string().optional(),
      condition: z.string().optional(),
    })),
  }),
  riskLevel: 'low',
})
export class FlowCreateTool {
  async execute(args: {
    name: string
    description?: string
    nodes: any[]
    edges: any[]
  }): Promise<any> {
    return {
      summary: `Flow "${args.name}" created: ${args.nodes.length} nodes, ${args.edges.length} edges`,
      nodes: args.nodes,
      edges: args.edges,
      name: args.name,
    }
  }
}
