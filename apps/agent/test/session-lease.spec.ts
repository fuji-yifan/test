/**
 * 会话执行权「跨副本租约」的接入逻辑（阶段 3 切片 B，纯逻辑、不联网）。
 *
 * 租约原语本身（原子 upsert / 过期 steal）在 session-lease-mysql.spec.ts 用真库验；
 * 这里验 SessionService 如何用它：抢到放行、抢不到回绝、心跳续期、renew 失败自退、
 * 释放只由持有者触发、以及 store 未实现租约时静默降级（等于纯内存现状）。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { SessionService, SessionBusyError } from '../src/modules/session/session.service'
import type { SessionStore, AgentSession } from '../src/modules/session/session.store'

interface LeaseImpl {
  /** 可为函数：第 n 次 acquire（1 起）是否授予 */
  granted?: boolean | ((n: number) => boolean)
  renewOk?: boolean
}

function makeStore(lease?: LeaseImpl) {
  const calls = {
    acquire: 0,
    renew: 0,
    released: [] as Array<{ id: string; owner: string }>,
    acquiredBy: [] as string[],
  }
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

  const store: Record<string, unknown> = {
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
  if (lease) {
    store.acquireLease = async (_id: string, owner: string) => {
      calls.acquire++
      calls.acquiredBy.push(owner)
      const granted =
        typeof lease.granted === 'function' ? lease.granted(calls.acquire) : lease.granted ?? true
      return { granted, degraded: false }
    }
    store.renewLease = async () => {
      calls.renew++
      return lease.renewOk ?? true
    }
    store.releaseLease = async (id: string, owner: string) => {
      calls.released.push({ id, owner })
    }
  }
  return { store: store as unknown as SessionStore, calls, sessions }
}

const savedEnv = {
  ttl: process.env.SESSION_LEASE_TTL_MS,
  heartbeat: process.env.SESSION_LEASE_HEARTBEAT_MS,
}
const services: SessionService[] = []

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

function make(lease?: LeaseImpl) {
  const built = makeStore(lease)
  const service = new SessionService(built.store)
  services.push(service)
  return { ...built, service }
}

/** 忠实模拟单实例租约：同 owner 恒授予；release 仅在 owner 匹配时清空。 */
function makeRig() {
  const calls = { acquire: 0, renew: 0, release: 0 }
  let leaseOwner: string | null = null
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
  const store: Record<string, unknown> = {
    async get(id: string) {
      return sessions.get(id) ?? null
    },
    async update(id: string, patch: Partial<AgentSession>) {
      const s = sessions.get(id)
      if (!s) return null
      Object.assign(s, patch)
      return s
    },
    async acquireLease(_id: string, owner: string) {
      calls.acquire++
      leaseOwner = owner
      return { granted: true, degraded: false }
    },
    async renewLease() {
      calls.renew++
      return leaseOwner !== null
    },
    async releaseLease(_id: string, owner: string) {
      calls.release++
      if (leaseOwner === owner) leaseOwner = null
    },
  }
  return { store: store as unknown as SessionStore, calls, hasLease: () => leaseOwner !== null }
}

afterEach(() => {
  for (const s of services) s.onModuleDestroy()
  services.length = 0
  restoreEnv('SESSION_LEASE_TTL_MS', savedEnv.ttl)
  restoreEnv('SESSION_LEASE_HEARTBEAT_MS', savedEnv.heartbeat)
})

describe('SessionService 跨副本租约', () => {
  it('抢到租约即放行，owner 为进程实例 id；释放时归还', async () => {
    const { service, calls } = make({ granted: true })
    const a = new AbortController()

    const res = await service.acquireRun('sess_1', a)
    expect(res.preempted).toBe(false)
    expect(calls.acquire).toBe(1)
    const owner = calls.acquiredBy[0]
    expect(owner).toMatch(/^inst_/)

    await service.releaseRun('sess_1', a)
    expect(calls.released).toEqual([{ id: 'sess_1', owner }])
  })

  it('另一副本持活租约时：轮询到 waitMs 后回绝（SessionBusyError）', async () => {
    const { service, calls } = make({ granted: false })
    const a = new AbortController()

    await expect(service.acquireRun('sess_1', a, 150)).rejects.toBeInstanceOf(SessionBusyError)
    expect(calls.acquire).toBeGreaterThan(1) // 确实轮询了

    // 回绝后由调用方（hub 的 finally）清本进程占位；租约不是本轮的，释放只记一次调用
    await service.releaseRun('sess_1', a)
    expect(calls.released).toHaveLength(1)
  })

  it('等待期间对方释放：抢到租约并放行', async () => {
    // 第 1 次拿不到，第 2 次拿到（模拟另一副本在等待期间释放）
    const { service, calls } = make({ granted: (n) => n > 1 })
    const a = new AbortController()

    const res = await service.acquireRun('sess_1', a, 1000)
    expect(res.preempted).toBe(false)
    expect(calls.acquire).toBe(2)
  })

  it('心跳续期；renew 返回 false（租约被夺）→ 中止本进程该轮', async () => {
    process.env.SESSION_LEASE_TTL_MS = '100'
    process.env.SESSION_LEASE_HEARTBEAT_MS = '20'
    const { service, calls } = make({ granted: true, renewOk: false })
    const a = new AbortController()

    await service.acquireRun('sess_1', a)
    await new Promise((r) => setTimeout(r, 80))

    expect(calls.renew).toBeGreaterThanOrEqual(1)
    expect(a.signal.aborted).toBe(true)
  })

  it('非持有者释放不触碰租约（镜像「只有持有者解锁」）', async () => {
    const { service, calls } = make({ granted: true })
    const a = new AbortController()
    const b = new AbortController()
    await service.acquireRun('sess_1', a)

    await service.releaseRun('sess_1', b) // b 不是持有者
    expect(calls.released).toEqual([])

    await service.releaseRun('sess_1', a)
    expect(calls.released).toHaveLength(1)
  })

  it('降级：store 未实现租约方法时直接放行、不抛错（等于纯内存现状）', async () => {
    const { service } = make() // 无 lease → 无 acquireLease
    const a = new AbortController()
    const res = await service.acquireRun('sess_1', a)
    expect(res.preempted).toBe(false)
    expect(a.signal.aborted).toBe(false)
  })

  it('同实例抢占：被抢占轮让位后，继任轮仍持有租约与心跳（回归：曾被误删）', async () => {
    process.env.SESSION_LEASE_TTL_MS = '100'
    process.env.SESSION_LEASE_HEARTBEAT_MS = '20'
    const rig = makeRig()
    const service = new SessionService(rig.store)
    services.push(service)

    const a = new AbortController()
    await service.acquireRun('sess_1', a)
    expect(rig.hasLease()).toBe(true)

    const b = new AbortController()
    const pending = service.acquireRun('sess_1', b, 2000)
    await service.releaseRun('sess_1', a) // A 让位：会释放它「以为的」租约、清心跳
    await pending

    // 继任轮 B 必须重新持有租约（owner 是进程级共享，A 的让位不该把 B 的锁顺手删掉）
    expect(rig.hasLease()).toBe(true)
    // 且 B 的心跳在跑：renew 次数继续增长
    const before = rig.calls.renew
    await new Promise((r) => setTimeout(r, 60))
    expect(rig.calls.renew).toBeGreaterThan(before)
  })
})
