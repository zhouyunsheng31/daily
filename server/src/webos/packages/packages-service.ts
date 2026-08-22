// server/src/webos/packages/packages-service.ts —— W1 包体系核心服务
// ----------------------------------------------------------------------------
// 依据：docs/routes/web/03-package-system.md §4（生命周期流水线）+ §5（AI 开发包、
//   校验反馈回路）+ 09-roadmap W1 交付（文件夹即包泛化 / 包事务 / 校验反馈）。
// 职责：
//   - 「文件夹即包」泛化：AI 在 packages/<id>/ 写 daily.pkg.json →
//     系统即时识别 type → 静态校验（契约 + 内容）→ 注册 + 建不可变版本；
//   - 校验反馈回路：校验不过不建版本，人话错误随 agent_fs_write 工具结果回流；
//   - 版本不可变 + 指针切换 + 回滚 + 审计（packages 三表，W0 校验器复用）；
//   - 回收站语义（packages/.trash/）：DELETE 移动文件夹 + 卸载标记，恢复即重扫关联。
// 约束：id 全局唯一（同 npm 语义）+ owner_key；W1 只做本人注册/安装，表结构为 W3 市场铺路。
// ============================================================================

import fs from 'node:fs'
import path from 'node:path'
import { Script as VmScript } from 'node:vm'
import {
  getWorkspaceRoot,
  APP_ID_PATTERN,
} from '../../utils/webosWorkspace.js'
import { validatePackageManifest, validateApiSpec, type ContractIssue } from '../contracts/index.js'
import {
  getPackage,
  listPackages,
  upsertPackage,
  insertVersion,
  listVersions,
  getVersion,
  setVersionStatus,
  setPackageActive,
  upsertInstall,
  getInstall,
  setInstallInstalled,
  appendVersionAudit,
} from './packages-db.js'

// ---- 常量（schema 唯一事实源在 shared/webos-contracts/packages/daily-pkg.schema.ts；
//      server rootDir 限制无法 import shared .ts → 本地常量 + 值守卫注释） ----
export const PACKAGE_MAX_BYTES = 10 * 1024 * 1024 // 单包配额 10MB（与 shared 一致）
export const PACKAGES_DIR = 'packages'
export const PACKAGES_TRASH_DIR = 'packages/.trash'
export const PACKAGE_MANIFEST = 'daily.pkg.json'
const MAX_BASE64_BLOB = 48 * 1024 // 静态拒绝：超大 base64 连续块（混淆对抗）

/** 各类型默认入口（entry 缺省时使用）；null = 不强求入口（bundle/theme/url-app 等） */
const TYPE_ENTRY_DEFAULTS: Record<string, string | null> = {
  app: 'index.html',
  'pet-layer': 'index.html',
  api: 'api.json',
  skill: 'SKILL.md',
  theme: null,
  toolpkg: 'main.js',
  mcp: null,
  workflow: null,
  'model-pack': null,
  'url-app': null,
  provider: null,
  subagent: 'agent.md',
  bundle: null,
}

// ---- 只读适配视图（「把 app 视为 type=app 的包」）：由 index.ts 注入，避免循环依赖 ----

export interface PackageListItem {
  id: string
  type: string
  displayName: string
  icon: string | null
  version: string | null
  source: string
  installed: boolean
  owner: boolean
  capabilities: string[]
  activeVersionId: string | null
  createdAt: number
  updatedAt: number
}

export type AppViewProvider = (key: string) => Promise<PackageListItem[]>

let appViewProvider: AppViewProvider | null = null

/** 注入 app 只读适配视图（index.ts 启动时调用；apps 视为 type=app 的包） */
export function setAppViewProvider(provider: AppViewProvider): void {
  appViewProvider = provider
}

async function appViewItems(key: string): Promise<PackageListItem[]> {
  if (!appViewProvider) return []
  try {
    return await appViewProvider(key)
  } catch (error) {
    console.warn('[packages] app view provider failed:', error instanceof Error ? error.message : String(error))
    return []
  }
}

// ---- 路径 / 小工具 ----

