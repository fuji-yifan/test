import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { DiscoveryService } from '@nestjs/core'
import { InstanceWrapper } from '@nestjs/core/injector/instance-wrapper'
import { ZodType } from 'zod'
import { TOOL_META, ToolMeta } from './tool.decorator'
import { ToolDef } from '../llm/llm.types'

// ---- 极简 zod → JSON Schema 转换器 ----
// 替代 zod-to-json-schema，该库在 TS 5.9 下有 TS2589 问题。
// 我们只用到基础类型，无需引入外部依赖的复杂泛型。

function zodToSchema(schema: ZodType): Record<string, unknown> {
  return describeZod(schema)
}

function describeZod(schema: any): any {
  const def = schema._def
  if (!def) return { type: 'string' }

  const typeName = def.typeName || schema.constructor?.name
  const desc = schema.description

  const d = (obj: Record<string, unknown>) => {
    if (desc && !obj.description) obj.description = desc
    return obj
  }

  switch (typeName) {
    case 'ZodString':
      return d({ type: 'string' })
    case 'ZodNumber':
      return d({ type: 'number' })
    case 'ZodBoolean':
      return d({ type: 'boolean' })
    case 'ZodEnum':
      return d({ type: 'string', enum: def.values })
    case 'ZodArray':
      return d({ type: 'array', items: describeZod(def.type) })
    case 'ZodObject': {
      const shape = def.shape()
      const properties: Record<string, any> = {}
      const required: string[] = []
      for (const [key, value] of Object.entries(shape)) {
        const fieldSchema = value as any
        properties[key] = describeZod(fieldSchema)
        if (fieldSchema._def?.typeName !== 'ZodOptional') {
          required.push(key)
        }
      }
      const result: Record<string, any> = { type: 'object', properties }
      if (required.length > 0) result.required = required
      return d(result)
    }
    case 'ZodOptional':
      return describeZod(def.innerType)
    case 'ZodNullable':
      return d({ ...describeZod(def.innerType), nullable: true })
    case 'ZodDefault':
      return describeZod(def.innerType)
    case 'ZodRecord':
      return d({ type: 'object', additionalProperties: describeZod(def.valueType) })
    case 'ZodUnion': {
      const options = def.options || []
      const firstNonNull = options.find((o: any) => o._def?.typeName !== 'ZodNull')
      if (firstNonNull) return describeZod(firstNonNull)
      return { type: 'string' }
    }
    case 'ZodEffects':
      return describeZod(def.schema)
    case 'ZodPipeline':
      return describeZod(def.in)
    case 'ZodNativeEnum':
      return d({ type: 'string', enum: Object.values(def.values) })
    default:
      return desc ? { type: 'string', description: desc } : { type: 'string' }
  }
}

// ---- 类型 ----
export interface RegisteredTool {
  name: string
  description: string
  riskLevel: 'low' | 'medium' | 'high' | 'critical'
  parameters: Record<string, unknown>
  zodSchema: ZodType
  instance: any
}

// ---- Registry ----
@Injectable()
export class ToolRegistry implements OnModuleInit {
  private readonly logger = new Logger(ToolRegistry.name)
  private tools: Map<string, RegisteredTool> = new Map()

  constructor(private discoveryService: DiscoveryService) {}

  onModuleInit(): void {
    const providers = this.discoveryService.getProviders()
    for (const wrapper of providers) {
      const meta = this.getToolMeta(wrapper)
      if (!meta) continue
      const instance = wrapper.instance
      if (!instance) continue

      this.tools.set(meta.name, {
        name: meta.name,
        description: meta.description,
        riskLevel: meta.riskLevel,
        parameters: zodToSchema(meta.inputSchema),
        zodSchema: meta.inputSchema,
        instance,
      })
      this.logger.log(`Registered tool: ${meta.name} (risk: ${meta.riskLevel})`)
    }
  }

  private getToolMeta(wrapper: InstanceWrapper): ToolMeta | null {
    try {
      return Reflect.getMetadata(TOOL_META, wrapper.metatype || wrapper.instance?.constructor) || null
    } catch {
      return null
    }
  }

  list(): ToolDef[] {
    return Array.from(this.tools.values()).map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }))
  }

  listByNames(names: string[]): ToolDef[] {
    const set = new Set(names)
    return this.list().filter((t) => set.has(t.name))
  }

  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name)
  }

  async call(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ ok: boolean; summary: string; data?: unknown; error?: string }> {
    const tool = this.tools.get(name)
    if (!tool) {
      return { ok: false, summary: `Unknown tool: ${name}`, error: 'tool_not_found' }
    }

    // 修复 DeepSeek 常见的参数格式问题
    const fixedArgs = this.fixupArgs(name, args)

    let parsed: any
    try {
      const schema = (tool.zodSchema as any).passthrough
        ? (tool.zodSchema as any).passthrough()
        : tool.zodSchema
      parsed = schema.parse(fixedArgs)
    } catch (err: any) {
      // 提取字段级别的错误信息，帮 LLM 修正
      const issues = err.issues
        ? err.issues.map((i: any) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
        : err.message
      return { ok: false, summary: `参数错误：${issues}。请按正确格式重试。`, error: 'validation_error' }
    }

    try {
      const result = await tool.instance.execute(parsed)
      return { ok: true, summary: result.summary || 'OK', data: result }
    } catch (err: any) {
      return { ok: false, summary: `Tool ${name} failed: ${err.message}`, error: 'execution_error' }
    }
  }

  getRisk(name: string): 'low' | 'medium' | 'high' | 'critical' {
    return this.tools.get(name)?.riskLevel || 'low'
  }

  /**
   * 修复 DeepSeek function calling 常见的参数格式问题：
   * - 嵌套参数被拍平（如直接传 fields 数组而不是 { fields: [...] }）
   * - 参数名大小写/下划线差异
   */
  private fixupArgs(name: string, args: Record<string, unknown>): Record<string, unknown> {
    // form_assemble_schema: 如果 args 中有数组但不是 fields，尝试提取
    if (name === 'form_assemble_schema') {
      if (!args.fields) {
        // 查找 args 中的数组值作为 fields
        for (const [key, val] of Object.entries(args)) {
          if (Array.isArray(val)) {
            return { fields: val, formTitle: args.formTitle || args.form_title, labelPosition: args.labelPosition || args.label_position }
          }
        }
        // DeepSeek 有时把整个结构拍平：{ field1: {...}, field2: {...} }
        // 给 LLM 返回明确错误让它修正
      }
    }

    // form_validate_schema: 如果 args 整体看起来像 schema 对象但没有 schema 键
    if (name === 'form_validate_schema') {
      if (!args.schema && !args.schema_json) {
        // 检查 args 本身是否就是 schema（含 fields 数组）
        if (args.fields || args.version || args.settings) {
          return { schema: args }
        }
      }
      // 统一 schema_json → schema
      if ((args as any).schema_json && !args.schema) {
        return { ...args, schema: (args as any).schema_json }
      }
    }

    return args
  }
}
