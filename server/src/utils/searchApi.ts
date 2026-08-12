// ============================================================================
// 外部搜索 API 调用工具
// 支持秘塔 AI 搜索、ArXiv 学术搜索、GitHub 搜索/下载
// 仅依赖 Node.js 内置 fetch，不依赖项目内其他文件
// ============================================================================

import { XMLParser } from 'fast-xml-parser'

// ArXiv API XML 解析器（spec 4.4 节）
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
})

// ---------------------------------------------------------------------------
// 通用重试与错误处理
// ---------------------------------------------------------------------------

interface RetryOptions {
  retries?: number
  baseDelayMs?: number
}

/** HTTP 错误（携带状态码、响应体和限流相关头，spec 4.3 节） */
class HttpError extends Error {
  status: number
  body: string
  rateLimitRemaining?: number   // X-RateLimit-Remaining 头（剩余请求数）
  rateLimitReset?: number      // X-RateLimit-Reset 头（unix epoch 秒）
  retryAfter?: number          // Retry-After 头（秒）

  constructor(
    status: number,
    body: string,
    opts?: { rateLimitRemaining?: number; rateLimitReset?: number; retryAfter?: number },
  ) {
    super(`HTTP ${status}: ${body}`)
    this.name = 'HttpError'
    this.status = status
    this.body = body
    if (opts?.rateLimitRemaining !== undefined) this.rateLimitRemaining = opts.rateLimitRemaining
    if (opts?.rateLimitReset !== undefined) this.rateLimitReset = opts.rateLimitReset
    if (opts?.retryAfter !== undefined) this.retryAfter = opts.retryAfter
  }
}

/** 网络错误（fetch 抛异常、超时） */
class NetworkError extends Error {
  constructor(detail: string) {
    super(detail)
    this.name = 'NetworkError'
  }
}

/**
 * 指数退避重试
 * - 429：读取 retry-after 头（秒），等待 max(retry-after, baseDelay * 2^attempt) 后重试
 * - 5xx：重试
 * - 4xx（非 429）：不重试，直接抛错
 * - 网络错误（fetch 抛异常）：重试
 * - 其他错误（如解析失败）：不重试
 * - 重试耗尽后抛最后一个错误
 */
async function retryWithBackoff<T>(fn: () => Promise<T>, opts?: RetryOptions): Promise<T> {
  const retries = opts?.retries ?? 3
  const baseDelay = opts?.baseDelayMs ?? 1000

  let lastErr: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err

      let retryable = false
      let delay = baseDelay * Math.pow(2, attempt)

      if (err instanceof HttpError) {
        if (err.status === 429) {
          retryable = true
          if (err.retryAfter !== undefined) {
            // retryAfter 单位：秒（spec 4.3 节改造后为 number）
            delay = Math.max(err.retryAfter * 1000, delay)
          }
        } else if (err.status >= 500) {
          retryable = true
        }
        // 4xx 非 429：不重试
      } else if (err instanceof NetworkError) {
        retryable = true
      }
      // 其他错误：不重试

      if (!retryable || attempt === retries) {
        throw err
      }

      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }
  throw lastErr
}

/**
 * 通用 fetch + 30s 超时 + 重试 + 错误格式化
 * @param apiUrl 请求 URL
 * @param init fetch init（不含 signal，由本函数管理）
 * @param apiName API 名称（用于错误消息）
 * @param parseResponse 响应解析函数（抛出的非 HttpError/NetworkError 错误不会被重试）
 */
async function fetchWithRetry<T>(
  apiUrl: string,
  init: RequestInit,
  apiName: string,
  parseResponse: (response: Response) => Promise<T>,
  options?: { timeoutMs?: number; retries?: number },
): Promise<T> {
  // 2026-08-10 性能优化：允许按 API 配置超时/重试（搜索类快速失败，避免 90s 等待）
  const timeoutMs = options?.timeoutMs ?? 30_000
  const retries = options?.retries
  try {
    return await retryWithBackoff(async () => {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), timeoutMs)

      try {
        let response: Response
        try {
          // 2026-08-08 修复：秘塔 API 对 Node 默认 UA 的请求返回空结果（反爬），
          // 必须带浏览器 UA（curl 正常、node fetch 空数组——线上 web_search 因此搜不到）
          const headers: Record<string, string> = {
            'User-Agent': 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
            ...(init.headers as Record<string, string> | undefined),
          }
          response = await fetch(apiUrl, { ...init, headers, signal: controller.signal })
        } catch (e) {
          if (e instanceof Error && e.name === 'AbortError') {
            throw new NetworkError(`请求超时（${timeoutMs}ms）`)
          }
          throw new NetworkError(e instanceof Error ? e.message : String(e))
        }

        if (!response.ok) {
          const body = await response.text().catch(() => '')
          // 解析限流相关头（spec 4.3 节）：X-RateLimit-Remaining / X-RateLimit-Reset / Retry-After
          const opts: { rateLimitRemaining?: number; rateLimitReset?: number; retryAfter?: number } = {}
          const remainingHeader = response.headers.get('x-ratelimit-remaining')
          if (remainingHeader !== null) {
            const n = parseInt(remainingHeader, 10)
            if (!Number.isNaN(n)) opts.rateLimitRemaining = n
          }
          const resetHeader = response.headers.get('x-ratelimit-reset')
          if (resetHeader !== null) {
            const n = parseInt(resetHeader, 10)
            if (!Number.isNaN(n)) opts.rateLimitReset = n
          }
          const retryAfterHeader = response.headers.get('retry-after')
          if (retryAfterHeader !== null) {
            const n = parseInt(retryAfterHeader, 10)
            if (!Number.isNaN(n)) opts.retryAfter = n
          }
          throw new HttpError(response.status, body, opts)
        }

        return await parseResponse(response)
      } finally {
        clearTimeout(timeout)
      }
    }, retries !== undefined ? { retries } : undefined)
  } catch (err) {
    if (err instanceof HttpError) {
      if (err.status === 429) {
        throw new Error(
          `${apiName} API 返回 429：请求过于频繁${err.retryAfter !== undefined ? `，建议 ${err.retryAfter} 秒后重试` : ''}`,
        )
      }
      throw new Error(`${apiName} API 返回错误 ${err.status}: ${err.body}`)
    }
    if (err instanceof NetworkError) {
      throw new Error(`网络错误：${err.message}`)
    }
    throw err
  }
}

