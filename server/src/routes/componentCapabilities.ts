// ============================================================================
// Phase 14.4.3：组件能力声明 CRUD API（spec 14.4.3 节）
// 5 个端点：GET / GET/:widgetType / POST (upsert) / PUT/:widgetType / DELETE/:widgetType
// ============================================================================

import { Router } from 'express'
import { getPool } from '../db/connection.js'
import { broadcastChange } from '../ws.js'
import { rowToCapability } from '../utils/capabilityTypes.js'
import type { ComponentCapability } from '../types/componentCapability.js'

export const componentCapabilitiesRouter = Router()

/**
 * 将 ComponentCapability（camelCase）转为数据库行参数（snake_case）
 */
function capabilityToRow(cap: ComponentCapability) {
  return {
    widget_type: cap.widgetType,
    display_name: cap.displayName,
    description: cap.description,
    api: JSON.stringify(cap.api ?? []),
    dependencies: cap.dependencies ?? [],
    version: cap.version ?? '1.0.0',
    component_env: cap.componentEnv ?? 'pure-frontend',
    cross_platform: cap.crossPlatform ?? true,
    desktop_only: cap.desktopOnly ?? false,
  }
}

// ---------------------------------------------------------------------------
// GET /api/component-capabilities —— 列出所有组件能力
// ---------------------------------------------------------------------------
componentCapabilitiesRouter.get('/', async (_req, res) => {
  try {
    const pool = getPool()
    const result = await pool.query(
      'SELECT * FROM component_capabilities ORDER BY widget_type',
    )
    res.json(result.rows.map((r: any) => rowToCapability(r)))
  } catch (err) {
    console.error('[component-capabilities] GET / failed:', err)
    res.status(500).json({ error: 'internal server error', detail: String(err) })
  }
})

// ---------------------------------------------------------------------------
// GET /api/component-capabilities/:widgetType —— 获取单个组件能力
// ---------------------------------------------------------------------------
componentCapabilitiesRouter.get('/:widgetType', async (req, res) => {
  try {
    const pool = getPool()
    const result = await pool.query(
      'SELECT * FROM component_capabilities WHERE widget_type = $1',
      [req.params.widgetType],
    )
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'not found' })
    }
    res.json(rowToCapability(result.rows[0] as any))
  } catch (err) {
    console.error('[component-capabilities] GET /:widgetType failed:', err)
    res.status(500).json({ error: 'internal server error', detail: String(err) })
  }
})

// ---------------------------------------------------------------------------
// POST /api/component-capabilities —— 创建/更新（upsert）
// 客户端组件自注册时调用此端点
// ---------------------------------------------------------------------------
componentCapabilitiesRouter.post('/', async (req, res) => {
  try {
    const pool = getPool()
    const now = Date.now()
    const body = req.body as Partial<ComponentCapability>

    // 基础校验：widgetType 与 displayName 必填
    if (!body.widgetType || typeof body.widgetType !== 'string') {
      return res.status(400).json({ error: 'widgetType is required' })
    }
    if (!body.displayName || typeof body.displayName !== 'string') {
      return res.status(400).json({ error: 'displayName is required' })
    }

    const cap: ComponentCapability = {
      widgetType: body.widgetType,
      displayName: body.displayName,
      description: body.description ?? '',
      api: body.api ?? [],
      dependencies: body.dependencies ?? [],
      version: body.version ?? '1.0.0',
      componentEnv: body.componentEnv ?? 'pure-frontend',
      crossPlatform: body.crossPlatform ?? true,
      desktopOnly: body.desktopOnly ?? false,
    }
    const row = capabilityToRow(cap)

    await pool.query(
      `INSERT INTO component_capabilities
        (widget_type, display_name, description, api, dependencies, version,
         component_env, cross_platform, desktop_only, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (widget_type) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         description = EXCLUDED.description,
         api = EXCLUDED.api,
         dependencies = EXCLUDED.dependencies,
         version = EXCLUDED.version,
         component_env = EXCLUDED.component_env,
         cross_platform = EXCLUDED.cross_platform,
         desktop_only = EXCLUDED.desktop_only,
         updated_at = EXCLUDED.updated_at`,
      [
        row.widget_type,
        row.display_name,
        row.description,
        row.api,
        row.dependencies,
        row.version,
        row.component_env,
        row.cross_platform,
        row.desktop_only,
        now,
        now,
      ],
    )

    const created: ComponentCapability = { ...cap }
    broadcastChange(
      { kind: 'component_capability_upserted', data: created },
      req.deviceId,
    )
    res.status(201).json(created)
  } catch (err) {
    console.error('[component-capabilities] POST / failed:', err)
    res.status(500).json({ error: 'internal server error', detail: String(err) })
  }
})

