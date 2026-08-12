import { useRef, useEffect, useState, useCallback, useMemo, type DragEvent } from 'react'
import { createPortal } from 'react-dom'
import { Lock, Unlock, ArrowUpToLine, ArrowDownToLine, ChevronUp, ChevronDown, X, ChevronRight, Minus, Star, StarOff, RefreshCw, Upload, FileCode, Eye, Loader2 } from 'lucide-react'
import { useDraggable } from '../hooks/useDraggable'
import { useResizable } from '../hooks/useResizable'
import { getWidgetConfig } from '../registry'
import { widgetDefinitionMap } from '../registry/widgetDefinitions'
import type { WidgetRenderStatus } from '../types/v2'
import { getColorSchemeStyle, WIDGET_COLOR_SCHEMES } from '../utils/widgetColorSchemes'
import { isLightTheme } from '../utils/color'
import { isInteractiveElement } from '../utils/drawingCoords'
import { useAppStore } from '../stores/useAppStore'
import { useToastStore } from '../stores/useToastStore'
import { uploadWidgetMiniHtml, uploadWidgetIconHtml } from '../api/widgets'
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
  // Phase 2 决策38/39：mini/icon 档 HTML 上传对话框（'mini' | 'icon' | null）
  const [uploadTierDialog, setUploadTierDialog] = useState<'mini' | 'icon' | null>(null)

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
    e.stopPropagation()
    dragMouseDown(e)
  }, [dragMouseDown, onBringToFront])

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
      {/* Phase 2 决策38/39：mini/icon 档 HTML 上传入口 */}
      <div
        className="widget-context-item"
        onClick={() => { setUploadTierDialog('mini'); closeMenu(); }}
      >
        <Upload size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} /> 上传 mini HTML
      </div>
      <div
        className="widget-context-item"
        onClick={() => { setUploadTierDialog('icon'); closeMenu(); }}
      >
        <Upload size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} /> 上传 icon HTML
      </div>
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
      {uploadTierDialog && createPortal(
        <TierHtmlUploadDialog
          widgetId={id}
          tier={uploadTierDialog}
          onClose={() => setUploadTierDialog(null)}
          onSuccess={(html) => {
            // 立即更新本地 state（REST API 已持久化，广播会同步其他客户端）
            const stateField = uploadTierDialog === 'mini' ? 'miniHtml' : 'iconHtml'
            onUpdateState({ [stateField]: html, updatedAt: Date.now() })
            setUploadTierDialog(null)
          }}
        />,
        document.body
      )}
    </div>
  )
}

// ============================================================================
// Phase 2 决策38/39：mini/icon 档 HTML 上传对话框
// 支持拖拽 .html 文件 + 粘贴 HTML 代码 + 实时预览
// 复用 UploadWidget.tsx 的拖拽/粘贴机制（spec §11.1）
// ============================================================================

