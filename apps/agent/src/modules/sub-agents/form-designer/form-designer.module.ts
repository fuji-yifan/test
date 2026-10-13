import { Module } from '@nestjs/common'

// 6 个工具
import { FormSearchFieldPoolTool } from './tools/form-search-field-pool.tool'
import { FormAssembleSchemaTool } from './tools/form-assemble-schema.tool'
import { FormValidateSchemaTool } from './tools/form-validate-schema.tool'
import { FormPreviewTool } from './tools/form-preview.tool'
import { FormSaveTool } from './tools/form-save.tool'
import { FormRollbackTool } from './tools/form-rollback.tool'

import { HubModule } from '../../hub/hub.module'
import { SessionModule } from '../../session/session.module'

@Module({
  imports: [HubModule, SessionModule],
  providers: [
    FormSearchFieldPoolTool,
    FormAssembleSchemaTool,
    FormValidateSchemaTool,
    FormPreviewTool,
    FormSaveTool,
    FormRollbackTool,
  ],
})
export class FormDesignerModule {}
