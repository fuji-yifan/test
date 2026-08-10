import { Module } from '@nestjs/common'
import { SubmissionAgent } from './submission.agent'
import { DataValidateTool } from './tools/data-validate.tool'
import { DataPreviewTool } from './tools/data-preview.tool'
import { DataConfirmTool } from './tools/data-confirm.tool'
import { DataRollbackTool } from './tools/data-rollback.tool'
import { DataQueryTool } from './tools/data-query.tool'
import { DataAnalyzeTool } from './tools/data-analyze.tool'
import { SessionModule } from '../../session/session.module'
import { HubModule } from '../../hub/hub.module'

@Module({
  imports: [HubModule, SessionModule],
  providers: [
    SubmissionAgent,
    DataValidateTool, DataPreviewTool, DataConfirmTool,
    DataRollbackTool, DataQueryTool, DataAnalyzeTool,
  ],
  exports: [SubmissionAgent],
})
export class SubmissionModule {}
