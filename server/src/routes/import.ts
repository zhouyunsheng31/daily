import { Router } from 'express'
import { getPool, withTransaction } from '../db/connection.js'
import { createError } from '../middleware/error.js'
import { broadcastChange } from '../ws.js'
import { v4 as uuidv4 } from 'uuid'

export const importRouter = Router()

// POST /api/import/idb — 从 IndexedDB 导出格式导入（兼容迁移）
importRouter.post('/idb', async (req, res, next) => {
  try {
    const pool = getPool()
    const data = req.body

    if (!data || !data.panels) {
      throw createError(400, 'INVALID_DATA', 'Missing panels array in import data')
    }

    const now = Date.now()
    const report = { imported: {} as Record<string, number>, errors: [] as string[] }

    await withTransaction(async (client) => {
      // 清空现有数据
      await client.query('DELETE FROM entity_relations')
      await client.query('DELETE FROM entities')
      await client.query('DELETE FROM widgets')
      await client.query('DELETE FROM panels')
      await client.query('DELETE FROM settings')
      await client.query('DELETE FROM dynamic_widgets')
      await client.query('DELETE FROM panel_templates')

      // 导入面板
      let panelCount = 0
      for (const pd of data.panels) {
        const p = pd.panel || pd
        if (!p.id) continue
        await client.query(
          `INSERT INTO panels (id, name, sort_order, settings, canvas_transform, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING`,
          [
            p.id, p.name || '未命名', p.order ?? 0,
            JSON.stringify(p.settings ?? {}),
            p.canvasTransform ? JSON.stringify(p.canvasTransform) : null,
            now, now
          ]
        )
        panelCount++
      }
      report.imported['panels'] = panelCount

      // 导入组件
      let widgetCount = 0
      for (const pd of data.panels) {
        const panelId = pd.panel?.id || pd.id
        const widgets = pd.widgets || []
        const positions = pd.positions || []
        const posMap = new Map(positions.map((p: any) => [p.widgetId, p]))

        for (const w of widgets) {
          if (!w.widgetId) continue
          const pos = posMap.get(w.widgetId) as any
          await client.query(
            `INSERT INTO widgets (id, panel_id, type, x, y, width, height, z_index, minimized, locked, color_scheme, state, is_primary, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) ON CONFLICT (id) DO NOTHING`,
            [
              w.widgetId, panelId, w.widgetType || 'unknown',
              pos?.x ?? 0, pos?.y ?? 0, pos?.w ?? 300, pos?.h ?? 200, pos?.zIndex ?? 0,
              w.minimized ?? false, w.locked ?? false, w.colorScheme ?? null,
              JSON.stringify(w.state ?? {}),
              w.isPrimary ?? false,
              now, now
            ]
          )
          widgetCount++
        }
      }
      report.imported['widgets'] = widgetCount

      // 导入实体数据
      const entityMappings: Array<{ key: string; type: string; items: any[] }> = [
        { key: 'tasks', type: 'task', items: data.tasks || [] },
        { key: 'focusSessions', type: 'focusSession', items: data.focusSessions || [] },
        { key: 'habits', type: 'habit', items: data.habits || [] },
        { key: 'habitCheckins', type: 'habitCheckin', items: data.habitCheckins || [] },
        { key: 'moodEntries', type: 'moodEntry', items: data.moodEntries || [] },
        { key: 'calendarEvents', type: 'calendarEvent', items: data.calendarEvents || [] },
        { key: 'drawingStrokes', type: 'drawingStroke', items: data.drawingStrokes || [] },
        { key: 'widgetConnections', type: 'widgetConnection', items: data.widgetConnections || [] },
        { key: 'quizSessions', type: 'quizSession', items: data.quizSessions || [] },
        { key: 'notes', type: 'note', items: data.notes || [] },
        { key: 'journals', type: 'journal', items: data.journals || [] },
        { key: 'quickNotes', type: 'quickNote', items: data.quickNotes || [] },
        { key: 'savingsGoals', type: 'savingsGoal', items: data.savingsGoals || [] },
        { key: 'savingsTransactions', type: 'savingsTransaction', items: data.savingsTransactions || [] },
        { key: 'aiConversations', type: 'aiConversation', items: data.aiConversations || [] },
        { key: 'aiMemories', type: 'aiMemory', items: data.aiMemories || [] },
        { key: 'aiAuditLogs', type: 'aiAuditLog', items: data.aiAuditLogs || [] },
        { key: 'vocabDecks', type: 'vocabDeck', items: data.vocabDecks || [] },
        { key: 'vocabProgress', type: 'vocabProgress', items: data.vocabProgress || [] },
        { key: 'sudokuGames', type: 'sudokuGame', items: data.sudokuGames || [] },
        { key: 'mistakes', type: 'mistake', items: data.mistakes || [] },
        { key: 'playlists', type: 'playlist', items: data.playlists || [] },
      ]

      let totalEntities = 0
      for (const mapping of entityMappings) {
        let count = 0
        for (const item of mapping.items) {
          let entityId: string
          let widgetIdForField: string | null = null
          if (mapping.type === 'playlist') {
            entityId = item.widgetId
            widgetIdForField = item.widgetId || null
          } else {
            entityId = item.id
            if (!entityId) continue
          }
          const { id: _id, panelId, ...rest } = item
          const dataJson = mapping.type === 'playlist'
            ? JSON.stringify({ ...rest, widgetId: item.widgetId })
            : JSON.stringify(rest)
          await client.query(
            `INSERT INTO entities (id, type, scope, panel_id, widget_id, data, record_status, created_at, updated_at)
             VALUES ($1, $2, 'default', $3, $4, $5, 'active', $6, $7) ON CONFLICT (id) DO NOTHING`,
            [entityId, mapping.type, panelId || null, widgetIdForField || null, dataJson, now, now]
          )
          count++
        }
        report.imported[mapping.key] = count
        totalEntities += count
      }
      report.imported['totalEntities'] = totalEntities

      // 导入设置
      if (data.settings) {
        if (data.settings.appearance) {
          await client.query(
            `INSERT INTO settings (key, value, updated_at) VALUES ('appearance', $1, $2)
             ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = $2`,
            [JSON.stringify(data.settings.appearance), now]
          )
        }
        if (data.settings.behavior) {
          await client.query(
            `INSERT INTO settings (key, value, updated_at) VALUES ('behavior', $1, $2)
             ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = $2`,
            [JSON.stringify(data.settings.behavior), now]
          )
        }
        report.imported['settings'] = 1
      }

      // 导入 activePanelId
      if (data.activePanelId) {
        await client.query(
          `INSERT INTO settings (key, value, updated_at) VALUES ('activePanelId', $1, $2)
           ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = $2`,
          [JSON.stringify(data.activePanelId), now]
        )
      }

      // 导入动态组件
      let dwCount = 0
      for (const dw of (data.dynamicWidgets || [])) {
        if (!dw.widgetType) continue
        await client.query(
          `INSERT INTO dynamic_widgets (widget_type, display_name, icon, default_layout, default_state, code, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (widget_type) DO NOTHING`,
          [
            dw.widgetType, dw.displayName || '', dw.icon || 'box',
            JSON.stringify(dw.defaultLayout ?? {}), JSON.stringify(dw.defaultState ?? {}),
            dw.code || '', now, now
          ]
        )
        dwCount++
      }
      report.imported['dynamicWidgets'] = dwCount

      // 导入 panelTemplates
      let ptCount = 0
      for (const pt of (data.panelTemplates || [])) {
        await client.query(
          `INSERT INTO panel_templates (id, name, icon, description, widgets, is_builtin, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING`,
          [
            pt.id || uuidv4(), pt.name || '', pt.icon || 'layout',
            pt.description || '', JSON.stringify(pt.widgets ?? []),
            pt.isBuiltin ?? false, now, now
          ]
        )
        ptCount++
      }
      report.imported['panelTemplates'] = ptCount
    })

    broadcastChange({ kind: 'data_imported', data: report }, req.deviceId)
    res.json(report)
  } catch (e) { next(e) }
})

