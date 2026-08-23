// server/src/webos/appapi/appapi-service.ts —— W2 App API 编排核心
// ----------------------------------------------------------------------------
// 依据：docs/routes/web/04-app-api.md §2/§5。
//   ① loadApiSpecs(userKey)    聚合本人 api 类型包的 api.json（校验后），供动态工具/调用解析
//   ② registerDynamicTools     把每个端点注册为 pi 工具 appapi_<ns>_<ep>
//   ③ invokeEndpoint           完整管线：鉴权(owner) → 解析 → storage 权界 → vm 执行 →
//                              计费(fixed) → 用量/审计落库
// 依赖注入：为避免与 webos.ts（loadState/saveState/chargeCredits）循环依赖，
//   由 webos.ts 在模块加载时 setAppApiDeps 注入（同 packages.setAppViewProvider 模式）。
// ============================================================================

import path from 'node:path'
import { Type } from 'typebox'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import { validateApiSpec } from '../contracts/index.js'
import { listPackages } from '../packages/packages-db.js'
import { resolvePackageFilePath, PACKAGE_MANIFEST, PACKAGES_DIR } from '../packages/packages-service.js'
import {
  getWorkspaceRoot,
  logAgentAction,
} from '../../utils/webosWorkspace.js'
import { fixedCostMinor } from '../../billing/pricing.js'
import { recordApiUsage, upsertApiPublic, getApiPublic, deleteApiPublic, type ApiUsageRecord } from './appapi-db.js'
import {
  executeApiHandler,
  makeStorage,
  makeHttp,
  matchStoragePrefix,
  redactSecrets,
  type ApiHandlerContext,
} from './api-runtime.js'

// ---- 本地类型（shared api.schema.ts 因 server rootDir 限制不能直接 import；
//      契约校验走 W0 JSON 快照 + validateApiSpec，此处类型仅供 TS 编译） ----

export interface ApiEndpointLike {
  name: string
  method?: 'GET' | 'POST'
  path: string
  description?: { zh?: string; en?: string }
  params?: unknown
  storage?: { read?: string[]; write?: string[] }
  handler: string
  returns?: unknown
  visibility?: 'owner' | 'public'
}

export interface WebOsApiSpecLike {
  schema_version: number
  namespace: string
  display_name?: { zh?: string; en?: string }
  network?: { domains?: string[] }
  secrets?: string[]
  endpoints: ApiEndpointLike[]
}

export type LoadedApiSpec = {
  packageId: string
  ownerKey: string
  activeVersionId: string | null
  spec: WebOsApiSpecLike
  manifestActive: Record<string, unknown> | null
}

// ---- 依赖注入（webos.ts 注册） ----

export interface PrincipalLike {
  key: string
  id: string
  guest: boolean
  role: string
  email?: string | null
}

/** 服务端 state 的结构化子集（避免依赖 webos.ts 内部类型 → 解耦循环） */
export interface AppStateLike {
  appStorage: Record<string, Record<string, unknown>>
  createdAt?: number
  credits?: {
    used?: number
    permanent?: { quota: number; used: number }
    monthly?: { quota: number; used: number; expiresAt: number }
    [k: string]: unknown
  }
  [k: string]: unknown
}

export interface AppApiDeps {
  loadState: (principal: PrincipalLike) => Promise<AppStateLike>
  saveState: (principal: PrincipalLike, state: AppStateLike) => Promise<void>
  /** 扣积分（1 积分 = ¥0.01）；返回实际扣减数；内部 mutate state.credits */
  chargeCredits: (state: AppStateLike, costMinor: number) => number
}

let deps: AppApiDeps | null = null

export function setAppApiDeps(injected: AppApiDeps): void {
  deps = injected
}

function requireDeps(): AppApiDeps {
  if (!deps) throw new Error('App API deps not registered (setAppApiDeps must be called at startup)')
  return deps
}

// ---- 加载 api specs ----

