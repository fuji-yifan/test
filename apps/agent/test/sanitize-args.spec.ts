/**
 * 审计参数脱敏纯函数（阶段 6 / S2）。
 */
import { describe, expect, it } from 'vitest'
import { sanitizeArgs, serializeArgsPreview } from '../src/modules/audit/sanitize-args'

describe('sanitizeArgs', () => {
  it('脱敏 token（工具路径注入的明文 token 不得进审计）', () => {
    const out = sanitizeArgs({ target: '表单', token: 'eyJhbGciOiJIUzI1NiJ9.secret.jwt' })
    expect(out.token).toBe('[REDACTED]')
    expect(out.target).toBe('表单')
    expect(JSON.stringify(out)).not.toContain('eyJhbGciOiJIUzI1NiJ9')
  })

  it('脱敏大小写不敏感 + 多种敏感键名', () => {
    const out = sanitizeArgs({
      Authorization: 'Bearer abc',
      api_key: 'sk-123',
      apiKey: 'sk-456',
      passwd: 'p',
      mySecretField: 's',
    })
    expect(out.Authorization).toBe('[REDACTED]')
    expect(out.api_key).toBe('[REDACTED]')
    expect(out.apiKey).toBe('[REDACTED]')
    expect(out.passwd).toBe('[REDACTED]')
    expect(out.mySecretField).toBe('[REDACTED]')
  })

  it('嵌套对象里的敏感键也被脱敏', () => {
    const out = sanitizeArgs({ headers: { token: 'x', accept: 'json' } }) as any
    expect(out.headers.token).toBe('[REDACTED]')
    expect(out.headers.accept).toBe('json')
  })

  it('超长字符串值被截断（含长度提示）', () => {
    const big = 'a'.repeat(2000)
    const out = sanitizeArgs({ existingSchema: big })
    expect(out.existingSchema).toBe('[truncated 2000 chars]')
  })

  it('短字符串与标量原样保留', () => {
    const out = sanitizeArgs({ n: 1, ok: true, name: '客户登记表', empty: null })
    expect(out).toEqual({ n: 1, ok: true, name: '客户登记表', empty: null })
  })

  it('数组递归脱敏 + 超长数组只留前 N 项', () => {
    const out = sanitizeArgs({ list: [{ token: 'a' }, { v: 2 }] }) as any
    expect(out.list[0].token).toBe('[REDACTED]')
    expect(out.list[1].v).toBe(2)
  })
})

describe('serializeArgsPreview', () => {
  it('返回脱敏后的 JSON 字符串，且不含明文 token', () => {
    const s = serializeArgsPreview({ token: 'secret-abc', name: 'x' })
    expect(s).toContain('[REDACTED]')
    expect(s).not.toContain('secret-abc')
  })

  it('整体超长时按 max 截断', () => {
    const many = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`k${i}`, `value-${i}`]))
    const full = JSON.stringify(sanitizeArgs(many))
    const s = serializeArgsPreview(many, 50)
    expect(full.length).toBeGreaterThan(50)
    expect(s.length).toBeLessThan(full.length)
    expect(s).toContain('truncated')
  })
})