/** 从 Content-Disposition 头提取文件名（兼容 filename、filename*、带引号和不带引号） */
export function extractFileName(contentDisposition: string | null): string {
  if (!contentDisposition) return ''
  const match = contentDisposition.match(/filename\*?=(?:UTF-8'')?(['"]?)([^'";\n]*)\1/i)
  if (!match) return ''
  try {
    return decodeURIComponent(match[2])
  } catch {
    return match[2]
  }
}

/** 从 GitHub repository_url 提取 owner/repo */
function extractRepoFullName(repositoryUrl: string | undefined | null): string {
  if (!repositoryUrl) return ''
  const match = repositoryUrl.match(/\/repos\/([^/]+\/[^/]+)/)
  return match ? match[1] : ''
}

/**
 * 构造 GitHub 代理完整 URL（spec 6.1 节）
 *
 * 服务器返回给客户端的代理 URL 必须是完整 URL（含 scheme + host），
 * 否则客户端（LLM/用户）拿到相对路径 /api/github/proxy?... 无法直接使用。
 *
 * 通过环境变量 SERVER_BASE_URL 配置服务器对外可达地址，
 * 如 https://daily.example.com
 *
 * 开发模式下 SERVER_BASE_URL 未配置时，回退到 http://localhost:${PORT}
 */
export function buildGithubProxyUrl(params: {
  type: 'zip' | 'asset' | 'file'
  owner: string
  repo: string
  ref?: string
  path?: string
  sha?: string
  assetId?: string
  fileName: string
}): string {
  const baseUrl = process.env.SERVER_BASE_URL || `http://localhost:${process.env.PORT || 3456}`
  const query = new URLSearchParams({
    type: params.type,
    owner: params.owner,
    repo: params.repo,
    fileName: params.fileName,
  })
  if (params.ref) query.set('ref', params.ref)
  if (params.path) query.set('path', params.path)
  if (params.sha) query.set('sha', params.sha)
  if (params.assetId) query.set('assetId', params.assetId)
  return `${baseUrl}/api/github/proxy?${query.toString()}`
}

// ---------------------------------------------------------------------------
// 1. 秘塔 AI 搜索 (Metaso)
// ---------------------------------------------------------------------------

/** 秘塔搜索范围（2026-08-05 扩展）：网页/文库/学术/图片/视频/播客 */
export type MetasoSearchScope = 'webpage' | 'document' | 'scholar' | 'image' | 'video' | 'podcast'

export interface WebSearchParams {
  query: string
  count?: number
  /** 搜索范围（默认 webpage）；scholar=学术（用户可让 AI 用此搜论文），image=图片 */
  scope?: MetasoSearchScope
  page?: number
}

export interface WebSearchHit {
  title: string
  url: string
  snippet: string
  summary?: string
  datePublished?: string  // ISO YYYY-MM-DD（秘塔返回中文格式 "2025年05月16日"，解析为 ISO）
}

export interface WebSearchResult {
  results: WebSearchHit[]
  total: number
}

/**
 * callMetaso 内部返回类型（spec 2.7.5 节）
 *
 * 在 WebSearchResult 基础上追加 _credits 内部字段，用于把秘塔响应中的 credits
 * 传递到 webSearchTool.execute 内的 logApiUsage；返回给客户端前需移除该字段。
 */
export interface WebSearchResultInternal extends WebSearchResult {
  _credits?: number
}

/**
 * 2026-08-10 性能优化：web_search 结果缓存 + single-flight。
 * - 相同 query+scope+page 的搜索 10 分钟内秒回（AI 同话题反复搜索不再重复打秘塔 API，
 *   响应从 1-5s 降到 <1ms，同时省积分；命中缓存 _credits=0 不重复计费）；
 * - 并发相同请求合并为一次外部调用（AI 并行工具调用时不会重复请求）；
 * - 上限 200 条，超出淘汰最早一条（简单 LRU）。
 */
const METASO_CACHE_TTL_MS = 10 * 60_000
const METASO_CACHE_MAX = 200
const metasoCache = new Map<string, { at: number; data: WebSearchResultInternal }>()
const metasoInflight = new Map<string, Promise<WebSearchResultInternal>>()

/**
 * 调用秘塔 AI 搜索 API
 * 端点：POST https://metaso.cn/api/v1/search
 * 认证：Bearer mk-{API_KEY}
 * 定价：0.03元/次，新用户5000点免费额度
 *
 * 实测响应字段（spec 2.7 节，2026-06-29 确认）：
 * - 顶层是 webpages[]（不是 results[]）
 * - 单条是 link（不是 url）
 * - 无 answer 字段（AI 总结通过首条 summary 体现，includeSummary:true 时返回）
 * - 顶层 total（如 51）应优先用，不用 results.length
 * - 顶层 credits 字段记录到 api_usage_log.credits_consumed（spec 2.7.5 节）
 */
export async function callMetaso(params: WebSearchParams, key: string): Promise<WebSearchResultInternal> {
  if (!key) throw new Error('未配置秘塔搜索 API Key，请在设置中填写（metaso.cn 获取）')

  const cacheKey = `${params.scope ?? 'webpage'}|${params.page ?? 1}|${params.query}`
  const cached = metasoCache.get(cacheKey)
  if (cached && Date.now() - cached.at < METASO_CACHE_TTL_MS) {
    return { ...cached.data, _credits: 0 } // 命中缓存：秒回且不消耗积分
  }
  const inflight = metasoInflight.get(cacheKey)
  if (inflight) return inflight // single-flight：并发相同请求合并

  const promise = (async () => {
    try {
      const data = await doCallMetaso(params, key)
      if (metasoCache.size >= METASO_CACHE_MAX) {
        const oldestKey = metasoCache.keys().next().value
        if (oldestKey) metasoCache.delete(oldestKey)
      }
      metasoCache.set(cacheKey, { at: Date.now(), data })
      return data
    } finally {
      metasoInflight.delete(cacheKey)
    }
  })()
  metasoInflight.set(cacheKey, promise)
  return promise
}

async function doCallMetaso(params: WebSearchParams, key: string): Promise<WebSearchResultInternal> {
  const body = JSON.stringify({
    q: params.query,
    scope: params.scope ?? 'webpage',
    includeSummary: true,
    size: String(Math.min(params.count ?? 10, 20)),
    // 2026-08-08 修复：page:1 会导致秘塔返回空结果（实测 page=1 响应无 webpages），
    // 只有显式要求翻页（page>1）时才传该参数
    ...(params.page && params.page > 1 ? { page: params.page } : {}),
    includeRawContent: false,
    conciseSnippet: true,
  })

  const data = await fetchWithRetry(
    'https://metaso.cn/api/v1/search',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body,
    },
    'Metaso',
    async (response) => {
      try {
        return await response.json() as any
      } catch (e) {
        throw new Error(`Metaso API 响应解析失败：${e instanceof Error ? e.message : String(e)}`)
      }
    },
    // 2026-08-10 搜索类快速失败：15s 超时 + 1 次重试（原来 30s×3 次最坏等 90s，
    // 失败时 AI 可立即换关键词重搜，而不是干等）
    { timeoutMs: 15_000, retries: 1 },
  )

  // 解析响应：webpages 是来源列表（修复 bug 1：results → webpages，spec 2.7.4 节）；
  // 2026-08-08 兼容 scholar scope：学术搜索返回的是 scholars[] 字段（实测 scope=scholar
  // 响应用 scholars 而非 webpages），否则学术结果会被丢弃
  const rawWebpages = data?.webpages ?? data?.scholars ?? []
  const results: WebSearchHit[] = rawWebpages.map((item: any) => {
    const hit: WebSearchHit = {
      title: item.title ?? '',
      url: item.link ?? '',                    // 修复 bug 2：url → link（spec 2.7.4 节）
      snippet: item.snippet ?? item.summary ?? '',  // summary 兜底 snippet（实测 summary/snippet 互斥）
    }
    // 新增：summary 字段（实测：includeSummary:true 时部分结果有 AI 生成 summary）
    if (item.summary) hit.summary = item.summary
    // 新增：datePublished 字段（实测：中文格式 "2025年05月16日" → ISO "2025-05-16"）
    if (item.date) {
      const m = String(item.date).match(/(\d{4})年(\d{2})月(\d{2})日/)
      if (m) hit.datePublished = `${m[1]}-${m[2]}-${m[3]}`
    }
    return hit
  })

  // 修复 bug 3：移除 data.answer 前置逻辑（实测秘塔无 answer 字段，spec 2.7.4 节）
  // AI 总结通过首条结果的 summary 字段体现（includeSummary:true 时首条通常含 summary）

  // 新增：credits 字段记录（spec 2.7.5 节，传递到 logApiUsage 用于配额监控）
  const creditsConsumed = typeof data?.credits === 'number' ? data.credits : undefined

  return {
    results,
    total: typeof data?.total === 'number' ? data.total : results.length,  // 实测秘塔返回 total 顶层字段
    ...(creditsConsumed !== undefined ? { _credits: creditsConsumed } : {}),
  }
}

// ---------------------------------------------------------------------------
// 1b. 秘塔读取网页（2026-08-05，POST /api/v1/reader）
// 给定 URL 读取网页全文（markdown），AI 可「打开指定网页 → 看到网页里的链接 →
// 继续打开里面的网页」多级跳转；返回标题/作者/日期 + markdown 全文。
// ---------------------------------------------------------------------------

export interface MetasoReaderResult {
  title: string
  url: string
  author: string
  date: string
  /** 网页全文（markdown 格式；accept=json 时返回 markdown 字段） */
  markdown: string
  _credits?: number
}

export async function callMetasoReader(url: string, key: string): Promise<MetasoReaderResult> {
  if (!key) throw new Error('未配置秘塔搜索 API Key，请在设置中填写（metaso.cn 获取）')
  const body = JSON.stringify({ url: String(url).slice(0, 2000), accept: 'json' })
  const data = await fetchWithRetry(
    'https://metaso.cn/api/v1/reader',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body,
    },
    'Metaso Reader',
    async (response) => {
      try {
        return await response.json() as any
      } catch (e) {
        throw new Error(`Metaso Reader 响应解析失败：${e instanceof Error ? e.message : String(e)}`)
      }
    },
  )
  return {
    title: String(data?.title ?? ''),
    url: String(data?.url ?? url),
    author: String(data?.author ?? ''),
    date: String(data?.date ?? ''),
    markdown: String(data?.markdown ?? ''),
    ...(typeof data?.credits === 'number' ? { _credits: data.credits } : {}),
  }
}

// ---------------------------------------------------------------------------
// 5. ArXiv 学术搜索（spec 3 节：移除 Semantic Scholar，仅保留 ArXiv）
// ---------------------------------------------------------------------------

export interface AcademicSearchParams {
  query: string
  limit?: number
  offset?: number
  category?: string     // ArXiv 分类，如 'cs.AI'
  sortBy?: 'relevance' | 'lastUpdatedDate' | 'submittedDate'  // 默认 'submittedDate'
  sortOrder?: 'ascending' | 'descending'  // 默认 'descending'
}

export interface AcademicPaper {
  paperId: string                  // = arxivId，保留以兼容客户端
  title: string
  abstract: string
  authors: string[]
  year: number
  venue: string                    // 固定 'ArXiv'，保留以兼容客户端
  citationCount: number            // 固定 0，保留以兼容客户端
  openAccessPdf?: { url: string; status: string }  // status 固定 'GREEN'
  externalIds?: { ArXiv?: string }  // 仅保留 ArXiv，移除 DOI
  publicationDate?: string         // ISO YYYY-MM-DD
  // ArXiv 特有字段
  absUrl?: string                  // ArXiv abs 页面 URL
  categories?: string[]            // ArXiv 分类列表
  primaryCategory?: string         // ArXiv 主分类
}

export interface AcademicSearchResult {
  papers: AcademicPaper[]
  total: number
}

// ---------------------------------------------------------------------------
// 3. GitHub 搜索/下载
// ---------------------------------------------------------------------------

export type GithubSearchMode =
  | 'search_repos'
  | 'search_code'
  | 'search_users'
  | 'search_issues'
  | 'download_release'
  | 'download_file'
  | 'download_repo_zip'

export interface GithubSearchParams {
  mode: GithubSearchMode
  query?: string
  owner?: string
  repo?: string
  assetId?: number
  path?: string
  sha?: string
  ref?: string  // Phase S10：分支/tag/commit，download_repo_zip 时可选，默认 'HEAD'
  page?: number
  perPage?: number
  language?: string
  sort?: string
}

export interface GithubSearchResult {
  mode: GithubSearchMode
  items?: any[]
  total?: number
  download?: {
    fileName: string
    size: number
    content?: string
    downloadUrl?: string
  }
}

const GITHUB_BASE = 'https://api.github.com'
const ONE_MB = 1_000_000

// GitHub API 无需 token 也可工作，但速率限制较低（60 req/hour vs 5000 req/hour）
function githubHeaders(key?: string, accept = 'application/vnd.github+json'): Record<string, string> {
  const headers: Record<string, string> = {
    'Accept': accept,
    'User-Agent': 'LivingDashboard-Server',
  }
  if (key) {
    headers['Authorization'] = `Bearer ${key}`
  }
  return headers
}

/**
 * GitHub JSON 请求（带重试、错误格式化、限额友好提示，spec 4.3 节）
 *
 * 在 fetchWithRetry 基础上包装一层 catch，识别 GitHub 特有的限额错误：
 * - 403 + X-RateLimit-Remaining: 0 → 主配额耗尽（60 req/hour 无 token / 5000 req/hour token 模式）
 * - 429 + Retry-After → 二级限额（如 search API 单独限额）
 */
async function githubJsonRequest(url: string, headers: Record<string, string>): Promise<any> {
  try {
    return await fetchWithRetry(
      url,
      { method: 'GET', headers },
      'GitHub',
      async (response) => {
        try {
          return await response.json() as any
        } catch (e) {
          throw new Error(`GitHub API 响应解析失败：${e instanceof Error ? e.message : String(e)}`)
        }
      },
    )
  } catch (err) {
    // GitHub 限额特殊处理（spec 4.3 节）
    if (err instanceof HttpError) {
      // 主配额耗尽：403 + X-RateLimit-Remaining: 0
      if (err.status === 403 && err.rateLimitRemaining === 0 && err.rateLimitReset !== undefined) {
        const resetDate = new Date(err.rateLimitReset * 1000)
        const resetStr = resetDate.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
        throw new Error(
          `GitHub API 配额已耗尽（无 token 模式 60 req/hour / token 模式 5000 req/hour）。` +
          `配额将在 ${resetStr} 重置（X-RateLimit-Reset）。` +
          `建议：1) 等待重置后重试；2) 在 设置 → 搜索 Key → GitHub 中配置 PAT 提升到 5000 req/hour。`
        )
      }
      // 二级限额：429 + Retry-After
      if (err.status === 429 && err.retryAfter !== undefined) {
        throw new Error(
          `GitHub API 二级限额触发（如 search API 单独限额，与主配额独立）。` +
          `建议 ${err.retryAfter} 秒后重试。`
        )
      }
    }
    throw err
  }
}

/**
 * 调用 GitHub 搜索/下载 API
 * 支持 7 种 mode：search_repos、search_code、search_users、search_issues、download_release、download_file、download_repo_zip
 */
export async function callGitHub(params: GithubSearchParams, key?: string): Promise<GithubSearchResult> {
  // GitHub API 无需 token 也可工作，但速率限制较低（60 req/hour vs 5000 req/hour）

  switch (params.mode) {
    case 'search_repos':
      return githubSearchRepos(params, key)
    case 'search_code':
      return githubSearchCode(params, key)
    case 'search_users':
      return githubSearchUsers(params, key)
    case 'search_issues':
      return githubSearchIssues(params, key)
    case 'download_release':
      return githubDownloadRelease(params, key)
    case 'download_file':
      return githubDownloadFile(params, key)
    case 'download_repo_zip':
      return githubDownloadRepoZip(params, key)
    default:
      throw new Error(`未知的 GitHub 模式：${params.mode as string}`)
  }
}

async function githubSearchRepos(params: GithubSearchParams, key?: string): Promise<GithubSearchResult> {
  const q = new URLSearchParams({
    q: params.query ?? '',
    page: String(params.page ?? 1),
    per_page: String(params.perPage ?? 30),
    order: 'desc',
  })
  if (params.sort) q.set('sort', params.sort)

  const url = `${GITHUB_BASE}/search/repositories?${q.toString()}`
  const data = await githubJsonRequest(url, githubHeaders(key))

  const items = (data?.items ?? []).map((item: any) => ({
    id: item.id,
    fullName: item.full_name ?? '',
    description: item.description ?? null,
    htmlUrl: item.html_url ?? '',
    stargazersCount: item.stargazers_count ?? 0,
    forksCount: item.forks_count ?? 0,
    language: item.language ?? null,
    updatedAt: item.updated_at ?? '',
    topics: item.topics ?? [],
  }))

  return { mode: 'search_repos', items, total: data?.total_count ?? items.length }
}

async function githubSearchCode(params: GithubSearchParams, key?: string): Promise<GithubSearchResult> {
  // spec 4.2 节：search_code 端点强制要 token，无 token 时返回明确错误
  // 其他端点（search_repos/search_users/search_issues/download_*）无 token 也能用
  if (!key) {
    throw new Error(
      'GitHub 代码搜索（search_code）需要 Personal Access Token，未配置 token 时无法使用。' +
      '请在 设置 → 搜索 Key → GitHub 中配置 PAT（https://github.com/settings/tokens）。' +
      '其他模式（search_repos/search_users/search_issues/download_*）无 token 也可用（60 req/hour）。'
    )
  }

  let qStr = params.query ?? ''
  // 修复 BUG 1：用空格代替 +。URLSearchParams 会把空格编码为 +（GitHub 解码后得到正确的查询语法）
  if (params.language) qStr += ` language:${params.language}`

  const q = new URLSearchParams({
    q: qStr,
    page: String(params.page ?? 1),
    per_page: String(params.perPage ?? 30),
  })

  const url = `${GITHUB_BASE}/search/code?${q.toString()}`
  const data = await githubJsonRequest(url, githubHeaders(key))

  const items = (data?.items ?? []).map((item: any) => ({
    name: item.name ?? '',
    path: item.path ?? '',
    // 修复 BUG 2：spec 6.1 GithubCodeHit 要求字段名为 repo，不是 repository
    repo: {
      fullName: item.repository?.full_name ?? '',
      htmlUrl: item.repository?.html_url ?? '',
    },
    htmlUrl: item.html_url ?? '',
    score: item.score ?? 0,
  }))

  return { mode: 'search_code', items, total: data?.total_count ?? items.length }
}

async function githubSearchUsers(params: GithubSearchParams, key?: string): Promise<GithubSearchResult> {
  const q = new URLSearchParams({
    q: params.query ?? '',
    page: String(params.page ?? 1),
    per_page: String(params.perPage ?? 30),
  })

  const url = `${GITHUB_BASE}/search/users?${q.toString()}`
  const data = await githubJsonRequest(url, githubHeaders(key))

  const items = (data?.items ?? []).map((item: any) => ({
    login: item.login ?? '',
    htmlUrl: item.html_url ?? '',
    avatarUrl: item.avatar_url ?? '',
    type: item.type ?? '',
    bio: item.bio ?? null,
    followers: item.followers ?? 0,
    publicRepos: item.public_repos ?? 0,
  }))

  return { mode: 'search_users', items, total: data?.total_count ?? items.length }
}

async function githubSearchIssues(params: GithubSearchParams, key?: string): Promise<GithubSearchResult> {
  const q = new URLSearchParams({
    q: params.query ?? '',
    page: String(params.page ?? 1),
    per_page: String(params.perPage ?? 30),
  })

  const url = `${GITHUB_BASE}/search/issues?${q.toString()}`
  const data = await githubJsonRequest(url, githubHeaders(key))

  const items = (data?.items ?? []).map((item: any) => ({
    id: item.id,
    number: item.number,
    title: item.title ?? '',
    state: item.state ?? '',
    htmlUrl: item.html_url ?? '',
    repo: { fullName: extractRepoFullName(item.repository_url) },
    labels: (item.labels ?? []).map((l: any) => l?.name ?? '').filter(Boolean),
    createdAt: item.created_at ?? '',
    updatedAt: item.updated_at ?? '',
    isPr: !!item.pull_request,
  }))

  return { mode: 'search_issues', items, total: data?.total_count ?? items.length }
}

async function githubDownloadRelease(params: GithubSearchParams, key?: string): Promise<GithubSearchResult> {
  if (!params.owner || !params.repo) {
    throw new Error('GitHub download_release 需要 owner 和 repo 参数')
  }

  if (params.assetId != null) {
    // 下载指定 asset（二进制，302 重定向到 CDN）
    // Phase S10 改造：所有 assetId 都走服务器代理 URL，不再读 body 到内存（spec 5.2 节）
    const owner = params.owner
    const repo = params.repo
    const url = `${GITHUB_BASE}/repos/${owner}/${repo}/releases/assets/${params.assetId}`
    const headers = githubHeaders(key, 'application/octet-stream')

    const download = await fetchWithRetry(
      url,
      { method: 'GET', headers },
      'GitHub',
      async (response) => {
        const contentDisposition = response.headers.get('content-disposition')
        let fileName = extractFileName(contentDisposition)
        if (!fileName) {
          const seg = response.url.split('/').filter(Boolean).pop() ?? ''
          fileName = seg ? decodeURIComponent(seg) : `asset-${params.assetId}`
        }

        const contentLengthHeader = response.headers.get('content-length')
        const contentLength = contentLengthHeader ? parseInt(contentLengthHeader, 10) : 0

        // 主动中断 body 下载（我们只需要元数据）
        response.body?.cancel().catch(() => {})

        const proxyUrl = buildGithubProxyUrl({
          type: 'asset',
          owner,
          repo,
          assetId: String(params.assetId),
          fileName,
        })

        return {
          fileName,
          size: contentLength,  // 可能 0（Content-Length 头缺失），客户端按实际下载大小为准
          downloadUrl: proxyUrl,
        }
      },
    )

    return { mode: 'download_release', download }
  }

  // 获取最新 release 元数据（不下载资产）
  const url = `${GITHUB_BASE}/repos/${params.owner}/${params.repo}/releases/latest`
  const data = await githubJsonRequest(url, githubHeaders(key))

  const release = {
    tagName: data?.tag_name ?? '',
    fileName: data?.name ?? '',
    assets: (data?.assets ?? []).map((a: any) => ({
      id: a.id,
      name: a.name ?? '',
      size: a.size ?? 0,
      downloadUrl: a.browser_download_url ?? '',
    })),
  }

  return { mode: 'download_release', items: [release], total: release.assets.length }
}

async function githubDownloadFile(params: GithubSearchParams, key?: string): Promise<GithubSearchResult> {
  if (!params.owner || !params.repo) {
    throw new Error('GitHub download_file 需要 owner 和 repo 参数')
  }

  let url: string
  if (params.sha) {
    url = `${GITHUB_BASE}/repos/${params.owner}/${params.repo}/git/blobs/${params.sha}`
  } else if (params.path) {
    url = `${GITHUB_BASE}/repos/${params.owner}/${params.repo}/contents/${params.path}`
  } else {
    throw new Error('GitHub download_file 需要 sha 或 path 参数')
  }

  const data = await githubJsonRequest(url, githubHeaders(key))

  const size: number = data?.size ?? 0
  const fileName: string =
    data?.name ?? (params.path ? params.path.split('/').pop() ?? 'file' : params.sha ?? 'blob')
  const content: string = data?.content ?? ''

  // 修复 BUG 5：用 sha 下载 blob 时，GitHub git/blobs API 总是返回 base64 content，
  // 不论文件大小。Phase S10 改造：≥1MB 走代理（服务器解码 base64 返回二进制），<1MB 仍返回 content
  if (params.sha) {
    if (size >= ONE_MB) {
      const proxyUrl = buildGithubProxyUrl({
        type: 'file',
        owner: params.owner,
        repo: params.repo,
        sha: params.sha,
        fileName,
      })
      return { mode: 'download_file', download: { fileName, size, downloadUrl: proxyUrl } }
    }
    return { mode: 'download_file', download: { fileName, size, content } }
  }

  // params.path 路径：≥1MB 走服务器代理（spec 5.1 节），<1MB 保持原 content 行为
  if (size >= ONE_MB) {
    const proxyUrl = buildGithubProxyUrl({
      type: 'file',
      owner: params.owner,
      repo: params.repo,
      path: params.path ?? '',
      fileName,
    })
    return { mode: 'download_file', download: { fileName, size, downloadUrl: proxyUrl } }
  }

  return { mode: 'download_file', download: { fileName, size, content } }
}

/**
 * Phase S10：下载整个仓库 zip 归档（spec 3.2 节）
 *
 * 用 HEAD + redirect:'manual' 拿元数据（避免下载 body 浪费带宽）
 * 手动跟随 301/302/303/307/308 最多 5 次
 * HEAD 不支持时降级 GET + Range: bytes=0-0
 *
 * 返回服务器代理 URL（不返回 codeload URL 给客户端）
 */
async function githubDownloadRepoZip(
  params: GithubSearchParams,
  key?: string,
): Promise<GithubSearchResult> {
  const owner = params.owner
  const repo = params.repo
  const ref = params.ref ?? 'HEAD'

  if (!owner || !repo) throw new Error('download_repo_zip 需要 owner 和 repo 参数')

  // 1. HEAD 请求拿元数据（GitHub zipball 端点 HEAD 也返回 302 + Location 头）
  const url = `${GITHUB_BASE}/repos/${owner}/${repo}/zipball/${ref}`
  const headers = githubHeaders(key)

  // 先 HEAD，如果返回 302 则手动跟随 Location（HEAD 不会下载 body）
  let resp = await fetch(url, { method: 'HEAD', headers, redirect: 'manual' })

  // 手动跟随最多 5 次 302（避免无限重定向）
  let redirectCount = 0
  while ([301, 302, 303, 307, 308].includes(resp.status) && redirectCount < 5) {
    const location = resp.headers.get('location')
    if (!location) break
    resp = await fetch(location, { method: 'HEAD', headers, redirect: 'manual' })
    redirectCount++
  }

  if (redirectCount >= 5) {
    throw new Error('GitHub zipball 重定向次数过多（>5），可能存在循环重定向')
  }

  // 2. 提取元数据（默认从 HEAD 响应拿 Content-Length / Content-Disposition）
  let contentLength = parseInt(resp.headers.get('content-length') ?? '0', 10)
  let contentDisposition = resp.headers.get('content-disposition')

  if (!resp.ok) {
    // HEAD 不支持时降级为 GET + Range: bytes=0-0（只取 1 字节）
    if (resp.status === 405 || resp.status === 501) {
      // 降级路径：GET + Range: bytes=0-0
      const rangeResp = await fetch(url, {
        method: 'GET',
        headers: { ...headers, Range: 'bytes=0-0' },
        redirect: 'follow',
      })
      // 206 响应的 Content-Length 是 1（Range 字节数），不是总大小
      // 总大小在 Content-Range: bytes 0-0/TOTAL 头里
      let totalSize = 0
      const contentRange = rangeResp.headers.get('content-range') ?? ''
      const match = contentRange.match(/\/(\d+)/)
      if (match) totalSize = parseInt(match[1], 10)
      // 若 Content-Range 缺失，size=0（与 5.2 节 release 处理一致）
      contentLength = totalSize
      if (!contentDisposition) {
        contentDisposition = rangeResp.headers.get('content-disposition')
      }
      // 读取并丢弃 1 字节 body（不会下载更多，因为 Range 限制）
      await rangeResp.text().catch(() => {})
    } else {
      const body = await resp.text().catch(() => '')
      throw new Error(`GitHub zipball API 返回错误 ${resp.status}: ${body}`)
    }
  }

  const fileName = contentDisposition
    ? extractFileName(contentDisposition) || `${owner}-${repo}-${ref}.zip`
    : `${owner}-${repo}-${ref}.zip`

  // 3. 构造代理 URL（不返回 codeload URL 给客户端）
  const proxyUrl = buildGithubProxyUrl({
    type: 'zip',
    owner,
    repo,
    ref,
    fileName,
  })

  return {
    mode: 'download_repo_zip',
    download: {
      fileName,
      size: contentLength,
      downloadUrl: proxyUrl,
    },
  }
}

// ---------------------------------------------------------------------------
// 7. ArXiv 最新论文实时搜索（Phase S10 功能 2，spec 4.2-4.6 节）
// ---------------------------------------------------------------------------

const ARXIV_API = 'https://export.arxiv.org/api/query'  // 用 HTTPS（内地可达）

export interface ArxivSearchParams {
  query: string
  category?: string     // ArXiv 分类，如 'cs.AI'
  limit?: number        // max_results，默认 10，硬上限 100
  offset?: number       // start，分页
  sortBy?: 'relevance' | 'lastUpdatedDate' | 'submittedDate'  // 默认 'submittedDate'
  sortOrder?: 'ascending' | 'descending'  // 默认 'descending'
}

/**
 * ArXiv API 节流器：≥3s 间隔，并发安全（spec 4.3 节"预留时间槽"模式）
 *
 * 设计说明：不用 fetchWithRetry（其 429 重试与节流器语义重叠），
 * 改用裸 fetch + 单次 30s 超时；429 时由节流器下次调用自然延后。
 */
let arxivNextAvailableAt = 0
const ARXIV_MIN_INTERVAL_MS = 3000

async function arxivThrottledFetch(url: string): Promise<string> {
  const now = Date.now()
  const earliest = Math.max(now, arxivNextAvailableAt)
  // 预留时间槽 BEFORE await（并发安全：多个并发调用各自占用不同时间槽）
  arxivNextAvailableAt = earliest + ARXIV_MIN_INTERVAL_MS
  if (earliest > now) {
    await new Promise(resolve => setTimeout(resolve, earliest - now))
  }
  // 裸 fetch + 单次 30s 超时；429 时由节流器下次调用自然延后
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'LivingDashboard/1.0 (academic-search)' },
    })
    if (!resp.ok) {
      throw new Error(`ArXiv API 返回 ${resp.status}: ${resp.statusText}`)
    }
    return await resp.text()
  } finally {
    clearTimeout(timeout)
  }
}