/** 读取包的 api.json 相对路径：manifest.api.spec ?? manifest.entry ?? 'api.json' */
function apiSpecRel(manifest: Record<string, unknown> | null): string {
  const api = manifest?.api as { spec?: string } | undefined
  if (api?.spec) return api.spec
  if (manifest && typeof manifest.entry === 'string' && manifest.entry && /\.json$/.test(manifest.entry)) return manifest.entry
  return 'api.json'
}

function readJsonFile(file: string): unknown | null {
  try {
    return JSON.parse(require('node:fs').readFileSync(file, 'utf-8'))
  } catch {
    return null
  }
}

/** 读取 package 的 daily.pkg.json（服务端校验用；不存在视为 null） */
function readOwnManifest(userKey: string, packageId: string): Record<string, unknown> | null {
  const root = getWorkspaceRoot(userKey)
  const file = path.join(root, PACKAGES_DIR, packageId, PACKAGE_MANIFEST)
  const raw = readJsonFile(file)
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>
  return null
}

/**
 * 聚合某用户本人所有 type=api 的包 specs（每条按 active 版本从文件夹现读，保证与
 * 包内容一致；owner 级 W2）。api.json 必须通过契约校验，失败跳过（不阻断其它包）。
 */
export async function loadApiSpecs(userKey: string): Promise<LoadedApiSpec[]> {
  const rows = await listPackages({ ownerKey: userKey, type: 'api' })
  const out: LoadedApiSpec[] = []
  for (const row of rows) {
    const manifest = readOwnManifest(userKey, row.id)
    const specRel = apiSpecRel(manifest)
    const specFull = path.join(getWorkspaceRoot(userKey), PACKAGES_DIR, row.id, specRel)
    const raw = readJsonFile(specFull)
    const cr = raw !== null ? validateApiSpec(raw) : null
    if (!cr || !cr.ok) continue // api.json 缺失/不合法 → 不注入（可经校验反馈修正）
    out.push({
      packageId: row.id,
      ownerKey: row.ownerKey,
      activeVersionId: row.activeVersionId,
      spec: (cr.normalized ?? raw) as WebOsApiSpecLike,
      manifestActive: manifest,
    })
  }
  return out
}

/** camelCase → snake_case（App 前端 sdk.useApi(ns).listNotes() 也能命中 list_notes） */
export function camelToSnake(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
}

/** 解析 namespace → 具体包 + 端点声明（找不到返回 null；支持 camelCase 别名） */
export async function resolveEndpoint(
  userKey: string,
  namespace: string,
  endpointName: string,
): Promise<{ packageId: string; ownerKey: string; spec: WebOsApiSpecLike; endpoint: ApiEndpointLike } | null> {
  const specs = await loadApiSpecs(userKey)
  for (const item of specs) {
    if (item.spec.namespace !== namespace) continue
    const endpoint = item.spec.endpoints.find((e) => e.name === endpointName)
      ?? item.spec.endpoints.find((e) => e.name === camelToSnake(endpointName))
    if (!endpoint) return null
    return { packageId: item.packageId, ownerKey: item.ownerKey, spec: item.spec, endpoint }
  }
  return null
}

/** 文档/调试数据源：某 namespace 的端点清单（不含 handler 代码体） */
export async function getNamespaceSpec(
  principal: PrincipalLike,
  namespace: string,
): Promise<{ ok: boolean; error?: string; namespace?: string; displayName?: string; network?: { domains?: string[] }; secrets?: string[]; endpoints?: Array<{ name: string; method?: string; path: string; description?: string; params?: unknown; storage?: { read?: string[]; write?: string[] }; visibility?: string }> }> {
  const specs = await loadApiSpecs(principal.key)
  const hit = specs.find((s) => s.spec.namespace === namespace)
  if (!hit) return { ok: false, error: 'namespace 未找到或未安装' }
  return {
    ok: true,
    namespace,
    displayName: hit.spec.display_name?.zh ?? hit.spec.namespace,
    network: hit.spec.network,
    secrets: hit.spec.secrets ?? [],
    endpoints: hit.spec.endpoints.map((e) => ({
      name: e.name,
      method: e.method ?? 'GET',
      path: e.path,
      description: e.description?.zh,
      params: e.params,
      storage: e.storage,
      visibility: e.visibility ?? 'owner',
    })),
  }
}

