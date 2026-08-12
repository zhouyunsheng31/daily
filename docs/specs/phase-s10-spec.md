# Phase S10 Spec：GitHub 中转下载 + 最新论文实时搜

> **状态**：草稿 v3（v2 对抗审查后修复 13 项问题；v3 对抗审查后修复 12 项问题）
> **依赖**：Phase S9（AI 搜索工具基础架构）
> **预估**：3-5 天
> **作者**：2026-06-27

---

## 一、背景与目标

### 1.1 问题

Phase S9 已完成 4 个 AI 搜索工具（local_search / web_search / academic_search / github_search），但有 3 个能力缺口：

1. **GitHub 项目整仓下载缺失**：`github_search` 只支持单文件下载（`download_file`）和 release asset 下载（`download_release`），无法下载整个仓库 zip 归档。
2. **最新论文实时搜缺失**：`academic_search` 只调 Semantic Scholar（S2），S2 search 端点不支持按日期排序，索引延迟数天到数周，无法搜"今天"发表的论文。
3. **大文件下载内地不可达**：`download_file` ≥1MB 返回 `raw.githubusercontent.com` 直链，`download_release` 返回 `objects.githubusercontent.com` CDN 直链——两者在内地无梯子环境下基本不可达。

### 1.2 目标

| 功能 | 目标 | 验收 |
|------|------|------|
| 功能 1：GitHub 项目中转下载 | 新增 `download_repo_zip` mode，支持下载整个仓库 zip 归档 | 内地无梯子用户能下载 microsoft/vscode 仓库 zip |
| 功能 2：最新论文实时搜 | `academic_search` 新增 `mode: 'latest'`，调 ArXiv API 按 `submittedDate` 倒序返回 | 能搜到"今天/昨天"提交的 ArXiv 论文 |
| 功能 3：大文件服务器代理 | 改造 `download_file` / `download_release` 大文件路径，返回服务器代理 URL | 内地无梯子用户能下载 ≥1MB 的 GitHub 文件和 release asset |

### 1.3 非目标

- 不做 ArXiv RSS feed 集成（API query 已足够，RSS 无法按关键词过滤）
- 不做 Unpaywall 集成（Unpaywall 只能按 DOI 查，不适合做搜索源；现有 ArXiv 兜底 URL 已覆盖大部分 OA 论文）
- 不做服务器侧文件缓存（流式代理，不落盘）
- 不做 `git clone` 等其他 Git 操作（仅 zip 归档下载）

---

## 二、共享架构：服务器代理下载端点

### 2.1 端点设计

新增 `GET /api/github/proxy`，走 `authMiddleware`（SERVER_TOKEN 鉴权，开发模式 SERVER_TOKEN 为空时跳过）。

**Query 参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `type` | `'zip' \| 'asset' \| 'file'` | 是 | 下载类型 |
| `owner` | string | 是 | 仓库 owner |
| `repo` | string | 是 | 仓库名 |
| `ref` | string | 否 | 分支/tag/commit，type=zip 时默认 `HEAD` |
| `path` | string | type=file 且无 sha 时必填 | 文件路径 |
| `sha` | string | type=file 时可选 | blob sha（走 git/blobs 端点，服务器解码 base64 后返回二进制） |
| `assetId` | number | type=asset 时必填 | release asset ID |
| `fileName` | string | 可选 | 期望的文件名（用于 Content-Disposition，默认从 GitHub 响应提取） |

### 2.2 实现细节

**文件**：`server/src/routes/githubProxy.ts`

