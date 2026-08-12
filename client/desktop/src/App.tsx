import { useEffect, useState, useRef, lazy, Suspense } from 'react'
import { useAppStore, setUseAIStoreRef } from './stores/useAppStore'
import type { MainView } from './types'
import { useAIStore, setUseAppStoreRef } from './stores/useAIStore'
import { registerAppStateProvider } from './stores/useAIStore'
import { useToastStore } from './stores/useToastStore'
// Phase 7 批次3 任务6：全局快捷键中心 hook
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import Workspace from './components/Workspace'
import UnifiedToolbar from './components/UnifiedToolbar'
// Phase 15 任务 2.7-b：TabBar 已迁移进 TitleBar，App.tsx 不再直接渲染 TabBar
// Phase 15 任务 2.7-c：Omnibox 已迁移进 TitleBar，App.tsx 不再直接渲染 Omnibox
import Sidebar from './components/Sidebar'
import ResizableDivider from './components/ResizableDivider'
import BrowserHome from './components/BrowserHome'
import CanvasHome from './components/CanvasHome'
import Toast from './components/Toast'
// Phase 9 批次1 模块8：离线降级 banner（顶部提示条）+ 服务器健康检查
import OfflineBanner from './components/OfflineBanner'
// Phase S3 缺口 D：失败操作 UI 提示 banner（与 OfflineBanner 同级，spec 2.4 节）
import SyncFailedBanner from './components/SyncFailedBanner'
// Phase 13.1.1：自绘标题栏（替换 Windows 原生标题栏，置于 app-root 最顶部）
import TitleBar from './components/TitleBar'
import GlobalErrorBoundary from './components/GlobalErrorBoundary'
import { startServerHealthCheck } from './utils/serverHealthCheck'
import { useRuntimeModeStore } from './stores/useRuntimeModeStore'
// Phase 9 批次2 模块3：工具桥接（渲染进程侧监听主进程的 tool:execute:request）
import { registerToolBridge } from './utils/toolBridge'

import { isLightTheme, hexToRgba, ensureContrast } from './utils/color'
import { useMultiTabSync } from './utils/multiTab'
import { getBackend } from './api/adapter'
import { initSyncQueue } from './utils/syncQueue'

// 批次5 任务8: React.lazy 懒加载条件渲染的重型组件，减小初始 bundle
const SettingsPanel = lazy(() => import('./components/SettingsPanel'))
const WidgetSearch = lazy(() => import('./components/WidgetSearch'))
const WebviewWidget = lazy(() => import('./components/widgets/WebviewWidget'))
const MigrationPage = lazy(() =>
  import('./components/MigrationPage').then(m => ({ default: m.MigrationPage }))
)
// Phase 13.1.4：Onboarding 懒加载（仅首次启动时加载，减小主 bundle）
const Onboarding = lazy(() => import('./components/Onboarding'))

// 简单加载占位（Phase 14 B3：增加品牌名 + 进度提示）
const SuspenseFallback = () => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-tertiary)' }}>
    正在初始化 Daily...
  </div>
)

// v10: 显式设置 useAIStore ref（修复 ensurePrimarySession 时序问题：setTimeout+require 在 ESM 不可靠）
setUseAIStoreRef(() => useAIStore)
// Phase 3: 对称设置 useAppStore ref（WS 变更广播触发 refreshPanels/refreshWidgets/refreshSettings）
setUseAppStoreRef(() => useAppStore)

// Register app state provider for AI context (avoids circular dep)
registerAppStateProvider(() => {
  const s = useAppStore.getState()
  const activePanelId = s.activePanelId
  const panels = s.panels as unknown as Record<string, { name: string }>
  const panelWidgets = s.panelWidgets as unknown as Record<string, Array<{ widgetId: string; widgetType: string; state: Record<string, unknown> }>>
  return {
    activePanelId,
    activePanelName: activePanelId && panels[activePanelId]?.name ? panels[activePanelId].name : '',
    visibleWidgetIds: activePanelId && panelWidgets[activePanelId] ? panelWidgets[activePanelId].map(w => w.widgetId) : [],
    selectedWidgetId: s.lastActiveWidgetId,
    canvasZoom: 1,
    panelWidgets,
  }
})

