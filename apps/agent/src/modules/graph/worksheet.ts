/**
 * 会话级表单工作台（worksheet）：让一段对话能同时管多张表。
 *
 * 背景：原先的「草稿」是单槽位的（`drafts['form-designer'].data.schema` 一个 schema），
 * 工作台只有一个模型：「当前这张表」。后果是——同会话再建一张新表，工具会按 key 把
 * 旧表合并进来（9 → 19 字段混表）；「同时建两张表」根本表达不出来。
 *
 * 这里把「当前这张表」升级成一份**多表清单 + 一个聚焦指针**，并引入**显式的目标寻址**：
 * 模型在 `target` 参数里说清它在动哪张表（填 key 或标题），编排层据此决定给不给
 * `existingSchema`、带不带 `formId`。寻址是纯函数，便于单测，也让「按本次调用的目标注入」
 * 取代原先「按会话里有什么注入」。
 */

/** 工作台里的一张表 */
export interface WorksheetEntry {
  /** 会话内短 id，'f1' / 'f2'，模型在 target 里引用 */
  key: string
  /** 显示标题（一般等于 schema.settings.formTitle） */
  title: string
  /** 完整 schema，合并与产物都用它 */
  schema: Record<string, unknown>
  /** 已落库的表单 id */
  formId?: string
}

/** 一份会话工作台 */
export interface FormWorksheet {
  forms: WorksheetEntry[]
  /** 最近创建/修改的那张表 */
  focusKey: string | null
}

/** target 的解析结论 */
export type TargetResolution =
  /** target 命中某张已有表（key 或标题） */
  | { kind: 'update'; key: string }
  /** 有 target 但无人命中（用户点名做新表），或没有 target 且工作台为空 */
  | { kind: 'create'; key: string; title: string }
  /** 没有 target 但有 focusKey：保留「再加一个字段」的既有体验，作兜底 */
  | { kind: 'focus'; key: string }
  /** 命中多张（重名表） */
  | { kind: 'ambiguous'; keys: string[] }

export const MAX_FORMS_IN_BLOCK = 8
export const MAX_FIELDS_PER_FORM = 40
export const MAX_OPTIONS_PER_FIELD = 12

/** 一张空工作台（工厂而非共享常量，避免被意外改写） */
export function emptyWorksheet(): FormWorksheet {
  return { forms: [], focusKey: null }
}

export function entryOf(
  ws: FormWorksheet | undefined | null,
  key: string,
): WorksheetEntry | undefined {
  return ws?.forms.find((f) => f.key === key)
}

/** schema 上的表单标题 */
export function schemaTitle(schema: unknown): string {
  const t = (schema as any)?.settings?.formTitle
  return typeof t === 'string' && t.trim() ? t.trim() : ''
}

function fieldCountOf(schema: unknown): number {
  const fields = (schema as any)?.fields
  return Array.isArray(fields) ? fields.length : 0
}

/**
 * 标题归一化，供寻址时做宽松比对。
 * 去掉「表单」「表」「的」与空白 —— 用户说「客户登记表」还是「客户登记」应当都命中。
 */
function normTitle(raw: string): string {
  return raw
    .trim()
    .replace(/表单/g, '')
    .replace(/的/g, '')
    .replace(/表/g, '')
    .replace(/\s+/g, '')
    .toLowerCase()
}

