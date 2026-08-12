import type { ComponentType, ReactNode } from 'react'

export interface WidgetPosition {
  widgetId: string
  x: number
  y: number
  w: number
  h: number
  zIndex: number
}

export interface PanelSettings {
  layoutMode: 'free' | 'grid'
  gridSize: number
  [key: string]: unknown
}

export interface WidgetConfig {
  widgetType: string
  displayName: string
  icon: ReactNode
  defaultLayout: { w: number; h: number; minW?: number; minH?: number }
  defaultState: Record<string, unknown>
  component: ComponentType<WidgetProps>
  serialize: (state: Record<string, unknown>) => Record<string, unknown>
  deserialize: (data: Record<string, unknown>) => Record<string, unknown>
  isDynamic?: boolean
}

export interface WidgetProps {
  widgetId: string
  panelId: string
  state: Record<string, unknown>
  onUpdateState: (partial: Record<string, unknown>) => void
  onEditingChange?: (editing: boolean) => void
  isPrimary?: boolean  // 新增：用于主AI助手 widget（v4 C1 修复）
}

export interface WidgetInstance {
  widgetId: string
  widgetType: string
  state: Record<string, unknown>
  minimized: boolean
  locked?: boolean
  colorScheme?: string  // 配色方案名，空=跟随全局
  isPrimary?: boolean  // 新增：主AI助手标记（顶层字段，全链路持久化）
}

export interface Panel {
  id: string
  name: string
  order: number
  settings: PanelSettings
  canvasTransform?: CanvasTransform
}

export interface PanelData {
  panel: Panel
  widgets: WidgetInstance[]
  positions: WidgetPosition[]
}

export interface AppearanceSettings {
  accentColor: string
  backgroundType: 'color' | 'gradient' | 'image'
  backgroundColor: string
  backgroundGradient: string
  backgroundImage: string
  surfaceColor: string
  surfaceBorderColor: string
  surfaceOpacity: number
  surfaceBlur: number
  textColor: string
  textMutedColor: string
  fontSize: number
}

/** Phase 6.3: 搜索引擎类型 */
export type SearchEngine = 'google' | 'bing' | 'baidu' | 'duckduckgo'

export interface BehaviorSettings {
  defaultLayoutMode: 'free' | 'grid'
  defaultGridSize: number
  startupPanel: 'last' | 'first' | string
  confirmBeforeDelete: boolean
  widgetSnapToEdge: boolean
  // Phase 6.3: 搜索引擎设置（spec 第 4 节）
  searchEngine: SearchEngine
  // Phase 6.1: 内存休眠（提前定义避免后续冲突）
  memoryHibernateEnabled: boolean
  memoryHibernateAfterMin: number
  memoryHibernateThresholdGB: number
  // Phase 15 批次2 任务2.0：隐私模式（独立 partition，不共享 cookie/storage）
  privacyMode: boolean
  // Phase 7 批次4 任务7（spec 6.4 节）：新建标签默认行为
  newTabDefault: 'home' | 'blank'
  // Phase 7 批次4 任务7（spec 6.4 节）：关闭标签后跳转策略
  closeTabJumpStrategy: 'prev' | 'next' | 'none'
}

/**
 * Phase 7 批次4 任务7（spec 6.2.3 节）：无障碍与动效设置。
 * - reduceMotion: 减弱动画（禁用所有 transition/animation）
 * - highContrast: 高对比度模式
 * - fontScale: 字体缩放（0.8 - 1.5，对应 80%-150%）
 * - compactMode: 紧凑模式（减小间距）
 *
 * 持久化到 useAppStore.settings.accessibility，与 appearance/behavior 同级（spec 6.5 节注 10）。
 */
export interface AccessibilitySettings {
  reduceMotion: boolean
  highContrast: boolean
  fontScale: number
  compactMode: boolean
}

export interface AppSettings {
  appearance: AppearanceSettings
  behavior: BehaviorSettings
  // Phase 7 批次4 任务7：无障碍设置（与 appearance/behavior 同级，spec 6.5 注 10）
  accessibility?: AccessibilitySettings
  // Phase 4: 主页定制（spec 5.8 节）
  browserHome?: {
    backgroundImage: string
    logo: string
    accentColor: string
  }
  canvasHome?: {
    backgroundImage: string
    circleIcon: string
    accentColor: string
  }
}

/**
 * Phase 7 批次6 任务5：主页模板类型。
 * - minimal：仅 AI 输入框 + 圆形图标（不显示收藏组件网格）
 * - standard（默认）：AI 输入框 + 圆形图标 + 收藏组件网格（当前布局）
 * - rich：standard + 快捷链接区 + 最近访问面板区
 */
