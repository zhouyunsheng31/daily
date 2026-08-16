import { Router } from 'express'
import { randomUUID } from 'crypto'
import { v4 as uuidv4 } from 'uuid'
import { getPool, withTransaction } from '../db/connection.js'
import { createError } from '../middleware/error.js'
import { broadcastChange } from '../ws.js'
import type { CreateEntityRequest, UpdateEntityRequest, EntityQueryParams } from '../types/index.js'

export const entitiesRouter = Router()

// ============================================================================
// 【安全修复 2026-08-16（C1）】entities 通用 API 越权封堵
// - webos_state 是 webOS 用户私有状态（App/积分/存储），只允许 webOS 专用
//   路由（webos.ts loadState/saveState）访问，通用 entities API 一律 403。
// - 列表查询强制要求 scope（禁止不带条件全库枚举）；scope 只能是 'default'
//   （旧桌面端兼容）或当前用户的 user:/guest: scope。
// - 单条读写/删除：webos_state → 403；user:/guest: scope 非本人 → 403。
// ============================================================================
const WEBOS_STATE_TYPE = 'webos_state'

/** 当前请求主键：登录用户 → user:<id>；游客 → guest:<deviceId>；单密码/无身份 → null */
function principalKeyOf(req: { user?: { userId?: string; guest?: boolean; guestDeviceId?: string } }): string | null {
  if (req.user?.guest) return req.user.guestDeviceId ? `guest:${req.user.guestDeviceId}` : null
  if (req.user?.userId) return `user:${req.user.userId}`
  return null
}

/** scope 是否允许当前用户访问：'default'（旧兼容）或等于自己的 principal key */
function scopeAllowed(req: { user?: { userId?: string; guest?: boolean; guestDeviceId?: string } }, scope: string | null | undefined): boolean {
  if (!scope) return false
  if (scope === 'default') return true
  const mine = principalKeyOf(req)
  return mine !== null && scope === mine
}

/** 校验实体行是否可被当前用户访问；返回错误则抛 403 */
function assertEntityAccessible(req: { user?: { userId?: string; guest?: boolean; guestDeviceId?: string } }, row: { type?: string | null; scope?: string | null }): void {
  if (row.type === WEBOS_STATE_TYPE) {
    throw createError(403, 'WEBOS_STATE_PROTECTED', 'webos_state 只能经 webOS 专用接口访问')
  }
  if (!scopeAllowed(req, row.scope)) {
    throw createError(403, 'ENTITY_SCOPE_FORBIDDEN', '无权访问该 scope 的实体')
  }
}

/** 校验请求体 scope（写操作）：webos_state 禁止；scope 必须是 default 或本人 */
function assertScopeWritable(req: { user?: { userId?: string; guest?: boolean; guestDeviceId?: string } }, type: string | undefined, scope: string | null | undefined): void {
  if (type === WEBOS_STATE_TYPE) {
    throw createError(403, 'WEBOS_STATE_PROTECTED', 'webos_state 只能经 webOS 专用接口访问')
  }
  if (scope !== undefined && !scopeAllowed(req, scope)) {
    throw createError(403, 'ENTITY_SCOPE_FORBIDDEN', '无权写入该 scope 的实体')
  }
}

