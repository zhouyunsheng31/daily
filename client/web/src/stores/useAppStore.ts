import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import type { Panel, PanelSettings, WidgetInstance, WidgetPosition, AppSettings, SaveStatus, DynamicWidgetDef, CanvasTransform, DrawingStroke, DrawingStrokeType, DrawingStyle, WidgetConnection, CanvasMode, Bookmark, ConflictInfo, FavoriteEntry, FavoriteGroup } from '../types'
import { DEFAULT_APPEARANCE, DEFAULT_BEHAVIOR, DEFAULT_DRAWING_STYLE } from '../types'
import * as panelsApi from '../api/panels'
import * as widgetsApi from '../api/widgets'
import * as entitiesApi from '../api/entities'
import * as settingsApi from '../api/settings'
import * as exportApi from '../api/export'
import * as favoritesApi from '../api/favorites'
import * as authApi from '../api/auth'
import { withFallback, detectBackend } from '../api/adapter'
import { ApiError } from '../api/client'
import { getViewportCenterCanvas } from '../utils/canvasCoords'
// 保留 IDB 导入作为降级
import {
  savePanel,
  deletePanel as dbDeletePanel,
  saveWidgets,
  savePositions,
  saveActivePanelId,
  saveSettings,
  saveDynamicWidget,
  deleteDynamicWidget as dbDeleteDynamicWidget,
  getAllDynamicWidgets,
  loadAllData,
  saveStroke,
  saveStrokesBatch as _saveStrokesBatch,
  getStrokesByPanel,
  deleteStrokesBatch as dbDeleteStrokesBatch,
  deleteStrokesByPanel as dbDeleteStrokesByPanel,
  saveConnection,
  getConnectionsByPanel,
  deleteConnection,
  deleteConnectionsByWidget as dbDeleteConnectionsByWidget,
  deleteConnectionsByPanel as dbDeleteConnectionsByPanel,
  saveBookmarks,
  getBookmarks,
} from '../utils/db'
import { getAllFavoritesFromIdb, saveFavoriteToIdb, deleteFavoriteFromIdb, deleteFavoritesByPanelIdFromIdb } from '../utils/dbStores/favorites'
// Phase 13.1.4：onboarding 完成状态持久化（kvStorage → entitiesApi + IDB 降级）
import { getKvValue, setKvValue } from '../utils/dbStores/kvStorage'
import { createDebouncedSave } from '../utils/debounce'
import { getWidgetConfig } from '../registry'
import { saveJobQueue, resourceSaveTracker } from '../utils/saveJob'
import { runtimeModeManager } from '../utils/editorLease'
import { getCommandStack } from '../utils/commandStack'
import type { EffectiveRuntimeMode, ResourceSaveState as V2ResourceSaveState } from '../types/v2'
import type { SessionState } from '../types/ai'
// Phase 6.1：内存休眠管理器（spec 第 1/4 节）
import { panelMemoryManager } from '../utils/panelMemoryManager'
import { savePanelState, restorePanelState, clearPanelState } from '../utils/panelStatePersistence'
// Phase S3 缺口 C+D：sync_failed 事件 + 失败 UI 提示
// M-6 修复：通过 syncQueue.ts 暴露的封装函数操作本地 Set，不直接修改模块内 Set
import { addFailedEntry, removeFailedEntry, clearFailedEntries } from '../utils/syncQueue'
import type { SyncFailedEvent } from '../types/syncLogs'
import { retrySyncLog } from '../api/syncLogs'
// S12 新增：WS 初始化需要 getDeviceId（spec S12.3-T11）
import { getDeviceId } from '../utils/deviceAuth'

// ============================================================================
// Phase S3 缺口 D：失败操作 UI 提示数据模型（spec 2.3.3 / 2.4 节）
// 来自服务器的失败 sync_log 记录，由 sync_failed WS 事件实时推送
// 与 syncQueue.ts 的 syncQueueFailedEntries Set 双源合并（本地阈值触发 + 服务器推送）
// ============================================================================
export interface SyncFailedEntry {
  id: string                       // sync_log id（用于调 retry/delete API）
  deviceId: string                // 失败操作发起设备
  operation: string               // create / update / delete
  entityType: string              // panel / widget / entity / favorite / settings
  entityId: string
  lastError?: string              // 失败错误信息（应用层截断 1000 字符）
  retryCount: number
  updatedAt: number
  dismissed?: boolean             // 客户端 UI 状态：用户点击关闭按钮后标记为 true（不删除，避免重复推送）
}

function findPanelIdForWidget(widgetId: string, panelWidgets: Record<string, WidgetInstance[]>): string | null {
  for (const [panelId, widgets] of Object.entries(panelWidgets)) {
    if (widgets.some(w => w.widgetId === widgetId)) {
      return panelId
    }
  }
  return null
}

// Phase 15 批次1 任务1.1：分批并行工具函数（用于串行 API 循环改并行，每批 5 个并发）
function chunks<T>(arr: T[], size: number): T[][] {
  const result: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size))
  }
  return result
}

// v10: lazy reference to useAIStore（避免循环依赖，对称 useAIStore.getUseAppStore）
let _useAIStoreRef: (() => import('./useAIStore').useAIStoreType) | null = null
export function setUseAIStoreRef(ref: () => import('./useAIStore').useAIStoreType) {
  _useAIStoreRef = ref
}
function getUseAIStore(): import('./useAIStore').useAIStoreType {
  if (!_useAIStoreRef) {
    throw new Error('[useAppStore] useAIStore ref not set. Call setUseAIStoreRef first.')
  }
  return _useAIStoreRef()
}

interface AppState {
  panels: Panel[]
  activePanelId: string | null
  panelWidgets: Record<string, WidgetInstance[]>
  panelPositions: Record<string, WidgetPosition[]>
  settings: AppSettings
  saveStatus: SaveStatus
  dynamicWidgets: DynamicWidgetDef[]
  initialized: boolean
  showSettings: boolean
  canvasTransform: CanvasTransform
  lastActiveWidgetId: string | null
  focusSessionsRevision: number
  effectiveRuntimeMode: EffectiveRuntimeMode
  resourceSaveStates: Record<string, V2ResourceSaveState>
  features: {
    aiMemory: boolean
    aiConversationHistory: boolean
    exportAIData: boolean
  }
  /** 游客模式：未登录用户访问 / 路由时加载展示面板（builtin-showcase），
   *  跳过所有需鉴权的初始化（settings/entities/runtimeModeManager/WS/bookmarks/favorites），
   *  画布只读（修改不保存到后端）。登录后用户走正常流程，isGuestMode=false。 */
  isGuestMode: boolean

  // ========== Phase 3: 自由画画 + 组件搭线 ==========
  canvasMode: Record<string, CanvasMode>
  drawingTool: DrawingStrokeType
  drawingStyle: DrawingStyle
  strokes: Record<string, DrawingStroke[]>
  connections: Record<string, WidgetConnection[]>
  hoveredWidgetId: string | null
  strokesLoadStatus: Record<string, 'idle' | 'loading' | 'loaded' | 'error'>
  connectionsLoadStatus: Record<string, 'idle' | 'loading' | 'loaded' | 'error'>
  canvasBookmarks: Record<string, { name: string; x: number; y: number; zoom: number }[]>

  initialize: () => Promise<void>
  addPanel: (name: string, options?: { skipPrimaryAI?: boolean; isCommunity?: boolean; communityApiUrl?: string | null }) => Promise<string>
  addPanelFromTemplate: (templateId: string) => Promise<void>
  deletePanel: (panelId: string, options?: { deleteEntityData?: boolean }) => Promise<void>
  renamePanel: (panelId: string, name: string) => Promise<void>
  reorderPanels: (panels: Panel[]) => Promise<void>
  setActivePanel: (panelId: string) => Promise<void>
  updatePanelSettings: (panelId: string, settings: Partial<Panel['settings']>) => Promise<void>

  addWidget: (widgetType: string, options?: {
    panelId?: string
    position?: { x: number; y: number; w: number; h: number }
    initialState?: Record<string, unknown>
    isPrimary?: boolean
  }) => Promise<void>
  removeWidget: (widgetId: string) => Promise<boolean>
  updateWidgetState: (widgetId: string, partial: Record<string, unknown>) => void
  updateWidgetPosition: (widgetId: string, partial: Partial<WidgetPosition>) => void
  updatePositions: (positions: WidgetPosition[]) => void
  bringToFront: (widgetId: string) => void
  toggleMinimize: (widgetId: string) => void
  toggleLock: (widgetId: string) => void
  changeLayer: (widgetId: string, action: 'moveUp' | 'moveDown' | 'bringToFront' | 'sendToBack') => void
  moveSelectedWidgets: (widgetIds: string[], deltaX: number, deltaY: number) => void
  setLastActiveWidget: (widgetId: string | null) => void
  updateWidgetColorScheme: (widgetId: string, schemeName: string | undefined) => void
  batchUpdateWidgetColorScheme: (widgetIds: string[], schemeName: string | undefined) => void

  updateAppearance: (partial: Partial<AppSettings['appearance']>) => Promise<void>
  updateBehavior: (partial: Partial<AppSettings['behavior']>) => Promise<void>
  // Phase 4: 主页定制（spec 5.8 节）—— 保存 browserHome/canvasHome 到 settings
  updateHomeCustomization: (partial: { browserHome?: Partial<NonNullable<AppSettings['browserHome']>>; canvasHome?: Partial<NonNullable<AppSettings['canvasHome']>> }) => Promise<void>
  setCanvasTransform: (transform: Partial<CanvasTransform>) => void

  addDynamicWidget: (def: DynamicWidgetDef) => Promise<boolean>
  removeDynamicWidget: (widgetType: string) => Promise<void>
  incrementFocusSessionsRevision: () => void
  getEffectiveRuntimeMode: () => EffectiveRuntimeMode
  isReadOnlyMode: () => boolean
  destroy: () => void

  // Phase 3 actions
  setCanvasMode: (panelId: string, mode: CanvasMode) => void
  setDrawingTool: (tool: DrawingStrokeType) => void
  setDrawingStyle: (style: Partial<DrawingStyle>) => void
  setHoveredWidgetId: (widgetId: string | null) => void

  addStroke: (panelId: string, stroke: DrawingStroke) => Promise<void>
  removeStroke: (panelId: string, strokeId: string) => Promise<void>
  removeStrokesBatch: (panelId: string, strokeIds: string[]) => Promise<void>
  clearStrokes: (panelId: string) => Promise<void>
  loadPanelStrokes: (panelId: string) => Promise<void>

  addConnection: (panelId: string, conn: WidgetConnection) => Promise<void>
  removeConnection: (panelId: string, connId: string) => Promise<void>
  loadPanelConnections: (panelId: string) => Promise<void>

  // Undo/Redo wrappers（按面板）
  undo: () => Promise<boolean>
  redo: () => Promise<boolean>
  canUndo: () => boolean
  canRedo: () => boolean

  // Coordinate Teleport
  addCanvasBookmark: (panelId: string, bookmark: { name: string; x: number; y: number; zoom: number }) => void
  removeCanvasBookmark: (panelId: string, index: number) => void
  teleportTo: (x: number, y: number, zoom?: number) => void

  // ========== View Toggles (session-level, not persisted) ==========
  hideConnections: boolean
  toggleHideConnections: () => void
  autoLayoutPanel: () => void

  // ========== v10: 主AI助手（Phase 4: 移除 desktop appMode，保留主AI助手相关） ==========
  primaryAISessionId: string | null
  isInitializing: boolean
  ensurePrimarySession: (panelId: string) => Promise<string>
  getPrimaryAIWidgetIdOfPanel: (panelId: string) => string | null
  // ========== Phase 3：AI 形态切换（浮球 / 底部任务栏，决策日志 21/40） ==========
  aiMode: 'orb' | 'taskbar'
  setAiMode: (mode: 'orb' | 'taskbar') => void

  // ========== Phase 2: 侧边栏 + 标签页 ↔ 网页组件双向转换 ==========
  sidebarCollapsed: boolean                                                    // 侧边栏是否折叠，默认 false（向后兼容字段，由 sidebarWidth <= 48 派生）
  toggleSidebar: () => void                                                    // 切换折叠状态（实际切换 sidebarWidth 240 ↔ 48）
  // 批次1: 可拖拽布局尺寸（持久化到 localStorage ld_layout_sizes）
  sidebarWidth: number                                                         // 侧边栏宽度（默认 240，折叠态 48）
  topbarOmniboxWidth: number                                                   // 顶栏 Omnibox 宽度（默认 360）
  setSidebarWidth: (w: number) => void                                         // 设置侧边栏宽度
  setTopbarOmniboxWidth: (w: number) => void                                   // 设置顶栏 Omnibox 宽度
  // 批次4: Sidebar 模式切换（canvas 画布面板 / ai-assistant AI 助手），会话级状态不持久化
  sidebarMode: 'canvas' | 'ai-assistant'                                       // 默认 'canvas'
  setSidebarMode: (mode: 'canvas' | 'ai-assistant') => void                    // 切换 Sidebar 模式
  closeOtherPanels: (keepPanelId: string) => Promise<void>                     // 关闭其他所有面板

  // ========== Phase 3: WS 变更广播触发的局部刷新 ==========
  refreshPanels: () => Promise<void>
  refreshWidgets: () => Promise<void>
  refreshSettings: () => Promise<void>
  refreshDynamicWidgets: (options?: { desktop?: boolean }) => Promise<void>
  // S12 新增：WS change 事件处理（spec S12.3-T11，替代桌面端 useAIStore.handleServerChange）
  handleServerChange: (changeType: string, data: unknown, sourceDeviceId?: string) => Promise<void>

  // ========== Phase 4: 架构基础改造（spec 任务 1） ==========

  // 书签（spec 5.3 节浏览器主页）
  bookmarks: Bookmark[]
  addBookmark: (url: string, title: string) => Promise<void>
  removeBookmark: (id: string) => Promise<void>
  toggleBookmarkHome: (id: string) => Promise<void>

  // 冲突管理（spec 2.5 节乐观锁冲突）
  conflicts: Record<string, ConflictInfo>
  addConflict: (widgetId: string, info: Omit<ConflictInfo, 'widgetId' | 'timestamp'>) => void
  resolveConflict: (widgetId: string, action: 'keep-local' | 'keep-remote' | 'merge', mergedState?: Record<string, unknown>) => Promise<void>
  clearConflict: (widgetId: string) => void

  // Widget 版本追踪（用于乐观锁冲突检测）
  widgetVersions: Record<string, number>

  // ========== Phase 5: 收藏组件 ==========
  favorites: FavoriteEntry[]
  addFavorite: (widgetId: string) => Promise<void>
  removeFavorite: (favoriteId: string) => Promise<void>
  removeFavoriteByWidgetId: (widgetId: string) => Promise<void>
  removeFavoritesByPanelId: (panelId: string) => Promise<void>
  isFavorited: (widgetId: string) => boolean
  getFavoriteByWidgetId: (widgetId: string) => FavoriteEntry | undefined
  refreshFavorites: () => Promise<void>

  // ========== Phase 7 批次3 任务4：收藏组件管理（排序/分组/搜索）数据层 ==========
  favoriteGroups: FavoriteGroup[]
  favoriteSortBy: 'manual' | 'name' | 'createdAt' | 'lastUsedAt'
  favoriteSearchQuery: string
  setFavoriteSortBy: (sortBy: 'manual' | 'name' | 'createdAt' | 'lastUsedAt') => void
  setFavoriteSearchQuery: (query: string) => void
  refreshFavoriteGroups: () => Promise<void>
  createFavoriteGroup: (name: string, color?: string) => Promise<FavoriteGroup | null>
  updateFavoriteGroup: (id: string, patch: Partial<Pick<FavoriteGroup, 'name' | 'color' | 'sortIndex'>>) => Promise<void>
  deleteFavoriteGroup: (id: string, migrateTo?: string) => Promise<void>
  updateFavoriteSort: (id: string, sortIndex: number) => Promise<void>
  updateFavoriteGroupAssignment: (id: string, groupId?: string, groupName?: string) => Promise<void>

