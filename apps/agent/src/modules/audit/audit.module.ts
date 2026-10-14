import { Module } from '@nestjs/common'
import { AuditStore } from './audit.store'

/**
 * 工具调用审计模块（阶段 6 / S2）。
 *
 * 无 MySQL / 未配置 AGENT_DATABASE_URL 时 store 自动降级 no-op，不阻断请求。
 * 审计表 `audit_logs` 归 server 所有，agent 只写不建。
 */
@Module({
  providers: [AuditStore],
  exports: [AuditStore],
})
export class AuditModule {}