// GET /api/entities — 灵活查询
entitiesRouter.get('/', async (req, res, next) => {
  try {
    const pool = getPool()
    const params = req.query as unknown as EntityQueryParams
    // 【安全修复 C1】列表查询：旧客户端不传 scope（'default' 兼容）→ 自动按当前
    // principal 推导；显式传 scope 时校验合法性；webos_state 一律禁止通用 API。
    // 推导规则：default（旧数据）∪ 自己的 scope（user:<id> / guest:<deviceId>），
    // 保证不泄露他人 user:/guest: 数据，同时旧客户端（scope 缺省）不降级。
    if (params.type === WEBOS_STATE_TYPE) {
      throw createError(403, 'WEBOS_STATE_PROTECTED', 'webos_state 只能经 webOS 专用接口访问')
    }
    let effectiveScope: string | null = params.scope ?? null
    if (effectiveScope !== null && !scopeAllowed(req, effectiveScope)) {
      throw createError(403, 'ENTITY_SCOPE_FORBIDDEN', '无权访问该 scope 的实体')
    }
    const conditions: string[] = []
    const values: unknown[] = []
    let paramIdx = 1

    if (params.type) { conditions.push(`type = $${paramIdx++}`); values.push(params.type) }
    // scope 过滤：显式 scope → 精确匹配；缺省 → default ∪ 自己（旧客户端兼容）
    if (effectiveScope !== null) {
      conditions.push(`scope = $${paramIdx++}`)
      values.push(effectiveScope)
    } else {
      const mine = principalKeyOf(req)
      if (mine) {
        conditions.push(`(scope = 'default' OR scope = $${paramIdx++})`)
        values.push(mine)
      } else {
        conditions.push(`scope = 'default'`)
      }
    }
    if (params.panelId) { conditions.push(`panel_id = $${paramIdx++}`); values.push(params.panelId) }
    if (params.widgetId) { conditions.push(`widget_id = $${paramIdx++}`); values.push(params.widgetId) }
    if (params.recordStatus) { conditions.push(`record_status = $${paramIdx++}`); values.push(params.recordStatus) }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const limit = Math.min(Math.max(parseInt(String(params.limit || '1000'), 10), 1), 10000)
    const offset = Math.max(parseInt(String(params.offset || '0'), 10), 0)

    const dataResult = await pool.query(
      `SELECT * FROM entities ${where} ORDER BY created_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      [...values, limit, offset]
    )
    const countResult = conditions.length > 0
      ? await pool.query(`SELECT COUNT(*) as count FROM entities ${where}`, values)
      : await pool.query('SELECT COUNT(*) as count FROM entities')

    res.json({
      items: dataResult.rows.map(parseEntityRow),
      total: parseInt(String(countResult.rows[0].count), 10),
      limit,
      offset,
    })
  } catch (e) { next(e) }
})

// POST /api/entities/batch
entitiesRouter.post('/batch', async (req, res, next) => {
  try {
    const pool = getPool()
    const { entities } = req.body as { entities: CreateEntityRequest[] }
    // 【安全修复 C1】批量写入同样校验 scope 与 webos_state
    for (const e of entities) {
      assertScopeWritable(req, e.type, e.scope)
    }
    const now = Date.now()

    const results = await withTransaction(async (client) => {
      const created: any[] = []
      for (const e of entities) {
        const id = e.id || uuidv4()
        await client.query(
          `INSERT INTO entities (id, type, scope, panel_id, widget_id, data, record_status, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [id, e.type, e.scope || 'default', e.panelId ?? null, e.widgetId ?? null,
            JSON.stringify(e.data), e.recordStatus || 'active', now, now]
        )
        const result = await client.query('SELECT * FROM entities WHERE id = $1', [id])
        created.push(parseEntityRow(result.rows[0]))
      }
      return created
    })

    res.status(201).json(results)
    broadcastChange({ kind: 'entity_created', data: results }, req.deviceId)
  } catch (e) { next(e) }
})