  // ========== Phase 7 批次3 任务6：组件搜索浮层状态（迁移 App.tsx Ctrl+F 本地 state） ==========
  showWidgetSearch: boolean
  setShowWidgetSearch: (open: boolean) => void

  // ========== Phase S3 缺口 C+D：sync_failed 监听 + 失败 UI 提示（spec 2.3.3 / 2.4 节） ==========
  // 来自服务器的失败 sync_log 记录，由 sync_failed WS 事件实时推送
  // 与 syncQueue.ts 的 syncQueueFailedEntries Set 双源合并（本地阈值触发 + 服务器推送）
  syncFailedEntries: SyncFailedEntry[]
  addSyncFailedEntry: (event: SyncFailedEvent) => void
  clearSyncFailedEntry: (id: string) => void
  clearAllSyncFailedEntries: () => void
  // dismiss 单个（用户点击关闭按钮，标记 dismissed=true 但不删除，避免重复推送）
  dismissSyncFailedEntry: (id: string) => void
  // retry 单个（调 api/syncLogs.retrySyncLog，成功后从集合移除）
  retrySyncFailedEntry: (id: string) => Promise<void>

  // ========== Phase 13.1.4：首次启动 Onboarding 门控状态 ==========
  // hasCompletedOnboarding：是否已完成 onboarding（默认 false，initialize 时从 IDB 加载）
  // onboardingChecked：onboarding 状态是否已从 IDB 加载完成（避免渲染期闪烁）
  // onboardingLoadFailed：onboarding 状态加载是否失败（双重故障时为 true，主应用应显示非阻塞警告）
  // setHasCompletedOnboarding：更新状态并持久化到 kvStorage（key: onboarding-completed）
  hasCompletedOnboarding: boolean
  onboardingChecked: boolean
  onboardingLoadFailed: boolean
  setHasCompletedOnboarding: (v: boolean) => Promise<void>
}

const debouncedPositionSave = createDebouncedSave(
  (panelId: string, positions: WidgetPosition[]) => {
    // 游客模式：画布修改不保存到后端/IDB（只读模式，视觉可拖动但刷新后恢复）
    if (useAppStore.getState().isGuestMode) return
    withFallback(
      () => widgetsApi.batchUpdatePositions(positions.map(p => ({
        id: p.widgetId,
        x: p.x,
        y: p.y,
        width: p.w,
        height: p.h,
        zIndex: p.zIndex,
      }))),
      () => savePositions(panelId, positions),
    ).catch((err) => {
      console.error('[SaveJob] Position save failed:', err)
    })
    for (const p of positions) {
      resourceSaveTracker.markSaving(p.widgetId, `pos-${p.widgetId}-${Date.now()}`)
    }
  },
  500
)

const debouncedWidgetStateSave = createDebouncedSave(
  (panelId: string, widgets: WidgetInstance[]) => {
    // 游客模式：画布修改不保存到后端/IDB
    if (useAppStore.getState().isGuestMode) return
    withFallback(
      () => widgetsApi.batchUpdateStates(widgets.map(w => ({
        id: w.widgetId,
        state: w.state,
        minimized: w.minimized,
        locked: w.locked,
        colorScheme: w.colorScheme ?? null,
      }))),
      () => saveWidgets(panelId, widgets),
    ).catch((err) => {
      console.error('[SaveJob] Widget state save failed:', err)
    })
    for (const w of widgets) {
      resourceSaveTracker.markSaving(w.widgetId, `ws-${w.widgetId}-${Date.now()}`)
    }
  },
  1000
)

const debouncedCanvasTransformSave = createDebouncedSave(
  (_panelId: string, panel: Panel) => {
    // 游客模式：canvasTransform 不持久化到后端/IDB
    if (useAppStore.getState().isGuestMode) return
    withFallback(
      async () => { await panelsApi.updatePanel(panel.id, { name: panel.name, settings: panel.settings as Record<string, unknown>, canvasTransform: panel.canvasTransform as Record<string, unknown> | undefined }) },
      () => savePanel(panel),
    )
  },
  500
)

// bookmarks 防抖持久化（500ms 合并高频更新）
const debouncedBookmarksSave = createDebouncedSave(
  (bookmarks: Bookmark[]) => {
    // 游客模式：不持久化 bookmarks（游客模式不加载 bookmarks，防御性 guard）
    if (useAppStore.getState().isGuestMode) return
    saveBookmarks(bookmarks).catch((err) => {
      console.error('[Persist] bookmarks save failed:', err)
    })
  },
  500
)

function setSaved(): Partial<AppState> {
  return { saveStatus: { status: 'saved', lastSavedAt: Date.now() } }
}

// 批次1: 布局尺寸持久化（key: ld_layout_sizes）
const LAYOUT_SIZES_STORAGE_KEY = 'ld_layout_sizes'
const DEFAULT_SIDEBAR_WIDTH = 240
const DEFAULT_TOPBAR_OMNIBOX_WIDTH = 360
const COLLAPSED_SIDEBAR_WIDTH = 48

interface LayoutSizes {
  sidebarWidth: number
  topbarOmniboxWidth: number
}

function loadLayoutSizes(): LayoutSizes {
  try {
    const raw = localStorage.getItem(LAYOUT_SIZES_STORAGE_KEY)
    if (!raw) return { sidebarWidth: DEFAULT_SIDEBAR_WIDTH, topbarOmniboxWidth: DEFAULT_TOPBAR_OMNIBOX_WIDTH }
    const parsed = JSON.parse(raw) as Partial<LayoutSizes>
    return {
      sidebarWidth: typeof parsed.sidebarWidth === 'number' && parsed.sidebarWidth > 0
        ? parsed.sidebarWidth
        : DEFAULT_SIDEBAR_WIDTH,
      topbarOmniboxWidth: typeof parsed.topbarOmniboxWidth === 'number' && parsed.topbarOmniboxWidth > 0
        ? parsed.topbarOmniboxWidth
        : DEFAULT_TOPBAR_OMNIBOX_WIDTH,
    }
  } catch {
    return { sidebarWidth: DEFAULT_SIDEBAR_WIDTH, topbarOmniboxWidth: DEFAULT_TOPBAR_OMNIBOX_WIDTH }
  }
}

function saveLayoutSizes(sizes: LayoutSizes): void {
  try {
    localStorage.setItem(LAYOUT_SIZES_STORAGE_KEY, JSON.stringify(sizes))
  } catch { /* ignore quota / privacy errors */ }
}

// Phase 7 批次3 任务4：收藏分组本地降级持久化（key: ld_favorite_groups）
// 服务器未升级时收藏分组存本地，服务器升级后由 refreshFavoriteGroups 拉取覆盖
const FAVORITE_GROUPS_STORAGE_KEY = 'ld_favorite_groups'

