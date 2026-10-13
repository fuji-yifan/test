/**
 * LangChainToolBridge 单元测试。
 *
 * 用假 Registry / Gateway 验证桥接层契约：
 * - 只桥接已注册的工具，未知名字跳过；
 * - 注入 token / workspaceId / savedFormId（与 legacy base.agent 对齐）；
 * - 工具调用 id 作为网关幂等键透传；
 * - confirmRequired 转成 ToolConfirmationRequiredError 抛出，而不是当成工具结果；
 * - 结果序列化成 { ok, summary, data?, error? } JSON。
 */
import { describe, expect, it } from 'vitest'
import type { ConfigService } from '@nestjs/config'
import { LangChainToolBridge } from '../src/modules/graph/tool-bridge.service'
import { ToolConfirmationRequiredError } from '../src/modules/graph/tool-confirmation.error'
import type { ToolRegistry } from '../src/modules/harness/tool.registry'
import type { GatewayResult, ToolGateway } from '../src/modules/harness/tool-gateway'

const FORM_SAVE = {
  name: 'form_save',
  description: '保存表单到服务端',
  riskLevel: 'low' as const,
  parameters: { type: 'object', properties: { title: { type: 'string' } } },
  zodSchema: undefined,
  instance: {},
}

const DATA_EXPORT = {
  name: 'data_export',
  description: '导出提交数据',
  riskLevel: 'high' as const,
  parameters: { type: 'object', properties: { id: { type: 'string' } } },
  zodSchema: undefined,
  instance: {},
}

interface ExecCall {
  tool: string
  args: Record<string, unknown>
  opts?: { requestId?: string; userId?: string; workspaceId?: string }
  confirmed?: boolean
}

class FakeGateway {
  readonly calls: ExecCall[] = []
  result: GatewayResult = { ok: true, summary: '已保存', result: { formId: 'f1' } }

  async execute(tool: string, args: Record<string, unknown>, opts?: ExecCall['opts']) {
    this.calls.push({ tool, args, opts })
    return this.result
  }

  async executeConfirmed(tool: string, args: Record<string, unknown>, opts?: ExecCall['opts']) {
    this.calls.push({ tool, args, opts, confirmed: true })
    return this.result
  }
}

function makeBridge(tools: Record<string, unknown>, gateway = new FakeGateway()) {
  const registry = {
    get: (name: string) => tools[name],
    getRisk: (name: string) => (tools[name] as any)?.riskLevel ?? 'low',
  } as unknown as ToolRegistry
  // 假 ConfigService：token 预算 2000（≈4000 字符）与 .env.example 默认一致
  const config = {
    get: (key: string) =>
      ({ 'context.maxToolResultTokens': 2000, 'context.maxToolResultChars': 8000 } as Record<string, unknown>)[
        key
      ],
  } as unknown as ConfigService
  return {
    bridge: new LangChainToolBridge(registry, gateway as unknown as ToolGateway, config),
    gateway,
  }
}

/** 从 invoke 结果里取文本内容：带 toolCall 时是 ToolMessage，否则是裸字符串 */
function textOf(out: unknown): string {
  if (typeof out === 'string') return out
  const content = (out as { content?: unknown }).content
  return typeof content === 'string' ? content : JSON.stringify(content)
}

function toolCallInput(name: string, args: Record<string, unknown>, id: string) {
  return { name, args, id, type: 'tool_call' as const }
}

