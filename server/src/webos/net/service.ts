// server/src/webos/net/service.ts —— W3 互通原语 v1：领域逻辑
// ----------------------------------------------------------------------------
// 通用原语（docs/routes/web/09-roadmap.md W3「隔空互通设计要点」）：
//   ① 共享数据空间（net_spaces/net_keys）：owner 声明可见性模式 + invite 白名单，
//      空间内持久化 KV（长期存，乐观版本号并发控制）。
//   ② 事件/消息总线（net_events）：跨用户投递（to 用注册用户名 handle 寻址，
//      R13 游客排除），增量拉取（afterSeq）——实时推送递延到 WS/Poll 接入层。
// 权限模型：平台 security 兜底（非游客 R13）∩ 空间可见性模式 ∩ owner 授权（invite ACL）。
// ============================================================================

import { randomUUID } from 'node:crypto'
import { getPool } from '../../db/connection.js'
import type { PrincipalLike } from '../appapi/appapi-service.js'
import {
  getSpace,
  insertSpace,
  listOwnSpaces,
  updateSpaceAcl,
  updateSpaceMode,
  getSpaceKey,
  upsertSpaceKey,
  listSpaceKeys,
  insertEvent,
  nextEventSeq,
  pollEvents,
  type NetSpaceMode,
  type NetSpaceRow,
} from './db.js'

// ---- 统一返回形态（与 appapi invokeEndpoint 一致） ----

export type NetResult<T = unknown> =
  | ({ ok: true } & T)
  | { ok: false; code: string; error: string }

const ok = <T>(data: T & { ok?: never }): NetResult<T> => ({ ok: true as const, ...data })
const fail = <T = never>(code: string, error: string): NetResult<T> => ({ ok: false as const, code, error })

// ---- 常量与校验 ----

export const SPACE_ID_PREFIX = 'sp-'
export const SPACE_NAME_MAX = 64
export const NET_KEY_MAX = 1024 * 256 // 单 key 值上限 256KB
/** key 名：字母数字 + `._-`，1..128 字符（禁止 / 与 ..） */
const KEY_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/

export function validateKeyName(key: string): boolean {
  return typeof key === 'string' && KEY_PATTERN.test(key)
}

/** 存储值打包：包一层哨兵对象，规避 SQLite 驱动把 TEXT JSON 自动反序列化导致的丢真（字符串 "1"→数字 1） */
const VALUE_SENTINEL = '__v'

function packValue(value: unknown): string | null {
  if (value === undefined) return null
  try {
    const text = JSON.stringify({ [VALUE_SENTINEL]: value })
    if (typeof text !== 'string') return null
    if (text.length > NET_KEY_MAX) return null
    return text
  } catch {
    return null
  }
}

/** 存储值解包：兼容「原始 JSON 字符串 / SQLite 驱动已反序列化的对象」两种形态 */
function unpackValue(raw: unknown): unknown {
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw) as unknown
      if (p && typeof p === 'object' && VALUE_SENTINEL in (p as Record<string, unknown>)) {
        return (p as Record<string, unknown>)[VALUE_SENTINEL]
      }
    } catch { /* 非 JSON 字符串原样返回 */ }
    return raw
  }
  if (raw && typeof raw === 'object' && VALUE_SENTINEL in (raw as Record<string, unknown>)) {
    return (raw as Record<string, unknown>)[VALUE_SENTINEL]
  }
  return raw
}

// ---- R13：互通体系仅面向注册用户，游客一律拒绝 ----

export type NetGuestError = { ok: false; code: string; error: string }

export function requireNonGuest(principal: PrincipalLike): NetGuestError | null {
  if (principal.guest) {
    return { ok: false as const, code: 'GUEST_NOT_ALLOWED', error: '互通体系仅面向注册用户，游客不参与（R13）' }
  }
  return null
}

// ---- 寻址：注册用户名 handle → user key（R13；users.username 唯一） ----