function loadFavoriteGroupsFromStorage(): FavoriteGroup[] {
  try {
    const raw = localStorage.getItem(FAVORITE_GROUPS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as FavoriteGroup[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveFavoriteGroupsToStorage(groups: FavoriteGroup[]): void {
  try {
    localStorage.setItem(FAVORITE_GROUPS_STORAGE_KEY, JSON.stringify(groups))
  } catch { /* ignore quota / privacy errors */ }
}

function persistCanvasTransform(panelId: string, transform: CanvasTransform, panels: Panel[]) {
  const panel = panels.find(p => p.id === panelId)
  if (!panel) return
  const updated = { ...panel, canvasTransform: transform }
  debouncedCanvasTransformSave.call(panelId, updated)
}

let _unsubModeChange: (() => void) | null = null
let _unsubSaveStateChange: (() => void) | null = null
let sessionStorageRafRef: number | null = null

// bookmarks 持久化 subscribe 跟踪
let _unsubPersistCollections: (() => void) | null = null
let _prevBookmarks: Bookmark[] | null = null

// Phase 6.1：panelMemoryManager 状态变更订阅（用于 deep-hibernated 时清空 panelWidgets/panelPositions）
let _unsubPanelMemoryStateChange: (() => void) | null = null

saveJobQueue.onResult((_jobId, result) => {
  if (result.ok) {
    // Will be marked saved when the debounced save completes
  }
})

export const useAppStore = create<AppState>((set, get) => ({
  panels: [],
  activePanelId: null,
  panelWidgets: {},
  panelPositions: {},
  settings: { appearance: DEFAULT_APPEARANCE, behavior: DEFAULT_BEHAVIOR },
  saveStatus: { status: 'saved', lastSavedAt: null },
  dynamicWidgets: [],
  initialized: false,
  showSettings: false,
  canvasTransform: { x: 0, y: 0, zoom: 1 },
  lastActiveWidgetId: null,
  focusSessionsRevision: 0,
  effectiveRuntimeMode: 'normal_editable' as EffectiveRuntimeMode,
  resourceSaveStates: {},
  features: {
    aiMemory: true,
    aiConversationHistory: true,
    exportAIData: false,
  },
  isGuestMode: false,

  // Phase 2: 侧边栏折叠状态（向后兼容字段，由 sidebarWidth <= 48 派生）
  // 批次1: sidebarWidth/topbarOmniboxWidth 持久化到 localStorage（key: ld_layout_sizes）
  sidebarCollapsed: loadLayoutSizes().sidebarWidth <= COLLAPSED_SIDEBAR_WIDTH,
  sidebarWidth: loadLayoutSizes().sidebarWidth,
  topbarOmniboxWidth: loadLayoutSizes().topbarOmniboxWidth,
  // 批次4: Sidebar 模式默认 'canvas'，会话级状态不持久化
  sidebarMode: 'canvas',

  // Phase 3 初始 state
  canvasMode: {},
  drawingTool: 'freehand',
  drawingStyle: { ...DEFAULT_DRAWING_STYLE },
  strokes: {},
  connections: {},
  hoveredWidgetId: null,
  strokesLoadStatus: {},
  connectionsLoadStatus: {},
  canvasBookmarks: {},

  // View Toggles 初始 state
  hideConnections: false,

  // v10: 主AI助手 初始 state（Phase 4: 移除 appMode/needsPrimaryAIMigration/migratePrimaryAI）
  primaryAISessionId: null,
  isInitializing: false,
  getPrimaryAIWidgetIdOfPanel: (panelId) => {
    const widgets = get().panelWidgets[panelId] ?? []
    return widgets.find(w => w.widgetType === 'aiAssistant' && w.isPrimary)?.widgetId ?? null
  },
  // Phase 3：AI 形态切换初始 state（浮球 / 底部任务栏）
  // 持久化到 localStorage，默认 'orb'
  aiMode: (() => {
    if (typeof window === 'undefined') return 'orb' as const
    try {
      const saved = window.localStorage.getItem('daily-ai-mode')
      return saved === 'taskbar' ? 'taskbar' : 'orb'
    } catch {
      return 'orb' as const
    }
  })(),
  setAiMode: (mode) => {
    set({ aiMode: mode })
    try {
      window.localStorage.setItem('daily-ai-mode', mode)
    } catch {
      // ignore localStorage errors
    }
  },
  ensurePrimarySession: async (panelId: string) => {
    const useAIStore = getUseAIStore()
    const aiState = useAIStore.getState()

    // 1. 检查内存中是否已有绑定该 panelId 的会话
    const existingInMemory = Object.values(aiState.sessions).find(s => s.boundPanelId === panelId)
    if (existingInMemory) {
      set({ primaryAISessionId: existingInMemory.sessionId })
      try { localStorage.setItem('primaryAISessionId', existingInMemory.sessionId) } catch { /* ignore */ }
      return existingInMemory.sessionId
    }

    // 1b. M2 修复：从 sessionList 查找（刷新后 sessions 为空但 sessionList 有元数据）
    const existingMeta = aiState.sessionList.find(m => m.boundPanelId === panelId)
    if (existingMeta) {
      // 重建 SessionState 到 sessions map
      const restoredSession: SessionState = {
        sessionId: existingMeta.sessionId,
        messages: [],
        createdAt: existingMeta.createdAt,
        updatedAt: existingMeta.updatedAt,
        model: existingMeta.modelId,
        modelId: existingMeta.modelId,
        status: 'idle',
        authorizedPrivateStores: [],
        hasConfirmedFirstSend: false,
        confirmedDataCategories: new Set(),
        confirmedModel: null,
        role: '生活助手',
        title: existingMeta.title,
        boundPanelId: existingMeta.boundPanelId,
        apiConfigId: existingMeta.apiConfigId,
      }
      useAIStore.setState(state => ({
        sessions: { ...state.sessions, [restoredSession.sessionId]: restoredSession },
        activeSessionId: state.activeSessionId ?? restoredSession.sessionId,
      }))
      set({ primaryAISessionId: restoredSession.sessionId })
      try { localStorage.setItem('primaryAISessionId', restoredSession.sessionId) } catch { /* ignore */ }
      // 异步加载历史消息
      void useAIStore.getState().loadSessionHistory(restoredSession.sessionId)
      return restoredSession.sessionId
    }

    // 2. 当前 primaryAISessionId 已存在且在 sessions 中（向后兼容）
    const current = get().primaryAISessionId
    if (current && aiState.sessions[current]) {
      const currentSession = aiState.sessions[current]
      // M1 修复：仅当 current session 未绑定或已绑定到当前 panelId 时才复用
      if (currentSession.boundPanelId === panelId || currentSession.boundPanelId === null) {
        useAIStore.getState().bindPanelToSession(current, panelId)
        return current
      }
      // current 已绑定到其他面板，跳到 step 4 创建新 session
    }

    // 3. 从 localStorage 恢复（M1 修复第二轮：同样检查 boundPanelId，避免 fall through 绕过隔离）
    const saved = localStorage.getItem('primaryAISessionId')
    if (saved && aiState.sessions[saved]) {
      const savedSession = aiState.sessions[saved]
      if (savedSession.boundPanelId === panelId || savedSession.boundPanelId === null) {
        set({ primaryAISessionId: saved })
        useAIStore.getState().bindPanelToSession(saved, panelId)
        return saved
      }
      // saved 已绑定到其他面板，跳到 step 4 创建新 session
    }

    // 4. 创建新 session，绑定到 panelId
    const prevActiveSessionId = aiState.activeSessionId
    const newSessionId = useAIStore.getState().createSession({
      boundPanelId: panelId,
      title: `面板会话`,
    })
    if (prevActiveSessionId) {
      useAIStore.setState({ activeSessionId: prevActiveSessionId })
    }
    set({ primaryAISessionId: newSessionId })
    localStorage.setItem('primaryAISessionId', newSessionId)
    return newSessionId
  },

  initialize: async () => {
    // Phase 15 批次1 任务1.1 对抗审查修复：isInitializing 由 App.tsx 单一管理
    // （App.tsx 同时 await useAppStore.initialize() + useAIStore.initialize()，
    // 两者都完成后才设 isInitializing=false。此处若提前设 false 会导致 AI 初始化
    // 未完成时主界面就渲染）。保留 set({ isInitializing: true }) 仅作为防御性备份。

    // Phase 14 B3：onboarding 检查提前并行启动（不依赖 detectBackend），
    // 让 onboardingChecked=true 尽快达成，避免 detectBackend 重试期间空白加载屏
    //
    // 容错修复（双重故障链路）：当 IDB 损坏导致 getKvValue 抛错时，原实现只设
    // onboardingChecked=true 但 hasCompletedOnboarding 保持 false，会渲染 Onboarding
    // 组件；若此时 server 也启动失败，Onboarding 内的 AI 配置等步骤无法完成，用户卡死。
    // 现策略：IDB 加载失败时默认 hasCompletedOnboarding=true（跳过引导直接进主应用），
    // 同时标记 onboardingLoadFailed=true，让 App.tsx 显示非阻塞警告。
    const onboardingPromise = (async () => {
      try {
        const v = await getKvValue('onboarding-completed')
        // Phase 15 批次1 任务1.1：不在 try 块提前设置 onboardingChecked=true，
        // 等 initialize 完成后统一设置，避免主界面提前渲染导致 BrowserHome autoFocus 卡顿
        set({ hasCompletedOnboarding: v === true })
      } catch (err) {
        console.error('[useAppStore] load onboarding state failed, defaulting to completed to avoid deadlock:', err)
        // catch 块保留 onboardingChecked=true：IDB 损坏容错场景必须立即解锁，否则永久卡死
        set({ hasCompletedOnboarding: true, onboardingChecked: true, onboardingLoadFailed: true })
      }
    })()

    try {
      const backend = await detectBackend()

      if (backend === 'api') {
        // ===== 游客模式检测：先尝试 getAllPanels，401 时加载展示面板（builtin-showcase）=====
        let panelsData: panelsApi.PanelDTO[]
        try {
          panelsData = await panelsApi.getAllPanels()
        } catch (err) {
          if (err instanceof ApiError && err.status === 401) {
            // 未登录 → 游客模式：先申请游客 JWT（写入 cookie，供 WS /api/panels 使用）
            try {
              await authApi.guestLogin(getDeviceId())
              console.log('[useAppStore] Guest JWT acquired for WS connection')
            } catch (guestErr) {
              // 游客 JWT 申请失败不阻塞展示面板加载（仅 WS 不可用）
              console.warn('[useAppStore] guestLogin failed, continuing without guest JWT:', guestErr)
            }
            // 加载展示面板
            const demo = await panelsApi.getDemoPanel()
            panelsData = [demo.panel]
            const guestWidgets = demo.widgets
            const guestPanelWidgets: Record<string, WidgetInstance[]> = {
              [demo.panel.id]: guestWidgets.map(w => ({
                widgetId: w.id,
                widgetType: w.type,
                state: w.state,
                minimized: w.minimized,
                locked: w.locked,
                colorScheme: w.colorScheme ?? undefined,
                isPrimary: w.isPrimary ?? false,
              })),
            }
            const guestPanelPositions: Record<string, WidgetPosition[]> = {
              [demo.panel.id]: guestWidgets.map(w => ({
                widgetId: w.id,
                x: w.x,
                y: w.y,
                w: w.width,
                h: w.height,
                zIndex: w.zIndex,
              })),
            }
            const guestWidgetVersions: Record<string, number> = {}
            for (const w of guestWidgets) guestWidgetVersions[w.id] = w.version
            const guestCanvasTransform = (demo.panel.canvasTransform as CanvasTransform | undefined) ?? { x: 0, y: 0, zoom: 1 }
            set({
              panels: [{
                id: demo.panel.id,
                name: demo.panel.name,
                order: demo.panel.sortOrder,
                settings: demo.panel.settings as PanelSettings,
                canvasTransform: guestCanvasTransform,
                ownerId: demo.panel.ownerId ?? null,
                isCommunity: demo.panel.isCommunity ?? false,
                communityApiUrl: demo.panel.communityApiUrl ?? null,
              }],
              activePanelId: demo.panel.id,
              panelWidgets: guestPanelWidgets,
              panelPositions: guestPanelPositions,
              widgetVersions: guestWidgetVersions,
              isGuestMode: true,
              initialized: true,
              saveStatus: { status: 'saved', lastSavedAt: Date.now() },
              canvasTransform: guestCanvasTransform,
              hasCompletedOnboarding: true,
              onboardingChecked: true,
            })
            console.log('[useAppStore] Guest mode: loaded demo panel', demo.panel.id, 'with', guestWidgets.length, 'widgets')
            // 游客模式提前结束 initialize：跳过所有需鉴权的后续初始化
            // （settings/entities/runtimeModeManager/WS/bookmarks/favorites/panelMemoryManager）
            // onboardingChecked 已在上方 set，onboardingPromise 为 fire-and-forget（内部 try/catch 安全）
            // panelsData 仅用于消除"未使用"告警（实际在 return 前已通过 set 注入 store）
            void panelsData
            return
          } else {
            throw err
          }
        }

        // 游客模式检测：getAllPanels 成功但用户未登录
        // 后端 /api/panels 对未登录返回 200 + community panels（不返回 401），
        // 需主动检查 useUserStore.isAuthenticated 判断是否游客
        const { useUserStore } = await import('./useUserStore')
        const userState = useUserStore.getState()
        if (!userState.isAuthenticated && !userState.isSinglePasswordMode) {
          // 游客模式：先申请游客 JWT（写入 cookie，供 WS 使用）
          try {
            await authApi.guestLogin(getDeviceId())
            console.log('[useAppStore] Guest JWT acquired for WS connection (community panels path)')
          } catch (guestErr) {
            console.warn('[useAppStore] guestLogin failed, continuing without guest JWT:', guestErr)
          }
          // 游客模式：用 getAllPanels 返回的 panel（含 demo panel）渲染，跳过所有鉴权初始化
          const guestPanels = panelsData.sort((a, b) => a.sortOrder - b.sortOrder)
          const guestPanelWidgets: Record<string, WidgetInstance[]> = {}
          const guestPanelPositions: Record<string, WidgetPosition[]> = {}
          const guestWidgetVersions: Record<string, number> = {}
          await Promise.all(guestPanels.map(async (panel) => {
            const ws = await widgetsApi.getPanelWidgets(panel.id)
            guestPanelWidgets[panel.id] = ws.map(w => ({
              widgetId: w.id,
              widgetType: w.type,
              state: w.state,
              minimized: w.minimized,
              locked: w.locked,
              colorScheme: w.colorScheme ?? undefined,
              isPrimary: w.isPrimary ?? false,
            }))
            guestPanelPositions[panel.id] = ws.map(w => ({
              widgetId: w.id,
              x: w.x,
              y: w.y,
              w: w.width,
              h: w.height,
              zIndex: w.zIndex,
            }))
            for (const w of ws) guestWidgetVersions[w.id] = w.version
          }))
          const guestCanvasTransform = (guestPanels[0]?.canvasTransform as CanvasTransform | undefined) ?? { x: 0, y: 0, zoom: 1 }
          set({
            panels: guestPanels.map(p => ({
              id: p.id,
              name: p.name,
              order: p.sortOrder,
              settings: p.settings as PanelSettings,
              canvasTransform: guestCanvasTransform,
              ownerId: p.ownerId ?? null,
              isCommunity: p.isCommunity ?? false,
              communityApiUrl: p.communityApiUrl ?? null,
            })),
            activePanelId: guestPanels[0]?.id ?? null,
            panelWidgets: guestPanelWidgets,
            panelPositions: guestPanelPositions,
            widgetVersions: guestWidgetVersions,
            isGuestMode: true,
            initialized: true,
            saveStatus: { status: 'saved', lastSavedAt: Date.now() },
            canvasTransform: guestCanvasTransform,
            hasCompletedOnboarding: true,
            onboardingChecked: true,
          })
          console.log('[useAppStore] Guest mode: user not authenticated, loaded', guestPanels.length, 'panels as read-only')
          return
        }

        let [activeId, settingsData] = await Promise.all([
          panelsApi.getActivePanelId(),
          settingsApi.getSettings(),
        ])

        // 自动迁移：SQLite 为空但 IDB 有数据时，自动导入
        if (panelsData.length === 0) {
          try {
            // 临时切换到 IDB 模式读取数据（绕过 API 层，因为 API 返回空数据）
            const { setBackendToIdb } = await import('../api/adapter')
            setBackendToIdb()
            const idbData = await loadAllData()

            if (idbData.panels.length > 0) {
              console.log(`[Storage] SQLite is empty but IDB has ${idbData.panels.length} panels, auto-migrating...`)
              // 用 IDB 模式导出完整数据
              const { exportAllData: idbExport } = await import('../utils/db')
              const blob = await idbExport()
              const jsonData = JSON.parse(await blob.text())

              // 切回 API 模式，通过 API 导入到 SQLite
              const { detectBackend: redetect } = await import('../api/adapter')
              await redetect() // 重新检测，切回 API 模式
              const result = await exportApi.importFromIdb(jsonData)
              console.log('[Storage] Auto-migration result:', result)

              // 重新从 API 加载
              ;[panelsData, activeId, settingsData] = await Promise.all([
                panelsApi.getAllPanels(),
                panelsApi.getActivePanelId(),
                settingsApi.getSettings(),
              ])
            } else {
              // IDB 也没数据，切回 API 模式
              const { detectBackend: redetect } = await import('../api/adapter')
              await redetect()
            }
          } catch (err) {
            console.error('[Storage] Auto-migration failed:', err)
            // 确保切回 API 模式
            try {
              const { detectBackend: redetect } = await import('../api/adapter')
              await redetect()
            } catch { /* ignore */ }
          }
        }

        const panels = panelsData.sort((a, b) => a.sortOrder - b.sortOrder)

        const panelWidgets: Record<string, WidgetInstance[]> = {}
        const panelPositions: Record<string, WidgetPosition[]> = {}
        const widgetVersions: Record<string, number> = {}
        // Phase 15 批次1 任务1.1：串行 API 循环改为分批并行（每批 5 个并发），
        // N 个面板 = ceil(N/5) × RTT，10 个面板从 2-5s 降到 ~0.5s
        await Promise.all(chunks(panels, 5).map(async (batch) => {
          await Promise.all(batch.map(async (panel) => {
            const ws = await widgetsApi.getPanelWidgets(panel.id)
            panelWidgets[panel.id] = ws.map(w => ({
              widgetId: w.id,
              widgetType: w.type,
              state: w.state,
              minimized: w.minimized,
              locked: w.locked,
              colorScheme: w.colorScheme ?? undefined,
              isPrimary: w.isPrimary ?? false,  // v10: 新增 isPrimary 字段（WidgetDTO 已支持）
            }))
            panelPositions[panel.id] = ws.map(w => ({
              widgetId: w.id,
              x: w.x,
              y: w.y,
              w: w.width,
              h: w.height,
              zIndex: w.zIndex,
            }))
            // Phase 4: 记录 widget 版本号（用于乐观锁冲突检测）
            for (const w of ws) {
              widgetVersions[w.id] = w.version
            }
          }))
        }))

        const activePanel = panels.find(p => p.id === activeId)
        // 优先从 sessionStorage 恢复 canvasTransform（同步，刷新后仍存在）
        let canvasTransform = activePanel?.canvasTransform ?? { x: 0, y: 0, zoom: 1 }
        if (activeId) {
          try {
            const saved = sessionStorage.getItem(`canvasTransform_${activeId}`)
            if (saved) {
              const parsed = JSON.parse(saved)
              if (parsed && typeof parsed.x === 'number' && typeof parsed.y === 'number' && typeof parsed.zoom === 'number') {
                canvasTransform = parsed as CanvasTransform
              }
            }
          } catch { /* ignore */ }
        }

        // 加载 strokes 和 connections 作为 entities
        const strokesResult = await entitiesApi.queryEntities({ type: 'drawingStroke' })
        const connectionsResult = await entitiesApi.queryEntities({ type: 'widgetConnection' })

        // 修复问题1：验证 activeId 指向实际存在的面板，否则回退到第一个面板
        const validActiveId = (activeId && panels.find(p => p.id === activeId)) ? activeId : (panels[0]?.id ?? null)

        set({
          panels: panels.map(p => ({
            id: p.id,
            name: p.name,
            order: p.sortOrder,
            settings: p.settings as PanelSettings,
            // 活跃面板使用 sessionStorage 恢复的值，确保与顶层 canvasTransform 一致
            canvasTransform: (p.id === validActiveId ? canvasTransform : p.canvasTransform) as CanvasTransform | undefined,
            ownerId: p.ownerId ?? null,
            isCommunity: p.isCommunity ?? false,
            communityApiUrl: p.communityApiUrl ?? null,
          })),
          activePanelId: validActiveId,
          panelWidgets,
          panelPositions,
          widgetVersions,  // Phase 4: 版本号追踪
          settings: {
            appearance: { ...DEFAULT_APPEARANCE, ...(settingsData.appearance as AppSettings['appearance'] || {}) },
            behavior: { ...DEFAULT_BEHAVIOR, ...(settingsData.behavior as AppSettings['behavior'] || {}) },
          },
          initialized: true,
          saveStatus: { status: 'saved', lastSavedAt: Date.now() },
          canvasTransform: canvasTransform as CanvasTransform,
        })

        runtimeModeManager.start()
        _unsubModeChange = runtimeModeManager.onModeChange((state) => {
          set({ effectiveRuntimeMode: state.mode })
        })
        _unsubSaveStateChange = resourceSaveTracker.onStateChange((resourceId, state) => {
          set(s => ({ resourceSaveStates: { ...s.resourceSaveStates, [resourceId]: state } }))
        })

        // Phase 3: 从 entities 恢复 strokes 和 connections
        const currentActiveId = activeId ?? panels[0]?.id
        if (currentActiveId) {
          try {
            const panelStrokes = strokesResult.items
              .filter(e => e.panelId === currentActiveId)
              .map(e => e.data as unknown as DrawingStroke)
            const panelConns = connectionsResult.items
              .filter(e => e.panelId === currentActiveId)
              .map(e => e.data as unknown as WidgetConnection)
            set(state => ({
              strokes: { ...state.strokes, [currentActiveId]: panelStrokes },
              connections: { ...state.connections, [currentActiveId]: panelConns },
              strokesLoadStatus: { ...state.strokesLoadStatus, [currentActiveId]: 'loaded' },
              connectionsLoadStatus: { ...state.connectionsLoadStatus, [currentActiveId]: 'loaded' },
            }))
            getCommandStack(currentActiveId)
          } catch (e) {
            console.error('[useAppStore] Failed to load Phase 3 data from API:', e)
            set(state => ({
              strokes: { ...state.strokes, [currentActiveId]: [] },
              connections: { ...state.connections, [currentActiveId]: [] },
              strokesLoadStatus: { ...state.strokesLoadStatus, [currentActiveId]: 'error' },
              connectionsLoadStatus: { ...state.connectionsLoadStatus, [currentActiveId]: 'error' },
            }))
          }
        }

        // 初始化后校验：确保 canvasTransform 与 sessionStorage 一致
        // 防止任何异步操作在初始化期间覆盖了 sessionStorage 恢复的值
        const finalActiveId = get().activePanelId
        if (finalActiveId) {
          try {
            const saved = sessionStorage.getItem(`canvasTransform_${finalActiveId}`)
            if (saved) {
              const parsed = JSON.parse(saved)
              if (parsed && typeof parsed.x === 'number' && typeof parsed.y === 'number' && typeof parsed.zoom === 'number') {
                const current = get().canvasTransform
                if (current.x !== parsed.x || current.y !== parsed.y || current.zoom !== parsed.zoom) {
                  set({ canvasTransform: parsed as CanvasTransform })
                }
              }
            }
          } catch { /* ignore */ }
        }
      } else {
        // 降级到 IDB
        console.warn('[Storage] API unavailable, using IndexedDB fallback')
        const data = await loadAllData()
        const panels = data.panels.map(pd => pd.panel).sort((a, b) => a.order - b.order)
        const panelWidgets: Record<string, WidgetInstance[]> = {}
        const panelPositions: Record<string, WidgetPosition[]> = {}
        for (const pd of data.panels) {
          // v10: IDB 模式 widget 映射改为 map 方式添加 isPrimary（修复 v7 Minor 8）
          panelWidgets[pd.panel.id] = pd.widgets.map(w => ({ ...w, isPrimary: w.isPrimary ?? false }))
          panelPositions[pd.panel.id] = pd.positions
        }
        const rawActiveId = data.activePanelId ?? null
        // 修复问题1：验证 activeId 指向实际存在的面板，否则回退到第一个面板
        const activeId = (rawActiveId && panels.find(p => p.id === rawActiveId)) ? rawActiveId : (panels[0]?.id ?? null)
        const activePanel = panels.find(p => p.id === activeId)
        // 优先从 sessionStorage 恢复 canvasTransform（同步，刷新后仍存在）
        let canvasTransform = activePanel?.canvasTransform ?? { x: 0, y: 0, zoom: 1 }
        if (activeId) {
          try {
            const saved = sessionStorage.getItem(`canvasTransform_${activeId}`)
            if (saved) {
              const parsed = JSON.parse(saved)
              if (parsed && typeof parsed.x === 'number' && typeof parsed.y === 'number' && typeof parsed.zoom === 'number') {
                canvasTransform = parsed as CanvasTransform
              }
            }
          } catch { /* ignore */ }
        }
        set({
          panels: panels.map(p => ({
            ...p,
            // 活跃面板使用 sessionStorage 恢复的值，确保与顶层 canvasTransform 一致
            canvasTransform: p.id === activeId ? canvasTransform : p.canvasTransform,
          })),
          activePanelId: activeId,
          panelWidgets,
          panelPositions,
          settings: data.settings,
          dynamicWidgets: data.dynamicWidgets,
          initialized: true,
          saveStatus: { status: 'saved', lastSavedAt: Date.now() },
          canvasTransform,
        })

        runtimeModeManager.start()
        _unsubModeChange = runtimeModeManager.onModeChange((state) => {
          set({ effectiveRuntimeMode: state.mode })
        })
        _unsubSaveStateChange = resourceSaveTracker.onStateChange((resourceId, state) => {
          set(s => ({ resourceSaveStates: { ...s.resourceSaveStates, [resourceId]: state } }))
        })

        // Phase 3: 加载当前激活面板的笔迹和连线
        if (activeId) {
          try {
            const [strokes, conns] = await Promise.all([
              getStrokesByPanel(activeId),
              getConnectionsByPanel(activeId),
            ])
            set(state => ({
              strokes: { ...state.strokes, [activeId]: strokes },
              connections: { ...state.connections, [activeId]: conns },
              strokesLoadStatus: { ...state.strokesLoadStatus, [activeId]: 'loaded' },
              connectionsLoadStatus: { ...state.connectionsLoadStatus, [activeId]: 'loaded' },
            }))
            // 初始化该面板的命令栈
            getCommandStack(activeId)
          } catch (e) {
            console.error('[useAppStore] Failed to load Phase 3 data:', e)
            set(state => ({
              strokes: { ...state.strokes, [activeId]: [] },
              connections: { ...state.connections, [activeId]: [] },
              strokesLoadStatus: { ...state.strokesLoadStatus, [activeId]: 'error' },
              connectionsLoadStatus: { ...state.connectionsLoadStatus, [activeId]: 'error' },
            }))
          }
        }

        // 初始化后校验：确保 canvasTransform 与 sessionStorage 一致
        const finalActiveId = get().activePanelId
        if (finalActiveId) {
          try {
            const saved = sessionStorage.getItem(`canvasTransform_${finalActiveId}`)
            if (saved) {
              const parsed = JSON.parse(saved)
              if (parsed && typeof parsed.x === 'number' && typeof parsed.y === 'number' && typeof parsed.zoom === 'number') {
                const current = get().canvasTransform
                if (current.x !== parsed.x || current.y !== parsed.y || current.zoom !== parsed.zoom) {
                  set({ canvasTransform: parsed as CanvasTransform })
                }
              }
            }
          } catch { /* ignore */ }
        }
      }
    } catch (err) {
      // Phase 15 批次1 任务1.1：onboardingChecked 防御性解锁 —
      // onboardingPromise try 块不再提前设置 onboardingChecked，若 initialize 中途异常，
      // 必须在此处解锁，否则 App.tsx 的 `if (!onboardingChecked)` 会永久卡在 SuspenseFallback
      set({ initialized: true, isInitializing: false, onboardingChecked: true, saveStatus: { status: 'error', lastSavedAt: null, error: String(err) } })
    }

    // v10: 旧面板迁移检测已移除（Phase 4: 移除 desktop appMode）

    // Phase 6.1：注册所有面板到内存管理器并启动监控（spec 第 4 节）
    try {
      const { panels, activePanelId, panelWidgets, settings } = get()
      for (const panel of panels) {
        const widgetCount = panelWidgets[panel.id]?.length ?? 0
        panelMemoryManager.registerPanel(panel.id, widgetCount)
      }
      if (activePanelId) {
        panelMemoryManager.markActive(activePanelId)
      }
      // 根据用户设置更新配置
      const behavior = settings.behavior
      if (behavior.memoryHibernateEnabled) {
        panelMemoryManager.updateConfig({
          hibernateAfterMs: behavior.memoryHibernateAfterMin * 60 * 1000,
          hibernateMemoryThresholdBytes: behavior.memoryHibernateThresholdGB * 1024 * 1024 * 1024,
        })
        panelMemoryManager.start()
      }
      // 订阅状态变更：
      // - hibernated：保存面板状态到数据库（spec 第 2 节，休眠前先 flush widget state）
      // - deep-hibernated：清空 panelWidgets/panelPositions 释放内存（spec 第 1 节）
      if (_unsubPanelMemoryStateChange) {
        _unsubPanelMemoryStateChange()
      }
      _unsubPanelMemoryStateChange = panelMemoryManager.onStateChange((panelId, state) => {
        if (state.status === 'hibernated') {
          // 保存面板状态到数据库（widget states + webview scrollY）
          // 注意：此时 panelWidgets 仍在 store 中，可以收集 widget states
          const widgets = get().panelWidgets[panelId] ?? []
          if (widgets.length > 0) {
            void savePanelState(panelId, widgets, debouncedWidgetStateSave.flush).catch(err => {
              console.error('[useAppStore] savePanelState failed:', err)
            })
          }
        } else if (state.status === 'deep-hibernated') {
          // 清空 panelWidgets/panelPositions 释放内存（widgets 数据仍在数据库，恢复时重新加载）
          set(s => {
            const newPanelWidgets = { ...s.panelWidgets }
            const newPanelPositions = { ...s.panelPositions }
            // 仅清空非活跃面板（活跃面板不应进入 deep-hibernated，但防御性检查）
            if (panelId !== s.activePanelId) {
              delete newPanelWidgets[panelId]
              delete newPanelPositions[panelId]
            }
            return { panelWidgets: newPanelWidgets, panelPositions: newPanelPositions }
          })
        }
      })
    } catch (err) {
      console.error('[useAppStore] PanelMemoryManager init failed:', err)
    }

    // 加载 bookmarks（独立于主初始化，失败不影响 panels/widgets）
    try {
      const savedBookmarks = await getBookmarks()
      // 初始化 _prev 引用为已加载值，避免 subscribe 首次触发误保存
      _prevBookmarks = savedBookmarks
      set({ bookmarks: savedBookmarks })
    } catch (err) {
      console.error('[useAppStore] Failed to load bookmarks:', err)
      _prevBookmarks = []
    }

    // 设置 subscribe 监听 bookmarks 变化，自动防抖保存到 IDB
    // 清理旧的 subscribe（防止 initialize 被多次调用时重复订阅）
    if (_unsubPersistCollections) {
      _unsubPersistCollections()
      _unsubPersistCollections = null
    }
    _unsubPersistCollections = useAppStore.subscribe((state) => {
      // null 表示尚未初始化完成，跳过保存
      if (_prevBookmarks !== null && state.bookmarks !== _prevBookmarks) {
        _prevBookmarks = state.bookmarks
        debouncedBookmarksSave.call(state.bookmarks)
      }
    })

    // Phase 5: 加载收藏组件数据（独立于主初始化，失败不影响主流程）
    void get().refreshFavorites()
    // Phase 7 批次3 任务4：加载收藏分组数据
    void get().refreshFavoriteGroups()

    // Phase 14 B3：等待 onboarding 检查完成（已在 initialize 开头并行启动）
    // 失败不阻塞主流程（onboardingPromise 内部已 try/catch 设置 onboardingChecked=true）
    await onboardingPromise
    // Phase 15 批次1 任务1.1：onboardingPromise try 块不再提前设置 onboardingChecked=true，
    // 此处统一在 initialize 末尾设置，确保主界面渲染时所有数据已加载完成
    set({ onboardingChecked: true })

    // Phase 15 批次1 任务1.1 对抗审查修复：isInitializing 由 App.tsx 单一管理
    // 不在此处设 isInitializing=false，避免 useAIStore.initialize() 未完成时主界面就渲染

    // S12 新增：WS 初始化 + 心跳（spec S12.3-T11，不依赖 useAIStore stub）
    // WS 失败不阻塞 initialize（已加载的数据仍可用，只是无实时同步）
    // S13 改造：WS 初始化已迁移到 useAIStore.initialize()（CanvasHome useEffect 调用）
  },

  addPanel: async (name: string, options?: { skipPrimaryAI?: boolean; isCommunity?: boolean; communityApiUrl?: string | null }): Promise<string> => {
    const { behavior } = get().settings
    const panels = get().panels
    const isCommunity = options?.isCommunity === true
    const communityApiUrl = options?.communityApiUrl ?? null
    const newPanel: Panel = {
      id: uuidv4(),
      name,
      order: panels.length,
      settings: { layoutMode: behavior.defaultLayoutMode, gridSize: behavior.defaultGridSize },
      ownerId: null,
      isCommunity,
      communityApiUrl,
    }
    await withFallback(
      async () => { await panelsApi.createPanel({ id: newPanel.id, name: newPanel.name, sortOrder: newPanel.order, settings: newPanel.settings as Record<string, unknown>, isCommunity, communityApiUrl }) },
      () => savePanel(newPanel),
    )
    await withFallback(
      () => panelsApi.setActivePanelId(newPanel.id),
      () => saveActivePanelId(newPanel.id),
    )
    set(state => ({
      panels: [...state.panels, newPanel],
      activePanelId: newPanel.id,
      panelWidgets: { ...state.panelWidgets, [newPanel.id]: [] },
      panelPositions: { ...state.panelPositions, [newPanel.id]: [] },
      canvasTransform: { x: 0, y: 0, zoom: 1 },
      ...setSaved(),
    }))

    // Phase 6.1：注册新面板到内存管理器（spec 第 4 节）
    try {
      panelMemoryManager.registerPanel(newPanel.id, 0)
      panelMemoryManager.markActive(newPanel.id)
    } catch (err) {
      console.error('[useAppStore] PanelMemoryManager registerPanel failed:', err)
    }

    return newPanel.id
  },

  addPanelFromTemplate: async (templateId: string) => {
    const { getPanelTemplateById } = await import('../utils/dbStores/panelTemplates')
    const template = await getPanelTemplateById(templateId)
    if (!template) {
      console.warn(`[addPanelFromTemplate] Template not found: ${templateId}`)
      return
    }

    const panelId = await get().addPanel(template.name)

    for (const widget of template.widgets) {
      try {
        await get().addWidget(widget.widgetType, {
          panelId,
          position: widget.position,
          initialState: widget.initialState,
        })
      } catch (e) {
        console.warn(`[addPanelFromTemplate] Failed to add widget ${widget.widgetType}:`, e)
      }
    }

    await get().setActivePanel(panelId)
  },

  deletePanel: async (panelId: string, options?: { deleteEntityData?: boolean }) => {
    await withFallback(
      () => panelsApi.deletePanel(panelId),
      () => dbDeletePanel(panelId, options),
    )
    // Phase 6.1：注销面板并清理内存状态（spec 第 4 节）
    try {
      panelMemoryManager.unregisterPanel(panelId)
      await clearPanelState(panelId)
    } catch (err) {
      console.error('[useAppStore] PanelMemoryManager unregisterPanel failed:', err)
    }
    if (options?.deleteEntityData) {
      // 显式清理笔迹和连线
      try {
        await withFallback(
          async () => entitiesApi.batchDeleteEntities(
            (await entitiesApi.queryEntities({ panelId, type: 'drawingStroke' })).items.map(e => e.id),
          ),
          () => dbDeleteStrokesByPanel(panelId),
        )
      } catch { /* ignore */ }
      try {
        await withFallback(
          async () => entitiesApi.batchDeleteEntities(
            (await entitiesApi.queryEntities({ panelId, type: 'widgetConnection' })).items.map(e => e.id),
          ),
          () => dbDeleteConnectionsByPanel(panelId),
        )
      } catch { /* ignore */ }
    }
    set(state => {
      const newPanels = state.panels.filter(p => p.id !== panelId)
      const newPanelWidgets = { ...state.panelWidgets }
      const newPanelPositions = { ...state.panelPositions }
      const newStrokes = { ...state.strokes }
      const newConnections = { ...state.connections }
      const newStrokesLoadStatus = { ...state.strokesLoadStatus }
      const newConnectionsLoadStatus = { ...state.connectionsLoadStatus }
      delete newPanelWidgets[panelId]
      delete newPanelPositions[panelId]
      delete newStrokes[panelId]
      delete newConnections[panelId]
      delete newStrokesLoadStatus[panelId]
      delete newConnectionsLoadStatus[panelId]
      const newActiveId = state.activePanelId === panelId
        ? newPanels[0]?.id ?? null
        : state.activePanelId
      const activePanel = newPanels.find(p => p.id === newActiveId)
      // 优先从 sessionStorage 恢复 canvasTransform
      let canvasTransform = activePanel?.canvasTransform ?? { x: 0, y: 0, zoom: 1 }
      if (newActiveId) {
        try {
          const saved = sessionStorage.getItem(`canvasTransform_${newActiveId}`)
          if (saved) {
            const parsed = JSON.parse(saved)
            if (parsed && typeof parsed.x === 'number' && typeof parsed.y === 'number' && typeof parsed.zoom === 'number') {
              canvasTransform = parsed as CanvasTransform
            }
          }
        } catch { /* ignore */ }
      }
      // 清理被删除面板的 sessionStorage
      try { sessionStorage.removeItem(`canvasTransform_${panelId}`) } catch { /* ignore */ }
      return {
        panels: newPanels,
        activePanelId: newActiveId,
        panelWidgets: newPanelWidgets,
        panelPositions: newPanelPositions,
        strokes: newStrokes,
        connections: newConnections,
        strokesLoadStatus: newStrokesLoadStatus,
        connectionsLoadStatus: newConnectionsLoadStatus,
        canvasTransform,
        ...setSaved(),
      }
    })
    // 持久化 activePanelId（不能在 set 回调中 await）
    const newActiveId = get().activePanelId
    if (newActiveId) await withFallback(
      () => panelsApi.setActivePanelId(newActiveId),
      () => saveActivePanelId(newActiveId),
    )
    // Phase 5: 联动清理该面板下的所有收藏组件
    try {
      await get().removeFavoritesByPanelId(panelId)
    } catch (err) {
      console.error('[deletePanel] Failed to clear favorites for panel:', panelId, err)
    }
  },

  renamePanel: async (panelId: string, name: string) => {
    const panel = get().panels.find(p => p.id === panelId)
    if (!panel) return
    const updated = { ...panel, name }
    await withFallback(
      async () => { await panelsApi.updatePanel(panelId, { name }) },
      () => savePanel(updated),
    )
    set(state => ({
      panels: state.panels.map(p => p.id === panelId ? updated : p),
      ...setSaved(),
    }))
  },

  reorderPanels: async (panels: Panel[]) => {
    const reordered = panels.map((p, i) => ({ ...p, order: i }))
    await withFallback(
      () => panelsApi.reorderPanels(reordered.map(p => p.id)),
      async () => { await Promise.all(reordered.map(p => savePanel(p))) },
    )
    set({ panels: reordered })
  },

  setActivePanel: async (panelId: string) => {
    const { panels, activePanelId, canvasTransform, strokes, connections, strokesLoadStatus, connectionsLoadStatus } = get()
    if (activePanelId) {
      const prevPanel = panels.find(p => p.id === activePanelId)
      if (prevPanel) {
        const updated = { ...prevPanel, canvasTransform }
        await withFallback(
          async () => { await panelsApi.updatePanel(activePanelId, { canvasTransform: canvasTransform as Record<string, unknown> }) },
          () => savePanel(updated),
        )
        set(state => ({
          panels: state.panels.map(p => p.id === activePanelId ? updated : p),
        }))
      }
      // Phase 6.1：将原面板标记为后台（spec 第 4 节）
      // 注意：不在此处立即休眠，由 panelMemoryManager 定时器根据时间/内存策略触发
      try {
        panelMemoryManager.markBackground(activePanelId)
      } catch (err) {
        console.error('[useAppStore] PanelMemoryManager markBackground failed:', err)
      }
    }
    // Phase 6.1：恢复目标面板（若处于休眠状态）并标记为活跃（spec 第 4 节）
    try {
      const targetState = panelMemoryManager.getPanelState(panelId)
      if (targetState && (targetState.status === 'hibernated' || targetState.status === 'deep-hibernated')) {
        // 从数据库恢复面板状态（widgets 数据已在 initialize 加载，此处仅恢复 savedState）
        await restorePanelState(panelId)
        panelMemoryManager.restorePanel(panelId)
        // deep-hibernated 时 panelWidgets/panelPositions 已被清空，需从 API 重新加载
        if (targetState.status === 'deep-hibernated') {
          try {
            const ws = await withFallback(
              () => widgetsApi.getPanelWidgets(panelId),
              async () => [],  // IDB 降级时无法重新加载，返回空数组
            )
            const reloadedWidgets = ws.map(w => ({
              widgetId: w.id,
              widgetType: w.type,
              state: w.state,
              minimized: w.minimized,
              locked: w.locked,
              colorScheme: w.colorScheme ?? undefined,
              isPrimary: w.isPrimary ?? false,
            }))
            const reloadedPositions = ws.map(w => ({
              widgetId: w.id,
              x: w.x,
              y: w.y,
              w: w.width,
              h: w.height,
              zIndex: w.zIndex,
            }))
            set(s => ({
              panelWidgets: { ...s.panelWidgets, [panelId]: reloadedWidgets },
              panelPositions: { ...s.panelPositions, [panelId]: reloadedPositions },
            }))
            panelMemoryManager.updateWidgetCount(panelId, reloadedWidgets.length)
          } catch (err) {
            console.error('[useAppStore] Failed to reload widgets for deep-hibernated panel:', err)
          }
        }
      }
      panelMemoryManager.markActive(panelId)
      // Phase 6.1：延迟清除恢复状态，让骨架屏有时间显示直到 widgets 渲染完成（spec 第 5 节"恢复时显示骨架屏，无白屏"）
      if (panelMemoryManager.isRestoring(panelId)) {
        setTimeout(() => {
          try {
            panelMemoryManager.markRestored(panelId)
          } catch (err) {
            console.error('[useAppStore] PanelMemoryManager markRestored failed:', err)
          }
        }, 300)
      }
    } catch (err) {
      console.error('[useAppStore] PanelMemoryManager markActive failed:', err)
    }
    await withFallback(
      () => panelsApi.setActivePanelId(panelId),
      () => saveActivePanelId(panelId),
    )
    const nextPanel = panels.find(p => p.id === panelId)
    // 优先从 sessionStorage 恢复 canvasTransform
    let nextTransform = nextPanel?.canvasTransform ?? { x: 0, y: 0, zoom: 1 }
    try {
      const saved = sessionStorage.getItem(`canvasTransform_${panelId}`)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (parsed && typeof parsed.x === 'number' && typeof parsed.y === 'number' && typeof parsed.zoom === 'number') {
          nextTransform = parsed as CanvasTransform
        }
      }
    } catch { /* ignore */ }
    set({ activePanelId: panelId, canvasTransform: nextTransform })

    // Phase 3: 按需加载新面板的笔迹和连线
    if (strokesLoadStatus[panelId] !== 'loaded' && strokesLoadStatus[panelId] !== 'loading') {
      set(s => ({ strokesLoadStatus: { ...s.strokesLoadStatus, [panelId]: 'loading' } }))
      try {
        const newStrokes = await withFallback(
          () => entitiesApi.queryEntities({ panelId, type: 'drawingStroke' }).then(r => r.items.map(e => e.data as unknown as DrawingStroke)),
          () => getStrokesByPanel(panelId),
        )
        set(s => ({
          strokes: { ...s.strokes, [panelId]: newStrokes },
          strokesLoadStatus: { ...s.strokesLoadStatus, [panelId]: 'loaded' },
        }))
      } catch (e) {
        console.error('[useAppStore] Failed to load strokes for panel:', panelId, e)
        set(s => ({
          strokes: { ...s.strokes, [panelId]: [] },
          strokesLoadStatus: { ...s.strokesLoadStatus, [panelId]: 'error' },
        }))
      }
    }
    if (connectionsLoadStatus[panelId] !== 'loaded' && connectionsLoadStatus[panelId] !== 'loading') {
      set(s => ({ connectionsLoadStatus: { ...s.connectionsLoadStatus, [panelId]: 'loading' } }))
      try {
        const newConns = await withFallback(
          () => entitiesApi.queryEntities({ panelId, type: 'widgetConnection' }).then(r => r.items.map(e => e.data as unknown as WidgetConnection)),
          () => getConnectionsByPanel(panelId),
        )
        set(s => ({
          connections: { ...s.connections, [panelId]: newConns },
          connectionsLoadStatus: { ...s.connectionsLoadStatus, [panelId]: 'loaded' },
        }))
      } catch (e) {
        console.error('[useAppStore] Failed to load connections for panel:', panelId, e)
        set(s => ({
          connections: { ...s.connections, [panelId]: [] },
          connectionsLoadStatus: { ...s.connectionsLoadStatus, [panelId]: 'error' },
        }))
      }
    }
    // 确保命令栈存在
    getCommandStack(panelId)
    void strokes
    void connections
  },

  updatePanelSettings: async (panelId: string, settings: Partial<Panel['settings']>) => {
    const panel = get().panels.find(p => p.id === panelId)
    if (!panel) return
    const updated = { ...panel, settings: { ...panel.settings, ...settings } }
    await withFallback(
      async () => { await panelsApi.updatePanel(panelId, { settings: updated.settings as Record<string, unknown> }) },
      () => savePanel(updated),
    )
    set(state => ({
      panels: state.panels.map(p => p.id === panelId ? updated : p),
      ...setSaved(),
    }))
  },

  addWidget: async (widgetType: string, options?: {
    panelId?: string
    position?: { x: number; y: number; w: number; h: number }
    initialState?: Record<string, unknown>
    isPrimary?: boolean
  }) => {
    const config = getWidgetConfig(widgetType)
    if (!config) return
    const targetPanelId = options?.panelId ?? get().activePanelId
    if (!targetPanelId) return

    const widgetId = uuidv4()

    // Determine widget state
    let widgetState: Record<string, unknown> = { ...config.defaultState }
    if (options?.initialState) {
      widgetState = { ...config.defaultState, ...options.initialState }
    }

    // v10: newWidget 新增 isPrimary 顶层字段（保持现有行为，不新增 minimized/locked）
    const newWidget: WidgetInstance = {
      widgetId,
      widgetType,
      state: widgetState,
      minimized: false,
      isPrimary: options?.isPrimary ?? false,
    }

    const existingPositions = get().panelPositions[targetPanelId] ?? []
    const maxZ = existingPositions.reduce((max, p) => Math.max(max, p.zIndex), 0)

    let newPosition: WidgetPosition
    if (options?.position) {
      newPosition = {
        widgetId,
        x: options.position.x,
        y: options.position.y,
        w: options.position.w,
        h: options.position.h,
        zIndex: maxZ + 1,
      }
    } else {
      const { canvasTransform } = get()
      // 用 canvas-container 实测 ccRect 计算视口中心（避免 React mount + 内联 style 的 CSS zoom quirk）
      const ccRect = document.querySelector('.panel-layer--active .canvas-container')?.getBoundingClientRect() ?? null
      if (!ccRect) {
        // 活动画布容器未找到（理论上不会发生），使用 fallback 坐标 (0, 0) 兜底
        console.warn('addWidget: canvas-container not found, falling back to (0, 0)')
      }
      let centerX: number
      let centerY: number
      if (ccRect) {
        const vc = getViewportCenterCanvas(ccRect, canvasTransform.zoom, window.innerWidth, window.innerHeight)
        // 钳制基点到非负区域：当画布向右平移较多时，视口中心可能对应 canvas 负坐标，
        // 此时在负坐标创建组件会导致"重置视图"后组件不可见。强制基点 >= 0 保证组件始终在
        // canvas 正坐标区域（重置视图后默认可见）。
        centerX = Math.max(0, vc.x)
        centerY = Math.max(0, vc.y)
      } else {
        centerX = 0
        centerY = 0
      }
      // 兜底钳制：确保最终位置非负（即使基点钳制后，减去 widget 一半宽高仍可能为负）
      newPosition = {
        widgetId,
        x: Math.max(0, Math.round(centerX - config.defaultLayout.w / 2)),
        y: Math.max(0, Math.round(centerY - config.defaultLayout.h / 2)),
        w: config.defaultLayout.w,
        h: config.defaultLayout.h,
        zIndex: maxZ + 1,
      }
    }

    const updatedWidgets = [...(get().panelWidgets[targetPanelId] ?? []), newWidget]
    const updatedPositions = [...existingPositions, newPosition]

    await withFallback(
      async () => { await widgetsApi.createWidget(targetPanelId, {
        id: widgetId,
        type: widgetType,
        x: newPosition.x,
        y: newPosition.y,
        width: newPosition.w,
        height: newPosition.h,
        zIndex: newPosition.zIndex,
        state: widgetState,
        isPrimary: options?.isPrimary ?? false,  // v10: 传入 isPrimary（修复 Issue 10）
      }) },
      () => saveWidgets(targetPanelId, updatedWidgets),
    )
    await withFallback(
      () => widgetsApi.batchUpdatePositions(updatedPositions.map(p => ({
        id: p.widgetId,
        x: p.x,
        y: p.y,
        width: p.w,
        height: p.h,
        zIndex: p.zIndex,
      }))),
      () => savePositions(targetPanelId, updatedPositions),
    )
    resourceSaveTracker.markSaved(widgetId)

    set(state => ({
      panelWidgets: { ...state.panelWidgets, [targetPanelId]: updatedWidgets },
      panelPositions: { ...state.panelPositions, [targetPanelId]: updatedPositions },
      ...setSaved(),
    }))

    // Phase 6.1：更新面板 widget 数量（spec 第 4 节）
    try {
      panelMemoryManager.updateWidgetCount(targetPanelId, updatedWidgets.length)
    } catch { /* ignore */ }
  },

  removeWidget: async (widgetId: string): Promise<boolean> => {
    const { panelWidgets, panelPositions, connections } = get()
    const panelId = findPanelIdForWidget(widgetId, panelWidgets)
    if (!panelId) return false

    // v10: 拒绝删除主AI助手 widget（修复 v7 Minor 10 — 用 findPanelIdForWidget + v7 Minor 14 — 返回 boolean）
    const widget = panelWidgets[panelId]?.find(w => w.widgetId === widgetId)
    if (widget?.isPrimary) {
      console.warn('[removeWidget] 不能删除主AI助手 widget')
      return false  // 静默拒绝
    }

    // Phase 3: 先批量删除涉及该 widget 的所有连线
    const relatedConnIds = (connections[panelId] ?? [])
      .filter(c => c.source.widgetId === widgetId || c.target.widgetId === widgetId)
      .map(c => c.id)
    if (relatedConnIds.length > 0) {
      try {
        await withFallback(
          () => entitiesApi.batchDeleteEntities(relatedConnIds),
          async () => { await dbDeleteConnectionsByWidget(panelId, widgetId) },
        )
      } catch (e) {
        console.error('[useAppStore] Failed to delete related connections:', e)
      }
    }

    const updatedWidgets = (panelWidgets[panelId] ?? []).filter(w => w.widgetId !== widgetId)
    const updatedPositions = (panelPositions[panelId] ?? []).filter(p => p.widgetId !== widgetId)
    const updatedConnections = (connections[panelId] ?? []).filter(
      c => c.source.widgetId !== widgetId && c.target.widgetId !== widgetId
    )

    await withFallback(
      () => widgetsApi.deleteWidget(widgetId),
      () => saveWidgets(panelId, updatedWidgets),
    )
    await withFallback(
      () => widgetsApi.batchUpdatePositions(updatedPositions.map(p => ({
        id: p.widgetId,
        x: p.x,
        y: p.y,
        width: p.w,
        height: p.h,
        zIndex: p.zIndex,
      }))),
      () => savePositions(panelId, updatedPositions),
    )

    set({
      panelWidgets: { ...panelWidgets, [panelId]: updatedWidgets },
      panelPositions: { ...panelPositions, [panelId]: updatedPositions },
      connections: { ...connections, [panelId]: updatedConnections },
      ...setSaved(),
    })
    resourceSaveTracker.markSaved(widgetId)
    // Phase 6.1：更新面板 widget 数量（spec 第 4 节）
    try {
      panelMemoryManager.updateWidgetCount(panelId, updatedWidgets.length)
    } catch { /* ignore */ }
    // Phase 5: widget 删除联动删除收藏
    const fav = get().getFavoriteByWidgetId(widgetId)
    if (fav) {
      await get().removeFavorite(fav.id)
    }
    return true  // v10: 删除成功
  },

  updateWidgetState: (widgetId: string, partial: Record<string, unknown>) => {
    const { panelWidgets } = get()
    const panelId = findPanelIdForWidget(widgetId, panelWidgets)
    if (!panelId) return

    const widgets = panelWidgets[panelId] ?? []
    const updatedWidgets = widgets.map(w => {
      if (w.widgetId !== widgetId) return w
      const newState = { ...w.state, ...partial }
      const stateSize = new Blob([JSON.stringify(newState)]).size
      if (stateSize > 1024 * 1024) {
        console.warn(`[AutoSave] Widget "${w.widgetType}"(${widgetId}) state exceeds 1MB (${(stateSize / 1024 / 1024).toFixed(2)}MB). Save may fail.`)
      }
      return { ...w, state: newState }
    })

    resourceSaveTracker.markDirty(widgetId)
    set({ panelWidgets: { ...panelWidgets, [panelId]: updatedWidgets } })
    debouncedWidgetStateSave.call(panelId, updatedWidgets)
  },

  updateWidgetPosition: (widgetId: string, partial: Partial<WidgetPosition>) => {
    const { panelPositions, panelWidgets } = get()
    const panelId = findPanelIdForWidget(widgetId, panelWidgets)
    if (!panelId) return

    const positions = panelPositions[panelId] ?? []
    const updatedPositions = positions.map(p =>
      p.widgetId === widgetId ? { ...p, ...partial } : p
    )

    resourceSaveTracker.markDirty(widgetId)
    set({ panelPositions: { ...panelPositions, [panelId]: updatedPositions } })
    debouncedPositionSave.call(panelId, updatedPositions)
  },

  updatePositions: (positions: WidgetPosition[]) => {
    const { activePanelId, panelPositions } = get()
    if (!activePanelId) return

    set({ panelPositions: { ...panelPositions, [activePanelId]: positions } })
    debouncedPositionSave.call(activePanelId, positions)
  },

  bringToFront: (widgetId: string) => {
    const { panelPositions, panelWidgets } = get()
    const panelId = findPanelIdForWidget(widgetId, panelWidgets)
    if (!panelId) return

    const positions = panelPositions[panelId] ?? []
    const maxZ = positions.reduce((max, p) => Math.max(max, p.zIndex), 0)
    const minZ = positions.reduce((min, p) => Math.min(min, p.zIndex), 0)
    let updatedPositions = positions.map(p =>
      p.widgetId === widgetId ? { ...p, zIndex: maxZ + 1 } : p
    )

    if (maxZ + 1 - minZ > 10000) {
      const sorted = [...updatedPositions].sort((a, b) => a.zIndex - b.zIndex)
      updatedPositions = sorted.map((p, i) => ({ ...p, zIndex: i }))
    }

    set({ panelPositions: { ...panelPositions, [panelId]: updatedPositions } })
    debouncedPositionSave.call(panelId, updatedPositions)
  },

  toggleMinimize: (widgetId: string) => {
    const { panelWidgets } = get()
    const panelId = findPanelIdForWidget(widgetId, panelWidgets)
    if (!panelId) return

    const widgets = panelWidgets[panelId] ?? []
    const updatedWidgets = widgets.map(w =>
      w.widgetId === widgetId ? { ...w, minimized: !w.minimized } : w
    )

    set({ panelWidgets: { ...panelWidgets, [panelId]: updatedWidgets } })
    debouncedWidgetStateSave.call(panelId, updatedWidgets)
  },

  toggleLock: (widgetId: string) => {
    const { panelWidgets } = get()
    const panelId = findPanelIdForWidget(widgetId, panelWidgets)
    if (!panelId) return
    const widgets = panelWidgets[panelId] ?? []
    const updatedWidgets = widgets.map(w =>
      w.widgetId === widgetId ? { ...w, locked: !w.locked } : w
    )
    set({ panelWidgets: { ...panelWidgets, [panelId]: updatedWidgets } })
    debouncedWidgetStateSave.call(panelId, updatedWidgets)
  },

  updateWidgetColorScheme: (widgetId: string, schemeName: string | undefined) => {
    const { panelWidgets } = get()
    const panelId = findPanelIdForWidget(widgetId, panelWidgets)
    if (!panelId) return
    const widgets = panelWidgets[panelId] ?? []
    const updatedWidgets = widgets.map(w =>
      w.widgetId === widgetId ? { ...w, colorScheme: schemeName } : w
    )
    set({ panelWidgets: { ...panelWidgets, [panelId]: updatedWidgets } })
    debouncedWidgetStateSave.call(panelId, updatedWidgets)
  },

  batchUpdateWidgetColorScheme: (widgetIds: string[], schemeName: string | undefined) => {
    const { activePanelId, panelWidgets } = get()
    if (!activePanelId) return
    const idSet = new Set(widgetIds)
    const widgets = panelWidgets[activePanelId] ?? []
    const updatedWidgets = widgets.map(w =>
      idSet.has(w.widgetId) ? { ...w, colorScheme: schemeName } : w
    )
    set({ panelWidgets: { ...panelWidgets, [activePanelId]: updatedWidgets } })
    debouncedWidgetStateSave.call(activePanelId, updatedWidgets)
  },

  changeLayer: (widgetId: string, action: string) => {
    const { panelPositions, panelWidgets } = get()
    const panelId = findPanelIdForWidget(widgetId, panelWidgets)
    if (!panelId) return
    const positions = panelPositions[panelId] ?? []
    const sorted = [...positions].sort((a, b) => a.zIndex - b.zIndex)
    const currentIdx = sorted.findIndex(p => p.widgetId === widgetId)
    if (currentIdx === -1) return

    let updatedPositions: WidgetPosition[]

    switch (action) {
      case 'bringToFront': {
        const maxZ = sorted[sorted.length - 1].zIndex
        updatedPositions = positions.map(p =>
          p.widgetId === widgetId ? { ...p, zIndex: maxZ + 1 } : p
        )
        break
      }
      case 'sendToBack': {
        const minZ = sorted[0].zIndex
        updatedPositions = positions.map(p =>
          p.widgetId === widgetId ? { ...p, zIndex: minZ - 1 } : p
        )
        break
      }
      case 'moveUp': {
        if (currentIdx >= sorted.length - 1) return
        const swapTarget = sorted[currentIdx + 1]
        updatedPositions = positions.map(p => {
          if (p.widgetId === widgetId) return { ...p, zIndex: swapTarget.zIndex }
          if (p.widgetId === swapTarget.widgetId) return { ...p, zIndex: sorted[currentIdx].zIndex }
          return p
        })
        break
      }
      case 'moveDown': {
        if (currentIdx <= 0) return
        const swapTarget = sorted[currentIdx - 1]
        updatedPositions = positions.map(p => {
          if (p.widgetId === widgetId) return { ...p, zIndex: swapTarget.zIndex }
          if (p.widgetId === swapTarget.widgetId) return { ...p, zIndex: sorted[currentIdx].zIndex }
          return p
        })
        break
      }
      default: return
    }

    const allZ = updatedPositions.map(p => p.zIndex)
    const zSpan = Math.max(...allZ) - Math.min(...allZ)
    if (zSpan > 10000) {
      const reSorted = [...updatedPositions].sort((a, b) => a.zIndex - b.zIndex)
      updatedPositions = reSorted.map((p, i) => ({ ...p, zIndex: i }))
    }

    set({ panelPositions: { ...panelPositions, [panelId]: updatedPositions } })
    debouncedPositionSave.call(panelId, updatedPositions)
  },

  moveSelectedWidgets: (widgetIds: string[], deltaX: number, deltaY: number) => {
    const { activePanelId, panelPositions, panelWidgets } = get()
    if (!activePanelId) return
    const lockedIds = new Set(
      (panelWidgets[activePanelId] ?? [])
        .filter(w => w.locked)
        .map(w => w.widgetId)
    )
    const movableIds = new Set(widgetIds.filter(id => !lockedIds.has(id)))
    if (movableIds.size === 0) return
    const positions = panelPositions[activePanelId] ?? []
    const updatedPositions = positions.map(p =>
      movableIds.has(p.widgetId) ? { ...p, x: p.x + deltaX, y: p.y + deltaY } : p
    )
    set({ panelPositions: { ...panelPositions, [activePanelId]: updatedPositions } })
    debouncedPositionSave.call(activePanelId, updatedPositions)
  },

  setLastActiveWidget: (widgetId: string | null) => {
    set({ lastActiveWidgetId: widgetId })
  },

  updateAppearance: async (partial: Partial<AppSettings['appearance']>) => {
    const newSettings = {
      ...get().settings,
      appearance: { ...get().settings.appearance, ...partial },
    }
    await withFallback(
      () => settingsApi.updateSettings(newSettings as unknown as Record<string, unknown>),
      () => saveSettings(newSettings),
    )
    set({ settings: newSettings, ...setSaved() })
  },

  updateBehavior: async (partial: Partial<AppSettings['behavior']>) => {
    const newSettings = {
      ...get().settings,
      behavior: { ...get().settings.behavior, ...partial },
    }
    await withFallback(
      () => settingsApi.updateSettings(newSettings as unknown as Record<string, unknown>),
      () => saveSettings(newSettings),
    )
    set({ settings: newSettings, ...setSaved() })

    // Phase 6.1：同步更新内存管理器配置（spec 第 4/8 节）
    try {
      const behavior = newSettings.behavior
      panelMemoryManager.updateConfig({
        hibernateAfterMs: behavior.memoryHibernateAfterMin * 60 * 1000,
        hibernateMemoryThresholdBytes: behavior.memoryHibernateThresholdGB * 1024 * 1024 * 1024,
      })
      if (behavior.memoryHibernateEnabled) {
        panelMemoryManager.start()
      } else {
        panelMemoryManager.stop()
      }
    } catch (err) {
      console.error('[useAppStore] PanelMemoryManager updateConfig failed:', err)
    }
  },

  // Phase 4: 主页定制（spec 5.8 节）—— 合并 browserHome/canvasHome 并持久化
  updateHomeCustomization: async (partial: { browserHome?: Partial<NonNullable<AppSettings['browserHome']>>; canvasHome?: Partial<NonNullable<AppSettings['canvasHome']>> }) => {
    const currentBrowserHome = get().settings.browserHome ?? { backgroundImage: '', logo: '', accentColor: '#3b82f6' }
    const currentCanvasHome = get().settings.canvasHome ?? { backgroundImage: '', circleIcon: '', accentColor: '#3b82f6' }
    const newSettings = {
      ...get().settings,
      browserHome: partial.browserHome !== undefined
        ? { ...currentBrowserHome, ...partial.browserHome }
        : get().settings.browserHome,
      canvasHome: partial.canvasHome !== undefined
        ? { ...currentCanvasHome, ...partial.canvasHome }
        : get().settings.canvasHome,
    }
    await withFallback(
      () => settingsApi.updateSettings(newSettings as unknown as Record<string, unknown>),
      () => saveSettings(newSettings),
    )
    set({ settings: newSettings, ...setSaved() })
  },

  setCanvasTransform: (transform: Partial<CanvasTransform>) => {
    const { activePanelId, canvasTransform } = get()
    const current = canvasTransform
    const newTransform = { ...current, ...transform }
    // 仅更新 canvasTransform，不重建 panels 数组，避免拖动时所有订阅 panels 的组件重渲染
    // panels 中的 canvasTransform 在切换面板或持久化时同步
    set({ canvasTransform: newTransform })
    // 节流写入 sessionStorage（拖动期间用 rAF 合并写入）
    if (activePanelId) {
      if (!sessionStorageRafRef) {
        sessionStorageRafRef = requestAnimationFrame(() => {
          sessionStorageRafRef = null
          const t = get().canvasTransform
          const pid = get().activePanelId
          if (pid) {
            try {
              sessionStorage.setItem(`canvasTransform_${pid}`, JSON.stringify(t))
            } catch { /* ignore */ }
            // 同步 panels 中的 canvasTransform（延迟到 rAF，避免高频更新）
            const panels = get().panels
            const updatedPanels = panels.map(p => p.id === pid ? { ...p, canvasTransform: t } : p)
            set({ panels: updatedPanels })
            persistCanvasTransform(pid, t, updatedPanels)
          }
        })
      }
    }
  },

  addDynamicWidget: async (def: DynamicWidgetDef) => {
    const { registerDynamicWidget } = await import('../utils/evaluateWidget')
    const success = registerDynamicWidget(def)
    if (!success) return false

    await withFallback(
      async () => { await entitiesApi.createEntity({ type: 'dynamicWidget', data: def as unknown as Record<string, unknown> }) },
      () => saveDynamicWidget(def),
    )
    set(state => ({
      dynamicWidgets: [...state.dynamicWidgets, def],
      ...setSaved(),
    }))
    return true
  },

  removeDynamicWidget: async (widgetType: string) => {
    const { unregisterWidget } = await import('../registry')
    unregisterWidget(widgetType)
    await withFallback(
      async () => {
        const result = await entitiesApi.queryEntities({ type: 'dynamicWidget' })
        const match = result.items.find(e => (e.data as { widgetType?: string }).widgetType === widgetType)
        if (match) await entitiesApi.deleteEntity(match.id)
      },
      () => dbDeleteDynamicWidget(widgetType),
    )
    set(state => ({
      dynamicWidgets: state.dynamicWidgets.filter(d => d.widgetType !== widgetType),
      ...setSaved(),
    }))
  },

  incrementFocusSessionsRevision: () => {
    set(state => ({ focusSessionsRevision: state.focusSessionsRevision + 1 }))
  },

  getEffectiveRuntimeMode: () => {
    return get().effectiveRuntimeMode
  },

  isReadOnlyMode: () => {
    return get().effectiveRuntimeMode !== 'normal_editable'
  },

  destroy: () => {
    runtimeModeManager.stop()
    // Phase 6.1：停止内存管理器并清理订阅（spec 第 4 节）
    try {
      panelMemoryManager.stop()
      if (_unsubPanelMemoryStateChange) {
        _unsubPanelMemoryStateChange()
        _unsubPanelMemoryStateChange = null
      }
    } catch (err) {
      console.error('[useAppStore] PanelMemoryManager stop failed:', err)
    }
    if (_unsubModeChange) {
      _unsubModeChange()
      _unsubModeChange = null
    }
    if (_unsubSaveStateChange) {
      _unsubSaveStateChange()
      _unsubSaveStateChange = null
    }
    // 清理 bookmarks 持久化 subscribe 和防抖保存
    if (_unsubPersistCollections) {
      _unsubPersistCollections()
      _unsubPersistCollections = null
    }
    debouncedBookmarksSave.cancel()
    _prevBookmarks = null
    void saveJobQueue.pending
  },

  // ============== Phase 3 actions ==============

  setCanvasMode: (panelId: string, mode: CanvasMode) => {
    set(state => ({
      canvasMode: { ...state.canvasMode, [panelId]: mode },
      hoveredWidgetId: mode === 'connect' ? state.hoveredWidgetId : null,
    }))
    // selectedWidgetIds 是 Workspace 局部 state，
    // 通过 Workspace.tsx 中的 useEffect 监听 canvasMode 变化来清空
  },

  setDrawingTool: (tool: DrawingStrokeType) => {
    set({ drawingTool: tool })
  },

  setDrawingStyle: (style: Partial<DrawingStyle>) => {
    set(state => ({ drawingStyle: { ...state.drawingStyle, ...style } }))
  },

  setHoveredWidgetId: (widgetId: string | null) => {
    set({ hoveredWidgetId: widgetId })
  },

  addStroke: async (panelId: string, stroke: DrawingStroke) => {
    const current = get().strokes[panelId] ?? []
    if (current.length >= 2000) {
      throw new Error('STROKE_LIMIT_REACHED')
    }
    set(state => ({
      strokes: { ...state.strokes, [panelId]: [...current, stroke] },
    }))
    try {
      await withFallback(
        async () => { await entitiesApi.createEntity({ id: stroke.id, type: 'drawingStroke', panelId, data: stroke as unknown as Record<string, unknown> }) },
        () => saveStroke(stroke),
      )
    } catch (e) {
      console.error('[useAppStore] Failed to save stroke:', e)
    }
  },

  removeStroke: async (panelId: string, strokeId: string) => {
    const current = get().strokes[panelId] ?? []
    set(state => ({
      strokes: { ...state.strokes, [panelId]: current.filter(s => s.id !== strokeId) },
    }))
    try {
      await withFallback(
        () => entitiesApi.deleteEntity(strokeId),
        () => dbDeleteStrokesBatch([strokeId]),
      )
    } catch (e) {
      console.error('[useAppStore] Failed to delete stroke:', e)
    }
  },

  removeStrokesBatch: async (panelId: string, strokeIds: string[]) => {
    if (strokeIds.length === 0) return
    const current = get().strokes[panelId] ?? []
    const idSet = new Set(strokeIds)
    set(state => ({
      strokes: { ...state.strokes, [panelId]: current.filter(s => !idSet.has(s.id)) },
    }))
    try {
      await withFallback(
        () => entitiesApi.batchDeleteEntities(strokeIds),
        () => dbDeleteStrokesBatch(strokeIds),
      )
    } catch (e) {
      console.error('[useAppStore] Failed to delete strokes batch:', e)
    }
  },

  clearStrokes: async (panelId: string) => {
    set(state => ({
      strokes: { ...state.strokes, [panelId]: [] },
    }))
    try {
      await withFallback(
        async () => {
          const result = await entitiesApi.queryEntities({ panelId, type: 'drawingStroke' })
          if (result.items.length > 0) await entitiesApi.batchDeleteEntities(result.items.map(e => e.id))
        },
        () => dbDeleteStrokesByPanel(panelId),
      )
    } catch (e) {
      console.error('[useAppStore] Failed to clear strokes:', e)
    }
  },

  loadPanelStrokes: async (panelId: string) => {
    set(s => ({ strokesLoadStatus: { ...s.strokesLoadStatus, [panelId]: 'loading' } }))
    try {
      const strokes = await withFallback(
        () => entitiesApi.queryEntities({ panelId, type: 'drawingStroke' }).then(r => r.items.map(e => e.data as unknown as DrawingStroke)),
        () => getStrokesByPanel(panelId),
      )
      set(s => ({
        strokes: { ...s.strokes, [panelId]: strokes },
        strokesLoadStatus: { ...s.strokesLoadStatus, [panelId]: 'loaded' },
      }))
    } catch (e) {
      console.error('[useAppStore] Failed to load strokes:', e)
      set(s => ({
        strokes: { ...s.strokes, [panelId]: [] },
        strokesLoadStatus: { ...s.strokesLoadStatus, [panelId]: 'error' },
      }))
    }
  },

  addConnection: async (panelId: string, conn: WidgetConnection) => {
    const current = get().connections[panelId] ?? []
    // 移除同 source/target 对的旧连接（双向检查）
    const filtered = current.filter(c =>
      !((c.source.widgetId === conn.source.widgetId && c.target.widgetId === conn.target.widgetId) ||
        (c.source.widgetId === conn.target.widgetId && c.target.widgetId === conn.source.widgetId))
    )
    set(state => ({
      connections: { ...state.connections, [panelId]: [...filtered, conn] },
    }))
    try {
      await withFallback(
        async () => { await entitiesApi.createEntity({ id: conn.id, type: 'widgetConnection', panelId, data: conn as unknown as Record<string, unknown> }) },
        () => saveConnection(conn),
      )
    } catch (e) {
      console.error('[useAppStore] Failed to save connection:', e)
    }
  },

  removeConnection: async (panelId: string, connId: string) => {
    const current = get().connections[panelId] ?? []
    set(state => ({
      connections: { ...state.connections, [panelId]: current.filter(c => c.id !== connId) },
    }))
    try {
      await withFallback(
        () => entitiesApi.deleteEntity(connId),
        () => deleteConnection(connId),
      )
    } catch (e) {
      console.error('[useAppStore] Failed to delete connection:', e)
    }
  },

  loadPanelConnections: async (panelId: string) => {
    set(s => ({ connectionsLoadStatus: { ...s.connectionsLoadStatus, [panelId]: 'loading' } }))
    try {
      const conns = await withFallback(
        () => entitiesApi.queryEntities({ panelId, type: 'widgetConnection' }).then(r => r.items.map(e => e.data as unknown as WidgetConnection)),
        () => getConnectionsByPanel(panelId),
      )
      set(s => ({
        connections: { ...s.connections, [panelId]: conns },
        connectionsLoadStatus: { ...s.connectionsLoadStatus, [panelId]: 'loaded' },
      }))
    } catch (e) {
      console.error('[useAppStore] Failed to load connections:', e)
      set(s => ({
        connections: { ...s.connections, [panelId]: [] },
        connectionsLoadStatus: { ...s.connectionsLoadStatus, [panelId]: 'error' },
      }))
    }
  },

  // Undo/Redo wrappers
  undo: async () => {
    const panelId = get().activePanelId
    if (!panelId) return false
    return getCommandStack(panelId).undo()
  },

  redo: async () => {
    const panelId = get().activePanelId
    if (!panelId) return false
    return getCommandStack(panelId).redo()
  },

  canUndo: () => {
    const panelId = get().activePanelId
    if (!panelId) return false
    return getCommandStack(panelId).canUndo()
  },

  canRedo: () => {
    const panelId = get().activePanelId
    if (!panelId) return false
    return getCommandStack(panelId).canRedo()
  },

  addCanvasBookmark: (panelId, bookmark) => {
    set(state => ({
      canvasBookmarks: {
        ...state.canvasBookmarks,
        [panelId]: [...(state.canvasBookmarks[panelId] ?? []), bookmark],
      },
    }))
  },

  removeCanvasBookmark: (panelId, index) => {
    set(state => ({
      canvasBookmarks: {
        ...state.canvasBookmarks,
        [panelId]: (state.canvasBookmarks[panelId] ?? []).filter((_, i) => i !== index),
      },
    }))
  },

  teleportTo: (x, y, zoom) => {
    const currentZoom = zoom ?? get().canvasTransform.zoom
    const vw = window.innerWidth
    const vh = window.innerHeight
    get().setCanvasTransform({
      x: vw / 2 - x * currentZoom,
      y: vh / 2 - y * currentZoom,
      zoom: currentZoom,
    })
  },

  toggleHideConnections: () => {
    set(state => ({ hideConnections: !state.hideConnections }))
  },

  autoLayoutPanel: () => {
    const { activePanelId, panelWidgets, panelPositions } = get()
    if (!activePanelId) return

    const widgets = panelWidgets[activePanelId] ?? []
    const positions = panelPositions[activePanelId] ?? []
    if (positions.length === 0) return

    // 按 panelWidgets 数组顺序排序（创建/插入顺序），过滤 locked widget
    const widgetOrder = new Map<string, number>()
    widgets.forEach((w, i) => widgetOrder.set(w.widgetId, i))

    const layoutable = positions
      .filter(p => widgetOrder.has(p.widgetId))
      .filter(p => {
        const w = widgets.find(w => w.widgetId === p.widgetId)
        return w ? !w.locked : true
      })
      .sort((a, b) => (widgetOrder.get(a.widgetId) ?? 0) - (widgetOrder.get(b.widgetId) ?? 0))

    if (layoutable.length === 0) return

    const GAP = 20
    const columns = Math.ceil(Math.sqrt(layoutable.length))
    const cellW = Math.max(...layoutable.map(p => p.w))
    const cellH = Math.max(...layoutable.map(p => p.h))

    const oldPositions = layoutable.map(p => ({ ...p }))

    const newPositions = layoutable.map((p, i) => ({
      ...p,
      x: (i % columns) * (cellW + GAP),
      y: Math.floor(i / columns) * (cellH + GAP),
    }))

    // 合并：未参与布局的 widget 保持原位
    const mergedPositions = positions.map(p => {
      const neu = newPositions.find(n => n.widgetId === p.widgetId)
      return neu ?? p
    })

    // 应用新布局
    get().updatePositions(mergedPositions)

    // 推入命令栈支持撤销
    const stack = getCommandStack(activePanelId)
    stack.push({
      description: `auto layout ${newPositions.length} widgets`,
      execute: async () => { /* noop: 已在 push 前手动执行 */ },
      undo: async () => {
        const current = useAppStore.getState().panelPositions[activePanelId] ?? []
        const restored = current.map(p => {
          const old = oldPositions.find(o => o.widgetId === p.widgetId)
          return old ?? p
        })
        useAppStore.getState().updatePositions(restored)
      },
      redo: async () => {
        const current = useAppStore.getState().panelPositions[activePanelId] ?? []
        const reapplied = current.map(p => {
          const neu = newPositions.find(n => n.widgetId === p.widgetId)
          return neu ?? p
        })
        useAppStore.getState().updatePositions(reapplied)
      },
    })

    // 重置视口到布局起点
    get().teleportTo(0, 0, 1)
  },

  // ========== Phase 2: 侧边栏 + 标签页 ↔ 网页组件双向转换 ==========

  toggleSidebar: () => {
    // 批次1: 切换 sidebarWidth 240 ↔ 48，同时同步 sidebarCollapsed（向后兼容）
    set(state => {
      const newWidth = state.sidebarWidth <= COLLAPSED_SIDEBAR_WIDTH
        ? DEFAULT_SIDEBAR_WIDTH
        : COLLAPSED_SIDEBAR_WIDTH
      const newCollapsed = newWidth <= COLLAPSED_SIDEBAR_WIDTH
      saveLayoutSizes({ sidebarWidth: newWidth, topbarOmniboxWidth: state.topbarOmniboxWidth })
      return { sidebarWidth: newWidth, sidebarCollapsed: newCollapsed }
    })
  },

  // 批次1: 设置侧边栏宽度（持久化到 localStorage）
  setSidebarWidth: (w: number) => {
    const clamped = Math.max(COLLAPSED_SIDEBAR_WIDTH, Math.min(480, Math.round(w)))
    set(state => {
      saveLayoutSizes({ sidebarWidth: clamped, topbarOmniboxWidth: state.topbarOmniboxWidth })
      return {
        sidebarWidth: clamped,
        sidebarCollapsed: clamped <= COLLAPSED_SIDEBAR_WIDTH,
      }
    })
  },

  // 批次1: 设置顶栏 Omnibox 宽度（持久化到 localStorage）
  setTopbarOmniboxWidth: (w: number) => {
    const clamped = Math.max(200, Math.min(720, Math.round(w)))
    set(state => {
      saveLayoutSizes({ sidebarWidth: state.sidebarWidth, topbarOmniboxWidth: clamped })
      return { topbarOmniboxWidth: clamped }
    })
  },

  // 批次4: 切换 Sidebar 模式（canvas 画布面板 / ai-assistant AI 助手），会话级状态不持久化
  setSidebarMode: (mode) => {
    set({ sidebarMode: mode })
  },

  // 关闭其他所有面板（保留 keepPanelId）
  closeOtherPanels: async (keepPanelId: string) => {
    const state = get()
    const toDelete = state.panels.filter(p => p.id !== keepPanelId).map(p => p.id)
    for (const pid of toDelete) {
      await state.deletePanel(pid)
    }
  },

  // ========== Phase 3: WS 变更广播触发的局部刷新 ==========
  // Spec 6.7：WS 推送变更后，从 API 拉取最新数据更新 store（仅 API 模式生效）
  refreshPanels: async () => {
    try {
      const [panelsData, activeId] = await Promise.all([
        panelsApi.getAllPanels(),
        panelsApi.getActivePanelId(),
      ])
      const panels = panelsData.sort((a, b) => a.sortOrder - b.sortOrder)
      const panelWidgets: Record<string, WidgetInstance[]> = {}
      const panelPositions: Record<string, WidgetPosition[]> = {}
      const widgetVersions: Record<string, number> = {}
      for (const panel of panels) {
        const ws = await widgetsApi.getPanelWidgets(panel.id)
        // F4 修复：widget 映射必须与 initialize 完全一致，包含全部 7 个字段
        panelWidgets[panel.id] = ws.map(w => ({
          widgetId: w.id,
          widgetType: w.type,
          state: w.state,
          minimized: w.minimized,
          locked: w.locked,
          colorScheme: w.colorScheme ?? undefined,
          isPrimary: w.isPrimary ?? false,
        }))
        panelPositions[panel.id] = ws.map(w => ({
          widgetId: w.id,
          x: w.x,
          y: w.y,
          w: w.width,
          h: w.height,
          zIndex: w.zIndex,
        }))
        // Phase 4: 记录 widget 版本号
        for (const w of ws) {
          widgetVersions[w.id] = w.version
        }
      }
      set(state => ({
        panels: panels.map(p => ({
          id: p.id,
          name: p.name,
          order: p.sortOrder,
          settings: p.settings as PanelSettings,
          canvasTransform: (p.id === activeId ? state.canvasTransform : (p.canvasTransform as CanvasTransform | undefined)) as CanvasTransform | undefined,
          ownerId: p.ownerId ?? null,
          isCommunity: p.isCommunity ?? false,
          communityApiUrl: p.communityApiUrl ?? null,
        })),
        activePanelId: activeId ?? state.activePanelId ?? panels[0]?.id ?? null,
        panelWidgets,
        panelPositions,
        widgetVersions,
      }))
    } catch (err) {
      console.error('[useAppStore] refreshPanels failed:', err)
    }
  },

  refreshWidgets: async () => {
    try {
      const state = get()
      const panelWidgets: Record<string, WidgetInstance[]> = {}
      const panelPositions: Record<string, WidgetPosition[]> = {}
      const widgetVersions: Record<string, number> = {}
      for (const panel of state.panels) {
        const ws = await widgetsApi.getPanelWidgets(panel.id)
        // F4 修复：widget 映射必须与 initialize 完全一致，包含全部 7 个字段
        panelWidgets[panel.id] = ws.map(w => ({
          widgetId: w.id,
          widgetType: w.type,
          state: w.state,
          minimized: w.minimized,
          locked: w.locked,
          colorScheme: w.colorScheme ?? undefined,
          isPrimary: w.isPrimary ?? false,
        }))
        panelPositions[panel.id] = ws.map(w => ({
          widgetId: w.id,
          x: w.x,
          y: w.y,
          w: w.width,
          h: w.height,
          zIndex: w.zIndex,
        }))
        // Phase 4: 记录 widget 版本号
        for (const w of ws) {
          widgetVersions[w.id] = w.version
        }
      }
      set({ panelWidgets, panelPositions, widgetVersions })
    } catch (err) {
      console.error('[useAppStore] refreshWidgets failed:', err)
    }
  },

  refreshSettings: async () => {
    try {
      const settingsData = await settingsApi.getSettings()
      set({
        settings: {
          appearance: { ...DEFAULT_APPEARANCE, ...((settingsData.appearance as AppSettings['appearance']) || {}) },
          behavior: { ...DEFAULT_BEHAVIOR, ...((settingsData.behavior as AppSettings['behavior']) || {}) },
        },
      })
    } catch (err) {
      console.error('[useAppStore] refreshSettings failed:', err)
    }
  },

  refreshDynamicWidgets: async (options?: { desktop?: boolean }) => {
    try {
      const defs = await getAllDynamicWidgets(options)
      const { loadAndRegisterDynamicWidgets } = await import('../utils/evaluateWidget')
      loadAndRegisterDynamicWidgets(defs)
      set({ dynamicWidgets: defs })
    } catch (err) {
      console.error('[useAppStore] refreshDynamicWidgets failed:', err)
    }
  },

  // S12 新增：WS change 事件处理（spec S12.3-T11）
  // 替代桌面端 useAIStore.handleServerChange，分发到 refresh* 系列
  // 注意：useAppStore 无 refreshAll 方法，用 Promise.all(refresh*) 作为 fallback
  handleServerChange: async (changeType: string, _data: unknown, sourceDeviceId?: string) => {
    // 忽略自己发起的 change（避免循环）
    if (sourceDeviceId && sourceDeviceId === getDeviceId()) return

    const state = get()
    switch (changeType) {
      case 'panel':
      case 'panels':
        await state.refreshPanels()
        break
      case 'widget':
      case 'widgets':
        await state.refreshWidgets()
        break
      case 'entity':
      case 'entities':
        // S12 改造：refreshAll 不存在，fallback 到全量刷新
        await Promise.all([
          state.refreshPanels(),
          state.refreshWidgets(),
          state.refreshSettings(),
          state.refreshDynamicWidgets({ desktop: false }),
        ])
        break
      case 'setting':
      case 'settings':
        await state.refreshSettings()
        break
      case 'dynamic_widget':
      case 'dynamic_widgets':
        await state.refreshDynamicWidgets({ desktop: false })
        break
      case 'stroke':
      case 'connection':
        // 简化：全量刷新（refreshAll 不存在）
        await Promise.all([
          state.refreshPanels(),
          state.refreshWidgets(),
        ])
        break
      default:
        console.warn('[S12 WS] unknown changeType:', changeType)
        // fallback：全量刷新
        await Promise.all([
          state.refreshPanels(),
          state.refreshWidgets(),
          state.refreshSettings(),
          state.refreshDynamicWidgets({ desktop: false }),
        ])
    }
  },

  // ========== Phase 4: 架构基础改造（spec 任务 1）==========

  // 书签管理（本地状态管理，不持久化，后续接入服务器）
  bookmarks: [],
  addBookmark: async (url: string, title: string) => {
    const bookmark: Bookmark = {
      id: uuidv4(),
      url,
      title,
      showOnHome: true,
      createdAt: Date.now(),
    }
    set(state => ({ bookmarks: [...state.bookmarks, bookmark] }))
  },
  removeBookmark: async (id: string) => {
    set(state => ({ bookmarks: state.bookmarks.filter(b => b.id !== id) }))
  },
  toggleBookmarkHome: async (id: string) => {
    set(state => ({
      bookmarks: state.bookmarks.map(b =>
        b.id === id ? { ...b, showOnHome: !b.showOnHome } : b
      ),
    }))
  },

  // 冲突管理
  conflicts: {},
  addConflict: (widgetId: string, info: Omit<ConflictInfo, 'widgetId' | 'timestamp'>) => {
    set(state => ({
      conflicts: {
        ...state.conflicts,
        [widgetId]: {
          widgetId,
          timestamp: Date.now(),
          ...info,
        },
      },
    }))
  },
  resolveConflict: async (widgetId: string, action: 'keep-local' | 'keep-remote' | 'merge', mergedState?: Record<string, unknown>) => {
    const conflict = get().conflicts[widgetId]
    if (!conflict) return

    if (action === 'keep-remote') {
      // 保留远端：用远端状态更新本地
      const { panelWidgets } = get()
      for (const [panelId, widgets] of Object.entries(panelWidgets)) {
        const idx = widgets.findIndex(w => w.widgetId === widgetId)
        if (idx >= 0) {
          const updatedWidgets = [...widgets]
          updatedWidgets[idx] = { ...updatedWidgets[idx], state: conflict.remoteState }
          set({ panelWidgets: { ...panelWidgets, [panelId]: updatedWidgets } })
          break
        }
      }
      // 更新本地版本号为远端版本
      set(state => ({
        widgetVersions: { ...state.widgetVersions, [widgetId]: conflict.remoteVersion },
      }))
    } else if (action === 'keep-local' || action === 'merge') {
      // 保留本地/合并：用远端版本号重新提交本地（或合并后的）状态
      const stateToSave = action === 'merge' && mergedState ? mergedState : (() => {
        const { panelWidgets } = get()
        for (const widgets of Object.values(panelWidgets)) {
          const w = widgets.find(w => w.widgetId === widgetId)
          if (w) return w.state
        }
        return {}
      })()

      try {
        const updated = await widgetsApi.updateWidgetState(widgetId, stateToSave, conflict.remoteVersion)
        // 更新本地版本号
        set(state => ({
          widgetVersions: { ...state.widgetVersions, [widgetId]: updated.version },
        }))
        // 如果是合并，更新本地状态
        if (action === 'merge' && mergedState) {
          const { panelWidgets } = get()
          for (const [panelId, widgets] of Object.entries(panelWidgets)) {
            const idx = widgets.findIndex(w => w.widgetId === widgetId)
            if (idx >= 0) {
              const updatedWidgets = [...widgets]
              updatedWidgets[idx] = { ...updatedWidgets[idx], state: mergedState }
              set({ panelWidgets: { ...panelWidgets, [panelId]: updatedWidgets } })
              break
            }
          }
        }
      } catch (err) {
        // Phase 4：409 冲突时更新冲突信息（spec 2.5 节）
        if (err instanceof ApiError && err.status === 409) {
          const data = err.data as { currentVersion?: number; currentState?: Record<string, unknown> }
          if (data.currentVersion !== undefined && data.currentState !== undefined) {
            get().addConflict(widgetId, {
              localVersion: conflict.remoteVersion,
              remoteVersion: data.currentVersion,
              remoteState: data.currentState,
            })
            return  // 保留冲突状态，等待用户再次处理
          }
        }
        // 其他错误（如网络错误）：保留冲突状态，让用户可以重试
        console.error('[useAppStore] resolveConflict failed:', err)
        return
      }
    }

    // 成功完成，清除冲突
    get().clearConflict(widgetId)
  },
  clearConflict: (widgetId: string) => {
    set(state => {
      const newConflicts = { ...state.conflicts }
      delete newConflicts[widgetId]
      return { conflicts: newConflicts }
    })
  },

  // Widget 版本追踪
  widgetVersions: {},

  // ========== Phase 5: 收藏组件 ==========
  favorites: [],
  refreshFavorites: async () => {
    try {
      const dtos = await withFallback(
        () => favoritesApi.getAllFavorites(),
        () => getAllFavoritesFromIdb(),
      )
      const favorites: FavoriteEntry[] = dtos.map(dto => ({
        id: dto.id,
        widgetId: dto.widgetId,
        panelId: dto.panelId,
        widgetType: dto.widgetType,
        displayName: dto.displayName,
        positionSnapshot: dto.positionSnapshot,
        stateSnapshot: dto.stateSnapshot,
        createdAt: dto.createdAt,
      }))
      set({ favorites })
    } catch (err) {
      console.error('[useAppStore] refreshFavorites failed:', err)
    }
  },
  addFavorite: async (widgetId: string) => {
    const { panelWidgets, panelPositions } = get()
    // 查找 widget 所在面板
    let panelId: string | null = null
    let widget: WidgetInstance | undefined
    for (const [pid, widgets] of Object.entries(panelWidgets)) {
      const found = widgets.find(w => w.widgetId === widgetId)
      if (found) { panelId = pid; widget = found; break }
    }
    if (!panelId || !widget) {
      console.warn('[addFavorite] Widget not found:', widgetId)
      return
    }
    // 查找 position
    const pos = (panelPositions[panelId] ?? []).find(p => p.widgetId === widgetId)
    if (!pos) {
      console.warn('[addFavorite] Position not found for widget:', widgetId)
      return
    }
    // 从 registry 获取 displayName
    const config = getWidgetConfig(widget.widgetType)
    const displayName = config?.displayName ?? widget.widgetType
    // positionSnapshot 排除 widgetId
    const { widgetId: _, ...posSnapshot } = pos
    void _
    const now = Date.now()
    const favorite: FavoriteEntry = {
      id: uuidv4(),
      widgetId,
      panelId,
      widgetType: widget.widgetType,
      displayName,
      positionSnapshot: posSnapshot,
      stateSnapshot: JSON.parse(JSON.stringify(widget.state)),
      createdAt: now,
    }
    // M2: 使用服务器返回的对象替换本地 favorite 对象，确保多端 id 一致
    const created = await withFallback(
      async () => favoritesApi.createFavorite(favorite),
      async () => { await saveFavoriteToIdb(favorite); return favorite },
      { operation: 'create', entityType: 'favorite', entityId: favorite.id, payload: favorite },
    )
    Object.assign(favorite, created)
    // 按 widgetId 去重，避免"刷新预览"时创建重复条目（handleRefreshFavorite 调用 addFavorite）
    set(state => ({ favorites: [...state.favorites.filter(f => f.widgetId !== widgetId), favorite] }))
  },
  removeFavorite: async (favoriteId: string) => {
    await withFallback(
      () => favoritesApi.deleteFavorite(favoriteId),
      () => deleteFavoriteFromIdb(favoriteId),
      { operation: 'delete', entityType: 'favorite', entityId: favoriteId, payload: {} },
    )
    set(state => ({ favorites: state.favorites.filter(f => f.id !== favoriteId) }))
  },
  removeFavoriteByWidgetId: async (widgetId: string) => {
    await withFallback(
      () => favoritesApi.deleteFavoriteByWidgetId(widgetId),
      async () => {
        const fav = get().favorites.find(f => f.widgetId === widgetId)
        if (fav) await deleteFavoriteFromIdb(fav.id)
      },
      { operation: 'delete', entityType: 'favorite', entityId: widgetId, payload: { widgetId } },
    )
    set(state => ({ favorites: state.favorites.filter(f => f.widgetId !== widgetId) }))
  },
  removeFavoritesByPanelId: async (panelId: string) => {
    await withFallback(
      () => favoritesApi.deleteFavoritesByPanelId(panelId),
      () => deleteFavoritesByPanelIdFromIdb(panelId),
      { operation: 'delete', entityType: 'favorite', entityId: 'batch', payload: { panelId } },
    )
    set(state => ({ favorites: state.favorites.filter(f => f.panelId !== panelId) }))
  },
  isFavorited: (widgetId: string) => {
    return get().favorites.some(f => f.widgetId === widgetId)
  },
  getFavoriteByWidgetId: (widgetId: string) => {
    return get().favorites.find(f => f.widgetId === widgetId)
  },

  // ========== Phase 7 批次3 任务4：收藏组件管理（排序/分组/搜索）数据层 ==========
  // 初始 favoriteGroups 从 localStorage 读取（API 不可用时的降级数据源）
  favoriteGroups: loadFavoriteGroupsFromStorage(),
  favoriteSortBy: 'manual',
  favoriteSearchQuery: '',
  setFavoriteSortBy: (sortBy) => {
    set({ favoriteSortBy: sortBy })
  },
  setFavoriteSearchQuery: (query) => {
    set({ favoriteSearchQuery: query })
  },
  refreshFavoriteGroups: async () => {
    try {
      const groups = await withFallback(
        () => favoritesApi.listGroups(),
        async () => loadFavoriteGroupsFromStorage(),
      )
      set({ favoriteGroups: groups ?? [] })
      // 同步写回 localStorage，保证下次启动 API 不可用时仍有最新数据
      if (groups && groups.length > 0) {
        saveFavoriteGroupsToStorage(groups)
      }
    } catch (err) {
      console.error('[useAppStore] refreshFavoriteGroups failed:', err)
    }
  },
  createFavoriteGroup: async (name, color?) => {
    const now = Date.now()
    const localGroup: FavoriteGroup = {
      id: uuidv4(),
      name,
      color,
      sortIndex: get().favoriteGroups.length,
      createdAt: now,
    }
    try {
      const created = await withFallback(
        () => favoritesApi.createGroup(name, color),
        async () => { saveFavoriteGroupsToStorage([...get().favoriteGroups, localGroup]); return localGroup },
        { operation: 'create', entityType: 'favoriteGroup', entityId: localGroup.id, payload: localGroup },
      )
      const merged: FavoriteGroup = { ...localGroup, ...created }
      set(state => ({ favoriteGroups: [...state.favoriteGroups, merged] }))
      saveFavoriteGroupsToStorage(get().favoriteGroups)
      return merged
    } catch (err) {
      console.error('[useAppStore] createFavoriteGroup failed:', err)
      return null
    }
  },
  updateFavoriteGroup: async (id, patch) => {
    // 乐观更新：先改本地，再调 API；失败时回滚（保留旧数组引用）
    const prevGroups = get().favoriteGroups
    const updatedGroups = prevGroups.map(g => g.id === id ? { ...g, ...patch } : g)
    set({ favoriteGroups: updatedGroups })
    saveFavoriteGroupsToStorage(updatedGroups)
    try {
      await withFallback(
        () => favoritesApi.updateGroup(id, patch),
        async () => { /* localStorage 已更新，无需额外操作 */ },
        { operation: 'update', entityType: 'favoriteGroup', entityId: id, payload: patch },
      )
    } catch (err) {
      console.error('[useAppStore] updateFavoriteGroup failed, rolling back:', err)
      set({ favoriteGroups: prevGroups })
      saveFavoriteGroupsToStorage(prevGroups)
    }
  },
  deleteFavoriteGroup: async (id, migrateTo?) => {
    const prevGroups = get().favoriteGroups
    const prevFavorites = get().favorites
    // 乐观更新：移除分组，同时根据 migrateTo 处理组内收藏
    const updatedGroups = prevGroups.filter(g => g.id !== id)
    const updatedFavorites = prevFavorites.map(f => {
      if (f.groupId !== id) return f
      if (migrateTo) {
        const targetGroup = prevGroups.find(g => g.id === migrateTo)
        return { ...f, groupId: migrateTo, groupName: targetGroup?.name }
      }
      // 不迁移：置为未分组
      const { groupId: _gid, groupName: _gn, ...rest } = f
      void _gid
      void _gn
      return rest as FavoriteEntry
    })
    set({ favoriteGroups: updatedGroups, favorites: updatedFavorites })
    saveFavoriteGroupsToStorage(updatedGroups)
    try {
      await withFallback(
        () => favoritesApi.deleteGroup(id, migrateTo),
        async () => { /* localStorage 已更新 */ },
        { operation: 'delete', entityType: 'favoriteGroup', entityId: id, payload: { migrateTo } },
      )
    } catch (err) {
      console.error('[useAppStore] deleteFavoriteGroup failed, rolling back:', err)
      set({ favoriteGroups: prevGroups, favorites: prevFavorites })
      saveFavoriteGroupsToStorage(prevGroups)
    }
  },
  updateFavoriteSort: async (id, sortIndex) => {
    // 乐观更新：先改本地 favorites，再调 API
    const prevFavorites = get().favorites
    const updatedFavorites = prevFavorites.map(f =>
      f.id === id ? { ...f, sortIndex } : f
    )
    set({ favorites: updatedFavorites })
    try {
      await withFallback(
        () => favoritesApi.updateFavoriteSort(id, sortIndex),
        async () => { /* 降级：sortIndex 仅在本地 favorites 中生效，下次 refreshFavorites 丢失 */ },
        { operation: 'update', entityType: 'favoriteSort', entityId: id, payload: { sortIndex } },
      )
    } catch (err) {
      console.error('[useAppStore] updateFavoriteSort failed, rolling back:', err)
      set({ favorites: prevFavorites })
    }
  },
  updateFavoriteGroupAssignment: async (id, groupId?, groupName?) => {
    const prevFavorites = get().favorites
    const updatedFavorites = prevFavorites.map(f => {
      if (f.id !== id) return f
      if (groupId === undefined) {
        // 取消分组：移除 groupId/groupName 字段
        const { groupId: _gid, groupName: _gn, ...rest } = f
        void _gid
        void _gn
        return rest as FavoriteEntry
      }
      return { ...f, groupId, groupName: groupName ?? f.groupName }
    })
    set({ favorites: updatedFavorites })
    try {
      await withFallback(
        () => favoritesApi.updateFavoriteGroup(id, groupId, groupName),
        async () => { /* 降级：仅本地生效 */ },
        { operation: 'update', entityType: 'favoriteGroupAssignment', entityId: id, payload: { groupId, groupName } },
      )
    } catch (err) {
      console.error('[useAppStore] updateFavoriteGroupAssignment failed, rolling back:', err)
      set({ favorites: prevFavorites })
    }
  },

  // Phase 7 批次3 任务6：组件搜索浮层状态（替代 App.tsx 的 useState）
  showWidgetSearch: false,
  setShowWidgetSearch: (open) => set({ showWidgetSearch: open }),

  // ========== Phase S3 缺口 C+D：sync_failed 监听 + 失败 UI 提示（spec 2.3.3 / 2.4 节） ==========
  // 来自服务器的失败 sync_log 记录（由 useAIStore.handleServerChange 的 sync_failed 分支调用）
  // 与 syncQueue.ts 的 syncQueueFailedEntries Set 双源合并
  syncFailedEntries: [],
  addSyncFailedEntry: (event: SyncFailedEvent) => {
    set(state => {
      const idx = state.syncFailedEntries.findIndex(e => e.id === event.id)
      if (idx >= 0) {
        // 去重：已存在则更新 retryCount/lastError/updatedAt（保留 dismissed 状态，避免重复推送）
        const newEntries = [...state.syncFailedEntries]
        newEntries[idx] = {
          ...newEntries[idx],
          lastError: event.lastError ?? undefined,
          retryCount: event.retryCount,
          updatedAt: event.updatedAt,
        }
        return { syncFailedEntries: newEntries }
      }
      // 新增
      const entry: SyncFailedEntry = {
        id: event.id,
        deviceId: event.deviceId,
        operation: event.operation,
        entityType: event.entityType,
        entityId: event.entityId,
        lastError: event.lastError ?? undefined,
        retryCount: event.retryCount,
        updatedAt: event.updatedAt,
      }
      return { syncFailedEntries: [...state.syncFailedEntries, entry] }
    })
    // M-6 修复：通过 syncQueue.ts 暴露的封装函数操作本地 Set（双源统一）
    addFailedEntry(event.id)
  },
  clearSyncFailedEntry: (id: string) => {
    set(state => ({ syncFailedEntries: state.syncFailedEntries.filter(e => e.id !== id) }))
    // M-6 修复：同步移除 syncQueue.ts 的本地 Set 中的对应条目
    removeFailedEntry(id)
  },
  clearAllSyncFailedEntries: () => {
    set({ syncFailedEntries: [] })
    // M-6 修复：同步清空 syncQueue.ts 的本地 Set
    clearFailedEntries()
  },
  dismissSyncFailedEntry: (id: string) => {
    // 用户点击关闭按钮，标记 dismissed=true 但不删除（避免服务器再次推送时重复显示）
    set(state => ({
      syncFailedEntries: state.syncFailedEntries.map(e =>
        e.id === id ? { ...e, dismissed: true } : e,
      ),
    }))
  },
  retrySyncFailedEntry: async (id: string) => {
    // 调 api/syncLogs.retrySyncLog，成功后从集合移除；失败保持原状（让用户看到错误）
    try {
      const result = await retrySyncLog(id)
      if (result.ok) {
        // 成功后从集合移除
        set(state => ({ syncFailedEntries: state.syncFailedEntries.filter(e => e.id !== id) }))
        removeFailedEntry(id)
      }
    } catch (err) {
      // 重试失败保持原状（用户可看到错误信息并再次尝试）
      console.error('[useAppStore] retrySyncFailedEntry failed:', err)
    }
  },

  // ========== Phase 13.1.4：首次启动 Onboarding 门控状态 ==========
  hasCompletedOnboarding: false,
  onboardingChecked: false,
  onboardingLoadFailed: false,
  setHasCompletedOnboarding: async (v: boolean) => {
    set({ hasCompletedOnboarding: v, onboardingChecked: true })
    try {
      await setKvValue('onboarding-completed', v)
    } catch (err) {
      console.error('[useAppStore] persist onboarding state failed:', err)
    }
  },
}))

