import type { WidgetPosition, PanelSettings } from '../types'

interface V1LayoutItem {
  i: string
  x: number
  y: number
  w: number
  h: number
}
type V1Layout = V1LayoutItem[]

const V1_COLS = 12
const V1_ROW_HEIGHT = 60
const V1_MARGIN = 12
const V1_CONTAINER_WIDTH = 1200

export function migrateV1LayoutToV2(
  layout: V1Layout,
  containerWidth: number = V1_CONTAINER_WIDTH
): WidgetPosition[] {
  const colWidth = (containerWidth - V1_MARGIN * (V1_COLS + 1)) / V1_COLS

  return layout.map((item, index) => ({
    widgetId: item.i,
    x: item.x * (colWidth + V1_MARGIN) + V1_MARGIN,
    y: item.y * (V1_ROW_HEIGHT + V1_MARGIN) + V1_MARGIN,
    w: item.w * (colWidth + V1_MARGIN) - V1_MARGIN,
    h: item.h * (V1_ROW_HEIGHT + V1_MARGIN) - V1_MARGIN,
    zIndex: index,
  }))
}

export function getDefaultPanelSettings(): PanelSettings {
  return {
    layoutMode: 'free',
    gridSize: 20,
  }
}

const VALID_FOCUS_MODES: readonly string[] = ['pomodoro', 'countup', 'countdown']
const VALID_TASK_STATUSES: readonly string[] = ['todo', 'doing', 'done']
const VALID_TASK_PRIORITIES: readonly string[] = ['low', 'medium', 'high']

function isValidFocusMode(v: unknown): v is import('../types').FocusMode {
  return typeof v === 'string' && VALID_FOCUS_MODES.includes(v)
}

export function migrateFocusSession(raw: unknown): import('../types').FocusSessionV2 {
  if (!raw || typeof raw !== 'object') throw new Error('invalid session: not an object')
  const s = raw as Record<string, unknown>

  const v = s.schemaVersion
  if (v !== 1 && v !== 2) throw new Error(`unsupported schemaVersion: ${v}`)

  if (typeof s.id !== 'string' || !s.id) throw new Error('missing id')
  if (typeof s.panelId !== 'string' || !s.panelId) throw new Error('missing panelId')
  if (typeof s.focusTimerWidgetId !== 'string' || !s.focusTimerWidgetId) throw new Error('missing focusTimerWidgetId')

  const startedAt = s.startedAt
  const endedAt = s.endedAt
  const durationMs = s.durationMs
  const createdAt = s.createdAt

  if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) throw new Error('invalid startedAt')
  if (typeof endedAt !== 'number' || !Number.isFinite(endedAt)) throw new Error('invalid endedAt')
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs)) throw new Error('invalid durationMs')
  if (typeof createdAt !== 'number' || !Number.isFinite(createdAt)) throw new Error('invalid createdAt')

  if (startedAt >= endedAt) throw new Error('startedAt must < endedAt')
  if (durationMs <= 0) throw new Error('durationMs must > 0')
  if (durationMs > endedAt - startedAt) throw new Error('durationMs exceeds time range')

  if (!isValidFocusMode(s.mode)) throw new Error(`invalid mode: ${s.mode}`)

  const label = typeof s.label === 'string' ? s.label.trim().slice(0, 200) : undefined

  if (v === 1) {
    return {
      id: s.id,
      panelId: s.panelId,
      focusTimerWidgetId: s.focusTimerWidgetId,
      label,
      startedAt,
      endedAt,
      durationMs,
      mode: s.mode,
      createdAt,
      schemaVersion: 2,
    }
  }

  const taskId = typeof s.taskId === 'string' && s.taskId ? s.taskId : undefined
  const taskTitleSnapshot = typeof s.taskTitleSnapshot === 'string'
    ? s.taskTitleSnapshot.trim().slice(0, 200) : undefined

  return {
    id: s.id,
    panelId: s.panelId,
    focusTimerWidgetId: s.focusTimerWidgetId,
    taskId,
    taskTitleSnapshot,
    label,
    startedAt,
    endedAt,
    durationMs,
    mode: s.mode,
    createdAt,
    schemaVersion: 2,
  }
}

export function migrateTask(raw: unknown): import('../types').Task {
  if (!raw || typeof raw !== 'object') throw new Error('invalid task: not an object')
  const s = raw as Record<string, unknown>

  const v = s.schemaVersion
  if (v !== 1) throw new Error(`unsupported task schemaVersion: ${v}`)

  if (typeof s.id !== 'string' || !s.id) throw new Error('missing id')
  if (typeof s.panelId !== 'string' || !s.panelId) throw new Error('missing panelId')

  const title = typeof s.title === 'string' ? s.title.trim() : ''
  if (!title) throw new Error('empty title')
  if (title.length > 200) throw new Error('title too long')

  if (!VALID_TASK_STATUSES.includes(s.status as string)) throw new Error(`invalid status: ${s.status}`)
  if (!VALID_TASK_PRIORITIES.includes(s.priority as string)) throw new Error(`invalid priority: ${s.priority}`)

  const createdAt = s.createdAt
  const updatedAt = s.updatedAt
  if (typeof createdAt !== 'number' || !Number.isFinite(createdAt)) throw new Error('invalid createdAt')
  if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) throw new Error('invalid updatedAt')

  const dueAt = typeof s.dueAt === 'number' && Number.isFinite(s.dueAt) && s.dueAt > 0
    ? s.dueAt : undefined

  return {
    id: s.id,
    panelId: s.panelId,
    title,
    status: s.status as import('../types').TaskStatus,
    priority: s.priority as import('../types').TaskPriority,
    dueAt,
    createdAt,
    updatedAt,
    schemaVersion: 1,
  }
}
