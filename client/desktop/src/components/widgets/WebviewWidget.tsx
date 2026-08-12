// WebviewWidget：Phase 2 浏览器集成的网页组件
// 基于 spec 3.2 节实现，含 F2/F3/S1/S11/S15/S17/F6 等修复
// 注意：Electron 全局命名空间不存在（tsconfig types 仅含 vite/client, node），
//   所有 webview 相关类型从 ../../types/electron 导入

import { useRef, useState, useEffect } from 'react'
import { ArrowLeft, ArrowRight, RotateCw } from 'lucide-react'
import { browserToolBridge, normalizeUrl, isUrl, buildSearchUrl } from '../../utils/browserToolBridge'
import { useAppStore } from '../../stores/useAppStore'
import { showContextMenu } from '../../utils/contextMenu'
import type { WidgetProps } from '../../types'
// Phase 6.1：内存休眠恢复滚动位置（spec 第 6 节）
import { panelMemoryManager } from '../../utils/panelMemoryManager'
import { restoreWebviewScrollY } from '../../utils/panelStatePersistence'
import type {
  WebviewTag,
  DidNavigateEvent,
  DidNavigateInPageEvent,
  LoadCommitEvent,
  DidFailLoadEvent,
  PageTitleUpdatedEvent,
  ConsoleMessageEvent,
  NewWindowEvent,
} from '../../types/electron'