export async function resolveHandle(handle: string): Promise<string | null> {
  const name = typeof handle === 'string' ? handle.trim() : ''
  if (!name || name.length > 128) return null
  const pool = getPool()
  const r = await pool.query(`SELECT id FROM users WHERE username=$1`, [name])
  const row = r.rows?.[0]
  return row && row.id ? `user:${String(row.id)}` : null
}

// ---- 权限模型 ----

export function canReadSpace(space: NetSpaceRow, key: string): boolean {
  if (space.ownerKey === key) return true
  if (space.mode === 'public-ro' || space.mode === 'open') return true
  return space.acl.includes(key) // invite
}

export function canWriteSpace(space: NetSpaceRow, key: string): boolean {
  if (space.ownerKey === key) return true
  if (space.mode === 'open') return true
  return space.mode === 'invite' && space.acl.includes(key)
}

// ---- 空间 CRUD ----

export async function createSpace(
  principal: PrincipalLike,
  input: { name: string; mode?: NetSpaceMode },
): Promise<NetResult<{ space: NetSpaceRow }>> {
  const guest = requireNonGuest(principal)
  if (guest) return guest
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (!name || name.length > SPACE_NAME_MAX) return fail('INVALID_NAME', `空间名需为 1-${SPACE_NAME_MAX} 字符`)
  const mode: NetSpaceMode = (input.mode ?? 'invite')
  if (!['public-ro', 'open', 'invite'].includes(mode)) return fail('INVALID_MODE', 'mode 需为 public-ro | open | invite')
  const space = await insertSpace({ id: `${SPACE_ID_PREFIX}${randomUUID()}`, ownerKey: principal.key, name, mode })
  return ok({ space })
}

export async function getSpaceInfo(
  principal: PrincipalLike,
  spaceId: string,
): Promise<NetResult<{ space: NetSpaceRow; isOwner: boolean; memberCount: number }>> {
  const guest = requireNonGuest(principal)
  if (guest) return guest
  const space = await getSpace(spaceId)
  if (!space) return fail('NOT_FOUND', '共享空间不存在')
  if (!canReadSpace(space, principal.key)) return fail('FORBIDDEN', '无权访问该共享空间')
  return ok({ space, isOwner: space.ownerKey === principal.key, memberCount: space.acl.length })
}

export async function listMine(
  principal: PrincipalLike,
): Promise<NetResult<{ spaces: NetSpaceRow[] }>> {
  const guest = requireNonGuest(principal)
  if (guest) return guest
  return ok({ spaces: await listOwnSpaces(principal.key) })
}

export async function setSpaceMode(
  principal: PrincipalLike,
  spaceId: string,
  mode: NetSpaceMode,
): Promise<NetResult<{ space: NetSpaceRow }>> {
  const guest = requireNonGuest(principal)
  if (guest) return guest
  const space = await getSpace(spaceId)
  if (!space) return fail('NOT_FOUND', '共享空间不存在')
  if (space.ownerKey !== principal.key) return fail('FORBIDDEN', '仅空间所有者可修改可见性')
  if (!['public-ro', 'open', 'invite'].includes(mode)) return fail('INVALID_MODE', 'mode 需为 public-ro | open | invite')
  await updateSpaceMode(spaceId, mode)
  return ok({ space: (await getSpace(spaceId))! })
}

// ---- 成员管理（owner 授权；按注册用户名 handle 寻址） ----

export async function addMember(
  principal: PrincipalLike,
  spaceId: string,
  handle: string,
): Promise<NetResult<{ key: string; memberCount: number }>> {
  const guest = requireNonGuest(principal)
  if (guest) return guest
  const space = await getSpace(spaceId)
  if (!space) return fail('NOT_FOUND', '共享空间不存在')
  if (space.ownerKey !== principal.key) return fail('FORBIDDEN', '仅空间所有者可添加成员')
  const key = await resolveHandle(handle)
  if (!key) return fail('HANDLE_NOT_FOUND', `找不到注册用户「${handle}」`)
  if (!space.acl.includes(key)) {
    await updateSpaceAcl(spaceId, [...space.acl, key])
  }
  return ok({ key, memberCount: space.acl.length + (space.acl.includes(key) ? 0 : 1) })
}

