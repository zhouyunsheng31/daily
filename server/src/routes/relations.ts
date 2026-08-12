import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { getPool } from '../db/connection.js'
import { createError } from '../middleware/error.js'
import { broadcastChange } from '../ws.js'
import type { CreateRelationRequest, RelationQueryParams } from '../types/index.js'

export const relationsRouter = Router()

// GET /api/relations
relationsRouter.get('/', async (req, res, next) => {
  try {
    const pool = getPool()
    const params = req.query as unknown as RelationQueryParams
    const conditions: string[] = []
    const values: unknown[] = []
    let paramIdx = 1

    if (params.sourceId) { conditions.push(`source_id = $${paramIdx++}`); values.push(params.sourceId) }
    if (params.targetId) { conditions.push(`target_id = $${paramIdx++}`); values.push(params.targetId) }
    if (params.type) { conditions.push(`type = $${paramIdx++}`); values.push(params.type) }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const result = await pool.query(`SELECT * FROM entity_relations ${where} ORDER BY created_at DESC`, values)
    res.json(result.rows.map(parseRelationRow))
  } catch (e) { next(e) }
})

// POST /api/relations
relationsRouter.post('/', async (req, res, next) => {
  try {
    const pool = getPool()
    const body = req.body as CreateRelationRequest
    const id = body.id || uuidv4()
    const now = Date.now()

    await pool.query(
      'INSERT INTO entity_relations (id, source_id, target_id, type, metadata, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
      [id, body.sourceId, body.targetId, body.type, JSON.stringify(body.metadata ?? {}), now]
    )
    const result = await pool.query('SELECT * FROM entity_relations WHERE id = $1', [id])
    const relation = parseRelationRow(result.rows[0])
    broadcastChange({ kind: 'relation_created', data: relation }, req.deviceId)
    res.status(201).json(relation)
  } catch (e) { next(e) }
})

// DELETE /api/relations/:id
relationsRouter.delete('/:id', async (req, res, next) => {
  try {
    const pool = getPool()
    const result = await pool.query('DELETE FROM entity_relations WHERE id = $1', [req.params.id])
    if (result.rowCount === 0) throw createError(404, 'NOT_FOUND', `Relation ${req.params.id} not found`)
    broadcastChange({ kind: 'relation_deleted', data: { id: req.params.id } }, req.deviceId)
    res.json({ ok: true })
  } catch (e) { next(e) }
})

// GET /api/relations/entity/:id
relationsRouter.get('/entity/:id', async (req, res, next) => {
  try {
    const pool = getPool()
    const result = await pool.query(
      'SELECT * FROM entity_relations WHERE source_id = $1 OR target_id = $1 ORDER BY created_at DESC',
      [req.params.id]
    )
    res.json(result.rows.map(parseRelationRow))
  } catch (e) { next(e) }
})

// GET /api/relations/entity/:id/connected — 获取关联实体（支持深度）
relationsRouter.get('/entity/:id/connected', async (req, res, next) => {
  try {
    const pool = getPool()
    const depth = Math.min(Math.max(parseInt(String(req.query.depth || '1'), 10), 1), 5)
    const entityId = req.params.id

    // BFS 遍历关系图
    const visited = new Set<string>()
    const entityIds = new Set<string>([entityId])
    const allRelations: any[] = []

    for (let d = 0; d < depth; d++) {
      const idsToQuery = [...entityIds].filter(id => !visited.has(id))
      if (idsToQuery.length === 0) break

      // 动态构建占位符：$1, $2, ... 用于 source_id IN (...)，接着 $N+1, ... 用于 target_id IN (...)
      const sourcePlaceholders = idsToQuery.map((_, i) => `$${i + 1}`).join(',')
      const targetPlaceholders = idsToQuery.map((_, i) => `$${i + 1 + idsToQuery.length}`).join(',')
      const result = await pool.query(
        `SELECT * FROM entity_relations WHERE source_id IN (${sourcePlaceholders}) OR target_id IN (${targetPlaceholders})`,
        [...idsToQuery, ...idsToQuery]
      )

      for (const r of result.rows) {
        allRelations.push(parseRelationRow(r))
        entityIds.add(r.source_id)
        entityIds.add(r.target_id)
      }

      for (const id of idsToQuery) visited.add(id)
    }

    // 获取所有关联实体
    const allIds = [...entityIds].filter(id => id !== entityId)
    let entities: any[] = []
    if (allIds.length > 0) {
      const placeholders = allIds.map((_, i) => `$${i + 1}`).join(',')
      const result = await pool.query(`SELECT * FROM entities WHERE id IN (${placeholders})`, allIds)
      entities = result.rows.map(parseEntityRow)
    }

    res.json({ relations: allRelations, entities })
  } catch (e) { next(e) }
})

function parseRelationRow(row: any) {
  return {
    id: row.id,
    sourceId: row.source_id,
    targetId: row.target_id,
    type: row.type,
    metadata: row.metadata || {},
    createdAt: row.created_at,
  }
}

function parseEntityRow(row: any) {
  return {
    id: row.id,
    type: row.type,
    scope: row.scope,
    panelId: row.panel_id,
    widgetId: row.widget_id,
    data: row.data || {},
    recordStatus: row.record_status,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
