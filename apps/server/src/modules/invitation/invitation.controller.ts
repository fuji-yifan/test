import { Controller, Get, Post, Param, Body, UseGuards } from '@nestjs/common'
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger'
import { InvitationService } from './invitation.service'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { PermissionGuard, RequiredPermission } from '../../common/guards/permission.guard'
import { WorkspaceGuard } from '../../common/guards/workspace.guard'
import { WorkspaceQuotaGuard, QuotaCheck } from '../../common/guards/workspace-quota.guard'
import { CurrentUser } from '../../common/decorators/current-user.decorator'

@ApiTags('Invitations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class InvitationController {
  constructor(private invitationService: InvitationService) {}

  /** 邀请用户加入工作空间（替代原直接添加成员） */
  @UseGuards(WorkspaceGuard, PermissionGuard, WorkspaceQuotaGuard)
  @RequiredPermission('member:invite')
  @QuotaCheck('member')
  @Post('workspaces/:wsId/invitations')
  send(
    @Param('wsId') wsId: string,
    @CurrentUser('userId') inviterId: string,
    @Body() dto: { email: string; role: string },
  ) {
    return this.invitationService.invite(wsId, inviterId, dto)
  }

  /** 我的待处理邀请 */
  @Get('invitations/mine')
  getMine(@CurrentUser('userId') userId: string) {
    return this.invitationService.getMyInvitations(userId)
  }

  /** 接受邀请 */
  @Post('invitations/:id/accept')
  accept(@Param('id') id: string, @CurrentUser('userId') userId: string) {
    return this.invitationService.accept(id, userId)
  }

  /** 拒绝邀请 */
  @Post('invitations/:id/decline')
  decline(@Param('id') id: string, @CurrentUser('userId') userId: string) {
    return this.invitationService.decline(id, userId)
  }
}
