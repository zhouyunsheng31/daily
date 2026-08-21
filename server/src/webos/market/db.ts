// server/src/webos/market/db.ts —— W3 统一包市场（R14）：发布条目 + 安装登记的表与访问层
// ----------------------------------------------------------------------------
// 万物皆可包：同一个市场，按 type 浏览/安装（app/api/skill/theme/bundle…），
// 不再有独立「API 市场」（R14）。发布 = owner 对已注册包的静态扫描 + 上架；
// 安装 = 依赖闭包登记（跨用户），api 包经 public 索引调用、skill 内容复制到调用者 skills/。
//   market_entries   (id PK, package_id UNIQUE, owner_key, type, display_name, version,
//                     status, description, api_namespace, data_scope(JSON), scan(JSON),
//                     created_at, updated_at)
//   market_installs  (package_id, caller_key, type, installed_at, PK(package_id,caller_key))
// ============================================================================

import { randomUUID } from 'node:crypto'
import { getPool } from '../../db/connection.js'

export interface MarketEntryRow {
  id: string
  packageId: string
  ownerKey: string
  type: string
  displayName: string
  version: string
  status: 'live' | 'withdrawn'
  description: string | null
  apiNamespace: string | null
  dataScope: { storage?: { read: string[]; write: string[] }; endpoints?: string[]; publishes?: string[] } | null
  scan: { ok: boolean; issues: string[]; scannedAt: number }
  createdAt: number
  updatedAt: number
}

export interface MarketInstallRow {
  packageId: string
  callerKey: string
  type: string
  installedAt: number
}

export async function ensureMarketSchema(): Promise<void> {
  const pool = getPool()
  await pool.query(`
    CREATE TABLE IF NOT EXISTS market_entries (
      id TEXT PRIMARY KEY,
      package_id TEXT NOT NULL UNIQUE,
      owner_key TEXT NOT NULL,
      type TEXT NOT NULL,
      display_name TEXT NOT NULL,
      version TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'live',
      description TEXT,
      api_namespace TEXT,
      data_scope TEXT,
      scan TEXT NOT NULL DEFAULT '{}',
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_market_entries_owner ON market_entries(owner_key, status)`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_market_entries_type ON market_entries(type, status)`)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS market_installs (
      package_id TEXT NOT NULL,
      caller_key TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'api',
      installed_at BIGINT NOT NULL,
      PRIMARY KEY (package_id, caller_key)
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_market_installs_caller ON market_installs(caller_key, installed_at)`)
  console.log('[market] market schema ensured')
}

function parseJson<T>(text: unknown, fallback: T): T {
  if (text === null || text === undefined) return fallback
  if (typeof text !== 'string') return text as T
  try {
    return JSON.parse(text) as T
  } catch {
    return fallback
  }
}

function mapEntryRow(raw: unknown): MarketEntryRow | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const scope = parseJson<MarketEntryRow['dataScope']>(r.data_scope, null)
  const scan = parseJson<MarketEntryRow['scan']>(r.scan, { ok: true, issues: [], scannedAt: 0 })
  return {
    id: String(r.id),
    packageId: String(r.package_id),
    ownerKey: String(r.owner_key),
    type: String(r.type),
    displayName: String(r.display_name),
    version: String(r.version),
    status: r.status === 'withdrawn' ? 'withdrawn' : 'live',
    description: r.description == null ? null : String(r.description),
    apiNamespace: r.api_namespace == null ? null : String(r.api_namespace),
    dataScope: scope,
    scan: { ok: !!scan?.ok, issues: Array.isArray(scan?.issues) ? scan.issues.map(String) : [], scannedAt: Number(scan?.scannedAt ?? 0) },
    createdAt: Number(r.created_at ?? 0),
    updatedAt: Number(r.updated_at ?? 0),
  }
}

const mapInstallRow = (raw: unknown): MarketInstallRow | null => {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  return { packageId: String(r.package_id), callerKey: String(r.caller_key), type: String(r.type), installedAt: Number(r.installed_at ?? 0) }
}