// ---- W3 public 管道：发布索引 + 跨用户公开解析 ----

/**
 * 发布某 api 命名空间为「公开可调用」（最小发布登记：namespace → owner 全局索引）。
 * 只允许 owner 本人；至少存在 1 个 visibility=public 端点才可发布（R13 游客不能发）。
 */
export async function publishNamespace(
  principal: PrincipalLike,
  namespace: string,
): Promise<{ ok: boolean; namespace?: string; publicEndpoints?: string[]; error?: string; errorCode?: string }> {
  if (principal.guest) return { ok: false, errorCode: 'GUEST_NOT_ALLOWED', error: '互通体系仅面向注册用户（R13）' }
  const specs = await loadApiSpecs(principal.key)
  const hit = specs.find((s) => s.spec.namespace === namespace)
  if (!hit) return { ok: false, errorCode: 'NAMESPACE_NOT_FOUND', error: `未见本人 api 包（namespace=${namespace}）` }
  const publicEndpoints = hit.spec.endpoints.filter((e) => e.visibility === 'public').map((e) => e.name)
  if (publicEndpoints.length === 0) return { ok: false, errorCode: 'NO_PUBLIC_ENDPOINTS', error: '该 api 包没有 visibility=public 的端点，无法公开' }
  await upsertApiPublic({ namespace, ownerKey: principal.key, packageId: hit.packageId })
  return { ok: true, namespace, publicEndpoints }
}

/** 撤回公开（owner 本人；从全局索引移除） */
export async function unpublishNamespace(
  principal: PrincipalLike,
  namespace: string,
): Promise<{ ok: boolean; error?: string; errorCode?: string }> {
  if (principal.guest) return { ok: false, errorCode: 'GUEST_NOT_ALLOWED', error: '互通体系仅面向注册用户（R13）' }
  const specs = await loadApiSpecs(principal.key)
  const hit = specs.find((s) => s.spec.namespace === namespace)
  if (!hit) return { ok: false, errorCode: 'NAMESPACE_NOT_FOUND', error: `未见本人 api 包（namespace=${namespace}）` }
  await deleteApiPublic(namespace)
  return { ok: true }
}

/** 查询某命名空间的 public 状态（已发布 + public 端点清单；任何注册用户可查，R13 排除游客） */
export async function getPublicStatus(
  principal: PrincipalLike,
  namespace: string,
): Promise<{ ok: boolean; published: boolean; publicEndpoints: string[]; ownerKey?: string; error?: string; errorCode?: string }> {
  if (principal.guest) return { ok: false, published: false, publicEndpoints: [], errorCode: 'GUEST_NOT_ALLOWED', error: '互通体系仅面向注册用户（R13）' }
  const row = await getApiPublic(namespace)
  if (!row) return { ok: true, published: false, publicEndpoints: [] }
  // 从属主当前包现读，确认仍然有效（防陈旧索引）
  const specs = await loadApiSpecs(row.ownerKey)
  const hit = specs.find((s) => s.spec.namespace === namespace)
  const publicEndpoints = hit ? hit.spec.endpoints.filter((e) => e.visibility === 'public').map((e) => e.name) : []
  return { ok: true, published: true, publicEndpoints, ownerKey: row.ownerKey }
}

/**
 * 跨用户解析：namespace ∈ 全局发布索引 → 返回属主的 public 端点声明。
 * 只放行 visibility=public 的端点（owner 端点不跨用户）；调用者必须非游客（R13）。
 */
