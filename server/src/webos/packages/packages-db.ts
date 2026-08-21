// server/src/webos/packages/packages-db.ts —— W1 包体系：三表与访问层
// ----------------------------------------------------------------------------
// 依据：docs/routes/web/03-package-system.md §4（DB 三表）+ §1（版本不可变/指针）。
//   packages          (id PK, owner_key, type, display_name, icon, source,
//                      active_version_id, installed, capabilities, network,
//                      created_at, updated_at)
//   package_versions  (id PK, package_id, version, status, parent_version_id,
//                      manifest(JSON 文本), content_ref, created_by, created_at, audit)
//   package_installs  (package_id, user_key, active_version_id, installed,
//                      installed_at, PK(package_id, user_key))
// 设计要点：
//   - id 全局唯一（同 npm/bundle id 语义），owner_key 记录创建者；W3 市场按 id 发布，
//     他人经 package_installs 安装 —— W1 只做本人注册+安装，但表结构一步到位。
//   - JSON 字段用 TEXT（PG/SQLite 双兼容，与 entities.data 一致）；审计事件 JSON 数组。
//   - 表与 webos_state 同级（entities/webos_* 表族思路），启动 ensure 幂等建表。
// ============================================================================

import { randomUUID } from 'node:crypto'
import { getPool } from '../../db/connection.js'

// ---- 行类型（与 REST / shell / 移动端 M2 包客户端共用的服务端内部形态） ----

export interface PackageRow {
  id: string
  ownerKey: string
  type: string
  displayName: string | null
  icon: string | null
  source: string
  activeVersionId: string | null
  installed: boolean
  capabilities: string[]
  network: { domains?: string[] } | null
  createdAt: number
  updatedAt: number
}

export interface PackageVersionRow {
  id: string
  packageId: string
  version: string
  status: string
  parentVersionId: string | null
  manifest: Record<string, unknown>
  contentRef: string | null
  createdBy: string
  createdAt: number
  audit: unknown[]
}

export interface PackageInstallRow {
  packageId: string
  userKey: string
  activeVersionId: string | null
  installed: boolean
  installedAt: number
}

// ---- 建表（幂等；跟随 initializeSchema 启动调用） ----

export async function ensurePackageSchema(): Promise<void> {
  const pool = getPool()
  await pool.query(`
    CREATE TABLE IF NOT EXISTS packages (
      id TEXT PRIMARY KEY,
      owner_key TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'app',
      display_name TEXT,
      icon TEXT,
      source TEXT NOT NULL DEFAULT 'ai_generated',
      active_version_id TEXT,
      installed BOOLEAN NOT NULL DEFAULT TRUE,
      capabilities TEXT NOT NULL DEFAULT '[]',
      network TEXT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_packages_owner ON packages(owner_key, type)`)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS package_versions (
      id TEXT PRIMARY KEY,
      package_id TEXT NOT NULL,
      version TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ready',
      parent_version_id TEXT,
      manifest TEXT NOT NULL,
      content_ref TEXT,
      created_by TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      audit TEXT NOT NULL DEFAULT '[]'
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_package_versions_pkg ON package_versions(package_id, created_at)`)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS package_installs (
      package_id TEXT NOT NULL,
      user_key TEXT NOT NULL,
      active_version_id TEXT,
      installed BOOLEAN NOT NULL DEFAULT TRUE,
      installed_at BIGINT NOT NULL,
      PRIMARY KEY (package_id, user_key)
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_package_installs_user ON package_installs(user_key, installed)`)
  console.log('[packages] package schema ensured')
}

// ---- 对象 helper：本地解析 JSON 文本字段（TEXT 兼容 PG/SQLite） ----

/** 本地解析 JSON 文本字段：SQLite 驱动已自动把 JSON 列反序列化为对象 → 原样返回；PG 返回字符串 → JSON.parse */
function parseJsonText(text: unknown, fallback: unknown): unknown {
  if (text === null || text === undefined) return fallback
  if (typeof text !== 'string') return text // 已是对象/数组（SQLite 驱动已解析）
  try {
    return JSON.parse(text)
  } catch {
    return fallback
  }
}

function mapPackageRow(raw: unknown): PackageRow | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  return {
    id: String(r.id),
    ownerKey: String(r.owner_key),
    type: String(r.type),
    displayName: r.display_name == null ? null : String(r.display_name),
    icon: r.icon == null ? null : String(r.icon),
    source: String(r.source ?? 'ai_generated'),
    activeVersionId: r.active_version_id == null ? null : String(r.active_version_id),
    installed: parseBool(r.installed),
    capabilities: Array.isArray(parseJsonText(r.capabilities as string | null, []))
      ? (parseJsonText(r.capabilities as string | null, []) as string[])
      : [],
    network: parseJsonText(r.network as string | null, null) as { domains?: string[] } | null,
    createdAt: Number(r.created_at ?? 0),
    updatedAt: Number(r.updated_at ?? 0),
  }
}

