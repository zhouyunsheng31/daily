// server/src/webos/net/router.ts —— W3 互通原语 v1 REST 端点
// ----------------------------------------------------------------------------
// 挂载：/webos/api 之后（index.ts，与 packages/appapi 同级）。
//   循证：authMiddleware 全局 → 本模块二次解析 Principal（同 packages/appapi 模式）。
//   端点（全部要求非游客，R13）：
//     POST   /net/spaces                       创建共享空间 { name, mode? }
//     GET    /net/spaces                       我创建的共享空间
//     GET    /net/spaces/:id                   空间信息（reader）
//     PUT    /net/spaces/:id/mode              { mode }（owner）
//     POST   /net/spaces/:id/members           { handle }（owner 添加成员）
//     DELETE /net/spaces/:id/members?handle=   （owner 移除成员）
//     GET    /net/spaces/:id/keys              空间 KV 键列表（reader）
//     GET    /net/spaces/:id/keys/:key         读共享数据（reader）
//     PUT    /net/spaces/:id/keys/:key         { value, version? } 写共享数据（writer）
//     POST   /net/spaces/:id/events            { kind, payload?, to? }（writer）
//     GET    /net/spaces/:id/events?afterSeq=&to=  增量拉取（reader）
// ============================================================================

import { Router, type Response, type Request } from 'express'
import type { PrincipalLike } from '../appapi/appapi-service.js'
import {
  createSpace,
  getSpaceInfo,
  listMine,
  setSpaceMode,
  addMember,
  removeMember,
  keyGet,
  keySet,
  keyList,
  eventSend,
  eventPoll,
  eventPollWait,
  type NetResult,
} from './service.js'

export const netRouter = Router()

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

function send(res: Response, r: NetResult): void {
  if (r.ok) {
    res.json(r)
    return
  }
  const status =
    r.code === 'FORBIDDEN' ? 403 :
    r.code === 'NOT_FOUND' || r.code === 'HANDLE_NOT_FOUND' ? 404 :
    r.code === 'VERSION_CONFLICT' ? 409 :
    r.code === 'GUEST_NOT_ALLOWED' ? 401 :
    r.code === 'SEQ_CONFLICT' ? 409 : 400
  res.status(status).json({ ok: false, error: r.code, message: r.error })
}

function readPrincipal(res: Response, req: Request): { p: PrincipalLike } | null {
  const p = principalFromRequest(req as never)
  if (!p) {
    res.status(401).json({ ok: false, error: 'UNAUTHORIZED', message: '未登录' })
    return null
  }
  return { p }
}

/** 提取参数：body.params 或 body 本身或 query（同 appapi 兼容） */
function extractBody(req: Request): Record<string, unknown> {
  const body = req.body
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const b = body as Record<string, unknown>
    if (b.params !== undefined && typeof b.params === 'object' && !Array.isArray(b.params)) {
      return b.params as Record<string, unknown>
    }
    return b
  }
  return {}
}

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)

// ---- spaces ----

netRouter.post('/net/spaces', (req, res) => {
  const guard = readPrincipal(res, req)
  if (!guard) return
  const { p } = guard
  const body = extractBody(req)
  void createSpace(p, { name: str(body.name), mode: str(body.mode, 'invite') as never })
    .then((r) => send(res, r))
    .catch((error) => { if (!res.headersSent) res.status(500).json({ ok: false, error: 'INTERNAL', message: error instanceof Error ? error.message : String(error) }) })
})

netRouter.get('/net/spaces', (req, res) => {
  const guard = readPrincipal(res, req)
  if (!guard) return
  void listMine(guard.p)
    .then((r) => send(res, r))
    .catch((error) => { if (!res.headersSent) res.status(500).json({ ok: false, error: 'INTERNAL', message: error instanceof Error ? error.message : String(error) }) })
})

netRouter.get('/net/spaces/:id', (req, res) => {
  const guard = readPrincipal(res, req)
  if (!guard) return
  void getSpaceInfo(guard.p, str(req.params.id))
    .then((r) => send(res, r))
    .catch((error) => { if (!res.headersSent) res.status(500).json({ ok: false, error: 'INTERNAL', message: error instanceof Error ? error.message : String(error) }) })
})

netRouter.put('/net/spaces/:id/mode', (req, res) => {
  const guard = readPrincipal(res, req)
  if (!guard) return
  const body = extractBody(req)
  void setSpaceMode(guard.p, str(req.params.id), str(body.mode, 'invite') as never)
    .then((r) => send(res, r))
    .catch((error) => { if (!res.headersSent) res.status(500).json({ ok: false, error: 'INTERNAL', message: error instanceof Error ? error.message : String(error) }) })
})

