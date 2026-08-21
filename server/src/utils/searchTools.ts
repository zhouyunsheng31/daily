// ============================================================================
// 搜索工具定义（2026-08-17 供应商替换：秘塔 + GitHub → Exa + ArXiv）
// - web_search        通用网页搜索（Exa /search，语义 + AI 摘要）
// - read_webpage      读取指定网页全文（Exa /contents 抓正文）
// - academic_search   学术搜索（ArXiv，保留，免费）
// - exa_find_similar  相似内容检索（Exa /findSimilar，唯一能力）
// execute 内部直接调用外部 API（不路由到客户端），并记录 logApiUsage
// local_search 工具定义在 piBridge.ts 中（需路由到客户端，故与 WS 路由同文件）
// ============================================================================

import { Type } from 'typebox'
import { AsyncLocalStorage } from 'node:async_hooks'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import {
  callExaSearch,
  callExaContents,
  callExaFindSimilar,
  type ExaSearchParams,
  type ExaSearchCategory,
} from './searchApiExa.js'
import { callArxiv, type ArxivSearchParams } from './searchApi.js'
import { getSearchKey } from '../db/aiSettingsStore.js'
import { logApiUsage } from '../db/apiUsageLog.js'

// ============================================================================
// 2026-08-17 搜索 API 状态可视化：调用方用户上下文
// 通过 AsyncLocalStorage 传递调用方身份（webOS 会话 = principal.key；
// 画布/面板会话 = panel:<panelId>），使搜索工具落库时能记录 user_key。
// piBridge.ts 在 session.prompt 外层设置该上下文；无上下文时 user_key 为 NULL。
// ============================================================================

const searchUserStorage = new AsyncLocalStorage<string | null>()

/** 在搜索用户上下文中执行 fn（scope = principal.key 或 panel:<panelId>） */
export function withSearchUser<T>(scope: string, fn: () => Promise<T>): Promise<T> {
  return searchUserStorage.run(scope, fn)
}

/** 获取当前异步上下文中的调用方标识（无上下文返回 null） */
export function getSearchUserKey(): string | null {
  return searchUserStorage.getStore() ?? null
}

// ---------------------------------------------------------------------------
// 1. web_search — Exa 语义搜索（2026-08-17，替换秘塔）
// 支持分类过滤（research paper 学术论文 / news 新闻 / github 仓库等）
// ---------------------------------------------------------------------------

const EXA_CATEGORIES = [
  'research paper',
  'company',
  'people',
  'dataset',
  'github',
  'news',
  'pdf',
  'patent',
  'financial report',
] as const

export const webSearchTool: ToolDefinition = {
  name: 'web_search',
  label: '网页搜索',
  description: '联网搜索（Exa 神经网络语义搜索，api.exa.ai）。用自然语言或关键词检索网页/学术论文/新闻/公司/GitHub 等内容，返回来源列表（标题/URL/日期/作者/AI 摘要）。支持 category 分类（research paper 学术论文 / news 新闻 / github 仓库 / company 公司等）、发布时段过滤。查论文用 category="research paper"。需要打开某链接看全文时用 read_webpage。',
  parameters: Type.Object({
    query: Type.String({ description: '搜索查询（自然语言或关键词，语义理解佳）' }),
    count: Type.Optional(Type.Number({ description: '返回条数，默认 5，最大 10' })),
    category: Type.Optional(Type.Union(
      [...EXA_CATEGORIES.map((c) => Type.Literal(c))],
      { description: '分类过滤：research paper 学术论文 / news 新闻 / github 仓库 / company 公司 / people 人物 / dataset 数据集 / pdf 文档等' },
    )),
    startPublishedDate: Type.Optional(Type.String({ description: '起始发布日 YYYY-MM-DD（可选，限定时间段）' })),
    endPublishedDate: Type.Optional(Type.String({ description: '结束发布日 YYYY-MM-DD（可选）' })),
  }),
  execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
    const p = params as {
      query?: string
      count?: number
      category?: ExaSearchCategory
      startPublishedDate?: string
      endPublishedDate?: string
    }
    const key = await getSearchKey('exa')
    if (!key) throw new Error('未配置 Exa API Key，请在设置中填写（EXA_API_KEY，exa.ai 获取）')
    const start = Date.now()
    try {
      const exaParams: ExaSearchParams = { query: String(p.query ?? '') }
      if (p.count != null) exaParams.numResults = Math.min(Number(p.count), 10)
      if (p.category) exaParams.category = p.category
      if (p.startPublishedDate) exaParams.startPublishedDate = String(p.startPublishedDate)
      if (p.endPublishedDate) exaParams.endPublishedDate = String(p.endPublishedDate)
      const result = await callExaSearch(exaParams, key)
      await logApiUsage({
        provider: 'exa',
        endpoint: 'search',
        latencyMs: Date.now() - start,
        status: 'ok',
        creditsConsumed: result.costUsd !== undefined ? Math.round(result.costUsd * 100 * 100) : undefined,  // USD→分（近似，用于成本观测）
        userKey: getSearchUserKey(),
        query: exaParams.query,
        tool: 'web_search',
      })
      return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      await logApiUsage({
        provider: 'exa',
        endpoint: 'search',
        latencyMs: Date.now() - start,
        status: 'error',
        errorMsg: errMsg,
        userKey: getSearchUserKey(),
        query: String(p.query ?? ''),
        tool: 'web_search',
      })
      throw err
    }
  },
}

