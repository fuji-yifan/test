/**
 * 把现有的 @Tool 注册表桥接成 LangChain 工具，供 LangGraph 节点使用。
 *
 * 分层不变：
 *   LangGraph 节点 → LangChainToolBridge → ToolGateway（幂等/风险/确认/审计）
 *                                       → ToolRegistry.call()（fixupArgs + zod 校验 + execute）
 * 也就是「图编排」只替换推理循环，工具侧的权限与校验语义完全复用。
 *
 * 关键设计：schema 传注册表预计算好的 JSON Schema（而非 zod schema）。
 * LangChain 对 JSON Schema 不做输入校验（见 @langchain/core DynamicStructuredTool
 * 文档：“The tool will not validate input if JSON schema is passed”），
 * 因此 ToolRegistry.call() 里的 fixupArgs + passthrough() 校验链路保持原样 ——
 * 这正是 DeepSeek 拍平参数等场景赖以修复的地方；若这里传 zod，非法参数会在
 * 进网关之前就被 LangChain 拒掉，丢失修复能力。
 */
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { tool, type StructuredToolInterface } from '@langchain/core/tools'
import { ToolRegistry } from '../harness/tool.registry'
import { ToolGateway, type GatewayResult } from '../harness/tool-gateway'
import { ToolConfirmationRequiredError } from './tool-confirmation.error'
import { charsForTokens } from './conversation-state'
import { entryOf, targetKeyOf, type FormWorksheet, type TargetResolution } from './worksheet'

/**
 * 摘要化的单字段阈值（阶段 4 / 4.3）：某个值序列化后超过这个字符数，判为「大字段」，
 * 无更小可丢子孙时整块替换成占位符（典型：template_search 每份模板的整份 schema）。
 */
const SUMMARY_FIELD_CHARS = 800

/** 单次图执行的会话上下文：token / 工作空间 / 草稿等由 act 节点按本次调用填进来 */
export interface ToolCallContext {
  userToken?: string
  workspaceId?: string
  userId?: string
  savedFormId?: string
  /** 当前会话已有的表单结构（form-designer 草稿），供 form_assemble_schema 合并 */
  currentSchema?: Record<string, unknown>
  /**
   * 会话级表单工作台。**undefined 时不启用工作台**（非表单 agent / 单测直连），
   * 退回单槽草稿行为。由 act 从图状态填进来。
   */
  formWorksheet?: FormWorksheet
  /**
   * 本次调用的目标解析结果（act 节点按 `args.target` + 工作台算出）。
   *
   * 关键：注入什么由**本次调用的目标**决定，而不是由「会话里有什么」决定 ——
   * 后者会让「做一张新表」也被灌上旧表、让 form_save 静默覆盖上一张表。
   */
  formTarget?: TargetResolution | null
}

@Injectable()
export class LangChainToolBridge {
  private readonly logger = new Logger(LangChainToolBridge.name)

  constructor(
    private readonly registry: ToolRegistry,
    private readonly gateway: ToolGateway,
    private readonly config: ConfigService,
  ) {}

  /**
   * 按名字构建 LangChain 工具列表；未注册的名字告警并跳过。
   * 传入的 names 应取自 `AgentSpec.serverTools`（agent-catalog）。
   */
  build(names: string[], ctx: ToolCallContext = {}): StructuredToolInterface[] {
    const tools: StructuredToolInterface[] = []
    for (const name of names) {
      const t = this.buildOne(name, ctx)
      if (t) tools.push(t)
    }
    return tools
  }

  buildOne(name: string, ctx: ToolCallContext = {}): StructuredToolInterface | undefined {
    const meta = this.registry.get(name)
    if (!meta) {
      this.logger.warn(`工具未注册，跳过桥接：${name}`)
      return undefined
    }

    return tool(
      // 注意：tool() 工厂会把实现包成 func(input, childConfig) 只传两个参数，
      // 第二个参数就是 LangGraph 的 ToolRuntime（config 的扩展），不是回调管理器。
      async (input: unknown, config?: unknown) => {
        const res = await this.run(name, (input ?? {}) as Record<string, unknown>, ctx, {
          requestId: resolveToolCallId(config),
        })
        return this.formatResult(res)
      },
      {
        name: meta.name,
        description: meta.description,
        // 传 JSON Schema 而非 zod：让 ToolRegistry.call() 负责参数修复与校验
        schema: meta.parameters as any,
      },
    )
  }

