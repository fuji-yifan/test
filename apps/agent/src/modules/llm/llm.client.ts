import { Injectable, Logger } from '@nestjs/common'
import OpenAI from 'openai'
import { ChatMessage, ToolDef, CompletionResult, StreamChunk } from './llm.types'

@Injectable()
export class LlmClient {
  private client: OpenAI
  private model: string
  private readonly logger = new Logger(LlmClient.name)

  constructor() {
    this.client = new OpenAI({
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    })
    this.model = process.env.DEEPSEEK_MODEL || 'deepseek-chat'
    this.logger.log(`LLM client initialized: model=${this.model}, baseURL=${process.env.DEEPSEEK_BASE_URL}`)
  }

  getModel(): string {
    return this.model
  }

  async complete(params: {
    messages: ChatMessage[]
    tools?: ToolDef[]
    maxTokens?: number
    temperature?: number
  }): Promise<CompletionResult> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: params.messages as any,
      tools: params.tools?.length
        ? params.tools.map((t) => ({
            type: 'function' as const,
            function: {
              name: t.name,
              description: t.description,
              parameters: t.parameters,
            },
          }))
        : undefined,
      max_tokens: params.maxTokens,
      temperature: params.temperature,
    })

    const choice = response.choices[0]
    const msg = choice.message

    return {
      content: msg.content,
      toolCalls: (msg.tool_calls || []).map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments,
        },
      })),
      usage: {
        inputTokens: response.usage?.prompt_tokens || 0,
        outputTokens: response.usage?.completion_tokens || 0,
      },
    }
  }

  async *streamComplete(params: {
    messages: ChatMessage[]
    tools?: ToolDef[]
    maxTokens?: number
    signal?: AbortSignal
  }): AsyncGenerator<StreamChunk> {
    const stream = await this.client.chat.completions.create(
      {
        model: this.model,
        messages: params.messages as any,
        tools: params.tools?.length
          ? params.tools.map((t) => ({
              type: 'function' as const,
              function: {
                name: t.name,
                description: t.description,
                parameters: t.parameters,
              },
            }))
          : undefined,
        max_tokens: params.maxTokens,
        stream: true,
      },
      { signal: params.signal },
    )

    let currentToolCall: { id?: string; name?: string; arguments?: string } = {}

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta

      if (delta?.content) {
        yield { type: 'delta', delta: delta.content }
      }

      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (tc.id) currentToolCall.id = tc.id
          if (tc.function?.name) currentToolCall.name = tc.function.name
          if (tc.function?.arguments) {
            currentToolCall.arguments =
              (currentToolCall.arguments || '') + tc.function.arguments
          }
        }
      }

      // 当 tool call 完成时，emit
      if (chunk.choices[0]?.finish_reason === 'tool_calls' && currentToolCall.id) {
        yield {
          type: 'tool_call',
          toolCall: {
            id: currentToolCall.id,
            type: 'function',
            function: {
              name: currentToolCall.name || '',
              arguments: currentToolCall.arguments || '{}',
            },
          },
        }
      }
    }
  }
}
