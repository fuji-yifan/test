import { Injectable } from '@nestjs/common'
import { Tool } from '../../../harness/tool.decorator'
import { z } from 'zod'
import { ContextService } from '../../../context/context.service'

/**
 * 把表单关联到流程的**开始节点**上（写库）。
 *
 * 注意语义：这只是「设计意向」，同名表单要等流程 `flow_publish` 发布后才真正绑定、才触发流程。
 * 因此摘要里明确写「发布后才会真正绑定」，绝不提前报喜成「已绑定」。
 *
 * 实现：GET 流程定义 → 找 start 节点 → 把 `config.formId / formName` 合并进去（**保留**原有
 * `variables` 等）→ PATCH。拿不到明确 id 一律 `ok:false`，绝不靠模型猜。
 */
@Injectable()
@Tool({
  name: 'flow_bind_form',
  description:
    '把一张表单关联到流程的开始节点（设计意向；需再调用 flow_publish 发布后才真正绑定生效）。用户要求「流程关联/绑定某张表单」时用。',
  inputSchema: z.object({
    flowId: z.string().optional().describe('流程 id（编排层会自动注入，一般不用手填）'),
    formId: z.string().optional().describe('要关联的表单 id（编排层会按会话中的表自动注入，一般不用手填）'),
    formName: z.string().optional().describe('表单名称（说明用）'),
  }),
  riskLevel: 'medium',
})
export class FlowBindFormTool {
  constructor(private contextService: ContextService) {}

  async execute(args: {
    flowId?: string; formId?: string; formName?: string
    token?: string; workspaceId?: string
  }): Promise<any> {
    const token = args.token || ''
    if (!token) {
      return { summary: '关联失败：未获取到登录凭证，请重新登录后重试', ok: false, error: 'no_token_in_session' }
    }
    const flowId = args.flowId
    if (!flowId) {
      return { summary: '没有确定要关联的流程。请先保存流程（flow_save）再关联表单。', ok: false, error: 'no_flow_id' }
    }
    const formId = args.formId
    if (!formId) {
      return { summary: '没有确定要关联的表单。请先说明要关联哪张已保存的表。', ok: false, error: 'no_form_id' }
    }

    // 取当前流程定义（nodes/edges 已是规范化坐标，合并后原样回写，不重算布局）
    let definition: any
    try {
      definition = await this.contextService.getProcessDefinition(token, flowId)
    } catch (e: any) {
      if (e?.status === 404) {
        return { summary: '要关联的流程不存在，请先保存流程（flow_save）。', ok: false, error: 'flow_not_found' }
      }
      return { ok: false, summary: `关联失败：${e?.message || '读取流程失败'}`, error: 'bind_failed' }
    }

    const nodes: any[] = Array.isArray(definition?.nodes) ? definition.nodes : []
    const startIndex = nodes.findIndex((n) => n?.type === 'start')
    if (startIndex < 0) {
      return { ok: false, summary: '该流程没有开始节点，无法关联表单。', error: 'no_start_node' }
    }

    // 合并进 start.config（保留 variables 等既有字段）
    const start = nodes[startIndex]
    const mergedStart = {
      ...start,
      config: { ...(start.config || {}), formId, ...(args.formName ? { formName: args.formName } : {}) },
    }
    const nextNodes = nodes.map((n, i) => (i === startIndex ? mergedStart : n))

    try {
      await this.contextService.updateProcessDraft(token, { id: flowId, nodes: nextNodes })
    } catch (e: any) {
      if (e?.status === 409) {
        return { ok: false, summary: String(e.message || '关联失败：该表单已被其他流程绑定'), error: 'bind_conflict' }
      }
      return { ok: false, summary: `关联失败：${e?.message || '写入流程失败'}`, error: 'bind_failed' }
    }

    return {
      summary: `已把表单关联到流程的开始节点；发布后才会真正绑定到该表单`,
      flowId,
      formId,
    }
  }
}
