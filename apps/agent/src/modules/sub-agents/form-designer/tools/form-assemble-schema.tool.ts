import { Injectable } from '@nestjs/common'
import { Tool } from '../../../harness/tool.decorator'
import { z } from 'zod'

// 简化的字段定义（DeepSeek 更容易生成）。
//
// 除 key 外全部 optional：这是「字段补丁」而不是「字段定义」—— 改一个已有字段时
// 只需给要改的属性，没给的属性由工具从原字段继承（见 mergeField）。
const simpleField = z.object({
  // id 是字段的稳定标识（阶段 5 / 5.3）：改已有字段（尤其是要改它的 key）时带上，
  // 工具就能认领旧字段而不是新建一个。新增字段不用填（id 由工具生成）。
  id: z.string().optional().describe('已有字段的 id（清单里的 id=）。改已有字段建议带上，改 key 时必须带'),
  key: z.string().optional().describe('字段标识，英文下划线。改已有字段时原样填它的 key；带 id 时可不填（保持原 key）'),
  name: z.string().optional().describe('字段标签，中文显示名。新增字段必填；改已有字段不传即保持不变'),
  type: z.string().optional().describe('控件类型: input/textarea/input-number/select/radio/checkbox/date-picker/date-range-picker/switch/rate/file-upload/rich-text/cascader/tip-text。新增字段必填；改已有字段不传即保持不变'),
  required: z.boolean().optional().describe('是否必填。不传 = 保持原样（把必填改成不必填要显式传 false）'),
  options: z.array(z.object({ label: z.string(), value: z.string() })).optional().describe('选项(仅select/radio/checkbox)。不传 = 保持原选项；传了 = 整体替换（要加一项就把原有项一并列出）'),
  text: z.string().optional().describe('tip-text控件的显示文本内容 / input的placeholder提示文字。不传 = 保持原样'),
})

/** 只有这几种控件吃 options；类型改成别的时要顺手把残留选项去掉 */
const OPTION_TYPES = new Set(['select', 'radio', 'checkbox'])

@Injectable()
@Tool({
  name: 'form_assemble_schema',
  description:
    '生成或修改表单Schema。新增字段必填: key(英文标识)、name(中文标签)、type(控件类型)。修改已有字段时只给要改的属性即可，没给的属性（选项、必填、placeholder）保持原样；要改已有字段的 key 时必须带上该字段的 id（清单里的 id=），否则会被当成新字段。删除字段用 removeFields。',
  inputSchema: z.object({
    fields: z
      .array(simpleField)
      .optional()
      .describe('要新增或修改的字段。只放要新增的字段和要改的字段，不要回传整张表。'),
    formTitle: z.string().optional().describe('表单标题'),
    // 目标寻址：编排层据此决定给不给 existingSchema（进而决定这是改表还是建表）。
    // 必须声明进 inputSchema，否则 zodToSchema 生成的 JSON Schema 里没有它，模型看不到。
    target: z
      .string()
      .optional()
      .describe('要修改的表单：填【会话中的表单】里那张表的 key 或标题；要做一张新表则填新表名。新表必须传。'),
    // 「删」与「改」结构上不可分（「回 17 个里的 10 个」是精简，「回 1 个」可能只是改一个字段），
    // 所以删除必须显式声明成一份要删的 key 清单。用「要删的 key」而不是「要留的字段」，
    // 是为了让模型永远不必回抄整张表 —— 回抄是唯一会丢配置的操作。
    removeFields: z
      .array(z.string())
      .optional()
      .describe('要删除的字段 key 列表。用户要求精简/删除字段时填这里（填**要删的**那几个 key，不要列要保留的）。'),
    // 由编排层注入（不是模型给的参数）：当前会话里已有的表单结构。
    // 有值时按 key 合并，避免模型只回传「新增字段」把原有字段整表覆盖掉。
    existingSchema: z.any().optional().describe('编排层注入：当前已有表单，用于合并'),
  }),
  riskLevel: 'low',
  // 结果校验（阶段 6 / S7.3）：组装的产物必须带 schema，否则不喂给模型（fail-closed）。
  outputSchema: z.object({ schema: z.record(z.unknown()) }).passthrough(),
})
export class FormAssembleSchemaTool {
  async execute(args: {
    fields?: Array<{ id?: string; key?: string; name?: string; type?: string; required?: boolean; options?: Array<{ label: string; value: string }>; text?: string }>
    formTitle?: string
    target?: string
    removeFields?: string[]
    existingSchema?: Record<string, unknown>
  }): Promise<any> {
    const existing = args.existingSchema as { fields?: unknown[]; settings?: Record<string, unknown> } | undefined
    const existingFields = Array.isArray(existing?.fields) ? (existing!.fields as any[]) : []
    // 字段身份：key 优先、空 key 退回 id（布局控件 key 为 ''，只能靠 id 寻址）
    const idOf = (f: any): string => (typeof f?.key === 'string' && f.key) || (typeof f?.id === 'string' && f.id) || ''
    // 两张索引：稳定 id（跨改 key 仍能命中）+ key（回退，兼容模型只填 key 的老习惯）
    const byId = new Map<string, any>()
    const byKey = new Map<string, any>()
    for (const f of existingFields) {
      if (typeof f?.id === 'string' && f.id) byId.set(f.id, f)
      if (typeof f?.key === 'string' && f.key) byKey.set(f.key, f)
    }

    const removeSet = new Set(
      (args.removeFields ?? []).filter((k): k is string => typeof k === 'string' && !!k.trim()).map((k) => k.trim()),
    )
    const isRemoved = (f: any): boolean =>
      (typeof f?.key === 'string' && !!f.key && removeSet.has(f.key)) ||
      (typeof f?.id === 'string' && !!f.id && removeSet.has(f.id))

    // 分成「改已有」与「加新的」两拨：前者继承原字段，后者才需要完整定义
    const patches = new Map<string, any>()
    const fresh: any[] = []
    for (const r of args.fields ?? []) {
      if (!r?.key && !r?.id) throw new Error('fields 里有条目既没有 key 也没有 id')
      // 同一次调用里既删又改同一条 → 以删为准
      if ((r.key && removeSet.has(r.key)) || (r.id && removeSet.has(r.id))) continue
      // 先按 id 命中（改 key 靠它），再回退按 key 命中
      const target = (r.id && byId.get(r.id)) || (r.key && byKey.get(r.key))
      if (target) {
        if (isRemoved(target)) continue
        patches.set(idOf(target), r)
        continue
      }
      if (!r.name || !r.type) {
        throw new Error(`新字段 ${r.key || r.id} 必须同时给出 name 与 type（改已有字段才可以只传要改的属性）`)
      }
      if (!r.key) throw new Error(`新字段 ${r.id} 必须给出 key`)
      fresh.push({ ...r, name: r.name, type: r.type })
    }

    const fields: any[] = []
    let updated = 0
    let removed = 0
    for (const f of existingFields) {
      if (isRemoved(f)) {
        removed++
        continue
      }
      const patch = patches.get(idOf(f))
      if (patch) {
        fields.push(this.mergeField(f, patch))
        updated++
        continue
      }
      fields.push(f)
    }
    for (const r of fresh) fields.push(this.buildField(r as any))

    // removeFields 里点了不存在的 key/id：说清楚，免得模型以为删掉了
    const missed = [...removeSet].filter((k) => !byKey.has(k) && !byId.has(k))

    const schema = {
      fields,
      version: 1,
      settings: {
        canvasCols: 24,
        labelPosition: 'left',
        ...(existing?.settings ?? {}),
        formTitle:
          args.formTitle ||
          (existing?.settings as any)?.formTitle ||
          '新建表单',
      },
    }

    const changes: string[] = []
    if (fresh.length > 0) changes.push(`新增 ${fresh.length} 个字段`)
    if (updated > 0) changes.push(`修改 ${updated} 个字段`)
    if (removed > 0) changes.push(`删除 ${removed} 个字段`)
    if (missed.length > 0) changes.push(`未找到要删除的 ${missed.join('、')}`)

    const summary =
      existingFields.length === 0
        ? `已生成表单"${schema.settings.formTitle}"，包含 ${fields.length} 个字段`
        : `已更新表单"${schema.settings.formTitle}"，${changes.length ? `${changes.join('，')}，` : ''}共 ${fields.length} 个字段`

    return { summary, schema }
  }

