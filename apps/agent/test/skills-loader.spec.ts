/**
 * 技能管理（阶段 7）：D1 frontmatter 解析 + D2 技能↔工具绑定校验。
 */
import { describe, expect, it } from 'vitest'
import { parseSkill } from '../src/modules/harness/skills.frontmatter'
import { SkillsLoader } from '../src/modules/harness/skills.loader'
import type { ToolRegistry } from '../src/modules/harness/tool.registry'

describe('parseSkill — D1 frontmatter 解析', () => {
  it('合法 frontmatter：各字段解析正确，且 body 已剥离 frontmatter', () => {
    const content = [
      '---',
      'name: Demo Agent',
      'description: 演示技能',
      'version: 2.0.0',
      'tools:',
      '  - tool_x',
      '  - tool_y',
      'scenarios:',
      '  - form-builder',
      'enabled: true',
      '---',
      '',
      '## 正文标题',
      '正文内容……',
    ].join('\n')

    const { meta, body } = parseSkill(content, 'demo.skill.md')
    expect(meta.name).toBe('Demo Agent')
    expect(meta.description).toBe('演示技能')
    expect(meta.version).toBe('2.0.0')
    expect(meta.toolNames).toEqual(['tool_x', 'tool_y'])
    expect(meta.scenarios).toEqual(['form-builder'])
    expect(meta.enabled).toBe(true)

    // 正文不能把元数据带进 prompt
    expect(body).toContain('## 正文标题')
    expect(body).not.toContain('name:')
    expect(body).not.toContain('---')
  })

  it('enabled: false 解析为 false', () => {
    const content = ['---', 'name: Off', 'tools: [t]', 'enabled: false', '---', 'body'].join('\n')
    expect(parseSkill(content, 'off.skill.md').meta.enabled).toBe(false)
  })

  it('缺省 enabled → true', () => {
    const content = ['---', 'name: On', 'tools: [t]', '---', 'body'].join('\n')
    expect(parseSkill(content, 'on.skill.md').meta.enabled).toBe(true)
  })

  it('旧格式（无 frontmatter）→ 回退正则，body = 全文', () => {
    const content = [
      '# Legacy Skill',
      '',
      'Description: 老格式技能',
      'Tools: ["tool_a", "tool_b"]',
      '',
      '---',
      '正文',
    ].join('\n')

    const { meta, body } = parseSkill(content, 'legacy.skill.md')
    expect(meta.name).toBe('Legacy Skill')
    expect(meta.description).toBe('老格式技能')
    expect(meta.toolNames).toEqual(['tool_a', 'tool_b'])
    // 回退路径保留原全文（与改造前行为一致）
    expect(body).toBe(content)
  })

  it('坏 YAML → 回退旧逻辑且不抛错', () => {
    const content = ['---', 'name: Bad', 'tools: [unclosed', '---', 'body'].join('\n')
    const res = parseSkill(content, 'bad.skill.md')
    // 解析失败 → name 落到文件名
    expect(res.meta.name).toBe('bad')
    expect(res.body).toBe(content)
  })
})

describe('SkillsLoader — D2 技能↔工具绑定校验', () => {
  // 4 个技能声明的全部工具（含 template_publish 已摘除后的集合）
  const ALL_TOOLS = [
    'form_search_field_pool',
    'form_assemble_schema',
    'form_validate_schema',
    'form_preview',
    'form_save',
    'data_list_forms',
    'data_query',
    'data_analyze',
    'template_search',
    'template_get_detail',
    'template_instantiate',
    'template_validate',
    'flow_create',
    'flow_validate',
    'flow_bind_form',
    'flow_preview',
    'flow_save',
    'flow_publish',
  ]
  const stubRegistry = (names: string[]): ToolRegistry =>
    ({ get: (n: string) => (names.includes(n) ? { name: n } : undefined) }) as unknown as ToolRegistry

  it('全套工具齐备 → 载入 4 个技能，loadFull 返回正文（不含 frontmatter）', () => {
    const loader = new SkillsLoader(stubRegistry(ALL_TOOLS))
    loader.onModuleInit()

    expect(loader.getAllMeta().length).toBe(4)
    const body = loader.loadFull('Form Designer Agent')
    expect(body).toBeTruthy()
    expect(body).toContain('字段来源策略')
    // 正文不再带 frontmatter 行
    expect(body).not.toContain('name: Form Designer Agent')
    expect(body).not.toContain('version:')
  })

  it('技能声明的工具未注册 → onModuleInit 抛错（dev/test fail-fast）', () => {
    const missingOne = ALL_TOOLS.filter((t) => t !== 'template_search')
    const loader = new SkillsLoader(stubRegistry(missingOne))
    expect(() => loader.onModuleInit()).toThrow(/未注册工具/)
  })
})
