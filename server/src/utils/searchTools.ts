// ============================================================================
// Phase S9：搜索工具定义（spec 2.4 节）
// 3 个服务器端工具：web_search / academic_search / github_search
// execute 内部直接调用外部 API（不路由到客户端），并记录 logApiUsage
// local_search 工具定义在 piBridge.ts 中（需路由到客户端，故与 WS 路由同文件）
// ============================================================================

import { Type } from 'typebox'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import {
  callMetaso,
  callMetasoReader,
  callArxiv,
  callGitHub,
  type WebSearchParams,
  type MetasoSearchScope,
  type ArxivSearchParams,
  type GithubSearchParams,
} from './searchApi.js'
import { getSearchKey } from '../db/aiSettingsStore.js'
import { logApiUsage } from '../db/apiUsageLog.js'

// ---------------------------------------------------------------------------
// 1. web_search — 秘塔 AI 搜索（2026-08-05 支持学术/图片等 scope）
// ---------------------------------------------------------------------------

export const webSearchTool: ToolDefinition = {
  name: 'web_search',
  label: '网页搜索',
  description: '联网搜索（秘塔 AI 搜索，metaso.cn）。scope 可切学术（scholar，搜论文）/图片（image）/文库/视频/播客。返回带摘要的来源列表，包含链接；需要打开某个链接看全文时用 read_webpage。',
  parameters: Type.Object({
    query: Type.String({ description: '搜索关键词' }),
    count: Type.Optional(Type.Number({ description: '返回条数，默认 10，最大 20' })),
    scope: Type.Optional(Type.Union(
      [
        Type.Literal('webpage'),
        Type.Literal('document'),
        Type.Literal('scholar'),
        Type.Literal('image'),
        Type.Literal('video'),
        Type.Literal('podcast'),
      ],
      { description: '搜索范围：webpage 网页（默认）/ scholar 学术论文 / image 图片 / document 文库 / video 视频 / podcast 播客' },
    )),
  }),
  execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
    const key = await getSearchKey('metaso')
    if (!key) throw new Error('未配置秘塔搜索 API Key，请在设置中填写（metaso.cn 获取）')
    const start = Date.now()
    try {
      const result = await callMetaso(params as WebSearchParams, key)
      await logApiUsage({
        provider: 'metaso',
        endpoint: 'web-search',
        latencyMs: Date.now() - start,
        status: 'ok',
        creditsConsumed: result._credits,  // 秘塔 credits 字段（spec 2.7.5 节）
      })
      // 返回给客户端前移除 _credits 内部字段
      const { _credits, ...clientResult } = result
      return { content: [{ type: 'text', text: JSON.stringify(clientResult) }], details: {} }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      await logApiUsage({
        provider: 'metaso',
        endpoint: 'web-search',
        latencyMs: Date.now() - start,
        status: 'error',
        errorMsg: errMsg,
      })
      throw err
    }
  },
}

// ---------------------------------------------------------------------------
// 1b. read_webpage — 秘塔读取网页（2026-08-05）
// 「打开指定网页 → 看到网页全文（含链接）→ 继续打开里面的网页」多级跳转
// ---------------------------------------------------------------------------

