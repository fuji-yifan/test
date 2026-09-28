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
    // form_assemble_schema: 处理 DeepSeek 各种传参格式
    if (name === 'form_assemble_schema') {
      // 模型偶尔用 placeholder 表达「提示文字」，而 tools 声明的参数名是 text。
      // placeholder 没写进 inputSchema（免得模型被诱导不用 text），所以在这里把它
      // 归一成 text —— 否则会被 zod 静默 strip，用户填的提示文字就凭空丢了。
      const withAliases = (fs: unknown) =>
        Array.isArray(fs)
          ? fs.map((f) =>
              f && typeof f === 'object' && !Array.isArray(f) && (f as any).text === undefined && typeof (f as any).placeholder === 'string'
                ? { ...(f as any), text: (f as any).placeholder }
                : f,
            )
          : fs
      if (Array.isArray(args.fields)) args = { ...args, fields: withAliases(args.fields) }

      if (!args.fields || !Array.isArray(args.fields)) {
        // args 中有数组值 → 作为 fields
        for (const [key, val] of Object.entries(args)) {
          // removeFields 也是数组，但它不是 fields —— 别把要删的 key 当成字段定义
          if (key === 'removeFields') continue
          if (Array.isArray(val) && val.length > 0) {
            // target / existingSchema 是编排层的寻址与注入通道，removeFields 是删除清单，
            // 拍平时都必须原样带上，否则寻址、合并、删除会同时失效
            // （DeepSeek 偶发拍平参数时就会踩到）。
            return {
              fields: withAliases(val),
              formTitle: args.formTitle || (args as any).form_title,
              labelPosition: args.labelPosition || (args as any).label_position,
              target: args.target,
              removeFields: args.removeFields ?? (args as any).remove_fields,
              existingSchema: args.existingSchema,
            }
          }
        }
        // args 中嵌套了 schema 对象 → 提取 fields
        for (const [key, val] of Object.entries(args)) {
          // existingSchema 也是「带 fields 的对象」，但它是编排层注入的当前草稿 ——
          // 把它当嵌套 schema 会把整张表回填成 fields，于是「只删两个字段」的调用
          // 变成「整表重写」（实测 summary 会多出「修改 N 个字段」这种假变更）。
          if (key === 'existingSchema') continue
          if (val && typeof val === 'object' && !Array.isArray(val) && Array.isArray((val as any).fields)) {
            return { ...args, fields: withAliases((val as any).fields), formTitle: args.formTitle || (val as any).formTitle || (val as any).settings?.formTitle }
          }
        }
        // 空参数 → 返回空 fields 让 LLM 看到错误（只给 removeFields 是合法调用，不塞空 fields）
        if (!args.fields && !args.removeFields) {
          return { ...args, fields: [] }
        }
      }
    }

    // form_validate_schema: DeepSeek 经常不按 schema 传参，尝试各种可能的格式
    if (name === 'form_validate_schema') {
      // 已正确传参
      if (args.schema && typeof args.schema === 'object') return args
      // schema 作为 JSON 字符串传入
      if (typeof args.schema === 'string') {
        try { return { schema: JSON.parse(args.schema) } } catch {}
      }
      // args 本身就是 schema（有 fields/version/settings）
      if (args.fields || args.version || args.settings) {
        return { schema: args }
      }
      // args 中某个值是对象且包含 fields → 作为 schema
      for (const [key, val] of Object.entries(args)) {
        if (val && typeof val === 'object' && !Array.isArray(val) && ((val as any).fields || (val as any).version)) {
          return { schema: val as Record<string, unknown> }
        }
      }
      // 完全没有可识别的内容 → 返回包含 args 的 schema 让 validate 自己报错
      if (Object.keys(args).length === 0 || (Object.keys(args).length === 1 && args.token)) {
        return { schema: args } // 空 schema，validate 会报告 missing fields
      }
    }

    // flow_create / flow_validate: DeepSeek 有时把 nodes/edges 拍平到顶层
    if ((name === 'flow_create' || name === 'flow_validate') && !args.nodes) {
      // 尝试从 args 中提取节点和边
      const extractedNodes: any[] = []
      const extractedEdges: any[] = []
      for (const [key, val] of Object.entries(args)) {
        if (Array.isArray(val)) {
          const first = val[0]
          if (first && typeof first === 'object') {
            if ('source' in first && 'target' in first) {
              extractedEdges.push(...val)
            } else if ('type' in first && ('id' in first || 'label' in first)) {
              extractedNodes.push(...val)
            }
          }
        }
      }
      if (extractedNodes.length > 0) {
        return { ...args, nodes: extractedNodes, edges: extractedEdges.length > 0 ? extractedEdges : (args.edges || []) }
      }
    }

    return args
  }
}
