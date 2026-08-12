import { useState, useRef, useEffect, useMemo } from 'react'
import { Pencil, Maximize2, Minimize2, Eye, Slash, ArrowRight, Square, Circle, Type, MousePointer2, Hand, Eraser, Spline, Undo2, Redo2, Plus, ZoomIn, ZoomOut, MapPin, Settings, ChevronDown } from 'lucide-react'
import { useAppStore } from '../stores/useAppStore'
import { getAllWidgetConfigs } from '../registry'
import { widgetDefinitionMap } from '../registry/widgetDefinitions'
import { DrawingSettingsPopover } from './DrawingSettingsPopover'
import { getViewportCenterCanvas } from '../utils/canvasCoords'
import type { CanvasMode, DrawingStrokeType, WidgetConfig } from '../types'
import type { WidgetCategory } from '../types/v2'

const CATEGORY_ORDER: WidgetCategory[] = ['basic', 'work', 'life', 'media', 'stats', 'ai', 'study', 'fun', 'web']
const CATEGORY_LABELS: Record<string, string> = {
  basic: '基础组件',
  work: '时间与任务',
  life: '生活与健康',
  media: '媒体与阅读',
  stats: '统计面板',
  ai: 'AI 助手',
  study: '学习工具',
  fun: '趣味',
  web: '浏览器',
}

const EMPTY_BOOKMARKS: { name: string; x: number; y: number; zoom: number }[] = []

interface PopoverProps {
  anchorRef: React.RefObject<HTMLButtonElement | null>
  onClose: () => void
  children: React.ReactNode
}

function Popover({ anchorRef, onClose, children }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && ref.current.contains(e.target as Node)) return
      if (anchorRef.current && anchorRef.current.contains(e.target as Node)) return
      onClose()
    }
    const timer = setTimeout(() => document.addEventListener('mousedown', handler), 0)
    return () => { clearTimeout(timer); document.removeEventListener('mousedown', handler) }
  }, [anchorRef, onClose])

  return (
    <div ref={ref} className="unified-toolbar-popover" onClick={e => e.stopPropagation()}>
      {children}
    </div>
  )
}

