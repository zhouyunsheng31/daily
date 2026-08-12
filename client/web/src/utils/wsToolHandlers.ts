/**
 * WS Tool Handlers — Phase 2E + Phase 3C
 *
 * 6 个工具的前端 WS 回调实现。后端 pi customTool 通过 WS 发送 tool_call 请求，
 * 前端在这里执行实际操作（操作画布 + IndexedDB），然后返回 tool_result。
 *
 * 工具列表（spec §5.6）：
 * 1. create_html_widget  — 创建 HTML widget（IndexedDB + 画布）
 * 2. update_html_widget  — 更新 HTML widget（画布 state + 布局 + IndexedDB）
 * 3. delete_html_widget  — 删除 HTML widget（画布 + IndexedDB）
 * 4. list_widgets        — 列出画布上所有 widget
 * 5. storage_read        — 读 KV 存储
 * 6. storage_write       — 写 KV 存储
 *
 * Phase 3C 尺寸协调机制：
 * - create/update 时记录 agentWidth/agentHeight 到 widget state（agent 期望尺寸）
 * - widget layout 的 w/h 是实际尺寸（用户可能拖拽调整）
 * - list_widgets 同时返回 agentWidth/agentHeight 和 actualWidth/actualHeight
 *   让 agent 感知用户是否调整过尺寸
 *
 * Note on IndexedDB linkage:
 * create_html_widget 先添加画布 widget 获取 widgetId，再用该 widgetId 作为
 * IndexedDB 记录的 id 写入 htmlWidgets 表。这样 widgetId == IDB id，
 * update/delete 可直接通过 widgetId 操作 IndexedDB 记录。
 *
 * S13 改造说明（web 端）：
 * - 删除 browserToolBridge import（web 端无 Electron <webview>）
 * - 18 个 browser_* 工具统一返回 not-supported 错误
 * - 新增 BROWSER_TOOLS 数组用于 executeToolCall 入口处快速判断
 */

import { createHtmlWidget, updateHtmlWidget, deleteHtmlWidget } from './dbStores/htmlWidgets'
import { getKvValue, setKvValue } from './dbStores/kvStorage'
import { getAllNotes, getNoteById } from './dbStores/notes'
import { getAllJournals, getJournalById } from './dbStores/journals'
import { getAllQuickNotes, getQuickNoteById } from './dbStores/quickNotes'
import { getAllMistakes, getMistakeById } from './dbStores/mistakes'
import {
  getAllSavingsGoals,
  getSavingsGoalById,
  getSavingsTransactionsByGoal,
} from './dbStores/savings'
import { getAllVocabDecks, getVocabDeckById } from './dbStores/vocabDecks'
import { getVocabProgressById, getVocabProgressByDeck } from './dbStores/vocabProgress'
import { useAppStore } from '../stores/useAppStore'
// Phase 5：背景层 + 弹出层 store（spec §3.2/§3.3）
import { useBackgroundStore } from '../stores/useBackgroundStore'
import { usePopupStore } from '../stores/usePopupStore'
// S13 改造1：删除 browserToolBridge import（web 端无 Electron <webview>，browser_* 全部降级）
// Phase 12：本地搜索工具集成（spec 3.7 节）
import { runLocalSearch } from './localSearch'
import type { LocalSearchParams } from '../types/ai'

/** 工具执行结果（与 WS 协议 tool_result 对应） */
export interface ToolCallResult {
  success: boolean
  data?: unknown
  error?: string
}

/** create_html_widget 工具参数 */
interface CreateHtmlWidgetParams {
  html: string
  x: number
  y: number
  width?: number
  height?: number
  title?: string
}

/** update_html_widget 工具参数 */
interface UpdateHtmlWidgetParams {
  id: string
  html?: string
  width?: number
  height?: number
  title?: string
}

/** Phase 2 决策38/39：set_widget_mini_html / set_widget_icon_html 工具参数 */
interface SetWidgetTierHtmlParams {
  widgetId: string
  html: string
}

/** delete_html_widget 工具参数 */
interface DeleteHtmlWidgetParams {
  id: string
}

/** storage_read 工具参数 */
interface StorageReadParams {
  key: string
  table?: string
}

/** storage_write 工具参数 */
interface StorageWriteParams {
  key: string
  value: unknown
}

