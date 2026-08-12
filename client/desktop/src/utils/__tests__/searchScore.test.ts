/**
 * searchScore.ts 单元测试 — Phase 12
 *
 * 覆盖重点：
 * 1. 高权重字段命中得分 3
 * 2. 中权重字段命中得分 2
 * 3. 低权重字段命中得分 1
 * 4. 多字段命中累加
 * 5. 不命中返回 0
 * 6. pickTopN 按分数降序取前 N
 *
 * 说明：scoreRecord / pickTopN 是纯函数，无需 mock。
 */
import { describe, test, expect } from 'vitest'
import { scoreRecord, pickTopN } from '../searchScore'
import type { SearchableRecord } from '../searchCache'

// ============================================================================
// 测试数据工厂
// ============================================================================

function makeRecord(opts: {
  high?: Record<string, string>
  medium?: Record<string, string>
  low?: Record<string, string>
}): SearchableRecord {
  return {
    id: 'test-id',
    storeId: 'test',
    type: 'note',
    highWeightFields: opts.high ?? {},
    mediumWeightFields: opts.medium ?? {},
    lowWeightFields: opts.low ?? {},
    createdAt: 0,
    updatedAt: 0,
  }
}

// ============================================================================
// 测试套件
// ============================================================================

describe('searchScore', () => {
  test('1. 高权重字段命中得分 3', () => {
    const record = makeRecord({ high: { name: 'hello world' } })
    const result = scoreRecord(record, ['hello'])
    expect(result.score).toBe(3)
    expect(result.matchedField).toBe('name')
    expect(result.snippet).toContain('hello')
  })

  test('2. 中权重字段命中得分 2', () => {
    const record = makeRecord({ medium: { content: 'hello world' } })
    const result = scoreRecord(record, ['hello'])
    expect(result.score).toBe(2)
    expect(result.matchedField).toBe('content')
  })

  test('3. 低权重字段命中得分 1', () => {
    const record = makeRecord({ low: { tags: 'hello world' } })
    const result = scoreRecord(record, ['hello'])
    expect(result.score).toBe(1)
    expect(result.matchedField).toBe('tags')
  })

  test('4. 多字段命中累加', () => {
    const record = makeRecord({
      high: { name: 'hello' },
      medium: { content: 'hello' },
      low: { tags: 'hello' },
    })
    const result = scoreRecord(record, ['hello'])
    expect(result.score).toBe(6) // 3 + 2 + 1
  })

  test('5. 不命中返回 0', () => {
    const record = makeRecord({ high: { name: 'world' } })
    const result = scoreRecord(record, ['hello'])
    expect(result.score).toBe(0)
    expect(result.matchedField).toBe('')
    expect(result.snippet).toBe('')
  })

  test('6. pickTopN 按分数降序取前 N', () => {
    const hits = [
      { score: 1, id: 'a' },
      { score: 5, id: 'b' },
      { score: 3, id: 'c' },
      { score: 2, id: 'd' },
    ]
    const top = pickTopN(hits, 2)
    expect(top).toHaveLength(2)
    expect(top[0].score).toBe(5)
    expect(top[1].score).toBe(3)
  })

  test('7. 空 tokens 返回 score 0', () => {
    const record = makeRecord({ high: { name: 'hello' } })
    const result = scoreRecord(record, [])
    expect(result.score).toBe(0)
  })

  test('8. snippet 截断到 120 字符', () => {
    const longText = 'a'.repeat(200)
    const record = makeRecord({ high: { name: longText } })
    const result = scoreRecord(record, ['a'])
    expect(result.snippet.length).toBe(120)
  })
})
