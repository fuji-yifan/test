import { Injectable, Logger } from '@nestjs/common'
import * as fs from 'fs'
import * as path from 'path'

export interface SkillMeta {
  name: string
  description: string
  toolNames: string[]
}

export interface Skill {
  meta: SkillMeta
  fullContent: string
}

@Injectable()
export class SkillsLoader {
  private readonly logger = new Logger(SkillsLoader.name)
  private skills: Map<string, Skill> = new Map()

  constructor() {
    this.loadAll()
  }

  private loadAll(): void {
    const skillsDir = path.join(process.cwd(), 'skills')
    if (!fs.existsSync(skillsDir)) {
      this.logger.warn(`Skills directory not found: ${skillsDir}`)
      return
    }

    const files = fs.readdirSync(skillsDir).filter((f) => f.endsWith('.skill.md'))
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(skillsDir, file), 'utf-8')
        const meta = this.parseMeta(content, file)
        this.skills.set(meta.name, { meta, fullContent: content })
        this.logger.log(`Loaded skill: ${meta.name} (${meta.toolNames.length} tools)`)
      } catch (err) {
        this.logger.warn(`Failed to load skill ${file}: ${(err as Error).message}`)
      }
    }
  }

  private parseMeta(content: string, filename: string): SkillMeta {
    const firstLine = content.split('\n')[0] || ''
    const nameMatch = firstLine.match(/^#\s+(.+)/)
    const name = nameMatch ? nameMatch[1].trim() : filename.replace('.skill.md', '')

    const toolMatch = content.match(/Tools:\s*\[([^\]]+)\]/)
    const toolNames = toolMatch
      ? toolMatch[1].split(',').map((t) => t.trim().replace(/"/g, ''))
      : []

    const descMatch = content.match(/Description:\s*(.+)/)
    const description = descMatch ? descMatch[1].trim() : name

    return { name, description, toolNames }
  }

  /** 获取所有 Skill 元数据（常驻 system prompt，~500 tokens） */
  getAllMeta(): SkillMeta[] {
    return Array.from(this.skills.values()).map((s) => s.meta)
  }

  /** 按名称加载完整 Skill 内容（按需，末尾追加） */
  loadFull(name: string): string | null {
    const skill = this.skills.get(name)
    return skill ? skill.fullContent : null
  }
}
