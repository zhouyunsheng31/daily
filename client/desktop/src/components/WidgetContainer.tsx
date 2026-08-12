import { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Lock, Unlock, ArrowUpToLine, ArrowDownToLine, ChevronUp, ChevronDown, X, ChevronRight, Minus, Star, StarOff, RefreshCw } from 'lucide-react'
import { useDraggable } from '../hooks/useDraggable'
import { useResizable } from '../hooks/useResizable'
import { getWidgetConfig } from '../registry'
import { widgetDefinitionMap } from '../registry/widgetDefinitions'
import type { WidgetRenderStatus } from '../types/v2'
import { getColorSchemeStyle, WIDGET_COLOR_SCHEMES } from '../utils/widgetColorSchemes'
import { isLightTheme } from '../utils/color'
import { isInteractiveElement } from '../utils/drawingCoords'
import { useAppStore } from '../stores/useAppStore'
import ConflictBadge from './ConflictBadge'

function resolveWidgetDisplay(type: string): {
  status: WidgetRenderStatus
} {
  const definition = widgetDefinitionMap.get(type)
  if (!definition) {
    return { status: 'unknown_type' }
  }
  return { status: 'ok' }
}

interface Props {
  id: string
  type: string
  x: number
  y: number
  width: number
  height: number
  minimized?: boolean
  locked?: boolean
  selected?: boolean
  widgetState: Record<string, unknown>
  onMove: (deltaX: number, deltaY: number) => void
  onResize: (deltaW: number, deltaH: number, deltaX?: number) => void
  onScale: (deltaScale: number) => void
  onClose: () => void
  onToggleMinimize: () => void
  onUpdateState: (partial: Record<string, unknown>) => void
  onBringToFront: () => void
  onToggleLock: () => void
  onChangeLayer: (action: 'moveUp' | 'moveDown' | 'bringToFront' | 'sendToBack') => void
  onDragSelected?: (widgetId: string, deltaX: number, deltaY: number) => void
  panelId: string
  onEditingChange?: (editing: boolean) => void
  colorScheme?: string
  onUpdateColorScheme: (schemeName: string | undefined) => void
  isPrimary?: boolean  // 新增：主AI助手标记
  isFavorite?: boolean  // Phase 5: 是否已收藏
  onToggleFavorite?: () => void  // Phase 5: 切换收藏
  onRefreshFavorite?: () => void  // Phase 5: 刷新收藏预览（更新 stateSnapshot）
}