export async function removeMember(
  principal: PrincipalLike,
  spaceId: string,
  handle: string,
): Promise<NetResult<{ removed: boolean }>> {
  const guest = requireNonGuest(principal)
  if (guest) return guest
  const space = await getSpace(spaceId)
  if (!space) return fail('NOT_FOUND', '共享空间不存在')
  if (space.ownerKey !== principal.key) return fail('FORBIDDEN', '仅空间所有者可移除成员')
  const key = await resolveHandle(handle)
  if (!key) return fail('HANDLE_NOT_FOUND', `找不到注册用户「${handle}」`)
  const next = space.acl.filter((k) => k !== key)
  if (next.length !== space.acl.length) await updateSpaceAcl(spaceId, next)
  return ok({ removed: next.length !== space.acl.length })
}

// ---- 共享数据（KV，长期存；乐观版本并发控制） ----

export async function keyGet(
  principal: PrincipalLike,
  spaceId: string,
  key: string,
): Promise<NetResult<{ key: string; value: unknown; version: number; updatedAt: number; updatedBy: string }>> {
  const guest = requireNonGuest(principal)
  if (guest) return guest
  if (!validateKeyName(key)) return fail('INVALID_KEY', 'key 需为 1-128 位字母数字或 `._-`')
  const space = await getSpace(spaceId)
  if (!space) return fail('NOT_FOUND', '共享空间不存在')
  if (!canReadSpace(space, principal.key)) return fail('FORBIDDEN', '无权读取该空间')
  const row = await getSpaceKey(spaceId, key)
  if (!row) return fail('NOT_FOUND', `key「${key}」不存在`)
  return ok({ key: row.key, value: unpackValue(row.value), version: row.version, updatedAt: row.updatedAt, updatedBy: row.updatedBy })
}

export async function keySet(
  principal: PrincipalLike,
  spaceId: string,
  key: string,
  value: unknown,
  version?: number | null,
): Promise<NetResult<{ key: string; version: number }>> {
  const guest = requireNonGuest(principal)
  if (guest) return guest
  if (!validateKeyName(key)) return fail('INVALID_KEY', 'key 需为 1-128 位字母数字或 `._-`')
  const space = await getSpace(spaceId)
  if (!space) return fail('NOT_FOUND', '共享空间不存在')
  if (!canWriteSpace(space, principal.key)) return fail('FORBIDDEN', '无权写入该空间')
  const text = packValue(value)
  if (text === null) return fail('INVALID_VALUE', '值无法序列化或超过 256KB')
  const current = await getSpaceKey(spaceId, key)
  const currentVersion = current ? current.version : 0
  if (version !== undefined && version !== null && version !== currentVersion) {
    return fail('VERSION_CONFLICT', `版本冲突：期望 v${version}，实际 v${currentVersion}（先 GET 最新 version 再写）`)
  }
  const row = await upsertSpaceKey({
    spaceId,
    key,
    value: text,
    ownerKey: space.ownerKey,
    updatedBy: principal.key,
    version: currentVersion + 1,
  })
  return ok({ key: row.key, version: row.version })
}

export async function keyList(
  principal: PrincipalLike,
  spaceId: string,
): Promise<NetResult<{ keys: Array<{ key: string; version: number; updatedAt: number }> }>> {
  const guest = requireNonGuest(principal)
  if (guest) return guest
  const space = await getSpace(spaceId)
  if (!space) return fail('NOT_FOUND', '共享空间不存在')
  if (!canReadSpace(space, principal.key)) return fail('FORBIDDEN', '无权读取该空间')
  const rows = await listSpaceKeys(spaceId)
  return ok({ keys: rows.map((r) => ({ key: r.key, version: r.version, updatedAt: r.updatedAt })) })
}

