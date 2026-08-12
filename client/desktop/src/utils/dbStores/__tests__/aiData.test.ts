/**
 * aiData 单元测试 — Phase 11 P1
 *
 * 覆盖重点：
 * 1. saveAIConversation API 成功路径（updateEntity）
 * 2. saveAIConversation API 404 时降级到 createEntity（upsertEntity 逻辑）
 * 3. getAIMemoriesByCategory API 路径（queryEntities + 按 category 过滤）
 * 4. updateAIMemory API 路径（getEntity + upsertEntity）
 * 5. updateAIMemory IDB 路径（ensureV2Ready + runIdbTransaction）
 * 6. deleteAIMemory API 路径（deleteEntity）
 * 7. cleanupExpiredMemories（过滤过期记忆 + batchDeleteEntities）
 * 8. toggleAIMemoryPin API 路径（切换 pinned 布尔值）
 * 9. withFallback 降级：API 抛错 → IDB 路径被调用
 * 10. clearAllAIMemories API 路径（批量删除）
 *
 * Mock 策略：
 * - vi.mock('@/api/entities')：替换 entitiesApi 的 6 个函数为 vi.fn()
 * - vi.mock('@/api/adapter')：withFallback 模拟真实行为（try API, catch → IDB），
 *   getBackend 返回可控值（默认 'api'）
 * - vi.mock('@/utils/db')：替换 ensureV2Ready / runIdbTransaction / upsertRecord
 *
 * 注意：aiData.ts 中 upsertEntity 是内部 helper（try updateEntity → catch 404 → createEntity），
 *      测试通过观察 entitiesApi.updateEntity / createEntity 的调用来验证此逻辑。
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import type { AIMemory, AIConversation } from '@/types'

// ============================================================================
// vi.mock：用 vi.hoisted 暴露可变 mock 对象
// ============================================================================
const mocks = vi.hoisted(() => ({
  // entities API
  updateEntity: vi.fn(),
  createEntity: vi.fn(),
  queryEntities: vi.fn(),
  batchDeleteEntities: vi.fn(),
  deleteEntity: vi.fn(),
  getEntity: vi.fn(),
  // adapter
  withFallback: vi.fn(async (apiFn: () => Promise<unknown>, idbFn: () => Promise<unknown>) => {
    // 模拟真实 withFallback 行为：API 优先，失败降级到 IDB
    try {
      return await apiFn()
    } catch {
      return await idbFn()
    }
  }),
  getBackend: vi.fn(() => 'api' as 'api' | 'idb'),
  // db
  ensureV2Ready: vi.fn().mockResolvedValue(undefined),
  runIdbTransaction: vi.fn().mockResolvedValue(undefined),
  upsertRecord: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/api/entities', () => ({
  updateEntity: mocks.updateEntity,
  createEntity: mocks.createEntity,
  queryEntities: mocks.queryEntities,
  batchDeleteEntities: mocks.batchDeleteEntities,
  deleteEntity: mocks.deleteEntity,
  getEntity: mocks.getEntity,
}))

vi.mock('@/api/adapter', () => ({
  withFallback: mocks.withFallback,
  getBackend: mocks.getBackend,
}))

vi.mock('@/utils/db', () => ({
  ensureV2Ready: mocks.ensureV2Ready,
  runIdbTransaction: mocks.runIdbTransaction,
  upsertRecord: mocks.upsertRecord,
}))

// ============================================================================
// 导入被测模块（必须在 vi.mock 之后）
// ============================================================================
import {
  saveAIConversation,
  getAIConversationsBySession,
  deleteAIConversationsBySession,
  deleteAllAIConversations,
  saveAIMemory,
  getAIMemoriesByCategory,
  getAIMemoriesByKey,
  getAllAIMemories,
  getPinnedMemories,
  clearAllAIMemories,
  deleteAIMemory,
  updateAIMemory,
  toggleAIMemoryPin,
  cleanupExpiredMemories,
  getAIMemoriesByCategoryAndKey,
  saveAIAuditLog,
  getAIAuditLogsBySession,
  getAllAIAuditLogs,
  clearAIAuditLogs,
  cleanupExpiredAuditLogs,
} from '../aiData'

// ============================================================================
// 测试数据 helper
// ============================================================================
function makeMemory(overrides: Partial<AIMemory> = {}): AIMemory {
  return {
    id: 'mem-1',
    category: 'work',
    key: 'task-style',
    value: 'prefers concise answers',
    confidence: 0.9,
    source: 'user_explicit',
    pinned: false,
    createdAt: 1000,
    updatedAt: 1000,
    schemaVersion: 1,
    ...overrides,
  }
}

function makeEntityDTO(memory: AIMemory) {
  return {
    id: memory.id,
    type: 'aiMemory',
    scope: 'default',
    panelId: null,
    widgetId: null,
    data: memory as unknown as Record<string, unknown>,
    recordStatus: 'active',
    version: 1,
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt,
  }
}

function makeConversation(overrides: Partial<AIConversation> = {}): AIConversation {
  return {
    id: 'conv-1',
    sessionId: 'session-1',
    role: 'user',
    content: 'hello',
    createdAt: 1000,
    schemaVersion: 1,
    ...overrides,
  }
}

// ============================================================================
// 测试套件
// ============================================================================
describe('aiData', () => {
  beforeEach(() => {
    // 重置所有 mock
    vi.clearAllMocks()
    // 默认 backend = 'api'
    mocks.getBackend.mockReturnValue('api')
    // 默认 withFallback 模拟真实行为（try API, catch → IDB）
    mocks.withFallback.mockImplementation(async (apiFn: () => Promise<unknown>, idbFn: () => Promise<unknown>) => {
      try {
        return await apiFn()
      } catch {
        return await idbFn()
      }
    })
    // 抑制源码 console.warn 噪音
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // --------------------------------------------------------------------------
  // 1. saveAIConversation API 成功路径
  // --------------------------------------------------------------------------
  test('1. saveAIConversation API 成功时调用 entitiesApi.updateEntity', async () => {
    // updateEntity 成功返回
    mocks.updateEntity.mockResolvedValue({ id: 'conv-1' })

    const conv = makeConversation()
    await saveAIConversation(conv)

    // 验证 updateEntity 被调用，参数正确
    expect(mocks.updateEntity).toHaveBeenCalledTimes(1)
    expect(mocks.updateEntity).toHaveBeenCalledWith('conv-1', {
      data: conv as unknown as Record<string, unknown>,
      panelId: null,
      widgetId: null,
    })
    // createEntity 不应被调用（未触发 404）
    expect(mocks.createEntity).not.toHaveBeenCalled()
  })

  // --------------------------------------------------------------------------
  // 2. saveAIConversation API 404 时降级到 createEntity
  // --------------------------------------------------------------------------
  test('2. saveAIConversation API 404 时降级调用 createEntity（upsertEntity 逻辑）', async () => {
    // updateEntity 抛出 404 错误（message 包含 'not found'）
    const notFoundErr = Object.assign(new Error('Entity not found'), { status: 404 })
    mocks.updateEntity.mockRejectedValue(notFoundErr)
    mocks.createEntity.mockResolvedValue({ id: 'conv-1' })

    const conv = makeConversation()
    await saveAIConversation(conv)

    // 验证 updateEntity 被调用（第一次尝试）
    expect(mocks.updateEntity).toHaveBeenCalledTimes(1)
    // 验证 createEntity 被调用（404 降级）
    expect(mocks.createEntity).toHaveBeenCalledTimes(1)
    expect(mocks.createEntity).toHaveBeenCalledWith({
      id: 'conv-1',
      type: 'aiConversation',
      scope: 'default',
      data: conv as unknown as Record<string, unknown>,
      panelId: null,
      widgetId: null,
    })
  })

  // --------------------------------------------------------------------------
  // 3. getAIMemoriesByCategory API 路径
  // --------------------------------------------------------------------------
  test('3. getAIMemoriesByCategory 调用 queryEntities 并按 category 过滤', async () => {
    const m1 = makeMemory({ id: 'm1', category: 'work' })
    const m2 = makeMemory({ id: 'm2', category: 'personal' })
    const m3 = makeMemory({ id: 'm3', category: 'work' })
    // queryEntities 返回全部记忆
    mocks.queryEntities.mockResolvedValue({
      items: [makeEntityDTO(m1), makeEntityDTO(m2), makeEntityDTO(m3)],
      total: 3,
      limit: 100,
      offset: 0,
    })

    const result = await getAIMemoriesByCategory('work')

    // 验证 queryEntities 被调用，参数 type='aiMemory'
    expect(mocks.queryEntities).toHaveBeenCalledWith({ type: 'aiMemory' })
    // 验证过滤结果只包含 category='work' 的记忆
    expect(result).toHaveLength(2)
    expect(result.map(m => m.id).sort()).toEqual(['m1', 'm3'])
  })

  // --------------------------------------------------------------------------
  // 4. updateAIMemory API 路径
  // --------------------------------------------------------------------------
  test('4. updateAIMemory API 路径：读取 entity + 合并 updates + upsertEntity', async () => {
    const existingMemory = makeMemory({ id: 'mem-1', value: 'old value', pinned: false })
    mocks.getEntity.mockResolvedValue(makeEntityDTO(existingMemory))
    mocks.updateEntity.mockResolvedValue({ id: 'mem-1' })

    // 固定 Date.now 以验证 updatedAt
    vi.spyOn(Date, 'now').mockReturnValue(99999)

    await updateAIMemory('mem-1', { value: 'new value', pinned: true })

    // 验证 getEntity 被调用
    expect(mocks.getEntity).toHaveBeenCalledWith('mem-1')
    // 验证 updateEntity 被调用，data 包含合并后的字段 + updatedAt
    expect(mocks.updateEntity).toHaveBeenCalledTimes(1)
    const callArgs = mocks.updateEntity.mock.calls[0]
    expect(callArgs[0]).toBe('mem-1')
    expect(callArgs[1].data.value).toBe('new value')
    expect(callArgs[1].data.pinned).toBe(true)
    expect(callArgs[1].data.updatedAt).toBe(99999)
    // 验证未传递的字段保留原值
    expect(callArgs[1].data.id).toBe('mem-1')
    expect(callArgs[1].data.category).toBe('work')
  })

  // --------------------------------------------------------------------------
  // 5. updateAIMemory IDB 路径
  // --------------------------------------------------------------------------
  test('5. updateAIMemory IDB 路径：调用 ensureV2Ready + runIdbTransaction', async () => {
    // 切换到 IDB 模式
    mocks.getBackend.mockReturnValue('idb')

    await updateAIMemory('mem-1', { value: 'updated via idb' })

    // 验证 IDB 路径被调用
    expect(mocks.ensureV2Ready).toHaveBeenCalledTimes(1)
    expect(mocks.runIdbTransaction).toHaveBeenCalledTimes(1)
    // 验证 store 是 MEMORIES_STORE
    const txArgs = mocks.runIdbTransaction.mock.calls[0]
    expect(txArgs[0]).toEqual(['aiMemories'])
    expect(txArgs[1]).toBe('readwrite')
    // API 路径不应被调用
    expect(mocks.getEntity).not.toHaveBeenCalled()
    expect(mocks.updateEntity).not.toHaveBeenCalled()
  })

  // --------------------------------------------------------------------------
  // 6. deleteAIMemory API 路径
  // --------------------------------------------------------------------------
  test('6. deleteAIMemory API 路径：调用 entitiesApi.deleteEntity', async () => {
    mocks.deleteEntity.mockResolvedValue(undefined)

    await deleteAIMemory('mem-1')

    expect(mocks.deleteEntity).toHaveBeenCalledTimes(1)
    expect(mocks.deleteEntity).toHaveBeenCalledWith('mem-1')
  })

  // --------------------------------------------------------------------------
  // 7. cleanupExpiredMemories
  // --------------------------------------------------------------------------
  test('7. cleanupExpiredMemories 过滤过期记忆并调用 batchDeleteEntities', async () => {
    const now = 100000
    vi.spyOn(Date, 'now').mockReturnValue(now)

    const m1 = makeMemory({ id: 'm1', expiresAt: now - 1000 }) // 已过期
    const m2 = makeMemory({ id: 'm2', expiresAt: now + 10000 }) // 未过期
    const m3 = makeMemory({ id: 'm3' }) // 无 expiresAt，永不过期
    mocks.queryEntities.mockResolvedValue({
      items: [makeEntityDTO(m1), makeEntityDTO(m2), makeEntityDTO(m3)],
      total: 3,
      limit: 100,
      offset: 0,
    })
    mocks.batchDeleteEntities.mockResolvedValue(undefined)

    const count = await cleanupExpiredMemories()

    // 验证返回清理数量
    expect(count).toBe(1)
    // 验证 batchDeleteEntities 被调用，只删除过期的 m1
    expect(mocks.batchDeleteEntities).toHaveBeenCalledTimes(1)
    expect(mocks.batchDeleteEntities).toHaveBeenCalledWith(['m1'])
  })

  // --------------------------------------------------------------------------
  // 8. toggleAIMemoryPin API 路径
  // --------------------------------------------------------------------------
  test('8. toggleAIMemoryPin API 路径：切换 pinned 布尔值', async () => {
    const existingMemory = makeMemory({ id: 'mem-1', pinned: false })
    mocks.getEntity.mockResolvedValue(makeEntityDTO(existingMemory))
    mocks.updateEntity.mockResolvedValue({ id: 'mem-1' })

    vi.spyOn(Date, 'now').mockReturnValue(88888)

    await toggleAIMemoryPin('mem-1')

    // 验证 getEntity 读取现有记忆
    expect(mocks.getEntity).toHaveBeenCalledWith('mem-1')
    // 验证 updateEntity 被调用，pinned 已切换为 true
    expect(mocks.updateEntity).toHaveBeenCalledTimes(1)
    const callArgs = mocks.updateEntity.mock.calls[0]
    expect(callArgs[1].data.pinned).toBe(true)
    expect(callArgs[1].data.updatedAt).toBe(88888)
  })

  // --------------------------------------------------------------------------
  // 9. withFallback 降级：API 抛错 → IDB 路径被调用
  // --------------------------------------------------------------------------
  test('9. withFallback 降级：saveAIConversation API 抛错时走 IDB 路径', async () => {
    // updateEntity 抛出非 404 错误（如网络错误）
    mocks.updateEntity.mockRejectedValue(new Error('network error'))

    const conv = makeConversation()
    await saveAIConversation(conv)

    // 验证 updateEntity 被尝试
    expect(mocks.updateEntity).toHaveBeenCalledTimes(1)
    // 验证 IDB 降级路径被调用：ensureV2Ready + runIdbTransaction
    expect(mocks.ensureV2Ready).toHaveBeenCalledTimes(1)
    expect(mocks.runIdbTransaction).toHaveBeenCalledTimes(1)
    // 验证 runIdbTransaction 使用 CONVERSATIONS_STORE
    const txArgs = mocks.runIdbTransaction.mock.calls[0]
    expect(txArgs[0]).toEqual(['aiConversations'])
    expect(txArgs[1]).toBe('readwrite')
  })

  // --------------------------------------------------------------------------
  // 10. clearAllAIMemories API 路径
  // --------------------------------------------------------------------------
  test('10. clearAllAIMemories API 路径：查询全部 + 批量删除', async () => {
    const m1 = makeMemory({ id: 'm1' })
    const m2 = makeMemory({ id: 'm2' })
    mocks.queryEntities.mockResolvedValue({
      items: [makeEntityDTO(m1), makeEntityDTO(m2)],
      total: 2,
      limit: 100,
      offset: 0,
    })
    mocks.batchDeleteEntities.mockResolvedValue(undefined)

    await clearAllAIMemories()

    // 验证查询所有 aiMemory
    expect(mocks.queryEntities).toHaveBeenCalledWith({ type: 'aiMemory' })
    // 验证批量删除所有 id
    expect(mocks.batchDeleteEntities).toHaveBeenCalledTimes(1)
    expect(mocks.batchDeleteEntities).toHaveBeenCalledWith(['m1', 'm2'])
  })

  // --------------------------------------------------------------------------
  // 11. getAllAIMemories 返回所有记忆
  // --------------------------------------------------------------------------
  test('11. getAllAIMemories 返回所有记忆（不过滤）', async () => {
    const m1 = makeMemory({ id: 'm1', category: 'a' })
    const m2 = makeMemory({ id: 'm2', category: 'b' })
    mocks.queryEntities.mockResolvedValue({
      items: [makeEntityDTO(m1), makeEntityDTO(m2)],
      total: 2,
      limit: 100,
      offset: 0,
    })

    const result = await getAllAIMemories()

    expect(result).toHaveLength(2)
    expect(result.map(m => m.id).sort()).toEqual(['m1', 'm2'])
  })

  // --------------------------------------------------------------------------
  // 12. clearAllAIMemories 空列表时不调用 batchDeleteEntities
  // --------------------------------------------------------------------------
  test('12. clearAllAIMemories 在无记忆时不调用 batchDeleteEntities', async () => {
    mocks.queryEntities.mockResolvedValue({
      items: [],
      total: 0,
      limit: 100,
      offset: 0,
    })

    await clearAllAIMemories()

    expect(mocks.queryEntities).toHaveBeenCalledWith({ type: 'aiMemory' })
    // 无数据时不应调用批量删除
    expect(mocks.batchDeleteEntities).not.toHaveBeenCalled()
  })

  // --------------------------------------------------------------------------
  // 13. cleanupExpiredMemories 在无过期记忆时返回 0
  // --------------------------------------------------------------------------
  test('13. cleanupExpiredMemories 无过期记忆时返回 0 且不调用 batchDeleteEntities', async () => {
    const now = 100000
    vi.spyOn(Date, 'now').mockReturnValue(now)

    const m1 = makeMemory({ id: 'm1', expiresAt: now + 10000 }) // 未过期
    mocks.queryEntities.mockResolvedValue({
      items: [makeEntityDTO(m1)],
      total: 1,
      limit: 100,
      offset: 0,
    })

    const count = await cleanupExpiredMemories()

    expect(count).toBe(0)
    expect(mocks.batchDeleteEntities).not.toHaveBeenCalled()
  })

  // --------------------------------------------------------------------------
  // 14. toggleAIMemoryPin IDB 路径
  // --------------------------------------------------------------------------
  test('14. toggleAIMemoryPin IDB 路径：调用 ensureV2Ready + runIdbTransaction', async () => {
    mocks.getBackend.mockReturnValue('idb')

    await toggleAIMemoryPin('mem-1')

    expect(mocks.ensureV2Ready).toHaveBeenCalledTimes(1)
    expect(mocks.runIdbTransaction).toHaveBeenCalledTimes(1)
    const txArgs = mocks.runIdbTransaction.mock.calls[0]
    expect(txArgs[0]).toEqual(['aiMemories'])
    expect(txArgs[1]).toBe('readwrite')
    // API 路径不应被调用
    expect(mocks.getEntity).not.toHaveBeenCalled()
  })

  // --------------------------------------------------------------------------
  // 15. deleteAIMemory IDB 路径（通过 withFallback 降级）
  // --------------------------------------------------------------------------
  test('15. deleteAIMemory API 抛错时降级到 IDB 路径', async () => {
    // deleteEntity 抛错
    mocks.deleteEntity.mockRejectedValue(new Error('api down'))

    await deleteAIMemory('mem-1')

    // API 被尝试
    expect(mocks.deleteEntity).toHaveBeenCalledWith('mem-1')
    // IDB 降级被调用
    expect(mocks.ensureV2Ready).toHaveBeenCalledTimes(1)
    expect(mocks.runIdbTransaction).toHaveBeenCalledTimes(1)
    expect(mocks.runIdbTransaction.mock.calls[0][0]).toEqual(['aiMemories'])
  })
})

// ============================================================================
// 完整 IDB 路径覆盖测试 — 让 runIdbTransaction 真正调用 inner callback
//
// 目的：现有测试 5/14/15 只验证 runIdbTransaction 被调用，但 inner callback 没有执行，
//   导致 IDB 路径的 ctx.get / ctx.iterateStore / ctx.deleteChecked / ctx.indexGetAll
//   等行未覆盖。这里通过 mockImplementation 让 callback 真实执行，覆盖内部逻辑。
//
// 关键 mock 策略：
// - mocks.runIdbTransaction.mockImplementation(async (stores, mode, cb) => cb(mockCtx))
// - mockCtx 提供 get / indexGetAll / iterateStore / deleteChecked 等方法
// ============================================================================

/**
 * 创建一个 mock IdbTxContext，用于让 runIdbTransaction 的 inner callback 真实执行。
 * 各方法可通过参数覆盖默认行为。
 */
