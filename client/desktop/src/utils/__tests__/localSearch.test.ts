/**
 * localSearch.ts 单元测试 — Phase 12
 *
 * 覆盖重点：
 * 1. 空查询返回空结果
 * 2. type 过滤（只返回指定 type 的记录）
 * 3. limit 截断（limit=5 时返回最多 5 条）
 * 4. tookMs 准确（非负数）
 * 5. 命中（查询匹配的记录返回）
 * 6. 不命中（查询不匹配的记录不返回）
 *
 * Mock 策略：
 * - vi.mock('../searchCache')：拦截 ensureCacheReady / _getCachedRecords，避免触发真实 IDB
 * - tokenize / scoreRecord / pickTopN 保持真实实现（纯函数）
 */
import { describe, test, expect, beforeEach, vi } from 'vitest'
import type { SearchableRecord } from '../searchCache'

vi.mock('../searchCache', () => ({
  ensureCacheReady: vi.fn().mockResolvedValue(undefined),
  _getCachedRecords: vi.fn().mockReturnValue([]),
}))

import { ensureCacheReady, _getCachedRecords } from '../searchCache'
import { runLocalSearch } from '../localSearch'

const mockedEnsureCacheReady = vi.mocked(ensureCacheReady)
const mockedGetCachedRecords = vi.mocked(_getCachedRecords)

// ============================================================================
// 测试数据工厂
// ============================================================================

function makeRecord(
  id: string,
  type: SearchableRecord['type'],
  name: string,
  content?: string,
): SearchableRecord {
  return {
    id,
    storeId: type,
    type,
    highWeightFields: { name },
    mediumWeightFields: content ? { content } : {},
    lowWeightFields: {},
    createdAt: 0,
    updatedAt: 0,
  }
}

function setSearchRecords(records: SearchableRecord[]): void {
  mockedGetCachedRecords.mockReturnValue(records)
}

// ============================================================================
// 测试套件
// ============================================================================

describe('localSearch', () => {
  beforeEach(() => {
    mockedEnsureCacheReady.mockClear()
    mockedGetCachedRecords.mockReset()
    mockedGetCachedRecords.mockReturnValue([])
  })

  test('1. 空查询返回空结果', async () => {
    const result = await runLocalSearch({ query: '' })
    expect(result.results).toEqual([])
    expect(result.total).toBe(0)
    // 空查询不应触发缓存重建
    expect(mockedEnsureCacheReady).not.toHaveBeenCalled()
  })

  test('2. type 过滤（只返回指定 type 的记录）', async () => {
    setSearchRecords([
      makeRecord('n1', 'note', 'hello note'),
      makeRecord('t1', 'task', 'hello task'),
      makeRecord('n2', 'note', 'hello note 2'),
    ])

    const result = await runLocalSearch({ query: 'hello', type: 'note' })

    expect(result.results.every((h) => h.type === 'note')).toBe(true)
    expect(result.total).toBe(2)
  })

  test('3. limit 截断（limit=2 时返回最多 2 条）', async () => {
    const records: SearchableRecord[] = []
    for (let i = 0; i < 10; i++) {
      records.push(makeRecord(`n${i}`, 'note', `hello ${i}`))
    }
    setSearchRecords(records)

    const result = await runLocalSearch({ query: 'hello', limit: 2 })
    expect(result.results).toHaveLength(2)
    // total 反映所有命中数（未被 limit 截断）
    expect(result.total).toBe(10)
  })

  test('4. tookMs 准确（非负数）', async () => {
    setSearchRecords([makeRecord('n1', 'note', 'hello')])
    const result = await runLocalSearch({ query: 'hello' })
    expect(result.tookMs).toBeGreaterThanOrEqual(0)
    expect(typeof result.tookMs).toBe('number')
  })

  test('5. 命中（查询匹配的记录返回）', async () => {
    setSearchRecords([
      makeRecord('n1', 'note', 'my hello world'),
      makeRecord('n2', 'note', 'unrelated content'),
    ])

    const result = await runLocalSearch({ query: 'hello' })
    expect(result.total).toBe(1)
    expect(result.results[0].id).toBe('n1')
    expect(result.results[0].title).toBe('my hello world')
  })

  test('6. 不命中（查询不匹配的记录不返回）', async () => {
    setSearchRecords([
      makeRecord('n1', 'note', 'completely unrelated'),
      makeRecord('n2', 'note', 'also unrelated'),
    ])

    const result = await runLocalSearch({ query: 'hello' })
    expect(result.total).toBe(0)
    expect(result.results).toEqual([])
  })

  test('7. limit 超过 HARD_LIMIT(50) 时被截断为 50', async () => {
    const records: SearchableRecord[] = []
    for (let i = 0; i < 60; i++) {
      records.push(makeRecord(`n${i}`, 'note', `hello ${i}`))
    }
    setSearchRecords(records)

    const result = await runLocalSearch({ query: 'hello', limit: 100 })
    expect(result.results).toHaveLength(50)
    expect(result.total).toBe(60)
  })

  test('8. limit 默认值为 20', async () => {
    const records: SearchableRecord[] = []
    for (let i = 0; i < 30; i++) {
      records.push(makeRecord(`n${i}`, 'note', `hello ${i}`))
    }
    setSearchRecords(records)

    const result = await runLocalSearch({ query: 'hello' })
    expect(result.results).toHaveLength(20)
    expect(result.total).toBe(30)
  })
})
