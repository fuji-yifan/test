import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createHash, randomBytes } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import { postJson } from './http'

/** 一个进行中的 span 句柄；由 `startSpan` 造、`endSpan` 收口。 */
export interface SpanHandle {
  name: string
  /** 与工具审计**同源**的 traceId（创建时已规范化为 32-hex，见 `normalizeTraceId`） */
  traceId: string
  /** 16 位十六进制 */
  spanId: string
  /** 纳秒时间戳（字符串，BigInt 防精度丢失） */
  startTimeUnixNano: string
  attributes: Record<string, unknown>
  /** 父 span（整轮 root）；root 自身无此字段 */
  parentSpanId?: string
}

/** 一轮请求内共享的追踪上下文（AsyncLocalStorage 存储） */
interface TurnContext {
  traceId: string
  userId?: string
  sessionId?: string
  /** 整轮 root span 的 id；其后创建的 span 都挂它当父 */
  parentSpanId?: string
}

/** 模块级（单例共享）：整轮入口 `runInTurn` 铺开，轮内 `startSpan`/`currentTraceId` 自动读取 */
const turnContext = new AsyncLocalStorage<TurnContext>()

/** Langfuse OTLP 认的列属性键（集中定义，便于一处调整） */
const LANGFUSE_USER_KEY = 'langfuse.user.id'
const LANGFUSE_SESSION_KEY = 'langfuse.session.id'

/** 整轮 root span 的默认名：Langfuse 里一轮请求 = 一棵以它为根的 trace 树 */
export const TURN_SPAN_NAME = 'agent.turn'

export interface SpanEnd {
  ok: boolean
  durationMs: number
  error?: string
}

/**
 * 链路追踪适配器（阶段 6 / S2.3）。
 *
 * 两条职责，**分开看**：
 * 1. **traceId 恒贯通**（不依赖任何基建）：`currentTraceId(requestId?)` 恒返回一个 32-hex
 *    （轮上下文优先，否则由 requestId 确定性派生），供工具审计与 span 复用它、串联同一轮里的所有记录。
 * 2. **可选 OTLP 导出**（env-gated）：配了 `OTEL_EXPORTER_OTLP_ENDPOINT` 或 `LANGFUSE_HOST`
 *    才在每个 span 结束时**一次 fire-and-forget POST**（OTLP/HTTP JSON）到 `${endpoint}/v1/traces`；
 *    未配置 → `endSpan` **直接返回、零外呼**。
 *
 * **刻意不做完整 OTel SDK**：不引依赖、不做批量/采样/gRPC/自动埋点。spans 一次一个 POST、
 * 带超时、失败只 `warnOnce`，**永不阻塞或影响关键路径**。
 */
@Injectable()
export class TracingService {
  private readonly logger = new Logger(TracingService.name)
  private readonly enabled: boolean
  private readonly endpoint?: string
  private readonly serviceName: string
  private readonly timeoutMs: number
  private readonly authHeader?: string
  private warned = false

  constructor(private readonly config: ConfigService) {
    const otlp = (config.get<string>('infra.otlpEndpoint') || '').trim()
    const langfuse = (config.get<string>('infra.langfuseHost') || '').trim()
    const tracingOn = config.get<boolean>('infra.tracingEnabled') !== false
    this.endpoint = otlp
      ? `${otlp.replace(/\/+$/, '')}/v1/traces`
      : langfuse
        ? `${langfuse.replace(/\/+$/, '')}/api/public/otel/v1/traces`
        : undefined
    this.enabled = tracingOn && !!this.endpoint
    this.serviceName = config.get<string>('infra.serviceName') || 'furmx-agent'
    this.timeoutMs = config.get<number>('infra.tracingTimeoutMs') ?? 2000
    // Langfuse 直连鉴权：public/secret key 均非空时启用 Basic Auth（两者缺一即不带，保持兼容）
    const pk = (config.get<string>('infra.langfusePublicKey') || '').trim()
    const sk = (config.get<string>('infra.langfuseSecretKey') || '').trim()
    this.authHeader =
      pk && sk ? `Basic ${Buffer.from(`${pk}:${sk}`).toString('base64')}` : undefined
  }

  /** 是否已启用 OTLP 导出（供上层短路判断 / 日志）。 */
  get isEnabled(): boolean {
    return this.enabled
  }

  /**
   * 当前轮次的 traceId。**恒有值**（禁用导出时也可用），且**恒为 32 位 hex**（OTLP 要求）：
   * 处于某一轮上下文（`runInTurn`）内 → 该轮统一 traceId；否则有 `requestId` 则确定性派生
   * （与工具审计同源），否则新造随机 32-hex。
   */
  currentTraceId(requestId?: string): string {
    return turnContext.getStore()?.traceId ?? normalizeTraceId(requestId)
  }

