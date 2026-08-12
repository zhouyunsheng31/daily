import { Router } from 'express'
import { randomUUID } from 'crypto'
import { getPool } from '../db/connection.js'
import { createError } from '../middleware/error.js'
import { requireAdmin } from '../middleware/auth.js'
import type { UserRole } from '../utils/jwt.js'
import { setSetting, clearPromptCache, SETTINGS_KEYS } from '../db/aiSettingsStore.js'
import {
  sanitizeApiKey,
  sanitizeModelName,
  sanitizeEndpointUrl,
} from '../utils/sanitize.js'

export const adminRouter = Router()

// 所有 admin 路由都需要 admin 权限
adminRouter.use(requireAdmin)

// ============================================================================
// 用户管理 API（仅 admin）
// ============================================================================

interface UserRow {
  id: string
  username: string
  email: string
  password_hash: string
  role: string
  is_banned: boolean | number
  created_at: number
  last_login_at: number | null
}

function toPublicUser(row: UserRow) {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    role: row.role as UserRole,
    isBanned: typeof row.is_banned === 'number' ? row.is_banned !== 0 : !!row.is_banned,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  }
}

// GET /api/admin/users — 获取所有用户列表
adminRouter.get('/users', async (_req, res, next) => {
  try {
    const pool = getPool()
    const result = await pool.query('SELECT * FROM users ORDER BY created_at ASC')
    res.json(result.rows.map(toPublicUser))
  } catch (e) { next(e) }
})

// PUT /api/admin/users/:id/ban — 封禁/解封用户
adminRouter.put('/users/:id/ban', async (req, res, next) => {
  try {
    const pool = getPool()
    const { isBanned } = req.body as { isBanned: boolean }
    const result = await pool.query(
      'UPDATE users SET is_banned = $1 WHERE id = $2 RETURNING *',
      [isBanned, req.params.id]
    )
    if (result.rows.length === 0) {
      next(createError(404, 'NOT_FOUND', 'User not found'))
      return
    }
    res.json(toPublicUser(result.rows[0] as UserRow))
  } catch (e) { next(e) }
})

// PUT /api/admin/users/:id/role — 修改用户角色
adminRouter.put('/users/:id/role', async (req, res, next) => {
  try {
    const pool = getPool()
    const { role } = req.body as { role: UserRole }
    if (role !== 'admin' && role !== 'member') {
      next(createError(400, 'INVALID_INPUT', 'role 必须为 admin 或 member'))
      return
    }
    const result = await pool.query(
      'UPDATE users SET role = $1 WHERE id = $2 RETURNING *',
      [role, req.params.id]
    )
    if (result.rows.length === 0) {
      next(createError(404, 'NOT_FOUND', 'User not found'))
      return
    }
    res.json(toPublicUser(result.rows[0] as UserRow))
  } catch (e) { next(e) }
})

// ============================================================================
// AI 配置管理 API（spec §10.3）
// - GET    /api/admin/ai-settings             → 列出所有 AI provider（api_key 脱敏）
// - POST   /api/admin/ai-settings             → 新增 provider
// - PUT    /api/admin/ai-settings/:id          → 编辑 provider
// - DELETE /api/admin/ai-settings/:id          → 删除 provider
// - GET    /api/admin/tool-permissions         → 全局工具开关默认值
// - PUT    /api/admin/tool-permissions/:toolName → 更新全局工具开关
// - GET    /api/admin/search-engines           → 所有搜索引擎配置
// - PUT    /api/admin/search-engines/:name     → 更新搜索引擎配置
// ============================================================================

interface AiProviderRow {
  id: string
  provider_name: string
  endpoint: string | null
  model: string
  api_key: string
  priority: number
  enabled: boolean | number
  created_at: number
  updated_at: number
}

