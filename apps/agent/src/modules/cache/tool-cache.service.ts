import { Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createHash } from 'node:crypto'
import type Redis from 'ioredis'
import { REDIS_CLIENT } from './redis.module'

/**
 * 只读工具白名单：命中缓存即短路返回、跳过 registry.call（阶段 4 / 4.5）。
 *
 * **必须显式列举**：风险等级无法区分读写（form_save 也是 low），靠 `risk==='low'` 会把
 * 写工具也缓存住。这些工具都只打 server HTTP 读接口。
 */
const READ_ONLY_TOOLS = new Set(['data_query', 'data_list_forms', 'template_search', 'template_get_detail'])

/** 写工具白名单：执行成功后失效本工作空间缓存（只失效、不写缓存）。 */
const WRITE_TOOLS = new Set(['form_save', 'template_instantiate', 'flow_save'])

/** 缓存值：只存回放只读工具所需的字段（GatewayResult 子集） */
export interface CachedToolResult {
  summary: string
  result: unknown
}

/**
 * 只读工具结果缓存（Redis）。REDIS_HOST 未设 / 未启用 → 全部方法 no-op（等于未引入缓存）。
 *
 * 键：`tool:<name>:<workspaceId>:<sha1(stableStringify(args 去 token))>`
 * - **必含 workspaceId**：防跨租户串数据；
 * - **去掉 token**：token 会轮换，且同工作空间内只读结果与调用者身份无关。
 */
@Injectable()
export class ToolResultCache {
  private readonly logger = new Logger(ToolResultCache.name)
  private readonly ttl: number
  private readonly ready: boolean
  private warned = false

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis | null,
    private readonly config: ConfigService,
  ) {
    this.ttl = config.get<number>('cache.ttlSeconds') ?? 60
    const enabled = config.get<boolean>('cache.enabled') ?? true
    this.ready = enabled && !!redis
  }

  isReadOnly(tool: string): boolean {
    return READ_ONLY_TOOLS.has(tool)
  }

  isWrite(tool: string): boolean {
    return WRITE_TOOLS.has(tool)
  }

  async get(tool: string, workspaceId: string, args: Record<string, unknown>): Promise<CachedToolResult | null> {
    if (!this.canUse(tool, workspaceId)) return null
    try {
      const raw = await this.redis!.get(this.keyOf(tool, workspaceId, args))
      return raw ? (JSON.parse(raw) as CachedToolResult) : null
    } catch (err) {
      this.warnOnce(err)
      return null
    }
  }

  async set(
    tool: string,
    workspaceId: string,
    args: Record<string, unknown>,
    value: CachedToolResult,
  ): Promise<void> {
    if (!this.canUse(tool, workspaceId)) return
    try {
      await this.redis!.set(this.keyOf(tool, workspaceId, args), JSON.stringify(value), 'EX', this.ttl)
    } catch (err) {
      this.warnOnce(err)
    }
  }

  /** 写工具成功后失效本工作空间下所有工具缓存（键空间小，用 keys 可接受；生产可换 SCAN）。 */
  async invalidateWorkspace(workspaceId: string): Promise<void> {
    if (!this.ready || !workspaceId) return
    try {
      const keys = await this.redis!.keys(`tool:*:${workspaceId}:*`)
      if (keys.length) await this.redis!.del(...keys)
    } catch (err) {
      this.warnOnce(err)
    }
  }

  // ==================== 内部 ====================

  private canUse(tool: string, workspaceId: string): boolean {
    return this.ready && !!workspaceId && this.isReadOnly(tool)
  }

  private keyOf(tool: string, workspaceId: string, args: Record<string, unknown>): string {
    const { token: _token, ...rest } = args
    const digest = createHash('sha1').update(stableStringify(rest)).digest('hex')
    return `tool:${tool}:${workspaceId}:${digest}`
  }

  private warnOnce(err: unknown): void {
    if (this.warned) return
    this.warned = true
    this.logger.warn(`Redis 缓存操作失败，后续静默：${(err as Error)?.message}`)
  }
}

/** 稳定序列化：对象键排序，保证同内容不同键序 → 同哈希 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const obj = value as Record<string, unknown>
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',')}}`
}
