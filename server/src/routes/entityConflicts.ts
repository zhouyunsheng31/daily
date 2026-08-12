import { Router } from 'express'
import { getPool } from '../db/connection.js'
import { createError } from '../middleware/error.js'
import type { EntityConflictLog, EntityConflictResolveAction } from '../types/index.js'

// ============================================================================
// Phase S3 缺口 A：实体冲突日志查询 / 解决 API（spec 2.1.4 节）
// 挂载在 /api/entities/conflicts，走 /api 全局 authMiddleware（继承）
//
// - GET    /                          查询冲突列表（?entityType= 过滤、?resolved=true 包含已解决）
// - GET    /:id                       查询单个冲突详情
// - POST   /:id/resolve               解决冲突（body: { action, mergedState? }）
// ============================================================================

export const entityConflictsRouter = Router()

// GET /api/entities/conflicts — 查询冲突日志列表
entityConflictsRouter.get('/', async (req, res, next) => {
  try {
    const pool = getPool()
    const params = req.query as Record<string, string | undefined>
    const conditions: string[] = []
    const values: unknown[] = []
    let paramIdx = 1

    if (params.entityType) {
      conditions.push(`entity_type = $${paramIdx++}`)
      values.push(params.entityType)
    }
    if (params.entityId) {
      conditions.push(`entity_id = $${paramIdx++}`)
      values.push(params.entityId)
    }
    if (params.panelId) {
      conditions.push(`panel_id = $${paramIdx++}`)
      values.push(params.panelId)
    }
    // 默认行为：未传 resolved 参数时返回全部（含已解决 + 未解决）
    // 显式传 resolved=true/false 时按值过滤
    if (params.resolved !== undefined) {
      conditions.push(`resolved = $${paramIdx++}`)
      values.push(params.resolved === 'true')
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const limit = Math.min(Math.max(parseInt(String(params.limit || '100'), 10), 1), 1000)
    const offset = Math.max(parseInt(String(params.offset || '0'), 10), 0)

    const dataResult = await pool.query(
      `SELECT * FROM entity_conflict_logs ${where} ORDER BY created_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      [...values, limit, offset],
    )
    const countResult = await pool.query(
      `SELECT COUNT(*) as count FROM entity_conflict_logs ${where}`,
      values,
    )

    res.json({
      conflicts: dataResult.rows.map(parseEntityConflictLogRow),
      total: parseInt(String(countResult.rows[0].count), 10),
      limit,
      offset,
    })
  } catch (e) { next(e) }
})

// GET /api/entities/conflicts/:id — 查询单个冲突详情
entityConflictsRouter.get('/:id', async (req, res, next) => {
  try {
    const pool = getPool()
    const result = await pool.query('SELECT * FROM entity_conflict_logs WHERE id = $1', [req.params.id])
    if (result.rows.length === 0) {
      throw createError(404, 'NOT_FOUND', `Conflict log ${req.params.id} not found`)
    }
    res.json({ conflict: parseEntityConflictLogRow(result.rows[0]) })
  } catch (e) { next(e) }
})

// POST /api/entities/conflicts/:id/resolve — 解决冲突
// body: { action: 'keep-local' | 'keep-remote' | 'merge', mergedState?: unknown }
entityConflictsRouter.post('/:id/resolve', async (req, res, next) => {
  try {
    const pool = getPool()
    const body = req.body as { action?: string; mergedState?: unknown }
    const validActions: EntityConflictResolveAction[] = ['keep-local', 'keep-remote', 'merge']
    if (!body.action || !validActions.includes(body.action as EntityConflictResolveAction)) {
      throw createError(
        400,
        'INVALID_PARAMS',
        `action must be one of: keep-local, keep-remote, merge`,
      )
    }
    const action = body.action as EntityConflictResolveAction
    // mergedState 当前仅作为客户端意图记录，不应用到 entity（如需应用，客户端应单独调 PUT /api/entities/:id）
    // 此处接受但暂不持久化（schema 无 merged_state 列）；保留参数供后续扩展
    const _mergedState = body.mergedState
    void _mergedState

    const now = Date.now()
    const result = await pool.query(
      `UPDATE entity_conflict_logs
       SET resolved = TRUE, resolved_action = $1, resolved_at = $2
       WHERE id = $3 RETURNING *`,
      [action, now, req.params.id],
    )

    if (result.rows.length === 0) {
      throw createError(404, 'NOT_FOUND', `Conflict log ${req.params.id} not found`)
    }

    const conflict = parseEntityConflictLogRow(result.rows[0])
    res.json({ ok: true, conflict })
  } catch (e) { next(e) }
})

function parseEntityConflictLogRow(row: any): EntityConflictLog {
  return {
    id: row.id,
    entityId: row.entity_id,
    entityType: row.entity_type,
    panelId: row.panel_id,
    localVersion: row.local_version,
    remoteVersion: row.remote_version,
    localState: row.local_state,
    remoteState: row.remote_state,
    sourceDeviceId: row.source_device_id,
    resolved: row.resolved,
    resolvedAction: row.resolved_action,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
  }
}
