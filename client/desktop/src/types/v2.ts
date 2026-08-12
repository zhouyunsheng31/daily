export type JSONValue = string | number | boolean | null | JSONValue[] | { [key: string]: JSONValue }

export interface PersistedRecord<T> {
  id: string
  version: number
  updatedAt: number
  data: T
}

export type RecordStatus = 'active' | 'pending_delete'

export interface DeletableEntityData {
  recordStatus: RecordStatus
  deleteToken?: string
  deleteExpiresAt?: number
  deletedAt?: number
}

export interface PanelData {
  name: string
  createdAt: number
  zIndex: number
  width: number
  height: number
  offsetX: number
  offsetY: number
  importBatchId?: string
  order?: number
  settings?: { layoutMode: 'free' | 'grid'; gridSize: number; [key: string]: unknown }
  canvasTransform?: { x: number; y: number; zoom: number }
  schemaVersion: number
}

export type PanelRecord = PersistedRecord<PanelData>

export interface WidgetRecordData extends DeletableEntityData {
  panelId: string
  type: string
  x: number
  y: number
  width: number
  height: number
  zIndex: number
  minimized?: boolean
  locked?: boolean
  colorScheme?: string
  schemaVersion: number
}

export type WidgetRecord = PersistedRecord<WidgetRecordData>

export interface WidgetStateEnvelope<T = unknown> {
  widgetType: string
  widgetVersion: string
  stateVersion: number
  updatedAt: number
  state: T
}

export interface WidgetStateData<T = unknown> {
  widgetId: string
  panelId: string
  envelope: WidgetStateEnvelope<T>
  legacyRaw?: unknown
  legacyWrappedAt?: number
  legacyRawDroppedAt?: number
  importedAsOpaqueUnknown?: boolean
  opaqueImportContext?: {
    oldWidgetId: string
    newWidgetId: string
    oldPanelId: string
    newPanelId: string
    widgetIdMap: Record<string, string>
    panelIdMap: Record<string, string>
    entityIdMap: Record<string, string>
  }
  schemaVersion: number
}

export type WidgetStateRecord<T = unknown> = PersistedRecord<WidgetStateData<T>>

export interface TaskData extends DeletableEntityData {
  panelId: string
  title: string
  description: string
  taskStatus: 'todo' | 'in_progress' | 'done'
  priority: 'low' | 'medium' | 'high'
  dueAt: number | null
  createdAt: number
  schemaVersion: number
}

export type TaskRecord = PersistedRecord<TaskData>

export interface CalendarEventData extends DeletableEntityData {
  panelId: string
  title: string
  startsAt: number
  endsAt?: number
  note?: string
  schemaVersion: number
}

export type CalendarEventRecord = PersistedRecord<CalendarEventData>

export interface FocusSessionData {
  panelId?: string
  focusTimerWidgetId?: string
  taskId?: string
  taskSnapshot?: {
    title: string
    deletedAt?: number
  }
  label?: string
  startedAt: number
  endedAt: number
  duration: number
  mode?: string
  schemaVersion: number
}

export type FocusSessionRecord = PersistedRecord<FocusSessionData>

export interface HabitData {
  name: string
  frequency: 'daily' | 'weekly'
  createdAt: number
  schemaVersion: number
}

export type HabitRecord = PersistedRecord<HabitData>

export interface HabitCheckinData {
  habitId: string
  date: string
  checkedAt: number
  schemaVersion: number
}

export type HabitCheckinRecord = PersistedRecord<HabitCheckinData>

export interface MoodEntryData extends DeletableEntityData {
  date: string
  mood: number
  note: string
  schemaVersion: number
}

export type MoodEntryRecord = PersistedRecord<MoodEntryData>

export interface BlobAssetManifest {
  widgetId: string
  fileName: string
  mimeType: string
  size?: number
}

export type ValidationResult<T> =
  | { ok: true; state: T; repaired?: boolean; warnings?: string[] }
  | { ok: false; fallbackState: T; errors: string[] }

export type ReadCompatResult<T> =
  | { ok: true; kind: 'current'; data: T }
  | { ok: true; kind: 'legacy'; raw: unknown; syntheticData: T }
  | { ok: false; reason: 'bad_shell' | 'unsupported_schema' | 'bad_legacy'; raw: unknown }

export interface StoreSchemaContract<TPersistedData> {
  storeName: string
  currentSchemaVersion: number
  supportedSchemaVersions: number[]
  validateRecordShell(rawRecord: unknown): rawRecord is PersistedRecord<unknown>
  validateData(rawData: unknown): ValidationResult<TPersistedData>
  readCompatValidateRecord(rawRecord: unknown): ReadCompatResult<TPersistedData>
}

export type WidgetCategory = 'basic' | 'study' | 'work' | 'life' | 'media' | 'stats' | 'fun' | 'ai' | 'web'

export interface WidgetCapabilities {
  aiReadable: boolean
  aiWritable: boolean
  connectable: boolean
  exportable: boolean
}

export interface WidgetLifecycle {
  onCreate?: (widgetId: string) => void
  onDestroy?: (widgetId: string) => void
  onStateChange?: (widgetId: string, newState: Record<string, unknown>) => void
}

export interface WidgetDefinitionV2A<T = unknown> {
  type: string
  widgetVersion: string
  stateVersion: number
  category: WidgetCategory
  capabilities: WidgetCapabilities
  createDefaultState(): T
  validateState(raw: unknown): ValidationResult<T>
  normalizeStateForSave(state: T): JSONValue
  normalizeState?(raw: unknown): T
  getAISummary?(state: T): string
  migrateState?(oldState: unknown, fromVersion: number): T
  lifecycle?: WidgetLifecycle
}

export interface ExportContext {
  widgetId: string
  panelId: string
  includeEntities: boolean
}

