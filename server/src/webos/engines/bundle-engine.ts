// server/src/webos/engines/bundle-engine.ts —— W4 type=bundle 组合容器执行引擎
// ----------------------------------------------------------------------------
// 依据：docs/routes/web/03-package-system.md §3（bundle = 纯组合容器：contents +
//       children（无 entry）；安装时解析子包闭包聚合）+ D19（嵌套 ≤3 层硬约束）。
// 职责：
//   - resolveBundleClosure：BFS 解析 bundle 的 children（嵌套 ≤3 层）+ 自身
//     contents（skills/tools/tokens/assets）聚合为闭包清单（去环、去重、失败
//     单项返回 issues 不抛阻断）；
//   - isBundleDepthValid：深度校验（≤3；children 引用 resolver 由调用方传入，
//     本模块保持纯函数、可单测）。
// 与 market.resolveDependencyClosure 的关系：市场闭包用于「全市场安装登记」，
// 本引擎专注于 bundle 包自身 contents/children 聚合（W4 最小可用），且可在
// 无 DB / 无市场时被 packages 生命周期直接调用。
// ============================================================================

import fs from 'node:fs'
import path from 'node:path'

/** bundle 嵌套深度硬约束（与 shared-contracts PACKAGE_CHILDREN_MAX_DEPTH 同源） */
export const BUNDLE_MAX_DEPTH = 3

export type BundleContentKind = 'skills' | 'tools' | 'tokens' | 'assets'

export interface BundleClosureItem {
  packageId: string
  /** 嵌套层数（顶层 bundle = 0；children 逐层 +1） */
  depth: number
  /** 该包 contents 聚合（skills/tools/tokens/assets；tokens 为对象，其余为路径数组） */
  contents: {
    skills: string[]
    tools: string[]
    tokens: Record<string, string>
    assets: string[]
  }
}

export interface BundleClosureResult {
  ok: boolean
  /** 闭包内全部包（含顶层 bundle），BFS 顺序 */
  items: BundleClosureItem[]
  /** 失败的 children（未解析到 manifest / 深度超限 / 环） */
  issues: string[]
  /** 聚合后的总 contents（顶层 bundle 语义：全部子包能力一次性装载） */
  aggregate: BundleClosureItem['contents']
}

/** 读取包目录 daily.pkg.json（不存在/非法返回 null；供闭包解析默认实现） */
export function readBundleManifest(pkgDir: string): Record<string, unknown> | null {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(pkgDir, 'daily.pkg.json'), 'utf-8')) as unknown
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>
    return null
  } catch {
    return null
  }
}

/** 包 contents 归一化（skills/tools/assets 是路径数组；tokens 是对象） */
export function bundleContentsOf(manifest: Record<string, unknown>): BundleClosureItem['contents'] {
  const contents = manifest.contents
  const empty = { skills: [] as string[], tools: [] as string[], tokens: {} as Record<string, string>, assets: [] as string[] }
  if (!contents || typeof contents !== 'object' || Array.isArray(contents)) return empty
  const c = contents as Record<string, unknown>
  const asStrings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x) : [])
  const tokens: Record<string, string> = {}
  if (c.tokens && typeof c.tokens === 'object' && !Array.isArray(c.tokens)) {
    for (const [k, v] of Object.entries(c.tokens as Record<string, unknown>)) {
      if (typeof v === 'string' || typeof v === 'number') tokens[k] = String(v)
    }
  }
  return { skills: asStrings(c.skills), tools: asStrings(c.tools), tokens, assets: asStrings(c.assets) }
}

/** children 列表（manifest.children 字符串数组；非法项剔除） */
export function bundleChildrenOf(manifest: Record<string, unknown>): string[] {
  const children = manifest.children
  return Array.isArray(children) ? children.filter((c): c is string => typeof c === 'string' && !!c) : []
}

/** 深度校验：children 链嵌套 ≤3 层（root=1 层，children 一层 → 2 …；>3 拒绝） */
export function isBundleDepthValid(children: readonly string[], depthSoFar = 1): boolean {
  if (!Array.isArray(children)) return true
  if (depthSoFar >= BUNDLE_MAX_DEPTH) return false
  return true
}

export interface BundleResolver {
  /** 给定包 id → 包目录（不含读取逻辑，由调用方提供；测试可注入 map） */
  pkgDirOf: (packageId: string) => string | null
  /** 给定包 id → manifest（默认读 pkgDir/daily.pkg.json） */
  manifestOf?: (packageId: string) => Record<string, unknown> | null
}

/**
 * BFS 解析 bundle 组合闭包：
 *   - 顶层 bundle 自身 contents 聚合；
 *   - children 逐层 BFS（嵌套 ≤3 层，超限记 issue 不阻断）；
 *   - 环/重复跳过（visited）；
 *   - 失败（manifest 缺失）记为 issue，聚合时忽略该子包。
 * 返回 { items（BFS 顺序）, aggregate（全部 contents 归一化聚合）, issues }。
 */
export function resolveBundleClosure(rootPackageId: string, resolver: BundleResolver, rootManifestOverride?: Record<string, unknown>): BundleClosureResult {
  const items: BundleClosureItem[] = []
  const issues: string[] = []
  const visited = new Set<string>()
  const queue: Array<{ packageId: string; depth: number }> = [{ packageId: rootPackageId, depth: 0 }]
  const manifestOf = resolver.manifestOf ?? ((packageId: string) => {
    const dir = resolver.pkgDirOf(packageId)
    return dir ? readBundleManifest(dir) : null
  })

  while (queue.length > 0) {
    const cur = queue.shift()!
    if (visited.has(cur.packageId)) continue
    visited.add(cur.packageId)

    const manifest = cur.packageId === rootPackageId && rootManifestOverride
      ? rootManifestOverride
      : manifestOf(cur.packageId)
    if (!manifest) {
      issues.push(`子包「${cur.packageId}」找不到 manifest（daily.pkg.json 缺失或非法），闭包聚合跳过`)
      continue
    }

    const contents = bundleContentsOf(manifest)
    items.push({ packageId: cur.packageId, depth: cur.depth, contents })

    // children 深度守卫：depth >= 3 时不允许再挂 children
    const children = bundleChildrenOf(manifest)
    if (children.length > 0) {
      if (cur.depth >= BUNDLE_MAX_DEPTH - 1) {
        issues.push(`子包「${cur.packageId}」嵌套深度超过 ${BUNDLE_MAX_DEPTH} 层（D19 硬约束），其 children 忽略`)
        continue
      }
      for (const child of children) {
        if (!visited.has(child)) queue.push({ packageId: child, depth: cur.depth + 1 })
      }
    }
  }

  // 聚合全部 contents（顶层 bundle 语义：闭包 = 全部能力一次装载）
  const aggregate: BundleClosureItem['contents'] = { skills: [], tools: [], tokens: {}, assets: [] }
  for (const item of items) {
    for (const k of ['skills', 'tools', 'assets'] as const) {
      for (const p of item.contents[k]) {
        if (!aggregate[k].includes(p)) aggregate[k].push(p)
      }
    }
    Object.assign(aggregate.tokens, item.contents.tokens)
  }

  return { ok: issues.length === 0, items, issues, aggregate }
}

/** 统一入口（供 packages 生命周期挂接） */
export const bundleEngine = {
  resolveClosure: resolveBundleClosure,
  isValidDepth: isBundleDepthValid,
  contentsOf: bundleContentsOf,
  childrenOf: bundleChildrenOf,
  readManifest: readBundleManifest,
}