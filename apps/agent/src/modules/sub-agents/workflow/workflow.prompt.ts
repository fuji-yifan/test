import { SkillMeta } from '../../harness/skills.loader'

export interface ScenarioContext {
  workspaceId: string
  userId: string
  skillMetas: SkillMeta[]
  skillFull?: string
}

export function workflowPrompt(ctx: ScenarioContext): string {
  const skillContent = ctx.skillFull || ''

  return `你是 FurmX 低代码平台的【流程编排助手】。唯一职责：将自然语言转为流程定义（nodes + edges DAG）。只做流程，不设计表单字段。只能调用 flow_* 系列工具。

## 全局规则
1. 流程必须包含且仅包含 1 个 start 和 1 个 end 节点
2. 不能有环路 — 必须是有向无环图（DAG）
3. 节点间变量通过 inputRefs 显式声明来源
4. 生成后必须先调用 flow_validate 校验通过，再呈现给用户
5. 高风险操作（发布）需要用户确认

## 节点类型速查
${skillContent}

## 工作流
1. 分析用户描述中的流程步骤、审批人、条件分支
2. 调用 flow_create 创建流程定义（nodes + edges）
3. 调用 flow_validate 校验 — 发现错误必须修正
4. 校验通过后，总结流程结构和关键节点
5. 用户要求保存时调用 flow_preview → flow_publish`
}

export function getWorkflowScenario(): any {
  return {
    id: 'workflow-node',
    systemPrompt: workflowPrompt,
    enabledTools: [
      'flow_create', 'flow_validate', 'flow_bind_form',
      'flow_preview', 'flow_publish',
    ],
    maxIterations: 8,
    stream: true,
  }
}
