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
    '把一张表单关联到流程（设计意向；需再调用 flow_publish 发布后才真正绑定生效）。用户要求「流程关联/绑定某张表单」时用。',
  inputSchema: z.object({
    flowId: z.string().optional().describe('流程 id（编排层会自动注入，一般不用手填）'),
    formId: z.string().optional().describe('要关联的表单 id（编排层会按会话中的表自动注入，一般不用手填）'),
    formName: z.string().optional().describe('表单名称。已有表单只需填名称，工具会按名称在当前工作空间里解析真实 id')
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
    // 表单必须来自服务端真实数据：模型给的 formId 可能不存在（实测编造过
    // `teacher_info_register`），绝不能用它直接写 start.config。
    const resolved = await this.resolveForm(token, args.workspaceId || '', args.formId, args.formName)
    if (resolved.failure) return resolved.failure
    const formId = resolved.formId!
    const formName = resolved.formName

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
      return { ok: false, summary: '该流程缺少入口节点，无法关联表单。', error: 'no_start_node' }
    }

    // 合并进 start.config（保留 variables 等既有字段）
    const start = nodes[startIndex]
    const mergedStart = {
      ...start,
      config: { ...(start.config || {}), formId, ...(formName ? { formName } : {}) },
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
      summary: `已把表单「${formName || formId}」关联到流程；发布后才会真正绑定到该表单`,
      flowId,
      formId,
    }
  }

  /**
   * 解析出**真实存在**的表单。
   *
   * 顺序：能拿到 formId 先向 server 校验（模型可能编造 id）；不存在且有名称时，
   * 再按名称在当前工作空间里查一次。只在找到唯一匹配时返回，绝不猜。
   */
  private async resolveForm(
    token: string,
    workspaceId: string,
    formIdRaw?: string,
    formNameRaw?: string,
  ): Promise<{ formId?: string; formName?: string; failure?: any }> {
    const formId = (formIdRaw || '').trim()
    const formName = (formNameRaw || '').trim()

    if (formId) {
      try {
        const form = await this.contextService.getForm(token, formId)
        if (form?.workspaceId && workspaceId && form.workspaceId !== workspaceId) {
          return {
            failure: { ok: false, error: 'form_workspace_mismatch', summary: '该表单不属于当前工作空间，无法关联。' },
          }
        }
        return { formId: form?.id || formId, formName: form?.name || formName }
      } catch (e: any) {
        // 模型编造/过期的 id：有名称就继续按名称解析，否则如实报错
        if (e?.status === 404 && !formName) {
          return {
            failure: {
              ok: false,
              error: 'form_not_found',
              summary: `当前空间里没有 id 为「${formId}」的表单，请先创建或确认表单名称。`,
            },
          }
        }
        if (e?.status !== 404) {
          return {
            failure: { ok: false, error: 'form_lookup_failed', summary: `读取表单失败：${e?.message || '未知错误'}` },
          }
        }
      }
    }

    if (!formName) {
      return {
        failure: { ok: false, error: 'no_form_id', summary: '没有确定要关联的表单。请先说明要关联哪张已保存的表。' },
      }
    }
    if (!workspaceId) {
      return {
        failure: { ok: false, error: 'no_workspace', summary: '无法确定当前工作空间，暂时不能按名称查找表单。' },
      }
    }

    let list: any[] = []
    try {
      const res = await this.contextService.listForms(token, workspaceId, { pageSize: 200, keyword: formName })
      list = Array.isArray(res) ? res : Array.isArray(res?.list) ? res.list : []
    } catch (e: any) {
      return {
        failure: { ok: false, error: 'form_lookup_failed', summary: `查找表单失败：${e?.message || '未知错误'}` },
      }
    }

    const normalized = this.normalizeName(formName)
    const matches = list.filter(
      (f) => f && !f.deletedAt && this.normalizeName(f.name) === normalized,
    )
    if (matches.length === 0) {
      return {
        failure: {
          ok: false,
          error: 'form_not_found',
          summary: `当前空间里没有名为「${formName}」的表单，请先创建它或核对名称。`,
        },
      }
    }
    if (matches.length > 1) {
      const options = matches.map((f) => `${f.name}（${f.id}）`).join('、')
      return {
        failure: {
          ok: false,
          error: 'form_ambiguous',
          summary: `当前空间里有多张名为「${formName}」的表单：${options}。请指明要绑定哪一张。`,
        },
      }
    }
    return { formId: matches[0].id, formName: matches[0].name || formName }
  }

  /** 名称比对前去掉空白与常见书名号/引号 */
  private normalizeName(name: string): string {
    return (name || '').replace(/[\s「」『』"'“”]/g, '')
  }
}
