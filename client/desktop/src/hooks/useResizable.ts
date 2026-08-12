import { useCallback, useEffect, useRef } from 'react'

interface UseResizableOptions {
  enabled?: boolean
  onResize: (deltaW: number, deltaH: number, deltaX?: number) => void
  onScale?: (deltaScale: number) => void
  onEnd?: () => void
}

export function useResizable({ enabled = true, onResize, onScale, onEnd }: UseResizableOptions) {
  const resizeState = useRef({
    isResizing: false,
    lastX: 0,
    lastY: 0,
    pendingW: 0,
    pendingH: 0,
    pendingX: 0,
    pendingScale: 0,
    rafId: null as number | null,
  })
  const onResizeRef = useRef(onResize)
  const onScaleRef = useRef(onScale)
  const onEndRef = useRef(onEnd)

  useEffect(() => { onResizeRef.current = onResize }, [onResize])
  useEffect(() => { if (onScale) onScaleRef.current = onScale }, [onScale])
  useEffect(() => { if (onEnd) onEndRef.current = onEnd }, [onEnd])

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, direction: 'se' | 'sw' | 'e' | 's' = 'se') => {
      if (!enabled || e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()

      resizeState.current = {
        isResizing: true,
        lastX: e.clientX,
        lastY: e.clientY,
        pendingW: 0,
        pendingH: 0,
        pendingX: 0,
        pendingScale: 0,
        rafId: null,
      }

      const flushDelta = () => {
        const state = resizeState.current
        const dw = state.pendingW
        const dh = state.pendingH
        const dx = state.pendingX
        const ds = state.pendingScale
        state.pendingW = 0
        state.pendingH = 0
        state.pendingX = 0
        state.pendingScale = 0
        state.rafId = null
        if (direction === 'se' && onScaleRef.current) {
          // se 方向：按比例缩放
          if (ds !== 0) onScaleRef.current(ds)
        } else {
          // sw/e/s 方向：只改变边框
          if (dw !== 0 || dh !== 0) onResizeRef.current(dw, dh, dx || undefined)
        }
      }

      const handleMouseMove = (e: MouseEvent) => {
        if (!resizeState.current.isResizing) return
        const state = resizeState.current

        if (direction === 'se') {
          // se 方向：按比例缩放，用鼠标移动距离计算 scale 变化
          const dx = e.clientX - state.lastX
          const dy = e.clientY - state.lastY
          // 取 x 和 y 方向的平均值作为缩放依据
          const avgDelta = (dx + dy) / 2
          // 每 100px 对应 0.1 的 scale 变化
          state.pendingScale += avgDelta / 1000
        } else {
          // sw 方向：左下角拖动，只改宽度（反向）和高度，同时移动x
          if (direction === 'sw') {
            const mouseDx = e.clientX - state.lastX
            state.pendingW += mouseDx
            state.pendingX += mouseDx
            state.pendingH += e.clientY - state.lastY
          }
          if (direction === 'e') state.pendingW += e.clientX - state.lastX
          if (direction === 's') state.pendingH += e.clientY - state.lastY
        }

        state.lastX = e.clientX
        state.lastY = e.clientY

        if (state.rafId === null) {
          state.rafId = requestAnimationFrame(flushDelta)
        }
      }

      const handleMouseUp = () => {
        if (!resizeState.current.isResizing) return
        const state = resizeState.current
        if (state.rafId !== null) {
          cancelAnimationFrame(state.rafId)
          flushDelta()
        }
        state.isResizing = false
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        onEndRef.current?.()
      }

      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      document.body.style.cursor =
        direction === 'se' ? 'nwse-resize' : direction === 'sw' ? 'nesw-resize' : direction === 'e' ? 'ew-resize' : 'ns-resize'
      document.body.style.userSelect = 'none'
    },
    [enabled]
  )

  return { handleMouseDown }
}
