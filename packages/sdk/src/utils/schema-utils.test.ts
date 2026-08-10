import { describe, it, expect } from 'vitest'
import {
  walkFields, findFieldById, findFieldByKey,
  insertFieldAtIndex, removeFieldById,
  flattenFields, cloneSchema, generateFieldId,
  isLayoutField,
} from './schema-utils'
import type { FieldSchema, FormSchema } from '../types'

const makeField = (overrides: Partial<FieldSchema> = {}): FieldSchema => ({
  id: 'f1',
  key: 'field1',
  type: 'input',
  name: 'Field 1',
  col: 12,
  props: {},
  ...overrides,
})

const makeSchema = (fields: FieldSchema[] = []): FormSchema => ({
  version: '2.0',
  id: 'test-schema',
  settings: {
    labelPosition: 'left', size: 'default', disabled: false,
    submitText: '提交', resetText: null, rules: [],
    cssClassName: '', formTitle: '', canvasCols: 24, canvasHeight: 0,
  },
  fields,
})

// ==================== walkFields ====================

describe('walkFields', () => {
  it('visits all top-level fields', () => {
    const fields = [makeField({ id: 'a' }), makeField({ id: 'b' })]
    const visited: string[] = []
    walkFields(fields, (f) => visited.push(f.id))
    expect(visited).toEqual(['a', 'b'])
  })

  it('visits nested fields with correct parent and depth', () => {
    const parent = makeField({ id: 'card', key: '', type: 'card', children: [makeField({ id: 'nested' })] })
    const parents: (string | null)[] = []
    const depths: number[] = []
    walkFields([parent], (_, p, d) => {
      parents.push(p?.id ?? null)
      depths.push(d)
    })
    expect(parents).toEqual([null, 'card'])
    expect(depths).toEqual([0, 1])
  })

  it('handles empty fields array', () => {
    const visited: string[] = []
    walkFields([], (f) => visited.push(f.id))
    expect(visited).toEqual([])
  })

  it('handles deeply nested structures', () => {
    const deep: FieldSchema = makeField({
      id: 'L0', type: 'card',
      children: [makeField({ id: 'L1', type: 'card',
        children: [makeField({ id: 'L2', type: 'card',
          children: [makeField({ id: 'L3' })]
        })]
      })]
    })
    const visited: string[] = []
    walkFields([deep], (f) => visited.push(f.id))
    expect(visited).toEqual(['L0', 'L1', 'L2', 'L3'])
  })
})

// ==================== findFieldById ====================

describe('findFieldById', () => {
  it('finds top-level field', () => {
    const fields = [makeField({ id: 'target' }), makeField({ id: 'other' })]
    expect(findFieldById(fields, 'target')?.id).toBe('target')
  })

  it('finds nested field', () => {
    const fields = [makeField({
      id: 'card', type: 'card',
      children: [makeField({ id: 'nested' })]
    })]
    expect(findFieldById(fields, 'nested')?.id).toBe('nested')
  })

  it('returns null for nonexistent id', () => {
    expect(findFieldById([], 'missing')).toBeNull()
  })

  it('returns null when no children', () => {
    const fields = [makeField({ id: 'a' })]
    expect(findFieldById(fields, 'b')).toBeNull()
  })
})

// ==================== findFieldByKey ====================

describe('findFieldByKey', () => {
  it('finds by key', () => {
    const fields = [makeField({ id: 'a', key: 'email' }), makeField({ id: 'b', key: 'name' })]
    expect(findFieldByKey(fields, 'email')?.id).toBe('a')
  })

  it('finds nested by key', () => {
    const fields = [makeField({
      id: 'card', type: 'card', key: '',
      children: [makeField({ id: 'child', key: 'nested_key' })]
    })]
    expect(findFieldByKey(fields, 'nested_key')?.id).toBe('child')
  })

  it('returns null for missing key', () => {
    expect(findFieldByKey([], 'none')).toBeNull()
  })
})

// ==================== insertFieldAtIndex ====================