// PUT /api/entities/batch
entitiesRouter.put('/batch', async (req, res, next) => {
  try {
    const { entities } = req.body as { entities: Array<{ id: string } & UpdateEntityRequest> }
    const now = Date.now()

    await withTransaction(async (client) => {
      for (const e of entities) {
        // 【安全修复 C1】批量更新：先校验目标实体可访问，再校验写入字段 scope
        const existingRow = await client.query('SELECT * FROM entities WHERE id = $1', [e.id])
        if (existingRow.rows.length > 0) {
          assertEntityAccessible(req, existingRow.rows[0])
        }
        assertScopeWritable(req, e.type, e.scope)
        const updates: string[] = []
        const values: unknown[] = []
        let paramIdx = 1

        if (e.type !== undefined) { updates.push(`type = $${paramIdx++}`); values.push(e.type) }
        if (e.scope !== undefined) { updates.push(`scope = $${paramIdx++}`); values.push(e.scope) }
        if (e.panelId !== undefined) { updates.push(`panel_id = $${paramIdx++}`); values.push(e.panelId) }
        if (e.widgetId !== undefined) { updates.push(`widget_id = $${paramIdx++}`); values.push(e.widgetId) }
        if (e.data !== undefined) { updates.push(`data = $${paramIdx++}`); values.push(JSON.stringify(e.data)) }
        if (e.recordStatus !== undefined) { updates.push(`record_status = $${paramIdx++}`); values.push(e.recordStatus) }

        if (updates.length > 0) {
          updates.push('version = version + 1')
          updates.push(`updated_at = $${paramIdx++}`)
          values.push(now)
          values.push(e.id)
          await client.query(`UPDATE entities SET ${updates.join(', ')} WHERE id = $${paramIdx}`, values)
        }
      }
    })

    res.json({ ok: true })
    broadcastChange({ kind: 'entity_updated', data: { entities } }, req.deviceId)
  } catch (e) { next(e) }
})

// DELETE /api/entities/batch
entitiesRouter.delete('/batch', async (req, res, next) => {
  try {
    const { ids } = req.body as { ids: string[] }
    await withTransaction(async (client) => {
      for (const id of ids) {
        // 【安全修复 C1】批量删除：校验目标实体可访问
        const existingRow = await client.query('SELECT * FROM entities WHERE id = $1', [id])
        if (existingRow.rows.length > 0) {
          assertEntityAccessible(req, existingRow.rows[0])
        }
        await client.query('DELETE FROM entities WHERE id = $1', [id])
      }
    })
    res.json({ ok: true, deleted: ids.length })
    broadcastChange({ kind: 'entity_deleted', data: { ids } }, req.deviceId)
  } catch (e) { next(e) }
})

// GET /api/entities/:id
entitiesRouter.get('/:id', async (req, res, next) => {
  try {
    const pool = getPool()
    const result = await pool.query('SELECT * FROM entities WHERE id = $1', [req.params.id])
    if (result.rows.length === 0) throw createError(404, 'NOT_FOUND', `Entity ${req.params.id} not found`)
    // 【安全修复 C1】单条读取校验访问权限
    assertEntityAccessible(req, result.rows[0])
    res.json(parseEntityRow(result.rows[0]))
  } catch (e) { next(e) }
})

