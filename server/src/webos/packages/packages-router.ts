// server/src/webos/packages/packages-router.ts —— W1 包体系 REST 端点族
// ----------------------------------------------------------------------------
// 依据：docs/routes/web/03-package-system.md §4（REST 端点族）。
//   挂载：<root>/webos/api 之后，与 filesRouter/desktopLayoutRouter 同级。
//   鉴权：跟随全局 authMiddleware（req.user），本模块按 principalFromRequest
//         复用 desktopLayout 的模式做二次解析（不触碰冻结的 webos.ts）。
//   端点：
//     GET    /packages?type=&q=           包列表（含 type=app 只读适配视图）
//     POST   /packages                     粘贴/上传创建（AI 走文件夹路径不经此）
//     GET    /packages/:id                 包详情（不可变版本 + 审计 + 安装态）
//     POST   /packages/:id/versions        推新版本（可带文件；内容变化才建版本）
//     PUT    /packages/:id/active-version  原子切活动版本指针
//     POST   /packages/:id/rollback        回滚
//     DELETE /packages/:id                 移入回收站（DB 行保留，可恢复）
//     GET    /packages/:id/files/raw/...   包文件（鉴权 + owner + 防穿越；W4 执行引擎再开放免鉴权）
// ============================================================================

import fs from 'node:fs'
import { Router, type Request, type Response } from 'express'
import type { Principal } from '../../routes/webos.js'
import {
  listForUser,
  getDetailForUser,
  createFromPaste,
  pushNewVersion,
  setActiveVersion,
  rollbackTo,
  recyclePackage,
  restorePackage,
  resolvePackageFilePath,
} from './packages-service.js'

export const packagesRouter = Router()

// 响应状态统一：错误返回 { ok:false, error, message }；成功返回 { ok:true, ... }
function bad(res: Response, error: string, message: string): void {
  res.status(400).json({ ok: false, error, message })
}

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

// ---- GET /packages?type=&q= ----
packagesRouter.get('/packages', async (req, res, next) => {
  try {
    const principal = principalFromRequest(req as never)
    if (!principal) return void res.status(401).json({ ok: false, error: 'UNAUTHORIZED' })
    const type = typeof req.query.type === 'string' && req.query.type ? String(req.query.type) : undefined
    const q = typeof req.query.q === 'string' && req.query.q ? String(req.query.q) : undefined
    const items = await listForUser(principal.key, { type, q })
    res.json({ ok: true, items, total: items.length })
  } catch (error) {
    next(error)
  }
})

// ---- POST /packages（粘贴/上传创建） ----
packagesRouter.post('/packages', async (req, res, next) => {
  try {
    const principal = principalFromRequest(req as never)
    if (!principal) return void res.status(401).json({ ok: false, error: 'UNAUTHORIZED' })
    const body = req.body as { manifest?: unknown; files?: unknown }
    if (!body || typeof body !== 'object' || body.manifest === undefined) {
      return void bad(res, 'INVALID_PACKAGE_BODY', '需要 { manifest: daily.pkg.json, files?: {path: content} }')
    }
    const files = normalizeFiles(body.files)
    const r = await createFromPaste(principal.key, { manifest: body.manifest, files })
    if (!r.ok) return void bad(res, 'PACKAGE_VALIDATION_FAILED', r.feedback)
    return void res.json({ ok: true, id: r.id, feedback: r.feedback })
  } catch (error) {
    next(error)
  }
})

function normalizeFiles(files: unknown): Record<string, string> | Array<{ path: string; content: string }> | undefined {
  if (!files || typeof files !== 'object') return undefined
  if (Array.isArray(files)) {
    return files
      .filter((f): f is { path: string; content: string } => !!f && typeof (f as { path?: unknown }).path === 'string' && typeof (f as { content?: unknown }).content === 'string')
  }
  const out: Record<string, string> = {}
  for (const [p, c] of Object.entries(files as Record<string, unknown>)) {
    if (typeof c === 'string') out[p] = c
  }
  return out
}

// ---- GET /packages/:id ----
packagesRouter.get('/packages/:id', async (req, res, next) => {
  try {
    const principal = principalFromRequest(req as never)
    if (!principal) return void res.status(401).json({ ok: false, error: 'UNAUTHORIZED' })
    const detail = await getDetailForUser(principal.key, String(req.params.id))
    if (!detail) return void res.status(404).json({ ok: false, error: 'PACKAGE_NOT_FOUND', message: '找不到该包（apps 请走 /webos/api/apps）' })
    res.json({ ok: true, ...detail })
  } catch (error) {
    next(error)
  }
})

// ---- POST /packages/:id/versions ----
packagesRouter.post('/packages/:id/versions', async (req, res, next) => {
  try {
    const principal = principalFromRequest(req as never)
    if (!principal) return void res.status(401).json({ ok: false, error: 'UNAUTHORIZED' })
    const files = normalizeFiles((req.body as { files?: unknown })?.files)
    const r = await pushNewVersion(principal.key, String(req.params.id), { files })
    if (!r.ok) return void bad(res, 'PACKAGE_VALIDATION_FAILED', r.feedback)
    res.json({ ok: true, feedback: r.feedback })
  } catch (error) {
    next(error)
  }
})

