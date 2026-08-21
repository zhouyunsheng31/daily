// server/src/webos/net/db.ts —— W3 互通原语 v1：共享数据空间 + 事件总线的表与访问层
// ----------------------------------------------------------------------------
// 依据：docs/routes/web/09-roadmap.md W3「隔空互通设计要点（通用原语版）」。
//   net_spaces    (id PK, owner_key, name, mode, acl, created_at, updated_at)
//                 —— 共享数据空间：owner 声明可见性模式 + invite 白名单
//   net_keys      (space_id, key, value(JSON 文本), owner_key, version, updated_at,
//                  updated_by, PK(space_id,key))
//                 —— 空间内持久化 KV（长期存；乐观版本号并发控制）
//   net_events    (id PK, space_id, seq, from_key, to_key, kind, payload, created_at,
//                  UNIQUE(space_id, seq))
//                 —— 跨用户事件/消息总线：按空间 + 目标用户增量拉取
// 表与 webos_* 表族同级；启动 ensure 幂等建表（同 appapi/packages 模式）。
// ============================================================================

import { randomUUID } from 'node:crypto'
import { getPool } from '../../db/connection.js'

/** 共享空间可见性模式（通用原语：公开读 / 开放读写 / 邀请制） */
export type NetSpaceMode = 'public-ro' | 'open' | 'invite'
export const NET_SPACE_MODES: NetSpaceMode[] = ['public-ro', 'open', 'invite']

export interface NetSpaceRow {
  id: string
  ownerKey: string
  name: string
  mode: NetSpaceMode
  /** invite 模式的成员白名单（user key 数组） */
  acl: string[]
  createdAt: number
  updatedAt: number
}

export interface NetKeyRow {
  spaceId: string
  key: string
  /** 存储值原始形态（JSON 打包文本；SQLite 驱动可能自动反序列化为对象，读取侧统一解包） */
  value: unknown
  ownerKey: string
  version: number
  updatedAt: number
  updatedBy: string
}

export interface NetEventRow {
  id: string
  spaceId: string
  seq: number
  fromKey: string
  /** 目标用户 key；null = 广播给空间内有权读的成员 */
  toKey: string | null
  kind: string
  /** 原始 payload（同上，读取侧统一解包） */
  payload: unknown
  createdAt: number
}

// ---- 建表（幂等；跟随 initializeSchema 启动调用） ----

