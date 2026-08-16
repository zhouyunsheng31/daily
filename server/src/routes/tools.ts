import { Router } from 'express'
import { getPool } from '../db/connection.js'
import { createError } from '../middleware/error.js'
import { requireAdmin } from '../middleware/auth.js'
import {
  AI_TOOL_DEFINITIONS,
  AI_TOOL_MAP,
  DISABLEABLE_TOOL_NAMES,
  FILE_SYSTEM_TOOL_NAMES,
  isValidToolName,
} from '../utils/aiTools.js'

// ============================================================================
// Phase S4：工具管理 API（spec 9.3.4 节）
// - GET    /api/tools          → 列出所有 AI 工具及启用状态
// - PUT    /api/tools/:name    → 更新单个工具启用状态
// - POST   /api/tools/reset    → 重置所有工具为默认启用
// ============================================================================
// Phase 3：文件系统工具开关 API（spec §7）
// - GET    /api/tools/settings → 获取所有文件系统工具的启用状态（默认全 false）
// - PUT    /api/tools/settings → 批量更新文件系统工具开关（需 admin 权限）
// - GET    /api/tools/enabled  → 获取已启用的工具列表（供 AI agent 查询）
// ============================================================================

export const toolsRouter = Router()

/**
 * 从 tool_settings 表读取所有工具的启用状态
 * 返回 Map<toolName, enabled>
 */
async function getToolEnabledStates(): Promise<Map<string, boolean>> {
  try {
    const pool = getPool()
    const result = await pool.query('SELECT tool_name, enabled FROM tool_settings')
    const map = new Map<string, boolean>()
    for (const row of result.rows) {
      // 防御性编程：迁移后 tool_settings 表理论上不再含 skill 记录（skill_id 已迁移到 skill_settings 表），
      // 此过滤作为兜底，防止迁移部分失败时脏数据污染 /api/tools 响应。
      if (isValidToolName(row.tool_name)) {
        // SQLite 存储 boolean 为 0/1，统一转换为严格 boolean
        map.set(row.tool_name, Boolean(row.enabled))
      }
    }
    return map
  } catch (err) {
    console.warn('[Tools] getToolEnabledStates failed:', err)
    return new Map()
  }
}

/**
 * GET /api/tools
 * 列出所有 AI 工具及启用状态（spec 9.3.4 节）
 * Phase 3：默认值由 defaultEnabled 字段决定（文件系统工具默认 false，spec §7）
 */
toolsRouter.get('/', async (_req, res, next) => {
  try {
    const enabledStates = await getToolEnabledStates()
    const tools = AI_TOOL_DEFINITIONS.map(info => ({
      name: info.name,
      label: info.label,
      description: info.description,
      category: info.category,
      canDisable: info.canDisable,
      defaultEnabled: info.defaultEnabled,
      enabled: enabledStates.get(info.name) ?? info.defaultEnabled,
    }))
    res.json({
      tools,
      total: tools.length,
      enabledCount: tools.filter(t => t.enabled).length,
    })
  } catch (e) { next(e) }
})

// ============================================================================
// Phase 3：文件系统工具开关 API（spec §7）
// 注意：/settings 和 /enabled 必须在 /:name 之前注册，否则会被参数路由匹配
// ============================================================================

/**
 * GET /api/tools/settings
 * 获取所有文件系统工具（read/write/edit/bash/grep/find/ls）的启用状态
 * 默认全部关闭，用户需手动开启
 */
toolsRouter.get('/settings', async (_req, res, next) => {
  try {
    const enabledStates = await getToolEnabledStates()
    const tools = AI_TOOL_DEFINITIONS
      .filter(info => FILE_SYSTEM_TOOL_NAMES.has(info.name))
      .map(info => ({
        name: info.name,
        label: info.label,
        description: info.description,
        enabled: enabledStates.get(info.name) ?? info.defaultEnabled, // defaultEnabled=false
      }))
    res.json({
      tools,
      total: tools.length,
      enabledCount: tools.filter(t => t.enabled).length,
    })
  } catch (e) { next(e) }
})

/**
 * PUT /api/tools/settings
 * 批量更新文件系统工具开关状态（需 admin 权限）
 * body: { tools: Array<{ toolName: string, enabled: boolean }> }
 */
