// server/src/webos/appapi/appapi-router.ts —— W2 App API REST 端点
// ----------------------------------------------------------------------------
// 依据：docs/routes/web/04-app-api.md §2①（服务端代理端点）。
//   挂载：/webos/api 之后（index.ts，与 packages/files 同级）。
//   端点：
//     POST   /appapi/:namespace/:endpoint     统一调用入口（参数在 body.params）
//     GET    /appapi/:namespace/:endpoint      只读端点快捷调用（参数在 query）
//     PUT    /appapi/:namespace/secrets        更新 api 包 secrets（只收声明名，值仅存服务端）
//     GET    /appapi/:namespace/secrets        只回执已设置名单，永不回传值
//   鉴权：跟随全局 authMiddleware，本模块按 principalFromRequest 解析（同 packages 模式）。
// ============================================================================

import { Router, type Response } from 'express'
import type { Principal } from '../../routes/webos.js'
import {
  invokeEndpoint,
  updateApiSecrets,
  getApiSecretsStatus,
  getNamespaceSpec,
  publishNamespace,
  unpublishNamespace,
  getPublicStatus,
} from './appapi-service.js'

export const appapiRouter = Router()

function principalFromRequest(req: {
  deviceId?: string
  user?: { authenticated?: unknown; guest?: unknown; userId?: string; guestDeviceId?: string; role?: unknown }
}): Principal | null {
  const user = req.user
  if (!user?.authenticated) return null
  if (user.guest) {
    const deviceId = user.guestDeviceId || req.deviceId
    if (!deviceId) return null
    return {
      key: `guest:${deviceId}`,
      id: `guest-${deviceId}`,
      deviceId,
      guest: true,
      role: 'guest',
    } as Principal
  }
  if (user.userId) {
    return {
      key: `user:${user.userId}`,
      id: user.userId,
      deviceId: `account-${user.userId}`,
      guest: false,
      role: (user.role === 'admin' ? 'admin' : 'member') as 'member' | 'admin',
    } as Principal
  }
  return null
}

function bad(res: Response, status: number, error: string, message: string): void {
  res.status(status).json({ ok: false, error, message })
}

/** 从 body.params 或 URL query 提取参数 */
function extractParams(req: { body?: unknown; query: Record<string, unknown> }): Record<string, unknown> {
  const body = req.body
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const b = body as Record<string, unknown>
    if (b.params !== undefined && typeof b.params === 'object' && !Array.isArray(b.params)) {
      return b.params as Record<string, unknown>
    }
    // 允许直接传参对象（前端可 body = { ...params }）
    const { params: _p, ...rest } = b
    if (Object.keys(rest).length > 0) return rest
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(req.query ?? {})) {
    if (k === 'params') continue
    out[k] = v
  }
  return out
}

// ---- PUT/GET /appapi/:namespace/secrets（字面路由须先于 :namespace/:endpoint 通配，避免被吞） ----
appapiRouter.put('/appapi/:namespace/secrets', (req, res) => {
  const principal = principalFromRequest(req as never)
  if (!principal) return void res.status(401).json({ ok: false, error: 'UNAUTHORIZED' })
  const namespace = String(req.params.namespace ?? '')
  const values = ((req.body as { values?: unknown })?.values ?? {}) as Record<string, string>
  void updateApiSecrets(principal, namespace, values).then((r) => {
    if (!r.ok) return void bad(res, 400, 'SECRETS_UPDATE_FAILED', r.error ?? '更新失败')
    res.json({ ok: true, set: r.set })
  }).catch((error) => {
    if (!res.headersSent) res.status(500).json({ ok: false, error: 'INTERNAL', message: error instanceof Error ? error.message : String(error) })
  })
})

appapiRouter.get('/appapi/:namespace/secrets', (req, res) => {
  const principal = principalFromRequest(req as never)
  if (!principal) return void res.status(401).json({ ok: false, error: 'UNAUTHORIZED' })
  const namespace = String(req.params.namespace ?? '')
  void getApiSecretsStatus(principal, namespace).then((r) => {
    res.json({ ok: r.ok, ...(r.error ? { error: r.error } : { declared: r.declared, set: r.set }) })
  }).catch((error) => {
    if (!res.headersSent) res.status(500).json({ ok: false, error: 'INTERNAL', message: error instanceof Error ? error.message : String(error) })
  })
})

// ---- POST/GET /appapi/:namespace/publish|unpublish|status（字面路由须先于 :namespace/:endpoint 通配） ----