/** 默认尺寸（与 builtInConfigs 中 htmlCanvas defaultLayout 保持一致） */
const DEFAULT_WIDGET_WIDTH = 400
const DEFAULT_WIDGET_HEIGHT = 300

// ============================================================================
// S13 改造5：BROWSER_TOOLS 数组（web 端新建，桌面端无此数组）
// ============================================================================

/**
 * 浏览器类工具名清单（18 项）
 *
 * 用于 executeToolCall 入口处快速判断工具是否为 browser_* 类，
 * 命中后统一返回 not-supported 错误。
 *
 * Web 端无 Electron <webview>，所有浏览器工具降级；
 * AI 收到 not-supported 后应能继续对话（fallback 到其他工具或提示用户用桌面端）。
 */
const BROWSER_TOOLS = [
  'browser_eval', 'browser_get_dom', 'browser_click', 'browser_input',
  'browser_scroll', 'browser_wait_for', 'browser_screenshot', 'browser_navigate',
  'browser_get_url', 'browser_get_title', 'browser_back', 'browser_forward',
  'browser_reload', 'browser_get_cookie', 'browser_set_cookie',
  'browser_open', 'browser_switch_tab', 'browser_list_tabs',
]

/**
 * 添加 widget 到画布并捕获新生成的 widgetId。
 *
 * useAppStore.addWidget 内部生成 widgetId 但不返回，这里通过 diff
 * panelWidgets 前后快照来捕获新 widgetId。
 */
async function addWidgetAndCaptureId(
  widgetType: string,
  options: {
    panelId?: string
    position?: { x: number; y: number; w: number; h: number }
    initialState?: Record<string, unknown>
  },
): Promise<string | null> {
  const appStore = useAppStore.getState()
  const panelId = options.panelId ?? appStore.activePanelId
  if (!panelId) return null

  const before = appStore.panelWidgets[panelId] ?? []
  await useAppStore.getState().addWidget(widgetType, { ...options, panelId })
  const after = useAppStore.getState().panelWidgets[panelId] ?? []
  const newWidget = after.find(w => !before.some(b => b.widgetId === w.widgetId))
  return newWidget?.widgetId ?? null
}

/**
 * 在 panelWidgets 中查找指定 widgetId 的 WidgetInstance。
 */
function findWidgetInstance(widgetId: string): { panelId: string; widget: import('../types').WidgetInstance } | null {
  const { panelWidgets } = useAppStore.getState()
  for (const [panelId, widgets] of Object.entries(panelWidgets)) {
    const widget = widgets.find(w => w.widgetId === widgetId)
    if (widget) return { panelId, widget }
  }
  return null
}

/**
 * 从 widget state 中读取 agentWidth/agentHeight（agent 期望尺寸）。
 * 不存在时返回 undefined。
 */
function readAgentSize(state: Record<string, unknown> | undefined): {
  agentWidth?: number
  agentHeight?: number
} {
  if (!state) return {}
  const agentWidth = typeof state.agentWidth === 'number' && Number.isFinite(state.agentWidth)
    ? state.agentWidth
    : undefined
  const agentHeight = typeof state.agentHeight === 'number' && Number.isFinite(state.agentHeight)
    ? state.agentHeight
    : undefined
  return { agentWidth, agentHeight }
}

// ============================================================================
// 6 个工具回调实现
// ============================================================================

/**
 * 1. create_html_widget
 * - 添加 htmlCanvas widget 到画布（widget state 是 source of truth）
 * - 在 widget state 中记录 agentWidth/agentHeight（agent 期望尺寸）
 * - 写入 IndexedDB（htmlWidgets 表，用 widgetId 作为 id）
 * - 返回 { id, width, height } 告知 agent 实际使用的尺寸
 */