toolsRouter.put('/settings', requireAdmin, async (req, res, next) => {
  try {
    const body = req.body as { tools?: Array<{ toolName: string; enabled: boolean }> }
    const tools = body.tools

    // 校验请求体
    if (!Array.isArray(tools) || tools.length === 0) {
      next(createError(400, 'INVALID_REQUEST', 'body.tools must be a non-empty array of { toolName, enabled }'))
      return
    }

    // 校验每个条目
    for (const item of tools) {
      if (!item || typeof item.toolName !== 'string' || typeof item.enabled !== 'boolean') {
        next(createError(400, 'INVALID_REQUEST', 'Each item must be { toolName: string, enabled: boolean }'))
        return
      }
      if (!FILE_SYSTEM_TOOL_NAMES.has(item.toolName)) {
        next(createError(400, 'INVALID_TOOL', `Not a filesystem tool: ${item.toolName}. Allowed: ${Array.from(FILE_SYSTEM_TOOL_NAMES).join(', ')}`))
        return
      }
    }

    // 批量更新（幂等 upsert）
    const pool = getPool()
    const now = Date.now()
    for (const item of tools) {
      await pool.query(
        `INSERT INTO tool_settings (tool_name, enabled, updated_at) VALUES ($1, $2, $3)
         ON CONFLICT (tool_name) DO UPDATE SET enabled = $2, updated_at = $3`,
        [item.toolName, item.enabled, now],
      )
    }

    res.json({
      ok: true,
      updated: tools.length,
      tools: tools.map(t => ({ toolName: t.toolName, enabled: t.enabled })),
    })
  } catch (e) { next(e) }
})

/**
 * GET /api/tools/enabled
 * 获取已启用的工具列表（供 AI agent 查询可用工具）
 * 返回所有已启用工具的元数据（含默认启用 + 用户启用的，排除默认禁用且未启用的）
 */
toolsRouter.get('/enabled', async (_req, res, next) => {
  try {
    const enabledStates = await getToolEnabledStates()
    const tools = AI_TOOL_DEFINITIONS
      .filter(info => {
        // 系统工具（canDisable=false）永远启用
        if (!info.canDisable) return true
        // 其他工具按 tool_settings + defaultEnabled 决定
        return enabledStates.get(info.name) ?? info.defaultEnabled
      })
      .map(info => ({
        name: info.name,
        label: info.label,
        description: info.description,
        category: info.category,
      }))
    res.json({
      tools,
      total: tools.length,
    })
  } catch (e) { next(e) }
})

/**
 * PUT /api/tools/:name
 * 更新单个工具启用状态（spec 9.3.4 节）
 * body: { enabled: boolean }
 * 【安全修复 2026-08-16（H6）】：加 requireAdmin——任意用户此前可自助启用
 * bash 等文件系统工具，叠加 H8 可形成 RCE 链。
 */
toolsRouter.put('/:name', requireAdmin, async (req, res, next) => {
  try {
    const toolName = String(req.params.name)
    const { enabled } = req.body as { enabled: boolean }

    // 校验工具名
    if (!isValidToolName(toolName)) {
      throw createError(400, 'INVALID_TOOL', `Unknown tool: ${toolName}`)
    }

    // 校验 enabled 类型
    if (typeof enabled !== 'boolean') {
      throw createError(400, 'INVALID_REQUEST', 'enabled must be a boolean')
    }

    // 检查是否可禁用
    const toolInfo = AI_TOOL_MAP.get(toolName)!
    if (!toolInfo.canDisable && !enabled) {
      throw createError(400, 'NOT_DISABLEABLE', `Tool ${toolName} cannot be disabled (system tool)`)
    }

    const pool = getPool()
    const now = Date.now()
    await pool.query(
      `INSERT INTO tool_settings (tool_name, enabled, updated_at) VALUES ($1, $2, $3)
       ON CONFLICT (tool_name) DO UPDATE SET enabled = $2, updated_at = $3`,
      [toolName, enabled, now],
    )

    res.json({
      ok: true,
      tool: toolName,
      enabled,
    })
  } catch (e) { next(e) }
})

/**
 * POST /api/tools/reset
 * 重置所有工具为默认启用（删除 tool_settings 表中所有 AI 工具记录）
 */
toolsRouter.post('/reset', requireAdmin, async (_req, res, next) => {
  try {
    const pool = getPool()
    const toolNames = Array.from(DISABLEABLE_TOOL_NAMES)
    // 一次 SQL 删除所有可禁用工具的启用状态记录
    const result = await pool.query(
      'DELETE FROM tool_settings WHERE tool_name = ANY($1::text[]) RETURNING tool_name',
      [toolNames],
    )
    const deletedCount = result.rowCount ?? 0
    res.json({
      ok: true,
      reset: deletedCount,
      message: deletedCount === 0
        ? 'No tools were disabled, nothing to reset'
        : `Reset ${deletedCount} tool settings to default (enabled)`,
    })
  } catch (e) { next(e) }
})
