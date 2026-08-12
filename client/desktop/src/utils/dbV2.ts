import { setDbInstance } from './idbTx'
import type { PanelTemplate } from '../types'

export const DB_NAME = 'living-dashboard-v2'
export const DB_VERSION = 11

export const V2_STORE_NAMES = [
  'panels',
  'widgetRecords',
  'widgetStates',
  'tasks',
  'calendarEvents',
  'focusSessions',
  'habits',
  'habitCheckins',
  'moodEntries',
  'importStaging',
  'settings',
  'meta',
  'dynamic-widgets',
  'playlists',
  'notes',
  'journals',
  'quickNotes',
  'savingsGoals',
  'savingsTransactions',
  'aiConversations',
  'aiMemories',
  'aiAuditLog',
  'drawingStrokes',
  'widgetConnections',
  'quizSessions',
  'vocabDecks',
  'vocabProgress',
  'sudokuGames',
  'mistakes',
  'panelTemplates',
  'htmlWidgets',
  'kvStorage',
  'webTabs',
  'bookmarks',
  'favorites',
] as const

export type V2StoreName = (typeof V2_STORE_NAMES)[number]

interface IndexDefinition {
  name: string
  keyPath: string | string[]
  options: IDBIndexParameters
}

export const V2_INDEX_DEFINITIONS: Record<string, IndexDefinition[]> = {
  panels: [{ name: 'by_name', keyPath: 'data.name', options: { unique: false } }],
  widgetRecords: [
    { name: 'by_panelId', keyPath: 'data.panelId', options: { unique: false } },
    { name: 'by_type', keyPath: 'data.type', options: { unique: false } },
    { name: 'by_recordStatus', keyPath: 'data.recordStatus', options: { unique: false } },
  ],
  widgetStates: [
    { name: 'by_widgetId', keyPath: 'data.widgetId', options: { unique: false } },
    { name: 'by_panelId', keyPath: 'data.panelId', options: { unique: false } },
  ],
  tasks: [
    { name: 'by_panelId', keyPath: 'data.panelId', options: { unique: false } },
    { name: 'by_taskStatus', keyPath: 'data.status', options: { unique: false } },  // task 数据使用 status 字段（不是 taskStatus）
    { name: 'by_recordStatus', keyPath: 'data.recordStatus', options: { unique: false } },
  ],
  calendarEvents: [
    { name: 'by_panelId', keyPath: 'data.panelId', options: { unique: false } },
    { name: 'by_startAt', keyPath: 'data.startsAt', options: { unique: false } },
    { name: 'by_recordStatus', keyPath: 'data.recordStatus', options: { unique: false } },
  ],
  focusSessions: [
    { name: 'by_panelId', keyPath: 'data.panelId', options: { unique: false } },
    { name: 'by_taskId', keyPath: 'data.taskId', options: { unique: false } },
    { name: 'by_startedAt', keyPath: 'data.startedAt', options: { unique: false } },
  ],
  habits: [
    { name: 'by_panelId', keyPath: 'data.panelId', options: { unique: false } },
    { name: 'by_name', keyPath: 'data.name', options: { unique: false } },
  ],
  habitCheckins: [
    { name: 'by_panelId', keyPath: 'data.panelId', options: { unique: false } },
    { name: 'by_habitId', keyPath: 'data.habitId', options: { unique: false } },
    { name: 'by_date', keyPath: 'data.date', options: { unique: false } },
    { name: 'by_habitId_date', keyPath: ['data.habitId', 'data.date'], options: { unique: true } },
  ],
  moodEntries: [
    { name: 'by_panelId', keyPath: 'data.panelId', options: { unique: false } },
    { name: 'by_date', keyPath: 'data.date', options: { unique: false } },
    { name: 'by_recordStatus', keyPath: 'data.recordStatus', options: { unique: false } },
    { name: 'by_panelId_date', keyPath: ['data.panelId', 'data.date'], options: { unique: true } },
  ],
  importStaging: [],
  settings: [],
  meta: [],
  'dynamic-widgets': [],
  playlists: [],
  notes: [
    { name: 'by_tags', keyPath: 'data.tags', options: { unique: false, multiEntry: true } },
    { name: 'by_createdAt', keyPath: 'data.createdAt', options: { unique: false } },
  ],
  journals: [
    { name: 'by_date', keyPath: 'data.date', options: { unique: false } },
    { name: 'by_createdAt', keyPath: 'data.createdAt', options: { unique: false } },
  ],
  quickNotes: [
    { name: 'by_tags', keyPath: 'data.tags', options: { unique: false, multiEntry: true } },
    { name: 'by_createdAt', keyPath: 'data.createdAt', options: { unique: false } },
  ],
  savingsGoals: [
    { name: 'by_deadline', keyPath: 'data.deadline', options: { unique: false } },
    { name: 'by_createdAt', keyPath: 'data.createdAt', options: { unique: false } },
  ],
  savingsTransactions: [
    { name: 'by_goalId', keyPath: 'data.goalId', options: { unique: false } },
    { name: 'by_createdAt', keyPath: 'data.createdAt', options: { unique: false } },
  ],
  aiConversations: [
    { name: 'by_sessionId', keyPath: 'data.sessionId', options: { unique: false } },
    { name: 'by_createdAt', keyPath: 'data.createdAt', options: { unique: false } },
  ],
  aiMemories: [
    { name: 'by_category', keyPath: 'data.category', options: { unique: false } },
    { name: 'by_key', keyPath: 'data.key', options: { unique: false } },
    { name: 'by_pinned', keyPath: 'data.pinned', options: { unique: false } },
    { name: 'by_createdAt', keyPath: 'data.createdAt', options: { unique: false } },
  ],
  aiAuditLog: [
    { name: 'by_sessionId', keyPath: 'data.sessionId', options: { unique: false } },
    { name: 'by_createdAt', keyPath: 'data.createdAt', options: { unique: false } },
  ],
  drawingStrokes: [
    { name: 'by_panelId', keyPath: 'data.panelId', options: { unique: false } },
    { name: 'by_panelId_createdAt', keyPath: ['data.panelId', 'data.createdAt'], options: { unique: false } },
  ],
  widgetConnections: [
    { name: 'by_panelId', keyPath: 'data.panelId', options: { unique: false } },
  ],
  quizSessions: [
    { name: 'by_panelId', keyPath: 'data.panelId', options: { unique: false } },
    { name: 'by_latexQuizWidgetId', keyPath: 'data.latexQuizWidgetId', options: { unique: false } },
    { name: 'by_startedAt', keyPath: 'data.startedAt', options: { unique: false } },
  ],
  vocabDecks: [
    { name: 'by_source', keyPath: 'data.source', options: { unique: false } },
  ],
  vocabProgress: [
    { name: 'by_deckId', keyPath: 'data.deckId', options: { unique: false } },
    { name: 'by_deckId_status', keyPath: ['data.deckId', 'data.status'], options: { unique: false } },
    { name: 'by_nextReviewAt', keyPath: 'data.nextReviewAt', options: { unique: false } },
    { name: 'by_deckId_nextReviewAt', keyPath: ['data.deckId', 'data.nextReviewAt'], options: { unique: false } },
  ],
  sudokuGames: [
    { name: 'by_panelId', keyPath: 'data.panelId', options: { unique: false } },
    { name: 'by_sudokuWidgetId', keyPath: 'data.sudokuWidgetId', options: { unique: false } },
    { name: 'by_status', keyPath: 'data.status', options: { unique: false } },
    { name: 'by_createdAt', keyPath: 'data.createdAt', options: { unique: false } },
  ],
  mistakes: [
    { name: 'by_panelId', keyPath: 'data.panelId', options: { unique: false } },
    { name: 'by_sourceType', keyPath: 'data.sourceType', options: { unique: false } },
    { name: 'by_questionId', keyPath: 'data.questionId', options: { unique: false } },
    { name: 'by_sourceId_questionId', keyPath: ['data.sourceId', 'data.questionId'], options: { unique: false } },
    { name: 'by_nextReviewAt', keyPath: 'data.nextReviewAt', options: { unique: false } },
    { name: 'by_status', keyPath: 'data.status', options: { unique: false } },
    { name: 'by_createdAt', keyPath: 'data.createdAt', options: { unique: false } },
  ],
  panelTemplates: [],
  htmlWidgets: [
    { name: 'by_createdAt', keyPath: 'data.createdAt', options: { unique: false } },
  ],
  kvStorage: [],
  webTabs: [],
  bookmarks: [],
}

