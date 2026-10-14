/**
 * 用户长期记忆的纯函数层（阶段 8 §3.7）：解析 + 排序 + 护栏。不碰 LLM/DB。
 */
import { describe, expect, it } from 'vitest'
import { capCandidates, parseExtraction, rankMemories } from '../src/modules/memory/user-memory.pure'
import { MEMORY_KEY_MAX, MEMORY_VALUE_MAX, type UserMemoryRecord } from '../src/modules/memory/user-memory.types'

function rec(over: Partial<UserMemoryRecord> = {}): UserMemoryRecord {
  return {
    id: 'm1',
    userId: 'u1',
    workspaceId: 'w1',
    kind: 'preference',
    key: 'k',
    value: 'v',
    confidence: 0.6,
    state: 'active',
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }
}

describe('parseExtraction', () => {
  it('解析裸 JSON 数组', () => {
    const raw = '[{"kind":"preference","key":"语言","value":"中文","confidence":0.9}]'
    const out = parseExtraction(raw)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ kind: 'preference', key: '语言', value: '中文', confidence: 0.9 })
  })

  it('剥 ```json 围栏并忽略前后噪声', () => {
    const raw = '好的，结果如下：\n```json\n[{"kind":"identity","key":"公司","value":"XX科技"}]\n```\n以上。'
    const out = parseExtraction(raw)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ kind: 'identity', key: '公司', value: 'XX科技' })
  })

  it('非法 JSON / 非数组 → []', () => {
    expect(parseExtraction('不是 JSON')).toEqual([])
    expect(parseExtraction('{"kind":"preference"}')).toEqual([])
    expect(parseExtraction('')).toEqual([])
  })

  it('kind 白名单：未知种类丢弃', () => {
    const raw = '[{"kind":"bogus","key":"a","value":"b"},{"kind":"conclusion","key":"c","value":"d"}]'
    const out = parseExtraction(raw)
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('conclusion')
  })

  it('敏感内容（密码/token/证件）丢弃', () => {
    const raw = JSON.stringify([
      { kind: 'identity', key: '密码', value: 'hunter2' },
      { kind: 'identity', key: '常用登录名', value: 'alice' },
      { kind: 'entity', key: '接口', value: 'api key sk-xx' },
    ])
    const out = parseExtraction(raw)
    expect(out).toHaveLength(1)
    expect(out[0].key).toBe('常用登录名')
  })

  it('批内按 (kind,key) 去重，保留 confidence 更高者', () => {
    const raw = JSON.stringify([
      { kind: 'preference', key: '语言', value: '英文', confidence: 0.4 },
      { kind: 'preference', key: '语言', value: '中文', confidence: 0.8 },
    ])
    const out = parseExtraction(raw)
    expect(out).toHaveLength(1)
    expect(out[0].value).toBe('中文')
    expect(out[0].confidence).toBe(0.8)
  })

  it('空 key/value 丢弃，超长字段截断', () => {
    const long = 'x'.repeat(MEMORY_VALUE_MAX + 50)
    const longKey = 'y'.repeat(MEMORY_KEY_MAX + 20)
    const raw = JSON.stringify([
      { kind: 'preference', key: '', value: 'v' },
      { kind: 'preference', key: 'k', value: '' },
      { kind: 'preference', key: longKey, value: long },
    ])
    const out = parseExtraction(raw)
    expect(out).toHaveLength(1)
    expect(out[0].key.length).toBe(MEMORY_KEY_MAX)
    expect(out[0].value.length).toBe(MEMORY_VALUE_MAX)
  })

  it('confidence 越界被夹到 [0,1]，非数回落 0.6', () => {
    const raw = JSON.stringify([
      { kind: 'preference', key: 'a', value: 'b', confidence: 5 },
      { kind: 'preference', key: 'c', value: 'd', confidence: 'bad' },
    ])
    const out = parseExtraction(raw)
    const byKey = Object.fromEntries(out.map((c) => [c.key, c.confidence]))
    expect(byKey['a']).toBe(1)
    expect(byKey['c']).toBe(0.6)
  })
})

describe('capCandidates', () => {
  it('按上限截断；上限 ≤0 → []', () => {
    const list = parseExtraction(
      JSON.stringify([
        { kind: 'preference', key: 'a', value: '1' },
        { kind: 'preference', key: 'b', value: '2' },
        { kind: 'preference', key: 'c', value: '3' },
      ]),
    )
    expect(capCandidates(list, 2)).toHaveLength(2)
    expect(capCandidates(list, 0)).toEqual([])
  })
})

describe('rankMemories', () => {
  const now = 10 * 24 * 3600 * 1000
  const old = now - 30 * 24 * 3600 * 1000 // 30 天前，新近度为 0
  const fresh = now - 3600 * 1000 // 1 小时前，新近度接近满

  it('词重合优先于新近度', () => {
    const records = [
      rec({ id: 'old-match', key: '常用表单', value: '教职工信息', updatedAt: old }),
      rec({ id: 'fresh-nomatch', key: '语言', value: '中文', updatedAt: fresh }),
    ]
    const out = rankMemories(records, '教职工信息表', now, 5)
    expect(out[0].id).toBe('old-match')
  })

  it('query 为空时退化为纯新近度', () => {
    const records = [
      rec({ id: 'older', key: 'a', value: 'x', updatedAt: old }),
      rec({ id: 'newer', key: 'b', value: 'y', updatedAt: fresh }),
    ]
    const out = rankMemories(records, '', now, 5)
    expect(out[0].id).toBe('newer')
  })

  it('返回前 topK 条；topK ≤0 → []', () => {
    const records = [rec({ id: 'a' }), rec({ id: 'b' }), rec({ id: 'c' })]
    expect(rankMemories(records, 'x', now, 2)).toHaveLength(2)
    expect(rankMemories(records, 'x', now, 0)).toEqual([])
  })
})
