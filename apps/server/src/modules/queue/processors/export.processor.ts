import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Job } from 'bullmq'

interface ExportJob {
  workspaceId: string
  formId: string
  format: 'csv' | 'excel'
  userId: string
}

@Processor('export')
export class ExportProcessor extends WorkerHost {
  async process(job: Job<ExportJob>): Promise<{ message: string }> {
    const { formId, format, workspaceId: _wsId, userId: _uid } = job.data
    // Phase 3: Prisma cursor-based pagination + stream write to MinIO → download link
    return { message: `Export for form ${formId} as ${format} — placeholder (Phase 3c-3)` }
  }
}
