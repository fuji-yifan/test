import {
  Injectable, CanActivate, ExecutionContext,
  ForbiddenException, NotFoundException,
} from '@nestjs/common'
import { PrismaClient } from '@prisma/client'

@Injectable()
export class WorkspaceGuard implements CanActivate {
  constructor(private prisma: PrismaClient) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest()
    const user = request.user
    if (!user?.userId) return false

    const workspaceId = request.params.wsId || request.params.workspaceId
    if (!workspaceId) return true

    // 已软删除 / 不存在的空间一律拒绝（放在 super_admin 绕过之前：超管也不该往墓碑里写）。
    // 不这么做的话，前端停在指向已删除空间的旧 URL 上时，写操作会 200 成功，
    // 数据落进用户永远看不到的空间 —— 表现为「保存成功但找不到」。
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { deletedAt: true },
    })
    if (!workspace || workspace.deletedAt) {
      throw new NotFoundException('工作空间不存在或已删除')
    }

    if (user.roles?.includes('role:super_admin')) return true

    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: user.userId } },
    })

    if (!member) {
      throw new ForbiddenException('您不是该工作空间的成员')
    }

    request.workspaceMember = member
    return true
  }
}
