// server/test/unit/market.test.ts —— W3 统一包市场（R14）必测族
// ----------------------------------------------------------------------------
// 验收（docs/routes/web/05-market.md + 09-roadmap W3 剩余切片）：
//   - 发布：owner 发布包（api/skill…）→ 静态扫描 → live 上架；secret 明文被拒（带人话 issues）
//   - 浏览：type/q 过滤 + 端点概览；详情含安装态
//   - 依赖闭包安装：dependencies+children（≤3 层）semver range 匹配全通过才落库；缺/不满足 → DEP_UNSATISFIED
//   - skill 安装：SKILL.md 复制到调用者 skills/；api 安装：公开端点即可跨用户调用（R15 调用方计费）
//   - 权限：非 owner 发布/下架被拒；游客一律 GUEST_NOT_ALLOWED（R13）
// 运行：npm test -- --run test/unit/market.test.ts
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
import { ensureMarketSchema } from '../../src/webos/market/db.js'
import {
  publishPackage,
  unpublishPackage,
  listMarket,
  marketDetail,
  installMarketPackage,
  listMyMarketInstalls,
  type MarketResult,
} from '../../src/webos/market/index.js'
import { setAppApiDeps, invokeEndpoint, type PrincipalLike, type AppStateLike } from '../../src/webos/appapi/index.js'

const ALICE_KEY = 'user:alice-mkt'
const ALICE: PrincipalLike = { key: ALICE_KEY, id: 'alice-mkt', guest: false, role: 'member' }
const BOB_KEY = 'user:bob-mkt'
const BOB: PrincipalLike = { key: BOB_KEY, id: 'bob-mkt', guest: false, role: 'member' }
const GUEST: PrincipalLike = { key: 'guest:dev-mkt', id: 'guest-dev-mkt', guest: true, role: 'guest' }

let sandboxDir = ''
let oldRoot = ''
let cleanup: () => Promise<void> = async () => {}
const states = new Map<string, AppStateLike>()

beforeEach(async () => {
  const db = await createTestDb()
  cleanup = db.cleanup
  await ensurePackageSchema()
  await ensureApiUsageSchema()
  await ensureApiPublicSchema()
  await ensureMarketSchema()
  sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-market-'))
  oldRoot = getSandboxRoot()
  setSandboxRoot(sandboxDir)
  states.clear()
  setAppApiDeps({
    loadState: async (p) => { if (!states.has(p.key)) states.set(p.key, { appStorage: {}, credits: { quota: 1000, used: 0 } }); return states.get(p.key)! },
    saveState: async (p, s) => { states.set(p.key, s) },
    chargeCredits: (state: AppStateLike, costMinor: number) => {
      const credits = (state.credits ?? { quota: 0, used: 0 }) as { quota: number; used: number }
      const cost = Math.min(Math.max(0, credits.quota - credits.used), Math.round(costMinor))
      credits.used += cost
      return cost
    },
  })
})

afterEach(async () => {
  setSandboxRoot(oldRoot)
  try { fs.rmSync(sandboxDir, { recursive: true, force: true }) } catch { /* 忽略 */ }
  await cleanup()
})

function ws(key: string): string {
  return path.join(getSandboxRoot(), 'webos', key)
}

async function seedPackage(key: string, manifest: Record<string, unknown>, files: Record<string, string>): Promise<string> {
  const id = String(manifest.id)
  const base = path.join(ws(key), 'packages', id)
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(base, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, content, 'utf-8')
  }
  fs.writeFileSync(path.join(base, 'daily.pkg.json'), JSON.stringify(manifest), 'utf-8')
  await syncPackageFromFs(key, path.join(base, 'daily.pkg.json'))
  return id
}

// ---- fixtures ----

const NOTES_MANIFEST = { schema_version: 2, id: 'com.demo.notes', type: 'api', version: '1.0.0', entry: 'api.json', display_name: { zh: '记事本 API' } } as Record<string, unknown>
const NOTES_API = JSON.stringify({
  schema_version: 1, namespace: 'notes', display_name: { zh: '记事本 API' },
  endpoints: [
    { name: 'list_notes', method: 'GET', path: '/notes', handler: 'handlers/list.js', visibility: 'public', storage: { read: ['notes/*'] }, returns: { type: 'array' } },
    { name: 'add_note', method: 'POST', path: '/notes', handler: 'handlers/add.js', visibility: 'public', storage: { read: ['notes/*'], write: ['notes/*'] } },
  ],
})
const LIST_JS = 'async function main(ctx){ const rows = await ctx.storage.list("notes/"); return rows.map(e => e.value) }'
const ADD_JS = 'async function main(ctx){ const id = "n" + Date.now(); await ctx.storage.set("notes/" + id, { id, content: ctx.params.content }); return { id, content: ctx.params.content } }'

