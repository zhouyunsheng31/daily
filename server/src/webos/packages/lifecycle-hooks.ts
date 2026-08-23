// server/src/webos/packages/lifecycle-hooks.ts —— W4 引擎挂接（包生命周期钩子）
// ----------------------------------------------------------------------------
// 依据：docs/routes/web/03-package-system.md §3 执行引擎表 + §4 生命周期流水线。
// 目标：把 W4 四个引擎（skill/theme/bundle/pet-layer）接入 packages 生命周期——
//   安装（installPackageEngines）：
//     - skill：origin 包文件夹 → 调用者工作区 skills/<id>/（复制 SKILL.md 等）；
//     - theme：读取 contents.tokens 生成 CSS 变量，存入调用者工作区
//       system/themes/<id>/tokens.json + theme.css（缺 key 回退默认，不抛阻断）；
//     - bundle：BFS 解析 children（嵌套 ≤3）+ contents 聚合，生成
//       system/bundles/<id>/closure.json + aggregate.json；
//     - pet-layer：读取 entry HTML + 行为参数，生成 system/pet-layers/<id>/scene.json；
//   卸载（uninstallPackageEngines）：清理对应调用者侧产物（幂等）。
// 设计：安装物全部落在调用者工作区 system/ 子目录（引擎侧产物），卸载 = 删除
// 该目录；不触碰包属主文件夹与 DB 记录（DB 生命周期仍由 registerOrUpdate 管）。
// ============================================================================

import fs from 'node:fs'
import path from 'node:path'
import { getWorkspaceRoot } from '../../utils/webosWorkspace.js'
import { skillEngine } from '../engines/skill-engine.js'
import { themeEngine } from '../engines/theme-engine.js'
import { bundleEngine, type BundleResolver } from '../engines/bundle-engine.js'
import { petLayerEngine } from '../engines/pet-layer-engine.js'

export interface EngineInstallResult {
  ok: boolean
  note: string
}

export interface PackageLifecycleHooks {
  /** 安装引擎产物（返回值追加到安装反馈） */
  onPackageInstalled: (input: { callerKey: string; packageId: string; type: string; pkgDir: string; manifest: Record<string, unknown> }) => Promise<EngineInstallResult[]>
  /** 卸载引擎产物（回收站/卸载清理） */
  onPackageUninstalled: (input: { callerKey: string; packageId: string; type: string }) => Promise<EngineInstallResult[]>
}

/** 引擎产物根目录：workpace/system/engines/<type>/<id>/（与 app 版本库隔离） */
function engineArtifactDir(callerKey: string, type: string, packageId: string): string {
  const safeType = String(type ?? '').replace(/[^\w-]/g, '_')
  const safeId = String(packageId ?? '').replace(/[^\p{L}\p{N}._-]/gu, '_').slice(0, 128)
  return path.join(getWorkspaceRoot(callerKey), 'system', 'engines', safeType, safeId)
}

function writeJsonArtifact(dir: string, name: string, data: unknown): void {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, name), JSON.stringify(data, null, 2), 'utf-8')
}