function TierHtmlUploadDialog({
  widgetId,
  tier,
  onClose,
  onSuccess,
}: {
  widgetId: string
  tier: 'mini' | 'icon'
  onClose: () => void
  onSuccess: (html: string) => void
}) {
  const showToast = useToastStore(s => s.showToast)
  const updateToast = useToastStore(s => s.updateToast)
  const [html, setHtml] = useState('')
  const [loading, setLoading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [showPreview, setShowPreview] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const tierLabel = tier === 'mini' ? 'mini 档（精简 HTML 形态）' : 'icon 档（HTML 图标）'
  const tierDesc = tier === 'mini'
    ? '决策38：mini 档是相册缩放中档，应为精简 HTML 形态（非简单缩放）。HTML 将通过 dangerouslySetInnerHTML 渲染。'
    : '决策39：icon 档是最小档，应为 AI 画的 HTML 图标（圆形/任意形状，非固定方形）。'

  // 读取 HTML 文件内容
  const readFile = useCallback((file: File) => {
    const isHtml = file.type === 'text/html' || file.name.toLowerCase().endsWith('.html') || file.name.toLowerCase().endsWith('.htm')
    if (!isHtml) {
      setError('请上传 .html 或 .htm 文件')
      return
    }
    setError(null)
    const reader = new FileReader()
    reader.onload = (e) => {
      const content = typeof e.target?.result === 'string' ? e.target.result : ''
      setHtml(content)
    }
    reader.onerror = () => setError('读取文件失败')
    reader.readAsText(file)
  }, [])

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) readFile(file)
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) readFile(file)
    e.target.value = ''
  }

  // 提交上传
  const handleSubmit = async () => {
    if (loading) return
    if (!html.trim()) {
      setError('请提供 HTML 内容')
      return
    }
    setLoading(true)
    setError(null)
    const toastId = showToast({ type: 'loading', message: `正在上传 ${tier} HTML...` })
    try {
      if (tier === 'mini') {
        await uploadWidgetMiniHtml(widgetId, html)
      } else {
        await uploadWidgetIconHtml(widgetId, html)
      }
      updateToast(toastId, { type: 'success', message: `${tier} HTML 已上传`, duration: 2000 })
      onSuccess(html)
    } catch (err) {
      const msg = err instanceof Error ? err.message : '上传失败'
      setError(msg)
      updateToast(toastId, { type: 'error', message: msg, duration: 4000 })
    } finally {
      setLoading(false)
    }
  }

  // 清除已设置的 mini/icon HTML（传空字符串会被后端拒绝，所以这里只支持上传新内容）
  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '6px 10px', borderRadius: 6,
    border: '1px solid var(--border-default, rgba(0,0,0,0.12))',
    background: 'var(--bg-elevated, #f0f0f2)',
    color: 'var(--text-primary, #1d1d1f)',
    fontSize: 13, fontFamily: 'inherit', outline: 'none',
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 10001,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        animation: 'popup-fade-in 0.15s ease-out',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(640px, 90vw)', maxHeight: '85vh', overflow: 'auto',
          background: 'var(--bg-surface, #fff)',
          border: '1px solid var(--border-default, rgba(0,0,0,0.12))',
          borderRadius: 12, boxShadow: '0 16px 40px rgba(0,0,0,0.2)', padding: 20,
        }}
      >
        {/* 头部 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>上传 {tierLabel}</h3>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary, #adb5bd)', padding: 4, display: 'inline-flex', alignItems: 'center' }}
            title="关闭"
          >
            <X size={18} />
          </button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-tertiary, #86868b)', marginBottom: 12, lineHeight: 1.4 }}>
          {tierDesc}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {/* 左侧：输入区 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* 拖拽区 */}
            <div
              onDrop={handleDrop}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={(e) => { e.preventDefault(); setDragOver(false) }}
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: `2px dashed ${dragOver ? 'var(--color-primary, #4A90E2)' : 'var(--border-default, rgba(0,0,0,0.18))'}`,
                borderRadius: 8, padding: '16px 12px', textAlign: 'center', cursor: 'pointer',
                background: dragOver ? 'var(--color-primary-muted, rgba(74,144,226,0.08))' : 'var(--bg-elevated, #f0f0f2)',
                transition: 'all 0.15s ease',
              }}
            >
              <FileCode size={24} style={{ color: 'var(--text-tertiary, #adb5bd)', marginBottom: 4 }} />
              <div style={{ fontSize: 11, color: 'var(--text-secondary, #86868b)' }}>
                拖拽 .html 文件，或点击选择
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".html,.htm,text/html"
                onChange={handleFileSelect}
                style={{ display: 'none' }}
              />
            </div>
            {/* HTML 代码文本框 */}
            <div>
              <label style={{ fontSize: 11, color: 'var(--text-secondary, #86868b)', marginBottom: 4, display: 'block' }}>
                或粘贴 HTML 代码
              </label>
              <textarea
                value={html}
                onChange={(e) => setHtml(e.target.value)}
                placeholder={tier === 'mini' ? '<div>精简摘要 HTML</div>' : '<div>图标 HTML（圆形/任意形状）</div>'}
                style={{
                  ...inputStyle, minHeight: 100, maxHeight: 180,
                  fontFamily: 'monospace', fontSize: 11, resize: 'vertical',
                }}
              />
            </div>
          </div>

          {/* 右侧：预览区 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={{ fontSize: 11, color: 'var(--text-secondary, #86868b)', fontWeight: 600 }}>预览</label>
              <button
                onClick={() => setShowPreview(!showPreview)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-primary, #4A90E2)', fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4 }}
              >
                <Eye size={11} /> {showPreview ? '隐藏' : '显示'}
              </button>
            </div>
            <div
              style={{
                width: '100%', height: 180,
                border: '1px solid var(--border-default, rgba(0,0,0,0.12))',
                borderRadius: 8, background: '#fff', overflow: 'hidden', position: 'relative',
              }}
            >
              {showPreview && html ? (
                <iframe
                  srcDoc={html}
                  style={{ width: '100%', height: '100%', border: 'none' }}
                  sandbox="allow-scripts"
                  title={`${tier}-preview`}
                />
              ) : (
                <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary, #adb5bd)', fontSize: 11 }}>
                  {html ? '预览已隐藏' : '提供 HTML 后显示预览'}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 错误提示 */}
        {error && (
          <div style={{ marginTop: 12, padding: '6px 10px', borderRadius: 6, background: 'rgba(255,59,48,0.1)', color: 'var(--color-error, #FF3B30)', fontSize: 12 }}>
            {error}
          </div>
        )}

        {/* 底部按钮 */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button
            onClick={onClose}
            style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid var(--border-default, rgba(0,0,0,0.12))', background: 'var(--bg-elevated, #f0f0f2)', color: 'var(--text-primary, #1d1d1f)', cursor: 'pointer', fontSize: 12 }}
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || !html.trim()}
            style={{
              padding: '6px 14px', borderRadius: 6, border: 'none',
              background: 'var(--color-primary, #4A90E2)', color: '#fff',
              cursor: loading ? 'not-allowed' : 'pointer', fontSize: 12, fontWeight: 500,
              display: 'inline-flex', alignItems: 'center', gap: 6,
              opacity: (loading || !html.trim()) ? 0.6 : 1,
            }}
          >
            {loading && <Loader2 size={12} className="animate-spin" />}
            上传
          </button>
        </div>
      </div>
    </div>
  )
}
