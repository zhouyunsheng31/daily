import { Router } from 'express'
import { getPool } from '../db/connection.js'
import {
  getAiSettings,
  getPromptOverrides,
  setSetting,
  clearPromptCache,
  DEFAULT_PROMPTS,
  SETTINGS_KEYS,
} from '../db/aiSettingsStore.js'
import { callLlm, type LlmMessage } from '../utils/llmCaller.js'
import {
  sanitizePromptInput,
  sanitizeApiKey,
  sanitizeModelName,
  sanitizeEndpointUrl,
} from '../utils/sanitize.js'
import { createError } from '../middleware/error.js'

// ============================================================================
// Phase 4：AI 配置 API（spec 3.2 节）
// - GET /api/ai/settings         → 获取 AI 设置（不含 API Key）
// - PUT /api/ai/settings         → 更新 AI 设置（API Key 经此保存到 ai_settings 表）
// - POST /api/ai/test-connection → 测试 API 连接
// - GET /api/ai/prompts          → 获取提示词
// - PUT /api/ai/prompts          → 更新提示词
// - POST /api/ai/prompts/reset   → 恢复默认提示词
// ============================================================================

export const aiSettingsRouter = Router()

// ============================================================================
// 路由
// ============================================================================

// S17.2：模型列表缓存（5 分钟，避免频繁调用 provider）
let modelsCache: {
  data: Array<{ id: string; owned_by?: string }>
  expiresAt: number
  apiKeyHash: string
  cacheKey: string // `${apiKeyHash}:${provider}`，不同 provider 不共享缓存
} | null = null
const MODELS_CACHE_TTL = 5 * 60 * 1000 // 5 分钟

/**
 * 根据 endpoint + model 推断 provider 的 /models 端点
 * - 优先按 endpoint 域名匹配（stepfun/deepseek/openai/anthropic）
 * - Anthropic 不支持 /models，返回 url='' 由调用方返回空列表
 * - 自定义 endpoint：已含 /vN 则直接追加 /models，否则追加 /v1/models
 * - endpoint 为空时按 model 前缀解析 provider（parseModel 逻辑）
 * - 全部缺失则回退到 stepfun 默认
 */
function resolveModelsEndpoint(
  endpoint: string | null | undefined,
  model: string | null | undefined,
): { url: string; provider: string } {
  // 1. 优先根据 endpoint 推断
  if (endpoint) {
    const lower = endpoint.toLowerCase()
    if (lower.includes('stepfun.com')) {
      return { url: 'https://api.stepfun.com/v1/models', provider: 'stepfun' }
    }
    if (lower.includes('deepseek.com')) {
      return { url: 'https://api.deepseek.com/v1/models', provider: 'deepseek' }
    }
    if (lower.includes('openai.com')) {
      return { url: 'https://api.openai.com/v1/models', provider: 'openai' }
    }
    if (lower.includes('anthropic.com')) {
      return { url: '', provider: 'anthropic' } // Anthropic 不支持 /models
    }
    // 自定义 endpoint：构造 /models URL
    const trimmed = endpoint.replace(/\/$/, '')
    // 已含 /v1 或以 /vN 结尾，直接追加 /models
    if (/\/v\d+(?:\/|$)/.test(lower) || /\/v\d+$/.test(lower)) {
      return { url: `${trimmed}/models`, provider: 'custom' }
    }
    // 否则追加 /v1/models
    return { url: `${trimmed}/v1/models`, provider: 'custom' }
  }

  // 2. 根据 model 解析 provider
  if (model) {
    const slashIdx = model.indexOf('/')
    const provider = slashIdx >= 0 ? model.substring(0, slashIdx) : 'stepfun'
    const baseUrls: Record<string, string> = {
      stepfun: 'https://api.stepfun.com/v1/models',
      deepseek: 'https://api.deepseek.com/v1/models',
      openai: 'https://api.openai.com/v1/models',
      anthropic: '',
    }
    return { url: baseUrls[provider] ?? '', provider }
  }

  // 3. 默认 stepfun
  return { url: 'https://api.stepfun.com/v1/models', provider: 'stepfun' }
}

/**
 * POST /api/ai/models
 * 获取可用模型列表（S17.2，S17.7 改为 POST 接受 form apiKey）
 * 根据 settings.endpoint + settings.model 动态选择 provider 的 /models 端点，
 * 带 5 分钟缓存（按 apiKeyHash:provider 隔离）
 *
 * S17.7 修复：API key 解析对称化
 * - 优先读 form body 的 apiKey（用户输入但未保存的场景）
 * - 其次读 DB 的 settings.apiKey
 * - 最后读环境变量 process.env.PI_API_KEY
 */
