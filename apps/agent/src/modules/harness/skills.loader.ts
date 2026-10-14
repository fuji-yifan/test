import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import * as fs from 'fs'
import * as path from 'path'
import { ToolRegistry } from './tool.registry'
import { parseSkill, type SkillMeta } from './skills.frontmatter'

export type { SkillMeta } from './skills.frontmatter'

export interface Skill {
  meta: SkillMeta
  /** 注入 prompt 的正文（阶段 7 / D1：已剥离 frontmatter） */
  fullContent: string
}

@Injectable()
export class SkillsLoader implements OnModuleInit {
  private readonly logger = new Logger(SkillsLoader.name)
  private skills: Map<string, Skill> = new Map()

  constructor(private readonly registry: ToolRegistry) {}

  /**
   * 延后到 onModuleInit：本方法依赖 ToolRegistry（它也在 onModuleInit 里填充）。
   * Nest 会先跑完被依赖 provider 的 onModuleInit，再跑本类 —— 这样读到的是已注册工具，
   * 才能校验技能声明的工具是否存在（阶段 7 / D2）。
   */
  onModuleInit(): void {
    this.loadAll()
  }

  private loadAll(): void {
    const skillsDir = path.join(process.cwd(), 'skills')
    if (!fs.existsSync(skillsDir)) {
      this.logger.warn(`Skills directory not found: ${skillsDir}`)
      return
    }

    /** 隔离问题清单：技能声明的工具未注册（写错工具名会静默失效，必须暴露） */
    const problems: string[] = []
    const files = fs.readdirSync(skillsDir).filter((f) => f.endsWith('.skill.md'))
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(skillsDir, file), 'utf-8')
        const { meta, body } = parseSkill(content, file)

        if (meta.enabled === false) {
          this.logger.log(`Skipped disabled skill: ${meta.name} (${file})`)
          continue
        }

        // D2：声明的工具必须都已注册，否则不登记该技能（隔离），并记入问题清单
        const missing = meta.toolNames.filter((t) => !this.registry.get(t))
        if (missing.length > 0) {
          problems.push(`${file}（${meta.name}）：未注册工具 ${missing.join(', ')}`)
          continue
        }

        this.skills.set(meta.name, { meta, fullContent: body })
        this.logger.log(`Loaded skill: ${meta.name} (${meta.toolNames.length} tools)`)
      } catch (err) {
        this.logger.warn(`Failed to load skill ${file}: ${(err as Error).message}`)
      }
    }

    if (problems.length > 0) {
      const msg = `技能声明的工具未注册，已隔离：\n${problems.join('\n')}`
      if (process.env.NODE_ENV !== 'production') {
        // dev/test fail-fast：写错工具名必须当场暴露，而不是运行时才发现某能力莫名不生效
        throw new Error(msg)
      }
      // 生产：喊一声并隔离，不让一个技能配置错误把整个应用拖垮
      this.logger.error(msg)
    }
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