export default function UnifiedToolbar() {
  const activePanelId = useAppStore(s => s.activePanelId)
  const mode = useAppStore(s => (activePanelId ? (s.canvasMode[activePanelId] ?? 'select') : 'select') as CanvasMode)
  const drawingTool = useAppStore(s => s.drawingTool)
  const setCanvasMode = useAppStore(s => s.setCanvasMode)
  const setDrawingTool = useAppStore(s => s.setDrawingTool)
  const canvasTransform = useAppStore(s => s.canvasTransform)
  const setCanvasTransform = useAppStore(s => s.setCanvasTransform)
  const addWidget = useAppStore(s => s.addWidget)
  const undo = useAppStore(s => s.undo)
  const redo = useAppStore(s => s.redo)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const bookmarks = useAppStore(s => activePanelId ? (s.canvasBookmarks[activePanelId] ?? EMPTY_BOOKMARKS) : EMPTY_BOOKMARKS)
  const addCanvasBookmark = useAppStore(s => s.addCanvasBookmark)
  const removeCanvasBookmark = useAppStore(s => s.removeCanvasBookmark)
  const hideConnections = useAppStore(s => s.hideConnections)
  const hideAIAssistant = useAppStore(s => s.hideAIAssistant)
  const toggleHideConnections = useAppStore(s => s.toggleHideConnections)
  const toggleHideAIAssistant = useAppStore(s => s.toggleHideAIAssistant)
  // Phase 4: 移除 appMode/setAppMode/needsPrimaryAIMigration/migratePrimaryAI 引用

  // Popover states
  const [addWidgetOpen, setAddWidgetOpen] = useState(false)
  const [drawPopoverOpen, setDrawPopoverOpen] = useState(false)
  const [teleportOpen, setTeleportOpen] = useState(false)
  const [viewPopoverOpen, setViewPopoverOpen] = useState(false)
  const [widgetSearch, setWidgetSearch] = useState('')
  const [teleportX, setTeleportX] = useState('')
  const [teleportY, setTeleportY] = useState('')
  const [bookmarkName, setBookmarkName] = useState('')

  const addBtnRef = useRef<HTMLButtonElement>(null)
  const drawBtnRef = useRef<HTMLButtonElement>(null)
  const teleportBtnRef = useRef<HTMLButtonElement>(null)
  const viewBtnRef = useRef<HTMLButtonElement>(null)
  const widgetInputRef = useRef<HTMLInputElement>(null)

  // Widget menu grouped
  const grouped = useMemo(() => {
    const configs = getAllWidgetConfigs()
    const filtered = widgetSearch.trim()
      ? configs.filter(c => c.displayName.toLowerCase().includes(widgetSearch.trim().toLowerCase()))
      : configs
    return filtered.reduce((acc, config) => {
      const def = widgetDefinitionMap.get(config.widgetType)
      const category = def?.category ?? 'basic'
      if (!acc[category]) acc[category] = []
      acc[category].push(config)
      return acc
    }, {} as Record<string, WidgetConfig[]>)
  }, [widgetSearch])

  // Focus search input when add widget opens
  useEffect(() => {
    if (addWidgetOpen) {
      setTimeout(() => widgetInputRef.current?.focus(), 0)
    }
  }, [addWidgetOpen])

  // 更新 undo/redo 状态（避免 useSyncExternalStore 无限循环）
  useEffect(() => {
    const update = () => {
      setCanUndo(useAppStore.getState().canUndo())
      setCanRedo(useAppStore.getState().canRedo())
    }
    update()
    const unsub = useAppStore.subscribe(update)
    return unsub
  }, [])

  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  // Phase 15 批次1 任务1.4：getBoundingClientRect 移到 useEffect，避免渲染期间同步调用导致 layout thrashing
  // 原代码在函数体中同步调用 getBoundingClientRect() 触发浏览器强制重排，每次渲染都阻塞主线程
  // 现在用 useState + useEffect，在浏览器绘制后异步计算，不阻塞当前帧渲染
  // 注意：Hooks 必须在 early return 之前调用，否则违反 React Hooks 规则
  const [viewportCenterCanvas, setViewportCenterCanvas] = useState({ x: 0, y: 0 })
  useEffect(() => {
    if (!activePanelId) return
    const ccRect = document.querySelector('.panel-layer--active .canvas-container')?.getBoundingClientRect() ?? null
    if (ccRect) {
      const vc = getViewportCenterCanvas(ccRect, canvasTransform.zoom, window.innerWidth, window.innerHeight)
      setViewportCenterCanvas(vc)
    } else {
      setViewportCenterCanvas({ x: 0, y: 0 })
    }
  }, [canvasTransform, activePanelId])
  const viewportCenterCanvasX = viewportCenterCanvas.x
  const viewportCenterCanvasY = viewportCenterCanvas.y

  if (!activePanelId) return null

  const setMode = (m: CanvasMode) => {
    setCanvasMode(activePanelId, m)
  }

  const setTool = (tool: DrawingStrokeType) => {
    setDrawingTool(tool)
    setMode('draw')
    setDrawPopoverOpen(false)
  }

  const handleTeleport = () => {
    const x = parseFloat(teleportX)
    const y = parseFloat(teleportY)
    if (!isNaN(x) && !isNaN(y)) {
      useAppStore.getState().teleportTo(x, y)
      setTeleportOpen(false)
      setTeleportX('')
      setTeleportY('')
    }
  }

  const openSettings = () => {
    useAppStore.setState({ showSettings: true })
  }

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen()
    } else {
      document.documentElement.requestFullscreen().catch(() => {})
    }
  }

  const zoomPercent = Math.round(canvasTransform.zoom * 100)

  return (
    <div className="unified-toolbar-container">
      <div className="unified-toolbar">
        {/* Canvas mode tools（Phase 4: 始终显示，移除 appMode 条件） */}
        <button
          className={`unified-toolbar-btn ${mode === 'select' ? 'is-active' : ''}`}
          onClick={() => setMode('select')}
          title="选择 (V)"
        >
          {/* 选择工具：箭头光标 */}
          <MousePointer2 size={14} />
          <span className="unified-toolbar-btn-label">选择</span>
        </button>

        <button
          className={`unified-toolbar-btn ${mode === 'pan' ? 'is-active' : ''}`}
          onClick={() => setMode('pan')}
          title="拖动 (H)"
        >
          {/* 拖动工具：手形 */}
          <Hand size={14} />
          <span className="unified-toolbar-btn-label">拖动</span>
        </button>

        <button
          ref={drawBtnRef}
          className={`unified-toolbar-btn ${mode === 'draw' ? 'is-active' : ''}`}
          onClick={() => {
            if (mode === 'draw') {
              setDrawPopoverOpen(!drawPopoverOpen)
            } else {
              setTool('freehand')
            }
            setAddWidgetOpen(false); setTeleportOpen(false); setViewPopoverOpen(false)
          }}
          title="画笔 (P)"
        >
          {/* 画笔工具 */}
          <Pencil size={14} />
          <span className="unified-toolbar-btn-label">画笔</span>
          {/* 下拉箭头 */}
          <ChevronDown size={10} />
        </button>

        <button
          className={`unified-toolbar-btn ${mode === 'erase' ? 'is-active' : ''}`}
          onClick={() => setMode('erase')}
          title="橡皮 (E)"
        >
          {/* 橡皮擦工具 */}
          <Eraser size={14} />
          <span className="unified-toolbar-btn-label">橡皮</span>
        </button>

        <button
          className={`unified-toolbar-btn ${mode === 'connect' ? 'is-active' : ''}`}
          onClick={() => setMode('connect')}
          title="连线 (C)"
        >
          {/* 连线工具 */}
          <Spline size={14} />
          <span className="unified-toolbar-btn-label">连线</span>
        </button>

        <div className="unified-toolbar-sep" />

        {/* Undo/Redo */}
        <button
          className="unified-toolbar-btn"
          onClick={() => void undo()}
          disabled={!canUndo}
          title="撤销 (Ctrl+Z)"
        >
          {/* 撤销 */}
          <Undo2 size={14} />
        </button>

        <button
          className="unified-toolbar-btn"
          onClick={() => void redo()}
          disabled={!canRedo}
          title="重做 (Ctrl+Y)"
        >
          {/* 重做 */}
          <Redo2 size={14} />
        </button>

        <div className="unified-toolbar-sep" />

        {/* Add widget */}
        <button
          ref={addBtnRef}
          className={`unified-toolbar-btn ${addWidgetOpen ? 'is-active' : ''}`}
          onClick={() => { setAddWidgetOpen(!addWidgetOpen); setDrawPopoverOpen(false); setTeleportOpen(false); setViewPopoverOpen(false) }}
          title="添加组件"
        >
          {/* 添加组件：保留原加粗描边以维持视觉权重 */}
          <Plus size={14} strokeWidth={2.5} />
          <span className="unified-toolbar-btn-label">添加</span>
        </button>

        <div className="unified-toolbar-sep" />

        {/* Zoom controls */}
        <button
          className="unified-toolbar-btn"
          onClick={() => setCanvasTransform({ zoom: Math.max(0.2, canvasTransform.zoom - 0.1) })}
          title="缩小"
        >
          {/* 缩小 */}
          <ZoomOut size={14} />
        </button>

        <button
          className="unified-toolbar-btn unified-toolbar-zoom"
          onClick={() => setCanvasTransform({ x: 0, y: 0, zoom: 1 })}
          title="重置缩放"
        >
          {zoomPercent}%
        </button>

        <button
          className="unified-toolbar-btn"
          onClick={() => setCanvasTransform({ zoom: Math.min(3, canvasTransform.zoom + 0.1) })}
          title="放大"
        >
          {/* 放大 */}
          <ZoomIn size={14} />
        </button>

        <div className="unified-toolbar-sep" />

        {/* Teleport */}
        <button
          ref={teleportBtnRef}
          className={`unified-toolbar-btn ${teleportOpen ? 'is-active' : ''}`}
          onClick={() => { setTeleportOpen(!teleportOpen); setAddWidgetOpen(false); setDrawPopoverOpen(false); setViewPopoverOpen(false) }}
          title="坐标传送"
        >
          {/* 坐标传送：地图定位针 */}
          <MapPin size={14} />
        </button>

        <div className="unified-toolbar-sep" />

        {/* Fullscreen */}
        <button
          className="unified-toolbar-btn"
          onClick={toggleFullscreen}
          title={isFullscreen ? '退出全屏' : '全屏'}
        >
          {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>

        <div className="unified-toolbar-sep" />

        {/* View toggles */}
        <button
          ref={viewBtnRef}
          className={`unified-toolbar-btn ${viewPopoverOpen ? 'is-active' : ''}`}
          onClick={() => { setViewPopoverOpen(!viewPopoverOpen); setAddWidgetOpen(false); setDrawPopoverOpen(false); setTeleportOpen(false) }}
          title="视图"
        >
          <Eye size={14} />
          <span className="unified-toolbar-btn-label">视图</span>
        </button>

        <div className="unified-toolbar-sep" />

        {/* Settings（Phase 4: 移除模式切换按钮和迁移按钮） */}
        <button
          className="unified-toolbar-btn"
          onClick={openSettings}
          title="设置"
        >
          {/* 设置：齿轮 */}
          <Settings size={14} />
        </button>
      </div>

      {/* Drawing settings when in draw mode */}
      {mode === 'draw' && <DrawingSettingsPopover />}

      {/* Draw tool popover */}
      {drawPopoverOpen && (
        <Popover anchorRef={drawBtnRef} onClose={() => setDrawPopoverOpen(false)}>
          <div className="unified-toolbar-popover__section">
            <span className="unified-toolbar-popover__label">绘图工具</span>
            {([
              { tool: 'freehand' as DrawingStrokeType, label: '画笔', shortcut: 'P', icon: <Pencil size={14} /> },
              { tool: 'line' as DrawingStrokeType, label: '直线', shortcut: 'L', icon: <Slash size={14} /> },
              { tool: 'arrow' as DrawingStrokeType, label: '箭头', shortcut: 'A', icon: <ArrowRight size={14} /> },
              { tool: 'rect' as DrawingStrokeType, label: '矩形', shortcut: 'R', icon: <Square size={14} /> },
              { tool: 'ellipse' as DrawingStrokeType, label: '椭圆', shortcut: 'O', icon: <Circle size={14} /> },
              { tool: 'text' as DrawingStrokeType, label: '文本', shortcut: 'T', icon: <Type size={14} /> },
            ]).map(item => (
              <button
                key={item.tool}
                className={`unified-toolbar-popover__item ${mode === 'draw' && drawingTool === item.tool ? 'is-active' : ''}`}
                onClick={() => setTool(item.tool)}
              >
                <span className="unified-toolbar-popover__item-icon">{item.icon}</span>
                <span className="unified-toolbar-popover__item-text">{item.label}</span>
                <span className="unified-toolbar-popover__item-shortcut">{item.shortcut}</span>
              </button>
            ))}
          </div>
        </Popover>
      )}

      {/* Add widget popover */}
      {addWidgetOpen && (
        <Popover anchorRef={addBtnRef} onClose={() => { setAddWidgetOpen(false); setWidgetSearch('') }}>
          <input
            ref={widgetInputRef}
            className="unified-toolbar-popover__search"
            type="text"
            placeholder="搜索组件…"
            value={widgetSearch}
            onChange={e => setWidgetSearch(e.target.value)}
          />
          <div className="unified-toolbar-popover__scroll">
            {CATEGORY_ORDER.map(cat => {
              const items = grouped[cat]
              if (!items || items.length === 0) return null
              return (
                <div key={cat}>
                  <div className="unified-toolbar-popover__label">{CATEGORY_LABELS[cat] ?? cat}</div>
                  {items.map(opt => (
                    <button
                      key={opt.widgetType}
                      className="unified-toolbar-popover__item"
                      onClick={() => { addWidget(opt.widgetType); setAddWidgetOpen(false); setWidgetSearch('') }}
                    >
                      <span className="unified-toolbar-popover__item-icon">{opt.icon}</span>
                      <span className="unified-toolbar-popover__item-text">{opt.displayName}</span>
                    </button>
                  ))}
                </div>
              )
            })}
          </div>
        </Popover>
      )}

      {/* Teleport popover */}
      {teleportOpen && (
        <Popover anchorRef={teleportBtnRef} onClose={() => { setTeleportOpen(false); setTeleportX(''); setTeleportY(''); setBookmarkName('') }}>
          <div className="unified-toolbar-popover__section">
            <span className="unified-toolbar-popover__label">坐标传送</span>
            <div className="unified-toolbar-teleport-row">
              <label>X</label>
              <input
                type="number"
                value={teleportX}
                onChange={e => setTeleportX(e.target.value)}
                placeholder={Math.round(viewportCenterCanvasX).toString()}
              />
            </div>
            <div className="unified-toolbar-teleport-row">
              <label>Y</label>
              <input
                type="number"
                value={teleportY}
                onChange={e => setTeleportY(e.target.value)}
                placeholder={Math.round(viewportCenterCanvasY).toString()}
              />
            </div>
            <button className="unified-toolbar-teleport-go" onClick={handleTeleport}>
              传送
            </button>
            <button
              className="unified-toolbar-teleport-go"
              onClick={() => { useAppStore.getState().teleportTo(0, 0); setTeleportOpen(false) }}
              style={{ marginTop: 4, background: 'transparent', border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}
            >
              回到原点
            </button>
          </div>
          <div className="unified-toolbar-popover__divider" />
          <div className="unified-toolbar-popover__section">
            <span className="unified-toolbar-popover__label">书签</span>
            <div className="unified-toolbar-teleport-row">
              <input
                type="text"
                value={bookmarkName}
                onChange={e => setBookmarkName(e.target.value)}
                placeholder="书签名称"
                style={{ flex: 1 }}
              />
              <button
                className="unified-toolbar-teleport-go"
                onClick={() => {
                  const name = bookmarkName.trim() || `书签 ${bookmarks.length + 1}`
                  addCanvasBookmark(activePanelId, { name, x: viewportCenterCanvasX, y: viewportCenterCanvasY, zoom: canvasTransform.zoom })
                  setBookmarkName('')
                }}
                style={{ padding: '2px 8px', fontSize: 12 }}
              >
                保存
              </button>
            </div>
            {bookmarks.length > 0 && (
              <div className="unified-toolbar-bookmark-list">
                {bookmarks.map((bm, i) => (
                  <div key={i} className="unified-toolbar-bookmark-item">
                    <button
                      className="unified-toolbar-bookmark-name"
                      onClick={() => { useAppStore.getState().teleportTo(bm.x, bm.y, bm.zoom); setTeleportOpen(false) }}
                    >
                      {bm.name}
                    </button>
                    <span className="unified-toolbar-bookmark-coords">
                      ({Math.round(bm.x)}, {Math.round(bm.y)})
                    </span>
                    <button
                      className="unified-toolbar-bookmark-del"
                      onClick={() => removeCanvasBookmark(activePanelId, i)}
                      title="删除"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Popover>
      )}

      {/* View popover */}
      {viewPopoverOpen && (
        <Popover anchorRef={viewBtnRef} onClose={() => setViewPopoverOpen(false)}>
          <div className="unified-toolbar-popover__section">
            <span className="unified-toolbar-popover__label">视图</span>
            <label className="unified-toolbar-popover__item" style={{ cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={!hideConnections}
                onChange={() => toggleHideConnections()}
                style={{ marginRight: 8 }}
              />
              <span className="unified-toolbar-popover__item-text">显示连线</span>
            </label>
            <label className="unified-toolbar-popover__item" style={{ cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={!hideAIAssistant}
                onChange={() => toggleHideAIAssistant()}
                style={{ marginRight: 8 }}
              />
              <span className="unified-toolbar-popover__item-text">显示AI助手</span>
            </label>
          </div>
        </Popover>
      )}
    </div>
  )
}