aiSettingsRouter.post('/models', async (req, res) => {
  try {
    const body = req.body as { apiKey?: string; model?: string; endpoint?: string }
    const settings = await getAiSettings()
    const apiKey = body.apiKey || settings.apiKey || process.env.PI_API_KEY
    if (!apiKey) {
      return res.status(400).json({
        error: 'API key not configured',
        code: 'API_KEY_MISSING',
      })
    }

    // 根据 endpoint + model 推断 provider 和 models URL
    // 优先使用 form body 的 model/endpoint（用户当前表单值），其次用 DB 设置
    const effectiveEndpoint = body.endpoint || settings.endpoint
    const effectiveModel = body.model || settings.model
    const { url: modelsUrl, provider } = resolveModelsEndpoint(effectiveEndpoint, effectiveModel)

    // provider 不支持 /models 端点（如 Anthropic）：返回空列表 + 提示
    if (!modelsUrl) {
      return res.json({
        models: [],
        cached: false,
        source: provider,
        note: '该 provider 不支持模型列表 API，请手动输入模型名',
      })
    }

    // 缓存键：apiKeyHash:provider（不同 provider 不共享缓存）
    const apiKeyHash = apiKey.slice(-8)
    const cacheKey = `${apiKeyHash}:${provider}`
    const now = Date.now()
    if (modelsCache && modelsCache.expiresAt > now && modelsCache.cacheKey === cacheKey) {
      return res.json({
        models: modelsCache.data,
        cached: true,
        source: provider,
      })
    }

    // 调用对应 provider 的 /models 端点
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)
    try {
      const resp = await fetch(modelsUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      })
      clearTimeout(timeout)

      if (!resp.ok) {
        const errorText = await resp.text().catch(() => '')
        let errorKind = 'UPSTREAM_ERROR'
        try {
          const errBody = JSON.parse(errorText)
          if (errBody.error?.type === 'request_params_invalid' || errBody.error?.message?.includes('subscription')) {
            errorKind = 'SUBSCRIPTION_EXPIRED'
          } else if (errBody.error?.type === 'quota_exceeded') {
            errorKind = 'QUOTA_EXCEEDED'
          } else if (resp.status === 401) {
            errorKind = 'API_KEY_INVALID'
          }
        } catch {}
        return res.status(502).json({
          error: `${provider} API 返回 ${resp.status}: ${errorText}`,
          code: errorKind,
        })
      }

      const data = await resp.json()
      const models = (data.data || []).map((m: { id: string; owned_by?: string }) => ({
        id: m.id,
        owned_by: m.owned_by,
      }))

      modelsCache = {
        data: models,
        expiresAt: now + MODELS_CACHE_TTL,
        apiKeyHash,
        cacheKey,
      }

      return res.json({
        models,
        cached: false,
        source: provider,
      })
    } finally {
      clearTimeout(timeout)
    }
  } catch (err) {
    console.error('[aiSettings] POST /models error:', err)
    return res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
      code: 'INTERNAL_ERROR',
    })
  }
})

/**
 * GET /api/ai/settings
 * 获取 AI 设置（不含 API Key，spec 3.2 节）
 */
aiSettingsRouter.get('/settings', async (_req, res, next) => {
  try {
    const settings = await getAiSettings()
    // 不返回 API Key（客户端不持有，spec 3.2 节）
    res.json({
      model: settings.model || process.env.PI_MODEL || 'stepfun/step-3.7-flash',
      endpoint: settings.endpoint || null,
      hasApiKey: !!settings.apiKey || !!process.env.PI_API_KEY,
    })
  } catch (e) { next(e) }
})

/**
 * GET /api/ai/settings/api-key
 * 返回实际的 API Key（仅用于桌面端 safeStorage 同步）
 *
 * 安全考量：此端点仅在本地桌面端使用（server 嵌入在 Electron 中），
 * 不暴露到外网。当 safeStorage 中的 apiKey 丢失/损坏时，用于从后端数据库同步恢复。
 */
aiSettingsRouter.get('/settings/api-key', async (_req, res, next) => {
  try {
    const settings = await getAiSettings()
    const apiKey = settings.apiKey || process.env.PI_API_KEY || ''
    res.json({ apiKey })
  } catch (e) { next(e) }
})

/**
 * PUT /api/ai/settings
 * 更新 AI 设置（API Key 经此保存到 ai_settings 表，spec 3.2 节）
 * 注意：API Key 实际存到 ai_settings 表，piBridge 启动时读取并注入到 authStorage
 */
