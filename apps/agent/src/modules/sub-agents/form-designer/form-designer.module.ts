import { Module } from '@nestjs/common'
import { FormDesignerAgent } from './form-designer.agent'

// 5 个工具
import { FormSearchFieldPoolTool } from './tools/form-search-field-pool.tool'
import { FormAssembleSchemaTool } from './tools/form-assemble-schema.tool'
import { FormValidateSchemaTool } from './tools/form-validate-schema.tool'
import { FormPreviewTool } from './tools/form-preview.tool'
import { FormSaveTool } from './tools/form-save.tool'

import { HubModule } from '../../hub/hub.module'
import { SessionModule } from '../../session/session.module'

@Module({
  imports: [HubModule, SessionModule],
  providers: [
    FormDesignerAgent,
    FormSearchFieldPoolTool,
    FormAssembleSchemaTool,
    FormValidateSchemaTool,
    FormPreviewTool,
    FormSaveTool,
  ],
  exports: [FormDesignerAgent],
})
export class FormDesignerModule {}
