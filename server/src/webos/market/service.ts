// server/src/webos/market/service.ts —— W3 统一包市场（R14）领域逻辑
// ----------------------------------------------------------------------------
// 万物皆可包：同一市场按 type 浏览/安装（api/skill/theme/bundle…）；app 走既有 apps 商店，
// 市场以只读适配展示（不重复注册）。发布 = owner 静态扫描（明文密钥/配额）→ live 上架；
// 安装 = 依赖闭包（dependencies + children，≤3 层，semver range 匹配，全通过才落库）登记，
//   api 包即获 public 调用权（复用 appapi 公开索引），skill 包复制 SKILL.md 到调用者 skills/。
// 计费：安装免费；后续 API 调用按 R15「调用者计费」（appapi public 已实现）。
// ============================================================================

import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { satisfies } from 'semver'
import { Type } from 'typebox'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import { getWorkspaceRoot, logAgentAction } from '../../utils/webosWorkspace.js'
import { requireNonGuest } from '../net/index.js'
import { loadApiSpecs, publishNamespace, unpublishNamespace, type PrincipalLike } from '../appapi/index.js'
import { packageDir, getDetailForUser } from '../packages/packages-service.js'
import { installedDir, readInstalledManifest } from './installed.js'
import { themeEngine } from '../engines/theme-engine.js'
import {
  upsertMarketEntry,
  getMarketEntry,
  listMarketEntries,
  deleteMarketEntry,
  setMarketEntryStatus,
  upsertMarketInstall,
  setMarketInstallEnabled,
  getMarketInstall,
  listMyInstalls,
  type MarketEntryRow,
} from './db.js'

// ---- 统一返回 ----

export type MarketResult<T = unknown> =
  | ({ ok: true } & T)
  | { ok: false; code: string; error: string; issues?: string[] }

const ok = <T>(data: T & { ok?: never }): MarketResult<T> => ({ ok: true as const, ...data })
const fail = <T = never>(code: string, error: string, issues?: string[]): MarketResult<T> => ({ ok: false, code, error, ...(issues ? { issues } : {}) })

// ---- 常量 ----

export const MARKET_MAX_FILES = 300
export const MARKET_MAX_SCAN_BYTES = 4 * 1024 * 1024
export const DEPTH_MAX = 3

// ---- 静态扫描：明文密钥 / 危险模式（上架门槛） ----