describe('insertFieldAtIndex', () => {
  it('inserts at top level at index 0', () => {
    const fields = [makeField({ id: 'existing' })]
    insertFieldAtIndex(fields, null, 0, makeField({ id: 'new' }))
    expect(fields[0].id).toBe('new')
    expect(fields[1].id).toBe('existing')
  })

  it('inserts into nested parent', () => {
    const card = makeField({ id: 'card', type: 'card', key: '' })
    const fields = [card]
    insertFieldAtIndex(fields, 'card', 0, makeField({ id: 'child' }))
    expect(fields[0].children?.[0].id).toBe('child')
  })

  it('returns false for nonexistent parent', () => {
    const fields = [makeField({ id: 'a' })]
    const result = insertFieldAtIndex(fields, 'nonexistent', 0, makeField({ id: 'b' }))
    expect(result).toBe(false)
  })

  it('creates children array if parent has none', () => {
    const card = makeField({ id: 'card', type: 'card', key: '' })
    const fields = [card]
    insertFieldAtIndex(fields, 'card', 0, makeField({ id: 'child' }))
    expect(fields[0].children).toBeDefined()
    expect(fields[0].children!).toHaveLength(1)
  })
})

// ==================== removeFieldById ====================

describe('removeFieldById', () => {
  it('removes top-level field and returns it', () => {
    const fields = [makeField({ id: 'a' }), makeField({ id: 'b' })]
    const removed = removeFieldById(fields, 'a')
    expect(removed?.id).toBe('a')
    expect(fields).toHaveLength(1)
    expect(fields[0].id).toBe('b')
  })

  it('removes nested field', () => {
    const fields = [makeField({ id: 'card', type: 'card', key: '', children: [makeField({ id: 'nested' })] })]
    const removed = removeFieldById(fields, 'nested')
    expect(removed?.id).toBe('nested')
    expect(fields[0].children).toHaveLength(0)
  })

  it('returns null when not found', () => {
    expect(removeFieldById([], 'missing')).toBeNull()
  })

  it('does not affect siblings when removing', () => {
    const fields = [
      makeField({ id: 'a' }),
      makeField({ id: 'b' }),
      makeField({ id: 'c' }),
    ]
    removeFieldById(fields, 'b')
    expect(fields.map(f => f.id)).toEqual(['a', 'c'])
  })
})

// ==================== flattenFields ====================

describe('flattenFields', () => {
  it('creates id -> field map', () => {
    const fields = [makeField({ id: 'a' }), makeField({ id: 'b' })]
    const map = flattenFields(fields)
    expect(map.size).toBe(2)
    expect(map.get('a')?.id).toBe('a')
  })

  it('includes nested fields', () => {
    const fields = [makeField({ id: 'card', type: 'card', key: '', children: [makeField({ id: 'child' })] })]
    const map = flattenFields(fields)
    expect(map.has('card')).toBe(true)
    expect(map.has('child')).toBe(true)
  })
})

// ==================== cloneSchema ====================

describe('cloneSchema', () => {
  it('deep clones the schema', () => {
    const original = makeSchema([makeField({ id: 'a' })])
    const cloned = cloneSchema(original)
    cloned.fields[0].id = 'mutated'
    expect(original.fields[0].id).toBe('a')
  })

  it('handles fields with nested children', () => {
    const original = makeSchema([
      makeField({ id: 'card', type: 'card', key: '', children: [makeField({ id: 'inner' })] })
    ])
    const cloned = cloneSchema(original)
    ;(cloned.fields[0].children![0] as FieldSchema).name = 'changed'
    expect((original.fields[0].children![0] as FieldSchema).name).toBe('Field 1')
  })

  it('handles empty fields array', () => {
    const schema = makeSchema([])
    const cloned = cloneSchema(schema)
    expect(cloned.fields).toEqual([])
  })
})

// ==================== generateFieldId ====================

describe('generateFieldId', () => {
  it('generates unique ids', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateFieldId()))
    expect(ids.size).toBe(100)
  })

  it('returns string values', () => {
    expect(typeof generateFieldId()).toBe('string')
  })
})

// ==================== isLayoutField ====================

describe('isLayoutField', () => {
  it('identifies layout container types', () => {
    expect(isLayoutField('card')).toBe(true)
    expect(isLayoutField('collapse')).toBe(true)
    expect(isLayoutField('divider')).toBe(true)
  })

  it('returns false for data fields', () => {
    expect(isLayoutField('input')).toBe(false)
    expect(isLayoutField('select')).toBe(false)
    expect(isLayoutField('textarea')).toBe(false)
  })
})