/** 解析相对路径是否命中 packages/<id>/（返回 id；非 packages/ 树则 null） */
export function matchPackageFolder(relative: string): string | null {
  const normalized = (relative ?? '').replace(/\\/g, '/').replace(/^\.\//, '')
  const m = normalized.match(/^packages\/([^/]+)(?:\/|$)/)
  if (!m) return null
  const id = m[1]!
  // 排除隐藏目录（.trash 等）与路径穿越（./..）
  if (id.startsWith('.') || id === '..') return null
  return APP_ID_PATTERN.test(id) ? id : null
}

export function packageDir(key: string, id: string): string {
  return path.join(getWorkspaceRoot(key), PACKAGES_DIR, id)
}

export function packageTrashDir(key: string, id: string): string {
  return path.join(getWorkspaceRoot(key), PACKAGES_TRASH_DIR, id)
}

function orgFromKey(key: string): 'system' | 'guest' | 'user' {
  if (key === 'system') return 'system'
  return key.startsWith('user:') ? 'user' : 'guest'
}

function manifestDisplayName(manifest: Record<string, unknown>): string | null {
  const dn = manifest.display_name as { zh?: string; en?: string } | undefined
  if (dn && typeof dn === 'object') {
    if (typeof dn.zh === 'string' && dn.zh) return dn.zh
    if (typeof dn.en === 'string' && dn.en) return dn.en
  }
  return String(manifest.id ?? '')
}

function manifestCapabilities(manifest: Record<string, unknown>): string[] {
  const caps = manifest.capabilities
  return Array.isArray(caps) ? caps.filter((c): c is string => typeof c === 'string') : []
}

/**
 * 计算下一个版本号：以 manifest 声明为准；若声明已被占用（同名版本已存在）
 * 则自动 +1 直到唯一：
 *   - 普通版本 1.2.0 被占 → 1.2.1（patch +1）
 *   - pre-release 1.2.0-beta.1 被占 → 1.2.0-beta.2（pre 数字尾 +1）
 */
export function nextPackageVersion(existingVersions: string[], declared: string): string {
  const used = new Set(existingVersions)
  if (!used.has(declared)) return declared
  const m = declared.match(/^(\d+)\.(\d+)\.(\d+)(?:-(.*))?$/)
  if (!m) return `${declared}-${Date.now()}`
  const major = m[1]!
  const minor = m[2]!
  const patch = m[3]!
  const pre = m[4]
  let candidate = declared
  do {
    if (pre) {
      const preM = candidate.slice(candidate.indexOf('-') + 1).match(/^(.*\D)?(\d+)$/)
      const head = preM ? preM[1] ?? '' : ''
      const num = preM ? Number(preM[2]) : 0
      candidate = `${major}.${minor}.${patch}-${head}${num + 1}`
    } else {
      const [, , , curPatch] = candidate.match(/^(\d+)\.(\d+)\.(\d+)/) ?? []
      candidate = `${major}.${minor}.${Number(curPatch ?? patch) + 1}`
    }
  } while (used.has(candidate))
  return candidate
}

function humanBytes(n: number): string {
  if (n < 1024) return `${n}B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`
  return `${(n / (1024 * 1024)).toFixed(1)}MB`
}

function formatIssues(target: string, issues: ContractIssue[]): string {
  const lines = issues.map((i) => `- ${i.path ? `${i.path}：` : ''}${i.message}`)
  return `⚠️ ${target} 校验未通过（未建版本，保持最近有效版本）：\n${lines.join('\n')}`
}

/** 递归收集包文件夹内相对路径 + 总字节（h = 隐藏约束：跳过 .git 等） */
function collectPackageFiles(folderDir: string): { files: string[]; total: number } {
  const files: string[] = []
  let total = 0
  const walk = (dir: string, base: string): void => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') && (entry.name === '.git' || entry.name === '.trash')) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full, path.join(base, entry.name))
      } else if (entry.isFile()) {
        let size: number
        try {
          size = fs.statSync(full).size
        } catch {
          continue
        }
        total += size
        files.push(path.join(base, entry.name).replace(/\\/g, '/'))
      }
    }
  }
  walk(folderDir, '')
  return { files, total }
}

/**
 * 包内容校验（在 manifest 结构校验通过后二次执行）：
 *   1) 总大小 ≤ 10MB；2) 按类型入口文件存在；3) api 类型 api.json/spec 再校验；
 *   4) mcp 条目入口存在；5) html/js/svg 静态拒绝清单（危险元素/协议/占位/eval/大 base64）。
 */