export default function App() {
  // Phase 15 批次1 任务1.4：拆分 settings 订阅，按需订阅 appearance（behavior 变化不触发 App 重渲染）
  const appearance = useAppStore(s => s.settings?.appearance)
  // Phase 7 批次4 任务7（spec 6.2.3 节）：订阅 accessibility 设置，应用到 document.documentElement
  const accessibility = useAppStore(s => s.settings?.accessibility)
  const showSettings = useAppStore(s => s.showSettings)
  const initialize = useAppStore(s => s.initialize)
  const ensurePrimarySession = useAppStore(s => s.ensurePrimarySession)
  const mainView = useAppStore(s => s.mainView)
  // Bug 修复：订阅 WS 连接状态，WS 连接成功时也上报 setServerOnline(true)，
  // 避免仅依赖 HTTP 健康检查导致 effectiveMode 卡在 'local'（HTTP 检查 30s 间隔 + 端口未就绪时永远 false）
  const isWsOnline = useAIStore(s => s.isOnline)

  // Phase 7 批次2 任务1: 主页切换动画（fade + slide，三阶段）
  type ViewPhase = 'exiting' | 'entering' | 'entered'
  const [displayView, setDisplayView] = useState<MainView>(mainView)
  const [exitingView, setExitingView] = useState<MainView | null>(null)
  const [phase, setPhase] = useState<ViewPhase>('entered')
  const displayViewRef = useRef<MainView>(mainView)

  useEffect(() => {
    const viewKey = (v: MainView) => `${v.type}${v.tabId ?? ''}${v.panelId ?? ''}`
    if (viewKey(mainView) === viewKey(displayViewRef.current)) return
    setExitingView(displayViewRef.current)
    setPhase('exiting')
    const t = setTimeout(() => {
      displayViewRef.current = mainView
      setDisplayView(mainView)
      setExitingView(null)
      setPhase('entering')
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setPhase('entered')
        })
      })
    }, 100)
    return () => clearTimeout(t)
  }, [mainView])
  // 批次1: 订阅布局尺寸（用于 ResizableDivider 拖拽改变 Sidebar 宽度）
  const sidebarWidth = useAppStore(s => s.sidebarWidth)
  const setSidebarWidth = useAppStore(s => s.setSidebarWidth)
  // Phase 15 任务 2.7-c：topbarOmniboxWidth/setTopbarOmniboxWidth 已移除（app-topbar 移除，Omnibox 迁移进 TitleBar）
  // Phase 7 批次3 任务6：组件搜索开关迁移到 store（由 useKeyboardShortcuts hook 控制）
  const showWidgetSearch = useAppStore(s => s.showWidgetSearch)
  const setShowWidgetSearch = useAppStore(s => s.setShowWidgetSearch)
  // Phase 13.1.4：Onboarding 门控状态
  const onboardingChecked = useAppStore(s => s.onboardingChecked)
  const hasCompletedOnboarding = useAppStore(s => s.hasCompletedOnboarding)
  const onboardingLoadFailed = useAppStore(s => s.onboardingLoadFailed)
  // Phase 15 批次1 任务1.1：订阅 isInitializing，初始化完成前显示加载占位（不渲染主界面）
  const isInitializing = useAppStore(s => s.isInitializing)

  // Phase 4 任务 7: UnifiedToolbar 仅画布模式显示（spec 5.7 节）
  const showUnifiedToolbar = mainView.type === 'canvas-panel' || mainView.type === 'canvas-home'

  useMultiTabSync()
  // Phase 7 批次3 任务6：注册全局快捷键（Ctrl+F/Ctrl+T/Ctrl+D 等）
  useKeyboardShortcuts()

  // Phase 3: 初始化 syncQueue 定时刷新任务（API 不可用时入队，恢复后批量回写）
  useEffect(() => {
    void initSyncQueue()
  }, [])

  // 容错修复：onboarding 状态加载失败时（IDB 损坏），显示非阻塞警告 Toast
  // 不阻塞主应用渲染，用户仍可正常使用应用
  useEffect(() => {
    if (onboardingLoadFailed) {
      useToastStore.getState().showToast({
        type: 'error',
        message: '引导状态加载失败（本地存储异常），已跳过引导。数据可能需要重新初始化。',
        duration: 8000,
      })
    }
  }, [onboardingLoadFailed])

  // Phase 9 批次1 模块8：启动服务器健康检查，定时探测服务器在线状态
  // - 在线/离线变化时通过 useRuntimeModeStore.setServerOnline 上报（2s 防抖）
  // - 30s 间隔（与 WS ping 间隔一致）
  // - URL 优先用 VITE_WS_URL 推导（同源同端口），fallback 到默认 localhost:3456
  useEffect(() => {
    // Phase 14 C4：从主进程获取动态端口（PORT=0 时由 OS 分配），fallback 到 3456
    const dynamicPort = window.serverPortApi?.getServerPort() ?? 3456
    // 从 VITE_WS_URL（如 ws://localhost:3456/ws）推导 HTTP 健康检查 URL（http://localhost:3456/api/health）
    // Phase 14 B1：prod 模式 file:// 协议下用绝对 URL，dev 模式用相对 host
    const wsUrlBase = (import.meta.env.VITE_WS_URL as string | undefined)
      ?? (typeof window !== 'undefined' && window.location.protocol === 'file:'
        ? `ws://localhost:${dynamicPort}/ws`
        : `ws://${window.location.host}/ws`)
    let healthUrl = typeof window !== 'undefined' && window.location.protocol === 'file:'
      ? `http://localhost:${dynamicPort}/api/health`
      : '/api/health'
    try {
      const u = new URL(wsUrlBase)
      healthUrl = `${u.protocol === 'wss:' ? 'https:' : 'http:'}//${u.host}/api/health`
    } catch {
      // 解析失败用默认值
    }

    const stop = startServerHealthCheck({
      url: healthUrl,
      onOnline: () => useRuntimeModeStore.getState().setServerOnline(true),
      onOffline: () => useRuntimeModeStore.getState().setServerOnline(false),
    })
    return stop
  }, [])

  // Bug 修复：WS 连接状态 → setServerOnline，作为 HTTP 健康检查的补充信号。
  // WS 连接成功意味着 server 已在运行且端口已就绪，比 30s 间隔的 HTTP 检查更及时。
  // setServerOnline 内部有 2s 防抖，与 HTTP 检查的调用不会冲突（取最后一次稳定值）。
  useEffect(() => {
    useRuntimeModeStore.getState().setServerOnline(isWsOnline)
  }, [isWsOnline])

  // Phase 9 批次2 模块3：注册工具执行桥接（监听主进程的 tool:execute:request）
  // 主进程的 LocalAgentService 触发工具调用时，通过 IPC 转发到渲染进程执行
  // （复用 wsToolHandlers.executeToolCall 的 24 个工具 + ask_user 单独处理）
  useEffect(() => {
    const unregister = registerToolBridge()
    return () => unregister()
  }, [])

  // 初始化：两个 store 都初始化完成后，调用 ensurePrimarySession
  useEffect(() => {
    let cancelled = false
    void (async () => {
      // 设置 isInitializing 标志
      useAppStore.setState({ isInitializing: true })
      try {
        // 独立调用 useAIStore.initialize()（避免 AIAssistant widget 内部 initialize 时序问题）
        const aiInitPromise = useAIStore.getState().initialize()
        // 同时调用 useAppStore.initialize()
        const appInitPromise = initialize()
        await Promise.all([aiInitPromise, appInitPromise])
        if (cancelled) return
        // 两个 store 都初始化完成后，调用 ensurePrimarySession
        try {
          // Phase 8 批次3：ensurePrimarySession 需要 panelId 参数；初始化时用 activePanelId
          const activePanelId = useAppStore.getState().activePanelId
          if (activePanelId) {
            await ensurePrimarySession(activePanelId)
          }
        } catch (e) {
          console.error('ensurePrimarySession failed:', e)
        }
      } catch (e) {
        // Phase 15 批次1 任务1.1 对抗审查修复：AI 或 App store 初始化失败时也要解锁
        // 否则 isInitializing 永远为 true，用户卡死在加载屏
        console.error('initialize failed:', e)
      } finally {
        if (!cancelled) {
          useAppStore.setState({ isInitializing: false })
          // Phase 15 批次5：TTI（可交互时间，spec 7.2.4）—— 从渲染进程启动到 isInitializing=false
          console.log(`[Profiling] TTI: ${Math.round(performance.now())}ms (renderer start → interactive)`)
        }
      }
    })()
    return () => { cancelled = true }
  }, [initialize, ensurePrimarySession])

  // Phase 7 批次3 任务6：原 Ctrl+F useEffect 已迁移到 useKeyboardShortcuts hook

  useEffect(() => {
    const saveTransform = () => {
      const { activePanelId, panels, canvasTransform } = useAppStore.getState()
      if (!activePanelId) return
      const panel = panels.find(p => p.id === activePanelId)
      if (!panel) return
      // 同步写入 sessionStorage（最可靠的刷新恢复机制）
      try {
        sessionStorage.setItem(`canvasTransform_${activePanelId}`, JSON.stringify(canvasTransform))
      } catch { /* ignore */ }
      // 保存到 IDB（降级）
      import('./utils/db').then(({ savePanel }) => savePanel({ ...panel, canvasTransform })).catch(() => {})
      // 保存到 API：使用 fetch + keepalive 确保页面卸载时请求仍能发出
      if (getBackend() === 'api') {
        try {
          fetch(`/api/panels/${activePanelId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: panel.name,
              settings: panel.settings as Record<string, unknown>,
              canvasTransform: canvasTransform as Record<string, unknown>,
            }),
            keepalive: true,
          }).catch(() => {})
        } catch { /* ignore */ }
      }
    }
    window.addEventListener('beforeunload', saveTransform)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') saveTransform()
    })
    return () => {
      window.removeEventListener('beforeunload', saveTransform)
    }
  }, [])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return
      e.preventDefault()
    }
    document.addEventListener('contextmenu', handler)
    return () => document.removeEventListener('contextmenu', handler)
  }, [])

  // Phase 2: 监听 webview:open-url IPC（webview 内 window.open 触发的 URL）
  // S1 修复：使用 window.webviewApi.onOpenUrl（返回清理函数，避免内存泄漏）
  // M1 修复：addWidget 用 try/catch 包裹，失败时不影响后续逻辑
  useEffect(() => {
    return window.webviewApi?.onOpenUrl(async (url: string) => {
      const state = useAppStore.getState()
      let panelId = state.activePanelId
      if (!panelId) {
        panelId = await state.addPanel('网页')
      }
      try {
        await state.addWidget('webPage', {
          panelId,
          position: { x: 100, y: 100, w: 480, h: 600 },
          initialState: { url, title: url, schemaVersion: 1 },
        })
      } catch (e) {
        console.error('Failed to open URL in webview:', e)
      }
    })
  }, [])

  // Phase 2: 监听 menu:action IPC
  useEffect(() => {
    return window.menuApi?.onMenuAction((action: string) => {
      switch (action) {
        case 'new-panel':
          void useAppStore.getState().addPanel('新面板').catch(console.error)
          break
        case 'toggle-sidebar':
          useAppStore.getState().toggleSidebar()
          break
        case 'export':
          // 导出功能 - 可后续实现
          break
        case 'import':
          // 导入功能 - 可后续实现
          break
        case 'manage-panels':
          // 面板管理 - 可后续实现
          break
        // Phase 7 批次3 任务6：视图菜单 zoom 通过 IPC 触发，由渲染进程根据作用域处理
        case 'zoom-in': {
          const { mainView: mv, canvasTransform, setCanvasTransform } = useAppStore.getState()
          if (mv.type === 'canvas-panel' || mv.type === 'canvas-home') {
            const z = canvasTransform.zoom ?? 1
            setCanvasTransform({ zoom: Math.min(z * 1.2, 5) })
          }
          break
        }
        case 'zoom-out': {
          const { mainView: mv, canvasTransform, setCanvasTransform } = useAppStore.getState()
          if (mv.type === 'canvas-panel' || mv.type === 'canvas-home') {
            const z = canvasTransform.zoom ?? 1
            setCanvasTransform({ zoom: Math.max(z / 1.2, 0.2) })
          }
          break
        }
        case 'zoom-reset': {
          const { mainView: mv, setCanvasTransform } = useAppStore.getState()
          if (mv.type === 'canvas-panel' || mv.type === 'canvas-home') {
            setCanvasTransform({ zoom: 1 })
          }
          break
        }
        default:
          console.log('Unknown menu action:', action)
      }
    })
  }, [])

  const app = appearance
  const bgType = app?.backgroundType ?? 'color'
  const bgColor = app?.backgroundColor ?? '#f5f5f7'
  const bgGradient = app?.backgroundGradient ?? ''
  const bgImage = app?.backgroundImage ?? ''

  useEffect(() => {
    if (!app) return
    const root = document.documentElement
    const light = isLightTheme(app)

    root.style.setProperty('--bg-canvas', app.backgroundColor)
    root.style.setProperty('--bg-surface', app.surfaceColor)
    root.style.setProperty('--bg-elevated', app.surfaceBorderColor)
    root.style.setProperty('--color-primary', app.accentColor)
    root.style.setProperty('--color-primary-light', app.accentColor)

    root.style.setProperty('--text-primary', app.textColor)
    root.style.setProperty('--text-secondary', app.textMutedColor)
    root.style.setProperty('--font-size-base', app.fontSize + 'px')

    if (light) {
      root.style.setProperty('--bg-hover', 'rgba(0, 0, 0, 0.05)')
      root.style.setProperty('--bg-active', 'rgba(0, 0, 0, 0.08)')
      root.style.setProperty('--border-subtle', 'rgba(0, 0, 0, 0.08)')
      root.style.setProperty('--border-default', 'rgba(0, 0, 0, 0.12)')
      root.style.setProperty('--border-strong', 'rgba(0, 0, 0, 0.18)')
      root.style.setProperty('--shadow-sm', '0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06)')
      root.style.setProperty('--shadow-md', '0 4px 12px rgba(0,0,0,0.1), 0 2px 4px rgba(0,0,0,0.06)')
      root.style.setProperty('--shadow-lg', '0 8px 28px rgba(0,0,0,0.12), 0 4px 8px rgba(0,0,0,0.08)')
      root.style.setProperty('--shadow-xl', '0 16px 40px rgba(0,0,0,0.16), 0 8px 16px rgba(0,0,0,0.1)')
      root.style.setProperty('--interaction-glow', hexToRgba(app.accentColor, 0.3))
      root.style.setProperty('--interaction-glow-subtle', hexToRgba(app.accentColor, 0.12))
      root.style.setProperty('--interaction-glow-hover', hexToRgba(app.accentColor, 0.25))
      root.style.setProperty('--interaction-glow-border', hexToRgba(app.accentColor, 0.5))
      root.style.setProperty('--corner-marker', 'rgba(0, 0, 0, 0.25)')
      root.style.setProperty('--transparent-border', 'rgba(0, 0, 0, 0.10)')
      root.style.setProperty('--toolbar-bg', 'rgba(255, 255, 255, 0.88)')
      root.style.setProperty('--toolbar-border', 'rgba(0, 0, 0, 0.10)')
      root.style.setProperty('--toolbar-text', 'rgba(0, 0, 0, 0.65)')
      root.style.setProperty('--toolbar-text-hover', 'rgba(0, 0, 0, 0.95)')
      root.style.setProperty('--toolbar-sep', 'rgba(0, 0, 0, 0.12)')
      root.style.setProperty('--toolbar-hover-bg', 'rgba(0, 0, 0, 0.06)')
      root.style.setProperty('--toolbar-shadow', '0 8px 32px rgba(0,0,0,0.08), 0 2px 8px rgba(0,0,0,0.04)')
      root.style.setProperty('--overlay-bg', 'rgba(0, 0, 0, 0.35)')
      root.style.setProperty('--locked-hover-border', 'rgba(0, 0, 0, 0.12)')
      root.style.setProperty('--canvas-toolbar-bg', 'rgba(255, 255, 255, 0.85)')
      root.style.setProperty('--shadow-popover', '0 8px 28px rgba(0,0,0,0.10), 0 4px 8px rgba(0,0,0,0.06)')
      root.style.setProperty('--shadow-drag', '0 12px 32px rgba(0,0,0,0.12), 0 4px 8px rgba(0,0,0,0.08)')
      root.style.setProperty('--shadow-glow-color', hexToRgba(app.accentColor, 0.15))
      root.style.setProperty('--color-done', ensureContrast('#34C759', true))
      root.style.setProperty('--bg-gradient-start', '#e8e8f0')
      root.style.setProperty('--bg-gradient-mid', '#dde0f0')
      root.style.setProperty('--bg-gradient-end', '#e5e5ea')
      root.style.setProperty('--color-primary-muted', hexToRgba(app.accentColor, 0.15))
      root.style.setProperty('--text-tertiary', '#adb5bd')
      root.style.setProperty('--bg-secondary', '#e9ecef')
      root.style.setProperty('--border-color', '#dee2e6')
      root.style.setProperty('--color-error-bg', 'rgba(239,68,68,0.12)')
      root.style.setProperty('--color-success-bg', 'rgba(16,185,129,0.12)')
      root.style.setProperty('--color-error-bg-subtle', 'rgba(239,68,68,0.08)')
      root.style.setProperty('--widget-on-surface', '#fff')
    } else {
      root.style.setProperty('--bg-hover', 'rgba(255, 255, 255, 0.06)')
      root.style.setProperty('--bg-active', 'rgba(255, 255, 255, 0.10)')
      root.style.setProperty('--border-subtle', 'rgba(255, 255, 255, 0.08)')
      root.style.setProperty('--border-default', 'rgba(255, 255, 255, 0.12)')
      root.style.setProperty('--border-strong', 'rgba(255, 255, 255, 0.18)')
      root.style.setProperty('--shadow-sm', '0 1px 3px rgba(0,0,0,0.35), 0 1px 2px rgba(0,0,0,0.25)')
      root.style.setProperty('--shadow-md', '0 4px 12px rgba(0,0,0,0.4), 0 2px 4px rgba(0,0,0,0.25)')
      root.style.setProperty('--shadow-lg', '0 8px 28px rgba(0,0,0,0.5), 0 4px 8px rgba(0,0,0,0.3)')
      root.style.setProperty('--shadow-xl', '0 16px 40px rgba(0,0,0,0.55), 0 8px 16px rgba(0,0,0,0.3)')
      root.style.setProperty('--interaction-glow', hexToRgba(app.accentColor, 0.3))
      root.style.setProperty('--interaction-glow-subtle', hexToRgba(app.accentColor, 0.12))
      root.style.setProperty('--interaction-glow-hover', hexToRgba(app.accentColor, 0.25))
      root.style.setProperty('--interaction-glow-border', hexToRgba(app.accentColor, 0.5))
      root.style.setProperty('--corner-marker', 'rgba(255, 255, 255, 0.25)')
      root.style.setProperty('--transparent-border', 'rgba(255, 255, 255, 0.06)')
      root.style.setProperty('--toolbar-bg', 'rgba(28, 28, 30, 0.88)')
      root.style.setProperty('--toolbar-border', 'rgba(255, 255, 255, 0.10)')
      root.style.setProperty('--toolbar-text', 'rgba(255, 255, 255, 0.65)')
      root.style.setProperty('--toolbar-text-hover', 'rgba(255, 255, 255, 0.95)')
      root.style.setProperty('--toolbar-sep', 'rgba(255, 255, 255, 0.12)')
      root.style.setProperty('--toolbar-hover-bg', 'rgba(255, 255, 255, 0.10)')
      root.style.setProperty('--toolbar-shadow', '0 8px 32px rgba(0,0,0,0.4), 0 2px 8px rgba(0,0,0,0.2)')
      root.style.setProperty('--overlay-bg', 'rgba(0, 0, 0, 0.6)')
      root.style.setProperty('--locked-hover-border', 'rgba(255, 255, 255, 0.08)')
      root.style.setProperty('--canvas-toolbar-bg', 'rgba(28, 28, 30, 0.85)')
      root.style.setProperty('--shadow-popover', '0 8px 28px rgba(0,0,0,0.5), 0 4px 8px rgba(0,0,0,0.3)')
      root.style.setProperty('--shadow-drag', '0 12px 32px rgba(0,0,0,0.4), 0 4px 8px rgba(0,0,0,0.2)')
      root.style.setProperty('--shadow-glow-color', hexToRgba(app.accentColor, 0.15))
      root.style.setProperty('--color-done', ensureContrast('#34C759', false))
      root.style.setProperty('--bg-gradient-start', '#1a1a2e')
      root.style.setProperty('--bg-gradient-mid', '#16213e')
      root.style.setProperty('--bg-gradient-end', '#1c1c1e')
      root.style.setProperty('--color-primary-muted', hexToRgba(app.accentColor, 0.15))
      root.style.setProperty('--text-tertiary', '#636366')
      root.style.setProperty('--bg-secondary', '#2a2a4a')
      root.style.setProperty('--border-color', '#3a3a5a')
      root.style.setProperty('--color-error-bg', 'rgba(239,68,68,0.2)')
      root.style.setProperty('--color-success-bg', 'rgba(16,185,129,0.15)')
      root.style.setProperty('--color-error-bg-subtle', 'rgba(239,68,68,0.15)')
      root.style.setProperty('--widget-on-surface', '#fff')
    }
  }, [app])

  // Phase 7 批次4 任务7（spec 6.2.3 节）：应用无障碍设置到 document.documentElement
  // - reduceMotion → data-reduce-motion 属性（CSS 选择器禁用 transition/animation）
  // - highContrast → data-high-contrast 属性（CSS 覆盖高对比度色彩）
  // - fontScale → style.fontSize（基于 rem 自动缩放，spec 实现）
  // - compactMode → data-compact-mode 属性（CSS 减小间距）
  // 启动时 + 变更时都生效，确保即使用户未打开设置面板，无障碍设置也持久应用
  useEffect(() => {
    const root = document.documentElement
    const a = accessibility
    if (!a) return
    // 减弱动画
    if (a.reduceMotion) {
      root.setAttribute('data-reduce-motion', 'true')
    } else {
      root.removeAttribute('data-reduce-motion')
    }
    // 高对比度
    if (a.highContrast) {
      root.setAttribute('data-high-contrast', 'true')
    } else {
      root.removeAttribute('data-high-contrast')
    }
    // 紧凑模式
    if (a.compactMode) {
      root.setAttribute('data-compact-mode', 'true')
    } else {
      root.removeAttribute('data-compact-mode')
    }
    // 字体缩放（80% - 150%）
    // spec 实现：document.documentElement.style.fontSize = `${scale * 100}%`
    // 基于 rem 的样式自动缩放（1rem = 根 font-size，默认 16px）
    const safeScale = typeof a.fontScale === 'number' && a.fontScale >= 0.5 && a.fontScale <= 2.0
      ? a.fontScale
      : 1.0
    root.style.fontSize = `${safeScale * 100}%`
  }, [accessibility])

  const customStyle: React.CSSProperties = {}
  if (bgType === 'color') {
    customStyle.background = bgColor
  } else if (bgType === 'gradient' && bgGradient) {
    customStyle.background = bgGradient
  } else if (bgType === 'image' && bgImage) {
    customStyle.background = `url(${bgImage}) center/cover no-repeat`
  }

  // /migration 路由：直接渲染迁移页面（放在所有 Hooks 之后，避免条件调用 Hook）
  if (window.location.pathname === '/migration') {
    return (
      <Suspense fallback={<SuspenseFallback />}>
        <MigrationPage />
      </Suspense>
    )
  }

  // Phase 13.1.4：Onboarding 门控
  // - onboardingChecked=false：等待 IDB 加载完成，显示加载占位（避免闪烁）
  // - hasCompletedOnboarding=false：首次启动，显示 Onboarding 流程
  // Phase 15 批次1 任务1.1：isInitializing=true 时显示加载占位（initialize 完成前不渲染主界面）
  if (isInitializing || !onboardingChecked) {
    return <SuspenseFallback />
  }
  if (!hasCompletedOnboarding) {
    return (
      <Suspense fallback={<SuspenseFallback />}>
        <Onboarding />
      </Suspense>
    )
  }

  return (
    <div className="app-root" style={customStyle}>
      {/* Phase 13.1.1：自绘标题栏，置于 app-root 最顶部（在 OfflineBanner 之上，与窗口顶边贴合） */}
      <TitleBar />
      {/* Phase 9 批次1 模块8：离线降级 banner，置于 app-topbar 之上（整个应用最顶部） */}
      <OfflineBanner />
      {/* Phase S3 缺口 D：失败操作 UI 提示 banner，与 OfflineBanner 同级（spec 2.4 节） */}
      <SyncFailedBanner />
      {/* Phase 15 任务 2.7-c：app-topbar 已完全移除（TabBar + Omnibox 都迁移进 TitleBar） */}
      {/* 原 app-topbar 内的 ResizableDivider（Omnibox 宽度调整）暂时移除，任务 2.3 会重新引入 */}
      <div className="app-body">
        <Sidebar />
        {/* 批次1: Sidebar 与主区域之间插入 ResizableDivider（vertical = 竖线，col-resize 改变宽度） */}
        {/* 任务 2.3：Sidebar 折叠态（sidebarWidth <= 48）不显示分割线 */}
        {sidebarWidth > 48 && (
          <ResizableDivider
            direction="vertical"
            onResize={(delta) => {
              const current = useAppStore.getState().sidebarWidth
              setSidebarWidth(current + delta)
            }}
            onReset={() => setSidebarWidth(240)}
            minSize={48}
            maxSize={480}
            currentSize={sidebarWidth}
          />
        )}
        <main className="app-main">
          {/* Phase 4 任务 7: 根据 mainView.type 渲染主区域，spec 5.7 节 */}
          {/* Phase 7 批次2 任务1: 主页切换动画（fade + slide，三阶段） */}
          {/* exiting → entering → entered；互斥渲染避免同时挂载两个视图 */}
          <div
            className="view-transition-container"
            style={{ width: "100%", height: "100%", position: "relative" }}
          >
            {exitingView ? (
              <div
                key={`exit-${exitingView.type}${exitingView.tabId ?? ''}${exitingView.panelId ?? ''}`}
                className="view-transition-exiting"
                style={{ width: "100%", height: "100%" }}
              >
                <GlobalErrorBoundary resetKeys={[exitingView.type, exitingView.tabId, exitingView.panelId]}>
                  {exitingView.type === 'web-tab' && <WebTabFullscreen tabId={exitingView.tabId} />}
                  {exitingView.type === 'canvas-panel' && <Workspace />}
                  {exitingView.type === 'browser-home' && <BrowserHome tabId={exitingView.tabId} />}
                  {exitingView.type === 'canvas-home' && <CanvasHome panelId={exitingView.panelId} />}
                </GlobalErrorBoundary>
              </div>
            ) : (
              <div
                key={`display-${displayView.type}${displayView.tabId ?? ''}${displayView.panelId ?? ''}`}
                className={`view-transition-${phase}`}
                style={{ width: "100%", height: "100%" }}
              >
                <GlobalErrorBoundary resetKeys={[displayView.type, displayView.tabId, displayView.panelId]}>
                  {displayView.type === 'web-tab' && <WebTabFullscreen tabId={displayView.tabId} />}
                  {displayView.type === 'canvas-panel' && <Workspace />}
                  {displayView.type === 'browser-home' && <BrowserHome tabId={displayView.tabId} />}
                  {displayView.type === 'canvas-home' && <CanvasHome panelId={displayView.panelId} />}
                </GlobalErrorBoundary>
              </div>
            )}
          </div>
          {showUnifiedToolbar && <UnifiedToolbar />}
          {showSettings && (
            <Suspense fallback={<SuspenseFallback />}>
              <SettingsPanel />
            </Suspense>
          )}
          {showWidgetSearch && (
            <Suspense fallback={<SuspenseFallback />}>
              <WidgetSearch onClose={() => setShowWidgetSearch(false)} />
            </Suspense>
          )}
        </main>
      </div>
      {/* Phase 7 批次2 任务3: Toast 全局容器（根 div 内最外层，fixed 定位） */}
      <Toast />
    </div>
  )
}

/**
 * Phase 4: 网页标签全屏渲染组件
 * web-tab 模式下独立渲染 WebviewWidget（全屏），不是在画布上
 */
function WebTabFullscreen({ tabId }: { tabId?: string }) {
  // Phase 15 批次2 任务2.0：用单次 selector 直接定位 tab，避免订阅整个 webTabs 数组
  const tab = useAppStore(s => s.webTabs.find(t => t.id === tabId))
  if (!tab || !tab.url) return null
  // 复用 WebviewWidget 组件，全屏渲染
  // 注意：WebviewWidget 需要 widgetId/panelId/state/onUpdateState
  // 这里用 tabId 作为 widgetId，panelId 用 'web-tab' 占位
  return (
    <div className="web-tab-fullscreen" style={{ width: '100%', height: '100%' }}>
      <WebviewWidgetFullscreen url={tab.url} title={tab.title} tabId={tab.id} />
    </div>
  )
}

/**
 * 全屏 WebviewWidget 包装器
 * 为 WebviewWidget 提供必要的 props，使其在 web-tab 模式下独立渲染
 */
function WebviewWidgetFullscreen({ url, title, tabId }: { url: string; title: string; tabId: string }) {
  const updateWebTab = useAppStore(s => s.updateWebTab)
  return (
    <GlobalErrorBoundary resetKeys={[url, tabId]}>
      <Suspense fallback={<SuspenseFallback />}>
        <WebviewWidget
          widgetId={`webtab-${tabId}`}
          panelId="web-tab"
          state={{ url, title, schemaVersion: 1 }}
          onUpdateState={(partial) => updateWebTab(tabId, partial as { url?: string; title?: string })}
        />
      </Suspense>
    </GlobalErrorBoundary>
  )
}
