// server/test/unit/appapi.test.ts —— W2 App API 必测族
// ----------------------------------------------------------------------------
// 验收（docs/routes/web/04-app-api.md §5/§6）：
//   - handler 沙箱逃逸：process/require/任意 fetch 均不可用（vm 隔离）
//   - storage 前缀越权：读写前缀白名单外一律拒绝
//   - 超时与输出截断：5s 超时（测试用小值）、64KB 上限（测试用小值）
//   - 域名白名单 + SSRF：非白名单/本机/内网目标被拦
//   - secrets 脱敏：值不出现于错误/日志/审计
//   - 计费落库：成功调用扣 1 积分 + webos_api_usage 一行（用例 A 核心：storage 真实读写）
// 运行：npm test -- --run test/unit/appapi.test.ts
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createTestDb } from '../helpers/db.js'
import { getPool } from '../../src/db/connection.js'
import { getSandboxRoot } from '../../src/sandbox/index.js'
import { setSandboxRoot } from '../../src/sandbox/pathValidator.js'
import { ensurePackageSchema } from '../../src/webos/packages/packages-db.js'
import { syncPackageFromFs } from '../../src/webos/packages/packages-service.js'
import { ensureApiUsageSchema, ensureApiPublicSchema } from '../../src/webos/appapi/appapi-db.js'
import { executeApiHandler, makeStorage, makeHttp, targetAllowed, redactSecrets, matchStoragePrefix } from '../../src/webos/appapi/api-runtime.js'
import {
  setAppApiDeps,
  invokeEndpoint,
  registerDynamicTools,
  type PrincipalLike,
  type AppStateLike,
} from '../../src/webos/appapi/index.js'

const USER_KEY = 'user:test-appapi'
const PRINCIPAL: PrincipalLike = { key: USER_KEY, id: 't', guest: false, role: 'member' }
let sandboxDir = ''
let cleanup: () => Promise<void> = async () => {}
let oldRoot = ''
let savedState: AppStateLike | null = null
let stateObj: AppStateLike | null = null
let chargedTotal = 0