function toProvider(row: AiProviderRow) {
  const enabled = typeof row.enabled === 'number' ? row.enabled !== 0 : !!row.enabled
  // 脱敏显示 api_key：前4后4
  const key = row.api_key || ''
  const maskedKey = key.length <= 8
    ? '****'
    : `${key.slice(0, 4)}...${key.slice(-4)}`
  return {
    id: row.id,
    providerName: row.provider_name,
    endpoint: row.endpoint || '',
    model: row.model,
    apiKeyMasked: maskedKey,
    priority: row.priority,
    enabled,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

/**
 * 将 priority 最高的 enabled provider 同步到 ai_settings 表（model/api_key/endpoint），
 * 让 piBridge.ts 无需修改即可读取默认 provider 配置。
 */
async function syncDefaultProviderToAiSettings(): Promise<void> {
  const pool = getPool()
  const result = await pool.query(
    'SELECT * FROM ai_providers WHERE enabled = TRUE ORDER BY priority DESC, created_at ASC LIMIT 1',
  )
  if (result.rows.length === 0) return
  const p = result.rows[0] as AiProviderRow
  await setSetting(SETTINGS_KEYS.MODEL, p.model)
  await setSetting(SETTINGS_KEYS.API_KEY, p.api_key)
  // 始终同步 endpoint（即使为空也要清除旧值，避免切换到无 endpoint 的 provider 时残留旧地址）
  await setSetting(SETTINGS_KEYS.ENDPOINT, p.endpoint || '')
  clearPromptCache()
}

/**
 * 惰性迁移：首次访问 ai_providers 为空时，从 ai_settings 表迁移现有配置。
 */
async function migrateAiSettingsToProvidersIfEmpty(): Promise<void> {
  const pool = getPool()
  const countResult = await pool.query('SELECT COUNT(*) as cnt FROM ai_providers')
  if (Number(countResult.rows[0].cnt) > 0) return

  const settingsResult = await pool.query(
    `SELECT key, value FROM ai_settings WHERE key IN ('model', 'api_key', 'endpoint')`,
  )
  const map: Record<string, string> = {}
  for (const row of settingsResult.rows) {
    map[row.key] = row.value
  }
  if (!map.model || !map.api_key) return

  const providerName = map.model.includes('/') ? map.model.split('/')[0] : 'custom'
  const now = Date.now()
  await pool.query(
    `INSERT INTO ai_providers (id, provider_name, endpoint, model, api_key, priority, enabled, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [randomUUID(), providerName, map.endpoint || null, map.model, map.api_key, 100, true, now, now],
  )
}

// GET /api/admin/ai-settings — 列出所有 AI provider
adminRouter.get('/ai-settings', async (_req, res, next) => {
  try {
    await migrateAiSettingsToProvidersIfEmpty()
    const pool = getPool()
    const result = await pool.query('SELECT * FROM ai_providers ORDER BY priority DESC, created_at ASC')
    res.json({ providers: result.rows.map(toProvider) })
  } catch (e) { next(e) }
})

// POST /api/admin/ai-settings — 新增 provider
adminRouter.post('/ai-settings', async (req, res, next) => {
  try {
    const body = req.body as {
      providerName: string
      endpoint?: string
      model: string
      apiKey: string
      priority?: number
      enabled?: boolean
    }
    if (!body.providerName || !body.model || !body.apiKey) {
      next(createError(400, 'INVALID_INPUT', 'providerName, model, apiKey are required'))
      return
    }
    let sanitizedApiKey: string
    let sanitizedModel: string
    let sanitizedEndpoint: string | null = null
    try { sanitizedApiKey = sanitizeApiKey(body.apiKey) }
    catch (e) { next(createError(400, 'INVALID_INPUT', `apiKey: ${e instanceof Error ? e.message : String(e)}`)); return }
    try { sanitizedModel = sanitizeModelName(body.model) }
    catch (e) { next(createError(400, 'INVALID_INPUT', `model: ${e instanceof Error ? e.message : String(e)}`)); return }
    if (body.endpoint) {
      try { sanitizedEndpoint = sanitizeEndpointUrl(body.endpoint) }
      catch (e) { next(createError(400, 'INVALID_INPUT', `endpoint: ${e instanceof Error ? e.message : String(e)}`)); return }
    }

    const id = randomUUID()
    const now = Date.now()
    const pool = getPool()
    await pool.query(
      `INSERT INTO ai_providers (id, provider_name, endpoint, model, api_key, priority, enabled, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, body.providerName, sanitizedEndpoint, sanitizedModel, sanitizedApiKey,
       body.priority ?? 0, body.enabled ?? true, now, now],
    )

    await syncDefaultProviderToAiSettings()

    const result = await pool.query('SELECT * FROM ai_providers WHERE id = $1', [id])
    res.status(201).json(toProvider(result.rows[0] as AiProviderRow))
  } catch (e) { next(e) }
})