  /**
   * 结构化执行入口（图里的 act 节点用）。
   *
   * - confirmed=false：走完整网关（含确认门），若需要确认则抛 ToolConfirmationRequiredError；
   * - confirmed=true：用户已放行，跳过确认门直接执行。
   *
   * 返回原始 GatewayResult（不 JSON 化），因为图还需要用它抽产物。
   */
  async run(
    name: string,
    args: Record<string, unknown>,
    ctx: ToolCallContext = {},
    opts?: { requestId?: string; confirmed?: boolean },
  ): Promise<GatewayResult> {
    const finalArgs = this.injectContext(name, args, ctx, opts?.requestId)
    const gatewayOpts = {
      requestId: opts?.requestId,
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
    }

    if (opts?.confirmed) {
      return this.gateway.executeConfirmed(name, finalArgs, gatewayOpts)
    }

    const res = await this.gateway.execute(name, finalArgs, gatewayOpts)
    if (res.confirmRequired) {
      throw new ToolConfirmationRequiredError({
        tool: name,
        args: finalArgs,
        risk: res.risk ?? this.registry.getRisk(name),
        confirmCallId: res.confirmCallId ?? '',
        summary: res.summary ?? `Tool "${name}" requires confirmation`,
      })
    }
    return res
  }

  /** 该工具是否属于「需人工放行」的风险等级（与 ToolGateway 的判定一致） */
  needsConfirmation(name: string): boolean {
    return this.registry.getRisk(name) !== 'low'
  }

  /** 把 GatewayResult 格式化成喂给 LLM 的 tool 消息内容 */
  toToolMessageContent(res: GatewayResult): string {
    return this.formatResult(res)
  }

  /** 用户确认后重放工具（跳过确认门），返回与正常执行一致的 JSON 字符串 */
  async executeConfirmed(
    name: string,
    args: Record<string, unknown>,
    opts?: { requestId?: string; userId?: string; workspaceId?: string },
  ): Promise<string> {
    return this.formatResult(await this.gateway.executeConfirmed(name, args, opts))
  }

  // ==================== 内部方法 ====================

  /** 注入 token / workspaceId；表单工具按本次调用的**目标**补 existingSchema / formId */
  private injectContext(
    name: string,
    args: Record<string, unknown>,
    ctx: ToolCallContext,
    requestId?: string,
  ): Record<string, unknown> {
    const out = { ...args }
    out.token = ctx.userToken || ''
    out.workspaceId = ctx.workspaceId || ''

    // form_save 幂等键（阶段 3 切片 C）：把本次 tool_call id 作为 clientRequestId 透传到 server，
    // 由 server 的 idempotency_keys 唯一键去重（网关内存 Set 只对 risk!=='low' 生效，form_save 是 low）。
    if (name === 'form_save' && requestId) out.clientRequestId = requestId

    // 没有工作台（非表单 agent / 单测直连）：单槽行为
    if (!ctx.formWorksheet) {
      if (name === 'form_save' && !out.formId && ctx.savedFormId) out.formId = ctx.savedFormId
      if (name === 'form_assemble_schema' && !out.existingSchema && ctx.currentSchema) {
        out.existingSchema = ctx.currentSchema
      }
      return out
    }

    // 只有「命中已有表」（update/focus，以及先取首个的 ambiguous）才注入；
    // create 一律不注入 → 整表重建，这就是修掉「第二张新表被合并」的地方。
    const resolved = ctx.formTarget
    if (!resolved) return out
    if (resolved.kind === 'create') return out

    const target = entryOf(ctx.formWorksheet, targetKeyOf(resolved))

    if (name === 'form_assemble_schema' && !out.existingSchema && target) {
      // 模型在追问里常常只给新字段，工具据此按 key 合并，避免原有字段被整表覆盖
      out.existingSchema = target.schema
    }
    if (name === 'form_save' && !out.formId && target?.formId) {
      // 只有解析到「已落库的那张表」才把 formId 带上 → 修掉「保存表 A 后再建表 B，
      // B 静默覆盖 A」：B 是 create，永远拿不到 formId。
      out.formId = target.formId
    }
    return out
  }