const SECRET_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: '疑似 API Key（sk-）', re: /\bsk-[A-Za-z0-9]{16,}\b/ },
  { name: '疑似 Bearer Token', re: /\bBearer\s+[A-Za-z0-9._\-]{20,}\b/i },
  { name: '硬编码密钥（apiKey=…）', re: /(api[_-]?key|secret|token|password)["']?\s*[:=]\s*["']?[A-Za-z0-9._\-]{16,}/i },
]

/** 扫描 owner 包文件夹：返回人话问题列表；空数组 = 通过 */
export async function scanPackageForSecrets(ownerKey: string, packageId: string): Promise<string[]> {
  const root = packageDir(ownerKey, packageId)
  if (!fs.existsSync(root)) return []
  const issues: string[] = []
  let scanned = 0
  let bytes = 0
  const walk = (dir: string): void => {
    if (issues.length >= 20 || scanned >= MARKET_MAX_FILES || bytes >= MARKET_MAX_SCAN_BYTES) return
    let entries: string[] = []
    try { entries = fs.readdirSync(dir) } catch { return }
    for (const name of entries) {
      if (name === '.trash') continue
      const full = path.join(dir, name)
      let stat: fs.Stats
      try { stat = fs.statSync(full) } catch { continue }
      if (stat.isDirectory()) { walk(full); continue }
      if (stat.size > 1024 * 1024) continue
      scanned += 1
      bytes += stat.size
      if (bytes > MARKET_MAX_SCAN_BYTES) return
      const rel = path.relative(root, full).replace(/\\/g, '/')
      const isText = !/\.(png|jpe?g|gif|webp|svg|ico|mp4|webm|mp3|wav|woff2?|ttf|otf|zip|gz|bin|exe)$/i.test(name)
      if (!isText || stat.size > 512 * 1024) continue
      let text = ''
      try { text = fs.readFileSync(full, 'utf-8') } catch { continue }
      for (const p of SECRET_PATTERNS) {
        if (p.re.test(text)) {
          issues.push(`${rel} 含${p.name}，禁止上架（密钥应走 api.json secrets 声明）`)
          break
        }
      }
    }
  }
  walk(root)
  return issues
}

// ---- 发布 / 撤回 ----

export async function publishPackage(
  principal: PrincipalLike,
  packageId: string,
): Promise<MarketResult<{ packageId: string; type: string; version: string; publicEndpoints: string[] }>> {
  const guest = requireNonGuest(principal)
  if (guest) return fail('GUEST_NOT_ALLOWED', '互通体系仅面向注册用户（R13）')
  const detail = await getDetailForUser(principal.key, packageId)
  if (!detail) return fail('NOT_FOUND', `找不到已注册的包「${packageId}」`)
  if (!detail.item.owner) return fail('FORBIDDEN', '仅包所有者可发布')
  if (detail.item.type === 'app') return fail('APP_NOT_MARKETABLE', 'type=app 的包走既有 Apps 商店（市场以只读适配展示）')
  const active = detail.versions.find((v) => v.id === detail.item.activeVersionId) ?? detail.versions[0]
  const version = active?.version ?? detail.item.version ?? '0.0.0'
  const type = detail.item.type

  // api 类型：必须含 public 端点 → 复用 appapi 公开索引（单一事实源）
  let apiNamespace: string | null = null
  let publicEndpoints: string[] = []
  let dataScope: { storage?: { read: string[]; write: string[] }; endpoints?: string[]; publishes?: string[] } | null = null
  if (type === 'api') {
    const specs = await loadApiSpecs(principal.key)
    const spec = specs.find((s) => s.packageId === packageId && !s.fromInstalled)
    if (!spec) return fail('API_SPEC_MISSING', `包「${packageId}」找不到合法 api.json（市场安装的包不可重复发布）`)
    publicEndpoints = spec.spec.endpoints.filter((e) => e.visibility === 'public').map((e) => e.name)
    if (publicEndpoints.length === 0) return fail('NO_PUBLIC_ENDPOINTS', 'api 包至少需 1 个 visibility=public 端点才能上架')
    const pub = await publishNamespace(principal, spec.spec.namespace)
    if (!pub.ok) return fail(pub.errorCode ?? 'PUBLISH_FAILED', pub.error ?? '发布失败')
    apiNamespace = spec.spec.namespace
    const read: string[] = []
    const write: string[] = []
    for (const e of spec.spec.endpoints) {
      if (e.visibility !== 'public') continue
      for (const r of e.storage?.read ?? []) if (!read.includes(r)) read.push(r)
      for (const w of e.storage?.write ?? []) if (!write.includes(w)) write.push(w)
    }
    dataScope = { storage: { read, write }, endpoints: publicEndpoints, publishes: [] }
  }

  // 静态扫描（明文密钥等）→ 不过不发布
  const issues = await scanPackageForSecrets(principal.key, packageId)
  if (issues.length > 0) return fail('SCAN_REJECTED', '安全检查未通过，未上架', issues)

  const displayName = detail.item.displayName ?? packageId
  const descriptionManifest = active?.manifest?.description
  const description = typeof descriptionManifest === 'object' && descriptionManifest
    ? (descriptionManifest as { zh?: string }).zh ?? null
    : null
  await upsertMarketEntry({
    packageId,
    ownerKey: principal.key,
    type,
    displayName,
    version,
    status: 'live',
    description,
    apiNamespace,
    dataScope,
    scan: { ok: true, issues, scannedAt: Date.now() },
  })
  await logAgentAction(principal.key, 'market_publish', { packageId, type, version }, true)
  return ok({ packageId, type, version, publicEndpoints })
}

export async function unpublishPackage(
  principal: PrincipalLike,
  packageId: string,
): Promise<MarketResult<{ packageId: string }>> {
  const guest = requireNonGuest(principal)
  if (guest) return fail('GUEST_NOT_ALLOWED', '互通体系仅面向注册用户（R13）')
  const entry = await getMarketEntry(packageId)
  if (!entry) return fail('NOT_FOUND', `市场无「${packageId}」`)
  if (entry.ownerKey !== principal.key) return fail('FORBIDDEN', '仅包所有者可下架')
  if (entry.apiNamespace) {
    await unpublishNamespace(principal, entry.apiNamespace)
  }
  await deleteMarketEntry(packageId)
  await logAgentAction(principal.key, 'market_unpublish', { packageId, type: entry.type }, true)
  return ok({ packageId })
}

// ---- 浏览 / 详情 ----

async function ownerPublicHandle(ownerKey: string): Promise<string> {
  if (!ownerKey.startsWith('user:')) return ownerKey
  try {
    const pool = (await import('../../db/connection.js')).getPool()
    const r = await pool.query(`SELECT username FROM users WHERE id=$1`, [ownerKey.slice('user:'.length)])
    return r.rows?.[0]?.username ?? ownerKey
  } catch {
    return ownerKey
  }
}

export async function listMarket(
  opts: { type?: string; q?: string },
): Promise<MarketResult<{ entries: Array<{ packageId: string; type: string; displayName: string; version: string; description: string | null; owner: string; endpoints: number | null }> }>> {
  // 统一包市场（R14）：无 type 过滤 = 全部「包」—— 真包（market_entries）+ App 包
  // （webos_store_apps 已发布快照，映射为 type=app 只读适配）+ skill 包视图
  // （系统全局 .pi/skills-webos/ + 用户发布 webos_store_skills）。
  // App / skill 不重复注册到 packages/ 目录，由各自来源作为「包」的只读适配，
  // 安装仍走既有端点（App→store install；skill→复制到用户 skills/）。市场只有「包」。
  const rows = await listMarketEntries({ type: opts.type && !['app', 'skill'].includes(opts.type) ? opts.type : undefined, q: opts.q, status: 'live' })
  let out = await Promise.all(rows.map(async (r) => ({
    packageId: r.packageId,
    type: r.type,
    displayName: r.displayName,
    version: r.version,
    description: r.description,
    owner: await ownerPublicHandle(r.ownerKey),
    endpoints: r.dataScope?.endpoints?.length ?? null,
  })))
  if (!opts.type || opts.type === 'app') {
    // 合并全局已发布 App（webos_store_apps published → type=app 包视图）
    const apps = await listPublishedStoreApps(opts.q)
    out = [...apps, ...out]
  }
  if (!opts.type || opts.type === 'skill') {
    // 合并技能包视图（系统全局 + 用户发布，type=skill）
    const skills = await listSkillPackages(opts.q)
    out = [...skills, ...out]
  }
  return ok({ entries: out })
}

/**
 * 技能包视图（type=skill 只读适配）：系统全局 .pi/skills-webos/（owner=system）
 * + 用户发布 webos_store_skills（owner=发布者 handle）。安装经 /store/skills/:id/install
 * （复制 SKILL.md 到调用者 skills/，AI 立即可用）——技能以「包」形态出现在市场。
 */
async function listSkillPackages(q?: string): Promise<Array<{ packageId: string; type: string; displayName: string; version: string; description: string | null; owner: string; endpoints: number | null }>> {
  const items: Array<{ packageId: string; type: 'skill'; displayName: string; version: string; description: string | null; owner: string; endpoints: null }> = []
  const ql = (q ?? '').trim().toLowerCase()
  const matchQ = (name: string): boolean => !ql || name.toLowerCase().includes(ql)
  try {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const { resolveGlobalSkillsDir } = await import('../../utils/webosWorkspace.js')
    const globalSkillsDir = resolveGlobalSkillsDir()
    // 系统全局技能（合理 SKILL.md 的目录就是技能包）
    if (fs.existsSync(globalSkillsDir)) {
      for (const entry of fs.readdirSync(globalSkillsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const skillDir = path.join(globalSkillsDir, entry.name)
        if (!fs.existsSync(path.join(skillDir, 'SKILL.md'))) continue
        if (!matchQ(entry.name)) continue
        items.push({
          packageId: `sys-skill:${entry.name}`,
          type: 'skill',
          displayName: entry.name,
          version: '1.0.0',
          description: null,
          owner: '系统',
          endpoints: null,
        })
      }
    }
    // 用户发布技能（webos_store_skills published）
    const pool = (await import('../../db/connection.js')).getPool()
    const r = await pool.query(
      `SELECT s.*, COALESCE(u.display_name, u.username, '匿名') AS owner_name
         FROM webos_store_skills s
         LEFT JOIN users u ON u.id = REPLACE(s.owner_key, 'user:', '')
         WHERE s.status = 'published' ORDER BY s.created_at DESC LIMIT 200`,
    )
    for (const row of r.rows ?? []) {
      const name = String(row.name ?? row.skill_id ?? '')
      if (!matchQ(name)) continue
      items.push({
        packageId: String(row.id),
        type: 'skill',
        displayName: name,
        version: '1.0.0',
        description: row.description ? String(row.description) : null,
        owner: String(row.owner_name ?? '匿名'),
        endpoints: null,
      })
    }
  } catch (error) {
    console.warn('[market] listSkillPackages failed:', error instanceof Error ? error.message : String(error))
  }
  return items
}

/**
 * 全局已发布 App 的市场视图（type=app 只读适配）：读 webos_store_apps 已发布条目，
 * 每个映射为一个「App 包」——owner 为发布者、版本取快照版本，安装经 store 端点。
 * 这就是「万物皆可包」里 App 的包形态：市场里只有一种东西（包），App 是其一。
 */
async function listPublishedStoreApps(q?: string): Promise<Array<{ packageId: string; type: string; displayName: string; version: string; description: string | null; owner: string; endpoints: number | null }>> {
  try {
    const pool = (await import('../../db/connection.js')).getPool()
    const ql = (q ?? '').trim().toLowerCase()
    const where: string[] = [`s.status = 'published'`]
    const params: unknown[] = []
    if (ql) {
      params.push(`%${ql}%`, `%${ql}%`)
      where.push(`(LOWER(s.name) LIKE $${params.length - 1} OR LOWER(s.name) LIKE $${params.length})`)
    }
    const r = await pool.query(
      `SELECT s.id AS share_id, s.name, s.version, s.description,
              COALESCE(u.display_name, u.username, '匿名') AS owner_name
         FROM webos_store_apps s
         LEFT JOIN users u ON u.id = REPLACE(s.owner_key, 'user:', '')
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY s.created_at DESC LIMIT 300`,
      params,
    )
    return (r.rows ?? []).map((row) => ({
      packageId: `store:${String(row.share_id)}`,
      type: 'app' as const,
      displayName: String(row.name ?? '未命名 App'),
      version: String(row.version ?? '1.0.0'),
      description: row.description ? String(row.description) : null,
      owner: String(row.owner_name ?? '匿名'),
      endpoints: null,
    }))
  } catch (error) {
    console.warn('[market] list published store apps failed:', error instanceof Error ? error.message : String(error))
    return []
  }
}

/** 市场「App」维度：直接返回全局已发布 App 包视图（供宿主 SDK market.apps 消费，与 market.list type=app 一致） */
export async function listMarketAppsGlobal(): Promise<MarketResult<{ apps: Array<{ id: string; name: string; source: string; version: string | null; owner?: string; description?: string | null }> }>> {
  try {
    const pool = (await import('../../db/connection.js')).getPool()
    const r = await pool.query(
      `SELECT s.id AS share_id, s.name, s.version, s.description,
              COALESCE(u.display_name, u.username, '匿名') AS owner_name
         FROM webos_store_apps s
         LEFT JOIN users u ON u.id = REPLACE(s.owner_key, 'user:', '')
         WHERE s.status = 'published'
         ORDER BY s.created_at DESC LIMIT 300`,
    )
    const apps = (r.rows ?? []).map((row) => ({
      id: `store:${String(row.share_id)}`,
      name: String(row.name ?? '未命名 App'),
      source: 'store',
      version: row.version ? String(row.version) : null,
      owner: String(row.owner_name ?? '匿名'),
      description: row.description ? String(row.description) : null,
    }))
    return ok({ apps })
  } catch (error) {
    console.warn('[market] listMarketAppsGlobal failed:', error instanceof Error ? error.message : String(error))
    return ok({ apps: [] })
  }
}

export async function marketDetail(
  principal: PrincipalLike,
  packageId: string,
): Promise<MarketResult<{ entry: MarketEntryRow; isInstalled: boolean; myHandle: string }>> {
  const guest = requireNonGuest(principal)
  if (guest) return fail('GUEST_NOT_ALLOWED', '互通体系仅面向注册用户（R13）')
  const entry = await getMarketEntry(packageId)
  if (!entry || entry.status !== 'live') return fail('NOT_FOUND', `市场没有可用的「${packageId}」`)
  const install = await getMarketInstall(packageId, principal.key)
  return ok({ entry, isInstalled: !!install, myHandle: await ownerPublicHandle(principal.key) })
}

// ---- 安装（依赖闭包，全通过才落库） ----

interface ClosureItem { packageId: string; range: string | undefined; depth: number }

/**
 * 解析依赖闭包：dependencies + children（≤3 层），逐项必须已发布 live 且 semver range 满足。
 * 任一缺失/不满足 → 返回 issues，不写入任何安装。
 */
export async function resolveDependencyClosure(packageId: string): Promise<{ ok: true; items: ClosureItem[] } | { ok: false; code: string; error: string; issues: string[] }> {
  const items: ClosureItem[] = []
  const visited = new Set<string>()
  const queue: ClosureItem[] = [{ packageId, range: undefined, depth: 0 }]
  const issues: string[] = []

  while (queue.length > 0) {
    const cur = queue.shift()!
    if (visited.has(cur.packageId)) continue
    visited.add(cur.packageId)
    items.push(cur)

    const entry = await getMarketEntry(cur.packageId)
    if (!entry || entry.status !== 'live') {
      issues.push(`依赖「${cur.packageId}」未在市场中上架（或被下架）`)
      continue
    }
    if (cur.range !== undefined && cur.range !== '*' && !satisfies(entry.version, cur.range)) {
      issues.push(`依赖「${cur.packageId}」版本 ${entry.version} 不满足要求 range=${cur.range}`)
      continue
    }
    if (cur.depth >= DEPTH_MAX) continue
    // 读取属主 manifest 拿下一层依赖
    const detail = await getDetailForUser(entry.ownerKey, cur.packageId)
    const manifest = detail?.versions.find((v) => v.id === detail.item.activeVersionId)?.manifest
      ?? detail?.versions[0]?.manifest
      ?? null
    const deps = manifest?.dependencies
    const children = manifest?.children
    const next: Array<{ id: string; range: string | undefined }> = []
    if (Array.isArray(deps)) {
      for (const d of deps) {
        const id = String((d as { id?: unknown }).id ?? (d as { id?: unknown }).id).trim() === '' ? '' : String((d as { id?: unknown }).id)
        if (!id) { issues.push('依赖声明缺 id'); continue }
        const range = typeof (d as { range?: unknown }).range === 'string' ? (d as { range?: unknown }).range as string : undefined
        next.push({ id, range })
      }
    }
    if (Array.isArray(children)) {
      for (const c of children) next.push({ id: String(c), range: undefined })
    }
    for (const n of next) {
      if (!visited.has(n.id)) queue.push({ packageId: n.id, range: n.range, depth: cur.depth + 1 })
    }
  }

  if (issues.length > 0) return { ok: false, code: 'DEP_UNSATISFIED', error: '依赖闭包不满足，未安装', issues }
  return { ok: true, items }
}

function copySkillToCaller(ownerKey: string, packageId: string, callerKey: string): string | null {
  const src = packageDir(ownerKey, packageId)
  if (!fs.existsSync(src)) return null
  const dest = path.join(getWorkspaceRoot(callerKey), 'skills', packageId)
  try {
    if (fs.existsSync(path.join(dest, 'SKILL.md'))) return '已存在（跳过复制）'
    fs.mkdirSync(dest, { recursive: true })
    fs.cpSync(src, dest, { recursive: true, filter: (s) => {
      const st = fs.statSync(s)
      if (st.isFile() && st.size > 1024 * 1024) return false
      if (st.isDirectory() && ['.trash', 'handlers'].includes(path.basename(s))) return false
      return true
    } })
    return '已复制 SKILL 内容到你的 skills/'
  } catch (error) {
    return `skill 复制失败：${error instanceof Error ? error.message : String(error)}`
  }
}

// ---- 统一安装引擎（2026-08-23）：整包复制 → installed/ → 按类型/内容分派生效 ----

/** deps 注入（webos.ts 挂载时传入 loadState/saveState，避免循环依赖） */
export interface MarketDeps {
  loadState: (principal: { key: string; guest?: boolean }) => Promise<{ apps?: unknown[] }>
  saveState: (principal: { key: string; guest?: boolean }, state: unknown) => Promise<void>
}
let marketDeps: MarketDeps | null = null
export function setMarketDeps(deps: MarketDeps): void { marketDeps = deps }

/** 从发布者工作区整包复制到调用者 installed/<id>/（跳过 .trash 与 >6MB 大文件） */
function copyPackageToCaller(ownerKey: string, packageId: string, callerKey: string): string | null {
  const src = packageDir(ownerKey, packageId)
  if (!fs.existsSync(src)) return null
  const dest = installedDir(callerKey, packageId)
  try {
    fs.mkdirSync(dest, { recursive: true })
    fs.cpSync(src, dest, { recursive: true, filter: (s) => {
      const st = fs.statSync(s)
      if (st.isFile() && st.size > 6 * 1024 * 1024) return false
      if (st.isDirectory() && ['.trash'].includes(path.basename(s))) return false
      return true
    } })
    return dest
  } catch (error) {
    console.warn('[market] copyPackageToCaller failed:', error instanceof Error ? error.message : String(error))
    return null
  }
}

/** 组合式内容声明（contents.*，schema 只允许 skills/mcp/tools/tokens/assets） */
function readContents(manifest: Record<string, unknown>): { skills: string[]; tokens: Record<string, string> | null } {
  const contents = manifest.contents && typeof manifest.contents === 'object' && !Array.isArray(manifest.contents)
    ? manifest.contents as Record<string, unknown>
    : {}
  const skills = Array.isArray(contents.skills) ? contents.skills.map(String) : []
  const tokens = contents.tokens && typeof contents.tokens === 'object' && !Array.isArray(contents.tokens)
    ? contents.tokens as Record<string, string>
    : null
  return { skills, tokens }
}

/** 包显示名（schema 字段 display_name；兼容历史 displayName） */
function displayNameOf(manifest: Record<string, unknown>, fallback: string): string {
  const dn = manifest.display_name
  if (dn && typeof dn === 'object' && !Array.isArray(dn)) {
    const zh = (dn as Record<string, unknown>).zh
    if (typeof zh === 'string' && zh) return zh
    const en = (dn as Record<string, unknown>).en
    if (typeof en === 'string' && en) return en
  }
  return typeof manifest.displayName === 'string' && manifest.displayName ? manifest.displayName : fallback
}

/** 把调用者已安装包的状态文件写到 system/config（当前主题等） */
function activeThemeFile(callerKey: string): string {
  return path.join(getWorkspaceRoot(callerKey), 'system', 'config', 'theme.json')
}

/** 读取当前启用的主题包（bootstrap 消费；fs 同步，供非 async 上下文调用） */
export function getActiveTheme(callerKey: string): { packageId: string; tokens: Record<string, string> } | null {
  try {
    const file = activeThemeFile(callerKey)
    if (!fs.existsSync(file)) return null
    const cfg = JSON.parse(fs.readFileSync(file, 'utf-8')) as { packageId?: string }
    if (!cfg.packageId) return null
    const manifest = readInstalledManifest(callerKey, cfg.packageId)
    if (!manifest) return null
    const tokensPath = path.join(installedDir(callerKey, cfg.packageId), 'tokens.json')
    const tokens = fs.existsSync(tokensPath) ? JSON.parse(fs.readFileSync(tokensPath, 'utf-8')) as Record<string, string> : {}
    return { packageId: cfg.packageId, tokens }
  } catch {
    return null
  }
}

/** 应用主题 tokens（写调用者工作区 + 记录 activeTheme） */
function provisionTheme(callerKey: string, packageId: string, destDir: string, manifest: Record<string, unknown>): string {
  const { tokens: contentTokens } = readContents(manifest)
  // themeEngine.apply 第一参接受 manifest（含 contents.tokens）或裸 tokens 表
  const tokens = contentTokens
    ? themeEngine.apply({ contents: { tokens: contentTokens } }).tokens
    : themeEngine.apply(manifest).tokens
  try {
    fs.writeFileSync(path.join(destDir, 'tokens.json'), JSON.stringify(tokens, null, 2), 'utf-8')
    fs.mkdirSync(path.dirname(activeThemeFile(callerKey)), { recursive: true })
    fs.writeFileSync(activeThemeFile(callerKey), JSON.stringify({ packageId, appliedAt: Date.now() }, null, 2), 'utf-8')
  } catch (error) {
    console.warn('[market] provisionTheme failed:', error instanceof Error ? error.message : String(error))
  }
  return '✅ 主题已应用：' + Object.keys(tokens).length + ' 个 CSS 变量（桌面/App 立即换肤，可在市场设置中关闭）'
}

/** app 包写入 state.apps（桌面立即出现，复用版本化打开/回滚机制） */
async function provisionApp(callerKey: string, packageId: string, destDir: string, manifest: Record<string, unknown>): Promise<string> {
  if (!marketDeps) return '⚠️ app 安装跳过（market deps 未注入）'
  const entry = typeof manifest.entry === 'string' && manifest.entry ? String(manifest.entry) : 'index.html'
  const htmlFile = path.join(destDir, entry)
  if (!fs.existsSync(htmlFile)) return `⚠️ app 包缺少入口 ${entry}，已登记但未上桌面`
  const html = fs.readFileSync(htmlFile, 'utf-8')
  const principal = { key: callerKey, guest: callerKey.startsWith('guest:') }
  try {
    const state = await marketDeps.loadState(principal as never)
    const apps = Array.isArray(state.apps) ? state.apps as unknown[] : []
    const idx = apps.findIndex((a) => (a as { id?: string }).id === packageId || (a as { id?: string }).id === `pkg.${packageId}`)
    const displayName = displayNameOf(manifest, packageId)
    const now = Date.now()
    const versionId = `version-${randomUUID()}`
    const appRecord = {
      id: `pkg.${packageId}`,
      name: displayName,
      source: 'store',
      activeVersionId: versionId,
      installed: true,
      createdAt: existingAtOrNow(apps, packageId, now),
      icon: typeof manifest.icon === 'string' ? manifest.icon : null,
      versions: [{
        id: versionId, appId: `pkg.${packageId}`, version: '1.0.0', status: 'active', source: 'store',
        capabilities: ['app.storage.private'],
        html, createdAt: now, createdBy: 'system', parentVersionId: null,
      }],
    }
    if (idx >= 0) (apps as unknown[])[idx] = appRecord
    else apps.push(appRecord)
    ;(state as { apps?: unknown[] }).apps = apps
    await marketDeps.saveState(principal as never, state)
    return `✅ App「${displayName}」已装上桌面（刷新桌面即可看到，可回滚）`
  } catch (error) {
    console.warn('[market] provisionApp failed:', error instanceof Error ? error.message : String(error))
    return `⚠️ App 安装写状态失败：${error instanceof Error ? error.message : String(error)}`
  }
}
function existingAtOrNow(apps: unknown[], packageId: string, now: number): number {
  const found = apps.find((a) => (a as { id?: string }).id === packageId || (a as { id?: string }).id === `pkg.${packageId}`)
  return found && typeof (found as { createdAt?: number }).createdAt === 'number' ? (found as { createdAt: number }).createdAt : now
}

/** skill 内容复制到调用者 skills/ + 失效 pi loader（立即被 AI 加载） */
async function provisionSkill(callerKey: string, packageId: string, destDir: string, manifest: Record<string, unknown>): Promise<string> {
  try {
    const { skillEngine } = await import('../engines/skill-engine.js')
    const r = skillEngine.install({ ownerKey: callerKey, callerKey, packageId, pkgDir: destDir, manifest })
    // 失效 pi 共享 loader：新会话立即加载新技能
    try {
      const pi = await import('../../piBridge.js')
      pi.invalidateWebosServices?.()
    } catch { /* piBridge 不可用忽略 */ }
    return r.ok ? `✅ Skill 已安装到你的 skills/${packageId}/（AI 下一条消息即可使用）` : `⚠️ ${r.note}`
  } catch (error) {
    return `⚠️ skill 安装失败：${error instanceof Error ? error.message : String(error)}`
  }
}

/** 按 manifest/contents 对已安装包做统一生效分派 */
async function provisionInstalled(callerKey: string, packageId: string, destDir: string, manifest: Record<string, unknown>): Promise<string[]> {
  const notes: string[] = []
  const type = String(manifest.type ?? '')
  const { skills, tokens } = readContents(manifest)
  if (type === 'app') {
    notes.push(await provisionApp(callerKey, packageId, destDir, manifest))
  }
  if (type === 'skill' || skills.length > 0 || fs.existsSync(path.join(destDir, 'SKILL.md'))) {
    notes.push(await provisionSkill(callerKey, packageId, destDir, manifest))
  }
  if (type === 'theme' || tokens) {
    notes.push(provisionTheme(callerKey, packageId, destDir, manifest))
  }
  // api / toolpkg / mcp / bundle / subagent / workflow 等：整包已落地 installed/，
  // 由各自消费端扫描生效（appapi 工具注册 / 后续运行时），无需此处额外动作
  return notes
}

export async function installMarketPackage(
  principal: PrincipalLike,
  packageId: string,
): Promise<MarketResult<{ installed: string[]; note: string }>> {
  const guest = requireNonGuest(principal)
  if (guest) return fail('GUEST_NOT_ALLOWED', '互通体系仅面向注册用户（R13）')
  const closure = await resolveDependencyClosure(packageId)
  if (!closure.ok) return closure

  const installed: string[] = []
  const notes: string[] = []
  for (const item of closure.items) {
    const entry = await getMarketEntry(item.packageId)
    if (!entry) continue
    await upsertMarketInstall(item.packageId, principal.key, entry.type, true)
    installed.push(item.packageId)
    // 整包落地（依赖闭包内的 api/skill/theme/app 一视同仁，全部安装即用）
    const dest = copyPackageToCaller(entry.ownerKey, item.packageId, principal.key)
    if (!dest) {
      notes.push(`${item.packageId}：⚠️ 包复制失败（发布者侧文件缺失）`)
      continue
    }
    const manifest = readInstalledManifest(principal.key, item.packageId)
    if (!manifest) {
      notes.push(`${item.packageId}：⚠️ installed 缺少 daily.pkg.json`)
      continue
    }
    const notes2 = await provisionInstalled(principal.key, item.packageId, dest, manifest)
    if (notes2.length > 0) notes.push(`${item.packageId}：${notes2.join('；')}`)
  }
  await logAgentAction(principal.key, 'market_install', { packageId, installed }, true)
  const note = notes.join('\n') || '已安装（内容将在对应位置生效：App→桌面 / Skill→AI 技能 / API→工具 / 主题→桌面换肤）'
  return ok({ installed, note })
}

/** 启停开关：enabled=false 移除运行时产物（保留 installed/ 与安装记录，可恢复） */
export async function toggleMarketInstall(
  principal: PrincipalLike,
  packageId: string,
  enabled: boolean,
): Promise<MarketResult<{ packageId: string; enabled: boolean; note: string }>> {
  const guest = requireNonGuest(principal)
  if (guest) return fail('GUEST_NOT_ALLOWED', '互通体系仅面向注册用户（R13）')
  const install = await getMarketInstall(packageId, principal.key)
  if (!install) return fail('NOT_INSTALLED', `未安装「${packageId}」`)
  const row = await setMarketInstallEnabled(packageId, principal.key, enabled)
  if (!row) return fail('TOGGLE_FAILED', '启停写入失败')
  const notes: string[] = []
  // app：从 state.apps 增/删
  if (install.type === 'app') {
    try {
      const manifest = readInstalledManifest(principal.key, packageId)
      if (enabled && marketDeps && manifest) {
        const dest = installedDir(principal.key, packageId)
        notes.push(await provisionApp(principal.key, packageId, dest, manifest))
      } else if (!enabled && marketDeps) {
        const state = await marketDeps.loadState(principal as never)
        const apps = Array.isArray(state.apps) ? state.apps as unknown[] : []
        ;(state as { apps?: unknown[] }).apps = apps.filter((a) => (a as { id?: string }).id !== packageId && (a as { id?: string }).id !== `pkg.${packageId}`)
        await marketDeps.saveState(principal as never, state)
        notes.push('已从桌面移除（重新启用可恢复）')
      }
    } catch (error) {
      notes.push(`app 同步失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  // skill：skills/<id> 增/删
  if (install.type === 'skill') {
    try {
      const { skillEngine } = await import('../engines/skill-engine.js')
      if (enabled) {
        const manifest = readInstalledManifest(principal.key, packageId)
        if (manifest) {
          const r = skillEngine.install({ ownerKey: principal.key, callerKey: principal.key, packageId, pkgDir: installedDir(principal.key, packageId), manifest })
          notes.push(r.ok ? '技能已恢复' : `⚠️ ${r.note}`)
        }
      } else {
        const r = skillEngine.uninstall({ callerKey: principal.key, packageId })
        notes.push(r.ok ? '技能已停用' : `⚠️ ${r.note}`)
      }
      const pi = await import('../../piBridge.js')
      pi.invalidateWebosServices?.()
    } catch (error) {
      notes.push(`skill 同步失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  // theme：activeTheme 增/清
  if (install.type === 'theme') {
    try {
      if (enabled) {
        const dest = installedDir(principal.key, packageId)
        const manifest = readInstalledManifest(principal.key, packageId)
        if (manifest) notes.push(provisionTheme(principal.key, packageId, dest, manifest))
      } else {
        const active = await getActiveTheme(principal.key)
        if (active && active.packageId === packageId) {
          fs.rmSync(activeThemeFile(principal.key), { force: true })
          notes.push('主题已恢复默认（重新启用可再应用）')
        } else {
          notes.push('主题已停用（未作为当前主题）')
        }
      }
    } catch (error) {
      notes.push(`theme 同步失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  await logAgentAction(principal.key, 'market_toggle', { packageId, enabled }, true)
  return ok({ packageId, enabled: row.enabled, note: notes.join('；') || (enabled ? '已启用' : '已停用') })
}

export async function listMyMarketInstalls(principal: PrincipalLike): Promise<MarketResult<{ items: Array<{ packageId: string; type: string; installedAt: number; enabled: boolean }> }>> {
  const guest = requireNonGuest(principal)
  if (guest) return fail('GUEST_NOT_ALLOWED', '互通体系仅面向注册用户（R13）')
  const rows = await listMyInstalls(principal.key)
  return ok({ items: rows.map((r) => ({ packageId: r.packageId, type: r.type, installedAt: r.installedAt, enabled: r.enabled })) })
}

/** 我的安装详情（含启停态 + 当前生效说明），市场设置页使用 */
export async function myInstallDetail(principal: PrincipalLike, packageId: string): Promise<MarketResult<{ packageId: string; type: string; enabled: boolean }>> {
  const guest = requireNonGuest(principal)
  if (guest) return fail('GUEST_NOT_ALLOWED', '互通体系仅面向注册用户（R13）')
  const row = await getMarketInstall(packageId, principal.key)
  if (!row) return fail('NOT_INSTALLED', `未安装「${packageId}」`)
  return ok({ packageId: row.packageId, type: row.type, enabled: row.enabled })
}

// ---- pi 工具：AI 找包 / 装包 ----

export async function registerMarketTools(principal: PrincipalLike): Promise<ToolDefinition[]> {
  const searchTool: ToolDefinition = {
    name: 'search_market_packages',
    label: '搜索包市场',
    description: '在市场搜索已上架的包（api/skill/theme 等，万物皆可包 R14）。返回 id / 类型 / 显示名 / 版本 / 发布者 / 端点概览。找到想要的包后用 install_market_package 安装（安装免费；api 包端点调用按调用者计费）。',
    parameters: Type.Object({
      q: Type.Optional(Type.String({ description: '搜索关键词（包 id 或显示名子串）' })),
      type: Type.Optional(Type.String({ description: '按类型过滤：api | skill | theme | toolpkg | bundle | …（省略=全部）' })),
    }),
    execute: async (_id: string, params: unknown) => {
      const p = (params ?? {}) as { q?: string; type?: string }
      const r = await listMarket({ q: p.q, type: p.type })
      if (!r.ok) return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: r.code, message: r.error }) }], details: {}, isError: true }
      const body = r.entries.slice(0, 20).map((e) => ({ id: e.packageId, type: e.type, name: e.displayName, version: e.version, owner: e.owner, description: e.description, endpoints: e.endpoints }))
      return { content: [{ type: 'text', text: JSON.stringify({ success: true, count: body.length, packages: body }) }], details: {} }
    },
  }

  const installTool: ToolDefinition = {
    name: 'install_market_package',
    label: '从市场安装包',
    description: '安装市场里的一个包（含其依赖闭包，自动一并安装；依赖缺失将拒绝并说明）。api 包安装后其 public 端点即可被调用（调用者本人付费，R15）；skill 包会复制 SKILL.md 到用户 skills/ 以便 AI 使用。',
    parameters: Type.Object({
      packageId: Type.String({ description: '包 id（search_market_packages 返回的 id）' }),
    }),
    execute: async (_id: string, params: unknown) => {
      const packageId = String((params as { packageId?: unknown }).packageId ?? '').trim()
      if (!packageId) return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'MISSING_ID', message: '需要 packageId' }) }], details: {}, isError: true }
      const r = await installMarketPackage(principal, packageId)
      if (!r.ok) return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: r.code, message: r.error, issues: r.issues }) }], details: {}, isError: true }
      return { content: [{ type: 'text', text: JSON.stringify({ success: true, installed: r.installed, note: r.note }) }], details: {} }
    },
  }
  return [searchTool, installTool]
}