describe('LangChainToolBridge', () => {
  it('按名字桥接已注册工具，未知名字跳过', () => {
    const { bridge } = makeBridge({ form_save: FORM_SAVE })
    const tools = bridge.build(['form_save', 'not_registered'])

    expect(tools).toHaveLength(1)
    expect(tools[0].name).toBe('form_save')
    expect(tools[0].description).toBe('保存表单到服务端')
  })

  it('调用时注入 token/workspaceId，并把 toolCall id 作为 requestId 透传', async () => {
    const { bridge, gateway } = makeBridge({ form_save: FORM_SAVE })
    const t = bridge.build(['form_save'], {
      userToken: 'tok-1',
      workspaceId: 'ws-1',
      userId: 'u-1',
    })[0]

    const out = await t.invoke(toolCallInput('form_save', { title: '报名表' }, 'call-1'))

    expect(gateway.calls).toHaveLength(1)
    expect(gateway.calls[0].tool).toBe('form_save')
    expect(gateway.calls[0].args).toMatchObject({
      title: '报名表',
      token: 'tok-1',
      workspaceId: 'ws-1',
    })
    expect(gateway.calls[0].opts).toEqual({
      requestId: 'call-1',
      userId: 'u-1',
      workspaceId: 'ws-1',
    })
    expect(JSON.parse(textOf(out))).toEqual({
      ok: true,
      summary: '已保存',
      data: { formId: 'f1' },
    })
  })

  it('LangGraph runtime 上的 toolCallId 优先于 config.toolCall.id', async () => {
    const { bridge, gateway } = makeBridge({ form_save: FORM_SAVE })
    const t = bridge.build(['form_save'])[0]

    await t.invoke(toolCallInput('form_save', {}, 'call-from-toolcall'), {
      toolCallId: 'call-from-runtime',
    })

    expect(gateway.calls[0].opts?.requestId).toBe('call-from-runtime')
  })

  it('savedFormId 注入到 form_save，但不覆盖显式传入的 formId', async () => {
    const { bridge, gateway } = makeBridge({ form_save: FORM_SAVE })
    const t = bridge.build(['form_save'], { savedFormId: 'f-existing' })[0]

    await t.invoke(toolCallInput('form_save', {}, 'c1'))
    await t.invoke(toolCallInput('form_save', { formId: 'f-explicit' }, 'c2'))

    expect(gateway.calls[0].args.formId).toBe('f-existing')
    expect(gateway.calls[1].args.formId).toBe('f-explicit')
  })

  it('form_save 把 toolCall id 注入为 clientRequestId（幂等键，切片 C）', async () => {
    const { bridge, gateway } = makeBridge({ form_save: FORM_SAVE, data_export: DATA_EXPORT })

    // 有 id：form_save 带上 clientRequestId
    await bridge
      .build(['form_save'])[0]
      .invoke(toolCallInput('form_save', { title: '报名表' }, 'call-x'))
    expect(gateway.calls[0].args.clientRequestId).toBe('call-x')

    // 无 id：不注入
    await bridge.build(['form_save'])[0].invoke(toolCallInput('form_save', {}, undefined as any))
    expect(gateway.calls[1].args.clientRequestId).toBeUndefined()

    // 非 form_save：不注入（幂等键只服务于表单创建）
    await bridge
      .build(['data_export'])[0]
      .invoke(toolCallInput('data_export', { id: 'sub-1' }, 'call-y'))
    expect(gateway.calls[2].args.clientRequestId).toBeUndefined()
  })

  it('form_rollback 命中已保存的表时注入 formId，未保存/新建的表不注入（5.5）', async () => {
    const FORM_ROLLBACK = { ...FORM_SAVE, name: 'form_rollback' }
    const { bridge, gateway } = makeBridge({ form_rollback: FORM_ROLLBACK })
    const worksheet = {
      forms: [
        { key: 'f1', title: '客户登记表', schema: {}, formId: 'uuid-1' },
        { key: 'f2', title: '员工登记表', schema: {} },
      ],
      focusKey: 'f1',
    }

    // 命中已保存的 f1 → 注入 formId
    await bridge.run('form_rollback', {}, {
      userToken: 'tok',
      formWorksheet: worksheet,
      formTarget: { kind: 'update', key: 'f1' },
    })
    expect(gateway.calls[0].args.formId).toBe('uuid-1')

    // 命中没保存过的 f2（无 formId）→ 不注入，工具据此报「没有可回滚的版本」
    await bridge.run('form_rollback', {}, {
      userToken: 'tok',
      formWorksheet: worksheet,
      formTarget: { kind: 'update', key: 'f2' },
    })
    expect(gateway.calls[1].args.formId).toBeUndefined()
  })

  it('confirmRequired 抛 ToolConfirmationRequiredError，携带 tool/args/risk/callId', async () => {
    const { bridge, gateway } = makeBridge({ data_export: DATA_EXPORT })
    gateway.result = {
      ok: false,
      confirmRequired: true,
      confirmCallId: 'confirm_abc',
      risk: 'high',
      summary: 'Tool "data_export" requires confirmation (risk: high)',
    }
    const t = bridge.build(['data_export'], { userToken: 'tok-9' })[0]

    const err = await t
      .invoke(toolCallInput('data_export', { id: 'sub-1' }, 'call-7'))
      .then(() => null)
      .catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ToolConfirmationRequiredError)
    const e = err as ToolConfirmationRequiredError
    expect(e.tool).toBe('data_export')
    expect(e.risk).toBe('high')
    expect(e.confirmCallId).toBe('confirm_abc')
    expect(e.args).toMatchObject({ id: 'sub-1', token: 'tok-9' })
  })

  it('工具执行失败时把 error 带进 JSON，仍返回字符串结果', async () => {
    const { bridge, gateway } = makeBridge({ form_save: FORM_SAVE })
    gateway.result = { ok: false, summary: '参数错误：title 必填', error: 'validation_error' }
    const t = bridge.build(['form_save'])[0]

    const out = await t.invoke(toolCallInput('form_save', {}, 'c1'))

    const parsed = JSON.parse(textOf(out))
    expect(parsed.ok).toBe(false)
    expect(parsed.error).toBe('validation_error')
    expect(parsed.summary).toContain('参数错误')
  })

  it('在 token 预算内的工具结果原样返回，不动', async () => {
    const { bridge } = makeBridge({ form_save: FORM_SAVE })
    const out = await bridge.toToolMessageContent({
      ok: true,
      summary: '已保存',
      result: { id: 'f1' },
    })

    expect(JSON.parse(out)).toEqual({ ok: true, summary: '已保存', data: { id: 'f1' } })
  })

  it('超 token 预算时摘要化：丢掉大字段（整份 schema），保住 id/name 等小字段', async () => {
    const { bridge } = makeBridge({ template_search: FORM_SAVE })
    // 每份 schema 是一个「平铺的大对象」（各字段都小、整体超阈值 → 判为可丢的整块 blob）
    const templates = Array.from({ length: 10 }, (_, i) => ({
      id: `t${i}`,
      name: `模板${i}`,
      description: '描述',
      schema: Object.fromEntries(Array.from({ length: 50 }, (_, j) => [`f${j}`, 'x'.repeat(30)])),
    }))

    const out = await bridge.toToolMessageContent({
      ok: true,
      summary: '找到 10 个模板',
      result: { templates },
    })

    const parsed = JSON.parse(out)
    expect(parsed.ok).toBe(true)
    // 小字段保住
    expect(parsed.data.templates[0].id).toBe('t0')
    expect(parsed.data.templates[0].name).toBe('模板0')
    // 大字段（每份 schema）整块丢，换成占位符
    expect(parsed.data.templates[0].schema).toMatch(/^\[omitted \d+ chars\]$/)
    // 摘要化已足够压到预算内 → 不再硬截
    expect(out).not.toContain('[truncated')
  })

  it('摘要化仍超预算（大量小字段累加）时头尾硬截，保留 ok/summary', async () => {
    const { bridge } = makeBridge({ data_export: DATA_EXPORT })
    // 100 条小记录：每条都小于单字段阈值（不会被摘要化），但总量远超预算
    const rows = Array.from({ length: 100 }, (_, i) => ({ id: `row-${i}`, v: 'x'.repeat(50) }))
    const out = await bridge.toToolMessageContent({ ok: true, summary: '导出完成', result: { rows } })

    expect(out).toContain('[truncated')
    expect(out.length).toBeLessThan(4200)
    // 头尾都要留：截断不能把 ok / summary 这些关键字段弄丢
    expect(out.startsWith('{"ok":true')).toBe(true)
  })

  it('executeConfirmed 走确认后重放路径', async () => {
    const { bridge, gateway } = makeBridge({ data_export: DATA_EXPORT })

    const out = await bridge.executeConfirmed('data_export', { id: 'sub-1' }, {
      requestId: 'call-7',
      userId: 'u-1',
    })

    expect(gateway.calls[0].confirmed).toBe(true)
    expect(JSON.parse(out)).toEqual({ ok: true, summary: '已保存', data: { formId: 'f1' } })
  })
})
