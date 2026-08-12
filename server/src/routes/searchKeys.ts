import { Router } from 'express'
import {
  getSearchKey,
  getSearchKeyStatus,
  setSearchKey,
  deleteSearchKey,
  type SearchProvider,
} from '../db/aiSettingsStore.js'
import { createError } from '../middleware/error.js'
import { logApiUsage } from '../db/apiUsageLog.js'
import { sanitizeApiKey } from '../utils/sanitize.js'

// ============================================================================
// Phase S9：搜索引擎 Key 管理 API（spec 8.4 节）
// - GET    /api/search/keys             → 列出所有 provider 的 Key 状态
// - GET    /api/search/keys/:provider   → 单个 provider 的 Key 状态
// - PUT    /api/search/keys/:provider   → 更新 Key（body: {key: string}）
// - DELETE /api/search/keys/:provider   → 删除 Key
// - POST   /api/search/keys/:provider/test → 测试 Key 是否有效
// ============================================================================

export const searchKeysRouter = Router()

const VALID_PROVIDERS: SearchProvider[] = ['metaso', 'github']
const PROVIDER_SET = new Set<string>(VALID_PROVIDERS)

const PROVIDER_DISPLAY_NAMES: Record<SearchProvider, string> = {
  metaso: '秘塔搜索',
  github: 'GitHub',
}

function isValidProvider(p: string): p is SearchProvider {
  return PROVIDER_SET.has(p)
}

// ============================================================================
// 路由
// ============================================================================

/**
 * GET /api/search/keys
 * 列出所有 provider 的 Key 状态（不返回明文 Key，spec 8.4 节）
 */
searchKeysRouter.get('/', async (_req, res, next) => {
  try {
    const providers = await Promise.all(
      VALID_PROVIDERS.map(async (provider) => {
        const status = await getSearchKeyStatus(provider)
        return { provider, ...status }
      }),
    )
    res.json({ providers })
  } catch (e) { next(e) }
})

/**
 * GET /api/search/keys/:provider
 * 获取单个 provider 的 Key 状态（不返回明文 Key，spec 8.4 节）
 */
searchKeysRouter.get('/:provider', async (req, res, next) => {
  try {
    const provider = req.params.provider
    if (!isValidProvider(provider)) {
      throw createError(400, 'INVALID_PROVIDER', `Unknown provider: ${provider}`)
    }
    const status = await getSearchKeyStatus(provider)
    res.json({ provider, ...status })
  } catch (e) { next(e) }
})

/**
 * PUT /api/search/keys/:provider
 * 更新 Key（spec 8.4 节）
 * body: { key: string }
 */
searchKeysRouter.put('/:provider', async (req, res, next) => {
  try {
    const provider = req.params.provider
    if (!isValidProvider(provider)) {
      throw createError(400, 'INVALID_PROVIDER', `Unknown provider: ${provider}`)
    }

    const { key } = (req.body || {}) as { key?: string }
    if (typeof key !== 'string') {
      throw createError(400, 'INVALID_REQUEST', 'key is required and must be a string')
    }

    let sanitized: string
    try {
      sanitized = sanitizeApiKey(key)
    } catch (e) {
      throw createError(400, 'INVALID_INPUT', `key: ${e instanceof Error ? e.message : String(e)}`)
    }

    const updatedAt = await setSearchKey(provider, sanitized)
    res.json({ ok: true, provider, updatedAt })
  } catch (e) { next(e) }
})

/**
 * DELETE /api/search/keys/:provider
 * 删除 Key（spec 8.4 节）
 */
searchKeysRouter.delete('/:provider', async (req, res, next) => {
  try {
    const provider = req.params.provider
    if (!isValidProvider(provider)) {
      throw createError(400, 'INVALID_PROVIDER', `Unknown provider: ${provider}`)
    }
    await deleteSearchKey(provider)
    res.json({ ok: true, provider })
  } catch (e) { next(e) }
})

/**
 * POST /api/search/keys/:provider/test
 * 测试 Key 是否有效（spec 8.4 节）
 * body: { key?: string }（可选，不传则用已存 Key）
 */
searchKeysRouter.post('/:provider/test', async (req, res, next) => {
  try {
    const provider = req.params.provider
    if (!isValidProvider(provider)) {
      throw createError(400, 'INVALID_PROVIDER', `Unknown provider: ${provider}`)
    }

    // 获取 Key（优先 body，其次 DB）
    const { key: bodyKey } = (req.body || {}) as { key?: string }
    let key: string | null = null
    if (typeof bodyKey === 'string' && bodyKey.length > 0) {
      key = bodyKey
    } else {
      key = await getSearchKey(provider)
    }

    if (!key) {
      res.json({
        ok: false,
        provider,
        error: `未配置 ${PROVIDER_DISPLAY_NAMES[provider]} API Key`,
      })
      return
    }

    // 调用 provider 特定的测试逻辑
    const result = await testSearchKey(provider, key)

    // 记录 API 调用（无论成功失败）
    await logApiUsage({
      provider,
      endpoint: getTestEndpoint(provider),
      latencyMs: result.latencyMs,
      status: result.ok ? 'ok' : 'error',
      errorMsg: result.error,
    })

    res.json({ ...result, provider })
  } catch (e) { next(e) }
})

// ============================================================================
// Key 测试实现（spec 8.4 节）
// ============================================================================

interface TestResult {
  ok: boolean
  latencyMs?: number
  error?: string
}

function getTestEndpoint(provider: SearchProvider): string {
  switch (provider) {
    case 'metaso': return 'web-search'
    case 'github': return 'rate-limit'
  }
}

async function testSearchKey(provider: SearchProvider, key: string): Promise<TestResult> {
  switch (provider) {
    case 'metaso': return testMetasoKey(key)
    case 'github': return testGitHubKey(key)
  }
}

/** 秘塔搜索：POST /api/v1/search，成功条件 HTTP 200 */
async function testMetasoKey(key: string): Promise<TestResult> {
  const start = Date.now()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    const response = await fetch('https://metaso.cn/api/v1/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
        'Accept': 'application/json',
      },
      body: JSON.stringify({ q: 'test', scope: 'webpage', size: '1', includeSummary: false, includeRawContent: false, conciseSnippet: false }),
      signal: controller.signal,
    })
    const latencyMs = Date.now() - start
    if (response.status === 200) {
      return { ok: true, latencyMs }
    }
    const text = await response.text().catch(() => '')
    return { ok: false, latencyMs, error: `HTTP ${response.status}: ${text.slice(0, 200)}` }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, error: '请求超时（10s）' }
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    clearTimeout(timeout)
  }
}

/** GitHub：GET /rate_limit，成功条件 HTTP 200 且有 resources.core.limit */
async function testGitHubKey(key: string): Promise<TestResult> {
  const start = Date.now()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    const response = await fetch('https://api.github.com/rate_limit', {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${key}` },
      signal: controller.signal,
    })
    const latencyMs = Date.now() - start
    if (response.status !== 200) {
      const text = await response.text().catch(() => '')
      return { ok: false, latencyMs, error: `HTTP ${response.status}: ${text.slice(0, 200)}` }
    }
    const data = await response.json() as { resources?: { core?: { limit?: unknown } } }
    if (data?.resources?.core?.limit === undefined) {
      return { ok: false, latencyMs, error: '响应缺少 resources.core.limit 字段' }
    }
    return { ok: true, latencyMs }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, error: '请求超时（10s）' }
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    clearTimeout(timeout)
  }
}
