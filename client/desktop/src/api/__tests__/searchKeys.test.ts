/**
 * searchKeys.ts API client 单元测试 — Phase 12
 *
 * 覆盖重点：
 * 1. listSearchKeys 调用 GET /search/keys
 * 2. getSearchKey 调用 GET /search/keys/:provider
 * 3. updateSearchKey 调用 PUT /search/keys/:provider
 * 4. deleteSearchKey 调用 DELETE /search/keys/:provider
 * 5. testSearchKey 调用 POST /search/keys/:provider/test
 * 6. 错误处理（401/400/网络错误）
 *
 * Mock 策略：
 * - vi.mock('../client')：拦截 api 对象，避免真实网络请求
 * - 自定义 ApiError 类用于错误测试
 */
import { describe, test, expect, beforeEach, vi } from 'vitest'

vi.mock('../client', () => {
  class ApiError extends Error {
    status: number
    data: unknown
    constructor(message: string, status: number, data?: unknown) {
      super(message)
      this.name = 'ApiError'
      this.status = status
      this.data = data
    }
  }
  return {
    api: {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
    },
    ApiError,
  }
})

import { api, ApiError } from '../client'
import {
  listSearchKeys,
  getSearchKey,
  updateSearchKey,
  deleteSearchKey,
  testSearchKey,
} from '../searchKeys'

// ============================================================================
// 测试套件
// ============================================================================

describe('searchKeys API client', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset()
    vi.mocked(api.post).mockReset()
    vi.mocked(api.put).mockReset()
    vi.mocked(api.delete).mockReset()
  })

  test('1. listSearchKeys 调用 GET /search/keys', async () => {
    const mockResponse = {
      providers: [
        { provider: 'metaso' as const, hasKey: true, updatedAt: 1000 },
        { provider: 'github' as const, hasKey: false, updatedAt: null },
      ],
    }
    vi.mocked(api.get).mockResolvedValue(mockResponse)

    const result = await listSearchKeys()

    expect(api.get).toHaveBeenCalledWith('/search/keys')
    expect(result).toEqual(mockResponse)
    expect(result.providers).toHaveLength(2)
  })

  test('2. getSearchKey 调用 GET /search/keys/:provider', async () => {
    const mockResponse = {
      provider: 'metaso' as const,
      hasKey: true,
      updatedAt: 12345,
    }
    vi.mocked(api.get).mockResolvedValue(mockResponse)

    const result = await getSearchKey('metaso')

    expect(api.get).toHaveBeenCalledWith('/search/keys/metaso')
    expect(result).toEqual(mockResponse)
  })

  test('3. updateSearchKey 调用 PUT /search/keys/:provider', async () => {
    const mockResponse = { ok: true as const, provider: 'github', updatedAt: 99999 }
    vi.mocked(api.put).mockResolvedValue(mockResponse)

    const result = await updateSearchKey('github', 'my-api-key')

    expect(api.put).toHaveBeenCalledWith('/search/keys/github', { key: 'my-api-key' })
    expect(result).toEqual(mockResponse)
  })

  test('4. deleteSearchKey 调用 DELETE /search/keys/:provider', async () => {
    const mockResponse = { ok: true as const, provider: 'metaso' }
    vi.mocked(api.delete).mockResolvedValue(mockResponse)

    const result = await deleteSearchKey('metaso')

    expect(api.delete).toHaveBeenCalledWith('/search/keys/metaso')
    expect(result).toEqual(mockResponse)
  })

  test('5. testSearchKey 调用 POST /search/keys/:provider/test', async () => {
    const mockResponse = { ok: true, latencyMs: 150 }
    vi.mocked(api.post).mockResolvedValue(mockResponse)

    // 带 key
    const result1 = await testSearchKey('github', 'test-key')
    expect(api.post).toHaveBeenCalledWith('/search/keys/github/test', { key: 'test-key' })
    expect(result1).toEqual(mockResponse)

    // 不带 key
    vi.mocked(api.post).mockResolvedValue({ ok: false, error: 'invalid key' })
    const result2 = await testSearchKey('github')
    expect(api.post).toHaveBeenCalledWith('/search/keys/github/test', {})
    expect(result2.ok).toBe(false)
  })

  test('6. 错误处理：401 时抛出 ApiError', async () => {
    const error = new ApiError('Unauthorized', 401, {
      error: { message: 'Unauthorized' },
    })
    vi.mocked(api.get).mockRejectedValue(error)

    await expect(listSearchKeys()).rejects.toThrow('Unauthorized')
    await expect(getSearchKey('metaso')).rejects.toMatchObject({ status: 401 })
  })

  test('7. 错误处理：400 时抛出 ApiError', async () => {
    const error = new ApiError('Bad Request', 400, {
      error: { message: 'Invalid key' },
    })
    vi.mocked(api.put).mockRejectedValue(error)

    await expect(updateSearchKey('github', 'bad-key')).rejects.toMatchObject({
      status: 400,
    })
  })

  test('8. 错误处理：网络错误（TypeError）', async () => {
    const networkError = new TypeError('Failed to fetch')
    vi.mocked(api.delete).mockRejectedValue(networkError)

    await expect(deleteSearchKey('metaso')).rejects.toThrow('Failed to fetch')
  })
})
