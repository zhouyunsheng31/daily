import { Router } from 'express'
import { getPool } from '../db/connection.js'
import { broadcastChange } from '../ws.js'

export const favoritesRouter = Router()

// GET /api/favorites - 获取所有收藏，按 created_at 排序
favoritesRouter.get('/', async (_req, res, next) => {
  try {
    const pool = getPool()
    const result = await pool.query('SELECT * FROM favorited_widgets ORDER BY created_at ASC')
    res.json(result.rows.map(parseFavoriteRow))
  } catch (e) { next(e) }
})

// POST /api/favorites - 添加收藏（UNIQUE 约束冲突时走 upsert）
favoritesRouter.post('/', async (req, res, next) => {
  try {
    const pool = getPool()
    const now = Date.now()
    const body = req.body as {
      id: string
      widgetId: string
      panelId: string
      widgetType: string
      displayName: string
      positionSnapshot: unknown
      stateSnapshot?: unknown
    }
    const result = await pool.query(
      `INSERT INTO favorited_widgets (id, widget_id, panel_id, widget_type, display_name, position_snapshot, state_snapshot, device_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (widget_id) DO UPDATE SET
         panel_id = EXCLUDED.panel_id,
         widget_type = EXCLUDED.widget_type,
         display_name = EXCLUDED.display_name,
         position_snapshot = EXCLUDED.position_snapshot,
         state_snapshot = EXCLUDED.state_snapshot,
         device_id = EXCLUDED.device_id,
         updated_at = EXCLUDED.updated_at
       RETURNING *`,
      [
        body.id,
        body.widgetId,
        body.panelId,
        body.widgetType,
        body.displayName,
        JSON.stringify(body.positionSnapshot || {}),
        JSON.stringify(body.stateSnapshot || {}),
        req.deviceId || null,
        now, now,
      ]
    )
    const favorite = parseFavoriteRow(result.rows[0])
    res.status(201).json(favorite)
    broadcastChange({ kind: 'favorite_added', data: favorite }, req.deviceId)
  } catch (e) { next(e) }
})

// DELETE /api/favorites/by-widget/:widgetId - 按 widgetId 删除（widget 删除联动）
// 注：必须放在 :id 路由之前，否则 by-widget 会被当作 :id 匹配
favoritesRouter.delete('/by-widget/:widgetId', async (req, res, next) => {
  try {
    const pool = getPool()
    const result = await pool.query('DELETE FROM favorited_widgets WHERE widget_id = $1 RETURNING *', [req.params.widgetId])
    if (result.rowCount === 0) return res.status(404).json({ error: 'not found' })
    const favorite = parseFavoriteRow(result.rows[0])
    res.json({ ok: true })
    broadcastChange({ kind: 'favorite_removed', data: favorite }, req.deviceId)
  } catch (e) { next(e) }
})

// DELETE /api/favorites/by-panel/:panelId - 按 panelId 删除（面板删除联动）
favoritesRouter.delete('/by-panel/:panelId', async (req, res, next) => {
  try {
    const pool = getPool()
    await pool.query('DELETE FROM favorited_widgets WHERE panel_id = $1', [req.params.panelId])
    res.json({ ok: true })
    broadcastChange({ kind: 'favorite_panel_cleared', data: { panelId: req.params.panelId } }, req.deviceId)
  } catch (e) { next(e) }
})

// DELETE /api/favorites/:id - 按 id 删除
favoritesRouter.delete('/:id', async (req, res, next) => {
  try {
    const pool = getPool()
    const result = await pool.query('DELETE FROM favorited_widgets WHERE id = $1 RETURNING *', [req.params.id])
    if (result.rowCount === 0) return res.status(404).json({ error: 'not found' })
    const favorite = parseFavoriteRow(result.rows[0])
    res.json({ ok: true })
    broadcastChange({ kind: 'favorite_removed', data: favorite }, req.deviceId)
  } catch (e) { next(e) }
})

function parseFavoriteRow(r: any) {
  return {
    id: r.id,
    widgetId: r.widget_id,
    panelId: r.panel_id,
    widgetType: r.widget_type,
    displayName: r.display_name,
    positionSnapshot: r.position_snapshot,
    stateSnapshot: r.state_snapshot || {},
    createdAt: r.created_at,
  }
}
