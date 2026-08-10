import {
  Injectable, CanActivate, ExecutionContext,
  ForbiddenException,
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
