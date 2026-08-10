import { Injectable } from '@nestjs/common'
import { AgentSession } from '../session/session.store'

export interface StateBar {
  agent: string
  phase: string
  todo: { id: string; text: string; status: 'pending' | 'in_progress' | 'completed' | 'blocked' }[]
  products: { type: string; agent: string; status: string }[]
  pendingConfirms: number
  constraintChecks: { label: string; satisfied: boolean }[]
}

@Injectable()
export class HubStateBar {
  /** 代码确定性生成状态栏 XML */
  generate(session: AgentSession): StateBar {
    const messages = session.messages
    const metadata = session.metadata || {}

    // 统计工具调用
    const toolCalls = messages.filter((m) => m.role === 'tool')
    const toolStartCount = toolCalls.length

    // 统计产物
    const products: { type: string; agent: string; status: string }[] = []
    if (metadata.draftSchema) {
      const validated = metadata.draftValidation?.passed
      products.push({ type: 'FormSchema', agent: 'form-designer', status: validated ? 'validated' : 'draft' })
    }
    if (metadata.draftWorkflow) {
      products.push({ type: 'WorkflowDef', agent: 'workflow', status: 'draft' })
    }
    if (metadata.draftTemplate) {
      products.push({ type: 'Template', agent: 'template', status: 'draft' })
    }

    // 待确认项
    const pendingConfirms = metadata.pendingConfirms || []

    // 阶段推断
    let phase = 'idle'
    let agent = 'hub'
    if (metadata.activeSubAgent) {
      agent = metadata.activeSubAgent
      phase = metadata.phase || 'executing'
    }

    // 构建 TODO（从编排计划中读取，或从对话历史推断）
    const todo: StateBar['todo'] = []
    if (metadata.plan) {
      for (const step of metadata.plan.steps) {
        let status: 'pending' | 'in_progress' | 'completed' | 'blocked' = 'pending'
        if (step.id === metadata.currentStepId) status = 'in_progress'
        if (metadata.completedSteps?.includes(step.id)) status = 'completed'
        if (metadata.blockedSteps?.includes(step.id)) status = 'blocked'
        todo.push({ id: step.id, text: `${step.agent}: ${step.action}`, status })
      }
    }

    // 约束检查
    const constraintChecks = [
      {
        label: '高风险操作需人工确认',
        satisfied: pendingConfirms.length === 0 || metadata.lastConfirmAction !== undefined,
      },
      { label: 'Schema 已校验', satisfied: metadata.draftValidation?.passed !== false },
      { label: 'Token 预算正常', satisfied: (metadata.tokenUsage?.percentage || 0) < 90 },
    ]

    return {
      agent,
      phase,
      products,
      pendingConfirms,
      constraintChecks,
      todo,
    }
  }

  /** 生成注入 LLM 上下文的状态栏文本 */
  toContextString(state: StateBar): string {
    const productList = state.products.length > 0
      ? state.products.map((p) => `    - ${p.type} (${p.agent}): ${p.status}`).join('\n')
      : '    暂无'

    const todoList = state.todo.length > 0
      ? state.todo.map((t) => `    - [${t.status === 'in_progress' ? '●' : t.status === 'completed' ? '✓' : '○'}] ${t.text} (${t.status})`).join('\n')
      : '    暂无'

    const constraintList = state.constraintChecks
      .map((c) => `    - ${c.satisfied ? '✓' : '✗'} ${c.label}`)
      .join('\n')

    return `<agent_status>
- 当前阶段：${state.phase}
- 活跃 Sub-Agent：${state.agent}
- 本次会话产物：
${productList}
- 待确认项：${state.pendingConfirms} 项
- 约束检查：
${constraintList}
- TODO：
${todoList}
</agent_status>`
  }
}
