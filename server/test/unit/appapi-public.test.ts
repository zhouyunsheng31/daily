// server/test/unit/appapi-public.test.ts —— W3 public 管道必测族（跨用户调用）
// ----------------------------------------------------------------------------
// 验收（docs/routes/web/04-app-api.md §6 用例 B + 09-roadmap W3「互通②切割」）：
//   - 发布：owner 把含 public 端点的 api 命名空间发布进全局索引（webos_api_public）
//   - 跨用户调用：乙调甲的 public 端点 → 在「甲 storage」上跑 W2 受限 vm，返回甲数据
//   - R15 调用者计费：账单记乙（乙 used+1），甲不被扣；数据持久化到甲（add 后甲可见）
//   - 权限边界：owner 端点不可跨用户；未发布不可跨用户；游客一律 GUEST_NOT_ALLOWED（R13）
//   - 撤回：unpublish 后跨用户调用 → ENDPOINT_NOT_FOUND
// 运行：npm test -- --run test/unit/appapi-public.test.ts
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createTestDb } from '../helpers/db.js'
import { getSandboxRoot } from '../../src/sandbox/index.js'
import { setSandboxRoot } from '../../src/sandbox/pathValidator.js'
import { ensurePackageSchema } from '../../src/webos/packages/packages-db.js'
import { syncPackageFromFs } from '../../src/webos/packages/packages-service.js'
import { ensureApiUsageSchema, ensureApiPublicSchema } from '../../src/webos/appapi/appapi-db.js'
import {
  setAppApiDeps,
  invokeEndpoint,
  publishNamespace,
  unpublishNamespace,
  getPublicStatus,
  type PrincipalLike,
  type AppStateLike,
} from '../../src/webos/appapi/index.js'

const ALICE_KEY = 'user:alice-uuid'
const ALICE: PrincipalLike = { key: ALICE_KEY, id: 'alice-uuid', guest: false, role: 'member' }
const BOB_KEY = 'user:bob-uuid'
const BOB: PrincipalLike = { key: BOB_KEY, id: 'bob-uuid', guest: false, role: 'member' }
const GUEST: PrincipalLike = { key: 'guest:dev-x', id: 'guest-dev-x', guest: true, role: 'guest' }

let sandboxDir = ''
let oldRoot = ''
let cleanup: () => Promise<void> = async () => {}
/** 每账号独立 state（跨账号不共享 → 验证 R15 计费与数据隔离） */
const states = new Map<string, AppStateLike>()

function mkState(): AppStateLike {
  return { appStorage: {}, credits: { quota: 1000, used: 0 } }
}

beforeEach(async () => {
  const db = await createTestDb()
  cleanup = db.cleanup
  await ensurePackageSchema()
  await ensureApiUsageSchema()
  await ensureApiPublicSchema()
  sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-appapi-public-'))
  oldRoot = getSandboxRoot()
  setSandboxRoot(sandboxDir)
  states.clear()
  setAppApiDeps({
    loadState: async (p) => {
      if (!states.has(p.key)) states.set(p.key, mkState())
      return states.get(p.key)!
    },
    saveState: async (p, s) => { states.set(p.key, s) },
    chargeCredits: (state: AppStateLike, costMinor: number) => {
      const credits = (state.credits ?? { quota: 0, used: 0 }) as { quota: number; used: number }
      const cost = Math.min(Math.max(0, credits.quota - credits.used), Math.round(costMinor))
      credits.used += cost
      return cost
    },
  })
  await seedNotesApiPackage()
})

afterEach(async () => {
  setSandboxRoot(oldRoot)
  try { fs.rmSync(sandboxDir, { recursive: true, force: true }) } catch { /* 忽略 */ }
  await cleanup()
})

function usedOf(key: string): number {
  return states.get(key)?.credits?.used ?? 0
}
function aliceStorage(): Record<string, unknown> {
  return states.get(ALICE_KEY)?.appStorage?.['com.example.notes'] ?? {}
}

// ---- helper：甲账号创建 com.example.notes（含 public + owner 端点） ----

function aliceWsRoot(): string {
  return path.join(getSandboxRoot(), 'webos', ALICE_KEY)
}

async function seedNotesApiPackage(): Promise<void> {
  const base = path.join(aliceWsRoot(), 'packages', 'com.example.notes')
  fs.mkdirSync(path.join(base, 'handlers'), { recursive: true })
  fs.writeFileSync(
    path.join(base, 'daily.pkg.json'),
    JSON.stringify({ schema_version: 2, id: 'com.example.notes', type: 'api', version: '1.0.0', entry: 'api.json' }),
    'utf-8',
  )
  fs.writeFileSync(
    path.join(base, 'api.json'),
    JSON.stringify({
      schema_version: 1,
      namespace: 'notes',
      display_name: { zh: '记事本 API' },
      endpoints: [
        {
          name: 'list_notes', method: 'GET', path: '/notes', handler: 'handlers/list.js',
          visibility: 'public', storage: { read: ['notes/*'], write: ['notes/*'] },
          returns: { type: 'array' },
        },
        {
          name: 'add_note', method: 'POST', path: '/notes', handler: 'handlers/add.js',
          visibility: 'public', storage: { read: ['notes/*'], write: ['notes/*'] },
          params: { type: 'object', properties: { content: { type: 'string' } } },
        },
        {
          name: 'owner_only', method: 'GET', path: '/owner', handler: 'handlers/list.js',
          storage: { read: ['notes/*'] },
        },
      ],
    }),
    'utf-8',
  )
  fs.writeFileSync(
    path.join(base, 'handlers', 'list.js'),
    'async function main(ctx){ const rows = await ctx.storage.list("notes/"); return rows.map(e => e.value) }',
    'utf-8',
  )
  fs.writeFileSync(
    path.join(base, 'handlers', 'add.js'),
    'async function main(ctx){ const id = "n" + Date.now(); await ctx.storage.set("notes/" + id, { id, content: ctx.params.content }); return { id, content: ctx.params.content } }',
    'utf-8',
  )
  await syncPackageFromFs(ALICE_KEY, path.join(base, 'daily.pkg.json'))
}

