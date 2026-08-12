import { Router } from 'express'
import { getPool } from '../db/connection.js'
import { broadcastChange, sendToDevice } from '../ws.js'
import type { SyncFailedEvent } from '../ws.js'
import type { UpsertSyncLogRequest } from '../types/index.js'

// ============================================================================
// Phase S3 缺口 B：sync_logs 服务器端持久化 API（spec 2.2.3 节）
// 挂载在 /api/sync/logs，走 /api 全局 authMiddleware（继承）
//
// 路由清单：
// - GET    /                     查询 sync_logs 列表（?deviceId/&status/&limit/&offset/&includeSuccess）
// - GET    /failed               仅查询 status=failed 的记录（便捷端点）
// - PUT    /                     upsert（客户端写入 pending 或更新 success/failed）
// - DELETE /:id                  删除单条记录
// - POST   /:id/retry            手动触发重试（服务器执行 payload 指向的操作）
// ============================================================================

export const syncLogsRouter = Router()

// GET /api/sync/logs — 查询 sync_logs 列表
syncLogsRouter.get('/', async (req, res, next) => {
  try {
    const pool = getPool()
    const params = req.query as Record<string, string | undefined>
    const conditions: string[] = []
    const values: unknown[] = []
    let paramIdx = 1

    if (params.deviceId) {
      conditions.push(`device_id = $${paramIdx++}`)
      values.push(params.deviceId)
    }
    if (params.status) {
      conditions.push(`status = $${paramIdx++}`)
      values.push(params.status)
    }
    if (params.entityType) {
      conditions.push(`entity_type = $${paramIdx++}`)
      values.push(params.entityType)
    }
    if (params.entityId) {
      conditions.push(`entity_id = $${paramIdx++}`)
      values.push(params.entityId)
    }
    // includeSuccess=false（默认）时排除 success 记录，仅返回 pending/failed
    const includeSuccess = params.includeSuccess === 'true'
    if (!includeSuccess) {
      conditions.push(`status != $${paramIdx++}`)
      values.push('success')
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const limit = Math.min(Math.max(parseInt(String(params.limit || '100'), 10), 1), 1000)
    const offset = Math.max(parseInt(String(params.offset || '0'), 10), 0)

    const dataResult = await pool.query(
      `SELECT * FROM sync_logs ${where} ORDER BY created_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      [...values, limit, offset],
    )
    const countResult = await pool.query(
      `SELECT COUNT(*) as count FROM sync_logs ${where}`,
      values,
    )

    res.json({
      items: dataResult.rows.map(parseSyncLogRow),
      total: parseInt(String(countResult.rows[0].count), 10),
      limit,
      offset,
    })
  } catch (e) { next(e) }
})

// GET /api/sync/logs/failed — 便捷端点：仅查询 status=failed 的记录
syncLogsRouter.get('/failed', async (req, res, next) => {
  try {
    const pool = getPool()
    const params = req.query as Record<string, string | undefined>
    const conditions = ['status = $1']
    const values: unknown[] = ['failed']
    let paramIdx = 2

    if (params.deviceId) {
      conditions.push(`device_id = $${paramIdx++}`)
      values.push(params.deviceId)
    }

    const limit = Math.min(Math.max(parseInt(String(params.limit || '100'), 10), 1), 1000)
    const offset = Math.max(parseInt(String(params.offset || '0'), 10), 0)

    const dataResult = await pool.query(
      `SELECT * FROM sync_logs WHERE ${conditions.join(' AND ')} ORDER BY updated_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      [...values, limit, offset],
    )
    res.json({
      items: dataResult.rows.map(parseSyncLogRow),
      limit,
      offset,
    })
  } catch (e) { next(e) }
})

// PUT /api/sync/logs — upsert（客户端写入 pending 或更新 success/failed）
syncLogsRouter.put('/', async (req, res, next) => {
  try {
    const pool = getPool()
    const body = req.body as UpsertSyncLogRequest

    // M-3：参数校验（缺 id/operation/entityType/entityId 时返回 400）
    if (!body.id || !body.operation || !body.entityType || !body.entityId) {
      res.status(400).json({
        error: 'INVALID_PARAMS',
        message: 'Required fields: id, operation, entityType, entityId',
      })
      return
    }
    // 校验 operation 枚举
    if (!['create', 'update', 'delete'].includes(body.operation)) {
      res.status(400).json({
        error: 'INVALID_PARAMS',
        message: `operation must be create|update|delete, got: ${body.operation}`,
      })
      return
    }
    // 校验 status 枚举（status 为可选字段，传值时校验）
    if (body.status && !['pending', 'success', 'failed'].includes(body.status)) {
      res.status(400).json({
        error: 'INVALID_PARAMS',
        message: `status must be pending|success|failed, got: ${body.status}`,
      })
      return
    }

    const now = Date.now()
    // S-2 修复：deviceId 仅从 req.deviceId 取（由 /api 全局 authMiddleware 注入），
    //         绝对不能从 body.deviceId 读取（防止伪造）
    const deviceId = req.deviceId ?? 'unknown'

    // M-7 修复：last_error 应用层截断 1000 字符（schema 仍 TEXT，由应用层保证长度）
    const lastError = body.lastError ? String(body.lastError).slice(0, 1000) : null

    await pool.query(
      `INSERT INTO sync_logs
        (id, device_id, operation, entity_type, entity_id, payload, status,
         retry_count, last_error, created_at, updated_at, next_retry_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status,
         retry_count = EXCLUDED.retry_count,
         last_error = EXCLUDED.last_error,
         updated_at = EXCLUDED.updated_at,
         next_retry_at = EXCLUDED.next_retry_at`,
      [
        body.id, deviceId, body.operation, body.entityType, body.entityId,
        JSON.stringify(body.payload), body.status ?? 'pending',
        body.retryCount ?? 0, lastError,
        now, now, body.nextRetryAt ?? null,
      ],
    )

    // S3 缺口 C：如果状态变为 failed，通过 WS 推送 sync_failed 事件到对应 device
    // ChangeEvent 联合类型已在 ws.ts 中扩展 sync_failed 事件（spec 2.3.1 节）
    if (body.status === 'failed') {
      const failedEntry: SyncFailedEvent = {
        id: body.id,
        deviceId,
        operation: body.operation,
        entityType: body.entityType,
        entityId: body.entityId,
        lastError: lastError,
        retryCount: body.retryCount ?? 0,
        updatedAt: now,
      }
      // 推送到发起设备（让发起方实时感知失败）
      sendToDevice(deviceId, {
        kind: 'change',
        changeType: 'sync_failed',
        data: failedEntry,
        sourceDeviceId: deviceId,
      })
      // 也广播到所有设备（让多端协作的其他设备能看到该设备的失败操作）
      // broadcastChange 会排除 sourceDeviceId，避免发起方重复收到
      broadcastChange({ kind: 'sync_failed', data: failedEntry }, deviceId)
    }

    res.json({ ok: true, id: body.id, status: body.status ?? 'pending' })
  } catch (e) { next(e) }
})

// DELETE /api/sync/logs/:id — 删除单条记录
syncLogsRouter.delete('/:id', async (req, res, next) => {
  try {
    const pool = getPool()
    const result = await pool.query('DELETE FROM sync_logs WHERE id = $1', [req.params.id])
    if (result.rowCount === 0) {
      res.status(404).json({ error: 'NOT_FOUND', message: `Sync log ${req.params.id} not found` })
      return
    }
    res.json({ ok: true })
  } catch (e) { next(e) }
})

// POST /api/sync/logs/:id/retry — 手动触发重试（服务器执行 payload 指向的操作）
syncLogsRouter.post('/:id/retry', async (req, res, next) => {
  try {
    const pool = getPool()
    const result = await pool.query('SELECT * FROM sync_logs WHERE id = $1', [req.params.id])
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'NOT_FOUND', message: `Sync log ${req.params.id} not found` })
      return
    }
    const row = result.rows[0]
    const now = Date.now()

    // S-7 修复：create 重试不在服务器端处理（客户端 syncQueue 本地处理去重）
    // 早期返回 skipped，不进入 executeSyncOpOnServer
    if (row.operation === 'create') {
      res.json({ ok: false, status: 'skipped', reason: 'create retry not supported on server' })
      return
    }

    try {
      await executeSyncOpOnServer(row.operation, row.entity_type, row.entity_id, row.payload)
      await pool.query(
        `UPDATE sync_logs SET status = 'success', retry_count = retry_count + 1, last_error = NULL, updated_at = $1 WHERE id = $2`,
        [now, req.params.id],
      )
      res.json({ ok: true, id: req.params.id, status: 'success' })
    } catch (retryErr) {
      const errorMsg = retryErr instanceof Error ? retryErr.message : String(retryErr)
      // M-7 修复：last_error 应用层截断 1000 字符
      const truncatedError = errorMsg.slice(0, 1000)
      await pool.query(
        `UPDATE sync_logs SET retry_count = retry_count + 1, last_error = $1, updated_at = $2, next_retry_at = $3 WHERE id = $4`,
        [truncatedError, now, now + 60_000, req.params.id],
      )
      res.status(500).json({ ok: false, id: req.params.id, status: 'failed', error: truncatedError })
    }
  } catch (e) { next(e) }
})

