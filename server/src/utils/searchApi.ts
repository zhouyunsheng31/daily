// ============================================================================
// 外部搜索 API 调用工具
// 2026-08-17 供应商替换：搜索后端改为 **Exa + ArXiv**（用户拍板）。
// - Exa 搜索/读取网页/相似内容 → 独立文件 searchApiExa.ts（搜索主力）
// - ArXiv 学术搜索 → 本文件（保留，免费）
// - githubProxy 下载代理依赖的 buildGithubProxyUrl / extractFileName / extractRepoFullName 保留
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
  const timeoutMs = options?.timeoutMs ?? 30_000
  const retries = options?.retries
  try {
    return await retryWithBackoff(async () => {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), timeoutMs)

      try {
        let response: Response
        try {
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

/** 从 GitHub repository_url 提取 owner/repo（保留：githubProxy 相关测试引用） */
export function extractRepoFullName(repositoryUrl: string | undefined | null): string {
  if (!repositoryUrl) return ''
  const match = repositoryUrl.match(/\/repos\/([^/]+\/[^/]+)/)
  return match ? match[1] : ''
}

/**
 * 构造 GitHub 代理完整 URL（spec 6.1 节）
 * 保留：githubProxy 下载代理路由依赖（搜索工具已不再使用）
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
// ArXiv 学术搜索（spec 3 节：移除 Semantic Scholar，仅保留 ArXiv）
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
 */
let arxivNextAvailableAt = 0
const ARXIV_MIN_INTERVAL_MS = 3000

async function arxivThrottledFetch(url: string): Promise<string> {
  const now = Date.now()
  const earliest = Math.max(now, arxivNextAvailableAt)
  arxivNextAvailableAt = earliest + ARXIV_MIN_INTERVAL_MS
  if (earliest > now) {
    await new Promise(resolve => setTimeout(resolve, earliest - now))
  }
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
 */
function parseArxivAtomXml(xmlText: string): { papers: AcademicPaper[]; total: number } {
  const doc = xmlParser.parse(xmlText) as ParsedArxivFeed

  const totalRaw = doc?.feed?.['opensearch:totalResults']
  const total = typeof totalRaw === 'string'
    ? parseInt(totalRaw, 10)
    : (totalRaw && typeof totalRaw === 'object' ? parseInt(totalRaw['#text'] ?? '0', 10) : 0)

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

    if (id) paper.absUrl = id

    const categoryArr = Array.isArray(entry.category)
      ? entry.category
      : (entry.category ? [entry.category] : [])
    const categories = categoryArr
      .map((c: any) => c?.['@_term'] ?? '')
      .filter(Boolean)
    if (categories.length > 0) paper.categories = categories

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
export function extractArxivId(idUrl: string): string {
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
  const searchQuery = params.category
    ? `all:"${params.query}" AND cat:${params.category}`
    : `all:"${params.query}"`

  const urlParams = new URLSearchParams({
    search_query: searchQuery,
    // 默认 relevance（按相关度）。找最新提交才显式传 submittedDate。
    sortBy: params.sortBy ?? 'relevance',
    sortOrder: params.sortOrder ?? 'descending',
    start: String(params.offset ?? 0),
    max_results: String(Math.min(params.limit ?? 10, 100)),
  })

  const url = `${ARXIV_API}?${urlParams.toString()}`

  const xmlText = await arxivThrottledFetch(url)
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
