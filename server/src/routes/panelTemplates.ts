import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { getPool } from '../db/connection.js'
import { broadcastChange } from '../ws.js'

export const panelTemplatesRouter = Router()

// GET /api/panel-templates
panelTemplatesRouter.get('/', async (_req, res, next) => {
  try {
    const pool = getPool()
    const result = await pool.query('SELECT * FROM panel_templates ORDER BY created_at')
    res.json(result.rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      icon: r.icon,
      description: r.description,
      widgets: r.widgets || [],
      isBuiltin: r.is_builtin,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })))
  } catch (e) { next(e) }
})

// POST /api/panel-templates
panelTemplatesRouter.post('/', async (req, res, next) => {
  try {
    const pool = getPool()
    const id = req.body.id || uuidv4()
    const now = Date.now()
    await pool.query(
      `INSERT INTO panel_templates (id, name, icon, description, widgets, is_builtin, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id, req.body.name, req.body.icon || 'layout',
        req.body.description || '',
        JSON.stringify(req.body.widgets || []),
        req.body.isBuiltin ?? false, now, now
      ]
    )
    const result = await pool.query('SELECT * FROM panel_templates WHERE id = $1', [id])
    const row = result.rows[0] as any
    const template = {
      id: row.id, name: row.name, icon: row.icon,
      description: row.description,
      widgets: row.widgets || [], isBuiltin: row.is_builtin,
      createdAt: row.created_at, updatedAt: row.updated_at,
    }
    broadcastChange({ kind: 'panel_template_created', data: template }, req.deviceId)
    res.status(201).json(template)
  } catch (e) { next(e) }
})

// DELETE /api/panel-templates/:id
panelTemplatesRouter.delete('/:id', async (req, res, next) => {
  try {
    const pool = getPool()
    const result = await pool.query('DELETE FROM panel_templates WHERE id = $1', [req.params.id])
    if (result.rowCount === 0) return res.status(404).json({ error: 'not found' })
    broadcastChange({ kind: 'panel_template_deleted', data: { id: req.params.id } }, req.deviceId)
    res.json({ ok: true })
  } catch (e) { next(e) }
})