// PUT /api/admin/ai-settings/:id — 编辑 provider
adminRouter.put('/ai-settings/:id', async (req, res, next) => {
  try {
    const body = req.body as {
      providerName?: string
      endpoint?: string | null
      model?: string
      apiKey?: string
      priority?: number
      enabled?: boolean
    }

    const pool = getPool()
    const existing = await pool.query('SELECT * FROM ai_providers WHERE id = $1', [req.params.id])
    if (existing.rows.length === 0) {
      next(createError(404, 'NOT_FOUND', 'Provider not found'))
      return
    }

    const updates: string[] = []
    const values: unknown[] = []
    let paramIdx = 1

    if (body.providerName !== undefined) {
      updates.push(`provider_name = $${paramIdx++}`)
      values.push(body.providerName)
    }
    if (body.endpoint !== undefined) {
      let sanitized: string | null = null
      if (body.endpoint) {
        try { sanitized = sanitizeEndpointUrl(body.endpoint) }
        catch (e) { next(createError(400, 'INVALID_INPUT', `endpoint: ${e instanceof Error ? e.message : String(e)}`)); return }
      }
      updates.push(`endpoint = $${paramIdx++}`)
      values.push(sanitized)
    }
    if (body.model !== undefined) {
      let sanitized: string
      try { sanitized = sanitizeModelName(body.model) }
      catch (e) { next(createError(400, 'INVALID_INPUT', `model: ${e instanceof Error ? e.message : String(e)}`)); return }
      updates.push(`model = $${paramIdx++}`)
      values.push(sanitized)
    }
    if (body.apiKey !== undefined) {
      let sanitized: string
      try { sanitized = sanitizeApiKey(body.apiKey) }
      catch (e) { next(createError(400, 'INVALID_INPUT', `apiKey: ${e instanceof Error ? e.message : String(e)}`)); return }
      updates.push(`api_key = $${paramIdx++}`)
      values.push(sanitized)
    }
    if (body.priority !== undefined) {
      updates.push(`priority = $${paramIdx++}`)
      values.push(body.priority)
    }
    if (body.enabled !== undefined) {
      updates.push(`enabled = $${paramIdx++}`)
      values.push(body.enabled)
    }

    if (updates.length === 0) {
      next(createError(400, 'INVALID_INPUT', 'No fields to update'))
      return
    }

    updates.push(`updated_at = $${paramIdx++}`)
    values.push(Date.now())
    values.push(req.params.id)

    await pool.query(
      `UPDATE ai_providers SET ${updates.join(', ')} WHERE id = $${paramIdx}`,
      values,
    )

    await syncDefaultProviderToAiSettings()

    const result = await pool.query('SELECT * FROM ai_providers WHERE id = $1', [req.params.id])
    res.json(toProvider(result.rows[0] as AiProviderRow))
  } catch (e) { next(e) }
})

// DELETE /api/admin/ai-settings/:id — 删除 provider
adminRouter.delete('/ai-settings/:id', async (req, res, next) => {
  try {
    const pool = getPool()
    const result = await pool.query('DELETE FROM ai_providers WHERE id = $1 RETURNING id', [req.params.id])
    if (result.rows.length === 0) {
      next(createError(404, 'NOT_FOUND', 'Provider not found'))
      return
    }
    await syncDefaultProviderToAiSettings()
    res.json({ ok: true })
  } catch (e) { next(e) }
})

// ============================================================================
// 工具权限全局开关 API（spec §10.3）
// PI 原生 7 个文件系统工具：read/write/edit/bash/grep/find/ls
// 全局默认值存 tool_settings 表，用户级可覆盖
// ============================================================================

const PI_FILESYSTEM_TOOLS = ['read', 'write', 'edit', 'bash', 'grep', 'find', 'ls'] as const

// GET /api/admin/tool-permissions — 返回全局工具开关默认值
adminRouter.get('/tool-permissions', async (_req, res, next) => {
  try {
    const pool = getPool()
    const result = await pool.query('SELECT tool_name, enabled FROM tool_settings')
    const states: Record<string, boolean> = {}
    for (const name of PI_FILESYSTEM_TOOLS) states[name] = false
    for (const row of result.rows) {
      if ((PI_FILESYSTEM_TOOLS as readonly string[]).includes(row.tool_name)) {
        states[row.tool_name] = typeof row.enabled === 'number' ? row.enabled !== 0 : !!row.enabled
      }
    }
    res.json({ tools: states })
  } catch (e) { next(e) }
})

