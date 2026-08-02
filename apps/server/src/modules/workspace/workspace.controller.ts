import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common'
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger'
import { WorkspaceService } from './workspace.service'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { PermissionGuard, RequiredPermission } from '../../common/guards/permission.guard'
import { CurrentUser } from '../../common/decorators/current-user.decorator'

@ApiTags('Workspaces')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('workspaces')
export class WorkspaceController {
  constructor(private workspaceService: WorkspaceService) {}

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
