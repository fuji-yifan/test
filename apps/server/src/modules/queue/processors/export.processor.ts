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
    const { formId, format } = job.data
    // TODO: Phase 3 — 实现大数据量导出逻辑（Prisma 分批查询 + 流式写入）
    return { message: `Export for form ${formId} as ${format} — placeholder (Phase 3c-3)` }
  }
}
