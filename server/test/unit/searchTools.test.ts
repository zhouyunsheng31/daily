/**
 * Phase S8.4：searchTools.ts execute 测试（spec 第六章 6.3 节）
 *
 * 覆盖 3 个外部搜索工具的 execute 函数：
 * - webSearchTool：秘塔 AI 搜索（成功 / key 缺失 / callMetaso 抛错）
 * - academicSearchTool：ArXiv 学术搜索（成功 / 抛错 / sortBy 透传）
 * - githubSearchTool：GitHub 搜索/下载（成功 / 7 种 mode endpoint 命名 / 抛错）
 *
 * Mock 策略：
 * - mock searchApi.ts（callMetaso / callArxiv / callGitHub）
 * - mock db/aiSettingsStore.ts（getSearchKey）
 * - mock db/apiUsageLog.ts（logApiUsage）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// ============================================================================
// vi.mock：拦截 searchTools 的重依赖（hoisted，在 import 之前执行）
// ============================================================================

vi.mock('../../src/utils/searchApi.js', () => ({
  callMetaso: vi.fn(),
  callArxiv: vi.fn(),
  callGitHub: vi.fn(),
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

const { webSearchTool, academicSearchTool, githubSearchTool } = await import('../../src/utils/searchTools.js')

const searchApiMod = await import('../../src/utils/searchApi.js')
const callMetasoMock = searchApiMod.callMetaso as unknown as ReturnType<typeof vi.fn>
const callArxivMock = searchApiMod.callArxiv as unknown as ReturnType<typeof vi.fn>
const callGitHubMock = searchApiMod.callGitHub as unknown as ReturnType<typeof vi.fn>

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
  // webSearchTool（秘塔 AI 搜索）
  // ---------------------------------------------------------------------------

  describe('webSearchTool.execute', () => {
    it('1. 成功路径：mock getSearchKey + callMetaso → 验证返回格式 + _credits 移除 + logApiUsage status=ok', async () => {
      getSearchKeyMock.mockResolvedValue('metaso-test-key')
      const mockResult = {
        results: [{ title: 'Test', url: 'http://test.com', snippet: 'snippet' }],
        total: 1,
        _credits: 5,
      }
      callMetasoMock.mockResolvedValue(mockResult)

      const ret = await (webSearchTool as any).execute('call-1', { query: 'test query', count: 5 }, undefined, undefined, undefined)

      // 验证 callMetaso 被正确调用
      expect(callMetasoMock).toHaveBeenCalledWith({ query: 'test query', count: 5 }, 'metaso-test-key')

      // 验证返回格式
      expect(ret).toHaveProperty('content')
      expect(ret.content).toHaveLength(1)
      expect(ret.content[0].type).toBe('text')

      // 验证 _credits 被移除
      const parsed = JSON.parse(ret.content[0].text)
      expect(parsed).not.toHaveProperty('_credits')
      expect(parsed.results).toHaveLength(1)
      expect(parsed.total).toBe(1)

      // 验证 logApiUsage status=ok + creditsConsumed
      expect(logApiUsageMock).toHaveBeenCalledWith(expect.objectContaining({
        provider: 'metaso',
        endpoint: 'web-search',
        status: 'ok',
        creditsConsumed: 5,
      }))
    })

    it('2. key 缺失：getSearchKey 返回 null → 抛错"未配置秘塔"', async () => {
      getSearchKeyMock.mockResolvedValue(null)

      await expect(
        (webSearchTool as any).execute('call-2', { query: 'test' }, undefined, undefined, undefined),
      ).rejects.toThrow('未配置秘塔搜索 API Key')

      // callMetaso 和 logApiUsage 均不应被调用
      expect(callMetasoMock).not.toHaveBeenCalled()
      expect(logApiUsageMock).not.toHaveBeenCalled()
    })

    it('3. callMetaso 抛错 → logApiUsage status=error + re-throw', async () => {
      getSearchKeyMock.mockResolvedValue('metaso-test-key')
      const apiErr = new Error('Metaso API timeout')
      callMetasoMock.mockRejectedValue(apiErr)

      await expect(
        (webSearchTool as any).execute('call-3', { query: 'test' }, undefined, undefined, undefined),
      ).rejects.toThrow('Metaso API timeout')

      // 验证 logApiUsage status=error + errorMsg
      expect(logApiUsageMock).toHaveBeenCalledWith(expect.objectContaining({
        provider: 'metaso',
        endpoint: 'web-search',
        status: 'error',
        errorMsg: 'Metaso API timeout',
      }))
    })
  })

  // ---------------------------------------------------------------------------
  // academicSearchTool（ArXiv 学术搜索）
  // ---------------------------------------------------------------------------

  describe('academicSearchTool.execute', () => {
    it('4. 成功路径：mock callArxiv → 验证返回格式 + logApiUsage status=ok', async () => {
      const mockResult = {
        papers: [{ paperId: '2401.12345', title: 'Test Paper', authors: ['Author'] }],
        total: 1,
      }
      callArxivMock.mockResolvedValue(mockResult)

      const ret = await (academicSearchTool as any).execute('call-4', { query: 'neural network' }, undefined, undefined, undefined)

      expect(callArxivMock).toHaveBeenCalledTimes(1)
      expect(ret.content[0].type).toBe('text')
      const parsed = JSON.parse(ret.content[0].text)
      expect(parsed.papers).toHaveLength(1)
      expect(parsed.total).toBe(1)

      expect(logApiUsageMock).toHaveBeenCalledWith(expect.objectContaining({
        provider: 'arxiv',
        endpoint: 'api/query',
        status: 'ok',
      }))
    })

    it('5. callArxiv 抛错 → logApiUsage status=error + re-throw', async () => {
      callArxivMock.mockRejectedValue(new Error('ArXiv API error'))

      await expect(
        (academicSearchTool as any).execute('call-5', { query: 'test' }, undefined, undefined, undefined),
      ).rejects.toThrow('ArXiv API error')

      expect(logApiUsageMock).toHaveBeenCalledWith(expect.objectContaining({
        provider: 'arxiv',
        endpoint: 'api/query',
        status: 'error',
        errorMsg: 'ArXiv API error',
      }))
    })

    it('6. sortBy=relevance 透传给 callArxiv', async () => {
      callArxivMock.mockResolvedValue({ papers: [], total: 0 })

      await (academicSearchTool as any).execute('call-6', { query: 'test', sortBy: 'relevance' }, undefined, undefined, undefined)

      expect(callArxivMock).toHaveBeenCalledWith(expect.objectContaining({ sortBy: 'relevance' }))
    })

    it('7. sortBy=lastUpdatedDate 透传给 callArxiv', async () => {
      callArxivMock.mockResolvedValue({ papers: [], total: 0 })

      await (academicSearchTool as any).execute('call-7', { query: 'test', sortBy: 'lastUpdatedDate' }, undefined, undefined, undefined)

      expect(callArxivMock).toHaveBeenCalledWith(expect.objectContaining({ sortBy: 'lastUpdatedDate' }))
    })

    it('8. sortBy=submittedDate 透传给 callArxiv', async () => {
      callArxivMock.mockResolvedValue({ papers: [], total: 0 })

      await (academicSearchTool as any).execute('call-8', { query: 'test', sortBy: 'submittedDate' }, undefined, undefined, undefined)

      expect(callArxivMock).toHaveBeenCalledWith(expect.objectContaining({ sortBy: 'submittedDate' }))
    })
  })

  // ---------------------------------------------------------------------------
  // githubSearchTool（GitHub 搜索/下载）
  // ---------------------------------------------------------------------------

  describe('githubSearchTool.execute', () => {
    it('9. 成功路径：search_repos mode → 验证返回格式 + logApiUsage endpoint=search-repos', async () => {
      getSearchKeyMock.mockResolvedValue('github-token')
      const mockResult = { mode: 'search_repos', items: [{ id: 1, fullName: 'octocat/hello-world' }], total: 1 }
      callGitHubMock.mockResolvedValue(mockResult)

      const ret = await (githubSearchTool as any).execute('call-9', { mode: 'search_repos', query: 'hello-world' }, undefined, undefined, undefined)

      // 验证 callGitHub 被调用 with key
      expect(callGitHubMock).toHaveBeenCalledWith(
        expect.objectContaining({ mode: 'search_repos', query: 'hello-world' }),
        'github-token',
      )

      // 验证返回格式
      expect(ret.content[0].type).toBe('text')
      const parsed = JSON.parse(ret.content[0].text)
      expect(parsed.mode).toBe('search_repos')

      // 验证 endpoint 命名：mode.replace(/_/g, '-')
      expect(logApiUsageMock).toHaveBeenCalledWith(expect.objectContaining({
        provider: 'github',
        endpoint: 'search-repos',
        status: 'ok',
      }))
    })

    it('10. 7 种 mode 的 endpoint 命名（mode.replace(/_/g, "-")）', async () => {
      getSearchKeyMock.mockResolvedValue('github-token')
      callGitHubMock.mockResolvedValue({ mode: 'test', items: [] })

      const modes = [
        { mode: 'search_repos', expected: 'search-repos', params: { query: 'test' } },
        { mode: 'search_code', expected: 'search-code', params: { query: 'test' } },
        { mode: 'search_users', expected: 'search-users', params: { query: 'test' } },
        { mode: 'search_issues', expected: 'search-issues', params: { query: 'test' } },
        { mode: 'download_release', expected: 'download-release', params: { owner: 'o', repo: 'r' } },
        { mode: 'download_file', expected: 'download-file', params: { owner: 'o', repo: 'r', path: 'README.md' } },
        { mode: 'download_repo_zip', expected: 'download-repo-zip', params: { owner: 'o', repo: 'r' } },
      ]

      for (const { mode, expected, params } of modes) {
        logApiUsageMock.mockClear()
        callGitHubMock.mockClear()

        await (githubSearchTool as any).execute('call-10', { mode, ...params }, undefined, undefined, undefined)

        expect(logApiUsageMock).toHaveBeenCalledWith(expect.objectContaining({
          provider: 'github',
          endpoint: expected,
          status: 'ok',
        }))
      }
    })

    it('11. callGitHub 抛错 → logApiUsage status=error + re-throw', async () => {
      getSearchKeyMock.mockResolvedValue('github-token')
      callGitHubMock.mockRejectedValue(new Error('GitHub API error'))

      await expect(
        (githubSearchTool as any).execute('call-11', { mode: 'search_repos', query: 'test' }, undefined, undefined, undefined),
      ).rejects.toThrow('GitHub API error')

      expect(logApiUsageMock).toHaveBeenCalledWith(expect.objectContaining({
        provider: 'github',
        endpoint: 'search-repos',
        status: 'error',
        errorMsg: 'GitHub API error',
      }))
    })

    it('12. key 缺失（null→undefined）→ GitHub 仍可调用（token 可选，不抛错）', async () => {
      // GitHub API token 可选：getSearchKey 返回 null → key = undefined → callGitHub 仍被调用
      getSearchKeyMock.mockResolvedValue(null)
      callGitHubMock.mockResolvedValue({ mode: 'search_repos', items: [], total: 0 })

      const ret = await (githubSearchTool as any).execute('call-12', { mode: 'search_repos', query: 'test' }, undefined, undefined, undefined)

      // callGitHub 应被调用 with undefined key
      expect(callGitHubMock).toHaveBeenCalledWith(
        expect.any(Object),
        undefined,
      )

      // 验证返回格式
      expect(ret.content[0].type).toBe('text')
      expect(logApiUsageMock).toHaveBeenCalledWith(expect.objectContaining({
        status: 'ok',
      }))
    })
  })
})
