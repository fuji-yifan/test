/**
 * ContextService 写流程时的 config 深度归一（防「JSON 里套 JSON」脏数据）。
 *
 * 背景：模型常把嵌套结构吐成字符串（整份 config 写成 "{}"，或 config.branches
 * 写成 "[{...}]"）。这类值落库后：设计器打开即报加载失败、服务端取
 * start.config.formId 拿不到 → 绑了表单也不发起。归一在 agent 写库这一层做掉。
 */
import { describe, expect, it } from 'vitest'
import { ContextService } from '../src/modules/context/context.service'

/** 替掉私有 fetch，捕获真正发出去的请求体 */
function makeService() {
  const svc = new ContextService()
  const calls: Array<{ path: string; method: string; body: any }> = []
  ;(svc as any).fetch = async (path: string, _token: string, opts?: any) => {
    calls.push({ path, method: opts?.method || 'GET', body: opts?.body ? JSON.parse(opts.body) : undefined })
    return { id: 'wf-new', status: 'draft' }
  }
  return { svc, calls }
}

describe('ContextService 流程 config 深度归一', () => {
  it('saveProcessDraft：字符串 config 与嵌套的字符串化 branches 都还原', async () => {
    const { svc, calls } = makeService()
    await svc.saveProcessDraft('t', {
      workspaceId: 'ws1',
      name: '客服工单处理流程',
      nodes: [
        { id: 'start', type: 'start', label: '发起申请', config: '{}' },
        { id: 'c1', type: 'condition', label: '优先级', config: { branches: '[{"name":"紧急","operator":"in"}]' } },
      ],
      edges: [],
    })

    const nodes = calls[0].body.nodes
    expect(calls[0].path).toBe('/api/v1/workspaces/ws1/workflows')
    expect(nodes[0].config).toEqual({})
    expect(nodes[1].config.branches).toEqual([{ name: '紧急', operator: 'in' }])
  })

  it('saveProcessDraft：类型归一 notify→cc，config 里的普通字符串不被误改', async () => {
    const { svc, calls } = makeService()
    await svc.saveProcessDraft('t', {
      workspaceId: 'ws1',
      name: '通知流程',
      nodes: [{ id: 'n1', type: 'notify', label: '通知', config: { template: 'auto_approved', value: '1000' } }],
      edges: [],
    })

    const node = calls[0].body.nodes[0]
    expect(node.type).toBe('cc')
    expect(node.config).toEqual({ template: 'auto_approved', value: '1000' })
  })

  it('updateProcessDraft：PATCH 只归一 config，坐标原样保留（不重跑布局）', async () => {
    const { svc, calls } = makeService()
    await svc.updateProcessDraft('t', {
      id: 'wf1',
      nodes: [{ id: 'start', type: 'start', name: '开始', position: { x: 180, y: 30 }, config: '{"formId":"f1"}' }],
    })

    expect(calls[0].method).toBe('PATCH')
    expect(calls[0].path).toBe('/api/v1/workflows/wf1')
    expect(calls[0].body.nodes[0].config).toEqual({ formId: 'f1' })
    expect(calls[0].body.nodes[0].position).toEqual({ x: 180, y: 30 })
  })
})