```typescript
import { Router, type Request, type Response } from 'express'
import { authMiddleware } from '../middleware/auth.js'
import { getSearchKey } from '../db/aiSettingsStore.js'
import { logApiUsage } from '../db/apiUsageLog.js'
import { extractFileName } from '../utils/searchApi.js'

export const githubProxyRouter = Router()
// 鉴权说明：`/api` 路由组在 `index.ts` L83 已全局应用 `authMiddleware`，
// 子路由 `/api/github/proxy` 自动继承，无需在 githubProxyRouter 内重复 use。
// 若需独立测试 githubProxyRouter，可在测试 setup 中单独 use(authMiddleware)。

const UPSTREAM_TIMEOUT_MS = 5 * 60 * 1000  // 5 分钟无数据断开

githubProxyRouter.get('/', async (req: Request, res: Response) => {
  const { type, owner, repo, ref, path, sha, assetId, fileName } = req.query as Record<string, string>

  // 1. 参数校验
  if (!type || !owner || !repo) {
    return res.status(400).json({ error: 'missing required params: type, owner, repo' })
  }
  if (type === 'file' && !path && !sha) {
    return res.status(400).json({ error: 'path or sha required for type=file' })
  }
  if (type === 'asset' && !assetId) {
    return res.status(400).json({ error: 'assetId required for type=asset' })
  }

  // 2. 读 GitHub Key
  const key = await getSearchKey('github')
  if (!key) {
    return res.status(500).json({ error: 'GitHub API Key not configured' })
  }

  // 3. 构造上游 URL + headers
  let upstreamUrl: string
  let upstreamHeaders: Record<string, string>
  let needsBase64Decode = false  // sha 路径需要解码 base64

  if (type === 'zip') {
    const safeRef = ref || 'HEAD'
    upstreamUrl = `https://api.github.com/repos/${owner}/${repo}/zipball/${safeRef}`
    upstreamHeaders = {
      Authorization: `Bearer ${key}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'LivingDashboard-Server',
    }
  } else if (type === 'asset') {
    upstreamUrl = `https://api.github.com/repos/${owner}/${repo}/releases/assets/${assetId}`
    upstreamHeaders = {
      Authorization: `Bearer ${key}`,
      Accept: 'application/octet-stream',
      'User-Agent': 'LivingDashboard-Server',
    }
  } else { // type === 'file'
    if (sha) {
      // sha 路径走 git/blobs，返回 JSON {content: base64, encoding: 'base64'}
      // 服务器需解析 JSON + base64 解码 + 返回二进制
      upstreamUrl = `https://api.github.com/repos/${owner}/${repo}/git/blobs/${sha}`
      upstreamHeaders = {
        Authorization: `Bearer ${key}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'LivingDashboard-Server',
      }
      needsBase64Decode = true
    } else {
      // path 路径走 contents API，Accept: raw 直接拿二进制
      upstreamUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`
      upstreamHeaders = {
        Authorization: `Bearer ${key}`,
        Accept: 'application/vnd.github.raw+json',
        'User-Agent': 'LivingDashboard-Server',
      }
    }
  }

  // 4. 客户端中断检测 + 上游 fetch 超时
  const controller = new AbortController()
  let abortReason: 'client' | 'timeout' | null = null

  const onClientClose = () => {
    abortReason = 'client'
    controller.abort()
  }
  req.on('close', onClientClose)

  const timeout = setTimeout(() => {
    abortReason = 'timeout'
    controller.abort()
  }, UPSTREAM_TIMEOUT_MS)

  // 5. 发起上游请求（带 Range 透传）
  const rangeHeader = req.headers.range
  const upstreamHeadersWithRange: Record<string, string> = { ...upstreamHeaders }
  if (rangeHeader) upstreamHeadersWithRange['Range'] = rangeHeader

  let upstreamResp: Response
  try {
    upstreamResp = await fetch(upstreamUrl, {
      method: 'GET',
      headers: upstreamHeadersWithRange,
      redirect: 'follow',
      signal: controller.signal,
    })
  } catch (err) {
    clearTimeout(timeout)
    req.off('close', onClientClose)
    if (abortReason === 'client') return  // 客户端已断开，无需响应
    if (abortReason === 'timeout') {
      return res.status(504).json({ error: 'upstream timeout (5min no data)' })
    }
    return res.status(504).json({ error: 'upstream network error', detail: String(err) })
  }

  // 6. 上游错误处理（含 416 Range Not Satisfiable 透传）
  if (!upstreamResp.ok && upstreamResp.status !== 206 && upstreamResp.status !== 416) {
    const body = await upstreamResp.text().catch(() => '')
    clearTimeout(timeout)
    req.off('close', onClientClose)
    return res.status(502).json({
      error: `GitHub upstream ${upstreamResp.status}`,
      body,
    })
  }

  // 7. 透传响应头
  const contentType = needsBase64Decode
    ? 'application/octet-stream'  // sha 路径强制二进制（上游是 JSON，但我们要返回解码后的二进制）
    : (upstreamResp.headers.get('content-type') ?? 'application/octet-stream')
  const contentLength = needsBase64Decode
    ? undefined  // sha 路径解码后大小变化，不透传原 Content-Length
    : (upstreamResp.headers.get('content-length') ?? undefined)
  const contentRange = upstreamResp.headers.get('content-range') ?? undefined
  const contentDisposition = fileName
    ? `attachment; filename="${fileName}"`
    : (upstreamResp.headers.get('content-disposition') ?? `attachment; filename="${owner}-${repo}.bin"`)

  res.setHeader('Content-Type', contentType)
  if (contentLength) res.setHeader('Content-Length', contentLength)
  if (contentRange) res.setHeader('Content-Range', contentRange)
  res.setHeader('Content-Disposition', contentDisposition)
  res.status(upstreamResp.status === 206 ? 206 : (upstreamResp.status === 416 ? 416 : 200))

  // 8. 流式转发 body（sha 路径需先读 JSON 再 base64 解码）
  try {
    if (needsBase64Decode) {
      // sha 路径：读完整 JSON → 解析 → base64 解码 → 返回二进制
      const jsonBody = await upstreamResp.json() as { content?: string; encoding?: string }
      if (jsonBody.encoding === 'base64' && jsonBody.content) {
        const binaryBuffer = Buffer.from(jsonBody.content, 'base64')
        res.end(binaryBuffer)
      } else {
        res.status(502).end(JSON.stringify({ error: 'unexpected blob response format' }))
      }
    } else if (upstreamResp.body) {
      // 直接流式 pipe
      const reader = (upstreamResp.body as ReadableStream<Uint8Array>).getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (req.aborted) {
          controller.abort()
          break
        }
        res.write(value)
      }
    }
    res.end()
  } catch (err: unknown) {
    // 客户端中断或写入失败，主动 abort 上游
    controller.abort()
    if (err instanceof Error && err.name === 'AbortError') {
      // 已在上方 onClientClose / setTimeout 处理，仅需关闭连接
      try { res.end() } catch {}
      return
    }
    // 非 AbortError：未发送 headers 时返回 500，已发送则直接 end
    if (!res.headersSent) {
      res.status(500).json({ error: `代理失败: ${(err as Error).message}` })
    } else {
      try { res.end() } catch {}
    }
  } finally {
    clearTimeout(timeout)
    req.off('close', onClientClose)
    // 记录调用日志
    const status = res.statusCode && res.statusCode < 400 ? 'ok' : 'error'
    logApiUsage({
      provider: 'github_proxy',
      endpoint: `${type}:${owner}/${repo}`,
      status,
    }).catch(() => {})
  }
})
```

**注册**：`server/src/index.ts` 在 `/api` 路由组下追加 `app.use('/api/github/proxy', githubProxyRouter)`。

> 实现提示：`extractFileName` 当前是 searchApi.ts 的内部函数（L143），实施时需将其改为 `export function extractFileName(...)`，并在 githubProxy.ts 顶部 import。

### 2.3 安全与限流

- **鉴权**：走 `authMiddleware`，未带 SERVER_TOKEN 返回 401
- **速率限制**：复用 `api_usage_log` 表记录每次代理调用（provider=`github_proxy`）；后续可加内存级速率限制（如同 IP 每分钟 10 次）
- **文件大小限制**：不设硬限制（GitHub 仓库 zip 上限 5GB，服务器流式代理不缓存全文件，内存占用恒定）
- **超时**：上游 fetch 5 分钟超时（`UPSTREAM_TIMEOUT_MS`），通过 `AbortController` 实现
- **客户端中断**：`req.on('close')` 检测客户端断开，主动 `controller.abort()` 中止上游 fetch
- **Token 不暴露**：服务器注入 `Authorization: Bearer <key>` 头，客户端只看到 `/api/github/proxy?...`，看不到 GitHub token

### 2.4 错误处理

| 场景 | 响应 |
|------|------|
| SERVER_TOKEN 未配置或错误 | 401 Unauthorized |
| 参数缺失/类型错误 | 400 Bad Request + `{ error: '...' }` |
| GitHub Key 未配置 | 500 + `{ error: 'GitHub API Key not configured' }` |
| GitHub 返回 404 | 502 + `{ error: 'GitHub upstream 404', body: '...' }` |
| GitHub 返回 429 | 502 + `{ error: 'GitHub upstream 429', body: '...' }` |
| GitHub 返回 416 Range Not Satisfiable | 416 透传（含 Content-Range 头） |
| GitHub 返回其他 4xx/5xx | 502 + `{ error: 'GitHub upstream N', body: '...' }` |
| 上游网络错误 | 504 Gateway Timeout + `{ error: 'upstream network error' }` |
| 上游 5 分钟无数据 | 504 + `{ error: 'upstream timeout (5min no data)' }` |
| 客户端中断 | 主动 abort 上游 fetch（无响应，连接已断） |
| sha 路径 JSON 解析失败 | 502 + `{ error: 'unexpected blob response format' }` |

---

## 三、功能 1：GitHub 项目中转下载

### 3.1 数据结构变更

**`GithubSearchMode` 追加**：

```typescript
export type GithubSearchMode =
  | 'search_repos'
  | 'search_code'
  | 'search_users'
  | 'search_issues'
  | 'download_release'
  | 'download_file'
  | 'download_repo_zip'  // 新增
