import { Router } from 'express'
import { getPool } from '../db/connection.js'

export const localServicesRouter = Router()

// ============================================================================
// Phase 6.2：本地服务注册 API（spec 3.3.2 节）
// 桌面端注册/心跳/注销本地服务，移动端查询在线服务列表
// ============================================================================

interface LocalServiceRow {
  id: number
  device_id: string
  service_name: string
  endpoint: string
  description: string | null
  online: boolean
  last_heartbeat: number | null
  registered_at: number
  updated_at: number
}

function parseServiceRow(r: LocalServiceRow) {
  return {
    id: r.id,
    deviceId: r.device_id,
    serviceName: r.service_name,
    endpoint: r.endpoint,
    description: r.description,
    online: r.online,
    lastHeartbeat: r.last_heartbeat,
    registeredAt: r.registered_at,
    updatedAt: r.updated_at,
  }
}

// 对抗审查修复（中 Bug）：endpoint URL 校验
// 必须是 http:// 或 https:// 开头，防止 file:///、ftp://、data: 等协议 SSRF 风险
// 长度限制 2048，防止超长 URL 攻击
const MAX_ENDPOINT_LENGTH = 2048

function validateEndpoint(endpoint: string): string | null {
  if (typeof endpoint !== 'string' || endpoint.length === 0) return 'endpoint is required'
  if (endpoint.length > MAX_ENDPOINT_LENGTH) return `endpoint too long (max ${MAX_ENDPOINT_LENGTH})`
  if (!/^https?:\/\//i.test(endpoint)) return 'endpoint must start with http:// or https://'
  try {
    const u = new URL(endpoint)
    // 只允许 http/https 协议（URL 构造器会解析，但需显式校验 protocol）
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'endpoint must be http or https'
    return null
  } catch {
    return 'endpoint is not a valid URL'
  }
}

// POST /api/local-services/register — 桌面端注册本地服务（upsert）
localServicesRouter.post('/register', async (req, res, next) => {
  try {
    const deviceId = req.deviceId
    if (!deviceId) {
      res.status(400).json({ error: 'missing deviceId (X-Device-Id header required)' })
      return
    }

    const body = req.body as {
      serviceName: string
      endpoint: string
      description?: string
    }
    if (!body.serviceName) {
      res.status(400).json({ error: 'serviceName is required' })
      return
    }
    // 对抗审查修复：endpoint 协议白名单校验，阻断 file:///、ftp://、内网 metadata URL 等 SSRF
    const endpointErr = validateEndpoint(body.endpoint)
    if (endpointErr) {
      res.status(400).json({ error: endpointErr })
      return
    }

    const pool = getPool()
    const now = Date.now()
    const result = await pool.query(
      `INSERT INTO local_service_registry (device_id, service_name, endpoint, description, online, last_heartbeat, registered_at, updated_at)
       VALUES ($1, $2, $3, $4, true, $5, $6, $7)
       ON CONFLICT (device_id, service_name) DO UPDATE SET
         endpoint = EXCLUDED.endpoint,
         description = EXCLUDED.description,
         online = true,
         last_heartbeat = EXCLUDED.last_heartbeat,
         updated_at = EXCLUDED.updated_at
       RETURNING *`,
      [deviceId, body.serviceName, body.endpoint, body.description ?? null, now, now, now],
    )
    res.status(201).json(parseServiceRow(result.rows[0] as LocalServiceRow))
  } catch (e) { next(e) }
})

// POST /api/local-services/heartbeat — 桌面端心跳（更新 last_heartbeat + online=true）
// body: { serviceName } 或 { serviceNames: string[] }
localServicesRouter.post('/heartbeat', async (req, res, next) => {
  try {
    const deviceId = req.deviceId
    if (!deviceId) {
      res.status(400).json({ error: 'missing deviceId (X-Device-Id header required)' })
      return
    }

    const body = req.body as { serviceName?: string; serviceNames?: string[] }
    const names: string[] = []
    if (Array.isArray(body.serviceNames)) {
      names.push(...body.serviceNames)
    } else if (typeof body.serviceName === 'string') {
      names.push(body.serviceName)
    }

    if (names.length === 0) {
      res.status(400).json({ error: 'serviceName or serviceNames is required' })
      return
    }

    const pool = getPool()
    const now = Date.now()
    const result = await pool.query(
      `UPDATE local_service_registry
       SET online = true, last_heartbeat = $1, updated_at = $2
       WHERE device_id = $3 AND service_name = ANY($4::text[])
       RETURNING service_name`,
      [now, now, deviceId, names],
    )
    res.json({ ok: true, updated: result.rowCount ?? 0 })
  } catch (e) { next(e) }
})

// POST /api/local-services/unregister — 桌面端注销服务
// body: { serviceName } 或 { serviceNames: string[] }
localServicesRouter.post('/unregister', async (req, res, next) => {
  try {
    const deviceId = req.deviceId
    if (!deviceId) {
      res.status(400).json({ error: 'missing deviceId (X-Device-Id header required)' })
      return
    }

    const body = req.body as { serviceName?: string; serviceNames?: string[] }
    const names: string[] = []
    if (Array.isArray(body.serviceNames)) {
      names.push(...body.serviceNames)
    } else if (typeof body.serviceName === 'string') {
      names.push(body.serviceName)
    }

    if (names.length === 0) {
      res.status(400).json({ error: 'serviceName or serviceNames is required' })
      return
    }

    const pool = getPool()
    const result = await pool.query(
      `DELETE FROM local_service_registry WHERE device_id = $1 AND service_name = ANY($2::text[]) RETURNING service_name`,
      [deviceId, names],
    )
    res.json({ ok: true, deleted: result.rowCount ?? 0 })
  } catch (e) { next(e) }
})

// GET /api/local-services/list — 列出所有在线服务（online=true）
localServicesRouter.get('/list', async (_req, res, next) => {
  try {
    const pool = getPool()
    const result = await pool.query(
      'SELECT * FROM local_service_registry WHERE online = true ORDER BY device_id, service_name',
    )
    res.json(result.rows.map((r) => parseServiceRow(r as LocalServiceRow)))
  } catch (e) { next(e) }
})

// GET /api/local-services/list/:deviceId — 列出指定设备的在线服务
localServicesRouter.get('/list/:deviceId', async (req, res, next) => {
  try {
    const pool = getPool()
    const result = await pool.query(
      'SELECT * FROM local_service_registry WHERE online = true AND device_id = $1 ORDER BY service_name',
      [req.params.deviceId],
    )
    res.json(result.rows.map((r) => parseServiceRow(r as LocalServiceRow)))
  } catch (e) { next(e) }
})
