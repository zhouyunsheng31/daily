// server/src/webos/appapi/index.ts —— W2 App API 出口
// ----------------------------------------------------------------------------
// 组装：用量表（db）+ 受限 vm 执行器（runtime）+ 编排核心（service）+ REST（router）。
// 接入方（webos.ts / index.ts）只依赖本文件导出的少量符号。
// ============================================================================

import { ensureApiUsageSchema, ensureApiPublicSchema } from './appapi-db.js'
import {
  setAppApiDeps,
  registerDynamicTools,
  invokeEndpoint,
  updateApiSecrets,
  getApiSecretsStatus,
  loadApiSpecs,
  getNamespaceSpec,
  camelToSnake,
  publishNamespace,
  unpublishNamespace,
  getPublicStatus,
  resolvePublicEndpoint,
} from './appapi-service.js'
import { appapiRouter } from './appapi-router.js'

export { appapiRouter }
export { ensureApiUsageSchema, ensureApiPublicSchema }
export { setAppApiDeps, registerDynamicTools, invokeEndpoint, updateApiSecrets, getApiSecretsStatus, loadApiSpecs, getNamespaceSpec, camelToSnake, publishNamespace, unpublishNamespace, getPublicStatus, resolvePublicEndpoint }
export type { AppApiDeps, PrincipalLike, AppStateLike, InvokeResult, InvokeInput } from './appapi-service.js'
export { executeApiHandler, matchStoragePrefix, allowedByPrefix, targetAllowed, redactSecrets } from './api-runtime.js'