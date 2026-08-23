// server/src/webos/market/installed.ts —— 市场安装的统一「已安装包」目录与消费端扫描
// ----------------------------------------------------------------------------
// 2026-08-23 统一包「安装即用」改造：
//   - 安装 = 把发布者的包文件夹**整包复制**到调用者工作区 installed/<packageId>/，
//     保持 manifest.id 不变（独立目录命名空间，不和调用者自己的 packages/ 冲突）；
//   - 消费端（appapi 工具注册 / 桌面 app 列表 / skill 复制 / theme 应用 / 启停开关）
//     统一从这里扫描 + 按 market_installs.enabled 过滤；
//   - 卸载/停用不动 installed/（可随时重新启用），只切换 enabled 与运行时产物。
// ============================================================================

import fs from 'node:fs'
import path from 'node:path'
import { getWorkspaceRoot } from '../../utils/webosWorkspace.js'
import { PACKAGE_MANIFEST } from '../packages/packages-service.js'

/** 已安装包目录名（相对工作区根） */
export const INSTALLED_DIR = 'installed'

export function installedDir(callerKey: string, packageId: string): string {
  return path.join(getWorkspaceRoot(callerKey), INSTALLED_DIR, String(packageId ?? '').replace(/[^\p{L}\p{N}._-]/gu, '_').slice(0, 128))
}

export function readInstalledManifest(callerKey: string, packageId: string): Record<string, unknown> | null {
  try {
    const file = path.join(installedDir(callerKey, packageId), PACKAGE_MANIFEST)
    if (!fs.existsSync(file)) return null
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'))
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : null
  } catch {
    return null
  }
}

export interface InstalledPackage {
  packageId: string
  type: string
  displayName: string
  version: string
  dir: string
  manifest: Record<string, unknown>
}

/**
 * 列出调用者已安装的包（installed/ 目录扫描）：
 * - enabled 过滤：market_installs.enabled=0 的包默认排除（消费端默认只看启用项）；
 * - 目录内必须含合法 daily.pkg.json（manifest.id 与目录名一致），否则跳过。
 */
export async function listInstalledPackages(
  callerKey: string,
  opts: { enabledOnly?: boolean; type?: string; includeDisabled?: boolean } = {},
): Promise<InstalledPackage[]> {
  const { enabledOnly = true } = opts
  // enabled 过滤数据源：lazy import 防循环（market/db ↔ market/installed）
  let enabledMap = new Map<string, boolean>()
  if (enabledOnly) {
    try {
      const { listInstallEnabledMap } = await import('./db.js')
      enabledMap = await listInstallEnabledMap(callerKey)
    } catch { /* db 不可用时不启用过滤（保守全量） */ }
  }
  const root = path.join(getWorkspaceRoot(callerKey), INSTALLED_DIR)
  if (!fs.existsSync(root)) return []
  const out: InstalledPackage[] = []
  let names: string[] = []
  try { names = fs.readdirSync(root) } catch { return [] }
  for (const name of names.sort()) {
    if (name.startsWith('.')) continue
    const dir = path.join(root, name)
    try { if (!fs.statSync(dir).isDirectory()) continue } catch { continue }
    const manifest = readInstalledManifest(callerKey, name)
    if (!manifest || manifest.id !== name) continue
    if (enabledOnly && enabledMap.get(name) === false) continue
    if (opts.type !== undefined && String(manifest.type ?? '') !== opts.type) continue
    out.push({
      packageId: name,
      type: String(manifest.type ?? ''),
      displayName: typeof manifest.displayName === 'string' && manifest.displayName ? manifest.displayName : name,
      version: typeof manifest.version === 'string' ? manifest.version : '0.0.0',
      dir,
      manifest,
    })
  }
  return out
}