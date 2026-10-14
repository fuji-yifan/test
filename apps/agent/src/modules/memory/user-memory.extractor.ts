import { Injectable, Logger } from '@nestjs/common'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { LangGraphLlmService } from '../llm/langgraph-llm.service'
import { parseExtraction } from './user-memory.pure'
import type { UserMemoryCandidate } from './user-memory.types'

/** 提取器输入：一段对话 + 本轮领域事实/产物（都由调用方从 session 与结果里凑）。 */
export interface ExtractionInput {
  recentTurns: { role: string; content: string }[]
  facts: Record<string, unknown>
  artifacts: unknown
}

/** 寒暄/过短轮不值得花一次模型调用：用户侧实质文字低于该长度直接跳过。 */
const MIN_USER_CHARS = 6

const SYSTEM = `你是用户长期记忆提取器。从下面这段「人机对话 + 领域事实 + 产物」里，抽取**跨会话仍然稳定有用**的、关于该用户本人的记忆。

只抽这四类：
- preference：偏好（语言、口径、风格、常用做法）
- identity：身份事实（姓名、公司、岗位、职责范围等）
- entity：常用对象（常用表单名、模板名、数据源等）
- conclusion：已确认的结论/决定（明确的业务规则、定下来的口径）

规则：
- 只记稳定的、可复用的信息；一次性的操作过程、寒暄、临时追问都不要。
- 不要记密码/口令/密钥/token/证件号/银行卡等敏感明文。
- key 是简短稳定标签（≤64 字），value 是标量文本（≤200 字）。
- 拿不准就少记，宁可空。
- 只输出 JSON 数组，形如 [{"kind":"preference","key":"...","value":"...","confidence":0.8}]，
  不要 markdown 围栏、不要解释。
- 没有任何可记的就输出 []。`

@Injectable()
export class UserMemoryExtractor {
  private readonly logger = new Logger(UserMemoryExtractor.name)

  constructor(private readonly llm: LangGraphLlmService) {}

  /**
   * 跑一次便宜模型提取。任何异常都返回 `[]`（拿不准就当没提取到），不影响本轮收尾。
   */
  async extract(input: ExtractionInput): Promise<UserMemoryCandidate[]> {
    const transcript = this.buildTranscript(input)
    if (!transcript) return []
    try {
      const res = await this.llm.chat.invoke([new SystemMessage(SYSTEM), new HumanMessage(transcript)])
      const raw = typeof res.content === 'string' ? res.content : JSON.stringify(res.content)
      return parseExtraction(raw)
    } catch (err) {
      this.logger.warn(`用户记忆提取失败：${(err as Error).message}`)
      return []
    }
  }

  /** 拼装提示词正文；噪声太多（没有实质用户发言）时返回 null 跳过。 */
  private buildTranscript(input: ExtractionInput): string | null {
    const userText = input.recentTurns
      .filter((t) => t.role === 'user')
      .map((t) => t.content)
      .join(' ')
      .trim()
    if (userText.length < MIN_USER_CHARS) return null

    const parts: string[] = []
    if (input.recentTurns.length) {
      parts.push('## 对话')
      parts.push(input.recentTurns.map((t) => `${t.role}: ${t.content}`).join('\n'))
    }
    const factKeys = Object.keys(input.facts ?? {})
    if (factKeys.length) {
      parts.push('## 领域事实')
      parts.push(
        factKeys
          .map((k) => `${k}: ${stringifyScalar((input.facts as Record<string, unknown>)[k])}`)
          .join('\n'),
      )
    }
    const artifactNames = artifactNamesOf(input.artifacts)
    if (artifactNames.length) {
      parts.push('## 产物')
      parts.push(artifactNames.join('\n'))
    }
    return parts.join('\n\n')
  }
}

/** 事实值只保留标量文本（对象/数组退化为 JSON 片段），避免提示词里塞大块结构。 */
function stringifyScalar(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  try {
    return JSON.stringify(v)
  } catch {
    return ''
  }
}

/** 从产物里捞名字类字段（表单名/模板名/流程名），给提取器当上下文。 */
function artifactNamesOf(artifacts: unknown): string[] {
  if (!artifacts || typeof artifacts !== 'object') return []
  const out: string[] = []
  for (const [agent, artifact] of Object.entries(artifacts as Record<string, unknown>)) {
    if (!artifact || typeof artifact !== 'object') continue
    const a = artifact as Record<string, unknown>
    const name = a.name ?? a.title ?? a.formName ?? a.templateName
    if (typeof name === 'string' && name.trim()) out.push(`${agent}: ${name.trim()}`)
  }
  return out
}
