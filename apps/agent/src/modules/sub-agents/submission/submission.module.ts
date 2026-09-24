import { Module } from '@nestjs/common'
import { SubmissionAgent } from './submission.agent'
import { DataQueryTool } from './tools/data-query.tool'
import { DataAnalyzeTool } from './tools/data-analyze.tool'
import { DataListFormsTool } from './tools/data-list-forms.tool'
import { SessionModule } from '../../session/session.module'
import { HubModule } from '../../hub/hub.module'

@Module({
  imports: [HubModule, SessionModule],
  providers: [
    SubmissionAgent,
    DataQueryTool, DataAnalyzeTool, DataListFormsTool,
  ],
  exports: [SubmissionAgent],
})
export class SubmissionModule {}
