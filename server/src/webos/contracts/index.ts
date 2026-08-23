// server/src/webos/contracts/index.ts —— 包体系契约校验器（web 路线）
// ----------------------------------------------------------------------------
// 职责：对 daily.pkg.json / api.json 做「schema 结构 + 语义」两层校验，返回
// 适合回流的「人话错误」列表（W1 校验反馈回路的核心）。
// schema 单一事实源在 shared/webos-contracts/packages/（TS），本模块通过
// JSON schema 快照消费同一契约，避免 server（rootDir=./src）与 shared 的
// 目录耦合；快照由 server/scripts/gen-contract-schemas.mjs 生成并提交 Git。
// 语义校验（能力词汇表 / 域名 / children 深度 / 危险声明）：规则常量与
// shared/capabilities.ts 同源；如需修改词汇表，先改 shared 再生成快照。
// ============================================================================

import { Check, Errors } from 'typebox/value'
import packageSchema from '../../../../shared/webos-contracts/packages/daily-pkg.schema.json' with { type: 'json' }
import apiSchema from '../../../../shared/webos-contracts/packages/api.schema.json' with { type: 'json' }
import {
  PACKAGE_CHILDREN_MAX_DEPTH,
  WEBOS_CAPABILITY_IDS,
  isWebOsCapability,
  isWebOsCapabilityAvailable,
  WEBOS_CAPABILITIES,
} from './shared-contracts.js'

export interface ContractIssue {
  /** 出错字段路径，如 'capabilities[1]' / 'network.domains' */
  path: string
  /** 人话错误信息（直接回流给 AI/用户） */
  message: string
  /** 级别：blocking（默认阻断）| warning（警告）| info（进行中） */
  level?: 'blocking' | 'warning' | 'info'
}

export interface ContractResult {
  ok: boolean
  issues: ContractIssue[]
  warnings?: ContractIssue[]
  normalized?: Record<string, unknown>
}

function asIssues(
  ok: boolean,
  issues: ContractIssue[],
  normalized?: Record<string, unknown>,
  warnings?: ContractIssue[],
): ContractResult {
  return { ok, issues, warnings: warnings && warnings.length > 0 ? warnings : undefined, normalized }
}

const PACKAGE_KNOWN_KEYS = new Set([
  'schema_version',
  'id',
  'type',
  'version',
  'entry',
  'display_name',
  'description',
  'icon',
  'capabilities',
  'network',
  'dependencies',
  'pets',
  'api',
  'url',
  'contents',
  'children',
  'minShell',
])

const API_KNOWN_KEYS = new Set([
  'schema_version',
  'namespace',
  'display_name',
  'description',
  'network',
  'secrets',
  'endpoints',
])

const API_ENDPOINT_KNOWN_KEYS = new Set([
  'name',
  'method',
  'path',
  'description',
  'params',
  'storage',
  'handler',
  'returns',
  'visibility',
])

function normalizeKeyName(key: string): string {
  return key.toLowerCase().replace(/[_-]/g, '')
}

function checkUnknownAndSpellingKeys(
  obj: Record<string, unknown>,
  knownKeys: Set<string>,
  basePath = '',
): { blocking: ContractIssue[]; warnings: ContractIssue[] } {
  const blocking: ContractIssue[] = []
  const warnings: ContractIssue[] = []
  const normalizedKnownMap = new Map<string, string>()
  for (const k of knownKeys) {
    normalizedKnownMap.set(normalizeKeyName(k), k)
  }

  for (const key of Object.keys(obj)) {
    if (knownKeys.has(key)) continue
    const p = basePath ? `${basePath}.${key}` : key
    const norm = normalizeKeyName(key)
    const matchedKnown = normalizedKnownMap.get(norm)
    if (matchedKnown) {
      blocking.push({
        path: p,
        message: `字段疑似拼写错误：想写 ${matchedKnown}？`,
        level: 'blocking',
      })
    } else {
      warnings.push({
        path: p,
        message: `未知字段「${key}」：已按元数据保留，无功能影响`,
        level: 'warning',
      })
    }
  }
  return { blocking, warnings }
}