// ---- PUT /packages/:id/active-version ----
packagesRouter.put('/packages/:id/active-version', async (req, res, next) => {
  try {
    const principal = principalFromRequest(req as never)
    if (!principal) return void res.status(401).json({ ok: false, error: 'UNAUTHORIZED' })
    const versionId = (req.body as { versionId?: unknown })?.versionId
    if (typeof versionId !== 'string' || !versionId) return void bad(res, 'MISSING_VERSION_ID', '需要 body { versionId }')
    const r = await setActiveVersion(principal.key, String(req.params.id), versionId)
    if (!r.ok) return void bad(res, 'SET_ACTIVE_FAILED', r.feedback)
    res.json({ ok: true, feedback: r.feedback })
  } catch (error) {
    next(error)
  }
})

// ---- POST /packages/:id/rollback ----
packagesRouter.post('/packages/:id/rollback', async (req, res, next) => {
  try {
    const principal = principalFromRequest(req as never)
    if (!principal) return void res.status(401).json({ ok: false, error: 'UNAUTHORIZED' })
    const toVersionId = (req.body as { toVersionId?: unknown })?.toVersionId
    const r = await rollbackTo(principal.key, String(req.params.id), {
      toVersionId: typeof toVersionId === 'string' && toVersionId ? toVersionId : undefined,
    })
    if (!r.ok) return void bad(res, 'ROLLBACK_FAILED', r.feedback)
    res.json({ ok: true, feedback: r.feedback })
  } catch (error) {
    next(error)
  }
})

// ---- DELETE /packages/:id ----
packagesRouter.delete('/packages/:id', async (req, res, next) => {
  try {
    const principal = principalFromRequest(req as never)
    if (!principal) return void res.status(401).json({ ok: false, error: 'UNAUTHORIZED' })
    const r = await recyclePackage(principal.key, String(req.params.id))
    if (!r.ok) return void bad(res, 'RECYCLE_FAILED', r.feedback)
    res.json({ ok: true, feedback: r.feedback })
  } catch (error) {
    next(error)
  }
})

// ---- POST /packages/:id/restore（回收站恢复；文档端点族未列出但回收语义需要） ----
packagesRouter.post('/packages/:id/restore', async (req, res, next) => {
  try {
    const principal = principalFromRequest(req as never)
    if (!principal) return void res.status(401).json({ ok: false, error: 'UNAUTHORIZED' })
    const r = await restorePackage(principal.key, String(req.params.id))
    if (!r.ok) return void bad(res, 'RESTORE_FAILED', r.feedback)
    res.json({ ok: true, feedback: r.feedback })
  } catch (error) {
    next(error)
  }
})

// ---- GET /packages/:id/files/raw/<rest> 或 ?path=（鉴权 + owner + 防穿越） ----
packagesRouter.get('/packages/:id/files/raw/:rest', async (req, res, next) => {
  await servePackageFile(req, res)
  next?.()
})
packagesRouter.get('/packages/:id/files/raw', async (req, res, next) => {
  if (typeof req.query.path !== 'string' || !req.query.path) {
    res.status(400).json({ ok: false, error: 'MISSING_PATH', message: '需要 ?path= 包内相对路径' })
    return next?.()
  }
  // 合并 rest 与 query.path —— route 以 ?path= 为准
  ;(req as { pkgRestPath?: string }).pkgRestPath = String(req.query.path)
  await servePackageFile(req, res)
  next?.()
})

async function servePackageFile(req: Request, res: Response): Promise<void> {
  try {
    const principal = principalFromRequest(req as never)
    if (!principal) {
      res.status(401).json({ ok: false, error: 'UNAUTHORIZED' })
      return
    }
    const id = String(req.params.id)
    const rest = (req as Request & { pkgRestPath?: string }).pkgRestPath
      ?? (Array.isArray(req.params.rest) ? (req.params.rest as string[]).join('/') : String(req.params.rest ?? ''))
    if (!rest) {
      res.status(400).json({ ok: false, error: 'MISSING_PATH', message: '缺少包内文件路径' })
      return
    }
    // owner/install 检查（W1 私有包；W3 市场 / W4 执行引擎再按情况免鉴权）
    const detail = await getDetailForUser(principal.key, id)
    if (!detail) {
      res.status(404).json({ ok: false, error: 'PACKAGE_NOT_FOUND' })
      return
    }
    if (!detail.install || !detail.install.installed) {
      res.status(404).json({ ok: false, error: 'PACKAGE_NOT_FOUND', message: '包未安装或已回收' })
      return
    }
    const full = resolvePackageFilePath(principal.key, id, rest)
    if (!full || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
      res.status(404).json({ ok: false, error: 'FILE_NOT_FOUND', message: `包内文件不存在：${rest}` })
      return
    }
    res.setHeader('Cache-Control', 'private, max-age=60')
    res.sendFile(full)
  } catch (error) {
    if (!res.headersSent) res.status(500).json({ ok: false, error: 'INTERNAL', message: error instanceof Error ? error.message : String(error) })
  }
}