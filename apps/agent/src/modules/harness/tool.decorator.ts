import { SetMetadata, applyDecorators } from '@nestjs/common'
import { ZodType } from 'zod'

export const TOOL_META = 'agent:tool'

export interface ToolMeta {
  name: string
  description: string
  inputSchema: ZodType
  riskLevel: 'low' | 'medium' | 'high' | 'critical'
  /**
   * 工具**结果**的校验 schema（阶段 6 / S7.3，可选）。
   * 声明后，`ToolRegistry.call` 会在 execute 之后 fail-closed 校验；非法结果不喂给模型。
   * 用宽松 schema（`.passthrough()`）只断言关键字段，避免误伤。
   */
  outputSchema?: ZodType
}

export const Tool = (meta: ToolMeta) => applyDecorators(SetMetadata(TOOL_META, meta))
