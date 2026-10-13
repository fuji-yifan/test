/**
 * 表单字段级 diff（阶段 5 / 5.4）。
 *
 * `form_save` 前把「上次落库的 schema」与「本次要保存的 schema」比一遍，把
 * 新增 / 修改 / 删除摆到确认卡片上，让用户在写库前看清改了什么。
 *
 * 纯函数、不依赖图状态，便于单测。字段身份取 `key || id`（布局控件 key 为空，
 * 只能靠 id），与 form_assemble_schema 的合并口径一致（见 5.3）。
 */

/** 单个字段的属性差异标签（给人看的中文，不是机器码） */
export interface FormFieldDiff {
  added: { key: string; name: string; type: string }[]
  modified: { key: string; name: string; changes: string[] }[]
  removed: { key: string; name: string }[]
}

function fieldsOf(schema: unknown): any[] {
  const fields = (schema as { fields?: unknown } | undefined)?.fields
  return Array.isArray(fields) ? (fields as any[]) : []
}

/** 字段身份：key 优先，空 key 的布局控件退回 id */
function identityOf(f: any): string {
  return (typeof f?.key === 'string' && f.key) || (typeof f?.id === 'string' && f.id) || ''
}

function requiredOf(f: any): boolean {
  return Array.isArray(f?.rules) && f.rules.some((r: any) => r?.type === 'required')
}

function optionsOf(f: any): string {
  return JSON.stringify(f?.props?.options ?? null)
}

/** 提示文字：input/textarea 落在 placeholder，tip-text 落在 text */
function textOf(f: any): string {
  const p = f?.props ?? {}
  return JSON.stringify(p.placeholder ?? p.text ?? null)
}

/** 两个同身份字段之间「看得懂的」属性差异标签 */
function changesOf(base: any, next: any): string[] {
  const changes: string[] = []
  if (base?.name !== next?.name) changes.push('标签')
  if (base?.type !== next?.type) changes.push('类型')
  if (requiredOf(base) !== requiredOf(next)) changes.push('必填')
  if (optionsOf(base) !== optionsOf(next)) changes.push('选项')
  if (textOf(base) !== textOf(next)) changes.push('提示文字')
  return changes
}

/**
 * 算一份字段级 diff。
 *
 * `base` 为 undefined / 空（从未保存过的表、老会话）时，全部字段计入「新增」。
 * 顺序沿用「本次 schema」的字段顺序，读起来与预览一致。
 */
export function diffFields(base: unknown, next: unknown): FormFieldDiff {
  const baseFields = fieldsOf(base)
  const nextFields = fieldsOf(next)
  const baseByIdentity = new Map<string, any>()
  for (const f of baseFields) {
    const id = identityOf(f)
    if (id) baseByIdentity.set(id, f)
  }

  const added: FormFieldDiff['added'] = []
  const modified: FormFieldDiff['modified'] = []
  const nextIdentities = new Set<string>()

  for (const f of nextFields) {
    const id = identityOf(f)
    const prev = id ? baseByIdentity.get(id) : undefined
    if (!prev) {
      added.push({ key: id, name: f?.name ?? id, type: f?.type ?? '' })
      continue
    }
    if (id) nextIdentities.add(id)
    const changes = changesOf(prev, f)
    if (changes.length > 0) {
      modified.push({ key: id, name: f?.name ?? prev?.name ?? id, changes })
    }
  }

  const removed: FormFieldDiff['removed'] = []
  for (const f of baseFields) {
    const id = identityOf(f)
    if (!id || nextIdentities.has(id)) continue
    // 基线里存在、本次却不见了的字段 = 被删（含被改 key 但没带 id 的「假删除」）
    removed.push({ key: id, name: f?.name ?? id })
  }

  return { added, modified, removed }
}

/** diff 是否为空（三组都空 = 本次保存相对上次没有字段变化） */
export function isDiffEmpty(diff: FormFieldDiff): boolean {
  return diff.added.length === 0 && diff.modified.length === 0 && diff.removed.length === 0
}
