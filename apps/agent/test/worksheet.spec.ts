import { describe, expect, it } from 'vitest'
import {
  applyAssemble,
  emptyWorksheet,
  markRestored,
  markSaved,
  resolveFormTarget,
  seedFromDraft,
  toFormArtifact,
  toWorksheetBlock,
  type FormWorksheet,
} from '../src/modules/graph/worksheet'

/** 造一个最小可用的 schema */
function schema(title: string, keys: string[]): Record<string, unknown> {
  return {
    version: 1,
    settings: { formTitle: title },
    fields: keys.map((k) => ({ key: k, name: k, type: 'input' })),
  }
}

function wsWith(...entries: Array<{ key: string; title: string; keys: string[]; formId?: string }>): FormWorksheet {
  return {
    forms: entries.map((e) => ({
      key: e.key,
      title: e.title,
      schema: schema(e.title, e.keys),
      ...(e.formId ? { formId: e.formId } : {}),
    })),
    focusKey: entries.length ? entries[entries.length - 1].key : null,
  }
}

describe('resolveFormTarget 目标寻址', () => {
  it('没有 target 时退回 focusKey（保住「再加一个字段」）', () => {
    const ws = wsWith({ key: 'f1', title: '客户登记表', keys: ['name'] })
    expect(resolveFormTarget(undefined, ws)).toEqual({ kind: 'focus', key: 'f1' })
    expect(resolveFormTarget('  ', ws)).toEqual({ kind: 'focus', key: 'f1' })
  })

  it('没有 target 且工作台为空 → 新建', () => {
    const r = resolveFormTarget(undefined, emptyWorksheet())
    expect(r.kind).toBe('create')
    expect(r).toMatchObject({ key: 'f1' })
  })

  it('target 填 key 直接命中', () => {
    const ws = wsWith(
      { key: 'f1', title: '客户登记表', keys: ['name'] },
      { key: 'f2', title: '员工登记表', keys: ['emp'] },
    )
    expect(resolveFormTarget('f1', ws)).toEqual({ kind: 'update', key: 'f1' })
  })

  it('target 填标题精确命中（可带/不带「表」字）', () => {
    const ws = wsWith({ key: 'f1', title: '客户登记表', keys: ['name'] })
    expect(resolveFormTarget('客户登记表', ws)).toEqual({ kind: 'update', key: 'f1' })
    expect(resolveFormTarget('客户登记', ws)).toEqual({ kind: 'update', key: 'f1' })
  })

  it('重名表 → ambiguous，列出所有命中', () => {
    const ws = wsWith(
      { key: 'f1', title: '客户登记表', keys: ['a'] },
      { key: 'f2', title: '客户登记表', keys: ['b'] },
    )
    expect(resolveFormTarget('客户登记表', ws)).toEqual({ kind: 'ambiguous', keys: ['f1', 'f2'] })
  })

  it('有 target 但无人命中 → 当作新表，title 取 target 原文', () => {
    const ws = wsWith({ key: 'f1', title: '客户登记表', keys: ['name'] })
    const r = resolveFormTarget('员工登记表', ws)
    expect(r).toEqual({ kind: 'create', key: 'f2', title: '员工登记表' })
  })

  it('新表 key 跳过已用编号', () => {
    const ws = wsWith(
      { key: 'f1', title: 'A表', keys: ['a'] },
      { key: 'f3', title: 'B表', keys: ['b'] },
    )
    expect(resolveFormTarget('C表', ws)).toMatchObject({ key: 'f4' })
  })

  it('target 填 formId 精确命中（阶段 5 / 5.1）', () => {
    const ws = wsWith(
      { key: 'f1', title: 'A表', keys: ['a'], formId: 'uuid-1' },
      { key: 'f2', title: 'B表', keys: ['b'], formId: 'uuid-2' },
    )
    expect(resolveFormTarget('uuid-2', ws)).toEqual({ kind: 'update', key: 'f2' })
  })

  it('重名时 formId 仍能唯一定位，不必 ambiguous', () => {
    const ws = wsWith(
      { key: 'f1', title: '客户登记表', keys: ['a'], formId: 'u1' },
      { key: 'f2', title: '客户登记表', keys: ['b'], formId: 'u2' },
    )
    expect(resolveFormTarget('客户登记表', ws)).toEqual({ kind: 'ambiguous', keys: ['f1', 'f2'] })
    expect(resolveFormTarget('u2', ws)).toEqual({ kind: 'update', key: 'f2' })
  })
})

