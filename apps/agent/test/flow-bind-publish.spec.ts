/**
 * flow_bind_form / flow_publish / flow_save（agent 侧流程落地）。
 *
 * 背景：绑定语义改为「流程发布后才真绑定」后，agent 这条链路必须真落库、失败如实报错：
 * - flow_bind_form 曾在空壳里谎报「已绑定」；这里断言它真读流程、真 PATCH，且保留原有 config；
 * - flow_publish 真打发布端点，409 冲突用 server 文案；
 * - flow_save 服务端没返回 id 时不得假成功。
 */
import { describe, expect, it } from 'vitest'
import { FlowBindFormTool } from '../src/modules/sub-agents/workflow/tools/flow-bind-form.tool'
import { FlowPublishTool } from '../src/modules/sub-agents/workflow/tools/flow-publish.tool'
import { FlowSaveTool } from '../src/modules/sub-agents/workflow/tools/flow-save.tool'

const DEFAULT_DEF = {
  id: 'wf1',
  name: '请假流程',
  status: 'draft',
  nodes: [
    { id: 'start', type: 'start', name: '开始', position: { x: 0, y: 0 }, config: { variables: { a: 1 } } },
    { id: 'end', type: 'end', name: '结束', position: { x: 0, y: 100 }, config: {} },
  ],
}

function httpError(status: number, message: string) {
  const e: any = new Error(message)
  e.status = status
  return e
}

function makeBind(opts?: { def?: any; getThrows?: any; updateThrows?: any }) {
  const getCalls: Array<{ token: string; flowId: string }> = []
  const updateCalls: Array<{ token: string; data: any }> = []
  const ctx = {
    getProcessDefinition: async (token: string, flowId: string) => {
      getCalls.push({ token, flowId })
      if (opts?.getThrows) throw opts.getThrows
      return opts?.def ?? DEFAULT_DEF
    },
    updateProcessDraft: async (token: string, data: any) => {
      updateCalls.push({ token, data })
      if (opts?.updateThrows) throw opts.updateThrows
      return {}
    },
  } as any
  return { tool: new FlowBindFormTool(ctx), getCalls, updateCalls }
}

function makePublish(opts?: { throws?: any }) {
  const calls: Array<{ token: string; flowId: string }> = []
  const ctx = {
    publishProcess: async (token: string, flowId: string) => {
      calls.push({ token, flowId })
      if (opts?.throws) throw opts.throws
      return {}
    },
  } as any
  return { tool: new FlowPublishTool(ctx), calls }
}

function makeSave(returns: any) {
  const calls: Array<{ token: string; data: any }> = []
  const ctx = {
    saveProcessDraft: async (token: string, data: any) => {
      calls.push({ token, data })
      return returns
    },
  } as any
  return { tool: new FlowSaveTool(ctx), calls }
}

describe('flow_bind_form', () => {
  it('成功：读流程 → PATCH start.config（保留 variables，附 formId/formName）', async () => {
    const { tool, getCalls, updateCalls } = makeBind()
    const res = await tool.execute({ token: 't', flowId: 'wf1', formId: 'f1', formName: '请假申请' })
    expect(res.ok).toBeUndefined()
    expect(res.flowId).toBe('wf1')
    expect(res.formId).toBe('f1')
    expect(res.summary).toContain('发布后')
    expect(getCalls).toEqual([{ token: 't', flowId: 'wf1' }])
    expect(updateCalls).toHaveLength(1)
    const nodes = updateCalls[0].data.nodes
    const start = nodes.find((n: any) => n.type === 'start')
    expect(start.config.formId).toBe('f1')
    expect(start.config.formName).toBe('请假申请')
    expect(start.config.variables).toEqual({ a: 1 }) // 既有 config 必须保留
    const end = nodes.find((n: any) => n.type === 'end')
    expect(end).toEqual(DEFAULT_DEF.nodes[1]) // 非 start 节点原样保留
  })

  it('没有 token → 未登录，不调 server', async () => {
    const { tool, getCalls } = makeBind()
    const res = await tool.execute({ flowId: 'wf1', formId: 'f1' })
    expect(res.ok).toBe(false)
    expect(res.error).toBe('no_token_in_session')
    expect(getCalls).toHaveLength(0)
  })

  it('没有 flowId → 报错，不调 server', async () => {
    const { tool, getCalls, updateCalls } = makeBind()
    const res = await tool.execute({ token: 't', formId: 'f1' })
    expect(res.error).toBe('no_flow_id')
    expect(getCalls).toHaveLength(0)
    expect(updateCalls).toHaveLength(0)
  })

  it('没有 formId → 报错，不调 server', async () => {
    const { tool, getCalls } = makeBind()
    const res = await tool.execute({ token: 't', flowId: 'wf1' })
    expect(res.error).toBe('no_form_id')
    expect(getCalls).toHaveLength(0)
  })

  it('流程不存在（404）→ 提示先保存，不 PATCH', async () => {
    const { tool, updateCalls } = makeBind({ getThrows: httpError(404, '流程定义不存在') })
    const res = await tool.execute({ token: 't', flowId: 'wf1', formId: 'f1' })
    expect(res.ok).toBe(false)
    expect(res.error).toBe('flow_not_found')
    expect(res.summary).toContain('flow_save')
    expect(updateCalls).toHaveLength(0)
  })

  it('没有 start 节点 → 报错，不 PATCH', async () => {
    const def = { ...DEFAULT_DEF, nodes: [{ id: 'end', type: 'end', config: {} }] }
    const { tool, updateCalls } = makeBind({ def })
    const res = await tool.execute({ token: 't', flowId: 'wf1', formId: 'f1' })
    expect(res.ok).toBe(false)
    expect(res.error).toBe('no_start_node')
    expect(updateCalls).toHaveLength(0)
  })

  it('PATCH 冲突（409）→ ok:false，透传 server 文案', async () => {
    const msg = '表单「请假申请」已被流程「报销流程」绑定，请先撤销发布或改为关联其他表单'
    const { tool } = makeBind({ updateThrows: httpError(409, msg) })
    const res = await tool.execute({ token: 't', flowId: 'wf1', formId: 'f1' })
    expect(res.ok).toBe(false)
    expect(res.error).toBe('bind_conflict')
    expect(res.summary).toBe(msg)
  })
})

