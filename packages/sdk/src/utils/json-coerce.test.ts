import { describe, it, expect } from 'vitest'
import { coerceJsonDeep, coerceNodeConfig } from './json-coerce'

describe('coerceJsonDeep', () => {
  it('还原字符串化的 JSON 对象', () => {
    expect(coerceJsonDeep('{}')).toEqual({})
    expect(coerceJsonDeep('{"a":1}')).toEqual({ a: 1 })
  })

  it('还原字符串化的 JSON 数组', () => {
    expect(coerceJsonDeep('[{"name":"小额"}]')).toEqual([{ name: '小额' }])
  })

  it('递归还原嵌套在对象/数组里的字符串 JSON', () => {
    // 本次真机的脏数据形态：config 是对象，但 branches 是字符串
    const dirty = { branches: '[{"name":"紧急","operator":"in"}]', timeout: '24h' }
    expect(coerceJsonDeep(dirty)).toEqual({ branches: [{ name: '紧急', operator: 'in' }], timeout: '24h' })

    const nested = { a: { b: '[{"c":1}]' } }
    expect(coerceJsonDeep(nested)).toEqual({ a: { b: [{ c: 1 }] } })
  })

  it('不把普通字符串、字段表达式、模板串当 JSON', () => {
    expect(coerceJsonDeep('auto_approved')).toBe('auto_approved')
    expect(coerceJsonDeep('$.form.fields.amount')).toBe('$.form.fields.amount')
    expect(coerceJsonDeep('{不是 json}')).toBe('{不是 json}')
  })

  it('不把能解析成原始类型的字符串改类型（数字/布尔/null 保持字符串）', () => {
    expect(coerceJsonDeep('1000')).toBe('1000')
    expect(coerceJsonDeep('true')).toBe('true')
    expect(coerceJsonDeep('null')).toBe('null')
  })

  it('非字符串、非对象的值原样返回', () => {
    expect(coerceJsonDeep(1)).toBe(1)
    expect(coerceJsonDeep(true)).toBe(true)
    expect(coerceJsonDeep(null)).toBe(null)
    expect(coerceJsonDeep(undefined)).toBe(undefined)
  })
})

describe('coerceNodeConfig', () => {
  it('保证返回普通对象', () => {
    expect(coerceNodeConfig(undefined)).toEqual({})
    expect(coerceNodeConfig(null)).toEqual({})
    expect(coerceNodeConfig('{}')).toEqual({})
    expect(coerceNodeConfig('[1,2]')).toEqual({})
    expect(coerceNodeConfig('不是 json')).toEqual({})
    expect(coerceNodeConfig('{"formId":"f1"}')).toEqual({ formId: 'f1' })
  })
})
