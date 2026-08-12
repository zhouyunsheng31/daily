import type { FocusMode, FocusSessionV2, TaskStatus, TaskPriority, Task, Habit, HabitCheckin, MoodEntry, CalendarEvent, QuizCategory, QuizSession } from '../types'
import { isValidLocalDateString } from './date'

const VALID_FOCUS_MODES: readonly string[] = ['pomodoro', 'countup', 'countdown']
const VALID_TASK_STATUSES: readonly string[] = ['todo', 'doing', 'done']
const VALID_TASK_PRIORITIES: readonly string[] = ['low', 'medium', 'high']

function isValidFocusMode(v: unknown): v is FocusMode {
  return typeof v === 'string' && VALID_FOCUS_MODES.includes(v)
}

export function migrateFocusSession(raw: unknown): FocusSessionV2 {
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

export function migrateTask(raw: unknown): Task {
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
    status: s.status as TaskStatus,
    priority: s.priority as TaskPriority,
    dueAt,
    createdAt,
    updatedAt,
    schemaVersion: 1,
  }
}

export const HABIT_COLORS = ['#ef4444', '#f97316', '#22c55e', '#3b82f6', '#8b5cf6', '#71717a'] as const

export function readTimestamp(value: unknown, field: string, now?: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`invalid ${field}`)
  }
  const ref = now ?? Date.now()
  if (value > ref + 24 * 60 * 60 * 1000) {
    throw new Error(`${field} is too far in the future`)
  }
  return value
}

export function validateTimestampOrder(createdAt: number, updatedAt: number): void {
  if (updatedAt < createdAt) {
    throw new Error('updatedAt must be >= createdAt')
  }
}

export function migrateHabit(raw: unknown): Habit {
  if (!raw || typeof raw !== 'object') throw new Error('invalid habit: not an object')
  const s = raw as Record<string, unknown>

  if (s.schemaVersion !== 1) throw new Error(`unsupported habit schemaVersion: ${s.schemaVersion}`)

  if (typeof s.id !== 'string' || !s.id) throw new Error('missing id')
  if (typeof s.panelId !== 'string' || !s.panelId) throw new Error('missing panelId')

  const title = typeof s.title === 'string' ? s.title.trim() : ''
  if (!title) throw new Error('empty title')
  if (title.length > 50) throw new Error('title too long')

  if (s.color !== undefined) {
    if (typeof s.color !== 'string' || !HABIT_COLORS.includes(s.color as typeof HABIT_COLORS[number])) {
      throw new Error('invalid color')
    }
  }
  const color = s.color as string | undefined

  const now = Date.now()
  const createdAt = readTimestamp(s.createdAt, 'createdAt', now)
  const updatedAt = readTimestamp(s.updatedAt, 'updatedAt', now)
  validateTimestampOrder(createdAt, updatedAt)

  let archivedAt: number | undefined
  if (s.archivedAt !== undefined && s.archivedAt !== null) {
    archivedAt = readTimestamp(s.archivedAt, 'archivedAt', now)
    if (archivedAt < createdAt) throw new Error('archivedAt must be >= createdAt')
    if (archivedAt < updatedAt) throw new Error('archivedAt must be >= updatedAt')
  }

  return {
    id: s.id,
    panelId: s.panelId,
    title,
    color,
    archivedAt,
    createdAt,
    updatedAt,
    schemaVersion: 1,
  }
}

export function migrateHabitCheckin(raw: unknown): HabitCheckin {
  if (!raw || typeof raw !== 'object') throw new Error('invalid habitCheckin: not an object')
  const s = raw as Record<string, unknown>

  if (s.schemaVersion !== 1) throw new Error(`unsupported habitCheckin schemaVersion: ${s.schemaVersion}`)

  if (typeof s.id !== 'string' || !s.id) throw new Error('missing id')
  if (typeof s.panelId !== 'string' || !s.panelId) throw new Error('missing panelId')
  if (typeof s.habitId !== 'string' || !s.habitId) throw new Error('missing habitId')
  if (typeof s.date !== 'string' || !s.date) throw new Error('missing date')

  if (s.id !== `${s.habitId}_${s.date}`) throw new Error('id must be ${habitId}_${date}')

  if (!isValidLocalDateString(s.date)) throw new Error('invalid date')

  const now = Date.now()
  const createdAt = readTimestamp(s.createdAt, 'createdAt', now)

  return {
    id: s.id,
    panelId: s.panelId,
    habitId: s.habitId,
    date: s.date,
    createdAt,
    schemaVersion: 1,
  }
}

export function migrateMoodEntry(raw: unknown): MoodEntry {
  if (!raw || typeof raw !== 'object') throw new Error('invalid moodEntry: not an object')
  const s = raw as Record<string, unknown>

  if (s.schemaVersion !== 1) throw new Error(`unsupported moodEntry schemaVersion: ${s.schemaVersion}`)

  if (typeof s.id !== 'string' || !s.id) throw new Error('missing id')
  if (typeof s.panelId !== 'string' || !s.panelId) throw new Error('missing panelId')
  if (typeof s.date !== 'string' || !s.date) throw new Error('missing date')

  if (s.id !== `mood_${s.panelId}_${s.date}`) throw new Error('id must be mood_${panelId}_${date}')

  if (!isValidLocalDateString(s.date)) throw new Error('invalid date')

  const level = s.level
  if (typeof level !== 'number' || ![1, 2, 3, 4, 5].includes(level)) throw new Error('invalid level')

  if (typeof s.note === 'string' && s.note.length > 200) throw new Error('note too long')
  const rawNote = typeof s.note === 'string' ? s.note.trim() : ''
  const note = rawNote || undefined

  const now = Date.now()
  const createdAt = readTimestamp(s.createdAt, 'createdAt', now)

  return {
    id: s.id,
    panelId: s.panelId,
    level: level as 1 | 2 | 3 | 4 | 5,
    note,
    date: s.date,
    createdAt,
    schemaVersion: 1,
  }
}