```

**`GithubSearchParams` 追加 `ref`**：

```typescript
export interface GithubSearchParams {
  mode: GithubSearchMode
  query?: string
  owner?: string
  repo?: string
  assetId?: number
  path?: string
  sha?: string
  ref?: string  // 新增：分支/tag/commit，download_repo_zip 时可选，默认 'HEAD'
  page?: number
  perPage?: number
  language?: string
  sort?: string
}
```

**`GithubSearchResult.download` 不变**（复用现有结构）。

### 3.2 实现细节

**文件**：`server/src/utils/searchApi.ts`

新增 `githubDownloadRepoZip` 函数，用 **HEAD 请求手动跟随 302** 拿元数据（避免 GET 下载 body 浪费带宽）：

```typescript
async function githubDownloadRepoZip(
  params: GithubSearchParams,
  key: string,
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
```

**`callGitHub` switch 追加分支**：

```typescript
case 'download_repo_zip':
  return githubDownloadRepoZip(params, key)
```

### 3.3 ToolDefinition 更新

**文件**：`server/src/utils/searchTools.ts`

`githubSearchTool.parameters` 的 `mode` Type.Union 追加 `Type.Literal('download_repo_zip')`，新增 `ref` 参数：

```typescript
mode: Type.Union([
  Type.Literal('search_repos'),
  // ... 6 个原有 ...
  Type.Literal('download_repo_zip'),
]),
ref: Type.Optional(Type.String({ description: '分支/tag/commit，download_repo_zip 时可选，默认 HEAD' })),
```

工具 description 更新：`'GitHub 仓库/代码/用户/Issue 搜索 + 文件/Release/整仓 zip 下载（7 个 mode）'`

### 3.4 验收标准

- `download_repo_zip` mode 调用返回 `{ mode, download: { fileName, size, downloadUrl: '/api/github/proxy?...' } }`
- `downloadUrl` 是服务器代理 URL，不是 codeload.github.com 直链
- 客户端 GET 代理 URL 能下载到真实 zip 文件
- 缺 owner/repo 参数抛错
- 不存在的仓库抛错（404）

---

## 四、功能 2：最新论文实时搜（ArXiv API query）

### 4.1 数据结构变更

**`AcademicSearchParams` 追加 `mode`**：

```typescript
export interface AcademicSearchParams {
  query: string
  limit?: number
  offset?: number
  year?: string
  fieldsOfStudy?: string
  openAccessOnly?: boolean
  mode?: 'relevance' | 'latest'  // 新增：默认 'relevance'（走 S2），'latest' 走 ArXiv
}
```

**`AcademicPaper` 追加 `publicationDate`**：

```typescript
export interface AcademicPaper {
  paperId: string
  title: string
  abstract: string
  authors: string[]
  year: number
  venue: string
  citationCount: number
  openAccessPdf?: { url: string; status: string; license?: string }
  externalIds?: { ArXiv?: string; DOI?: string }
  tldr?: { text: string }
  publicationDate?: string  // 新增：ISO YYYY-MM-DD
}
```

### 4.2 ArXiv API 调用

**文件**：`server/src/utils/searchApi.ts`

新增 `callArxiv` 函数：

```typescript
const ARXIV_API = 'https://export.arxiv.org/api/query'  // 用 HTTPS（内地可达）

export interface ArxivSearchParams {
  query: string
  category?: string     // ArXiv 分类，如 'cs.AI'
  limit?: number        // max_results，默认 10，硬上限 100
  offset?: number       // start，分页
}

export async function callArxiv(params: ArxivSearchParams): Promise<AcademicSearchResult> {
  // ArXiv API 无需 Key

  // 1. 构造 search_query
  const searchQuery = params.category
    ? `all:"${params.query}" AND cat:${params.category}`
    : `all:"${params.query}"`

  const urlParams = new URLSearchParams({
    search_query: searchQuery,
    sortBy: 'submittedDate',
    sortOrder: 'descending',
    start: String(params.offset ?? 0),
    max_results: String(Math.min(params.limit ?? 10, 100)),
  })

  const url = `${ARXIV_API}?${urlParams.toString()}`

  // 2. fetch（带 ArXiv 专用节流，≥3s 间隔，并发安全）
  const xmlText = await arxivThrottledFetch(url)

  // 3. 解析 Atom XML
  const { papers, total } = parseArxivAtomXml(xmlText)

  return { papers, total }
}
```

### 4.3 ArXiv 速率限制节流器（并发安全）

**文件**：`server/src/utils/searchApi.ts`

```typescript
// ArXiv API 节流器：≥3s 间隔，并发安全（预留时间槽模式）
let arxivNextAvailableAt = 0
const ARXIV_MIN_INTERVAL_MS = 3000

async function arxivThrottledFetch(url: string): Promise<string> {
  const now = Date.now()
  const earliest = Math.max(now, arxivNextAvailableAt)
  arxivNextAvailableAt = earliest + ARXIV_MIN_INTERVAL_MS  // 预留时间槽 BEFORE await
  if (earliest > now) {
    await new Promise(resolve => setTimeout(resolve, earliest - now))
  }
  // 不用 fetchWithRetry（其内部 429 重试与节流器语义重叠）
  // 改用裸 fetch + 单次 30s 超时；429 时由节流器在下次调用自然延后
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
```

> 设计说明：`arxivThrottledFetch` 不复用 `fetchWithRetry`，因为 `fetchWithRetry` 的 429 指数退避重试与节流器的"预留时间槽"语义重叠，会导致实际请求间隔不可控。ArXiv 的 429 由节流器统一管控：遇到 429 时本次抛错，下次调用自然延后到 `arxivNextAvailableAt` 之后。

### 4.4 Atom XML 解析（用 fast-xml-parser，不用正则）

**文件**：`server/src/utils/searchApi.ts`

```typescript
import { XMLParser } from 'fast-xml-parser'

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
})

