import { Controller, Get, Query, UseGuards } from '@nestjs/common'
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger'
import { AnalyticsService } from './analytics.service'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { PermissionGuard, RequiredPermission } from '../../common/guards/permission.guard'
import { CurrentUser } from '../../common/decorators/current-user.decorator'

@ApiTags('Analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('analytics')
export class AnalyticsController {
  constructor(private analyticsService: AnalyticsService) {}

  /** 工作台概览 — 仅需登录即可访问 */
  @Get('overview')
  overview(
    @Query('workspaceId') workspaceId: string,
    @CurrentUser('userId') userId: string,
  ) {
    return this.analyticsService.overview(workspaceId, userId)
  }

  @RequiredPermission('analytics:view')
  @Get('submission-trend')
  submissionTrend(
    @Query('workspaceId') workspaceId: string,
    @Query('days') days?: number,
  ) {
    return this.analyticsService.submissionTrend(workspaceId, days || 30)
  }

  @RequiredPermission('analytics:view')
  @Get('form-ranking')
  formRanking(@Query('workspaceId') workspaceId: string) {
    return this.analyticsService.formRanking(workspaceId)
  }

  @RequiredPermission('analytics:view')
  @Get('form-status')
  formStatusDistribution(@Query('workspaceId') workspaceId: string) {
    return this.analyticsService.formStatusDistribution(workspaceId)
  }
}
