import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common'
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger'
import { RbacService } from './rbac.service'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { PermissionGuard, RequiredPermission } from '../../common/guards/permission.guard'

@ApiTags('RBAC')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('workspaces/:wsId/roles')
export class RbacController {
  constructor(private rbacService: RbacService) {}

  @Get()
  listRoles(@Param('wsId') wsId: string) {
    return this.rbacService.listRoles(wsId)
  }

  @UseGuards(PermissionGuard)
  @RequiredPermission('role:create')
  @Post()
  createRole(@Param('wsId') wsId: string, @Body() dto: { name: string; permissions: string[] }) {
    return this.rbacService.createRole(wsId, dto)
  }

  @UseGuards(PermissionGuard)
  @RequiredPermission('role:edit')
  @Patch(':id')
  updateRole(@Param('id') id: string, @Body() dto: { name?: string; permissions?: string[] }) {
    return this.rbacService.updateRole(id, dto)
  }

  @UseGuards(PermissionGuard)
  @RequiredPermission('role:delete')
  @Delete(':id')
  deleteRole(@Param('id') id: string) {
    return this.rbacService.deleteRole(id)
  }

  @Get('matrix')
  getPermissionMatrix(@Param('wsId') wsId: string) {
    return this.rbacService.getPermissionMatrix(wsId)
  }
}