/**
 * 容错自愈规范化：对 AI / 外部开发者传入的宽松 Manifest 进行智能修复与格式规整
 * 1. 纯文本 display_name / description 自动转为多语言对象 { zh: ... }
 * 2. 自动补全缺省的 schema_version: 2、version: '1.0.0'
 * 3. 依赖项字典结构 { "com.x": "^1.0" } 自动转为数组 [{ id: "com.x", range: "^1.0" }]
 * 4. 忽略/剔除 $schema 等额外非标字段
 */
export function normalizePackageManifest(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return {}
  }
  const m: Record<string, unknown> = { ...(raw as Record<string, unknown>) }

  // 1. schema_version 缺省自愈
  if (m.schema_version === undefined) {
    m.schema_version = 2
  }

  // 2. version 缺省自愈
  if (typeof m.version !== 'string' || !m.version.trim()) {
    m.version = '1.0.0'
  }

  // 3. display_name 宽松兼容（字符串 → { zh: str }）
  if (typeof m.display_name === 'string') {
    const text = m.display_name.trim() || '未命名应用'
    m.display_name = { zh: text }
  } else if (m.display_name && typeof m.display_name === 'object' && !Array.isArray(m.display_name)) {
    const dn = m.display_name as Record<string, unknown>
    if (!dn.zh && !dn.en) {
      dn.zh = '未命名应用'
    }
  }

  // 4. description 宽松兼容（字符串 → { zh: str }）
  if (typeof m.description === 'string') {
    const text = m.description.trim()
    m.description = text ? { zh: text } : undefined
  }

  // 5. dependencies 宽松兼容（对象字典 → 数组）
  if (m.dependencies && typeof m.dependencies === 'object' && !Array.isArray(m.dependencies)) {
    const depsArr: Array<{ id: string; range?: string }> = []
    for (const [depId, rangeVal] of Object.entries(m.dependencies as Record<string, unknown>)) {
      if (typeof depId === 'string' && depId.trim()) {
        depsArr.push({ id: depId.trim(), range: typeof rangeVal === 'string' ? rangeVal : undefined })
      }
    }
    m.dependencies = depsArr
  }

  // 6. api 包如果未声明 api.spec，自动补充默认 api.json
  if (m.type === 'api' && (!m.api || typeof m.api !== 'object')) {
    m.api = { spec: 'api.json' }
  }

  // 7. 剔除 $schema 避免 schema strict 校验失败
  delete m.$schema

  return m
}

/**
 * 容错自愈规范化：对 AI / 外部开发者传入的宽松 api.json 进行智能修复与格式规整
 * 1. 顶层及 endpoints[].description 的 display_name/description 纯字符串 → { zh: str }
 * 2. method 小写 → 大写（'get' → 'GET'）
 * 3. storage.read/write 单字符串 → 单元素数组（"read": "notes/*" → ["notes/*"]）
 * 4. 缺 schema_version → 补 1
 * 5. 剔除 $schema
 * 6. endpoints[].handler 前导 ./ 剥离（仅当剩余路径仍合法）
 */
export function normalizeApiSpec(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return {}
  }
  const spec: Record<string, unknown> = { ...(raw as Record<string, unknown>) }

  // 1. schema_version 缺省自愈
  if (spec.schema_version === undefined) {
    spec.schema_version = 1
  }

  // 2. display_name 宽松兼容（字符串 → { zh: str }）
  if (typeof spec.display_name === 'string') {
    const text = spec.display_name.trim() || '未命名服务'
    spec.display_name = { zh: text }
  } else if (spec.display_name && typeof spec.display_name === 'object' && !Array.isArray(spec.display_name)) {
    const dn = spec.display_name as Record<string, unknown>
    if (!dn.zh && !dn.en) {
      dn.zh = '未命名服务'
    }
  }

  // 3. description 宽松兼容（字符串 → { zh: str }）
  if (typeof spec.description === 'string') {
    const text = spec.description.trim()
    spec.description = text ? { zh: text } : undefined
  }

  // 4. endpoints 规整
  if (Array.isArray(spec.endpoints)) {
    spec.endpoints = spec.endpoints.map((epRaw) => {
      if (typeof epRaw !== 'object' || epRaw === null || Array.isArray(epRaw)) {
        return epRaw
      }
      const ep: Record<string, unknown> = { ...(epRaw as Record<string, unknown>) }

      // method 小写转大写
      if (typeof ep.method === 'string') {
        ep.method = ep.method.toUpperCase()
      }

      // ep.description 字符串 → { zh: str }
      if (typeof ep.description === 'string') {
        const text = ep.description.trim()
        ep.description = text ? { zh: text } : undefined
      }

      // storage.read / storage.write 单字符串 → 数组
      if (ep.storage && typeof ep.storage === 'object' && !Array.isArray(ep.storage)) {
        const st: Record<string, unknown> = { ...(ep.storage as Record<string, unknown>) }
        if (typeof st.read === 'string' && st.read.trim()) {
          st.read = [st.read.trim()]
        }
        if (typeof st.write === 'string' && st.write.trim()) {
          st.write = [st.write.trim()]
        }
        ep.storage = st
      }

      // handler 前导 ./ 剥离
      if (typeof ep.handler === 'string') {
        const stripped = ep.handler.replace(/^\.\//, '')
        if (stripped && !stripped.startsWith('.')) {
          ep.handler = stripped
        }
      }

      return ep
    })
  }

  // 5. 剔除 $schema
  delete spec.$schema

  return spec
}