async function handleCreateHtmlWidget(params: CreateHtmlWidgetParams): Promise<ToolCallResult> {
  const { html, x, y, width, height, title } = params

  if (typeof html !== 'string' || html.length === 0) {
    return { success: false, error: 'html is required and must be a non-empty string' }
  }
  if (typeof x !== 'number' || typeof y !== 'number') {
    return { success: false, error: 'x and y are required and must be numbers' }
  }

  // 1. 解析尺寸：传入则用传入值，否则用默认值
  const w = typeof width === 'number' && width > 0 ? width : DEFAULT_WIDGET_WIDTH
  const h = typeof height === 'number' && height > 0 ? height : DEFAULT_WIDGET_HEIGHT
  const now = Date.now()
  const widgetId = await addWidgetAndCaptureId('htmlCanvas', {
    position: { x, y, w, h },
    initialState: {
      html,
      title: title ?? 'HTML Widget',
      createdAt: now,
      updatedAt: now,
      // 记录 agent 期望的尺寸（与实际 w/h 一致，因为创建时无人为调整）
      agentWidth: w,
      agentHeight: h,
      schemaVersion: 1,
    },
  })

  if (!widgetId) {
    return { success: false, error: 'failed to add widget to canvas' }
  }

  // 2. 写入 IndexedDB（用 widgetId 作为 id，便于后续 update/delete）
  try {
    await createHtmlWidget({ html, title }, widgetId)
  } catch (err) {
    // IndexedDB 写入失败不阻断画布创建，仅记录
    console.warn('[wsToolHandlers] createHtmlWidget (IDB) failed:', err)
  }

  return {
    success: true,
    data: { id: widgetId, width: w, height: h },
  }
}

/**
 * 2. update_html_widget
 * - 更新画布 widget state（html / title / agentWidth / agentHeight）
 * - 如有 width/height，更新 widget 布局（实际 w/h）
 * - 同步更新 IndexedDB（用 widgetId 作为 id）
 * - 返回 { id, width, height } 告知 agent 当前实际尺寸
 *
 * spec §7 Phase 3: agent update_html_widget 时除非显式传 width/height，
 * 否则不覆盖当前 w/h（保留用户拖拽后的尺寸）。
 */
async function handleUpdateHtmlWidget(params: UpdateHtmlWidgetParams): Promise<ToolCallResult> {
  const { id, html, width, height, title } = params

  if (typeof id !== 'string' || id.length === 0) {
    return { success: false, error: 'id is required and must be a string' }
  }

  const found = findWidgetInstance(id)
  if (!found) {
    return { success: false, error: `widget not found: ${id}` }
  }

  // 1. 更新画布 widget state（html / title / agentWidth / agentHeight / updatedAt）
  const stateUpdate: Record<string, unknown> = { updatedAt: Date.now() }
  if (typeof html === 'string') stateUpdate.html = html
  if (typeof title === 'string') stateUpdate.title = title
  if (typeof width === 'number' && width > 0) stateUpdate.agentWidth = width
  if (typeof height === 'number' && height > 0) stateUpdate.agentHeight = height
  useAppStore.getState().updateWidgetState(id, stateUpdate)

  // 2. 如有 width/height，更新 widget 布局（实际 w/h）
  if (typeof width === 'number' && width > 0) {
    useAppStore.getState().updateWidgetPosition(id, { w: width })
  }
  if (typeof height === 'number' && height > 0) {
    useAppStore.getState().updateWidgetPosition(id, { h: height })
  }

  // 3. 同步更新 IndexedDB（用 widgetId 作为 id）
  try {
    const updates: { html?: string; title?: string } = {}
    if (typeof html === 'string') updates.html = html
    if (typeof title === 'string') updates.title = title
    if (Object.keys(updates).length > 0) {
      await updateHtmlWidget(id, updates)
    }
  } catch (err) {
    console.warn('[wsToolHandlers] updateHtmlWidget (IDB) failed:', err)
  }

  // 4. 读取更新后的实际尺寸返回给 agent
  const updated = findWidgetInstance(id)
  const positions = useAppStore.getState().panelPositions[found.panelId] ?? []
  const pos = positions.find(p => p.widgetId === id)
  const actualWidth = pos?.w ?? (typeof width === 'number' && width > 0 ? width : DEFAULT_WIDGET_WIDTH)
  const actualHeight = pos?.h ?? (typeof height === 'number' && height > 0 ? height : DEFAULT_WIDGET_HEIGHT)

  // 静默 unused 警告（updated 用于确认 widget 仍存在）
  void updated

  return { success: true, data: { id, width: actualWidth, height: actualHeight } }
}