let v2Db: IDBDatabase | null = null

/**
 * 删除指定的 IndexedDB database。
 * 即使删除被阻塞或失败也 resolve（调用方可以继续尝试重建）。
 */
function deleteDatabaseSafe(name: string): Promise<void> {
  return new Promise<void>((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(name)
      req.onsuccess = () => resolve()
      req.onerror = () => resolve()  // 删除失败也继续，让调用方重试 open
      req.onblocked = () => resolve() // 阻塞也继续（可能部分连接已释放）
    } catch {
      resolve()
    }
  })
}

/**
 * 实际打开/升级 V2 数据库的内部函数。
 * 失败时 reject（由外层 openV2Database 决定是否重建）。
 */
function doOpenV2Database(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      for (const storeName of V2_STORE_NAMES) {
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName, { keyPath: 'id' })
        }
      }
      for (const storeName of Object.keys(V2_INDEX_DEFINITIONS)) {
        if (!db.objectStoreNames.contains(storeName)) continue
        const store = request.transaction!.objectStore(storeName)
        for (const indexDef of V2_INDEX_DEFINITIONS[storeName]) {
          if (!store.indexNames.contains(indexDef.name)) {
            store.createIndex(indexDef.name, indexDef.keyPath, indexDef.options)
          }
        }
      }
    }

    request.onblocked = () => {
      console.warn('[dbV2] Database upgrade blocked by another connection')
    }

    request.onerror = () => {
      reject(request.error)
    }

    request.onsuccess = () => {
      const db = request.result
      v2Db = db
      setDbInstance(db)
      resolve(db)
    }
  })
}

