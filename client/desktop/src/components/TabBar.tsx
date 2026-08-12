// TabBar 组件（顶部网页标签栏）
// Phase 4 改造（spec 5.2/5.5/5.9 节）：
// - 从"画布面板管理"改为"网页标签管理"（使用 webTabs）
// - + 按钮新建网页标签 → 浏览器主页
// - 每个标签加 📌 嵌入按钮（lucide-react Pin 图标）
// - 不再包含 Omnibox（Omnibox 已移到 App.tsx 左上角）
// Phase 7 批次2 任务3: Pin 按钮 loading/success/error 状态 + toast 反馈
// Phase 15 任务 2.7-b：PinButton 从 TabBar 渲染中移除（保留为独立导出组件，后续迁移到 panel toolbar）
//           TabBar 迁移进 TitleBar 中间区域，drag-drop 限制在 tabs 区域
import { useState, useEffect, useRef } from 'react'
import { Plus, X, Pin, Globe, Home, Loader2, Check, AlertCircle } from 'lucide-react'
import { useAppStore } from '../stores/useAppStore'
import { useToastStore } from '../stores/useToastStore'
import { showContextMenu } from '../utils/contextMenu'
// Phase 15 batch4 task4.2: tooltip show shortcut keys
import { getShortcutKeys } from '../hooks/useKeyboardShortcuts'