// 复用 capabilities 的词汇表静态数据：为避免在 server/src 直接 import shared 的 .ts
// （rootDir 限制），这里从独立 shim 导入（见 shared-contracts.ts）
export { WEBOS_CAPABILITY_IDS, WEBOS_CAPABILITIES }

// ============================================================================
// 基础校验器
// ============================================================================

/** 语义校验一组能力词（capabilities）：非法词/不可用词 → issue */
function checkCapabilities(caps: readonly unknown[], basePath: string): ContractIssue[] {
  const issues: ContractIssue[] = []
  if (Array.isArray(caps)) {
    caps.forEach((cap, i) => {
      if (typeof cap !== 'string') {
        issues.push({ path: `${basePath}[${i}]`, message: `能力词必须是字符串（当前是 ${typeof cap}）` })
        return
      }
      if (!isWebOsCapability(cap)) {
        issues.push({ path: `${basePath}[${i}]`, message: `能力词「${cap}」不在词汇表内。可用词见 docs/routes/web/03-package-system.md §6，或 capabilities.ts` })
      } else if (!isWebOsCapabilityAvailable(cap)) {
        const def = WEBOS_CAPABILITIES.find((c) => c.id === cap)
        issues.push({ path: `${basePath}[${i}]`, message: `能力词「${cap}」当前不可用${def?.phase ? `（${def.phase} 阶段）` : ''}，只能声明为不可用并返回 unavailable` })
      }
    })
  }
  return issues
}

/** 语义校验网络域名（network.domains）：格式合法 + 禁内网段 + 禁协议前缀 */
function checkDomains(domains: readonly unknown[], basePath: string): ContractIssue[] {
  const issues: ContractIssue[] = []
  const domainPattern = /^(\*\.)?[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+$/
  const blockedIp = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.)/ 
  const blockedHosts = new Set(['localhost', 'localhost.localdomain'])
  if (Array.isArray(domains)) {
    domains.forEach((d, i) => {
      if (typeof d !== 'string') {
        issues.push({ path: `${basePath}[${i}]`, message: `域名必须是字符串（当前是 ${typeof d}）` })
        return
      }
      if (d.startsWith('http://') || d.startsWith('https://')) {
        issues.push({ path: `${basePath}[${i}]`, message: `域名「${d}」不能带协议前缀，只写主机名（如 api.example.com）` })
        return
      }
      if (!domainPattern.test(d)) {
        issues.push({ path: `${basePath}[${i}]`, message: `域名「${d}」格式不合法：只允许字母/数字/连字符与点（可 * 前缀通配子域）` })
        return
      }
      const host = d.replace(/^\*\./, '')
      if (blockedHosts.has(host) || blockedIp.test(d)) {
        issues.push({ path: `${basePath}[${i}]`, message: `域名「${d}」指向本机/内网，禁止出站（SSRF 防护）` })
      }
    })
  }
  return issues
}