interface ParsedArxivFeed {
  feed?: {
    entry?: any | any[]
    'opensearch:totalResults'?: string | { '@_type'?: string; '#text'?: string }
  }
}

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

    const pdfLink = Array.isArray(entry.link)
      ? entry.link.find((l: any) => l?.['@_rel'] === 'related' && l?.['@_title'] === 'pdf')
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

function extractArxivId(idUrl: string): string {
  // http://arxiv.org/abs/2401.12345v1 → 2401.12345
  const match = idUrl.match(/abs\/([0-9]{4}\.[0-9]{4,5})/)
  return match ? match[1] : ''
}
```

### 4.5 callSemanticScholar 路径补充 publicationDate

**文件**：`server/src/utils/searchApi.ts`

`callSemanticScholar` 的 `fields` 参数追加 `publicationDate`：

```typescript
const searchParams = new URLSearchParams({
  query: params.query,
  fields: 'title,abstract,authors,year,externalIds,openAccessPdf,citationCount,venue,tldr,publicationDate',
  limit: String(Math.min(params.limit ?? 10, 100)),
})
```

在 paper 映射中：

```typescript
if (p.publicationDate) {
  paper.publicationDate = p.publicationDate
}
```

### 4.6 callAcademicSearch 分发

**文件**：`server/src/utils/searchApi.ts`

新增 `callAcademicSearch` 统一分发函数：

> 实现提示：`callAcademicSearch` 必须 `export`，因为 `searchTools.ts` 需要 import 它。

```typescript
export async function callAcademicSearch(
  params: AcademicSearchParams,
  s2Key?: string,
): Promise<AcademicSearchResult> {
  if (params.mode === 'latest') {
    // latest 模式走 ArXiv（无需 S2 Key）
    return callArxiv({
      query: params.query,
      limit: params.limit,
      offset: params.offset,
    })
  }
  // 默认 relevance 走 S2（需要 Key）
  if (!s2Key) throw new Error('未配置 Semantic Scholar API Key，请在设置中填写')
  return callSemanticScholar(params, s2Key)
}
```

### 4.7 ToolDefinition 更新（含 execute Key 检查逻辑修复）

**文件**：`server/src/utils/searchTools.ts`

> 实现提示：在 `searchTools.ts` 顶部 import 列表中追加 `callAcademicSearch`：
> ```typescript
> import { callSemanticScholar, callAcademicSearch } from './searchApi.js'
> ```
> （`callAcademicSearch` 在 searchApi.ts 中已 `export`，见 4.6 节）

`academicSearchTool.parameters` 追加 `mode`：

```typescript
mode: Type.Optional(Type.Union([
  Type.Literal('relevance'),
  Type.Literal('latest'),
], { description: '搜索模式：relevance（默认，S2 相关性）/ latest（ArXiv 按提交日期倒序，实时性最好，无需 S2 Key）' })),
```

`execute` 内按 mode 决定是否要求 S2 Key（修复对抗审查 bug #3）：

```typescript
execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
  const start = Date.now()
  const mode = (params as any).mode ?? 'relevance'

  // latest 模式不需要 S2 Key
  const s2Key = mode === 'latest' ? undefined : await getSearchKey('semanticScholar')
  // relevance 模式下 Key 缺失由 callAcademicSearch 内部抛错

  try {
    const result = await callAcademicSearch(params as AcademicSearchParams, s2Key)
    await logApiUsage({
      provider: mode === 'latest' ? 'arxiv' : 'semanticScholar',
      endpoint: mode === 'latest' ? 'api/query' : 'paper/search',
      latencyMs: Date.now() - start,
      status: 'ok',
    })
    return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    await logApiUsage({
      provider: mode === 'latest' ? 'arxiv' : 'semanticScholar',
      endpoint: mode === 'latest' ? 'api/query' : 'paper/search',
      latencyMs: Date.now() - start,
      status: 'error',
      errorMsg,
    })
    throw err
  }
}
```

工具 description 更新：`'检索学术论文（Semantic Scholar 相关性 / ArXiv 最新提交）'`

### 4.8 验收标准

- `mode: 'latest'` 调用返回 ArXiv 论文列表，`publicationDate` 非空
- 返回结果按 `submittedDate` 倒序（第 1 篇 publicationDate ≥ 第 2 篇）
- `openAccessPdf.url` 是 `https://arxiv.org/pdf/{id}.pdf` 格式
- `externalIds.ArXiv` 填充正确的 ArXiv id
- ArXiv 连续调用间隔 ≥ 3 秒（节流器生效，并发安全）
- `mode: 'latest'` 时 S2 Key 缺失也能工作（不抛"未配置 S2 Key"错误）
- `mode: 'relevance'`（默认）行为与现有 S2 完全一致（无回归）
- S2 路径的 `publicationDate` 字段也填充（如果 S2 返回了）

