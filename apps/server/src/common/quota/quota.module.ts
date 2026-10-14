import { Global, Module } from '@nestjs/common'
import { WorkspaceQuotaService } from './workspace-quota.service'
import { WorkspaceQuotaGuard } from '../guards/workspace-quota.guard'

/**
 * 工作空间配额模块（阶段 6 / S6.1）。
 *
 * 设为 `@Global()`：`WorkspaceQuotaGuard` 被 Form / Invitation 等**各业务模块**的控制器
 * 以 `@UseGuards(WorkspaceQuotaGuard)` 引用，Nest 会在**控制器所属模块上下文**解析它 ——
 * 故 provider 必须全局可见（与 `AuditModule` 同款横切惯例）。
 */
@Global()
@Module({
  providers: [WorkspaceQuotaService, WorkspaceQuotaGuard],
  exports: [WorkspaceQuotaService, WorkspaceQuotaGuard],
})
export class QuotaModule {}