export function validatePackageContent(manifest: Record<string, unknown>, folderDir: string): ContractIssue[] {
  const issues: ContractIssue[] = []
  if (!fs.existsSync(folderDir) || !fs.statSync(folderDir).isDirectory()) {
    issues.push({ path: '', message: `包目录不存在（${folderDir}）` })
    return issues
  }
  const { files, total } = collectPackageFiles(folderDir)
  if (total > PACKAGE_MAX_BYTES) {
    issues.push({ path: '', message: `包总大小 ${humanBytes(total)} 超过单包配额 ${humanBytes(PACKAGE_MAX_BYTES)}` })
  }

  const type = String(manifest.type ?? '')
  const entry = typeof manifest.entry === 'string' && manifest.entry ? manifest.entry : TYPE_ENTRY_DEFAULTS[type] ?? null
  if (entry) {
    const full = path.join(folderDir, entry)
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
      issues.push({ path: `entry`, message: `入口文件「${entry}」不存在（type=「${type}」需要该入口）` })
    }
  }

  // type=api：校验 api.json 声明是否完整合法（W2 handler 引擎前置门禁）
  if (type === 'api') {
    const apiRel = (manifest.api as { spec?: string } | undefined)?.spec ?? 'api.json'
    const apiFull = path.join(folderDir, apiRel)
    if (!fs.existsSync(apiFull)) {
      issues.push({ path: `api.spec`, message: `api 包缺少声明的 api.json（${apiRel}）` })
    } else {
      try {
        const apiRaw = JSON.parse(fs.readFileSync(apiFull, 'utf-8')) as unknown
        const apiResult = validateApiSpec(apiRaw)
        for (const issue of apiResult.issues) issues.push(issue)
      } catch (error) {
        issues.push({ path: apiRel, message: `api.json 不是合法 JSON：${error instanceof Error ? error.message : String(error)}` })
      }
    }
  }

  // contents.mcp 声明的入口文件必须存在
  const contents = manifest.contents as { mcp?: Array<{ entry?: string }> } | undefined
  if (contents?.mcp && Array.isArray(contents.mcp)) {
    contents.mcp.forEach((mcp, i) => {
      if (typeof mcp.entry === 'string' && mcp.entry) {
        const full = path.join(folderDir, mcp.entry)
        if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
          issues.push({ path: `contents.mcp[${i}].entry`, message: `MCP 条目入口「${mcp.entry}」不存在` })
        }
      }
    })
  }

  // 静态拒绝清单（html/js/svg + 超大 base64）
  for (const rel of files) {
    const lower = rel.toLowerCase()
    if (lower.endsWith('.html') || lower.endsWith('.htm')) {
      const content = safeRead(folderDir, rel)
      if (content == null) continue
      if (/<\s*(iframe|object|embed|base)\b/i.test(content)) {
        issues.push({ path: rel, message: '不允许 iframe/object/embed/base 元素（防嵌套/防改 base）' })
      }
      if (/(?:src|href|action|formaction)\s*=\s*["']?\s*(?:javascript:|vbscript:|file:|filesystem:)/i.test(content)) {
        issues.push({ path: rel, message: '不允许 javascript:/vbscript:/file: 等危险协议资源' })
      }
      if (/\s(?:src|href)\s*=\s*["']?\s*data:text\/html/i.test(content)) {
        issues.push({ path: rel, message: '不允许 data:text/html 资源' })
      }
      if (type !== 'url-app' && /(?:src|href|action|formaction)\s*=\s*["']?\s*(?:https?:|https?%3A|\x2f\x2f)/i.test(content)) {
        issues.push({ path: rel, message: '静态包不允许外部网络资源（外部引用请用 url-app 类型或声明 network.domains 后经 App API 访问）' })
      }
      const blobs = [...content.matchAll(/data:[a-z0-9/+.-]+;base64,([A-Za-z0-9+/=]+)/gi)]
      for (const b of blobs) {
        if (b[1] && b[1].length > MAX_BASE64_BLOB) {
          issues.push({ path: rel, message: `base64 内联块过大（${humanBytes((b[1].length / 4) * 3)}，疑似混淆载荷）` })
        }
      }
    } else if (lower.endsWith('.js') || lower.endsWith('.mjs')) {
      const content = safeRead(folderDir, rel)
      if (content == null) continue
      if (/(?:^|\s)(?:\.\.\.|…)(?=\s*(?:[;{}()[\],:]|$))/m.test(content)) {
        issues.push({ path: rel, message: 'JS 里出现省略号/代码占位符（…），疑似未完成代码' })
      }
      if (/\beval\s*\(/i.test(content) || /\bnew\s+Function\s*\(/i.test(content)) {
        issues.push({ path: rel, message: '不允许 eval / new Function（远程代码执行向量）' })
      }
      try {
        new VmScript(content, { filename: `pkg-${rel}` })
      } catch (error) {
        issues.push({ path: rel, message: `JS 语法错误：${error instanceof Error ? error.message : String(error)}` })
      }
    } else if (lower.endsWith('.svg')) {
      const content = safeRead(folderDir, rel)
      if (content != null && /<script\b/i.test(content)) {
        issues.push({ path: rel, message: 'SVG 不允许内嵌 <script>' })
      }
    }
  }

  // 去重（同 path 同 message 只报一次）
  const seen = new Set<string>()
  return issues.filter((i) => {
    const k = `${i.path}|${i.message}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

function safeRead(folderDir: string, rel: string): string | null {
  try {
    return fs.readFileSync(path.join(folderDir, rel), 'utf-8')
  } catch {
    return null
  }
}

// ---- 注册 / 版本（核心事务：校验不过不建版本） ----

async function registerOrUpdate(
  key: string,
  folderId: string,
  manifest: Record<string, unknown>,
  createdBy: 'system' | 'guest' | 'user',
): Promise<{ ok: boolean; feedback: string; versionCreated: boolean }> {
  const folderDir = packageDir(key, folderId)
  const contentIssues = validatePackageContent(manifest, folderDir)
  if (contentIssues.length > 0) {
    return { ok: false, feedback: formatIssues(`packages/${folderId}`, contentIssues), versionCreated: false }
  }

  const existing = await getPackage(folderId)
  if (existing && existing.ownerKey !== key) {
    return {
      ok: false,
      feedback: `⚠️ 包 id「${folderId}」已被其他用户占用（owner=${existing.ownerKey.slice(0, 12)}）。请换一个全局唯一 id（如 com.daily.xxx）`,
      versionCreated: false,
    }
  }

  const versions = existing ? await listVersions(folderId) : []
  const prevActiveId = existing?.activeVersionId ?? null
  const active = prevActiveId ? versions.find((v) => v.id === prevActiveId) ?? null : null

  // 幂等：活动版本 manifest 与文件夹当前一致 → 不建新版本（AI 重复写同内容不产生垃圾版本）
  if (active && active.manifest && sameManifest(active.manifest, manifest)) {
    return { ok: true, feedback: `✅ 包 packages/${folderId}（${String(manifest.type)}）校验通过，无内容变化（当前 v${active.version}）`, versionCreated: false }
  }

  const versionStr = nextPackageVersion(versions.map((v) => v.version), String(manifest.version ?? '1.0.0'))
  const version = await insertVersion({
    packageId: folderId,
    version: versionStr,
    status: 'active',
    parentVersionId: active?.id ?? null,
    manifest,
    contentRef: folderId,
    createdBy,
    audit: [{ action: 'version_created', at: Date.now(), by: createdBy }],
  })
  if (prevActiveId && prevActiveId !== version.id) {
    await setVersionStatus(prevActiveId, 'ready')
  }
  await upsertPackage({
    id: folderId,
    ownerKey: key,
    type: String(manifest.type),
    displayName: manifestDisplayName(manifest),
    icon: typeof manifest.icon === 'string' ? manifest.icon : null,
    source: existing?.source ?? 'ai_generated',
    activeVersionId: version.id,
    installed: true,
    capabilities: manifestCapabilities(manifest),
    network: (manifest.network as { domains?: string[] } | undefined) ?? null,
  })
  await upsertInstall({ packageId: folderId, userKey: key, activeVersionId: version.id, installed: true })
  await appendVersionAudit(version.id, { action: 'version_created', at: Date.now(), by: createdBy })
  const verb = existing ? '已发布新版本' : '已注册'
  console.log(`[packages] ${verb}: ${folderId} v${versionStr} (${String(manifest.type)}) owner=${key.slice(0, 12)}`)
  return { ok: true, feedback: `✅ 包 packages/${folderId}（${String(manifest.type)}）校验通过，${verb} v${versionStr}`, versionCreated: true }
}

function sameManifest(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}

/** 从工作区文件钩子触发的「文件夹即包」同步（返回人话反馈，随工具结果回流） */
export async function syncPackageFromFs(key: string, fullPath: string): Promise<string | void> {
  const root = getWorkspaceRoot(key)
  const relative = (() => {
    try {
      return path.relative(root, fullPath)
    } catch {
      return ''
    }
  })()
  if (!relative || relative.startsWith('..')) return undefined
  const folderId = matchPackageFolder(relative)
  if (!folderId) return undefined

  const folderDir = packageDir(key, folderId)
  if (!fs.existsSync(folderDir) || !fs.statSync(folderDir).isDirectory()) {
    return `⚠️ packages/${folderId} 目录已不存在；包保持最近有效版本不变`
  }
  const manifestFile = path.join(folderDir, PACKAGE_MANIFEST)
  if (!fs.existsSync(manifestFile)) {
    return `⚠️ packages/${folderId} 下缺少 ${PACKAGE_MANIFEST}（包 manifest）：先写 manifest，再补内容，校验通过后系统自动注册`
  }
  let manifest: unknown
  try {
    manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf-8'))
  } catch (error) {
    return `⚠️ packages/${folderId}/${PACKAGE_MANIFEST} 不是合法 JSON：${error instanceof Error ? error.message : String(error)}`
  }
  if (idMismatch(manifest, folderId)) {
    return `⚠️ packages/${folderId}/${PACKAGE_MANIFEST} 的 id（${String((manifest as Record<string, unknown>).id)}）与文件夹名（${folderId}）不一致：请改 manifest 或用同 id 的文件夹`
  }
  const cr = validatePackageManifest(manifest)
  if (!cr.ok) {
    return formatIssues(`packages/${folderId}/${PACKAGE_MANIFEST}`, cr.issues)
  }
  const m = manifest as Record<string, unknown>
  if (m.type === 'app') {
    return `⚠️ packages/${folderId}：type=app 的包请放进 apps/${folderId}/ 目录（文件夹即 App，由桌面调度）；packages/ 只登记非 app 类型（api/skill/theme 等）`
  }
  const r = await registerOrUpdate(key, folderId, m, orgFromKey(key))
  return r.feedback
}

function idMismatch(value: unknown, folderId: string): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  return (value as Record<string, unknown>).id !== folderId
}

/**
 * 启动/列表时全量扫描 packages/ 注册（幂等；覆盖手动复制文件夹、回收站恢复、
 * 钩子未触发的历史目录）。只处理含合法 daily.pkg.json 的完整包。
 */
export async function syncAllPackagesFromWorkspace(key: string): Promise<void> {
  const root = getWorkspaceRoot(key)
  const packagesRoot = path.join(root, PACKAGES_DIR)
  let dirs: string[] = []
  try {
    if (!fs.existsSync(packagesRoot)) return
    dirs = fs.readdirSync(packagesRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && APP_ID_PATTERN.test(e.name))
      .map((e) => e.name)
  } catch {
    return
  }
  for (const folderId of dirs) {
    const manifestFile = path.join(packagesRoot, folderId, PACKAGE_MANIFEST)
    if (!fs.existsSync(manifestFile)) continue // 半成品目录：跳过，写完再注册
    let raw: unknown
    try {
      raw = JSON.parse(fs.readFileSync(manifestFile, 'utf-8'))
    } catch {
      continue
    }
    const cr = validatePackageManifest(raw)
    // idMismatch(raw, folderId) === true 表示 manifest.id ≠ 文件夹名 → 跳过
    if (!cr.ok || idMismatch(raw, folderId)) continue
    const m = raw as Record<string, unknown>
    if (m.type === 'app') continue // app 走 apps/（视同已有机制）
    try {
      await registerOrUpdate(key, folderId, m, orgFromKey(key))
    } catch (error) {
      console.warn(`[packages] scan register failed for ${folderId}:`, error instanceof Error ? error.message : String(error))
    }
  }
}

// ---- 列表 / 详情 ----

export async function listForUser(key: string, opts: { type?: string; q?: string } = {}): Promise<PackageListItem[]> {
  const { type, q } = opts
  const ql = q?.toLowerCase()
  const byQ = (items: PackageListItem[]): PackageListItem[] =>
    ql ? items.filter((i) => i.id.toLowerCase().includes(ql) || i.displayName.toLowerCase().includes(ql)) : items

  // type=app → 只读适配视图（apps 视为 type=app 的包）
  if (type === 'app') return byQ(await appViewItems(key))

  const rows = await listPackages({ ownerKey: key, type, q })
  const items: PackageListItem[] = rows.map((p) => ({
    id: p.id,
    type: p.type,
    displayName: p.displayName ?? p.id,
    icon: p.icon,
    version: null,
    source: p.source,
    installed: p.installed,
    owner: p.ownerKey === key,
    capabilities: p.capabilities,
    activeVersionId: p.activeVersionId,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  }))
  // 补版本号：批量查活跃版本（≤500，逐查版本表代价可控）
  for (const item of items) {
    if (item.activeVersionId) {
      const v = await getVersion(item.activeVersionId)
      item.version = v?.version ?? null
    }
  }
  // 无 type 过滤时合并 app 只读适配视图
  if (type === undefined) return byQ([...(await appViewItems(key)), ...items])
  return items
}

export interface PackageDetailView {
  item: PackageListItem
  versions: Array<{
    id: string
    version: string
    status: string
    parentVersionId: string | null
    manifest: Record<string, unknown>
    createdBy: string
    createdAt: number
    audit: unknown[]
  }>
  install: { installed: boolean; activeVersionId: string | null; installedAt: number } | null
}

export async function getDetailForUser(key: string, id: string): Promise<PackageDetailView | null> {
  const pkg = await getPackage(id)
  if (!pkg) return null
  const versions = await listVersions(id)
  const install = await getInstall(id, key)
  const active = pkg.activeVersionId ? versions.find((v) => v.id === pkg.activeVersionId) ?? null : null
  return {
    item: {
      id: pkg.id,
      type: pkg.type,
      displayName: pkg.displayName ?? pkg.id,
      icon: pkg.icon,
      version: active?.version ?? null,
      source: pkg.source,
      installed: pkg.installed,
      owner: pkg.ownerKey === key,
      capabilities: pkg.capabilities,
      activeVersionId: pkg.activeVersionId,
      createdAt: pkg.createdAt,
      updatedAt: pkg.updatedAt,
    },
    versions: versions.map((v) => ({
      id: v.id,
      version: v.version,
      status: v.status,
      parentVersionId: v.parentVersionId,
      manifest: v.manifest,
      createdBy: v.createdBy,
      createdAt: v.createdAt,
      audit: v.audit,
    })),
    install: install ? { installed: install.installed, activeVersionId: install.activeVersionId, installedAt: install.installedAt } : null,
  }
}

// ---- 生命周期操作（REST 路由调用） ----

/** 粘贴/上传创建：写入包目录后走注册事务（校验不过不建版本） */
export async function createFromPaste(
  key: string,
  input: { manifest: unknown; files?: Record<string, string> | Array<{ path: string; content: string }> },
): Promise<{ ok: boolean; feedback: string; id?: string }> {
  const cr = validatePackageManifest(input.manifest)
  if (!cr.ok) return { ok: false, feedback: formatIssues('新包', cr.issues) }
  const m = (cr.normalized ?? input.manifest) as Record<string, unknown>
  const id = String(m.id)

  if (m.type === 'app') {
    // 兼容统一包接口上传 app 类型：写入 apps/<id>/ 并注册 App
    const root = getWorkspaceRoot(key)
    const appDir = path.join(root, 'apps', id)
    fs.mkdirSync(appDir, { recursive: true })
    writeManifestAndFiles(appDir, m, input.files)
    return { ok: true, feedback: `✅ 应用 apps/${id} 导入成功，已添加到桌面`, id }
  }

  if (idMismatch(m, id)) {
    return { ok: false, feedback: `manifest id 缺失或非法（${String(m.id ?? '')}）` }
  }
  const folderDir = packageDir(key, id)
  fs.mkdirSync(folderDir, { recursive: true })
  // 写 manifest + 可选文件（路径防穿越）
  writeManifestAndFiles(folderDir, m, input.files)
  const r = await registerOrUpdate(key, id, m, orgFromKey(key))
  return { ok: r.ok, feedback: r.feedback, id: r.ok ? id : undefined }
}

function writeManifestAndFiles(
  folderDir: string,
  manifest: Record<string, unknown>,
  files?: Record<string, string> | Array<{ path: string; content: string }>,
): void {
  // 先保证 manifest 写入
  const manifestPath = path.join(folderDir, PACKAGE_MANIFEST)
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true })
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8')
  writePackageFilesOnly(folderDir, files)
}

/** 只写调用方提供的包文件（不碰 daily.pkg.json；路径防穿越） */
function writePackageFilesOnly(
  folderDir: string,
  files?: Record<string, string> | Array<{ path: string; content: string }>,
): void {
  const entries: Array<{ path: string; content: string }> = []
  if (Array.isArray(files)) {
    entries.push(...files)
  } else if (files && typeof files === 'object') {
    for (const [p, content] of Object.entries(files)) entries.push({ path: p, content })
  }
  for (const f of entries) {
    const rel = (f.path ?? '').replace(/\\/g, '/').replace(/^\/+/, '')
    if (!rel || rel.includes('..')) continue
    const full = path.join(folderDir, rel)
    if (!full.startsWith(folderDir + path.sep)) continue
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, f.content, 'utf-8')
  }
}

/** 推新版本（可带文件更新）：应用文件后重新校验，内容变化才建版本（包事务） */
export async function pushNewVersion(
  key: string,
  id: string,
  input: { files?: Record<string, string> | Array<{ path: string; content: string }>; reason?: string } = {},
): Promise<{ ok: boolean; feedback: string }> {
  const pkg = await getPackage(id)
  if (!pkg) return { ok: false, feedback: `找不到包「${id}」` }
  if (pkg.ownerKey !== key) return { ok: false, feedback: '无权操作他人包' }
  if (input.files) writePackageFilesOnly(packageDir(key, id), input.files)

  const manifestFile = path.join(packageDir(key, id), PACKAGE_MANIFEST)
  if (!fs.existsSync(manifestFile)) return { ok: false, feedback: `packages/${id}/${PACKAGE_MANIFEST} 不存在` }
  let raw: unknown
  try {
    raw = JSON.parse(fs.readFileSync(manifestFile, 'utf-8'))
  } catch (error) {
    return { ok: false, feedback: `manifest JSON 解析失败：${error instanceof Error ? error.message : String(error)}` }
  }
  const cr = validatePackageManifest(raw)
  if (!cr.ok) return { ok: false, feedback: formatIssues(`packages/${id}/${PACKAGE_MANIFEST}`, cr.issues) }
  if (idMismatch(raw, id)) return { ok: false, feedback: `manifest id（${String((raw as Record<string, unknown>).id)}）与包 id「${id}」不一致` }
  const r = await registerOrUpdate(key, id, raw as Record<string, unknown>, orgFromKey(key))
  return { ok: r.ok, feedback: r.feedback }
}
// ---- 原子切指针 ----

export async function setActiveVersion(key: string, id: string, versionId: string): Promise<{ ok: boolean; feedback: string }> {
  const pkg = await getPackage(id)
  if (!pkg) return { ok: false, feedback: `找不到包「${id}」` }
  if (pkg.ownerKey !== key) return { ok: false, feedback: '无权操作他人包' }
  const versions = await listVersions(id)
  if (!versions.some((v) => v.id === versionId)) return { ok: false, feedback: `版本 ${versionId} 不属于包「${id}」` }
  if (pkg.activeVersionId === versionId) return { ok: true, feedback: `包「${id}」已指向该版本` }
  await setPackageActive(id, versionId, { prevActiveVersionId: pkg.activeVersionId })
  await upsertInstall({ packageId: id, userKey: key, activeVersionId: versionId, installed: true })
  await appendVersionAudit(versionId, { action: 'active_switched', at: Date.now(), by: orgFromKey(key) })
  const target = versions.find((v) => v.id === versionId)!
  return { ok: true, feedback: `✅ 包「${id}」活动版本已切换：${target.version}` }
}

/** 回滚：切到指定/最近可用版本（指针语义；内容恢复待 W2 执行引擎按版本 manifest+文件重建） */
export async function rollbackTo(key: string, id: string, opts: { toVersionId?: string } = {}): Promise<{ ok: boolean; feedback: string }> {
  const pkg = await getPackage(id)
  if (!pkg) return { ok: false, feedback: `找不到包「${id}」` }
  if (pkg.ownerKey !== key) return { ok: false, feedback: '无权操作他人包' }
  const versions = await listVersions(id)
  if (versions.length <= 1) return { ok: false, feedback: `包「${id}」只有 1 个版本，无可回滚目标` }
  let targetId: string
  if (opts.toVersionId) {
    if (!versions.some((v) => v.id === opts.toVersionId)) return { ok: false, feedback: `版本 ${opts.toVersionId} 不属于包「${id}」` }
    targetId = opts.toVersionId
  } else {
    const currentIdx = versions.findIndex((v) => v.id === pkg.activeVersionId)
    const fallback = versions.filter((v) => v.id !== pkg.activeVersionId).pop()
    if (!fallback) return { ok: false, feedback: '找不到可回滚版本' }
    targetId = currentIdx > 0 ? versions[currentIdx - 1]!.id : fallback.id
  }
  if (targetId === pkg.activeVersionId) return { ok: true, feedback: `包「${id}」已在目标版本` }
  const target = versions.find((v) => v.id === targetId)!
  const prevActive = pkg.activeVersionId
  await setPackageActive(id, targetId, { prevActiveVersionId: prevActive })
  if (prevActive) await setVersionStatus(prevActive, 'rolled_back')
  await upsertInstall({ packageId: id, userKey: key, activeVersionId: targetId, installed: true })
  await appendVersionAudit(targetId, { action: 'rollback_to', at: Date.now(), by: orgFromKey(key) })
  return { ok: true, feedback: `✅ 包「${id}」已回滚到 v${target.version}` }
}

/** 回收：移动文件夹到 packages/.trash/ + 卸载标记（DB 行保留；恢复=移回+重扫） */
export async function recyclePackage(key: string, id: string): Promise<{ ok: boolean; feedback: string }> {
  const pkg = await getPackage(id)
  if (!pkg) return { ok: false, feedback: `找不到包「${id}」` }
  if (pkg.ownerKey !== key) return { ok: false, feedback: '无权操作他人包' }
  const from = packageDir(key, id)
  const to = packageTrashDir(key, id)
  if (fs.existsSync(from)) {
    if (fs.existsSync(to)) fs.rmSync(to, { recursive: true, force: true })
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.renameSync(from, to)
  }
  await setInstallInstalled(id, key, false)
  await upsertPackage({ ...pkg, installed: false })
  return { ok: true, feedback: `🗑 包「${id}」已移入回收站（packages/.trash/）；复制回 packages/${id}/ 即自动恢复` }
}

/** 恢复回收站包：移回原目录 + 重扫（幂等，版本指针不变） */
export async function restorePackage(key: string, id: string): Promise<{ ok: boolean; feedback: string }> {
  const pkg = await getPackage(id)
  if (!pkg) return { ok: false, feedback: `找不到包「${id}」` }
  const from = packageTrashDir(key, id)
  const to = packageDir(key, id)
  if (!fs.existsSync(from)) return { ok: false, feedback: `回收站中没有「${id}」（可能已被彻底删除）` }
  fs.mkdirSync(path.dirname(to), { recursive: true })
  fs.renameSync(from, to)
  await setInstallInstalled(id, key, true)
  await upsertPackage({ ...pkg, installed: true })
  await syncPackageFromFs(key, path.join(to, PACKAGE_MANIFEST))
  return { ok: true, feedback: `✅ 包「${id}」已恢复（版本指针保持 v${pkg.activeVersionId ? (await getVersion(pkg.activeVersionId))?.version ?? '' : ''}）` }
}

/** 解析包内文件绝对路径（供 raw 端点；防穿越） */
export function resolvePackageFilePath(key: string, id: string, restPath: string): string | null {
  const root = packageDir(key, id)
  const rel = (restPath ?? '').replace(/\\/g, '/').replace(/^\/+/, '')
  if (!rel || rel.includes('..')) return null
  const full = path.join(root, rel)
  if (!full.startsWith(root + path.sep)) return null
  return full
}
