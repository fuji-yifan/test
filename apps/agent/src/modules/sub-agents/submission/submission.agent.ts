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
import { submissionPrompt } from './submission.prompt'

@Injectable()
export class SubmissionAgent extends BaseAgent {
  protected readonly logger = new Logger(SubmissionAgent.name)
  protected readonly config: AgentConfig = {
    name: 'Submission Agent',
    toolNames: ['data_list_forms', 'data_query', 'data_analyze'],
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

  protected buildSystemPrompt(_session: AgentSession): string {
    const skillMeta = this.skillsLoader.getAllMeta()
    const skillFull = this.skillsLoader.loadFull(this.config.name)
    return submissionPrompt({
      skillMetas: skillMeta,
      skillFull: skillFull || undefined,
    })
  }

  protected getServerTools(): string[] {
    return ['data_list_forms', 'data_query', 'data_analyze']
  }

  protected async onToolSuccess(
    session: AgentSession,
    toolName: string,
    result: GatewayResult,
  ): Promise<void> {
    if (toolName === 'data_analyze' && result.ok) {
      await this.sessionService.updateMetadata(session.id, {
        lastAnalysis: result.result,
      })
    }
  }

  /** 只读分析没有需要挂回消息的结构化产物（分析结果走 metadata.lastAnalysis） */
  protected extractResultJSON(_fullContent: string, _session: AgentSession): unknown {
    return undefined
  }
}