export async function resolvePublicEndpoint(
  namespace: string,
  endpointName: string,
): Promise<{ packageId: string; ownerKey: string; spec: WebOsApiSpecLike; endpoint: ApiEndpointLike } | null> {
  const row = await getApiPublic(namespace)
  if (!row) return null
  const specs = await loadApiSpecs(row.ownerKey)
  const hit = specs.find((s) => s.spec.namespace === namespace)
  if (!hit) return null // 属主包已不存在/失效 → 视为未发布
  const endpoint =
    hit.spec.endpoints.find((e) => e.name === endpointName && e.visibility === 'public')
    ?? hit.spec.endpoints.find((e) => e.name === camelToSnake(endpointName) && e.visibility === 'public')
  if (!endpoint) return null
  return { packageId: hit.packageId, ownerKey: hit.ownerKey, spec: hit.spec, endpoint }
}

// ---- secrets（值仅存服务端 state.appStorage[<packageId>]['__api_secrets__']） ----

const API_SECRETS_KEY = '__api_secrets__'

function readSecretsBag(state: AppStateLike, packageId: string): Record<string, string> {
  const bag = state.appStorage?.[packageId]?.[API_SECRETS_KEY]
  return bag && typeof bag === 'object' && !Array.isArray(bag)
    ? bag as Record<string, string>
    : {}
}

function getSecretsForSpec(state: AppStateLike, packageId: string, spec: WebOsApiSpecLike): Record<string, string> {
  const all = readSecretsBag(state, packageId)
  const declared = new Set<string>(spec.secrets ?? [])
  const out: Record<string, string> = {}
  for (const name of declared) {
    const v = all[name]
    if (typeof v === 'string' && v) out[name] = v
  }
  return out
}

/** 更新包 secrets（仅接受 api.json 声明的密钥名；值仅存服务端，脱敏返回） */
export async function updateApiSecrets(
  principal: PrincipalLike,
  namespace: string,
  values: Record<string, string>,
): Promise<{ ok: boolean; set: string[]; error?: string }> {
  const d = requireDeps()
  const specs = await loadApiSpecs(principal.key)
  const hit = specs.find((s) => s.spec.namespace === namespace)
  if (!hit) return { ok: false, set: [], error: `找不到已安装的 api 包（namespace=${namespace}）` }
  if (hit.ownerKey !== principal.key) return { ok: false, set: [], error: '仅包所有者可配置 secrets' }
  const declared = new Set<string>(hit.spec.secrets ?? [])
  const state = await d.loadState(principal)
  const bag = readSecretsBag(state, hit.packageId)
  const set: string[] = []
  for (const [name, value] of Object.entries(values ?? {})) {
    if (!declared.has(name)) continue
    if (typeof value !== 'string') continue
    if (value.length > 256) continue
    bag[name] = value
    set.push(name)
  }
  const app = state.appStorage[hit.packageId] ?? (state.appStorage[hit.packageId] = {})
  app[API_SECRETS_KEY] = bag
  await d.saveState(principal, state)
  return { ok: true, set }
}

/** 查询 secrets 状态（只回执「哪些已设置」，永不回传值） */
export async function getApiSecretsStatus(principal: PrincipalLike, namespace: string): Promise<{ ok: boolean; declared: string[]; set: string[]; error?: string }> {
  const d = requireDeps()
  const specs = await loadApiSpecs(principal.key)
  const hit = specs.find((s) => s.spec.namespace === namespace)
  if (!hit) return { ok: false, declared: [], set: [], error: 'namespace 未找到' }
  const state = await d.loadState(principal)
  const bag = readSecretsBag(state, hit.packageId)
  const declared = hit.spec.secrets ?? []
  const set = declared.filter((name) => typeof bag[name] === 'string' && bag[name])
  return { ok: true, declared, set }
}

// ---- storage ctx（权界 + 持久化到 state.appStorage[packageId]） ----

