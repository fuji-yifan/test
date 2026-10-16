import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler'
import { APP_GUARD } from '@nestjs/core'
import { PassportModule } from '@nestjs/passport'
import { JwtModule } from '@nestjs/jwt'
import configuration, {
  auditConfig,
  cacheConfig,
  checkpointConfig,
  contextConfig,
  deepseekConfig,
  infraConfig,
  userMemoryConfig,
} from './config/configuration'

import { JwtAuthGuard } from './common/guards/jwt-auth.guard'
import { JwtStrategy } from './common/guards/jwt.strategy'

import { LlmModule } from './modules/llm/llm.module'
import { SessionModule } from './modules/session/session.module'
import { ToolsModule } from './modules/harness/tools.module'
import { HubModule } from './modules/hub/hub.module'
import { FormDesignerModule } from './modules/sub-agents/form-designer/form-designer.module'
import { WorkflowModule } from './modules/sub-agents/workflow/workflow.module'
import { TemplateModule } from './modules/sub-agents/template/template.module'
import { SubmissionModule } from './modules/sub-agents/submission/submission.module'
import { ContextModule } from './modules/context/context.module'
import { CheckpointModule } from './modules/graph/checkpoint.module'
import { AgentGraphModule } from './modules/graph/graph.module'
import { AgentCacheModule } from './modules/cache/cache.module'
import { InfraModule } from './modules/infra/infra.module'
import { MemoryModule } from './modules/memory/memory.module'

import { HubController } from './modules/hub/hub.controller'
import { HealthController } from './modules/health/health.controller'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [
        configuration,
        deepseekConfig,
        contextConfig,
        checkpointConfig,
        cacheConfig,
        userMemoryConfig,
        auditConfig,
        infraConfig,
      ],
      envFilePath: ['.env'],
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: parseInt(process.env.AGENT_RATE_LIMIT || '20', 10),
      },
    ]),
    PassportModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '7d' },
    }),
    LlmModule,
    SessionModule,
    ToolsModule,
    HubModule,
    FormDesignerModule,
    WorkflowModule,
    TemplateModule,
    SubmissionModule,
    ContextModule,
    CheckpointModule,
    AgentGraphModule,
    AgentCacheModule,
    InfraModule,
    // HubController 注册在本模块却直接注入 UserMemoryService（index 4）→ 必须由 AppModule 直接导入，
    // 少了它启动即 「Nest can't resolve dependencies of the HubController」（graph/hub 各自的 import 只覆盖它们自己）
    MemoryModule,
  ],
  controllers: [HubController, HealthController],
  providers: [
    JwtStrategy,
    JwtAuthGuard,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
