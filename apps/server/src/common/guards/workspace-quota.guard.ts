import {
  Injectable, CanActivate, ExecutionContext, SetMetadata, ForbiddenException,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { WorkspaceQuotaService } from '../quota/workspace-quota.service'

/** 配额类型元数据（建表 / 邀请成员）。 */
export const QUOTA_KIND_KEY = 'quotaKind'
export const QuotaCheck = (kind: 'form' | 'member') => SetMetadata(QUOTA_KIND_KEY, kind)

/**
 * 工作空间配额守卫（阶段 6 / S6.1，**per-controller**：贴合既有 `WorkspaceGuard`/`PermissionGuard` 惯例）。
 *
 * **默认关**：`QUOTA_ENABLED !== 'true'` 时 `canActivate` 直接放行（零行为变化）。
 * 打开后仅对挂了 `@QuotaCheck('form'|'member')` 的路由生效；工作空间从 `:wsId` 路径参数取。
 * 超限由 `WorkspaceQuotaService` 抛 429。
 */
@Injectable()
export class WorkspaceQuotaGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly quota: WorkspaceQuotaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (process.env.QUOTA_ENABLED !== 'true') return true

    const kind = this.reflector.getAllAndOverride<'form' | 'member' | undefined>(QUOTA_KIND_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (!kind) return true

    const request = context.switchToHttp().getRequest()
    const workspaceId =
      request.params?.wsId || request.params?.workspaceId || request.user?.workspaceId
    if (!workspaceId) {
      throw new ForbiddenException('无法确定工作空间上下文')
    }

    if (kind === 'form') await this.quota.assertCanCreateForm(workspaceId)
    else await this.quota.assertCanInviteMember(workspaceId)
    return true
  }
}
