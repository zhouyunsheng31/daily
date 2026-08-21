// server/test/unit/appapi-sdk.test.ts —— W2 sdk.useApi 扩展守卫（拆独立文件，
// 避免单进程 SQLite DatabaseSync 打开次数超限导致 createTestDb 报 CANTOPEN）
// ----------------------------------------------------------------------------
// 与 appapi.test.ts 分开，各自独立 worker：本文件只测「sdk.useApi 相关」——
// camelCase 端点别名 + namespace 文档/调试数据源（getNamespaceSpec）。
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
  camelToSnake,
  getNamespaceSpec,
  type PrincipalLike,
  type AppStateLike,
} from '../../src/webos/appapi/index.js'

const USER_KEY = 'user:test-appapi-sdk'
const PRINCIPAL: PrincipalLike = { key: USER_KEY, id: 't', guest: false, role: 'member' }
let sandboxDir = ''
let cleanup: () => Promise<void> = async () => {}
let oldRoot = ''
let chargedTotal = 0
let stateObj: AppStateLike | null = null

beforeEach(async () => {
  const db = await createTestDb()
  cleanup = db.cleanup
  await ensurePackageSchema()
  await ensureApiUsageSchema()
  await ensureApiPublicSchema()
  sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-appapi-sdk-'))
  oldRoot = getSandboxRoot()
  setSandboxRoot(sandboxDir)
  chargedTotal = 0
  stateObj = { appStorage: {}, credits: { quota: 1000, used: 0 } }
  setAppApiDeps({
    loadState: async () => stateObj!,
    saveState: async (_p, s) => { stateObj = s },
    chargeCredits: (state: AppStateLike, costMinor: number) => {
      const credits = (state.credits ?? { quota: 0, used: 0 }) as { quota: number; used: number }
      const cost = Math.min(Math.max(0, credits.quota - credits.used), Math.round(costMinor))
      credits.used += cost
      chargedTotal += cost
      return cost
    },
  })
})

afterEach(async () => {
  setSandboxRoot(oldRoot)
  try { fs.rmSync(sandboxDir, { recursive: true, force: true }) } catch { /* 忽略 */ }
  await cleanup()
})

function wsRoot(): string {
  return path.join(getSandboxRoot(), 'webos', USER_KEY)
}

async function seedNotesApiPackage(): Promise<void> {
  const base = path.join(wsRoot(), 'packages', 'com.example.notes')
  fs.mkdirSync(path.join(base, 'handlers'), { recursive: true })
  fs.writeFileSync(path.join(base, 'daily.pkg.json'), JSON.stringify({
    schema_version: 2, id: 'com.example.notes', type: 'api', version: '1.0.0',
    entry: 'api.json', display_name: { zh: '记事本 API' }, capabilities: ['app.api.invoke'],
  }), 'utf-8')
  fs.writeFileSync(path.join(base, 'api.json'), JSON.stringify({
    schema_version: 1, namespace: 'notes', display_name: { zh: '记事本 API' },
    endpoints: [
      { name: 'list_notes', method: 'GET', path: '/notes', handler: 'handlers/list.js', storage: { read: ['notes/*'], write: ['notes/*'] }, params: { type: 'object', properties: { keyword: { type: 'string' } } } },
      { name: 'add_note', method: 'POST', path: '/notes', handler: 'handlers/add.js', storage: { read: ['notes/*'], write: ['notes/*'] }, params: { type: 'object', properties: { content: { type: 'string' } } } },
    ],
  }), 'utf-8')
  fs.writeFileSync(path.join(base, 'handlers', 'list.js'), 'async function main(ctx){ const rows = await ctx.storage.list("notes/"); return rows.map(e => e.value) }', 'utf-8')
  fs.writeFileSync(path.join(base, 'handlers', 'add.js'), 'async function main(ctx){ const id = "n" + Date.now(); ctx.storage.set("notes/" + id, { id, content: ctx.params.content }); return { id, content: ctx.params.content } }', 'utf-8')
  await syncPackageFromFs(USER_KEY, path.join(base, 'daily.pkg.json'))
}

describe('W2：sdk.useApi 相关 —— camelCase 别名 + namespace 文档数据源', () => {
  it('camelToSnake：listNotes→list_notes，已 snake 不变', () => {
    expect(camelToSnake('listNotes')).toBe('list_notes')
    expect(camelToSnake('list_notes')).toBe('list_notes')
    expect(camelToSnake('sendMessage')).toBe('send_message')
  })

  it('useApi(ns).listNotes()（camel 别名）可命中 list_notes 且计费', async () => {
    await seedNotesApiPackage()
    const r = await invokeEndpoint(PRINCIPAL, { namespace: 'notes', endpoint: 'listNotes', params: {} })
    expect(r.ok).toBe(true)
    expect(chargedTotal).toBe(1)
  })

  it('getNamespaceSpec 返回端点清单（文档/调试数据源）', async () => {
    await seedNotesApiPackage()
    const spec = await getNamespaceSpec(PRINCIPAL, 'notes')
    expect(spec.ok).toBe(true)
    const names = (spec.endpoints ?? []).map((e) => e.name)
    expect(names).toContain('list_notes')
    expect(names).toContain('add_note')
    const listEp = (spec.endpoints ?? []).find((e) => e.name === 'list_notes')!
    expect(listEp.method).toBe('GET')
    expect(listEp.visibility).toBe('owner')
    expect(spec.displayName).toBe('记事本 API')
  })
})