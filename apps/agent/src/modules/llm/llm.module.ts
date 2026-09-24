import { Global, Module } from '@nestjs/common'
import { LlmClient } from './llm.client'
import { LlmStreamService } from './llm.stream'
import { LangGraphLlmService } from './langgraph-llm.service'

@Global()
@Module({
  providers: [LlmClient, LlmStreamService, LangGraphLlmService],
  exports: [LlmClient, LlmStreamService, LangGraphLlmService],
})
export class LlmModule {}