// ---------------------------------------------------------------------------
// 2. read_webpage — Exa 读取网页（2026-08-17，替换秘塔 reader）
// 按 URL 抓取正文（markdown 风格文本），支持一次多个 URL
// ---------------------------------------------------------------------------

export const readWebpageTool: ToolDefinition = {
  name: 'read_webpage',
  label: '读取网页',
  description: '读取指定网页的完整内容（Exa 按 URL 抓取正文文本）。当 web_search 找到链接需要看全文、或用户给出具体网址要求打开时调用；支持一次传多个 URL 批量抓取。',
  parameters: Type.Object({
    urls: Type.Array(Type.String(), { description: '要读取的网页 URL 列表（1-5 个；单 URL 传长度为 1 的数组）' }),
    maxChars: Type.Optional(Type.Number({ description: '每页最大字符数，默认 8000' })),
  }),
  execute: async (_toolCallId, params: { urls: string[]; maxChars?: number }, _signal, _onUpdate, _ctx) => {
    const key = await getSearchKey('exa')
    if (!key) throw new Error('未配置 Exa API Key，请在设置中填写（EXA_API_KEY，exa.ai 获取）')
    const urls = (Array.isArray(params.urls) ? params.urls : [params.urls]).map(String).slice(0, 5)
    if (urls.length === 0) throw new Error('urls 不能为空')
    for (const u of urls) {
      if (!/^https?:\/\//i.test(u)) throw new Error(`不是合法的 http/https 链接: ${u.slice(0, 80)}`)
    }
    const start = Date.now()
    try {
      const result = await callExaContents(urls, key, params.maxChars ?? 8000)
      await logApiUsage({
        provider: 'exa',
        endpoint: 'contents',
        latencyMs: Date.now() - start,
        status: 'ok',
        creditsConsumed: result.costUsd !== undefined ? Math.round(result.costUsd * 100 * 100) : undefined,
        userKey: getSearchUserKey(),
        query: urls.join(' | ').slice(0, 500),
        tool: 'read_webpage',
      })
      // 文本过长截断（每页保留 8k 字符，防止撑爆上下文）
      for (const r of result.results) {
        if (r.text && r.text.length > 8000) {
          r.text = r.text.slice(0, 8000) + '\n\n…（内容过长已截断，可针对具体段落再次提问）'
        }
      }
      return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      await logApiUsage({
        provider: 'exa',
        endpoint: 'contents',
        latencyMs: Date.now() - start,
        status: 'error',
        errorMsg: errMsg,
        userKey: getSearchUserKey(),
        query: urls.join(' | ').slice(0, 500),
        tool: 'read_webpage',
      })
      throw err
    }
  },
}

// ---------------------------------------------------------------------------
// 3. academic_search — ArXiv 学术搜索（保留，spec 3 节：仅 ArXiv）
// ---------------------------------------------------------------------------

export const academicSearchTool: ToolDefinition = {
  name: 'academic_search',
  label: '学术搜索',
  description: '检索 ArXiv 学术论文（标题/摘要/PDF）。默认按相关度排序；要最新提交的论文再传 sortBy="submittedDate"。支持分类过滤（category 如 cs.AI/cs.LG）。',
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
        userKey: getSearchUserKey(),
        query: (params as ArxivSearchParams).query ?? null,
        tool: 'academic_search',
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
        userKey: getSearchUserKey(),
        query: (params as ArxivSearchParams).query ?? null,
        tool: 'academic_search',
      })
      throw err
    }
  },
}

// ---------------------------------------------------------------------------
// 4. exa_find_similar — Exa 相似内容（2026-08-17 新增，Exa 独有能力）
// 按一个已知 URL 找语义相似的其他内容（找相似论文/竞品文/相关文档）
// ---------------------------------------------------------------------------

export const exaFindSimilarTool: ToolDefinition = {
  name: 'exa_find_similar',
  label: '相似内容检索',
  description: '根据一个已知 URL 找到与它语义相似的其他网页/文章/论文（Exa /findSimilar）。适合：找相似论文、竞品文章、同主题文档扩展。',
  parameters: Type.Object({
    url: Type.String({ description: '已知内容 URL（如某论文/文章/仓库地址）' }),
    count: Type.Optional(Type.Number({ description: '返回条数，默认 5，最大 10' })),
  }),
  execute: async (_toolCallId, params: { url: string; count?: number }, _signal, _onUpdate, _ctx) => {
    const key = await getSearchKey('exa')
    if (!key) throw new Error('未配置 Exa API Key，请在设置中填写（EXA_API_KEY，exa.ai 获取）')
    const url = String(params.url ?? '').trim()
    if (!/^https?:\/\//i.test(url)) throw new Error('url 必须是 http/https 链接')
    const start = Date.now()
    try {
      const result = await callExaFindSimilar(url, key, params.count ?? 5)
      await logApiUsage({
        provider: 'exa',
        endpoint: 'findSimilar',
        latencyMs: Date.now() - start,
        status: 'ok',
        creditsConsumed: result.costUsd !== undefined ? Math.round(result.costUsd * 100 * 100) : undefined,
        userKey: getSearchUserKey(),
        query: url,
        tool: 'exa_find_similar',
      })
      return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      await logApiUsage({
        provider: 'exa',
        endpoint: 'findSimilar',
        latencyMs: Date.now() - start,
        status: 'error',
        errorMsg: errMsg,
        userKey: getSearchUserKey(),
        query: url,
        tool: 'exa_find_similar',
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
  exaFindSimilarTool,
]