---

## 五、功能 3：大文件服务器代理（改造现有路径）

### 5.1 download_file 改造

**文件**：`server/src/utils/searchApi.ts`

**path 路径**（修改前 L657-661）：

```typescript
// 修改前：≥1MB 返回 raw.githubusercontent.com 直链
if (size >= ONE_MB) {
  return { mode: 'download_file', download: { fileName, size, downloadUrl } }
}
```

**path 路径**（修改后）：

```typescript
// 修改后：≥1MB 返回服务器代理 URL
if (size >= ONE_MB) {
  const proxyUrl = buildGithubProxyUrl({
    type: 'file',
    owner: params.owner,
    repo: params.repo ?? '',
    path: params.path ?? '',
    fileName,
  })
  return { mode: 'download_file', download: { fileName, size, downloadUrl: proxyUrl } }
}
```

**sha 路径**（修改前 L652-654）：始终返回 `content`（base64）。

**sha 路径**（修改后）：≥1MB 也走代理：

```typescript
if (params.sha) {
  if (size >= ONE_MB) {
    // 大文件 sha 走代理（服务器代理端点会解码 git/blobs 的 base64 后返回二进制）
    const proxyUrl = buildGithubProxyUrl({
      type: 'file',
      owner: params.owner ?? '',
      repo: params.repo ?? '',
      sha: params.sha,
      fileName,
    })
    return { mode: 'download_file', download: { fileName, size, downloadUrl: proxyUrl } }
  }
  // 小文件 sha 仍返回 base64 content（保持现有行为）
  return { mode: 'download_file', download: { fileName, size, content } }
}
```

### 5.2 download_release 改造

**文件**：`server/src/utils/searchApi.ts`

`githubDownloadRelease` 的 assetId 分支（修改前 L576-603）：读 body 到内存检查大小，≥1MB 返回 `response.url`（CDN 直链）。

**修改后**：所有 asset 下载都走服务器代理，**不再读 body 到内存**，只从 `Content-Length` 头拿大小：

```typescript
// 修改后：始终返回服务器代理 URL（asset 一般都 ≥1MB，统一走代理）
// 不再读 arrayBuffer，节省内存
const contentLength = parseInt(response.headers.get('content-length') ?? '0', 10)
const contentDisposition = response.headers.get('content-disposition')
const fileName = contentDisposition
  ? extractFileName(contentDisposition) || `asset-${params.assetId}`
  : `asset-${params.assetId}`

// 主动中断 body 下载（我们只需要元数据）
response.body?.cancel().catch(() => {})

const proxyUrl = buildGithubProxyUrl({
  type: 'asset',
  owner: params.owner ?? '',
  repo: params.repo ?? '',
  assetId: String(params.assetId ?? 0),
  fileName,
})

return {
  mode: 'download_release',
  download: {
    fileName,
    size: contentLength,  // 可能 0（Content-Length 头缺失），客户端按实际下载大小为准
    downloadUrl: proxyUrl,
  },
}
```

> **注**：`size` 可能为 0（Content-Length 头缺失时不报错，客户端按实际下载大小为准）。spec 11.1 验收清单补充此情况。

### 5.3 验收标准

- `download_file` path 路径 ≥1MB：返回 `downloadUrl: '/api/github/proxy?type=file&...'`，不是 `raw.githubusercontent.com`
- `download_file` sha 路径 ≥1MB：返回代理 URL，不是 base64 content
- `download_file` <1MB：保持现有 base64 content 行为不变
- `download_release` assetId 分支：始终返回代理 URL，不读 body 到内存
- `download_release` size 可能为 0（Content-Length 头缺失时不报错）
- 客户端 GET 代理 URL 能下载到真实文件
- Range 请求支持断点续传

---

## 六、代理 URL 构造工具函数

### 6.1 buildGithubProxyUrl

**文件**：`server/src/utils/searchApi.ts`

为解决"客户端如何拼接服务器 base URL"问题（对抗审查 bug #7），新增工具函数 + 环境变量 `SERVER_BASE_URL`：

```typescript
/**
 * 构造 GitHub 代理完整 URL
 * 
 * 服务器返回给客户端的代理 URL 必须是完整 URL（含 scheme + host），
 * 否则客户端（LLM/用户）拿到相对路径 /api/github/proxy?... 无法直接使用。
 * 
 * 通过环境变量 SERVER_BASE_URL 配置服务器对外可达地址，
 * 如 https://living-dashboard.example.com
 * 
 * 开发模式下 SERVER_BASE_URL 未配置时，回退到 http://localhost:${PORT}
 */
function buildGithubProxyUrl(params: {
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
```

### 6.2 环境变量

**`server/.env`** 追加（生产部署时配置）：

```
# 服务器对外可达地址（用于构造 GitHub 代理完整 URL）
# 开发模式留空则用 http://localhost:${PORT}
# 生产部署填实际域名，如 https://living-dashboard.example.com
SERVER_BASE_URL=
```

**`server/src/index.ts`** 启动时打印 `SERVER_BASE_URL` 配置提示。

---

## 七、依赖更新

### 7.1 新增依赖

**`server/package.json`** 追加：

```json
{
  "dependencies": {
    "fast-xml-parser": "^4.4.1"
  }
}
```

`fast-xml-parser` 是纯 JS 实现，无 native 依赖，体积 ~150KB。

