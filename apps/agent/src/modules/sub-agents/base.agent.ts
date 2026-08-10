import { Logger } from '@nestjs/common'
import { LlmStreamService } from '../llm/llm.stream'
import { ToolRegistry } from '../harness/tool.registry'
import { ToolGateway, GatewayResult } from '../harness/tool-gateway'
import { SessionService } from '../session/session.service'
import { HubStateBar } from '../hub/hub.state-bar'
import { SkillsLoader } from '../harness/skills.loader'
import { SseWriter, SseEventType } from '../../common/sse/sse.writer'
import { AgentSession } from '../session/session.store'
import { ToolDef } from '../llm/llm.types'

/**
 * 错误恢复级别（四级级联）
 */
enum RecoveryLevel {
  RETRY = 'retry',       // 同工具，LLM 修正参数重试
  DEGRADE = 'degrade',   // 同 Agent，尝试替代方案
  FALLBACK = 'fallback', // Hub-Agent 重新编排
  PASSTHROUGH = 'passthrough', // 原始错误透传给用户
}

/**
 * Sub-Agent 配置接口，子类在 constructor 中提供。
 */
export interface AgentConfig {
  name: string
  toolNames: string[]
  maxIterations: number
  maxRetries: number        // 同工具最多重试次数（文档: 2）
  maxDegrades: number       // 同 Agent 最多降级次数（文档: 1）
}

/**
 * Sub-Agent 上下文，传递给子类的钩子方法。
 */
export interface AgentContext {
  session: AgentSession
  sse: SseWriter
  signal?: AbortSignal
}

/**
 * 子类需要实现的钩子方法。
 */
export abstract class BaseAgent {
  protected abstract readonly logger: Logger
  protected abstract readonly config: AgentConfig

  constructor(
    protected llmStream: LlmStreamService,
    protected toolRegistry: ToolRegistry,
    protected toolGateway: ToolGateway,
    protected sessionService: SessionService,
    protected stateBar: HubStateBar,
    protected skillsLoader: SkillsLoader,
  ) {}

  /** 子类提供 system prompt 字符串 */
  protected abstract buildSystemPrompt(session: AgentSession): string

  /** 子类提供需要调 server API 的工具名称（注入 token + workspaceId） */
  protected abstract getServerTools(): string[]

  /** 子类在工具调用成功后更新 metadata（如保存 draftSchema） */
  protected abstract onToolSuccess(
    session: AgentSession,
    toolName: string,
    result: GatewayResult,
  ): Promise<void>

  /** 子类提取最终响应中的结构化产物 */
  protected abstract extractResultJSON(fullContent: string, session: AgentSession): unknown