beforeEach(async () => {
  const db = await createTestDb()
  cleanup = db.cleanup
  await ensurePackageSchema()
  await ensureApiUsageSchema()
  await ensureApiPublicSchema()
  sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-appapi-'))
  oldRoot = getSandboxRoot()
  setSandboxRoot(sandboxDir)
  savedState = null
  chargedTotal = 0
  stateObj = { appStorage: {}, credits: { quota: 1000, used: 0 } }
  // 注入 deps（模拟 webos.ts 的 loadState/saveState/chargeCredits；state 跨调用持久）
  setAppApiDeps({
    loadState: async () => stateObj!,
    saveState: async (_p, s) => { savedState = s; stateObj = s },
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

const runCtx = { storage: makeStorage({ bag: {}, readRules: ['notes/*'], writeRules: ['notes/*'] }), params: {}, userKey: USER_KEY }

describe('W2 必测族 1：handler 沙箱逃逸（process/require/任意 fetch 均不可用）', () => {
  it('直接引用 process → 编译失败（ReferenceError）', async () => {
    const r = await executeApiHandler({ code: 'async function main(c){ return process.version }', ctx: runCtx })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errorCode).toMatch(/HANDLER_COMPILE|HANDLER_ERROR/)
  })

  it('require/fs 不可用', async () => {
    const r = await executeApiHandler({ code: 'async function main(c){ return require("fs") }', ctx: runCtx })
    expect(r.ok).toBe(false)
  })

  it('未声明白名单时 ctx 无 http → 任意 fetch 不可达', async () => {
    const r = await executeApiHandler({ code: 'async function main(c){ return typeof c.http }', ctx: runCtx })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toBe('undefined')
  })

  it('vm 隔离：constructor.constructor 逃逸被 null-proto 沙箱阻断（拿不到宿主 process）', async () => {
    const code = 'async function main(c){ const f = this.constructor.constructor("return process"); return f() === undefined ? "isolated" : "LEAKED" }'
    const r = await executeApiHandler({ code, ctx: runCtx })
    // 必须：要么抛错被拒（most likely，this.constructor 在 null-proto 下 undefined），
    // 要么返回 "isolated"——任何情况都不得返回 "LEAKED"
    const leaked = r.ok && typeof r.value === 'string' && r.value.includes('LEAKED')
    expect(leaked).toBe(false)
    if (r.ok) expect(r.value).toBe('isolated')
  })

  it('不能读取宿主全局（fetch 也不在上下文）', async () => {
    const r = await executeApiHandler({ code: 'async function main(c){ return typeof fetch }', ctx: runCtx })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toBe('undefined')
  })
})

describe('W2 必测族 2：storage 前缀越权', () => {
  it('读越权拒绝 / 白名单内正常', () => {
    const storage = makeStorage({ bag: { 'notes/1': { title: 'a' }, 'secret/x': 1 }, readRules: ['notes/*'], writeRules: ['notes/*'] })
    expect(() => storage.get('secret/x')).toThrow(/越权/)
    expect(storage.get('notes/1')).toEqual({ title: 'a' })
  })

  it('写/删越权拒绝，白名单内落袋', () => {
    const bag: Record<string, unknown> = {}
    const storage = makeStorage({ bag, readRules: ['notes/*'], writeRules: ['notes/*'] })
    expect(() => storage.set('secret/x', 1)).toThrow(/越权/)
    expect(() => storage.del('notes/1')).not.toThrow() // 不存在也放行（删白名单内）
    storage.set('notes/a', { title: 'ok' })
    expect(bag['notes/a']).toEqual({ title: 'ok' })
    storage.del('notes/a')
    expect(bag['notes/a']).toBeUndefined()
  })

  it('无 write 规则 = 禁止写（storage 声明须显式授权）', () => {
    const storage = makeStorage({ bag: {}, readRules: ['notes/*'], writeRules: [] })
    expect(() => storage.set('notes/x', 1)).toThrow(/越权/)
  })

  it('list 只返回白名单内 + 前缀过滤', () => {
    const storage = makeStorage({
      bag: { 'notes/a': 1, 'notes/b': 2, 'meta/x': 3, 'secret/y': 4 },
      readRules: ['notes/*'],
      writeRules: [],
    })
    const rows = storage.list('notes/')
    expect(rows.map((r) => r.key).sort()).toEqual(['notes/a', 'notes/b'])
  })

  it('matchStoragePrefix 语义：notes/*、notes、notes/ 三形态', () => {
    expect(matchStoragePrefix('notes/*', 'notes/a')).toBe(true)
    expect(matchStoragePrefix('notes/*', 'notes')).toBe(true)
    expect(matchStoragePrefix('notes/*', 'other')).toBe(false)
    expect(matchStoragePrefix('notes', 'notes/a')).toBe(true)
    expect(matchStoragePrefix('notes/', 'notes/a')).toBe(true)
    expect(matchStoragePrefix('notes/2', 'notes/20')).toBe(false)
  })
})

describe('W2 必测族 3：超时与输出截断', () => {
  it('超时：sleep 超过 timeoutMs → HANDLER_TIMEOUT', async () => {
    const code = 'async function main(c){ await new Promise(r=>setTimeout(r, 2000)); return 1 }'
    const r = await executeApiHandler({ code, ctx: runCtx, timeoutMs: 150 })
    expect(r.ok).toBe(false)
    if (!r.ok) { expect(r.errorCode).toBe('HANDLER_TIMEOUT'); expect(r.timedOut).toBe(true) }
  })

  it('输出截断：超过 maxOutputBytes → HANDLER_OUTPUT_TOO_LARGE', async () => {
    const code = `async function main(c){ return 'x'.repeat(2000) }`
    const r = await executeApiHandler({ code, ctx: runCtx, maxOutputBytes: 256 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errorCode).toBe('HANDLER_OUTPUT_TOO_LARGE')
  })

  it('handler 未定义 main 或非 async → 明确报错', async () => {
    const r1 = await executeApiHandler({ code: 'const x = 1', ctx: runCtx })
    expect(r1.ok).toBe(false)
    if (!r1.ok) expect(r1.errorCode).toBe('HANDLER_NO_MAIN')
  })
})

describe('W2 必测族 4：域名白名单 + SSRF', () => {
  it('targetAllowed：白名单命中 / 子域通配 / 拒绝本机与内网', () => {
    expect(targetAllowed('https://api.example.com/v1/x', ['api.example.com'])).toBe(true)
    expect(targetAllowed('https://sub.example.com/', ['*.example.com'])).toBe(true)
    expect(targetAllowed('https://other.com/', ['api.example.com'])).toBe(false)
    expect(targetAllowed('http://localhost:80/x', ['*.com'])).toBe(false)
    expect(targetAllowed('http://127.0.0.1/x', ['*.example.com'])).toBe(false)
    expect(targetAllowed('http://10.0.0.8/x', ['*.example.com'])).toBe(false)
    expect(targetAllowed('http://192.168.1.1/x', ['*.example.com'])).toBe(false)
  })

  it('ctx.http 对非白名单目标抛错（未发起网络请求）', async () => {
    const http = makeHttp(['api.example.com'])
    await expect(http.fetch('http://127.0.0.1/')).rejects.toThrow(/白名单/)
    await expect(http.fetch('https://other.com/')).rejects.toThrow(/白名单/)
  })
})

describe('W2 必测族 5：secrets 脱敏', () => {
  it('redactSecrets 把完整值替换为 ***（不残留任何片段）', () => {
    expect(redactSecrets('请求失败：TOKEN=abcSECRET123xyz', { KEY: 'abcSECRET123xyz' }))
      .toBe('请求失败：TOKEN=***')
  })

  it('handler 抛错含 secret 值 → invoke 返回的错误已脱敏且 usage 库里也无值', async () => {
    // 带 secrets 声明的版本（top-level secrets）+ 预置密钥值到 appStorage
    const api2 = JSON.parse(notesApiJson()) as Record<string, unknown>
    api2.secrets = ['API_KEY']
    ;(api2 as { endpoints: unknown[] }).endpoints.push({
      name: 'leak_secret', method: 'POST', path: '/leak', handler: 'handlers/leak.js',
      storage: { read: ['notes/*'], write: ['notes/*'] },
    })
    const base = path.join(wsRoot(), 'packages', 'com.example.notes')
    fs.mkdirSync(path.join(base, 'handlers'), { recursive: true })
    fs.writeFileSync(path.join(base, 'daily.pkg.json'), NOTES_MANIFEST, 'utf-8')
    fs.writeFileSync(path.join(base, 'api.json'), JSON.stringify(api2), 'utf-8')
    fs.writeFileSync(
      path.join(base, 'handlers', 'leak.js'),
      'async function main(c){ const s = (c.secrets || {})["API_KEY"] || ""; throw new Error("secret:" + s) }',
      'utf-8',
    )
    await syncPackageFromFs(USER_KEY, path.join(base, 'daily.pkg.json'))
    // 预置密钥值（模拟用户在「包设置页」填好）
    stateObj!.appStorage['com.example.notes'] = { __api_secrets__: { API_KEY: 'SUPERSECRET123456' } }

    const r = await invokeEndpoint(PRINCIPAL, { namespace: 'notes', endpoint: 'leak_secret', params: {} })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).not.toContain('SUPERSECRET123456')
      expect(r.error).toContain('***')
    }
    const rows = await getPool().query(`SELECT error_message FROM webos_api_usage WHERE endpoint='leak_secret'`)
    expect(String(rows.rows[0]?.error_message ?? '')).not.toContain('SUPERSECRET123456')
    expect(String(rows.rows[0]?.error_message ?? '')).toContain('***')
  })
})

describe('W2 必测族 6：全链路 —— 计费落库 + 用例 A（AI 知道自己 App 的数据）', () => {
  async function feedNotes(principal: PrincipalLike): Promise<void> {
    await invokeEndpoint(principal, {
      namespace: 'notes', endpoint: 'add_note', params: { content: '昨天记的点子' },
    })
    await invokeEndpoint(principal, {
      namespace: 'notes', endpoint: 'add_note', params: { content: '去超市买牛奶' },
    })
  }

  it('add_note 写 storage + list_notes 读回（用例 A 语义）+ 每次成功扣 1 积分 + usage 落库', async () => {
    await seedNotesApiPackage()
    await feedNotes(PRINCIPAL)
    const list = await invokeEndpoint(PRINCIPAL, { namespace: 'notes', endpoint: 'list_notes', params: { keyword: '牛奶' } })
    expect(list.ok).toBe(true)
    if (list.ok) {
      const arr = list.value as Array<{ content: string }>
      expect(arr.length).toBe(1)
      expect(arr[0].content).toContain('牛奶')
    }
    // 计费：3 次成功调用各扣 1 积分
    expect(chargedTotal).toBe(3)
    // storage 已持久化到 state（savedState 由 saveState 捕获）
    const notesKeys = Object.keys(savedState?.appStorage?.['com.example.notes'] ?? {}).filter((k) => k.startsWith('notes/'))
    expect(notesKeys.length).toBe(2)
    // usage 表 3 行（两次 add + 一次 list）
    const rows = await getPool().query(`SELECT COUNT(*) AS n, COALESCE(SUM(cost_minor),0) AS total FROM webos_api_usage WHERE user_key=$1`, [USER_KEY])
    expect(Number(rows.rows[0]?.n ?? 0)).toBe(3)
    expect(Number(rows.rows[0]?.total ?? 0)).toBe(3)
  })

  it('未安装/不存在端点 → not_found，不扣费', async () => {
    await seedNotesApiPackage()
    const r = await invokeEndpoint(PRINCIPAL, { namespace: 'notes', endpoint: 'nope' })
    expect(r.ok).toBe(false)
    expect(chargedTotal).toBe(0)
  })

  it('动态工具注册：api 包端点 → appapi_notes_list_notes 可用', async () => {
    await seedNotesApiPackage()
    const tools = await registerDynamicTools(PRINCIPAL)
    const names = tools.map((t) => t.name)
    expect(names).toContain('appapi_notes_list_notes')
    expect(names).toContain('appapi_notes_add_note')
    const listTool = tools.find((t) => t.name === 'appapi_notes_list_notes')!
    const fn = listTool.execute as unknown as (id: string, params: unknown) => Promise<{ content: Array<{ text: string }> }>
    const res = await fn('x', {})
    const parsed = JSON.parse(res.content[0].text) as { success: boolean; result?: unknown[] }
    expect(parsed.success).toBe(true)
    expect(Array.isArray(parsed.result)).toBe(true)
  })
})

// ---- helper：创建 com.example.notes 的 api 包（文件夹即包） ----

function wsRoot(): string {
  return path.join(getSandboxRoot(), 'webos', USER_KEY)
}

const NOTES_MANIFEST = JSON.stringify({
  schema_version: 2,
  id: 'com.example.notes',
  type: 'api',
  version: '1.0.0',
  entry: 'api.json',
  display_name: { zh: '记事本 API' },
  capabilities: ['app.api.invoke'],
})

function notesApiJson(secrets: string[] = []): string {
  return JSON.stringify({
    schema_version: 1,
    namespace: 'notes',
    display_name: { zh: '记事本 API' },
    ...(secrets.length ? { secrets } : {}),
    endpoints: [
      {
        name: 'list_notes', method: 'GET', path: '/notes', handler: 'handlers/list.js',
        storage: { read: ['notes/*'], write: ['notes/*'] },
        params: { type: 'object', properties: { keyword: { type: 'string' } } },
        returns: { type: 'array' },
      },
      {
        name: 'add_note', method: 'POST', path: '/notes', handler: 'handlers/add.js',
        storage: { read: ['notes/*'], write: ['notes/*'] },
        params: { type: 'object', properties: { content: { type: 'string' } } },
      },
    ],
  })
}

async function seedNotesApiPackage(): Promise<void> {
  const base = path.join(wsRoot(), 'packages', 'com.example.notes')
  fs.mkdirSync(path.join(base, 'handlers'), { recursive: true })
  fs.writeFileSync(path.join(base, 'daily.pkg.json'), NOTES_MANIFEST, 'utf-8')
  fs.writeFileSync(path.join(base, 'api.json'), notesApiJson(), 'utf-8')
  fs.writeFileSync(
    path.join(base, 'handlers', 'list.js'),
    'async function main(ctx){ const rows = await ctx.storage.list("notes/"); return rows.filter(e => !ctx.params.keyword || String(e.value.content || "").includes(ctx.params.keyword)).map(e => e.value) }',
    'utf-8',
  )
  fs.writeFileSync(
    path.join(base, 'handlers', 'add.js'),
    'async function main(ctx){ const id = "n" + Date.now(); ctx.storage.set("notes/" + id, { id, content: ctx.params.content }); return { id, content: ctx.params.content } }',
    'utf-8',
  )
  await syncPackageFromFs(USER_KEY, path.join(base, 'daily.pkg.json'))
}