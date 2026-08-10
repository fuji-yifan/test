import { Injectable } from '@nestjs/common'
import { Tool } from '../../../harness/tool.decorator'
import { z } from 'zod'

@Injectable()
@Tool({
  name: 'form_preview',
  description: '生成表单的预览摘要，展示字段列表、布局和校验状态。不实际写入数据库。',
  inputSchema: z.object({
    schema: z.record(z.unknown()).describe('已验证通过的表单 Schema'),
  }),
  riskLevel: 'low',
})
export class FormPreviewTool {
  async execute(args: { schema: Record<string, unknown> }): Promise<any> {
    const schema = args.schema
    const fields = (schema.fields as any[]) || []
    const settings = (schema.settings as any) || {}

    const fieldList = fields.map((f) => {
      const rulesStr = f.rules?.length
        ? ` [${f.rules.map((r: any) => r.type).join(', ')}]`
        : ''
      return `  - ${f.name} (${f.key}): ${f.type}${rulesStr} (col:${f.col})`
    }).join('\n')

    const summary = `## 表单预览: ${settings.formTitle || '未命名'}

### 字段列表 (${fields.length} 个)
${fieldList}

### 表单设置
- 布局列数: ${settings.canvasCols || 24}
- 标签位置: ${settings.labelPosition || 'left'}
- 版本: ${schema.version || 1}`

    return { summary, fieldCount: fields.length, settings }
  }
}