describe('applyAssemble 登记产物', () => {
  it('create：追加新 entry 并聚焦', () => {
    const ws = wsWith({ key: 'f1', title: '客户登记表', keys: ['name'] })
    const resolved = resolveFormTarget('员工登记表', ws)
    const next = applyAssemble(ws, resolved, schema('员工登记表', ['emp', 'dept']))
    expect(next.forms.map((f) => f.key)).toEqual(['f1', 'f2'])
    expect(next.focusKey).toBe('f2')
    // 关键：新表是独立的一套字段，没有被旧表合并
    expect((next.forms[1].schema as any).fields.map((f: any) => f.key)).toEqual(['emp', 'dept'])
  })

  it('update：覆盖对应表，不新增 entry', () => {
    const ws = wsWith(
      { key: 'f1', title: '客户登记表', keys: ['name'] },
      { key: 'f2', title: '员工登记表', keys: ['emp'] },
    )
    const resolved = resolveFormTarget('客户登记表', ws)
    const next = applyAssemble(ws, resolved, schema('客户登记表', ['name', 'phone']))
    expect(next.forms).toHaveLength(2)
    expect(next.focusKey).toBe('f1')
    expect((next.forms[0].schema as any).fields.map((f: any) => f.key)).toEqual(['name', 'phone'])
    // 另一张表没被碰到
    expect((next.forms[1].schema as any).fields.map((f: any) => f.key)).toEqual(['emp'])
  })

  it('focus：更新聚焦那张（缺 title 时沿用原 title）', () => {
    const ws = wsWith({ key: 'f1', title: '客户登记表', keys: ['name'] })
    const next = applyAssemble(ws, resolveFormTarget(undefined, ws), {
      fields: [{ key: 'name' }, { key: 'phone' }],
    })
    expect(next.forms).toHaveLength(1)
    expect(next.forms[0].title).toBe('客户登记表')
    expect((next.forms[0].schema as any).fields).toHaveLength(2)
  })

  it('不可变：不改动传入的工作台', () => {
    const ws = wsWith({ key: 'f1', title: '客户登记表', keys: ['name'] })
    const before = JSON.stringify(ws)
    applyAssemble(ws, resolveFormTarget('员工登记表', ws), schema('员工登记表', ['emp']))
    expect(JSON.stringify(ws)).toBe(before)
  })
})

describe('markSaved 记录 formId', () => {
  it('把 formId 记到解析出的那张表上', () => {
    const ws = wsWith(
      { key: 'f1', title: '客户登记表', keys: ['name'] },
      { key: 'f2', title: '员工登记表', keys: ['emp'] },
    )
    const next = markSaved(ws, resolveFormTarget('客户登记表', ws), 'form-123')
    expect(next.forms[0].formId).toBe('form-123')
    expect(next.forms[1].formId).toBeUndefined()
    expect(next.focusKey).toBe('f1')
  })

  it('同时把当前 schema 存成 diff 基线（savedSchema）', () => {
    const ws = wsWith({ key: 'f1', title: '客户登记表', keys: ['name'] })
    const next = markSaved(ws, resolveFormTarget('客户登记表', ws), 'form-123')
    expect(next.forms[0].savedSchema).toEqual(ws.forms[0].schema)
  })
})

describe('markRestored 回滚登记（阶段 5 / 5.5）', () => {
  it('把 schema 换成回滚后的快照，savedSchema 同步换', () => {
    const ws = wsWith({ key: 'f1', title: '客户登记表', keys: ['name'], formId: 'u1' })
    const restored = schema('客户登记表', ['name', 'phone'])
    const next = markRestored(ws, resolveFormTarget('u1', ws), restored)
    expect(next.forms[0].schema).toEqual(restored)
    expect(next.forms[0].savedSchema).toEqual(restored)
    expect(next.forms[0].formId).toBe('u1')
    expect(next.focusKey).toBe('f1')
  })
})

