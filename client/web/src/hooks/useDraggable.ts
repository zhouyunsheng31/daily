import { useCallback, useEffect, useRef } from 'react'

const DRAG_THRESHOLD = 5

interface UseDraggableOptions {
  enabled?: boolean
  onMove: (deltaX: number, deltaY: number) => void
  onDragStart?: () => void
  onEnd?: () => void
}

export function useDraggable({ enabled = true, onMove, onDragStart, onEnd }: UseDraggableOptions) {
  const dragState = useRef<{
    pending: boolean
    isDragging: boolean
    startX: number
    startY: number
    originX: number
    originY: number
    pendingDeltaX: number
    pendingDeltaY: number
    rafId: number | null
  }>({ pending: false, isDragging: false, startX: 0, startY: 0, originX: 0, originY: 0, pendingDeltaX: 0, pendingDeltaY: 0, rafId: null })
  const onMoveRef = useRef(onMove)
  const onDragStartRef = useRef(onDragStart)
  const onEndRef = useRef(onEnd)

  useEffect(() => { onMoveRef.current = onMove }, [onMove])
  useEffect(() => { if (onDragStart) onDragStartRef.current = onDragStart }, [onDragStart])
  useEffect(() => { if (onEnd) onEndRef.current = onEnd }, [onEnd])

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!enabled || e.button !== 0) return
      dragState.current = {
        pending: true,
        isDragging: false,
        startX: e.clientX,
        startY: e.clientY,
        originX: e.clientX,
        originY: e.clientY,
        pendingDeltaX: 0,
        pendingDeltaY: 0,
        rafId: null,
      }

      const flushDelta = () => {
        const state = dragState.current
        const dx = state.pendingDeltaX
        const dy = state.pendingDeltaY
        state.pendingDeltaX = 0
        state.pendingDeltaY = 0
        state.rafId = null
        if (dx !== 0 || dy !== 0) {
          onMoveRef.current(dx, dy)
        }
      }

      const handleMouseMove = (e: MouseEvent) => {
        const state = dragState.current
        if (!state.pending && !state.isDragging) return

        // 还未确认拖动，检查是否超过阈值
        if (state.pending && !state.isDragging) {
          const dx = e.clientX - state.originX
          const dy = e.clientY - state.originY
          if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return
          // 超过阈值，确认拖动
          state.pending = false
          state.isDragging = true
          document.body.style.cursor = 'grabbing'
          document.body.style.userSelect = 'none'
          onDragStartRef.current?.()
        }

        const deltaX = e.clientX - state.startX
        const deltaY = e.clientY - state.startY
        state.startX = e.clientX
        state.startY = e.clientY
        state.pendingDeltaX += deltaX
        state.pendingDeltaY += deltaY

        // 用 rAF 节流，每帧最多触发一次 onMove
        if (state.rafId === null) {
          state.rafId = requestAnimationFrame(flushDelta)
        }
      }

      const handleMouseUp = () => {
        const state = dragState.current
        if (!state.pending && !state.isDragging) return
        // 刷出剩余的 delta
        if (state.rafId !== null) {
          cancelAnimationFrame(state.rafId)
          flushDelta()
        }
        state.pending = false
        state.isDragging = false
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        onEndRef.current?.()
      }

      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    },
    [enabled]
  )

  return { handleMouseDown, isDragging: () => dragState.current.isDragging }
}