/**
 * 打开 V2 数据库（带损坏自愈）。
 *
 * 修复双重故障链路：当 IDB backing store 损坏（DOMException: Internal error
 * opening backing store）时，原实现直接 reject，导致 ensureV2Ready 抛错、
 * loadOnboardingState 失败、App.tsx 渲染 Onboarding 卡死。
 *
 * 现策略：第一次打开失败时，删除 database 后重试一次；仍失败才 reject。
 * 删除 database 会丢失原有数据，但能避免应用永久卡死。
 */
export function openV2Database(): Promise<IDBDatabase> {
  return doOpenV2Database().catch((firstErr) => {
    const errName = firstErr instanceof DOMException ? firstErr.name : ''
    const errMsg = firstErr instanceof Error ? firstErr.message : String(firstErr)
    console.warn('[dbV2] openV2Database first attempt failed, will try to delete and recreate:', {
      name: errName,
      message: errMsg,
    })
    // 删除损坏的 database 然后重试一次（重建 schema）
    return deleteDatabaseSafe(DB_NAME).then(() => doOpenV2Database())
  })
}

const V1_DB_NAME = 'living-dashboard'

export function isV1DatabasePresent(): Promise<boolean> {
  if (typeof indexedDB.databases === 'function') {
    return indexedDB.databases().then((dbs) => dbs.some((db) => db.name === V1_DB_NAME))
  }
  return new Promise<boolean>((resolve) => {
    const request = indexedDB.open(V1_DB_NAME)
    let createdEmpty = false
    request.onupgradeneeded = () => {
      createdEmpty = true
    }
    request.onsuccess = () => {
      const db = request.result
      db.close()
      if (createdEmpty) {
        indexedDB.deleteDatabase(V1_DB_NAME)
      }
      resolve(!createdEmpty)
    }
    request.onerror = () => {
      resolve(false)
    }
  })
}

function openV1Database(): Promise<IDBDatabase | null> {
  return new Promise<IDBDatabase | null>((resolve) => {
    const request = indexedDB.open(V1_DB_NAME)
    let needsCreation = false

    request.onupgradeneeded = () => {
      needsCreation = true
    }

    request.onsuccess = () => {
      if (needsCreation) {
        request.result.close()
        indexedDB.deleteDatabase(V1_DB_NAME)
        resolve(null)
        return
      }
      resolve(request.result)
    }

    request.onerror = () => {
      resolve(null)
    }
  })
}