const HELLO_MANIFEST = { schema_version: 2, id: 'com.demo.hello', type: 'skill', version: '1.0.0', entry: 'SKILL.md', display_name: { zh: '问候技能' } } as Record<string, unknown>

describe('W3 统一包市场 · 发布与扫描', () => {
  it('api 包（public 端点）发布 → live、列表 type/q 可见、端点概览；乙可跨用户调用（R15）', async () => {
    await seedPackage(ALICE_KEY, NOTES_MANIFEST, { 'api.json': NOTES_API, 'handlers/list.js': LIST_JS, 'handlers/add.js': ADD_JS })
    const pub = await publishPackage(ALICE, 'com.demo.notes')
    expect(pub.ok).toBe(true)
    if (pub.ok) {
      expect(pub.type).toBe('api')
      expect(pub.publicEndpoints).toEqual(['list_notes', 'add_note'])
    }
    const list = await listMarket({ q: 'notes' })
    expect(list.ok).toBe(true)
    if (list.ok) {
      expect(list.entries.length).toBe(1)
      expect(list.entries[0].endpoints).toBe(2)
      expect(list.entries[0].packageId).toBe('com.demo.notes')
    }
    const filtered = await listMarket({ type: 'api' })
    if (filtered.ok) expect(filtered.entries.length).toBe(1)
    // 乙未安装也可经公开索引调用（发布即可调，账单记乙）
    const detail = await marketDetail(BOB, 'com.demo.notes')
    if (detail.ok) expect(detail.isInstalled).toBe(false)
    const call = await invokeEndpoint(BOB, { namespace: 'notes', endpoint: 'add_note', params: { content: 'via-market' } })
    expect(call.ok).toBe(true)
    if (call.ok) expect(states.get(BOB_KEY)?.credits?.used).toBe(1)
  })

  it('api 包无 public 端点 → NO_PUBLIC_ENDPOINTS 拒发', async () => {
    const manifest = { ...NOTES_MANIFEST, id: 'com.demo.private' }
    const api = JSON.stringify({ schema_version: 1, namespace: 'private', endpoints: [{ name: 'p', method: 'GET', path: '/p', handler: 'handlers/list.js' }] })
    await seedPackage(ALICE_KEY, manifest, { 'api.json': api, 'handlers/list.js': LIST_JS })
    const pub = await publishPackage(ALICE, 'com.demo.private')
    expect(pub.ok).toBe(false)
    if (!pub.ok) expect(pub.code).toBe('NO_PUBLIC_ENDPOINTS')
  })

  it('handler 含硬编码密钥 → SCAN_REJECTED 带人话 issues；撤回后不发布', async () => {
    const leaky = 'async function main(ctx){ const KEY = "sk-abcdefghijklmnopqrstuvwxyz123456"; return { ok: true } }'
    await seedPackage(ALICE_KEY, NOTES_MANIFEST, { 'api.json': NOTES_API, 'handlers/list.js': leaky })
    const pub = await publishPackage(ALICE, 'com.demo.notes')
    expect(pub.ok).toBe(false)
    if (!pub.ok) {
      expect(pub.code).toBe('SCAN_REJECTED')
      expect(pub.issues?.some((i) => i.includes('疑似 API Key') || i.includes('handlers/list.js'))).toBe(true)
    }
    const list = await listMarket({})
    // 2026-08-21 统一包市场：无 type = App 包 + 技能包视图 + 真包（市场只有「包」）。
    // 系统技能（.pi/skills-webos/）会以 skill 包出现，故断言「合规包不在列表」而非「列表为空」
    if (list.ok) expect(list.entries.some((e) => e.packageId === 'com.demo.notes')).toBe(false)
  })

  it('非 owner 发布/下架 → 拒绝；owner 下架后列表不可见', async () => {
    await seedPackage(ALICE_KEY, NOTES_MANIFEST, { 'api.json': NOTES_API, 'handlers/list.js': LIST_JS, 'handlers/add.js': ADD_JS })
    await publishPackage(ALICE, 'com.demo.notes')
    expect((await publishPackage(BOB, 'com.demo.notes')).ok).toBe(false)
    const un = await unpublishPackage(BOB, 'com.demo.notes')
    expect(un.ok).toBe(false)
    if (!un.ok) expect(un.code).toBe('FORBIDDEN')
    const self = await unpublishPackage(ALICE, 'com.demo.notes')
    expect(self.ok).toBe(true)
    const after = await listMarket({})
    if (after.ok) expect(after.entries.some((e) => e.packageId === 'com.demo.notes')).toBe(false)
  })
})

