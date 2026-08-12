import { useRef, useCallback, useState, useEffect, useLayoutEffect, useMemo } from 'react'
import { AlertTriangle, Palette, Ban, BookOpen, Briefcase, Leaf, BarChart3, Plus, Diamond } from 'lucide-react'
import { useAppStore } from '../stores/useAppStore'
import WidgetContainer from './WidgetContainer'
import WidgetErrorBoundary from './WidgetErrorBoundary'
import Minimap from './Minimap'
import { ConnectionLayer } from './ConnectionLayer'
import { StrokesLayer } from './StrokesLayer'
import { sanitizeWidgetState } from '../utils/stateSchema'
import { WIDGET_COLOR_SCHEMES } from '../utils/widgetColorSchemes'
import { getActiveCanvasContainer } from '../utils/canvasCoords'
import { getBuiltinPanelTemplates } from '../utils/dbStores/panelTemplates'
import type { PanelTemplate } from '../types'
// Phase 6.1：内存休眠管理器 + 骨架屏（spec 第 5 节）
import { panelMemoryManager, type PanelMemoryStatus } from '../utils/panelMemoryManager'
import SkeletonScreen from './SkeletonScreen'
import { FreeHtmlComponent } from './FreeHtmlComponent'

const NOOP = () => {}
import { getCommandStack } from '../utils/commandStack'
import {
  downsamplePoints,
  findNearestAnchor,
  generateId,
  isInteractiveElement,
} from '../utils/drawingCoords'
import type { CanvasMode, DrawingStroke, DrawingStrokeType, ConnectionAnchor, WidgetConnection, WidgetPosition, WidgetInstance } from '../types'

const EMPTY_STROKES: DrawingStroke[] = []
const EMPTY_POSITIONS: WidgetPosition[] = []
const EMPTY_WIDGETS: WidgetInstance[] = []

function getWidgetsInBox(
  positions: { widgetId: string; x: number; y: number; w: number; h: number }[],
  box: { x1: number; y1: number; x2: number; y2: number }
): string[] {
  const left = Math.min(box.x1, box.x2)
  const right = Math.max(box.x1, box.x2)
  const top = Math.min(box.y1, box.y2)
  const bottom = Math.max(box.y1, box.y2)
  return positions
    .filter(p => {
      const wr = p.x + p.w
      const wb = p.y + p.h
      return p.x < right && wr > left && p.y < bottom && wb > top
    })
    .map(p => p.widgetId)
}

function isStrokeHitByPoint(stroke: DrawingStroke, point: { x: number; y: number }, threshold: number = 12): boolean {
  for (let i = 0; i < stroke.points.length - 1; i++) {
    const a = stroke.points[i]
    const b = stroke.points[i + 1]
    const l2 = (a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y)
    if (l2 === 0) {
      const dx = point.x - a.x
      const dy = point.y - a.y
      if (dx * dx + dy * dy < threshold * threshold) return true
      continue
    }
    let t = ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) / l2
    t = Math.max(0, Math.min(1, t))
    const px = a.x + t * (b.x - a.x)
    const py = a.y + t * (b.y - a.y)
    const dx = point.x - px
    const dy = point.y - py
    if (dx * dx + dy * dy < threshold * threshold) return true
  }
  return false
}

const TEMPLATE_ICONS: Record<string, React.ReactNode> = {
  'book-open': <BookOpen size={28} />,
  'briefcase': <Briefcase size={28} />,
  'leaf': <Leaf size={28} />,
  'bar-chart-3': <BarChart3 size={28} />,
}

function WelcomeScreen() {
  const addPanel = useAppStore(s => s.addPanel)
  const addPanelFromTemplate = useAppStore(s => s.addPanelFromTemplate)
  const [templates, setTemplates] = useState<PanelTemplate[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    getBuiltinPanelTemplates().then(setTemplates).catch(() => setTemplates([]))
  }, [])

  const handleCreate = async (templateId?: string) => {
    if (loading) return
    setLoading(true)
    try {
      if (templateId) {
        await addPanelFromTemplate(templateId)
      } else {
        await addPanel('新面板')
      }
    } catch (e) {
      console.error('[WelcomeScreen] Failed to create panel:', e)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="workspace full">
      <div className="welcome-screen">
        <div className="welcome-screen__header">
          <div className="welcome-screen__icon"><Diamond size={48} /></div>
          <h1 className="welcome-screen__title">欢迎使用 Daily</h1>
          <p className="welcome-screen__subtitle">选择一个模板快速开始，或创建空白面板自由搭建</p>
        </div>
        <div className="welcome-screen__templates">
          {templates.map(t => (
            <button
              key={t.id}
              className="welcome-screen__template-card"
              onClick={() => handleCreate(t.id)}
              disabled={loading}
            >
              <div className="welcome-screen__template-icon">
                {TEMPLATE_ICONS[t.icon] ?? <BarChart3 size={28} />}
              </div>
              <div className="welcome-screen__template-info">
                <span className="welcome-screen__template-name">{t.name}</span>
                <span className="welcome-screen__template-desc">{t.description}</span>
              </div>
            </button>
          ))}
        </div>
        <button
          className="welcome-screen__blank-btn"
          onClick={() => handleCreate()}
          disabled={loading}
        >
          <Plus size={18} />
          <span>创建空白面板</span>
        </button>
      </div>
    </main>
  )
}

