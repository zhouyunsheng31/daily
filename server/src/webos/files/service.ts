// server/src/webos/files/service.ts —— File Service 一阶段：核心数据操作
// ----------------------------------------------------------------------------
// 为移动端同步铺路（manifest 锚点）并把用户文件补上元数据与版本（07 分篇）：
//   - recordFileStats     : 写磁盘后登记/更新 files 元数据（双写核心，被 hook 调用）
//   - recordFileDeleted   : 删除后标记回收站语义
//   - scanWorkspace       : 全量扫描磁盘 → files 表（reconcile 种子）
//   - reconcile           : 磁盘 ↔ files 表 diff 对齐（后台任务）
//   - createSnapshotPoint : 手动/自动快照点（AI 批量改写前）
// 路径语义不变：home/ agent/ system/ apps/ shared/ 与现有 agent_fs 完全兼容。
// ============================================================================

import fs from 'node:fs'
import path from 'node:path'
import { getPool } from '../../db/connection.js'
import { getWorkspaceRoot, isUserHomeFile } from '../../utils/webosWorkspace.js'
import {
  etagOf,
  storeFileMeta,
  markFileDeleted,
  purgeFileMeta,
  getFileMeta,
  listManifest,
  storeFileVersion,
  sumFileBytes,
  FileMetaRow,
} from './db.js'

/** MIME 识别（尽力）；未知返回 application/octet-stream */
export function mimeOf(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  const table: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
    '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.avif': 'image/avif',
    '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska',
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.flac': 'audio/flac',
    '.pdf': 'application/pdf', '.json': 'application/json', '.txt': 'text/plain', '.md': 'text/markdown',
    '.html': 'text/html', '.htm': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
    '.mjs': 'text/javascript', '.cjs': 'text/javascript', '.zip': 'application/zip',
    '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.csv': 'text/csv', '.wasm': 'application/wasm', '.ttf': 'font/ttf', '.otf': 'font/otf',
  }
  return table[ext] ?? 'application/octet-stream'
}

/** 相对路径化：绝对路径 → 相对工作区根的 posix 路径 */
export function relativize(key: string, fullPath: string): string {
  const root = getWorkspaceRoot(key)
  const rel = path.relative(root, path.resolve(fullPath))
  return rel.split(path.sep).join('/')
}

/** 读取文件并计算 etag；size > 阈值时用前 256KB+后 256KB 采样指纹（避免大文件全读） */
export function fingerprintFile(filePath: string): { size: number; etag: string } {
  const stat = fs.statSync(filePath)
  const size = stat.size
  const CHUNK = 256 * 1024
  if (size <= 4 * 1024 * 1024 && size < 2 * 1024 * 1024 * 1024) {
    // 小文件直接全读（≤4MB 内存安全）
    const data = fs.readFileSync(filePath)
    return { size, etag: etagOf(data) }
  }
  // 大文件采样头尾，够增量同步判定即可（不追求全量哈希）
  const fd = fs.openSync(filePath, 'r')
  try {
    const head = Buffer.alloc(Math.min(CHUNK, size))
    fs.readSync(fd, head, 0, head.length, 0)
    const tailLen = Math.min(CHUNK, size)
    const tail = Buffer.alloc(tailLen)
    fs.readSync(fd, tail, 0, tailLen, Math.max(0, size - tailLen))
    return { size, etag: etagOf(Buffer.concat([head, tail])) }
  } finally {
    fs.closeSync(fd)
  }
}

/** 写磁盘后登记/更新元数据（双写核心；由 webos.ts 的 onFileChanged hook 调用） */
export async function recordFileStats(key: string, fullPath: string): Promise<FileMetaRow | null> {
  try {
    const stat = fs.statSync(fullPath)
    if (!stat.isFile()) return null // 目录不登记单文件
    const { size, etag } = fingerprintFile(fullPath)
    const rel = relativize(key, fullPath)
    return await storeFileMeta({
      userKey: key,
      path: rel,
      size,
      sha256: etag,
      mime: mimeOf(fullPath),
      updatedAt: stat.mtimeMs,
    })
  } catch {
    return null // 登记失败静默（不阻断文件操作自身）
  }
}

/** 删除后更新元数据（回收站语义：deleted_at 非空；保留历史版本行） */
export async function recordFileDeleted(key: string, fullPath: string): Promise<void> {
  try {
    const rel = relativize(key, fullPath)
    await markFileDeleted(key, rel)
  } catch { /* 静默 */ }
}

/** 全量扫描工作区磁盘 → 更新 files 表（reconcile 种子；目录跳过） */
export async function scanWorkspace(key: string): Promise<{ scanned: number; indexed: number }> {
  const root = getWorkspaceRoot(key)
  const found = new Set<string>()
  let scanned = 0
  let indexed = 0
  const walk = async (dir: string): Promise<void> => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'logs') continue // 系统日志不计入用户文件
        await walk(full)
        continue
      }
      if (!entry.isFile()) continue
      const rel = relativize(key, full)
      found.add(rel)
      scanned += 1
      try {
        const current = await getFileMeta(key, rel)
        const { size, etag } = fingerprintFile(full)
        if (!current || current.size !== size || current.sha256 !== etag) {
          await storeFileMeta({ userKey: key, path: rel, size, sha256: etag, mime: mimeOf(full), updatedAt: fs.statSync(full).mtimeMs })
          indexed += 1
        }
      } catch { /* 单文件失败跳过 */ }
    }
  }
  await walk(root)
  return { scanned, indexed }
}

