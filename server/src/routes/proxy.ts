import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import { getPool } from '../db/connection.js'
import { sendProxyRequest } from '../ws.js'

export const proxyRouter = Router()

// ============================================================================
// Phase 6.2：代理 API（spec 3.3.3 节）
// 移动端通过服务器代理调用桌面端本地服务
// 端点：/proxy/:deviceId/:serviceName/*path
// ============================================================================

// 对抗审查修复（中 Bug）：补全 RFC 7230 hop-by-hop headers 过滤
// 防止 proxy-authorization 等敏感凭据透传到桌面端本地服务
const FILTERED_REQUEST_HEADERS = new Set([
  'host',
  'connection',
  'content-length',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

// 响应时需要过滤的 headers（不应透传给移动端）
const FILTERED_RESPONSE_HEADERS = new Set([
  'host',
  'connection',
  'content-length',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

/**
 * 代理处理器：将请求转发到桌面端本地服务
 * 同时注册有路径和无路径两种路由模式
 */
async function proxyHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // Express 5 命名路由参数运行时始终是 string
    const deviceId = req.params.deviceId as string
    const serviceName = req.params.serviceName as string

    // Express 5 的 *path 通配符运行时返回 string[]（如 ["api","notes"]），不是字符串
    // 需要将数组 join 为 "/" 分隔的路径字符串
    const pathRaw = req.params.path
    const path = Array.isArray(pathRaw) ? pathRaw.join('/') : (typeof pathRaw === 'string' ? pathRaw : '')

    if (!deviceId || !serviceName) {
      res.status(400).json({ error: 'deviceId and serviceName are required' })
      return
    }

    // 保留查询字符串（req.url 包含原始查询参数，如 ?tag=work&limit=10）
    // req.url 是相对于挂载点的 URL，包含 path + query
    const queryString = req.url?.split('?')[1] || ''
    const fullPath = queryString ? `${path}?${queryString}` : path

    // 1. 查 local_service_registry 确认 online=true
    const pool = getPool()
    const result = await pool.query(
      'SELECT * FROM local_service_registry WHERE device_id = $1 AND service_name = $2 AND online = true',
      [deviceId, serviceName],
    )

    if (result.rows.length === 0) {
      // 离线降级：服务 online=false 或不存在
      res.status(503).json({ error: 'local_service_offline', message: '依赖的桌面端离线' })
      return
    }

    // 2. 构造转发 headers（过滤 host/connection/content-length）
    const forwardHeaders: Record<string, string> = {}
    for (const [key, value] of Object.entries(req.headers)) {
      if (FILTERED_REQUEST_HEADERS.has(key.toLowerCase())) continue
      if (typeof value === 'string') {
        forwardHeaders[key] = value
      } else if (Array.isArray(value)) {
        forwardHeaders[key] = value.join(', ')
      }
    }

    // 3. 构造 body（JSON.stringify）
    let body: string | null = null
    if (req.body !== undefined && req.body !== null) {
      body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body)
    }

    // 4. 通过 WS 向桌面端发送 proxy_request，等待 proxy_response（超时 30 秒）
    let response
    try {
      response = await sendProxyRequest(deviceId, {
        serviceName,
        method: req.method,
        path: fullPath,
        headers: forwardHeaders,
        body,
      })
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      if (errMsg === 'proxy_timeout') {
        res.status(504).json({ error: 'proxy_timeout', message: '桌面端响应超时' })
        return
      }
      if (errMsg === 'device_offline' || errMsg === 'device_disconnected') {
        res.status(503).json({ error: 'local_service_offline', message: '依赖的桌面端离线' })
        return
      }
      throw err
    }

    // 5. 将响应返回给请求方
    // 过滤响应 headers
    const responseHeaders: Record<string, string> = {}
    for (const [key, value] of Object.entries(response.headers)) {
      if (FILTERED_RESPONSE_HEADERS.has(key.toLowerCase())) continue
      responseHeaders[key] = value
    }

    // 处理 Base64 编码的二进制响应
    const isBase64 = responseHeaders['x-proxy-base64'] === 'true'
    delete responseHeaders['x-proxy-base64']

    res.status(response.status)
    for (const [key, value] of Object.entries(responseHeaders)) {
      res.setHeader(key, value)
    }

    if (isBase64) {
      const buffer = Buffer.from(response.body, 'base64')
      res.send(buffer)
    } else {
      res.send(response.body)
    }
  } catch (e) { next(e) }
}

// Express 5 用 *path 命名通配符捕获剩余路径
proxyRouter.all('/:deviceId/:serviceName/*path', proxyHandler)
// 无路径的边界情况（如 /proxy/:deviceId/:serviceName）
proxyRouter.all('/:deviceId/:serviceName', proxyHandler)