/**
 * 服务器端重试执行器（简化版，仅处理 HTTP 路由内部调用）
 *
 * **M-1 修复**：sync_logs retry 是兜底重试机制，**不参与乐观锁**（按 LWW 强制覆盖）。
 *   直接 UPDATE SQL 跳过 widgets.ts 的乐观锁 WHERE version=$expected 校验。
 *   如未来需要严格乐观锁，应抽 `server/src/services/syncExecutor.ts` 统一处理（S3 不抽）。
 *
 * **S-7 修复**：retry 路由对 create 操作早期返回 skipped，不会进入此函数。
 *   此函数仅处理 panel/widget/entity 三种 entityType 的 update/delete；
 *   settings/favorite 等不支持类型走 default 抛错（M-2 修复）。
 *
 * @param operation  create / update / delete（实际只会是 update/delete，create 已在 retry 路由早期返回）
 * @param entityType panel / widget / entity
 * @param entityId   实体 ID
 * @param payload    客户端原始 payload（JSONB 已被 pg 自动反序列化为对象）
 */
async function executeSyncOpOnServer(
  operation: string,
  entityType: string,
  entityId: string,
  payload: unknown,
): Promise<void> {
  const p = (payload ?? {}) as Record<string, unknown>
  const pool = getPool()

  if (entityType === 'panel') {
    if (operation === 'update') {
      const now = Date.now()
      await pool.query(
        `UPDATE panels SET name = $1, sort_order = $2, settings = $3, canvas_transform = $4, updated_at = $5 WHERE id = $6`,
        [
          (p.name as string) ?? '未命名',
          (p.sortOrder as number) ?? 0,
          JSON.stringify(p.settings ?? {}),
          p.canvasTransform !== undefined ? JSON.stringify(p.canvasTransform ?? null) : null,
          now,
          entityId,
        ],
      )
    } else if (operation === 'delete') {
      await pool.query('DELETE FROM panels WHERE id = $1', [entityId])
    }
    // operation=create 已在 retry 路由早期返回，不会进入此函数
    return
  }

  if (entityType === 'widget') {
    if (operation === 'update') {
      const now = Date.now()
      // M-1 修复：跳过 widgets.ts 的乐观锁 WHERE version=$expected 校验，按 LWW 强制覆盖
      await pool.query(
        `UPDATE widgets SET state = $1, version = version + 1, updated_at = $2 WHERE id = $3`,
        [JSON.stringify(p.state ?? {}), now, entityId],
      )
    } else if (operation === 'delete') {
      await pool.query('DELETE FROM widgets WHERE id = $1', [entityId])
    }
    return
  }

  if (entityType === 'entity') {
    if (operation === 'update') {
      const now = Date.now()
      await pool.query(
        `UPDATE entities SET data = $1, version = version + 1, updated_at = $2 WHERE id = $3`,
        [JSON.stringify(p.data ?? {}), now, entityId],
      )
    } else if (operation === 'delete') {
      await pool.query('DELETE FROM entities WHERE id = $1', [entityId])
    }
    return
  }

  // M-2 修复：default 抛错，不静默跳过 settings/favorite 等不支持类型
  throw new Error(`Unsupported entityType for server retry: ${entityType}`)
}

function parseSyncLogRow(row: any) {
  return {
    id: row.id,
    deviceId: row.device_id,
    operation: row.operation,
    entityType: row.entity_type,
    entityId: row.entity_id,
    payload: row.payload,
    status: row.status,
    retryCount: row.retry_count,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    nextRetryAt: row.next_retry_at,
  }
}
