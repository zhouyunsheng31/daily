import { useEffect, useCallback, useState } from 'react'

interface EditingState {
  widgetId: string | null
  zIndex: number
}

const EDITING_Z_INDEX = 9999

let editingState: EditingState = { widgetId: null, zIndex: 0 }
const listeners = new Set<() => void>()

function notifyListeners() {
  listeners.forEach(fn => fn())
}

export function enterEditMode(widgetId: string, currentZIndex: number): void {
  editingState = { widgetId, zIndex: currentZIndex }
  notifyListeners()
}

export function exitEditMode(): void {
  editingState = { widgetId: null, zIndex: 0 }
  notifyListeners()
}

export function getEditingWidgetId(): string | null {
  return editingState.widgetId
}

export function getEditingZIndex(): number {
  return EDITING_Z_INDEX
}

export function useEditingState(): EditingState {
  const [, setTick] = useState(0)

  useEffect(() => {
    const listener = () => setTick(t => t + 1)
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [])

  return editingState
}

export function useEditMode(widgetId: string, currentZIndex: number) {
  const isEditing = editingState.widgetId === widgetId

  const enter = useCallback(() => {
    enterEditMode(widgetId, currentZIndex)
  }, [widgetId, currentZIndex])

  const exit = useCallback(() => {
    exitEditMode()
  }, [])

  useEffect(() => {
    if (!isEditing) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        exitEditMode()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isEditing])

  return {
    isEditing,
    editingZIndex: isEditing ? EDITING_Z_INDEX : currentZIndex,
    dragEnabled: !isEditing,
    enterEditMode: enter,
    exitEditMode: exit,
  }
}
