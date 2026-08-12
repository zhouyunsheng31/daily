/**
 * Server Health Check — Phase 9 批次 1 模块 8（离线降级）
 *
 * 定时 fetch 服务器健康检查端点（如 http://localhost:3456/api/health），
 * 根据响应状态回调 onOnline / onOffline。
 *
 * 设计要点：
 * - 默认 30s 间隔（与 WS 心跳 ping 间隔一致，见 useAIStore.ts:179）
 * - fetch 失败（网络错误 / 超时）也算 offline
 * - 使用 AbortController 实现单次请求超时（避免 fetch 挂死）
 * - 返回 stop 函数，清理 interval 和正在进行的 fetch
 *
 * 使用示例（App.tsx 顶层 useEffect）：
 * ```typescript
 * useEffect(() => {
 *   const stop = startServerHealthCheck({
 *     url: 'http://localhost:3456/api/health',
 *     onOnline: () => useRuntimeModeStore.getState().setServerOnline(true),
 *     onOffline: () => useRuntimeModeStore.getState().setServerOnline(false),
 *   })
 *   return stop
 * }, [])
 * ```
 */

export interface ServerHealthCheckOptions {
  /** 健康检查 URL，如 http://localhost:3456/api/health */
  url: string
  /** 检查间隔（毫秒），默认 30000（30s） */
  intervalMs?: number
  /** 单次 fetch 超时（毫秒），默认 5000（5s） */
  fetchTimeoutMs?: number
  /** 服务器在线时调用 */
  onOnline: () => void
  /** 服务器离线时调用（含 fetch 失败） */
  onOffline: () => void
  /** 是否在启动时立即执行一次检查（默认 true） */
  runImmediately?: boolean
}

/** 默认检查间隔：30s */
const DEFAULT_INTERVAL_MS = 30_000

/** 默认单次 fetch 超时：5s */
const DEFAULT_FETCH_TIMEOUT_MS = 5_000

/**
 * 启动服务器健康检查
 *
 * @returns stop 函数，调用后停止定时检查并清理资源
 */
export function startServerHealthCheck(options: ServerHealthCheckOptions): () => void {
  const {
    url,
    onOnline,
    onOffline,
  } = options
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS
  const fetchTimeoutMs = options.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS
  const runImmediately = options.runImmediately ?? true

  let stopped = false
  let intervalId: ReturnType<typeof setInterval> | null = null
  let abortController: AbortController | null = null

  async function checkOnce(): Promise<void> {
    if (stopped) return

    // 取消上一次未完成的 fetch
    if (abortController) {
      abortController.abort()
    }
    abortController = new AbortController()

    const timer = setTimeout(() => abortController?.abort(), fetchTimeoutMs)

    try {
      // GET 请求用于判断在线状态（与 adapter.ts detectBackend 探测端点对齐，避免 HEAD 被服务端拒绝）
      const res = await fetch(url, {
        method: 'GET',
        signal: abortController.signal,
        cache: 'no-store',
      })
      // 2xx 视为在线；3xx/4xx/5xx 视为离线（服务可能降级或不可用）
      if (res.ok) {
        onOnline()
      } else {
        onOffline()
      }
    } catch {
      // AbortError（超时）、TypeError（网络错误/CORS）、其他均视为离线
      onOffline()
    } finally {
      clearTimeout(timer)
      abortController = null
    }
  }

  if (runImmediately) {
    void checkOnce()
  }

  intervalId = setInterval(() => {
    void checkOnce()
  }, intervalMs)

  return () => {
    stopped = true
    if (intervalId) {
      clearInterval(intervalId)
      intervalId = null
    }
    if (abortController) {
      abortController.abort()
      abortController = null
    }
  }
}