export default function Workspace() {
  const activePanelId = useAppStore(s => s.activePanelId)
  const panels = useAppStore(s => s.panels)
  const panelWidgets = useAppStore(s => s.panelWidgets)
  const panelPositions = useAppStore(s => s.panelPositions)
  // 不直接订阅 canvasTransform，避免每次缩放/平移都重渲染整个 widget 树
  // 通过 ref + subscribe 只更新 canvas-container 的 style
  const setCanvasTransform = useAppStore(s => s.setCanvasTransform)
  const removeWidget = useAppStore(s => s.removeWidget)
  const toggleMinimize = useAppStore(s => s.toggleMinimize)
  const updateWidgetPosition = useAppStore(s => s.updateWidgetPosition)
  const bringToFront = useAppStore(s => s.bringToFront)
  const settings = useAppStore(s => s.settings)
  const toggleLock = useAppStore(s => s.toggleLock)
  const changeLayer = useAppStore(s => s.changeLayer)
  const moveSelectedWidgets = useAppStore(s => s.moveSelectedWidgets)
  const setLastActiveWidget = useAppStore(s => s.setLastActiveWidget)
  const lastActiveWidgetId = useAppStore(s => s.lastActiveWidgetId)
  const batchUpdateWidgetColorScheme = useAppStore(s => s.batchUpdateWidgetColorScheme)
  const hideAIAssistant = useAppStore(s => s.hideAIAssistant)
  // Phase 5: 订阅收藏列表（用于 WidgetContainer 的 isFavorite 判断）
  const favorites = useAppStore(s => s.favorites)

  // Phase 3
  const canvasMode = useAppStore(s => (activePanelId ? (s.canvasMode[activePanelId] ?? 'select') : 'select') as CanvasMode)
  const setCanvasMode = useAppStore(s => s.setCanvasMode)
  const setDrawingTool = useAppStore(s => s.setDrawingTool)
  const setHoveredWidgetId = useAppStore(s => s.setHoveredWidgetId)
  const addStroke = useAppStore(s => s.addStroke)
  const removeStrokesBatch = useAppStore(s => s.removeStrokesBatch)
  const addConnection = useAppStore(s => s.addConnection)
  const undo = useAppStore(s => s.undo)
  const redo = useAppStore(s => s.redo)
  const _emptyArr = useMemo(() => [] as DrawingStroke[], [])
  const _emptyPosArr = useMemo(() => [] as WidgetPosition[], [])
  const strokes = useAppStore(s => s.strokes[activePanelId ?? ''] ?? _emptyArr)
  const positions = useAppStore(s => s.panelPositions[activePanelId ?? ''] ?? _emptyPosArr)

  const [selectedWidgetIds, setSelectedWidgetIds] = useState<Set<string>>(new Set())
  const [boxSelection, setBoxSelection] = useState<{ startX: number; startY: number; endX: number; endY: number; active: boolean } | null>(null)
  const [errorKeys, setErrorKeys] = useState<Record<string, number>>({})
  const [batchColorMenu, setBatchColorMenu] = useState<{ x: number; y: number } | null>(null)

  // Phase 6.1：订阅 panelMemoryManager 状态变化，用于渲染骨架屏（spec 第 5 节）
  const [panelMemoryStates, setPanelMemoryStates] = useState<Record<string, PanelMemoryStatus>>({})
  useEffect(() => {
    // 初始化：同步当前所有面板状态
    const initialStates: Record<string, PanelMemoryStatus> = {}
    for (const state of panelMemoryManager.getAllStates()) {
      initialStates[state.panelId] = state.status
    }
    setPanelMemoryStates(initialStates)

    // 订阅状态变化
    const unsub = panelMemoryManager.onStateChange((panelId, state) => {
      setPanelMemoryStates(prev => ({ ...prev, [panelId]: state.status }))
    })
    return () => {
      unsub()
    }
  }, [])

  // 构建 position Map，避免每个 widget 用 .find() O(n²) 查找（必须在条件返回前调用）
  const positionMap = useMemo(() => {
    const map = new Map<string, WidgetPosition>()
    for (const p of positions) {
      map.set(p.widgetId, p)
    }
    return map
  }, [positions])

  const spacePressed = useRef(false)
  const boxSelectStart = useRef<{ screenX: number; screenY: number; canvasX: number; canvasY: number } | null>(null)

  // Phase 3 草稿状态
  const [draftStroke, setDraftStroke] = useState<DrawingStroke | null>(null)
  const draftStrokeRef = useRef<DrawingStroke | null>(null)
  const draftRafRef = useRef<number | null>(null)
  const draftLastPointRef = useRef<{ x: number; y: number } | null>(null)

  // Phase 3 橡皮擦擦除状态
  const erasingIdsRef = useRef<Set<string>>(new Set())

  // Phase 3 连线 drag 状态
  const connectingRef = useRef<{ sourceWidgetId: string; sourceAnchor: ConnectionAnchor; current: { x: number; y: number } } | null>(null)
  const [connectingVisual, setConnectingVisual] = useState<{ sourceWidgetId: string; sourceAnchor: ConnectionAnchor; current: { x: number; y: number } } | null>(null)

  const bgType = settings?.appearance?.backgroundType ?? 'color'

  // 同步 activePanelId 到 ref，供 window 级 wheel handler 使用
  useEffect(() => {
    activePanelIdRef.current = activePanelId ?? null
  }, [activePanelId])

  // 同步 lastActiveWidgetId 到 ref，并缓存对应 DOM 元素
  useEffect(() => {
    lastActiveWidgetIdRef.current = lastActiveWidgetId
    if (lastActiveWidgetId) {
      activeWidgetElRef.current = document.querySelector(
        `[data-widget-id="${CSS.escape(lastActiveWidgetId)}"]`
      ) as HTMLElement | null
    } else {
      activeWidgetElRef.current = null
    }
  }, [lastActiveWidgetId])

  const isPanning = useRef(false)
  const panStart = useRef({ x: 0, y: 0 })
  const transformStart = useRef({ x: 0, y: 0 })
  const dblClickTimer = useRef<{ time: number; x: number; y: number } | null>(null)
  const pendingPanTimer = useRef<number | null>(null)
  const widgetsAreaRef = useRef<HTMLDivElement>(null)
  const batchColorMenuRef = useRef<HTMLDivElement>(null)
  const activePanelIdRef = useRef<string | null>(null)
  const lastActiveWidgetIdRef = useRef<string | null>(null)
  const activeWidgetElRef = useRef<HTMLElement | null>(null)
  // Cached canvas-container element to avoid per-frame querySelector.
  // Updated when activePanelId changes (panel switch invalidates it).
  const canvasContainerRef = useRef<HTMLElement | null>(null)

  // 视口坐标 → 画布坐标。用 ccRect 实测避免 React mount + 内联 style 的 CSS zoom quirk。
  const screenToCanvas = useCallback((screenX: number, screenY: number) => {
    const cc = canvasContainerRef.current
    if (!cc) return { x: 0, y: 0 }
    const ccRect = cc.getBoundingClientRect()
    const zoom = useAppStore.getState().canvasTransform.zoom
    return {
      x: (screenX - ccRect.left) / zoom,
      y: (screenY - ccRect.top) / zoom,
    }
  }, [])

  // panel 切换时刷新 canvasContainerRef
  useLayoutEffect(() => {
    if (!activePanelId) {
      canvasContainerRef.current = null
      return
    }
    canvasContainerRef.current = getActiveCanvasContainer(widgetsAreaRef.current)
  }, [activePanelId])

  // canvasTransform 变化时只更新 canvas-container 的 DOM style，不触发 widget 树重渲染
  // 使用 CSS zoom 替代 transform: scale()，避免缩放后文字模糊
  // 使用 left/top 替代 transform: translate()，避免 transform 创建合成层导致 zoom 失效
  const applyCanvasTransformDOM = useCallback((x: number, y: number, zoom: number) => {
    const canvasEl = widgetsAreaRef.current?.querySelector('.panel-layer--active .canvas-container') as HTMLElement | null
    if (canvasEl) {
      canvasEl.style.left = `${x}px`
      canvasEl.style.top = `${y}px`
      canvasEl.style.zoom = `${zoom}`
    }
  }, [])

  // 订阅 canvasTransform 变化，只更新 DOM
  useEffect(() => {
    const unsub = useAppStore.subscribe((state) => {
      if (state.activePanelId) {
        const t = state.canvasTransform
        applyCanvasTransformDOM(t.x, t.y, t.zoom)
      }
    })
    // 初始应用一次
    const t = useAppStore.getState().canvasTransform
    applyCanvasTransformDOM(t.x, t.y, t.zoom)
    return unsub
  }, [applyCanvasTransformDOM])

  // activePanelId 变化时重新应用 canvas transform
  // 解决初始化时 DOM 元素尚未创建导致 applyCanvasTransformDOM 为 no-op 的竞态问题
  // 使用 useLayoutEffect 确保在浏览器绘制前同步应用，避免闪烁
  useLayoutEffect(() => {
    if (!activePanelId) return
    const t = useAppStore.getState().canvasTransform
    applyCanvasTransformDOM(t.x, t.y, t.zoom)
  }, [activePanelId, applyCanvasTransformDOM])

  // 计算 canvas-mode 模式下连接的 hover widget
  useEffect(() => {
    if (canvasMode !== 'connect' || !activePanelId) {
      setHoveredWidgetId(null)
      return
    }
    const handleMove = (e: MouseEvent) => {
      // connect 模式下不跳过交互元素，始终检测 widget 以显示锚点
      // 用 ccRect 实测（canvasContainerRef 已缓存）避免 React mount + 内联 style 的 CSS zoom quirk
      const point = screenToCanvas(e.clientX, e.clientY)
      const positionsList = useAppStore.getState().panelPositions[activePanelId] ?? EMPTY_POSITIONS
      // connect 模式下使用带缓冲区的命中检测，避免鼠标移向边缘锚点时离开 widget 导致锚点消失
      const ANCHOR_BUFFER = 30
      const sorted = [...positionsList].sort((a, b) => b.zIndex - a.zIndex)
      let hit: string | null = null
      for (const w of sorted) {
        if (
          point.x >= w.x - ANCHOR_BUFFER &&
          point.x <= w.x + w.w + ANCHOR_BUFFER &&
          point.y >= w.y - ANCHOR_BUFFER &&
          point.y <= w.y + w.h + ANCHOR_BUFFER
        ) {
          hit = w.widgetId
          break
        }
      }
      setHoveredWidgetId(hit)
    }
    window.addEventListener('mousemove', handleMove)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      setHoveredWidgetId(null)
    }
  }, [canvasMode, activePanelId, setHoveredWidgetId, screenToCanvas])

  // 监听 Space 键 - 临时切到 pan 模式 + 中断正在进行的连线 drag
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        const target = e.target as HTMLElement | null
        const targetEl = target instanceof HTMLElement ? target : null
        if (targetEl?.closest('input, textarea, select, button, [contenteditable="true"], [role="textbox"], [data-widget-interactive="true"]')) return
        e.preventDefault()
        spacePressed.current = true
        // 中断正在进行的连线 drag
        if (connectingRef.current) {
          connectingRef.current = null
          setConnectingVisual(null)
        }
        document.body.style.cursor = 'grab'
      }
    }
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spacePressed.current = false
        document.body.style.cursor = ''
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [])

  // Phase 3 快捷键：V/H/P/E/C/L/A/R/O/T 和 Esc/Ctrl+Z/Y
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const targetEl = target instanceof HTMLElement ? target : null
      if (targetEl?.closest('input, textarea, select, [contenteditable="true"], [role="textbox"], [data-widget-interactive="true"], [data-ai-input="true"]')) {
        return
      }
      if (!activePanelId) return

      const key = e.key
      const isCtrl = e.ctrlKey || e.metaKey

      // Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z
      if (isCtrl && !e.shiftKey && key.toLowerCase() === 'z') {
        e.preventDefault()
        void undo()
        return
      }
      if (isCtrl && (key.toLowerCase() === 'y' || (e.shiftKey && key.toLowerCase() === 'z'))) {
        e.preventDefault()
        void redo()
        return
      }

      // Esc: 任何模式下回到 select
      if (e.key === 'Escape') {
        if (canvasMode !== 'select') {
          e.preventDefault()
          setCanvasMode(activePanelId, 'select')
          // 清空草稿
          if (draftStrokeRef.current) {
            draftStrokeRef.current = null
            setDraftStroke(null)
          }
          if (connectingRef.current) {
            connectingRef.current = null
            setConnectingVisual(null)
          }
        } else {
          setSelectedWidgetIds(new Set())
        }
        return
      }

      // 模式/工具切换（避免在组合键状态下）
      if (e.isComposing || isCtrl || e.altKey) return
      const k = key.toLowerCase()
      const modeShortcut: Record<string, CanvasMode | DrawingStrokeType> = {
        v: 'select',
        h: 'pan',
        p: 'freehand', // 切到 draw 模式 + freehand
        e: 'erase',
        c: 'connect',
        l: 'line',
        a: 'arrow',
        r: 'rect',
        o: 'ellipse',
        t: 'text',
      }
      const action = modeShortcut[k]
      if (action) {
        e.preventDefault()
        if (typeof action === 'string' && ['freehand', 'line', 'arrow', 'rect', 'ellipse', 'text'].includes(action)) {
          setDrawingTool(action as DrawingStrokeType)
          setCanvasMode(activePanelId, 'draw')
        } else {
          setCanvasMode(activePanelId, action as CanvasMode)
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activePanelId, canvasMode, setCanvasMode, setDrawingTool, undo, redo])

  // 既有快捷键 [/] Delete
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      // Phase 7: target 可能不是 HTMLElement（document/window/Electron 特殊对象），closest 可能不存在
      const targetEl = target instanceof HTMLElement ? target : null
      if (targetEl?.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]')) return
      if (!lastActiveWidgetId) return
      if (e.key === ']') {
        e.preventDefault()
        changeLayer(lastActiveWidgetId, e.ctrlKey ? 'bringToFront' : 'moveUp')
      } else if (e.key === '[') {
        e.preventDefault()
        changeLayer(lastActiveWidgetId, e.ctrlKey ? 'sendToBack' : 'moveDown')
      } else if (e.key === 'Delete') {
        if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return
        if (targetEl?.closest('input, textarea, select, button, [contenteditable="true"], [role="textbox"], [data-widget-interactive="true"]')) return
        if (targetEl?.closest('.fab-menu, .modal-overlay, .confirm-dialog')) return
        if (selectedWidgetIds.size === 0) return

        // 过滤主AI助手（不可删除）
        const allWidgets = (useAppStore.getState().panelWidgets[activePanelId!] ?? EMPTY_WIDGETS)
        const deletableIds = Array.from(selectedWidgetIds).filter(id => {
          const w = allWidgets.find(w => w.widgetId === id)
          return w && !w.isPrimary
        })
        if (deletableIds.length === 0) return

        const CONTENT_TYPES = new Set(['noteBlock', 'richText', 'markdownEditor', 'sticker'])
        const selectedTypes = new Set(
          deletableIds.map(id => {
            const w = allWidgets.find(w => w.widgetId === id)
            return w?.widgetType
          }).filter(Boolean)
        )
        const hasContentWidget = Array.from(selectedTypes).some(t => CONTENT_TYPES.has(t!))
        const needConfirm = hasContentWidget || settings?.behavior?.confirmBeforeDelete
        const count = deletableIds.length
        let confirmed = true
        if (needConfirm) {
          const msg = hasContentWidget
            ? `将删除 ${count} 个组件，其中包含用户内容的内容将被永久删除，确定吗？`
            : `将删除 ${count} 个组件，确定吗？`
          confirmed = window.confirm(msg)
        }
        if (!confirmed) return

        // IIFE await async（removeWidget 返回 Promise<boolean>）
        void (async () => {
          const successIds: string[] = []
          for (const id of deletableIds) {
            try {
              const ok = await removeWidget(id)
              if (ok) successIds.push(id)
            } catch { /* 删除失败跳过 */ }
          }
          if (successIds.length > 0) {
            setSelectedWidgetIds(new Set())
          }
        })()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [lastActiveWidgetId, changeLayer, selectedWidgetIds, activePanelId, settings, removeWidget])

  useEffect(() => {
    queueMicrotask(() => setSelectedWidgetIds(new Set()))
  }, [activePanelId])

  // 切到非 select 模式时清空选中（与 spec §4.1 一致）
  useEffect(() => {
    if (canvasMode !== 'select') {
      queueMicrotask(() => setSelectedWidgetIds(new Set()))
    }
  }, [canvasMode, activePanelId])

  // 批量配色右键菜单：在 widgets-area 空白处右键时弹出
  useEffect(() => {
    const el = widgetsAreaRef.current
    if (!el) return
    const handleContextMenu = (e: MouseEvent) => {
      const target = e.target
      // Phase 7: target 可能不是 HTMLElement，此时不显示菜单
      if (!(target instanceof HTMLElement)) return
      // 如果右键点在组件内或菜单内，不处理
      if (target.closest('.widget-container') || target.closest('.widget-context-menu')) return
      if (selectedWidgetIds.size === 0) return
      e.preventDefault()
      setBatchColorMenu({ x: e.clientX, y: e.clientY })
    }
    el.addEventListener('contextmenu', handleContextMenu)
    return () => el.removeEventListener('contextmenu', handleContextMenu)
  }, [selectedWidgetIds])

  // 批量配色菜单：点击外部关闭
  useEffect(() => {
    if (!batchColorMenu) return
    const handleClick = (e: MouseEvent) => {
      if (batchColorMenuRef.current && batchColorMenuRef.current.contains(e.target as Node)) return
      setBatchColorMenu(null)
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setBatchColorMenu(null)
    }
    window.addEventListener('mousedown', handleClick)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('mousedown', handleClick)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [batchColorMenu])

  // ===================== 鼠标事件处理 =====================

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!activePanelId) return
    const target = e.target
    if (!(target instanceof HTMLElement)) return
    const currentMode = useAppStore.getState().canvasMode[activePanelId] ?? 'select'
    // connect 模式下允许点击 widget 内部开始连线
    if (currentMode !== 'connect') {
      if (target.closest('.widget-container') || target.closest('.unified-toolbar-container') || target.closest('.minimap-container') || target.closest('.drawing-settings-popover')) return
    } else {
      if (target.closest('.unified-toolbar-container') || target.closest('.minimap-container') || target.closest('.drawing-settings-popover')) return
    }

    // Space + drag = pan（所有模式通用）
    if (e.button === 1 || (e.button === 0 && spacePressed.current)) {
      e.preventDefault()
      isPanning.current = true
      panStart.current = { x: e.clientX, y: e.clientY }
      const t = useAppStore.getState().canvasTransform
      transformStart.current = { x: t.x, y: t.y }

      const handleMouseMove = (e: MouseEvent) => {
        if (!isPanning.current) return
        const dx = e.clientX - panStart.current.x
        const dy = e.clientY - panStart.current.y
        setCanvasTransform({
          x: transformStart.current.x + dx,
          y: transformStart.current.y + dy,
        })
      }

      const handleMouseUp = (e: MouseEvent) => {
        if (e.button !== 0 && e.button !== 1) return
        if (!isPanning.current) return
        isPanning.current = false
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }

      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = 'grabbing'
      document.body.style.userSelect = 'none'
      return
    }

    if (e.button !== 0) return

    const currentTransform = useAppStore.getState().canvasTransform
    const canvas = screenToCanvas(e.clientX, e.clientY)

    // ===== connect 模式 =====
    if (currentMode === 'connect') {
      // 检查是否在某个 widget 附近（含缓冲区，方便点击锚点）
      const positionsList = useAppStore.getState().panelPositions[activePanelId] ?? EMPTY_POSITIONS
      const CONNECT_BUFFER = 30
      const sorted = [...positionsList].sort((a, b) => b.zIndex - a.zIndex)
      let widgetAtPoint: string | null = null
      for (const w of sorted) {
        if (
          canvas.x >= w.x - CONNECT_BUFFER &&
          canvas.x <= w.x + w.w + CONNECT_BUFFER &&
          canvas.y >= w.y - CONNECT_BUFFER &&
          canvas.y <= w.y + w.h + CONNECT_BUFFER
        ) {
          widgetAtPoint = w.widgetId
          break
        }
      }
      if (widgetAtPoint) {
        // 找最近的锚点
        const widgetPos = positionsList.find(p => p.widgetId === widgetAtPoint)
        if (widgetPos) {
          const anchors: ConnectionAnchor[] = ['top', 'right', 'bottom', 'left']
          let bestAnchor: ConnectionAnchor | null = null
          let bestDist = 100 // 锚点吸附距离放宽
          for (const a of anchors) {
            const ax = widgetPos.x + (a === 'left' ? 0 : a === 'right' ? widgetPos.w : widgetPos.w / 2)
            const ay = widgetPos.y + (a === 'top' ? 0 : a === 'bottom' ? widgetPos.h : widgetPos.h / 2)
            const dx = canvas.x - ax
            const dy = canvas.y - ay
            const d = Math.sqrt(dx * dx + dy * dy)
            if (d < bestDist) {
              bestDist = d
              bestAnchor = a
            }
          }
          if (bestAnchor) {
            e.preventDefault()
            e.stopPropagation()
            connectingRef.current = {
              sourceWidgetId: widgetAtPoint,
              sourceAnchor: bestAnchor,
              current: canvas,
            }
            setConnectingVisual({
              sourceWidgetId: widgetAtPoint,
              sourceAnchor: bestAnchor,
              current: canvas,
            })
            return
          }
        }
      }
      return
    }

    // ===== draw 模式 =====
    if (currentMode === 'draw') {
      // 透传给组件内输入区
      if (isInteractiveElement(target)) return
      e.preventDefault()

      const tool = useAppStore.getState().drawingTool
      const style = useAppStore.getState().drawingStyle
      const now = Date.now()

      // text 模式：直接放置
      if (tool === 'text') {
        const text = window.prompt('输入文本内容（取消不创建）:', '')
        if (text && text.trim()) {
          const stroke: DrawingStroke = {
            id: generateId('stroke'),
            panelId: activePanelId,
            type: 'text',
            points: [canvas],
            text: text.trim(),
            style: { ...style },
            createdAt: now,
            updatedAt: now,
            schemaVersion: 1,
          }
          void addStroke(activePanelId, stroke)
          // 命令栈
          getCommandStack(activePanelId).push({
            description: `add text stroke`,
            execute: async () => { await addStroke(activePanelId, stroke) },
            undo: async () => { /* removeStroke 由 addStroke 的幂等性反向处理：手动反向 */ await useAppStore.getState().removeStroke(activePanelId, stroke.id) },
            redo: async () => { await addStroke(activePanelId, stroke) },
          })
        }
        return
      }

      // 其他工具：开始画
      const initialStroke: DrawingStroke = {
        id: generateId('stroke'),
        panelId: activePanelId,
        type: tool,
        points: [canvas],
        style: { ...style },
        createdAt: now,
        updatedAt: now,
        schemaVersion: 1,
      }
      draftStrokeRef.current = initialStroke
      draftLastPointRef.current = canvas
      setDraftStroke(initialStroke)

      const handleMouseMove = (e: MouseEvent) => {
        if (!draftStrokeRef.current) return
        if (draftRafRef.current !== null) return
        draftRafRef.current = requestAnimationFrame(() => {
          draftRafRef.current = null
          if (!draftStrokeRef.current) return
          const p = screenToCanvas(e.clientX, e.clientY)
          const ds = draftStrokeRef.current
          if (ds.type === 'freehand') {
            const last = draftLastPointRef.current
            if (last) {
              const dx = p.x - last.x
              const dy = p.y - last.y
              if (dx * dx + dy * dy < 4) return // 移动距离太小，跳过
            }
            const newPoints = [...ds.points, p]
            const newStroke = { ...ds, points: newPoints, updatedAt: Date.now() }
            draftStrokeRef.current = newStroke
            draftLastPointRef.current = p
            setDraftStroke(newStroke)
          } else {
            // line/arrow/rect/ellipse: 只需更新第二个点
            const newPoints: DrawingStroke['points'] = [ds.points[0], p]
            const newStroke = { ...ds, points: newPoints, updatedAt: Date.now() }
            draftStrokeRef.current = newStroke
            setDraftStroke(newStroke)
          }
        })
      }

      const handleMouseUp = () => {
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
        if (draftRafRef.current !== null) {
          cancelAnimationFrame(draftRafRef.current)
          draftRafRef.current = null
        }
        const finalStroke = draftStrokeRef.current
        draftStrokeRef.current = null
        draftLastPointRef.current = null
        setDraftStroke(null)
        if (finalStroke && finalStroke.points.length >= (finalStroke.type === 'freehand' ? 1 : 2)) {
          // 降采样（仅 freehand）
          if (finalStroke.type === 'freehand') {
            finalStroke.points = downsamplePoints(finalStroke.points)
          }
          void addStroke(activePanelId, finalStroke)
          // 命令栈
          getCommandStack(activePanelId).push({
            description: `add ${finalStroke.type} stroke`,
            execute: async () => { await addStroke(activePanelId, finalStroke) },
            undo: async () => { await useAppStore.getState().removeStroke(activePanelId, finalStroke.id) },
            redo: async () => { await addStroke(activePanelId, finalStroke) },
          })
        }
      }

      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
      return
    }

    // ===== erase 模式 =====
    if (currentMode === 'erase') {
      if (isInteractiveElement(target)) return
      e.preventDefault()
      erasingIdsRef.current = new Set()
      let lastErase = { x: 0, y: 0, time: 0 }
      const handleMouseMove = (e: MouseEvent) => {
        const p = screenToCanvas(e.clientX, e.clientY)
        const now = Date.now()
        if (now - lastErase.time < 16) return // 60fps
        lastErase = { x: p.x, y: p.y, time: now }
        const current = useAppStore.getState().strokes[activePanelId] ?? EMPTY_STROKES
        for (const s of current) {
          if (erasingIdsRef.current.has(s.id)) continue
          if (isStrokeHitByPoint(s, p, 12)) {
            erasingIdsRef.current.add(s.id)
          }
        }
      }
      const handleMouseUp = () => {
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
        const ids = Array.from(erasingIdsRef.current)
        erasingIdsRef.current = new Set()
        if (ids.length > 0) {
          // 记录被擦除的 stroke（用于 undo）
          const all = useAppStore.getState().strokes[activePanelId] ?? EMPTY_STROKES
          const removed = all.filter(s => ids.includes(s.id))
          void removeStrokesBatch(activePanelId, ids)
          // 命令栈（合并为一条命令）
          getCommandStack(activePanelId).push({
            description: `erase ${ids.length} strokes`,
            execute: async () => { await removeStrokesBatch(activePanelId, ids) },
            undo: async () => {
              // 恢复：用 addStroke 一条条加回去
              for (const s of removed) {
                await addStroke(activePanelId, s)
              }
            },
            redo: async () => { await removeStrokesBatch(activePanelId, ids) },
          })
        }
      }
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
      return
    }

    // ===== text 模式（独立于 draw 模式） =====
    if (currentMode === 'text') {
      if (isInteractiveElement(target)) return
      e.preventDefault()
      const text = window.prompt('输入文本内容（取消不创建）:', '')
      if (text && text.trim()) {
        const now = Date.now()
        const style = useAppStore.getState().drawingStyle
        const stroke: DrawingStroke = {
          id: generateId('stroke'),
          panelId: activePanelId,
          type: 'text',
          points: [canvas],
          text: text.trim(),
          style: { ...style },
          createdAt: now,
          updatedAt: now,
          schemaVersion: 1,
        }
        void addStroke(activePanelId, stroke)
        getCommandStack(activePanelId).push({
          description: `add text stroke`,
          execute: async () => { await addStroke(activePanelId, stroke) },
          undo: async () => { await useAppStore.getState().removeStroke(activePanelId, stroke.id) },
          redo: async () => { await addStroke(activePanelId, stroke) },
        })
      }
      return
    }

    // ===== pan 模式 =====
    if (currentMode === 'pan') {
      e.preventDefault()
      isPanning.current = true
      panStart.current = { x: e.clientX, y: e.clientY }
      const t = useAppStore.getState().canvasTransform
      transformStart.current = { x: t.x, y: t.y }

      const handleMouseMove = (e: MouseEvent) => {
        if (!isPanning.current) return
        const dx = e.clientX - panStart.current.x
        const dy = e.clientY - panStart.current.y
        setCanvasTransform({
          x: transformStart.current.x + dx,
          y: transformStart.current.y + dy,
        })
      }
      const handleMouseUp = () => {
        isPanning.current = false
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = 'grabbing'
      document.body.style.userSelect = 'none'
      return
    }

    // ===== select 模式（默认）=====
    // 左键单击 = 拖动画布, 双击 = 框选
    e.preventDefault()

    // 清除之前可能残留的延迟 pan
    if (pendingPanTimer.current !== null) {
      clearTimeout(pendingPanTimer.current)
      pendingPanTimer.current = null
    }

    // Double-click detection
    const now = Date.now()
    const DBL_CLICK_THRESHOLD = 300
    const isDouble = dblClickTimer.current &&
      (now - dblClickTimer.current.time) < DBL_CLICK_THRESHOLD &&
      Math.abs(e.clientX - dblClickTimer.current.x) < 5 &&
      Math.abs(e.clientY - dblClickTimer.current.y) < 5

    if (isDouble) {
      // Double-click: start box selection
      dblClickTimer.current = null
      boxSelectStart.current = { screenX: e.clientX, screenY: e.clientY, canvasX: canvas.x, canvasY: canvas.y }
      setBoxSelection({ startX: canvas.x, startY: canvas.y, endX: canvas.x, endY: canvas.y, active: true })
      setSelectedWidgetIds(new Set())
      setLastActiveWidget(null)

      const handleMouseMove = (e: MouseEvent) => {
        if (!boxSelectStart.current) return
        const canvas = screenToCanvas(e.clientX, e.clientY)
        setBoxSelection(prev => prev ? { ...prev, endX: canvas.x, endY: canvas.y } : null)
      }
      const handleMouseUp = (e: MouseEvent) => {
        if (e.button !== 0) return
        if (!boxSelectStart.current) return
        const start = boxSelectStart.current
        const dx = Math.abs(e.clientX - start.screenX)
        const dy = Math.abs(e.clientY - start.screenY)
        boxSelectStart.current = null
        setBoxSelection(prev => prev ? { ...prev, active: false } : null)
        if (dx * dy < 4) {
          setBoxSelection(null)
          window.removeEventListener('mousemove', handleMouseMove)
          window.removeEventListener('mouseup', handleMouseUp)
          document.body.style.userSelect = ''
          return
        }
        const canvas = screenToCanvas(e.clientX, e.clientY)
        const pos = useAppStore.getState().panelPositions[activePanelId] ?? []
        const ids = getWidgetsInBox(pos, { x1: start.canvasX, y1: start.canvasY, x2: canvas.x, y2: canvas.y })
        setSelectedWidgetIds(new Set(ids))
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
        document.body.style.userSelect = ''
      }
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
      document.body.style.userSelect = 'none'
    } else {
      // Single click: 延迟 150ms 启动 pan，避免双击时微移
      dblClickTimer.current = { time: now, x: e.clientX, y: e.clientY }
      const startClientX = e.clientX
      const startClientY = e.clientY
      const startTransform = { x: currentTransform.x, y: currentTransform.y }
      let panStarted = false
      let moveHandler: ((e: MouseEvent) => void) | null = null
      let upHandler: ((e: MouseEvent) => void) | null = null

      const startPan = () => {
        panStarted = true
        isPanning.current = true
        panStart.current = { x: startClientX, y: startClientY }
        transformStart.current = { x: startTransform.x, y: startTransform.y }
        document.body.style.cursor = 'grabbing'
        document.body.style.userSelect = 'none'
      }

      const cleanup = () => {
        if (pendingPanTimer.current !== null) {
          clearTimeout(pendingPanTimer.current)
          pendingPanTimer.current = null
        }
        isPanning.current = false
        if (moveHandler) window.removeEventListener('mousemove', moveHandler)
        if (upHandler) window.removeEventListener('mouseup', upHandler)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }

      moveHandler = (e: MouseEvent) => {
        // 如果鼠标移动超过 3px，立即启动 pan（不需要等延迟）
        if (!panStarted) {
          const dist = Math.abs(e.clientX - startClientX) + Math.abs(e.clientY - startClientY)
          if (dist > 3) {
            if (pendingPanTimer.current !== null) {
              clearTimeout(pendingPanTimer.current)
              pendingPanTimer.current = null
            }
            startPan()
          } else {
            return
          }
        }
        const dx = e.clientX - panStart.current.x
        const dy = e.clientY - panStart.current.y
        setCanvasTransform({
          x: transformStart.current.x + dx,
          y: transformStart.current.y + dy,
        })
      }

      upHandler = () => {
        cleanup()
      }

      window.addEventListener('mousemove', moveHandler)
      window.addEventListener('mouseup', upHandler)

      // 延迟 150ms 启动 pan
      pendingPanTimer.current = window.setTimeout(() => {
        pendingPanTimer.current = null
        if (!panStarted) {
          startPan()
        }
      }, 150)
    }
  }, [setCanvasTransform, activePanelId, setLastActiveWidget, addStroke, removeStrokesBatch, screenToCanvas])

  // connect 模式 mousemove（更新临时 target 位置）
  useEffect(() => {
    if (!connectingRef.current) return
    const handleMove = (e: MouseEvent) => {
      if (!connectingRef.current) return
      if (spacePressed.current) {
        // Space 按下时终止
        connectingRef.current = null
        setConnectingVisual(null)
        return
      }
      const p = screenToCanvas(e.clientX, e.clientY)
      connectingRef.current.current = p
      setConnectingVisual(prev => prev ? { ...prev, current: p } : null)
    }
    const handleUp = (e: MouseEvent) => {
      if (!connectingRef.current) return
      if (e.button !== 0) return
      const conn = connectingRef.current
      connectingRef.current = null
      setConnectingVisual(null)
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
      // 释放鼠标：检查是否落在某 widget 锚点上
      const p = screenToCanvas(e.clientX, e.clientY)
      const positionsList = useAppStore.getState().panelPositions[activePanelId!] ?? EMPTY_POSITIONS
      const candidates = positionsList.map(p => ({ widgetId: p.widgetId, position: p }))
      const target = findNearestAnchor(p, candidates, conn.sourceWidgetId, 60)
      if (!target) return
      if (target.widgetId === conn.sourceWidgetId) return // 自连
      const now = Date.now()
      const newConn: WidgetConnection = {
        id: generateId('conn'),
        panelId: activePanelId!,
        source: { widgetId: conn.sourceWidgetId, anchor: conn.sourceAnchor },
        target: { widgetId: target.widgetId, anchor: target.anchor },
        type: 'visual',
        style: { ...useAppStore.getState().drawingStyle, arrow: 'end' },
        createdAt: now,
        updatedAt: now,
        schemaVersion: 1,
      }
      void addConnection(activePanelId!, newConn)
      getCommandStack(activePanelId!).push({
        description: `add connection`,
        execute: async () => { await addConnection(activePanelId!, newConn) },
        undo: async () => { await useAppStore.getState().removeConnection(activePanelId!, newConn.id) },
        redo: async () => { await addConnection(activePanelId!, newConn) },
      })
    }
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [connectingVisual !== null, activePanelId, addConnection, screenToCanvas])

  // 使用非 passive 的 wheel 监听器以支持 preventDefault
  // 挂到 window 的捕获阶段，确保组件内滚动也被我们截获
  // 行为：默认缩放画布；若滚轮在"最近激活的组件"上方（含 portal 弹层），则只滚动该组件内
  useEffect(() => {
    let wheelRafId: number | null = null
    let pendingDelta: number = 0
    let lastMouseX: number = 0
    let lastMouseY: number = 0

    const flushWheel = () => {
      wheelRafId = null
      if (pendingDelta === 0) return

      const current = useAppStore.getState().canvasTransform
      const newZoom = Math.max(0.2, Math.min(3, current.zoom + pendingDelta))
      pendingDelta = 0

      if (newZoom === current.zoom) return

      const area = widgetsAreaRef.current
      let newX = current.x
      let newY = current.y
      if (area) {
        // 鼠标 viewport 坐标（与 ccRect.left 坐标系一致）
        const mX = lastMouseX
        const mY = lastMouseY
        // CSS zoom 缩放 left/top，保持鼠标指向的 canvas 点不变的公式：
        // newX = mX * (1/newZoom - 1/oldZoom) + oldX（c(t) 抵消，代数正确）
        newX = mX * (1 / newZoom - 1 / current.zoom) + current.x
        newY = mY * (1 / newZoom - 1 / current.zoom) + current.y
      }

      setCanvasTransform({ x: newX, y: newY, zoom: newZoom })
    }

    const handler = (e: WheelEvent) => {
      const target = e.target
      if (!(target instanceof HTMLElement)) return

      // S16 修复：webview 内的 wheel 事件直接放行，让网页自己滚动
      // 必须放在 closest 检查之前，确保 webview 滚动优先级最高
      if (target.tagName === 'WEBVIEW' || target.closest('webview')) {
        return
      }

      // 现有逻辑：工具栏/侧边栏/弹层等区域不缩放
      if (target.closest(
        '.unified-toolbar-container, .sidebar, .panel-sidebar, .modal-overlay, .fab-menu, .widget-context-menu, .unified-toolbar-popover, .popover, [role="dialog"], .minimap-container, .settings-panel, .settings-overlay, .apicfg-modal__overlay, .apicfg-modal, .toast-container'
      )) {
        return
      }
      const activeWidgetEl = activeWidgetElRef.current
      if (activeWidgetEl && target.closest(`[data-widget-id="${CSS.escape(activeWidgetEl.dataset.widgetId ?? '')}"]`)) {
        return
      }

      e.preventDefault()
      pendingDelta += e.deltaY > 0 ? -0.08 : 0.08
      lastMouseX = e.clientX
      lastMouseY = e.clientY
      if (wheelRafId === null) {
        wheelRafId = requestAnimationFrame(flushWheel)
      }
    }
    window.addEventListener('wheel', handler, { passive: false, capture: true })
    return () => {
      window.removeEventListener('wheel', handler, true)
      if (wheelRafId !== null) {
        cancelAnimationFrame(wheelRafId)
        wheelRafId = null
      }
    }
  }, [setCanvasTransform])

  const handleDragSelected = useCallback((widgetId: string, deltaX: number, deltaY: number) => {
    const ids = Array.from(selectedWidgetIds)
    if (ids.length === 0) {
      ids.push(widgetId)
    }
    const zoom = useAppStore.getState().canvasTransform.zoom
    moveSelectedWidgets(ids, deltaX / zoom, deltaY / zoom)
  }, [selectedWidgetIds, moveSelectedWidgets])

  // Phase 5: 切换组件收藏状态
  const handleToggleFavorite = useCallback(async (widgetId: string) => {
    const state = useAppStore.getState()
    const existing = state.getFavoriteByWidgetId(widgetId)
    if (existing) {
      await state.removeFavorite(existing.id)
    } else {
      await state.addFavorite(widgetId)
    }
  }, [])

  // Phase 5: 刷新收藏预览（重新 upsert，更新 stateSnapshot）
  const handleRefreshFavorite = useCallback(async (widgetId: string) => {
    await useAppStore.getState().addFavorite(widgetId)
  }, [])

  if (panels.length === 0) {
    return <WelcomeScreen />
  }

  const activeWidgets = panelWidgets[activePanelId!] ?? []
  const widgetCountWarning = activeWidgets.length > 50
  const strokeCountWarning = strokes.length > 500
  const strokeCountBlock = strokes.length >= 2000

  return (
    <main className={`workspace full ${bgType !== 'color' ? 'custom-bg' : ''}`}>
      <div
        className="workspace-widgets-area"
        ref={widgetsAreaRef}
        onMouseDown={handleMouseDown}
      >
        {panels.map(panel => {
          const isActive = panel.id === activePanelId
          const panelWidgetList = panelWidgets[panel.id] ?? []
          const panelPositionList = panelPositions[panel.id] ?? []
          // 为每个面板构建 position Map
          const panelPosMap = isActive ? positionMap : new Map(panelPositionList.map(p => [p.widgetId, p]))
          // Phase 6.1：获取面板内存状态，决定是否渲染骨架屏（spec 第 5 节）
          const memoryStatus = panelMemoryStates[panel.id]
          const isHibernated = memoryStatus === 'hibernated' || memoryStatus === 'deep-hibernated'
          // Phase 6.1：恢复中也显示骨架屏，避免白屏（spec 第 5 节"恢复时显示骨架屏，无白屏"）
          const isRestoring = panelMemoryManager.isRestoring(panel.id)
          const showSkeleton = isHibernated || isRestoring

          return (
            <div
              key={panel.id}
              className={`panel-layer ${isActive ? 'panel-layer--active' : 'panel-layer--hidden'}`}
            >
              <div
                className="canvas-container"
              >
                {/* Phase 6.1：休眠/恢复中面板渲染骨架屏（spec 第 5 节） */}
                {showSkeleton && (
                  <SkeletonScreen
                    panelId={panel.id}
                    panelName={panel.name}
                    status={isRestoring ? 'restoring' : (memoryStatus || 'background')}
                    widgetCount={panelWidgetList.length}
                  />
                )}
                {/* 已提交笔迹层（z:10）*/}
                <StrokesLayer panelId={panel.id} mode="committed" />

                {/* 连线层（z:20）*/}
                <ConnectionLayer panelId={panel.id} />

                {/* 组件层（z:100+）*/}
                {isActive && panelWidgetList.length === 0 ? (
                  <div className="workspace-empty" style={{ pointerEvents: 'none' }}>
                    <div className="workspace-empty-icon"><Plus size={48} /></div>
                    <p className="workspace-empty-text">点击右下角 + 添加组件</p>
                    <div className="workspace-shortcut-hints">
                      <span>按住 Space 并拖拽 — 平移画布</span>
                      <span>滚轮 — 缩放画布</span>
                      <span>V — 选择 / P — 画笔 / E — 橡皮 / C — 连线</span>
                      <span>Delete — 删除选中组件</span>
                      <span>Esc — 取消选择</span>
                      <span>组件分组：基础 / 时间与任务 / 生活与健康 / 媒体与阅读 / 学习工具 / AI 助手</span>
                    </div>
                  </div>
                ) : (
                  panelWidgetList.map(widget => {
                    // 隐藏 AI 助手时跳过渲染（仅影响渲染，不删除数据）
                    if (hideAIAssistant && widget.widgetType === 'aiAssistant') return null
                    const pos = panelPosMap.get(widget.widgetId)
                    if (!pos) return null

                    const sanitizedState = sanitizeWidgetState(widget.widgetType, widget.state)

                    // Phase 2：自由 HTML 组件分流（设计文档 §3.1/§3.4 + 决策日志 13/14/22/32）
                    // 不走 WidgetContainer（避免 drag/resize 包装），直接渲染 FreeHtmlComponent
                    // 共享 DOM、pointer-events: none 让点击穿透，可跨 widget 边界
                    if (widget.widgetType === 'freeHtml') {
                      const html = typeof sanitizedState.html === 'string' ? sanitizedState.html : ''
                      if (!html) return null  // 空 freeHtml 不渲染（等待 AI 生成内容）
                      const isGlobal = Boolean(sanitizedState.isGlobal)
                      const customZIndex = typeof sanitizedState.customZIndex === 'number' ? sanitizedState.customZIndex : undefined
                      const stateWidth = typeof sanitizedState.width === 'number' ? sanitizedState.width : undefined
                      const stateHeight = typeof sanitizedState.height === 'number' ? sanitizedState.height : undefined
                      // interactive 默认 true（决策32"支持人操作"），仅 AI 显式设 false 才完全穿透
                      const interactive = sanitizedState.interactive !== false
                      const size = (stateWidth != null || stateHeight != null)
                        ? { width: stateWidth ?? pos.w, height: stateHeight ?? pos.h }
                        : { width: pos.w, height: pos.h }
                      return (
                        <WidgetErrorBoundary
                          key={`${widget.widgetId}-${errorKeys[widget.widgetId] ?? 0}`}
                          widgetType={widget.widgetType}
                          widgetId={widget.widgetId}
                          onRetry={() => setErrorKeys(prev => ({
                            ...prev,
                            [widget.widgetId]: (prev[widget.widgetId] ?? 0) + 1
                          }))}
                        >
                          <FreeHtmlComponent
                            key={widget.widgetId}
                            id={widget.widgetId}
                            htmlContent={html}
                            position={{ x: pos.x, y: pos.y }}
                            size={size}
                            isGlobal={isGlobal}
                            zIndex={customZIndex ?? 100}
                            scale={1}
                            interactive={interactive}
                          />
                        </WidgetErrorBoundary>
                      )
                    }

                    return (
                      <WidgetErrorBoundary
                        key={`${widget.widgetId}-${errorKeys[widget.widgetId] ?? 0}`}
                        widgetType={widget.widgetType}
                        widgetId={widget.widgetId}
                        onRetry={() => setErrorKeys(prev => ({
                          ...prev,
                          [widget.widgetId]: (prev[widget.widgetId] ?? 0) + 1
                        }))}
                      >
                        <WidgetContainer
                          key={widget.widgetId}
                          id={widget.widgetId}
                          type={widget.widgetType}
                          x={pos.x}
                          y={pos.y}
                          width={pos.w}
                          height={pos.h}
                          minimized={widget.minimized}
                          locked={widget.locked}
                          selected={isActive && selectedWidgetIds.has(widget.widgetId)}
                          widgetState={sanitizedState}
                          onMove={isActive ? (dx, dy) => {
                            const zoom = useAppStore.getState().canvasTransform.zoom
                            updateWidgetPosition(widget.widgetId, {
                              x: pos.x + dx / zoom,
                              y: pos.y + dy / zoom,
                            })
                          } : NOOP as unknown as (deltaX: number, deltaY: number) => void}
                          onResize={isActive ? (dw, dh, dx) => {
                            const zoom = useAppStore.getState().canvasTransform.zoom
                            updateWidgetPosition(widget.widgetId, {
                              ...(dx ? { x: pos.x + dx / zoom } : {}),
                              w: pos.w + dw / zoom,
                              h: pos.h + dh / zoom,
                            })
                          } : NOOP as unknown as (deltaW: number, deltaH: number, deltaX?: number) => void}
                          onScale={isActive ? (ds) => {
                            const currentScale = (sanitizedState.scale as number) ?? 1
                            const newScale = Math.max(0.5, Math.min(3, currentScale + ds))
                            useAppStore.getState().updateWidgetState(widget.widgetId, { scale: newScale })
                          } : NOOP as unknown as (deltaScale: number) => void}
                          onClose={isActive ? () => removeWidget(widget.widgetId) : NOOP}
                          onToggleMinimize={isActive ? () => toggleMinimize(widget.widgetId) : NOOP}
                          onUpdateState={(partial) => useAppStore.getState().updateWidgetState(widget.widgetId, partial)}
                          onBringToFront={isActive ? () => { bringToFront(widget.widgetId); setLastActiveWidget(widget.widgetId) } : NOOP}
                          onToggleLock={isActive ? () => toggleLock(widget.widgetId) : NOOP}
                          onChangeLayer={isActive ? (action) => changeLayer(widget.widgetId, action) : NOOP as unknown as (action: 'moveUp' | 'moveDown' | 'bringToFront' | 'sendToBack') => void}
                          onDragSelected={isActive ? handleDragSelected : undefined}
                          panelId={panel.id}
                          colorScheme={widget.colorScheme}
                          onUpdateColorScheme={isActive ? (schemeName) => useAppStore.getState().updateWidgetColorScheme(widget.widgetId, schemeName) : NOOP as unknown as (schemeName: string | undefined) => void}
                          isPrimary={widget.isPrimary ?? false}
                          isFavorite={favorites.some(f => f.widgetId === widget.widgetId)}
                          onToggleFavorite={() => handleToggleFavorite(widget.widgetId)}
                          onRefreshFavorite={() => handleRefreshFavorite(widget.widgetId)}
                        />
                      </WidgetErrorBoundary>
                    )
                  })
                )}

                {/* 草稿笔迹层（z:200）— 仅活跃面板 */}
                {isActive && <StrokesLayer panelId={activePanelId!} mode="draft" draftStroke={draftStroke} />}

                {/* 连线 drag 预览 — 仅活跃面板 */}
                {isActive && connectingVisual && (() => {
                  const sourcePos = positions.find(p => p.widgetId === connectingVisual.sourceWidgetId)
                  if (!sourcePos) return null
                  const getAnchor = (a: ConnectionAnchor) => {
                    switch (a) {
                      case 'top': return { x: sourcePos.x + sourcePos.w / 2, y: sourcePos.y }
                      case 'right': return { x: sourcePos.x + sourcePos.w, y: sourcePos.y + sourcePos.h / 2 }
                      case 'bottom': return { x: sourcePos.x + sourcePos.w / 2, y: sourcePos.y + sourcePos.h }
                      case 'left': return { x: sourcePos.x, y: sourcePos.y + sourcePos.h / 2 }
                    }
                  }
                  const p1 = getAnchor(connectingVisual.sourceAnchor)
                  const p2 = connectingVisual.current
                  const path = `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`
                  return (
                    <svg
                      className="connection-preview"
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: '100%',
                        pointerEvents: 'none',
                        overflow: 'visible',
                      }}
                    >
                      <path
                        d={path}
                        stroke="#4A90E2"
                        strokeWidth={2}
                        strokeDasharray="6,4"
                        fill="none"
                        opacity={0.7}
                      />
                    </svg>
                  )
                })()}

                {/* 框选矩形 — 仅活跃面板 */}
                {isActive && boxSelection?.active && (
                  <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}>
                    <rect
                      x={Math.min(boxSelection.startX, boxSelection.endX)}
                      y={Math.min(boxSelection.startY, boxSelection.endY)}
                      width={Math.abs(boxSelection.endX - boxSelection.startX)}
                      height={Math.abs(boxSelection.endY - boxSelection.startY)}
                      fill="rgba(74, 144, 226, 0.1)"
                      stroke="rgba(74, 144, 226, 0.5)"
                      strokeWidth="1"
                      strokeDasharray="4 2"
                    />
                  </svg>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* 小地图 - 放在 workspace 根层级，使用 fixed 定位 */}
      <Minimap widgetsAreaRef={widgetsAreaRef} />

      {widgetCountWarning && (
        <div style={{
          position: 'fixed',
          bottom: 60,
          left: '50%',
          transform: 'translateX(-50%)',
          padding: '6px 16px',
          borderRadius: 20,
          background: 'rgba(255,149,0,0.15)',
          border: '1px solid rgba(255,149,0,0.3)',
          color: 'var(--color-warning)',
          fontSize: 12,
          fontWeight: 500,
          zIndex: 1000,
          pointerEvents: 'none',
        }}>
          <AlertTriangle size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} /> 当前面板 {activeWidgets.length} 个组件，可能影响性能
        </div>
      )}

      {strokeCountWarning && !strokeCountBlock && (
        <div style={{
          position: 'fixed',
          bottom: 92,
          left: '50%',
          transform: 'translateX(-50%)',
          padding: '6px 16px',
          borderRadius: 20,
          background: 'rgba(255,149,0,0.15)',
          border: '1px solid rgba(255,149,0,0.3)',
          color: 'var(--color-warning)',
          fontSize: 12,
          fontWeight: 500,
          zIndex: 1000,
          pointerEvents: 'none',
        }}>
          <AlertTriangle size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} /> 当前面板 {strokes.length} 条笔迹，建议导出后清空
        </div>
      )}

      {strokeCountBlock && (
        <div style={{
          position: 'fixed',
          bottom: 92,
          left: '50%',
          transform: 'translateX(-50%)',
          padding: '6px 16px',
          borderRadius: 20,
          background: 'rgba(255,68,68,0.15)',
          border: '1px solid rgba(255,68,68,0.3)',
          color: '#f44',
          fontSize: 12,
          fontWeight: 500,
          zIndex: 1000,
        }}>
          <Ban size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} /> 笔迹已达 2000 条上限，无法新增。请清空或导出后再画。
        </div>
      )}

      {/* 框选浮动工具栏 */}
      {selectedWidgetIds.size > 0 && !batchColorMenu && (
        <div style={{
          position: 'fixed',
          bottom: 20,
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          gap: 8,
          padding: '6px 12px',
          borderRadius: 10,
          background: 'var(--bg-elevated, #fff)',
          border: '1px solid var(--border-default, #ddd)',
          boxShadow: '0 2px 12px rgba(0,0,0,0.12)',
          zIndex: 9000,
        }}>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: '28px' }}>
            已选 {selectedWidgetIds.size} 个组件
          </span>
          <button
            style={{
              padding: '4px 12px',
              borderRadius: 6,
              border: '1px solid var(--border-default, #ddd)',
              background: 'var(--bg-default, #f5f5f5)',
              cursor: 'pointer',
              fontSize: 12,
              color: 'var(--text-primary)',
            }}
            onClick={(e) => {
              e.stopPropagation()
              const rect = (e.target as HTMLElement).getBoundingClientRect()
              setBatchColorMenu({ x: rect.left, y: rect.top - 200 })
            }}
          >
            <Palette size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} /> 配色
          </button>
        </div>
      )}

      {/* 批量配色右键菜单 */}
      {batchColorMenu && selectedWidgetIds.size > 0 && (
        <div
          ref={batchColorMenuRef}
          className="widget-context-menu"
          style={{ position: 'fixed', left: batchColorMenu.x, top: batchColorMenu.y, zIndex: 10000 }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="widget-context-item widget-context-title">
            批量配色 ({selectedWidgetIds.size} 个组件)
          </div>
          <div className="widget-context-separator" />
          <div style={{ padding: '8px 12px', display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            <div
              style={{
                width: 24, height: 24, borderRadius: 6, cursor: 'pointer',
                border: '2px solid var(--color-primary)',
                background: 'linear-gradient(135deg, var(--color-primary), var(--color-secondary))',
              }}
              onClick={() => {
                const ids = Array.from(selectedWidgetIds)
                ids.forEach(id => useAppStore.getState().updateWidgetColorScheme(id, undefined))
                setBatchColorMenu(null)
              }}
              title="跟随全局"
            />
            {WIDGET_COLOR_SCHEMES.map(scheme => (
              <div
                key={scheme.name}
                style={{
                  width: 24, height: 24, borderRadius: 6, cursor: 'pointer',
                  border: '1px solid var(--border-default)',
                  background: scheme.dark.primary,
                }}
                onClick={() => {
                  const ids = Array.from(selectedWidgetIds)
                  batchUpdateWidgetColorScheme(ids, scheme.name)
                  setBatchColorMenu(null)
                }}
                title={scheme.label}
              />
            ))}
          </div>
        </div>
      )}
    </main>
  )
}
