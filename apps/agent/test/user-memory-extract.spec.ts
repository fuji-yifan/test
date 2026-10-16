/**
 * 用户长期记忆的提取链路（阶段 8 §3.7 / 8.2）：提取器解析 + service 落库护栏。
 * LLM 与 store 都用假件，纯逻辑验证；真 store 见 user-memory-mysql.spec.ts。
 */
import { describe, expect, it } from 'vitest'
import { UserMemoryService } from '../src/modules/memory/user-memory.service'
import { UserMemoryExtractor } from '../src/modules/memory/user-memory.extractor'
import type { UserMemoryRecord } from '../src/modules/memory/user-memory.types'
import type { AgentSession } from '../src/modules/session/session.store'
import type { RunGraphResult } from '../src/modules/graph/graph-runner.service'

function makeSession(over: Partial<AgentSession> = {}): AgentSession {
  return {
    id: 'sess_1',
    userId: 'user_1',
    workspaceId: 'ws_1',
    scenario: 'form-builder',
    messages: [],
    metadata: {},
    locked: false,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }
}

const OK: RunGraphResult = {
  finalContent: '好的，以后都用中文。',
  usage: { inputTokens: 1, outputTokens: 1 },
  turnUsage: { inputTokens: 1, outputTokens: 1 },
  halted: false,
  gaveUp: false,
}

function makeStore(opts: { available?: boolean } = {}) {
  const upserts: UserMemoryRecord[][] = []
  const store = {
    async available() {
      return opts.available !== false
    },
    async upsertMany(records: UserMemoryRecord[]) {
      upserts.push(records)
    },
    async list() {
      return []
    },
    async remove() {
      return false
    },
  }
  return { store: store as any, upserts }
}

function makeConfig(over: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    'userMemory.enabled': true,
    'userMemory.extractEnabled': true,
    'userMemory.extractMaxPerTurn': 5,
    'userMemory.maxScan': 200,
    'userMemory.recallTopK': 5,
    ...over,
  }
  return { get: (key: string) => values[key] } as any
}

/** 假 LLM 返回固定文本；记录调用次数。 */
function makeLlm(content: string) {
  let calls = 0
  const llm = {
    chat: {
      async invoke() {
        calls++
        return { content }
      },
    },
  }
  return { llm: llm as any, count: () => calls }
}

function build(llmContent: string, storeOpts: { available?: boolean } = {}, configOver: Record<string, unknown> = {}) {
  const { store, upserts } = makeStore(storeOpts)
  const { llm, count } = makeLlm(llmContent)
  const extractor = new UserMemoryExtractor(llm)
  const service = new UserMemoryService(store, extractor, makeConfig(configOver))
  return { service, upserts, llmCount: count }
}

describe('UserMemoryService.extractAndStore', () => {
  it('解析模型输出并落库，带 id / 来源会话 / scope', async () => {
    const { service, upserts } = build(
      '[{"kind":"preference","key":"语言","value":"中文","confidence":0.9}]',
    )
    await service.extractAndStore(makeSession(), OK, '以后都用中文回答')

    expect(upserts).toHaveLength(1)
    const [r] = upserts[0]
    expect(r).toMatchObject({
      userId: 'user_1',
      workspaceId: 'ws_1',
      kind: 'preference',
      key: '语言',
      value: '中文',
      sourceSessionId: 'sess_1',
      state: 'active',
    })
    expect(r.id).toMatch(/^mem_/)
  })

  it('每轮条数上限生效（extractMaxPerTurn）', async () => {
    const items = Array.from({ length: 8 }, (_, i) => ({
      kind: 'entity',
      key: `k${i}`,
      value: `v${i}`,
    }))
    const { service, upserts } = build(JSON.stringify(items), {}, { 'userMemory.extractMaxPerTurn': 3 })
    await service.extractAndStore(makeSession(), OK, '这是我的常用表单列表')
    expect(upserts[0]).toHaveLength(3)
  })

  it('extractEnabled=false → 不调模型、不落库', async () => {
    const { service, upserts, llmCount } = build(
      '[{"kind":"preference","key":"语言","value":"中文"}]',
      {},
      { 'userMemory.extractEnabled': false },
    )
    await service.extractAndStore(makeSession(), OK, '以后都用中文回答')
    expect(upserts).toHaveLength(0)
    expect(llmCount()).toBe(0)
  })

  it('存储不可用 → 不调模型、不落库（降级 no-op）', async () => {
    const { service, upserts, llmCount } = build(
      '[{"kind":"preference","key":"语言","value":"中文"}]',
      { available: false },
    )
    await service.extractAndStore(makeSession(), OK, '以后都用中文回答')
    expect(upserts).toHaveLength(0)
    expect(llmCount()).toBe(0)
  })

  it('同会话并发去重：第二次调用被跳过', async () => {
    const { service, llmCount } = build('[{"kind":"preference","key":"语言","value":"中文"}]')
    const session = makeSession()
    await Promise.all([
      service.extractAndStore(session, OK, '以后都用中文回答'),
      service.extractAndStore(session, OK, '以后都用中文回答'),
    ])
    expect(llmCount()).toBe(1)
  })

  it('模型输出为空数组 → 不落库', async () => {
    const { service, upserts } = build('[]')
    await service.extractAndStore(makeSession(), OK, '以后都用中文回答')
    expect(upserts).toHaveLength(0)
  })
})

describe('UserMemoryExtractor', () => {
  it('寒暄/过短用户发言跳过（不打模型）', async () => {
    const { service, llmCount } = build('[{"kind":"preference","key":"x","value":"y"}]')
    await service.extractAndStore(makeSession(), OK, '你好')
    expect(llmCount()).toBe(0)
  })
})