describe('W3 统一包市场 · 安装（依赖闭包）', () => {
  it('skill 安装 → SKILL.md 复制到调用者 skills/，登记安装可见', async () => {
    await seedPackage(ALICE_KEY, HELLO_MANIFEST, { 'SKILL.md': '# Hello\n\n会打招呼的技能。' })
    await publishPackage(ALICE, 'com.demo.hello')
    const inst = await installMarketPackage(BOB, 'com.demo.hello')
    expect(inst.ok).toBe(true)
    if (inst.ok) expect(inst.installed).toContain('com.demo.hello')
    expect(fs.existsSync(path.join(ws(BOB_KEY), 'skills', 'com.demo.hello', 'SKILL.md'))).toBe(true)
    const mine = await listMyMarketInstalls(BOB)
    if (mine.ok) expect(mine.items.some((i) => i.packageId === 'com.demo.hello')).toBe(true)
  })

  it('依赖闭包：装 B（依赖 A ^1.0.0）→ A、B 都登记', async () => {
    await seedPackage(ALICE_KEY, { ...NOTES_MANIFEST, version: '1.2.0' }, { 'api.json': NOTES_API, 'handlers/list.js': LIST_JS, 'handlers/add.js': ADD_JS })
    await publishPackage(ALICE, 'com.demo.notes')
    await seedPackage(ALICE_KEY, {
      schema_version: 2, id: 'com.demo.needsmeta', type: 'skill', version: '1.0.0', entry: 'SKILL.md',
      dependencies: [{ id: 'com.demo.notes', range: '^1.0.0' }],
    } as Record<string, unknown>, { 'SKILL.md': '# needsmeta' })
    await publishPackage(ALICE, 'com.demo.needsmeta')

    const inst = await installMarketPackage(BOB, 'com.demo.needsmeta')
    expect(inst.ok).toBe(true)
    if (inst.ok) {
      expect(inst.installed).toContain('com.demo.needsmeta')
      expect(inst.installed).toContain('com.demo.notes')
    }
    const mine = await listMyMarketInstalls(BOB)
    if (mine.ok) expect(mine.items.some((i) => i.packageId === 'com.demo.notes')).toBe(true)
  })

  it('缺依赖 → DEP_UNSATISFIED 且不写入任何安装', async () => {
    await seedPackage(ALICE_KEY, {
      schema_version: 2, id: 'com.demo.ghostdep', type: 'skill', version: '1.0.0', entry: 'SKILL.md',
      dependencies: [{ id: 'com.demo.gone', range: '^1.0.0' }],
    } as Record<string, unknown>, { 'SKILL.md': '# ghost' })
    await publishPackage(ALICE, 'com.demo.ghostdep')
    const inst = await installMarketPackage(BOB, 'com.demo.ghostdep')
    expect(inst.ok).toBe(false)
    if (!inst.ok) {
      expect(inst.code).toBe('DEP_UNSATISFIED')
      expect(inst.issues?.some((i) => i.includes('com.demo.gone'))).toBe(true)
    }
    const mine = await listMyMarketInstalls(BOB)
    if (mine.ok) expect(mine.items.length).toBe(0)
  })

  it('range 不满足（依赖 ^2.0.0 而实际 1.2.0）→ DEP_UNSATISFIED', async () => {
    await seedPackage(ALICE_KEY, { ...NOTES_MANIFEST, version: '1.2.0' }, { 'api.json': NOTES_API, 'handlers/list.js': LIST_JS, 'handlers/add.js': ADD_JS })
    await publishPackage(ALICE, 'com.demo.notes')
    await seedPackage(ALICE_KEY, {
      schema_version: 2, id: 'com.demo.badrange', type: 'skill', version: '1.0.0', entry: 'SKILL.md',
      dependencies: [{ id: 'com.demo.notes', range: '^2.0.0' }],
    } as Record<string, unknown>, { 'SKILL.md': '# badrange' })
    await publishPackage(ALICE, 'com.demo.badrange')
    const inst = await installMarketPackage(BOB, 'com.demo.badrange')
    expect(inst.ok).toBe(false)
    if (!inst.ok) {
      expect(inst.code).toBe('DEP_UNSATISFIED')
      expect(inst.issues?.some((i) => i.includes('不满足'))).toBe(true)
    }
  })
})

describe('W3 统一包市场 · R13 游客', () => {
  it('游客发布 / 安装 / 详情 → GUEST_NOT_ALLOWED', async () => {
    await seedPackage(ALICE_KEY, HELLO_MANIFEST, { 'SKILL.md': '# Hello' })
    await publishPackage(ALICE, 'com.demo.hello')
    expect((await publishPackage(GUEST, 'com.demo.hello')).ok).toBe(false)
    expect((await installMarketPackage(GUEST, 'com.demo.hello')).ok).toBe(false)
    const d = await marketDetail(GUEST, 'com.demo.hello')
    expect(d.ok).toBe(false)
    if (!d.ok) expect(d.code).toBe('GUEST_NOT_ALLOWED')
  })
})