import type { WidgetDefinitionV2A, ValidationResult, JSONValue } from '../types/v2'
import type { WebviewWidgetState } from '../types'

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function nullableStr(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

function nullableNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function oneOf<T extends string>(v: unknown, values: readonly T[], fallback: T): T {
  return values.includes(v as T) ? (v as T) : fallback
}

function checkSchemaVersion(raw: Record<string, unknown>): string | null {
  if (!('schemaVersion' in raw)) return 'missing schemaVersion'
  if (raw.schemaVersion !== 1) return `unsupported schemaVersion: ${raw.schemaVersion}`
  return null
}

interface AIAssistantWidgetState {
  sessionId: string
  selectedModel: string
  contextPanelOpen: boolean
  privacyAccepted: boolean
  configPanelOpen: boolean
  role: string
  theme: string
  schemaVersion: 1
}

const AI_ASSISTANT_MODELS = ['deepseek-v4-flash', 'gpt-5.5', 'gpt-5.4', 'gemini-3.5-flash', 'claude-sonnet-4.6'] as const

const aiAssistantDef: WidgetDefinitionV2A<AIAssistantWidgetState> = {
  type: 'aiAssistant',
  widgetVersion: '1.0.0',
  stateVersion: 1,
  category: 'ai',
  capabilities: { aiReadable: true, aiWritable: false, connectable: true, exportable: true },
  createDefaultState(): AIAssistantWidgetState {
    return {
      sessionId: '',
      selectedModel: 'deepseek-v4-flash',
      contextPanelOpen: false,
      privacyAccepted: false,
      configPanelOpen: false,
      role: '生活助手',
      theme: 'default',
      schemaVersion: 1,
    }
  },
  validateState(raw: unknown): ValidationResult<AIAssistantWidgetState> {
    const def = this.createDefaultState()
    if (!isObject(raw)) return { ok: false, fallbackState: def, errors: ['state is not an object'] }
    const err = checkSchemaVersion(raw)
    if (err) return { ok: false, fallbackState: def, errors: [err] }
    return {
      ok: true,
      state: {
        sessionId: str(raw.sessionId, def.sessionId),
        selectedModel: oneOf(raw.selectedModel, AI_ASSISTANT_MODELS, def.selectedModel),
        contextPanelOpen: bool(raw.contextPanelOpen, def.contextPanelOpen),
        privacyAccepted: bool(raw.privacyAccepted, def.privacyAccepted),
        configPanelOpen: bool(raw.configPanelOpen, def.configPanelOpen),
        role: str(raw.role, def.role),
        theme: str(raw.theme, def.theme),
        schemaVersion: 1,
      },
    }
  },
  normalizeStateForSave(state: AIAssistantWidgetState): JSONValue {
    return { ...state }
  },
  normalizeState(raw: unknown): AIAssistantWidgetState {
    const def = this.createDefaultState()
    if (!isObject(raw)) return def
    return {
      sessionId: (raw.sessionId as string) ?? def.sessionId,
      selectedModel: (raw.selectedModel as string) ?? def.selectedModel,
      contextPanelOpen: (raw.contextPanelOpen as boolean) ?? def.contextPanelOpen,
      privacyAccepted: (raw.privacyAccepted as boolean) ?? def.privacyAccepted,
      configPanelOpen: (raw.configPanelOpen as boolean) ?? def.configPanelOpen,
      role: (raw.role as string) ?? def.role,
      theme: (raw.theme as string) ?? def.theme,
      schemaVersion: 1,
    }
  },
  getAISummary(state: AIAssistantWidgetState): string {
    return `AI助手(${state.role}): 模型=${state.selectedModel}, 隐私已接受=${state.privacyAccepted}`
  },
  migrateState(oldState: unknown, fromVersion: number): AIAssistantWidgetState {
    if (fromVersion === this.stateVersion) return oldState as AIAssistantWidgetState
    return this.normalizeState ? this.normalizeState(oldState) : this.createDefaultState()
  },
  lifecycle: {},
}

type PdfViewerState = { fileName: string; mimeType: string | null; size: number | null; lastPage: number; needsReselect: boolean; schemaVersion: 1 }
const pdfViewerDef: WidgetDefinitionV2A<PdfViewerState> = {
  type: 'pdfViewer',
  widgetVersion: '1.0.0',
  stateVersion: 1,
  category: 'media',
  capabilities: { aiReadable: true, aiWritable: false, connectable: false, exportable: true },
  createDefaultState(): PdfViewerState {
    return { fileName: '', mimeType: null, size: null, lastPage: 1, needsReselect: false, schemaVersion: 1 }
  },
  validateState(raw: unknown): ValidationResult<PdfViewerState> {
    const def = this.createDefaultState()
    if (!isObject(raw)) return { ok: false, fallbackState: def, errors: ['state is not an object'] }
    const err = checkSchemaVersion(raw)
    if (err) return { ok: false, fallbackState: def, errors: [err] }
    return { ok: true, state: { fileName: str(raw.fileName, def.fileName), mimeType: nullableStr(raw.mimeType), size: nullableNum(raw.size), lastPage: num(raw.lastPage, def.lastPage), needsReselect: bool(raw.needsReselect, def.needsReselect), schemaVersion: 1 } }
  },
  normalizeStateForSave(state: PdfViewerState): JSONValue {
    return { fileName: state.fileName.trim(), mimeType: state.mimeType, size: state.size, lastPage: state.lastPage, needsReselect: state.needsReselect, schemaVersion: 1 }
  },
  normalizeState(raw: unknown): PdfViewerState {
    const def = this.createDefaultState()
    if (!isObject(raw)) return def
    return {
      fileName: (raw.fileName as string) ?? def.fileName,
      mimeType: (raw.mimeType as string | null) ?? def.mimeType,
      size: (raw.size as number | null) ?? def.size,
      lastPage: (raw.lastPage as number) ?? def.lastPage,
      needsReselect: (raw.needsReselect as boolean) ?? def.needsReselect,
      schemaVersion: 1,
    }
  },
  getAISummary(state: PdfViewerState): string {
    return `PDF查看器: 文件=${state.fileName || '(未选择)'}, 页码=${state.lastPage}`
  },
  migrateState(oldState: unknown, fromVersion: number): PdfViewerState {
    if (fromVersion === this.stateVersion) return oldState as PdfViewerState
    return this.normalizeState ? this.normalizeState(oldState) : this.createDefaultState()
  },
  lifecycle: {},
}

type MusicPlayerState = { playlistName: string; fileName: string | null; mimeType: string | null; size: number | null; needsReselect: boolean; songCount: number; lastPlayedAt: number | null; schemaVersion: 1 }
const musicPlayerDef: WidgetDefinitionV2A<MusicPlayerState> = {
  type: 'musicPlayer',
  widgetVersion: '1.0.0',
  stateVersion: 1,
  category: 'media',
  capabilities: { aiReadable: true, aiWritable: true, connectable: false, exportable: true },
  createDefaultState(): MusicPlayerState {
    return { playlistName: '', fileName: null, mimeType: null, size: null, needsReselect: false, songCount: 0, lastPlayedAt: null, schemaVersion: 1 }
  },
  validateState(raw: unknown): ValidationResult<MusicPlayerState> {
    const def = this.createDefaultState()
    if (!isObject(raw)) return { ok: false, fallbackState: def, errors: ['state is not an object'] }
    const err = checkSchemaVersion(raw)
    if (err) return { ok: false, fallbackState: def, errors: [err] }
    return { ok: true, state: { playlistName: str(raw.playlistName, def.playlistName), fileName: nullableStr(raw.fileName), mimeType: nullableStr(raw.mimeType), size: nullableNum(raw.size), needsReselect: bool(raw.needsReselect, def.needsReselect), songCount: num(raw.songCount, 0), lastPlayedAt: nullableNum(raw.lastPlayedAt), schemaVersion: 1 } }
  },
  normalizeStateForSave(state: MusicPlayerState): JSONValue {
    return { playlistName: state.playlistName.trim(), fileName: state.fileName, mimeType: state.mimeType, size: state.size, needsReselect: state.needsReselect, songCount: state.songCount, lastPlayedAt: state.lastPlayedAt, schemaVersion: 1 }
  },
  normalizeState(raw: unknown): MusicPlayerState {
    const def = this.createDefaultState()
    if (!isObject(raw)) return def
    return {
      playlistName: (raw.playlistName as string) ?? def.playlistName,
      fileName: (raw.fileName as string | null) ?? def.fileName,
      mimeType: (raw.mimeType as string | null) ?? def.mimeType,
      size: (raw.size as number | null) ?? def.size,
      needsReselect: (raw.needsReselect as boolean) ?? def.needsReselect,
      songCount: (raw.songCount as number) ?? 0,
      lastPlayedAt: (raw.lastPlayedAt as number | null) ?? null,
      schemaVersion: 1,
    }
  },
  getAISummary(state: MusicPlayerState): string {
    const playlistInfo = state.playlistName ? `歌单=${state.playlistName}` : '无歌单'
    const songInfo = state.songCount > 0 ? `, ${state.songCount}首歌` : ''
    const lastPlayed = state.lastPlayedAt
      ? `, 最近播放=${new Date(state.lastPlayedAt).toLocaleDateString('zh-CN')}`
      : ''
    return `音乐播放器: ${playlistInfo}${songInfo}${lastPlayed}`
  },
  migrateState(oldState: unknown, fromVersion: number): MusicPlayerState {
    if (fromVersion === this.stateVersion) return oldState as MusicPlayerState
    return this.normalizeState ? this.normalizeState(oldState) : this.createDefaultState()
  },
  lifecycle: {},
}

const FOCUS_DISPLAY_MODES = ['timer', 'history'] as const
const FOCUS_THEMES = ['default', 'warm', 'cool', 'dark'] as const
type FocusTimerState = { currentTaskId: string | null; lastSessionId: string | null; activeSessionId: string | null; displayMode: 'timer' | 'history'; durationPreset: number; soundEnabled: boolean; theme: string; schemaVersion: 1 }
const focusTimerDef: WidgetDefinitionV2A<FocusTimerState> = {
  type: 'focusTimer',
  widgetVersion: '1.0.0',
  stateVersion: 1,
  category: 'work',
  capabilities: { aiReadable: true, aiWritable: true, connectable: true, exportable: true },
  createDefaultState(): FocusTimerState {
    return { currentTaskId: null, lastSessionId: null, activeSessionId: null, displayMode: 'timer', durationPreset: 25, soundEnabled: true, theme: 'default', schemaVersion: 1 }
  },
  validateState(raw: unknown): ValidationResult<FocusTimerState> {
    const def = this.createDefaultState()
    if (!isObject(raw)) return { ok: false, fallbackState: def, errors: ['state is not an object'] }
    const err = checkSchemaVersion(raw)
    if (err) return { ok: false, fallbackState: def, errors: [err] }
    return { ok: true, state: { currentTaskId: nullableStr(raw.currentTaskId), lastSessionId: nullableStr(raw.lastSessionId), activeSessionId: nullableStr(raw.activeSessionId), displayMode: oneOf(raw.displayMode, FOCUS_DISPLAY_MODES, def.displayMode), durationPreset: num(raw.durationPreset, def.durationPreset), soundEnabled: bool(raw.soundEnabled, def.soundEnabled), theme: oneOf(raw.theme, FOCUS_THEMES, def.theme), schemaVersion: 1 } }
  },
  normalizeStateForSave(state: FocusTimerState): JSONValue {
    return { currentTaskId: state.currentTaskId, lastSessionId: state.lastSessionId, activeSessionId: state.activeSessionId, displayMode: state.displayMode, durationPreset: state.durationPreset, soundEnabled: state.soundEnabled, theme: state.theme, schemaVersion: 1 }
  },
  normalizeState(raw: unknown): FocusTimerState {
    const def = this.createDefaultState()
    if (!isObject(raw)) return def
    return {
      currentTaskId: (raw.currentTaskId as string | null) ?? def.currentTaskId,
      lastSessionId: (raw.lastSessionId as string | null) ?? def.lastSessionId,
      activeSessionId: (raw.activeSessionId as string | null) ?? def.activeSessionId,
      displayMode: (raw.displayMode as FocusTimerState['displayMode']) ?? def.displayMode,
      durationPreset: (raw.durationPreset as number) ?? def.durationPreset,
      soundEnabled: (raw.soundEnabled as boolean) ?? def.soundEnabled,
      theme: (raw.theme as string) ?? def.theme,
      schemaVersion: 1,
    }
  },
  getAISummary(state: FocusTimerState): string {
    const status = state.activeSessionId ? '专注中' : '空闲'
    return `专注计时器: 模式=${state.displayMode}, 状态=${status}`
  },
  migrateState(oldState: unknown, fromVersion: number): FocusTimerState {
    if (fromVersion === this.stateVersion) return oldState as FocusTimerState
    return this.normalizeState ? this.normalizeState(oldState) : this.createDefaultState()
  },
  lifecycle: {},
}

interface LatexQuizWidgetState {
  currentSessionId: string | null
  displayMode: 'menu' | 'quiz' | 'result'
  selectedCategory: 'algebra' | 'geometry' | 'calculus' | 'trig'
  userAnswers: Record<string, string>
  gradeResults: Record<string, boolean>
  schemaVersion: 1
}

const LATEXQUIZ_DISPLAY_MODES = ['menu', 'quiz', 'result'] as const
const LATEXQUIZ_CATEGORIES = ['algebra', 'geometry', 'calculus', 'trig'] as const

const latexQuizDef: WidgetDefinitionV2A<LatexQuizWidgetState> = {
  type: 'latexQuiz',
  widgetVersion: '1.0.0',
  stateVersion: 1,
  category: 'study',
  capabilities: { aiReadable: true, aiWritable: false, connectable: false, exportable: true },
  createDefaultState(): LatexQuizWidgetState {
    return {
      currentSessionId: null,
      displayMode: 'menu',
      selectedCategory: 'algebra',
      userAnswers: {},
      gradeResults: {},
      schemaVersion: 1,
    }
  },
  validateState(raw: unknown): ValidationResult<LatexQuizWidgetState> {
    const def = this.createDefaultState()
    if (!isObject(raw)) return { ok: false, fallbackState: def, errors: ['state is not an object'] }
    const err = checkSchemaVersion(raw)
    if (err) return { ok: false, fallbackState: def, errors: [err] }
    return {
      ok: true,
      state: {
        currentSessionId: nullableStr(raw.currentSessionId),
        displayMode: oneOf(raw.displayMode, LATEXQUIZ_DISPLAY_MODES, def.displayMode),
        selectedCategory: oneOf(raw.selectedCategory, LATEXQUIZ_CATEGORIES, def.selectedCategory),
        userAnswers: isObject(raw.userAnswers) ? raw.userAnswers as Record<string, string> : def.userAnswers,
        gradeResults: isObject(raw.gradeResults) ? raw.gradeResults as Record<string, boolean> : def.gradeResults,
        schemaVersion: 1,
      },
    }
  },
  normalizeStateForSave(state: LatexQuizWidgetState): JSONValue {
    return {
      currentSessionId: state.currentSessionId,
      displayMode: state.displayMode,
      selectedCategory: state.selectedCategory,
      userAnswers: state.userAnswers,
      gradeResults: state.gradeResults,
      schemaVersion: 1,
    }
  },
  normalizeState(raw: unknown): LatexQuizWidgetState {
    const def = this.createDefaultState()
    if (!isObject(raw)) return def
    return {
      currentSessionId: nullableStr(raw.currentSessionId) ?? def.currentSessionId,
      displayMode: oneOf(raw.displayMode, LATEXQUIZ_DISPLAY_MODES, def.displayMode),
      selectedCategory: oneOf(raw.selectedCategory, LATEXQUIZ_CATEGORIES, def.selectedCategory),
      userAnswers: isObject(raw.userAnswers) ? raw.userAnswers as Record<string, string> : def.userAnswers,
      gradeResults: isObject(raw.gradeResults) ? raw.gradeResults as Record<string, boolean> : def.gradeResults,
      schemaVersion: 1,
    }
  },
  getAISummary(state: LatexQuizWidgetState): string {
    const correct = Object.values(state.gradeResults).filter(Boolean).length
    const total = Object.keys(state.userAnswers).length
    if (state.currentSessionId && total > 0) {
      return `LaTeX 出题器: 分类=${state.selectedCategory}, 进度=${correct}/${total}`
    }
    return `LaTeX 出题器: 分类=${state.selectedCategory}, 未开始`
  },
  migrateState(oldState: unknown, fromVersion: number): LatexQuizWidgetState {
    if (fromVersion === this.stateVersion) return oldState as LatexQuizWidgetState
    return this.normalizeState ? this.normalizeState(oldState) : this.createDefaultState()
  },
  lifecycle: {},
}

interface CalculatorWidgetState {
  history: Array<{ id: string; expression: string; result: string; timestamp: number }>
  schemaVersion: 1
}

function isValidHistoryEntry(h: unknown): h is { id: string; expression: string; result: string; timestamp: number } {
  if (!isObject(h)) return false
  return typeof h.id === 'string'
    && typeof h.expression === 'string' && h.expression.length <= 200
    && typeof h.result === 'string' && h.result.length <= 50
    && typeof h.timestamp === 'number' && Number.isFinite(h.timestamp)
}

const calculatorDef: WidgetDefinitionV2A<CalculatorWidgetState> = {
  type: 'calculator',
  widgetVersion: '1.0.0',
  stateVersion: 1,
  category: 'study',
  capabilities: { aiReadable: false, aiWritable: false, connectable: false, exportable: false },
  createDefaultState(): CalculatorWidgetState {
    return { history: [], schemaVersion: 1 }
  },
  validateState(raw: unknown): ValidationResult<CalculatorWidgetState> {
    const def = this.createDefaultState()
    if (!isObject(raw)) return { ok: false, fallbackState: def, errors: ['state is not an object'] }
    const err = checkSchemaVersion(raw)
    if (err) return { ok: false, fallbackState: def, errors: [err] }
    return {
      ok: true,
      state: {
        history: Array.isArray(raw.history) ? raw.history.filter(isValidHistoryEntry).slice(0, 50) : def.history,
        schemaVersion: 1,
      },
    }
  },
  normalizeStateForSave(state: CalculatorWidgetState): JSONValue {
    return { history: state.history.slice(0, 50), schemaVersion: 1 }
  },
  normalizeState(raw: unknown): CalculatorWidgetState {
    const def = this.createDefaultState()
    if (!isObject(raw)) return def
    return {
      history: Array.isArray(raw.history) ? raw.history.filter(isValidHistoryEntry).slice(0, 50) : def.history,
      schemaVersion: 1,
    }
  },
  getAISummary(state: CalculatorWidgetState): string {
    if (state.history.length === 0) return '计算器: 无历史记录'
    const last = state.history[state.history.length - 1]
    return `计算器: 最近计算 ${last.expression} = ${last.result}, 共${state.history.length}条记录`
  },
  migrateState(oldState: unknown, fromVersion: number): CalculatorWidgetState {
    if (fromVersion === this.stateVersion) return oldState as CalculatorWidgetState
    return this.normalizeState ? this.normalizeState(oldState) : this.createDefaultState()
  },
  lifecycle: {},
}

interface SudokuWidgetState {
  currentGameId: string | null
  displayMode: 'menu' | 'game'
  difficulty: 'easy' | 'medium' | 'hard'
  noteMode: boolean
  schemaVersion: 1
}

const SUDOKU_DISPLAY_MODES = ['menu', 'game'] as const
const SUDOKU_DIFFICULTIES = ['easy', 'medium', 'hard'] as const

const sudokuDef: WidgetDefinitionV2A<SudokuWidgetState> = {
  type: 'sudoku',
  widgetVersion: '1.0.0',
  stateVersion: 1,
  category: 'study',
  capabilities: { aiReadable: true, aiWritable: false, connectable: false, exportable: true },
  createDefaultState(): SudokuWidgetState {
    return { currentGameId: null, displayMode: 'menu', difficulty: 'easy', noteMode: false, schemaVersion: 1 }
  },
  validateState(raw: unknown): ValidationResult<SudokuWidgetState> {
    const def = this.createDefaultState()
    if (!isObject(raw)) return { ok: false, fallbackState: def, errors: ['state is not an object'] }
    const err = checkSchemaVersion(raw)
    if (err) return { ok: false, fallbackState: def, errors: [err] }
    return {
      ok: true,
      state: {
        currentGameId: nullableStr(raw.currentGameId),
        displayMode: oneOf(raw.displayMode, SUDOKU_DISPLAY_MODES, def.displayMode),
        difficulty: oneOf(raw.difficulty, SUDOKU_DIFFICULTIES, def.difficulty),
        noteMode: bool(raw.noteMode, def.noteMode),
        schemaVersion: 1,
      },
    }
  },
  normalizeStateForSave(state: SudokuWidgetState): JSONValue {
    return { currentGameId: state.currentGameId, displayMode: state.displayMode, difficulty: state.difficulty, noteMode: state.noteMode, schemaVersion: 1 }
  },
  normalizeState(raw: unknown): SudokuWidgetState {
    const def = this.createDefaultState()
    if (!isObject(raw)) return def
    return {
      currentGameId: (raw.currentGameId as string | null) ?? def.currentGameId,
      displayMode: oneOf(raw.displayMode, SUDOKU_DISPLAY_MODES, def.displayMode),
      difficulty: oneOf(raw.difficulty, SUDOKU_DIFFICULTIES, def.difficulty),
      noteMode: (raw.noteMode as boolean) ?? def.noteMode,
      schemaVersion: 1,
    }
  },
  getAISummary(state: SudokuWidgetState): string {
    return `数独: 难度=${state.difficulty}, 模式=${state.displayMode}`
  },
  migrateState(oldState: unknown, fromVersion: number): SudokuWidgetState {
    if (fromVersion === this.stateVersion) return oldState as SudokuWidgetState
    return this.normalizeState ? this.normalizeState(oldState) : this.createDefaultState()
  },
  lifecycle: {},
}

// ============================================================================
// freeHtml：自由 HTML 组件（共享 DOM，任意形状，pointer-events 穿透）
// 与 htmlCanvas 并列，AI 生成 HTML 时两种都支持
// ============================================================================

interface FreeHtmlWidgetState {
  html: string
  title: string
  isGlobal?: boolean
  width?: number
  height?: number
  customZIndex?: number
  interactive?: boolean
  createdAt: number
  updatedAt: number
  schemaVersion: 1
}

const freeHtmlWidgetDef: WidgetDefinitionV2A<FreeHtmlWidgetState> = {
  type: 'freeHtml',
  widgetVersion: '1.0.0',
  stateVersion: 1,
  category: 'ai',
  capabilities: { aiReadable: true, aiWritable: true, connectable: false, exportable: true },
  createDefaultState(): FreeHtmlWidgetState {
    return { html: '', title: '自由 HTML', isGlobal: false, interactive: true, createdAt: 0, updatedAt: 0, schemaVersion: 1 }
  },
  validateState(raw: unknown): ValidationResult<FreeHtmlWidgetState> {
    const def = this.createDefaultState()
    if (!isObject(raw)) return { ok: false, fallbackState: def, errors: ['state is not an object'] }
    const err = checkSchemaVersion(raw)
    if (err) return { ok: false, fallbackState: def, errors: [err] }
    return {
      ok: true,
      state: {
        html: str(raw.html, def.html),
        title: str(raw.title, def.title),
        isGlobal: bool(raw.isGlobal, def.isGlobal),
        width: nullableNum(raw.width) ?? def.width,
        height: nullableNum(raw.height) ?? def.height,
        customZIndex: nullableNum(raw.customZIndex) ?? def.customZIndex,
        interactive: raw.interactive !== undefined ? bool(raw.interactive, def.interactive) : def.interactive,
        createdAt: num(raw.createdAt, def.createdAt),
        updatedAt: num(raw.updatedAt, def.updatedAt),
        schemaVersion: 1,
      },
    }
  },
  normalizeStateForSave(state: FreeHtmlWidgetState): JSONValue {
    return { ...state }
  },
  normalizeState(raw: unknown): FreeHtmlWidgetState {
    const def = this.createDefaultState()
    if (!isObject(raw)) return def
    return {
      html: (raw.html as string) ?? def.html,
      title: (raw.title as string) ?? def.title,
      isGlobal: (raw.isGlobal as boolean) ?? def.isGlobal,
      width: nullableNum(raw.width) ?? def.width,
      height: nullableNum(raw.height) ?? def.height,
      customZIndex: nullableNum(raw.customZIndex) ?? def.customZIndex,
      interactive: raw.interactive !== undefined ? (raw.interactive as boolean) : def.interactive,
      createdAt: (raw.createdAt as number) ?? def.createdAt,
      updatedAt: (raw.updatedAt as number) ?? def.updatedAt,
      schemaVersion: 1,
    }
  },
  getAISummary(state: FreeHtmlWidgetState): string {
    const posInfo = state.isGlobal ? '全局覆盖' : '画布定位'
    return `自由 HTML: ${state.title || '(无标题)'}, ${posInfo}, 内容长度=${state.html.length}`
  },
  migrateState(oldState: unknown, fromVersion: number): FreeHtmlWidgetState {
    if (fromVersion === this.stateVersion) return oldState as FreeHtmlWidgetState
    return this.normalizeState ? this.normalizeState(oldState) : this.createDefaultState()
  },
  lifecycle: {},
}

interface HtmlCanvasWidgetState {
  html: string
  title: string
  createdAt: number
  updatedAt: number
  agentWidth?: number
  agentHeight?: number
  schemaVersion: 1
}

const htmlCanvasWidgetDef: WidgetDefinitionV2A<HtmlCanvasWidgetState> = {
  type: 'htmlCanvas',
  widgetVersion: '1.0.0',
  stateVersion: 1,
  category: 'ai',
  capabilities: { aiReadable: true, aiWritable: true, connectable: false, exportable: true },
  createDefaultState(): HtmlCanvasWidgetState {
    return { html: '', title: 'HTML Widget', createdAt: 0, updatedAt: 0, schemaVersion: 1 }
  },
  validateState(raw: unknown): ValidationResult<HtmlCanvasWidgetState> {
    const def = this.createDefaultState()
    if (!isObject(raw)) return { ok: false, fallbackState: def, errors: ['state is not an object'] }
    const err = checkSchemaVersion(raw)
    if (err) return { ok: false, fallbackState: def, errors: [err] }
    return {
      ok: true,
      state: {
        html: str(raw.html, def.html),
        title: str(raw.title, def.title),
        createdAt: num(raw.createdAt, def.createdAt),
        updatedAt: num(raw.updatedAt, def.updatedAt),
        agentWidth: nullableNum(raw.agentWidth) ?? def.agentWidth,
        agentHeight: nullableNum(raw.agentHeight) ?? def.agentHeight,
        schemaVersion: 1,
      },
    }
  },
  normalizeStateForSave(state: HtmlCanvasWidgetState): JSONValue {
    return { ...state }
  },
  normalizeState(raw: unknown): HtmlCanvasWidgetState {
    const def = this.createDefaultState()
    if (!isObject(raw)) return def
    return {
      html: (raw.html as string) ?? def.html,
      title: (raw.title as string) ?? def.title,
      createdAt: (raw.createdAt as number) ?? def.createdAt,
      updatedAt: (raw.updatedAt as number) ?? def.updatedAt,
      agentWidth: nullableNum(raw.agentWidth) ?? def.agentWidth,
      agentHeight: nullableNum(raw.agentHeight) ?? def.agentHeight,
      schemaVersion: 1,
    }
  },
  getAISummary(state: HtmlCanvasWidgetState): string {
    return `HTML Widget: ${state.title || '(无标题)'}, 内容长度=${state.html.length}`
  },
  migrateState(oldState: unknown, fromVersion: number): HtmlCanvasWidgetState {
    if (fromVersion === this.stateVersion) return oldState as HtmlCanvasWidgetState
    return this.normalizeState ? this.normalizeState(oldState) : this.createDefaultState()
  },
  lifecycle: {},
}

const webPageWidgetDef: WidgetDefinitionV2A<WebviewWidgetState> = {
  type: 'webPage',
  widgetVersion: '1.0.0',
  stateVersion: 1,
  category: 'web',
  capabilities: { aiReadable: true, aiWritable: true, connectable: false, exportable: true },
  createDefaultState(): WebviewWidgetState {
    return { url: '', title: '新网页', schemaVersion: 1 }
  },
  validateState(raw: unknown): ValidationResult<WebviewWidgetState> {
    const def = this.createDefaultState()
    if (!isObject(raw)) return { ok: false, fallbackState: def, errors: ['state is not an object'] }
    const err = checkSchemaVersion(raw)
    if (err) return { ok: false, fallbackState: def, errors: [err] }
    return {
      ok: true,
      state: {
        url: str(raw.url, def.url),
        title: str(raw.title, def.title),
        schemaVersion: 1,
      },
    }
  },
  normalizeStateForSave(state: WebviewWidgetState): JSONValue {
    return { url: state.url, title: state.title, schemaVersion: 1 }
  },
  normalizeState(raw: unknown): WebviewWidgetState {
    const def = this.createDefaultState()
    if (!isObject(raw)) return def
    return {
      url: str(raw.url, def.url),
      title: str(raw.title, def.title),
      schemaVersion: 1,
    }
  },
  getAISummary(state: WebviewWidgetState): string {
    return `网页组件: ${state.title}, URL=${state.url}`
  },
  migrateState(oldState: unknown, fromVersion: number): WebviewWidgetState {
    if (fromVersion === this.stateVersion) return oldState as WebviewWidgetState
    return this.normalizeState ? this.normalizeState(oldState) : this.createDefaultState()
  },
  lifecycle: {},
}

const allDefinitions: WidgetDefinitionV2A[] = [
  pdfViewerDef,
  musicPlayerDef,
  focusTimerDef,
  latexQuizDef,
  calculatorDef,
  sudokuDef,
  aiAssistantDef,
  htmlCanvasWidgetDef,
  freeHtmlWidgetDef,
  webPageWidgetDef,
]

export const widgetDefinitionMap: Map<string, WidgetDefinitionV2A> = new Map(
  allDefinitions.map(d => [d.type, d]),
)

export { webPageWidgetDef }
