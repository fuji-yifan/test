import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { ConfigService } from '@nestjs/config'
import { ThrottlerModule } from '@nestjs/throttler'
import type Redis from 'ioredis'
import { ConfigModule } from './config/config.module'
import { PrismaModule } from './common/prisma.module'
import { RedisModule } from './common/redis.module'
import { MinioModule } from './common/minio.module'
import { CacheModule } from './modules/cache/cache.module'
import { MailModule } from './modules/mail/mail.module'
import { AuthModule } from './modules/auth/auth.module'
import { WorkspaceModule } from './modules/workspace/workspace.module'
import { FormModule } from './modules/form/form.module'
import { SubmissionModule } from './modules/submission/submission.module'
import { TemplateModule } from './modules/template/template.module'
import { RbacModule } from './modules/rbac/rbac.module'
import { AuditModule } from './modules/audit/audit.module'
import { WebhookModule } from './modules/webhook/webhook.module'
import { WorkflowModule } from './modules/workflow/workflow.module'
import { InvitationModule } from './modules/invitation/invitation.module'
import { NotificationModule } from './modules/notification/notification.module'
import { AnalyticsModule } from './modules/analytics/analytics.module'
import { UploadModule } from './modules/upload/upload.module'
import { PermissionGuard } from './common/guards/permission.guard'
import { InfraThrottlerGuard } from './common/throttler/throttler.guard'
import { RedisThrottlerStorage } from './common/throttler/redis-throttler.storage'
import { QuotaModule } from './common/quota/quota.module'

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    RedisModule,
    MinioModule,
    // 限流（阶段 6 / S6.1，默认关）：计数器 Redis 有则用、无则内存。守卫走全局，
    // 覆盖登录等未鉴权路由；RATE_LIMIT_ENABLED!=='true' 时恒放行（零行为变化）。
    ThrottlerModule.forRootAsync({
      inject: [ConfigService, 'REDIS_CLIENT'],
      useFactory: (config: ConfigService, redis: Redis | null) => ({
        throttlers: [
          {
            ttl: parseInt(config.get<string>('RATE_LIMIT_TTL_MS') || '60000', 10),
            limit: parseInt(config.get<string>('RATE_LIMIT_LIMIT') || '120', 10),
          },
        ],
        storage: new RedisThrottlerStorage(redis),
      }),
    }),
    CacheModule,
    MailModule,
    AuthModule,
    WorkspaceModule,
    FormModule,
    SubmissionModule,
    TemplateModule,
    RbacModule,
    AuditModule,
    WebhookModule,
    WorkflowModule,
    InvitationModule,
    NotificationModule,
    AnalyticsModule,
    UploadModule,
    QuotaModule,
  ],
  providers: [
    PermissionGuard,
    // 限流走全局（APP_GUARD）：覆盖登录等未鉴权路由与全部控制器；默认关故零行为变化。
    { provide: APP_GUARD, useClass: InfraThrottlerGuard },
  ],
})
export class AppModule {}
