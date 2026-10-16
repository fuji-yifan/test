/**
 * GraphRunnerService.persist 的成本落库（阶段 4 / 4.1、4.5）。
 *
 * usage channel 是累加器、跨轮不清零 → values.usage 就是「会话累计」。persist 必须在
 * plan 判空**之前**写 metadata.usageTotals，否则纯闲聊轮（无 plan）的成本会丢。
 * 单条回答的用量 = usage − usageAtTurnStart（轮首由 routerNode 写入的基线），随消息落库。
 * 这里用假图 + 记录型 sessions 直接驱动 runner，不碰 checkpoint / 子图机器。
 */
import { describe, expect, it } from 'vitest'
import { GraphRunnerService } from '../src/modules/graph/graph-runner.service'

function makeRunner(values: any) {
  const patches: Record<string, any>[] = []
  const messages: Record<string, any>[] = []
  // 空流（不产生任何 GraphEvent），getState 返回设定的最终 values
  const graphs = {
    graph: {
      stream: async () => (async function* () {})(),
      getState: async () => ({ values, tasks: [] }),
    },
  } as any
  const sessions = {
    updateMetadata: async (_id: string, patch: Record<string, any>) => {
      patches.push(patch)
    },
    addMessage: async (_id: string, msg: Record<string, any>) => {
      messages.push(msg)
    },
  } as any
  return { runner: new GraphRunnerService(graphs, sessions), patches, messages }
}

function run(runner: GraphRunnerService, message = 'hi') {
  return runner.run({
    sessionId: 's1',
    userId: 'u1',
    workspaceId: 'w1',
    userToken: 'tok',
    message,
    pageContext: { scenario: 'form-builder' },
    onEvent: () => {},
  })
}

describe('GraphRunnerService — usageTotals 落库（阶段 4 / 4.1）', () => {
  it('无 plan 的一轮也把会话累计用量写进 metadata.usageTotals', async () => {
    const usage = { inputTokens: 11, outputTokens: 22 }
    const { runner, patches } = makeRunner({ usage, finalContent: '闲聊回复' })

    const result = await run(runner)

    expect(result.usage).toEqual(usage)
    const usagePatch = patches.find((p) => 'usageTotals' in p)
    expect(usagePatch?.usageTotals).toEqual(usage)
  })

  it('有 plan 的一轮：usageTotals 与 plan 元数据各写一次，互不覆盖', async () => {
    const usage = { inputTokens: 33, outputTokens: 44 }
    const { runner, patches } = makeRunner({
      usage,
      plan: { steps: [{ id: '1', action: '生成表单' }] },
      completedSteps: [],
      finalContent: 'done',
    })

    await run(runner)

    expect(patches.find((p) => 'usageTotals' in p)?.usageTotals).toEqual(usage)
    expect(patches.some((p) => p.plan)).toBe(true)
  })

  it('values 没有 usage 时兜底写零（不写 undefined）', async () => {
    const { runner, patches } = makeRunner({ finalContent: 'x' })

    await run(runner)

    expect(patches.find((p) => 'usageTotals' in p)?.usageTotals).toEqual({ inputTokens: 0, outputTokens: 0 })
  })
})

describe('GraphRunnerService — 单条回答用量（阶段 4 / 4.5）', () => {
  it('turnUsage = usage − usageAtTurnStart，且随 assistant 消息落库', async () => {
    // 消息落库挂在 persist 的 plan 分支之后（无 plan 的纯闲聊轮不落 assistant 消息），
    // 所以这里要有 plan 才走得到 addMessage。
    const { runner, patches, messages } = makeRunner({
      usage: { inputTokens: 100, outputTokens: 500 },
      usageAtTurnStart: { inputTokens: 40, outputTokens: 300 },
      plan: { steps: [{ id: '1', action: '生成表单' }] },
      completedSteps: [],
      finalContent: '本轮回答',
    })

    const result = await run(runner)

    expect(result.turnUsage).toEqual({ inputTokens: 60, outputTokens: 200 })
    // 累计口径不受影响（防回归）
    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 500 })
    expect(patches.find((p) => 'usageTotals' in p)?.usageTotals).toEqual({
      inputTokens: 100,
      outputTokens: 500,
    })
    expect(messages).toHaveLength(1)
    expect(messages[0].usage).toEqual({ inputTokens: 60, outputTokens: 200 })
  })

  it('缺 usageAtTurnStart（老 checkpoint）时基线当 0，不出现负数', async () => {
    const { runner } = makeRunner({
      usage: { inputTokens: 10, outputTokens: 20 },
      finalContent: 'x',
    })

    const result = await run(runner)

    expect(result.turnUsage).toEqual({ inputTokens: 10, outputTokens: 20 })
  })
})