/** 语义校验 children：引用已注册 id + 深度 ≤3 + 无重复（包间校验在 W1 注册层做） */
function checkChildren(children: readonly unknown[], basePath: string): ContractIssue[] {
  const issues: ContractIssue[] = []
  if (Array.isArray(children)) {
    const seen = new Set<string>()
    children.forEach((c, i) => {
      if (typeof c !== 'string' || c.length === 0) {
        issues.push({ path: `${basePath}[${i}]`, message: `子包 id 必须是非空字符串` })
      } else {
        if (seen.has(c)) issues.push({ path: `${basePath}[${i}]`, message: `子包「${c}」重复引用` })
        seen.add(c)
      }
    })
    // 深度 ≤3（含本层）：bundle/organic children 实际深度在注册时用
    // PACKAGE_CHILDREN_MAX_DEPTH 做递归校验（见 helper below）
  }
  return issues
}

/**
 * 从 children 链递归校验嵌套深度。children 里的每个 id 视为子包一层。
 * @param depthSoFar 当前包所在层（顶层=1）
 */
function checkChildrenDepth(children: readonly unknown[] | undefined, depthSoFar: number, basePath: string): ContractIssue[] {
  const issues: ContractIssue[] = []
  if (!Array.isArray(children)) return issues
  if (depthSoFar >= PACKAGE_CHILDREN_MAX_DEPTH) {
    issues.push({ path: basePath, message: `包嵌套超过 ${PACKAGE_CHILDREN_MAX_DEPTH} 层（D19 硬约束）：当前层 ${depthSoFar}，children 会使深度溢出` })
    return issues
  }
  return issues
}

// ============================================================================
// 主入口：validatePackageManifest / validateApiSpec
// ============================================================================

/**
 * 校验 daily.pkg.json（schema 结构 + 语义）。返回 ok + issues（人话）+ normalized（规范化后的对象）。
 * 供 W1 packages.ts 注册流水线、App 生成校验回路、以及用户/AI 预览用。
 * @param raw 已解析的 JSON 对象（未知类型）
 * @param depth 当前嵌套层（顶层=1；递归 children 校验用）
 */