export type HomeTemplateType = 'minimal' | 'standard' | 'rich'

// ========================= Phase 4: 产品形态改造 =========================

/** 网页标签（独立于画布面板，spec 5.2 节） */
export interface WebTab {
  id: string
  url: string
  title: string
  favicon?: string
  panelId?: string  // 嵌入到的画布面板（可选，嵌入后建立引用）
  createdAt: number
  updatedAt: number
}

/** 书签（spec 5.3 节浏览器主页） */
export interface Bookmark {
  id: string
  url: string
  title: string
  favicon?: string
  showOnHome: boolean  // 是否显示在主页
  createdAt: number
}

/** 冲突信息（spec 2.5 节乐观锁冲突） */
export interface ConflictInfo {
  widgetId: string
  localVersion: number
  remoteVersion: number
  remoteState: Record<string, unknown>
  timestamp: number
}

/** 主区域显示类型（spec 5.2 节，主区域同一时间只显示一个） */
export type MainViewType = 'web-tab' | 'canvas-panel' | 'browser-home' | 'canvas-home'

/** 主区域显示状态 */
export interface MainView {
  type: MainViewType
  tabId?: string    // type='web-tab'/'browser-home' 时使用
  panelId?: string  // type='canvas-panel'/'canvas-home' 时使用
}

export interface SaveStatus {
  status: 'saved' | 'saving' | 'error'
  lastSavedAt: number | null
  error?: string
}

export interface DynamicWidgetDef {
  widgetType: string
  displayName: string
  icon: string
  defaultLayout: { w: number; h: number; minW?: number; minH?: number }
  defaultState: Record<string, unknown>
  code: string
  createdAt: number
  componentEnv?: 'pure-frontend' | 'local-dependent'
  localServices?: string[]
  crossPlatform?: boolean
  desktopOnly?: boolean
}

export interface CanvasTransform {
  x: number
  y: number
  zoom: number
  [key: string]: unknown
}

export interface MusicTrack {
  id: string
  name: string
  dataUrl: string
  duration: number
  addedAt: number
}

export interface MusicPlaylist {
  widgetId: string
  tracks: MusicTrack[]
  currentTrackIndex: number
  currentTime: number
  volume: number
  isPlaying: boolean
  playMode: 'sequence' | 'loop' | 'shuffle'
}

export interface AppData {
  panels: PanelData[]
  activePanelId: string | null
  settings: AppSettings
  dynamicWidgets: DynamicWidgetDef[]
}

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  accentColor: '#3b82f6',
  backgroundType: 'color',
  // 批次1: 默认色值改为亮色洁净色系（与 index.css :root 对齐）
  backgroundColor: '#f5f5f7',
  backgroundGradient: 'linear-gradient(135deg, #e8e8f0, #dde0f0)',
  backgroundImage: '',
  surfaceColor: '#ffffff',
  surfaceBorderColor: '#f0f0f2',
  surfaceOpacity: 1,
  surfaceBlur: 0,
  textColor: '#1d1d1f',
  textMutedColor: '#86868b',
  fontSize: 14,
}

export const DEFAULT_BEHAVIOR: BehaviorSettings = {
  defaultLayoutMode: 'free',
  defaultGridSize: 20,
  startupPanel: 'last',
  confirmBeforeDelete: true,
  widgetSnapToEdge: false,
  // Phase 6.3: 默认 Bing（用户要求）
  searchEngine: 'bing',
  // Phase 6.1: 内存休眠默认值
  memoryHibernateEnabled: true,
  memoryHibernateAfterMin: 5,
  memoryHibernateThresholdGB: 1.5,
  // Phase 15 批次2 任务2.0：隐私模式默认关闭
  privacyMode: false,
  // Phase 7 批次4 任务7（spec 6.4 节）：新建标签默认打开主页
  newTabDefault: 'home',
  // Phase 7 批次4 任务7（spec 6.4 节）：关闭标签后默认跳到上一个
  closeTabJumpStrategy: 'prev',
}

/**
 * Phase 7 批次4 任务7（spec 6.2.3 节）：无障碍设置默认值。
 * - reduceMotion: 默认关闭（保留完整动效体验）
 * - highContrast: 默认关闭
 * - fontScale: 默认 1.0（100%，与原 fontSize 一致）
 * - compactMode: 默认关闭
 */
export const DEFAULT_ACCESSIBILITY: AccessibilitySettings = {
  reduceMotion: false,
  highContrast: false,
  fontScale: 1.0,
  compactMode: false,
}