  /**
   * 主运行入口：构建上下文 → ReAct 循环（含四级错误恢复） → 汇总
   */
  async run(
    session: AgentSession,
    userMessage: string,
    sse: SseWriter,
    signal?: AbortSignal,
  ): Promise<{ finalContent: string; toolCalls: number; usage: { inputTokens: number; outputTokens: number } }> {
    let totalInputTokens = 0
    let totalOutputTokens = 0
    let toolCallCount = 0

    // 加载 Skills
    const skillFull = this.skillsLoader.loadFull(this.config.name)

    // 构建 system prompt
    const systemPrompt = this.buildSystemPrompt(session)

    // 构建消息历史（清洗孤立的 tool 消息）
    const messages = this.buildMessages(session, systemPrompt, userMessage)

    // 估算输入 tokens
    totalInputTokens += Math.ceil(messages.reduce((acc, m) => acc + (m.content || '').length, 0) / 4)

    // 保存用户消息
    await this.sessionService.addMessage(session.id, { role: 'user', content: userMessage })

    // 获取工具列表
    const tools = this.toolRegistry.listByNames(this.config.toolNames)

    // SSE meta 事件
    sse.writeEvent(SseEventType.META, {
      model: this.llmStream.getModel(),
      requestId: this.nanoid(8),
      activeAgent: this.config.name,
      tools: tools.map((t) => t.name),
    })

    // === 错误恢复追踪 ===
    const toolErrorCount: Map<string, number> = new Map()
    let degradeCount = 0
    let currentRecoveryLevel: RecoveryLevel = RecoveryLevel.RETRY

    // === ReAct 循环 ===
    let iteration = 0
    let finalContent = ''

    while (iteration < this.config.maxIterations) {
      iteration++
      this.logger.log(`[${this.config.name}] ReAct iteration ${iteration}/${this.config.maxIterations}`)

      if (signal?.aborted) {
        sse.writeEvent(SseEventType.ERROR, { code: 'ABORTED', message: 'Client disconnected' })
        break
      }

      try {
        // LLM 调用（流式，含重试+熔断）
        let fullContent = ''
        let toolCallChunk: any = null

        for await (const chunk of this.llmStream.streamWithRetry({
          messages,
          tools,
          maxTokens: parseInt(process.env.MAX_OUTPUT_TOKENS || '2048', 10),
          signal,
        })) {
          if (chunk.type === 'delta' && chunk.delta) {
            fullContent += chunk.delta
            totalOutputTokens += Math.ceil(chunk.delta.length / 4)
            sse.writeEvent(SseEventType.DELTA, { content: chunk.delta })
          }
          if (chunk.type === 'tool_call' && chunk.toolCall) {
            toolCallChunk = chunk.toolCall
          }
        }

        // === 工具调用处理 ===
        if (toolCallChunk) {
          const result = await this.handleToolCall(
            toolCallChunk, session, messages, sse,
            toolCallCount, toolErrorCount, degradeCount,
          )

          if (result === 'break_confirm') break       // 等待用户确认
          if (result === 'degrade_triggered') {
            degradeCount++
            if (degradeCount > this.config.maxDegrades) {
              currentRecoveryLevel = RecoveryLevel.FALLBACK
              sse.writeEvent(SseEventType.ERROR, {
                code: 'FALLBACK',
                message: '当前 Agent 多次降级失败，建议切换方式或联系管理员',
              })
              break
            }
          }

          toolCallCount++
          // 重置错误计数（成功时）
          if (result === 'success') {
            const toolName = toolCallChunk.function?.name
            if (toolName) toolErrorCount.delete(toolName)
          }

          continue
        }

        // === 纯文本输出（最终回复） ===
        finalContent = fullContent
        const resultJSON = this.extractResultJSON(finalContent, session)

        sse.writeEvent(SseEventType.MESSAGE, {
          role: 'assistant',
          content: finalContent,
          result: resultJSON || undefined,
        })

        await this.sessionService.addMessage(session.id, {
          role: 'assistant',
          content: finalContent,
        })
        break
      } catch (err: any) {
        this.logger.error(`[${this.config.name}] iteration ${iteration} failed: ${err.message}`)

        // 熔断器 → passthrough
        if (err.name === 'CircuitBreakerOpenError') {
          sse.writeEvent(SseEventType.ERROR, {
            code: 'CIRCUIT_BREAKER',
            message: 'DeepSeek API 暂时不可用，请稍后重试',
          })
          break
        }

        // 达到最大迭代次数 → gracefulExit
        if (iteration >= this.config.maxIterations) {
          finalContent = this.gracefulExit(toolCallCount, session)
          sse.writeEvent(SseEventType.MESSAGE, { role: 'assistant', content: finalContent })
          break
        }

        // 非致命 → 继续循环重试
        sse.writeEvent(SseEventType.ERROR, {
          code: 'RETRYING',
          message: `第 ${iteration} 轮出错，正在重试: ${err.message}`,
        })
      }
    }

    // === done 事件 ===
    sse.writeEvent(SseEventType.DONE, {
      sessionId: session.id,
      stopReason: iteration >= this.config.maxIterations ? 'max_iterations' : 'completed',
      usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
    })

    return {
      finalContent,
      toolCalls: toolCallCount,
      usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
    }
  }

