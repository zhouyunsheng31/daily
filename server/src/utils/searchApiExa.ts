// ============================================================================
// Exa 搜索 API 调用层（2026-08-17，替换秘塔/GitHub 搜索）
// ----------------------------------------------------------------------------
// 决策：搜索供应商替换为 Exa + ArXiv（用户拍板）。
// Exa 承担：通用网页搜索（web_search）、读取网页全文（read_webpage）、
//   相似内容检索（exa_find_similar）。
// ArXiv 保留：学术论文（academic_search）。
//
// Exa 端点：
//   POST /search          语义搜索（返回结果列表，可带 summary/highlights）
//   POST /contents        按 URL 抓取正文（批量）
//   POST /findSimilar     按 URL 找语义相似内容
// 认证：x-api-key: <key>（dashboard.exa.ai/api-keys）
// 计费：search $7/1k 请求（超出 10 条 $1/1k）、contents $1/1k 页、
//       findSimilar $7/1k；响应自带 costDollars.total 可记录成本。
// 仅依赖 Node.js 内置 fetch，不依赖项目内其他文件。
// ============================================================================

export type ExaSearchCategory =
  | 'research paper'
  | 'company'
  | 'people'
  | 'dataset'
  | 'github'
  | 'news'
  | 'pdf'
  | 'patent'
  | 'financial report'

export interface ExaSearchParams {
  query: string
  numResults?: number           // 默认 5，最大 10
  category?: ExaSearchCategory  // 分类过滤（research paper=论文）
  startPublishedDate?: string   // YYYY-MM-DD
  endPublishedDate?: string     // YYYY-MM-DD
  includeSummary?: boolean      // 是否返回 AI 摘要（默认 true，cost $1/1k 页）
}

export interface ExaHit {
  title: string
  url: string
  publishedDate?: string  // ISO YYYY-MM-DD
  author?: string | null
  summary?: string
  highlights?: string[]
}

export interface ExaSearchResult {
  results: ExaHit[]
  /** 本次请求成本（USD），来自响应 costDollars.total；无则 undefined */
  costUsd?: number
}

export interface ExaContentsResult {
  results: Array<{
    url: string
    title: string
    author?: string | null
    publishedDate?: string  // ISO YYYY-MM-DD
    text: string            // 正文（markdown 风格文本）
  }>
  costUsd?: number
}

// ---------------------------------------------------------------------------
// 底层请求（带超时 + 错误格式化；Exa 成功率极高，重试 1 次即可）
// ---------------------------------------------------------------------------

async function exaFetch(path: string, body: Record<string, unknown>, key: string): Promise<any> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)
  try {
    const resp = await fetch(`https://api.exa.ai${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const text = await resp.text()
    let data: any = null
    try { data = JSON.parse(text) } catch { /* 非 JSON（如 HTML 错误页） */ }
    if (!resp.ok) {
      const detail = data?.error ?? (typeof data === 'string' ? data : '')
      throw new Error(`Exa ${path} HTTP ${resp.status}${detail ? `: ${String(detail).slice(0, 300)}` : ''}`)
    }
    return data
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Exa ${path} 请求超时（30s）`)
    }
    if (err instanceof Error && err.message.startsWith('Exa ')) throw err
    throw new Error(`Exa ${path} 网络错误：${err instanceof Error ? err.message : String(err)}`)
  } finally {
    clearTimeout(timeout)
  }
}

// ---------------------------------------------------------------------------
// search：语义搜索
// ---------------------------------------------------------------------------

export async function callExaSearch(params: ExaSearchParams, key: string): Promise<ExaSearchResult> {
  if (!key) throw new Error('未配置 Exa API Key（EXA_API_KEY）')
  const body: Record<string, unknown> = {
    query: params.query,
    numResults: Math.min(params.numResults ?? 5, 10),
    type: 'auto',
  }
  if (params.category) body.category = params.category
  if (params.startPublishedDate) body.startPublishedDate = params.startPublishedDate
  if (params.endPublishedDate) body.endPublishedDate = params.endPublishedDate
  // 默认要 AI 摘要（让 AI 不点开也能拿到要点）
  if (params.includeSummary !== false) {
    body.contents = { summary: { maxCharacters: 400 } }
  }

  const data = await exaFetch('/search', body, key)

  const results: ExaHit[] = (data?.results ?? []).map((item: any) => ({
    title: String(item.title ?? ''),
    url: String(item.url ?? ''),
    publishedDate: item.publishedDate ? String(item.publishedDate).slice(0, 10) : undefined,
    author: item.author ?? null,
    summary: item.summary ? String(item.summary) : undefined,
    highlights: Array.isArray(item.highlights) ? item.highlights.map(String) : undefined,
  }))

  const costUsd = typeof data?.costDollars?.total === 'number' ? data.costDollars.total : undefined
  return { results, ...(costUsd !== undefined ? { costUsd } : {}) }
}

// ---------------------------------------------------------------------------
// contents：按 URL 抓取正文（批量）
// ---------------------------------------------------------------------------

export async function callExaContents(
  urls: string[],
  key: string,
  maxCharacters = 8000,
): Promise<ExaContentsResult> {
  if (!key) throw new Error('未配置 Exa API Key（EXA_API_KEY）')
  if (!Array.isArray(urls) || urls.length === 0) throw new Error('urls 不能为空')
  const data = await exaFetch('/contents', {
    urls: urls.slice(0, 5), // 单次最多抓 5 页，防止撑爆上下文
    text: { maxCharacters },
  }, key)

  const statusMap = new Map<string, string>(
    (data?.statuses ?? []).map((s: any) => [s.id, s.status]),
  )
  const results = (data?.results ?? []).map((item: any) => ({
    url: String(item.url ?? ''),
    title: String(item.title ?? ''),
    author: item.author ?? null,
    publishedDate: item.publishedDate ? String(item.publishedDate).slice(0, 10) : undefined,
    text: String(item.text ?? ''),
    status: statusMap.get(item.url) ?? 'unknown',
  }))

  const costUsd = typeof data?.costDollars?.total === 'number' ? data.costDollars.total : undefined
  return { results, ...(costUsd !== undefined ? { costUsd } : {}) }
}

// ---------------------------------------------------------------------------
// findSimilar：按 URL 找语义相似内容
// ---------------------------------------------------------------------------

export async function callExaFindSimilar(
  url: string,
  key: string,
  numResults = 5,
): Promise<ExaSearchResult> {
  if (!key) throw new Error('未配置 Exa API Key（EXA_API_KEY）')
  const data = await exaFetch('/findSimilar', {
    url,
    numResults: Math.min(numResults, 10),
  }, key)

  const results: ExaHit[] = (data?.results ?? []).map((item: any) => ({
    title: String(item.title ?? ''),
    url: String(item.url ?? ''),
    publishedDate: item.publishedDate ? String(item.publishedDate).slice(0, 10) : undefined,
    author: item.author ?? null,
  }))
  const costUsd = typeof data?.costDollars?.total === 'number' ? data.costDollars.total : undefined
  return { results, ...(costUsd !== undefined ? { costUsd } : {}) }
}
