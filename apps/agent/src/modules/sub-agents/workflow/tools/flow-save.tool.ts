import { Injectable } from '@nestjs/common'
import { Tool } from '../../../harness/tool.decorator'
import { z } from 'zod'
import { ContextService } from '../../../context/context.service'

@Injectable()
@Tool({
  name: 'flow_save',
  description: '把流程定义保存为草稿到平台。草稿不会触发流程，需再调用 flow_publish 发布后才真正生效。',
  inputSchema: z.object({
    name: z.string().describe('流程名称'),
    description: z.string().optional().describe('流程描述'),
    nodes: z.array(z.record(z.unknown())),
    edges: z.array(z.record(z.unknown())),
  }),
  // 写库操作：风险 ≥ medium（阶段 6 / S3.3）；save-approval 检查点 coversRisk。
  riskLevel: 'medium',
})
export class FlowSaveTool {
  constructor(private contextService: ContextService) {}

  async execute(args: {
    name: string; description?: string
    nodes: any[]; edges: any[]
    token?: string; workspaceId?: string
  }): Promise<any> {
    const token = args.token || ''
    if (!token) {
      return { summary: '保存失败：未获取到登录凭证，请重新登录后重试', ok: false, error: 'no_token_in_session' }
    }
    const wsId = args.workspaceId || 'default'

    const result = await this.contextService.saveProcessDraft(token, {
      name: args.name,
      description: args.description || '',
      nodes: args.nodes,
      edges: args.edges,
      workspaceId: wsId,
    })

    // 服务端没返回 id → 实际没落库，绝不能回「保存成功」这种假成功
    const id = result?.id
    if (!id) {
      return { ok: false, summary: '保存失败：服务端未返回流程 id', error: 'save_failed' }
    }

    return {
      summary: `流程「${args.name}」已保存为草稿；发布后才会真正生效`,
      id,
      status: result.status,
      result,
    }
  }
}