  /**
   * 处理单个工具调用（含确认门 + 四级错误恢复判断）
   * 返回值: 'success' | 'break_confirm' | 'degrade_triggered' | 'retry'
   */
  private async handleToolCall(
    toolCallChunk: any,
    session: AgentSession,
    messages: any[],
    sse: SseWriter,
    toolCallCount: number,
    toolErrorCount: Map<string, number>,
    degradeCount: number,
  ): Promise<'success' | 'break_confirm' | 'degrade_triggered' | 'retry'> {
    const toolCall = {
      id: toolCallChunk.id || `call_${this.nanoid()}`,
      type: 'function' as const,
      function: {
        name: toolCallChunk.function?.name || '',
        arguments: toolCallChunk.function?.arguments || '{}',
      },
    }

    // 解析参数
    let args: Record<string, unknown> = {}
    try {
      args = JSON.parse(toolCall.function.arguments)
    } catch {
      args = {}
    }

    // 注入 token + workspaceId（所有需要调 server API 的工具）
    if (this.getServerTools().includes(toolCall.function.name)) {
      args.token = session.metadata?.userToken || ''
      args.workspaceId = session.workspaceId || (session.metadata?.workspaceId as string) || ''
      // 自动注入已有表单 ID（修改已有表单时避免创建新表单）
      if (toolCall.function.name === 'form_save' && !args.formId && session.metadata?.savedFormId) {
        args.formId = session.metadata.savedFormId
      }
    }

    // SSE: tool_start
    sse.writeEvent(SseEventType.TOOL_START, {
      callId: toolCall.id,
      tool: toolCall.function.name,
      args,
    })

    // 通过工具网关执行（含幂等 + 审计）
    const gatewayResult = await this.toolGateway.execute(toolCall.function.name, args, {
      requestId: toolCall.id,
      userId: session.userId,
      workspaceId: session.workspaceId,
    })

    // === 确认门 ===
    if (gatewayResult.confirmRequired) {
      sse.writeEvent(SseEventType.CONFIRM_REQUIRED, {
        callId: gatewayResult.confirmCallId,
        tool: toolCall.function.name,
        risk: gatewayResult.risk || 'medium',
        summary: gatewayResult.summary || '',
      })

      messages.push({ role: 'assistant', content: null, tool_calls: [toolCall] })
      messages.push({
        role: 'tool',
        content: `[AWAITING_CONFIRMATION] ${gatewayResult.summary}`,
        tool_call_id: toolCall.id,
        name: toolCall.function.name,
      })

      await this.sessionService.updateMetadata(session.id, {
        pendingConfirms: [
          ...(session.metadata?.pendingConfirms || []),
          { callId: gatewayResult.confirmCallId, tool: toolCall.function.name, args, result: gatewayResult },
        ],
      })

      await this.sessionService.addMessage(session.id, {
        role: 'tool',
        content: `[AWAITING_CONFIRMATION] ${gatewayResult.summary}`,
        toolCalls: [toolCall],
        toolResults: [{ callId: toolCall.id, tool: toolCall.function.name, ok: true, summary: gatewayResult.summary || '' }],
      })

      return 'break_confirm'
    }

    // === 四级错误恢复判断 ===
    if (!gatewayResult.ok) {
      const toolName = toolCall.function.name
      const errorCount = (toolErrorCount.get(toolName) || 0) + 1
      toolErrorCount.set(toolName, errorCount)

      // 参数校验失败 → LLM 修正重试（allowed retries: maxRetries）
      if (gatewayResult.error === 'validation_error') {
        if (errorCount <= this.config.maxRetries) {
          // 注入错误到上下文，LLM 会自动修正
          const correctionHint = `工具 ${toolName} 参数校验失败：${gatewayResult.summary}。请修正参数后重试。`
          messages.push({ role: 'assistant', content: null, tool_calls: [toolCall] })
          messages.push({
            role: 'tool',
            content: correctionHint,
            tool_call_id: toolCall.id,
            name: toolName,
          })
          sse.writeEvent(SseEventType.ERROR, {
            code: 'RETRY',
            message: correctionHint,
          })
          return 'retry'
        }
        // 超过重试次数 → 降级
        sse.writeEvent(SseEventType.ERROR, {
          code: 'DEGRADE',
          message: `工具 ${toolName} 连续 ${errorCount} 次参数错误，尝试替代方案`,
        })
        // 注入降级提示到上下文
        messages.push({ role: 'assistant', content: null, tool_calls: [toolCall] })
        messages.push({
          role: 'tool',
          content: `[DEGRADE] ${toolName} 多次失败。请尝试其他方式完成用户需求，或者直接问用户需要什么。`,
          tool_call_id: toolCall.id,
          name: toolName,
        })
        return 'degrade_triggered'
      }

      // 执行错误 → 根据错误类型判断
      if (errorCount <= this.config.maxRetries) {
        const errorHint = `工具 ${toolName} 执行失败：${gatewayResult.summary}。请尝试其他方式。`
        messages.push({ role: 'assistant', content: null, tool_calls: [toolCall] })
        messages.push({ role: 'tool', content: errorHint, tool_call_id: toolCall.id, name: toolName })
        return 'retry'
      }
      return 'degrade_triggered'
    }

    // === 成功 ===
    const resultStr = JSON.stringify(gatewayResult.result || gatewayResult.summary)
    const truncated = this.llmStream.summarizeToolResult(
      resultStr,
      parseInt(process.env.MAX_TOOL_RESULT_CHARS || '8000', 10),
    )

    sse.writeEvent(SseEventType.TOOL_RESULT, {
      callId: toolCall.id,
      tool: toolCall.function.name,
      ok: true,
      summary: truncated,
    })

    messages.push({ role: 'assistant', content: null, tool_calls: [toolCall] })
    messages.push({
      role: 'tool',
      content: truncated,
      tool_call_id: toolCall.id,
      name: toolCall.function.name,
    })

    await this.sessionService.addMessage(session.id, {
      role: 'tool',
      content: truncated,
      toolCalls: [toolCall],
      toolResults: [{ callId: toolCall.id, tool: toolCall.function.name, ok: true, summary: truncated }],
    })

    // 子类钩子：更新 metadata
    await this.onToolSuccess(session, toolCall.function.name, gatewayResult)

    return 'success'
  }

