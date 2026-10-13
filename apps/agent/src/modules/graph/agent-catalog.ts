/**
 * Agent 目录：把「每个领域 Agent 是什么」做成声明式数据。
 *
 * 新增一个 Agent = 在这里加一条 spec，父图/子图/路由/检查点全部自动接上，
 * 不需要改图的结构。HITL 检查点也在这里声明（见 CheckpointDef）。
 */
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common'
import { SkillsLoader } from '../harness/skills.loader'
import { ToolRegistry } from '../harness/tool.registry'
import { formDesignerPrompt } from '../sub-agents/form-designer/form-designer.prompt'
import { workflowPrompt } from '../sub-agents/workflow/workflow.prompt'
import { templatePrompt } from '../sub-agents/template/template.prompt'
import { submissionPrompt } from '../sub-agents/submission/submission.prompt'
import type { AgentKey, AgentStateType, StepArtifact } from './agent-state'
import {
  applyAssemble,
  compactEntry,
  markRestored,
  markSaved,
  toWorksheetBlock,
  type FormWorksheet,
  type TargetResolution,
} from './worksheet'

/** 人工检查点的答复动作 */
export type CheckpointAction = 'continue' | 'abort'

export interface CheckpointOption {
  value: CheckpointAction
  label: string
  style?: 'primary' | 'default' | 'danger'
}

/**
 * 声明式 HITL 检查点。
 *
 * 命中时机二选一：
 * - afterTool：某工具成功后。用来表达「产物已生成，问用户是否继续」。
 * - beforeTool：某工具执行前。用来表达「有副作用前先征求同意」。
 *
 * toolCallId 参与去重：同一个 tool_call 只会问一次；LLM 换了新的 tool_call
 * （比如用户让改一版再生成）就会再问一次 —— 这正是我们想要的语义。
 */
export interface CheckpointDef {
  id: string
  afterTool?: string
  beforeTool?: string
  /** 问题文案 */
  prompt: string
  options: CheckpointOption[]
  /** action=continue 是否同时充当该工具的「风险放行」，避免对同一调用问两遍 */
  coversRisk?: boolean
  /** 额外触发条件（读到当时的状态） */
  when?: (state: AgentStateType) => boolean
}

export interface AgentSpec {
  key: AgentKey
  /** 展示名（也用于 SkillsLoader 匹配 skill 文件名） */
  label: string
  /** 该 Agent 对应的前端页面 scenario */
  scenario: string
  /** 可用工具（必须都是已注册工具） */
  toolNames: string[]
  /** 需要注入 token/workspaceId 的工具 */
  serverTools: string[]
  maxIterations: number
  /** 构造 system prompt（复用 legacy 的 prompt 模块，保持人设一致） */
  systemPrompt: (ctx: {
    userId: string
    workspaceId: string
    skillMetas: ReturnType<SkillsLoader['getAllMeta']>
    skillFull?: string
  }) => string
  /** 从工具结果 / 最终文本里抽出该 Agent 的产物 */
  extractArtifact: (params: {
    toolName: string
    result: unknown
    state: AgentStateType
    /** 本次调用的目标解析结果（表单类工具才有，由 act 节点按 target 算出） */
    resolved?: TargetResolution
  }) => {
    draftUpdate?: StepArtifact
    metadata?: Record<string, unknown>
    /** 更新后的会话工作台（仅 form-designer 用）；由 act 写进 formWorksheet channel */
    worksheet?: FormWorksheet
    /**
     * 领域事实（手册 §2.12.3 Facts）：跨 Agent 交接用的**标量**键值，由 act 合并进
     * sessionFacts[agent]，再经 projectMemory 渲染进共享记忆块。只放标量（id/名称/计数）。
     */
    facts?: Record<string, unknown>
  } | null
  /**
   * 把「当前会话的产物」渲染成一段提示词（返回 null 表示不带），prepare 会贴到
   * system prompt 末尾。
   *
   * prepare 每轮都会重建 messages，只剩 system + 用户这一句话，所以模型看不见
   * 上一轮 tool_call 里的产物。form-designer 这里给的是**会话中的表清单**
   * （每张表的 key/标题/字段），让模型能分辨「改哪张、建哪张」，而不是凭记忆重造。
   */
  draftHint?: (ctx: { worksheet: FormWorksheet; draft: unknown }) => string | null
  checkpoints: CheckpointDef[]
}

