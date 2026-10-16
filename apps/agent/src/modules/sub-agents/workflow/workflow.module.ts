import { Module } from '@nestjs/common'
import { FlowCreateTool } from './tools/flow-create.tool'
import { FlowValidateTool } from './tools/flow-validate.tool'
import { FlowBindFormTool } from './tools/flow-bind-form.tool'
import { FlowPreviewTool } from './tools/flow-preview.tool'
import { FlowSaveTool } from './tools/flow-save.tool'
import { FlowPublishTool } from './tools/flow-publish.tool'
import { SessionModule } from '../../session/session.module'
import { HubModule } from '../../hub/hub.module'

@Module({
  imports: [HubModule, SessionModule],
  providers: [
    FlowCreateTool, FlowValidateTool, FlowBindFormTool,
    FlowPreviewTool, FlowSaveTool, FlowPublishTool,
  ],
})
export class WorkflowModule {}
