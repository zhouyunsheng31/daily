import type {
  WidgetStateData,
  ExportableWidgetDefinition,
  ImportContext,
  ExportContext,
  ValidationResult,
} from '../types/v2'
import { runIdbTransaction } from './idbTx'
import { widgetDefinitionMap } from '../registry/widgetDefinitions'
import { v4 as uuidv4 } from 'uuid'

const PANEL_STORE = 'panels'
const WIDGET_RECORDS_STORE = 'widgetRecords'
const WIDGET_STATES_STORE = 'widgetStates'
const TASKS_STORE = 'tasks'
const CALENDAR_EVENTS_STORE = 'calendarEvents'
const FOCUS_SESSIONS_STORE = 'focusSessions'
const HABITS_STORE = 'habits'
const HABIT_CHECKINS_STORE = 'habitCheckins'
const MOOD_ENTRIES_STORE = 'moodEntries'
const QUIZ_SESSIONS_STORE = 'quizSessions'
const VOCAB_DECKS_STORE = 'vocabDecks'
const VOCAB_PROGRESS_STORE = 'vocabProgress'
const SUDOKU_GAMES_STORE = 'sudokuGames'
const MISTAKES_STORE = 'mistakes'
const PANEL_TEMPLATES_STORE = 'panelTemplates'
const SETTINGS_STORE = 'settings'
const NOTES_STORE = 'notes'
const JOURNALS_STORE = 'journals'
const QUICK_NOTES_STORE = 'quickNotes'
const SAVINGS_GOALS_STORE = 'savingsGoals'
const SAVINGS_TRANSACTIONS_STORE = 'savingsTransactions'
const AI_CONVERSATIONS_STORE = 'aiConversations'
const AI_MEMORIES_STORE = 'aiMemories'
const AI_AUDIT_LOG_STORE = 'aiAuditLog'

type ExportableRecord = {
  id: string
  version: number
  data: Record<string, unknown>
}

export interface ExportBundle {
  version: 3
  schema: 'living-dashboard-v2'
  exportedAt: string
  panels: ExportableRecord[]
  widgetRecords: ExportableRecord[]
  widgetStates: ExportableRecord[]
  tasks: ExportableRecord[]
  calendarEvents: ExportableRecord[]
  focusSessions: ExportableRecord[]
  habits: ExportableRecord[]
  habitCheckins: ExportableRecord[]
  moodEntries: ExportableRecord[]
  quizSessions: ExportableRecord[]
  vocabDecks?: ExportableRecord[]
  vocabProgress?: ExportableRecord[]
  sudokuGames?: ExportableRecord[]
  mistakes?: ExportableRecord[]
  panelTemplates?: ExportableRecord[]
  notes?: ExportableRecord[]
  journals?: ExportableRecord[]
  quickNotes?: ExportableRecord[]
  savingsGoals?: ExportableRecord[]
  savingsTransactions?: ExportableRecord[]
  aiConversations?: ExportableRecord[]
  aiMemories?: ExportableRecord[]
  aiAuditLog?: ExportableRecord[]
  settings?: Record<string, unknown>
  meta?: Record<string, unknown>
}

export interface ImportStagingResult {
  valid: boolean
  bundle?: ExportBundle
  idMaps: {
    panelIdMap: Record<string, string>
    widgetIdMap: Record<string, string>
    entityIdMap: Record<string, string>
  }
  warnings: string[]
}

export interface ImportRemapResult {
  records: Map<string, Array<{ id: string; data: unknown }>>
  warnings: string[]
  stats: Record<string, number>
}

export interface ImportReport {
  imported: Record<string, number>
  warnings: string[]
  errors: string[]
}

const INTERNAL_WIDGET_STATE_FIELDS = new Set([
  'legacyRaw',
  'legacyWrappedAt',
  'legacyRawDroppedAt',
])

function stripInternalWidgetStateFields(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    if (!INTERNAL_WIDGET_STATE_FIELDS.has(key)) {
      result[key] = value
    }
  }
  return result
}

function isExportableWidgetDefinition(
  def: unknown,
): def is ExportableWidgetDefinition {
  return (
    typeof def === 'object' &&
    def !== null &&
    typeof (def as ExportableWidgetDefinition).exportState === 'function' &&
    typeof (def as ExportableWidgetDefinition).importState === 'function'
  )
}

