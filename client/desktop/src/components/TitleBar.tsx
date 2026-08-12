/**
 * TitleBar — Phase 13.1.1 自绘标题栏
 *
 * 替换 Windows 原生标题栏，配合主进程的 frame: false + titleBarOverlay 兜底：
 * - 高度 40px，背景用 CSS 变量（Phase 15 任务 2.7-d 主题跟随 appearance）
 * - 整条标题栏 -webkit-app-region: drag（可拖拽移动窗口）
 * - 右侧三个按钮 -webkit-app-region: no-drag（可点击）
 * - 关闭按钮 hover 红色背景（Windows 风格）
 * - 双击标题栏区域切换最大化（Windows 风格）
 * - isMaximized 状态通过 windowApi.onMaximizeChange 监听主进程推送
 *
 * Phase 15 任务 2.7-b/c/d：Chrome 风格三段式布局
 * - 左：汉堡菜单 + 当前 tab 标题（2.7-d 增强）
 * - 中：TabBar（flex: 1，drag-drop 限制在 tabs 区域）
 * - 右1：Omnibox（flex: 0 1 480px）
 * - 右2：窗口控制按钮（固定宽度 138px = 3 按钮 × 46px）
 *
 * 设计参考：docs/ui-prototype/desktop/index.html 深色主题（#1e1e2e + #cdd6f4）
 */

import { useState, useEffect, useCallback, useRef, type ReactElement } from 'react'
import { Minus, Square, X, Copy, Menu, Plus, PanelLeft, ZoomIn, ZoomOut, RotateCcw, Settings } from 'lucide-react'
// Phase 15 任务 2.7-b：TabBar 迁移进 TitleBar 中间区域
import TabBar from './TabBar'
// Phase 15 任务 2.7-c：Omnibox 迁移进 TitleBar（在 tabs 右侧、窗口控制按钮左侧）
import Omnibox from './Omnibox'
// Phase 15 任务 2.7-d：订阅 mainView/webTabs/panels 显示当前 tab 标题
import { useAppStore } from '../stores/useAppStore'

const TITLEBAR_HEIGHT = 40

