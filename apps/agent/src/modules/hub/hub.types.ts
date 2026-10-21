// ==================== 共享产物契约类型 ====================

/** 表单设计产物 */
export interface FormArtifact {
  type: 'form-schema'
  schema: Record<string, unknown>
  fieldSemantics: Record<string, { label: string; type: string; domain: string }>
  validation: { passed: boolean; issues: ValidationIssue[] }
  stats: { fieldCount: number; requiredCount: number; groupCount: number }
}

/** 流程编排产物 */
export interface WorkflowArtifact {
  type: 'workflow-definition'
  nodes: unknown[]
  edges: unknown[]
  bindings: { nodeId: string; fieldKeys: string[]; upstreamNodeId?: string }[]
  validation: { isDAG: boolean; hasCycle: boolean; orphanNodes: string[] }
}

/** 模板产物 */
export interface TemplateArtifact {
  type: 'template'
  name: string
  description: string
  category: string
  tags: string[]
  schema: Record<string, unknown>
  derivedFrom?: string
}

/** 数据分析产物 */
export interface AnalysisArtifact {
  type: 'data-analysis'
  summary: string
  insights: { title: string; description: string; confidence: number }[]
  trends: { field: string; direction: 'up' | 'down' | 'stable'; magnitude: number }[]
  anomalies: { field: string; value: number; expected: number; zScore: number }[]
  chartSuggestions: { type: string; fields: string[]; title: string }[]
}

/** 编排步骤 */
export interface OrchestrationStep {
  id: string
  agent: 'form-designer' | 'workflow' | 'template' | 'submission'
  action: string
  input: Record<string, unknown>
  dependsOn: string[]
  expects: string
}

/** 编排计划 */
export interface OrchestrationPlan {
  planId: string
  description: string
  steps: OrchestrationStep[]
}

/** 校验问题 */
export interface ValidationIssue {
  field?: string
  path: string
  message: string
  severity: 'error' | 'warning'
}