export function migrateCalendarEvent(raw: unknown): CalendarEvent {
  if (!raw || typeof raw !== 'object') throw new Error('invalid calendarEvent: not an object')
  const s = raw as Record<string, unknown>
  // 兼容旧字段名 startAt/endAt/description，优先使用新字段名 startsAt/endsAt/note
  const rawStartsAt = s.startsAt ?? s.startAt
  const rawEndsAt = s.endsAt ?? s.endAt
  const rawNote = s.note ?? s.description
  // 兼容旧数据可能缺少 schemaVersion 字段
  if (s.schemaVersion !== undefined && s.schemaVersion !== 1) throw new Error(`unsupported calendarEvent schemaVersion: ${s.schemaVersion}`)
  if (typeof s.id !== 'string' || !s.id) throw new Error('missing id')
  if (typeof s.panelId !== 'string' || !s.panelId) throw new Error('missing panelId')
  const title = typeof s.title === 'string' ? s.title.trim() : ''
  if (!title) throw new Error('empty title')
  if (title.length > 200) throw new Error('title too long')
  if (typeof rawStartsAt !== 'number' || !Number.isFinite(rawStartsAt) || rawStartsAt <= 0) throw new Error('invalid startsAt')
  const startsAt = rawStartsAt
  let endsAt: number | undefined
  if (rawEndsAt !== undefined && rawEndsAt !== null) {
    if (typeof rawEndsAt !== 'number' || !Number.isFinite(rawEndsAt) || rawEndsAt <= 0) throw new Error('invalid endsAt')
    if (rawEndsAt <= startsAt) throw new Error('endsAt must be > startsAt')
    endsAt = rawEndsAt
  }
  let note: string | undefined
  if (rawNote !== undefined && rawNote !== null) {
    if (typeof rawNote !== 'string') throw new Error('invalid note type')
    const trimmed = rawNote.trim()
    if (trimmed.length > 200) throw new Error('note too long')
    note = trimmed || undefined
  }
  const now = Date.now()
  const createdAt = readTimestamp(s.createdAt, 'createdAt', now)
  const updatedAt = readTimestamp(s.updatedAt, 'updatedAt', now)
  validateTimestampOrder(createdAt, updatedAt)
  return { id: s.id, panelId: s.panelId, title, startsAt, endsAt, note, createdAt, updatedAt, schemaVersion: 1 }
}

const VALID_QUIZ_CATEGORIES: readonly string[] = ['algebra', 'geometry', 'calculus', 'trig']

export function migrateQuizSession(raw: unknown): QuizSession {
  if (!raw || typeof raw !== 'object') throw new Error('invalid quizSession: not an object')
  const s = raw as Record<string, unknown>

  if (s.schemaVersion !== 1) throw new Error(`unsupported quizSession schemaVersion: ${s.schemaVersion}`)

  if (typeof s.id !== 'string' || !s.id) throw new Error('missing id')
  if (typeof s.panelId !== 'string' || !s.panelId) throw new Error('missing panelId')
  if (typeof s.latexQuizWidgetId !== 'string' || !s.latexQuizWidgetId) throw new Error('missing latexQuizWidgetId')
  if (typeof s.category !== 'string' || !VALID_QUIZ_CATEGORIES.includes(s.category)) {
    throw new Error(`invalid category: ${s.category}`)
  }

  if (!Array.isArray(s.questionIds)) {
    throw new Error('missing or invalid questionIds')
  }
  const questionIds = s.questionIds.filter((x): x is string => typeof x === 'string')

  const userAnswers = isObject(s.userAnswers) ? s.userAnswers as Record<string, string> : {}
  const gradeResults = isObject(s.gradeResults) ? s.gradeResults as Record<string, boolean> : {}

  const correctCount = typeof s.correctCount === 'number' && Number.isFinite(s.correctCount) ? s.correctCount : 0
  const totalCount = typeof s.totalCount === 'number' && Number.isFinite(s.totalCount) ? s.totalCount : questionIds.length

  if (typeof s.startedAt !== 'number' || !Number.isFinite(s.startedAt) || s.startedAt <= 0) {
    throw new Error('invalid startedAt')
  }
  const finishedAt = typeof s.finishedAt === 'number' && Number.isFinite(s.finishedAt) && s.finishedAt >= 0
    ? s.finishedAt
    : 0

  return {
    id: s.id,
    panelId: s.panelId,
    latexQuizWidgetId: s.latexQuizWidgetId,
    category: s.category as QuizCategory,
    questionIds,
    userAnswers,
    gradeResults,
    correctCount,
    totalCount,
    startedAt: s.startedAt,
    finishedAt,
    schemaVersion: 1,
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
