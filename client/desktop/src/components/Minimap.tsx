import { useRef, useState, useCallback, useEffect, useMemo } from 'react'
import { toCanvas } from 'html-to-image'
import { useAppStore } from '../stores/useAppStore'
import { WIDGET_COLOR_SCHEMES } from '../utils/widgetColorSchemes'
import { getActiveCanvasContainer } from '../utils/canvasCoords'
import type { WidgetPosition, WidgetInstance } from '../types'

type DisplayMode = 'schematic' | 'thumbnail'

interface MinimapProps {
  widgetsAreaRef: React.RefObject<HTMLDivElement | null>
}

const MIN_WIDTH = 120
const MIN_HEIGHT = 80
const MAX_WIDTH = 500
const MAX_HEIGHT = 400
const DEFAULT_WIDTH = 240
const DEFAULT_HEIGHT = 160
const MIN_SCALE = 0.2
const MAX_SCALE = 3.0
const DEFAULT_SCALE = 1.0
const SCALE_STEP = 0.1
const PADDING = 100

// 从 CSS 变量读取颜色
function getCSSVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

// widgetType → 简化图标映射（Phase 4 任务 9: 图标统一审计，emoji 改为字母缩写，canvas 渲染）
const TYPE_ICONS: Record<string, string> = {
  'todo-list': 'T', 'countdown': 'C', 'clock': 'C', 'weather': 'W',
  'calendar': 'C', 'note': 'N', 'calculator': 'C', 'habit-tracker': 'H',
  'quote': 'Q', 'timer': 'T', 'stopwatch': 'S', 'pomodoro': 'P',
  'sudoku': 'S', 'progress': 'P', 'links': 'L', 'image': 'I',
  'count': 'C', 'markdown': 'M', 'search': 'S', 'music': 'M',
}

