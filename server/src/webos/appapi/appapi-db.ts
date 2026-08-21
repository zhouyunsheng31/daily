// server/src/webos/appapi/appapi-db.ts —— W2 App API 用量表与审计落库
// ----------------------------------------------------------------------------
// 依据：docs/routes/web/04-app-api.md §2（计费 kind='api' 落库 + 审计）。
//   webos_api_usage  （id PK, user_key, user_email, namespace, package_id, endpoint,
//                      method, params(摘要), status, cost_minor, duration_ms,
//                      ip, created_at）
// 一行 = 一次 API 调用（owner 级）；管理端可经 trace/用量统计审计。
// 计费金额来自 billing/fixedCostMinor('api', 1)（固定微价/次），与 appapi-service 联动。
// ============================================================================

import { randomUUID } from 'node:crypto'
import { getPool } from '../../db/connection.js'

export interface ApiUsageRecord {
  userKey: string
  userEmail?: string | null
  namespace: string
  packageId: string
  endpoint: string
  method: string
  /** 参数摘要（不含敏感值；仅前 200 字符） */
  paramSummary?: string | null
  status: 'ok' | 'failed' | 'not_found' | 'forbidden' | 'timeout' | 'too_large' | 'insufficient'
  costMinor: number
  durationMs: number
  ip?: string | null
  errorCode?: string | null
  errorMessage?: string | null
}

/** 建表（幂等；跟随 initializeSchema 启动调用） */
export async function ensureApiUsageSchema(): Promise<void> {
  const pool = getPool()
  await pool.query(`
    CREATE TABLE IF NOT EXISTS webos_api_usage (
      id TEXT PRIMARY KEY,
      user_key TEXT NOT NULL,
      user_email TEXT,
      namespace TEXT NOT NULL,
      package_id TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      method TEXT NOT NULL DEFAULT 'POST',
      param_summary TEXT,
      status TEXT NOT NULL,
      cost_minor BIGINT NOT NULL DEFAULT 0,
      duration_ms BIGINT NOT NULL DEFAULT 0,
      ip TEXT,
      error_code TEXT,
      error_message TEXT,
      created_at BIGINT NOT NULL
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_webos_api_usage_user ON webos_api_usage(user_key, created_at)`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_webos_api_usage_ns ON webos_api_usage(namespace, created_at)`)
  console.log('[appapi] api usage schema ensured')
}

/**
 * 建表（W3 public 管道）：namespace → owner 全局索引（"公开可调用"的最小发布登记）。
 * 只登记 namespace + owner + package，端点实时从 owner 当前 active 版本文件夹读（与包内容一致）。
 */
export async function ensureApiPublicSchema(): Promise<void> {
  const pool = getPool()
  await pool.query(`
    CREATE TABLE IF NOT EXISTS webos_api_public (
      id TEXT PRIMARY KEY,
      namespace TEXT NOT NULL UNIQUE,
      owner_key TEXT NOT NULL,
      package_id TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_webos_api_public_owner ON webos_api_public(owner_key)`)
  console.log('[appapi] api public index schema ensured')
}

export async function upsertApiPublic(input: { namespace: string; ownerKey: string; packageId: string }): Promise<void> {
  const pool = getPool()
  await pool.query(
    `INSERT INTO webos_api_public (id, namespace, owner_key, package_id, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$5)
     ON CONFLICT (namespace) DO UPDATE SET package_id=EXCLUDED.package_id, updated_at=EXCLUDED.updated_at`,
    [randomUUID(), input.namespace, input.ownerKey, input.packageId, Date.now()],
  )
}

export async function getApiPublic(namespace: string): Promise<{ namespace: string; ownerKey: string; packageId: string; updatedAt: number } | null> {
  const pool = getPool()
  const r = await pool.query(`SELECT * FROM webos_api_public WHERE namespace=$1`, [namespace])
  const row = r.rows?.[0]
  return row ? { namespace: String(row.namespace), ownerKey: String(row.owner_key), packageId: String(row.package_id), updatedAt: Number(row.updated_at ?? 0) } : null
}

export async function deleteApiPublic(namespace: string): Promise<void> {
  const pool = getPool()
  await pool.query(`DELETE FROM webos_api_public WHERE namespace=$1`, [namespace])
}

export async function listMyApiPublic(ownerKey: string): Promise<Array<{ namespace: string; packageId: string; updatedAt: number }>> {
  const pool = getPool()
  const r = await pool.query(`SELECT * FROM webos_api_public WHERE owner_key=$1 ORDER BY updated_at DESC LIMIT 500`, [ownerKey])
  return (r.rows ?? []).map((row) => ({ namespace: String(row.namespace), packageId: String(row.package_id), updatedAt: Number(row.updated_at ?? 0) }))
}

/** 用量/审计落库（一次 API 调用一行；失败不阻断主流程） */
export async function recordApiUsage(input: ApiUsageRecord): Promise<void> {
  try {
    const pool = getPool()
    await pool.query(
      `INSERT INTO webos_api_usage
        (id, user_key, user_email, namespace, package_id, endpoint, method, param_summary,
         status, cost_minor, duration_ms, ip, error_code, error_message, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        `api-${randomUUID()}`,
        input.userKey,
        input.userEmail ?? null,
        input.namespace,
        input.packageId,
        input.endpoint,
        input.method,
        input.paramSummary ? String(input.paramSummary).slice(0, 200) : null,
        input.status,
        input.costMinor,
        input.durationMs,
        input.ip ?? null,
        input.errorCode ?? null,
        input.errorMessage ? String(input.errorMessage).slice(0, 500) : null,
        Date.now(),
      ],
    )
  } catch (error) {
    console.warn('[appapi] recordApiUsage failed:', error instanceof Error ? error.message : String(error))
  }
}