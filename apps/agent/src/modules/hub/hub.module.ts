import { Module } from '@nestjs/common'
import { SessionModule } from '../session/session.module'
import { HubService } from './hub.service'
import { HubStateBar } from './hub.state-bar'

@Module({
  imports: [SessionModule],
  providers: [HubService, HubStateBar],
  exports: [HubService, HubStateBar],
})
export class HubModule {}