function readAllFromStore(db: IDBDatabase, storeName: string): Promise<unknown[]> {
  return new Promise<unknown[]>((resolve, reject) => {
    if (!db.objectStoreNames.contains(storeName)) {
      resolve([])
      return
    }
    const tx = db.transaction(storeName, 'readonly')
    const store = tx.objectStore(storeName)
    const request = store.getAll()
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

interface V1WidgetContainer {
  panelId: string
  widgets: Array<{
    widgetId: string
    widgetType: string
    state: Record<string, unknown>
    minimized?: boolean
    locked?: boolean
  }>
}

interface V1PositionContainer {
  panelId: string
  positions: Array<{
    widgetId: string
    x: number
    y: number
    w: number
    h: number
    zIndex: number
  }>
}

export async function migrateFromV1ToV2(): Promise<{
  migrated: boolean
  recordCounts: Record<string, number>
}> {
  const v1Db = await openV1Database()
  if (!v1Db) {
    return { migrated: false, recordCounts: {} }
  }

  const recordCounts: Record<string, number> = {}
  const now = Date.now()

  try {
    const v1Panels = (await readAllFromStore(v1Db, 'panels')) as Array<Record<string, unknown>>
    const v1WidgetContainers = (await readAllFromStore(v1Db, 'widgets')) as V1WidgetContainer[]
    const v1PositionContainers = (await readAllFromStore(v1Db, 'positions')) as V1PositionContainer[]
    const v1Tasks = await readAllFromStore(v1Db, 'tasks')
    const v1CalendarEvents = await readAllFromStore(v1Db, 'calendarEvents')
    const v1FocusSessions = await readAllFromStore(v1Db, 'focusSessions')
    const v1Habits = await readAllFromStore(v1Db, 'habits')
    const v1HabitCheckins = await readAllFromStore(v1Db, 'habitCheckins')
    const v1MoodEntries = await readAllFromStore(v1Db, 'moodEntries')
    const v1Settings = await readAllFromStore(v1Db, 'settings')
    const v1Meta = await readAllFromStore(v1Db, 'meta')
    const v1DynamicWidgets = await readAllFromStore(v1Db, 'dynamic-widgets')
    const v1Playlists = await readAllFromStore(v1Db, 'playlists')

    v1Db.close()

    const positionMap = new Map<string, V1PositionContainer>()
    for (const pc of v1PositionContainers) {
      positionMap.set(pc.panelId, pc)
    }

    const widgetMap = new Map<string, V1WidgetContainer>()
    for (const wc of v1WidgetContainers) {
      widgetMap.set(wc.panelId, wc)
    }

    const v2 = await openV2Database()
    const allStoreNames = [...V2_STORE_NAMES]
    const tx = v2.transaction(allStoreNames, 'readwrite')

    let panelsCount = 0
    let widgetRecordsCount = 0
    let widgetStatesCount = 0
    let tasksCount = 0
    let calendarEventsCount = 0
    let focusSessionsCount = 0
    let habitsCount = 0
    let habitCheckinsCount = 0
    let moodEntriesCount = 0
    let settingsCount = 0
    let metaCount = 0
    let dynamicWidgetsCount = 0
    let playlistsCount = 0

    for (const panel of v1Panels) {
      const panelId = panel.id as string
      if (!panelId) continue

      const panelData: Record<string, unknown> = {
        name: panel.name ?? '',
        createdAt: now,
        zIndex: typeof panel.order === 'number' ? panel.order : 0,
        width: 0,
        height: 0,
        offsetX: 0,
        offsetY: 0,
        order: typeof panel.order === 'number' ? panel.order : 0,
        settings: panel.settings ?? undefined,
        canvasTransform: panel.canvasTransform ?? undefined,
        schemaVersion: 1,
      }
      if (panel.canvasTransform && typeof panel.canvasTransform === 'object') {
        const ct = panel.canvasTransform as Record<string, unknown>
        panelData.offsetX = typeof ct.x === 'number' ? ct.x : 0
        panelData.offsetY = typeof ct.y === 'number' ? ct.y : 0
      }

      tx.objectStore('panels').put({
        id: panelId,
        version: 1,
        updatedAt: now,
        data: panelData,
      })
      panelsCount++

      const wc = widgetMap.get(panelId)
      const pc = positionMap.get(panelId)

      if (wc && wc.widgets) {
        const posLookup = new Map<string, V1PositionContainer['positions'][number]>()
        if (pc && pc.positions) {
          for (const pos of pc.positions) {
            posLookup.set(pos.widgetId, pos)
          }
        }

        for (const widget of wc.widgets) {
          const widgetId = widget.widgetId
          if (!widgetId) continue

          const pos = posLookup.get(widgetId)

          tx.objectStore('widgetRecords').put({
            id: widgetId,
            version: 1,
            updatedAt: now,
            data: {
              panelId,
              type: widget.widgetType ?? 'unknown',
              x: pos?.x ?? 0,
              y: pos?.y ?? 0,
              width: pos?.w ?? 300,
              height: pos?.h ?? 200,
              zIndex: pos?.zIndex ?? 0,
              minimized: widget.minimized,
              locked: widget.locked,
              recordStatus: 'active',
              schemaVersion: 1,
            },
          })
          widgetRecordsCount++

          tx.objectStore('widgetStates').put({
            id: widgetId,
            version: 1,
            updatedAt: now,
            data: {
              widgetId,
              panelId,
              envelope: {
                widgetType: widget.widgetType ?? 'unknown',
                widgetVersion: '1',
                stateVersion: 1,
                updatedAt: now,
                state: widget.state ?? {},
              },
              legacyRaw: widget.state ?? {},
              legacyWrappedAt: now,
              schemaVersion: 1,
            },
          })
          widgetStatesCount++
        }
      }
    }

    for (const task of v1Tasks) {
      const t = task as Record<string, unknown>
      const id = t.id as string
      if (!id) continue
      tx.objectStore('tasks').put({
        id,
        version: 1,
        updatedAt: now,
        data: t,
      })
      tasksCount++
    }

    for (const event of v1CalendarEvents) {
      const e = event as Record<string, unknown>
      const id = e.id as string
      if (!id) continue
      tx.objectStore('calendarEvents').put({
        id,
        version: 1,
        updatedAt: now,
        data: e,
      })
      calendarEventsCount++
    }

    for (const session of v1FocusSessions) {
      const s = session as Record<string, unknown>
      const id = s.id as string
      if (!id) continue
      tx.objectStore('focusSessions').put({
        id,
        version: 1,
        updatedAt: now,
        data: s,
      })
      focusSessionsCount++
    }

    for (const habit of v1Habits) {
      const h = habit as Record<string, unknown>
      const id = h.id as string
      if (!id) continue
      tx.objectStore('habits').put({
        id,
        version: 1,
        updatedAt: now,
        data: h,
      })
      habitsCount++
    }

    for (const checkin of v1HabitCheckins) {
      const c = checkin as Record<string, unknown>
      const id = c.id as string
      if (!id) continue
      tx.objectStore('habitCheckins').put({
        id,
        version: 1,
        updatedAt: now,
        data: c,
      })
      habitCheckinsCount++
    }

    for (const entry of v1MoodEntries) {
      const m = entry as Record<string, unknown>
      const id = m.id as string
      if (!id) continue
      tx.objectStore('moodEntries').put({
        id,
        version: 1,
        updatedAt: now,
        data: m,
      })
      moodEntriesCount++
    }

    for (const item of v1Settings) {
      const s = item as Record<string, unknown>
      const key = s.key as string
      if (!key) continue
      tx.objectStore('settings').put({
        id: key,
        version: 1,
        updatedAt: now,
        data: s.value,
      })
      settingsCount++
    }

    for (const item of v1Meta) {
      const m = item as Record<string, unknown>
      const key = m.key as string
      if (!key) continue
      tx.objectStore('meta').put({
        id: key,
        version: 1,
        updatedAt: now,
        data: { value: m.value },
      })
      metaCount++
    }

    for (const dw of v1DynamicWidgets) {
      const d = dw as Record<string, unknown>
      const widgetType = d.widgetType as string
      if (!widgetType) continue
      tx.objectStore('dynamic-widgets').put({
        id: widgetType,
        version: 1,
        updatedAt: now,
        data: d,
      })
      dynamicWidgetsCount++
    }

    for (const pl of v1Playlists) {
      const p = pl as Record<string, unknown>
      const widgetId = p.widgetId as string
      if (!widgetId) continue
      tx.objectStore('playlists').put({
        id: widgetId,
        version: 1,
        updatedAt: now,
        data: p,
      })
      playlistsCount++
    }

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'))
    })

    recordCounts['panels'] = panelsCount
    recordCounts['widgetRecords'] = widgetRecordsCount
    recordCounts['widgetStates'] = widgetStatesCount
    recordCounts['tasks'] = tasksCount
    recordCounts['calendarEvents'] = calendarEventsCount
    recordCounts['focusSessions'] = focusSessionsCount
    recordCounts['habits'] = habitsCount
    recordCounts['habitCheckins'] = habitCheckinsCount
    recordCounts['moodEntries'] = moodEntriesCount
    recordCounts['settings'] = settingsCount
    recordCounts['meta'] = metaCount
    recordCounts['dynamic-widgets'] = dynamicWidgetsCount
    recordCounts['playlists'] = playlistsCount

    await deleteV1Database()

    return { migrated: true, recordCounts }
  } catch (error) {
    if (v1Db) {
      try { v1Db.close() } catch { /* ignore */ }
    }
    console.error('[dbV2] Migration failed:', error)
    throw error
  }
}

export function deleteV1Database(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(V1_DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
    request.onblocked = () => {
      console.warn('[dbV2] V1 database deletion blocked')
      resolve()
    }
  })
}