/** 解析后的 ArXiv Atom feed 结构（spec 4.4 节） */
interface ParsedArxivFeed {
  feed?: {
    entry?: any | any[]
    'opensearch:totalResults'?: string | { '@_type'?: string; '#text'?: string }
  }
}

/**
 * 解析 ArXiv Atom XML（spec 4.4 节，用 fast-xml-parser，不用正则）
 *
 * 兼容 entry 为单个对象或数组；
 * opensearch:totalResults 兼容字符串和 {@_type, #text} 对象形式
 */
function parseArxivAtomXml(xmlText: string): { papers: AcademicPaper[]; total: number } {
  const doc = xmlParser.parse(xmlText) as ParsedArxivFeed

  // opensearch:totalResults 可能是字符串或对象
  const totalRaw = doc?.feed?.['opensearch:totalResults']
  const total = typeof totalRaw === 'string'
    ? parseInt(totalRaw, 10)
    : (totalRaw && typeof totalRaw === 'object' ? parseInt(totalRaw['#text'] ?? '0', 10) : 0)

  // Atom feed 结构：feed > entry[]
  const entries = doc?.feed?.entry
  const entryList = Array.isArray(entries) ? entries : (entries ? [entries] : [])

  const papers: AcademicPaper[] = entryList.map((entry: any): AcademicPaper => {
    const id: string = entry.id ?? ''
    const arxivId = extractArxivId(id)
    const published: string = entry.published ?? ''
    const publicationDate = published.split('T')[0]
    const year = parseInt(publicationDate.split('-')[0], 10) || 0

    const authors = Array.isArray(entry.author)
      ? entry.author.map((a: any) => a?.name ?? '').filter(Boolean)
      : (entry.author?.name ? [entry.author.name] : [])

    // PDF link 优先取 <link rel="related" type="application/pdf">，否则用 arxiv.org/pdf/{id}.pdf 兜底
    const pdfLink = Array.isArray(entry.link)
      ? entry.link.find((l: any) =>
          l?.['@_rel'] === 'related' && (l?.['@_type'] === 'application/pdf' || l?.['@_title'] === 'pdf'))
      : undefined
    const pdfUrl = pdfLink?.['@_href'] ?? (arxivId ? `https://arxiv.org/pdf/${arxivId}.pdf` : '')

    const paper: AcademicPaper = {
      paperId: arxivId,
      title: (entry.title ?? '').replace(/\s+/g, ' ').trim(),
      abstract: (entry.summary ?? '').replace(/\s+/g, ' ').trim(),
      authors,
      year,
      venue: 'ArXiv',
      citationCount: 0,
      publicationDate,
    }

    // 新增 absUrl（id 字段就是 abs URL，如 http://arxiv.org/abs/2401.12345v1）
    if (id) paper.absUrl = id

    // 新增 categories（entry.category 可能是数组或单个对象）
    const categoryArr = Array.isArray(entry.category)
      ? entry.category
      : (entry.category ? [entry.category] : [])
    const categories = categoryArr
      .map((c: any) => c?.['@_term'] ?? '')
      .filter(Boolean)
    if (categories.length > 0) paper.categories = categories

    // 新增 primaryCategory（arxiv:primary_category 带前缀）
    const primaryCat = entry['arxiv:primary_category']?.['@_term']
    if (primaryCat) paper.primaryCategory = primaryCat

    if (pdfUrl) {
      paper.openAccessPdf = { url: pdfUrl, status: 'GREEN' }
    }
    if (arxivId) {
      paper.externalIds = { ArXiv: arxivId }
    }

    return paper
  })

  return { papers, total: total || papers.length }
}