### 7.2 无数据库变更

本 Phase 不新增表、不修改 schema。`api_usage_log` 表复用记录代理调用（provider=`github_proxy` / `arxiv`）。

---

## 八、其他文件更新

### 8.1 aiTools.ts 元数据更新

**文件**：`server/src/utils/aiTools.ts`

L58-59 工具元数据 description 同步更新（与 searchTools.ts 保持一致）：

```typescript
// 修改前
{ name: 'academic_search', label: '学术搜索', description: '检索学术论文（Semantic Scholar API），支持开放获取 PDF', category: 'search', canDisable: true },
{ name: 'github_search', label: 'GitHub 搜索', description: 'GitHub 仓库/代码/用户/Issue 搜索 + 文件/Release 下载', category: 'search', canDisable: true },

// 修改后
{ name: 'academic_search', label: '学术搜索', description: '检索学术论文（Semantic Scholar 相关性 / ArXiv 最新提交）', category: 'search', canDisable: true },
{ name: 'github_search', label: 'GitHub 搜索', description: 'GitHub 仓库/代码/用户/Issue 搜索 + 文件/Release/整仓 zip 下载', category: 'search', canDisable: true },
```

### 8.2 piBridge.ts 无需更新

piBridge.ts L930 `...searchTools` 用展开运算符导入，searchTools.ts 的 ToolDefinition 更新会自动生效。customTools 数组本身无需改动。

### 8.3 local_search / web_search 无影响

- `local_search` 路由到客户端执行，与本次 GitHub 代理/ArXiv 改造完全解耦
- `web_search` 调博查 API，与 GitHub/ArXiv 无关

---

## 九、Spec / Roadmap 更新

### 9.1 ai-search-spec.md 更新

**5.x 节追加**：
- 5.6 节：ArXiv API query 集成（mode: 'latest'）
- 5.7 节：ArXiv 节流器（≥3s 间隔，并发安全预留时间槽模式）
- 5.1 节 `AcademicSearchParams` 追加 `mode` 字段
- 5.1 节 `AcademicPaper` 追加 `publicationDate` 字段

**6.x 节追加**：
- 6.2 节端点表追加 `download_repo_zip`（zipball 端点）
- 6.4 节下载策略表更新：大文件改为服务器代理 URL
- 6.6 节（新增）：服务器代理下载端点 `/api/github/proxy`
- 6.7 节（新增）：`SERVER_BASE_URL` 环境变量 + `buildGithubProxyUrl` 工具函数

### 9.2 roadmap_server_v1.md 更新

新增 Phase S10 段落（在 Phase S9 之后），含任务表 + 验收标准。

---

## 十、测试计划

### 10.1 新增测试脚本

**`server/test/search-github-zip-test.ts`**：
- Test 1: `download_repo_zip` 基本调用（microsoft/vscode HEAD）
  - 断言：mode、fileName 非空、size > 0、downloadUrl 以 `/api/github/proxy?type=zip` 开头
- Test 2: `download_repo_zip` 指定 ref（microsoft/vscode 主分支名）
- Test 3: 缺 owner/repo 参数抛错
- Test 4: 不存在的仓库抛错（404）

**`server/test/search-academic-latest-test.ts`**：
- Test 1: `mode: 'latest'` 基本调用（query="large language model"）
  - 断言：papers 数组非空、每篇有 publicationDate、openAccessPdf.url 含 arxiv.org/pdf/、externalIds.ArXiv 非空
- Test 2: 按 submittedDate 倒序断言（papers[0].publicationDate >= papers[1].publicationDate >= ...）
- Test 3: limit 参数生效（limit=5 返回 5 篇）
- Test 4: offset 分页（offset=5 返回第 6-10 篇）
- Test 5: 节流器验证（连续 2 次调用间隔 ≥ 3s）
- Test 6: 节流器并发安全（Promise.all 2 个调用，两个返回间隔 ≥ 3s）
- Test 7: `mode: 'latest'` 时 S2 Key 缺失也能工作
- Test 8: `mode: 'relevance'`（默认）回归确认（走 S2，与现有行为一致）
- Test 9: S2 路径 publicationDate 字段填充

**`server/test/github-proxy-test.ts`**：
- Test 1: 小文件代理（type=file，path=README.md，<1MB）
  - 断言：200 OK、Content-Type 非空、响应体非空
- Test 2: zip 代理（type=zip，owner=microsoft，repo=vscode）
  - 断言：200 OK、Content-Type: application/zip、Content-Length > 0
- Test 3: asset 代理（type=asset，已知 assetId）
- Test 4: sha 代理（type=file，sha=已知 sha）
  - 断言：200 OK、Content-Type: application/octet-stream、响应体是二进制（不是 JSON）
- Test 5: Range 请求（断点续传）
  - 断言：206 Partial Content、Content-Range 头存在
- Test 6: 416 Range Not Satisfiable 透传
- Test 7: 鉴权失败（不带 SERVER_TOKEN 或错误 token）
  - 断言：401（仅在生产模式下，开发模式 SERVER_TOKEN 为空跳过）
- Test 8: 参数缺失（type 缺失）
  - 断言：400
- Test 9: 客户端中断（发起请求后立即断开，服务器应 abort 上游）

### 10.2 回归测试

重新跑 Phase S9 的 3 个测试脚本（`search-web-test.ts` / `search-academic-test.ts` / `search-github-test.ts`），确认无回归：
- web_search：不受影响
- academic_search：`mode: 'relevance'`（默认）行为应与 S2 一致；原有 9 个断言全绿
- github_search：`download_file` <1MB 和 `download_release` 元数据分支不受影响；`download_file` ≥1MB 和 `download_release` assetId 分支行为改变（断言要更新为代理 URL）

---

