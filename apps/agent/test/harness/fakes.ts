import { AIMessage, type BaseMessage } from '@langchain/core/messages'
import { z } from 'zod'

// ==================== 测试替身 ====================

export const TOOL_RISK: Record<string, 'low' | 'medium' | 'high'> = {
  form_search_field_pool: 'low',
  form_assemble_schema: 'low',
  form_validate_schema: 'low',
  form_preview: 'low',
  form_save: 'medium',
  form_rollback: 'medium',
  flow_create: 'low',
  flow_validate: 'low',
  flow_preview: 'low',
  flow_save: 'medium',
  flow_bind_form: 'medium',
  flow_publish: 'high',
  template_search: 'low',
  template_get_detail: 'low',
  template_validate: 'low',
  template_instantiate: 'medium',
  data_list_forms: 'low',
  data_query: 'low',
  data_analyze: 'low',
  // 高风险/中风险的通用替身：用来验检查点与工具级确认门，与具体领域无关
  data_export: 'high',
  data_merge: 'medium',
}

export class FakeRegistry {
  get(name: string) {
    const risk = TOOL_RISK[name]
    if (!risk) return undefined
    return {
      name,
      description: `tool ${name}`,
      riskLevel: risk,
      parameters: { type: 'object', properties: {} },
      zodSchema: z.object({}).passthrough(),
      instance: {},
    }
  }
  getRisk(name: string) {
    return TOOL_RISK[name] ?? 'low'
  }
  list() {
    return Object.keys(TOOL_RISK).map((name) => ({ name, description: name, parameters: {} }))
  }
  listByNames(names: string[]) {
    return this.list().filter((t) => names.includes(t.name))
  }
}

export interface GwCall {
  name: string
  args: Record<string, unknown>
  confirmed: boolean
}

export class FakeGateway {
  calls: GwCall[] = []
  /** 放进来的工具名一律返回失败，用来验重试上限 / 降级 / 收尾 */
  failTools = new Set<string>()
  /** 失败时回给网关的 error 分类（默认按执行错处理） */
  failError = 'execution_error'
  /** 延迟钩子（毫秒）：用来验超时熔断（S7.1）。返回 Promise，测试自行用 withTimeout 包裹。 */
  delayMs = 0
  async execute(name: string, args: Record<string, unknown>) {
    this.calls.push({ name, args, confirmed: false })
    if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs))
    if (this.failTools.has(name)) {
      return { ok: false, summary: `${name} failed`, error: this.failError }
    }
    return this.result(name, args)
  }
  async executeConfirmed(name: string, args: Record<string, unknown>) {
    this.calls.push({ name, args, confirmed: true })
    if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs))
    return this.result(name, args)
  }
  private result(name: string, args: Record<string, unknown> = {}) {
    // 与真实工具同口径：显式 formTitle > 已有 schema 的标题 > target（新表）> 默认。
    // 有 existingSchema 时回显它的字段，避免假网关把「改表」演示成「整表重建」。
    const existing = args.existingSchema as any
    const existingTitle = existing?.settings?.formTitle
    const title =
      typeof args.formTitle === 'string' && args.formTitle
        ? args.formTitle
        : typeof existingTitle === 'string' && existingTitle
          ? existingTitle
          : typeof args.target === 'string' && args.target
            ? args.target
            : '新建表单'
    const fields =
      Array.isArray(existing?.fields) && existing.fields.length > 0
        ? existing.fields
        : [{ key: 'name', type: 'string' }]
    const payloads: Record<string, unknown> = {
      form_assemble_schema: { schema: { settings: { formTitle: title }, fields } },
      form_validate_schema: { passed: true, issues: [] },
      form_preview: { previewUrl: 'http://x/preview' },
      form_save: { formId: 'F-1' },
      flow_create: { nodes: [{ id: 'n1' }], edges: [] },
      data_analyze: { summary: '本月投诉集中在物流', insights: [] },
      template_instantiate: {
        templateId: 'T-9',
        name: '请假申请',
        schema: { fields: [{ key: 'days', type: 'number' }] },
      },
    }
    return { ok: true, summary: `${name} ok`, result: payloads[name] ?? { ok: true } }
  }
}

export interface ScriptStep {
  content?: string
  calls?: { id: string; name: string; args?: Record<string, unknown> }[]
}
export type Script = ScriptStep[]

/** 按脚本逐轮返回 AIMessage 的假模型 */
export class ScriptedLlm {
  private cursor = 0
  calls = 0
  /** 每次 think 收到的完整上下文，用来断言步骤交接时指令里带了上游产物 */
  seen: BaseMessage[][] = []
  /** 路由兜底用的 chat 通道：这里统一「无意见」，让路由沿用确定性结论 */
  chat = { invoke: async () => new AIMessage({ content: '' }) }
  constructor(private readonly script: Script) {}
  withTools() {
    return {
      invoke: async (messages: BaseMessage[]) => {
        this.seen.push(messages)
        const step = this.script[Math.min(this.cursor, this.script.length - 1)]
        this.cursor++
        this.calls++
        return new AIMessage({
          content: step.content ?? '',
          tool_calls: (step.calls ?? []).map((c) => ({ id: c.id, name: c.name, args: c.args ?? {} })),
        })
      },
    }
  }
}
