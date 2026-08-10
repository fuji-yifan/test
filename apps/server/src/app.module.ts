import { Module } from '@nestjs/common'
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

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    RedisModule,
    MinioModule,
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
  ],
  providers: [PermissionGuard],
})
export class AppModule {}