## 十一、风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| ArXiv API 节流不够被封 IP | 中 | ArXiv 搜索不可用 | 节流器 ≥3s 间隔 + 预留时间槽并发安全 + 429 重试指数退避 |
| 服务器代理被滥用 | 中 | 服务器流量消耗大 | SERVER_TOKEN 鉴权 + 后续加速率限制 |
| 大文件下载占用服务器连接太久 | 中 | 服务器连接池耗尽 | 5 分钟超时 + 客户端中断时 abort 上游 |
| fast-xml-parser 解析 ArXiv XML 失败 | 低 | ArXiv 搜索返回空 | 解析失败时抛错（不静默吞掉），LLM 收到错误提示 |
| GitHub zipball 端点对超大仓库超时 | 低 | 大仓库下载失败 | 5 分钟超时 + 客户端可重试 |
| 客户端不知道服务器 base URL | 中 | 代理 URL 无法直接使用 | `SERVER_BASE_URL` 环境变量 + `buildGithubProxyUrl` 工具函数返回完整 URL |
| sha 路径 base64 解码失败 | 低 | sha 代理返回 502 | 解析失败时返回明确错误 |
| `SERVER_BASE_URL` 未配置 | 中 | 开发模式回退 localhost | 开发模式自动回退 `http://localhost:${PORT}`，生产部署必须配置 |

---

## 十二、实施顺序

1. **共享架构**（功能 3 基础）：实现 `/api/github/proxy` 端点 + 注册路由 + `buildGithubProxyUrl` 工具函数
2. **功能 3**：改造 `download_file` / `download_release` 大文件路径
3. **功能 1**：新增 `download_repo_zip` mode
4. **功能 2**：ArXiv API 集成（独立，可与 1/3 并行）+ `callAcademicSearch` 分发 + execute Key 检查修复
5. **aiTools.ts 元数据更新**
6. **测试**：3 个新测试脚本 + 回归测试（含 github 测试断言更新）
7. **Spec/Roadmap 更新**

---

## 十三、验收清单

### 13.1 功能验收

- [ ] `download_repo_zip` mode 返回完整代理 URL，客户端能下载真实 zip
- [ ] `academic_search` `mode: 'latest'` 返回 ArXiv 论文，按 submittedDate 倒序
- [ ] `academic_search` `mode: 'latest'` 时 S2 Key 缺失也能工作
- [ ] `download_file` path ≥1MB 返回代理 URL，不是 raw.githubusercontent.com
- [ ] `download_file` sha ≥1MB 返回代理 URL，不是 base64 content
- [ ] `download_release` assetId 返回代理 URL，不是 objects.githubusercontent.com
- [ ] `/api/github/proxy` 端点支持 Range 请求（206 + Content-Range）
- [ ] `/api/github/proxy` 端点 416 Range Not Satisfiable 透传
- [ ] `/api/github/proxy` 端点鉴权生效（401）
- [ ] `/api/github/proxy` sha 路径返回二进制（非 JSON），Content-Type: application/octet-stream
- [ ] `/api/github/proxy` 客户端中断时主动 abort 上游 fetch
- [ ] `/api/github/proxy` 上游 5 分钟无数据自动断开（504）
- [ ] ArXiv 节流器 ≥3s 间隔，并发安全（预留时间槽）
- [ ] S2 路径 `publicationDate` 字段填充
- [ ] `download_release` size 可能为 0 时不报错
- [ ] `SERVER_BASE_URL` 配置后代理 URL 是完整 URL

### 13.2 回归验收

- [ ] `academic_search` `mode: 'relevance'`（默认）行为与 S2 一致
- [ ] `download_file` <1MB 仍返回 base64 content
- [ ] Phase S9 的 3 个测试脚本全绿（含 github 测试断言更新）
- [ ] `aiTools.ts` 元数据 description 与 searchTools.ts 一致

### 13.3 文档验收

- [ ] `ai-search-spec.md` 5.x/6.x 节更新
- [ ] `roadmap_server_v1.md` 新增 Phase S10
- [ ] `server/.env.example`（如有）追加 `SERVER_BASE_URL`
- [ ] commit message 清晰

---

## 附录 A：ArXiv API search_query 语法参考

| 前缀 | 含义 | 示例 |
|------|------|------|
| `all:` | 全部字段 | `all:"large language model"` |
| `ti:` | 标题 | `ti:transformer` |
| `abs:` | 摘要 | `abs:attention` |
| `au:` | 作者 | `au:lecun` |
| `cat:` | 分类 | `cat:cs.AI` |
| 布尔 | 组合 | `ti:transformer AND cat:cs.AI` |

ArXiv 分类速查（常用）：
- `cs.AI` 人工智能
- `cs.LG` 机器学习
- `cs.CL` 计算语言学
- `cs.CV` 计算机视觉
- `stat.ML` 统计机器学习
- `eess.SP` 信号处理
- `math.CO` 组合数学
- `physics` 物理

---

## 附录 B：服务器代理 URL 示例（完整 URL）

**zip 下载**：
```
https://your-server.com/api/github/proxy?type=zip&owner=microsoft&repo=vscode&ref=HEAD&fileName=vscode-HEAD.zip
```

**大文件下载（path）**：
```
https://your-server.com/api/github/proxy?type=file&owner=facebook&repo=react&path=packages%2Freact%2Fpackage.json&fileName=package.json
```

**大文件下载（sha）**：
```
https://your-server.com/api/github/proxy?type=file&owner=microsoft&repo=vscode&sha=4f91dc9e256cfdd87e7daee2a6c65c41d0f15382&fileName=README.md
```

**Release asset 下载**：
```
https://your-server.com/api/github/proxy?type=asset&owner=microsoft&repo=vscode&assetId=12345&fileName=vscode-setup.exe
```

---

## 附录 C：对抗审查 v1 发现的 13 项问题修复记录