// ============================================================================
// Phase 2 决策38/39：set_widget_mini_html / set_widget_icon_html
// AI 自定义 mini/icon 档 HTML，更新 widget.state.miniHtml / iconHtml
// 渲染时（Workspace.tsx）优先使用这两个字段，无则 fallback 到默认生成器
// ============================================================================

/**
 * set_widget_mini_html — 设置 widget 的 mini 档精简 HTML（决策38）
 * 更新 widget.state.miniHtml，并通过专用 REST API 持久化到服务端 widgets.state
 * 使用专用 POST /api/widgets/:id/mini-html 端点（服务端做 state 合并，避免覆盖并发修改）
 */
async function handleSetWidgetMiniHtml(params: SetWidgetTierHtmlParams): Promise<ToolCallResult> {
  const { widgetId, html } = params
  if (typeof widgetId !== 'string' || widgetId.length === 0) {
    return { success: false, error: 'widgetId is required and must be a string' }
  }
  if (typeof html !== 'string') {
    return { success: false, error: 'html is required and must be a string' }
  }

  const found = findWidgetInstance(widgetId)
  if (!found) {
    return { success: false, error: `widget not found: ${widgetId}` }
  }

  // 1. 更新画布 widget state（miniHtml + updatedAt）— 立即反馈 UI
  useAppStore.getState().updateWidgetState(widgetId, {
    miniHtml: html,
    updatedAt: Date.now(),
  })

  // 2. 通过专用 REST API 持久化到服务端（服务端合并 state，避免覆盖并发修改）
  try {
    const { uploadWidgetMiniHtml } = await import('../api/widgets')
    await uploadWidgetMiniHtml(widgetId, html)
  } catch (err) {
    // 持久化失败不阻断画布更新，仅记录（与 update_html_widget IDB 失败处理一致）
    console.warn('[wsToolHandlers] set_widget_mini_html persist failed:', err)
  }

  return { success: true, data: { widgetId, tier: 'mini' } }
}

/**
 * set_widget_icon_html — 设置 widget 的 icon 档 HTML 图标（决策39）
 * 更新 widget.state.iconHtml，并通过专用 REST API 持久化到服务端 widgets.state
 * 使用专用 POST /api/widgets/:id/icon-html 端点（服务端做 state 合并，避免覆盖并发修改）
 */
async function handleSetWidgetIconHtml(params: SetWidgetTierHtmlParams): Promise<ToolCallResult> {
  const { widgetId, html } = params
  if (typeof widgetId !== 'string' || widgetId.length === 0) {
    return { success: false, error: 'widgetId is required and must be a string' }
  }
  if (typeof html !== 'string') {
    return { success: false, error: 'html is required and must be a string' }
  }

  const found = findWidgetInstance(widgetId)
  if (!found) {
    return { success: false, error: `widget not found: ${widgetId}` }
  }

  // 1. 更新画布 widget state（iconHtml + updatedAt）— 立即反馈 UI
  useAppStore.getState().updateWidgetState(widgetId, {
    iconHtml: html,
    updatedAt: Date.now(),
  })

  // 2. 通过专用 REST API 持久化到服务端（服务端合并 state，避免覆盖并发修改）
  try {
    const { uploadWidgetIconHtml } = await import('../api/widgets')
    await uploadWidgetIconHtml(widgetId, html)
  } catch (err) {
    console.warn('[wsToolHandlers] set_widget_icon_html persist failed:', err)
  }

  return { success: true, data: { widgetId, tier: 'icon' } }
}

/**
 * 3. delete_html_widget
 * - 从画布删除 widget
 * - 同步删除 IndexedDB 记录（用 widgetId 作为 id）
 */
async function handleDeleteHtmlWidget(params: DeleteHtmlWidgetParams): Promise<ToolCallResult> {
  const { id } = params

  if (typeof id !== 'string' || id.length === 0) {
    return { success: false, error: 'id is required and must be a string' }
  }

  const found = findWidgetInstance(id)
  if (!found) {
    return { success: false, error: `widget not found: ${id}` }
  }

  // 1. 从画布删除（useAppStore.removeWidget 会拒绝删除主AI助手 widget）
  const removed = await useAppStore.getState().removeWidget(id)
  if (!removed) {
    return { success: false, error: `failed to remove widget from canvas: ${id} (may be primary AI assistant)` }
  }

  // 2. 同步删除 IndexedDB 记录（用 widgetId 作为 id）
  try {
    await deleteHtmlWidget(id)
  } catch (err) {
    console.warn('[wsToolHandlers] deleteHtmlWidget (IDB) failed:', err)
  }

  return { success: true, data: { id } }
}