describe('toWorksheetBlock 表清单注入', () => {
  it('工作台为空 → null（不注入）', () => {
    expect(toWorksheetBlock(emptyWorksheet())).toBeNull()
    expect(toWorksheetBlock(undefined)).toBeNull()
  })

  it('渲染每张表的 key/标题/字段，并标出聚焦与已保存', () => {
    const ws: FormWorksheet = {
      forms: [
        { key: 'f1', title: '报名统计表', schema: schema('报名统计表', ['name', 'age']), formId: 'fid-1' },
        { key: 'f2', title: '员工登记表', schema: schema('员工登记表', ['emp']) },
      ],
      focusKey: 'f2',
    }
    const block = toWorksheetBlock(ws)!
    expect(block).toContain('共 2 张')
    expect(block).toContain('当前聚焦 f2')
    expect(block).toContain('f2（聚焦） 标题：员工登记表')
    expect(block).toContain('f1 标题：报名统计表（已保存 id=fid-1）')
    expect(block).toContain('key=name name=name type=input')
    // 硬规则要带上，否则模型可能不传 target
    expect(block).toContain('target')
  })

  it('字段超过上限时截断并给出总数', () => {
    const many = Array.from({ length: 45 }, (_, i) => `k${i}`)
    const ws = wsWith({ key: 'f1', title: '大表', keys: many })
    const block = toWorksheetBlock(ws)!
    expect(block).toContain('…共 45 个字段')
    expect(block.match(/key=k\d+/g)?.length).toBe(40)
  })

  /**
   * 09-22 翻车点：清单里只有 key/name/type，模型看不见选项与必填，
   * 于是它「照抄」时把 options/rules 抄丢了，用户看到"用工性质的选项怎么丢失了"。
   * 清单必须带上这两样，模型才能既保住它们、也改得动它们。
   */
  it('带上 required 与 options：模型看得见才能保住/修改', () => {
    const ws: FormWorksheet = {
      forms: [
        {
          key: 'f1',
          title: '教职工信息表',
          schema: {
            version: 1,
            settings: { formTitle: '教职工信息表' },
            fields: [
              { key: 'field_name', name: '姓名', type: 'input', rules: [{ type: 'required', message: '请填写姓名' }] },
              {
                key: 'field_employ_type',
                name: '用工性质',
                type: 'radio',
                props: {
                  options: [
                    { label: '事业编制', value: 'public' },
                    { label: '兼职', value: 'parttime' },
                  ],
                },
              },
              { key: 'field_remark', name: '备注', type: 'textarea' },
            ],
          },
        },
      ],
      focusKey: 'f1',
    }
    const block = toWorksheetBlock(ws)!
    expect(block).toContain('key=field_name name=姓名 type=input required')
    expect(block).toContain('options=事业编制:public|兼职:parttime')
    // 没有 options 的字段行干净收尾，不塞空壳
    expect(block).toContain('key=field_remark name=备注 type=textarea\n')
  })

  it('选项过多时截断并给出总数', () => {
    const opts = Array.from({ length: 20 }, (_, i) => ({ label: `选项${i}`, value: `v${i}` }))
    const ws: FormWorksheet = {
      forms: [
        {
          key: 'f1',
          title: '大表',
          schema: {
            version: 1,
            settings: { formTitle: '大表' },
            fields: [{ key: 'k', name: 'K', type: 'select', props: { options: opts } }],
          },
        },
      ],
      focusKey: 'f1',
    }
    const block = toWorksheetBlock(ws)!
    expect(block).toContain('…共 20 项')
    expect(block.match(/v\d+/g)?.length).toBe(12)
  })

  it('字段行带 id（改 key 靠它认领旧字段，阶段 5 / 5.3）', () => {
    const ws: FormWorksheet = {
      forms: [
        {
          key: 'f1',
          title: '客户登记表',
          schema: {
            version: 1,
            settings: { formTitle: '客户登记表' },
            fields: [{ id: 'field_ab12', key: 'name', name: '姓名', type: 'input' }],
          },
        },
      ],
      focusKey: 'f1',
    }
    const block = toWorksheetBlock(ws)!
    expect(block).toContain('key=name id=field_ab12 name=姓名 type=input')
  })
})

describe('toFormArtifact 产物形态', () => {
  it('空工作台 → null', () => {
    expect(toFormArtifact(emptyWorksheet())).toBeNull()
  })

  it('带 forms 数组，schema/formId 指向聚焦表', () => {
    const ws: FormWorksheet = {
      forms: [
        { key: 'f1', title: '报名统计表', schema: schema('报名统计表', ['name', 'age']), formId: 'fid-1' },
        { key: 'f2', title: '员工登记表', schema: schema('员工登记表', ['emp']) },
      ],
      focusKey: 'f2',
    }
    const art = toFormArtifact(ws)!
    expect(art.kind).toBe('form')
    expect((art.forms as any[]).map((f) => f.title)).toEqual(['报名统计表', '员工登记表'])
    expect((art.forms as any[])[0].fieldCount).toBe(2)
    expect((art.forms as any[])[0].formId).toBe('fid-1')
    expect((art.forms as any[])[1].formId).toBeUndefined()
    // 单表兼容：schema/formId 取聚焦表
    expect((art.schema as any).settings.formTitle).toBe('员工登记表')
    expect(art.formId).toBeUndefined()
  })
})

describe('seedFromDraft 旧线程迁移', () => {
  it('有字段的草稿 → 种成 f1', () => {
    const s = seedFromDraft(schema('历史表单', ['a', 'b']))!
    expect(s.focusKey).toBe('f1')
    expect(s.forms[0].title).toBe('历史表单')
    expect((s.forms[0].schema as any).fields).toHaveLength(2)
  })

  it('空草稿 → null（不种）', () => {
    expect(seedFromDraft(null)).toBeNull()
    expect(seedFromDraft(schema('空表', []))).toBeNull()
  })
})
