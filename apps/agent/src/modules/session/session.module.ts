import { Module } from '@nestjs/common'
import { SessionStore } from './session.store'
import { SessionService } from './session.service'

@Module({
  providers: [SessionStore, SessionService],
  exports: [SessionStore, SessionService],
})
export class SessionModule {}
