import { Module } from '@nestjs/common'
import { AgentGraphModule } from '../graph/graph.module'
import { SessionModule } from '../session/session.module'
import { HubService } from './hub.service'
import { HubStateBar } from './hub.state-bar'
import { LangGraphTurnService } from './langgraph-turn.service'

@Module({
  imports: [SessionModule, AgentGraphModule],
  providers: [HubService, HubStateBar, LangGraphTurnService],
  exports: [HubService, HubStateBar, LangGraphTurnService],
})
export class HubModule {}
