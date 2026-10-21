/**
 * 技能文件（*.skill.md）解析（阶段 7 / D1）。
 *
 * 对齐 Agent Skills 规范：文件头部用 YAML frontmatter 承载元数据，正文与元数据分离。
 *
 * 关键约束：loadFull() 返回的正文会被拼进各 sub-agent 的 system prompt，
 * 因此 **body 必须剥离 frontmatter** —— 否则 name/version 这些元数据会漏进提示词。
 *
 * 无 frontmatter / YAML 非法的技能文件直接抛错，由 SkillsLoader 捕获后跳过。
 */
import { load as loadYaml } from 'js-yaml'

export interface SkillMeta {
  name: string
  description: string
  toolNames: string[]
  /** 规范 frontmatter 可选字段 */
  version?: string
  /** 该技能适用的页面场景（informational） */
  scenarios?: string[]
  /** 是否启用（缺省 true；false 时加载器跳过该技能） */
  enabled?: boolean
}

export interface ParsedSkill {
  meta: SkillMeta
  /** 注入 prompt 的正文（frontmatter 已剥离） */
  body: string
}

/** YAML 里的字符串列表：既接受真正的数组，也接受逗号分隔的字符串 */
function toStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean)
  if (typeof v === 'string') {
    return v
      .split(',')
      .map((x) => x.trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean)
  }
  return []
}

/** 拆出 frontmatter 区块与正文；首行不是 `---` 或无闭合 `---` 时返回 null */
function splitFrontmatter(content: string): { yaml: string; body: string } | null {
  const normalized = content.replace(/^\uFEFF/, '')
  const lines = normalized.split('\n')
  if (lines[0].trim() !== '---') return null
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      return {
        yaml: lines.slice(1, i).join('\n'),
        // 剥掉闭合标记后的正文；去掉紧随其后的空行，避免 prompt 顶部空一大块
        body: lines.slice(i + 1).join('\n').replace(/^[\r\n]+/, ''),
      }
    }
  }
  return null
}

/**
 * 解析技能文件为 { meta, body }。
 *
 * 必须有合法 frontmatter：用 js-yaml 解析元数据，body = 闭合 `---` 之后的正文。
 * 缺失或非法时抛错，由调用方捕获并跳过该技能。
 */
export function parseSkill(content: string, filename: string): ParsedSkill {
  const fm = splitFrontmatter(content)
  if (!fm) {
    throw new Error('缺少合法 frontmatter（文件需以 --- 开头并用 --- 闭合）')
  }

  let raw: unknown
  try {
    raw = loadYaml(fm.yaml)
  } catch (err) {
    throw new Error(`frontmatter YAML 解析失败: ${(err as Error).message}`)
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('frontmatter 必须是 YAML 对象')
  }

  const obj = raw as Record<string, unknown>
  const fallbackName = filename.replace('.skill.md', '')
  const name =
    typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim() : fallbackName
  const description =
    typeof obj.description === 'string' && obj.description.trim()
      ? obj.description.trim()
      : name

  const meta: SkillMeta = { name, description, toolNames: toStringArray(obj.tools) }
  if (typeof obj.version === 'string') meta.version = obj.version
  const scenarios = toStringArray(obj.scenarios)
  if (scenarios.length > 0) meta.scenarios = scenarios
  meta.enabled = obj.enabled === undefined ? true : obj.enabled !== false

  return { meta, body: fm.body }
}
