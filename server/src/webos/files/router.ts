// server/src/webos/files/router.ts —— File Service 一阶段 REST API
// ----------------------------------------------------------------------------
// 依据：docs/routes/web/07-files.md §2.2。web 与移动端共用：
//   GET    /webos/api/files/manifest?prefix=       全量清单（移动端同步锚点）
//   GET    /webos/api/files/blob?path=             下载（支持 Range）
//   PUT    /webos/api/files/blob?path= [body]      小文件直传（≤8MB，body 为原始字节）
//   POST   /webos/api/files/upload           分块（action: init|part|complete|abort）
//   DELETE /webos/api/files?path=                 删（回收站语义）
//   POST   /webos/api/files/snapshot              手动快照点
//   POST   /webos/api/files/reconcile             对齐磁盘↔表（管理员触发）
// 认证继承 /webos/api 的 authMiddleware（由 index.ts 挂载）。
// ============================================================================

import { Router } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { getPool } from '../../db/connection.js'
import { getWorkspaceRoot, workspaceUsedBytes, workspaceLimitFor } from '../../utils/webosWorkspace.js'
import {
  listManifest,
  storeFileMeta,
  markFileDeleted,
  storeFileVersion,
  getFileMeta,
} from './db.js'
import {
  mimeOf,
  relativize,
  fingerprintFile,
  createSnapshotPoint,
  reconcileFileMetadata,
} from './service.js'

export const filesRouter = Router()

// 文件服务常量（与 shared/webos-contracts/files.ts 的 FILE_SERVICE_CONSTANTS 同源；
// server 受 rootDir 限制不能 import shared 的 .ts，此处本地定义，值由 shared 侧守卫测试保证一致）
const FILE_CHUNK_SIZE = 8 * 1024 * 1024
const FILE_SMALL_PUT_LIMIT = 8 * 1024 * 1024
const FILE_SESSION_TTL_MS = 2 * 60 * 60 * 1000
const FILE_MANIFEST_MAX_ENTRIES = 20_000

/** authPrincipal（与 desktopLayout 同模式：从 req.user 本地解析） */
function principalFromRequest(req: { deviceId?: string; user?: { authenticated?: unknown; guest?: unknown; userId?: string; guestDeviceId?: string; role?: unknown } }): { key: string } | null {
  const user = req.user
  if (!user?.authenticated) return null
  if (user.guest) {
    const deviceId = user.guestDeviceId || req.deviceId
    if (!deviceId) return null
    return { key: `guest:${deviceId}` }
  }
  if (user.userId) return { key: `user:${user.userId}` }
  return null
}

function pathQuery(value: unknown): string {
  const s = typeof value === 'string' ? value.trim() : ''
  return s.replace(/^\/+/, '')
}

/** 解析相对路径 → 工作区绝对路径（防穿越：同 resolveWorkspacePath 语义） */
function resolvePath(key: string, rel: string): string {
  if (rel.length === 0 || rel.length > 512 || rel.includes('\0')) throw new Error('INVALID_PATH')
  const root = getWorkspaceRoot(key)
  const resolved = path.resolve(root, rel)
  const relative = path.relative(root, resolved)
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('PATH_ESCAPE')
  return resolved
}

// ============================================================================
// GET /files/manifest?prefix=
// ============================================================================
filesRouter.get('/files/manifest', async (req, res, next) => {
  try {
    const principal = principalFromRequest(req as never)
    if (!principal) return void res.status(401).json({ error: 'UNAUTHORIZED' })
    const prefix = pathQuery(req.query.prefix).split(path.sep).join('/')
    const manifest = await listManifest(principal.key, prefix)
    const entries = manifest
      .slice(0, FILE_MANIFEST_MAX_ENTRIES)
      .map((row) => ({ path: row.path, size: row.size, etag: row.sha256, mtime: row.updatedAt, mime: row.mime }))
    const totalBytes = entries.reduce((sum, e) => sum + e.size, 0)
    res.json({ ok: true, prefix, entries, totalBytes })
  } catch (error) {
    next(error)
  }
})