/**
 * 4. list_widgets
 * - 读取 useAppStore.panelWidgets 返回当前画布上所有 widget 列表
 * - 对每个 widget 返回 agentWidth/agentHeight（agent 期望）和
 *   actualWidth/actualHeight（用户实际调整后的尺寸）
 *   让 agent 感知尺寸是否被用户调整过
 */
function handleListWidgets(): ToolCallResult {
  const { panelWidgets, panelPositions, activePanelId } = useAppStore.getState()

  const widgets: Array<{
    id: string
    type: string
    panelId: string
    title?: string
    position?: { x: number; y: number; w: number; h: number }
    isPrimary?: boolean
    agentWidth?: number
    agentHeight?: number
    actualWidth?: number
    actualHeight?: number
  }> = []

  for (const [panelId, widgetList] of Object.entries(panelWidgets)) {
    const positions = panelPositions[panelId] ?? []
    for (const widget of widgetList) {
      const pos = positions.find(p => p.widgetId === widget.widgetId)
      const title = typeof widget.state.title === 'string' ? widget.state.title : undefined
      const agentSize = readAgentSize(widget.state as Record<string, unknown> | undefined)
      widgets.push({
        id: widget.widgetId,
        type: widget.widgetType,
        panelId,
        title,
        position: pos ? { x: pos.x, y: pos.y, w: pos.w, h: pos.h } : undefined,
        isPrimary: widget.isPrimary,
        agentWidth: agentSize.agentWidth,
        agentHeight: agentSize.agentHeight,
        actualWidth: pos?.w,
        actualHeight: pos?.h,
      })
    }
  }

  return {
    success: true,
    data: { widgets, activePanelId, count: widgets.length },
  }
}

/**
 * 5. storage_read
 * - 从 KV 存储读取值，或从旧表读取归档数据
 *
 * Phase 4A: 扩展支持读旧表（归档只读）。
 * - 不传 table：从 kvStorage 读取（现有逻辑）
 * - 传 table：从对应旧表读取归档数据
 *   - key="all" → 列出全部记录
 *   - key="<id>" → 按 id 读取单条记录
 *   - savings 特殊 key: "transactions:<goalId>" → 读取某 goal 的所有交易
 *   - vocabProgress 特殊 key: "deck:<deckId>" → 读取某 deck 的所有进度（不支持 "all"）
 */
const LEGACY_TABLES = new Set<string>([
  'notes',
  'journals',
  'mistakes',
  'quickNotes',
  'savings',
  'vocabDecks',
  'vocabProgress',
])

/**
 * 从旧表读取归档数据（只读）。
 * 调用对应 dbStore 的 get/list 函数，复用 adapter.withFallback() 机制。
 *
 * 导出供 iframeProxy.ts 的 read_storage action 复用，避免逻辑重复。
 */
