import { SetMetadata, applyDecorators } from '@nestjs/common'
import { ZodType } from 'zod'

export const TOOL_META = 'agent:tool'

export interface ToolMeta {
  name: string
  description: string
  inputSchema: ZodType
  riskLevel: 'low' | 'medium' | 'high' | 'critical'
}

export const Tool = (meta: ToolMeta) => applyDecorators(SetMetadata(TOOL_META, meta))
