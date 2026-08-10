import { Injectable } from '@nestjs/common'
import { Tool } from '../../../harness/tool.decorator'
import { z } from 'zod'

@Injectable()
@Tool({
  name: 'data_preview',
  description: '生成提交数据的预览摘要，不实际写入数据库（默认模式）。',
  inputSchema: z.object({
    formName: z.string().describe('表单名称'),
    data: z.record(z.unknown()).describe('要提交的数据'),
    fields: z.array(z.object({
      key: z.string(), name: z.string(), type: z.string(),
    })).optional(),
  }),
  riskLevel: 'low',
})
export class DataPreviewTool {
  async execute(args: { formName: string; data: Record<string, unknown>; fields?: Array<{ key: string; name: string; type: string }> }): Promise<any> {
    const fieldList = args.fields?.length
      ? args.fields.map((f) => `  - ${f.name} (${f.key}): ${args.data[f.key]}`).join('\n')
      : Object.entries(args.data).map(([k, v]) => `  - ${k}: ${v}`).join('\n')

    const summary = `## 数据预览: ${args.formName}\n\n${fieldList}\n\n⚠ 预览模式，未实际写入数据库。确认后调用 data_confirm 完成提交。`
    return { summary, fieldCount: args.fields?.length || Object.keys(args.data).length }
  }
}
