// server/src/webos/packages/index.ts —— W1 包体系出口
// ----------------------------------------------------------------------------
// 依据：docs/routes/web/03-package-system.md §4 + 09-roadmap W1。
// 组装：包三表（db）+ 生命周期/校验反馈（service）+ REST 端点（router）。
// 接入方（index.ts / webos.ts）只依赖本文件导出的少量符号。
// ============================================================================

import { ensurePackageSchema } from './packages-db.js'
import {
  syncPackageFromFs,
  syncAllPackagesFromWorkspace,
  setAppViewProvider,
  matchPackageFolder,
  PACKAGES_DIR,
  PACKAGE_MANIFEST,
} from './packages-service.js'
import { packagesRouter } from './packages-router.js'

export { packagesRouter }
export { ensurePackageSchema }
export { syncPackageFromFs, syncAllPackagesFromWorkspace, setAppViewProvider, matchPackageFolder, PACKAGES_DIR, PACKAGE_MANIFEST }
export { listForUser, getDetailForUser } from './packages-service.js'