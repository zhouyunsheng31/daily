// server/test/unit/net.test.ts —— W3 互通原语 v1 必测族
// ----------------------------------------------------------------------------
// 验收（docs/routes/web/09-roadmap.md W3「隔空互通设计要点 · 通用原语」）：
//   - R13：游客一律拒绝（互通体系仅面向注册用户）
//   - 寻址：注册用户名 handle → user key（users.username 唯一）；未知返回 null
//   - 共享数据空间：创建/列表/信息；owner 读写；乐观版本并发控制（VERSION_CONFLICT 409）
//   - 可见性模式：invite（ACL 白名单）/ public-ro（公开读，owner 写）/ open（公开读写）
//   - 成员管理：owner 按 handle 添加/移除成员；非 owner 操作被拒
//   - 事件总线：成员发布 + 双方增量拉取（afterSeq）；定向事件（to=handle）仅目标可见
// 运行：npm test -- --run test/unit/net.test.ts
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createTestDb } from '../helpers/db.js'
import { getPool } from '../../src/db/connection.js'
import { ensureNetSchema } from '../../src/webos/net/db.js'
import {
  resolveHandle,
  createSpace,
  getSpaceInfo,
  listMine,
  setSpaceMode,
  addMember,
  removeMember,
  keySet,
  keyGet,
  keyList,
  eventSend,
  eventPoll,
} from '../../src/webos/net/index.js'
import type { PrincipalLike } from '../../src/webos/appapi/appapi-service.js'

let cleanup: () => Promise<void> = async () => {}
let alice: { key: string; principal: PrincipalLike }
let bob: { key: string; principal: PrincipalLike }
const guest: PrincipalLike = { key: 'guest:dev-net-1', id: 'guest-dev-net-1', guest: true, role: 'guest' }

