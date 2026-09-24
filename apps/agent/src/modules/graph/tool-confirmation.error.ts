/**
 * 工具需要人工确认时抛出。
 *
 * 桥接层把 ToolGateway 的 `confirmRequired` 转成异常抛出，图节点捕获后
 * 调 LangGraph `interrupt()` 落一个 HITL 检查点（见 Phase 4）。
 * 之所以用抛异常而不是返回标记：LangChain tool 的返回值会被序列化进
 * ToolMessage 交给 LLM，确认请求不该被当作工具结果喂给模型。
 */
export type ToolRiskLevel = 'low' | 'medium' | 'high' | 'critical'

export class ToolConfirmationRequiredError extends Error {
  readonly tool: string
  readonly args: Record<string, unknown>
  readonly risk: ToolRiskLevel
  readonly confirmCallId: string
  readonly summary: string

  constructor(params: {
    tool: string
    args: Record<string, unknown>
    risk: ToolRiskLevel
    confirmCallId: string
    summary: string
  }) {
    super(params.summary)
    this.name = 'ToolConfirmationRequiredError'
    this.tool = params.tool
    this.args = params.args
    this.risk = params.risk
    this.confirmCallId = params.confirmCallId
    this.summary = params.summary
  }
}
