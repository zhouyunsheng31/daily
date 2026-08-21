// server/src/webos/files/db.ts —— File Service 一阶段：元数据表与访问层
// ----------------------------------------------------------------------------
// 依据：docs/routes/web/07-files.md §2.1。为移动端同步铺路（manifest 锚点）：
//   files         (user_key TEXT, path TEXT, size BIGINT, sha256 TEXT(etag),
//                  mime TEXT, version BIGINT, deleted_at BIGINT, updated_at BIGINT,
//                  UNIQUE(user_key, path))   -- 一行 = 一个文件当前态
//   file_versions (id TEXT PK, user_key TEXT, path TEXT, sha256 TEXT, size BIGINT,
//                  created_at BIGINT)        -- 按需快照（AI 批量改写前自动建）
// 表与 webos_state 同级（entities/webos_* 表族），PG/SQLite 双兼容。
// ============================================================================

import { createHash, randomUUID } from 'node:crypto'
import { getPool } from '../../db/connection.js'

export interface FileMetaRow {
  userKey: string
  path: string
  size: number
  sha256: string
  mime: string
  version: number
  deletedAt: number | null
  updatedAt: number
}

export interface FileVersionRow {
  id: string
  userKey: string
  path: string
  sha256: string
  size: number
  createdAt: number
}

