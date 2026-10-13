import { Injectable } from '@nestjs/common'
import { Tool } from '../../../harness/tool.decorator'
import { z } from 'zod'

@Injectable()
@Tool({
  name: 'template_instantiate',
  description: '基于模板 Schema 实例化一个新表单。可传入参数覆盖模板中的字段值。',
  inputSchema: z.object({
    templateName: z.string().describe('模板名称'),
    templateSchema: z.record(z.unknown()).optional().describe('模板的 FormSchema（从 template_get_detail 获取）'),
    overrides: z.record(z.unknown()).optional().describe('要覆盖的字段值 {fieldName: newValue}'),
  }),
  // 生成新表单（写操作）：风险 ≥ medium（阶段 6 / S3.3）；instantiate-approval 检查点 coversRisk。
  riskLevel: 'medium',
})
export class TemplateInstantiateTool {
  async execute(args: {
    templateName: string
    templateSchema?: Record<string, unknown>
    overrides?: Record<string, unknown>
  }): Promise<any> {
    const baseSchema = args.templateSchema || { fields: [], version: 1, settings: { formTitle: args.templateName } }

    // 应用覆盖
    if (args.overrides && baseSchema.fields) {
      const fields = baseSchema.fields as any[]
      for (const [key, value] of Object.entries(args.overrides)) {
        const field = fields.find((f: any) => f.key === key || f.name === key)
        if (field) Object.assign(field, value)
      }
    }

    return {
      summary: `Form instantiated from template "${args.templateName}" with ${(baseSchema.fields as any[])?.length || 0} fields`,
      schema: baseSchema,
    }
  }
}
