import { Global, Module } from '@nestjs/common'
import { AuditService } from './audit.service'
import { AuditController } from './audit.controller'

// 审计是横切关注点：登录/权限拒绝等审计发生在 AuthService、PermissionGuard 等
// 与业务模块无关的位置，故设为 @Global，免去逐模块 import AuditModule。
@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
