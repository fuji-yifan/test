/**
 * 技能文件（*.skill.md）解析（阶段 7 / D1）。
 *
 * 对齐 Agent Skills 规范：文件头部用 YAML frontmatter 承载元数据，正文与元数据分离。
 *
 * 关键约束：loadFull() 返回的正文会被拼进各 sub-agent 的 system prompt，
 * 因此 **body 必须剥离 frontmatter** —— 否则 name/version 这些元数据会漏进提示词。
 *
 * 兼容性：老格式（首行 `# Title` + `Tools: [...]` + `Description:` 纯文本）没有
 * frontmatter，此时回退旧正则逻辑，body = 全文，行为与改造前完全一致。
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

/** 旧格式回退：无 frontmatter 或 YAML 解析失败时，沿用改造前的正则解析 */
function parseLegacy(content: string, filename: string): SkillMeta {
  const firstLine = content.split('\n')[0] || ''
  const nameMatch = firstLine.match(/^#\s+(.+)/)
  const name = nameMatch ? nameMatch[1].trim() : filename.replace('.skill.md', '')

  const toolMatch = content.match(/Tools:\s*\[([^\]]+)\]/)
  const toolNames = toolMatch
    ? toolMatch[1].split(',').map((t) => t.trim().replace(/"/g, '')).filter(Boolean)
    : []

  const descMatch = content.match(/Description:\s*(.+)/)
  const description = descMatch ? descMatch[1].trim() : name

  return { name, description, toolNames }
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
 * 有合法 frontmatter → 用 js-yaml 解析元数据，body = 闭合 `---` 之后的正文；
 * 无 frontmatter 或 YAML 抛错 → 回退旧正则逻辑（body = 原全文）。
 */
export function parseSkill(content: string, filename: string): ParsedSkill {
  const fm = splitFrontmatter(content)
  if (fm) {
    try {
      const raw = loadYaml(fm.yaml)
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
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
    } catch {
      // 坏 YAML → 静默回退，不让一个手滑的技能文件拖垮启动
    }
  }
  return { meta: parseLegacy(content, filename), body: content }
}