function mapVersionRow(raw: unknown): PackageVersionRow | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  return {
    id: String(r.id),
    packageId: String(r.package_id),
    version: String(r.version),
    status: String(r.status ?? 'ready'),
    parentVersionId: r.parent_version_id == null ? null : String(r.parent_version_id),
    manifest: (parseJsonText(r.manifest as string | null, {}) as Record<string, unknown>) ?? {},
    contentRef: r.content_ref == null ? null : String(r.content_ref),
    createdBy: String(r.created_by ?? 'system'),
    createdAt: Number(r.created_at ?? 0),
    audit: Array.isArray(parseJsonText(r.audit as string | null, [])) ? (parseJsonText(r.audit as string | null, []) as unknown[]) : [],
  }
}

function mapInstallRow(raw: unknown): PackageInstallRow | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  return {
    packageId: String(r.package_id),
    userKey: String(r.user_key),
    activeVersionId: r.active_version_id == null ? null : String(r.active_version_id),
    installed: parseBool(r.installed),
    installedAt: Number(r.installed_at ?? 0),
  }
}

/** SQLite 布尔以 0/1 数字返回、PG 以 JS boolean 返回 → 统一解析 */
function parseBool(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true' || value === 'TRUE'
}

// ---- packages 表 ----

export async function upsertPackage(pkg: {
  id: string
  ownerKey: string
  type: string
  displayName?: string | null
  icon?: string | null
  source: string
  activeVersionId: string | null
  installed: boolean
  capabilities?: string[]
  network?: { domains?: string[] } | null
}): Promise<PackageRow> {
  const pool = getPool()
  const now = Date.now()
  const r = await pool.query(
    `INSERT INTO packages (id, owner_key, type, display_name, icon, source, active_version_id, installed, capabilities, network, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)
     ON CONFLICT (id) DO UPDATE SET
       owner_key=EXCLUDED.owner_key, type=EXCLUDED.type, display_name=EXCLUDED.display_name,
       icon=EXCLUDED.icon, source=EXCLUDED.source, active_version_id=EXCLUDED.active_version_id,
       installed=EXCLUDED.installed, capabilities=EXCLUDED.capabilities,
       network=EXCLUDED.network, updated_at=EXCLUDED.updated_at
     RETURNING *`,
    [
      pkg.id,
      pkg.ownerKey,
      pkg.type,
      pkg.displayName ?? null,
      pkg.icon ?? null,
      pkg.source,
      pkg.activeVersionId,
      pkg.installed,
      JSON.stringify(pkg.capabilities ?? []),
      pkg.network ? JSON.stringify(pkg.network) : null,
      now,
    ],
  )
  const row = r.rows[0] ? mapPackageRow(r.rows[0]) : null
  if (!row) throw new Error(`upsertPackage failed for ${pkg.id}`)
  return row
}

export async function getPackage(id: string): Promise<PackageRow | null> {
  const pool = getPool()
  const r = await pool.query(`SELECT * FROM packages WHERE id=$1`, [id])
  return r.rows[0] ? mapPackageRow(r.rows[0]) : null
}