/** 构建 endpoint 的 ctx.storage（读写均受 endpoint.storage 前缀约束） */
export function buildStorage(
  state: AppStateLike,
  packageId: string,
  storageDecl: { read?: string[]; write?: string[] } | undefined,
): ApiHandlerContext['storage'] {
  return makeStorage({
    bag: state.appStorage[packageId] ?? (state.appStorage[packageId] = {}),
    readRules: storageDecl?.read ?? [],
    writeRules: storageDecl?.write ?? [],
    match: matchStoragePrefix,
  })
}

// ---- 调用管线 ----

export type InvokeResult =
  | { ok: true; value: unknown; costMinor: number }
  | { ok: false; error: string; errorCode: string }

export interface InvokeInput {
  namespace: string
  endpoint: string
  params?: Record<string, unknown>
  ip?: string | null
}

export async function invokeEndpoint(principal: PrincipalLike, input: InvokeInput): Promise<InvokeResult> {
  const d = requireDeps()
  const startedAt = Date.now()
  const { namespace, endpoint: endpointName, params, ip } = input

  // ---- 解析目标：① 本人 api 包（owner 路径）→ ② 全局发布索引（public 路径，R13） ----
  const hit = await resolveEndpoint(principal.key, namespace, endpointName)
  let packageId: string
  let ownerKey: string
  let spec: WebOsApiSpecLike
  let endpoint: ApiEndpointLike
  let execPrincipal: PrincipalLike = principal // 执行（数据）侧 principal；public 时为属主
  let isRemote = false // 跨用户（属主执行 + 调用者计费）

  if (hit) {
    packageId = hit.packageId
    ownerKey = hit.ownerKey
    spec = hit.spec
    endpoint = hit.endpoint
  } else {
    // owner 级未命中 → 尝试 public 全局索引（跨用户，R13 非游客）
    if (principal.guest) {
      await recordApiUsage(toUsage(principal, {
        namespace, packageId: '', endpoint: endpointName, method: 'POST',
        paramSummary: safeJson(params), status: 'forbidden', costMinor: 0, durationMs: Date.now() - startedAt, ip: ip ?? null,
        errorCode: 'GUEST_NOT_ALLOWED', errorMessage: '互通体系仅面向注册用户（R13）',
      }))
      return { ok: false, error: '互通体系仅面向注册用户，游客不参与（R13）', errorCode: 'GUEST_NOT_ALLOWED' }
    }
    const pub = await resolvePublicEndpoint(namespace, endpointName)
    if (!pub) {
      await recordApiUsage(toUsage(principal, {
        namespace, packageId: '', endpoint: endpointName, method: 'POST',
        paramSummary: safeJson(params), status: 'not_found', costMinor: 0, durationMs: Date.now() - startedAt, ip: ip ?? null,
        errorCode: 'ENDPOINT_NOT_FOUND', errorMessage: `namespace/endpoint 不存在或未发布 PUBLIC（${namespace}/${endpointName}）`,
      }))
      return { ok: false, error: `API 端点不存在（${namespace}/${endpointName}）或未发布（仅 owner 或公开端点可调）`, errorCode: 'ENDPOINT_NOT_FOUND' }
    }
    packageId = pub.packageId
    ownerKey = pub.ownerKey
    spec = pub.spec
    endpoint = pub.endpoint
    execPrincipal = { key: ownerKey, id: ownerKey.startsWith('user:') ? ownerKey.slice('user:'.length) : ownerKey, guest: false, role: 'member' }
    isRemote = true
  }

  // ---- 执行上下文：owner 路径用本人 state；public 路径用属主 state（数据在属主侧） ----
  const state = await d.loadState(execPrincipal)
  const secrets = getSecretsForSpec(state, packageId, spec)
  const storage = buildStorage(state, packageId, endpoint.storage)
  const domains = spec.network?.domains ?? []
  const ctx: ApiHandlerContext = {
    storage,
    params: params ?? {},
    userKey: execPrincipal.key,
    ...(domains.length > 0 ? { http: makeHttp(domains) } : {}),
    ...(Object.keys(secrets).length > 0 ? { secrets } : {}),
  }

  const code = readHandlerSafe(execPrincipal.key, packageId, endpoint.handler)
  if (code == null) {
    await recordApiUsage(toUsage(principal, {
      namespace, packageId, endpoint: endpointName, method: endpoint.method ?? 'POST',
      paramSummary: safeJson(params), status: 'not_found', costMinor: 0, durationMs: Date.now() - startedAt, ip: ip ?? null,
      errorCode: 'HANDLER_MISSING', errorMessage: `handler 文件不存在：${endpoint.handler}`,
    }))
    return { ok: false, error: `handler 文件不存在：${endpoint.handler}`, errorCode: 'HANDLER_MISSING' }
  }

  const runResult = await executeApiHandler({ code, ctx })
  const durationMs = runResult.durationMs

  // ---- 计费（R15：谁触发谁付费；public 时账单记调用者，数据持久化到属主） ----
  let costMinor = 0
  let status: ApiUsageRecord['status'] = 'failed'
  if (runResult.ok) {
    costMinor = fixedCostMinor('api', 1)
    await d.saveState(execPrincipal, state) // 数据落盘（owner 路径=本人；public=属主）
    if (isRemote) {
      const callerState = await d.loadState(principal)
      const chargedCaller = d.chargeCredits(callerState, costMinor)
      await d.saveState(principal, callerState)
      if (costMinor > 0 && chargedCaller <= 0) status = 'insufficient'
      else status = 'ok'
    } else {
      const charged = d.chargeCredits(state, costMinor)
      if (costMinor > 0 && charged <= 0) status = 'insufficient'
      else status = 'ok'
    }
  } else if (runResult.timedOut) {
    status = 'timeout'
  } else if (runResult.errorCode === 'HANDLER_OUTPUT_TOO_LARGE') {
    status = 'too_large'
  }

  const errorCode = runResult.ok ? undefined : runResult.errorCode
  const errorMessage = runResult.ok ? undefined : redactSecrets(runResult.error, secrets)

  await recordApiUsage(toUsage(principal, {
    namespace, packageId, endpoint: endpointName, method: endpoint.method ?? 'POST',
    paramSummary: safeJson(params), status, costMinor: runResult.ok ? costMinor : 0,
    durationMs, ip: ip ?? null, errorCode: errorCode ?? null, errorMessage: errorMessage ?? null,
  }))

  // 审计（execution.log，同 AI 工具轨迹）：失败信息脱敏；public 调用标注属主与远端
  try {
    logAgentAction(principal.key, `appapi_${namespace}_${endpointName}`, {
      params: summarizeParams(params),
      costMinor: runResult.ok ? costMinor : 0,
      ...(isRemote ? { remoteOwner: ownerKey, remote: true } : {}),
    }, runResult.ok, errorMessage ?? undefined)
  } catch { /* 审计失败不阻断 */ }

  if (!runResult.ok) {
    return { ok: false, error: errorMessage ?? runResult.error, errorCode: runResult.errorCode }
  }
  return { ok: true, value: runResult.value, costMinor }
}

