import { Global, Module } from '@nestjs/common'
import { LlmClient } from './llm.client'
import { LlmStreamService } from './llm.stream'

@Global()
@Module({
  providers: [LlmClient, LlmStreamService],
  exports: [LlmClient, LlmStreamService],
})
export class LlmModule {}
