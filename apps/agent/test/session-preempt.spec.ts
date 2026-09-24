/**
 * 会话执行权的抢占语义（不联网、不依赖 Nest 容器与 MySQL）。
 *
 * 背景：同一会话里「上一条消息的检查点还没答，就发了下一条」时，旧实现用布尔锁
 * 直接回 SESSION_BUSY（前端「会话正在执行中，请等待完成」）。用户要的是：开始新
 * 一段对话 = 上一段自动作废。这里锁定三条不变式：
 * - 最新一轮总是拿到执行权，上一轮收到 abort；
 * - 被抢占的那一轮退出时不能解锁（否则第三个请求会插进来与新一轮并行写图）；
 * - 前一轮正常结束后，锁会被清掉，下一轮不产生额外等待。
 */
import { describe, it, expect } from 'vitest'
import { SessionService } from '../src/modules/session/session.service'
import type { SessionStore, AgentSession } from '../src/modules/session/session.store'

/** 只实现 SessionService 用到的 get/update，其余用不着 */
function makeStore(): { store: SessionStore; sessions: Map<string, AgentSession> } {
  const sessions = new Map<string, AgentSession>()
  sessions.set('sess_1', {
    id: 'sess_1',
    userId: 'user_1',
    workspaceId: 'ws_1',
    scenario: 'form-builder',
    messages: [],
    metadata: {},
    locked: false,
    createdAt: 0,
    updatedAt: 0,
  })
  const store = {
    async get(id: string) {
      return sessions.get(id) ?? null
    },
    async update(id: string, patch: Partial<AgentSession>) {
      const s = sessions.get(id)
      if (!s) return null
      Object.assign(s, patch)
      return s
    },
  }
  return { store: store as unknown as SessionStore, sessions }
}

function make() {
  const { store, sessions } = makeStore()
  return { service: new SessionService(store), sessions }
}

describe('SessionService.acquireRun / releaseRun', () => {
  it('空闲时直接拿到执行权，不抢占', async () => {
    const { service } = make()
    const a = new AbortController()

    const res = await service.acquireRun('sess_1', a)

    expect(res.preempted).toBe(false)
    expect(a.signal.aborted).toBe(false)
  })

  it('上一轮还在跑时：中止它并由本轮接管，不再报 SESSION_BUSY', async () => {
    const { service } = make()
    const a = new AbortController()
    const b = new AbortController()
    await service.acquireRun('sess_1', a)

    // A 仍持有执行权（模拟图卡在中断后的 stream 上没退出）
    const pending = service.acquireRun('sess_1', b, 2000)

    // 抢占的第一步就是同步 abort 上一轮，让信号立刻传到 graph.stream
    expect(a.signal.aborted).toBe(true)

    // A 让位（真实链路里是它自己的 finally 调 releaseRun）
    await service.releaseRun('sess_1', a)

    await expect(pending).resolves.toEqual({ preempted: true })
    expect(b.signal.aborted).toBe(false)
  })

  it('上一轮迟迟不让位时，等满 waitMs 后本轮接管', async () => {
    const { service } = make()
    const a = new AbortController()
    const b = new AbortController()
    await service.acquireRun('sess_1', a)

    const started = Date.now()
    const res = await service.acquireRun('sess_1', b, 120)

    expect(res.preempted).toBe(true)
    expect(Date.now() - started).toBeGreaterThanOrEqual(100)
    expect(a.signal.aborted).toBe(true)
  })

  it('被抢占的那一轮退出时不能解锁（否则第三个请求会并行写同一个图）', async () => {
    const { service, sessions } = make()
    const a = new AbortController()
    const b = new AbortController()
    await service.acquireRun('sess_1', a)
    const pending = service.acquireRun('sess_1', b, 0)
    await pending

    // A 现在才想起来收尾
    await service.releaseRun('sess_1', a)

    // B 仍持有：紧接着的 C 必须去抢占 B，而不是被当成空闲
    const c = new AbortController()
    const res = await service.acquireRun('sess_1', c, 0)
    expect(res.preempted).toBe(true)
    expect(b.signal.aborted).toBe(true)
    expect(sessions.get('sess_1')!.locked).toBe(true)
  })

  it('正常结束时释放：下一轮不抢占、不等待', async () => {
    const { service, sessions } = make()
    const a = new AbortController()
    await service.acquireRun('sess_1', a)
    await service.releaseRun('sess_1', a)
    expect(sessions.get('sess_1')!.locked).toBe(false)

    const b = new AbortController()
    const res = await service.acquireRun('sess_1', b)
    expect(res.preempted).toBe(false)
    expect(b.signal.aborted).toBe(false)
  })
})
