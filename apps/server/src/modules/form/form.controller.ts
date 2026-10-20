import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards,
} from '@nestjs/common'
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger'
import { FormService } from './form.service'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { PermissionGuard, RequiredPermission } from '../../common/guards/permission.guard'
import { WorkspaceGuard } from '../../common/guards/workspace.guard'
import { WorkspaceQuotaGuard, QuotaCheck } from '../../common/guards/workspace-quota.guard'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Public } from '../../common/decorators/public.decorator'

@ApiTags('Forms')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class FormController {
  constructor(private formService: FormService) {}

  // ---- 工作空间下的表单管理 (L2+L3 权限) ----
  @UseGuards(WorkspaceGuard)
  @Get('workspaces/:wsId/forms')
  list(
    @Param('wsId') wsId: string,
    @Query() query: { page?: number; pageSize?: number; status?: string },
  ) {
    return this.formService.list(wsId, query)
  }

  @UseGuards(WorkspaceGuard, PermissionGuard, WorkspaceQuotaGuard)
  @RequiredPermission('form:create')
  @QuotaCheck('form')
  @Post('workspaces/:wsId/forms')
  create(
    @Param('wsId') wsId: string,
    @CurrentUser('userId') userId: string,
    @Body() dto: { name: string; description?: string; clientRequestId?: string },
  ) {
    return this.formService.create(wsId, userId, dto)
  }

  // ---- 表单 CRUD (L3 表单级权限) ----
  @Get('forms/:id')
  getById(@Param('id') id: string) {
    return this.formService.getById(id)
  }

  @UseGuards(PermissionGuard)
  @RequiredPermission('form:edit')
  @Patch('forms/:id')
  update(
    @Param('id') id: string,
    @CurrentUser('userId') userId: string,
    @Body() dto: { name?: string; description?: string; category?: string; schema?: any; settings?: any; maxSubmissions?: number; targetVersion?: number },
  ) {
    return this.formService.update(id, userId, dto)
  }

  @UseGuards(PermissionGuard)
  @RequiredPermission('form:delete')
  @Delete('forms/:id')
  remove(@Param('id') id: string) {
    return this.formService.remove(id)
  }

  @UseGuards(PermissionGuard)
  @RequiredPermission('form:edit')
  @Post('forms/:id/restore')
  restore(@Param('id') id: string) {
    return this.formService.restore(id)
  }

  // 彻底删除（回收站清空），不可恢复，权限与移入回收站一致
  @UseGuards(PermissionGuard)
  @RequiredPermission('form:delete')
  @Delete('forms/:id/purge')
  purge(@Param('id') id: string) {
    return this.formService.purge(id)
  }

  @UseGuards(WorkspaceGuard)
  @Get('workspaces/:wsId/forms/recycle')
  listRecycle(@Param('wsId') wsId: string) {
    return this.formService.listRecycle(wsId)
  }

  @UseGuards(PermissionGuard)
  @RequiredPermission('form:publish')
  @Post('forms/:id/publish')
  publish(@Param('id') id: string, @CurrentUser('userId') userId: string) {
    return this.formService.publish(id, userId)
  }

  @UseGuards(PermissionGuard)
  @RequiredPermission('form:archive')
  @Post('forms/:id/archive')
  archive(@Param('id') id: string) {
    return this.formService.archive(id)
  }

  @UseGuards(WorkspaceGuard, PermissionGuard)
  @RequiredPermission('form:copy')
  @Post('workspaces/:wsId/forms/:id/fork')
  fork(
    @Param('wsId') wsId: string,
    @Param('id') id: string,
    @CurrentUser('userId') userId: string,
  ) {
    return this.formService.fork(id, wsId, userId)
  }

  @Get('forms/:id/versions')
  getVersions(@Param('id') id: string) {
    return this.formService.getVersions(id)
  }

  @UseGuards(PermissionGuard)
  @RequiredPermission('form:edit')
  @Delete('forms/:id/versions/:version')
  deleteVersion(@Param('id') id: string, @Param('version') version: string) {
    return this.formService.deleteVersion(id, parseInt(version))
  }

  @UseGuards(PermissionGuard)
  @RequiredPermission('form:edit')
  @Post('forms/:id/versions/:version/restore')
  restoreVersion(@Param('id') id: string, @Param('version') version: string) {
    return this.formService.restoreVersion(id, parseInt(version))
  }

  // ---- 公开接口（渲染器获取 Schema + 版本兼容性检查） ----

  @Public()
  @Get('public/forms/:id')
  getPublished(@Param('id') id: string) {
    return this.formService.getPublished(id)
  }

  @Public()
  @Get('public/forms/:id/compatibility')
  checkCompatibility(@Param('id') id: string, @Query('dataVersion') dataVersion?: string) {
    return this.formService.checkCompatibility(id, dataVersion ? parseInt(dataVersion) : undefined)
  }
}