export default function Minimap({ widgetsAreaRef }: MinimapProps) {
  const activePanelId = useAppStore(s => s.activePanelId)
  const panelPositions = useAppStore(s => s.panelPositions)
  const panelWidgets = useAppStore(s => s.panelWidgets)
  // 不直接订阅 canvasTransform，避免每次变换都触发重渲染
  // 在绘制时通过 getState() 读取最新值
  const setCanvasTransform = useAppStore(s => s.setCanvasTransform)

  const [minimapScale, setMinimapScale] = useState(DEFAULT_SCALE)
  const [size, setSize] = useState({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT })
  const [focused, setFocused] = useState(false)
  const [displayMode, setDisplayMode] = useState<DisplayMode>('schematic')

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number | null>(null)
  const jumpDragRef = useRef(false)
  const cachedThumbnailCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const captureDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const positions: WidgetPosition[] = activePanelId ? (panelPositions[activePanelId] ?? []) : []
  const widgets: WidgetInstance[] = activePanelId ? (panelWidgets[activePanelId] ?? []) : []

  const widgetMap = useMemo(() => {
    const map = new Map<string, WidgetInstance>()
    for (const w of widgets) map.set(w.widgetId, w)
    return map
  }, [widgets])

  // ===== 坐标映射计算 =====
  const computeMapping = useCallback(() => {
    if (positions.length === 0) return null
    const canvasTransform = useAppStore.getState().canvasTransform

    const minX = Math.min(...positions.map(w => w.x))
    const minY = Math.min(...positions.map(w => w.y))
    const maxX = Math.max(...positions.map(w => w.x + w.w))
    const maxY = Math.max(...positions.map(w => w.y + w.h))

    // 计算当前视口在画布坐标中的范围，确保视口也包含在 minimap 中
    const area = widgetsAreaRef.current
    if (area) {
      const rect = area.getBoundingClientRect()
      // 用 canvas-container 实测 ccRect 计算视口（避免 React mount + 内联 style 的 CSS zoom quirk）
      const ccRect = getActiveCanvasContainer(area)?.getBoundingClientRect() ?? null
      // 考虑 scrollTop/scrollLeft 偏移
      const scrollX = area.scrollLeft
      const scrollY = area.scrollTop
      let vpMinX: number, vpMinY: number, vpMaxX: number, vpMaxY: number
      if (ccRect) {
        vpMinX = (rect.left - ccRect.left) / canvasTransform.zoom
        vpMinY = (rect.top - ccRect.top) / canvasTransform.zoom
        vpMaxX = (rect.right - ccRect.left) / canvasTransform.zoom
        vpMaxY = (rect.bottom - ccRect.top) / canvasTransform.zoom
      } else {
        // fallback
        vpMinX = scrollX / canvasTransform.zoom - canvasTransform.x
        vpMinY = scrollY / canvasTransform.zoom - canvasTransform.y
        vpMaxX = vpMinX + rect.width / canvasTransform.zoom
        vpMaxY = vpMinY + rect.height / canvasTransform.zoom
      }
      // 扩展边界以包含视口
      const boundedMinX = Math.min(minX, vpMinX)
      const boundedMinY = Math.min(minY, vpMinY)
      const boundedMaxX = Math.max(maxX, vpMaxX)
      const boundedMaxY = Math.max(maxY, vpMaxY)

      const paddedBounds = {
        minX: boundedMinX - PADDING,
        minY: boundedMinY - PADDING,
        maxX: boundedMaxX + PADDING,
        maxY: boundedMaxY + PADDING,
      }

      const rangeX = paddedBounds.maxX - paddedBounds.minX
      const rangeY = paddedBounds.maxY - paddedBounds.minY
      if (rangeX <= 0 || rangeY <= 0) return null

      const scaleX = size.width / rangeX
      const scaleY = size.height / rangeY
      const fitScale = Math.min(scaleX, scaleY)
      const finalScale = fitScale * minimapScale

      const contentW = rangeX * finalScale
      const contentH = rangeY * finalScale
      const offsetX = (size.width - contentW) / 2
      const offsetY = (size.height - contentH) / 2

      return { paddedBounds, finalScale, offsetX, offsetY, ccRect }
    }

    const paddedBounds = {
      minX: minX - PADDING,
      minY: minY - PADDING,
      maxX: maxX + PADDING,
      maxY: maxY + PADDING,
    }

    const rangeX = paddedBounds.maxX - paddedBounds.minX
    const rangeY = paddedBounds.maxY - paddedBounds.minY
    if (rangeX <= 0 || rangeY <= 0) return null

    const scaleX = size.width / rangeX
    const scaleY = size.height / rangeY
    const fitScale = Math.min(scaleX, scaleY)
    const finalScale = fitScale * minimapScale

    const contentW = rangeX * finalScale
    const contentH = rangeY * finalScale
    const offsetX = (size.width - contentW) / 2
    const offsetY = (size.height - contentH) / 2

    return { paddedBounds, finalScale, offsetX, offsetY }
  }, [positions, size, minimapScale, widgetsAreaRef])

  // ===== 示意模式绘制 =====
  const drawSchematic = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const mapping = computeMapping()
    if (!mapping) return

    const { paddedBounds, finalScale, offsetX, offsetY } = mapping
    const dpr = window.devicePixelRatio || 1

    canvas.width = size.width * dpr
    canvas.height = size.height * dpr
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, size.width, size.height)

    const colorPrimary = getCSSVar('--color-primary') || '#4A90E2'
    const bgElevated = getCSSVar('--bg-elevated') || '#3A3A3C'

    // 绘制组件（简化版：无阴影、无渐变，纯填充+色条）
    for (const pos of positions) {
      const widget = widgetMap.get(pos.widgetId)
      const x = (pos.x - paddedBounds.minX) * finalScale + offsetX
      const y = (pos.y - paddedBounds.minY) * finalScale + offsetY
      const w = pos.w * finalScale
      const h = pos.h * finalScale

      if (w < 2 || h < 2) continue

      let primaryColor = colorPrimary
      if (widget?.colorScheme) {
        const scheme = WIDGET_COLOR_SCHEMES.find(s => s.name === widget.colorScheme)
        if (scheme) primaryColor = scheme.dark.primary
      }

      // 主体填充（无阴影、无渐变）
      ctx.fillStyle = bgElevated
      ctx.globalAlpha = 0.8
      ctx.fillRect(x, y, w, h)

      // 顶部色条
      const headerH = Math.max(2, Math.min(6, h * 0.15))
      ctx.fillStyle = primaryColor
      ctx.globalAlpha = 0.85
      ctx.fillRect(x, y, w, headerH)

      // 内容示意线条
      if (h > 16 && w > 12) {
        const lineY = y + headerH + 3
        const lineCount = Math.min(3, Math.floor((h - headerH - 5) / 4))
        ctx.fillStyle = getCSSVar('--text-secondary') || '#98989D'
        ctx.globalAlpha = 0.25
        for (let i = 0; i < lineCount; i++) {
          const seed = pos.widgetId.charCodeAt(0) * 7 + i * 13
          const lw = w * (0.4 + (seed % 40) / 100)
          ctx.fillRect(x + 3, lineY + i * 4, lw, 1)
        }
      }

      // 类型图标
      if (w > 16 && h > 16 && widget?.widgetType) {
        const icon = TYPE_ICONS[widget.widgetType]
        if (icon) {
          ctx.globalAlpha = 0.6
          ctx.font = `${Math.min(8, Math.min(w, h) * 0.25)}px sans-serif`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(icon, x + w / 2, y + h / 2 + headerH / 4)
        }
      }

      ctx.globalAlpha = 1
    }

    // 绘制视口矩形
    const canvasTransform = useAppStore.getState().canvasTransform
    const area = widgetsAreaRef.current
    if (area) {
      const rect = area.getBoundingClientRect()
      const scrollX = area.scrollLeft
      const scrollY = area.scrollTop
      // 优先用 mapping.ccRect（避免 React mount + 内联 style 的 CSS zoom quirk）
      let vpCanvasX: number, vpCanvasY: number, vpCanvasW: number, vpCanvasH: number
      if (mapping.ccRect) {
        vpCanvasX = (rect.left - mapping.ccRect.left) / canvasTransform.zoom
        vpCanvasY = (rect.top - mapping.ccRect.top) / canvasTransform.zoom
        vpCanvasW = (rect.right - rect.left) / canvasTransform.zoom
        vpCanvasH = (rect.bottom - rect.top) / canvasTransform.zoom
      } else {
        // fallback
        vpCanvasX = scrollX / canvasTransform.zoom - canvasTransform.x
        vpCanvasY = scrollY / canvasTransform.zoom - canvasTransform.y
        vpCanvasW = rect.width / canvasTransform.zoom
        vpCanvasH = rect.height / canvasTransform.zoom
      }

      const vpX = (vpCanvasX - paddedBounds.minX) * finalScale + offsetX
      const vpY = (vpCanvasY - paddedBounds.minY) * finalScale + offsetY
      const vpDrawW = vpCanvasW * finalScale
      const vpDrawH = vpCanvasH * finalScale

      ctx.fillStyle = colorPrimary
      ctx.globalAlpha = 0.06
      ctx.fillRect(vpX, vpY, vpDrawW, vpDrawH)

      ctx.strokeStyle = colorPrimary
      ctx.globalAlpha = 0.7
      ctx.lineWidth = 1.5
      ctx.setLineDash([4, 3])
      ctx.strokeRect(vpX, vpY, vpDrawW, vpDrawH)
      ctx.setLineDash([])
      ctx.globalAlpha = 1
    }
  }, [computeMapping, positions, widgetMap, size, widgetsAreaRef])

  // ===== 真实缩略模式绘制 =====
  const drawThumbnail = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const mapping = computeMapping()
    if (!mapping) return

    const { paddedBounds, finalScale, offsetX, offsetY } = mapping
    const dpr = window.devicePixelRatio || 1

    canvas.width = size.width * dpr
    canvas.height = size.height * dpr
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, size.width, size.height)

    // 使用缓存的 canvas 直接绘制，无需异步
    const thumbCanvas = cachedThumbnailCanvasRef.current
    if (thumbCanvas) {
      const thumbW = (paddedBounds.maxX - paddedBounds.minX) * finalScale
      const thumbH = (paddedBounds.maxY - paddedBounds.minY) * finalScale
      ctx.drawImage(thumbCanvas, offsetX, offsetY, thumbW, thumbH)
    }

    // 绘制视口矩形
    const canvasTransform = useAppStore.getState().canvasTransform
    const area = widgetsAreaRef.current
    if (area) {
      const rect = area.getBoundingClientRect()
      const scrollX = area.scrollLeft
      const scrollY = area.scrollTop
      // 优先用 mapping.ccRect（避免 React mount + 内联 style 的 CSS zoom quirk）
      let vpCanvasX: number, vpCanvasY: number, vpCanvasW: number, vpCanvasH: number
      if (mapping.ccRect) {
        vpCanvasX = (rect.left - mapping.ccRect.left) / canvasTransform.zoom
        vpCanvasY = (rect.top - mapping.ccRect.top) / canvasTransform.zoom
        vpCanvasW = (rect.right - rect.left) / canvasTransform.zoom
        vpCanvasH = (rect.bottom - rect.top) / canvasTransform.zoom
      } else {
        // fallback
        vpCanvasX = scrollX / canvasTransform.zoom - canvasTransform.x
        vpCanvasY = scrollY / canvasTransform.zoom - canvasTransform.y
        vpCanvasW = rect.width / canvasTransform.zoom
        vpCanvasH = rect.height / canvasTransform.zoom
      }

      const vpX = (vpCanvasX - paddedBounds.minX) * finalScale + offsetX
      const vpY = (vpCanvasY - paddedBounds.minY) * finalScale + offsetY
      const vpDrawW = vpCanvasW * finalScale
      const vpDrawH = vpCanvasH * finalScale

      const colorPrimary = getCSSVar('--color-primary') || '#4A90E2'
      ctx.fillStyle = colorPrimary
      ctx.globalAlpha = 0.08
      ctx.fillRect(vpX, vpY, vpDrawW, vpDrawH)
      ctx.strokeStyle = colorPrimary
      ctx.globalAlpha = 0.7
      ctx.lineWidth = 1.5
      ctx.setLineDash([4, 3])
      ctx.strokeRect(vpX, vpY, vpDrawW, vpDrawH)
      ctx.setLineDash([])
      ctx.globalAlpha = 1
    }
  }, [computeMapping, size, widgetsAreaRef])

  // ===== 按需重绘（不再持续 rAF 循环）=====
  const scheduleRedrawRef = useRef<() => void>(() => {})
  const scheduleRedraw = useCallback(() => {
    if (rafRef.current !== null) return // 已有 pending 的重绘
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      if (displayMode === 'schematic') {
        drawSchematic()
      } else {
        drawThumbnail()
      }
    })
  }, [displayMode, drawSchematic, drawThumbnail])
  useEffect(() => {
    scheduleRedrawRef.current = scheduleRedraw
  }, [scheduleRedraw])

  // ===== 缩略图捕获（toCanvas 直接输出 canvas，无 base64 开销）=====
  const captureThumbnail = useCallback(async () => {
    const canvasContainer = document.querySelector('.canvas-container')
    if (!canvasContainer) return

    try {
      const captured = await toCanvas(canvasContainer as HTMLElement, {
        pixelRatio: 0.3,
        skipAutoScale: true,
        filter: (node: HTMLElement) => {
          if (node.style?.display === 'none' || node.style?.visibility === 'hidden') return false
          return true
        },
      })
      cachedThumbnailCanvasRef.current = captured
      scheduleRedrawRef.current()
    } catch {
      // 捕获失败时静默忽略
    }
  }, [])

  // 数据变化时调度重绘
  useEffect(() => { scheduleRedraw() }, [positions, minimapScale, size, scheduleRedraw])

  // canvasTransform 变化时调度重绘（手动比较，不触发组件重渲染）
  useEffect(() => {
    let prev = useAppStore.getState().canvasTransform
    const unsub = useAppStore.subscribe((state) => {
      if (state.canvasTransform !== prev) {
        prev = state.canvasTransform
        scheduleRedraw()
      }
    })
    return unsub
  }, [scheduleRedraw])

  // 缩略图模式：数据变化时 debounce 捕获
  useEffect(() => {
    if (displayMode !== 'thumbnail') return

    // 首次立即捕获
    captureThumbnail()

    // 数据变化时 debounce 300ms 捕获
    if (captureDebounceRef.current) clearTimeout(captureDebounceRef.current)
    captureDebounceRef.current = setTimeout(() => {
      captureThumbnail()
    }, 300)

    return () => {
      if (captureDebounceRef.current) clearTimeout(captureDebounceRef.current)
    }
  }, [displayMode, captureThumbnail, positions, activePanelId])

  // ===== 点击/拖拽跳转 =====
  const handleCanvasMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setFocused(true)
    jumpDragRef.current = true

    const doJump = (clientX: number, clientY: number) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const mapping = computeMapping()
      if (!mapping) return
      const { paddedBounds, finalScale, offsetX, offsetY } = mapping

      const rect = canvas.getBoundingClientRect()
      const px = clientX - rect.left
      const py = clientY - rect.top

      const canvasX = (px - offsetX) / finalScale + paddedBounds.minX
      const canvasY = (py - offsetY) / finalScale + paddedBounds.minY

      const area = widgetsAreaRef.current
      if (!area) return
      const areaRect = area.getBoundingClientRect()
      const currentZoom = useAppStore.getState().canvasTransform.zoom
      // 目标：让 canvasX 落在视口中心
      // ⇒ newX = (areaRect.left + areaRect.width/2) / currentZoom - canvasX - c(t_after)
      // 新状态由 setCanvasTransform → applyCanvasTransformDOM（JS-set）→ c(t_after) = 0
      setCanvasTransform({
        x: (areaRect.left + areaRect.width / 2) / currentZoom - canvasX,
        y: (areaRect.top + areaRect.height / 2) / currentZoom - canvasY,
        zoom: currentZoom,
      })
    }

    doJump(e.clientX, e.clientY)

    const handleMove = (ev: MouseEvent) => {
      if (!jumpDragRef.current) return
      doJump(ev.clientX, ev.clientY)
    }
    const handleUp = () => {
      jumpDragRef.current = false
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
  }, [computeMapping, setCanvasTransform, widgetsAreaRef])

  // ===== 滚轮缩放小地图 =====
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!focused) return
    e.preventDefault()
    e.stopPropagation()

    const delta = e.deltaY > 0 ? -SCALE_STEP : SCALE_STEP
    setMinimapScale(prev => Math.max(MIN_SCALE, Math.min(MAX_SCALE, prev + delta)))
  }, [focused])

  // ===== 拖拽手柄调整大小 =====
  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()

    const startX = e.clientX
    const startY = e.clientY
    const startW = size.width
    const startH = size.height

    const handleMove = (ev: MouseEvent) => {
      const dx = startX - ev.clientX
      const dy = startY - ev.clientY
      const newW = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startW + dx))
      const newH = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, startH + dy))
      setSize({ width: newW, height: newH })
    }
    const handleUp = () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
  }, [size])

  // ===== 点击外部取消选中 =====
  useEffect(() => {
    if (!focused) return
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setFocused(false)
      }
    }
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFocused(false)
    }
    window.addEventListener('mousedown', handleClickOutside)
    window.addEventListener('keydown', handleEsc)
    return () => {
      window.removeEventListener('mousedown', handleClickOutside)
      window.removeEventListener('keydown', handleEsc)
    }
  }, [focused])

  // 面板切换时取消选中
  useEffect(() => {
    queueMicrotask(() => setFocused(false))
  }, [activePanelId])

  // 无组件时隐藏
  if (positions.length === 0) return null

  return (
    <div
      ref={containerRef}
      className={`minimap-container${focused ? ' minimap-focused' : ''}`}
      style={{
        width: size.width,
        height: size.height,
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* 拖拽手柄 */}
      <div className="minimap-resize-handle" onMouseDown={handleResizeMouseDown} />

      {/* 画布 */}
      <canvas
        ref={canvasRef}
        className="minimap-canvas"
        style={{ width: size.width, height: size.height }}
        onMouseDown={handleCanvasMouseDown}
        onWheel={handleWheel}
      />

      {/* 模式切换按钮 */}
      <button
        className="minimap-mode-toggle"
        onClick={(e) => {
          e.stopPropagation()
          setDisplayMode(prev => prev === 'schematic' ? 'thumbnail' : 'schematic')
        }}
        title={displayMode === 'schematic' ? '切换到真实缩略' : '切换到示意模式'}
      >
        {displayMode === 'schematic' ? '🗺' : '📐'}
      </button>

      {/* 缩放比例指示 */}
      <div className="minimap-scale-indicator">
        {Math.round(minimapScale * 100)}%
      </div>
    </div>
  )
}