appapiRouter.post('/appapi/:namespace/publish', (req, res) => {
  const principal = principalFromRequest(req as never)
  if (!principal) return void res.status(401).json({ ok: false, error: 'UNAUTHORIZED', message: '未登录' })
  const namespace = String(req.params.namespace ?? '')
  void publishNamespace(principal, namespace).then((r) => {
    if (!r.ok) return void bad(res, r.errorCode === 'NO_PUBLIC_ENDPOINTS' ? 400 : 404, r.errorCode!, r.error ?? '发布失败')
    res.json({ ok: true, namespace: r.namespace, publicEndpoints: r.publicEndpoints })
  }).catch((error) => {
    if (!res.headersSent) res.status(500).json({ ok: false, error: 'INTERNAL', message: error instanceof Error ? error.message : String(error) })
  })
})

appapiRouter.post('/appapi/:namespace/unpublish', (req, res) => {
  const principal = principalFromRequest(req as never)
  if (!principal) return void res.status(401).json({ ok: false, error: 'UNAUTHORIZED', message: '未登录' })
  const namespace = String(req.params.namespace ?? '')
  void unpublishNamespace(principal, namespace).then((r) => {
    if (!r.ok) return void bad(res, 404, r.errorCode!, r.error ?? '撤回失败')
    res.json({ ok: true, namespace })
  }).catch((error) => {
    if (!res.headersSent) res.status(500).json({ ok: false, error: 'INTERNAL', message: error instanceof Error ? error.message : String(error) })
  })
})

appapiRouter.get('/appapi/:namespace/status', (req, res) => {
  const principal = principalFromRequest(req as never)
  if (!principal) return void res.status(401).json({ ok: false, error: 'UNAUTHORIZED', message: '未登录' })
  const namespace = String(req.params.namespace ?? '')
  void getPublicStatus(principal, namespace).then((r) => {
    if (!r.ok) return void res.status(401).json({ ok: false, error: r.errorCode, message: r.error })
    res.json({ ok: true, published: r.published, publicEndpoints: r.publicEndpoints, ownerKey: r.ownerKey ?? null })
  }).catch((error) => {
    if (!res.headersSent) res.status(500).json({ ok: false, error: 'INTERNAL', message: error instanceof Error ? error.message : String(error) })
  })
})

// ---- POST /appapi/:namespace/:endpoint ----
appapiRouter.post('/appapi/:namespace/:endpoint', (req, res) => {
  const principal = principalFromRequest(req as never)
  if (!principal) return void res.status(401).json({ ok: false, error: 'UNAUTHORIZED' })
  const namespace = String(req.params.namespace ?? '')
  const endpoint = String(req.params.endpoint ?? '')
  if (!namespace || !endpoint) return void bad(res, 400, 'MISSING_PATH', '需要 /appapi/:namespace/:endpoint')
  const params = extractParams(req as never)
  const ip = req.ip ?? null
  void invokeEndpoint(principal, { namespace, endpoint, params, ip }).then((r) => {
    if (r.ok) res.json({ ok: true, result: r.value, costMinor: r.costMinor })
    else res.status(400).json({ ok: false, error: r.errorCode, message: r.error })
  }).catch((error) => {
    if (!res.headersSent) res.status(500).json({ ok: false, error: 'INTERNAL', message: error instanceof Error ? error.message : String(error) })
  })
})

// ---- GET /appapi/:namespace/:endpoint（只读端点，参数在 query） ----
appapiRouter.get('/appapi/:namespace/:endpoint', (req, res) => {
  const principal = principalFromRequest(req as never)
  if (!principal) return void res.status(401).json({ ok: false, error: 'UNAUTHORIZED' })
  const namespace = String(req.params.namespace ?? '')
  const endpoint = String(req.params.endpoint ?? '')
  if (!namespace || !endpoint) return void bad(res, 400, 'MISSING_PATH', '需要 /appapi/:namespace/:endpoint')
  const params = extractParams(req as never)
  void invokeEndpoint(principal, { namespace, endpoint, params, ip: req.ip ?? null }).then((r) => {
    if (r.ok) res.json({ ok: true, result: r.value, costMinor: r.costMinor })
    else res.status(400).json({ ok: false, error: r.errorCode, message: r.error })
  }).catch((error) => {
    if (!res.headersSent) res.status(500).json({ ok: false, error: 'INTERNAL', message: error instanceof Error ? error.message : String(error) })
  })
})

// ---- GET /appapi/:namespace（文档/调试数据源：端点清单） ----
appapiRouter.get('/appapi/:namespace', (req, res) => {
  const principal = principalFromRequest(req as never)
  if (!principal) return void res.status(401).json({ ok: false, error: 'UNAUTHORIZED' })
  const namespace = String(req.params.namespace ?? '')
  void getNamespaceSpec(principal, namespace).then((r) => {
    if (!r.ok) return void res.status(404).json({ ok: false, error: 'NAMESPACE_NOT_FOUND', message: r.error })
    res.json(r)
  }).catch((error) => {
    if (!res.headersSent) res.status(500).json({ ok: false, error: 'INTERNAL', message: error instanceof Error ? error.message : String(error) })
  })
})