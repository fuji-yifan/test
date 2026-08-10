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
    this.logger.log(`[API] ${opts?.method || 'GET'} ${path} token=${token ? token.slice(0, 15) + '...' : '(empty)'}`)
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
      // 适配 ApiResponse 包装格式 { code: 0, data, message }
      return json.data ?? json
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
      return { error: '保存失败：缺少工作空间 ID，请确保已进入工作空间后再操作' }
    }
    const wsId = workspaceId
    // Step 1: 创建表单（server 只接受 name + description）
    const created: any = await this.fetch(`/api/v1/workspaces/${wsId}/forms`, token, {
      method: 'POST',
      body: JSON.stringify({ name: data.name, description: data.description }),
    })
    const formId = created?.id
    if (!formId) return created

    // Step 2: 更新 schema、category、tags、settings
    const updateData: Record<string, unknown> = {}
    if (data.schema) updateData.schema = data.schema
    if (data.category) updateData.category = data.category
    if (data.tags) updateData.tags = data.tags
    if ((data as any).settings) updateData.settings = (data as any).settings

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
    return this.fetch('/api/v1/workflow/process-definitions', token, {
      method: 'POST',
      body: JSON.stringify(data),
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