export function closeV2Database(): void {
  if (v2Db) {
    v2Db.close()
    v2Db = null
  }
}

export function getV2Database(): IDBDatabase | null {
  return v2Db
}

const BUILTIN_PANEL_TEMPLATES: PanelTemplate[] = [
  {
    id: 'builtin-study',
    name: '学习模板',
    icon: 'book-open',
    description: '学习场景预设',
    widgets: [
      { widgetType: 'latexQuiz', position: { x: 20, y: 20, w: 360, h: 480 } },
      { widgetType: 'calculator', position: { x: 400, y: 20, w: 320, h: 460 } },
      { widgetType: 'vocabTrainer', position: { x: 20, y: 520, w: 360, h: 480 } },
      { widgetType: 'focusTimer', position: { x: 400, y: 520, w: 260, h: 300 } },
    ],
    isBuiltin: true,
    createdAt: 0,
    updatedAt: 0,
    schemaVersion: 1,
  },
  {
    id: 'builtin-work',
    name: '工作模板',
    icon: 'briefcase',
    description: '工作场景预设',
    widgets: [
      { widgetType: 'taskList', position: { x: 20, y: 20, w: 340, h: 400 } },
      { widgetType: 'agendaList', position: { x: 380, y: 20, w: 320, h: 380 } },
      { widgetType: 'focusTimer', position: { x: 20, y: 440, w: 260, h: 300 } },
      { widgetType: 'markdownEditor', position: { x: 380, y: 440, w: 450, h: 400 } },
    ],
    isBuiltin: true,
    createdAt: 0,
    updatedAt: 0,
    schemaVersion: 1,
  },
  {
    id: 'builtin-relax',
    name: '放松模板',
    icon: 'leaf',
    description: '放松场景预设',
    widgets: [
      { widgetType: 'musicPlayer', position: { x: 20, y: 20, w: 320, h: 380 } },
      { widgetType: 'breathingWidget', position: { x: 360, y: 20, w: 240, h: 280 } },
      { widgetType: 'quoteCard', position: { x: 20, y: 420, w: 280, h: 160 } },
      { widgetType: 'moodTracker', position: { x: 360, y: 420, w: 300, h: 340 } },
    ],
    isBuiltin: true,
    createdAt: 0,
    updatedAt: 0,
    schemaVersion: 1,
  },
  {
    id: 'builtin-review',
    name: '复盘模板',
    icon: 'bar-chart-3',
    description: '复盘场景预设',
    widgets: [
      { widgetType: 'statsPanel', position: { x: 20, y: 20, w: 340, h: 300 } },
      { widgetType: 'moodTracker', position: { x: 380, y: 20, w: 300, h: 340 } },
      { widgetType: 'habitTracker', position: { x: 20, y: 380, w: 340, h: 400 } },
      { widgetType: 'journal', position: { x: 380, y: 380, w: 380, h: 460 } },
    ],
    isBuiltin: true,
    createdAt: 0,
    updatedAt: 0,
    schemaVersion: 1,
  },
]

