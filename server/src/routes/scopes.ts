import { Router } from 'express'
import { getPool, withTransaction } from '../db/connection.js'
import { createError } from '../middleware/error.js'
import { requireAdmin } from '../middleware/auth.js'
import { broadcastChange } from '../ws.js'

export const scopesRouter = Router()

// 【安全修复 2026-08-16（C1）】：scope 操作可跨用户移动/合并任意实体，
// 且 GET /api/scopes 会枚举全部用户 scope（泄露 user:*/guest:* 身份）。
// 全部改为 requireAdmin——旧桌面端如需 scope 管理，由管理员操作。

// GET /api/scopes — 列出所有 scope（去重）【仅管理员】
scopesRouter.get('/', requireAdmin, async (_req, res, next) => {
  try {
    const pool = getPool()
    const result = await pool.query('SELECT DISTINCT scope FROM entities ORDER BY scope')
    res.json(result.rows.map((r: { scope: string }) => r.scope))
  } catch (e) { next(e) }
})

// PUT /api/scopes/entity/:id — 修改实体所属 scope【仅管理员】
scopesRouter.put('/entity/:id', requireAdmin, async (req, res, next) => {
  try {
    const pool = getPool()
    const { scope } = req.body as { scope: string }
    if (!scope) throw createError(400, 'MISSING_SCOPE', 'scope is required')

    const existing = await pool.query('SELECT * FROM entities WHERE id = $1', [req.params.id])
    if (existing.rows.length === 0) throw createError(404, 'NOT_FOUND', `Entity ${req.params.id} not found`)

    await pool.query('UPDATE entities SET scope = $1, updated_at = $2 WHERE id = $3', [scope, Date.now(), req.params.id])
    res.json({ ok: true })
    broadcastChange({ kind: 'entity_updated', data: { id: req.params.id, scope } }, req.deviceId)
  } catch (e) { next(e) }
})

// POST /api/scopes/merge — 合并 scope【仅管理员】
scopesRouter.post('/merge', requireAdmin, async (req, res, next) => {
  try {
    const pool = getPool()
    const { fromScope, toScope } = req.body as { fromScope: string; toScope: string }
    if (!fromScope || !toScope) throw createError(400, 'MISSING_PARAMS', 'fromScope and toScope are required')
    if (fromScope === toScope) throw createError(400, 'SAME_SCOPE', 'fromScope and toScope must be different')

    const result = await pool.query('UPDATE entities SET scope = $1, updated_at = $2 WHERE scope = $3', [toScope, Date.now(), fromScope])

    res.json({ ok: true, moved: result.rowCount })
    broadcastChange({ kind: 'entity_updated', data: { fromScope, toScope } }, req.deviceId)
  } catch (e) { next(e) }
})

// POST /api/scopes/split — 拆分 scope【仅管理员】
scopesRouter.post('/split', requireAdmin, async (req, res, next) => {
  try {
    const pool = getPool()
    const { entityIds, newScope } = req.body as { entityIds: string[]; newScope: string }
    if (!entityIds?.length || !newScope) throw createError(400, 'MISSING_PARAMS', 'entityIds and newScope are required')

    const now = Date.now()
    await withTransaction(async (client) => {
      for (const id of entityIds) {
        await client.query('UPDATE entities SET scope = $1, updated_at = $2 WHERE id = $3', [newScope, now, id])
      }
    })

    res.json({ ok: true, moved: entityIds.length })
    broadcastChange({ kind: 'entity_updated', data: { entityIds, newScope } }, req.deviceId)
  } catch (e) { next(e) }
})