// ============================================================================
// GET /files/blob?path=  （支持 Range；视频/大文件断点）
// ============================================================================
filesRouter.get('/files/blob', async (req, res, next) => {
  try {
    const principal = principalFromRequest(req as never)
    if (!principal) return void res.status(401).json({ error: 'UNAUTHORIZED' })
    const rel = pathQuery(req.query.path).split(path.sep).join('/')
    const full = resolvePath(principal.key, rel)
    const stat = fs.statSync(full)
    if (!stat.isFile()) return void res.status(404).json({ error: 'FILE_NOT_FOUND' })

    res.setHeader('Content-Type', mimeOf(full))
    res.setHeader('Accept-Ranges', 'bytes')
    const range = req.headers.range
    if (range) {
      const match = /bytes=(\d*)-(\d*)/.exec(range)
      if (match) {
        const start = match[1] ? parseInt(match[1], 10) : 0
        const end = match[2] ? parseInt(match[2], 10) : stat.size - 1
        if (start >= 0 && end >= start && end < stat.size) {
          res.status(206)
          res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`)
          res.setHeader('Content-Length', end - start + 1)
          fs.createReadStream(full, { start, end }).pipe(res)
          return
        }
      }
      res.status(416).setHeader('Content-Range', `bytes */${stat.size}`).end()
      return
    }
    res.setHeader('Content-Length', stat.size)
    fs.createReadStream(full).pipe(res)
  } catch (error) {
    next(error)
  }
})

// ============================================================================
// PUT /files/blob?path=  （小文件直传，body 为原始 Buffer）
// ============================================================================
filesRouter.put('/files/blob', async (req, res, next) => {
  try {
    const principal = principalFromRequest(req as never)
    if (!principal) return void res.status(401).json({ error: 'UNAUTHORIZED' })
    const rel = pathQuery(req.query.path).split(path.sep).join('/')
    const bytes = req.body
    if (!Buffer.isBuffer(bytes)) {
      // Express json 解析后非 Buffer → 需要 raw body（见 index.ts 挂载时该路由用 express.raw）
      return void res.status(415).json({ error: 'BLOB_RAW_REQUIRED', message: 'PUT blob 需要原始字节 body（express.raw）' })
    }
    if (bytes.length > FILE_SMALL_PUT_LIMIT) {
      return void res.status(413).json({ error: 'TOO_LARGE', message: `单次直传上限 ${FILE_SMALL_PUT_LIMIT / 1024 / 1024}MB，更大文件请用分块上传` })
    }
    const full = resolvePath(principal.key, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, bytes)
    const { size, etag } = fingerprintFile(full)
    await storeFileMeta({ userKey: principal.key, path: rel, size, sha256: etag, mime: mimeOf(full), updatedAt: fs.statSync(full).mtimeMs })
    // 图片双写公开副本（工作区 home/ 下图片免鉴权 on-demand）
    res.json({ ok: true, file: { path: rel, size, etag, mtime: fs.statSync(full).mtimeMs, mime: mimeOf(full) } })
  } catch (error) {
    next(error)
  }
})

// ============================================================================
// POST /files/upload  —— 分块上传（action: init|part|complete|abort）
// body: JSON { action, path?, totalBytes?, index?, data?(base64), uploadId? }
// ============================================================================
interface UploadSession {
  key: string
  uploadId: string
  path: string
  tmpPath: string
  totalBytes: number
  bytesSoFar: number
  partsCount: number
  lastActiveAt: number
}
const uploadSessions = new Map<string, UploadSession>()

function uploadTmpDir(key: string): string {
  const d = path.join(process.cwd(), 'data', 'webos-uploads', key.replace(/[^a-zA-Z0-9_.:-]/g, '_'))
  fs.mkdirSync(d, { recursive: true })
  return d
}

function expireUploadSessions(): void {
  const now = Date.now()
  for (const [id, s] of uploadSessions) {
    if (now - s.lastActiveAt > FILE_SESSION_TTL_MS) {
      try { fs.unlinkSync(s.tmpPath) } catch { /* 忽略 */ }
      uploadSessions.delete(id)
    }
  }
}

filesRouter.post('/files/upload', async (req, res, next) => {
  try {
    const principal = principalFromRequest(req as never)
    if (!principal) return void res.status(401).json({ error: 'UNAUTHORIZED' })
    expireUploadSessions()
    const body = (req.body ?? {}) as {
      action?: string
      path?: string
      totalBytes?: number
      index?: number
      data?: string
      uploadId?: string
    }
    const action = typeof body.action === 'string' ? body.action : ''

    if (action === 'init') {
      const rel = pathQuery(body.path).split(path.sep).join('/')
      const totalBytes = typeof body.totalBytes === 'number' && body.totalBytes >= 0 ? body.totalBytes : 0
      // 复用未完成同会话（断点续传）
      for (const s of uploadSessions.values()) {
        if (s.key === principal.key && s.path === rel && s.totalBytes === totalBytes && s.bytesSoFar < s.totalBytes) {
          s.lastActiveAt = Date.now()
          return void res.json({
            ok: true, uploadId: s.uploadId, path: rel, totalBytes,
            chunkSize: FILE_CHUNK_SIZE,
            partsCount: totalBytes === 0 ? 1 : Math.ceil(totalBytes / FILE_CHUNK_SIZE),
            resumed: true, receivedParts: s.partsCount,
          })
        }
      }
      const uploadId = randomUUID()
      const tmpPath = path.join(uploadTmpDir(principal.key), uploadId)
      fs.writeFileSync(tmpPath, Buffer.alloc(0))
      uploadSessions.set(uploadId, { key: principal.key, uploadId, path: rel, tmpPath, totalBytes, bytesSoFar: 0, partsCount: 0, lastActiveAt: Date.now() })
      return void res.json({
        ok: true, uploadId, path: rel, totalBytes,
        chunkSize: FILE_CHUNK_SIZE,
        partsCount: totalBytes === 0 ? 1 : Math.ceil(totalBytes / FILE_CHUNK_SIZE),
        resumed: false,
      })
    }

    const session = body.uploadId ? uploadSessions.get(body.uploadId) : undefined
    if (!session || session.key !== principal.key) {
      return void res.status(404).json({ error: 'UPLOAD_NOT_FOUND', message: '上传会话不存在或已过期，请重新开始' })
    }

    if (action === 'part') {
      const index = typeof body.index === 'number' && Number.isInteger(body.index) ? body.index : -1
      if (index !== session.partsCount) {
        return void res.status(400).json({ error: 'PART_SEQUENCE', message: `分片顺序错误：期望第 ${session.partsCount} 片，收到第 ${index} 片` })
      }
      const contentBase64 = typeof body.data === 'string' ? body.data : ''
      const buffer = Buffer.from(contentBase64, 'base64')
      fs.appendFileSync(session.tmpPath, buffer)
      session.bytesSoFar += buffer.length
      session.partsCount += 1
      session.lastActiveAt = Date.now()
      if (session.bytesSoFar > session.totalBytes) {
        return void res.status(400).json({ error: 'PART_OVERFLOW', message: '分片总字节超过声明大小' })
      }
      return void res.json({ ok: true, received: session.bytesSoFar, partsCount: session.partsCount, totalBytes: session.totalBytes })
    }

    if (action === 'complete') {
      if (session.bytesSoFar !== session.totalBytes) {
        return void res.status(400).json({ error: 'INCOMPLETE', message: `已收 ${session.bytesSoFar}/${session.totalBytes} 字节，请传完再 complete` })
      }
      const full = resolvePath(principal.key, session.path)
      fs.mkdirSync(path.dirname(full), { recursive: true })
      fs.renameSync(session.tmpPath, full)
      uploadSessions.delete(session.uploadId)
      const { size, etag } = fingerprintFile(full)
      const mime = mimeOf(full)
      await storeFileMeta({ userKey: principal.key, path: session.path, size, sha256: etag, mime, updatedAt: fs.statSync(full).mtimeMs })
      return void res.json({
        ok: true,
        file: { path: session.path, size, etag, mtime: fs.statSync(full).mtimeMs, mime },
        workspaceBytes: workspaceUsedBytes(principal.key),
        workspaceLimitBytes: workspaceLimitFor(principal.key),
      })
    }

    if (action === 'abort') {
      try { fs.unlinkSync(session.tmpPath) } catch { /* 忽略 */ }
      uploadSessions.delete(session.uploadId)
      return void res.json({ ok: true })
    }

    return void res.status(400).json({ error: 'BAD_ACTION', message: 'action 必须是 init|part|complete|abort' })
  } catch (error) {
    next(error)
  }
})

// ============================================================================
// DELETE /files?path=
// ============================================================================
filesRouter.delete('/files', async (req, res, next) => {
  try {
    const principal = principalFromRequest(req as never)
    if (!principal) return void res.status(401).json({ error: 'UNAUTHORIZED' })
    const rel = pathQuery(req.query.path).split(path.sep).join('/')
    const full = resolvePath(principal.key, rel)
    if (fs.existsSync(full)) {
      fs.rmSync(full, { recursive: false })
    }
    await markFileDeleted(principal.key, rel)
    res.json({ ok: true, trash: true })
  } catch (error) {
    next(error)
  }
})

// ============================================================================
// POST /files/snapshot  手动快照点（AI 批量改写前）
// ============================================================================
filesRouter.post('/files/snapshot', async (req, res, next) => {
  try {
    const principal = principalFromRequest(req as never)
    if (!principal) return void res.status(401).json({ error: 'UNAUTHORIZED' })
    const label = (req.body && typeof (req.body as { label?: unknown }).label === 'string')
      ? String((req.body as { label?: unknown }).label).slice(0, 100)
      : 'manual'
    const snap = await createSnapshotPoint(principal.key, label)
    res.json({ ok: true, snapshotId: snap.snapshotId, fileCount: snap.fileCount, createdAt: snap.createdAt })
  } catch (error) {
    next(error)
  }
})

// ============================================================================
// POST /files/reconcile  —— 磁盘↔表对齐（默认全量；管理员/自动任务可带 userKey）
// ============================================================================
filesRouter.post('/files/reconcile', async (req, res, next) => {
  try {
    const principal = principalFromRequest(req as never)
    if (!principal) return void res.status(401).json({ error: 'UNAUTHORIZED' })
    // 仅本人触发自己（管理员后续可传 userKey；首版保守：只允许自己）
    const result = await reconcileFileMetadata([principal.key])
    res.json({ ok: true, ...result })
  } catch (error) {
    next(error)
  }
})