export async function ensureNetSchema(): Promise<void> {
  const pool = getPool()
  await pool.query(`
    CREATE TABLE IF NOT EXISTS net_spaces (
      id TEXT PRIMARY KEY,
      owner_key TEXT NOT NULL,
      name TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'invite',
      acl TEXT NOT NULL DEFAULT '[]',
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_net_spaces_owner ON net_spaces(owner_key)`)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS net_keys (
      space_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      owner_key TEXT NOT NULL,
      version BIGINT NOT NULL DEFAULT 0,
      updated_at BIGINT NOT NULL,
      updated_by TEXT NOT NULL,
      PRIMARY KEY (space_id, key)
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS net_events (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL,
      seq BIGINT NOT NULL,
      from_key TEXT NOT NULL,
      to_key TEXT,
      kind TEXT NOT NULL,
      payload TEXT,
      created_at BIGINT NOT NULL,
      UNIQUE (space_id, seq)
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_net_events_scope ON net_events(space_id, to_key, seq)`)
  console.log('[net] interop schema ensured')
}

// ---- 对象 helper（JSON 文本本地解析，PG/SQLite 双兼容） ----

function parseJsonText<T>(text: unknown, fallback: T): T {
  if (text === null || text === undefined) return fallback
  if (typeof text !== 'string') return text as T // 已是对象（SQLite 自动反序列化）
  try {
    return JSON.parse(text) as T
  } catch {
    return fallback
  }
}

function mapSpaceRow(raw: unknown): NetSpaceRow | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const mode = String(r.mode ?? 'invite')
  return {
    id: String(r.id),
    ownerKey: String(r.owner_key),
    name: String(r.name ?? ''),
    mode: (NET_SPACE_MODES as string[]).includes(mode) ? mode as NetSpaceMode : 'invite',
    acl: Array.isArray(parseJsonText<string[]>(r.acl, [])) ? parseJsonText<string[]>(r.acl, []) : [],
    createdAt: Number(r.created_at ?? 0),
    updatedAt: Number(r.updated_at ?? 0),
  }
}

function mapKeyRow(raw: unknown): NetKeyRow | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  return {
    spaceId: String(r.space_id),
    key: String(r.key),
    value: r.value, // 保持原始形态；读取侧解包（SQLite 可能已自动解析 JSON → 对象）
    ownerKey: String(r.owner_key),
    version: Number(r.version ?? 0),
    updatedAt: Number(r.updated_at ?? 0),
    updatedBy: String(r.updated_by ?? ''),
  }
}

function mapEventRow(raw: unknown): NetEventRow | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  return {
    id: String(r.id),
    spaceId: String(r.space_id),
    seq: Number(r.seq ?? 0),
    fromKey: String(r.from_key),
    toKey: r.to_key == null ? null : String(r.to_key),
    kind: String(r.kind ?? 'event'),
    payload: r.payload, // 保持原始形态；读取侧解包
    createdAt: Number(r.created_at ?? 0),
  }
}

// ---- net_spaces ----

export async function insertSpace(space: {
  id: string
  ownerKey: string
  name: string
  mode: NetSpaceMode
  acl?: string[]
}): Promise<NetSpaceRow> {
  const pool = getPool()
  const now = Date.now()
  const r = await pool.query(
    `INSERT INTO net_spaces (id, owner_key, name, mode, acl, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [space.id, space.ownerKey, space.name, space.mode, JSON.stringify(space.acl ?? []), now, now],
  )
  const row = r.rows?.[0] ? mapSpaceRow(r.rows[0]) : null
  if (!row) throw new Error(`insertSpace failed for ${space.id}`)
  return row
}

export async function getSpace(id: string): Promise<NetSpaceRow | null> {
  const pool = getPool()
  const r = await pool.query(`SELECT * FROM net_spaces WHERE id=$1`, [id])
  return r.rows?.[0] ? mapSpaceRow(r.rows[0]) : null
}

export async function listOwnSpaces(ownerKey: string): Promise<NetSpaceRow[]> {
  const pool = getPool()
  const r = await pool.query(`SELECT * FROM net_spaces WHERE owner_key=$1 ORDER BY updated_at DESC LIMIT 500`, [ownerKey])
  return (r.rows ?? []).map(mapSpaceRow).filter((x): x is NetSpaceRow => x !== null)
}

export async function updateSpaceMode(id: string, mode: NetSpaceMode): Promise<void> {
  const pool = getPool()
  await pool.query(`UPDATE net_spaces SET mode=$1, updated_at=$2 WHERE id=$3`, [mode, Date.now(), id])
}

export async function updateSpaceAcl(id: string, acl: string[]): Promise<void> {
  const pool = getPool()
  await pool.query(`UPDATE net_spaces SET acl=$1, updated_at=$2 WHERE id=$3`, [JSON.stringify(acl), Date.now(), id])
}

// ---- net_keys ----

export async function upsertSpaceKey(input: {
  spaceId: string
  key: string
  value: string
  ownerKey: string
  updatedBy: string
  version: number
}): Promise<NetKeyRow> {
  const pool = getPool()
  const now = Date.now()
  const r = await pool.query(
    `INSERT INTO net_keys (space_id, key, value, owner_key, version, updated_at, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (space_id, key) DO UPDATE SET
       value=EXCLUDED.value, version=EXCLUDED.version, updated_at=EXCLUDED.updated_at, updated_by=EXCLUDED.updated_by
     RETURNING *`,
    [input.spaceId, input.key, input.value, input.ownerKey, input.version, now, input.updatedBy],
  )
  const row = r.rows?.[0] ? mapKeyRow(r.rows[0]) : null
  if (!row) throw new Error(`upsertSpaceKey failed for ${input.spaceId}/${input.key}`)
  return row
}

export async function getSpaceKey(spaceId: string, key: string): Promise<NetKeyRow | null> {
  const pool = getPool()
  const r = await pool.query(`SELECT * FROM net_keys WHERE space_id=$1 AND key=$2`, [spaceId, key])
  return r.rows?.[0] ? mapKeyRow(r.rows[0]) : null
}

export async function listSpaceKeys(spaceId: string): Promise<NetKeyRow[]> {
  const pool = getPool()
  const r = await pool.query(`SELECT * FROM net_keys WHERE space_id=$1 ORDER BY updated_at DESC LIMIT 1000`, [spaceId])
  return (r.rows ?? []).map(mapKeyRow).filter((x): x is NetKeyRow => x !== null)
}

// ---- net_events ----

export async function insertEvent(input: {
  spaceId: string
  seq: number
  fromKey: string
  toKey: string | null
  kind: string
  payload: string | null
}): Promise<NetEventRow> {
  const pool = getPool()
  const r = await pool.query(
    `INSERT INTO net_events (id, space_id, seq, from_key, to_key, kind, payload, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [randomUUID(), input.spaceId, input.seq, input.fromKey, input.toKey, input.kind, input.payload, Date.now()],
  )
  const row = r.rows?.[0] ? mapEventRow(r.rows[0]) : null
  if (!row) throw new Error(`insertEvent failed for ${input.spaceId}@${input.seq}`)
  return row
}

export async function nextEventSeq(spaceId: string): Promise<number> {
  const pool = getPool()
  const r = await pool.query(`SELECT COALESCE(MAX(seq),0)+1 AS s FROM net_events WHERE space_id=$1`, [spaceId])
  return Number(r.rows?.[0]?.s ?? 1)
}

export async function pollEvents(opts: {
  spaceId: string
  afterSeq: number
  forKey?: string | null
  limit?: number
}): Promise<NetEventRow[]> {
  const pool = getPool()
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500)
  if (opts.forKey !== undefined && opts.forKey !== null) {
    const r = await pool.query(
      `SELECT * FROM net_events WHERE space_id=$1 AND seq>$2 AND (to_key IS NULL OR to_key=$3)
       ORDER BY seq ASC LIMIT $4`,
      [opts.spaceId, opts.afterSeq, opts.forKey, limit],
    )
    return (r.rows ?? []).map(mapEventRow).filter((x): x is NetEventRow => x !== null)
  }
  const r = await pool.query(
    `SELECT * FROM net_events WHERE space_id=$1 AND seq>$2 AND to_key IS NULL
     ORDER BY seq ASC LIMIT $3`,
    [opts.spaceId, opts.afterSeq, limit],
  )
  return (r.rows ?? []).map(mapEventRow).filter((x): x is NetEventRow => x !== null)
}
