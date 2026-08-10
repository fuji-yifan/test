import { Injectable } from '@nestjs/common'
import { Tool } from '../../../harness/tool.decorator'
import { z } from 'zod'

// 简化的字段定义（DeepSeek 更容易生成）
const simpleField = z.object({
  key: z.string().describe('字段标识，英文下划线'),
  name: z.string().describe('字段标签，中文显示名'),
  type: z.string().describe('控件类型: input/textarea/input-number/select/radio/checkbox/date-picker/switch/rate/file-upload/tip-text'),
  required: z.boolean().optional().describe('是否必填'),
  options: z.array(z.object({ label: z.string(), value: z.string() })).optional().describe('选项(仅select/radio/checkbox)'),
  text: z.string().optional().describe('tip-text控件的显示文本内容 / input的placeholder提示文字'),
})

@Injectable()
@Tool({
  name: 'form_assemble_schema',
  description: '生成表单Schema。字段必填: key(英文标识)、name(中文标签)、type(控件类型)。可选: required、options(仅select/radio/checkbox, 格式[{label,value}])、text(tip-text的显示内容/input的placeholder)',
  inputSchema: z.object({
    fields: z.array(simpleField).describe('字段定义数组，每个字段必须有 key, name, type'),
    formTitle: z.string().optional().describe('表单标题'),
  }),
  riskLevel: 'low',
})
export class FormAssembleSchemaTool {
  async execute(args: {
    fields: Array<{ key: string; name: string; type: string; required?: boolean; options?: Array<{ label: string; value: string }>; text?: string }>
    formTitle?: string
  }): Promise<any> {
    const schema = {
      fields: (args.fields || []).map((f) => {
        const props: Record<string, unknown> = {}
        if (f.options) props.options = f.options
        if (f.type === 'tip-text' && f.text) {
          props.text = f.text
          props.color = '#606266'
          props.fontSize = '14px'
        }
        if ((f.type === 'input' || f.type === 'textarea') && f.text) {
          props.placeholder = f.text
        }
        return {
          id: `field_${this.nanoid()}`,
          col: f.type === 'tip-text' ? 24 : 12,
          key: f.key,
          name: f.name,
          type: f.type,
          props,
          rules: f.required ? [{ type: 'required', message: `请填写${f.name}` }] : [],
        }
      }),
      version: 1,
      settings: {
        formTitle: args.formTitle || '新建表单',
        canvasCols: 24,
        labelPosition: 'left',
      },
    }

    return {
      summary: `已生成表单"${args.formTitle || '新建表单'}"，包含 ${schema.fields.length} 个字段`,
      schema,
    }
  }

  private nanoid(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
    let result = ''
    for (let i = 0; i < 8; i++) result += chars[Math.floor(Math.random() * chars.length)]
    return result
  }
}
