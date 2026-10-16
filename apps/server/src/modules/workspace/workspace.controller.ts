import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common'
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger'
import { WorkspaceService } from './workspace.service'
import { AuthService } from '../auth/auth.service'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { WorkspaceGuard } from '../../common/guards/workspace.guard'
import { PermissionGuard, RequiredPermission } from '../../common/guards/permission.guard'
import { CurrentUser } from '../../common/decorators/current-user.decorator'

@ApiTags('Workspaces')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('workspaces')
export class WorkspaceController {
  constructor(
    private workspaceService: WorkspaceService,
    private authService: AuthService,
  ) {}

  @Get()
  list(@CurrentUser('userId') userId: string) {
    return this.workspaceService.list(userId)
  }

  @Post()
  create(@CurrentUser('userId') userId: string, @Body() dto: { name: string; remark?: string }) {
    return this.workspaceService.create(userId, dto)
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.workspaceService.getById(id)
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: { name?: string; remark?: string; logoUrl?: string; settings?: any }) {
    return this.workspaceService.update(id, dto)
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser('userId') userId: string) {
    return this.workspaceService.remove(id, userId)
  }

  /**
   * 换发 token，把工作空间身份切到该空间（阶段 6 / S1.1 的后续）。
   *
   * 登录时签进 JWT 的 workspaceId 是「最早的空间」，切空间只改路由不改 token；而 agent
   * 取 id 时 JWT 优先，于是切空间对 agent 无效。前端选完空间后调这里换发。
   *
   * 参数名用 `:wsId`：WorkspaceGuard 读的是 params.wsId —— 它同时保证「空间存在、
   * 未软删、且你是成员」，换成 :id 会让守卫取不到值而直接放行。
   */
  @UseGuards(WorkspaceGuard)
  @Post(':wsId/token')
  issueToken(@Param('wsId') wsId: string, @CurrentUser('userId') userId: string) {
    return this.authService.issueTokenFor(userId, wsId)
  }

  @Post(':id/leave')
  leave(@Param('id') id: string, @CurrentUser('userId') userId: string) {
    return this.workspaceService.leave(id, userId)
  }

  @Get(':id/members')
  listMembers(@Param('id') id: string) {
    return this.workspaceService.listMembers(id)
  }

  @UseGuards(PermissionGuard)
  @RequiredPermission('member:invite')
  @Post(':id/members')
  addMember(@Param('id') id: string, @Body() dto: { email: string; role: string }) {
    return this.workspaceService.addMember(id, dto)
  }

  @UseGuards(PermissionGuard)
  @RequiredPermission('member:remove')
  @Delete(':id/members/:userId')
  removeMember(@Param('id') id: string, @Param('userId') userId: string) {
    return this.workspaceService.removeMember(id, userId)
  }

  @UseGuards(PermissionGuard)
  @RequiredPermission('member:role')
  @Patch(':id/members/:userId')
  updateMemberRole(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Body() dto: { role: string },
  ) {
    return this.workspaceService.updateMemberRole(id, userId, dto.role)
  }
}