export function validatePackageManifest(raw: unknown, depth = 1): ContractResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return asIssues(false, [{ path: '', message: 'daily.pkg.json 必须是 JSON 对象', level: 'blocking' }])
  }
  // 先执行容错规范化自愈（字符串文本转多语言、补全默认版本等）
  const manifest = normalizePackageManifest(raw)

  const issues: ContractIssue[] = []
  const warnings: ContractIssue[] = []

  // 1) 顶层未知字段与拼写守护
  const { blocking: spellingIssues, warnings: unknownWarnings } = checkUnknownAndSpellingKeys(
    manifest,
    PACKAGE_KNOWN_KEYS,
  )
  issues.push(...spellingIssues)
  warnings.push(...unknownWarnings)

  // 2) 语义校验（先做：不依赖 schema——即使结构有小瑕疵也要报出语义问题，回流更友好）
  const caps = manifest['capabilities']
  if (caps !== undefined) issues.push(...checkCapabilities(caps as readonly unknown[], 'capabilities'))
  const net = manifest['network']
  if (net !== null && typeof net === 'object' && !Array.isArray(net)) {
    const domains = (net as Record<string, unknown>)['domains']
    if (domains !== undefined) issues.push(...checkDomains(domains as readonly unknown[], 'network.domains'))
  }
  const children = manifest['children']
  if (children !== undefined) {
    issues.push(...checkChildren(children as readonly unknown[], 'children'))
    issues.push(...checkChildrenDepth(children as readonly unknown[] | undefined, depth, 'children'))
  }

  // 3) schema 结构校验（typebox Check，从 shared JSON 快照）
  const schemaOk = Check(packageSchema, manifest)
  if (!schemaOk) {
    const schemaIssues: ContractIssue[] = []
    if (manifest['schema_version'] !== 2) schemaIssues.push({ path: 'schema_version', message: 'schema_version 必须为 2（当前组合式包版本）', level: 'blocking' })
    if (typeof manifest['id'] !== 'string' || manifest['id'].length === 0) schemaIssues.push({ path: 'id', message: '缺少包 id（全局唯一，如 com.daily.notes）', level: 'blocking' })
    else if (!/^[\p{L}\p{N}._ -]{1,128}$/u.test(manifest['id'] as string)) schemaIssues.push({ path: 'id', message: `包 id「${manifest['id'] as string}」含非法字符：只允许 Unicode 字母/数字/._- 与空格，禁止路径分隔符与 ..`, level: 'blocking' })
    if (typeof manifest['type'] !== 'string') schemaIssues.push({ path: 'type', message: '缺少包类型', level: 'blocking' })
    else {
      const validTypes = ['app', 'pet-layer', 'api', 'skill', 'theme', 'toolpkg', 'mcp', 'workflow', 'model-pack', 'url-app', 'provider', 'subagent', 'bundle']
      if (!validTypes.includes(manifest['type'] as string)) schemaIssues.push({ path: 'type', message: `包类型「${manifest['type'] as string}」不在支持列表（${validTypes.join('/')}）`, level: 'blocking' })
    }
    if (typeof manifest['version'] !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest['version'] as string)) {
      schemaIssues.push({ path: 'version', message: `版本号「${String(manifest['version'] ?? '')}」不是合法 semver（如 1.2.0 或 1.2.0-beta.1）`, level: 'blocking' })
    }
    // 提取 TypeBox 具体的属性错误人话提示
    if (schemaIssues.length === 0) {
      for (const err of Errors(packageSchema, manifest)) {
        const rawPath = typeof err.instancePath === 'string' ? err.instancePath : ''
        const p = rawPath.replace(/^\//, '').replace(/\//g, '.') || 'manifest'
        schemaIssues.push({ path: p, message: `字段 ${p} 格式不符：${err.message}`, level: 'blocking' })
      }
    }
    if (schemaIssues.length === 0) {
      schemaIssues.push({ path: 'schema', message: 'manifest 结构不完整，请确认必需字段 id / type / version 是否准确', level: 'blocking' })
    }
    // 合并：结构错误优先（schemaIssues），语义错误随后（去重 path）
    const seen = new Set<string>()
    for (const issue of [...schemaIssues, ...issues]) {
      const key = issue.path + '|' + issue.message
      if (!seen.has(key)) {
        seen.add(key)
        if (!issue.level) issue.level = 'blocking'
      }
    }
    const blockingIssues = [...schemaIssues, ...issues].filter((i) => (i.level ?? 'blocking') === 'blocking')
    return asIssues(false, blockingIssues, manifest, warnings)
  }

  const blockingIssues = issues.filter((i) => (i.level ?? 'blocking') === 'blocking')
  return asIssues(blockingIssues.length === 0, blockingIssues, manifest, warnings)
}

/**
 * 校验 api.json（schema 结构 + 语义）。供 W2 appApi.ts 加载时校验、生成回路反馈。
 */