/**
 * reconcile：磁盘 ↔ files 表 diff 对齐。
 * 1) 磁盘上有但表里没有/已删除 → 补录
 * 2) 表里有但磁盘上不存在 → 标记删除（保留历史版本）
 * 返回 { scanned, added, markedDeleted, totalBefore, totalAfter }
 */
export async function reconcileFileMetadata(userKeys?: string[]): Promise<{
  keys: number
  scanned: number
  added: number
  markedDeleted: number
  totalBefore: number
  totalAfter: number
}> {
  const pool = getPool()
  // 若未指定 keys，取 files 表里全部 distinct user_key（触发过双写的用户）
  let keys = userKeys
  if (!keys) {
    const r = await pool.query('SELECT DISTINCT user_key FROM files').catch(() => ({ rows: [] as unknown[] }))
    keys = (r.rows ?? []).map((row) => String((row as { user_key?: unknown }).user_key ?? ''))
  }
  let scanned = 0
  let added = 0
  let markedDeleted = 0
  let totalBefore = 0
  let totalAfter = 0
  for (const key of keys) {
    if (!key) continue
    try {
      totalBefore += await sumFileBytes(key)
    } catch { /* 忽略 */ }
    // 1) 磁盘 → 表
    const { scanned: s, indexed } = await scanWorkspace(key)
    scanned += s
    added += indexed
    // 2) 表 → 磁盘（未删除行但磁盘不存在 → 标记删除）
    try {
      const manifest = await listManifest(key, '')
      for (const row of manifest) {
        const full = path.join(getWorkspaceRoot(key), row.path)
        if (!fs.existsSync(full)) {
          await markFileDeleted(key, row.path)
          markedDeleted += 1
        }
      }
    } catch { /* 忽略 */ }
    try {
      totalAfter += await sumFileBytes(key)
    } catch { /* 忽略 */ }
  }
  return { keys: keys.length, scanned, added, markedDeleted, totalBefore, totalAfter }
}

/**
 * 创建/追加快照点：把当前按路径的文件 etag 记录到一个快照行（snapshots 表）。
 * AI 批量改写前调用 → 「恢复到改写前」粒度。
 */
export async function createSnapshotPoint(key: string, label = 'manual'): Promise<{ snapshotId: string; fileCount: number; createdAt: number }> {
  const pool = getPool()
  // 建快照表（幂等）
  await pool.query(`
    CREATE TABLE IF NOT EXISTS file_snapshots (
      id TEXT PRIMARY KEY,
      user_key TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT 'manual',
      created_at BIGINT NOT NULL
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS file_snapshot_entries (
      snapshot_id TEXT NOT NULL,
      path TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      size BIGINT NOT NULL,
      PRIMARY KEY (snapshot_id, path)
    )
  `)
  const snapshotId = `snap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const createdAt = Date.now()
  await pool.query(`INSERT INTO file_snapshots (id, user_key, label, created_at) VALUES ($1,$2,$3,$4)`, [snapshotId, key, label, createdAt])
  const manifest = await listManifest(key, '')
  let fileCount = 0
  for (const row of manifest) {
    await pool.query(
      `INSERT INTO file_snapshot_entries (snapshot_id, path, sha256, size) VALUES ($1,$2,$3,$4)
       ON CONFLICT (snapshot_id, path) DO NOTHING`,
      [snapshotId, row.path, row.sha256, row.size],
    )
    fileCount += 1
  }
  return { snapshotId, fileCount, createdAt }
}

/** 恢复某个文件到某快照条目（读快照 sha256 → 若与磁盘不同则重建；供「恢复到改写前」） */
export async function restoreFileFromSnapshot(key: string, snapshotId: string, filePath: string): Promise<boolean> {
  const pool = getPool()
  const r = await pool.query(
    `SELECT path, sha256, size FROM file_snapshot_entries WHERE snapshot_id=$1 AND path=$2 ORDER BY 1 LIMIT 1`,
    [snapshotId, filePath],
  )
  const row = r.rows[0] as { path: string; sha256: string; size: number } | undefined
  if (!row) return false
  const full = path.join(getWorkspaceRoot(key), row.path)
  const current = fs.existsSync(full) ? fingerprintFile(full) : { size: 0, etag: '' }
  if (current.etag === row.sha256) return true // 已一致
  return false // 需要 blob 重建：本阶段未存 blob 内容（内容寻址块在后置），这里只判等
}

/** 引用导出（供测试/reconcile CLI） */
export { getFileMeta, listManifest, sumFileBytes }

/** 判断路径是否在用户可见区（home/）——与 webosWorkspace 一致 */
export function isUserHome(key: string, fullPath: string): boolean {
  return isUserHomeFile(key, fullPath)
}

export type { FileMetaRow }