/** W4 引擎安装钩子（最小可用：各引擎产物落到调用者工作区 system/engines/<type>/<id>/） */
export async function onPackageInstalled(input: { callerKey: string; packageId: string; type: string; pkgDir: string; manifest: Record<string, unknown> }): Promise<EngineInstallResult[]> {
  const { callerKey, packageId, type, pkgDir, manifest } = input
  const results: EngineInstallResult[] = []
  if (!fs.existsSync(pkgDir) || !fs.statSync(pkgDir).isDirectory()) {
    return [{ ok: false, note: `包目录不存在（${pkgDir}），引擎未运行` }]
  }

  switch (type) {
    case 'skill': {
      const r = skillEngine.install({ ownerKey: callerKey, callerKey, packageId, pkgDir, manifest })
      results.push({ ok: r.ok, note: r.note })
      break
    }
    case 'theme': {
      const r = themeEngine.apply(manifest)
      const dir = engineArtifactDir(callerKey, 'theme', packageId)
      writeJsonArtifact(dir, 'tokens.json', r.tokens)
      writeJsonArtifact(dir, 'manifest.json', manifest)
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, 'theme.css'), r.cssVars, 'utf-8')
      const fallbackNote = r.missing.length > 0 ? '（缺 ' + r.missing.join(', ') + '，已回退默认值）' : ''
      results.push({ ok: true, note: '✅ 主题已应用：' + Object.keys(r.tokens).length + ' 个 CSS 变量 → system/engines/theme/' + packageId + '/' + fallbackNote })
      break
    }
    case 'bundle': {
      const getPkgDir = (childId: string): string | null => {
        // 子包目录 = 同 owner 工作区 packages/<childId>/（与当前包同源）
        const dir = path.join(getWorkspaceRoot(callerKey), 'packages', childId)
        return fs.existsSync(dir) ? dir : null
      }
      const resolver: BundleResolver = { pkgDirOf: getPkgDir }
      const closure = bundleEngine.resolveClosure(packageId, resolver, manifest)
      const dir = engineArtifactDir(callerKey, 'bundle', packageId)
      writeJsonArtifact(dir, 'closure.json', closure)
      writeJsonArtifact(dir, 'aggregate.json', closure.aggregate)
      writeJsonArtifact(dir, 'manifest.json', manifest)
      const depthOk = bundleEngine.isValidDepth(bundleEngine.childrenOf(manifest))
      if (!depthOk) {
        results.push({ ok: false, note: '⚠️ bundle「' + packageId + '」children 嵌套超过 3 层（D19 硬约束），闭包解析已截断' })
      }
      results.push({
        ok: true,
        note: '✅ bundle 闭包已解析：' + closure.items.length + ' 个包（skills ' + closure.aggregate.skills.length + ' / tools ' + closure.aggregate.tools.length + ' / tokens ' + Object.keys(closure.aggregate.tokens).length + ' / assets ' + closure.aggregate.assets.length + '）' + (closure.issues.length > 0 ? '；' + closure.issues.length + ' 个子包失败：' + closure.issues.slice(0, 2).join('；') : ''),
      })
      break
    }
    case 'pet-layer': {
      const scene = petLayerEngine.load({ packageId, pkgDir, manifest })
      const dir = engineArtifactDir(callerKey, 'pet-layer', packageId)
      writeJsonArtifact(dir, 'scene.json', {
        packageId,
        html: scene.html,
        behavior: scene.behavior,
        assets: scene.assets,
        note: scene.note,
      })
      writeJsonArtifact(dir, 'manifest.json', manifest)
      const entryName = typeof manifest.entry === 'string' ? manifest.entry : 'index.html'
      results.push({ ok: true, note: '✅ 桌宠场景已装载（entry=' + entryName + '，assets ' + scene.assets.length + ' 个）' + (scene.note ? '；' + scene.note : '') })
      break
    }
    default:
      results.push({ ok: true, note: '' })
  }
  return results
}

/** W4 引擎卸载钩子：清理调用者工作区 system/engines/<type>/<id>/ + skill 目录 */
export async function onPackageUninstalled(input: { callerKey: string; packageId: string; type: string }): Promise<EngineInstallResult[]> {
  const { callerKey, packageId, type } = input
  const results: EngineInstallResult[] = []
  // skill：清理调用者 skills/<id>/（只清理本引擎安装标记目录）
  if (type === 'skill') {
    const r = skillEngine.uninstall({ callerKey, packageId })
    results.push({ ok: r.ok, note: r.note })
  }
  // 其余类型：删除引擎产物目录（幂等）
  const dir = engineArtifactDir(callerKey, type, packageId)
  try {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true })
      results.push({ ok: true, note: `已清理引擎产物 system/engines/${type}/${packageId}/` })
    }
  } catch (error) {
    results.push({ ok: false, note: `清理失败：${error instanceof Error ? error.message : String(error)}` })
  }
  return results
}

/** 生命周期钩子实例（packages/index.ts 导出，webos.ts 安装时调用） */
export const lifecycleHooks: PackageLifecycleHooks = {
  onPackageInstalled,
  onPackageUninstalled,
}