export interface ImportContext {
  oldWidgetId: string
  newWidgetId: string
  oldPanelId: string
  newPanelId: string
  widgetIdMap: Record<string, string>
  panelIdMap: Record<string, string>
  entityIdMap: Record<string, string>
  addWarning(message: string): void
}

export interface ExportableWidgetDefinition<T = unknown> extends WidgetDefinitionV2A<T> {
  exportState(state: T, context: ExportContext): unknown
  importState(raw: unknown, context: ImportContext): ValidationResult<T>
}

export type WidgetRenderStatus =
  | 'ok'
  | 'missing_state'
  | 'unknown_type'
  | 'bad_state'
  | 'incompatible_state_version'
  | 'render_error'

export type DiagnosticIssueKind =
  | 'import_recovery_error'
  | 'duplicate_widget_state'
  | 'widget_state_repair_failed'
  | 'bad_panel_record'
  | 'opaque_recover_failed'
  | 'legacy_raw_oversized'
  | 'create_widget_partial_commit'
  | 'orphan_widget_state'
  | 'widget_record_missing'
  | 'widget_state_missing'
  | 'orphan_widget_record'
  | 'inconsistent_cross_store_commit'

export type WidgetDisplayMode =
  | { kind: 'render'; status: WidgetRenderStatus }
  | { kind: 'diagnostic'; issue: DiagnosticIssueKind }
  | { kind: 'opaque_recover_required' }

export type PanelLoadStatus =
  | 'ok'
  | 'missing'
  | 'bad_record'
  | 'incompatible_schema'

export type LoadedWidgetState =
  | { kind: 'envelope'; envelope: WidgetStateEnvelope }
  | { kind: 'legacy'; raw: unknown; syntheticEnvelope: WidgetStateEnvelope }
  | { kind: 'missing' }
  | { kind: 'invalid'; raw: unknown }

export type LocatedWidgetState =
  | { kind: 'found'; primaryKey: string; record: WidgetStateRecord; matchedBy: 'id' | 'data.widgetId'; needsRepair: boolean }
  | { kind: 'duplicate_conflict'; widgetId: string; candidates: Array<{ primaryKey: string; record: WidgetStateRecord }> }
  | { kind: 'missing' }

export type StorageWriteOutcome =
  | { ok: true }
  | { ok: false; kind: 'quota_exceeded' }
  | { ok: false; kind: 'version_conflict'; current?: PersistedRecord<unknown> }
  | { ok: false; kind: 'condition_mismatch' }
  | { ok: false; kind: 'not_found' }
  | { ok: false; kind: 'constraint' }
  | { ok: false; kind: 'retryable_abort' }
  | { ok: false; kind: 'readonly_required' }
  | { ok: false; kind: 'programming_error_after_commit' }

// ============ Phase 4B: Learning Enhancement ============

export interface VocabDeckData {
  name: string
  description: string
  wordCount: number
  source: 'builtin' | 'custom'
  createdAt: number
  updatedAt: number
  schemaVersion: number
}
export type VocabDeckRecord = PersistedRecord<VocabDeckData>

export interface VocabProgressData {
  deckId: string
  word: string
  meaning: string
  easeFactor: number
  interval: number
  repetition: number
  nextReviewAt: number
  lastReviewAt: number | null
  status: 'new' | 'learning' | 'review' | 'mastered'
  createdAt: number
  updatedAt: number
  schemaVersion: number
}
export type VocabProgressRecord = PersistedRecord<VocabProgressData>

export interface SudokuGameData {
  panelId: string
  sudokuWidgetId: string
  difficulty: 'easy' | 'medium' | 'hard'
  puzzle: number[]
  solution: number[]
  userGrid: number[]
  notes: Record<string, number[]>
  startedAt: number
  finishedAt: number
  elapsedSeconds: number
  isPaused: boolean
  status: 'playing' | 'completed' | 'abandoned'
  createdAt: number
  updatedAt: number
  schemaVersion: number
}
export type SudokuGameRecord = PersistedRecord<SudokuGameData>

export interface MistakeData {
  panelId: string
  sourceType: 'latexQuiz'
  sourceId: string
  questionId: string
  questionContent: string
  correctAnswer: string
  userAnswer: string
  explanation: string
  errorCount: number
  easeFactor: number
  interval: number
  repetition: number
  nextReviewAt: number
  lastReviewAt: number | null
  status: 'new' | 'learning' | 'review' | 'mastered'
  createdAt: number
  updatedAt: number
  schemaVersion: number
}
export type MistakeRecord = PersistedRecord<MistakeData>

export interface PanelTemplateData {
  name: string
  icon: string
  description: string
  widgets: Array<{
    widgetType: string
    position: { x: number; y: number; w: number; h: number }
    initialState?: Record<string, unknown>
  }>
  isBuiltin: boolean
  createdAt: number
  updatedAt: number
  schemaVersion: number
}
export type PanelTemplateRecord = PersistedRecord<PanelTemplateData>

export type ResourceKind =
  | 'panel'
  | 'widgetRecord'
  | 'widgetState'
  | 'task'
  | 'calendarEvent'
  | 'focusSession'
  | 'habit'
  | 'habitCheckin'
  | 'moodEntry'
  | 'quizSession'
  | 'vocabDeck'
  | 'vocabProgress'
  | 'sudokuGame'
  | 'mistake'
  | 'panelTemplate'

export type EffectiveRuntimeMode =
  | 'normal_editable'
  | 'readonly_lease_lost'
  | 'quota'
  | 'bad_panel_readonly'

export type LocalBlobPlaceholderState = {
  fileName?: string
  mimeType?: string
  size?: number
  needsReselect: boolean
}

export type { ResourceSaveState } from '../utils/saveJob'