/** 建表（幂等）。跟随 initializeSchema 在启动时调用；PG/SQLite 语法兼容。 */
export async function ensureFileServiceSchema(): Promise<void> {
  const pool = getPool()
  await pool.query(`
    CREATE TABLE IF NOT EXISTS files (
      user_key TEXT NOT NULL,
      path TEXT NOT NULL,
      size BIGINT NOT NULL DEFAULT 0,
      sha256 TEXT NOT NULL DEFAULT '',
      mime TEXT NOT NULL DEFAULT 'application/octet-stream',
      version BIGINT NOT NULL DEFAULT 1,
      deleted_at BIGINT,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (user_key, path)
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_files_user_deleted ON files(user_key, deleted_at)`)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS file_versions (
      id TEXT PRIMARY KEY,
      user_key TEXT NOT NULL,
      path TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      size BIGINT NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_file_versions_up ON file_versions(user_key, path, created_at)`)
  console.log('[files] file service schema ensured')
}

/** 计算内容 fingerprint（sha256 前 16 位 = etag；移动端增量同步锚点） */
export function etagOf(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex').slice(0, 16)
}

/** 表存在性探测（reconcile 前避免建表竞态；失败视为不存在并走建表） */
export async function tableExists(name: string): Promise<boolean> {
  try {
    const pool = getPool()
    const conn = pool as unknown as { sqlite?: unknown; query: (s: string, p?: unknown[]) => Promise<{ rows: unknown[] }> }
    if (conn.sqlite !== undefined) {
      const r = await conn.query(`SELECT name FROM sqlite_master WHERE type='table' AND name=$1`, [name])
      return (r.rows ?? []).length > 0
    }
    const r = await conn.query(
      `SELECT table_name FROM information_schema.tables WHERE table_name=$1`,
      [name],
    )
    return (r.rows ?? []).length > 0
  } catch {
    return false
  }
}

/** upsert 文件元数据（写磁盘后调用；sha256=etag 短指纹；deleted_at 置空表示复活） */
export async function storeFileMeta(meta: {
  userKey: string
  path: string
  size: number
  sha256: string
  mime: string
  updatedAt?: number
}): Promise<FileMetaRow> {
  const pool = getPool()
  const now = meta.updatedAt ?? Date.now()
  const row = await pool.query(
    `INSERT INTO files (user_key, path, size, sha256, mime, version, deleted_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,1,NULL,$6)
     ON CONFLICT (user_key, path) DO UPDATE SET
       size=EXCLUDED.size, sha256=EXCLUDED.sha256, mime=EXCLUDED.mime,
       version=files.version+1, deleted_at=NULL, updated_at=EXCLUDED.updated_at
     RETURNING *`,
    [meta.userKey, meta.path, meta.size, meta.sha256, meta.mime, now],
  )
  return mapRow(row.rows[0])
}

/** 按 user_key+path 读取元数据（未删除优先；无则尝试删除行） */
export async function getFileMeta(userKey: string, path: string): Promise<FileMetaRow | null> {
  const pool = getPool()
  const r = await pool.query(
    `SELECT * FROM files WHERE user_key=$1 AND path=$2 ORDER BY (deleted_at IS NOT NULL) ASC, updated_at DESC LIMIT 1`,
    [userKey, path],
  )
  return r.rows[0] ? mapRow(r.rows[0]) : null
}

/** 标记删除（回收站语义：deleted_at 非空；不物理删行，供回收站/reconcile 用） */
export async function markFileDeleted(userKey: string, path: string, deletedAt = Date.now()): Promise<void> {
  const pool = getPool()
  await pool.query(
    `UPDATE files SET deleted_at=$1, updated_at=$1 WHERE user_key=$2 AND path=$3 AND deleted_at IS NULL`,
    [deletedAt, userKey, path],
  )
}

/** 物理删除某条的元数据（彻底删除/回收站清空用） */
export async function purgeFileMeta(userKey: string, path: string): Promise<void> {
  const pool = getPool()
  await pool.query(`DELETE FROM file_versions WHERE user_key=$1 AND path=$2`, [userKey, path])
  await pool.query(`DELETE FROM files WHERE user_key=$1 AND path=$2`, [userKey, path])
}

/** 记录一个轻量版本快照（AI 批量改写前自动建；blob 按内容寻址去重，不重复存字节） */
export async function storeFileVersion(meta: { userKey: string; path: string; sha256: string; size: number }, createdAt = Date.now()): Promise<FileVersionRow> {
  const pool = getPool()
  const id = `fv-${randomUUID()}`
  const r = await pool.query(
    `INSERT INTO file_versions (id, user_key, path, sha256, size, created_at)
     VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING RETURNING *`,
    [id, meta.userKey, meta.path, meta.sha256, meta.size, createdAt],
  )
  if (r.rows[0]) return mapVersionRow(r.rows[0])
  const existing = await pool.query(`SELECT * FROM file_versions WHERE id=$1`, [id])
  return mapVersionRow(existing.rows[0])
}

/** 查某 user+path 的版本历史（按时间升序） */
export async function listFileVersions(userKey: string, path: string): Promise<FileVersionRow[]> {
  const pool = getPool()
  const r = await pool.query(
    `SELECT * FROM file_versions WHERE user_key=$1 AND path=$2 ORDER BY created_at ASC LIMIT 500`,
    [userKey, path],
  )
  return (r.rows ?? []).map(mapVersionRow)
}

/** manifest 查询：某 user+prefix 下未删除的全部文件（用于移动端同步锚点） */
export async function listManifest(userKey: string, prefix: string): Promise<FileMetaRow[]> {
  const pool = getPool()
  const p = prefix.trim().replace(/^\/+|\/+$/g, '')
  const like = p ? `${escapeLike(p)}/%` : '%'
  const r = await pool.query(
    `SELECT * FROM files
     WHERE user_key=$1 AND deleted_at IS NULL AND (path = $2 OR path LIKE $3)
     ORDER BY path ASC LIMIT 20000`,
    [userKey, p, like],
  )
  return (r.rows ?? []).map(mapRow)
}

/** 汇总某 user 未删除文件总字节（配额展示从磁盘换成 files 表的预演；reconcile 后一致） */
export async function sumFileBytes(userKey: string): Promise<number> {
  const pool = getPool()
  const r = await pool.query(
    `SELECT COALESCE(SUM(size),0) AS total FROM files WHERE user_key=$1 AND deleted_at IS NULL`,
    [userKey],
  )
  return Number(r.rows[0]?.total ?? 0)
}

function mapRow(raw: unknown): FileMetaRow {
  const r = raw as Record<string, unknown>
  return {
    userKey: String(r.user_key),
    path: String(r.path),
    size: Number(r.size ?? 0),
    sha256: String(r.sha256 ?? ''),
    mime: String(r.mime ?? 'application/octet-stream'),
    version: Number(r.version ?? 1),
    deletedAt: r.deleted_at == null ? null : Number(r.deleted_at),
    updatedAt: Number(r.updated_at ?? 0),
  }
}

function mapVersionRow(raw: unknown): FileVersionRow {
  const r = raw as Record<string, unknown>
  return {
    id: String(r.id),
    userKey: String(r.user_key),
    path: String(r.path),
    sha256: String(r.sha256 ?? ''),
    size: Number(r.size ?? 0),
    createdAt: Number(r.created_at ?? 0),
  }
}

function escapeLike(s: string): string {
  return s.replace(/[%_\\]/g, (m) => `\\${m}`)
}