export async function listPackages(opts: { ownerKey?: string; type?: string; q?: string }): Promise<PackageRow[]> {
  const pool = getPool()
  const where: string[] = []
  const params: unknown[] = []
  if (opts.ownerKey !== undefined) {
    params.push(opts.ownerKey)
    where.push(`owner_key=$${params.length}`)
  }
  if (opts.type !== undefined) {
    params.push(opts.type)
    where.push(`type=$${params.length}`)
  }
  if (opts.q) {
    params.push(`%${opts.q}%`)
    where.push(`(id LIKE $${params.length} OR COALESCE(display_name,'') LIKE $${params.length})`)
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
  const r = await pool.query(`SELECT * FROM packages ${whereSql} ORDER BY updated_at DESC LIMIT 500`, params)
  return (r.rows ?? []).map(mapPackageRow).filter((x): x is PackageRow => x !== null)
}

/** 物理删行（彻底删除用；W1 常规删除走回收站语义不调用） */
export async function purgePackageRows(id: string): Promise<void> {
  const pool = getPool()
  await pool.query(`DELETE FROM package_installs WHERE package_id=$1`, [id])
  await pool.query(`DELETE FROM package_versions WHERE package_id=$1`, [id])
  await pool.query(`DELETE FROM packages WHERE id=$1`, [id])
}

// ---- package_versions 表 ----

export async function insertVersion(v: {
  packageId: string
  version: string
  status?: string
  parentVersionId?: string | null
  manifest: Record<string, unknown>
  contentRef?: string | null
  createdBy: string
  audit?: unknown[]
}): Promise<PackageVersionRow> {
  const pool = getPool()
  const id = `pv-${randomUUID()}`
  const r = await pool.query(
    `INSERT INTO package_versions (id, package_id, version, status, parent_version_id, manifest, content_ref, created_by, created_at, audit)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [
      id,
      v.packageId,
      v.version,
      v.status ?? 'ready',
      v.parentVersionId ?? null,
      JSON.stringify(v.manifest),
      v.contentRef ?? null,
      v.createdBy,
      Date.now(),
      JSON.stringify(v.audit ?? []),
    ],
  )
  const row = r.rows[0] ? mapVersionRow(r.rows[0]) : null
  if (!row) throw new Error(`insertVersion failed for ${v.packageId}`)
  return row
}

export async function getVersion(id: string): Promise<PackageVersionRow | null> {
  const pool = getPool()
  const r = await pool.query(`SELECT * FROM package_versions WHERE id=$1`, [id])
  return r.rows[0] ? mapVersionRow(r.rows[0]) : null
}

export async function listVersions(packageId: string): Promise<PackageVersionRow[]> {
  const pool = getPool()
  const r = await pool.query(
    `SELECT * FROM package_versions WHERE package_id=$1 ORDER BY created_at ASC, id ASC LIMIT 500`,
    [packageId],
  )
  return (r.rows ?? []).map(mapVersionRow).filter((x): x is PackageVersionRow => x !== null)
}

export async function setVersionStatus(id: string, status: string): Promise<void> {
  const pool = getPool()
  await pool.query(`UPDATE package_versions SET status=$1 WHERE id=$2`, [status, id])
}

/** 追加审计事件（audit 为 JSON 数组；读改写，PG/SQLite 双兼容） */
export async function appendVersionAudit(id: string, event: { action: string; at: number; by: string }): Promise<void> {
  const pool = getPool()
  const cur = await pool.query(`SELECT audit FROM package_versions WHERE id=$1`, [id])
  const prev = Array.isArray(parseJsonText(cur.rows[0]?.audit as string | null, [])) ? (parseJsonText(cur.rows[0]?.audit as string | null, []) as unknown[]) : []
  await pool.query(`UPDATE package_versions SET audit=$1 WHERE id=$2`, [JSON.stringify([...prev, event]), id])
}

/** 设置包当前活动版本（原子指针切换；同时维护 package_versions 的 active 状态） */
export async function setPackageActive(
  packageId: string,
  versionId: string,
  opts: { prevActiveVersionId?: string | null },
): Promise<void> {
  const pool = getPool()
  if (opts.prevActiveVersionId) {
    await pool.query(`UPDATE package_versions SET status='ready' WHERE id=$1 AND status='active'`, [opts.prevActiveVersionId])
  }
  await pool.query(`UPDATE package_versions SET status='active' WHERE id=$1`, [versionId])
  await pool.query(`UPDATE packages SET active_version_id=$1, updated_at=$2 WHERE id=$3`, [versionId, Date.now(), packageId])
}

// ---- package_installs 表 ----

export async function upsertInstall(install: {
  packageId: string
  userKey: string
  activeVersionId?: string | null
  installed?: boolean
}): Promise<PackageInstallRow> {
  const pool = getPool()
  const now = Date.now()
  const r = await pool.query(
    `INSERT INTO package_installs (package_id, user_key, active_version_id, installed, installed_at)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (package_id, user_key) DO UPDATE SET
       active_version_id=EXCLUDED.active_version_id, installed=EXCLUDED.installed,
       installed_at=CASE WHEN EXCLUDED.installed THEN package_installs.installed_at ELSE EXCLUDED.installed_at END
     RETURNING *`,
    [install.packageId, install.userKey, install.activeVersionId ?? null, install.installed ?? true, now],
  )
  const row = r.rows[0] ? mapInstallRow(r.rows[0]) : null
  if (!row) throw new Error(`upsertInstall failed for ${install.packageId}/${install.userKey}`)
  return row
}

export async function getInstall(packageId: string, userKey: string): Promise<PackageInstallRow | null> {
  const pool = getPool()
  const r = await pool.query(`SELECT * FROM package_installs WHERE package_id=$1 AND user_key=$2`, [packageId, userKey])
  return r.rows[0] ? mapInstallRow(r.rows[0]) : null
}

export async function listInstalled(userKey: string): Promise<PackageInstallRow[]> {
  const pool = getPool()
  const r = await pool.query(
    `SELECT * FROM package_installs WHERE user_key=$1 AND installed=TRUE ORDER BY installed_at DESC LIMIT 500`,
    [userKey],
  )
  return (r.rows ?? []).map(mapInstallRow).filter((x): x is PackageInstallRow => x !== null)
}

/** 标记安装态（卸载=false），不删行（回收站语义） */
export async function setInstallInstalled(packageId: string, userKey: string, installed: boolean): Promise<void> {
  const pool = getPool()
  await pool.query(
    `UPDATE package_installs SET installed=$1 WHERE package_id=$2 AND user_key=$3`,
    [installed, packageId, userKey],
  )
}
