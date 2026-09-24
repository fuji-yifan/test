import { describe, expect, it } from 'vitest'
import { FormAssembleSchemaTool } from '../src/modules/sub-agents/form-designer/tools/form-assemble-schema.tool'

/**
 * F3 回归：form_assemble_schema 曾经是整表重建，模型在「加一个字段」的追问里
 * 只回传新增字段时，原有字段会被整表覆盖。现在按 key 合并。
 *
 * 09-22 之后契约改成「增量」：模型只给要新增/要改的字段，属性级的未提及一律保留；
 * 删除走显式的 removeFields，不再让模型回抄整张表（回抄会丢 options/必填/placeholder）。
 */
describe('form_assemble_schema 字段合并', () => {
  const tool = new FormAssembleSchemaTool()

  it('首次创建：没有已有 schema 时行为不变', async () => {
    const res = await tool.execute({
      formTitle: '客户登记表',
      fields: [
        { key: 'name', name: '姓名', type: 'input', required: true },
        { key: 'phone', name: '手机号', type: 'input' },
      ],
    })
    expect(res.schema.fields).toHaveLength(2)
    expect(res.schema.fields.map((f: any) => f.key)).toEqual(['name', 'phone'])
    expect(res.schema.settings.formTitle).toBe('客户登记表')
    expect(res.summary).toContain('2 个字段')
  })

  it('追加字段：原有字段不丢，新字段追加在末尾', async () => {
    const first = await tool.execute({
      formTitle: '客户登记表',
      fields: [
        { key: 'name', name: '姓名', type: 'input', required: true },
        { key: 'phone', name: '手机号', type: 'input' },
      ],
    })

    // 模型只回传了新增字段（这就是线上丢字段的触发条件）
    const second = await tool.execute({
      fields: [{ key: 'remark', name: '备注', type: 'textarea' }],
      existingSchema: first.schema,
    })

    expect(second.schema.fields.map((f: any) => f.key)).toEqual(['name', 'phone', 'remark'])
    expect(second.schema.settings.formTitle).toBe('客户登记表')
    expect(second.summary).toContain('新增 1 个字段')
    expect(second.summary).toContain('共 3 个字段')
  })

  it('更新已有字段：保留原 id，按新定义覆盖', async () => {
    const first = await tool.execute({
      fields: [{ key: 'phone', name: '手机号', type: 'input' }],
    })
    const originalId = first.schema.fields[0].id

    const second = await tool.execute({
      fields: [{ key: 'phone', name: '联系手机', type: 'input', required: true }],
      existingSchema: first.schema,
    })

    expect(second.schema.fields).toHaveLength(1)
    expect(second.schema.fields[0].id).toBe(originalId)
    expect(second.schema.fields[0].name).toBe('联系手机')
    expect(second.schema.fields[0].rules).toHaveLength(1)
  })

  it('重复传全部字段：幂等，不产生重复', async () => {
    const first = await tool.execute({
      fields: [
        { key: 'name', name: '姓名', type: 'input' },
        { key: 'phone', name: '手机号', type: 'input' },
      ],
    })

    const second = await tool.execute({
      fields: [
        { key: 'name', name: '姓名', type: 'input' },
        { key: 'phone', name: '手机号', type: 'input' },
      ],
      existingSchema: first.schema,
    })

    expect(second.schema.fields.map((f: any) => f.key)).toEqual(['name', 'phone'])
    expect(second.schema.fields.map((f: any) => f.id)).toEqual(
      first.schema.fields.map((f: any) => f.id),
    )
  })

  /**
   * 线上翻车实录（2026-09-22 sess_txsajd5t2pff）：模型「去掉入职日期」时把留下的字段
   * 只回成 key/name/type，旧实现整字段替换 → 所有 select/radio 的 options 与全部必填
   * 一起归零（用户看到的就是"用工性质的选项怎么丢失了"）。
   */
  it('只给 key/name/type 的重述：选项、必填、placeholder 全部保住', async () => {
    const first = await tool.execute({
      fields: [
        { key: 'field_name', name: '姓名', type: 'input', required: true, text: '请输入姓名' },
        {
          key: 'field_employ_type',
          name: '用工性质',
          type: 'radio',
          options: [
            { label: '事业编制', value: 'public' },
            { label: '合同制', value: 'contract' },
            { label: '劳务派遣', value: 'dispatch' },
            { label: '兼职', value: 'parttime' },
          ],
        },
      ],
    })

    const second = await tool.execute({
      fields: [
        { key: 'field_name', name: '姓名', type: 'input' },
        { key: 'field_employ_type', name: '用工性质', type: 'radio' },
      ],
      existingSchema: first.schema,
    })

    const [name, employType] = second.schema.fields
    expect(name.rules).toHaveLength(1)
    expect(name.props.placeholder).toBe('请输入姓名')
    expect(employType.props.options).toHaveLength(4)
    expect(employType.props.options[3]).toEqual({ label: '兼职', value: 'parttime' })
    expect(second.summary).toContain('修改 2 个字段')
    expect(second.summary).toContain('共 2 个字段')
  })

  it('只传要改的那一个属性：其余字段与属性都不动', async () => {
    const first = await tool.execute({
      fields: [
        { key: 'field_name', name: '姓名', type: 'input', text: '请输入姓名' },
        { key: 'field_phone', name: '手机号', type: 'input', text: '请输入手机号' },
        { key: 'field_dept', name: '所属部门', type: 'select', options: [{ label: '语文组', value: 'chinese' }] },
      ],
    })

    // 用户说「把手机号改成必填」
    const second = await tool.execute({
      fields: [{ key: 'field_phone', required: true }],
      existingSchema: first.schema,
    })

    expect(second.schema.fields.map((f: any) => f.key)).toEqual([
      'field_name',
      'field_phone',
      'field_dept',
    ])
    const phone = second.schema.fields[1]
    expect(phone.rules).toHaveLength(1)
    expect(phone.props.placeholder).toBe('请输入手机号')
    expect(second.summary).toContain('修改 1 个字段')
  })

  it('required=false：显式去掉必填', async () => {
    const first = await tool.execute({
      fields: [{ key: 'field_name', name: '姓名', type: 'input', required: true }],
    })

    const second = await tool.execute({
      fields: [{ key: 'field_name', required: false }],
      existingSchema: first.schema,
    })

    expect(second.schema.fields[0].rules).toEqual([])
  })

  it('改选项：options 整体替换（清单里能看到当前取值，照着改）', async () => {
    const first = await tool.execute({
      fields: [
        {
          key: 'field_employ_type',
          name: '用工性质',
          type: 'radio',
          options: [
            { label: '事业编制', value: 'public' },
            { label: '合同制', value: 'contract' },
          ],
        },
      ],
    })

    const second = await tool.execute({
      fields: [
        {
          key: 'field_employ_type',
          options: [
            { label: '事业编制', value: 'public' },
            { label: '合同制', value: 'contract' },
            { label: '返聘', value: 'rehire' },
          ],
        },
      ],
      existingSchema: first.schema,
    })

    const opts = second.schema.fields[0].props.options
    expect(opts).toHaveLength(3)
    expect(opts.map((o: any) => o.label)).toContain('返聘')
  })

  it('精简（removeFields）：列出的删除，保留的沿用原 id 与原顺序', async () => {
    const first = await tool.execute({
      formTitle: '教职工信息登记表',
      fields: [
        { key: 'field_name', name: '姓名', type: 'input', required: true },
        { key: 'field_idcard', name: '身份证号', type: 'input' },
        { key: 'field_phone', name: '手机号', type: 'input' },
        { key: 'field_photo', name: '照片', type: 'file-upload' },
      ],
    })
    const idOf = (k: string) => first.schema.fields.find((f: any) => f.key === k).id

    const second = await tool.execute({
      target: 'f1',
      removeFields: ['field_idcard', 'field_photo'],
      existingSchema: first.schema,
    })

    expect(second.schema.fields.map((f: any) => f.key)).toEqual(['field_name', 'field_phone'])
    expect(second.schema.fields.map((f: any) => f.id)).toEqual([idOf('field_name'), idOf('field_phone')])
    // 没传 formTitle，标题不能被这次调用清掉
    expect(second.schema.settings.formTitle).toBe('教职工信息登记表')
    // 保留的字段属性也不动
    expect(second.schema.fields[0].rules).toHaveLength(1)
    expect(second.summary).toContain('删除 2 个字段')
    expect(second.summary).toContain('共 2 个字段')
  })

  it('精简 + 新增同时发生：新增的追加、删除的移除', async () => {
    const first = await tool.execute({
      fields: [
        { key: 'name', name: '姓名', type: 'input' },
        { key: 'photo', name: '照片', type: 'file-upload' },
      ],
    })

    const second = await tool.execute({
      removeFields: ['photo'],
      fields: [{ key: 'dept', name: '所属部门', type: 'select', options: [{ label: '语文组', value: 'chinese' }] }],
      existingSchema: first.schema,
    })

    expect(second.schema.fields.map((f: any) => f.key)).toEqual(['name', 'dept'])
    expect(second.summary).toContain('新增 1 个字段')
    expect(second.summary).toContain('删除 1 个字段')
  })

  it('removeFields 里点了不存在的 key：如实报出，字段不受影响', async () => {
    const first = await tool.execute({
      fields: [
        { key: 'name', name: '姓名', type: 'input' },
        { key: 'phone', name: '手机号', type: 'input' },
      ],
    })

    const second = await tool.execute({
      removeFields: ['field_typo'],
      existingSchema: first.schema,
    })

    expect(second.schema.fields.map((f: any) => f.key)).toEqual(['name', 'phone'])
    expect(second.summary).toContain('未找到要删除的 field_typo')
    expect(second.summary).toContain('共 2 个字段')
  })

  it('一次调用里既删又改同一个 key：以删为准', async () => {
    const first = await tool.execute({
      fields: [{ key: 'field_hire_date', name: '入职日期', type: 'date-picker' }],
    })

    const second = await tool.execute({
      removeFields: ['field_hire_date'],
      fields: [{ key: 'field_hire_date', name: '入职日期', type: 'date-picker' }],
      existingSchema: first.schema,
    })

    expect(second.schema.fields).toHaveLength(0)
    expect(second.summary).toContain('删除 1 个字段')
  })

  it('新字段缺 name 或 type：直接报错，不静默建出半成品', async () => {
    const first = await tool.execute({
      fields: [{ key: 'name', name: '姓名', type: 'input' }],
    })

    await expect(
      tool.execute({
        fields: [{ key: 'field_x', name: '新字段' }],
        existingSchema: first.schema,
      }),
    ).rejects.toThrow(/name 与 type/)
  })

  it('更新后 summary 用「已更新」而不是「已生成」', async () => {
    const first = await tool.execute({
      fields: [
        { key: 'name', name: '姓名', type: 'input' },
        { key: 'phone', name: '手机号', type: 'input' },
      ],
    })

    const second = await tool.execute({
      removeFields: ['phone'],
      existingSchema: first.schema,
    })

    expect(second.summary).toContain('已更新表单')
    expect(second.summary).not.toContain('已生成表单')
    expect(second.schema.fields).toHaveLength(1)
  })
})
