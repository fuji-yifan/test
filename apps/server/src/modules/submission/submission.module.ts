import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { SubmissionService } from './submission.service'
import { SubmissionController } from './submission.controller'
import { FieldACLInterceptor } from '../../common/interceptors/field-acl.interceptor'
import { WorkflowModule } from '../workflow/workflow.module'

@Module({
  imports: [
    WorkflowModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'dev-secret',
    }),
  ],
  controllers: [SubmissionController],
  providers: [SubmissionService, FieldACLInterceptor],
  exports: [SubmissionService],
})
export class SubmissionModule {}
