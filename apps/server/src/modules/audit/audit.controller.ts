import { Controller, Get, Delete, Param, Query, Res, UseGuards } from '@nestjs/common'
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger'
import { Response } from 'express'
import { AuditService, CleanupUnit } from './audit.service'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { PermissionGuard, RequiredPermission } from '../../common/guards/permission.guard'
import { CurrentUser } from '../../common/decorators/current-user.decorator'

@ApiTags('Audit')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
@RequiredPermission('audit:view')
@Controller('workspaces/:wsId/audit-logs')
export class AuditController {
  constructor(private auditService: AuditService) {}

  @Get()
  list(
    @Param('wsId') wsId: string,
    @Query() query: {
      page?: number; pageSize?: number; action?: string
      resourceType?: string; userId?: string
      startDate?: string; endDate?: string
    },
  ) {
    return this.auditService.list(wsId, query)
  }

  @Get('actions')
  getActionTypes(@Param('wsId') wsId: string) {
    return this.auditService.getActionTypes(wsId)
  }

  @Get('users')
  getUsers(@Param('wsId') wsId: string) {
    return this.auditService.getUsers(wsId)
  }

  @Get('stats')
  getStats(
    @Param('wsId') wsId: string,
    @Query('days') days?: number,
  ) {
    return this.auditService.getStats(wsId, days || 7)
  }

  @Get('export')
  @RequiredPermission('audit:export')
  async exportCsv(
    @Param('wsId') wsId: string,
    @Query() query: { action?: string; resourceType?: string; userId?: string; startDate?: string; endDate?: string },
    @CurrentUser('userId') userId: string,
    @Res() res: Response,
  ) {
    try { await this.auditService.log({ workspaceId: wsId, userId, action: '导出审计日志', resourceType: 'AuditLog' }) } catch { /* 记录失败不影响导出 */ }
    const csv = await this.auditService.exportCsv(wsId, query)
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', 'attachment; filename=audit-logs.csv')
    res.send('\uFEFF' + csv)
  }

  @Delete('cleanup')
  @RequiredPermission('audit:cleanup')
  async cleanup(
    @Param('wsId') wsId: string,
    @Query('amount') amount: string,
    @Query('unit') unit: string,
    @CurrentUser('userId') userId: string,
  ) {
    // 下限 1：负数会让 cutoff 落到未来，一次把日志全删光（query 参数是外部输入，前端 min 挡不住手搓请求）
    const n = Math.max(1, Math.floor(Number(amount) || 7))
    const u: CleanupUnit = unit === 'month' || unit === 'year' ? unit : 'day'
    try { await this.auditService.log({ workspaceId: wsId, userId, action: '清理审计日志', resourceType: 'AuditLog', details: { amount: n, unit: u } }) } catch { /* 记录失败不影响清理 */ }
    return this.auditService.cleanup(wsId, n, u)
  }

  @Get(':id')
  getDetail(@Param('wsId') wsId: string, @Param('id') id: string) {
    return this.auditService.getDetail(id)
  }
}
