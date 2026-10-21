import { Controller, Get, Post, Patch, Delete, Param, Query, Body, UseGuards } from '@nestjs/common'
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger'
import { TemplateService } from './template.service'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { PermissionGuard, RequiredPermission } from '../../common/guards/permission.guard'
import { CurrentUser } from '../../common/decorators/current-user.decorator'

@ApiTags('Templates')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('templates')
export class TemplateController {
  constructor(private templateService: TemplateService) {}

  @Get()
  list(@Query() query: { page?: number; pageSize?: number; category?: string; keyword?: string }) {
    return this.templateService.list(query)
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.templateService.getById(id)
  }

  @UseGuards(PermissionGuard)
  @RequiredPermission('template:create')
  @Post()
  create(
    @CurrentUser('userId') userId: string,
    @Body() dto: { name: string; description?: string; schema: any; category?: string; tags?: string[] },
  ) {
    return this.templateService.create(userId, dto)
  }

  @UseGuards(PermissionGuard)
  @RequiredPermission('template:edit')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: { name?: string; description?: string; schema?: any; category?: string; tags?: string[] },
  ) {
    return this.templateService.update(id, dto)
  }

  @UseGuards(PermissionGuard)
  @RequiredPermission('template:delete')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.templateService.remove(id)
  }

  @UseGuards(PermissionGuard)
  @RequiredPermission('template:create')
  @Post(':id/use')
  use(
    @Param('id') id: string,
    @Body('workspaceId') workspaceId: string,
    @CurrentUser('userId') userId: string,
  ) {
    return this.templateService.use(id, workspaceId, userId)
  }
}
