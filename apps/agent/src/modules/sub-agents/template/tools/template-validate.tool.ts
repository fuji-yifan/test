import { Injectable } from '@nestjs/common'
import { Tool } from '../../../harness/tool.decorator'
import { z } from 'zod'

@Injectable()
@Tool({
  name: 'template_validate',
  description: '校验模板完整性：检查名称、分类、标签、Schema 合法性。',
  inputSchema: z.object({
    name: z.string(),
    description: z.string().optional(),
    category: z.string(),
    tags: z.array(z.string()),
    schema: z.record(z.unknown()),
  }),
  riskLevel: 'low',
})
export class TemplateValidateTool {
  async execute(args: {
    name: string; description?: string; category: string; tags: string[]; schema: Record<string, unknown>
  }): Promise<any> {
    const issues: string[] = []
    if (!args.name) issues.push('Missing template name')
    if (!args.category) issues.push('Missing category')
    if (!args.tags || args.tags.length === 0) issues.push('At least 1 tag required')
    if (!args.schema) issues.push('Missing schema')

    const passed = issues.length === 0
    return {
      summary: passed ? 'Template validation PASSED' : `Validation FAILED: ${issues.join('; ')}`,
      passed, issues,
    }
  }
}