  /**
   * 在「一整轮」的追踪上下文里跑 `fn`：期间的 span 共享 traceId、挂在同一个 root span 下，
   * 并自动带上 `langfuse.user.id` / `langfuse.session.id`。异步上下文经 await/生成器透传。
   *
   * root span 在 `fn` 落定后收口（正常 ok / 异常 error）；导出未配即零外呼。
   */
  async runInTurn<T>(
    ctx: { requestId?: string; userId?: string; sessionId?: string; name?: string },
    fn: () => Promise<T>,
  ): Promise<T> {
    const traceId = normalizeTraceId(ctx.requestId)
    const store: TurnContext = { traceId, userId: ctx.userId, sessionId: ctx.sessionId }
    return turnContext.run(store, async () => {
      // 先建 root，再把它的 id 写回 store —— 之后创建的 span 才会认它当父（root 自己无父）。
      const root = this.startSpan(ctx.name ?? TURN_SPAN_NAME, traceId)
      store.parentSpanId = root.spanId
      const startedAt = Date.now()
      try {
        const out = await fn()
        void this.endSpan(root, { ok: true, durationMs: Date.now() - startedAt }).catch(() => {})
        return out
      } catch (err) {
        void this.endSpan(root, {
          ok: false,
          durationMs: Date.now() - startedAt,
          error: (err as Error)?.message,
        }).catch(() => {})
        throw err
      }
    })
  }

  /**
   * 开一个 span（恒成功、零外呼）。`traceId` 由调用方传入以与审计同源。
   * 处于轮次上下文时自动补 user/session 属性，并记下父 span。
   */
  startSpan(name: string, traceId: string, attributes: Record<string, unknown> = {}): SpanHandle {
    const ctx = turnContext.getStore()
    const attrs: Record<string, unknown> = { ...attributes }
    if (ctx?.userId) attrs[LANGFUSE_USER_KEY] = ctx.userId
    if (ctx?.sessionId) attrs[LANGFUSE_SESSION_KEY] = ctx.sessionId
    return {
      name,
      traceId,
      spanId: randomBytes(8).toString('hex'),
      startTimeUnixNano: nanos(),
      attributes: attrs,
      // 创建时快照：root 建时 store.parentSpanId 尚为空 → root 无父，符合 OTLP 语义
      parentSpanId: ctx?.parentSpanId,
    }
  }

  /**
   * 收口 span。未启用导出 → **直接返回、零外呼**；启用 → 一次 fire-and-forget POST。
   */
  async endSpan(span: SpanHandle, end: SpanEnd): Promise<void> {
    if (!this.enabled || !this.endpoint) return
    const body = this.buildOtlpBody(span, end)
    const res = await postJson(this.endpoint, body, this.timeoutMs, {
      ...(this.authHeader ? { authorization: this.authHeader } : {}),
    })
    if (!res || res.status < 200 || res.status >= 300) this.warnOnce(res?.status)
  }

  /** OTLP/HTTP JSON（resourceSpans[].scopeSpans[].spans[]）。 */
  private buildOtlpBody(span: SpanHandle, end: SpanEnd): unknown {
    const attrs = Object.entries(span.attributes)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => ({ key: k, value: { stringValue: String(v) } }))
    if (end.error) attrs.push({ key: 'error', value: { stringValue: end.error } })
    attrs.push({ key: 'duration_ms', value: { stringValue: String(end.durationMs) } })

    return {
      resourceSpans: [
        {
          resource: {
            attributes: [{ key: 'service.name', value: { stringValue: this.serviceName } }],
          },
          scopeSpans: [
            {
              scope: { name: 'furmx-agent' },
              spans: [
                {
                  traceId: normalizeTraceId(span.traceId),
                  spanId: span.spanId,
                  ...(span.parentSpanId ? { parentSpanId: span.parentSpanId } : {}),
                  name: span.name,
                  kind: 1, // SPAN_KIND_INTERNAL
                  startTimeUnixNano: span.startTimeUnixNano,
                  endTimeUnixNano: nanos(),
                  attributes: attrs,
                  status: end.ok ? { code: 1 } : { code: 2, message: end.error || 'error' },
                },
              ],
            },
          ],
        },
      ],
    }
  }

  private warnOnce(status?: number): void {
    if (this.warned) return
    this.warned = true
    this.logger.warn(
      `追踪导出失败（${status ? `http-${status}` : 'unreachable'}），后续静默：${this.endpoint}`,
    )
  }
}

/**
 * 把任意标识规范成 **32 位小写 hex** 的 traceId（OTLP 硬性要求）。
 *
 * - 已是 32-hex → 原样（幂等）；
 * - 其它非空串（如 uuid / nanoid / 业务 requestId）→ `sha256` 前 32 位，**确定性**（同一 requestId 恒得同一 traceId，便于审计与 span 同源比对）；
 * - 空 → 随机 32-hex。
 *
 * 导出供 tool-gateway 的审计兜底复用，保证全局只有一处生成逻辑。
 */
export function normalizeTraceId(input?: string): string {
  const s = (input || '').trim()
  if (/^[0-9a-f]{32}$/i.test(s)) return s.toLowerCase()
  if (s) return createHash('sha256').update(s).digest('hex').slice(0, 32)
  return randomBytes(16).toString('hex')
}

/** 当前时间 → 纳秒字符串（BigInt 防 Number 精度丢失）。 */
function nanos(): string {
  return (BigInt(Date.now()) * 1_000_000n).toString()
}