export async function upsertMarketEntry(input: Omit<MarketEntryRow, 'id' | 'createdAt' | 'updatedAt'>): Promise<MarketEntryRow> {
  const pool = getPool()
  const now = Date.now()
  const r = await pool.query(
    `INSERT INTO market_entries (id, package_id, owner_key, type, display_name, version, status, description, api_namespace, data_scope, scan, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (package_id) DO UPDATE SET
       owner_key=EXCLUDED.owner_key, type=EXCLUDED.type, display_name=EXCLUDED.display_name,
       version=EXCLUDED.version, status=EXCLUDED.status, description=EXCLUDED.description,
       api_namespace=EXCLUDED.api_namespace, data_scope=EXCLUDED.data_scope, scan=EXCLUDED.scan,
       updated_at=EXCLUDED.updated_at
     RETURNING *`,
    [
      `me-${randomUUID()}`,
      input.packageId,
      input.ownerKey,
      input.type,
      input.displayName,
      input.version,
      input.status,
      input.description ?? null,
      input.apiNamespace ?? null,
      input.dataScope ? JSON.stringify(input.dataScope) : null,
      JSON.stringify(input.scan),
      now,
      now,
    ],
  )
  const row = r.rows?.[0] ? mapEntryRow(r.rows[0]) : null
  if (!row) throw new Error(`upsertMarketEntry failed for ${input.packageId}`)
  return row
}

export async function getMarketEntry(packageId: string): Promise<MarketEntryRow | null> {
  const pool = getPool()
  const r = await pool.query(`SELECT * FROM market_entries WHERE package_id=$1`, [packageId])
  return r.rows?.[0] ? mapEntryRow(r.rows[0]) : null
}

export async function listMarketEntries(opts: { type?: string; q?: string; status?: 'live' | 'withdrawn' }): Promise<MarketEntryRow[]> {
  const pool = getPool()
  const where: string[] = []
  const params: unknown[] = []
  if (opts.status) { params.push(opts.status); where.push(`status=$${params.length}`) }
  if (opts.type) { params.push(opts.type); where.push(`type=$${params.length}`) }
  if (opts.q) {
    params.push(`%${opts.q}%`)
    where.push(`(display_name LIKE $${params.length} OR package_id LIKE $${params.length})`)
  }
  const sql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const r = await pool.query(`SELECT * FROM market_entries ${sql} ORDER BY updated_at DESC LIMIT 500`, params)
  return (r.rows ?? []).map(mapEntryRow).filter((x): x is MarketEntryRow => x !== null)
}

export async function deleteMarketEntry(packageId: string): Promise<void> {
  const pool = getPool()
  await pool.query(`DELETE FROM market_entries WHERE package_id=$1`, [packageId])
}

export async function setMarketEntryStatus(packageId: string, status: 'live' | 'withdrawn'): Promise<void> {
  const pool = getPool()
  await pool.query(`UPDATE market_entries SET status=$1, updated_at=$2 WHERE package_id=$3`, [status, Date.now(), packageId])
}

export async function upsertMarketInstall(packageId: string, callerKey: string, type: string): Promise<void> {
  const pool = getPool()
  await pool.query(
    `INSERT INTO market_installs (package_id, caller_key, type, installed_at)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (package_id, caller_key) DO UPDATE SET type=EXCLUDED.type, installed_at=EXCLUDED.installed_at`,
    [packageId, callerKey, type, Date.now()],
  )
}

export async function getMarketInstall(packageId: string, callerKey: string): Promise<MarketInstallRow | null> {
  const pool = getPool()
  const r = await pool.query(`SELECT * FROM market_installs WHERE package_id=$1 AND caller_key=$2`, [packageId, callerKey])
  return r.rows?.[0] ? mapInstallRow(r.rows[0]) : null
}

export async function listMyInstalls(callerKey: string): Promise<MarketInstallRow[]> {
  const pool = getPool()
  const r = await pool.query(`SELECT * FROM market_installs WHERE caller_key=$1 ORDER BY installed_at DESC LIMIT 500`, [callerKey])
  return (r.rows ?? []).map(mapInstallRow).filter((x): x is MarketInstallRow => x !== null)
}