import { Controller, Get, Query, UseGuards } from '@nestjs/common'
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger'
import { AnalyticsService } from './analytics.service'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { PermissionGuard, RequiredPermission } from '../../common/guards/permission.guard'
import { CurrentUser } from '../../common/decorators/current-user.decorator'

@ApiTags('Analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
@RequiredPermission('submission:view')
@Controller('analytics')
export class AnalyticsController {
  constructor(private analyticsService: AnalyticsService) {}

  @Get('overview')
  overview(
    @Query('workspaceId') workspaceId: string,
    @CurrentUser('userId') userId: string,
  ) {
    return this.analyticsService.overview(workspaceId, userId)
  }

  @Get('submission-trend')
  submissionTrend(
    @Query('workspaceId') workspaceId: string,
    @Query('days') days?: number,
  ) {
    return this.analyticsService.submissionTrend(workspaceId, days || 30)
  }

  @Get('form-ranking')
  formRanking(@Query('workspaceId') workspaceId: string) {
    return this.analyticsService.formRanking(workspaceId)
  }

  @Get('form-status')
  formStatusDistribution(@Query('workspaceId') workspaceId: string) {
    return this.analyticsService.formStatusDistribution(workspaceId)
  }
}
