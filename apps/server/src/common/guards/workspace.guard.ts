/**
 * WorkspaceGuard — 工作空间成员校验
 *
 * 判定当前用户是否属于请求的工作空间。
 * 用于 L2 应用/工作空间级权限控制。
 *
 * 用法：在 Controller 方法上添加 @UseGuards(WorkspaceGuard)
 */

import {
  Injectable, CanActivate, ExecutionContext,
  ForbiddenException, Logger,
} from '@nestjs/common'
import { PrismaClient } from '@prisma/client'

@Injectable()
export class WorkspaceGuard implements CanActivate {
  private readonly logger = new Logger(WorkspaceGuard.name)

  constructor(private prisma: PrismaClient) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest()
    const user = request.user
    if (!user?.userId) return false

    // 从路径参数中提取 workspaceId
    const workspaceId = request.params.wsId || request.params.workspaceId
    if (!workspaceId) return true // 无工作空间参数 → 放行

    // 平台管理员直接放行
    if (user.roles?.includes('role:super_admin')) return true

    // 检查是否是该工作空间成员
    const member = await this.prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId,
          userId: user.userId,
        },
      },
    })

    if (!member) {
      throw new ForbiddenException('您不是该工作空间的成员')
    }

    // 挂载成员信息到 request，供后续使用
    request.workspaceMember = member
    return true
  }
}
