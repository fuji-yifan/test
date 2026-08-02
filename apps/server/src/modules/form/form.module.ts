import { Module } from '@nestjs/common'
import { FormService } from './form.service'
import { FormController } from './form.controller'

@Module({
  controllers: [FormController],
  providers: [FormService],
  exports: [FormService],
})
export class FormModule {}