describe('flow_publish', () => {
  it('成功：调 publishProcess，摘要含「已发布」', async () => {
    const { tool, calls } = makePublish()
    const res = await tool.execute({ token: 't', flowId: 'wf1', name: '请假流程' })
    expect(res.ok).toBeUndefined()
    expect(res.flowId).toBe('wf1')
    expect(res.status).toBe('published')
    expect(res.summary).toContain('已发布')
    expect(calls).toEqual([{ token: 't', flowId: 'wf1' }])
  })

  it('没有 token → 未登录，不调 server', async () => {
    const { tool, calls } = makePublish()
    const res = await tool.execute({ flowId: 'wf1' })
    expect(res.error).toBe('no_token_in_session')
    expect(calls).toHaveLength(0)
  })

  it('没有 flowId → 报错，不调 server', async () => {
    const { tool, calls } = makePublish()
    const res = await tool.execute({ token: 't' })
    expect(res.error).toBe('no_flow_id')
    expect(calls).toHaveLength(0)
  })

  it('发布冲突（409）→ ok:false + server 文案', async () => {
    const msg = '表单「请假申请」已被流程「报销流程」绑定，请先撤销发布或改为关联其他表单'
    const { tool } = makePublish({ throws: httpError(409, msg) })
    const res = await tool.execute({ token: 't', flowId: 'wf1' })
    expect(res.ok).toBe(false)
    expect(res.error).toBe('publish_conflict')
    expect(res.summary).toBe(msg)
  })

  it('未关联表单（400）→ ok:false + no_form_bound，用 server 文案', async () => {
    const msg = '请先为该流程关联表单后再发布'
    const { tool } = makePublish({ throws: httpError(400, msg) })
    const res = await tool.execute({ token: 't', flowId: 'wf1' })
    expect(res.ok).toBe(false)
    expect(res.error).toBe('no_form_bound')
    expect(res.summary).toBe(msg)
  })
})

describe('flow_save', () => {
  it('成功：返回 id 与 status，摘要提示是草稿', async () => {
    const { tool, calls } = makeSave({ id: 'wf1', status: 'draft' })
    const res = await tool.execute({ token: 't', workspaceId: 'ws1', name: '请假流程', nodes: [], edges: [] })
    expect(res.ok).toBeUndefined()
    expect(res.id).toBe('wf1')
    expect(res.status).toBe('draft')
    expect(res.summary).toContain('草稿')
    expect(calls).toHaveLength(1)
  })

  it('没有 token → 未登录，不调 server', async () => {
    const { tool, calls } = makeSave({ id: 'wf1' })
    const res = await tool.execute({ workspaceId: 'ws1', name: 'x', nodes: [], edges: [] })
    expect(res.error).toBe('no_token_in_session')
    expect(calls).toHaveLength(0)
  })

  it('服务端未返回 id → 不得假成功', async () => {
    const { tool } = makeSave({})
    const res = await tool.execute({ token: 't', workspaceId: 'ws1', name: 'x', nodes: [], edges: [] })
    expect(res.ok).toBe(false)
    expect(res.error).toBe('save_failed')
  })
})