function TitleBarImpl(): ReactElement {
  // isMaximized：跟踪窗口最大化状态（用于切换 maximize 按钮图标：□ ↔ ▢）
  // 初始 false，useEffect 中通过 windowApi.isMaximized() 同步真实状态
  const [isMaximized, setIsMaximized] = useState<boolean>(false)
  // Phase 15 任务 2.7-d：汉堡菜单 dropdown 显示状态
  const [menuOpen, setMenuOpen] = useState<boolean>(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Phase 15 任务 2.7-d：订阅 mainView/webTabs/panels/activeWebTabId/activePanelId 显示当前 tab 标题
  const mainView = useAppStore(s => s.mainView)
  const webTabs = useAppStore(s => s.webTabs)
  const activeWebTabId = useAppStore(s => s.activeWebTabId)
  const panels = useAppStore(s => s.panels)
  const activePanelId = useAppStore(s => s.activePanelId)

  useEffect(() => {
    // 初始渲染：查询当前窗口最大化状态
    void window.windowApi?.isMaximized().then(setIsMaximized).catch(() => {})
    // 订阅主进程 maximize/unmaximize 事件推送
    // onMaximizeChange 返回清理函数（与 menuApi.onMenuAction 同模式）
    const unsubscribe = window.windowApi?.onMaximizeChange((next) => {
      setIsMaximized(next)
    })
    return () => {
      unsubscribe?.()
    }
  }, [])

  // Phase 15 任务 2.7-d：点击外部关闭汉堡菜单 dropdown
  useEffect(() => {
    if (!menuOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [menuOpen])

  const handleMinimize = useCallback((): void => {
    void window.windowApi?.minimize()
  }, [])

  const handleMaximizeToggle = useCallback((): void => {
    void window.windowApi?.maximizeToggle()
  }, [])

  const handleClose = useCallback((): void => {
    void window.windowApi?.close()
  }, [])

  // 双击标题栏区域切换最大化（Windows 原生标题栏行为）
  // 仅在标题栏主体（非按钮区域）双击触发；按钮自身 stopPropagation 防止误触
  const handleDoubleClick = useCallback((): void => {
    void window.windowApi?.maximizeToggle()
  }, [])

  // Phase 15 任务 2.7-d：计算当前 tab 标题（按 mainView.type 分支）
  const currentTitle = (() => {
    switch (mainView.type) {
      case 'web-tab': {
        // web-tab 模式：显示当前 tab title
        const tabId = mainView.tabId ?? activeWebTabId
        const tab = webTabs.find(t => t.id === tabId)
        return tab?.title || '新标签页'
      }
      case 'canvas-panel': {
        // canvas-panel 模式：显示当前面板名
        const panelId = mainView.panelId ?? activePanelId
        const panel = panels.find(p => p.id === panelId)
        return panel?.name || '画布面板'
      }
      case 'canvas-home':
        // canvas-home 模式：显示 "Daily"
        return 'Daily'
      case 'browser-home':
        // browser-home 模式：显示 "Daily"
        return 'Daily'
      default:
        return 'Daily'
    }
  })()

  // Phase 15 任务 2.7-d：汉堡菜单项操作
  const handleNewPanel = useCallback(() => {
    setMenuOpen(false)
    void useAppStore.getState().addPanel('新面板').catch(console.error)
  }, [])

  const handleToggleSidebar = useCallback(() => {
    setMenuOpen(false)
    useAppStore.getState().toggleSidebar()
  }, [])

  const handleZoomIn = useCallback(() => {
    setMenuOpen(false)
    const { canvasTransform, setCanvasTransform } = useAppStore.getState()
    const z = canvasTransform.zoom ?? 1
    setCanvasTransform({ zoom: Math.min(z * 1.2, 5) })
  }, [])

  const handleZoomOut = useCallback(() => {
    setMenuOpen(false)
    const { canvasTransform, setCanvasTransform } = useAppStore.getState()
    const z = canvasTransform.zoom ?? 1
    setCanvasTransform({ zoom: Math.max(z / 1.2, 0.2) })
  }, [])

  const handleZoomReset = useCallback(() => {
    setMenuOpen(false)
    useAppStore.getState().setCanvasTransform({ zoom: 1 })
  }, [])

  const handleOpenSettings = useCallback(() => {
    setMenuOpen(false)
    useAppStore.setState({ showSettings: true })
  }, [])

  // canvas 模式下才显示视图缩放菜单项
  const isCanvasMode = mainView.type === 'canvas-panel' || mainView.type === 'canvas-home'

  return (
    <div
      className="titlebar"
      role="banner"
      aria-label="应用标题栏"
      style={{ height: TITLEBAR_HEIGHT }}
      onDoubleClick={handleDoubleClick}
    >
      {/* 左侧：汉堡菜单 + 当前 tab 标题（Phase 15 任务 2.7-d 增强） */}
      <div className="titlebar-left" ref={menuRef}>
        <button
          type="button"
          className="titlebar-menu-btn"
          aria-label="菜单"
          title="菜单"
          onClick={(e) => {
            e.stopPropagation()
            setMenuOpen(prev => !prev)
          }}
        >
          <Menu size={16} strokeWidth={1.5} />
        </button>
        {menuOpen && (
          <div className="titlebar-menu-dropdown" role="menu">
            <button type="button" className="titlebar-menu-item" role="menuitem" onClick={handleNewPanel}>
              <Plus size={14} strokeWidth={1.5} />
              <span>新建面板</span>
            </button>
            <button type="button" className="titlebar-menu-item" role="menuitem" onClick={handleToggleSidebar}>
              <PanelLeft size={14} strokeWidth={1.5} />
              <span>切换侧边栏</span>
            </button>
            {isCanvasMode && (
              <>
                <div className="titlebar-menu-divider" />
                <button type="button" className="titlebar-menu-item" role="menuitem" onClick={handleZoomIn}>
                  <ZoomIn size={14} strokeWidth={1.5} />
                  <span>放大</span>
                </button>
                <button type="button" className="titlebar-menu-item" role="menuitem" onClick={handleZoomOut}>
                  <ZoomOut size={14} strokeWidth={1.5} />
                  <span>缩小</span>
                </button>
                <button type="button" className="titlebar-menu-item" role="menuitem" onClick={handleZoomReset}>
                  <RotateCcw size={14} strokeWidth={1.5} />
                  <span>重置缩放</span>
                </button>
              </>
            )}
            <div className="titlebar-menu-divider" />
            <button type="button" className="titlebar-menu-item" role="menuitem" onClick={handleOpenSettings}>
              <Settings size={14} strokeWidth={1.5} />
              <span>设置</span>
            </button>
          </div>
        )}
        <div className="titlebar-title" title={currentTitle}>
          {currentTitle}
        </div>
      </div>

      {/* 中间：TabBar（Phase 15 任务 2.7-b 迁移进 TitleBar，flex: 1 占据中间空间） */}
      {/* TabBar 内部 drag-drop 限制在 tabs 区域，右侧窗口按钮区域禁用 drag-drop */}
      <div className="titlebar-center">
        <TabBar />
      </div>

      {/* Phase 15 任务 2.7-c：Omnibox 迁移进 TitleBar（在 tabs 右侧、窗口控制按钮左侧） */}
      {/* Omnibox 用 flex: 0 1 480px，占据 tabs 和窗口按钮之间的空间 */}
      <div className="titlebar-omnibox">
        <Omnibox />
      </div>

      {/* 右侧：窗口控制按钮（no-drag 区域，可点击；stopPropagation 防止冒泡到 onDoubleClick） */}
      <div className="titlebar-controls">
        <button
          type="button"
          className="titlebar-button titlebar-button--minimize"
          aria-label="最小化"
          onClick={(e) => {
            e.stopPropagation()
            handleMinimize()
          }}
        >
          <Minus size={16} strokeWidth={1.5} />
        </button>
        <button
          type="button"
          className="titlebar-button titlebar-button--maximize"
          aria-label={isMaximized ? '还原' : '最大化'}
          onClick={(e) => {
            e.stopPropagation()
            handleMaximizeToggle()
          }}
        >
          {isMaximized ? <Copy size={14} strokeWidth={1.5} /> : <Square size={14} strokeWidth={1.5} />}
        </button>
        <button
          type="button"
          className="titlebar-button titlebar-button--close"
          aria-label="关闭"
          onClick={(e) => {
            e.stopPropagation()
            handleClose()
          }}
        >
          <X size={16} strokeWidth={1.5} />
        </button>
      </div>
    </div>
  )
}

export const TitleBar = TitleBarImpl
export default TitleBar
