import { Module } from '@nestjs/common'
import { TemplateAgent } from './template.agent'
import { TemplateSearchTool } from './tools/template-search.tool'
import { TemplateGetDetailTool } from './tools/template-get-detail.tool'
import { TemplateInstantiateTool } from './tools/template-instantiate.tool'
import { TemplateValidateTool } from './tools/template-validate.tool'
import { SessionModule } from '../../session/session.module'
import { HubModule } from '../../hub/hub.module'

@Module({
  imports: [HubModule, SessionModule],
  providers: [
    TemplateAgent,
    TemplateSearchTool, TemplateGetDetailTool,
    TemplateInstantiateTool, TemplateValidateTool,
  ],
  exports: [TemplateAgent],
})
export class TemplateModule {}
