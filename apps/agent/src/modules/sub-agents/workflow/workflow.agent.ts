import { Injectable, Logger } from '@nestjs/common'
import { LlmStreamService } from '../../llm/llm.stream'
import { ToolRegistry } from '../../harness/tool.registry'
import { ToolGateway } from '../../harness/tool-gateway'
import { SessionService } from '../../session/session.service'
import { HubStateBar } from '../../hub/hub.state-bar'
import { SkillsLoader } from '../../harness/skills.loader'
import { AgentSession } from '../../session/session.store'
import { BaseAgent, AgentConfig } from '../base.agent'
import { GatewayResult } from '../../harness/tool-gateway'
import { workflowPrompt } from './workflow.prompt'

@Injectable()
export class WorkflowAgent extends BaseAgent {
  protected readonly logger = new Logger(WorkflowAgent.name)
  protected readonly config: AgentConfig = {
    name: 'Workflow Agent',
    toolNames: [
      'flow_create', 'flow_validate', 'flow_bind_form',
      'flow_preview', 'flow_save',
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
  ) {
    super(llmStream, toolRegistry, toolGateway, sessionService, stateBar, skillsLoader)
  }

  protected buildSystemPrompt(session: AgentSession): string {
    const skillMeta = this.skillsLoader.getAllMeta()
    const skillFull = this.skillsLoader.loadFull(this.config.name)
    return workflowPrompt({
      workspaceId: session.workspaceId,
      userId: session.userId,
      skillMetas: skillMeta,
      skillFull: skillFull || undefined,
    })
  }

  protected getServerTools(): string[] {
    return ['flow_save', 'flow_bind_form']
  }

  protected async onToolSuccess(
    session: AgentSession,
    toolName: string,
    result: GatewayResult,
  ): Promise<void> {
    if (toolName === 'flow_create' && result.ok && (result.result as any)?.nodes) {
      await this.sessionService.updateMetadata(session.id, {
        draftWorkflow: result.result,
      })
    }
  }

  protected extractResultJSON(fullContent: string, _session: AgentSession): unknown {
    const jsonMatch = fullContent.match(/\{[\s\S]*"nodes"[\s\S]*"edges"[\s\S]*\}/)
    if (jsonMatch) {
      try { return JSON.parse(jsonMatch[0]) } catch { /* skip */ }
    }
    return undefined
  }
}
