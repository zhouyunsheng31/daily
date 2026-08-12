/**
 * MockElectronAPI（Phase 11.1）
 *
 * 在 window 上注入 preload 暴露的 mock API（agentApi / aiKeyApi / toolBridgeApi 等），
 * 供渲染进程组件测试用（无需启动真实 Electron 主进程）。
 *
 * 用法：
 *   import { setupMockElectronAPI, teardownMockElectronAPI } from '@/test/mocks/mockElectronAPI'
 *   beforeEach(() => setupMockElectronAPI())
 *   afterEach(() => teardownMockElectronAPI())
 *
 * 自定义返回值：
 *   setupMockElectronAPI({
 *     agentApi: { sendMessage: vi.fn().mockResolvedValue({ ok: true }) },
 *   })
 */
import { vi } from 'vitest'

export interface MockElectronAPIOptions {
  agentApi?: Partial<NonNullable<Window['agentApi']>>
  aiKeyApi?: Partial<NonNullable<Window['aiKeyApi']>>
  toolBridgeApi?: Partial<NonNullable<Window['toolBridgeApi']>>
  windowApi?: Partial<NonNullable<Window['windowApi']>>
}

const noop = () => {}

/**
 * 默认 agentApi mock：
 * - initialize / sendMessage / disposeSession / setThinkingLevel 返回 { ok: true }
 * - onEvent 返回 cleanup 函数（vi.fn 便于断言）
 */
function createDefaultAgentApi(): NonNullable<Window['agentApi']> {
  return {
    initialize: vi.fn().mockResolvedValue({ ok: true }),
    sendMessage: vi.fn().mockResolvedValue({ ok: true }),
    disposeSession: vi.fn().mockResolvedValue({ ok: true }),
    setThinkingLevel: vi.fn().mockResolvedValue({ ok: true }),
    onEvent: vi.fn().mockImplementation((cb) => {
      // 保存回调，测试用例可通过 triggerAgentEvent 主动触发
      ;(createDefaultAgentApi as unknown as { _lastEventCb?: typeof cb })._lastEventCb = cb
      return vi.fn().mockImplementation(noop) as unknown as () => void
    }),
  }
}

function createDefaultAiKeyApi(): NonNullable<Window['aiKeyApi']> {
  const store = new Map<string, { apiKey: string; endpoint: string; model: string }>()
  let activeProvider: string | null = null
  return {
    setApiKey: vi.fn().mockImplementation(async (provider: string, apiKey: string, endpoint: string, model: string) => {
      store.set(provider, { apiKey, endpoint, model })
      if (!activeProvider) activeProvider = provider
    }),
    getApiKey: vi.fn().mockImplementation(async (provider: string) => store.get(provider)?.apiKey ?? null),
    setActiveProvider: vi.fn().mockImplementation(async (provider: string) => {
      activeProvider = provider
    }),
    getActiveProvider: vi.fn().mockImplementation(async () => activeProvider),
    deleteApiKey: vi.fn().mockImplementation(async (provider: string) => {
      store.delete(provider)
      if (activeProvider === provider) activeProvider = null
    }),
    listProviders: vi.fn().mockImplementation(async () => Array.from(store.keys())),
  }
}

function createDefaultToolBridgeApi(): NonNullable<Window['toolBridgeApi']> {
  const handlers: Array<(request: unknown) => void> = []
  return {
    onToolExecuteRequest: vi.fn().mockImplementation((cb: (request: unknown) => void) => {
      handlers.push(cb)
      return () => {
        const idx = handlers.indexOf(cb)
        if (idx >= 0) handlers.splice(idx, 1)
      }
    }),
    respondToolResult: vi.fn().mockResolvedValue(undefined),
    executeTool: vi.fn().mockResolvedValue({ ok: true, data: null }),
  }
}

/**
 * 默认 windowApi mock（Phase 13.1.1 自绘标题栏）：
 * - minimize / maximizeToggle / close 返回 undefined（无操作）
 * - isMaximized 默认 false
 * - onMaximizeChange 返回 cleanup 函数（与 menuApi/shortcutApi 同模式）
 *
 * 测试用例可通过 triggerWindowMaximizeChange 主动触发回调（类似 triggerAgentEvent）。
 */
function createDefaultWindowApi(): NonNullable<Window['windowApi']> {
  return {
    minimize: vi.fn().mockResolvedValue(undefined),
    maximizeToggle: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    isMaximized: vi.fn().mockResolvedValue(false),
    onMaximizeChange: vi.fn().mockImplementation((cb: (isMaximized: boolean) => void) => {
      ;(createDefaultWindowApi as unknown as { _lastMaximizeCb?: typeof cb })._lastMaximizeCb = cb
      return vi.fn().mockImplementation(noop) as unknown as () => void
    }),
  }
}

/**
 * 主动触发 window:maximize-change 事件（配合 onMaximizeChange 注册的回调，模拟主进程推送）
 */
export function triggerWindowMaximizeChange(isMaximized: boolean): void {
  const cb = (createDefaultWindowApi as unknown as { _lastMaximizeCb?: (isMaximized: boolean) => void })._lastMaximizeCb
  cb?.(isMaximized)
}

/**
 * 在 window 上注入 mock API（替换 preload 注入的真实 API）
 * @param options 自定义覆盖（覆盖默认 mock 行为）
 * @returns teardown 函数（恢复原 API）
 */
export function setupMockElectronAPI(options?: MockElectronAPIOptions): () => void {
  const original = {
    agentApi: window.agentApi,
    aiKeyApi: window.aiKeyApi,
    toolBridgeApi: window.toolBridgeApi,
    windowApi: window.windowApi,
  }

  const defaultAgent = createDefaultAgentApi()
  const defaultAiKey = createDefaultAiKeyApi()
  const defaultToolBridge = createDefaultToolBridgeApi()
  const defaultWindow = createDefaultWindowApi()

  window.agentApi = options?.agentApi
    ? { ...defaultAgent, ...options.agentApi }
    : defaultAgent
  window.aiKeyApi = options?.aiKeyApi
    ? { ...defaultAiKey, ...options.aiKeyApi }
    : defaultAiKey
  window.toolBridgeApi = options?.toolBridgeApi
    ? { ...defaultToolBridge, ...options.toolBridgeApi }
    : defaultToolBridge
  window.windowApi = options?.windowApi
    ? { ...defaultWindow, ...options.windowApi }
    : defaultWindow

  return () => {
    window.agentApi = original.agentApi
    window.aiKeyApi = original.aiKeyApi
    window.toolBridgeApi = original.toolBridgeApi
    window.windowApi = original.windowApi
  }
}

/** teardown：清空 window 上的 mock API */
export function teardownMockElectronAPI(): void {
  delete (window as { agentApi?: unknown }).agentApi
  delete (window as { aiKeyApi?: unknown }).aiKeyApi
  delete (window as { toolBridgeApi?: unknown }).toolBridgeApi
  delete (window as { windowApi?: unknown }).windowApi
}

/**
 * 主动触发 agent event（配合 onEvent 注册的回调，模拟主进程推送）
 */
export function triggerAgentEvent(panelId: string, event: unknown): void {
  const cb = (createDefaultAgentApi as unknown as { _lastEventCb?: (data: { panelId: string; event: unknown }) => void })._lastEventCb
  cb?.({ panelId, event })
}
