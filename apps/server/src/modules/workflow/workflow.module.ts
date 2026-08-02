import { Module } from '@nestjs/common'
import { WorkflowService } from './workflow.service'
import { WorkflowController } from './workflow.controller'
import { SLAService } from './sla.service'
import { NotificationModule } from '../notification/notification.module'

@Module({
  imports: [NotificationModule],
  controllers: [WorkflowController],
  providers: [WorkflowService, SLAService],
  exports: [WorkflowService],
})
export class WorkflowModule {}