export async function readFromLegacyTable(table: string, key: string): Promise<ToolCallResult> {
  if (!LEGACY_TABLES.has(table)) {
    return {
      success: false,
      error: `unknown legacy table: ${table}. Supported tables: ${[...LEGACY_TABLES].join(', ')}`,
    }
  }

  try {
    let value: unknown

    switch (table) {
      case 'notes': {
        value = key === 'all' ? await getAllNotes() : await getNoteById(key)
        break
      }
      case 'journals': {
        value = key === 'all' ? await getAllJournals() : await getJournalById(key)
        break
      }
      case 'quickNotes': {
        value = key === 'all' ? await getAllQuickNotes() : await getQuickNoteById(key)
        break
      }
      case 'mistakes': {
        value = key === 'all' ? await getAllMistakes() : await getMistakeById(key)
        break
      }
      case 'savings': {
        if (key === 'all') {
          value = await getAllSavingsGoals()
        } else if (key.startsWith('transactions:')) {
          const goalId = key.slice('transactions:'.length)
          value = await getSavingsTransactionsByGoal(goalId)
        } else {
          value = await getSavingsGoalById(key)
        }
        break
      }
      case 'vocabDecks': {
        value = key === 'all' ? await getAllVocabDecks() : await getVocabDeckById(key)
        break
      }
      case 'vocabProgress': {
        if (key === 'all') {
          return {
            success: false,
            error:
              'vocabProgress does not support key="all" (potentially large dataset). ' +
              'Use key="deck:<deckId>" to list progress for a deck, or key="<id>" for a single record.',
          }
        }
        if (key.startsWith('deck:')) {
          const deckId = key.slice('deck:'.length)
          value = await getVocabProgressByDeck(deckId)
        } else {
          value = await getVocabProgressById(key)
        }
        break
      }
      default:
        // Unreachable because of the LEGACY_TABLES guard above, but keeps TS happy
        return { success: false, error: `unsupported legacy table: ${table}` }
    }

    return { success: true, data: { table, key, value } }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[wsToolHandlers] readFromLegacyTable(${table}, ${key}) failed:`, err)
    return { success: false, error: `failed to read from legacy table ${table}: ${message}` }
  }
}

async function handleStorageRead(params: StorageReadParams): Promise<ToolCallResult> {
  const { key, table } = params

  if (typeof key !== 'string' || key.length === 0) {
    return { success: false, error: 'key is required and must be a string' }
  }

  // 如果指定了 table，从旧表读取归档数据
  if (typeof table === 'string' && table.length > 0) {
    return readFromLegacyTable(table, key)
  }

  // 否则从 kvStorage 读取（现有逻辑）
  const value = await getKvValue(key)
  return { success: true, data: { key, value } }
}

/**
 * 6. storage_write
 * - 写入 KV 存储
 */
async function handleStorageWrite(params: StorageWriteParams): Promise<ToolCallResult> {
  const { key, value } = params

  if (typeof key !== 'string' || key.length === 0) {
    return { success: false, error: 'key is required and must be a string' }
  }

  await setKvValue(key, value)
  return { success: true, data: { key, success: true } }
}

// ============================================================================
// 统一分发入口
// ============================================================================

/**
 * 根据工具名分发到对应的前端回调。
 * 所有异常被捕获并转换为 { success: false, error } 结构。
 *
 * S13 改造说明（web 端）：
 * - 删除 browserToolsNeedingWidgetId Set + browserToolBridge 调用
 * - 入口处用 BROWSER_TOOLS 数组快速判断，统一返回 not-supported
 * - 保留 8 个数据类工具（create_html_widget/update_html_widget/delete_html_widget/
 *   list_widgets/storage_read/storage_write/local_search/query_capabilities）
 */
export async function executeToolCall(tool: string, params: unknown): Promise<ToolCallResult> {
  try {
    // S13 改造5：browser_* 工具统一降级返回 not-supported
    // Web 端无 Electron <webview>，所有浏览器工具不可执行
    // AI 收到错误后应能继续对话（fallback 或提示用户用桌面端）
    if (BROWSER_TOOLS.includes(tool)) {
      return {
        success: false,
        error: `Web 端不支持浏览器工具，请在桌面端操作 (tool: ${tool})`,
      }
    }

    switch (tool) {
      case 'create_html_widget':
        return await handleCreateHtmlWidget(params as CreateHtmlWidgetParams)
      case 'update_html_widget':
        return await handleUpdateHtmlWidget(params as UpdateHtmlWidgetParams)
      // Phase 2 决策38/39：mini/icon 档 AI 自定义 HTML
      case 'set_widget_mini_html':
        return await handleSetWidgetMiniHtml(params as SetWidgetTierHtmlParams)
      case 'set_widget_icon_html':
        return await handleSetWidgetIconHtml(params as SetWidgetTierHtmlParams)
      case 'delete_html_widget':
        return await handleDeleteHtmlWidget(params as DeleteHtmlWidgetParams)
      case 'list_widgets':
        return handleListWidgets()
      case 'storage_read':
        return await handleStorageRead(params as StorageReadParams)
      case 'storage_write':
        return await handleStorageWrite(params as StorageWriteParams)
      case 'local_search': {
        // Phase 12：本地搜索工具（spec 3.7 节）
        try {
          // 注意：外层 executeToolCall(tool, params: unknown) 已用 unknown 类型
          // 内层必须重命名变量，避免与外层 params 同名（TypeScript 编译错误）
          const localSearchParams = params as LocalSearchParams
          const result = await runLocalSearch(localSearchParams)
          return { success: true, data: result }
        } catch (err) {
          return {
            success: false,
            error: `local_search 执行失败：${err instanceof Error ? err.message : String(err)}`,
          }
        }
      }
      case 'query_capabilities': {
        const widgetType = (params as { widgetType?: string }).widgetType
        // Phase 14 B1：prod 模式 file:// 协议下用绝对 URL，dev 模式用相对路径
        const capabilitiesBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)
          ?? (typeof window !== 'undefined' && window.location.protocol === 'file:'
            ? 'http://localhost:3456/api'
            : '/api')
        const url = widgetType
          ? `${capabilitiesBase}/component-capabilities/${encodeURIComponent(widgetType)}`
          : `${capabilitiesBase}/component-capabilities`
        try {
          const resp = await fetch(url)
          if (!resp.ok) {
            return { success: false, error: `Server returned ${resp.status}: ${await resp.text()}` }
          }
          const data = await resp.json()
          return { success: true, data }
        } catch (err) {
          return { success: false, error: `Failed to fetch capabilities: ${(err as Error).message}` }
        }
      }
      // Phase 5：背景层工具（spec §3.2）
      case 'set_background': {
        const p = params as {
          type: 'color' | 'gradient' | 'image'
          color?: string
          gradient?: string
          imageUrl?: string
        }
        const bgStore = useBackgroundStore.getState()
        bgStore.setBackground({
          type: p.type,
          color: p.color,
          gradient: p.gradient,
          imageUrl: p.imageUrl,
        })
        return {
          success: true,
          data: { type: p.type, message: `Background set to ${p.type}` },
        }
      }
      case 'add_effect': {
        const p = params as {
          effect: 'none' | 'rain' | 'snow' | 'particles' | 'stars'
          config?: Record<string, unknown>
        }
        const bgStore = useBackgroundStore.getState()
        bgStore.addEffect({ effect: p.effect, config: p.config })
        return {
          success: true,
          data: { effect: p.effect, message: `Effect set to ${p.effect}` },
        }
      }
      case 'place_basic_component': {
        const p = params as {
          componentType: 'clock' | 'text' | 'image'
          position: { x: number; y: number }
          config?: Record<string, unknown>
        }
        if (!p.position || typeof p.position.x !== 'number' || typeof p.position.y !== 'number') {
          return { success: false, error: 'position.x and position.y are required numbers' }
        }
        const bgStore = useBackgroundStore.getState()
        const componentId = bgStore.placeBasicComponent({
          componentType: p.componentType,
          position: p.position,
          config: p.config,
        })
        return {
          success: true,
          data: { componentId, message: `Placed ${p.componentType} at (${p.position.x}, ${p.position.y})` },
        }
      }
      // Phase 5：弹出层工具（spec §3.3）
      case 'show_popup': {
        const p = params as {
          popupType: 'login' | 'html' | 'text' | 'image'
          content?: string
          title?: string
          closeOn?: string[]
          autoCloseMs?: number
          position?: { x?: number; y?: number }
        }
        const popupStore = usePopupStore.getState()
        const popupId = popupStore.showPopup({
          popupType: p.popupType,
          content: p.content,
          title: p.title,
          closeOn: p.closeOn as ('login_success' | 'manual' | 'timer' | 'ai_dismiss')[] | undefined,
          autoCloseMs: p.autoCloseMs,
          position: p.position,
          trigger: 'manual',
        })
        return {
          success: true,
          data: { popupId, message: `Popup ${p.popupType} shown` },
        }
      }
      case 'dismiss_popup': {
        const p = params as { popupId?: string }
        const popupStore = usePopupStore.getState()
        const count = popupStore.dismissPopup(p.popupId)
        return {
          success: true,
          data: { dismissedCount: count, message: `Dismissed ${count} popup(s)` },
        }
      }
      default:
        return { success: false, error: `unknown tool: ${tool}` }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[wsToolHandlers] tool "${tool}" failed:`, err)
    return { success: false, error: message }
  }
}