export default function TabBar() {
  // Phase 4: 改为管理网页标签（webTabs），不再管理画布面板
  const webTabs = useAppStore(s => s.webTabs)
  const activeWebTabId = useAppStore(s => s.activeWebTabId)
  const setActiveWebTab = useAppStore(s => s.setActiveWebTab)
  const addWebTab = useAppStore(s => s.addWebTab)
  const closeWebTab = useAppStore(s => s.closeWebTab)
  const updateWebTab = useAppStore(s => s.updateWebTab)
  const setMainView = useAppStore(s => s.setMainView)
  const addWidget = useAppStore(s => s.addWidget)
  const activePanelId = useAppStore(s => s.activePanelId)
  // Phase 7 批次2 任务3: 上下文菜单嵌入操作的 toast 反馈
  const showToast = useToastStore(s => s.showToast)
  const updateToast = useToastStore(s => s.updateToast)

  // 拖拽重排状态
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null)

  // Phase 4 任务 8（spec 5.9 节）：+ 按钮新建网页标签 → 显示浏览器主页
  const handleNewWebTab = async () => {
    const tabId = await addWebTab()  // 不传 url，显示浏览器主页
    setMainView({ type: 'browser-home', tabId })
  }

  // 点击标签切换
  const handleTabClick = (tabId: string) => {
    setActiveWebTab(tabId)
    const tab = webTabs.find(t => t.id === tabId)
    if (tab?.url) {
      // 有 URL → 显示网页
      setMainView({ type: 'web-tab', tabId })
    } else {
      // 无 URL → 显示浏览器主页
      setMainView({ type: 'browser-home', tabId })
    }
  }

  // 中键关闭标签
  const handleMouseDown = (e: React.MouseEvent, tabId: string) => {
    if (e.button === 1) {  // 中键
      e.preventDefault()
      handleCloseTab(tabId)
    }
  }

  // 关闭标签
  const handleCloseTab = (tabId: string) => {
    void closeWebTab(tabId).then(() => {
      // 关闭后切换到其他标签或浏览器主页
      const remaining = useAppStore.getState().webTabs.filter(t => t.id !== tabId)
      if (remaining.length > 0) {
        const next = remaining[remaining.length - 1]
        setActiveWebTab(next.id)
        if (next.url) {
          setMainView({ type: 'web-tab', tabId: next.id })
        } else {
          setMainView({ type: 'browser-home', tabId: next.id })
        }
      } else {
        // 没有标签了，回到画布
        setMainView({ type: 'canvas-panel' })
      }
    })
  }

  // Phase 4 任务 5（spec 5.5 节）：📌 嵌入按钮
  // 点击嵌入 → 在当前画布面板创建 WebviewWidget，标签不关闭
  // Phase 7 批次2 任务3: 去掉 window.alert，改为 throw Error 由 PinButton 显示 toast
  const handlePinToCanvas = async (tabId: string) => {
    const tab = webTabs.find(t => t.id === tabId)
    if (!tab || !tab.url) {
      throw new Error('请先在标签中打开网页后再嵌入')
    }
    const panelId = activePanelId
    if (!panelId) {
      throw new Error('请先在侧边栏选择一个画布面板')
    }
    await addWidget('webPage', {
      panelId,
      position: { x: 100, y: 100, w: 480, h: 600 },
      initialState: { url: tab.url, title: tab.title, schemaVersion: 1 },
    })
    // 更新 tab.panelId 建立引用（标签不关闭）
    updateWebTab(tabId, { panelId })
  }

  // HTML5 drag and drop 拖拽重排
  // Phase 15 任务 2.7-b：drag-drop 限制在 tabs 区域，避免与窗口控制按钮冲突
  const handleDragStart = (e: React.DragEvent, tabId: string) => {
    // 检查 e.target 是否在 .tab-bar__tabs 内（右侧 138px 窗口按钮区域禁用 drag-drop）
    const target = e.target as HTMLElement
    if (!target.closest('.tab-bar__tabs')) {
      e.preventDefault()
      return
    }
    setDraggedTabId(tabId)
    e.dataTransfer.effectAllowed = 'move'
  }
  const handleDragOver = (e: React.DragEvent, tabId: string) => {
    if (draggedTabId && draggedTabId !== tabId) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
    }
  }
  const handleDrop = (e: React.DragEvent, targetTabId: string) => {
    e.preventDefault()
    if (!draggedTabId || draggedTabId === targetTabId) return
    // 重新排序 webTabs 数组（本地状态，无需持久化）
    const tabs = useAppStore.getState().webTabs
    const newTabs = [...tabs]
    const fromIdx = newTabs.findIndex(t => t.id === draggedTabId)
    const toIdx = newTabs.findIndex(t => t.id === targetTabId)
    if (fromIdx === -1 || toIdx === -1) return
    const [moved] = newTabs.splice(fromIdx, 1)
    newTabs.splice(toIdx, 0, moved)
    // 直接更新 store（webTabs 是本地状态）
    useAppStore.setState({ webTabs: newTabs })
    setDraggedTabId(null)
  }
  const handleDragEnd = () => setDraggedTabId(null)

  return (
    <div className="tab-bar">
      <div className="tab-bar__tabs">
        {webTabs.map(tab => (
          <div
            key={tab.id}
            className={`tab-bar__tab ${tab.id === activeWebTabId ? 'tab-bar__tab--active' : ''}`}
            onClick={() => handleTabClick(tab.id)}
            onMouseDown={(e) => handleMouseDown(e, tab.id)}
            draggable
            onDragStart={(e) => handleDragStart(e, tab.id)}
            onDragOver={(e) => handleDragOver(e, tab.id)}
            onDrop={(e) => handleDrop(e, tab.id)}
            onDragEnd={handleDragEnd}
            onContextMenu={(e) => {
              e.preventDefault()
              const items: Array<{ label: string; onClick: () => void | Promise<void> }> = [
                { label: '关闭', onClick: () => handleCloseTab(tab.id) },
                { label: '嵌入到画布', onClick: async () => {
              const toastId = showToast({ type: 'loading', message: '正在嵌入到画布...' })
              try {
                await handlePinToCanvas(tab.id)
                updateToast(toastId, { type: 'success', message: '已嵌入到画布', duration: 2000 })
              } catch (err) {
                const msg = err instanceof Error ? err.message : '嵌入失败'
                updateToast(toastId, { type: 'error', message: msg, duration: 4000 })
              }
            } },
              ]
              showContextMenu(e, items)
            }}
          >
            {/* 网页图标（favicon 或 lucide-react 图标） */}
            <span className="tab-bar__tab-icon" style={{ display: 'flex', alignItems: 'center' }}>
              {tab.favicon ? (
                <img src={tab.favicon} alt="" style={{ width: 14, height: 14 }} />
              ) : tab.url ? (
                <Globe size={12} />
              ) : (
                <Home size={12} />
              )}
            </span>
            <span className="tab-bar__tab-title">{tab.title || '新标签页'}</span>
            {/* Phase 15 任务 2.7-b：PinButton 已从 TabBar 渲染中移除（保留为独立导出组件，后续迁移到 panel toolbar） */}
            {/* 关闭按钮 */}
            <button
              className="tab-bar__tab-close"
              onClick={(e) => {
                e.stopPropagation()
                handleCloseTab(tab.id)
              }}
              title={`关闭标签 (${getShortcutKeys('close-tab')})`}
              style={{
                border: 'none',
                background: 'transparent',
                color: 'var(--text-tertiary)',
                cursor: 'pointer',
                padding: 2,
                display: 'flex',
                alignItems: 'center',
                borderRadius: 3,
              }}
            >
              <X size={12} />
            </button>
          </div>
        ))}
        {/* + 按钮新建网页标签（Phase 4 任务 8: → 浏览器主页） */}
        <button
          className="tab-bar__new-btn"
          onClick={handleNewWebTab}
          title={`新建网页标签 (${getShortcutKeys('new-web-tab')})`}
          style={{
            border: 'none',
            background: 'transparent',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            padding: '4px 8px',
            display: 'flex',
            alignItems: 'center',
            borderRadius: 4,
          }}
        >
          <Plus size={14} />
        </button>
      </div>
    </div>
  )
}

