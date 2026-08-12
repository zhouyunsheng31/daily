/**
 * searchCache.ts 单元测试 — Phase 12
 *
 * 覆盖重点：
 * 1. 缓存重建（ensureCacheReady 后 _getCachedRecords 返回数据）
 * 2. 并发去重（多次 ensureCacheReady 只重建一次）
 * 3. markSearchCacheStale 后下次 ensureCacheReady 触发重建
 * 4. _getCachedRecords 返回所有记录
 * 5. _resetCacheForTesting 重置缓存
 * 6. 失败兜底（单个适配器失败不阻塞其他）
 *
 * Mock 策略：
 * - vi.mock('../searchIndexAdapters')：拦截 buildAllAdapters，避免触发真实 IDB
 * - 通过 makeAdapter 构造可控的 SearchAdapter 测试桩
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import type { SearchAdapter, SearchableRecord } from '../searchCache'

vi.mock('../searchIndexAdapters', () => ({
  buildAllAdapters: vi.fn(),
}))

import {
  ensureCacheReady,
  _getCachedRecords,
  markSearchCacheStale,
  _resetCacheForTesting,
} from '../searchCache'
import { buildAllAdapters } from '../searchIndexAdapters'

const mockedBuildAllAdapters = vi.mocked(buildAllAdapters)

// ============================================================================
// 测试数据工厂
// ============================================================================

function makeRecord(
  id: string,
  storeId: string,
  type: SearchableRecord['type'],
  name?: string,
): SearchableRecord {
  return {
    id,
    storeId,
    type,
    highWeightFields: name ? { name } : {},
    mediumWeightFields: {},
    lowWeightFields: {},
    createdAt: 0,
    updatedAt: 0,
  }
}

function makeAdapter(
  name: string,
  records: SearchableRecord[],
  opts?: { fail?: boolean },
): SearchAdapter {
  const fn = async (): Promise<SearchableRecord[]> => {
    if (opts?.fail) throw new Error(`adapter ${name} failed`)
    return records
  }
  // ESM 严格模式下函数 name 属性只读，Object.assign 会抛 TypeError
  // 用 Object.defineProperty 绕过（name 是 configurable: true）
  Object.defineProperty(fn, 'name', { value: name, configurable: true })
  return fn as SearchAdapter
}

// ============================================================================
// 测试套件
// ============================================================================

describe('searchCache', () => {
  beforeEach(() => {
    _resetCacheForTesting()
    mockedBuildAllAdapters.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  test('1. ensureCacheReady 后 _getCachedRecords 返回数据', async () => {
    mockedBuildAllAdapters.mockReturnValue([
      makeAdapter('panels', [makeRecord('p1', 'panels', 'panel', 'Panel A')]),
    ])

    await ensureCacheReady()

    const records = _getCachedRecords()
    expect(records).toHaveLength(1)
    expect(records[0].id).toBe('p1')
    expect(records[0].storeId).toBe('panels')
  })

  test('2. 并发去重：多次并发 ensureCacheReady 只重建一次', async () => {
    let buildCount = 0
    // 用可控的 Promise 保证并发性
    let resolveAdapter!: (records: SearchableRecord[]) => void
    const pendingPromise = new Promise<SearchableRecord[]>((resolve) => {
      resolveAdapter = resolve
    })
    const adapterFn = (): Promise<SearchableRecord[]> => {
      buildCount++
      return pendingPromise
    }
    Object.defineProperty(adapterFn, 'name', { value: 'panels', configurable: true })
    const adapter = adapterFn as SearchAdapter

    mockedBuildAllAdapters.mockReturnValue([adapter])

    // 并发发起 3 次 ensureCacheReady
    const allPromise = Promise.all([
      ensureCacheReady(),
      ensureCacheReady(),
      ensureCacheReady(),
    ])

    // adapter 已被调用一次（buildCount=1），三个调用都在 await 同一个 cacheBuilding
    expect(buildCount).toBe(1)

    resolveAdapter([makeRecord('p1', 'panels', 'panel')])

    await allPromise

    // 重建仍然只发生一次
    expect(buildCount).toBe(1)
  })

  test('3. markSearchCacheStale 后下次 ensureCacheReady 触发重建', async () => {
    let buildCount = 0
    const makeCountingAdapter = (): SearchAdapter => {
      const fn = async (): Promise<SearchableRecord[]> => {
        buildCount++
        return [makeRecord('p1', 'panels', 'panel')]
      }
      Object.defineProperty(fn, 'name', { value: 'panels', configurable: true })
      return fn as SearchAdapter
    }

    mockedBuildAllAdapters.mockReturnValue([makeCountingAdapter()])

    // 第一次：触发重建
    await ensureCacheReady()
    expect(buildCount).toBe(1)

    // 不 mark stale，再次调用不应触发重建
    await ensureCacheReady()
    expect(buildCount).toBe(1)

    // mark stale 后触发重建
    markSearchCacheStale()
    mockedBuildAllAdapters.mockReturnValue([makeCountingAdapter()])
    await ensureCacheReady()
    expect(buildCount).toBe(2)
  })

  test('4. _getCachedRecords 返回所有记录（多 store 合并）', async () => {
    mockedBuildAllAdapters.mockReturnValue([
      makeAdapter('panels', [
        makeRecord('p1', 'panels', 'panel'),
        makeRecord('p2', 'panels', 'panel'),
      ]),
      makeAdapter('tasks', [makeRecord('t1', 'tasks', 'task')]),
    ])

    await ensureCacheReady()

    const records = _getCachedRecords()
    expect(records).toHaveLength(3)
    const ids = records.map((r) => r.id).sort()
    expect(ids).toEqual(['p1', 'p2', 't1'])
  })

  test('5. _resetCacheForTesting 重置缓存', async () => {
    mockedBuildAllAdapters.mockReturnValue([
      makeAdapter('panels', [makeRecord('p1', 'panels', 'panel')]),
    ])

    await ensureCacheReady()
    expect(_getCachedRecords()).toHaveLength(1)

    _resetCacheForTesting()

    expect(_getCachedRecords()).toHaveLength(0)
  })

  test('6. 失败兜底：单个适配器失败不阻塞其他', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      mockedBuildAllAdapters.mockReturnValue([
        makeAdapter('panels', [makeRecord('p1', 'panels', 'panel')]),
        makeAdapter('tasks', [], { fail: true }),
        makeAdapter('notes', [makeRecord('n1', 'notes', 'note')]),
      ])

      await ensureCacheReady()

      const records = _getCachedRecords()
      // tasks 失败返回空数组，但 panels 和 notes 应该被记录
      expect(records).toHaveLength(2)
      const storeIds = new Set(records.map((r) => r.storeId))
      expect(storeIds.has('panels')).toBe(true)
      expect(storeIds.has('notes')).toBe(true)
      expect(storeIds.has('tasks')).toBe(false)
      // 失败的适配器应该被 console.error 记录
      expect(errSpy).toHaveBeenCalled()
    } finally {
      errSpy.mockRestore()
    }
  })

  test('7. 空记录的适配器不入缓存（records.length === 0 时不 set）', async () => {
    mockedBuildAllAdapters.mockReturnValue([
      makeAdapter('emptyStore', []),
      makeAdapter('panels', [makeRecord('p1', 'panels', 'panel')]),
    ])

    await ensureCacheReady()

    const records = _getCachedRecords()
    expect(records).toHaveLength(1)
    expect(records[0].storeId).toBe('panels')
  })
})
