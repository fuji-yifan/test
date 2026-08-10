import { Injectable, Logger } from '@nestjs/common'
import { LlmStreamService } from '../../llm/llm.stream'
import { ToolRegistry } from '../../harness/tool.registry'
import { ToolGateway } from '../../harness/tool-gateway'
import { SessionService } from '../../session/session.service'
import { HubStateBar } from '../../hub/hub.state-bar'
import { SkillsLoader } from '../../harness/skills.loader'
import { ContextService } from '../../context/context.service'
import { AgentSession } from '../../session/session.store'
import { BaseAgent, AgentConfig } from '../base.agent'
import { GatewayResult } from '../../harness/tool-gateway'
import { formDesignerPrompt } from './form-designer.prompt'

@Injectable()
export class FormDesignerAgent extends BaseAgent {
  protected readonly logger = new Logger(FormDesignerAgent.name)
  protected readonly config: AgentConfig = {
    name: 'Form Designer Agent',
    toolNames: [
      'form_search_field_pool', 'form_assemble_schema',
      'form_validate_schema', 'form_preview', 'form_save',
    ],
    maxIterations: parseInt(process.env.MAX_ITERATIONS || '8', 10),
    maxRetries: parseInt(process.env.MAX_RETRIES || '2', 10),
    maxDegrades: parseInt(process.env.MAX_DEGRADE || '1', 10),
  }

  constructor(
    llmStream: LlmStreamService,
    toolRegistry: ToolRegistry,
    toolGateway: ToolGateway,
    sessionService: SessionService,
    stateBar: HubStateBar,
    skillsLoader: SkillsLoader,
    private contextService: ContextService,
  ) {
    super(llmStream, toolRegistry, toolGateway, sessionService, stateBar, skillsLoader)
  }

  protected buildSystemPrompt(session: AgentSession): string {
    const skillMeta = this.skillsLoader.getAllMeta()
    const skillFull = this.skillsLoader.loadFull(this.config.name)
    return formDesignerPrompt({
      workspaceId: session.workspaceId,
      userId: session.userId,
      skillMetas: skillMeta,
      skillFull: skillFull || undefined,
    })
  }

  protected getServerTools(): string[] {
    return ['form_save', 'form_preview']
  }

  protected async onToolSuccess(
    session: AgentSession,
    toolName: string,
    result: GatewayResult,
  ): Promise<void> {
    const updates: Record<string, unknown> = {}

    if (toolName === 'form_validate_schema' && result.ok) {
      updates.draftValidation = result.result
    }
    if (toolName === 'form_assemble_schema' && result.ok && (result.result as any)?.schema) {
      updates.draftSchema = (result.result as any).schema
    }
    if (toolName === 'form_save' && result.ok && (result.result as any)?.formId) {
      updates.savedFormId = (result.result as any).formId
    }

    if (Object.keys(updates).length > 0) {
      await this.sessionService.updateMetadata(session.id, updates)
    }
  }

  protected extractResultJSON(fullContent: string, session: AgentSession): unknown {
    const draftSchema = session.metadata?.draftSchema
    const savedFormId = session.metadata?.savedFormId
    if (draftSchema) {
      return { schema: draftSchema, formId: savedFormId || undefined }
    }
    const jsonMatch = fullContent.match(/\{[\s\S]*"schema"[\s\S]*\}/)
    if (jsonMatch) {
      try { return JSON.parse(jsonMatch[0]) } catch { /* skip */ }
    }
    return undefined
  }
}