export async function exportV2Data(): Promise<Blob> {
  const storeNames = [
    PANEL_STORE,
    WIDGET_RECORDS_STORE,
    WIDGET_STATES_STORE,
    TASKS_STORE,
    CALENDAR_EVENTS_STORE,
    FOCUS_SESSIONS_STORE,
    HABITS_STORE,
    HABIT_CHECKINS_STORE,
    MOOD_ENTRIES_STORE,
    QUIZ_SESSIONS_STORE,
    VOCAB_DECKS_STORE,
    VOCAB_PROGRESS_STORE,
    SUDOKU_GAMES_STORE,
    MISTAKES_STORE,
    PANEL_TEMPLATES_STORE,
    NOTES_STORE,
    JOURNALS_STORE,
    QUICK_NOTES_STORE,
    SAVINGS_GOALS_STORE,
    SAVINGS_TRANSACTIONS_STORE,
    AI_CONVERSATIONS_STORE,
    AI_MEMORIES_STORE,
    AI_AUDIT_LOG_STORE,
  ]

  const result = await runIdbTransaction(storeNames, 'readonly', async (ctx) => {
    const panels: ExportableRecord[] = []
    const widgetRecords: ExportableRecord[] = []
    const widgetStates: ExportableRecord[] = []
    const tasks: ExportableRecord[] = []
    const calendarEvents: ExportableRecord[] = []
    const focusSessions: ExportableRecord[] = []
    const habits: ExportableRecord[] = []
    const habitCheckins: ExportableRecord[] = []
    const moodEntries: ExportableRecord[] = []
    const quizSessions: ExportableRecord[] = []
    const vocabDecks: ExportableRecord[] = []
    const vocabProgress: ExportableRecord[] = []
    const sudokuGames: ExportableRecord[] = []
    const mistakes: ExportableRecord[] = []
    const panelTemplates: ExportableRecord[] = []
    const notes: ExportableRecord[] = []
    const journals: ExportableRecord[] = []
    const quickNotes: ExportableRecord[] = []
    const savingsGoals: ExportableRecord[] = []
    const savingsTransactions: ExportableRecord[] = []
    const aiConversations: ExportableRecord[] = []
    const aiMemories: ExportableRecord[] = []
    const aiAuditLog: ExportableRecord[] = []

    await ctx.iterateStore<unknown>(PANEL_STORE, (record) => {
      panels.push({
        id: record.id,
        version: record.version,
        data: record.data as Record<string, unknown>,
      })
    })

    await ctx.iterateStore<unknown>(WIDGET_RECORDS_STORE, (record) => {
      widgetRecords.push({
        id: record.id,
        version: record.version,
        data: record.data as Record<string, unknown>,
      })
    })

    await ctx.iterateStore<WidgetStateData>(WIDGET_STATES_STORE, (record) => {
      const stateData = record.data as unknown as Record<string, unknown>
      const widgetType =
        stateData.envelope &&
        typeof stateData.envelope === 'object' &&
        stateData.envelope !== null
          ? (stateData.envelope as Record<string, unknown>).widgetType
          : null

      const def = widgetDefinitionMap.get(widgetType as string)
      let exportedData: Record<string, unknown>

      if (
        isExportableWidgetDefinition(def) &&
        stateData.envelope &&
        typeof stateData.envelope === 'object'
      ) {
        const envelope = stateData.envelope as Record<string, unknown>
        const envelopeState = envelope.state
        const exportContext: ExportContext = {
          widgetId: record.id,
          panelId: (stateData.panelId as string) ?? '',
          includeEntities: true,
        }
        const exportedState = def.exportState(envelopeState, exportContext)
        const cleanedData = stripInternalWidgetStateFields(stateData)
        cleanedData.envelope = {
          ...envelope,
          state: exportedState,
        }
        exportedData = cleanedData
      } else {
        exportedData = stripInternalWidgetStateFields(stateData)
      }

      widgetStates.push({
        id: record.id,
        version: record.version,
        data: exportedData,
      })
    })

    await ctx.iterateStore<unknown>(TASKS_STORE, (record) => {
      tasks.push({
        id: record.id,
        version: record.version,
        data: record.data as Record<string, unknown>,
      })
    })

    await ctx.iterateStore<unknown>(CALENDAR_EVENTS_STORE, (record) => {
      calendarEvents.push({
        id: record.id,
        version: record.version,
        data: record.data as Record<string, unknown>,
      })
    })

    await ctx.iterateStore<unknown>(FOCUS_SESSIONS_STORE, (record) => {
      focusSessions.push({
        id: record.id,
        version: record.version,
        data: record.data as Record<string, unknown>,
      })
    })

    await ctx.iterateStore<unknown>(HABITS_STORE, (record) => {
      habits.push({
        id: record.id,
        version: record.version,
        data: record.data as Record<string, unknown>,
      })
    })

    await ctx.iterateStore<unknown>(HABIT_CHECKINS_STORE, (record) => {
      habitCheckins.push({
        id: record.id,
        version: record.version,
        data: record.data as Record<string, unknown>,
      })
    })

    await ctx.iterateStore<unknown>(MOOD_ENTRIES_STORE, (record) => {
      moodEntries.push({
        id: record.id,
        version: record.version,
        data: record.data as Record<string, unknown>,
      })
    })

    await ctx.iterateStore<unknown>(QUIZ_SESSIONS_STORE, (record) => {
      quizSessions.push({
        id: record.id,
        version: record.version,
        data: record.data as Record<string, unknown>,
      })
    })

    await ctx.iterateStore<unknown>(VOCAB_DECKS_STORE, (record) => {
      vocabDecks.push({
        id: record.id,
        version: record.version,
        data: record.data as Record<string, unknown>,
      })
    })

    await ctx.iterateStore<unknown>(VOCAB_PROGRESS_STORE, (record) => {
      vocabProgress.push({
        id: record.id,
        version: record.version,
        data: record.data as Record<string, unknown>,
      })
    })

    await ctx.iterateStore<unknown>(SUDOKU_GAMES_STORE, (record) => {
      sudokuGames.push({
        id: record.id,
        version: record.version,
        data: record.data as Record<string, unknown>,
      })
    })

    await ctx.iterateStore<unknown>(MISTAKES_STORE, (record) => {
      mistakes.push({
        id: record.id,
        version: record.version,
        data: record.data as Record<string, unknown>,
      })
    })

    await ctx.iterateStore<unknown>(PANEL_TEMPLATES_STORE, (record) => {
      panelTemplates.push({
        id: record.id,
        version: record.version,
        data: record.data as Record<string, unknown>,
      })
    })

    await ctx.iterateStore<unknown>(NOTES_STORE, (record) => {
      notes.push({
        id: record.id,
        version: record.version,
        data: record.data as Record<string, unknown>,
      })
    })

    await ctx.iterateStore<unknown>(JOURNALS_STORE, (record) => {
      journals.push({
        id: record.id,
        version: record.version,
        data: record.data as Record<string, unknown>,
      })
    })

    await ctx.iterateStore<unknown>(QUICK_NOTES_STORE, (record) => {
      quickNotes.push({
        id: record.id,
        version: record.version,
        data: record.data as Record<string, unknown>,
      })
    })

    await ctx.iterateStore<unknown>(SAVINGS_GOALS_STORE, (record) => {
      savingsGoals.push({
        id: record.id,
        version: record.version,
        data: record.data as Record<string, unknown>,
      })
    })

    await ctx.iterateStore<unknown>(SAVINGS_TRANSACTIONS_STORE, (record) => {
      savingsTransactions.push({
        id: record.id,
        version: record.version,
        data: record.data as Record<string, unknown>,
      })
    })

    await ctx.iterateStore<unknown>(AI_CONVERSATIONS_STORE, (record) => {
      aiConversations.push({
        id: record.id,
        version: record.version,
        data: record.data as Record<string, unknown>,
      })
    })

    await ctx.iterateStore<unknown>(AI_MEMORIES_STORE, (record) => {
      aiMemories.push({
        id: record.id,
        version: record.version,
        data: record.data as Record<string, unknown>,
      })
    })

    await ctx.iterateStore<unknown>(AI_AUDIT_LOG_STORE, (record) => {
      aiAuditLog.push({
        id: record.id,
        version: record.version,
        data: record.data as Record<string, unknown>,
      })
    })

    return {
      panels,
      widgetRecords,
      widgetStates,
      tasks,
      calendarEvents,
      focusSessions,
      habits,
      habitCheckins,
      moodEntries,
      quizSessions,
      vocabDecks,
      vocabProgress,
      sudokuGames,
      mistakes,
      panelTemplates,
      notes,
      journals,
      quickNotes,
      savingsGoals,
      savingsTransactions,
      aiConversations,
      aiMemories,
      aiAuditLog,
    }
  })

  let settings: Record<string, unknown> | undefined
  try {
    settings = await runIdbTransaction([SETTINGS_STORE], 'readonly', async (ctx) => {
      const record = await ctx.get<unknown>(SETTINGS_STORE, 'appSettings')
      return record?.data as Record<string, unknown> | undefined
    })
  } catch {
    settings = undefined
  }

  const bundle: ExportBundle = {
    version: 3,
    schema: 'living-dashboard-v2',
    exportedAt: new Date().toISOString(),
    panels: result.panels,
    widgetRecords: result.widgetRecords,
    widgetStates: result.widgetStates,
    tasks: result.tasks,
    calendarEvents: result.calendarEvents,
    focusSessions: result.focusSessions,
    habits: result.habits,
    habitCheckins: result.habitCheckins,
    moodEntries: result.moodEntries,
    quizSessions: result.quizSessions,
    vocabDecks: result.vocabDecks,
    vocabProgress: result.vocabProgress,
    sudokuGames: result.sudokuGames,
    mistakes: result.mistakes,
    panelTemplates: result.panelTemplates,
    notes: result.notes,
    journals: result.journals,
    quickNotes: result.quickNotes,
    savingsGoals: result.savingsGoals,
    savingsTransactions: result.savingsTransactions,
    aiConversations: result.aiConversations,
    aiMemories: result.aiMemories,
    aiAuditLog: result.aiAuditLog,
    settings,
  }

  const json = JSON.stringify(bundle)
  return new Blob([json], { type: 'application/json' })
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function validateBundleFormat(raw: unknown): {
  valid: boolean
  bundle?: ExportBundle
  warnings: string[]
} {
  const warnings: string[] = []

  if (!isObject(raw)) {
    return { valid: false, warnings: ['bundle is not an object'] }
  }

  if (raw.version !== 2 && raw.version !== 3) {
    return { valid: false, warnings: [`invalid version: ${raw.version}, expected 2 or 3`] }
  }

  if (raw.schema !== 'living-dashboard-v2') {
    return { valid: false, warnings: [`invalid schema: ${raw.schema}, expected living-dashboard-v2`] }
  }

  if (typeof raw.exportedAt !== 'string') {
    warnings.push('missing or invalid exportedAt')
  }

  const requiredArrays: Array<keyof ExportBundle> = [
    'panels',
    'widgetRecords',
    'widgetStates',
    'tasks',
    'calendarEvents',
    'focusSessions',
    'habits',
    'habitCheckins',
    'moodEntries',
    'quizSessions',
  ]

  for (const key of requiredArrays) {
    if (!Array.isArray(raw[key])) {
      return { valid: false, warnings: [`missing or invalid array: ${key}`] }
    }
  }

  const validateRecords = (
    records: unknown[],
    label: string,
  ): ExportableRecord[] => {
    const valid: ExportableRecord[] = []
    for (let i = 0; i < records.length; i++) {
      const r = records[i]
      if (!isObject(r)) {
        warnings.push(`${label}[${i}]: not an object, skipping`)
        continue
      }
      if (typeof r.id !== 'string' || !r.id) {
        warnings.push(`${label}[${i}]: missing or invalid id, skipping`)
        continue
      }
      if (typeof r.version !== 'number' || !Number.isFinite(r.version)) {
        warnings.push(`${label}[${i}]: missing or invalid version, skipping`)
        continue
      }
      if (!isObject(r.data)) {
        warnings.push(`${label}[${i}]: missing or invalid data, skipping`)
        continue
      }
      valid.push({
        id: r.id as string,
        version: r.version as number,
        data: r.data as Record<string, unknown>,
      })
    }
    return valid
  }

  // v2 compatibility: fill missing fields with empty arrays
  if (raw.version === 2) {
    raw.vocabDecks = raw.vocabDecks ?? []
    raw.vocabProgress = raw.vocabProgress ?? []
    raw.sudokuGames = raw.sudokuGames ?? []
    raw.mistakes = raw.mistakes ?? []
    raw.panelTemplates = raw.panelTemplates ?? []
  }

  const optionalArrays: Array<keyof ExportBundle> = [
    'vocabDecks',
    'vocabProgress',
    'sudokuGames',
    'mistakes',
    'panelTemplates',
    'notes',
    'journals',
    'quickNotes',
    'savingsGoals',
    'savingsTransactions',
    'aiConversations',
    'aiMemories',
    'aiAuditLog',
  ]

  for (const key of optionalArrays) {
    if (raw[key] !== undefined && !Array.isArray(raw[key])) {
      return { valid: false, warnings: [`invalid array: ${key}`] }
    }
  }

  const bundle: ExportBundle = {
    version: raw.version as 3,
    schema: 'living-dashboard-v2',
    exportedAt: (raw.exportedAt as string) ?? new Date().toISOString(),
    panels: validateRecords(raw.panels as unknown[], 'panels'),
    widgetRecords: validateRecords(raw.widgetRecords as unknown[], 'widgetRecords'),
    widgetStates: validateRecords(raw.widgetStates as unknown[], 'widgetStates'),
    tasks: validateRecords(raw.tasks as unknown[], 'tasks'),
    calendarEvents: validateRecords(raw.calendarEvents as unknown[], 'calendarEvents'),
    focusSessions: validateRecords(raw.focusSessions as unknown[], 'focusSessions'),
    habits: validateRecords(raw.habits as unknown[], 'habits'),
    habitCheckins: validateRecords(raw.habitCheckins as unknown[], 'habitCheckins'),
    moodEntries: validateRecords(raw.moodEntries as unknown[], 'moodEntries'),
    quizSessions: validateRecords(raw.quizSessions as unknown[], 'quizSessions'),
    vocabDecks: Array.isArray(raw.vocabDecks) ? validateRecords(raw.vocabDecks as unknown[], 'vocabDecks') : undefined,
    vocabProgress: Array.isArray(raw.vocabProgress) ? validateRecords(raw.vocabProgress as unknown[], 'vocabProgress') : undefined,
    sudokuGames: Array.isArray(raw.sudokuGames) ? validateRecords(raw.sudokuGames as unknown[], 'sudokuGames') : undefined,
    mistakes: Array.isArray(raw.mistakes) ? validateRecords(raw.mistakes as unknown[], 'mistakes') : undefined,
    panelTemplates: Array.isArray(raw.panelTemplates) ? validateRecords(raw.panelTemplates as unknown[], 'panelTemplates') : undefined,
    notes: Array.isArray(raw.notes) ? validateRecords(raw.notes as unknown[], 'notes') : undefined,
    journals: Array.isArray(raw.journals) ? validateRecords(raw.journals as unknown[], 'journals') : undefined,
    quickNotes: Array.isArray(raw.quickNotes) ? validateRecords(raw.quickNotes as unknown[], 'quickNotes') : undefined,
    savingsGoals: Array.isArray(raw.savingsGoals) ? validateRecords(raw.savingsGoals as unknown[], 'savingsGoals') : undefined,
    savingsTransactions: Array.isArray(raw.savingsTransactions) ? validateRecords(raw.savingsTransactions as unknown[], 'savingsTransactions') : undefined,
    aiConversations: Array.isArray(raw.aiConversations) ? validateRecords(raw.aiConversations as unknown[], 'aiConversations') : undefined,
    aiMemories: Array.isArray(raw.aiMemories) ? validateRecords(raw.aiMemories as unknown[], 'aiMemories') : undefined,
    aiAuditLog: Array.isArray(raw.aiAuditLog) ? validateRecords(raw.aiAuditLog as unknown[], 'aiAuditLog') : undefined,
    settings: isObject(raw.settings) ? (raw.settings as Record<string, unknown>) : undefined,
    meta: isObject(raw.meta) ? (raw.meta as Record<string, unknown>) : undefined,
  }

  return { valid: true, bundle, warnings }
}

export function importV2Stage(raw: unknown): ImportStagingResult {
  const validation = validateBundleFormat(raw)
  if (!validation.valid) {
    return {
      valid: false,
      idMaps: { panelIdMap: {}, widgetIdMap: {}, entityIdMap: {} },
      warnings: validation.warnings,
    }
  }

  const bundle = validation.bundle!

  const panelIdMap: Record<string, string> = {}
  const widgetIdMap: Record<string, string> = {}
  const entityIdMap: Record<string, string> = {}

  for (const panel of bundle.panels) {
    panelIdMap[panel.id] = uuidv4()
  }

  for (const wr of bundle.widgetRecords) {
    widgetIdMap[wr.id] = uuidv4()
  }

  for (const ws of bundle.widgetStates) {
    if (!widgetIdMap[ws.id]) {
      widgetIdMap[ws.id] = uuidv4()
    }
  }

  for (const task of bundle.tasks) {
    entityIdMap[task.id] = uuidv4()
  }

  for (const event of bundle.calendarEvents) {
    entityIdMap[event.id] = uuidv4()
  }

  for (const session of bundle.focusSessions) {
    entityIdMap[session.id] = uuidv4()
  }

  for (const habit of bundle.habits) {
    entityIdMap[habit.id] = uuidv4()
  }

  // habitCheckins and moodEntries use semantic IDs (${habitId}_${date} / mood_${panelId}_${date}),
  // so they don't need UUID pre-allocation in entityIdMap

  for (const qs of bundle.quizSessions) {
    entityIdMap[qs.id] = uuidv4()
  }

  for (const vd of (bundle.vocabDecks ?? [])) {
    entityIdMap[vd.id] = uuidv4()
  }

  for (const vp of (bundle.vocabProgress ?? [])) {
    entityIdMap[vp.id] = uuidv4()
  }

  for (const sg of (bundle.sudokuGames ?? [])) {
    entityIdMap[sg.id] = uuidv4()
  }

  for (const m of (bundle.mistakes ?? [])) {
    entityIdMap[m.id] = uuidv4()
  }

  for (const pt of (bundle.panelTemplates ?? [])) {
    entityIdMap[pt.id] = uuidv4()
  }

  for (const n of (bundle.notes ?? [])) {
    entityIdMap[n.id] = uuidv4()
  }

  for (const j of (bundle.journals ?? [])) {
    entityIdMap[j.id] = uuidv4()
  }

  for (const qn of (bundle.quickNotes ?? [])) {
    entityIdMap[qn.id] = uuidv4()
  }

  for (const sg of (bundle.savingsGoals ?? [])) {
    entityIdMap[sg.id] = uuidv4()
  }

  for (const st of (bundle.savingsTransactions ?? [])) {
    entityIdMap[st.id] = uuidv4()
  }

  for (const ac of (bundle.aiConversations ?? [])) {
    entityIdMap[ac.id] = uuidv4()
  }

  for (const am of (bundle.aiMemories ?? [])) {
    entityIdMap[am.id] = uuidv4()
  }

  for (const al of (bundle.aiAuditLog ?? [])) {
    entityIdMap[al.id] = uuidv4()
  }

  return {
    valid: true,
    bundle,
    idMaps: { panelIdMap, widgetIdMap, entityIdMap },
    warnings: validation.warnings,
  }
}

function remapId(
  id: string | undefined | null,
  map: Record<string, string>,
): string | undefined {
  if (id == null) return undefined
  return map[id] ?? id
}

export function importV2Remap(staged: ImportStagingResult): ImportRemapResult {
  if (!staged.valid || !staged.bundle) {
    return {
      records: new Map(),
      warnings: ['staging result is invalid, cannot remap'],
      stats: {},
    }
  }

  const bundle = staged.bundle
  const { panelIdMap, widgetIdMap, entityIdMap } = staged.idMaps
  const warnings: string[] = [...staged.warnings]
  const stats: Record<string, number> = {}
  const records = new Map<string, Array<{ id: string; data: unknown }>>()

  const panelRecords: Array<{ id: string; data: unknown }> = []
  for (const panel of bundle.panels) {
    const newId = panelIdMap[panel.id]
    const newData = { ...panel.data }
    panelRecords.push({ id: newId, data: newData })
  }
  records.set(PANEL_STORE, panelRecords)
  stats[PANEL_STORE] = panelRecords.length

  const widgetRecordRecords: Array<{ id: string; data: unknown }> = []
  for (const wr of bundle.widgetRecords) {
    const newId = widgetIdMap[wr.id]
    const newData = { ...wr.data }
    newData.panelId = remapId(newData.panelId as string, panelIdMap)
    widgetRecordRecords.push({ id: newId, data: newData })
  }
  records.set(WIDGET_RECORDS_STORE, widgetRecordRecords)
  stats[WIDGET_RECORDS_STORE] = widgetRecordRecords.length

  const widgetStateRecords: Array<{ id: string; data: unknown }> = []
  for (const ws of bundle.widgetStates) {
    const oldWidgetId = ws.id
    const newWidgetId = widgetIdMap[oldWidgetId] ?? uuidv4()
    const oldPanelId = ws.data.panelId as string
    const newPanelId = remapId(oldPanelId, panelIdMap) ?? oldPanelId

    const newData: Record<string, unknown> = { ...ws.data }
    newData.widgetId = newWidgetId
    newData.panelId = newPanelId

    const envelope = newData.envelope
    if (isObject(envelope)) {
      const widgetType = envelope.widgetType as string
      const def = widgetDefinitionMap.get(widgetType)

      if (isExportableWidgetDefinition(def)) {
        const importContext: ImportContext = {
          oldWidgetId,
          newWidgetId,
          oldPanelId,
          newPanelId,
          widgetIdMap,
          panelIdMap,
          entityIdMap,
          addWarning(message: string) {
            warnings.push(`widgetState[${oldWidgetId}].importState: ${message}`)
          },
        }

        const importResult: ValidationResult<unknown> = def.importState(
          envelope.state,
          importContext,
        )

        if (importResult.ok) {
          const remappedEnvelope = { ...envelope }
          remappedEnvelope.state = importResult.state
          newData.envelope = remappedEnvelope
          if (importResult.warnings) {
            for (const w of importResult.warnings) {
              warnings.push(`widgetState[${oldWidgetId}].importState warning: ${w}`)
            }
          }
        } else {
          warnings.push(
            `widgetState[${oldWidgetId}].importState failed: ${importResult.errors.join(', ')}, using fallback state`,
          )
          const remappedEnvelope = { ...envelope }
          remappedEnvelope.state = importResult.fallbackState
          newData.envelope = remappedEnvelope
        }
      } else {
        newData.importedAsOpaqueUnknown = true
        newData.opaqueImportContext = {
          oldWidgetId,
          newWidgetId,
          oldPanelId,
          newPanelId,
          widgetIdMap,
          panelIdMap,
          entityIdMap,
        }
        warnings.push(
          `widgetState[${oldWidgetId}]: unknown widget type "${widgetType}", imported as opaque`,
        )
      }
    }

    widgetStateRecords.push({ id: newWidgetId, data: newData })
  }
  records.set(WIDGET_STATES_STORE, widgetStateRecords)
  stats[WIDGET_STATES_STORE] = widgetStateRecords.length

  const taskRecords: Array<{ id: string; data: unknown }> = []
  for (const task of bundle.tasks) {
    const newId = entityIdMap[task.id] ?? uuidv4()
    const newData = { ...task.data }
    newData.panelId = remapId(newData.panelId as string, panelIdMap)
    taskRecords.push({ id: newId, data: newData })
  }
  records.set(TASKS_STORE, taskRecords)
  stats[TASKS_STORE] = taskRecords.length

  const calendarEventRecords: Array<{ id: string; data: unknown }> = []
  for (const event of bundle.calendarEvents) {
    const newId = entityIdMap[event.id] ?? uuidv4()
    const newData = { ...event.data }
    newData.panelId = remapId(newData.panelId as string, panelIdMap)
    calendarEventRecords.push({ id: newId, data: newData })
  }
  records.set(CALENDAR_EVENTS_STORE, calendarEventRecords)
  stats[CALENDAR_EVENTS_STORE] = calendarEventRecords.length

  const focusSessionRecords: Array<{ id: string; data: unknown }> = []
  for (const session of bundle.focusSessions) {
    const newId = entityIdMap[session.id] ?? uuidv4()
    const newData = { ...session.data }
    newData.panelId = remapId(newData.panelId as string, panelIdMap)
    if (newData.focusTimerWidgetId) {
      newData.focusTimerWidgetId = remapId(
        newData.focusTimerWidgetId as string,
        widgetIdMap,
      )
    }
    if (newData.taskId) {
      newData.taskId = remapId(newData.taskId as string, entityIdMap)
    }
    focusSessionRecords.push({ id: newId, data: newData })
  }
  records.set(FOCUS_SESSIONS_STORE, focusSessionRecords)
  stats[FOCUS_SESSIONS_STORE] = focusSessionRecords.length

  const habitRecords: Array<{ id: string; data: unknown }> = []
  for (const habit of bundle.habits) {
    const newId = entityIdMap[habit.id] ?? uuidv4()
    const newData = { ...habit.data }
    if (newData.panelId) {
      newData.panelId = remapId(newData.panelId as string, panelIdMap)
    }
    habitRecords.push({ id: newId, data: newData })
  }
  records.set(HABITS_STORE, habitRecords)
  stats[HABITS_STORE] = habitRecords.length

  const habitCheckinRecords: Array<{ id: string; data: unknown }> = []
  for (const checkin of bundle.habitCheckins) {
    const newData = { ...checkin.data }
    newData.habitId = remapId(newData.habitId as string, entityIdMap)
    if (newData.panelId) {
      newData.panelId = remapId(newData.panelId as string, panelIdMap)
    }
    // habitCheckin ID is semantic: ${habitId}_${date}, must recalculate after remapping
    const newId = `${newData.habitId}_${newData.date}`
    newData.id = newId
    habitCheckinRecords.push({ id: newId, data: newData })
  }
  records.set(HABIT_CHECKINS_STORE, habitCheckinRecords)
  stats[HABIT_CHECKINS_STORE] = habitCheckinRecords.length

  const moodEntryRecords: Array<{ id: string; data: unknown }> = []
  for (const entry of bundle.moodEntries) {
    const newData = { ...entry.data }
    if (newData.panelId) {
      newData.panelId = remapId(newData.panelId as string, panelIdMap)
    }
    // moodEntry ID is semantic: mood_${panelId}_${date}, must recalculate after remapping
    const newId = `mood_${newData.panelId}_${newData.date}`
    newData.id = newId
    moodEntryRecords.push({ id: newId, data: newData })
  }
  records.set(MOOD_ENTRIES_STORE, moodEntryRecords)
  stats[MOOD_ENTRIES_STORE] = moodEntryRecords.length

  const quizSessionRecords: Array<{ id: string; data: unknown }> = []
  for (const qs of bundle.quizSessions) {
    const newId = entityIdMap[qs.id] ?? uuidv4()
    const newData = { ...qs.data }
    if (newData.panelId) {
      newData.panelId = remapId(newData.panelId as string, panelIdMap)
    }
    if (newData.latexQuizWidgetId) {
      newData.latexQuizWidgetId = remapId(
        newData.latexQuizWidgetId as string,
        widgetIdMap,
      )
    }
    quizSessionRecords.push({ id: newId, data: newData })
  }
  records.set(QUIZ_SESSIONS_STORE, quizSessionRecords)
  stats[QUIZ_SESSIONS_STORE] = quizSessionRecords.length

  // vocabDecks — no ID remapping needed (global resource), just assign new IDs
  const vocabDeckRecords: Array<{ id: string; data: unknown }> = []
  for (const vd of (bundle.vocabDecks ?? [])) {
    const newId = entityIdMap[vd.id] ?? uuidv4()
    const newData = { ...vd.data }
    vocabDeckRecords.push({ id: newId, data: newData })
  }
  records.set(VOCAB_DECKS_STORE, vocabDeckRecords)
  stats[VOCAB_DECKS_STORE] = vocabDeckRecords.length

  // vocabProgress — remap deckId using entityIdMap
  const vocabProgressRecords: Array<{ id: string; data: unknown }> = []
  for (const vp of (bundle.vocabProgress ?? [])) {
    const newId = entityIdMap[vp.id] ?? uuidv4()
    const newData = { ...vp.data }
    newData.deckId = remapId(newData.deckId as string, entityIdMap)
    vocabProgressRecords.push({ id: newId, data: newData })
  }
  records.set(VOCAB_PROGRESS_STORE, vocabProgressRecords)
  stats[VOCAB_PROGRESS_STORE] = vocabProgressRecords.length

  // sudokuGames — remap panelId and sudokuWidgetId
  const sudokuGameRecords: Array<{ id: string; data: unknown }> = []
  for (const sg of (bundle.sudokuGames ?? [])) {
    const newId = entityIdMap[sg.id] ?? uuidv4()
    const newData = { ...sg.data }
    newData.panelId = remapId(newData.panelId as string, panelIdMap)
    newData.sudokuWidgetId = remapId(newData.sudokuWidgetId as string, widgetIdMap)
    sudokuGameRecords.push({ id: newId, data: newData })
  }
  records.set(SUDOKU_GAMES_STORE, sudokuGameRecords)
  stats[SUDOKU_GAMES_STORE] = sudokuGameRecords.length

  // mistakes — remap panelId and sourceId
  const mistakeRecords: Array<{ id: string; data: unknown }> = []
  for (const m of (bundle.mistakes ?? [])) {
    const newId = entityIdMap[m.id] ?? uuidv4()
    const newData = { ...m.data }
    newData.panelId = remapId(newData.panelId as string, panelIdMap)
    newData.sourceId = remapId(newData.sourceId as string, widgetIdMap)
    mistakeRecords.push({ id: newId, data: newData })
  }
  records.set(MISTAKES_STORE, mistakeRecords)
  stats[MISTAKES_STORE] = mistakeRecords.length

  // panelTemplates — no ID remapping needed (global resource)
  const panelTemplateRecords: Array<{ id: string; data: unknown }> = []
  for (const pt of (bundle.panelTemplates ?? [])) {
    const newId = entityIdMap[pt.id] ?? uuidv4()
    const newData = { ...pt.data }
    panelTemplateRecords.push({ id: newId, data: newData })
  }
  records.set(PANEL_TEMPLATES_STORE, panelTemplateRecords)
  stats[PANEL_TEMPLATES_STORE] = panelTemplateRecords.length

  const noteRecords: Array<{ id: string; data: unknown }> = []
  for (const n of (bundle.notes ?? [])) {
    const newId = entityIdMap[n.id] ?? uuidv4()
    noteRecords.push({ id: newId, data: { ...n.data } })
  }
  records.set(NOTES_STORE, noteRecords)
  stats[NOTES_STORE] = noteRecords.length

  const journalRecords: Array<{ id: string; data: unknown }> = []
  for (const j of (bundle.journals ?? [])) {
    const newId = entityIdMap[j.id] ?? uuidv4()
    journalRecords.push({ id: newId, data: { ...j.data } })
  }
  records.set(JOURNALS_STORE, journalRecords)
  stats[JOURNALS_STORE] = journalRecords.length

  const quickNoteRecords: Array<{ id: string; data: unknown }> = []
  for (const qn of (bundle.quickNotes ?? [])) {
    const newId = entityIdMap[qn.id] ?? uuidv4()
    quickNoteRecords.push({ id: newId, data: { ...qn.data } })
  }
  records.set(QUICK_NOTES_STORE, quickNoteRecords)
  stats[QUICK_NOTES_STORE] = quickNoteRecords.length

  const savingsGoalRecords: Array<{ id: string; data: unknown }> = []
  for (const sg of (bundle.savingsGoals ?? [])) {
    const newId = entityIdMap[sg.id] ?? uuidv4()
    savingsGoalRecords.push({ id: newId, data: { ...sg.data } })
  }
  records.set(SAVINGS_GOALS_STORE, savingsGoalRecords)
  stats[SAVINGS_GOALS_STORE] = savingsGoalRecords.length

  const savingsTransactionRecords: Array<{ id: string; data: unknown }> = []
  for (const st of (bundle.savingsTransactions ?? [])) {
    const newId = entityIdMap[st.id] ?? uuidv4()
    const newData = { ...st.data }
    if (newData.goalId) {
      newData.goalId = remapId(newData.goalId as string, entityIdMap)
    }
    savingsTransactionRecords.push({ id: newId, data: newData })
  }
  records.set(SAVINGS_TRANSACTIONS_STORE, savingsTransactionRecords)
  stats[SAVINGS_TRANSACTIONS_STORE] = savingsTransactionRecords.length

  const aiConversationRecords: Array<{ id: string; data: unknown }> = []
  for (const ac of (bundle.aiConversations ?? [])) {
    const newId = entityIdMap[ac.id] ?? uuidv4()
    aiConversationRecords.push({ id: newId, data: { ...ac.data } })
  }
  records.set(AI_CONVERSATIONS_STORE, aiConversationRecords)
  stats[AI_CONVERSATIONS_STORE] = aiConversationRecords.length

  const aiMemoryRecords: Array<{ id: string; data: unknown }> = []
  for (const am of (bundle.aiMemories ?? [])) {
    const newId = entityIdMap[am.id] ?? uuidv4()
    aiMemoryRecords.push({ id: newId, data: { ...am.data } })
  }
  records.set(AI_MEMORIES_STORE, aiMemoryRecords)
  stats[AI_MEMORIES_STORE] = aiMemoryRecords.length

  const aiAuditLogRecords: Array<{ id: string; data: unknown }> = []
  for (const al of (bundle.aiAuditLog ?? [])) {
    const newId = entityIdMap[al.id] ?? uuidv4()
    aiAuditLogRecords.push({ id: newId, data: { ...al.data } })
  }
  records.set(AI_AUDIT_LOG_STORE, aiAuditLogRecords)
  stats[AI_AUDIT_LOG_STORE] = aiAuditLogRecords.length

  return { records, warnings, stats }
}

export async function importV2Commit(
  remapped: ImportRemapResult,
  stagedIdMaps?: { panelIdMap: Record<string, string>; widgetIdMap: Record<string, string>; entityIdMap: Record<string, string> },
): Promise<ImportReport> {
  const report: ImportReport = {
    imported: {},
    warnings: [...remapped.warnings],
    errors: [],
  }

  const storeNames = Array.from(remapped.records.keys())
  if (storeNames.length === 0) {
    return report
  }

  // Phase 1: Process vocabDecks first (dedup builtin decks by name)
  const entityIdMap = stagedIdMaps?.entityIdMap ?? {}
  if (remapped.records.has(VOCAB_DECKS_STORE)) {
    const deckRecords = remapped.records.get(VOCAB_DECKS_STORE)!
    try {
      // Query existing builtin decks
      const existingBuiltinDecks = await runIdbTransaction([VOCAB_DECKS_STORE], 'readonly', async (ctx) => {
        const existing: Array<{ id: string; name: string; source: string }> = []
        await ctx.iterateStore<{ name: string; source: string }>(VOCAB_DECKS_STORE, (record) => {
          if (record.data.source === 'builtin') {
            existing.push({ id: record.id, name: record.data.name, source: record.data.source })
          }
        })
        return existing
      })

      const existingDeckByName = new Map(existingBuiltinDecks.map(d => [d.name, d]))
      const decksToWrite: Array<{ id: string; data: unknown }> = []
      let deckCount = 0

      for (const record of deckRecords) {
        const data = record.data as Record<string, unknown>
        if (data.source === 'builtin' && existingDeckByName.has(data.name as string)) {
          // Skip: builtin deck with same name already exists
          const existingDeck = existingDeckByName.get(data.name as string)!
          entityIdMap[record.id] = existingDeck.id
          report.warnings.push(`vocabDecks[${record.id}]: builtin deck "${data.name as string}" already exists, mapping to existing id`)
        } else {
          decksToWrite.push(record)
        }
      }

      // Write non-duplicate decks
      await runIdbTransaction([VOCAB_DECKS_STORE], 'readwrite', async (ctx) => {
        for (const record of decksToWrite) {
          try {
            await ctx.addNew(VOCAB_DECKS_STORE, { id: record.id, data: record.data })
            deckCount++
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            report.errors.push(`vocabDecks[${record.id}]: commit failed - ${msg}`)
          }
        }
      })
      report.imported[VOCAB_DECKS_STORE] = deckCount
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      report.errors.push(`vocabDecks transaction failed: ${msg}`)
    }
  }

  // Phase 2: Re-remap vocabProgress deckId with updated entityIdMap (after vocabDecks dedup)
  if (remapped.records.has(VOCAB_PROGRESS_STORE)) {
    const progressRecords = remapped.records.get(VOCAB_PROGRESS_STORE)!
    // Re-remap deckId for records whose deckId maps to a deduped deck
    for (const record of progressRecords) {
      const data = record.data as Record<string, unknown>
      const currentDeckId = data.deckId as string
      if (entityIdMap[currentDeckId]) {
        data.deckId = entityIdMap[currentDeckId]
      }
    }

    // Check for duplicate words within the same deck
    try {
      const existingProgressWords = await runIdbTransaction([VOCAB_PROGRESS_STORE], 'readonly', async (ctx) => {
        const words: Map<string, Set<string>> = new Map() // deckId -> Set<word>
        await ctx.iterateStore<{ deckId: string; word: string }>(VOCAB_PROGRESS_STORE, (record) => {
          const deckId = record.data.deckId
          const word = record.data.word
          if (!words.has(deckId)) words.set(deckId, new Set())
          words.get(deckId)!.add(word)
        })
        return words
      })

      const progressToWrite: Array<{ id: string; data: unknown }> = []
      let progressCount = 0

      for (const record of progressRecords) {
        const data = record.data as Record<string, unknown>
        const deckId = data.deckId as string
        const word = data.word as string
        const existingWords = existingProgressWords.get(deckId)
        if (existingWords && existingWords.has(word)) {
          report.warnings.push(`vocabProgress[${record.id}]: word "${word}" already exists in deck, skipping`)
        } else {
          progressToWrite.push(record)
        }
      }

      await runIdbTransaction([VOCAB_PROGRESS_STORE], 'readwrite', async (ctx) => {
        for (const record of progressToWrite) {
          try {
            await ctx.addNew(VOCAB_PROGRESS_STORE, { id: record.id, data: record.data })
            progressCount++
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            report.errors.push(`vocabProgress[${record.id}]: commit failed - ${msg}`)
          }
        }
      })
      report.imported[VOCAB_PROGRESS_STORE] = progressCount
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      report.errors.push(`vocabProgress transaction failed: ${msg}`)
    }
  }

  // Phase 3: Process panelTemplates (dedup builtin templates by name)
  if (remapped.records.has(PANEL_TEMPLATES_STORE)) {
    const templateRecords = remapped.records.get(PANEL_TEMPLATES_STORE)!
    try {
      const existingBuiltinTemplates = await runIdbTransaction([PANEL_TEMPLATES_STORE], 'readonly', async (ctx) => {
        const existing: Array<{ id: string; name: string; isBuiltin: boolean }> = []
        await ctx.iterateStore<{ name: string; isBuiltin: boolean }>(PANEL_TEMPLATES_STORE, (record) => {
          if (record.data.isBuiltin) {
            existing.push({ id: record.id, name: record.data.name, isBuiltin: record.data.isBuiltin })
          }
        })
        return existing
      })

      const existingTemplateByName = new Map(existingBuiltinTemplates.map(t => [t.name, t]))
      const templatesToWrite: Array<{ id: string; data: unknown }> = []
      let templateCount = 0

      for (const record of templateRecords) {
        const data = record.data as Record<string, unknown>
        if (data.isBuiltin && existingTemplateByName.has(data.name as string)) {
          report.warnings.push(`panelTemplates[${record.id}]: builtin template "${data.name as string}" already exists, skipping`)
        } else {
          templatesToWrite.push(record)
        }
      }

      await runIdbTransaction([PANEL_TEMPLATES_STORE], 'readwrite', async (ctx) => {
        for (const record of templatesToWrite) {
          try {
            await ctx.addNew(PANEL_TEMPLATES_STORE, { id: record.id, data: record.data })
            templateCount++
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            report.errors.push(`panelTemplates[${record.id}]: commit failed - ${msg}`)
          }
        }
      })
      report.imported[PANEL_TEMPLATES_STORE] = templateCount
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      report.errors.push(`panelTemplates transaction failed: ${msg}`)
    }
  }

  // Phase 4: Process remaining stores (sudokuGames, mistakes, and all original stores)
  const processedStores = new Set([VOCAB_DECKS_STORE, VOCAB_PROGRESS_STORE, PANEL_TEMPLATES_STORE])
  const remainingStoreNames = storeNames.filter(s => !processedStores.has(s))

  if (remainingStoreNames.length > 0) {
    try {
      await runIdbTransaction(remainingStoreNames, 'readwrite', async (ctx) => {
        for (const storeName of remainingStoreNames) {
          const records = remapped.records.get(storeName)
          if (!records) continue
          let count = 0
          for (const record of records) {
            try {
              await ctx.addNew(storeName, {
                id: record.id,
                data: record.data,
              })
              count++
            } catch (err) {
              const msg =
                err instanceof Error ? err.message : String(err)
              report.errors.push(
                `${storeName}[${record.id}]: commit failed - ${msg}`,
              )
            }
          }
          report.imported[storeName] = count
        }
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      report.errors.push(`transaction failed: ${msg}`)
    }
  }

  return report
}

export async function importV1AsV2(raw: unknown): Promise<ImportReport> {
  if (!isObject(raw)) {
    return {
      imported: {},
      warnings: [],
      errors: ['v1 import: bundle is not an object'],
    }
  }

  if (raw.schema !== 'living-dashboard-v1') {
    return {
      imported: {},
      warnings: [],
      errors: [`v1 import: invalid schema "${raw.schema}", expected "living-dashboard-v1"`],
    }
  }

  const now = Date.now()
  const v1Panels = raw.panels
  if (!Array.isArray(v1Panels)) {
    return {
      imported: {},
      warnings: [],
      errors: ['v1 import: missing or invalid panels array'],
    }
  }

  const panels: ExportableRecord[] = []
  const widgetRecords: ExportableRecord[] = []
  const widgetStates: ExportableRecord[] = []

  for (const panelContainer of v1Panels) {
    if (!isObject(panelContainer)) continue
    const panel = panelContainer.panel
    if (!isObject(panel)) continue

    const panelId = panel.id as string
    if (!panelId) continue

    panels.push({
      id: panelId,
      version: 1,
      data: {
        name: panel.name ?? '',
        createdAt: now,
        zIndex: typeof panel.order === 'number' ? panel.order : 0,
        width: 0,
        height: 0,
        offsetX:
          panel.canvasTransform &&
          typeof panel.canvasTransform === 'object' &&
          (panel.canvasTransform as Record<string, unknown>).x != null
            ? (panel.canvasTransform as Record<string, unknown>).x
            : 0,
        offsetY:
          panel.canvasTransform &&
          typeof panel.canvasTransform === 'object' &&
          (panel.canvasTransform as Record<string, unknown>).y != null
            ? (panel.canvasTransform as Record<string, unknown>).y
            : 0,
        order: typeof panel.order === 'number' ? panel.order : 0,
        settings: panel.settings ?? undefined,
        canvasTransform: panel.canvasTransform ?? undefined,
        schemaVersion: 1,
      },
    })

    const widgets = panelContainer.widgets
    if (Array.isArray(widgets)) {
      const positions = panelContainer.positions
      const posLookup = new Map<string, Record<string, unknown>>()
      if (Array.isArray(positions)) {
        for (const pos of positions) {
          if (isObject(pos) && typeof pos.widgetId === 'string') {
            posLookup.set(pos.widgetId, pos as Record<string, unknown>)
          }
        }
      }

      for (const widget of widgets) {
        if (!isObject(widget)) continue
        const widgetId = widget.widgetId as string
        if (!widgetId) continue

        const pos = posLookup.get(widgetId)

        widgetRecords.push({
          id: widgetId,
          version: 1,
          data: {
            panelId,
            type: (widget.widgetType as string) ?? 'unknown',
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

        widgetStates.push({
          id: widgetId,
          version: 1,
          data: {
            widgetId,
            panelId,
            envelope: {
              widgetType: (widget.widgetType as string) ?? 'unknown',
              widgetVersion: '1',
              stateVersion: 1,
              updatedAt: now,
              state: widget.state ?? {},
            },
            schemaVersion: 1,
          },
        })
      }
    }
  }

  const convertEntityArray = (
    arr: unknown,
  ): ExportableRecord[] => {
    if (!Array.isArray(arr)) return []
    const result: ExportableRecord[] = []
    for (const item of arr) {
      if (!isObject(item)) continue
      const id = item.id as string
      if (!id) continue
      result.push({ id, version: 1, data: item as Record<string, unknown> })
    }
    return result
  }

  const v2Bundle: ExportBundle = {
    version: 2 as 3,
    schema: 'living-dashboard-v2',
    exportedAt:
      typeof raw.exportedAt === 'string'
        ? raw.exportedAt
        : new Date().toISOString(),
    panels,
    widgetRecords,
    widgetStates,
    tasks: convertEntityArray(raw.tasks),
    calendarEvents: convertEntityArray(raw.calendarEvents),
    focusSessions: convertEntityArray(raw.focusSessions),
    habits: convertEntityArray(raw.habits),
    habitCheckins: convertEntityArray(raw.habitCheckins),
    moodEntries: convertEntityArray(raw.moodEntries),
    quizSessions: [],
    vocabDecks: [],
    vocabProgress: [],
    sudokuGames: [],
    mistakes: [],
    panelTemplates: [],
    settings: isObject(raw.settings) ? (raw.settings as Record<string, unknown>) : undefined,
  }

  const staged = importV2Stage(v2Bundle)
  if (!staged.valid) {
    return {
      imported: {},
      warnings: staged.warnings,
      errors: ['v1->v2 conversion: staging validation failed'],
    }
  }

  const remapped = importV2Remap(staged)
  return importV2Commit(remapped, staged.idMaps)
}

export async function importDataV2(blob: Blob): Promise<ImportReport> {
  let raw: unknown
  try {
    const text = await blob.text()
    raw = JSON.parse(text)
  } catch {
    return {
      imported: {},
      warnings: [],
      errors: ['failed to parse import file as JSON'],
    }
  }

  if (!isObject(raw)) {
    return {
      imported: {},
      warnings: [],
      errors: ['import file root is not an object'],
    }
  }

  const schema = raw.schema
  const version = raw.version

  if (schema === 'living-dashboard-v1' || version === 1) {
    return importV1AsV2(raw)
  }

  if (schema === 'living-dashboard-v2' || version === 2 || version === 3) {
    const staged = importV2Stage(raw)
    if (!staged.valid) {
      return {
        imported: {},
        warnings: staged.warnings,
        errors: ['v2/v3 import: staging validation failed'],
      }
    }
    const remapped = importV2Remap(staged)
    return importV2Commit(remapped, staged.idMaps)
  }

  return {
    imported: {},
    warnings: [],
    errors: [
      `unrecognized import format: schema="${String(schema)}", version=${String(version)}`,
    ],
  }
}
