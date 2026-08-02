import { Controller, Get, Post, Delete, Param, Query, UseGuards } from '@nestjs/common'
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger'
import { NotificationService } from './notification.service'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { CurrentUser } from '../../common/decorators/current-user.decorator'

@ApiTags('Notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationController {
  constructor(private notificationService: NotificationService) {}

  @Get()
  list(
    @CurrentUser('userId') userId: string,
    @Query() query: { page?: number; pageSize?: number; isRead?: boolean },
  ) {
    return this.notificationService.listForUser(userId, query)
  }

  @Get('unread-count')
  getUnreadCount(@CurrentUser('userId') userId: string) {
    return this.notificationService.getUnreadCount(userId)
  }

  @Post(':id/read')
  markAsRead(@Param('id') id: string, @CurrentUser('userId') userId: string) {
    return this.notificationService.markAsRead(id, userId)
  }

  @Post('read-all')
  markAllAsRead(@CurrentUser('userId') userId: string) {
    return this.notificationService.markAllAsRead(userId)
  }

  @Delete('clear-all')
  clearAll(@CurrentUser('userId') userId: string) {
    return this.notificationService.clearAll(userId)
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser('userId') userId: string) {
    return this.notificationService.remove(id, userId)
  }
}
