import { Module } from '@nestjs/common'
import { AgentGraphModule } from '../graph/graph.module'
import { SessionModule } from '../session/session.module'
import { LangGraphTurnService } from './langgraph-turn.service'

@Module({
  imports: [SessionModule, AgentGraphModule],
  providers: [LangGraphTurnService],
  exports: [LangGraphTurnService],
})
export class HubModule {}