netRouter.post('/net/spaces/:id/members', (req, res) => {
  const guard = readPrincipal(res, req)
  if (!guard) return
  const body = extractBody(req)
  void addMember(guard.p, str(req.params.id), str(body.handle))
    .then((r) => send(res, r))
    .catch((error) => { if (!res.headersSent) res.status(500).json({ ok: false, error: 'INTERNAL', message: error instanceof Error ? error.message : String(error) }) })
})

netRouter.delete('/net/spaces/:id/members', (req, res) => {
  const guard = readPrincipal(res, req)
  if (!guard) return
  const handle = typeof req.query.handle === 'string' ? req.query.handle : ''
  void removeMember(guard.p, str(req.params.id), handle)
    .then((r) => send(res, r))
    .catch((error) => { if (!res.headersSent) res.status(500).json({ ok: false, error: 'INTERNAL', message: error instanceof Error ? error.message : String(error) }) })
})

// ---- shared data（KV） ----

netRouter.get('/net/spaces/:id/keys', (req, res) => {
  const guard = readPrincipal(res, req)
  if (!guard) return
  void keyList(guard.p, str(req.params.id))
    .then((r) => send(res, r))
    .catch((error) => { if (!res.headersSent) res.status(500).json({ ok: false, error: 'INTERNAL', message: error instanceof Error ? error.message : String(error) }) })
})

netRouter.get('/net/spaces/:id/keys/:key', (req, res) => {
  const guard = readPrincipal(res, req)
  if (!guard) return
  void keyGet(guard.p, str(req.params.id), str(req.params.key))
    .then((r) => send(res, r))
    .catch((error) => { if (!res.headersSent) res.status(500).json({ ok: false, error: 'INTERNAL', message: error instanceof Error ? error.message : String(error) }) })
})

netRouter.put('/net/spaces/:id/keys/:key', (req, res) => {
  const guard = readPrincipal(res, req)
  if (!guard) return
  const body = extractBody(req)
  const rawVersion = typeof body.version === 'number' ? body.version : (typeof body.version === 'string' && /^\d+$/.test(body.version) ? Number(body.version) : undefined)
  void keySet(guard.p, str(req.params.id), str(req.params.key), body.value, rawVersion)
    .then((r) => send(res, r))
    .catch((error) => { if (!res.headersSent) res.status(500).json({ ok: false, error: 'INTERNAL', message: error instanceof Error ? error.message : String(error) }) })
})

// ---- events ----

netRouter.post('/net/spaces/:id/events', (req, res) => {
  const guard = readPrincipal(res, req)
  if (!guard) return
  const body = extractBody(req)
  void eventSend(guard.p, str(req.params.id), {
    kind: str(body.kind, 'event'),
    payload: body.payload,
    to: body.to === undefined ? null : (typeof body.to === 'string' ? body.to : null),
  })
    .then((r) => send(res, r))
    .catch((error) => { if (!res.headersSent) res.status(500).json({ ok: false, error: 'INTERNAL', message: error instanceof Error ? error.message : String(error) }) })
})

netRouter.get('/net/spaces/:id/events', (req, res) => {
  const guard = readPrincipal(res, req)
  if (!guard) return
  const afterSeq = typeof req.query.afterSeq === 'string' && /^\d+$/.test(req.query.afterSeq) ? Number(req.query.afterSeq) : 0
  const to = typeof req.query.to === 'string' && req.query.to ? req.query.to : null
  // ?wait=<秒>（上限 30s）长轮询：有新事件立即返回，否则等满 wait 返回当前结果
  const wait = typeof req.query.wait === 'string' && /^\d+$/.test(req.query.wait) ? Number(req.query.wait) : 0
  const pollFn = wait > 0
    ? eventPollWait(guard.p, str(req.params.id), { afterSeq, to, limit: Number(req.query.limit ?? 100), waitMs: wait * 1000 })
    : eventPoll(guard.p, str(req.params.id), { afterSeq, to, limit: Number(req.query.limit ?? 100) })
  void pollFn
    .then((r) => send(res, r))
    .catch((error) => { if (!res.headersSent) res.status(500).json({ ok: false, error: 'INTERNAL', message: error instanceof Error ? error.message : String(error) }) })
})