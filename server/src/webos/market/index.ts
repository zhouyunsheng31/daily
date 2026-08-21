// server/src/webos/market/index.ts —— W3 统一包市场（R14）出口
// ----------------------------------------------------------------------------
// 组装：市场表（db）+ 领域逻辑（service，含 pi 找包/装包工具）+ REST（router）。
// ============================================================================

import { ensureMarketSchema } from './db.js'
import { marketRouter } from './router.js'

export { marketRouter }
export { ensureMarketSchema }
export {
  publishPackage,
  unpublishPackage,
  listMarket,
  marketDetail,
  installMarketPackage,
  listMyMarketInstalls,
  resolveDependencyClosure,
  scanPackageForSecrets,
  registerMarketTools,
  type MarketResult,
} from './service.js'
export type { MarketEntryRow, MarketInstallRow } from './db.js'