| # | 问题 | 级别 | 修复方式 |
|---|------|------|---------|
| 1 | 5.2 `size: contentLength \|\| byteLength` 中 `byteLength` 未定义 | bug | 改为 `size: contentLength`，补充"可能为 0"说明 |
| 2 | 2.2 sha 路径代理未解码 base64 | bug | 2.2 伪代码补充 `needsBase64Decode` 分支：解析 JSON + base64 解码 + 返回二进制 |
| 3 | 4.7 `mode='latest'` 时 S2 Key 缺失仍抛错 | bug | 4.7 execute 按 mode 决定是否要求 S2 Key，4.6 `callAcademicSearch` 接受可选 s2Key |
| 4 | 4.3 ArXiv 节流器并发竞态 | bug | 4.3 改为"预留时间槽"模式（`arxivNextAvailableAt` 在 await 前更新） |
| 5 | 2.2 客户端中断处理无实现 | 缺陷 | 2.2 伪代码补充 `req.on('close')` + `AbortController.abort()` |
| 6 | 2.2 上游 fetch 无 5 分钟超时 | 缺陷 | 2.2 伪代码补充 `setTimeout + controller.abort` |
| 7 | 9 代理 URL 客户端拼接机制未定义 | 缺陷 | 新增第六章 `buildGithubProxyUrl` + `SERVER_BASE_URL` 环境变量 |
| 8 | aiTools.ts 元数据未更新 | 缺陷 | 新增 8.1 节明确 aiTools.ts description 同步更新 |
| 9 | 2.1/2.2/3.1 `ref` 字段必填语义不一致 | 补充 | 2.1 参数表 ref 改"否"（默认 HEAD），3.1 注释统一 |
| 10 | 2.4 错误处理表漏掉 416 | 补充 | 2.4 补充 416 透传 + 2.2 伪代码补充 416 处理 |
| 11 | 11.1 验收清单漏项 | 补充 | 13.1 验收清单补充 sha ≥1MB / 节流 / publicationDate / size=0 / SERVER_BASE_URL 等 |
| 12 | 4.4 `extractArxivTotalResults` 正则脆弱 | 补充 | 4.4 改用 `XMLParser` 解析 `opensearch:totalResults`（不再用正则） |
| 13 | 3.2 GET + cancel 浪费带宽 | 补充 | 3.2 改用 HEAD 手动跟随 302（最多 5 次），不支持 HEAD 时降级 Range: bytes=0-0 |

---

## 附录 D：v2 → v3 对抗审查修复记录（12 项）

| # | 问题 | 级别 | 修复方式 |
|---|------|------|---------|
| 1 | 4.7 节 `searchTools.ts` 未说明如何 import `callAcademicSearch` | 中等 | 4.7 节小节开头补充 import 提示块：`import { callSemanticScholar, callAcademicSearch } from './searchApi.js'` |
| 2 | 2.2 节 `githubProxy.ts` 用到的 `extractFileName` 是 searchApi.ts 内部函数（L143，未 export），import 来源未明确 | 中等 | 2.2 节 import 块追加 `import { extractFileName } from '../utils/searchApi.js'`；2.2 节末尾补充实现提示：searchApi.ts 中需将 `extractFileName` 改为 `export function extractFileName(...)` |
| 3 | 3.2 节 HEAD 降级 GET+Range 时 `size` 取值错误：206 响应 `Content-Length` 是 1（Range 字节数）不是总大小，总大小在 `Content-Range: bytes 0-0/TOTAL` 头里 | 中等 | 3.2 节降级路径改为解析 `Content-Range` 头 `/` 后数字作为 size；`Content-Range` 缺失时 size=0（与 5.2 节 release 处理一致） |
| 4 | 4.3 节 `arxivThrottledFetch` 内部用 `fetchWithRetry`，其 429 指数退避重试与节流器"预留时间槽"语义重叠，导致请求间隔不可控 | 中等 | 4.3 节 `arxivThrottledFetch` 改用裸 `fetch` + 单次 30s 超时 + 不重试；429 由节流器统一管控（本次抛错，下次调用自然延后到 `arxivNextAvailableAt` 之后） |
| 5 | 8.1 节"修改前" description 写成 `'检索学术论文（Semantic Scholar API）'`，实际现有代码是 `'检索学术论文（Semantic Scholar API），支持开放获取 PDF'` | 中等 | 8.1 节修改前 description 改为 `'检索学术论文（Semantic Scholar API），支持开放获取 PDF'` |
| 6 | 2.2 节流式转发 catch 块未调用 `res.end()`，连接未正确关闭 | 中等 | 2.2 节 catch 块补充 `try { res.end() } catch {}`，并区分 AbortError（已在上游处理）与其他错误（500 响应） |
| 7 | 2.2 节 `githubProxyRouter.use(authMiddleware)` 与 `/api` 路由组全局挂载重复 | 轻微 | 2.2 节删除 `githubProxyRouter.use(authMiddleware)`，补充鉴权说明注释（子路由自动继承 `/api` 的 `authMiddleware`） |
| 8 | 3.2 节重定向次数耗尽（>=5）未明确分支，错误信息误导 | 轻微 | 3.2 节补充 `if (redirectCount >= 5) throw new Error('GitHub zipball 重定向次数过多（>5），可能存在循环重定向')` |
| 9 | 3.3 节注释 `// ... 5 个原有 ...` 数数错误（实际 6 个：search_repos/search_code/search_users/search_issues/download_release/download_file） | 轻微 | 注释改为 `// ... 6 个原有 ...` |
| 10 | 2.2 节 `fetch()` 返回值多余的 `as unknown as Response` cast（fetch 本身返回 `Promise<Response>`） | 轻微 | 2.2 节删除 `as unknown as Response` cast |
| 11 | 5.1 节 `params.owner ?? ''` 多余兜底（githubDownloadFile L629 已检查 `if (!params.owner || !params.repo)` 抛错，params.owner 一定非空） | 轻微 | 5.1 节 path 路径代理 URL 构造中 `owner: params.owner ?? ''` 改为 `owner: params.owner` |
| 12 | 4.6 节未明确说明 `callAcademicSearch` 必须 export（searchTools.ts 需 import） | 轻微 | 4.6 节函数定义前补充实现提示：`callAcademicSearch` 必须 `export`；确认函数签名是 `export async function callAcademicSearch(...)` |