export const readWebpageTool: ToolDefinition = {
  name: 'read_webpage',
  label: '读取网页',
  description: '读取指定网页的完整内容（markdown 全文，含正文与链接）。当 web_search 找到的链接需要看全文、或用户给出具体网址要求打开时调用；返回的正文里通常带链接，可继续 read_webpage 打开里面的网页逐级深入。',
  parameters: Type.Object({
    url: Type.String({ description: '要读取的网页完整 URL（http/https）' }),
  }),
  execute: async (_toolCallId, params: { url: string }, _signal, _onUpdate, _ctx) => {
    const key = await getSearchKey('metaso')
    if (!key) throw new Error('未配置秘塔搜索 API Key，请在设置中填写（metaso.cn 获取）')
    const url = String(params.url ?? '').trim()
    if (!/^https?:\/\//i.test(url)) throw new Error('url 必须是 http/https 链接')
    const start = Date.now()
    try {
      const result = await callMetasoReader(url, key)
      await logApiUsage({
        provider: 'metaso',
        endpoint: 'web-reader',
        latencyMs: Date.now() - start,
        status: 'ok',
        creditsConsumed: result._credits,
      })
      const { _credits, ...clientResult } = result
      // markdown 过长截断（保留 8k 字符，防止撑爆上下文）
      if (clientResult.markdown && clientResult.markdown.length > 8000) {
        clientResult.markdown = clientResult.markdown.slice(0, 8000) + '\n\n…（内容过长已截断，可针对具体段落再次提问）'
      }
      return { content: [{ type: 'text', text: JSON.stringify(clientResult) }], details: {} }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      await logApiUsage({
        provider: 'metaso',
        endpoint: 'web-reader',
        latencyMs: Date.now() - start,
        status: 'error',
        errorMsg: errMsg,
      })
      throw err
    }
  },
}

// ---------------------------------------------------------------------------
// 2. academic_search — ArXiv 学术搜索（spec 3 节：移除 S2，仅保留 ArXiv）
// ---------------------------------------------------------------------------

export const academicSearchTool: ToolDefinition = {
  name: 'academic_search',
  label: '学术搜索',
  description: '检索 ArXiv 学术论文（标题/摘要/PDF）。默认按**相关度**排序（找特定论文/官方报告用精确关键词如 "DeepSeek-V4" 即可命中）；要最新提交的论文再传 sortBy="submittedDate"。支持分类过滤（category 如 cs.AI/cs.LG）。',
  parameters: Type.Object({
    query: Type.String({ description: '搜索关键词（精确全名效果最好，如 "DeepSeek-V4"、"Transformer"）' }),
    limit: Type.Optional(Type.Number({ description: '返回条数，默认 10，最大 100' })),
    offset: Type.Optional(Type.Number({ description: '偏移量，用于分页' })),
    category: Type.Optional(Type.String({
      description: 'ArXiv 分类过滤，如 cs.AI / cs.LG / cs.CL / stat.ML；不传则全分类搜索',
    })),
    sortBy: Type.Optional(Type.Union(
      [
        Type.Literal('relevance'),
        Type.Literal('lastUpdatedDate'),
        Type.Literal('submittedDate'),
      ],
      { description: '排序方式：relevance 相关度（默认，找特定论文用）/ lastUpdatedDate / submittedDate（找最新提交用）' },
    )),
    sortOrder: Type.Optional(Type.Union(
      [Type.Literal('ascending'), Type.Literal('descending')],
      { description: '排序方向，默认 descending' },
    )),
  }),
  execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
    const start = Date.now()
    try {
      // 直接调 callArxiv（无需 Key，spec 3.7 节）
      const result = await callArxiv(params as ArxivSearchParams)
      await logApiUsage({
        provider: 'arxiv',
        endpoint: 'api/query',
        latencyMs: Date.now() - start,
        status: 'ok',
      })
      return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      await logApiUsage({
        provider: 'arxiv',
        endpoint: 'api/query',
        latencyMs: Date.now() - start,
        status: 'error',
        errorMsg: errMsg,
      })
      throw err
    }
  },
}

// ---------------------------------------------------------------------------
// 3. github_search — GitHub 搜索/下载（7 个 mode，Phase S10 追加 download_repo_zip）
// ---------------------------------------------------------------------------

export const githubSearchTool: ToolDefinition = {
  name: 'github_search',
  label: 'GitHub 搜索',
  description: 'GitHub 仓库/代码/用户/Issue 搜索 + 文件/Release/整仓 zip 下载（7 个 mode）',
  parameters: Type.Object({
    mode: Type.Union(
      [
        Type.Literal('search_repos'),
        Type.Literal('search_code'),
        Type.Literal('search_users'),
        Type.Literal('search_issues'),
        Type.Literal('download_release'),
        Type.Literal('download_file'),
        Type.Literal('download_repo_zip'),
      ],
      { description: '操作模式：search_repos/search_code/search_users/search_issues/download_release/download_file/download_repo_zip' },
    ),
    query: Type.Optional(Type.String({ description: '搜索关键词（search_* 模式必填）' })),
    owner: Type.Optional(Type.String({ description: '仓库 owner（download_* 模式必填）' })),
    repo: Type.Optional(Type.String({ description: '仓库名（download_* 模式必填）' })),
    assetId: Type.Optional(Type.Number({ description: 'Release 资产 ID（download_release 模式下载具体资产时使用）' })),
    path: Type.Optional(Type.String({ description: '文件路径（download_file 模式）' })),
    sha: Type.Optional(Type.String({ description: '文件 blob SHA（download_file 模式）' })),
    ref: Type.Optional(Type.String({ description: '分支/tag/commit，download_repo_zip 时可选，默认 HEAD' })),
    page: Type.Optional(Type.Number({ description: '页码，默认 1（search_* 模式）' })),
    perPage: Type.Optional(Type.Number({ description: '每页条数，默认 30（search_* 模式）' })),
    language: Type.Optional(Type.String({ description: '语言过滤（search_code 模式）' })),
    sort: Type.Optional(Type.String({ description: '排序字段（search_repos 模式）' })),
  }),
  execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
    // GitHub API 可选 token：无 token 时也能搜索，但限速 60 req/hour
    const key = (await getSearchKey('github')) ?? undefined
    const start = Date.now()
    const githubParams = params as GithubSearchParams
    // endpoint 根据模式动态命名（如 'search-repos'、'download-file'）
    const endpoint = githubParams.mode.replace(/_/g, '-')
    try {
      const result = await callGitHub(githubParams, key)
      await logApiUsage({
        provider: 'github',
        endpoint,
        latencyMs: Date.now() - start,
        status: 'ok',
      })
      return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      await logApiUsage({
        provider: 'github',
        endpoint,
        latencyMs: Date.now() - start,
        status: 'error',
        errorMsg: errMsg,
      })
      throw err
    }
  },
}

// ---------------------------------------------------------------------------
// 导出汇总
// ---------------------------------------------------------------------------

export const searchTools: ToolDefinition[] = [
  webSearchTool,
  readWebpageTool,
  academicSearchTool,
  githubSearchTool,
]
