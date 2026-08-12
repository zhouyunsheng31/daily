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
import { browserToolBridge } from './browserToolBridge'
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
async function handleCreateHtmlWidget(params: CreateHtmlWidgetParams, panelId?: string): Promise<ToolCallResult> {
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
    panelId,  // 修复：传入 tool_call 携带的 panelId，避免 widget 创建在错误的 panel 上
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
 */
export async function executeToolCall(tool: string, params: unknown, panelId?: string): Promise<ToolCallResult> {
  try {
    // 对于需要 widgetId 的浏览器工具，自动注入当前活跃的 webview widgetId
    // Pi Agent 调用浏览器工具时不传 widgetId，由前端自动确定活跃的网页组件
    const browserToolsNeedingWidgetId = new Set([
      'browser_eval', 'browser_get_dom', 'browser_click', 'browser_input',
      'browser_scroll', 'browser_wait_for', 'browser_screenshot', 'browser_navigate',
      'browser_get_url', 'browser_get_title', 'browser_back', 'browser_forward',
      'browser_reload', 'browser_get_cookie', 'browser_set_cookie',
    ])
    if (browserToolsNeedingWidgetId.has(tool)) {
      const p = (params ?? {}) as Record<string, unknown>
      if (!p.widgetId || typeof p.widgetId !== 'string') {
        // 从 useAppStore 获取 lastActiveWidgetId，检查是否在 browserToolBridge 中注册
        const lastActive = useAppStore.getState().lastActiveWidgetId
        const registered = browserToolBridge.getRegisteredWebviews()
        let activeId: string | undefined
        if (lastActive && registered.some(w => w.widgetId === lastActive)) {
          activeId = lastActive
        } else if (registered.length > 0) {
          activeId = registered[0].widgetId
        }
        if (!activeId) {
          return { success: false, error: 'No active webview. Please open a web page first.' }
        }
        p.widgetId = activeId
        params = p
      }
    }
    switch (tool) {
      case 'create_html_widget':
        return await handleCreateHtmlWidget(params as CreateHtmlWidgetParams, panelId)
      case 'update_html_widget':
        return await handleUpdateHtmlWidget(params as UpdateHtmlWidgetParams)
      case 'delete_html_widget':
        return await handleDeleteHtmlWidget(params as DeleteHtmlWidgetParams)
      case 'list_widgets':
        return handleListWidgets()
      case 'storage_read':
        return await handleStorageRead(params as StorageReadParams)
      case 'storage_write':
        return await handleStorageWrite(params as StorageWriteParams)
      case 'browser_eval':
        return await browserToolBridge.browserEval(params as { widgetId: string; script: string })
      case 'browser_get_dom':
        return await browserToolBridge.browserGetDom(params as { widgetId: string; selector?: string })
      case 'browser_click':
        return await browserToolBridge.browserClick(params as { widgetId: string; selector: string })
      case 'browser_input':
        return await browserToolBridge.browserInput(params as { widgetId: string; selector: string; text: string })
      case 'browser_scroll':
        return await browserToolBridge.browserScroll(params as { widgetId: string; x?: number; y?: number; selector?: string })
      case 'browser_wait_for':
        return await browserToolBridge.browserWaitFor(params as { widgetId: string; condition: string; timeout?: number })
      case 'browser_screenshot':
        return await browserToolBridge.browserScreenshot(params as { widgetId: string })
      case 'browser_navigate':
        return await browserToolBridge.browserNavigate(params as { widgetId: string; url: string })
      case 'browser_get_url':
        return browserToolBridge.browserGetUrl(params as { widgetId: string })
      case 'browser_get_title':
        return browserToolBridge.browserGetTitle(params as { widgetId: string })
      case 'browser_back':
        return browserToolBridge.browserBack(params as { widgetId: string })
      case 'browser_forward':
        return browserToolBridge.browserForward(params as { widgetId: string })
      case 'browser_reload':
        return browserToolBridge.browserReload(params as { widgetId: string })
      case 'browser_get_cookie':
        return await browserToolBridge.browserGetCookie(params as { widgetId: string })
      case 'browser_set_cookie':
        return await browserToolBridge.browserSetCookie(params as { widgetId: string; name: string; value: string; domain?: string })
      case 'browser_open':
        return await browserToolBridge.browserOpen(params as { url: string })
      case 'browser_switch_tab':
        return await browserToolBridge.browserSwitchTab(params as { widgetId: string })
      case 'browser_list_tabs':
        return browserToolBridge.browserListTabs()
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
      default:
        return { success: false, error: `unknown tool: ${tool}` }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[wsToolHandlers] tool "${tool}" failed:`, err)
    return { success: false, error: message }
  }
}
