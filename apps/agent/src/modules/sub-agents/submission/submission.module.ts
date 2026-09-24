import { Module } from '@nestjs/common'
import { DataQueryTool } from './tools/data-query.tool'
import { DataAnalyzeTool } from './tools/data-analyze.tool'
import { DataListFormsTool } from './tools/data-list-forms.tool'
import { SessionModule } from '../../session/session.module'
import { HubModule } from '../../hub/hub.module'

@Module({
  imports: [HubModule, SessionModule],
  providers: [
    DataQueryTool, DataAnalyzeTool, DataListFormsTool,
  ],
})
export class SubmissionModule {}