describe('W3 public 管道 · 发布', () => {
  it('owner 发布 → 返回 public 端点清单；未发布前不可跨用户', async () => {
    const before = await getPublicStatus(BOB, 'notes')
    if (before.ok) expect(before.published).toBe(false)
    // 未发布：乙调甲的 public 端点 → ENDPOINT_NOT_FOUND
    const pre = await invokeEndpoint(BOB, { namespace: 'notes', endpoint: 'list_notes' })
    expect(pre.ok).toBe(false)
    if (!pre.ok) expect(pre.errorCode).toBe('ENDPOINT_NOT_FOUND')

    const pub = await publishNamespace(ALICE, 'notes')
    expect(pub.ok).toBe(true)
    if (pub.ok) {
      expect(pub.publicEndpoints).toEqual(['list_notes', 'add_note'])
    }
    const st = await getPublicStatus(BOB, 'notes')
    if (st.ok) {
      expect(st.published).toBe(true)
      expect(st.publicEndpoints).toEqual(['list_notes', 'add_note'])
    }
  })

  it('非 owner（乙发布甲的 namespace）→ 拒绝；owner 端点不可跨用户', async () => {
    await publishNamespace(ALICE, 'notes')
    // 乙没有自己的 notes 包 → NAMESPACE_NOT_FOUND
    const bad = await publishNamespace(BOB, 'notes')
    expect(bad.ok).toBe(false)
    // owner 端点不 public → 跨用户不可调
    const ownerEp = await invokeEndpoint(BOB, { namespace: 'notes', endpoint: 'owner_only' })
    expect(ownerEp.ok).toBe(false)
    if (!ownerEp.ok) expect(ownerEp.errorCode).toBe('ENDPOINT_NOT_FOUND')
  })
})

describe('W3 public 管道 · 跨用户调用 + 调用者计费（R15）', () => {
  it('乙调甲的 public 端点：读甲的 storage、账单记乙、甲不扣费', async () => {
    await publishNamespace(ALICE, 'notes')
    // 甲先写一条数据（owner 路径）
    const aliceAdd = await invokeEndpoint(ALICE, { namespace: 'notes', endpoint: 'add_note', params: { content: '牛奶' } })
    expect(aliceAdd.ok).toBe(true)
    expect(usedOf(ALICE_KEY)).toBe(1)

    // 乙读甲的公开端点
    const bobList = await invokeEndpoint(BOB, { namespace: 'notes', endpoint: 'list_notes' })
    expect(bobList.ok).toBe(true)
    if (bobList.ok) {
      const arr = bobList.value as Array<{ content: string }>
      expect(arr.length).toBe(1)
      expect(arr[0].content).toBe('牛奶')
    }
    // R15：乙扣 1、甲不再多扣
    expect(usedOf(BOB_KEY)).toBe(1)
    expect(usedOf(ALICE_KEY)).toBe(1)
  })

  it('乙写甲的公开端点 → 数据落到甲 storage（甲重读可见），乙付费', async () => {
    await publishNamespace(ALICE, 'notes')
    const bobAdd = await invokeEndpoint(BOB, { namespace: 'notes', endpoint: 'add_note', params: { content: '乙写的' } })
    expect(bobAdd.ok).toBe(true)
    const keys = Object.keys(aliceStorage()).filter((k) => k.startsWith('notes/'))
    expect(keys.length).toBe(1)
    expect(usedOf(BOB_KEY)).toBe(1)
    expect(usedOf(ALICE_KEY)).toBe(0) // 甲未被借用
    // 甲重读可见乙写入
    const aliceList = await invokeEndpoint(ALICE, { namespace: 'notes', endpoint: 'list_notes' })
    expect(aliceList.ok).toBe(true)
    if (aliceList.ok) {
      const arr = aliceList.value as Array<{ content: string }>
      expect(arr[0].content).toBe('乙写的')
    }
  })

  it('游客调 public 端点 → GUEST_NOT_ALLOWED（R13）', async () => {
    await publishNamespace(ALICE, 'notes')
    const r = await invokeEndpoint(GUEST, { namespace: 'notes', endpoint: 'list_notes' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errorCode).toBe('GUEST_NOT_ALLOWED')
  })

  it('撤回后跨用户调用 → ENDPOINT_NOT_FOUND；owner 本人仍可调', async () => {
    await publishNamespace(ALICE, 'notes')
    await unpublishNamespace(ALICE, 'notes')
    const st = await getPublicStatus(BOB, 'notes')
    if (st.ok) expect(st.published).toBe(false)
    const gone = await invokeEndpoint(BOB, { namespace: 'notes', endpoint: 'list_notes' })
    expect(gone.ok).toBe(false)
    if (!gone.ok) expect(gone.errorCode).toBe('ENDPOINT_NOT_FOUND')
    // owner 本人路径不受影响
    const self = await invokeEndpoint(ALICE, { namespace: 'notes', endpoint: 'list_notes' })
    expect(self.ok).toBe(true)
  })
})