// POST /api/entities
entitiesRouter.post('/', async (req, res, next) => {
  try {
    const pool = getPool()
    const body = req.body as CreateEntityRequest
    // 【安全修复 C1】创建校验 scope 与 webos_state
    assertScopeWritable(req, body.type, body.scope)
    const id = body.id || uuidv4()
    const now = Date.now()

    await pool.query(
      `INSERT INTO entities (id, type, scope, panel_id, widget_id, data, record_status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, body.type, body.scope || 'default', body.panelId ?? null, body.widgetId ?? null,
        JSON.stringify(body.data), body.recordStatus || 'active', now, now]
    )
    const result = await pool.query('SELECT * FROM entities WHERE id = $1', [id])
    const entity = parseEntityRow(result.rows[0])
    res.status(201).json(entity)
    broadcastChange({ kind: 'entity_created', data: entity }, req.deviceId)
  } catch (e) { next(e) }
})

// PUT /api/entities/:id
entitiesRouter.put('/:id', async (req, res, next) => {
  try {
    const pool = getPool()
    const body = req.body as UpdateEntityRequest & { expectedVersion?: number }
    const existing = await pool.query('SELECT * FROM entities WHERE id = $1', [req.params.id])
    if (existing.rows.length === 0) throw createError(404, 'NOT_FOUND', `Entity ${req.params.id} not found`)
    // 【安全修复 C1】更新前校验目标实体可访问 + 写入 scope 合法
    assertEntityAccessible(req, existing.rows[0])
    assertScopeWritable(req, body.type, body.scope)

    const conflictRow = existing.rows[0]
    // Phase S3 缺口 A：版本不匹配时记录冲突日志（仍应用更新，LWW + 日志策略）
    const conflictDetected =
      body.expectedVersion !== undefined && conflictRow.version !== body.expectedVersion

    const updates: string[] = []
    const values: unknown[] = []
    let paramIdx = 1

    if (body.type !== undefined) { updates.push(`type = $${paramIdx++}`); values.push(body.type) }
    if (body.scope !== undefined) { updates.push(`scope = $${paramIdx++}`); values.push(body.scope) }
    if (body.panelId !== undefined) { updates.push(`panel_id = $${paramIdx++}`); values.push(body.panelId) }
    if (body.widgetId !== undefined) { updates.push(`widget_id = $${paramIdx++}`); values.push(body.widgetId) }
    if (body.data !== undefined) { updates.push(`data = $${paramIdx++}`); values.push(JSON.stringify(body.data)) }
    if (body.recordStatus !== undefined) { updates.push(`record_status = $${paramIdx++}`); values.push(body.recordStatus) }

    const now = Date.now()

    // S3 缺口 A：用 withTransaction 包裹冲突日志 INSERT + entities UPDATE + SELECT 返回
    // 保证一致性：若 INSERT 成功但 UPDATE 失败时整体回滚，避免脏日志
    const updatedRow = await withTransaction(async (client) => {
      if (conflictDetected) {
        const conflictId = randomUUID()
        await client.query(
          `INSERT INTO entity_conflict_logs
            (id, entity_id, entity_type, panel_id, local_version, remote_version, local_state, remote_state,
             source_device_id, resolved, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, FALSE, $10)`,
          [
            conflictId,
            req.params.id,
            conflictRow.type || 'entity',
            conflictRow.panel_id ?? null,
            conflictRow.version,
            body.expectedVersion as number,
            JSON.stringify(conflictRow.data ?? null),
            JSON.stringify(body.data ?? null),
            req.deviceId ?? null,
            now,
          ],
        )
        console.warn(
          `[Conflict] Entity ${req.params.id} version mismatch: ` +
          `expected=${body.expectedVersion}, current=${conflictRow.version}, ` +
          `logged to entity_conflict_logs, applying LWW update`,
        )
      }

      if (updates.length > 0) {
        updates.push('version = version + 1')
        updates.push(`updated_at = $${paramIdx++}`)
        values.push(now)
        values.push(req.params.id)
        await client.query(`UPDATE entities SET ${updates.join(', ')} WHERE id = $${paramIdx}`, values)
      }

      const result = await client.query('SELECT * FROM entities WHERE id = $1', [req.params.id])
      return result.rows[0]
    })

    const entity = parseEntityRow(updatedRow)
    res.json(entity)
    broadcastChange({ kind: 'entity_updated', data: entity }, req.deviceId)
  } catch (e) { next(e) }
})

// DELETE /api/entities/:id
entitiesRouter.delete('/:id', async (req, res, next) => {
  try {
    const pool = getPool()
    // 【安全修复 C1】删除前校验目标实体可访问
    const existing = await pool.query('SELECT * FROM entities WHERE id = $1', [req.params.id])
    if (existing.rows.length > 0) {
      assertEntityAccessible(req, existing.rows[0])
    }
    const result = await pool.query('DELETE FROM entities WHERE id = $1', [req.params.id])
    if (result.rowCount === 0) throw createError(404, 'NOT_FOUND', `Entity ${req.params.id} not found`)
    res.json({ ok: true })
    broadcastChange({ kind: 'entity_deleted', data: { id: req.params.id } }, req.deviceId)
  } catch (e) { next(e) }
})

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
