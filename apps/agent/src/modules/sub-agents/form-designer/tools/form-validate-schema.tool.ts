import { Injectable } from '@nestjs/common'
import { Tool } from '../../../harness/tool.decorator'
import { z } from 'zod'

const ALLOWED_TYPES = [
  'input', 'textarea', 'input-number', 'select', 'radio', 'checkbox',
  'date-picker', 'switch', 'rate', 'slider', 'tip-text',
  'upload', 'rich-text', 'cascader', 'date-range-picker',
]

const ALLOWED_RULES = ['required', 'string', 'number', 'email', 'url', 'phone']

@Injectable()
@Tool({
  name: 'form_validate_schema',
  description: '校验生成的 FormSchema 是否合法。检查字段类型、必填规则、组件限制、联动规则语法。返回所有不合规项。',
  inputSchema: z.object({
    schema: z.record(z.unknown()).describe('要校验的 FormSchema 对象'),
  }),
  riskLevel: 'low',
})
export class FormValidateSchemaTool {
  async execute(args: { schema: Record<string, unknown> }): Promise<any> {
    const schema = args.schema
    const issues: Array<{ field?: string; path: string; message: string; severity: 'error' | 'warning' }> = []

    // 检查必填顶层字段
    if (!schema.fields || !Array.isArray(schema.fields)) {
      return { summary: 'Schema is invalid: missing "fields" array', passed: false, issues: [{ path: '$', message: 'Missing "fields" array', severity: 'error' }] }
    }

    const fields = schema.fields as any[]
    const seenKeys = new Set<string>()

    for (let i = 0; i < fields.length; i++) {
      const field = fields[i]

      // 检查 key 唯一性
      if (!field.key) {
        issues.push({ path: `$.fields[${i}]`, message: 'Missing field key', severity: 'error' })
      } else if (seenKeys.has(field.key)) {
        issues.push({ field: field.key, path: `$.fields[${i}]`, message: `Duplicate key: ${field.key}`, severity: 'error' })
      } else {
        seenKeys.add(field.key)
      }

      // 检查 name
      if (!field.name) {
        issues.push({ field: field.key, path: `$.fields[${i}]`, message: 'Missing field name', severity: 'error' })
      }

      // 检查 type 合法性
      if (!field.type || !ALLOWED_TYPES.includes(field.type)) {
        issues.push({
          field: field.key || field.name,
          path: `$.fields[${i}].type`,
          message: `Unknown field type: "${field.type}". Allowed: ${ALLOWED_TYPES.join(', ')}`,
          severity: 'error',
        })
      }

      // 检查 col 范围
      if (field.col !== undefined && (field.col < 1 || field.col > 24)) {
        issues.push({ field: field.name, path: `$.fields[${i}].col`, message: `col must be 1-24, got ${field.col}`, severity: 'warning' })
      }

      // 检查 rule type 合法性
      if (field.rules && Array.isArray(field.rules)) {
        for (const rule of field.rules) {
          if (!ALLOWED_RULES.includes(rule.type)) {
            issues.push({
              field: field.name || field.key,
              path: `$.fields[${i}].rules`,
              message: `Unknown rule type: "${rule.type}". Allowed: ${ALLOWED_RULES.join(', ')}`,
              severity: 'error',
            })
          }
        }
      }

      // 检查 select/radio/checkbox 有 options
      if (['select', 'radio', 'checkbox', 'cascader'].includes(field.type)) {
        const options = field.props?.options
        if (!options || !Array.isArray(options) || options.length === 0) {
          issues.push({
            field: field.name || field.key,
            path: `$.fields[${i}].props.options`,
            message: `Field type "${field.type}" requires props.options array with at least one {label, value}`,
            severity: 'error',
          })
        }
      }
    }

    // 检查 settings
    if (!schema.settings) {
      issues.push({ path: '$.settings', message: 'Missing settings object', severity: 'warning' })
    }

    const passed = issues.filter((i) => i.severity === 'error').length === 0
    const summary = passed
      ? `Schema validation PASSED: ${fields.length} fields, ${issues.length} warnings`
      : `Schema validation FAILED: ${issues.filter((i) => i.severity === 'error').length} errors, ${issues.filter((i) => i.severity === 'warning').length} warnings`

    return { summary, passed, issues }
  }
}