/**
 * Phase 7 批次2 任务3: Pin 按钮子组件
 *
 * 每个标签独立管理 pinState，避免多 tab 共享状态。
 * - idle：默认色 Pin 图标；已嵌入（tabPanelId 存在）则绿色实心 Pin
 * - loading：Loader2 旋转动画
 * - success：绿色 Check 图标 + 短暂抖动
 * - error：红色 AlertCircle 图标 + 短暂抖动
 *
 * setTimeout 有 cleanup，避免 setState on unmounted。
 *
 * Phase 15 任务 2.7-b：PinButton 已从 TabBar 渲染中移除，保留为独立导出组件。
 * 后续会迁移到 panel toolbar（画布模式下显示）。
 */
type PinState = 'idle' | 'loading' | 'success' | 'error'

interface PinButtonProps {
  tabId: string
  /** tab.panelId，存在表示已嵌入到画布 */
  tabPanelId?: string
  /** 实际嵌入操作（失败时 throw Error） */
  onPin: (tabId: string) => Promise<void>
}

export function PinButton({ tabId, tabPanelId, onPin }: PinButtonProps) {
  const [pinState, setPinState] = useState<PinState>('idle')
  const pinTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showToast = useToastStore((s) => s.showToast)
  const updateToast = useToastStore((s) => s.updateToast)

  // cleanup timeout，避免 setState on unmounted
  useEffect(() => {
    return () => {
      if (pinTimeoutRef.current) {
        clearTimeout(pinTimeoutRef.current)
        pinTimeoutRef.current = null
      }
    }
  }, [])

  const handleClick = async () => {
    if (pinState === 'loading') return // loading 时禁止重复点击
    setPinState('loading')
    const toastId = showToast({ type: 'loading', message: '正在嵌入到画布...' })
    try {
      await onPin(tabId)
      setPinState('success')
      updateToast(toastId, { type: 'success', message: '已嵌入到画布', duration: 2000 })
      pinTimeoutRef.current = setTimeout(() => setPinState('idle'), 1500)
    } catch (err) {
      setPinState('error')
      const msg = err instanceof Error ? err.message : '嵌入失败'
      updateToast(toastId, { type: 'error', message: msg, duration: 4000 })
      pinTimeoutRef.current = setTimeout(() => setPinState('idle'), 1500)
    }
  }

  // 图标按状态渲染
  const iconNode = (() => {
    switch (pinState) {
      case 'loading':
        return <Loader2 size={12} className="animate-spin" />
      case 'success':
        return <Check size={12} />
      case 'error':
        return <AlertCircle size={12} />
      case 'idle':
      default:
        // 已嵌入：绿色实心 Pin；未嵌入：默认描边 Pin
        return tabPanelId ? (
          <Pin size={12} fill="currentColor" />
        ) : (
          <Pin size={12} />
        )
    }
  })()

  // 按钮颜色按状态映射
  const buttonColor = (() => {
    switch (pinState) {
      case 'success':
        return 'var(--color-success)'
      case 'error':
        return 'var(--color-error)'
      case 'idle':
        return tabPanelId ? 'var(--color-success)' : 'var(--text-tertiary)'
      default:
        return 'var(--text-tertiary)'
    }
  })()

  const title = (() => {
    switch (pinState) {
      case 'loading':
        return '正在嵌入...'
      case 'success':
        return '已嵌入'
      case 'error':
        return '嵌入失败'
      case 'idle':
      default:
        return tabPanelId ? '已嵌入到画布' : '嵌入到画布'
    }
  })()

  return (
    <button
      className={`tab-bar__tab-pin${pinState === 'success' || pinState === 'error' ? ' tab-bar__tab-pin--shake' : ''}`}
      onClick={(e) => {
        e.stopPropagation()
        void handleClick()
      }}
      title={title}
      style={{
        border: 'none',
        background: 'transparent',
        color: buttonColor,
        cursor: pinState === 'loading' ? 'wait' : 'pointer',
        padding: 2,
        display: 'flex',
        alignItems: 'center',
        borderRadius: 3,
      }}
    >
      {iconNode}
    </button>
  )
}