// PUT /api/admin/tool-permissions/:toolName — 更新全局工具开关
adminRouter.put('/tool-permissions/:toolName', async (req, res, next) => {
  try {
    const toolName = req.params.toolName
    if (!(PI_FILESYSTEM_TOOLS as readonly string[]).includes(toolName)) {
      next(createError(400, 'INVALID_TOOL', `Unknown tool: ${toolName}. Allowed: ${PI_FILESYSTEM_TOOLS.join(', ')}`))
      return
    }
    const { enabled } = req.body as { enabled: boolean }
    if (typeof enabled !== 'boolean') {
      next(createError(400, 'INVALID_INPUT', 'enabled must be a boolean'))
      return
    }
    const pool = getPool()
    const now = Date.now()
    await pool.query(
      `INSERT INTO tool_settings (tool_name, enabled, updated_at) VALUES ($1, $2, $3)
       ON CONFLICT (tool_name) DO UPDATE SET enabled = $2, updated_at = $3`,
      [toolName, enabled, now],
    )
    res.json({ ok: true, toolName, enabled })
  } catch (e) { next(e) }
})

// ============================================================================
// 搜索引擎配置 API（spec §10.3）
// 4 个引擎：local/web(metaso)/academic(arxiv)/github
// config JSON 存储引擎参数（如 api_key）；metaso/github 的 api_key 同步到 ai_settings 表
// ============================================================================

interface SearchEngineRow {
  name: string
  display_name: string
  enabled: boolean | number
  config: string | Record<string, unknown>
  updated_at: number
}

function toSearchEngine(row: SearchEngineRow) {
  const enabled = typeof row.enabled === 'number' ? row.enabled !== 0 : !!row.enabled
  let config: Record<string, unknown> = {}
  if (typeof row.config === 'string') {
    try { config = JSON.parse(row.config) as Record<string, unknown> } catch { /* ignore */ }
  } else if (row.config && typeof row.config === 'object') {
    config = row.config as Record<string, unknown>
  }
  return {
    name: row.name,
    displayName: row.display_name,
    enabled,
    config,
    updatedAt: Number(row.updated_at),
  }
}

// GET /api/admin/search-engines — 返回所有搜索引擎配置
adminRouter.get('/search-engines', async (_req, res, next) => {
  try {
    const pool = getPool()
    const result = await pool.query('SELECT * FROM search_engines ORDER BY name ASC')
    res.json({ engines: result.rows.map(toSearchEngine) })
  } catch (e) { next(e) }
})

// PUT /api/admin/search-engines/:name — 更新搜索引擎配置
adminRouter.put('/search-engines/:name', async (req, res, next) => {
  try {
    const name = req.params.name
    const body = req.body as { enabled?: boolean; config?: Record<string, unknown> }

    const pool = getPool()
    const existing = await pool.query('SELECT * FROM search_engines WHERE name = $1', [name])
    if (existing.rows.length === 0) {
      next(createError(404, 'NOT_FOUND', `Search engine not found: ${name}`))
      return
    }

    const updates: string[] = []
    const values: unknown[] = []
    let paramIdx = 1

    if (body.enabled !== undefined) {
      if (typeof body.enabled !== 'boolean') {
        next(createError(400, 'INVALID_INPUT', 'enabled must be a boolean'))
        return
      }
      updates.push(`enabled = $${paramIdx++}`)
      values.push(body.enabled)
    }
    if (body.config !== undefined) {
      updates.push(`config = $${paramIdx++}`)
      values.push(JSON.stringify(body.config))
    }

    if (updates.length === 0) {
      next(createError(400, 'INVALID_INPUT', 'No fields to update'))
      return
    }

    updates.push(`updated_at = $${paramIdx++}`)
    values.push(Date.now())
    values.push(name)

    await pool.query(
      `UPDATE search_engines SET ${updates.join(', ')} WHERE name = $${paramIdx}`,
      values,
    )

    // 同步 metaso/github 的 api_key 到 ai_settings 表（piBridge 从 ai_settings 读取）
    if (body.config) {
      const apiKey = body.config.apiKey as string | undefined
      if (typeof apiKey === 'string' && apiKey.length > 0) {
        if (name === 'metaso') {
          await setSetting(SETTINGS_KEYS.SEARCH_KEY_METASO, apiKey)
        } else if (name === 'github') {
          await setSetting(SETTINGS_KEYS.SEARCH_KEY_GITHUB, apiKey)
        }
      }
    }

    const result = await pool.query('SELECT * FROM search_engines WHERE name = $1', [name])
    res.json(toSearchEngine(result.rows[0] as SearchEngineRow))
  } catch (e) { next(e) }
})
