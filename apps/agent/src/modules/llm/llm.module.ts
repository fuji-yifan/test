import { Global, Module } from '@nestjs/common'
import { LangGraphLlmService } from './langgraph-llm.service'

@Global()
@Module({
  providers: [LangGraphLlmService],
  exports: [LangGraphLlmService],
})
export class LlmModule {}