export type FocusMode = 'pomodoro' | 'countup' | 'countdown'

export interface FocusSessionV1 {
  id: string
  panelId: string
  focusTimerWidgetId: string
  label?: string
  startedAt: number
  endedAt: number
  durationMs: number
  mode: FocusMode
  createdAt: number
  schemaVersion: 1
}

export interface FocusSessionV2 {
  id: string
  panelId: string
  focusTimerWidgetId: string
  taskId?: string
  taskTitleSnapshot?: string
  label?: string
  startedAt: number
  endedAt: number
  durationMs: number
  mode: FocusMode
  createdAt: number
  schemaVersion: 2
}

export type FocusSession = FocusSessionV2

export type TaskStatus = 'todo' | 'doing' | 'done'
export type TaskPriority = 'low' | 'medium' | 'high'

export interface Task {
  id: string
  panelId: string
  title: string
  status: TaskStatus
  priority: TaskPriority
  dueAt?: number
  createdAt: number
  updatedAt: number
  schemaVersion: 1
}

export const DEFAULT_PANEL_SETTINGS: PanelSettings = {
  layoutMode: 'free',
  gridSize: 20,
}

export interface Habit {
  id: string
  panelId: string
  title: string
  color?: string
  archivedAt?: number
  createdAt: number
  updatedAt: number
  schemaVersion: 1
}

export interface HabitCheckin {
  id: string
  panelId: string
  habitId: string
  date: string
  createdAt: number
  schemaVersion: 1
}

export interface MoodEntry {
  id: string
  panelId: string
  level: 1 | 2 | 3 | 4 | 5
  note?: string
  date: string
  createdAt: number
  schemaVersion: 1
}

export interface DataSourceDefinition {
  storeName: string
  displayName: string
  category: string
  aiReadable: boolean
  aiWritable: boolean
  schema: Record<string, string>
  defaultQuery?: (options?: { offset?: number; limit?: number }) => Promise<{ items: unknown[]; total: number }>
}

export interface CalendarEvent {
  id: string
  panelId: string
  title: string
  startsAt: number
  endsAt?: number
  note?: string
  createdAt: number
  updatedAt: number
  schemaVersion: 1
}

export interface Note {
  id: string
  title: string
  content: string
  tags: string[]
  createdAt: number
  updatedAt: number
  schemaVersion: 1
}

export interface Journal {
  id: string
  date: string
  content: string
  mood?: number
  tags: string[]
  createdAt: number
  updatedAt: number
  schemaVersion: 1
}

export interface QuickNote {
  id: string
  content: string
  tags: string[]
  createdAt: number
  schemaVersion: 1
}

export interface SavingsGoal {
  id: string
  name: string
  target: number
  current: number
  deadline?: number
  createdAt: number
  updatedAt: number
  schemaVersion: 1
}

export interface SavingsTransaction {
  id: string
  goalId: string
  amount: number
  note?: string
  createdAt: number
  schemaVersion: 1
}

export interface AIConversation {
  id: string
  sessionId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  toolCalls?: unknown
  createdAt: number
  schemaVersion: 1
}

export interface AIMemory {
  id: string
  category: string
  key: string
  value: string
  confidence: number
  source: 'user_explicit' | 'ai_inferred' | 'behavior_stat'
  pinned: boolean
  expiresAt?: number
  createdAt: number
  updatedAt: number
  schemaVersion: 1
}

// ========================= Phase 3: 自由画画 + 组件搭线 =========================

export type CanvasMode = 'select' | 'pan' | 'draw' | 'erase' | 'connect' | 'text'

export type DrawingStrokeType = 'freehand' | 'line' | 'arrow' | 'rect' | 'ellipse' | 'text'

export interface DrawingPoint {
  x: number
  y: number
}

export interface DrawingStyle {
  color: string
  width: number
  opacity: number
  fill?: string
}

export interface DrawingStroke {
  id: string
  panelId: string
  type: DrawingStrokeType
  points: DrawingPoint[]
  text?: string
  style: DrawingStyle
  createdAt: number
  updatedAt: number
  schemaVersion: 1
}

export type ConnectionAnchor = 'top' | 'right' | 'bottom' | 'left'
export type ConnectionArrow = 'none' | 'end' | 'both'

/** Phase 1.4: WidgetPort 初步定义 — 为 Phase 3 搭线做准备 */
export interface WidgetPort {
  id: string
  widgetId: string
  direction: ConnectionAnchor
  type: 'in' | 'out' | 'inout'
  dataType?: string
}

