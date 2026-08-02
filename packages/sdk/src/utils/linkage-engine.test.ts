import { describe, it, expect } from 'vitest'
import { resolveLinkage, applyLinkageAction } from './linkage-engine'
import type { FieldSchema } from '../types'

const makeField = (overrides: Partial<FieldSchema> = {}): FieldSchema => ({
  id: 'f1',
  key: 'field1',
  type: 'input',
  name: 'Field 1',
  props: {},
  ...overrides,
})

describe('resolveLinkage', () => {
  it('returns empty array when no linkage rules match', () => {
    const fields: FieldSchema[] = [
      makeField({ id: 'a', key: 'city', linkage: [] }),
    ]
    const result = resolveLinkage(fields, 'province', { province: 'Beijing' })
    expect(result).toEqual([])
  })

  it('triggers linkage when trigger field matches', () => {
    const fields: FieldSchema[] = [
      makeField({
        id: 'a',
        key: 'city',
        linkage: [{
          trigger: 'province',
          target: 'city',
          action: { type: 'setValue', value: 'Default City' },
        }],
      }),
    ]
    const result = resolveLinkage(fields, 'province', { province: 'Beijing' })
    expect(result).toHaveLength(1)
    expect(result[0].fieldId).toBe('a')
    expect(result[0].action.type).toBe('setValue')
  })

  it('skips linkage when condition is not satisfied', () => {
    const fields: FieldSchema[] = [
      makeField({
        id: 'a',
        key: 'city',
        linkage: [{
          trigger: 'province',
          condition: 'province == "Shanghai"',
          target: 'city',
          action: { type: 'setValue', value: 'Shanghai City' },
        }],
      }),
    ]
    const result = resolveLinkage(fields, 'province', { province: 'Beijing' })
    expect(result).toHaveLength(0)
  })

  it('executes linkage when condition is satisfied', () => {
    const fields: FieldSchema[] = [
      makeField({
        id: 'a',
        key: 'city',
        linkage: [{
          trigger: 'province',
          condition: 'province == "Shanghai"',
          target: 'city',
          action: { type: 'setValue', value: 'Shanghai City' },
        }],
      }),
    ]
    const result = resolveLinkage(fields, 'province', { province: 'Shanghai' })
    expect(result).toHaveLength(1)
  })

  it('handles multiple linkage rules on same field', () => {
    const fields: FieldSchema[] = [
      makeField({
        id: 'a',
        key: 'city',
        linkage: [
          { trigger: 'province', target: 'city', action: { type: 'setValue', value: 'A' } },
          { trigger: 'country', target: 'city', action: { type: 'setValue', value: 'B' } },
        ],
      }),
    ]
    // only province changed, should only trigger first rule
    const result = resolveLinkage(fields, 'province', { province: 'X' })
    expect(result).toHaveLength(1)
    expect(result[0].action.type).toBe('setValue')
    expect((result[0].action as any).value).toBe('A')
  })

  it('resolves nested fields linkage', () => {
    const fields: FieldSchema[] = [
      makeField({
        id: 'parent',
        key: 'container',
        type: 'card',
        children: [
          makeField({
            id: 'child',
            key: 'nested',
            linkage: [{
              trigger: 'outside',
              target: 'nested',
              action: { type: 'setDisabled', disabled: true },
            }],
          }),
        ],
      }),
    ]
    const result = resolveLinkage(fields, 'outside', { outside: 'triggered' })
    expect(result).toHaveLength(1)
    expect(result[0].fieldId).toBe('child')
  })
})

describe('applyLinkageAction', () => {
  it('applies setValue action', () => {
    const data = { name: 'old' }
    const updated = applyLinkageAction(data, { type: 'setValue', value: 'new' }, 'name')
    expect(updated.name).toBe('new')
  })

  it('does not mutate original data', () => {
    const data = { name: 'old' }
    applyLinkageAction(data, { type: 'setValue', value: 'new' }, 'name')
    expect(data.name).toBe('old')
  })
})