/** 从 ArXiv entry id URL 提取 arxiv id（如 http://arxiv.org/abs/2401.12345v1 → 2401.12345） */
function extractArxivId(idUrl: string): string {
  const match = idUrl.match(/abs\/([0-9]{4}\.[0-9]{4,5})/)
  return match ? match[1] : ''
}

/**
 * 调用 ArXiv API 搜索最新论文（spec 3.8 节）
 * - URL: https://export.arxiv.org/api/query?search_query=...&sortBy=submittedDate&sortOrder=descending
 * - 节流：通过 arxivThrottledFetch 实现 ≥3s 间隔（并发安全）
 * - 解析：通过 parseArxivAtomXml 解析 Atom XML
 */
export async function callArxiv(params: ArxivSearchParams): Promise<AcademicSearchResult> {
  // ArXiv API 无需 Key

  // 1. 构造 search_query
  const searchQuery = params.category
    ? `all:"${params.query}" AND cat:${params.category}`
    : `all:"${params.query}"`

  const urlParams = new URLSearchParams({
    search_query: searchQuery,
    // 2026-08-08 修复：默认 relevance（按相关度）。此前默认 submittedDate 倒序，
    // 用户搜特定论文（如 DeepSeek-V4 官方报告，提交较早）会被大量新提交的第三方
    // 论文挤掉——"明明存在却搜不到"。找最新提交才显式传 submittedDate。
    sortBy: params.sortBy ?? 'relevance',
    sortOrder: params.sortOrder ?? 'descending',
    start: String(params.offset ?? 0),
    max_results: String(Math.min(params.limit ?? 10, 100)),
  })

  const url = `${ARXIV_API}?${urlParams.toString()}`

  // 2. fetch（带 ArXiv 专用节流）
  const xmlText = await arxivThrottledFetch(url)

  // 3. 解析 Atom XML
  const { papers, total } = parseArxivAtomXml(xmlText)

  return { papers, total }
}

// ============================================================================
// Phase S8.1：测试专用导出（与 piBridge.ts __test 模式一致）
// 仅在测试环境中通过 vi.mock 拦截后使用，生产代码不应引用
// ============================================================================

export const __test = {
  retryWithBackoff,
  parseArxivAtomXml,
  extractArxivId,
  extractRepoFullName,
  HttpError,
  NetworkError,
}
