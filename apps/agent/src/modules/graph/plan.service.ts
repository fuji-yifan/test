/**
 * 计划推进：把 OrchestrationPlan 变成"下一步做什么"。
 *
 * 纯函数，不依赖 Nest/LLM，便于单测。legacy 的 HubService 里同一套逻辑是
 * 分散在 controller 循环里的，这里收敛成可测试的服务。
 */
import { Injectable } from '@nestjs/common'
import type { OrchestrationPlan, OrchestrationStep } from '../hub/hub.types'
import type { StepArtifact } from './agent-state'

export interface StepInput {
  /** 依赖的上游产物（已解析引用） */
  resolved: Record<string, unknown>
  /** 拼给 Sub-Agent 的一句话指令 */
  message: string
}

@Injectable()
export class PlanService {
  /** 当前步骤（全部依赖已完成、且自身未完成的第一步） */
  currentStep(plan: OrchestrationPlan | null, completedSteps: string[]): OrchestrationStep | null {
    if (!plan?.steps?.length) return null
    return (
      plan.steps.find(
        (s) => !completedSteps.includes(s.id) && s.dependsOn.every((d) => completedSteps.includes(d)),
      ) ?? null
    )
  }

  /** 计划是否已跑完（没有可执行的下一步了） */
  isDone(plan: OrchestrationPlan | null, completedSteps: string[]): boolean {
    if (!plan) return true
    return this.currentStep(plan, completedSteps) === null
  }

  /** 把步骤的 input 里的 $1.schema 这类引用解析成实际值 */
  resolveInput(step: OrchestrationStep, artifacts: Record<string, StepArtifact>): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(step.input ?? {})) {
      if (typeof value === 'string' && value.startsWith('$')) {
        out[key] = this.resolveRef(value, artifacts)
      } else {
        out[key] = value
      }
    }
    return out
  }

  /** 构造这一步交给 Sub-Agent 的用户指令 */
  buildStepInput(step: OrchestrationStep, artifacts: Record<string, StepArtifact>, originalMessage: string): StepInput {
    const resolved = this.resolveInput(step, artifacts)
    const parts: string[] = [`[步骤 ${step.id}] ${step.action}`]
    for (const [key, value] of Object.entries(resolved)) {
      if (key === 'query' || key === 'description') {
        parts.push(`${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
      } else if (value !== null && value !== undefined) {
        parts.push(`${key}: ${typeof value === 'object' ? JSON.stringify(value).slice(0, 2000) : String(value)}`)
      }
    }
    if (parts.length === 1) parts.push(originalMessage)
    return { resolved, message: parts.join('\n') }
  }

  /**
   * 这一步的输入「带引用、但引用全解析不出来」。
   *
   * 用来在推进计划时判定「上游产物没到位」：模板市场没搜到东西时，第一步不会登记
   * 产物，第二步的 $1.schema 就是 null —— 这一步没有输入可做，应当整步跳过。
   * 不跳的话下游 Agent 会拿着空引用照常执行，凭空造出一张跟请求无关的表。
   *
   * 判定用「全部解析不出来」而不是「有一个解析不出来」：input 里常混着
   * description 这种常量，只有引用整体落空才说明产物链断了。
   */
  hasUnresolvedRefs(step: OrchestrationStep, artifacts: Record<string, StepArtifact>): boolean {
    const refs = Object.values(step.input ?? {}).filter(
      (v): v is string => typeof v === 'string' && v.startsWith('$'),
    )
    if (refs.length === 0) return false
    return refs.every((r) => this.resolveRef(r, artifacts) == null)
  }

  /** 解析单个引用："$1.schema" / "$2" / "$1.nodes[0].id" 的简化形式 */
  resolveRef(ref: string, artifacts: Record<string, StepArtifact>): unknown {
    const parts = ref.replace(/^\$/, '').split('.')
    const stepId = parts[0]
    const artifact = artifacts[stepId]
    if (!artifact) return null
    if (parts.length === 1) return artifact.data
    let value: any = artifact.data
    for (let i = 1; i < parts.length; i++) {
      if (value == null) return null
      value = value[parts[i]]
    }
    return value
  }
}