// ---------------------------------------------------------------------------
// PUT /api/component-capabilities/:widgetType —— 更新（部分字段）
// ---------------------------------------------------------------------------
componentCapabilitiesRouter.put('/:widgetType', async (req, res) => {
  try {
    const pool = getPool()
    const widgetType = req.params.widgetType
    const existing = await pool.query(
      'SELECT * FROM component_capabilities WHERE widget_type = $1',
      [widgetType],
    )
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'not found' })
    }

    const now = Date.now()
    const body = req.body as Partial<ComponentCapability>
    const updates: string[] = []
    const values: unknown[] = []
    let paramIdx = 1

    if (body.displayName !== undefined) {
      updates.push(`display_name = $${paramIdx++}`)
      values.push(body.displayName)
    }
    if (body.description !== undefined) {
      updates.push(`description = $${paramIdx++}`)
      values.push(body.description)
    }
    if (body.api !== undefined) {
      updates.push(`api = $${paramIdx++}`)
      values.push(JSON.stringify(body.api))
    }
    if (body.dependencies !== undefined) {
      updates.push(`dependencies = $${paramIdx++}`)
      values.push(body.dependencies)
    }
    if (body.version !== undefined) {
      updates.push(`version = $${paramIdx++}`)
      values.push(body.version)
    }
    if (body.componentEnv !== undefined) {
      updates.push(`component_env = $${paramIdx++}`)
      values.push(body.componentEnv)
    }
    if (body.crossPlatform !== undefined) {
      updates.push(`cross_platform = $${paramIdx++}`)
      values.push(body.crossPlatform)
    }
    if (body.desktopOnly !== undefined) {
      updates.push(`desktop_only = $${paramIdx++}`)
      values.push(body.desktopOnly)
    }

    if (updates.length > 0) {
      updates.push(`updated_at = $${paramIdx++}`)
      values.push(now)
      values.push(widgetType)
      await pool.query(
        `UPDATE component_capabilities SET ${updates.join(', ')} WHERE widget_type = $${paramIdx}`,
        values,
      )
    }

    const result = await pool.query(
      'SELECT * FROM component_capabilities WHERE widget_type = $1',
      [widgetType],
    )
    const updated = rowToCapability(result.rows[0] as any)
    broadcastChange(
      { kind: 'component_capability_updated', data: updated },
      req.deviceId,
    )
    res.json(updated)
  } catch (err) {
    console.error('[component-capabilities] PUT /:widgetType failed:', err)
    res.status(500).json({ error: 'internal server error', detail: String(err) })
  }
})

// ---------------------------------------------------------------------------
// DELETE /api/component-capabilities/:widgetType —— 删除
// ---------------------------------------------------------------------------
componentCapabilitiesRouter.delete('/:widgetType', async (req, res) => {
  try {
    const pool = getPool()
    const result = await pool.query(
      'DELETE FROM component_capabilities WHERE widget_type = $1',
      [req.params.widgetType],
    )
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'not found' })
    }
    broadcastChange(
      { kind: 'component_capability_deleted', data: { widgetType: req.params.widgetType } },
      req.deviceId,
    )
    res.json({ ok: true })
  } catch (err) {
    console.error('[component-capabilities] DELETE /:widgetType failed:', err)
    res.status(500).json({ error: 'internal server error', detail: String(err) })
  }
})
