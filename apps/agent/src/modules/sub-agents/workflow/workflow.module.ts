import { Module } from '@nestjs/common'
import { WorkflowAgent } from './workflow.agent'
import { FlowCreateTool } from './tools/flow-create.tool'
import { FlowValidateTool } from './tools/flow-validate.tool'
import { FlowBindFormTool } from './tools/flow-bind-form.tool'
import { FlowPreviewTool } from './tools/flow-preview.tool'
import { FlowPublishTool } from './tools/flow-publish.tool'
import { SessionModule } from '../../session/session.module'
import { HubModule } from '../../hub/hub.module'

@Module({
  imports: [HubModule, SessionModule],
  providers: [
    WorkflowAgent,
    FlowCreateTool, FlowValidateTool, FlowBindFormTool,
    FlowPreviewTool, FlowPublishTool,
  ],
  exports: [WorkflowAgent],
})
export class WorkflowModule {}
