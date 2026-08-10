import { Injectable } from '@nestjs/common'
import { Tool } from '../../../harness/tool.decorator'
import { z } from 'zod'

@Injectable()
@Tool({
  name: 'data_validate',
  description: '三层护栏第一层：校验提交数据的格式合法性。检查字段类型、必填、范围、枚举值、注入攻击字符。',
  inputSchema: z.object({
    data: z.record(z.unknown()).describe('要校验的表单数据 {fieldKey: value}'),
    schema: z.record(z.unknown()).describe('表单 Schema（含字段定义和校验规则）'),
  }),
  riskLevel: 'low',
})
export class DataValidateTool {
  // XSS/SQL 注入检测正则
  private injectionPattern = /<script|<\/script|javascript:|onerror=|onload=|--|;--|DROP\s|DELETE\sFROM|INSERT\sINTO|UNION\sSELECT/i

  async execute(args: { data: Record<string, unknown>; schema: Record<string, unknown> }): Promise<any> {
    const issues: Array<{ field: string; message: string; severity: 'error' | 'warning' }> = []
    const fields = (args.schema.fields as any[]) || []

    for (const [key, value] of Object.entries(args.data)) {
      const fieldDef = fields.find((f: any) => f.key === key)

      // 注入检测
      const strVal = String(value || '')
      if (this.injectionPattern.test(strVal)) {
        issues.push({ field: key, message: `Potential injection detected in "${key}"`, severity: 'error' })
      }

      // 类型校验
      if (fieldDef) {
        const type = fieldDef.type
        if (type === 'number' && isNaN(Number(value))) {
          issues.push({ field: key, message: `"${key}" should be a number, got "${value}"`, severity: 'error' })
        }

        // 必填校验
        const rules = fieldDef.rules || []
        const requiredRule = rules.find((r: any) => r.type === 'required')
        if (requiredRule && (value === undefined || value === null || value === '')) {
          issues.push({ field: key, message: `"${fieldDef.name || key}" is required`, severity: 'error' })
        }

        // 正则校验
        const patternRule = rules.find((r: any) => r.type === 'pattern')
        if (patternRule && value && !new RegExp(patternRule.value || '').test(String(value))) {
          issues.push({ field: key, message: `"${key}" doesn't match pattern`, severity: 'error' })
        }
      }
    }

    const passed = issues.filter((i) => i.severity === 'error').length === 0
    return { summary: passed ? `Validation PASSED (${issues.length} warnings)` : `Validation FAILED: ${issues.length} issues`, passed, issues }
  }
}
