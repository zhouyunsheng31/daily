/**
 * Phase S8.4：searchApi.ts 纯函数 + retryWithBackoff 测试（spec 第六章 6.4-6.5 节）
 *
 * 覆盖：
 * - extractFileName：Content-Disposition 解析（6 用例）
 * - buildGithubProxyUrl：代理 URL 构造（4 用例）
 * - parseArxivAtomXml：ArXiv Atom XML 解析（3 用例）
 * - extractArxivId：ArXiv ID 提取（2 用例）
 * - extractRepoFullName：GitHub 仓库全名提取（2 用例）
 * - retryWithBackoff：指数退避重试（6 用例）
 *
 * 注：retryWithBackoff / parseArxivAtomXml / extractArxivId / extractRepoFullName /
 * HttpError / NetworkError 通过 __test 导出访问（spec 6.4-6.5 节）
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import {
  extractFileName,
  buildGithubProxyUrl,
  __test,
} from '../../src/utils/searchApi.js'

const {
  retryWithBackoff,
  parseArxivAtomXml,
  extractArxivId,
  extractRepoFullName,
  HttpError,
  NetworkError,
} = __test

// ============================================================================
// 1. extractFileName（spec 6.4 节）
// ============================================================================

describe('extractFileName', () => {
  it('1. 带引号的 filename: attachment; filename="test.zip" → test.zip', () => {
    expect(extractFileName('attachment; filename="test.zip"')).toBe('test.zip')
  })

  it('2. 不带引号的 filename: attachment; filename=test.zip → test.zip', () => {
    expect(extractFileName('attachment; filename=test.zip')).toBe('test.zip')
  })

  it('3. null 输入 → 空字符串（默认名）', () => {
    expect(extractFileName(null)).toBe('')
  })

  it('4. UTF-8 编码 filename*: attachment; filename*=UTF-8\'\'%E4%B8%AD%E6%96%87.zip → 中文.zip', () => {
    expect(extractFileName("attachment; filename*=UTF-8''%E4%B8%AD%E6%96%87.zip")).toBe('中文.zip')
  })

  it('5. 空字符串输入 → 空字符串', () => {
    expect(extractFileName('')).toBe('')
  })

  it('6. 无 filename 字段 → 空字符串', () => {
    expect(extractFileName('attachment')).toBe('')
    expect(extractFileName('inline')).toBe('')
  })
})

// ============================================================================
// 2. buildGithubProxyUrl（spec 6.4 节）
// ============================================================================

describe('buildGithubProxyUrl', () => {
  // 保存原始 env，测试后恢复
  let origServerBaseUrl: string | undefined
  let origPort: string | undefined

  beforeEach(() => {
    origServerBaseUrl = process.env.SERVER_BASE_URL
    origPort = process.env.PORT
    delete process.env.SERVER_BASE_URL
    delete process.env.PORT
  })

  afterEach(() => {
    if (origServerBaseUrl !== undefined) process.env.SERVER_BASE_URL = origServerBaseUrl
    else delete process.env.SERVER_BASE_URL
    if (origPort !== undefined) process.env.PORT = origPort
    else delete process.env.PORT
  })

  it('7. type=zip：构造完整 URL（localhost fallback）', () => {
    const url = new URL(buildGithubProxyUrl({
      type: 'zip',
      owner: 'octocat',
      repo: 'hello-world',
      ref: 'main',
      fileName: 'octocat-hello-world-main.zip',
    }))
    expect(url.origin).toBe('http://localhost:3456')
    expect(url.pathname).toBe('/api/github/proxy')
    expect(url.searchParams.get('type')).toBe('zip')
    expect(url.searchParams.get('owner')).toBe('octocat')
    expect(url.searchParams.get('repo')).toBe('hello-world')
    expect(url.searchParams.get('ref')).toBe('main')
    expect(url.searchParams.get('fileName')).toBe('octocat-hello-world-main.zip')
  })

  it('8. type=asset：含 assetId 参数', () => {
    const url = new URL(buildGithubProxyUrl({
      type: 'asset',
      owner: 'octocat',
      repo: 'hello-world',
      assetId: '12345',
      fileName: 'release.zip',
    }))
    expect(url.searchParams.get('type')).toBe('asset')
    expect(url.searchParams.get('assetId')).toBe('12345')
  })

  it('9. type=file：含 path 和 sha 参数', () => {
    const url = new URL(buildGithubProxyUrl({
      type: 'file',
      owner: 'octocat',
      repo: 'hello-world',
      path: 'src/index.ts',
      sha: 'abc123def',
      fileName: 'index.ts',
    }))
    expect(url.searchParams.get('type')).toBe('file')
    expect(url.searchParams.get('path')).toBe('src/index.ts')
    expect(url.searchParams.get('sha')).toBe('abc123def')
  })

  it('10. SERVER_BASE_URL 环境变量覆盖 localhost', () => {
    process.env.SERVER_BASE_URL = 'https://api.example.com'
    const url = new URL(buildGithubProxyUrl({
      type: 'zip',
      owner: 'o',
      repo: 'r',
      fileName: 'f.zip',
    }))
    expect(url.origin).toBe('https://api.example.com')
  })
})

// ============================================================================
// 3. parseArxivAtomXml（spec 6.4 节）
// ============================================================================

describe('parseArxivAtomXml', () => {
  // 标准 ArXiv Atom feed（2 条 entry）
  const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
<feed>
  <opensearch:totalResults>2</opensearch:totalResults>
  <entry>
    <id>http://arxiv.org/abs/2401.12345v1</id>
    <updated>2024-01-15T00:00:00Z</updated>
    <published>2024-01-10T00:00:00Z</published>
    <title>Test Paper Title</title>
    <summary>This is a test abstract.</summary>
    <author><name>Author One</name></author>
    <author><name>Author Two</name></author>
    <link href="http://arxiv.org/abs/2401.12345v1" rel="alternate" type="text/html"/>
    <link href="http://arxiv.org/pdf/2401.12345v1" rel="related" type="application/pdf" title="pdf"/>
    <arxiv:primary_category term="cs.AI"/>
    <category term="cs.AI"/>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/2401.67890v1</id>
    <updated>2024-02-15T00:00:00Z</updated>
    <published>2024-02-10T00:00:00Z</published>
    <title>Second Paper</title>
    <summary>Second abstract.</summary>
    <author><name>Author Three</name></author>
    <link href="http://arxiv.org/abs/2401.67890v1" rel="alternate" type="text/html"/>
    <link href="http://arxiv.org/pdf/2401.67890v1" rel="related" type="application/pdf" title="pdf"/>
    <arxiv:primary_category term="cs.LG"/>
    <category term="cs.LG"/>
  </entry>
</feed>`

  it('11. 解析标准 Atom feed → 提取 title/authors/pdfLink/arxivId/publicationDate', () => {
    const { papers, total } = parseArxivAtomXml(sampleXml)

    expect(total).toBe(2)
    expect(papers).toHaveLength(2)

    const p0 = papers[0]
    expect(p0.paperId).toBe('2401.12345')  // arxivId（去掉 v1 后缀）
    expect(p0.title).toBe('Test Paper Title')
    expect(p0.abstract).toBe('This is a test abstract.')
    expect(p0.authors).toEqual(['Author One', 'Author Two'])
    expect(p0.year).toBe(2024)
    expect(p0.venue).toBe('ArXiv')
    expect(p0.citationCount).toBe(0)
    expect(p0.publicationDate).toBe('2024-01-10')
    expect(p0.absUrl).toBe('http://arxiv.org/abs/2401.12345v1')
    expect(p0.categories).toEqual(['cs.AI'])
    expect(p0.primaryCategory).toBe('cs.AI')
    expect(p0.openAccessPdf).toEqual({ url: 'http://arxiv.org/pdf/2401.12345v1', status: 'GREEN' })
    expect(p0.externalIds).toEqual({ ArXiv: '2401.12345' })

    const p1 = papers[1]
    expect(p1.paperId).toBe('2401.67890')
    expect(p1.title).toBe('Second Paper')
    expect(p1.authors).toEqual(['Author Three'])
    expect(p1.primaryCategory).toBe('cs.LG')
  })

  it('12. 空 feed（无 entry）→ papers=[]', () => {
    const emptyXml = `<?xml version="1.0" encoding="UTF-8"?>
<feed>
  <opensearch:totalResults>0</opensearch:totalResults>
</feed>`
    const { papers, total } = parseArxivAtomXml(emptyXml)
    expect(papers).toEqual([])
    expect(total).toBe(0)
  })

  it('13. 单个 entry（非数组形式）→ 正确处理为 1 条', () => {
    const singleEntryXml = `<?xml version="1.0" encoding="UTF-8"?>
<feed>
  <opensearch:totalResults>1</opensearch:totalResults>
  <entry>
    <id>http://arxiv.org/abs/2401.99999v1</id>
    <updated>2024-03-01T00:00:00Z</updated>
    <published>2024-02-20T00:00:00Z</published>
    <title>Single Entry Paper</title>
    <summary>Single abstract.</summary>
    <author><name>Solo Author</name></author>
    <link href="http://arxiv.org/pdf/2401.99999v1" rel="related" type="application/pdf" title="pdf"/>
    <arxiv:primary_category term="cs.CL"/>
    <category term="cs.CL"/>
  </entry>
</feed>`
    const { papers, total } = parseArxivAtomXml(singleEntryXml)
    expect(papers).toHaveLength(1)
    expect(total).toBe(1)
    expect(papers[0].paperId).toBe('2401.99999')
    expect(papers[0].title).toBe('Single Entry Paper')
    expect(papers[0].authors).toEqual(['Solo Author'])
  })
})

// ============================================================================
// 4. extractArxivId（spec 6.4 节）
// ============================================================================

describe('extractArxivId', () => {
  it('14. 标准 arxiv URL → 提取 ID（去掉版本后缀）', () => {
    expect(extractArxivId('http://arxiv.org/abs/2401.12345v1')).toBe('2401.12345')
    expect(extractArxivId('http://arxiv.org/abs/2401.67890v2')).toBe('2401.67890')
  })

  it('15. 非 arxiv URL → 空字符串', () => {
    expect(extractArxivId('https://example.com/foo/bar')).toBe('')
    expect(extractArxivId('not-a-url')).toBe('')
  })
})

// ============================================================================
// 5. extractRepoFullName（spec 6.4 节）
// ============================================================================

describe('extractRepoFullName', () => {
  it('16. GitHub API repository_url → owner/repo', () => {
    // 实际正则匹配 /repos/owner/repo 格式（GitHub API repository_url 字段格式）
    expect(extractRepoFullName('https://api.github.com/repos/octocat/hello-world')).toBe('octocat/hello-world')
    expect(extractRepoFullName('https://api.github.com/repos/microsoft/vscode')).toBe('microsoft/vscode')
  })

  it('17. 非 GitHub API URL / null / undefined → 空字符串', () => {
    expect(extractRepoFullName('https://github.com/octocat/hello-world')).toBe('')  // 无 /repos/ 前缀
    expect(extractRepoFullName('https://example.com/foo/bar')).toBe('')
    expect(extractRepoFullName(null)).toBe('')
    expect(extractRepoFullName(undefined)).toBe('')
  })
})

// ============================================================================
// 6. retryWithBackoff（spec 6.5 节）
// ============================================================================

describe('retryWithBackoff', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('18. fn 成功 → 返回结果，不重试', async () => {
    const fn = vi.fn().mockResolvedValue('success')
    const result = await retryWithBackoff(fn, { retries: 3, baseDelayMs: 1000 })
    expect(result).toBe('success')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('19. fn 抛 NetworkError → 重试 3 次（1s/2s/4s 退避），最终抛出', async () => {
    const fn = vi.fn().mockRejectedValue(new NetworkError('network fail'))
    const promise = retryWithBackoff(fn, { retries: 3, baseDelayMs: 1000 })
    // 提前挂 catch 防止 advanceTimersByTimeAsync 期间产生 unhandled rejection
    promise.catch(() => {})

    // 总退避：1000 + 2000 + 4000 = 7000ms
    await vi.advanceTimersByTimeAsync(7000)
    await expect(promise).rejects.toThrow('network fail')
    // 1 次初始 + 3 次重试 = 4 次
    expect(fn).toHaveBeenCalledTimes(4)
  })

  it('20. fn 抛 HttpError(429) + retry-after → 重试后成功', async () => {
    const err = new HttpError(429, 'rate limited', { retryAfter: 5 })
    const fn = vi.fn()
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce('recovered')
    const promise = retryWithBackoff(fn, { retries: 3, baseDelayMs: 1000 })

    // delay = max(5*1000, 1000*2^0) = max(5000, 1000) = 5000
    await vi.advanceTimersByTimeAsync(5000)
    const result = await promise
    expect(result).toBe('recovered')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('21. fn 抛 HttpError(500) → 重试后成功', async () => {
    const err = new HttpError(500, 'server error')
    const fn = vi.fn()
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce('recovered')
    const promise = retryWithBackoff(fn, { retries: 3, baseDelayMs: 1000 })

    // delay = 1000 * 2^0 = 1000
    await vi.advanceTimersByTimeAsync(1000)
    const result = await promise
    expect(result).toBe('recovered')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('22. fn 抛 HttpError(400) → 不重试，直接抛出', async () => {
    const err = new HttpError(400, 'bad request')
    const fn = vi.fn().mockRejectedValue(err)
    // 4xx 非 429 不重试，不需要推进 fake timer
    await expect(retryWithBackoff(fn, { retries: 3, baseDelayMs: 1000 }))
      .rejects.toThrow('HTTP 400')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('23. fn 重试 3 次仍失败 → 抛最后一次错误', async () => {
    const lastErr = new NetworkError('persistent failure')
    const fn = vi.fn().mockRejectedValue(lastErr)
    const promise = retryWithBackoff(fn, { retries: 3, baseDelayMs: 1000 })
    promise.catch(() => {})  // 防止 unhandled rejection

    await vi.advanceTimersByTimeAsync(7000)
    try {
      await promise
      expect.fail('should have thrown')
    } catch (e) {
      expect(e).toBe(lastErr)  // 确切是同一个错误对象
    }
    expect(fn).toHaveBeenCalledTimes(4)
  })
})