  /** 构建消息历史（含状态栏注入） */
  private buildMessages(
    session: AgentSession,
    systemPrompt: string,
    userMessage: string,
  ): any[] {
    const rawHistory = session.messages.map((m) => ({
      role: m.role,
      content: m.content,
      ...(m.toolCalls?.length ? { tool_calls: m.toolCalls } : {}),
      ...(m.role === 'tool' && m.toolResults?.length
        ? { name: m.toolResults[0].tool, tool_call_id: m.toolResults[0].callId }
        : {}),
    }))

    // 清洗孤立的 tool 消息
    const cleanHistory: any[] = []
    for (const msg of rawHistory) {
      if (msg.role === 'tool') {
        if (cleanHistory.length === 0) continue
        const prev = cleanHistory[cleanHistory.length - 1]
        if (!prev.tool_calls || prev.tool_calls.length === 0) continue
      }
      cleanHistory.push(msg)
    }

    // 状态栏
    const state = this.stateBar.generate(session)
    const stateStr = this.stateBar.toContextString(state)

    return [
      { role: 'system', content: systemPrompt },
      ...cleanHistory,
      { role: 'user', content: `${stateStr}\n\n${userMessage}` },
    ]
  }

  /** gracefulExit: 达到 MAX_ITERATIONS 时返回部分结果 */
  private gracefulExit(toolCallCount: number, session: AgentSession): string {
    const completedItems: string[] = []
    if (session.metadata?.draftSchema) completedItems.push('FormSchema')
    if (session.metadata?.draftWorkflow) completedItems.push('WorkflowDef')
    if (session.metadata?.draftTemplate) completedItems.push('Template')
    if (session.metadata?.lastAnalysis) completedItems.push('Analysis')

    return `任务未完全完成（已执行 ${this.config.maxIterations} 轮），以下是当前进度：
- 工具调用次数: ${toolCallCount}
- 已生成产物: ${completedItems.length > 0 ? completedItems.join(', ') : '无'}
- 你可以回复"继续"来恢复执行`
  }

  protected nanoid(length = 8): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
    let result = ''
    for (let i = 0; i < length; i++) result += chars[Math.floor(Math.random() * chars.length)]
    return result
  }
}
