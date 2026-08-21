/**
 * Phase S8.4：searchTools.ts execute 测试（spec 第六章 6.3 节）
 *
 * 2026-08-17 供应商替换后覆盖 4 个外部搜索工具：
 * - webSearchTool：Exa 语义搜索（成功 / key 缺失 / callExaSearch 抛错）
 * - readWebpageTool：Exa 抓网页（成功 / 非法 URL / 抛错）
 * - academicSearchTool：ArXiv 学术搜索（成功 / 抛错 / sortBy 透传）
 * - exaFindSimilarTool：Exa 相似内容（成功 / 非法 URL / 抛错）
 *
 * Mock 策略：
 * - mock searchApiExa.ts（callExaSearch / callExaContents / callExaFindSimilar）
 * - mock searchApi.ts（callArxiv）
 * - mock db/aiSettingsStore.ts（getSearchKey）
 * - mock db/apiUsageLog.ts（logApiUsage）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// ============================================================================
// vi.mock：拦截 searchTools 的重依赖（hoisted，在 import 之前执行）
// ============================================================================

vi.mock('../../src/utils/searchApiExa.js', () => ({
  callExaSearch: vi.fn(),
  callExaContents: vi.fn(),
  callExaFindSimilar: vi.fn(),
}))

vi.mock('../../src/utils/searchApi.js', () => ({
  callArxiv: vi.fn(),
}))

vi.mock('../../src/db/aiSettingsStore.js', () => ({
  getSearchKey: vi.fn(),
}))

vi.mock('../../src/db/apiUsageLog.js', () => ({
  logApiUsage: vi.fn(),
}))

// ============================================================================
// 动态 import（在 mock 生效后）
// ============================================================================

const { webSearchTool, readWebpageTool, academicSearchTool, exaFindSimilarTool } = await import('../../src/utils/searchTools.js')

const searchApiExaMod = await import('../../src/utils/searchApiExa.js')
const callExaSearchMock = searchApiExaMod.callExaSearch as unknown as ReturnType<typeof vi.fn>
const callExaContentsMock = searchApiExaMod.callExaContents as unknown as ReturnType<typeof vi.fn>
const callExaFindSimilarMock = searchApiExaMod.callExaFindSimilar as unknown as ReturnType<typeof vi.fn>

const searchApiMod = await import('../../src/utils/searchApi.js')
const callArxivMock = searchApiMod.callArxiv as unknown as ReturnType<typeof vi.fn>

const aiSettingsMod = await import('../../src/db/aiSettingsStore.js')
const getSearchKeyMock = aiSettingsMod.getSearchKey as unknown as ReturnType<typeof vi.fn>

const apiUsageMod = await import('../../src/db/apiUsageLog.js')
const logApiUsageMock = apiUsageMod.logApiUsage as unknown as ReturnType<typeof vi.fn>

// ============================================================================
// 测试套件
// ============================================================================

describe('searchTools execute', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    logApiUsageMock.mockResolvedValue(undefined)
  })

  // ---------------------------------------------------------------------------
  // webSearchTool（Exa 语义搜索）
  // ---------------------------------------------------------------------------

  describe('webSearchTool.execute', () => {
    it('1. 成功路径：mock getSearchKey + callExaSearch → 验证返回格式 + logApiUsage status=ok', async () => {
      getSearchKeyMock.mockResolvedValue('exa-test-key')
      const mockResult = {
        results: [{ title: 'Test', url: 'http://test.com', summary: 'snippet' }],
        costUsd: 0.007,
      }
      callExaSearchMock.mockResolvedValue(mockResult)

      const ret = await (webSearchTool as any).execute('call-1', { query: 'test query', count: 5 }, undefined, undefined, undefined)

      // 验证 callExaSearch 被正确调用
      expect(callExaSearchMock).toHaveBeenCalledWith({ query: 'test query', numResults: 5 }, 'exa-test-key')

      // 验证返回格式
      expect(ret).toHaveProperty('content')
      expect(ret.content).toHaveLength(1)
      expect(ret.content[0].type).toBe('text')

      const parsed = JSON.parse(ret.content[0].text)
      expect(parsed.results).toHaveLength(1)

      // 验证 logApiUsage status=ok
      expect(logApiUsageMock).toHaveBeenCalledWith(expect.objectContaining({
        provider: 'exa',
        endpoint: 'search',
        status: 'ok',
      }))
    })

    it('2. key 缺失：getSearchKey 返回 null → 抛错"未配置 Exa"', async () => {
      getSearchKeyMock.mockResolvedValue(null)

      await expect(
        (webSearchTool as any).execute('call-2', { query: 'test' }, undefined, undefined, undefined),
      ).rejects.toThrow('未配置 Exa API Key')

      // callExaSearch 和 logApiUsage 均不应被调用
      expect(callExaSearchMock).not.toHaveBeenCalled()
      expect(logApiUsageMock).not.toHaveBeenCalled()
    })

    it('3. callExaSearch 抛错 → logApiUsage status=error + re-throw', async () => {
      getSearchKeyMock.mockResolvedValue('exa-test-key')
      const apiErr = new Error('Exa API timeout')
      callExaSearchMock.mockRejectedValue(apiErr)

      await expect(
        (webSearchTool as any).execute('call-3', { query: 'test' }, undefined, undefined, undefined),
      ).rejects.toThrow('Exa API timeout')

      expect(logApiUsageMock).toHaveBeenCalledWith(expect.objectContaining({
        provider: 'exa',
        endpoint: 'search',
        status: 'error',
        errorMsg: 'Exa API timeout',
      }))
    })

    it('4. category/count 透传给 callExaSearch', async () => {
      getSearchKeyMock.mockResolvedValue('exa-test-key')
      callExaSearchMock.mockResolvedValue({ results: [] })

      await (webSearchTool as any).execute('call-4', { query: 'LLM', count: 3, category: 'research paper' }, undefined, undefined, undefined)

      expect(callExaSearchMock).toHaveBeenCalledWith(
        expect.objectContaining({ query: 'LLM', numResults: 3, category: 'research paper' }),
        'exa-test-key',
      )
    })
  })

  // ---------------------------------------------------------------------------
  // readWebpageTool（Exa 读取网页）
  // ---------------------------------------------------------------------------

  describe('readWebpageTool.execute', () => {
    it('5. 成功路径：mock callExaContents → 验证返回格式 + logApiUsage status=ok', async () => {
      getSearchKeyMock.mockResolvedValue('exa-test-key')
      const mockResult = {
        results: [{ url: 'https://example.com', title: 'Example', text: 'hello' }],
        costUsd: 0.001,
      }
      callExaContentsMock.mockResolvedValue(mockResult)

      const ret = await (readWebpageTool as any).execute('call-5', { urls: ['https://example.com'] }, undefined, undefined, undefined)

      expect(callExaContentsMock).toHaveBeenCalledWith(['https://example.com'], 'exa-test-key', 8000)
      const parsed = JSON.parse(ret.content[0].text)
      expect(parsed.results).toHaveLength(1)

      expect(logApiUsageMock).toHaveBeenCalledWith(expect.objectContaining({
        provider: 'exa',
        endpoint: 'contents',
        status: 'ok',
      }))
    })

    it('6. urls 为空 → 抛错；非法 URL → 抛错', async () => {
      getSearchKeyMock.mockResolvedValue('exa-test-key')
      await expect(
        (readWebpageTool as any).execute('call-6a', { urls: [] }, undefined, undefined, undefined),
      ).rejects.toThrow('urls 不能为空')

      await expect(
        (readWebpageTool as any).execute('call-6b', { urls: ['ftp://x'] }, undefined, undefined, undefined),
      ).rejects.toThrow('http/https')
    })
  })

  // ---------------------------------------------------------------------------
  // academicSearchTool（ArXiv 学术搜索）
  // ---------------------------------------------------------------------------

  describe('academicSearchTool.execute', () => {
    it('7. 成功路径：mock callArxiv → 验证返回格式 + logApiUsage status=ok', async () => {
      const mockResult = {
        papers: [{ paperId: '2401.12345', title: 'Test Paper', authors: ['Author'] }],
        total: 1,
      }
      callArxivMock.mockResolvedValue(mockResult)

      const ret = await (academicSearchTool as any).execute('call-7', { query: 'neural network' }, undefined, undefined, undefined)

      expect(callArxivMock).toHaveBeenCalledTimes(1)
      expect(ret.content[0].type).toBe('text')
      const parsed = JSON.parse(ret.content[0].text)
      expect(parsed.papers).toHaveLength(1)

      expect(logApiUsageMock).toHaveBeenCalledWith(expect.objectContaining({
        provider: 'arxiv',
        endpoint: 'api/query',
        status: 'ok',
      }))
    })

    it('8. callArxiv 抛错 → logApiUsage status=error + re-throw', async () => {
      callArxivMock.mockRejectedValue(new Error('ArXiv API error'))

      await expect(
        (academicSearchTool as any).execute('call-8', { query: 'test' }, undefined, undefined, undefined),
      ).rejects.toThrow('ArXiv API error')

      expect(logApiUsageMock).toHaveBeenCalledWith(expect.objectContaining({
        provider: 'arxiv',
        endpoint: 'api/query',
        status: 'error',
        errorMsg: 'ArXiv API error',
      }))
    })

    it('9. sortBy=relevance 透传给 callArxiv', async () => {
      callArxivMock.mockResolvedValue({ papers: [], total: 0 })

      await (academicSearchTool as any).execute('call-9', { query: 'test', sortBy: 'relevance' }, undefined, undefined, undefined)

      expect(callArxivMock).toHaveBeenCalledWith(expect.objectContaining({ sortBy: 'relevance' }))
    })
  })

  // ---------------------------------------------------------------------------
  // exaFindSimilarTool（Exa 相似内容）
  // ---------------------------------------------------------------------------

  describe('exaFindSimilarTool.execute', () => {
    it('10. 成功路径：mock callExaFindSimilar → 验证返回格式 + logApiUsage status=ok', async () => {
      getSearchKeyMock.mockResolvedValue('exa-test-key')
      callExaFindSimilarMock.mockResolvedValue({
        results: [{ title: 'Related', url: 'https://example.com/rel' }],
        costUsd: 0.007,
      })

      const ret = await (exaFindSimilarTool as any).execute('call-10', { url: 'https://example.com/a', count: 4 }, undefined, undefined, undefined)

      expect(callExaFindSimilarMock).toHaveBeenCalledWith('https://example.com/a', 'exa-test-key', 4)
      const parsed = JSON.parse(ret.content[0].text)
      expect(parsed.results).toHaveLength(1)

      expect(logApiUsageMock).toHaveBeenCalledWith(expect.objectContaining({
        provider: 'exa',
        endpoint: 'findSimilar',
        status: 'ok',
      }))
    })

    it('11. 非法 url → 抛错；callExaFindSimilar 抛错 → status=error + re-throw', async () => {
      getSearchKeyMock.mockResolvedValue('exa-test-key')

      await expect(
        (exaFindSimilarTool as any).execute('call-11a', { url: 'not-a-url' }, undefined, undefined, undefined),
      ).rejects.toThrow('http/https')

      callExaFindSimilarMock.mockRejectedValue(new Error('Exa findSimilar error'))
      await expect(
        (exaFindSimilarTool as any).execute('call-11b', { url: 'https://example.com/a' }, undefined, undefined, undefined),
      ).rejects.toThrow('Exa findSimilar error')

      expect(logApiUsageMock).toHaveBeenCalledWith(expect.objectContaining({
        provider: 'exa',
        endpoint: 'findSimilar',
        status: 'error',
        errorMsg: 'Exa findSimilar error',
      }))
    })
  })
})