/** 生成工作台里下一个可用短 id（f1 / f2 / …） */
function nextKey(ws: FormWorksheet): string {
  let max = 0
  for (const f of ws.forms) {
    const m = /^f(\d+)$/.exec(f.key)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `f${max + 1}`
}

/**
 * 解析本次工具调用的目标。
 *
 * 优先级：key 精确 → 标题精确 → 标题包含。都不中则视为「做一张新表」。
 * 没有 target 时退回 focusKey（保住「再加一个字段」）；工作台为空则也是新建。
 */
export function resolveFormTarget(
  target: string | undefined | null,
  ws: FormWorksheet | undefined | null,
): TargetResolution {
  const sheet = ws ?? emptyWorksheet()
  const raw = typeof target === 'string' ? target.trim() : ''

  if (!raw) {
    if (sheet.focusKey && entryOf(sheet, sheet.focusKey)) {
      return { kind: 'focus', key: sheet.focusKey }
    }
    return { kind: 'create', key: nextKey(sheet), title: '' }
  }

  // 1) key 精确（模型照表清单里的 key 寻址）
  const byKey = entryOf(sheet, raw)
  if (byKey) return { kind: 'update', key: byKey.key }

  // 2) 标题精确（重名 → ambiguous）
  const normTarget = normTitle(raw)
  if (normTarget) {
    const exact = sheet.forms.filter((f) => normTitle(f.title) === normTarget)
    if (exact.length === 1) return { kind: 'update', key: exact[0].key }
    if (exact.length > 1) return { kind: 'ambiguous', keys: exact.map((f) => f.key) }

    // 3) 标题包含（「客户登记」↔「客户登记表」）
    const loose = sheet.forms.filter((f) => {
      const t = normTitle(f.title)
      return !!t && (t.includes(normTarget) || normTarget.includes(t))
    })
    if (loose.length === 1) return { kind: 'update', key: loose[0].key }
    if (loose.length > 1) return { kind: 'ambiguous', keys: loose.map((f) => f.key) }
  }

  // 4) 有 target 但没人命中 —— 用户点名要做新表
  return { kind: 'create', key: nextKey(sheet), title: raw }
}

/** 本次解析指向的工作台 entry key（ambiguous 先取最先命中的那张，见 plan 的边界说明） */
export function targetKeyOf(resolved: TargetResolution): string {
  return resolved.kind === 'ambiguous' ? resolved.keys[0] : resolved.key
}

/**
 * 登记一次 assemble 的产物（不可变更新）。
 * update/focus → 覆盖对应表的 schema；create → 追加新表。返回的新工作台聚焦到这张。
 */
export function applyAssemble(
  ws: FormWorksheet,
  resolved: TargetResolution,
  schema: Record<string, unknown>,
): FormWorksheet {
  const key = targetKeyOf(resolved)
  const existing = entryOf(ws, key)
  const title = schemaTitle(schema) || existing?.title || '新建表单'
  const entry: WorksheetEntry = existing
    ? { ...existing, title, schema }
    : { key, title, schema }

  return {
    forms: existing ? ws.forms.map((f) => (f.key === key ? entry : f)) : [...ws.forms, entry],
    focusKey: key,
  }
}

/** 登记一次保存：把 formId 记到对应表上 */
export function markSaved(
  ws: FormWorksheet,
  resolved: TargetResolution,
  formId: string,
): FormWorksheet {
  const key = targetKeyOf(resolved)
  return {
    forms: ws.forms.map((f) => (f.key === key ? { ...f, formId } : f)),
    focusKey: key,
  }
}

/** 工作台里聚焦的那张表（focusKey 失效时退回最后一张） */
export function focusEntry(ws: FormWorksheet): WorksheetEntry | undefined {
  return entryOf(ws, ws.focusKey ?? '') ?? ws.forms[ws.forms.length - 1]
}

/** 紧凑的表摘要（前端多行列表 / metadata.draftForms 共用这个形态） */
export function compactEntry(e: WorksheetEntry): Record<string, unknown> {
  return {
    key: e.key,
    title: e.title,
    fieldCount: fieldCountOf(e.schema),
    ...(e.formId ? { formId: e.formId } : {}),
    schema: e.schema,
  }
}

/**
 * 前端预览卡片认的产物形态。
 *
 * 有工作台就带 `forms[]`（多行摘要列表），`schema`/`formId` 指向聚焦表以兼容单表分支。
 */
export function toFormArtifact(ws: FormWorksheet | undefined | null): Record<string, unknown> | null {
  const sheet = ws ?? emptyWorksheet()
  if (sheet.forms.length === 0) return null
  const focus = focusEntry(sheet)!
  return {
    kind: 'form',
    schema: focus.schema,
    ...(focus.formId ? { formId: focus.formId } : {}),
    forms: sheet.forms.map(compactEntry),
  }
}

/**
 * 把「旧线程的单槽草稿」种成工作台。
 *
 * 07-xx 之前建的会话，checkpoint 里只有 `drafts['form-designer'].data.schema`，没有
 * formWorksheet。prepare 里用这个补种一次，老会话的上下文不丢（prepare 只在 run 时跑，
 * resume 不重跑，所以不会反复种）。
 */
export function seedFromDraft(schema: unknown, key = 'f1'): FormWorksheet | null {
  if (!schema || typeof schema !== 'object') return null
  const s = schema as Record<string, unknown>
  if (fieldCountOf(s) === 0) return null
  return { forms: [{ key, title: schemaTitle(s) || '（未命名）', schema: s }], focusKey: key }
}

/**
 * 清单里的一行字段。
 *
 * 只印「模型必须看见才能正确动作」的东西：身份（key/name/type）、是否必填、选项取值。
 * `required`/`options` 一定要带上 —— 模型看不见的字段属性，它既保不住也改不了
 * （实测：模型只回 key/name/type 的重述时，select 的 options 与 rules 整片丢失，
 * 因为合并时它给什么就整体替换什么）。placeholder 等其余属性不进清单：改表时
 * 未提及的属性由工具保留（见 form-assemble-schema.tool.ts 的 mergeField），
 * 不靠模型复述。
 */
function fieldLine(f: any): string {
  let line = `    key=${f?.key} name=${f?.name} type=${f?.type}`
  if (Array.isArray(f?.rules) && f.rules.length > 0) line += ' required'
  const opts = f?.props?.options
  if (Array.isArray(opts) && opts.length > 0) {
    const shown = opts
      .slice(0, MAX_OPTIONS_PER_FIELD)
      .map((o: any) => `${o?.label}:${o?.value}`)
      .join('|')
    line += ` options=${shown}`
    if (opts.length > MAX_OPTIONS_PER_FIELD) line += `|…共 ${opts.length} 项`
  }
  return line
}

/**
 * 渲染注入 system prompt 的表清单（上下文工程主体）。
 *
 * 不重放原始对话历史 —— 表清单里每张表的 key/标题/formId/字段清单已经够模型分辨意图，
 * 且不会让 checkpoint 无限膨胀。工作台为空时返回 null（不带）。
 */
export function toWorksheetBlock(ws: FormWorksheet | undefined | null): string | null {
  const sheet = ws ?? emptyWorksheet()
  if (sheet.forms.length === 0) return null

  const focus = sheet.focusKey
  const shown = sheet.forms.slice(0, MAX_FORMS_IN_BLOCK)
  const lines: string[] = [
    `【会话中的表单】共 ${sheet.forms.length} 张${focus ? `，当前聚焦 ${focus}` : ''}`,
  ]

  for (const e of shown) {
    const fields = ((e.schema as any)?.fields ?? []) as any[]
    const focusTag = e.key === focus ? '（聚焦）' : ''
    const savedTag = e.formId ? '（已保存）' : ''
    lines.push(`- ${e.key}${focusTag} 标题：${e.title}${savedTag}  ${fields.length} 个字段`)
    for (const f of fields.slice(0, MAX_FIELDS_PER_FORM)) {
      lines.push(fieldLine(f))
    }
    if (fields.length > MAX_FIELDS_PER_FORM) {
      lines.push(`    …共 ${fields.length} 个字段`)
    }
  }
  if (sheet.forms.length > MAX_FORMS_IN_BLOCK) {
    lines.push(`…另有 ${sheet.forms.length - MAX_FORMS_IN_BLOCK} 张表未列出`)
  }

  lines.push(
    '用户要修改其中某张表时，必须把该表在 form_assemble_schema 的 target 参数里写清楚（填它的 key 或标题）；',
    '要新建一张表时，target 填新表的标题。',
    '改表时 fields 只给「要新增的字段」和「要改的字段」——不要整表回抄。清单里没提到的字段、以及没提到的属性（选项、必填等）一律原样保留。',
    '要精简或删除字段时用 removeFields 填这些字段的 key，千万不要把「要保留的字段」列出来。',
  )
  return lines.join('\n')
}
