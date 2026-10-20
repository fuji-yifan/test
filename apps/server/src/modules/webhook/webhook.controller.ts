import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common'
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger'
import { WebhookService } from './webhook.service'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'

@ApiTags('Webhooks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('forms/:formId/webhooks')
export class WebhookController {
  constructor(private webhookService: WebhookService) {}

  @Get()
  list(@Param('formId') formId: string) {
    return this.webhookService.list(formId)
  }

  @Post()
  create(
    @Param('formId') formId: string,
    @Body() dto: { url: string; events: string[]; secret?: string },
  ) {
    return this.webhookService.create(formId, dto)
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: { url?: string; events?: string[]; isActive?: boolean; secret?: string },
  ) {
    return this.webhookService.update(id, dto)
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.webhookService.remove(id)
  }

  @Post(':id/test')
  test(@Param('id') id: string) {
    return this.webhookService.test(id)
  }

  @Get(':id/deliveries')
  getDeliveries(
    @Param('id') id: string,
    @Query() query: { page?: number; pageSize?: number },
  ) {
    return this.webhookService.getDeliveries(id, query)
  }
}
