import { Global, Module } from '@nestjs/common'
import { DiscoveryModule } from '@nestjs/core'
import { ToolRegistry } from './tool.registry'
import { ToolGateway } from './tool-gateway'
import { SkillsLoader } from './skills.loader'
import { SessionModule } from '../session/session.module'
import { AuditModule } from '../audit/audit.module'

@Global()
@Module({
  imports: [DiscoveryModule, SessionModule, AuditModule],
  providers: [ToolRegistry, ToolGateway, SkillsLoader],
  exports: [ToolRegistry, ToolGateway, SkillsLoader],
})
export class ToolsModule {}