export interface WidgetConnection {
  id: string
  panelId: string
  source: { widgetId: string; anchor: ConnectionAnchor }
  target: { widgetId: string; anchor: ConnectionAnchor }
  type: 'visual'
  label?: string
  style: {
    color: string
    width: number
    dashed?: boolean
    arrow?: ConnectionArrow
  }
  createdAt: number
  updatedAt: number
  schemaVersion: 1
}

export const DEFAULT_DRAWING_STYLE: DrawingStyle = {
  color: '#FF6B6B',
  width: 3,
  opacity: 1,
}

// ============ Phase 4A: Learning Components ============

export type QuizCategory = 'algebra' | 'geometry' | 'calculus' | 'trig'

export interface QuizQuestion {
  id: string
  category: QuizCategory
  prompt: string
  latex: string
  answer: string
  answerType: 'exact' | 'numeric'
  tolerance?: number
  explanation?: string
}

export interface QuizSession {
  id: string
  panelId: string
  latexQuizWidgetId: string
  category: QuizCategory
  questionIds: string[]
  userAnswers: Record<string, string>
  gradeResults: Record<string, boolean>
  correctCount: number
  totalCount: number
  startedAt: number
  finishedAt: number
  schemaVersion: 1
}

export interface CalculatorHistoryEntry {
  id: string
  expression: string
  result: string
  timestamp: number
}

export const DEFAULT_CONNECTION_STYLE: WidgetConnection['style'] = {
  color: '#4A90E2',
  width: 2,
  arrow: 'end',
  dashed: false,
}

// ============ Phase 4B: Learning Enhancement ============

export interface VocabDeck {
  id: string
  name: string
  description: string
  wordCount: number
  source: 'builtin' | 'custom'
  createdAt: number
  updatedAt: number
  schemaVersion: 1
}

export interface VocabProgress {
  id: string
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
  schemaVersion: 1
}

export interface SudokuGame {
  id: string
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
  schemaVersion: 1
}

export interface Mistake {
  id: string
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
  schemaVersion: 1
}

export interface PanelTemplate {
  id: string
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
  schemaVersion: 1
}

// ========================= Phase 2: HtmlCanvasWidget + KV Storage =========================

export interface HtmlCanvasWidgetData {
  id: string
  html: string
  title?: string
  createdAt: number
  updatedAt: number
  schemaVersion: 1
}

/** Phase 2：自由 HTML 组件状态类型（与 HtmlCanvasWidgetData 并列，共享 DOM 无隔离） */
export interface FreeHtmlWidgetData {
  id: string
  html: string
  title?: string
  isGlobal?: boolean
  width?: number
  height?: number
  customZIndex?: number
  interactive?: boolean
  createdAt: number
  updatedAt: number
  schemaVersion: 1
}

// Phase 2 浏览器集成：WebviewWidget 状态类型（M5 修复（v7）：与现有 widget state 类型同位置）
export interface WebviewWidgetState {
  url: string                    // 当前 URL
  title: string                  // 页面标题（自动从 webview 获取）
  schemaVersion: 1
}

export interface KvStorageEntry {
  key: string
  value: unknown
  updatedAt: number
  schemaVersion: 1
}

export type { AIAuditLog } from '../utils/dbStores/aiData'

// ========================= Phase 5: 收藏组件 =========================

/** 位置快照（不含 widgetId，因为 widgetId 已是 FavoriteEntry 顶层字段） */
export type PositionSnapshot = Omit<WidgetPosition, 'widgetId'>

/** 收藏组件条目 */
export interface FavoriteEntry {
  id: string
  widgetId: string
  panelId: string
  widgetType: string
  displayName: string
  positionSnapshot: PositionSnapshot
  stateSnapshot: Record<string, unknown>
  createdAt: number
  // Phase 7 批次3 任务4：排序/分组扩展字段（可选，向后兼容）
  sortIndex?: number        // 排序索引（默认按创建时间）
  groupId?: string          // 分组 ID（未分组为 undefined）
  groupName?: string        // 分组名称（冗余，方便显示）
  lastUsedAt?: number       // 最近使用时间戳（用于"最近使用"排序）
  updatedAt?: number        // 更新时间戳（用于降级排序）
}

/**
 * Phase 7 批次3 任务4：收藏分组定义。
 * 分组用于在收藏管理 UI 中聚合 FavoriteEntry，可自定义颜色。
 */
export interface FavoriteGroup {
  id: string
  name: string
  color?: string  // 分组颜色（可选）
  sortIndex: number
  createdAt: number
}
