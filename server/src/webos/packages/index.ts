// server/src/webos/packages/index.ts —— W1 包体系出口
// ----------------------------------------------------------------------------
// 依据：docs/routes/web/03-package-system.md §4 + 09-roadmap W1。
// 组装：包三表（db）+ 生命周期/校验反馈（service）+ REST 端点（router）。
// 接入方（index.ts / webos.ts）只依赖本文件导出的少量符号。
// W4（2026-08-23）：引擎挂接 —— 在生命周期钩子上安装/卸载
//   skill / theme / bundle / pet-layer 的执行引擎（见下方 hooks）。
// ============================================================================

import { ensurePackageSchema } from './packages-db.js'
import {
  syncPackageFromFs,
  syncAllPackagesFromWorkspace,
  ensureSystemPackages,
  setAppViewProvider,
  matchPackageFolder,
  PACKAGES_DIR,
  PACKAGE_MANIFEST,
} from './packages-service.js'
import { packagesRouter } from './packages-router.js'
import { lifecycleHooks } from './lifecycle-hooks.js'

export { packagesRouter }
export { ensurePackageSchema }
export { syncPackageFromFs, syncAllPackagesFromWorkspace, ensureSystemPackages, setAppViewProvider, matchPackageFolder, PACKAGES_DIR, PACKAGE_MANIFEST }
export { listForUser, getDetailForUser } from './packages-service.js'

// ---- W4 引擎生命周期挂接（install/uninstall 钩子；见 lifecycle-hooks.ts） ----
export { lifecycleHooks } from './lifecycle-hooks.js'
export type { PackageLifecycleHooks, EngineInstallResult } from './lifecycle-hooks.js'