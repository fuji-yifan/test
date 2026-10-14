import { Module } from '@nestjs/common'
import { AgentGraphModule } from '../graph/graph.module'
import { SessionModule } from '../session/session.module'
import { MemoryModule } from '../memory/memory.module'
import { LangGraphTurnService } from './langgraph-turn.service'

@Module({
  imports: [SessionModule, AgentGraphModule, MemoryModule],
  providers: [LangGraphTurnService],
  exports: [LangGraphTurnService],
})
export class HubModule {}