export async function initBuiltinPanelTemplates(): Promise<void> {
  const db = getV2Database()
  if (!db) return

  const tx = db.transaction('panelTemplates', 'readwrite')
  const store = tx.objectStore('panelTemplates')
  const getAllRequest = store.getAll()

  const existing: Array<{ id: string; data: PanelTemplate }> = await new Promise((resolve, reject) => {
    getAllRequest.onsuccess = () => resolve(getAllRequest.result)
    getAllRequest.onerror = () => reject(getAllRequest.error)
  })

  const existingBuiltinIds = new Set(
    existing.filter(r => (r.data as PanelTemplate).isBuiltin).map(r => r.id)
  )

  const now = Date.now()
  for (const template of BUILTIN_PANEL_TEMPLATES) {
    if (existingBuiltinIds.has(template.id)) continue
    const record = {
      id: template.id,
      version: 1,
      updatedAt: now,
      data: { ...template, createdAt: now, updatedAt: now },
    }
    store.put(record)
  }

  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'))
  })
}

export async function initV2Storage(): Promise<{
  db: IDBDatabase
  migratedFromV1: boolean
  migrationCounts?: Record<string, number>
}> {
  const db = await openV2Database()

  const requiredV3Stores = ['notes', 'journals', 'quickNotes', 'savingsGoals', 'savingsTransactions', 'aiConversations', 'aiMemories', ]
  for (const store of requiredV3Stores) {
    if (!db.objectStoreNames.contains(store)) {
      throw new Error(`Database migration v3 validation failed: store '${store}' not found. Please refresh the page.`)
    }
  }

  const requiredV4Stores = ['drawingStrokes', 'widgetConnections']
  for (const store of requiredV4Stores) {
    if (!db.objectStoreNames.contains(store)) {
      throw new Error(`Database migration v4 validation failed: store '${store}' not found. Please refresh the page.`)
    }
  }

  const requiredV5Stores = ['quizSessions']
  for (const store of requiredV5Stores) {
    if (!db.objectStoreNames.contains(store)) {
      throw new Error(`Database migration v5 validation failed: store '${store}' not found. Please refresh the page.`)
    }
  }

  const requiredV6Stores = ['vocabDecks', 'vocabProgress', 'sudokuGames', 'mistakes', 'panelTemplates']
  for (const store of requiredV6Stores) {
    if (!db.objectStoreNames.contains(store)) {
      throw new Error(`Database migration v6 validation failed: store '${store}' not found. Please refresh the page.`)
    }
  }

  const requiredV8Stores = ['htmlWidgets', 'kvStorage']
  for (const store of requiredV8Stores) {
    if (!db.objectStoreNames.contains(store)) {
      throw new Error(`Database migration v8 validation failed: store '${store}' not found. Please refresh the page.`)
    }
  }

  const requiredV9Stores = ['aiAuditLog']
  for (const store of requiredV9Stores) {
    if (!db.objectStoreNames.contains(store)) {
      throw new Error(`Database migration v9 validation failed: store '${store}' not found. Please refresh the page.`)
    }
  }

  const requiredV10Stores = ['webTabs', 'bookmarks']
  for (const store of requiredV10Stores) {
    if (!db.objectStoreNames.contains(store)) {
      throw new Error(`Database migration v10 validation failed: store '${store}' not found. Please refresh the page.`)
    }
  }

  const requiredV11Stores = ['favorites']
  for (const store of requiredV11Stores) {
    if (!db.objectStoreNames.contains(store)) {
      throw new Error(`Database migration v11 validation failed: store '${store}' not found. Please refresh the page.`)
    }
  }

  // Initialize built-in panel templates (idempotent)
  try {
    await initBuiltinPanelTemplates()
  } catch (e) {
    console.error('[dbV2] Failed to initialize built-in panel templates:', e)
  }

  const v1Present = await isV1DatabasePresent()
  if (v1Present) {
    const result = await migrateFromV1ToV2()
    return {
      db,
      migratedFromV1: result.migrated,
      migrationCounts: result.recordCounts,
    }
  }

  return { db, migratedFromV1: false }
}
