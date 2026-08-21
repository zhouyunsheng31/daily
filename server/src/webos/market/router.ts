// server/src/webos/market/router.ts —— W3 统一包市场（R14）REST 端点
// ----------------------------------------------------------------------------
// 挂载：/webos/api 之后（index.ts）。循证：authMiddleware 全局 → 本模块二次解析 Principal。
//   端点（发布/安装/详情/我的需非游客，R13；浏览 list 开放给已鉴权用户）：
//     GET    /market?type=&q=              市场列表（live 条目）
//     GET    /market/mine                  我的安装记录
//     POST   /market/publish   {packageId} owner 发布（静态扫描 → live）
//     POST   /market/:id/unpublish          owner 下架
//     GET    /market/:id                    详情（含数据范围/端点摘要/安装态）
//     POST   /market/:id/install            安装（依赖闭包自动一并装）
// ============================================================================

import { Router, type Response, type Request } from 'express'
import type { PrincipalLike } from '../appapi/appapi-service.js'
import {
  listMarket,
  listMarketAppsGlobal,
  marketDetail,
  publishPackage,
  unpublishPackage,
  installMarketPackage,
  listMyMarketInstalls,
  type MarketResult,
} from './service.js'

export const marketRouter = Router()

function principalFromRequest(req: {
  deviceId?: string
  user?: { authenticated?: unknown; guest?: unknown; userId?: string; guestDeviceId?: string; role?: unknown }
}): PrincipalLike | null {
  const user = req.user
  if (!user?.authenticated) return null
  if (user.guest) {
    const deviceId = user.guestDeviceId || req.deviceId
    if (!deviceId) return null
    return { key: `guest:${deviceId}`, id: `guest-${deviceId}`, guest: true, role: 'guest' } as PrincipalLike
  }
  if (user.userId) {
    return {
      key: `user:${user.userId}`,
      id: user.userId,
      guest: false,
      role: (user.role === 'admin' ? 'admin' : 'member') as 'member' | 'admin',
    } as PrincipalLike
  }
  return null
}

function send(res: Response, r: MarketResult): void {
  if (r.ok) { res.json(r); return }
  const status =
    r.code === 'FORBIDDEN' ? 403 :
    r.code === 'NOT_FOUND' ? 404 :
    r.code === 'GUEST_NOT_ALLOWED' ? 401 :
    r.code === 'SCAN_REJECTED' ? 400 :
    r.code === 'DEP_UNSATISFIED' ? 409 : 400
  res.status(status).json({ ok: false, error: r.code, message: r.error, ...(r.issues ? { issues: r.issues } : {}) })
}

function readPrincipal(res: Response, req: Request, allowGuest = false): PrincipalLike | null {
  const p = principalFromRequest(req as never)
  if (!p) { res.status(401).json({ ok: false, error: 'UNAUTHORIZED', message: '未登录' }); return null }
  if (p.guest && !allowGuest) { res.status(401).json({ ok: false, error: 'GUEST_NOT_ALLOWED', message: '互通体系仅面向注册用户（R13）' }); return null }
  return p
}

const str = (v: unknown, fb = ''): string => (typeof v === 'string' ? v : fb)
const strBody = (req: Request, k: string): string => {
  const b = req.body as Record<string, unknown> | undefined
  return typeof b?.[k] === 'string' ? (b[k] as string) : ''
}

// ---- 列表（开放浏览） / 我的安装（非游客） ----

marketRouter.get('/market', (req, res) => {
  const p = readPrincipal(res, req, true)
  if (!p) return
  const type = typeof req.query.type === 'string' && req.query.type ? String(req.query.type) : undefined
  const q = typeof req.query.q === 'string' && req.query.q ? String(req.query.q) : undefined
  void listMarket({ type, q })
    .then((r) => send(res, r))
    .catch((error) => { if (!res.headersSent) res.status(500).json({ ok: false, error: 'INTERNAL', message: error instanceof Error ? error.message : String(error) }) })
})

// 市场「App」维度：全局已发布 App 包（宿主 SDK market.apps 消费；与 listMarket?type=app 一致）
marketRouter.get('/market/apps', (req, res) => {
  void listMarketAppsGlobal()
    .then((r) => send(res, r))
    .catch((error) => { if (!res.headersSent) res.status(500).json({ ok: false, error: 'INTERNAL', message: error instanceof Error ? error.message : String(error) }) })
})

marketRouter.get('/market/mine', (req, res) => {
  const p = readPrincipal(res, req, false)
  if (!p) return
  void listMyMarketInstalls(p)
    .then((r) => send(res, r))
    .catch((error) => { if (!res.headersSent) res.status(500).json({ ok: false, error: 'INTERNAL', message: error instanceof Error ? error.message : String(error) }) })
})

// ---- 发布 / 详情 / 安装 / 下架（非游客） ----

marketRouter.post('/market/publish', (req, res) => {
  const p = readPrincipal(res, req, false)
  if (!p) return
  const packageId = strBody(req, 'packageId')
  if (!packageId) { res.status(400).json({ ok: false, error: 'MISSING_ID', message: '需要 body { packageId }' }); return }
  void publishPackage(p, packageId)
    .then((r) => { if (r.ok) res.status(201).json(r); else send(res, r) })
    .catch((error) => { if (!res.headersSent) res.status(500).json({ ok: false, error: 'INTERNAL', message: error instanceof Error ? error.message : String(error) }) })
})

marketRouter.get('/market/:id', (req, res) => {
  const p = readPrincipal(res, req, false)
  if (!p) return
  void marketDetail(p, str(req.params.id))
    .then((r) => send(res, r))
    .catch((error) => { if (!res.headersSent) res.status(500).json({ ok: false, error: 'INTERNAL', message: error instanceof Error ? error.message : String(error) }) })
})

marketRouter.post('/market/:id/install', (req, res) => {
  const p = readPrincipal(res, req, false)
  if (!p) return
  void installMarketPackage(p, str(req.params.id))
    .then((r) => { if (r.ok) res.status(201).json(r); else send(res, r) })
    .catch((error) => { if (!res.headersSent) res.status(500).json({ ok: false, error: 'INTERNAL', message: error instanceof Error ? error.message : String(error) }) })
})

marketRouter.post('/market/:id/unpublish', (req, res) => {
  const p = readPrincipal(res, req, false)
  if (!p) return
  void unpublishPackage(p, str(req.params.id))
    .then((r) => send(res, r))
    .catch((error) => { if (!res.headersSent) res.status(500).json({ ok: false, error: 'INTERNAL', message: error instanceof Error ? error.message : String(error) }) })
})