// 存储后端适配器：支持运行时在 IDB 和 API 之间切换
// 当 API 不可用时自动降级到 IDB，API 恢复后自动切回并刷新 syncQueue

import { enqueueSyncOp, flushSyncQueue } from '../utils/syncQueue'
import { useRuntimeModeStore } from '../stores/useRuntimeModeStore'

type StorageBackend = 'api' | 'idb'

let currentBackend: StorageBackend = 'api'
let apiAvailable: boolean | null = null
// 订阅 useRuntimeModeStore.isServerOnline 变化的取消函数（仅订阅一次）
let unsubscribeRuntimeMode: (() => void) | null = null

export async function detectBackend(): Promise<StorageBackend> {
  // Phase 14 B3：指数退避重试（500ms, 1000ms, 2000ms, 4000ms = 7.5s 总等待）
  // 之前 10 次 × 1s = 10s 空白，现在更快失败让出 onboarding 渲染
  const RETRY_DELAYS_MS = [500, 1000, 2000, 4000]
  const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1  // 5 次尝试（4 次等待）
  apiAvailable = false
  // Phase 14 B1：prod 模式 file:// 协议下用绝对 URL，dev 模式用相对 '/api'
  // （与 client.ts API_BASE 保持一致，否则 detectBackend 总是 fetch file:///api/health 失败）
  const healthUrl = (import.meta.env.VITE_API_BASE_URL
    ?? (typeof window !== 'undefined' && window.location.protocol === 'file:'
      ? 'http://localhost:3456/api'
      : '/api')) + '/health'

  // 初始探测：指数退避重试 /api/health，确定初始 currentBackend
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(healthUrl, { signal: AbortSignal.timeout(3000) })
      if (res.ok) {
        apiAvailable = true
        break
      }
    } catch {
      // 本次探测失败，继续重试
    }
    if (attempt < MAX_ATTEMPTS) {
      const delay = RETRY_DELAYS_MS[attempt - 1]
      console.log(`[Storage] Retrying backend detection (attempt ${attempt}/${MAX_ATTEMPTS}) in ${delay}ms...`)
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
  currentBackend = apiAvailable ? 'api' : 'idb'
  console.log('[Storage] Backend detected:', currentBackend)

  // 后续监听：订阅 useRuntimeModeStore.isServerOnline 变化，
  // online 时切回 api 并 flush syncQueue，offline 时降级到 idb。
  // 该订阅替代原 setInterval 健康检查循环，与 startServerHealthCheck 上报的状态对齐。
  if (!unsubscribeRuntimeMode) {
    unsubscribeRuntimeMode = useRuntimeModeStore.subscribe((state, prevState) => {
      if (state.isServerOnline === prevState.isServerOnline) return
      if (state.isServerOnline) {
        apiAvailable = true
        currentBackend = 'api'
        console.log('[Storage] Server online (runtime mode store), switching back to api')
        // API 恢复后，刷新 syncQueue（批量回写离线期间的写操作）
        flushSyncQueue().catch((err) => {
          console.error('[Storage] SyncQueue flush failed:', err)
        })
      } else {
        apiAvailable = false
        currentBackend = 'idb'
        console.log('[Storage] Server offline (runtime mode store), falling back to idb')
      }
    })
  }

  return currentBackend
}

export function getBackend(): StorageBackend {
  return currentBackend
}

export function isApiAvailable(): boolean {
  return apiAvailable === true
}

// 强制切换到 IDB 模式（用于自动迁移降级）
export function setBackendToIdb(): void {
  currentBackend = 'idb'
  apiAvailable = false
  console.log('[Storage] Forced switch to IDB mode')
}

/**
 * 同步操作描述（可选，用于 API 失败降级时入队 syncQueue）
 * 读操作不需要传 syncOp
 */
export interface SyncOp {
  operation: 'create' | 'update' | 'delete'
  entityType: string
  entityId: string
  payload: unknown
}

/**
 * 通用请求包装：API 优先，失败时降级到 IDB + syncQueue
 * @param apiFn API 请求函数
 * @param idbFn IDB 降级函数
 * @param syncOp 可选的同步操作描述（写操作传入，读操作不传）
 */
export async function withFallback<T>(
  apiFn: () => Promise<T>,
  idbFn: () => Promise<T>,
  syncOp?: SyncOp,
): Promise<T> {
  if (currentBackend === 'api') {
    try {
      const result = await apiFn()
      // API 成功：返回结果（异步预写 IDB 由调用方负责）
      return result
    } catch (err) {
      console.warn('[Storage] API failed, falling back to IDB:', err)
      // 标记 API 不可用，后续请求直接走 IDB（定时健康检查会自动恢复）
      apiAvailable = false
      currentBackend = 'idb'
      const idbResult = await idbFn()
      // 如果是写操作，加入 syncQueue（API 恢复后批量回写）
      if (syncOp) {
        enqueueSyncOp(syncOp).catch((e) => {
          console.error('[Storage] Failed to enqueue sync op:', e)
        })
      }
      return idbResult
    }
  }
  // IDB 模式：先走 IDB，如果结果为空且是数组，尝试 API 补充（处理 IDB 数据未同步的情况）
  const idbResult = await idbFn()
  if (Array.isArray(idbResult) && idbResult.length === 0) {
    try {
      const apiResult = await apiFn()
      if (Array.isArray(apiResult) && apiResult.length > 0) {
        // API 有数据，切换回 API 模式
        apiAvailable = true
        currentBackend = 'api'
        console.log('[Storage] API has data, switching back to api')
        return apiResult
      }
    } catch {
      // API 仍然不可用，保持 IDB 结果
    }
  }
  // IDB 模式下的写操作也加入 syncQueue
  if (syncOp) {
    enqueueSyncOp(syncOp).catch((e) => {
      console.error('[Storage] Failed to enqueue sync op:', e)
    })
  }
  return idbResult
}
