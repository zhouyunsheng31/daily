import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { getPool, withTransaction } from '../db/connection.js'
import { createError } from '../middleware/error.js'
import { requireAdmin, requireUser } from '../middleware/auth.js'
import { broadcastChange } from '../ws.js'
import type { CreateWidgetRequest, UpdateWidgetRequest } from '../types/index.js'

export const widgetsRouter = Router()

export const panelWidgetsRouter = Router()

// GET /api/panels/:panelId/widgets
panelWidgetsRouter.get('/:panelId/widgets', async (req, res, next) => {
  try {
    const pool = getPool()
    const result = await pool.query('SELECT * FROM widgets WHERE panel_id = $1 ORDER BY z_index ASC', [req.params.panelId])
    res.json(result.rows.map(parseWidgetRow))
  } catch (e) { next(e) }
})

// POST /api/panels/:panelId/widgets
panelWidgetsRouter.post('/:panelId/widgets', async (req, res, next) => {
  try {
    const pool = getPool()
    const body = req.body as CreateWidgetRequest
    const id = body.id || uuidv4()
    const now = Date.now()

    await pool.query(
      `INSERT INTO widgets (id, panel_id, type, x, y, width, height, z_index, minimized, locked, color_scheme, state, is_primary, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        id, req.params.panelId, body.type,
        body.x ?? 0, body.y ?? 0, body.width ?? 300, body.height ?? 200, body.zIndex ?? 0,
        body.minimized ?? false, body.locked ?? false, body.colorScheme ?? null,
        JSON.stringify(body.state ?? {}),
        body.isPrimary ?? false,
        now, now
      ]
    )
    const result = await pool.query('SELECT * FROM widgets WHERE id = $1', [id])
    const widget = parseWidgetRow(result.rows[0])
    res.status(201).json(widget)
    broadcastChange({ kind: 'widget_created', data: widget }, req.deviceId)
  } catch (e) { next(e) }
})

// PUT /api/widgets/batch-positions
widgetsRouter.put('/batch-positions', async (req, res, next) => {
  try {
    const pool = getPool()
    const { positions } = req.body as { positions: Array<{ id: string; x: number; y: number; width: number; height: number; zIndex: number }> }
    const now = Date.now()
    await withTransaction(async (client) => {
      for (const p of positions) {
        await client.query(
          'UPDATE widgets SET x = $1, y = $2, width = $3, height = $4, z_index = $5, version = version + 1, updated_at = $6 WHERE id = $7',
          [p.x, p.y, p.width, p.height, p.zIndex, now, p.id]
        )
      }
    })
    res.json({ ok: true })
    broadcastChange({ kind: 'widget_updated', data: { positions } }, req.deviceId)
  } catch (e) { next(e) }
})

// PUT /api/widgets/batch-states
widgetsRouter.put('/batch-states', async (req, res, next) => {
  try {
    const pool = getPool()
    const { widgets } = req.body as { widgets: Array<{ id: string; state?: Record<string, unknown>; minimized?: boolean; locked?: boolean; colorScheme?: string | null }> }
    const now = Date.now()

    await withTransaction(async (client) => {
      for (const w of widgets) {
        const updates: string[] = []
        const values: unknown[] = []
        let paramIdx = 1

        if (w.state !== undefined) { updates.push(`state = $${paramIdx++}`); values.push(JSON.stringify(w.state)) }
        if (w.minimized !== undefined) { updates.push(`minimized = $${paramIdx++}`); values.push(w.minimized) }
        if (w.locked !== undefined) { updates.push(`locked = $${paramIdx++}`); values.push(w.locked) }
        if (w.colorScheme !== undefined) { updates.push(`color_scheme = $${paramIdx++}`); values.push(w.colorScheme) }

        if (updates.length > 0) {
          updates.push('version = version + 1')
          updates.push(`updated_at = $${paramIdx++}`)
          values.push(now)
          values.push(w.id)
          await client.query(`UPDATE widgets SET ${updates.join(', ')} WHERE id = $${paramIdx}`, values)
        }
      }
    })
    res.json({ ok: true })
    broadcastChange({ kind: 'widget_updated', data: { widgets } }, req.deviceId)
  } catch (e) { next(e) }
})

// ============================================================================
// Phase 2 决策38/39：mini/icon 档 AI 自定义 HTML 上传接口
// POST /api/widgets/:id/mini-html — 上传 mini 档精简 HTML（决策38）
// POST /api/widgets/:id/icon-html — 上传 icon 档 HTML 图标（决策39）
// 认证：需要登录（requireUser），owner 可改自己面板上的 widget，admin 可改任意 widget
// Body: { html: string }
// 更新 widget.state.miniHtml / iconHtml（合并到现有 state，不覆盖其他字段）
// ============================================================================

/**
 * 通用：上传 widget 的 mini/icon 档 HTML
 * @param req Express Request（已通过 requireUser 中间件）
 * @param widgetId widget ID
 * @param tier 'mini' | 'icon'，决定写入 state.miniHtml 还是 state.iconHtml
 */
async function uploadTierHtml(
  req: import('express').Request,
  res: import('express').Response,
  next: import('express').NextFunction,
  widgetId: string,
  tier: 'mini' | 'icon'
): Promise<void> {
  try {
    const pool = getPool()
    const body = req.body as { html?: unknown }
    const html = body.html
    if (typeof html !== 'string' || html.length === 0) {
      throw createError(400, 'INVALID_PARAMS', 'html is required and must be a non-empty string')
    }
    // 大小限制（64KB，防止过大 HTML 拖累渲染）
    const MAX_TIER_HTML_SIZE = 64 * 1024
    if (html.length > MAX_TIER_HTML_SIZE) {
      throw createError(400, 'INVALID_PARAMS', `html too large: ${html.length} chars (max ${MAX_TIER_HTML_SIZE})`)
    }

    // 1. 查 widget 是否存在 + 获取 panelId + 当前 state
    const widgetResult = await pool.query('SELECT * FROM widgets WHERE id = $1', [widgetId])
    if (widgetResult.rows.length === 0) {
      throw createError(404, 'NOT_FOUND', `Widget ${widgetId} not found`)
    }
    const widgetRow = widgetResult.rows[0]
    const panelId = widgetRow.panel_id

    // 2. 查 panel 获取 ownerId + isCommunity，做权限校验
    const panelResult = await pool.query('SELECT * FROM panels WHERE id = $1', [panelId])
    if (panelResult.rows.length === 0) {
      throw createError(404, 'NOT_FOUND', `Panel ${panelId} not found for widget ${widgetId}`)
    }
    const panelRow = panelResult.rows[0]
    const panelOwnerId = panelRow.owner_id ?? null
    const isCommunity = typeof panelRow.is_community === 'number'
      ? panelRow.is_community !== 0
      : !!panelRow.is_community

    const userId = req.user?.userId
    // 权限：非社区面板只有 owner 或 admin 可修改（与 panels.ts PUT /:id 一致）
    if (userId && !isCommunity && panelOwnerId && panelOwnerId !== userId && req.user?.role !== 'admin') {
      next(createError(403, 'FORBIDDEN', '无权修改他人面板上的组件'))
      return
    }

    // 3. 合并 state：保留现有字段，覆盖 miniHtml/iconHtml + updatedAt
    const stateField = tier === 'mini' ? 'miniHtml' : 'iconHtml'
    const existingState = typeof widgetRow.state === 'string'
      ? JSON.parse(widgetRow.state || '{}')
      : (widgetRow.state || {})
    const newState = {
      ...existingState,
      [stateField]: html,
      updatedAt: Date.now(),
    }

    const now = Date.now()
    await pool.query(
      `UPDATE widgets SET state = $1, version = version + 1, updated_at = $2 WHERE id = $3`,
      [JSON.stringify(newState), now, widgetId]
    )

    // 4. 返回更新后的 widget + 广播
    const updatedResult = await pool.query('SELECT * FROM widgets WHERE id = $1', [widgetId])
    const widget = parseWidgetRow(updatedResult.rows[0])
    res.json(widget)
    broadcastChange({ kind: 'widget_updated', data: widget }, req.deviceId)
  } catch (e) { next(e) }
}

// POST /api/widgets/:id/mini-html — 上传 mini 档精简 HTML（决策38）
widgetsRouter.post('/:id/mini-html', requireUser, async (req, res, next) => {
  await uploadTierHtml(req, res, next, String(req.params.id), 'mini')
})

// POST /api/widgets/:id/icon-html — 上传 icon 档 HTML 图标（决策39）
widgetsRouter.post('/:id/icon-html', requireUser, async (req, res, next) => {
  await uploadTierHtml(req, res, next, String(req.params.id), 'icon')
})

// GET /api/widgets/global — 获取所有全局组件（is_global = TRUE）
// 必须在 /:id 之前注册，否则 /global 会被 /:id 匹配
// 全局组件对所有用户可见，由 admin 设置
widgetsRouter.get('/global', async (_req, res, next) => {
  try {
    const pool = getPool()
    const result = await pool.query('SELECT * FROM widgets WHERE is_global = TRUE ORDER BY z_index ASC')
    res.json(result.rows.map(parseWidgetRow))
  } catch (e) { next(e) }
})

// ============================================================================
// Phase 6 T12：管理员全局组件管理（spec §10.3）
// PUT /api/widgets/custom/:id/global — 切换 custom_widgets 表中组件的 is_global 标志
// 认证：requireAdmin（仅管理员可设置全局组件）
// Body: { isGlobal: boolean }
// 全局组件对所有用户可见（在 custom_widgets 列表查询中独立于 is_public 返回）
// 路径必须在 PUT /:id 之前注册，避免 :id 路径冲突（虽然 /:id/global 不会被 /:id 匹配，
// 但保持与 /custom/* 系列接口一致的注册顺序）
// ============================================================================
widgetsRouter.put('/custom/:id/global', requireAdmin, async (req, res, next) => {
  try {
    const pool = getPool()
    const { isGlobal } = req.body as { isGlobal?: unknown }
    if (typeof isGlobal !== 'boolean') {
      throw createError(400, 'INVALID_PARAMS', 'isGlobal is required and must be a boolean')
    }
    const existing = await pool.query('SELECT * FROM custom_widgets WHERE id = $1', [req.params.id])
    if (existing.rows.length === 0) {
      throw createError(404, 'NOT_FOUND', `Custom widget ${req.params.id} not found`)
    }
    const now = Date.now()
    const isGlobalVal = process.env.DB_DRIVER === 'sqlite' ? (isGlobal ? 1 : 0) : isGlobal
    await pool.query(
      'UPDATE custom_widgets SET is_global = $1, updated_at = $2 WHERE id = $3',
      [isGlobalVal, now, req.params.id]
    )
    const result = await pool.query('SELECT * FROM custom_widgets WHERE id = $1', [req.params.id])
    res.json(parseCustomWidgetRow(result.rows[0]))
  } catch (e) { next(e) }
})

// ============================================================================
// Phase 5：自定义上传组件 CRUD（spec §11.2）
// 路由必须在 /:id 之前注册，否则 /upload、/custom 会被 /:id 匹配
// - POST   /api/widgets/upload   上传组件（登录用户均可，admin 可设 is_global）
// - GET    /api/widgets/custom   列表（公开 + 自己的）
// - PUT    /api/widgets/custom/:id  更新（admin）
// - DELETE /api/widgets/custom/:id  删除（admin）
// ============================================================================

// POST /api/widgets/upload — 上传自定义 HTML 组件（登录用户均可，spec §11.2）
// - member 上传：owner_id=self，默认私有（isPublic=false）
// - admin 上传：可选 is_global=true（全局可见，标记为 admin 全局组件）
widgetsRouter.post('/upload', requireUser, async (req, res, next) => {
  try {
    const pool = getPool()
    const { name, description, html, width, height, tags, isPublic, isGlobal } = req.body as {
      name?: string
      description?: string
      html?: string
      width?: number
      height?: number
      tags?: string[]
      isPublic?: boolean
      isGlobal?: boolean
    }
    if (typeof html !== 'string' || html.length === 0) {
      throw createError(400, 'INVALID_PARAMS', 'html is required and must be a non-empty string')
    }
    if (typeof name !== 'string' || name.length === 0) {
      throw createError(400, 'INVALID_PARAMS', 'name is required')
    }
    // is_global 仅 admin 可设；非 admin 强制为 false
    const isGlobalFlag = isGlobal === true && req.user?.role === 'admin'

    const id = uuidv4()
    const now = Date.now()
    const ownerId = req.user?.userId ?? null
    const w = typeof width === 'number' && width > 0 ? Math.floor(width) : 400
    const h = typeof height === 'number' && height > 0 ? Math.floor(height) : 300
    const tagsJson = JSON.stringify(Array.isArray(tags) ? tags : [])
    const pubFlag = isPublic ? 1 : 0  // SQLite 兼容：用整数，PG 会自动转换
    // 注意：PG 模式下 is_public 是 BOOLEAN，传整数 0/1 会被 pg 驱动拒绝，需要用 boolean
    const isPublicVal = process.env.DB_DRIVER === 'sqlite' ? pubFlag : Boolean(isPublic)
    const isGlobalVal = process.env.DB_DRIVER === 'sqlite' ? (isGlobalFlag ? 1 : 0) : isGlobalFlag
    await pool.query(
      `INSERT INTO custom_widgets (id, name, description, html, width, height, tags, owner_id, is_public, is_global, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [id, name, description ?? '', html, w, h, tagsJson, ownerId, isPublicVal, isGlobalVal, now, now]
    )
    const result = await pool.query('SELECT * FROM custom_widgets WHERE id = $1', [id])
    res.status(201).json(parseCustomWidgetRow(result.rows[0]))
  } catch (e) { next(e) }
})

// GET /api/widgets/custom — 获取自定义组件列表（公开 + 自己的）
widgetsRouter.get('/custom', async (req, res, next) => {
  try {
    const pool = getPool()
    const ownerId = req.user?.userId ?? null
    let result
    if (ownerId) {
      // 已登录用户：公开的 + 自己上传的
      result = await pool.query(
        'SELECT * FROM custom_widgets WHERE is_public = TRUE OR owner_id = $1 ORDER BY created_at DESC',
        [ownerId]
      )
    } else {
      // 未登录/单密码模式：仅公开的
      result = await pool.query('SELECT * FROM custom_widgets WHERE is_public = TRUE ORDER BY created_at DESC')
    }
    res.json(result.rows.map(parseCustomWidgetRow))
  } catch (e) { next(e) }
})

// GET /api/widgets/custom/all — 管理员获取所有自定义组件（含私有，spec §10.3）
// 仅 admin 可调用，用于全局组件管理界面
widgetsRouter.get('/custom/all', requireAdmin, async (_req, res, next) => {
  try {
    const pool = getPool()
    const result = await pool.query('SELECT * FROM custom_widgets ORDER BY created_at DESC')
    res.json(result.rows.map(parseCustomWidgetRow))
  } catch (e) { next(e) }
})

// PUT /api/widgets/custom/:id — 更新自定义组件（admin）
widgetsRouter.put('/custom/:id', requireAdmin, async (req, res, next) => {
  try {
    const pool = getPool()
    const { name, description, html, width, height, tags, isPublic } = req.body as {
      name?: string
      description?: string
      html?: string
      width?: number
      height?: number
      tags?: string[]
      isPublic?: boolean
    }
    const existing = await pool.query('SELECT * FROM custom_widgets WHERE id = $1', [req.params.id])
    if (existing.rows.length === 0) {
      throw createError(404, 'NOT_FOUND', `Custom widget ${req.params.id} not found`)
    }
    const now = Date.now()
    const updates: string[] = []
    const values: unknown[] = []
    let paramIdx = 1
    if (typeof name === 'string' && name.length > 0) { updates.push(`name = $${paramIdx++}`); values.push(name) }
    if (typeof description === 'string') { updates.push(`description = $${paramIdx++}`); values.push(description) }
    if (typeof html === 'string' && html.length > 0) { updates.push(`html = $${paramIdx++}`); values.push(html) }
    if (typeof width === 'number' && width > 0) { updates.push(`width = $${paramIdx++}`); values.push(Math.floor(width)) }
    if (typeof height === 'number' && height > 0) { updates.push(`height = $${paramIdx++}`); values.push(Math.floor(height)) }
    if (Array.isArray(tags)) { updates.push(`tags = $${paramIdx++}`); values.push(JSON.stringify(tags)) }
    if (typeof isPublic === 'boolean') {
      const isPublicVal = process.env.DB_DRIVER === 'sqlite' ? (isPublic ? 1 : 0) : isPublic
      updates.push(`is_public = $${paramIdx++}`)
      values.push(isPublicVal)
    }
    if (updates.length > 0) {
      updates.push(`updated_at = $${paramIdx++}`)
      values.push(now)
      values.push(req.params.id)
      await pool.query(`UPDATE custom_widgets SET ${updates.join(', ')} WHERE id = $${paramIdx}`, values)
    }
    const result = await pool.query('SELECT * FROM custom_widgets WHERE id = $1', [req.params.id])
    res.json(parseCustomWidgetRow(result.rows[0]))
  } catch (e) { next(e) }
})

// DELETE /api/widgets/custom/:id — 删除自定义组件（admin）
widgetsRouter.delete('/custom/:id', requireAdmin, async (req, res, next) => {
  try {
    const pool = getPool()
    const result = await pool.query('DELETE FROM custom_widgets WHERE id = $1', [req.params.id])
    if (result.rowCount === 0) {
      throw createError(404, 'NOT_FOUND', `Custom widget ${req.params.id} not found`)
    }
    res.json({ ok: true })
  } catch (e) { next(e) }
})

// GET /api/widgets/:id
widgetsRouter.get('/:id', async (req, res, next) => {
  try {
    const pool = getPool()
    const result = await pool.query('SELECT * FROM widgets WHERE id = $1', [req.params.id])
    if (result.rows.length === 0) throw createError(404, 'NOT_FOUND', `Widget ${req.params.id} not found`)
    res.json(parseWidgetRow(result.rows[0]))
  } catch (e) { next(e) }
})

// PUT /api/widgets/:id
widgetsRouter.put('/:id', async (req, res, next) => {
  try {
    const pool = getPool()
    const body = req.body as UpdateWidgetRequest & { expectedVersion?: number }
    const existing = await pool.query('SELECT * FROM widgets WHERE id = $1', [req.params.id])
    if (existing.rows.length === 0) throw createError(404, 'NOT_FOUND', `Widget ${req.params.id} not found`)

    const now = Date.now()

    // Phase 4：乐观锁（spec 2.5 节）
    // - state 更新：必须校验 version（WHERE id = $X AND version = $Y）
    // - 位置/尺寸更新：LWW（不校验 version，位置冲突不重要）
    // - 其他字段（minimized/locked/colorScheme/isPrimary）：LWW（不校验 version）
    const isStateOnlyUpdate = body.state !== undefined &&
      body.x === undefined && body.y === undefined &&
      body.width === undefined && body.height === undefined &&
      body.zIndex === undefined && body.minimized === undefined &&
      body.locked === undefined && body.colorScheme === undefined &&
      body.isPrimary === undefined

    if (isStateOnlyUpdate && body.expectedVersion !== undefined) {
      // state 更新 + 乐观锁校验
      const result = await pool.query(
        `UPDATE widgets SET state = $1, version = version + 1, updated_at = $2
         WHERE id = $3 AND version = $4 RETURNING *`,
        [JSON.stringify(body.state), now, req.params.id, body.expectedVersion],
      )
      if (result.rows.length === 0) {
        // 版本不匹配，冲突
        const current = await pool.query('SELECT * FROM widgets WHERE id = $1', [req.params.id])
        if (current.rows.length === 0) {
          throw createError(404, 'NOT_FOUND', `Widget ${req.params.id} not found`)
        }
        res.status(409).json({
          conflict: true,
          conflictType: 'state',
          currentVersion: current.rows[0].version,
          currentState: current.rows[0].state,
          message: '组件状态有冲突，点击查看',
        })
        return
      }
      const widget = parseWidgetRow(result.rows[0])
      res.json(widget)
      broadcastChange({ kind: 'widget_updated', data: widget }, req.deviceId)
      return
    }

    // 其他更新：LWW（不校验 version）
    const updates: string[] = []
    const values: unknown[] = []
    let paramIdx = 1

    if (body.x !== undefined) { updates.push(`x = $${paramIdx++}`); values.push(body.x) }
    if (body.y !== undefined) { updates.push(`y = $${paramIdx++}`); values.push(body.y) }
    if (body.width !== undefined) { updates.push(`width = $${paramIdx++}`); values.push(body.width) }
    if (body.height !== undefined) { updates.push(`height = $${paramIdx++}`); values.push(body.height) }
    if (body.zIndex !== undefined) { updates.push(`z_index = $${paramIdx++}`); values.push(body.zIndex) }
    if (body.minimized !== undefined) { updates.push(`minimized = $${paramIdx++}`); values.push(body.minimized) }
    if (body.locked !== undefined) { updates.push(`locked = $${paramIdx++}`); values.push(body.locked) }
    if (body.colorScheme !== undefined) { updates.push(`color_scheme = $${paramIdx++}`); values.push(body.colorScheme) }
    if (body.state !== undefined) { updates.push(`state = $${paramIdx++}`); values.push(JSON.stringify(body.state)) }
    if (body.isPrimary !== undefined) { updates.push(`is_primary = $${paramIdx++}`); values.push(body.isPrimary) }

    if (updates.length > 0) {
      updates.push('version = version + 1')
      updates.push(`updated_at = $${paramIdx++}`)
      values.push(now)
      values.push(req.params.id)
      await pool.query(`UPDATE widgets SET ${updates.join(', ')} WHERE id = $${paramIdx}`, values)
    }

    const result = await pool.query('SELECT * FROM widgets WHERE id = $1', [req.params.id])
    const widget = parseWidgetRow(result.rows[0])
    res.json(widget)
    broadcastChange({ kind: 'widget_updated', data: widget }, req.deviceId)
  } catch (e) { next(e) }
})

// DELETE /api/widgets/:id
widgetsRouter.delete('/:id', async (req, res, next) => {
  try {
    const pool = getPool()
    const result = await pool.query('DELETE FROM widgets WHERE id = $1', [req.params.id])
    if (result.rowCount === 0) throw createError(404, 'NOT_FOUND', `Widget ${req.params.id} not found`)
    res.json({ ok: true })
    broadcastChange({ kind: 'widget_deleted', data: { id: req.params.id } }, req.deviceId)
  } catch (e) { next(e) }
})

function parseWidgetRow(row: any) {
  return {
    id: row.id,
    panelId: row.panel_id,
    type: row.type,
    x: row.x,
    y: row.y,
    width: row.width,
    height: row.height,
    zIndex: row.z_index,
    minimized: row.minimized,
    locked: row.locked,
    colorScheme: row.color_scheme,
    state: row.state || {},
    isPrimary: row.is_primary,
    isGlobal: typeof row.is_global === 'number' ? row.is_global !== 0 : !!row.is_global,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** Phase 5：解析 custom_widgets 表行（PG/SQLite 兼容） */
function parseCustomWidgetRow(row: any) {
  let tags: string[] = []
  if (Array.isArray(row.tags)) {
    tags = row.tags  // PG 返回数组
  } else if (typeof row.tags === 'string') {
    try { tags = JSON.parse(row.tags) } catch { tags = [] }  // SQLite 返回 JSON 字符串
  }
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    html: row.html,
    width: row.width,
    height: row.height,
    tags,
    ownerId: row.owner_id ?? null,
    isPublic: typeof row.is_public === 'number' ? row.is_public !== 0 : !!row.is_public,
    isGlobal: typeof row.is_global === 'number' ? row.is_global !== 0 : !!row.is_global,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
