import { Router } from 'express'
import { getPool } from '../db/connection.js'
import { requireAdmin } from '../middleware/auth.js'

export const exportRouter = Router()

// 【安全修复 2026-08-16（C1）】：全库导出（含 entities/webos_state）仅管理员可用
// GET /api/export
exportRouter.get('/', requireAdmin, async (_req, res, next) => {
  try {
    const pool = getPool()

    const panelsResult = await pool.query('SELECT * FROM panels ORDER BY sort_order ASC')
    const widgetsResult = await pool.query('SELECT * FROM widgets ORDER BY z_index ASC')
    const entitiesResult = await pool.query('SELECT * FROM entities ORDER BY created_at DESC')
    const relationsResult = await pool.query('SELECT * FROM entity_relations ORDER BY created_at DESC')
    const settingsResult = await pool.query('SELECT * FROM settings')
    const dynamicWidgetsResult = await pool.query('SELECT * FROM dynamic_widgets')
    const templatesResult = await pool.query('SELECT * FROM panel_templates')

    const panels = panelsResult.rows.map(parsePanel)
    const widgets = widgetsResult.rows.map(parseWidget)
    const entities = entitiesResult.rows.map(parseEntity)
    const relations = relationsResult.rows.map(parseRelation)
    const settingsRows = settingsResult.rows as { key: string; value: unknown }[]
    const dynamicWidgets = dynamicWidgetsResult.rows.map(parseDynamicWidget)
    const templates = templatesResult.rows.map(parseTemplate)

    const settings: Record<string, unknown> = {}
    for (const row of settingsRows) {
      if (row.key === 'activePanelId') continue
      settings[row.key] = row.value
    }

    const activePanelRow = settingsRows.find(r => r.key === 'activePanelId')

    res.json({
      version: 8,
      schema: 'daily-sqlite-v1',
      exportedAt: new Date().toISOString(),
      panels,
      widgets,
      entities,
      relations,
      settings,
      activePanelId: activePanelRow ? activePanelRow.value : null,
      dynamicWidgets,
      panelTemplates: templates,
    })
  } catch (e) { next(e) }
})

function parsePanel(row: any) {
  return {
    id: row.id, name: row.name, sortOrder: row.sort_order,
    settings: row.settings || {},
    canvasTransform: row.canvas_transform || null,
    createdAt: row.created_at, updatedAt: row.updated_at,
  }
}

function parseWidget(row: any) {
  return {
    id: row.id, panelId: row.panel_id, type: row.type,
    x: row.x, y: row.y, width: row.width, height: row.height, zIndex: row.z_index,
    minimized: row.minimized, locked: row.locked,
    colorScheme: row.color_scheme, state: row.state || {},
    isPrimary: row.is_primary,
    createdAt: row.created_at, updatedAt: row.updated_at,
  }
}

function parseEntity(row: any) {
  return {
    id: row.id, type: row.type, scope: row.scope,
    panelId: row.panel_id, widgetId: row.widget_id,
    data: row.data || {}, recordStatus: row.record_status,
    createdAt: row.created_at, updatedAt: row.updated_at,
  }
}

function parseRelation(row: any) {
  return {
    id: row.id, sourceId: row.source_id, targetId: row.target_id,
    type: row.type, metadata: row.metadata || {},
    createdAt: row.created_at,
  }
}

function parseDynamicWidget(row: any) {
  return {
    widgetType: row.widget_type, displayName: row.display_name, icon: row.icon,
    defaultLayout: row.default_layout || {},
    defaultState: row.default_state || {},
    code: row.code, createdAt: row.created_at, updatedAt: row.updated_at,
  }
}

function parseTemplate(row: any) {
  return {
    id: row.id, name: row.name, icon: row.icon, description: row.description,
    widgets: row.widgets || [], isBuiltin: row.is_builtin,
    createdAt: row.created_at, updatedAt: row.updated_at,
  }
}