// ---- 事件/消息总线 ----

export async function eventSend(
  principal: PrincipalLike,
  spaceId: string,
  input: { kind: string; payload?: unknown; to?: string | null },
): Promise<NetResult<{ seq: number }>> {
  const guest = requireNonGuest(principal)
  if (guest) return guest
  const space = await getSpace(spaceId)
  if (!space) return fail('NOT_FOUND', '共享空间不存在')
  if (!canWriteSpace(space, principal.key)) return fail('FORBIDDEN', '无权在该空间发布事件')
  const kind = typeof input.kind === 'string' && input.kind ? input.kind.slice(0, 64) : 'event'
  let toKey: string | null = null
  if (typeof input.to === 'string' && input.to.trim()) {
    const resolved = await resolveHandle(input.to.trim())
    if (!resolved) return fail('HANDLE_NOT_FOUND', `找不到注册用户「${input.to}」`)
    toKey = resolved
  }
  const payloadText = packValue(input.payload ?? null)
  if (payloadText === null) return fail('INVALID_PAYLOAD', 'payload 无法序列化或超过 256KB')
  const seq = await nextEventSeq(spaceId)
  let row
  try {
    row = await insertEvent({ spaceId, seq, fromKey: principal.key, toKey, kind, payload: payloadText })
  } catch {
    return fail('SEQ_CONFLICT', '事件序号冲突，请重试（并发写）')
  }
  return ok({ seq: row.seq })
}

export async function eventPoll(
  principal: PrincipalLike,
  spaceId: string,
  opts: { afterSeq?: number; to?: string | null; limit?: number },
): Promise<NetResult<{ events: Array<{ seq: number; from: string; to: string | null; kind: string; payload: unknown; createdAt: number }> }>> {
  const guest = requireNonGuest(principal)
  if (guest) return guest
  const space = await getSpace(spaceId)
  if (!space) return fail('NOT_FOUND', '共享空间不存在')
  if (!canReadSpace(space, principal.key)) return fail('FORBIDDEN', '无权读取该空间')
  const afterSeq = Number(opts.afterSeq ?? 0)
  let forKey: string | null = null
  if (opts.to === 'me' || opts.to === 'self') forKey = principal.key
  else if (typeof opts.to === 'string' && opts.to.trim()) {
    forKey = await resolveHandle(opts.to.trim())
  }
  const rows = await pollEvents({ spaceId, afterSeq, forKey, limit: opts.limit })
  return ok({
    events: rows.map((r) => ({
      seq: r.seq,
      from: r.fromKey,
      to: r.toKey,
      kind: r.kind,
      payload: r.payload === null ? null : unpackValue(r.payload),
      createdAt: r.createdAt,
    })),
  })
}

/**
 * 长轮询（实时通知最小实现）：轮询直到有新事件或超时。返回最后一次 poll 结果。
 * waitMs 上限 30s，间隔 intervalMs（默认 1000ms）。
 */
export async function eventPollWait(
  principal: PrincipalLike,
  spaceId: string,
  opts: { afterSeq?: number; to?: string | null; limit?: number; waitMs?: number; intervalMs?: number },
): Promise<NetResult<{ events: Array<{ seq: number; from: string; to: string | null; kind: string; payload: unknown; createdAt: number }> }>> {
  const waitMs = Math.min(Math.max(Number(opts.waitMs ?? 0) || 0, 0), 30_000)
  const intervalMs = Math.min(Math.max(Number(opts.intervalMs ?? 0) || 1000, 200), 5000)
  const deadline = Date.now() + waitMs
  for (;;) {
    const r = await eventPoll(principal, spaceId, { afterSeq: opts.afterSeq, to: opts.to, limit: opts.limit })
    if (!waitMs || (r.ok && r.events.length > 0) || Date.now() >= deadline) return r
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}