aiSettingsRouter.put('/settings', async (req, res, next) => {
  try {
    const { model, apiKey, endpoint } = req.body as {
      model?: string
      apiKey?: string
      endpoint?: string
    }

    if (model !== undefined) {
      let sanitized: string
      try { sanitized = sanitizeModelName(model) }
      catch (e) { next(createError(400, 'INVALID_INPUT', `model: ${e instanceof Error ? e.message : String(e)}`)); return }
      await setSetting(SETTINGS_KEYS.MODEL, sanitized)
    }
    if (apiKey !== undefined) {
      // API Key 存到 ai_settings 表（piBridge 启动时读取并注入 authStorage）
      let sanitized: string
      try { sanitized = sanitizeApiKey(apiKey) }
      catch (e) { next(createError(400, 'INVALID_INPUT', `apiKey: ${e instanceof Error ? e.message : String(e)}`)); return }
      await setSetting(SETTINGS_KEYS.API_KEY, sanitized)
    }
    if (endpoint !== undefined) {
      let sanitized: string
      try { sanitized = sanitizeEndpointUrl(endpoint) }
      catch (e) { next(createError(400, 'INVALID_INPUT', `endpoint: ${e instanceof Error ? e.message : String(e)}`)); return }
      await setSetting(SETTINGS_KEYS.ENDPOINT, sanitized)
    }

    // 清除提示词缓存（让下次创建 session 时重新读取设置）
    clearPromptCache()

    res.json({ ok: true })
  } catch (e) { next(e) }
})

/**
 * POST /api/ai/test-connection
 * 测试 API 连接（spec 3.2 节）
 * 实际调用 LLM API 发送 ping 消息，验证 API Key/Endpoint/Model 配置正确
 */
aiSettingsRouter.post('/test-connection', async (req, res, next) => {
  try {
    const { model, apiKey, endpoint } = req.body as {
      model?: string
      apiKey?: string
      endpoint?: string
    }

    // 1. 参数校验（先校验 apiKey 再校验 model：用户更常见的错误是漏填 apiKey）
    const settings = await getAiSettings()
    let effectiveModel: string
    let effectiveApiKey: string
    let effectiveEndpoint: string | undefined

    const rawApiKey = apiKey || settings.apiKey || process.env.PI_API_KEY
    if (!rawApiKey) {
      res.status(400).json({
        ok: false,
        error: 'API key is required',
      })
      return
    }
    try {
      effectiveApiKey = sanitizeApiKey(rawApiKey)
    } catch (err) {
      res.status(400).json({
        ok: false,
        error: `API key is invalid: ${err instanceof Error ? err.message : String(err)}`,
      })
      return
    }

    try {
      effectiveModel = sanitizeModelName(model || settings.model || process.env.PI_MODEL || '')
    } catch (err) {
      res.status(400).json({
        ok: false,
        error: `model is invalid: ${err instanceof Error ? err.message : String(err)}`,
      })
      return
    }

    const rawEndpoint = endpoint || settings.endpoint || process.env.PI_API_ENDPOINT
    if (rawEndpoint) {
      try {
        effectiveEndpoint = sanitizeEndpointUrl(rawEndpoint)
      } catch (err) {
        res.status(400).json({
          ok: false,
          error: `endpoint is invalid: ${err instanceof Error ? err.message : String(err)}`,
        })
        return
      }
    }

    // 2. 调用 LLM API 发送 ping（30 秒超时）
    const messages: LlmMessage[] = [
      { role: 'user', content: 'Reply with the single word: OK' },
    ]

    const startTime = Date.now()
    try {
      const reply = await callLlm(messages, {
        model: effectiveModel,
        apiKey: effectiveApiKey,
        endpoint: effectiveEndpoint,
        maxTokens: 256,
        temperature: 0,
        timeoutMs: 30_000,
      })
      const latencyMs = Date.now() - startTime
      console.log(`[AiSettings] test-connection: model=${effectiveModel}, endpoint=${effectiveEndpoint || 'default'}, latency=${latencyMs}ms, reply=${reply.slice(0, 50)}`)
      res.json({
        ok: true,
        message: `connection test passed (${latencyMs}ms)`,
        latencyMs,
        reply: reply.slice(0, 100),
      })
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)

      // S17.4: 解析 callLlm 错误 message，识别已知错误模式
      let errorKind = 'UNKNOWN'
      // message 格式：LLM API 返回错误 ${status}: ${errorText}
      const llmErrorMatch = errMsg.match(/LLM API 返回错误 (\d+): (.*)/)
      if (llmErrorMatch) {
        const status = llmErrorMatch[1]
        const bodyText = llmErrorMatch[2]
        try {
          const body = JSON.parse(bodyText)
          if (body.error?.type === 'request_params_invalid' || body.error?.message?.includes('subscription')) {
            errorKind = 'SUBSCRIPTION_EXPIRED'
          } else if (body.error?.type === 'quota_exceeded') {
            errorKind = 'QUOTA_EXCEEDED'
          } else if (status === '401') {
            errorKind = 'API_KEY_INVALID'
          } else {
            errorKind = 'UPSTREAM_ERROR'
          }
        } catch {
          if (status === '401') errorKind = 'API_KEY_INVALID'
          else if (status === '400') errorKind = 'SUBSCRIPTION_EXPIRED'
          else errorKind = 'UPSTREAM_ERROR'
        }
      } else if (errMsg.includes('未配置 API key')) {
        errorKind = 'API_KEY_MISSING'
      } else if (errMsg.includes('超时')) {
        errorKind = 'TIMEOUT'
      }

      console.error(`[AiSettings] test-connection failed: model=${effectiveModel}, error=${errMsg}, kind=${errorKind}`)

      // 根据 errorKind 返回语义正确的 HTTP 状态码（保持 errorKind 字段不变）
      const httpStatusByKind: Record<string, number> = {
        SUBSCRIPTION_EXPIRED: 502,
        QUOTA_EXCEEDED: 502,
        API_KEY_INVALID: 401,
        API_KEY_MISSING: 400,
        TIMEOUT: 504,
        UPSTREAM_ERROR: 502,
      }
      const httpStatus = httpStatusByKind[errorKind] ?? 500
      res.status(httpStatus).json({
        ok: false,
        error: errMsg,
        errorKind,
      })
    }
  } catch (e) { next(e) }
})

