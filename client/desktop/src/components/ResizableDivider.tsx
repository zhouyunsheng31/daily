// ResizableDivider 组件（批次1: 可拖拽分割线）
// 实现要点：
// 1. 水平方向（horizontal）：分割线水平摆放，拖拽改变高度（cursor: row-resize）
// 2. 垂直方向（vertical）：分割线垂直摆放，拖拽改变宽度（cursor: col-resize）
// 3. 拖拽期间用本地 ref 暂存位置数据，不触发 React 渲染
// 4. 用 requestAnimationFrame 节流 clamp 计算，避免高频 mousemove 浪费
// 5. mouseup 时通过 onResize 回调最终 delta（从 mousedown 到 mouseup 的累计位移）
// 6. 双击触发 onReset
// 7. 悬停时颜色加深
import { useRef, useState, useCallback } from 'react'

export interface ResizableDividerProps {
  direction: 'horizontal' | 'vertical'
  onResize: (delta: number) => void
  onReset?: () => void
  minSize?: number
  maxSize?: number
  currentSize?: number
}

export default function ResizableDivider({
  direction,
  onResize,
  onReset,
  minSize,
  maxSize,
  currentSize,
}: ResizableDividerProps) {
  // 拖拽起始位置（client 坐标）和起始尺寸，用 ref 暂存避免每次 mousemove 触发渲染
  const startClientRef = useRef<number>(0)
  const startSizeRef = useRef<number>(0)
  // 最终 delta：mousemove 期间用 ref 暂存，mouseup 时读取并回调 onResize
  const finalDeltaRef = useRef<number>(0)
  // rAF handle 用于节流 clamp 计算
  const rafRef = useRef<number | null>(null)
  // 待消费的最新 rawDelta：mousemove 写入，rAF 回调读取
  const pendingRawDeltaRef = useRef<number>(0)
  // 视觉反馈：拖拽态 + 悬停态
  const [isDragging, setIsDragging] = useState(false)
  const [isHovered, setIsHovered] = useState(false)

  // 钳制 delta 到 [minSize, maxSize] 范围（基于 currentSize）
  const clampDelta = useCallback((rawDelta: number): number => {
    if (currentSize === undefined) return rawDelta
    const newSize = currentSize + rawDelta
    let clamped = newSize
    if (minSize !== undefined) clamped = Math.max(clamped, minSize)
    if (maxSize !== undefined) clamped = Math.min(clamped, maxSize)
    return clamped - currentSize
  }, [currentSize, minSize, maxSize])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const startClient = direction === 'vertical' ? e.clientX : e.clientY
    startClientRef.current = startClient
    startSizeRef.current = currentSize ?? 0
    finalDeltaRef.current = 0
    pendingRawDeltaRef.current = 0
    setIsDragging(true)

    const handleMouseMove = (ev: MouseEvent) => {
      const currentClient = direction === 'vertical' ? ev.clientX : ev.clientY
      pendingRawDeltaRef.current = currentClient - startClientRef.current
      // 用 rAF 节流 clamp 计算和 finalDeltaRef 更新（同一帧内多次 mousemove 只计算一次）
      if (rafRef.current !== null) return
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null
        finalDeltaRef.current = clampDelta(pendingRawDeltaRef.current)
      })
    }

    const handleMouseUp = () => {
      // 取消 pending rAF，防止内存泄漏
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      // 立即同步计算一次 final delta（防止最后一帧 rAF 被取消丢失数据）
      finalDeltaRef.current = clampDelta(pendingRawDeltaRef.current)
      const finalDelta = finalDeltaRef.current
      setIsDragging(false)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      // 通过 onResize 回调最终值（mouseup 时一次性提交）
      if (finalDelta !== 0) {
        onResize(finalDelta)
      }
    }

    // 拖拽期间覆盖全局 cursor，避免在子元素上闪烁
    document.body.style.cursor = direction === 'vertical' ? 'col-resize' : 'row-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [direction, clampDelta, onResize, currentSize])

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (onReset) onReset()
  }, [onReset])

  const isVertical = direction === 'vertical'

  // 分割线本体样式：1px 厚，颜色随状态变化
  const dividerStyle: React.CSSProperties = {
    position: 'relative',
    flexShrink: 0,
    backgroundColor: isDragging
      ? 'var(--color-primary)'
      : isHovered
        ? 'var(--border-default)'
        : 'var(--border-subtle)',
    transition: 'background-color 120ms ease-out',
    ...(isVertical
      ? { width: '1px', cursor: 'col-resize', height: '100%' }
      : { height: '1px', cursor: 'row-resize', width: '100%' }),
  }

  // 扩大可点击命中区域（不改变视觉宽度）：上下/左右各扩展 3px（共 7px 厚命中区）
  const hitAreaStyle: React.CSSProperties = {
    position: 'absolute',
    inset: isVertical ? '-3px -3px -3px -3px' : '-3px -3px -3px -3px',
    zIndex: 1,
  }

  return (
    <div
      style={dividerStyle}
      onMouseDown={handleMouseDown}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onDoubleClick={handleDoubleClick}
      role="separator"
      aria-orientation={isVertical ? 'vertical' : 'horizontal'}
    >
      {/* 透明命中区域，扩大拖拽响应范围 */}
      <div style={hitAreaStyle} />
    </div>
  )
}