async function seedUser(username: string): Promise<{ key: string; principal: PrincipalLike }> {
  const pool = getPool()
  const id = randomUUID()
  await pool.query(
    `INSERT INTO users (id, username, email, password_hash, role, is_banned, created_at, last_login_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, username, `${username}@interop.test`, 'x', 'member', false, Date.now(), null],
  )
  return { key: `user:${id}`, principal: { key: `user:${id}`, id, guest: false, role: 'member' } }
}

beforeEach(async () => {
  const db = await createTestDb()
  cleanup = db.cleanup
  await ensureNetSchema()
  alice = await seedUser('alice')
  bob = await seedUser('bob')
})

afterEach(async () => {
  await cleanup()
})

describe('W3 互通原语 v1 · R13 游客排除', () => {
  it('游客创建空间 → GUEST_NOT_ALLOWED', async () => {
    const r = await createSpace(guest, { name: 'x' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('GUEST_NOT_ALLOWED')
  })

  it('游客读写 key / 拉取事件 → GUEST_NOT_ALLOWED', async () => {
    const created = await createSpace(alice.principal, { name: 'sp' })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const spaceId = created.space.id
    expect((await keySet(guest, spaceId, 'k', 1)).ok).toBe(false)
    expect((await keyGet(guest, spaceId, 'k')).ok).toBe(false)
    expect((await eventPoll(guest, spaceId, { afterSeq: 0 })).ok).toBe(false)
  })
})

describe('W3 互通原语 v1 · 寻址（handle → user key）', () => {
  it('注册用户名解析成 user key；未知/非法返回 null', async () => {
    expect(await resolveHandle('alice')).toBe(alice.key)
    expect(await resolveHandle('bob')).toBe(bob.key)
    expect(await resolveHandle('nobody-xyz')).toBeNull()
    expect(await resolveHandle('')).toBeNull()
  })
})

describe('W3 互通原语 v1 · 共享数据空间 + KV', () => {
  it('创建空间 → listMine 可见 → getSpaceInfo isOwner=True', async () => {
    const created = await createSpace(alice.principal, { name: '我的论坛' })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const id = created.space.id
    expect(id.startsWith('sp-')).toBe(true)
    expect((await listMine(alice.principal)).ok).toBe(true)
    const info = await getSpaceInfo(alice.principal, id)
    expect(info.ok).toBe(true)
    if (info.ok) {
      expect(info.isOwner).toBe(true)
      expect(info.memberCount).toBe(0)
    }
  })

  it('owner 写读 key：值 JSON 往返、版本递增', async () => {
    const created = await createSpace(alice.principal, { name: 'sp' })
    if (!created.ok) throw new Error('create failed')
    const id = created.space.id
    const w1 = await keySet(alice.principal, id, 'post_01', { title: '你好', n: 1 })
    expect(w1.ok).toBe(true)
    if (!w1.ok) return
    expect(w1.version).toBe(1)
    const w2 = await keySet(alice.principal, id, 'post_01', { title: '你好', n: 2 })
    if (!w2.ok) throw new Error('w2 failed')
    expect(w2.version).toBe(2)
    const g = await keyGet(alice.principal, id, 'post_01')
    expect(g.ok).toBe(true)
    if (g.ok) {
      expect(g.value).toEqual({ title: '你好', n: 2 })
      expect(g.version).toBe(2)
    }
    const ls = await keyList(alice.principal, id)
    expect(ls.ok).toBe(true)
    if (ls.ok) expect(ls.keys.map((k) => k.key)).toContain('post_01')
  })

  it('乐观版本并发：gorilla 带旧 version 写 → VERSION_CONFLICT', async () => {
    const created = await createSpace(alice.principal, { name: 'sp' })
    if (!created.ok) return
    const w1 = await keySet(alice.principal, created.space.id, 'goban', { rows: 15 })
    if (!w1.ok) throw new Error('w1 failed')
    const stale = await keySet(alice.principal, created.space.id, 'goban', { rows: 15, move: 1 }, w1.version)
    expect(stale.ok).toBe(true)
    if (!stale.ok) return
    const conflict = await keySet(alice.principal, created.space.id, 'goban', { rows: 15, move: 2 }, w1.version)
    expect(conflict.ok).toBe(false)
    if (!conflict.ok) expect(conflict.code).toBe('VERSION_CONFLICT')
  })

  it('非法 key 名拒绝（含 / 或 ..）', async () => {
    const created = await createSpace(alice.principal, { name: 'sp' })
    if (!created.ok) return
    expect((await keySet(alice.principal, created.space.id, '../etc', 1)).ok).toBe(false)
    expect((await keySet(alice.principal, created.space.id, 'a/b', 1)).ok).toBe(false)
    expect((await keySet(alice.principal, created.space.id, 'ok-key_1.2', 1)).ok).toBe(true)
  })
})

describe('W3 互通原语 v1 · 可见性模式与成员管理', () => {
  it('invite 默认：非成员 B 读不到；addMember(handle) 后 B 可读写；revoke 后不可', async () => {
    const created = await createSpace(alice.principal, { name: 'invite-room' })
    if (!created.ok) throw new Error('create failed')
    const id = created.space.id
    expect((await keyGet(bob.principal, id, 'x')).ok).toBe(false) // 未授权
    await keySet(alice.principal, id, 'x', 42)
    expect((await keyGet(bob.principal, id, 'x')).ok).toBe(false) // 仍未授权

    const granted = await addMember(alice.principal, id, 'bob')
    expect(granted.ok).toBe(true)
    // 非 owner 不能加人
    expect((await addMember(bob.principal, id, 'alice')).ok).toBe(false)

    const g = await keyGet(bob.principal, id, 'x')
    expect(g.ok).toBe(true)
    if (g.ok) expect(g.value).toBe(42)
    const bw = await keySet(bob.principal, id, 'x', 43, 1) // 成员可写（带版本）
    if (!bw.ok) throw new Error(`bob write failed ${bw.error}`)

    const removed = await removeMember(alice.principal, id, 'bob')
    expect(removed.ok).toBe(true)
    expect((await keyGet(bob.principal, id, 'x')).ok).toBe(false)
  })

  it('public-ro：任意注册用户可读、只有 owner 可写; open：可读写', async () => {
    const pub = await createSpace(alice.principal, { name: 'pub', mode: 'public-ro' })
    if (!pub.ok) throw new Error('pub create failed')
    await keySet(alice.principal, pub.space.id, 'notice', 'hello')
    const read = await keyGet(bob.principal, pub.space.id, 'notice')
    expect(read.ok).toBe(true)
    if (read.ok) expect(read.value).toBe('hello')
    const badWrite = await keySet(bob.principal, pub.space.id, 'notice', 'hack')
    expect(badWrite.ok).toBe(false)
    if (!badWrite.ok) expect(badWrite.code).toBe('FORBIDDEN')

    const open = await createSpace(alice.principal, { name: 'open', mode: 'open' })
    if (!open.ok) throw new Error('open create failed')
    const ow = await keySet(bob.principal, open.space.id, 'k', 1)
    expect(ow.ok).toBe(true)
    expect((await keyGet(bob.principal, open.space.id, 'k')).ok).toBe(true)
  })

  it('setSpaceMode 仅 owner；非法 mode 拒绝', async () => {
    const created = await createSpace(alice.principal, { name: 'sp' })
    if (!created.ok) return
    const id = created.space.id
    expect((await setSpaceMode(bob.principal, id, 'open')).ok).toBe(false)
    const ok1 = await setSpaceMode(alice.principal, id, 'open')
    expect(ok1.ok).toBe(true)
    const ok2 = await setSpaceMode(alice.principal, id, 'bogus' as never)
    expect(ok2.ok).toBe(false)
  })
})

describe('W3 互通原语 v1 · 事件/消息总线', () => {
  it('成员发布 + 双方增量拉取（afterSeq 只返回新事件）', async () => {
    const created = await createSpace(alice.principal, { name: 'room', mode: 'open' })
    if (!created.ok) throw new Error('create failed')
    const id = created.space.id
    // open 模式 bob 也能发
    const s1 = await eventSend(alice.principal, id, { kind: 'say', payload: { text: 'hi' } })
    const s2 = await eventSend(bob.principal, id, { kind: 'say', payload: { text: 'yo' } })
    expect(s1.ok && s2.ok).toBe(true)
    if (!s1.ok || !s2.ok) return

    const p1 = await eventPoll(bob.principal, id, { afterSeq: 0 })
    expect(p1.ok).toBe(true)
    if (p1.ok) {
      expect(p1.events.length).toBe(2)
      expect(p1.events[0].seq).toBe(1)
      expect(p1.events[1].payload).toEqual({ text: 'yo' })
    }
    const p2 = await eventPoll(bob.principal, id, { afterSeq: s1.seq })
    if (p2.ok) expect(p2.events.map((e) => e.seq)).toEqual([s2.seq])
  })

  it('定向事件（to=handle）：仅目标用户可见', async () => {
    const created = await createSpace(alice.principal, { name: 'dm', mode: 'open' })
    if (!created.ok) throw new Error('create failed')
    const id = created.space.id
    const broad = await eventSend(alice.principal, id, { kind: 'hi', payload: { public: 1 } })
    const dm = await eventSend(alice.principal, id, { kind: 'dm', payload: { secret: 1 }, to: 'bob' })
    expect(broad.ok && dm.ok).toBe(true)
    if (!broad.ok || !dm.ok) return

    const bobView = await eventPoll(bob.principal, id, { afterSeq: 0, to: 'me' })
    if (bobView.ok) {
      // bob 可见广播 + 给自己的定向
      expect(bobView.events.map((e) => e.seq).sort()).toEqual([broad.seq, dm.seq].sort())
    }
    const aliceView = await eventPoll(alice.principal, id, { afterSeq: 0 })
    if (aliceView.ok) {
      // 广播可见；定向给 bob 的 alice 拉不到（to_key IS NULL 过滤）
      expect(aliceView.events.map((e) => e.seq)).toEqual([broad.seq])
    }
  })

  it('非成员（invite）不能发布事件', async () => {
    const created = await createSpace(alice.principal, { name: 'closed', mode: 'invite' })
    if (!created.ok) return
    const r = await eventSend(bob.principal, created.space.id, { kind: 'x' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('FORBIDDEN')
  })
})