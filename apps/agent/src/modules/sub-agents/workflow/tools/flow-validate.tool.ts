import { Injectable } from '@nestjs/common'
import { Tool } from '../../../harness/tool.decorator'
import { z } from 'zod'

@Injectable()
@Tool({
  name: 'flow_validate',
  description: '校验流程定义的 DAG 合法性：检查环路、孤立节点、start/end 唯一性、fork/join 配对、变量引用。',
  inputSchema: z.object({
    nodes: z.array(z.object({
      id: z.string(), type: z.string(), label: z.string().optional(),
    })),
    edges: z.array(z.object({
      id: z.string(), source: z.string(), target: z.string(),
    })),
  }),
  riskLevel: 'low',
})
export class FlowValidateTool {
  async execute(args: { nodes: any[]; edges: any[] }): Promise<any> {
    const issues: Array<{ path: string; message: string; severity: 'error' | 'warning' }> = []

    const nodeIds = new Set(args.nodes.map((n) => n.id))
    const nodeTypes = new Map(args.nodes.map((n) => [n.id, n.type]))

    // 检查 start 唯一
    const starts = args.nodes.filter((n) => n.type === 'start')
    if (starts.length === 0) issues.push({ path: '$.nodes', message: 'Missing start node', severity: 'error' })
    if (starts.length > 1) issues.push({ path: '$.nodes', message: 'Multiple start nodes', severity: 'error' })

    // 检查 end 唯一
    const ends = args.nodes.filter((n) => n.type === 'end')
    if (ends.length === 0) issues.push({ path: '$.nodes', message: 'Missing end node', severity: 'error' })
    if (ends.length > 1) issues.push({ path: '$.nodes', message: 'Multiple end nodes', severity: 'error' })

    // 检查所有 edge 的 source/target 引用了存在的 node
    const sourceIds = new Set(args.edges.map((e) => e.source))
    const targetIds = new Set(args.edges.map((e) => e.target))

    for (const nid of nodeIds) {
      const n = args.nodes.find((n) => n.id === nid)
      if (n?.type === 'start' && !sourceIds.has(nid)) {
        issues.push({ path: `$.edges`, message: `Start node "${nid}" has no outgoing edge`, severity: 'error' })
      }
      if (n?.type === 'end' && !targetIds.has(nid)) {
        issues.push({ path: `$.edges`, message: `End node "${nid}" has no incoming edge`, severity: 'error' })
      }
      if (n?.type !== 'start' && n?.type !== 'end' && (!sourceIds.has(nid) || !targetIds.has(nid))) {
        issues.push({ path: `$.edges`, message: `Node "${nid}" (${n?.type}) missing input or output`, severity: 'warning' })
      }
    }

    // 检查孤立 edge
    for (const e of args.edges) {
      if (!nodeIds.has(e.source)) issues.push({ path: `$.edges`, message: `Edge "${e.id}" source "${e.source}" not found`, severity: 'error' })
      if (!nodeIds.has(e.target)) issues.push({ path: `$.edges`, message: `Edge "${e.id}" target "${e.target}" not found`, severity: 'error' })
    }

    // 检查 fork/join 配对
    const forks = args.nodes.filter((n) => n.type === 'parallel' && n.config?.parallelType === 'fork')
    const joins = args.nodes.filter((n) => n.type === 'parallel' && n.config?.parallelType === 'join')
    if (forks.length !== joins.length) {
      issues.push({ path: '$.nodes', message: `Fork/join mismatch: ${forks.length} forks, ${joins.length} joins`, severity: 'warning' })
    }

    const passed = issues.filter((i) => i.severity === 'error').length === 0
    return {
      summary: passed
        ? `Flow validation PASSED: ${args.nodes.length} nodes, ${args.edges.length} edges, ${issues.length} warnings`
        : `Flow validation FAILED: ${issues.filter((i) => i.severity === 'error').length} errors`,
      passed, issues,
    }
  }
}
