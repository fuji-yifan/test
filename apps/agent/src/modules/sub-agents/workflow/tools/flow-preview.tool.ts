import { Injectable } from '@nestjs/common'
import { Tool } from '../../../harness/tool.decorator'
import { z } from 'zod'

@Injectable()
@Tool({
  name: 'flow_preview',
  description: '生成流程的预览摘要，展示节点列表、流转路径和关键信息。',
  inputSchema: z.object({
    nodes: z.array(z.record(z.unknown())),
    edges: z.array(z.record(z.unknown())),
    name: z.string().optional().default('未命名流程'),
  }),
  riskLevel: 'low',
})
export class FlowPreviewTool {
  async execute(args: { nodes: any[]; edges: any[]; name?: string }): Promise<any> {
    const nodeList = args.nodes.map((n: any) => {
      const badge = n.type === 'start' ? '[开始]' : n.type === 'end' ? '[结束]'
        : n.type === 'approval' ? '[审批]' : n.type === 'condition' ? '[条件]'
        : n.type === 'notify' ? '[通知]' : n.type === 'parallel' ? '[并行]' : ''
      return `  ${badge} ${n.id}: ${n.label || n.type}`
    }).join('\n')

    const edgeList = args.edges.map((e: any) => {
      const cond = e.condition ? ` [${e.condition}]` : ''
      return `  ${e.source} → ${e.target}${cond}`
    }).join('\n')

    const summary = `## 流程预览: ${args.name}

### 节点 (${args.nodes.length})
${nodeList}

### 流转路径
${edgeList}`

    return { summary, nodeCount: args.nodes.length, edgeCount: args.edges.length }
  }
}
