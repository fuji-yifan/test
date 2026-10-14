import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { randomBytes } from 'node:crypto'
import { postJson } from './http'

/** 一个进行中的 span 句柄；由 `startSpan` 造、`endSpan` 收口。 */
export interface SpanHandle {
  name: string
  /** 与工具审计**同源**的 traceId（原样透传，不重映射 —— 便于旁路比对） */
  traceId: string
  /** 16 位十六进制 */
  spanId: string
  /** 纳秒时间戳（字符串，BigInt 防精度丢失） */
  startTimeUnixNano: string
  attributes: Record<string, unknown>
}

export interface SpanEnd {
  ok: boolean
  durationMs: number
  error?: string
}

/**
 * 链路追踪适配器（阶段 6 / S2.3）。
 *
 * 两条职责，**分开看**：
 * 1. **traceId 恒贯通**（不依赖任何基建）：`currentTraceId(requestId?)` 恒返回一个 id
 *    （`requestId || tr_<hex>`），供工具审计与 span 复用它、串联同一轮里的所有记录。
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
  }

  /** 是否已启用 OTLP 导出（供上层短路判断 / 日志）。 */
  get isEnabled(): boolean {
    return this.enabled
  }

  /**
   * 当前轮次的 traceId。**恒有值**（禁用导出时也可用）：
   * 有 `requestId` 复用之（与工具审计同源），否则新造 `tr_<hex>`。
   */
  currentTraceId(requestId?: string): string {
    return requestId && requestId.trim() ? requestId : `tr_${randomBytes(6).toString('hex')}`
  }

  /** 开一个 span（恒成功、零外呼）。`traceId` 由调用方传入以与审计同源。 */
  startSpan(name: string, traceId: string, attributes: Record<string, unknown> = {}): SpanHandle {
    return {
      name,
      traceId,
      spanId: randomBytes(8).toString('hex'),
      startTimeUnixNano: nanos(),
      attributes,
    }
  }

  /**
   * 收口 span。未启用导出 → **直接返回、零外呼**；启用 → 一次 fire-and-forget POST。
   */
  async endSpan(span: SpanHandle, end: SpanEnd): Promise<void> {
    if (!this.enabled || !this.endpoint) return
    const body = this.buildOtlpBody(span, end)
    const res = await postJson(this.endpoint, body, this.timeoutMs)
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
                  traceId: span.traceId,
                  spanId: span.spanId,
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

/** 当前时间 → 纳秒字符串（BigInt 防 Number 精度丢失）。 */
function nanos(): string {
  return (BigInt(Date.now()) * 1_000_000n).toString()
}