export default function WebviewWidget({ widgetId, panelId, state, onUpdateState }: WidgetProps) {
  const webviewRef = useRef<WebviewTag | null>(null)
  // F2 修复：用 useRef 缓存 onUpdateState，避免内联箭头函数每次渲染新引用导致 useEffect 反复注销/重注册
  const onUpdateStateRef = useRef(onUpdateState)
  onUpdateStateRef.current = onUpdateState
  // L3 修复：state.url 强制类型转换不安全，改为 typeof 守卫
  const initialUrl = typeof state.url === 'string' ? state.url : ''
  const [localUrl, setLocalUrl] = useState(initialUrl)
  const [isLoading, setIsLoading] = useState(false)
  const [canGoBack, setCanGoBack] = useState(false)
  const [canGoForward, setCanGoForward] = useState(false)
  // S15 修复：错误状态 UI
  const [error, setError] = useState<{ message: string; url: string } | null>(null)
  const updateTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // S5 修复：pendingRef 保存待提交的 state，trailing 模式不丢弃更新
  const pendingRef = useRef<Record<string, unknown> | undefined>(undefined)
  // S15 修复：加载超时计时器
  const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // Phase 15 批次2 任务2.0：订阅隐私模式（隐私模式下使用独立 partition）
  const privacyMode = useAppStore(s => s.settings?.behavior?.privacyMode) ?? false

  // S5 修复：节流更新 state 改为 trailing 模式（500ms 内的多次更新合并，最后一次必定刷新）
  // F2 修复：使用 onUpdateStateRef.current 而非 onUpdateState，避免闭包捕获旧引用
  const throttledUpdateState = (partial: Record<string, unknown>) => {
    pendingRef.current = { ...(pendingRef.current ?? {}), ...partial }
    if (updateTimerRef.current) return
    updateTimerRef.current = setTimeout(() => {
      if (pendingRef.current) {
        onUpdateStateRef.current(pendingRef.current)
        pendingRef.current = undefined
      }
      updateTimerRef.current = undefined
    }, 500)
  }

  // 导航
  // Phase 15 批次1 任务1.3：非 URL 输入用当前搜索引擎搜索（不再 fallback about:blank）
  const navigate = (url: string) => {
    const engine = useAppStore.getState().settings.behavior.searchEngine
    const target = isUrl(url) ? normalizeUrl(url) : buildSearchUrl(url, engine)
    const webview = webviewRef.current
    if (webview) {
      webview.loadURL(target)
      setLocalUrl(target)
    }
  }
  const goBack = () => webviewRef.current?.goBack()
  const goForward = () => webviewRef.current?.goForward()
  const reload = () => {
    setError(null)
    webviewRef.current?.reload()
  }

  // F2 修复：拆分为三个独立 useEffect，避免 onUpdateState 变化导致反复注销/重注册
  // useEffect 1：注册 webview 到 browserToolBridge + dom-ready 首次导航（只依赖 widgetId）
  // F3 修复（v8）：在 useEffect 1 中监听 dom-ready 事件触发首次导航，
  //   解决 useEffect 2 在 webview 未就绪时跳过导航导致 webview 永远空白的问题
  // S1 修复（v8）：useEffect 1 只负责注册/注销 webview + dom-ready 首次导航，
  //   不在 cleanup 中提交 state 或清理 timer（state 提交和 timer 清理由 useEffect 3 负责，避免重复）
  useEffect(() => {
    const webview = webviewRef.current
    if (!webview) return
    browserToolBridge.registerWebview(widgetId, webview)
    // F3 修复（v8）：dom-ready 时触发首次导航，确保 webview 不会永远空白
    const onDomReady = () => {
      const url = typeof state.url === 'string' ? state.url : ''
      if (url) {
        try {
          if (webview.getURL() !== url) webview.loadURL(url)
        } catch {
          webview.loadURL(url)
        }
      }
      // Phase 6.1：恢复滚动位置（spec 第 6 节）
      // 面板从休眠恢复后，webview 重新加载，此处恢复之前保存的 scrollY
      try {
        const savedState = panelMemoryManager.getSavedState(panelId)
        if (savedState && typeof savedState.webviewScrollY === 'number' && savedState.webviewScrollY > 0) {
          // 延迟恢复滚动位置，等待页面内容加载完成
          setTimeout(() => {
            void restoreWebviewScrollY(widgetId, savedState.webviewScrollY!)
          }, 300)
        }
      } catch { /* ignore */ }
    }
    webview.addEventListener('dom-ready', onDomReady)
    return () => {
      webview.removeEventListener('dom-ready', onDomReady)
      browserToolBridge.unregisterWebview(widgetId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widgetId])

  // F2 修复：useEffect 2：URL 变化时导航（单独的 useEffect，只依赖 state.url）
  // S1 修复：删除 <webview src> 属性后，完全由此 useEffect 控制 loadURL
  // S18 修复（v7）：用 try/catch 包裹 getURL()，避免 webview 未就绪时抛错；只在 URL 不同时导航，避免频繁 loadURL
  // F3 修复（v8）：catch 块保持 try/catch 跳过未就绪导航，因为 useEffect 1 的 dom-ready 会处理首次导航
  useEffect(() => {
    const webview = webviewRef.current
    if (!webview) return
    const url = typeof state.url === 'string' ? state.url : ''
    if (!url) return
    // S18 修复（v7）：检查 webview 是否正在加载/已加载相同 URL，避免频繁导航
    try {
      if (webview.getURL() !== url) {
        webview.loadURL(url)
      }
    } catch {
      // F3 修复（v8）：webview 未就绪（getURL 抛错），忽略本次导航，由 useEffect 1 的 dom-ready 处理首次导航
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.url])

  // S11 修复（v7）：localUrl 同步 state.url，避免 prop 变化时输入框不更新
  // 场景：AI 调用 browser_navigate 改变了 state.url，但 localUrl 仍是旧值，导致输入框显示旧 URL
  useEffect(() => {
    if (typeof state.url === 'string') setLocalUrl(state.url)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.url])

  // F2 修复：useEffect 3：webview 事件监听（只依赖 widgetId，使用 onUpdateStateRef.current）
  // F2 修复（v7）：所有事件监听器改为 (e: unknown) => void，内部用 `as` 断言为 S17 声明的事件类型
  //   原因：WebviewTag.addEventListener 签名是 (event: string, listener: (e: unknown) => void)，
  //   传入类型化监听器 (e: DidNavigateEvent) => void 会因逆变导致类型不兼容
  useEffect(() => {
    const webview = webviewRef.current
    if (!webview) return

    const onDidNavigate = (e: unknown) => {
      const event = e as DidNavigateEvent
      setLocalUrl(event.url)
      setCanGoBack(webview.canGoBack())
      setCanGoForward(webview.canGoForward())
      throttledUpdateState({ url: event.url })
    }
    const onDidNavigateInPage = (e: unknown) => {
      const event = e as DidNavigateInPageEvent
      setLocalUrl(event.url)
      setCanGoBack(webview.canGoBack())
      setCanGoForward(webview.canGoForward())
      throttledUpdateState({ url: event.url })
    }
    const onTitleChange = (e: unknown) => {
      const event = e as PageTitleUpdatedEvent
      throttledUpdateState({ title: event.title })
    }
    // S15 修复：load-commit 时启动 10s 加载超时计时器
    // M3 修复：只在主框架的 load-commit 上启动超时，子框架（iframe/ad）的 load-commit 不重置主框架超时计时器
    const onLoadCommit = (e: unknown) => {
      const event = e as LoadCommitEvent
      if (!event.isMainFrame) return  // 只处理主框架
      setIsLoading(true)
      setError(null)
      if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current)
      loadTimeoutRef.current = setTimeout(() => {
        setIsLoading(false)
        setError({ message: '加载超时（10s）', url: '' })
      }, 10000)
    }
    // S15 修复：did-finish-load 时清除超时计时器
    const onDidFinishLoad = () => {
      setIsLoading(false)
      if (loadTimeoutRef.current) {
        clearTimeout(loadTimeoutRef.current)
        loadTimeoutRef.current = undefined
      }
    }
    // S15 修复：did-fail-load 事件监听器，显示错误页面
    const onDidFailLoad = (e: unknown) => {
      const event = e as DidFailLoadEvent
      if (!event.isMainFrame) return  // 只处理主框架错误
      setIsLoading(false)
      if (loadTimeoutRef.current) {
        clearTimeout(loadTimeoutRef.current)
        loadTimeoutRef.current = undefined
      }
      setError({ message: event.errorDescription || '加载失败', url: event.validatedURL })
    }
    // console-message：转发到渲染进程 console
    // Phase 15 批次2 任务2.0：dev 环境 1% 采样 warn/log，error 始终转发
    const onConsoleMessage = (e: unknown) => {
      const event = e as ConsoleMessageEvent
      const level = event.level
      const msg = `[webview ${widgetId}] ${event.message}`
      if (level === 2) {
        console.error(msg)  // 始终转发 error
      } else if (import.meta.env.DEV && Math.random() < 0.01) {
        // dev 环境 1% 采样
        if (level === 1) console.warn(msg)
        else console.log(msg)
      }
    }
    // new-window：阻止默认弹窗，交由 main 进程或 webviewApi 处理
    const onNewWindow = (e: unknown) => {
      const event = e as NewWindowEvent
      // 优先通过 webviewApi.onOpenUrl 回调处理（main 进程拦截 new-window 时会调用）
      // 此处仅阻止默认行为，实际打开逻辑由 main 进程的 webContents.on('new-window') 处理
      console.log(`[webview ${widgetId}] new-window: ${event.url}`)
    }

    webview.addEventListener('did-navigate', onDidNavigate as EventListener)
    webview.addEventListener('did-navigate-in-page', onDidNavigateInPage as EventListener)
    webview.addEventListener('page-title-updated', onTitleChange as EventListener)
    webview.addEventListener('load-commit', onLoadCommit as EventListener)
    webview.addEventListener('did-finish-load', onDidFinishLoad as EventListener)
    webview.addEventListener('did-fail-load', onDidFailLoad as EventListener)
    webview.addEventListener('console-message', onConsoleMessage as EventListener)
    webview.addEventListener('new-window', onNewWindow as EventListener)

    return () => {
      webview.removeEventListener('did-navigate', onDidNavigate as EventListener)
      webview.removeEventListener('did-navigate-in-page', onDidNavigateInPage as EventListener)
      webview.removeEventListener('page-title-updated', onTitleChange as EventListener)
      webview.removeEventListener('load-commit', onLoadCommit as EventListener)
      webview.removeEventListener('did-finish-load', onDidFinishLoad as EventListener)
      webview.removeEventListener('did-fail-load', onDidFailLoad as EventListener)
      webview.removeEventListener('console-message', onConsoleMessage as EventListener)
      webview.removeEventListener('new-window', onNewWindow as EventListener)
      // S3 修复：cleanup 中清除 loadTimeoutRef，避免组件卸载后计时器仍触发 setState
      if (loadTimeoutRef.current) {
        clearTimeout(loadTimeoutRef.current)
        loadTimeoutRef.current = undefined
      }
      // S1 修复（v8）：state 提交（pendingRef + updateTimerRef）只放在 useEffect 3 的 cleanup 中
      //   （useEffect 1 的 cleanup 不再提交 state 或清理 timer，避免重复提交）
      if (updateTimerRef.current) {
        clearTimeout(updateTimerRef.current)
        if (pendingRef.current) onUpdateStateRef.current(pendingRef.current)
        pendingRef.current = undefined
      }
      // S1 修复（v8）：不再在此 cleanup 中调用 browserToolBridge.unregisterWebview，
      //   注销由 useEffect 1 的 cleanup 统一负责，避免重复注销
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widgetId])

  // F6 修复：监听 activePanelId 变化，非活跃面板的 webview 暂停网络活动
  // 注意：panelId="web-tab" 表示 WebTabFullscreen 全屏网页模式，始终视为活跃
  const activePanelId = useAppStore(s => s.activePanelId)
  const isActive = panelId === 'web-tab' || activePanelId === panelId

  useEffect(() => {
    const webview = webviewRef.current
    if (!webview) return
    try {
      if (isActive) {
        // 活跃面板：恢复渲染
        webview.style.visibility = 'visible'
      } else {
        // 非活跃面板：暂停网络请求（stop() 停止当前加载和网络活动）
        // 注意：webview 未 dom-ready 时调用 stop() 会抛错，需 try/catch
        webview.stop()
        // 隐藏 webview（visibility:hidden 不影响画布坐标，与 display:none 不同）
        webview.style.visibility = 'hidden'
      }
    } catch {
      // webview 未就绪（未 dom-ready），忽略本次操作
    }
  }, [isActive])

  // S12 修复：合并后的完整 return JSX（统一 3.2 节与 F6 修复节，含 toolbar + error + content(webview + placeholder)）
  // L3 修复：state.url 用 typeof 守卫，不强制 as string
  // S1 修复：currentUrl 变量已删除（不再用于 webview src，URL 导航由 useEffect 2 控制）

  return (
    <div
      className="webview-widget"
      onMouseEnter={() => useAppStore.getState().setLastActiveWidget(widgetId)}
    >
      <div
        className="webview-widget__toolbar"
        data-widget-drag-handle
        onContextMenu={(e) => {
          e.preventDefault()
          void showContextMenu(e, [
            {
              label: '在新标签页打开',
              // S13 修复：捕获 5-webview 限制错误，提示用户
              onClick: () =>
                useAppStore
                  .getState()
                  .convertWidgetToTab(widgetId)
                  .catch((err: unknown) => window.alert((err as Error).message)),
            },
          ])
        }}
      >
        <button onClick={goBack} disabled={!canGoBack} title="后退"><ArrowLeft size={14} /></button>
        <button onClick={goForward} disabled={!canGoForward} title="前进"><ArrowRight size={14} /></button>
        <button onClick={reload} title="刷新"><RotateCw size={14} /></button>
        <input
          className="webview-widget__url-input"
          value={localUrl}
          onChange={(e) => setLocalUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') navigate(localUrl)
          }}
          placeholder="输入 URL"
        />
        {isLoading && <span className="webview-widget__loading">加载中...</span>}
      </div>
      {/* S15 修复：错误状态 UI（错误消息 + 重试按钮） */}
      {error && (
        <div className="webview-widget__error">
          <p>{error.message}</p>
          {error.url && <p className="webview-widget__error-url">{error.url}</p>}
          <button onClick={reload}>重试</button>
        </div>
      )}
      {/* F6 修复：webview 包裹在 content div 中，非活跃时覆盖占位 div */}
      <div className="webview-widget__content" style={{ position: 'relative' }}>
        {/* F7 修复（v9）：恢复 src 属性，确保 webContents 立即初始化、dom-ready 事件正常触发
            之前 S1 修复删除了 src 属性想避免双重导航冲突，但导致 Electron 31 下 webContents
            永远不初始化、dom-ready 永远不触发，形成死锁（白屏 bug 的真正根因）。
            现在用 state.url || 'about:blank' 作为初始 src，useEffect 2 的 getURL() 守卫
            会避免重复导航（src 触发的首次导航后 getURL()===url，loadURL 不会再被调用） */}
        {/* S11 修复：添加 partition 属性，每个 webview 独立 partition 隔离 cookie */}
        {/* Phase 15 批次2 任务2.0：默认共享 partition=persist:webview，隐私模式用独立 partition */}
        <webview
          ref={webviewRef}
          src={typeof state.url === 'string' && state.url ? state.url : 'about:blank'}
          className="webview-widget__webview"
          webpreferences="contextIsolation=yes,nodeIntegration=no,sandbox=yes"
          allowpopups
          partition={privacyMode ? 'persist:webview-private' : 'persist:webview'}
          style={{ visibility: isActive ? 'visible' : 'hidden' }}
        />
        {!isActive && (
          <div
            className="webview-widget__placeholder"
            style={{
              position: 'absolute',
              inset: 0,
              background: 'var(--bg-surface, #f5f5f5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 10,
            }}
          >
            <span>面板未活跃，渲染已暂停</span>
          </div>
        )}
      </div>
    </div>
  )
}
