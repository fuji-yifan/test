import { Injectable, Logger } from '@nestjs/common'

@Injectable()
export class ContextService {
  private readonly logger = new Logger(ContextService.name)
  private readonly serverBaseURL: string

  constructor() {
    this.serverBaseURL = process.env.SERVER_API_BASE_URL || 'http://localhost:3000'
  }

  /** 创建带用户 token 的请求头 */
  private headers(token: string): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    }
  }

  /** 发起服务端 API 调用，30s 超时 */
  private async fetch<T>(path: string, token: string, opts?: RequestInit): Promise<T> {
    this.logger.log(`[API] ${opts?.method || 'GET'} ${path}`)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30000)

    try {
      const res = await fetch(`${this.serverBaseURL}${path}`, {
        ...opts,
        headers: { ...this.headers(token), ...(opts?.headers as any || {}) },
        signal: controller.signal,
      })

      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new Error(`Server API ${path} returned ${res.status}: ${body}`)
      }

      const json = await res.json()
      return json.data ?? json
    } catch (err: any) {
      // 网络层错误（server 未启动等）转换为友好消息
      if (err.name === 'TypeError' || err.message?.includes('fetch failed') || err.cause?.code === 'ECONNREFUSED') {
        throw new Error(`后端服务未启动或不可达（${this.serverBaseURL}）`)
      }
      throw err
    } finally {
      clearTimeout(timeout)
    }
  }

  // ---- 便捷方法 ----

  async getForm(token: string, formId: string): Promise<any> {
    return this.fetch(`/api/v1/forms/${formId}`, token)
  }

  async getFormSchema(token: string, formId: string): Promise<any> {
    const form = await this.getForm(token, formId)
    return form.schema || form
  }

  async getSubmissions(token: string, formId: string, params?: {
    page?: number; pageSize?: number; startDate?: string; endDate?: string
  }): Promise<any> {
    const sp = new URLSearchParams()
    if (params?.page) sp.set('page', String(params.page))
    if (params?.pageSize) sp.set('pageSize', String(params.pageSize))
    if (params?.startDate) sp.set('startDate', params.startDate)
    if (params?.endDate) sp.set('endDate', params.endDate)
    const qs = sp.toString()
    return this.fetch(`/api/v1/submissions?formId=${formId}${qs ? '&' + qs : ''}`, token)
  }

  async getTask(token: string, taskId: string): Promise<any> {
    return this.fetch(`/api/v1/workflow/tasks/${taskId}`, token)
  }

  async getTaskApprovalHistory(token: string, taskId: string): Promise<any> {
    return this.fetch(`/api/v1/workflow/tasks/${taskId}/history`, token)
  }

  async getProcessDefinition(token: string, processId: string): Promise<any> {
    return this.fetch(`/api/v1/workflow/process-definitions/${processId}`, token)
  }

  async getTemplates(token: string, query?: { category?: string; keyword?: string }): Promise<any> {
    const sp = new URLSearchParams()
    if (query?.category) sp.set('category', query.category)
    if (query?.keyword) sp.set('keyword', query.keyword)
    const qs = sp.toString()
    return this.fetch(`/api/v1/templates${qs ? '?' + qs : ''}`, token)
  }

  async saveFormDraft(token: string, data: Record<string, unknown>, workspaceId?: string): Promise<any> {
    if (!workspaceId) {
      return { error: '保存失败：缺少工作空间 ID' }
    }
    const wsId = workspaceId
    const existingFormId = data.formId as string | undefined

    // 更新已有表单
    if (existingFormId) {
      const updateData: Record<string, unknown> = {}
      if (data.schema) updateData.schema = data.schema
      if (data.category) updateData.category = data.category
      if (data.tags) updateData.tags = data.tags
      await this.fetch(`/api/v1/forms/${existingFormId}`, token, {
        method: 'PATCH',
        body: JSON.stringify(updateData),
      })
      return { ...updateData, id: existingFormId }
    }

    // 创建新表单
    const created: any = await this.fetch(`/api/v1/workspaces/${wsId}/forms`, token, {
      method: 'POST',
      body: JSON.stringify({ name: data.name, description: data.description }),
    })
    const formId = created?.id
    if (!formId) return created

    const updateData: Record<string, unknown> = {}
    if (data.schema) updateData.schema = data.schema
    if (data.category) updateData.category = data.category
    if (data.tags) updateData.tags = data.tags

    if (Object.keys(updateData).length > 0) {
      await this.fetch(`/api/v1/forms/${formId}`, token, {
        method: 'PATCH',
        body: JSON.stringify(updateData),
      })
    }

    return { ...created, ...updateData, id: formId }
  }

  async saveTemplateDraft(token: string, data: Record<string, unknown>): Promise<any> {
    return this.fetch('/api/v1/templates', token, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async saveProcessDraft(token: string, data: Record<string, unknown>): Promise<any> {
    const wsId = data.workspaceId || 'default'
    // 规范化节点：补 position、label→name、格点对齐
    const rawNodes = (data.nodes as any[]) || []
    const normalizedNodes = rawNodes.map((n, i) => ({
      id: n.id,
      type: n.type,
      name: n.label || n.name || n.id,
      position: { x: 200, y: 80 + i * 120 },
      config: n.config || {},
    }))
    // 规范化边：source→sourceNodeId, target→targetNodeId
    const rawEdges = (data.edges as any[]) || []
    const normalizedEdges = rawEdges.map((e) => ({
      id: e.id,
      sourceNodeId: e.source || e.sourceNodeId,
      targetNodeId: e.target || e.targetNodeId,
    }))
    return this.fetch(`/api/v1/workspaces/${wsId}/workflows`, token, {
      method: 'POST',
      body: JSON.stringify({ ...data, nodes: normalizedNodes, edges: normalizedEdges }),
    })
  }

  async recordDecision(token: string, taskId: string, data: {
    decision: 'approve' | 'reject'
    comment?: string
  }): Promise<any> {
    return this.fetch(`/api/v1/workflow/tasks/${taskId}/decision`, token, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }
}