const CONTINUE: CheckpointOption = { value: 'continue', label: '继续', style: 'primary' }
const ABORT: CheckpointOption = { value: 'abort', label: '中断', style: 'danger' }

/**
 * 工具结果里常见的「产物承载字段」。
 * 各工具返回结构不统一，这里做一次收敛，避免每个 Agent 重复写。
 */
function pick(obj: unknown, keys: string[]): Record<string, unknown> | null {
  if (!obj || typeof obj !== 'object') return null
  const src = obj as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const k of keys) if (src[k] !== undefined) out[k] = src[k]
  return Object.keys(out).length > 0 ? out : null
}

/** 收敛出「领域事实」：只留有值的标量，丢掉 undefined/空串/嵌套对象（避免大对象进记忆块） */
function compactFacts(src: Record<string, unknown>): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(src)) {
    if (v === undefined || v === null || v === '') continue
    if (typeof v === 'object') continue
    out[k] = v
  }
  return Object.keys(out).length > 0 ? out : undefined
}

@Injectable()
export class AgentCatalogService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AgentCatalogService.name)

  constructor(
    private readonly skillsLoader: SkillsLoader,
    private readonly registry: ToolRegistry,
  ) {}

  private cache?: AgentSpec[]
  /** 已告警过的未知场景，避免每个请求刷一条日志 */
  private readonly warnedScenarios = new Set<string>()

  list(): AgentSpec[] {
    if (!this.cache) this.cache = this.build()
    return this.cache
  }

  get(key: string): AgentSpec | undefined {
    return this.list().find((s) => s.key === key)
  }

  /** scenario -> AgentKey（前端页面决定默认身份） */
  agentByScenario(scenario: string): AgentKey {
    const hit = this.list().find((s) => s.scenario === scenario)
    if (hit) return hit.key
    // 前端页面 scenario 与 spec.scenario 不完全同名，这里补一张对照表。
    // 'general' 是前端的兜底页面场景（工作台首页、成员、设置等不属于任何领域的页），
    // 显式写出来，避免它靠 ?? 静默落到某个 Agent 上。
    const byLooking = {
      'general': 'form-designer',
      'form-builder': 'form-designer',
      'workflow-node': 'workflow',
      'template-creator': 'template',
      'data-analysis': 'submission',
    } as Record<string, AgentKey>
    const mapped = byLooking[scenario]
    if (!mapped) {
      // 前端新增/写错页面场景时，默认身份会静默落到 form-designer —— 症状是
      // 「某个页面助手不太对」而不是报错。这里喊一声，每个未知场景只喊一次。
      if (!this.warnedScenarios.has(scenario)) {
        this.warnedScenarios.add(scenario)
        this.logger.warn(`未知页面场景 "${scenario}"，默认身份落 form-designer`)
      }
      return 'form-designer'
    }
    return mapped
  }

  scenarioByAgent(key: AgentKey): string {
    return this.get(key)?.scenario ?? 'form-builder'
  }

  /** 声明里但未注册的工具 */
  missingToolNames(): { agent: AgentKey; tool: string }[] {
    const out: { agent: AgentKey; tool: string }[] = []
    for (const spec of this.list()) {
      for (const t of spec.toolNames) if (!this.registry.get(t)) out.push({ agent: spec.key, tool: t })
    }
    return out
  }

  /**
   * 启动时校验工具名。
   *
   * 声明里写错工具名不会报错：桥接层只会告警后跳过，模型看到少一个工具就用别的，
   * 症状是「某个能力莫名不生效」而不是启动失败。所以在启动时把它喊出来。
   */
  onApplicationBootstrap(): void {
    for (const { agent, tool } of this.missingToolNames()) {
      this.logger.warn(`Agent "${agent}" 声明的工具未注册，将被静默跳过：${tool}`)
    }
  }

  // ==================== 声明 ====================

  private build(): AgentSpec[] {
    const skills = this.skillsLoader
    return [
      {
        key: 'form-designer',
        label: 'Form Designer Agent',
        scenario: 'form-builder',
        toolNames: [
          'form_search_field_pool',
          'form_assemble_schema',
          'form_validate_schema',
          'form_preview',
          'form_save',
          'form_rollback',
        ],
        serverTools: ['form_preview', 'form_save', 'form_rollback'],
        maxIterations: 8,
        // 会话里有哪些表（key/标题/字段全列出），模型据此分辨「改哪张、建哪张」
        draftHint: ({ worksheet }) => toWorksheetBlock(worksheet),
        systemPrompt: (ctx) =>
          formDesignerPrompt({
            workspaceId: ctx.workspaceId,
            userId: ctx.userId,
            skillMetas: ctx.skillMetas,
            skillFull: ctx.skillFull,
          }),
        checkpoints: [
          {
            // 生成表单结构后先问「是否可行」。不要写"继续则进入预览"——点是 validate，
            // 不是预览（form_preview 根本没走），问了会误导用户。
            id: 'schema-review',
            afterTool: 'form_assemble_schema',
            prompt: '表单结构已生成，这个结构是否可行？',
            options: [CONTINUE, ABORT],
          },
          {
            // 用户要求：保存前问「是否加入当前空间」
            id: 'space-approval',
            beforeTool: 'form_save',
            prompt: '这个表单是否加入当前空间？',
            options: [
              { value: 'continue', label: '加入当前空间', style: 'primary' },
              { value: 'abort', label: '先不加入', style: 'danger' },
            ],
            coversRisk: true,
          },
          {
            // 回滚同样写库（追加新版本），执行前征求同意（阶段 5 / 5.5）
            id: 'rollback-approval',
            beforeTool: 'form_rollback',
            prompt: '确认把这张表单回滚到上一版？',
            options: [
              { value: 'continue', label: '确认回滚', style: 'primary' },
              { value: 'abort', label: '取消', style: 'danger' },
            ],
            coversRisk: true,
          },
        ],
        extractArtifact: ({ toolName, result, state, resolved }) => {
          if (toolName === 'form_assemble_schema') {
            const schema = (result as any)?.schema ?? pick(result, ['fields', 'settings', 'version'])
            if (!schema) return null
            const worksheet = resolved
              ? applyAssemble(state.formWorksheet, resolved, schema)
              : state.formWorksheet
            return {
              draftUpdate: { type: 'FormArtifact', data: { schema } },
              metadata: {
                draftSchema: schema,
                // 会话里有哪些表，随 metadata 一起回写，供 hub.artifact 拼多行预览
                draftForms: worksheet.forms.map(compactEntry),
              },
              worksheet,
            }
          }
          if (toolName === 'form_validate_schema') {
            return { metadata: { draftValidation: result } }
          }
          if (toolName === 'form_save') {
            const formId = (result as any)?.formId ?? (result as any)?.id
            const draft = state.drafts['form-designer']?.data?.schema
            const worksheet =
              resolved && formId ? markSaved(state.formWorksheet, resolved, formId) : state.formWorksheet
            return {
              draftUpdate: draft ? { type: 'FormArtifact', data: { schema: draft, formId } } : undefined,
              metadata: formId
                ? { savedFormId: formId, draftForms: worksheet.forms.map(compactEntry) }
                : undefined,
              worksheet,
            }
          }
          if (toolName === 'form_rollback') {
            // 回滚成功：把工作台里该表的 schema 换成回滚后的快照（savedSchema 同步换，
            // 否则下一次 form_save 的 diff 会把整场回滚当成大改动）。
            const schema = (result as any)?.schema
            if (!schema) return null
            const worksheet = resolved
              ? markRestored(state.formWorksheet, resolved, schema)
              : state.formWorksheet
            return {
              draftUpdate: { type: 'FormArtifact', data: { schema } },
              metadata: {
                draftSchema: schema,
                draftForms: worksheet.forms.map(compactEntry),
              },
              worksheet,
            }
          }
          return null
        },
      },
      {
        key: 'workflow',
        label: 'Workflow Agent',
        scenario: 'workflow-node',
        toolNames: ['flow_create', 'flow_validate', 'flow_bind_form', 'flow_preview', 'flow_save'],
        serverTools: ['flow_bind_form', 'flow_save'],
        maxIterations: 8,
        systemPrompt: (ctx) =>
          workflowPrompt({
            workspaceId: ctx.workspaceId,
            userId: ctx.userId,
            skillMetas: ctx.skillMetas,
            skillFull: ctx.skillFull,
          }),
        checkpoints: [
          {
            id: 'save-approval',
            beforeTool: 'flow_save',
            prompt: '流程定义已就绪，是否保存到当前工作空间？',
            options: [
              { value: 'continue', label: '保存', style: 'primary' },
              { value: 'abort', label: '先不保存', style: 'danger' },
            ],
            coversRisk: true,
          },
          {
            id: 'bind-form-approval',
            beforeTool: 'flow_bind_form',
            prompt: '要把表单绑定到这个流程节点上吗？',
            options: [CONTINUE, ABORT],
            coversRisk: true,
          },
        ],
        extractArtifact: ({ toolName, result }) => {
          if (toolName === 'flow_create' || toolName === 'flow_validate') {
            const data = pick(result, ['name', 'nodes', 'edges', 'bindings', 'validation'])
            if (!data?.nodes && !data?.edges) return null
            return {
              draftUpdate: { type: 'WorkflowArtifact', data },
              metadata: { draftWorkflow: data },
              facts: compactFacts({
                workflowName: data.name,
                nodes: Array.isArray(data.nodes) ? (data.nodes as unknown[]).length : undefined,
              }),
            }
          }
          if (toolName === 'flow_save') {
            const id = (result as any)?.id ?? (result as any)?.workflowId
            return {
              metadata: { savedWorkflowId: id },
              facts: compactFacts({ savedWorkflowId: id }),
            }
          }
          return null
        },
      },
      {
        key: 'template',
        label: 'Template Market Agent',
        scenario: 'template-creator',
        toolNames: ['template_search', 'template_get_detail', 'template_validate', 'template_instantiate'],
        serverTools: ['template_search', 'template_get_detail', 'template_instantiate'],
        maxIterations: 8,
        systemPrompt: (ctx) =>
          templatePrompt({ skillMetas: ctx.skillMetas, skillFull: ctx.skillFull }),
        checkpoints: [
          {
            id: 'instantiate-approval',
            beforeTool: 'template_instantiate',
            prompt: '要用这个模板生成一份新表单吗？',
            options: [
              { value: 'continue', label: '用这个模板', style: 'primary' },
              { value: 'abort', label: '再看看别的', style: 'danger' },
            ],
            coversRisk: true,
          },
        ],
        extractArtifact: ({ toolName, result }) => {
          // 搜索结果登记成产物：前端据此渲染「模板预览」多行清单（点开看表单结构）。
          // 用 draftTemplate 同一个槽位——实例化后会被 template_instantiate 的
          // {schema} 覆盖，正好完成「先看模板清单、选定后看生成结果」的过渡。
          if (toolName === 'template_search') {
            const templates = (result as any)?.templates
            if (!Array.isArray(templates) || templates.length === 0) return null
            return {
              draftUpdate: { type: 'TemplateListArtifact', data: { templates } },
              metadata: { draftTemplate: { templates } },
              facts: compactFacts({ templateCount: templates.length }),
            }
          }
          if (toolName === 'template_instantiate') {
            const data = pick(result, ['name', 'description', 'category', 'tags', 'schema', 'templateId'])
            if (!data) return null
            return {
              draftUpdate: { type: 'TemplateArtifact', data },
              metadata: { draftTemplate: data },
              facts: compactFacts({ templateId: data.templateId, templateName: data.name }),
            }
          }
          return null
        },
      },
      {
        key: 'submission',
        label: 'Submission Agent',
        scenario: 'data-analysis',
        // 只读分析：查表单 → 取聚合数据 → 统计分析。不提供任何写操作，
        // 因此也就没有写前的业务检查点（写路径已随审批辅助一起下线）。
        toolNames: ['data_list_forms', 'data_query', 'data_analyze'],
        serverTools: ['data_list_forms', 'data_query', 'data_analyze'],
        maxIterations: 8,
        systemPrompt: (ctx) => submissionPrompt({ skillMetas: ctx.skillMetas, skillFull: ctx.skillFull }),
        checkpoints: [],
        extractArtifact: ({ toolName, result }) => {
          if (toolName === 'data_query') {
            const total = (result as any)?.total
            return typeof total === 'number' ? { facts: compactFacts({ analyzedCount: total }) } : null
          }
          if (toolName === 'data_analyze') {
            const data = pick(result, ['summary', 'insights', 'trends', 'anomalies', 'chartSuggestions'])
            if (!data) return null
            return {
              draftUpdate: { type: 'AnalysisArtifact', data },
              metadata: { lastAnalysis: data },
              facts: compactFacts({
                insightCount: Array.isArray(data.insights) ? (data.insights as unknown[]).length : undefined,
              }),
            }
          }
          return null
        },
      },
    ]
  }
}
