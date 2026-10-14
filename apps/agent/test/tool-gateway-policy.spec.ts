/**
 * ToolGateway × 策略门（阶段 6 / S3.1+S3.2）。
 *
 * 验：deny 直接拦（不打 registry、落审计）；内置删除兜底确认；warn 带审计备注；
 * 且**旧 5 参构造（无策略服务）行为不变**。
 */
import { describe, expect, it } from 'vitest'
import type { ConfigService } from '@nestjs/config'
import { ToolGateway } from '../src/modules/harness/tool-gateway'
import { ToolResultCache } from '../src/modules/cache/tool-cache.service'
import type { PolicyDecision } from '../src/modules/harness/policy-rules'

const RISK: Record<string, 'low' | 'medium' | 'high' | 'critical'> = {
  data_query: 'low',
  form_save: 'low',
  form_delete: 'low', // 故意评 low：验内置兜底确认
  data_export: 'high',
}

class StubRegistry {
  calls: string[] = []
  result = { ok: true, summary: 'ok', data: { v: 1 } }
  get(name: string) {
    return { name, riskLevel: RISK[name] ?? 'low' }
  }
  getRisk(name: string) {
    return RISK[name] ?? 'low'
  }
  async call(name: string) {
    this.calls.push(name)
    return this.result
  }
}

class StubAudit {
  records: any[] = []
  async available() {
    return true
  }
  async record(entry: any) {
    this.records.push(entry)
  }
}

function makeConfig(): ConfigService {
  return {
    get: (k: string) =>
      ({ 'cache.ttlSeconds': 60, 'cache.enabled': true, 'context.toolTimeoutMs': 30000 } as Record<
        string,
        unknown
      >)[k],
  } as unknown as ConfigService
}

function makeGateway(policy?: { check: () => Promise<PolicyDecision> }) {
  const registry = new StubRegistry()
  const audit = new StubAudit()
  const config = makeConfig()
  const cache = new ToolResultCache(null, config)
  const gateway = policy
    ? new ToolGateway(registry as any, {} as any, cache, config, audit as any, policy as any)
    : new ToolGateway(registry as any, {} as any, cache, config, audit as any)
  return { gateway, registry, audit }
}

describe('ToolGateway 策略门（S3.1+S3.2）', () => {
  it('外部 PDP deny → 拦截，不打 registry，落 POLICY_DENIED 审计', async () => {
    const { gateway, registry, audit } = makeGateway({
      check: async () => ({ decision: 'deny', reason: 'blocked', source: 'external' }),
    })

    const res = await gateway.execute('data_export', {}, { workspaceId: 'ws1', userId: 'u1' })

    expect(res.ok).toBe(false)
    expect(res.error).toBe('policy_denied')
    expect(registry.calls).toEqual([])
    expect(audit.records).toHaveLength(1)
    expect(audit.records[0].summary).toContain('POLICY_DENIED')
  })

  it('内置删除兜底：删除工具被评 low → requireConfirm（不打 registry）', async () => {
    const { gateway, registry } = makeGateway()

    const res = await gateway.execute('form_delete', { token: 't', formId: 'f1' }, { workspaceId: 'ws1' })

    expect(res.confirmRequired).toBe(true)
    expect(res.summary).toContain('policy: delete-tool')
    expect(registry.calls).toEqual([])
  })

  it('敏感字段 → warn：照常执行，审计带 note=pii_access', async () => {
    const { gateway, registry, audit } = makeGateway()

    const res = await gateway.execute(
      'data_query',
      { token: 't', fields: ['email', 'name'] },
      { workspaceId: 'ws1' },
    )

    expect(res.ok).toBe(true)
    expect(registry.calls).toEqual(['data_query'])
    expect(audit.records[0].note).toBe('pii_access')
  })

  it('legacy 5 参构造（无策略服务）：低风险工具照常执行、不落额外审计', async () => {
    const { gateway, registry, audit } = makeGateway()

    const res = await gateway.execute('data_query', { token: 't', q: 'x' }, { workspaceId: 'ws1' })

    expect(res).toEqual({ ok: true, summary: 'ok', result: { v: 1 } })
    expect(registry.calls).toEqual(['data_query'])
    expect(audit.records).toHaveLength(1)
  })

  it('executeConfirmed：外部 deny 也拦（不再放行）', async () => {
    const { gateway, registry } = makeGateway({
      check: async () => ({ decision: 'deny', reason: 'blocked', source: 'external' }),
    })

    const res = await gateway.executeConfirmed('data_export', {}, { workspaceId: 'ws1' })

    expect(res.ok).toBe(false)
    expect(res.error).toBe('policy_denied')
    expect(registry.calls).toEqual([])
  })
})