  /** LLM 看到的工具结果是 ok/summary/data/error 的 JSON（超预算时摘要化/硬截） */
  private formatResult(res: GatewayResult): string {
    const payload = {
      ok: res.ok,
      summary: res.summary ?? (res.ok ? 'OK' : 'failed'),
      ...(res.result !== undefined ? { data: res.result } : {}),
      ...(res.error ? { error: res.error } : {}),
    }
    const full = JSON.stringify(payload)
    const budget = this.resultCharBudget()
    // 1) 在预算内：原样返回（绝大多数工具结果走这条）
    if (full.length <= budget) return full
    // 2) 超预算：摘要化 —— 丢掉大字段（如整份 schema），保住 id/name/desc/summary 等小字段
    const summarized = JSON.stringify(summarize(payload, SUMMARY_FIELD_CHARS))
    if (summarized.length <= budget) return summarized
    // 3) 仍超（大量小字段累加，摘要化无能为力）：头尾各留一半硬截兜底
    return this.truncate(summarized, budget)
  }

  /**
   * 工具结果进 LLM 视图的字符预算（阶段 4 / 4.3）。
   * 以 `context.maxToolResultTokens` 的 token 预算为准（CJK≈2 字符/token 近似），
   * 再用 `context.maxToolResultChars` 作绝对字符上限兜底 —— 取二者较小。
   * token 预算 ≤ 0 表示不设 token 预算，只用字符上限。
   */
  private resultCharBudget(): number {
    const tokens = this.config.get<number>('context.maxToolResultTokens') ?? 2000
    const hardCap = this.config.get<number>('context.maxToolResultChars') ?? 8000
    if (!Number.isFinite(tokens) || tokens <= 0) return hardCap
    return Math.min(charsForTokens(tokens), hardCap)
  }

  /**
   * 头尾各留一半硬截，控制进上下文的体积。
   *
   * 头尾都要留是因为 ok / summary 在头、往往最有用的切片在尾。
   * 只影响 LLM 看到的 ToolMessage —— SSE 的 `tool_result` 用的是网关的 summary，
   * 前端预览卡片的数据源是产物（artifact），都不经过这里。
   */
  private truncate(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text
    const half = Math.floor(maxChars / 2)
    return text.slice(0, half) + `\n... [truncated ${text.length - maxChars} chars] ...\n` + text.slice(-half)
  }
}

/** 序列化后长度（undefined/不可序列化 → 0） */
function jsonLen(value: unknown): number {
  return JSON.stringify(value)?.length ?? 0
}

/**
 * 摘要化（阶段 4 / 4.3，只作用于 LLM 视图）：
 * - 节点序列化 ≤ limitChars → 原样保留；
 * - 节点超限但有「更小的、可丢的子孙」（即子孙中也有超限者）→ 下钻递归，只丢里层大块；
 * - 节点超限且其子孙都不超限（terminal blob，如整份 schema）→ 整块替换成 `[omitted N chars]`。
 *
 * 这样 template_search 的 data → templates → 每条模板 会被逐层下钻，
 * 只把每条模板里的 `schema` 整块丢掉，而保住 id/name/description 等标量。
 */
function summarize(value: unknown, limitChars: number): unknown {
  if (jsonLen(value) <= limitChars) return value

  if (Array.isArray(value)) {
    return value.map((v) => summarize(v, limitChars))
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    const hasSmallerDroppable = entries.some(([, v]) => jsonLen(v) > limitChars)
    if (hasSmallerDroppable) {
      const out: Record<string, unknown> = {}
      for (const [k, v] of entries) out[k] = summarize(v, limitChars)
      return out
    }
  }
  return `[omitted ${jsonLen(value)} chars]`
}

/**
 * 取工具调用的 id 作为网关幂等键。
 * LangGraph ToolNode 构造 runtime 时写入 `toolCallId`；用 ToolCall 形态直接
 * invoke 时，invoke() 会把整个 ToolCall 塞进 `config.toolCall`。两者都兜住。
 */
function resolveToolCallId(config: unknown): string | undefined {
  const c = config as { toolCallId?: string; toolCall?: { id?: string } } | undefined
  return c?.toolCallId ?? c?.toolCall?.id
}