function toUsage(principal: PrincipalLike, rec: Omit<ApiUsageRecord, 'userKey' | 'userEmail'>): ApiUsageRecord {
  return { userKey: principal.key, userEmail: principal.email ?? null, ...rec }
}

function readHandlerSafe(userKey: string, packageId: string, handlerPath: string): string | null {
  const full = resolvePackageFilePath(userKey, packageId, handlerPath)
  if (!full) return null
  try {
    return require('node:fs').readFileSync(full, 'utf-8')
  } catch {
    return null
  }
}

function safeJson(v: unknown): string | null {
  if (v === undefined || v === null) return null
  try {
    return JSON.stringify(v)?.slice(0, 200) ?? null
  } catch {
    return null
  }
}

function summarizeParams(v: unknown): Record<string, unknown> | undefined {
  if (v === undefined || v === null) return undefined
  try {
    const text = JSON.stringify(v)
    return text && text.length > 300 ? { note: `参数过大（${text.length} 字符）` } : (v as Record<string, unknown>)
  } catch {
    return undefined
  }
}

// ---- AI 动态工具注册（pi 会话） ----

/** 把 ep.params（JSON schema）转成 pi 参数 TypeBox schema（受限子集） */
export function paramsToTypeBox(paramsSchema: unknown): ToolDefinition['parameters'] {
  const p = paramsSchema as { type?: string; properties?: Record<string, unknown> } | undefined
  if (!p || p.type !== 'object' || !p.properties) return Type.Object({})
  const props: Record<string, unknown> = {}
  for (const [name, raw] of Object.entries(p.properties)) {
    const v = raw as { type?: string; description?: string; default?: unknown } | undefined
    if (!v || typeof v !== 'object') {
      props[name] = Type.Unknown({ description: '未知类型参数' })
      continue
    }
    const opts: Record<string, unknown> = {}
    if (typeof v.description === 'string') opts.description = v.description
    if ('default' in v) opts.default = v.default
    switch (v.type) {
      case 'string': props[name] = Type.String(opts); break
      case 'integer': props[name] = Type.Integer(opts); break
      case 'number': props[name] = Type.Number(opts); break
      case 'boolean': props[name] = Type.Boolean(opts); break
      case 'array': props[name] = Type.Array(Type.Unknown(), opts); break
      case 'object': props[name] = Type.Object({}, opts); break
      default: props[name] = Type.Unknown(opts)
    }
  }
  // TypeBox Object 需要 TProperties；动态构造的属性值类型在编译期未知 → 收窄断言
  return Type.Object(props as never)
}

