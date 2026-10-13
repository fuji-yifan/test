/**
 * 超时熔断纯函数（阶段 6 / S7.1）。
 */
import { describe, expect, it } from 'vitest'
import { withTimeout, isTimeoutError, TimeoutError } from '../src/modules/harness/timeout'

describe('withTimeout', () => {
  it('未超时：原样返回结果', async () => {
    const v = await withTimeout(Promise.resolve(42), 50, 'x')
    expect(v).toBe(42)
  })

  it('超时：抛 TimeoutError（name=TimeoutError，区别于 AbortError）', async () => {
    const slow = new Promise((r) => setTimeout(() => r('late'), 50))
    await expect(withTimeout(slow, 10, '工具 foo')).rejects.toBeInstanceOf(TimeoutError)
    try {
      await withTimeout(slow, 10, '工具 foo')
    } catch (err) {
      expect(isTimeoutError(err)).toBe(true)
      expect((err as Error).name).toBe('TimeoutError')
    }
  })

  it('ms<=0：不设超时（原样返回）', async () => {
    const v = await withTimeout(Promise.resolve('ok'), 0, 'x')
    expect(v).toBe('ok')
  })

  it('底层 reject 原样透传（不是超时）', async () => {
    const boom = Promise.reject(new Error('boom'))
    await expect(withTimeout(boom, 50, 'x')).rejects.toThrow('boom')
  })
})