  /** 新字段的完整构造（首次创建时每个字段都走这里） */
  private buildField(f: { key?: string; name?: string; type?: string; required?: boolean; options?: any[]; text?: string }): any {
    const type = f.type as string
    const props: Record<string, unknown> = {}
    if (f.options) props.options = f.options
    this.applyText(props, type, f.text)
    return {
      id: `field_${this.nanoid()}`,
      col: type === 'tip-text' ? 24 : 12,
      key: f.key,
      name: f.name,
      type,
      props,
      rules: f.required ? [{ type: 'required', message: `请填写${f.name}` }] : [],
    }
  }

  /**
   * 把一个字段补丁合进已有字段：**以原字段为底，只覆盖模型显式给出的属性**。
   *
   * 这里是「模型不必回抄整张表」的落点。模型看不见或懒得重述的属性（选项、
   * 必填、placeholder、col 等）一律原样保留 —— 实测模型在精简字段时只回
   * key/name/type，若像以前那样整体替换，select 的 options 和 rules 会整片丢失。
   */
  private mergeField(prev: any, patch: any): any {
    const next: any = { ...prev } // 保留 id / col / props / rules 以及编辑器的其它属性
    // 按 id 命中时允许改 key（阶段 5 / 5.3）：靠 patch.key 与 prev.key 的差异触发，
    // 按 key 命中时两者相同 → 等价于不动。id 始终沿用 prev，绝不换（换 id 等于换字段）。
    if (patch.key !== undefined && patch.key !== '' && patch.key !== prev.key) next.key = patch.key
    if (patch.name !== undefined) next.name = patch.name
    if (patch.type !== undefined) next.type = patch.type

    const props: Record<string, unknown> = { ...(prev.props ?? {}) }
    if (patch.options !== undefined) {
      if (Array.isArray(patch.options) && patch.options.length > 0) props.options = patch.options
      else delete props.options
    }
    // 类型改成不吃选项的控件时，别把旧选项留成僵尸
    const finalType = next.type as string
    if (patch.type !== undefined && !OPTION_TYPES.has(finalType)) delete props.options
    if (patch.text !== undefined) this.applyText(props, finalType, patch.text)
    next.props = props

    if (patch.required !== undefined) {
      next.rules = patch.required ? [{ type: 'required', message: `请填写${next.name}` }] : []
    }
    return next
  }

  /** text 参数在不同控件上落到不同属性（与 buildField 共用，保持两条路径口径一致） */
  private applyText(props: Record<string, unknown>, type: string | undefined, text?: string): void {
    if (text === undefined || text === '') return
    if (type === 'tip-text') {
      props.text = text
      props.color = '#606266'
      props.fontSize = '14px'
      return
    }
    if (type === 'input' || type === 'textarea') props.placeholder = text
  }

  private nanoid(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
    let result = ''
    for (let i = 0; i < 8; i++) result += chars[Math.floor(Math.random() * chars.length)]
    return result
  }
}