const MAX_DYNAMIC_TOOLS = 60

/** 把本人已安装 api 包的所有端点注册为 pi 工具（appapi_<ns>_<ep>），超 60 个裁剪 */
export async function registerDynamicTools(principal: PrincipalLike): Promise<ToolDefinition[]> {
  const specs = await loadApiSpecs(principal.key)
  const tools: ToolDefinition[] = []

  for (const item of specs) {
    const { packageId, spec } = item
    for (const endpoint of spec.endpoints) {
      if (tools.length >= MAX_DYNAMIC_TOOLS) break
      const ns = spec.namespace
      const ep = endpoint.name
      const toolName = `appapi_${ns}_${ep}`
      const descZh = endpoint.description?.zh ?? `${ns} 的 ${ep} 端点`
      tools.push({
        name: toolName,
        label: `调用 ${ns} API：${ep}`,
        description: `调用本人 api 包（${packageId}）的端点「${ep}」：${descZh}。${endpoint.visibility === 'public' ? 'public 可见性（owner 也可调）' : '仅本人可调（owner）'}。数据读写范围：读 ${(endpoint.storage?.read ?? []).join('、') || '无'}；写 ${(endpoint.storage?.write ?? []).join('、') || '无'}。`,
        parameters: paramsToTypeBox(endpoint.params),
        execute: async (_toolCallId: string, params: unknown) => {
          try {
            const r = await invokeEndpoint(principal, {
              namespace: ns,
              endpoint: ep,
              params: (params ?? {}) as Record<string, unknown>,
            })
            if (!r.ok) {
              return {
                content: [{ type: 'text', text: JSON.stringify({ success: false, error: r.errorCode, message: r.error }) }],
                details: {},
                isError: true,
              }
            }
            return {
              content: [{ type: 'text', text: JSON.stringify({ success: true, result: r.value, costMinor: r.costMinor }) }],
              details: {},
            }
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error)
            return {
              content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'API 调用失败', message: msg }) }],
              details: {},
              isError: true,
            }
          }
        },
      })
    }
  }
  return tools.slice(0, MAX_DYNAMIC_TOOLS)
}