// POST /api/import — 从新格式导入
importRouter.post('/', async (req, res, next) => {
  try {
    const pool = getPool()
    const data = req.body

    if (!data || data.schema !== 'daily-sqlite-v1') {
      throw createError(400, 'INVALID_DATA', 'Invalid import format')
    }

    const now = Date.now()
    const report = { imported: {} as Record<string, number> }

    await withTransaction(async (client) => {
      // 清空
      await client.query('DELETE FROM entity_relations')
      await client.query('DELETE FROM entities')
      await client.query('DELETE FROM widgets')
      await client.query('DELETE FROM panels')
      await client.query('DELETE FROM settings')
      await client.query('DELETE FROM dynamic_widgets')
      await client.query('DELETE FROM panel_templates')

      // Panels
      for (const p of (data.panels || [])) {
        await client.query(
          `INSERT INTO panels (id, name, sort_order, settings, canvas_transform, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING`,
          [
            p.id, p.name, p.sortOrder ?? 0,
            JSON.stringify(p.settings ?? {}), p.canvasTransform ? JSON.stringify(p.canvasTransform) : null,
            p.createdAt || now, p.updatedAt || now
          ]
        )
      }
      report.imported['panels'] = (data.panels || []).length

      // Widgets
      for (const w of (data.widgets || [])) {
        await client.query(
          `INSERT INTO widgets (id, panel_id, type, x, y, width, height, z_index, minimized, locked, color_scheme, state, is_primary, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) ON CONFLICT (id) DO NOTHING`,
          [
            w.id, w.panelId, w.type, w.x, w.y, w.width, w.height, w.zIndex,
            w.minimized ?? false, w.locked ?? false, w.colorScheme ?? null,
            JSON.stringify(w.state ?? {}),
            w.isPrimary ?? false,
            w.createdAt || now, w.updatedAt || now
          ]
        )
      }
      report.imported['widgets'] = (data.widgets || []).length

      // Entities
      for (const e of (data.entities || [])) {
        await client.query(
          `INSERT INTO entities (id, type, scope, panel_id, widget_id, data, record_status, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (id) DO NOTHING`,
          [
            e.id, e.type, e.scope || 'default', e.panelId ?? null, e.widgetId ?? null,
            JSON.stringify(e.data ?? {}), e.recordStatus || 'active',
            e.createdAt || now, e.updatedAt || now
          ]
        )
      }
      report.imported['entities'] = (data.entities || []).length

      // Relations
      for (const r of (data.relations || [])) {
        await client.query(
          `INSERT INTO entity_relations (id, source_id, target_id, type, metadata, created_at)
           VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
          [r.id, r.sourceId, r.targetId, r.type, JSON.stringify(r.metadata ?? {}), r.createdAt || now]
        )
      }
      report.imported['relations'] = (data.relations || []).length

      // Settings
      if (data.settings) {
        for (const [key, val] of Object.entries(data.settings)) {
          await client.query(
            `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, $3)
             ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = $3`,
            [key, JSON.stringify(val), now]
          )
        }
      }
      if (data.activePanelId) {
        await client.query(
          `INSERT INTO settings (key, value, updated_at) VALUES ('activePanelId', $1, $2)
           ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = $2`,
          [JSON.stringify(data.activePanelId), now]
        )
      }

      // Dynamic widgets
      for (const dw of (data.dynamicWidgets || [])) {
        await client.query(
          `INSERT INTO dynamic_widgets (widget_type, display_name, icon, default_layout, default_state, code, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (widget_type) DO NOTHING`,
          [
            dw.widgetType, dw.displayName, dw.icon,
            JSON.stringify(dw.defaultLayout ?? {}), JSON.stringify(dw.defaultState ?? {}),
            dw.code, dw.createdAt || now, dw.updatedAt || now
          ]
        )
      }

      // Panel templates
      for (const pt of (data.panelTemplates || [])) {
        await client.query(
          `INSERT INTO panel_templates (id, name, icon, description, widgets, is_builtin, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING`,
          [
            pt.id, pt.name, pt.icon || 'layout',
            pt.description || '', JSON.stringify(pt.widgets ?? []),
            pt.isBuiltin ?? false, pt.createdAt || now, pt.updatedAt || now
          ]
        )
      }
    })

    broadcastChange({ kind: 'data_imported', data: report }, req.deviceId)
    res.json(report)
  } catch (e) { next(e) }
})
