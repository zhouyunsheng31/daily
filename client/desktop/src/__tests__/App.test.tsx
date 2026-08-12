/**
 * App.tsx 初始化单元测试 — Phase 11 P0
 *
 * 覆盖重点：
 * 1. App 基础渲染不抛错
 * 2. 挂载后触发 startServerHealthCheck
 * 3. 挂载后触发 useAIStore.initialize + useAppStore.initialize
 * 4. 卸载时调用清理函数（healthCheck.stop / toolBridge.unregister）
 * 5. settings.appearance 变化时写入 CSS 变量
 * 6. /migration 路径直接渲染 MigrationPage（不渲染主壳）
 *
 * Mock 策略：
 * - vi.mock 大量子组件为占位 div（避免渲染真实组件依赖链）
 * - vi.mock stores（保留 setUseAppStoreRef / setUseAIStoreRef / registerAppStateProvider 为 vi.fn）
 * - vi.mock utils（serverHealthCheck / toolBridge / syncQueue / multiTab / keyboardShortcuts / color / api adapter）
 * - 构造 zustand-like mockStore，支持 selector 调用 + getState/setState
 *
 * 注意：App.tsx 不在 happy-dom 之外需要任何环境（不加 // @vitest-environment 注释）
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, act, fireEvent } from '@testing-library/react'
import type { ReactElement } from 'react'

// ============================================================================
// 工具：构造 zustand-like mock store（支持 selector 调用 + getState/setState）
// ============================================================================

interface MockStoreOptions<T> {
  initial: T
}

function createMockStore<T extends object>({ initial }: MockStoreOptions<T>): {
  hook: (<S,>(selector?: (s: T) => S) => S) & {
    getState: () => T
    setState: (partial: Partial<T> | ((s: T) => Partial<T>)) => void
    subscribe: (cb: (s: T, prev: T) => void) => () => void
    getInitialState: () => T
  }
} {
  let state: T = { ...initial }
  const listeners = new Set<(s: T, prev: T) => void>()

  const hook = <S,>(selector?: (s: T) => S): S => {
    if (!selector) return state as unknown as S
    return selector(state)
  }
  hook.getState = () => state
  hook.setState = (partial: Partial<T> | ((s: T) => Partial<T>)): void => {
    const prev = state
    const patch = typeof partial === 'function' ? (partial as (s: T) => Partial<T>)(state) : partial
    state = { ...state, ...patch }
    listeners.forEach(l => l(state, prev))
  }
  hook.subscribe = (cb: (s: T, prev: T) => void): (() => void) => {
    listeners.add(cb)
    return () => listeners.delete(cb)
  }
  hook.getInitialState = (): T => initial
  return { hook }
}

// ============================================================================
// vi.mock：拦截所有子组件（占位 div，附带 data-testid 便于断言）
// ============================================================================

const placeholder = (testId: string) => {
  const Cmp = (props: Record<string, unknown>): ReactElement => (
    <div data-testid={testId} {...props} />
  )
  return Cmp
}

vi.mock('../components/Workspace', () => ({ default: placeholder('Workspace') }))
vi.mock('../components/UnifiedToolbar', () => ({ default: placeholder('UnifiedToolbar') }))
vi.mock('../components/TabBar', () => ({ default: placeholder('TabBar') }))
vi.mock('../components/Sidebar', () => ({ default: placeholder('Sidebar') }))
vi.mock('../components/Omnibox', () => ({ default: placeholder('Omnibox') }))
vi.mock('../components/ResizableDivider', () => ({ default: placeholder('ResizableDivider') }))
vi.mock('../components/BrowserHome', () => ({ default: placeholder('BrowserHome') }))
vi.mock('../components/CanvasHome', () => ({ default: placeholder('CanvasHome') }))
vi.mock('../components/Toast', () => ({ default: placeholder('Toast') }))
vi.mock('../components/OfflineBanner', () => ({
  default: placeholder('OfflineBanner'),
  OfflineBanner: placeholder('OfflineBanner'),
}))
vi.mock('../components/SyncFailedBanner', () => ({ default: placeholder('SyncFailedBanner') }))
vi.mock('../components/TitleBar', () => ({ default: placeholder('TitleBar') }))
vi.mock('../components/SettingsPanel', () => ({ default: placeholder('SettingsPanel') }))
vi.mock('../components/WidgetSearch', () => ({ default: placeholder('WidgetSearch') }))
vi.mock('../components/widgets/WebviewWidget', () => ({ default: placeholder('WebviewWidget') }))
vi.mock('../components/MigrationPage', () => ({
  MigrationPage: placeholder('MigrationPage'),
}))

// ============================================================================
// vi.mock：utils 副作用（每个都返回 cleanup 函数便于断言调用）
// ============================================================================

const startServerHealthCheckMock = vi.fn().mockImplementation(() => vi.fn())
vi.mock('../utils/serverHealthCheck', () => ({
  startServerHealthCheck: startServerHealthCheckMock,
}))

const registerToolBridgeMock = vi.fn().mockImplementation(() => vi.fn())
vi.mock('../utils/toolBridge', () => ({
  registerToolBridge: registerToolBridgeMock,
}))

const initSyncQueueMock = vi.fn().mockImplementation(() => Promise.resolve())
vi.mock('../utils/syncQueue', () => ({
  initSyncQueue: initSyncQueueMock,
}))

vi.mock('../utils/multiTab', () => ({
  useMultiTabSync: vi.fn(),
}))

vi.mock('../hooks/useKeyboardShortcuts', () => ({
  useKeyboardShortcuts: vi.fn(),
}))

vi.mock('../utils/color', () => ({
  isLightTheme: vi.fn().mockReturnValue(true),
  hexToRgba: vi.fn().mockImplementation((h: string, a: number) => `rgba(0,0,0,${a})`),
  ensureContrast: vi.fn().mockImplementation((h: string) => h),
}))

vi.mock('../api/adapter', () => ({
  getBackend: vi.fn().mockReturnValue('local'),
}))

// ============================================================================
// vi.mock：stores（保留 setUseAppStoreRef / setUseAIStoreRef / registerAppStateProvider
//   为 vi.fn，避免触发真实 zustand 模块加载副作用）
// ============================================================================

const defaultAppearance = {
  backgroundType: 'color' as const,
  backgroundColor: '#f5f5f7',
  backgroundGradient: '',
  backgroundImage: '',
  surfaceColor: '#fff',
  surfaceBorderColor: '#eee',
  accentColor: '#007aff',
  textColor: '#1d1d1f',
  textMutedColor: '#6e6e73',
  fontSize: 14,
}

const { hook: useAppStoreMock } = createMockStore({
  initial: {
    settings: {
      appearance: defaultAppearance,
    },
    showSettings: false,
    showWidgetSearch: false,
    mainView: { type: 'canvas-home' as const },
    sidebarWidth: 240,
    topbarOmniboxWidth: 360,
    activePanelId: 'panel-1',
    panels: [{ id: 'panel-1', name: 'P1', settings: {}, canvasTransform: {} }],
    panelWidgets: {},
    lastActiveWidgetId: null,
    canvasTransform: { zoom: 1 },
    webTabs: [],
    isInitializing: false,
    onboardingChecked: true,
    hasCompletedOnboarding: true,
    initialize: vi.fn().mockResolvedValue(undefined),
    ensurePrimarySession: vi.fn().mockResolvedValue(undefined),
    setSidebarWidth: vi.fn(),
    setTopbarOmniboxWidth: vi.fn(),
    setShowWidgetSearch: vi.fn(),
    addPanel: vi.fn().mockResolvedValue('panel-2'),
    addWidget: vi.fn().mockResolvedValue(undefined),
    toggleSidebar: vi.fn(),
    setCanvasTransform: vi.fn(),
    updateWebTab: vi.fn(),
  },
})

const { hook: useAIStoreMock } = createMockStore({
  initial: {
    sessions: {},
    activeSessionId: null,
    initialize: vi.fn().mockResolvedValue(undefined),
  },
})

const { hook: useRuntimeModeStoreMock } = createMockStore({
  initial: {
    mode: 'auto' as const,
    effectiveMode: 'cloud' as const,
    isServerOnline: true,
    isOfflineDowngraded: false,
    setServerOnline: vi.fn(),
    setMode: vi.fn(),
  },
})

vi.mock('../stores/useAppStore', () => ({
  useAppStore: useAppStoreMock,
  setUseAIStoreRef: vi.fn(),
}))

vi.mock('../stores/useAIStore', () => ({
  useAIStore: useAIStoreMock,
  setUseAppStoreRef: vi.fn(),
  registerAppStateProvider: vi.fn(),
}))

vi.mock('../stores/useRuntimeModeStore', () => ({
  useRuntimeModeStore: useRuntimeModeStoreMock,
}))

vi.mock('../stores/useThinkingLevelStore', () => ({
  useThinkingLevelStore: {
    getState: vi.fn().mockReturnValue({ currentLevel: 'medium' }),
    setState: vi.fn(),
    subscribe: vi.fn(),
  },
}))

vi.mock('../stores/useApiConfigStore', () => ({
  useApiConfigStore: {
    getState: vi.fn().mockReturnValue({ presets: [], activePresetId: null }),
    setState: vi.fn(),
    subscribe: vi.fn(),
  },
}))

// ============================================================================
// 动态 import App（在所有 mock 就绪后）
// ============================================================================

async function loadApp(): Promise<{ default: React.FC }> {
  vi.resetModules()
  const mod = await import('../App')
  return mod as { default: React.FC }
}

// ============================================================================
// 测试套件
// ============================================================================

describe('App.tsx 初始化', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // 重新让 mock 工厂函数返回 vi.fn，避免跨用例污染
    startServerHealthCheckMock.mockImplementation(() => vi.fn())
    registerToolBridgeMock.mockImplementation(() => vi.fn())
    initSyncQueueMock.mockImplementation(() => Promise.resolve())
    // 重置 store 状态到初始值（initialize 仍保留 mock）
    useAppStoreMock.setState({
      settings: { appearance: defaultAppearance },
      showSettings: false,
      showWidgetSearch: false,
      mainView: { type: 'canvas-home' },
      activePanelId: 'panel-1',
    } as never)
    useRuntimeModeStoreMock.setState({
      isOfflineDowngraded: false,
      effectiveMode: 'cloud',
    } as never)
    // 重置 window.webviewApi / menuApi（App.tsx 内部 useEffect 注册）
    ;(window as unknown as { webviewApi?: unknown }).webviewApi = {
      onOpenUrl: vi.fn().mockImplementation(() => vi.fn()),
    }
    ;(window as unknown as { menuApi?: unknown }).menuApi = {
      onMenuAction: vi.fn().mockImplementation(() => vi.fn()),
    }
    // window.location.pathname 复位
    window.history.replaceState({}, '', '/')
  })

  afterEach(() => {
    cleanup()
  })

  // --------------------------------------------------------------------------
  // 1. App 基础渲染不抛错
  // --------------------------------------------------------------------------
  it('1. App 基础渲染不抛错', async () => {
    const { default: App } = await loadApp()
    let container: { container: HTMLElement } | undefined
    await act(async () => {
      container = render(<App />)
    })
    expect(container!.container.querySelector('.app-root')).not.toBeNull()
  })

  // --------------------------------------------------------------------------
  // 2. 挂载后调用 startServerHealthCheck
  // --------------------------------------------------------------------------
  it('2. 挂载后调用 startServerHealthCheck', async () => {
    const { default: App } = await loadApp()
    await act(async () => {
      render(<App />)
    })
    expect(startServerHealthCheckMock).toHaveBeenCalledTimes(1)
    const opts = startServerHealthCheckMock.mock.calls[0][0] as {
      url: string
      onOnline: () => void
      onOffline: () => void
    }
    expect(opts.url).toMatch(/\/api\/health$/)
    expect(typeof opts.onOnline).toBe('function')
    expect(typeof opts.onOffline).toBe('function')
  })

  // --------------------------------------------------------------------------
  // 3. 挂载后调用 useAIStore.initialize + useAppStore.initialize
  // --------------------------------------------------------------------------
  it('3. 挂载后调用 useAIStore.initialize 与 useAppStore.initialize', async () => {
    const { default: App } = await loadApp()
    const aiInit = useAIStoreMock.getState().initialize as ReturnType<typeof vi.fn>
    const appInit = useAppStoreMock.getState().initialize as ReturnType<typeof vi.fn>
    aiInit.mockClear()
    appInit.mockClear()

    await act(async () => {
      render(<App />)
    })
    // 等待 useEffect 内 async 函数完成（initialize + Promise.all）
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(aiInit).toHaveBeenCalledTimes(1)
    expect(appInit).toHaveBeenCalledTimes(1)
  })

  // --------------------------------------------------------------------------
  // 4. 卸载时调用清理函数（healthCheck stop + toolBridge unregister）
  // --------------------------------------------------------------------------
  it('4. 卸载时调用清理函数（healthCheck.stop 与 toolBridge.unregister）', async () => {
    const healthStop = vi.fn()
    const toolBridgeUnregister = vi.fn()
    startServerHealthCheckMock.mockImplementation(() => healthStop)
    registerToolBridgeMock.mockImplementation(() => toolBridgeUnregister)

    const { default: App } = await loadApp()
    let unmount: (() => void) | undefined
    await act(async () => {
      const result = render(<App />)
      unmount = result.unmount
    })

    expect(healthStop).not.toHaveBeenCalled()
    expect(toolBridgeUnregister).not.toHaveBeenCalled()

    await act(async () => {
      unmount?.()
    })

    expect(healthStop).toHaveBeenCalledTimes(1)
    expect(toolBridgeUnregister).toHaveBeenCalledTimes(1)
  })

  // --------------------------------------------------------------------------
  // 5. settings.appearance 变化时写入 CSS 变量
  // --------------------------------------------------------------------------
  it('5. settings.appearance 变化时写入 CSS 变量', async () => {
    const { default: App } = await loadApp()
    let rerenderFn: ((ui: React.ReactElement) => void) | undefined
    await act(async () => {
      const result = render(<App />)
      rerenderFn = result.rerender
    })

    // 初始挂载应已设置 --bg-canvas
    const root = document.documentElement
    expect(root.style.getPropertyValue('--bg-canvas')).toBe('#f5f5f7')

    // 修改 settings.appearance.backgroundColor
    useAppStoreMock.setState({
      settings: {
        appearance: { ...defaultAppearance, backgroundColor: '#111111' },
      },
    } as never)

    await act(async () => {
      rerenderFn?.(<App />)
    })

    expect(root.style.getPropertyValue('--bg-canvas')).toBe('#111111')
  })

  // --------------------------------------------------------------------------
  // 6. /migration 路径直接渲染 MigrationPage（不渲染主壳）
  // --------------------------------------------------------------------------
  it('6. /migration 路径直接渲染 MigrationPage（不渲染 app-root）', async () => {
    window.history.replaceState({}, '', '/migration')
    const { default: App } = await loadApp()
    let container: { container: HTMLElement } | undefined
    await act(async () => {
      container = render(<App />)
    })
    expect(container!.container.querySelector('.app-root')).toBeNull()
    expect(container!.container.querySelector('[data-testid="MigrationPage"]')).not.toBeNull()
  })

  // --------------------------------------------------------------------------
  // 7. contextmenu 事件在非 INPUT/TEXTAREA/SELECT 时阻止默认行为
  // --------------------------------------------------------------------------
  it('7. contextmenu 事件在 div 上触发 preventDefault', async () => {
    const { default: App } = await loadApp()
    let container: { container: HTMLElement } | undefined
    await act(async () => {
      container = render(<App />)
    })

    const target = container!.container.querySelector('.app-root') as HTMLElement
    expect(target).not.toBeNull()

    const ev = new Event('contextmenu', { bubbles: true, cancelable: true })
    const spy = vi.spyOn(ev, 'preventDefault')
    target.dispatchEvent(ev)

    expect(spy).toHaveBeenCalled()
  })

  // --------------------------------------------------------------------------
  // 8. canvas-panel 主视图下渲染 Workspace（且显示 UnifiedToolbar）
  // --------------------------------------------------------------------------
  it('8. canvas-panel 主视图下渲染 Workspace 与 UnifiedToolbar', async () => {
    useAppStoreMock.setState({ mainView: { type: 'canvas-panel', panelId: 'panel-1' } } as never)
    const { default: App } = await loadApp()
    let container: { container: HTMLElement } | undefined
    await act(async () => {
      container = render(<App />)
    })
    expect(container!.container.querySelector('[data-testid="Workspace"]')).not.toBeNull()
    expect(container!.container.querySelector('[data-testid="UnifiedToolbar"]')).not.toBeNull()
  })

  // --------------------------------------------------------------------------
  // 9. browser-home 主视图下渲染 BrowserHome（且不显示 UnifiedToolbar）
  // --------------------------------------------------------------------------
  it('9. browser-home 主视图下渲染 BrowserHome 且不显示 UnifiedToolbar', async () => {
    useAppStoreMock.setState({ mainView: { type: 'browser-home', tabId: 'tab-1' } } as never)
    const { default: App } = await loadApp()
    let container: { container: HTMLElement } | undefined
    await act(async () => {
      container = render(<App />)
    })
    expect(container!.container.querySelector('[data-testid="BrowserHome"]')).not.toBeNull()
    expect(container!.container.querySelector('[data-testid="UnifiedToolbar"]')).toBeNull()
  })

  // --------------------------------------------------------------------------
  // 10. showSettings=true 时渲染 SettingsPanel
  // --------------------------------------------------------------------------
  it('10. showSettings=true 时渲染 SettingsPanel', async () => {
    useAppStoreMock.setState({ showSettings: true } as never)
    const { default: App } = await loadApp()
    let container: { container: HTMLElement } | undefined
    await act(async () => {
      container = render(<App />)
    })
    expect(container!.container.querySelector('[data-testid="SettingsPanel"]')).not.toBeNull()
  })
})