export function validateApiSpec(raw: unknown): ContractResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return asIssues(false, [{ path: '', message: 'api.json 必须是 JSON 对象', level: 'blocking' }])
  }
  // 先执行容错规范化自愈（字符串文本转多语言、补全默认版本等）
  const spec = normalizeApiSpec(raw)

  const issues: ContractIssue[] = []
  const warnings: ContractIssue[] = []

  // 1) 顶层未知字段与拼写守护
  const { blocking: topSpelling, warnings: topWarnings } = checkUnknownAndSpellingKeys(spec, API_KNOWN_KEYS)
  issues.push(...topSpelling)
  warnings.push(...topWarnings)

  const endpoints = spec['endpoints']
  if (!Array.isArray(endpoints) || endpoints.length === 0) {
    issues.push({ path: 'endpoints', message: 'api.json 必须至少声明一个端点（endpoints 非空数组）', level: 'blocking' })
  } else {
    // 端点名唯一性 + handler 路径防穿越 + 端点方法合法 + endpoints[i] 未知字段与拼写守护
    const seen = new Set<string>()
    endpoints.forEach((epRaw, i) => {
      if (typeof epRaw !== 'object' || epRaw === null) return
      const ep = epRaw as Record<string, unknown>
      const { blocking: epSpelling, warnings: epWarnings } = checkUnknownAndSpellingKeys(
        ep,
        API_ENDPOINT_KNOWN_KEYS,
        `endpoints[${i}]`,
      )
      issues.push(...epSpelling)
      warnings.push(...epWarnings)

      const name = ep['name']
      if (typeof name === 'string') {
        if (seen.has(name)) issues.push({ path: `endpoints[${i}].name`, message: `端点名「${name}」重复`, level: 'blocking' })
        seen.add(name)
        if (!/^[a-z][a-z0-9_]*$/.test(name)) issues.push({ path: `endpoints[${i}].name`, message: `端点名「${name}」必须是小写字母开头的小写下划线命名（如 list_notes）`, level: 'blocking' })
      }
      const handler = ep['handler']
      if (typeof handler === 'string') {
        if (!/^[a-zA-Z0-9_./-]+\.js$/.test(handler) || handler.includes('..')) {
          issues.push({ path: `endpoints[${i}].handler`, message: `handler 路径「${handler}」不合法：必须是相对路径的 .js 文件（禁止 .. 越界）`, level: 'blocking' })
        }
      }
      const method = ep['method']
      if (method !== undefined && method !== 'GET' && method !== 'POST') {
        issues.push({ path: `endpoints[${i}].method`, message: `method「${String(method)}」不支持（仅 GET/POST；GET=只读，POST=有副作用）`, level: 'blocking' })
      }
      const path = ep['path']
      if (typeof path === 'string' && !path.startsWith('/')) {
        issues.push({ path: `endpoints[${i}].path`, message: `path「${path}」必须以 / 开头`, level: 'blocking' })
      }
      const visibility = ep['visibility']
      if (visibility !== undefined && visibility !== 'owner' && visibility !== 'public') {
        issues.push({ path: `endpoints[${i}].visibility`, message: `visibility「${String(visibility)}」不受支持（owner/public）`, level: 'blocking' })
      }
      // storage 前缀语义：读/写列表非空
      const storage = ep['storage']
      if (storage !== null && typeof storage === 'object' && !Array.isArray(storage)) {
        const read = (storage as Record<string, unknown>)['read']
        const write = (storage as Record<string, unknown>)['write']
        for (const [k, arr] of [['read', read], ['write', write]] as const) {
          if (arr !== undefined && (!Array.isArray(arr) || arr.length === 0)) {
            issues.push({ path: `endpoints[${i}].storage.${k}`, message: `storage.${k} 必须是非空数组（如 ["notes/*"]）`, level: 'blocking' })
          }
        }
      }
    })
  }

  const schemaOk = Check(apiSchema, spec)
  // schema 结构本身失败但已通过语义补充时，给兜底提示
  if (!schemaOk && issues.length === 0) {
    if (spec['schema_version'] !== 1) issues.push({ path: 'schema_version', message: 'schema_version 必须为 1', level: 'blocking' })
    if (typeof spec['namespace'] !== 'string' || spec['namespace'].length === 0) issues.push({ path: 'namespace', message: '缺少 namespace（全局唯一，如 notes）', level: 'blocking' })
    else if (!/^[a-z][a-z0-9_.-]*$/.test(spec['namespace'] as string)) issues.push({ path: 'namespace', message: `namespace「${String(spec['namespace'])}」只允许小写字母/数字/点/连字符/下划线（以小写字母开头）`, level: 'blocking' })
  }

  const blockingIssues = issues.filter((i) => (i.level ?? 'blocking') === 'blocking')
  return asIssues(blockingIssues.length === 0, blockingIssues, spec, warnings)
}

/** 校验未知 JSON 是否为合法 package manifest 或 api spec（自动识别顶层字段） */
export function validateUnknownContract(raw: unknown): { kind: 'package' | 'api' | null; result: ContractResult } {
  if (typeof raw !== 'object' || raw === null) return { kind: null, result: asIssues(false, [{ path: '', message: '不是合法 JSON 对象' }]) }
  const obj = raw as Record<string, unknown>
  if (obj['schema_version'] === 2 && obj['type'] !== undefined) {
    return { kind: 'package', result: validatePackageManifest(raw) }
  }
  if (obj['schema_version'] === 1 && obj['endpoints'] !== undefined) {
    return { kind: 'api', result: validateApiSpec(raw) }
  }
  return { kind: null, result: asIssues(false, [{ path: '', message: '无法识别契约类型：schema_version=2+type → daily.pkg.json；schema_version=1+endpoints → api.json' }]) }
}