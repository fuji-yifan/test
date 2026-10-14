import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'

/**
 * 工作空间配额（阶段 6 / S6.1）。
 *
 * 依 `Workspace.maxForms` / `maxMembers`（schema 既有字段）与实时 `count()` 比较。
 * 约定 **`maxForms`/`maxMembers <= 0` 表示不限**。超限抛 **429**（与限流同码，前端提示「配额已用尽」）。
 *
 * 默认**不生效**：守卫在 `QUOTA_ENABLED !== 'true'` 时直接放行，本服务不会被调用。
 */
@Injectable()
export class WorkspaceQuotaService {
  private readonly logger = new Logger(WorkspaceQuotaService.name)

  constructor(private readonly prisma: PrismaClient) {}

  /** 建表前校验表单数是否达上限。 */
  async assertCanCreateForm(workspaceId: string): Promise<void> {
    const ws = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { maxForms: true },
    })
    if (!ws) return
    const limit = ws.maxForms ?? 0
    if (limit <= 0) return
    const count = await this.prisma.form.count({ where: { workspaceId, deletedAt: null } })
    if (count >= limit) {
      this.logger.warn(`工作空间 ${workspaceId} 表单数达上限（${count}/${limit}）`)
      throw new HttpException('表单数量已达套餐上限，请升级套餐', HttpStatus.TOO_MANY_REQUESTS)
    }
  }

  /** 邀请成员前校验成员数是否达上限（含待处理邀请，避免「先邀满再拒」绕过）。 */
  async assertCanInviteMember(workspaceId: string): Promise<void> {
    const ws = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { maxMembers: true },
    })
    if (!ws) return
    const limit = ws.maxMembers ?? 0
    if (limit <= 0) return
    const [members, pending] = await Promise.all([
      this.prisma.workspaceMember.count({ where: { workspaceId } }),
      this.prisma.workspaceInvitation.count({ where: { workspaceId, status: 'pending' } }),
    ])
    if (members + pending >= limit) {
      this.logger.warn(`工作空间 ${workspaceId} 成员数达上限（${members}+${pending}/${limit}）`)
      throw new HttpException('成员数量已达套餐上限，请升级套餐', HttpStatus.TOO_MANY_REQUESTS)
    }
  }
}