/**
 * GET /api/ai/prompts
 * 获取提示词（spec 3.2 节）
 */
aiSettingsRouter.get('/prompts', async (_req, res, next) => {
  try {
    const overrides = await getPromptOverrides()
    res.json({
      systemPrompt: overrides.systemPrompt ?? DEFAULT_PROMPTS.systemPrompt,
      canvasPrompt: overrides.canvasPrompt ?? DEFAULT_PROMPTS.canvasPrompt,
      browserPrompt: overrides.browserPrompt ?? DEFAULT_PROMPTS.browserPrompt,
      defaults: DEFAULT_PROMPTS,
    })
  } catch (e) { next(e) }
})

/**
 * PUT /api/ai/prompts
 * 更新提示词（spec 3.2 节）
 */
aiSettingsRouter.put('/prompts', async (req, res, next) => {
  try {
    const { systemPrompt, canvasPrompt, browserPrompt } = req.body as {
      systemPrompt?: string
      canvasPrompt?: string
      browserPrompt?: string
    }

    if (systemPrompt !== undefined) {
      let sanitized: string
      try { sanitized = sanitizePromptInput(systemPrompt) }
      catch (e) { next(createError(400, 'INVALID_INPUT', `systemPrompt: ${e instanceof Error ? e.message : String(e)}`)); return }
      await setSetting(SETTINGS_KEYS.SYSTEM_PROMPT, sanitized)
    }
    if (canvasPrompt !== undefined) {
      let sanitized: string
      try { sanitized = sanitizePromptInput(canvasPrompt) }
      catch (e) { next(createError(400, 'INVALID_INPUT', `canvasPrompt: ${e instanceof Error ? e.message : String(e)}`)); return }
      await setSetting(SETTINGS_KEYS.CANVAS_PROMPT, sanitized)
    }
    if (browserPrompt !== undefined) {
      let sanitized: string
      try { sanitized = sanitizePromptInput(browserPrompt) }
      catch (e) { next(createError(400, 'INVALID_INPUT', `browserPrompt: ${e instanceof Error ? e.message : String(e)}`)); return }
      await setSetting(SETTINGS_KEYS.BROWSER_PROMPT, sanitized)
    }

    // 清除提示词缓存
    clearPromptCache()

    res.json({ ok: true })
  } catch (e) { next(e) }
})

/**
 * POST /api/ai/prompts/reset
 * 恢复默认提示词（spec 3.2 节）
 */
aiSettingsRouter.post('/prompts/reset', async (_req, res, next) => {
  try {
    // 删除提示词覆盖，让 piBridge 回退到默认值
    await getPool().query(
      `DELETE FROM ai_settings WHERE key IN ($1, $2, $3)`,
      [SETTINGS_KEYS.SYSTEM_PROMPT, SETTINGS_KEYS.CANVAS_PROMPT, SETTINGS_KEYS.BROWSER_PROMPT],
    )

    // 清除提示词缓存
    clearPromptCache()

    res.json({
      ok: true,
      defaults: DEFAULT_PROMPTS,
    })
  } catch (e) { next(e) }
})