export default function WidgetContainer({
  id, type, x, y, width, height, minimized, locked, selected, widgetState,
  onMove, onResize, onScale, onClose, onToggleMinimize, onUpdateState, onBringToFront,
  onToggleLock, onChangeLayer, onDragSelected,
  panelId, onEditingChange, colorScheme, onUpdateColorScheme, isPrimary = false,
  isFavorite, onToggleFavorite, onRefreshFavorite,
}: Props) {
  const isLight = useAppStore(s => isLightTheme(s.settings.appearance))
  const containerRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [editExpanded, setEditExpanded] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [isDragging, setIsDragging] = useState(false)

  const handleEditingChange = useCallback((editing: boolean) => {
    setIsEditing(editing)
    onEditingChange?.(editing)
    if (editing) onBringToFront()
  }, [onEditingChange, onBringToFront])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const interactiveSelector = 'input:not([type="file"]):not([type="hidden"]), textarea, select, [contenteditable="true"]'
    const handleFocusIn = (e: FocusEvent) => {
      if ((e.target as HTMLElement)?.matches?.(interactiveSelector)) {
        handleEditingChange(true)
      }
    }
    const handleFocusOut = (e: FocusEvent) => {
      const related = e.relatedTarget as HTMLElement | null
      if (related && el.contains(related) && related.matches?.(interactiveSelector)) return
      setTimeout(() => {
        if (!el.contains(document.activeElement) || !document.activeElement?.matches?.(interactiveSelector)) {
          handleEditingChange(false)
        }
      }, 0)
    }
    el.addEventListener('focusin', handleFocusIn)
    el.addEventListener('focusout', handleFocusOut)
    return () => {
      el.removeEventListener('focusin', handleFocusIn)
      el.removeEventListener('focusout', handleFocusOut)
    }
  }, [handleEditingChange])

  const bgColor = (widgetState.bgColor as string) || ''
  const bgOpacity = (widgetState.bgOpacity as number) ?? 1
  const borderColor = (widgetState.borderColor as string) || ''
  const borderRadius = (widgetState.borderRadius as number) ?? 0
  const fontSize = (widgetState.fontSize as number) ?? 14
  const textColor = (widgetState.textColor as string) || ''
  const scale = (widgetState.scale as number) ?? 1

  // Phase 7 批次5：containerStyle 用 useMemo 缓存，避免每次重渲染都重新计算颜色解析
  const containerStyle = useMemo<React.CSSProperties>(() => {
    const style: React.CSSProperties = { overflow: 'visible' }
    if (scale !== 1 || isDragging) {
      const s = isDragging ? scale * 1.01 : scale
      style.zoom = s
    }
    if (bgColor) {
      const r = parseInt(bgColor.slice(1, 3), 16)
      const g = parseInt(bgColor.slice(3, 5), 16)
      const b = parseInt(bgColor.slice(5, 7), 16)
      style.backgroundColor = `rgba(${r},${g},${b},${bgOpacity})`
    }
    if (borderColor) {
      style.borderColor = borderColor
    }
    if (borderRadius) {
      style.borderRadius = `${borderRadius}px`
    }
    if (colorScheme) {
      const schemeStyle = getColorSchemeStyle(colorScheme, isLight)
      if (schemeStyle) {
        Object.assign(style, schemeStyle)
      }
    }
    return style
  }, [scale, isDragging, bgColor, bgOpacity, borderColor, borderRadius, colorScheme, isLight])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    el.style.left = `${x}px`
    el.style.top = `${y}px`
    el.style.width = `${width}px`
    el.style.height = `${height}px`
  }, [x, y, width, height])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const handler = (e: MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setContextMenu({ x: e.clientX, y: e.clientY })
      setEditExpanded(false)
    }
    el.addEventListener('contextmenu', handler)
    return () => el.removeEventListener('contextmenu', handler)
  }, [])

  useEffect(() => {
    if (!contextMenu) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && menuRef.current.contains(e.target as Node)) return
      setContextMenu(null)
      setEditExpanded(false)
    }
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handler)
      document.addEventListener('contextmenu', handler)
    }, 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('contextmenu', handler)
    }
  }, [contextMenu])

  // 拖动期间直接操作 DOM 的偏移量追踪（避免每帧更新 store 导致 React 重渲染）
  const totalScreenDeltaRef = useRef({ x: 0, y: 0 })

  const { handleMouseDown: dragMouseDown } = useDraggable({
    enabled: !minimized && !isEditing && !locked,
    onMove: selected && onDragSelected
      ? (deltaX, deltaY) => {
          // 多选拖动：直接操作所有选中 widget 的 DOM 位置
          totalScreenDeltaRef.current.x += deltaX
          totalScreenDeltaRef.current.y += deltaY
          const zoom = useAppStore.getState().canvasTransform.zoom
          const totalCanvasDx = totalScreenDeltaRef.current.x / zoom
          const totalCanvasDy = totalScreenDeltaRef.current.y / zoom
          document.querySelectorAll('.widget-container.selected').forEach(el => {
            const hel = el as HTMLElement
            const startLeft = parseFloat(hel.dataset.dragStartLeft || '0')
            const startTop = parseFloat(hel.dataset.dragStartTop || '0')
            hel.style.left = `${startLeft + totalCanvasDx}px`
            hel.style.top = `${startTop + totalCanvasDy}px`
          })
        }
      : (deltaX, deltaY) => {
          // 单 widget 拖动：直接操作 DOM 位置
          totalScreenDeltaRef.current.x += deltaX
          totalScreenDeltaRef.current.y += deltaY
          const zoom = useAppStore.getState().canvasTransform.zoom
          const totalCanvasDx = totalScreenDeltaRef.current.x / zoom
          const totalCanvasDy = totalScreenDeltaRef.current.y / zoom
          const el = containerRef.current
          if (el) {
            el.style.left = `${x + totalCanvasDx}px`
            el.style.top = `${y + totalCanvasDy}px`
          }
        },
    onDragStart: () => {
      setIsDragging(true)
      totalScreenDeltaRef.current = { x: 0, y: 0 }
      // 多选拖动时记录所有选中 widget 的起始位置
      if (selected) {
        document.querySelectorAll('.widget-container.selected').forEach(el => {
          const hel = el as HTMLElement
          hel.dataset.dragStartLeft = hel.style.left
          hel.dataset.dragStartTop = hel.style.top
        })
      }
    },
    onEnd: () => {
      // 先提交最终位置到 store，再延迟清除拖动状态（避免闪烁）
      const total = totalScreenDeltaRef.current
      if (total.x !== 0 || total.y !== 0) {
        if (selected && onDragSelected) {
          onDragSelected(id, total.x, total.y)
        } else {
          onMove(total.x, total.y)
        }
      }
      requestAnimationFrame(() => {
        setIsDragging(false)
        document.querySelectorAll('.widget-container[data-drag-start-left]').forEach(el => {
          delete (el as HTMLElement).dataset.dragStartLeft
          delete (el as HTMLElement).dataset.dragStartTop
        })
      })
      totalScreenDeltaRef.current = { x: 0, y: 0 }
    },
  })

  // resize 期间直接操作 DOM（避免每帧更新 store）
  const resizeOffsetRef = useRef({ dw: 0, dh: 0, dx: 0 })

  const { handleMouseDown: resizeMouseDown } = useResizable({
    enabled: !minimized && !locked,
    onResize: (deltaW, deltaH, deltaX) => {
      // 累积屏幕空间增量
      resizeOffsetRef.current.dw += deltaW
      resizeOffsetRef.current.dh += deltaH
      if (deltaX) resizeOffsetRef.current.dx += deltaX
      const zoom = useAppStore.getState().canvasTransform.zoom
      const el = containerRef.current
      if (el) {
        el.style.width = `${width + resizeOffsetRef.current.dw / zoom}px`
        el.style.height = `${height + resizeOffsetRef.current.dh / zoom}px`
        if (resizeOffsetRef.current.dx) {
          el.style.left = `${x + resizeOffsetRef.current.dx / zoom}px`
        }
      }
    },
    onScale: (deltaScale) => {
      // scale 直接走 store（频率低，且需要触发组件重渲染）
      onScale(deltaScale)
    },
    onEnd: () => {
      // 提交最终 resize 到 store
      const off = resizeOffsetRef.current
      if (off.dw !== 0 || off.dh !== 0) {
        onResize(off.dw, off.dh, off.dx || undefined)
      }
      resizeOffsetRef.current = { dw: 0, dh: 0, dx: 0 }
    },
  })

  const handleContainerMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    onBringToFront()
    // 如果点击的是交互元素（输入框、按钮等），不触发拖动
    const target = e.target as HTMLElement
    if (isInteractiveElement(target)) return
    // S17 修复：webview 捕获鼠标事件，不触发拖拽
    if (target.tagName === 'WEBVIEW' || target.closest('webview')) {
      return
    }
    // webPage 类型只能通过 drag handle 拖拽
    if (type === 'webPage' && !target.closest('[data-widget-drag-handle]')) {
      return
    }
    e.stopPropagation()
    dragMouseDown(e)
  }, [dragMouseDown, onBringToFront, type])

  const closeMenu = useCallback(() => {
    setContextMenu(null)
    setEditExpanded(false)
  }, [])

  const config = getWidgetConfig(type)
  const WidgetComponent = config?.component
  const displayName = config?.displayName || type
  const display = resolveWidgetDisplay(type)

  const contextMenuEl = contextMenu ? (
    <div
      ref={menuRef}
      className="widget-context-menu"
      style={{ position: 'fixed', left: contextMenu.x, top: contextMenu.y, zIndex: 10000 }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="widget-context-item widget-context-title">
        {displayName}
      </div>
      <div className="widget-context-separator" />
      <div
        className="widget-context-item"
        onClick={() => { onToggleMinimize(); closeMenu(); }}
      >
        <Minus size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} /> 最小化
      </div>
      <div
        className="widget-context-item"
        onClick={() => { onToggleLock(); closeMenu(); }}
      >
        {locked ? <><Unlock size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} /> 解锁组件</> : <><Lock size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} /> 锁定组件</>}
      </div>
      <div
        className="widget-context-item"
        onClick={() => { onToggleFavorite?.(); closeMenu(); }}
      >
        {isFavorite ? <StarOff size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} /> : <Star size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />}
        {isFavorite ? '取消收藏' : '收藏'}
      </div>
      {isFavorite && (
        <div
          className="widget-context-item"
          onClick={() => { onRefreshFavorite?.(); closeMenu(); }}
        >
          <RefreshCw size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} /> 刷新预览
        </div>
      )}
      <div className="widget-context-separator" />
      <div
        className="widget-context-item"
        onClick={() => { onChangeLayer('bringToFront'); closeMenu(); }}
      >
        <ArrowUpToLine size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} /> 置顶
      </div>
      <div
        className="widget-context-item"
        onClick={() => { onChangeLayer('moveUp'); closeMenu(); }}
      >
        <ChevronUp size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} /> 上移一层
      </div>
      <div
        className="widget-context-item"
        onClick={() => { onChangeLayer('moveDown'); closeMenu(); }}
      >
        <ChevronDown size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} /> 下移一层
      </div>
      <div
        className="widget-context-item"
        onClick={() => { onChangeLayer('sendToBack'); closeMenu(); }}
      >
        <ArrowDownToLine size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} /> 置底
      </div>
      <div
        className={`widget-context-item ${locked || isPrimary ? 'disabled' : 'danger'}`}
        onClick={() => { if (!locked && !isPrimary) { onClose(); closeMenu(); } }}
        style={locked || isPrimary ? { opacity: 0.4, pointerEvents: 'none' } : undefined}
      >
        <X size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} /> 关闭
      </div>
      <div className="widget-context-separator" />
      <div
        className="widget-context-item"
        onClick={() => setEditExpanded((prev) => !prev)}
      >
        {editExpanded ? <><ChevronDown size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} /> 编辑</> : <><ChevronRight size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} /> 编辑</>}
      </div>
      {editExpanded && (
        <div className="widget-edit-section">
          <div className="color-menu-row">
            <span>背景色</span>
            <input
              type="color"
              value={bgColor || '#2C2C2E'}
              onChange={(e) => onUpdateState({ bgColor: e.target.value })}
            />
          </div>
          <div className="color-menu-row">
            <span>透明度</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={bgOpacity}
              onChange={(e) => onUpdateState({ bgOpacity: parseFloat(e.target.value) })}
            />
          </div>
          <div className="color-menu-row">
            <span>边框色</span>
            <input
              type="color"
              value={borderColor || '#3A3A3C'}
              onChange={(e) => onUpdateState({ borderColor: e.target.value })}
            />
          </div>
          <div className="color-menu-row">
            <span>圆角</span>
            <input
              type="range"
              min="0"
              max="30"
              step="1"
              value={borderRadius}
              onChange={(e) => onUpdateState({ borderRadius: parseInt(e.target.value) })}
            />
          </div>
          <div className="color-menu-row">
            <span>缩放</span>
            <input
              type="range"
              min="0.5"
              max="2"
              step="0.1"
              value={scale}
              onChange={(e) => onUpdateState({ scale: parseFloat(e.target.value) })}
            />
          </div>
          {type === 'richText' && (
            <>
              <div className="color-menu-row">
                <span>字号</span>
                <input
                  type="range"
                  min="10"
                  max="32"
                  step="1"
                  value={fontSize}
                  onChange={(e) => onUpdateState({ fontSize: parseInt(e.target.value) })}
                />
              </div>
              <div className="color-menu-row">
                <span>文字色</span>
                <input
                  type="color"
                  value={textColor || '#F5F5F7'}
                  onChange={(e) => onUpdateState({ textColor: e.target.value })}
                />
              </div>
            </>
          )}
          <div className="color-menu-row">
            <span>配色</span>
            <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
              <div
                style={{
                  width: 18, height: 18, borderRadius: 4, cursor: 'pointer',
                  border: !colorScheme ? '2px solid var(--color-primary)' : '1px solid var(--border-default)',
                  background: 'linear-gradient(135deg, var(--color-primary), var(--color-secondary))',
                }}
                onClick={() => onUpdateColorScheme(undefined)}
                title="跟随全局"
              />
              {WIDGET_COLOR_SCHEMES.map(scheme => (
                <div
                  key={scheme.name}
                  style={{
                    width: 18, height: 18, borderRadius: 4, cursor: 'pointer',
                    border: colorScheme === scheme.name ? '2px solid var(--color-primary)' : '1px solid var(--border-default)',
                    background: scheme.dark.primary,
                  }}
                  onClick={() => onUpdateColorScheme(scheme.name)}
                  title={scheme.label}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  ) : null

  const isTransparent = !bgColor && bgOpacity < 0.1

  return (
    <div
      ref={containerRef}
      data-widget-id={id}
      className={`widget-container no-header ${minimized ? 'minimized' : ''} ${locked ? 'locked' : ''} ${selected ? 'selected' : ''} ${isTransparent ? 'is-transparent' : ''} ${isDragging ? 'dragging' : ''}`}
      style={containerStyle}
      onMouseDown={handleContainerMouseDown}
    >
      {isTransparent && <div className="corner-bl" />}
      {isTransparent && <div className="corner-br" />}
      {locked && (
        <div className="widget-lock-indicator" style={{
          position: 'absolute', top: 4, right: 4, fontSize: 10,
          opacity: 0, transition: 'opacity 150ms', pointerEvents: 'none', zIndex: 20,
        }}><Lock size={10} /></div>
      )}
      {/* Phase 4: 冲突角标（spec 2.5 节）*/}
      <ConflictBadge widgetId={id} />
      {!minimized && (
        <>
          <div className="widget-body">
            {display.status === 'unknown_type' ? (
              <div style={{ padding: 16, color: 'var(--text-tertiary)' }}>未知组件: {type}</div>
            ) : WidgetComponent ? (
              <WidgetComponent widgetId={id} panelId={panelId} state={widgetState} onUpdateState={onUpdateState} onEditingChange={handleEditingChange} isPrimary={isPrimary} />
            ) : (
              <div style={{ padding: 16, color: 'var(--text-tertiary)' }}>组件加载失败: {type}</div>
            )}
          </div>
          {!locked && (
            <>
              <div
                className="resize-handle resize-handle-se"
                onMouseDown={(e) => {
                  e.stopPropagation()
                  resizeMouseDown(e, 'se')
                }}
              />
              <div
                className="resize-handle resize-handle-sw"
                onMouseDown={(e) => {
                  e.stopPropagation()
                  resizeMouseDown(e, 'sw')
                }}
              />
            </>
          )}
        </>
      )}

      {createPortal(contextMenuEl, document.body)}
    </div>
  )
}
