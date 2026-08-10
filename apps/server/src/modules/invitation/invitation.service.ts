import { Injectable, NotFoundException, ForbiddenException, ConflictException, Logger } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'

@Injectable()
export class InvitationService {
  private readonly logger = new Logger(InvitationService.name)

  constructor(
    private prisma: PrismaClient,
  ) {}

  /** 向用户发送工作空间邀请 */
  async invite(workspaceId: string, inviterId: string, dto: { email: string; role: string }) {
    const invitee = await this.prisma.user.findUnique({ where: { email: dto.email } })
    if (!invitee) throw new NotFoundException('该用户不存在，请检查邮箱是否正确')

    // 对方已是成员
    const existingMember = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: invitee.id } },
    })
    if (existingMember) throw new ConflictException('该用户已在工作空间中')

    const [workspace, inviter] = await Promise.all([
      this.prisma.workspace.findUnique({ where: { id: workspaceId }, select: { name: true } }),
      this.prisma.user.findUnique({ where: { id: inviterId }, select: { nickname: true, email: true } }),
    ])
    const inviterName = inviter!.nickname || inviter!.email

    // 已有待处理的邀请 → 更新并重新发送通知
    const existingInvitation = await this.prisma.workspaceInvitation.findUnique({
      where: { workspaceId_inviteeId: { workspaceId, inviteeId: invitee.id } },
    })
    if (existingInvitation) {
      const updated = await this.prisma.workspaceInvitation.update({
        where: { id: existingInvitation.id },
        data: { role: dto.role, status: 'pending', inviterId },
      })
      await this.createNotification(invitee.id, workspaceId, workspace!.name, inviterName, dto.role, updated.id)
      return updated
    }

    // 创建邀请 + 通知
    const invitation = await this.prisma.workspaceInvitation.create({
      data: {
        workspaceId,
        inviterId,
        inviteeId: invitee.id,
        role: dto.role,
      },
    })

    await this.createNotification(invitee.id, workspaceId, workspace!.name, inviterName, dto.role, invitation.id)

    return invitation
  }

  private async createNotification(
    userId: string, workspaceId: string, workspaceName: string,
    inviterName: string, role: string, invitationId: string,
  ) {
    try {
      await this.prisma.notification.create({
        data: {
          userId,
          workspaceId,
          type: '邀请',
          title: '工作空间邀请',
          content: `${workspaceName} 邀请您加入，请确认`,
          relatedType: 'invitation',
          relatedId: invitationId,
        },
      })
      this.logger.log(`邀请通知已创建 → userId=${userId} workspace=${workspaceName} role=${role}`)
    } catch (e) {
      this.logger.error(`创建邀请通知失败 → userId=${userId}`, e)
    }
  }

  /** 获取我的待处理邀请 */
  async getMyInvitations(userId: string) {
    return this.prisma.workspaceInvitation.findMany({
      where: { inviteeId: userId, status: 'pending' },
      include: {
        workspace: { select: { id: true, name: true } },
        inviter: { select: { id: true, email: true, nickname: true, avatarUrl: true } },
      },
      orderBy: { createdAt: 'desc' },
    })
  }

  /** 接受邀请 */
  async accept(id: string, userId: string) {
    const invitation = await this.prisma.workspaceInvitation.findUnique({
      where: { id },
      include: { workspace: true },
    })
    if (!invitation) throw new NotFoundException('邀请不存在')
    if (invitation.inviteeId !== userId) throw new ForbiddenException('该邀请不属于你')
    if (invitation.status !== 'pending') throw new ConflictException('该邀请已处理')

    // 加入工作空间
    await this.prisma.workspaceMember.create({
      data: {
        workspaceId: invitation.workspaceId,
        userId,
        role: invitation.role,
      },
    })

    // 标记邀请已接受
    await this.prisma.workspaceInvitation.update({
      where: { id },
      data: { status: 'accepted' },
    })

    return { workspaceName: invitation.workspace.name }
  }

  /** 拒绝邀请 */
  async decline(id: string, userId: string) {
    const invitation = await this.prisma.workspaceInvitation.findUnique({ where: { id } })
    if (!invitation) throw new NotFoundException('邀请不存在')
    if (invitation.inviteeId !== userId) throw new ForbiddenException('该邀请不属于你')
    if (invitation.status !== 'pending') throw new ConflictException('该邀请已处理')

    await this.prisma.workspaceInvitation.update({
      where: { id },
      data: { status: 'declined' },
    })
  }
}

function roleLabel(role: string) {
  const map: Record<string, string> = { owner: '创建者', editor: '编辑者', viewer: '查看者' }
  return map[role] || role
}