interface MockIdbCtx {
  get: ReturnType<typeof vi.fn>
  indexGetAll: ReturnType<typeof vi.fn>
  iterateStore: ReturnType<typeof vi.fn>
  deleteChecked: ReturnType<typeof vi.fn>
}

function createMockIdbCtx(overrides: Partial<MockIdbCtx> = {}): MockIdbCtx {
  return {
    get: vi.fn().mockResolvedValue(undefined),
    indexGetAll: vi.fn().mockResolvedValue([]),
    iterateStore: vi.fn().mockImplementation(async () => {}),
    deleteChecked: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

/**
 * 让 mocks.runIdbTransaction 真正调用 inner callback，并传入 mockCtx。
 * 返回 mockCtx 供测试断言。
 */
function installIdbCallbackExecutor(ctx: MockIdbCtx): MockIdbCtx {
  mocks.runIdbTransaction.mockImplementation(
    async (_stores: string[], _mode: string, cb: (ctx: MockIdbCtx) => Promise<unknown>) => {
      return await cb(ctx)
    },
  )
  return ctx
}

describe('aiData - 完整 IDB 路径覆盖', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // 默认 backend = 'idb'（让函数走 IDB 路径而非 API）
    mocks.getBackend.mockReturnValue('idb')
    // withFallback 模拟真实行为：当 backend='idb' 时直接走 IDB（跳过 API）
    mocks.withFallback.mockImplementation(async (apiFn: () => Promise<unknown>, idbFn: () => Promise<unknown>) => {
      if (mocks.getBackend() === 'idb') {
        return await idbFn()
      }
      try {
        return await apiFn()
      } catch {
        return await idbFn()
      }
    })
    // 抑制源码 console.warn 噪音
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  // --------------------------------------------------------------------------
  // 16. getAIConversationsBySession IDB 路径：indexGetAll by_sessionId
  // --------------------------------------------------------------------------
  test('16. getAIConversationsBySession IDB 路径：调用 indexGetAll(by_sessionId) + 返回数据', async () => {
    const conv1 = makeConversation({ id: 'c1', sessionId: 's1' })
    const mockCtx = createMockIdbCtx({
      indexGetAll: vi.fn().mockResolvedValue([
        { id: 'c1', data: conv1 },
      ]),
    })
    installIdbCallbackExecutor(mockCtx)

    const result = await getAIConversationsBySession('s1')

    expect(mocks.ensureV2Ready).toHaveBeenCalledTimes(1)
    expect(mocks.runIdbTransaction).toHaveBeenCalledTimes(1)
    // 验证 indexGetAll 调用参数
    expect(mockCtx.indexGetAll).toHaveBeenCalledWith('aiConversations', 'by_sessionId', 's1')
    // 验证返回值是 record.data
    expect(result).toEqual([conv1])
  })

  // --------------------------------------------------------------------------
  // 17. deleteAIConversationsBySession IDB 路径：iterateStore 风格的 deleteChecked
  //     实际源码使用 indexGetAll + deleteChecked 循环
  // --------------------------------------------------------------------------
  test('17. deleteAIConversationsBySession IDB 路径：indexGetAll + deleteChecked 循环', async () => {
    const mockCtx = createMockIdbCtx({
      indexGetAll: vi.fn().mockResolvedValue([
        { id: 'c1', data: { sessionId: 's1' } },
        { id: 'c2', data: { sessionId: 's1' } },
      ]),
    })
    installIdbCallbackExecutor(mockCtx)

    await deleteAIConversationsBySession('s1')

    expect(mocks.ensureV2Ready).toHaveBeenCalledTimes(1)
    expect(mockCtx.indexGetAll).toHaveBeenCalledWith('aiConversations', 'by_sessionId', 's1')
    // deleteChecked 应被调用 2 次（每个 record 一次）
    expect(mockCtx.deleteChecked).toHaveBeenCalledTimes(2)
    expect(mockCtx.deleteChecked).toHaveBeenNthCalledWith(1, 'aiConversations', { id: 'c1' })
    expect(mockCtx.deleteChecked).toHaveBeenNthCalledWith(2, 'aiConversations', { id: 'c2' })
  })

  // --------------------------------------------------------------------------
  // 18. deleteAllAIConversations IDB 路径：iterateStore + deleteChecked 循环
  // --------------------------------------------------------------------------
  test('18. deleteAllAIConversations IDB 路径：iterateStore + deleteChecked 循环', async () => {
    const mockCtx = createMockIdbCtx({
      iterateStore: vi.fn().mockImplementation(async (
        _store: string,
        visitor: (record: { id: string }) => void,
      ) => {
        visitor({ id: 'c1' })
        visitor({ id: 'c2' })
        visitor({ id: 'c3' })
      }),
    })
    installIdbCallbackExecutor(mockCtx)

    await deleteAllAIConversations()

    expect(mocks.ensureV2Ready).toHaveBeenCalledTimes(1)
    expect(mockCtx.iterateStore).toHaveBeenCalledTimes(1)
    // deleteChecked 调用 3 次
    expect(mockCtx.deleteChecked).toHaveBeenCalledTimes(3)
    expect(mockCtx.deleteChecked).toHaveBeenNthCalledWith(1, 'aiConversations', { id: 'c1' })
    expect(mockCtx.deleteChecked).toHaveBeenNthCalledWith(3, 'aiConversations', { id: 'c3' })
  })

  // --------------------------------------------------------------------------
  // 19. saveAIMemory IDB 路径：调用 upsertRecord
  // --------------------------------------------------------------------------
  test('19. saveAIMemory IDB 路径：调用 upsertRecord 写入记录', async () => {
    installIdbCallbackExecutor(createMockIdbCtx())

    const mem = makeMemory({ id: 'mem-idb-1' })
    await saveAIMemory(mem)

    expect(mocks.ensureV2Ready).toHaveBeenCalledTimes(1)
    expect(mocks.runIdbTransaction).toHaveBeenCalledTimes(1)
    expect(mocks.upsertRecord).toHaveBeenCalledTimes(1)
    // 验证 upsertRecord 参数
    const callArgs = mocks.upsertRecord.mock.calls[0]
    expect(callArgs[1]).toBe('aiMemories')
    expect(callArgs[2]).toBe('mem-idb-1')
    expect(callArgs[3]).toEqual(mem)
  })

  // --------------------------------------------------------------------------
  // 20. getAIMemoriesByKey IDB 路径：indexGetAll by_key
  // --------------------------------------------------------------------------
  test('20. getAIMemoriesByKey IDB 路径：调用 indexGetAll(by_key) + 返回数据', async () => {
    const m1 = makeMemory({ id: 'm1', key: 'task-style' })
    const mockCtx = createMockIdbCtx({
      indexGetAll: vi.fn().mockResolvedValue([{ id: 'm1', data: m1 }]),
    })
    installIdbCallbackExecutor(mockCtx)

    const result = await getAIMemoriesByKey('task-style')

    expect(mockCtx.indexGetAll).toHaveBeenCalledWith('aiMemories', 'by_key', 'task-style')
    expect(result).toEqual([m1])
  })

  // --------------------------------------------------------------------------
  // 21. getPinnedMemories IDB 路径：indexGetAll by_pinned 值为 1
  // --------------------------------------------------------------------------
  test('21. getPinnedMemories IDB 路径：调用 indexGetAll(by_pinned, 1)', async () => {
    const pinnedMem = makeMemory({ id: 'm1', pinned: true })
    const mockCtx = createMockIdbCtx({
      indexGetAll: vi.fn().mockResolvedValue([{ id: 'm1', data: pinnedMem }]),
    })
    installIdbCallbackExecutor(mockCtx)

    const result = await getPinnedMemories()

    expect(mockCtx.indexGetAll).toHaveBeenCalledWith('aiMemories', 'by_pinned', 1)
    expect(result).toEqual([pinnedMem])
  })

  // --------------------------------------------------------------------------
  // 22. getAllAIMemories IDB 路径：iterateStore 全量遍历
  // --------------------------------------------------------------------------
  test('22. getAllAIMemories IDB 路径：iterateStore 全量遍历 + 返回数据', async () => {
    const m1 = makeMemory({ id: 'm1' })
    const m2 = makeMemory({ id: 'm2' })
    const mockCtx = createMockIdbCtx({
      iterateStore: vi.fn().mockImplementation(async (
        _store: string,
        visitor: (record: { data: AIMemory }) => void,
      ) => {
        visitor({ data: m1 })
        visitor({ data: m2 })
      }),
    })
    installIdbCallbackExecutor(mockCtx)

    const result = await getAllAIMemories()

    expect(mockCtx.iterateStore).toHaveBeenCalledTimes(1)
    expect(result).toEqual([m1, m2])
  })

  // --------------------------------------------------------------------------
  // 23. clearAllAIMemories IDB 路径：iterateStore + deleteChecked 循环
  // --------------------------------------------------------------------------
  test('23. clearAllAIMemories IDB 路径：iterateStore + deleteChecked 循环', async () => {
    const mockCtx = createMockIdbCtx({
      iterateStore: vi.fn().mockImplementation(async (
        _store: string,
        visitor: (record: { id: string }) => void,
      ) => {
        visitor({ id: 'm1' })
        visitor({ id: 'm2' })
      }),
    })
    installIdbCallbackExecutor(mockCtx)

    await clearAllAIMemories()

    expect(mockCtx.iterateStore).toHaveBeenCalledTimes(1)
    expect(mockCtx.deleteChecked).toHaveBeenCalledTimes(2)
    expect(mockCtx.deleteChecked).toHaveBeenNthCalledWith(1, 'aiMemories', { id: 'm1' })
  })

  // --------------------------------------------------------------------------
  // 24. updateAIMemory IDB 路径：ctx.get 命中 → upsertRecord 更新
  // --------------------------------------------------------------------------
  test('24. updateAIMemory IDB 路径：existing 存在时合并 updates + upsertRecord', async () => {
    const existingMemory = makeMemory({ id: 'mem-1', value: 'old value' })
    const mockCtx = createMockIdbCtx({
      get: vi.fn().mockResolvedValue({ id: 'mem-1', data: existingMemory, version: 1 }),
    })
    installIdbCallbackExecutor(mockCtx)
    vi.spyOn(Date, 'now').mockReturnValue(12345)

    await updateAIMemory('mem-1', { value: 'new value' })

    expect(mockCtx.get).toHaveBeenCalledWith('aiMemories', 'mem-1')
    expect(mocks.upsertRecord).toHaveBeenCalledTimes(1)
    const callArgs = mocks.upsertRecord.mock.calls[0]
    expect(callArgs[1]).toBe('aiMemories')
    expect(callArgs[2]).toBe('mem-1')
    expect(callArgs[3].value).toBe('new value')
    expect(callArgs[3].updatedAt).toBe(12345)
    // 未传递字段保留
    expect(callArgs[3].category).toBe('work')
  })

  // --------------------------------------------------------------------------
  // 25. updateAIMemory IDB 路径：existing 不存在时直接 return（不调用 upsertRecord）
  // --------------------------------------------------------------------------
  test('25. updateAIMemory IDB 路径：existing 不存在时不调用 upsertRecord', async () => {
    const mockCtx = createMockIdbCtx({
      get: vi.fn().mockResolvedValue(undefined),
    })
    installIdbCallbackExecutor(mockCtx)

    await updateAIMemory('mem-missing', { value: 'whatever' })

    expect(mockCtx.get).toHaveBeenCalledWith('aiMemories', 'mem-missing')
    expect(mocks.upsertRecord).not.toHaveBeenCalled()
  })

  // --------------------------------------------------------------------------
  // 26. toggleAIMemoryPin IDB 路径：existing 存在时翻转 pinned
  // --------------------------------------------------------------------------
  test('26. toggleAIMemoryPin IDB 路径：existing 存在时翻转 pinned + upsertRecord', async () => {
    const existingMemory = makeMemory({ id: 'mem-1', pinned: false })
    const mockCtx = createMockIdbCtx({
      get: vi.fn().mockResolvedValue({ id: 'mem-1', data: existingMemory, version: 1 }),
    })
    installIdbCallbackExecutor(mockCtx)
    vi.spyOn(Date, 'now').mockReturnValue(99999)

    await toggleAIMemoryPin('mem-1')

    expect(mockCtx.get).toHaveBeenCalledWith('aiMemories', 'mem-1')
    expect(mocks.upsertRecord).toHaveBeenCalledTimes(1)
    const callArgs = mocks.upsertRecord.mock.calls[0]
    expect(callArgs[3].pinned).toBe(true) // false → true
    expect(callArgs[3].updatedAt).toBe(99999)
  })

  // --------------------------------------------------------------------------
  // 27. toggleAIMemoryPin IDB 路径：existing 不存在时不调用 upsertRecord
  // --------------------------------------------------------------------------
  test('27. toggleAIMemoryPin IDB 路径：existing 不存在时不调用 upsertRecord', async () => {
    const mockCtx = createMockIdbCtx({
      get: vi.fn().mockResolvedValue(undefined),
    })
    installIdbCallbackExecutor(mockCtx)

    await toggleAIMemoryPin('mem-missing')

    expect(mockCtx.get).toHaveBeenCalledWith('aiMemories', 'mem-missing')
    expect(mocks.upsertRecord).not.toHaveBeenCalled()
  })

  // --------------------------------------------------------------------------
  // 28. cleanupExpiredMemories IDB 路径：iterateStore + deleteChecked
  // --------------------------------------------------------------------------
  test('28. cleanupExpiredMemories IDB 路径：iterateStore 过滤过期 + deleteChecked', async () => {
    const now = 100000
    vi.spyOn(Date, 'now').mockReturnValue(now)

    const m1 = makeMemory({ id: 'm1', expiresAt: now - 1000 }) // 过期
    const m2 = makeMemory({ id: 'm2', expiresAt: now + 10000 }) // 未过期
    const m3 = makeMemory({ id: 'm3' }) // 无 expiresAt
    const mockCtx = createMockIdbCtx({
      iterateStore: vi.fn().mockImplementation(async (
        _store: string,
        visitor: (record: { id: string; data: AIMemory }) => void,
      ) => {
        visitor({ id: 'm1', data: m1 })
        visitor({ id: 'm2', data: m2 })
        visitor({ id: 'm3', data: m3 })
      }),
    })
    installIdbCallbackExecutor(mockCtx)

    const count = await cleanupExpiredMemories()

    expect(count).toBe(1)
    expect(mockCtx.deleteChecked).toHaveBeenCalledTimes(1)
    expect(mockCtx.deleteChecked).toHaveBeenCalledWith('aiMemories', { id: 'm1' })
  })

  // --------------------------------------------------------------------------
  // 29. cleanupExpiredMemories IDB 路径：无过期记忆返回 0
  // --------------------------------------------------------------------------
  test('29. cleanupExpiredMemories IDB 路径：无过期记忆时 count=0', async () => {
    const now = 100000
    vi.spyOn(Date, 'now').mockReturnValue(now)

    const mockCtx = createMockIdbCtx({
      iterateStore: vi.fn().mockImplementation(async () => {}),
    })
    installIdbCallbackExecutor(mockCtx)

    const count = await cleanupExpiredMemories()

    expect(count).toBe(0)
    expect(mockCtx.deleteChecked).not.toHaveBeenCalled()
  })

  // --------------------------------------------------------------------------
  // 30. cleanupExpiredMemories IDB 路径：抛错时返回 0（catch 分支）
  // --------------------------------------------------------------------------
  test('30. cleanupExpiredMemories IDB 路径：抛错时 catch 返回 0', async () => {
    mocks.runIdbTransaction.mockRejectedValue(new Error('idb error'))

    const count = await cleanupExpiredMemories()

    expect(count).toBe(0)
  })

  // --------------------------------------------------------------------------
  // 31. getAIMemoriesByCategoryAndKey IDB 路径：indexGetAll + 按 key 过滤
  // --------------------------------------------------------------------------
  test('31. getAIMemoriesByCategoryAndKey IDB 路径：indexGetAll + filter key', async () => {
    const m1 = makeMemory({ id: 'm1', category: 'work', key: 'task-style' })
    const m2 = makeMemory({ id: 'm2', category: 'work', key: 'other-key' })  // key 不匹配
    const m3 = makeMemory({ id: 'm3', category: 'work', key: 'task-style' })
    const mockCtx = createMockIdbCtx({
      indexGetAll: vi.fn().mockResolvedValue([
        { id: 'm1', data: m1 },
        { id: 'm2', data: m2 },
        { id: 'm3', data: m3 },
      ]),
    })
    installIdbCallbackExecutor(mockCtx)

    const result = await getAIMemoriesByCategoryAndKey('work', 'task-style')

    expect(mockCtx.indexGetAll).toHaveBeenCalledWith('aiMemories', 'by_category', 'work')
    expect(result).toHaveLength(2)
    expect(result.map(m => m.id).sort()).toEqual(['m1', 'm3'])
  })

  // --------------------------------------------------------------------------
  // 32. saveAIAuditLog IDB 路径：upsertRecord
  // --------------------------------------------------------------------------
  test('32. saveAIAuditLog IDB 路径：调用 upsertRecord 写入审计日志', async () => {
    installIdbCallbackExecutor(createMockIdbCtx())

    const auditLog = {
      id: 'audit-1',
      sessionId: 's1',
      toolName: 'storage_read',
      actionType: 'read' as const,
      targetType: 'memory' as const,
      status: 'success' as const,
      userConfirmed: true,
      createdAt: 1000,
      schemaVersion: 1 as const,
    }
    await saveAIAuditLog(auditLog)

    expect(mocks.ensureV2Ready).toHaveBeenCalledTimes(1)
    expect(mocks.runIdbTransaction).toHaveBeenCalledTimes(1)
    expect(mocks.upsertRecord).toHaveBeenCalledTimes(1)
    const callArgs = mocks.upsertRecord.mock.calls[0]
    expect(callArgs[1]).toBe('aiAuditLog')
    expect(callArgs[2]).toBe('audit-1')
    expect(callArgs[3]).toEqual(auditLog)
  })

  // --------------------------------------------------------------------------
  // 33. getAIAuditLogsBySession IDB 路径：indexGetAll by_sessionId
  // --------------------------------------------------------------------------
  test('33. getAIAuditLogsBySession IDB 路径：indexGetAll(by_sessionId) + 返回', async () => {
    const log1 = {
      id: 'a1', sessionId: 's1', toolName: 'tool1', actionType: 'create' as const,
      status: 'success' as const, userConfirmed: false, createdAt: 1000, schemaVersion: 1 as const,
    }
    const mockCtx = createMockIdbCtx({
      indexGetAll: vi.fn().mockResolvedValue([{ id: 'a1', data: log1 }]),
    })
    installIdbCallbackExecutor(mockCtx)

    const result = await getAIAuditLogsBySession('s1')

    expect(mockCtx.indexGetAll).toHaveBeenCalledWith('aiAuditLog', 'by_sessionId', 's1')
    expect(result).toEqual([log1])
  })

  // --------------------------------------------------------------------------
  // 34. getAllAIAuditLogs IDB 路径：iterateStore 全量遍历
  // --------------------------------------------------------------------------
  test('34. getAllAIAuditLogs IDB 路径：iterateStore 全量遍历', async () => {
    const log1 = {
      id: 'a1', sessionId: 's1', toolName: 'tool1', actionType: 'read' as const,
      status: 'success' as const, userConfirmed: false, createdAt: 1000, schemaVersion: 1 as const,
    }
    const mockCtx = createMockIdbCtx({
      iterateStore: vi.fn().mockImplementation(async (
        _store: string,
        visitor: (record: { data: typeof log1 }) => void,
      ) => {
        visitor({ data: log1 })
      }),
    })
    installIdbCallbackExecutor(mockCtx)

    const result = await getAllAIAuditLogs()

    expect(mockCtx.iterateStore).toHaveBeenCalledTimes(1)
    expect(result).toEqual([log1])
  })

  // --------------------------------------------------------------------------
  // 35. clearAIAuditLogs IDB 路径：iterateStore + deleteChecked
  // --------------------------------------------------------------------------
  test('35. clearAIAuditLogs IDB 路径：iterateStore + deleteChecked 循环', async () => {
    const mockCtx = createMockIdbCtx({
      iterateStore: vi.fn().mockImplementation(async (
        _store: string,
        visitor: (record: { id: string }) => void,
      ) => {
        visitor({ id: 'a1' })
        visitor({ id: 'a2' })
      }),
    })
    installIdbCallbackExecutor(mockCtx)

    await clearAIAuditLogs()

    expect(mockCtx.iterateStore).toHaveBeenCalledTimes(1)
    expect(mockCtx.deleteChecked).toHaveBeenCalledTimes(2)
    expect(mockCtx.deleteChecked).toHaveBeenNthCalledWith(1, 'aiAuditLog', { id: 'a1' })
  })

  // --------------------------------------------------------------------------
  // 36. cleanupExpiredAuditLogs IDB 路径：iterateStore 过滤 90 天前 + deleteChecked
  // --------------------------------------------------------------------------
  test('36. cleanupExpiredAuditLogs IDB 路径：iterateStore 过滤 + deleteChecked', async () => {
    const now = 10_000_000_000
    vi.spyOn(Date, 'now').mockReturnValue(now)

    // 90 天前的时间点
    const cutoff = now - 90 * 24 * 60 * 60 * 1000
    const oldLog = {
      id: 'a1', sessionId: 's1', toolName: 'tool1', actionType: 'read' as const,
      status: 'success' as const, userConfirmed: false, createdAt: cutoff - 1000, schemaVersion: 1 as const,
    }
    const newLog = {
      id: 'a2', sessionId: 's1', toolName: 'tool2', actionType: 'read' as const,
      status: 'success' as const, userConfirmed: false, createdAt: cutoff + 1000, schemaVersion: 1 as const,
    }
    const mockCtx = createMockIdbCtx({
      iterateStore: vi.fn().mockImplementation(async (
        _store: string,
        visitor: (record: { id: string; data: typeof oldLog }) => void,
      ) => {
        visitor({ id: 'a1', data: oldLog })
        visitor({ id: 'a2', data: newLog })
      }),
    })
    installIdbCallbackExecutor(mockCtx)

    await cleanupExpiredAuditLogs()

    expect(mockCtx.iterateStore).toHaveBeenCalledTimes(1)
    // 只删除过期日志（oldLog）
    expect(mockCtx.deleteChecked).toHaveBeenCalledTimes(1)
    expect(mockCtx.deleteChecked).toHaveBeenCalledWith('aiAuditLog', { id: 'a1' })
  })

  // --------------------------------------------------------------------------
  // 37. cleanupExpiredAuditLogs IDB 路径：抛错时 catch 静默
  // --------------------------------------------------------------------------
  test('37. cleanupExpiredAuditLogs IDB 路径：抛错时 catch 静默（不抛出）', async () => {
    mocks.runIdbTransaction.mockRejectedValue(new Error('idb unavailable'))

    // 不应抛出
    await expect(cleanupExpiredAuditLogs()).resolves.toBeUndefined()
  })
})

// ============================================================================
// API 路径补全测试 — 覆盖未测的 API 路径函数
// ============================================================================

describe('aiData - API 路径补全', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // 默认 backend = 'api'
    mocks.getBackend.mockReturnValue('api')
    // 默认 withFallback 模拟真实行为
    mocks.withFallback.mockImplementation(async (apiFn: () => Promise<unknown>, idbFn: () => Promise<unknown>) => {
      try {
        return await apiFn()
      } catch {
        return await idbFn()
      }
    })
    // 重置 IDB mock 默认行为，防止上一个 describe 的 mockRejectedValue 泄漏
    mocks.ensureV2Ready.mockResolvedValue(undefined)
    mocks.runIdbTransaction.mockResolvedValue(undefined)
    mocks.upsertRecord.mockResolvedValue(undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  // --------------------------------------------------------------------------
  // 38. getAIConversationsBySession API 路径
  // --------------------------------------------------------------------------
  test('38. getAIConversationsBySession API 路径：queryEntities + 按 sessionId 过滤', async () => {
    const c1 = makeConversation({ id: 'c1', sessionId: 's1' })
    const c2 = makeConversation({ id: 'c2', sessionId: 's2' })
    mocks.queryEntities.mockResolvedValue({
      items: [
        { id: 'c1', type: 'aiConversation', data: c1 },
        { id: 'c2', type: 'aiConversation', data: c2 },
      ],
      total: 2,
      limit: 100,
      offset: 0,
    })

    const result = await getAIConversationsBySession('s1')

    expect(mocks.queryEntities).toHaveBeenCalledWith({ type: 'aiConversation' })
    expect(result).toEqual([c1])
  })

  // --------------------------------------------------------------------------
  // 39. deleteAIConversationsBySession API 路径：有匹配记录时 batchDelete
  // --------------------------------------------------------------------------
  test('39. deleteAIConversationsBySession API 路径：有匹配记录时调用 batchDeleteEntities', async () => {
    mocks.queryEntities.mockResolvedValue({
      items: [
        { id: 'c1', type: 'aiConversation', data: { sessionId: 's1' } },
        { id: 'c2', type: 'aiConversation', data: { sessionId: 's1' } },
      ],
      total: 2,
      limit: 100,
      offset: 0,
    })
    mocks.batchDeleteEntities.mockResolvedValue(undefined)

    await deleteAIConversationsBySession('s1')

    expect(mocks.queryEntities).toHaveBeenCalledWith({ type: 'aiConversation' })
    expect(mocks.batchDeleteEntities).toHaveBeenCalledWith(['c1', 'c2'])
  })

  // --------------------------------------------------------------------------
  // 40. deleteAIConversationsBySession API 路径：无匹配记录时不调用 batchDelete
  // --------------------------------------------------------------------------
  test('40. deleteAIConversationsBySession API 路径：无匹配记录时不调用 batchDeleteEntities', async () => {
    mocks.queryEntities.mockResolvedValue({
      items: [],
      total: 0,
      limit: 100,
      offset: 0,
    })

    await deleteAIConversationsBySession('s1')

    expect(mocks.batchDeleteEntities).not.toHaveBeenCalled()
  })

  // --------------------------------------------------------------------------
  // 41. deleteAllAIConversations API 路径：批量删除
  // --------------------------------------------------------------------------
  test('41. deleteAllAIConversations API 路径：query + batchDelete', async () => {
    mocks.queryEntities.mockResolvedValue({
      items: [
        { id: 'c1', type: 'aiConversation', data: {} },
        { id: 'c2', type: 'aiConversation', data: {} },
      ],
      total: 2,
      limit: 100,
      offset: 0,
    })
    mocks.batchDeleteEntities.mockResolvedValue(undefined)

    await deleteAllAIConversations()

    expect(mocks.queryEntities).toHaveBeenCalledWith({ type: 'aiConversation' })
    expect(mocks.batchDeleteEntities).toHaveBeenCalledWith(['c1', 'c2'])
  })

  // --------------------------------------------------------------------------
  // 42. deleteAllAIConversations API 路径：无记录时不调用 batchDelete
  // --------------------------------------------------------------------------
  test('42. deleteAllAIConversations API 路径：无记录时不调用 batchDeleteEntities', async () => {
    mocks.queryEntities.mockResolvedValue({
      items: [],
      total: 0,
      limit: 100,
      offset: 0,
    })

    await deleteAllAIConversations()

    expect(mocks.batchDeleteEntities).not.toHaveBeenCalled()
  })

  // --------------------------------------------------------------------------
  // 43. saveAIMemory API 路径：调用 upsertEntity
  // --------------------------------------------------------------------------
  test('43. saveAIMemory API 路径：调用 entitiesApi.updateEntity', async () => {
    mocks.updateEntity.mockResolvedValue({ id: 'mem-1' })

    const mem = makeMemory({ id: 'mem-1' })
    await saveAIMemory(mem)

    expect(mocks.updateEntity).toHaveBeenCalledTimes(1)
    expect(mocks.updateEntity).toHaveBeenCalledWith('mem-1', {
      data: mem as unknown as Record<string, unknown>,
      panelId: null,
      widgetId: null,
    })
    expect(mocks.createEntity).not.toHaveBeenCalled()
  })

  // --------------------------------------------------------------------------
  // 44. saveAIMemory API 路径：404 时降级到 createEntity
  // --------------------------------------------------------------------------
  test('44. saveAIMemory API 路径：404 时降级调用 createEntity', async () => {
    mocks.updateEntity.mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }))
    mocks.createEntity.mockResolvedValue({ id: 'mem-1' })

    const mem = makeMemory({ id: 'mem-1' })
    await saveAIMemory(mem)

    expect(mocks.updateEntity).toHaveBeenCalledTimes(1)
    expect(mocks.createEntity).toHaveBeenCalledTimes(1)
    expect(mocks.createEntity).toHaveBeenCalledWith({
      id: 'mem-1',
      type: 'aiMemory',
      scope: 'default',
      data: mem as unknown as Record<string, unknown>,
      panelId: null,
      widgetId: null,
    })
  })

  // --------------------------------------------------------------------------
  // 45. saveAIMemory API 路径：非 404 错误时重新抛出（upsertEntity 逻辑）
  // --------------------------------------------------------------------------
  test('45. saveAIMemory API 路径：非 404 错误时重新抛出（不调用 createEntity）', async () => {
    mocks.updateEntity.mockRejectedValue(new Error('server error 500'))

    const mem = makeMemory({ id: 'mem-1' })
    await expect(saveAIMemory(mem)).resolves.toBeUndefined() // withFallback 降级到 IDB

    // upsertEntity 内部：updateEntity 抛非 404 错误 → upsertEntity 重新抛出
    // withFallback 捕获 → 走 IDB 路径
    expect(mocks.updateEntity).toHaveBeenCalledTimes(1)
    expect(mocks.createEntity).not.toHaveBeenCalled() // 未触发 404 降级
    // 验证 IDB 降级被调用
    expect(mocks.ensureV2Ready).toHaveBeenCalledTimes(1)
    expect(mocks.runIdbTransaction).toHaveBeenCalledTimes(1)
  })

  // --------------------------------------------------------------------------
  // 46. getAIMemoriesByKey API 路径
  // --------------------------------------------------------------------------
  test('46. getAIMemoriesByKey API 路径：queryEntities + 按 key 过滤', async () => {
    const m1 = makeMemory({ id: 'm1', key: 'task-style' })
    const m2 = makeMemory({ id: 'm2', key: 'other-key' })
    mocks.queryEntities.mockResolvedValue({
      items: [
        { id: 'm1', type: 'aiMemory', data: m1 },
        { id: 'm2', type: 'aiMemory', data: m2 },
      ],
      total: 2,
      limit: 100,
      offset: 0,
    })

    const result = await getAIMemoriesByKey('task-style')

    expect(mocks.queryEntities).toHaveBeenCalledWith({ type: 'aiMemory' })
    expect(result).toEqual([m1])
  })

  // --------------------------------------------------------------------------
  // 47. getPinnedMemories API 路径
  // --------------------------------------------------------------------------
  test('47. getPinnedMemories API 路径：queryEntities + 过滤 pinned=true', async () => {
    const m1 = makeMemory({ id: 'm1', pinned: true })
    const m2 = makeMemory({ id: 'm2', pinned: false })
    mocks.queryEntities.mockResolvedValue({
      items: [
        { id: 'm1', type: 'aiMemory', data: m1 },
        { id: 'm2', type: 'aiMemory', data: m2 },
      ],
      total: 2,
      limit: 100,
      offset: 0,
    })

    const result = await getPinnedMemories()

    expect(mocks.queryEntities).toHaveBeenCalledWith({ type: 'aiMemory' })
    expect(result).toEqual([m1])
  })

  // --------------------------------------------------------------------------
  // 48. getAIMemoriesByCategoryAndKey API 路径
  // --------------------------------------------------------------------------
  test('48. getAIMemoriesByCategoryAndKey API 路径：queryEntities + category+key 双过滤', async () => {
    const m1 = makeMemory({ id: 'm1', category: 'work', key: 'task-style' })
    const m2 = makeMemory({ id: 'm2', category: 'work', key: 'other' })
    const m3 = makeMemory({ id: 'm3', category: 'personal', key: 'task-style' })
    mocks.queryEntities.mockResolvedValue({
      items: [
        { id: 'm1', type: 'aiMemory', data: m1 },
        { id: 'm2', type: 'aiMemory', data: m2 },
        { id: 'm3', type: 'aiMemory', data: m3 },
      ],
      total: 3,
      limit: 100,
      offset: 0,
    })

    const result = await getAIMemoriesByCategoryAndKey('work', 'task-style')

    expect(mocks.queryEntities).toHaveBeenCalledWith({ type: 'aiMemory' })
    expect(result).toEqual([m1])
  })

  // --------------------------------------------------------------------------
  // 49. saveAIAuditLog API 路径：调用 updateEntity
  // --------------------------------------------------------------------------
  test('49. saveAIAuditLog API 路径：调用 entitiesApi.updateEntity', async () => {
    mocks.updateEntity.mockResolvedValue({ id: 'audit-1' })

    const auditLog = {
      id: 'audit-1', sessionId: 's1', toolName: 'storage_read',
      actionType: 'read' as const, status: 'success' as const,
      userConfirmed: true, createdAt: 1000, schemaVersion: 1 as const,
    }
    await saveAIAuditLog(auditLog)

    expect(mocks.updateEntity).toHaveBeenCalledTimes(1)
    expect(mocks.updateEntity).toHaveBeenCalledWith('audit-1', {
      data: auditLog as unknown as Record<string, unknown>,
      panelId: null,
      widgetId: null,
    })
  })

  // --------------------------------------------------------------------------
  // 50. saveAIAuditLog API 路径：404 时降级到 createEntity
  // --------------------------------------------------------------------------
  test('50. saveAIAuditLog API 路径：404 时降级调用 createEntity', async () => {
    mocks.updateEntity.mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }))
    mocks.createEntity.mockResolvedValue({ id: 'audit-1' })

    const auditLog = {
      id: 'audit-1', sessionId: 's1', toolName: 'storage_read',
      actionType: 'read' as const, status: 'success' as const,
      userConfirmed: true, createdAt: 1000, schemaVersion: 1 as const,
    }
    await saveAIAuditLog(auditLog)

    expect(mocks.updateEntity).toHaveBeenCalledTimes(1)
    expect(mocks.createEntity).toHaveBeenCalledTimes(1)
    expect(mocks.createEntity).toHaveBeenCalledWith({
      id: 'audit-1',
      type: 'aiAuditLog',
      scope: 'default',
      data: auditLog as unknown as Record<string, unknown>,
      panelId: null,
      widgetId: null,
    })
  })

  // --------------------------------------------------------------------------
  // 51. getAIAuditLogsBySession API 路径
  // --------------------------------------------------------------------------
  test('51. getAIAuditLogsBySession API 路径：queryEntities + 按 sessionId 过滤', async () => {
    const a1 = {
      id: 'a1', sessionId: 's1', toolName: 'tool1', actionType: 'read' as const,
      status: 'success' as const, userConfirmed: false, createdAt: 1000, schemaVersion: 1 as const,
    }
    const a2 = {
      id: 'a2', sessionId: 's2', toolName: 'tool2', actionType: 'read' as const,
      status: 'success' as const, userConfirmed: false, createdAt: 2000, schemaVersion: 1 as const,
    }
    mocks.queryEntities.mockResolvedValue({
      items: [
        { id: 'a1', type: 'aiAuditLog', data: a1 },
        { id: 'a2', type: 'aiAuditLog', data: a2 },
      ],
      total: 2,
      limit: 100,
      offset: 0,
    })

    const result = await getAIAuditLogsBySession('s1')

    expect(mocks.queryEntities).toHaveBeenCalledWith({ type: 'aiAuditLog' })
    expect(result).toEqual([a1])
  })

  // --------------------------------------------------------------------------
  // 52. getAllAIAuditLogs API 路径
  // --------------------------------------------------------------------------
  test('52. getAllAIAuditLogs API 路径：queryEntities 返回全部', async () => {
    const a1 = {
      id: 'a1', sessionId: 's1', toolName: 'tool1', actionType: 'read' as const,
      status: 'success' as const, userConfirmed: false, createdAt: 1000, schemaVersion: 1 as const,
    }
    mocks.queryEntities.mockResolvedValue({
      items: [{ id: 'a1', type: 'aiAuditLog', data: a1 }],
      total: 1,
      limit: 100,
      offset: 0,
    })

    const result = await getAllAIAuditLogs()

    expect(mocks.queryEntities).toHaveBeenCalledWith({ type: 'aiAuditLog' })
    expect(result).toEqual([a1])
  })

  // --------------------------------------------------------------------------
  // 53. clearAIAuditLogs API 路径：有记录时 batchDelete
  // --------------------------------------------------------------------------
  test('53. clearAIAuditLogs API 路径：query + batchDelete', async () => {
    mocks.queryEntities.mockResolvedValue({
      items: [
        { id: 'a1', type: 'aiAuditLog', data: {} },
        { id: 'a2', type: 'aiAuditLog', data: {} },
      ],
      total: 2,
      limit: 100,
      offset: 0,
    })
    mocks.batchDeleteEntities.mockResolvedValue(undefined)

    await clearAIAuditLogs()

    expect(mocks.queryEntities).toHaveBeenCalledWith({ type: 'aiAuditLog' })
    expect(mocks.batchDeleteEntities).toHaveBeenCalledWith(['a1', 'a2'])
  })

  // --------------------------------------------------------------------------
  // 54. clearAIAuditLogs API 路径：无记录时不调用 batchDelete
  // --------------------------------------------------------------------------
  test('54. clearAIAuditLogs API 路径：无记录时不调用 batchDeleteEntities', async () => {
    mocks.queryEntities.mockResolvedValue({
      items: [],
      total: 0,
      limit: 100,
      offset: 0,
    })

    await clearAIAuditLogs()

    expect(mocks.batchDeleteEntities).not.toHaveBeenCalled()
  })

  // --------------------------------------------------------------------------
  // 55. cleanupExpiredAuditLogs API 路径：有过期记录时 batchDelete
  // --------------------------------------------------------------------------
  test('55. cleanupExpiredAuditLogs API 路径：有 90 天前记录时 batchDelete', async () => {
    const now = 10_000_000_000
    vi.spyOn(Date, 'now').mockReturnValue(now)
    const cutoff = now - 90 * 24 * 60 * 60 * 1000

    mocks.queryEntities.mockResolvedValue({
      items: [
        { id: 'a1', type: 'aiAuditLog', data: { createdAt: cutoff - 1000 } }, // 过期
        { id: 'a2', type: 'aiAuditLog', data: { createdAt: cutoff + 1000 } }, // 未过期
      ],
      total: 2,
      limit: 100,
      offset: 0,
    })
    mocks.batchDeleteEntities.mockResolvedValue(undefined)

    await cleanupExpiredAuditLogs()

    expect(mocks.queryEntities).toHaveBeenCalledWith({ type: 'aiAuditLog' })
    expect(mocks.batchDeleteEntities).toHaveBeenCalledWith(['a1'])
  })

  // --------------------------------------------------------------------------
  // 56. cleanupExpiredAuditLogs API 路径：无过期记录时不调用 batchDelete
  // --------------------------------------------------------------------------
  test('56. cleanupExpiredAuditLogs API 路径：无过期记录时不调用 batchDeleteEntities', async () => {
    const now = 10_000_000_000
    vi.spyOn(Date, 'now').mockReturnValue(now)

    mocks.queryEntities.mockResolvedValue({
      items: [
        { id: 'a1', type: 'aiAuditLog', data: { createdAt: now - 1000 } }, // 未过期（最近）
      ],
      total: 1,
      limit: 100,
      offset: 0,
    })

    await cleanupExpiredAuditLogs()

    expect(mocks.batchDeleteEntities).not.toHaveBeenCalled()
  })

  // --------------------------------------------------------------------------
  // 57. cleanupExpiredAuditLogs API 路径：queryEntities 抛错时 catch 静默
  // --------------------------------------------------------------------------
  test('57. cleanupExpiredAuditLogs API 路径：queryEntities 抛错时 catch 静默', async () => {
    mocks.queryEntities.mockRejectedValue(new Error('api down'))

    // 不应抛出
    await expect(cleanupExpiredAuditLogs()).resolves.toBeUndefined()

    expect(mocks.batchDeleteEntities).not.toHaveBeenCalled()
  })

  // --------------------------------------------------------------------------
  // 58. cleanupExpiredMemories API 路径：queryEntities 抛错时 catch 返回 0
  // --------------------------------------------------------------------------
  test('58. cleanupExpiredMemories API 路径：queryEntities 抛错时 catch 返回 0', async () => {
    mocks.queryEntities.mockRejectedValue(new Error('api down'))

    const count = await cleanupExpiredMemories()

    expect(count).toBe(0)
    expect(mocks.batchDeleteEntities).not.toHaveBeenCalled()
  })
})
