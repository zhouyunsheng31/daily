/**
 * AI Store — Phase 2 WS Client
 *
 * Per spec section 5.6, useAIStore is rewritten as a WS client that subscribes
 * to the pi event stream (text_delta, tool_call, tool_result, agent_end) and
 * drives the UI based on events from the backend pi bridge.
 *
 * WS protocol (server/src/ws.ts):
 * - Frontend → Backend:
 *   - { kind: 'user_message', sessionId, content }
 *   - { kind: 'tool_result', requestId, success, data?, error? }
 *   - { kind: 'error_report', widgetId, message, stack?, source }
 * - Backend → Frontend:
 *   - { kind: 'tool_call', requestId, tool, params }
 *   - { kind: 'pi_event', event, data }
 *   - { kind: 'session_ready', sessionId }
 *   - { kind: 'error', message }
 *
 * Memory management (memories, loadMemories, updateMemory, etc.) is preserved
 * — it uses the aiData dbStore directly, no WS involved.
 *
 * LLM config management is simplified:
 * - fetchModels() returns a fixed list ['step-3.7-flash'] (pi backend is pre-configured)
 * - checkApiAvailability() checks WS connection state
 * - saveApiKey/loadApiKey remain stubs (pi backend uses VITE_STEPFUN_API_KEY env var)
 */

import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import type {
  SessionState,
  ChatMessage,
  LLMConfig,
  PermissionRequest,
  PermissionLevel,
  PermissionResponse,
  PrivacySettings,
  ApiKeyStorageMode,
  DataSendPreview,
  ToolCallRequest,
  AskUserOption,
  // Phase 12：搜索结果缓存类型（spec 3.9 节）
  SearchSourceEntry,
  LocalSearchHit,
  WebSearchHit,
  AcademicPaper,
  GithubRepoHit,
} from '../types/ai'
// Phase 12：搜索工具判断 + kind 映射 + 类型守卫（运行时函数，非 type）
import { isSearchTool, SEARCH_TOOL_KIND_MAP, isLocalSearchResult } from '../types/ai'
import type { AIMemory } from '../types'
import {
  getAllAIMemories,
  updateAIMemory,
  toggleAIMemoryPin,
  deleteAIMemory as deleteAIMemoryData,
  clearAllAIMemories,
} from '../utils/dbStores/aiData'
import { executeToolCall } from '../utils/wsToolHandlers'
import { getDeviceId, getServerToken } from '../utils/deviceAuth'
import { localServiceRegistry } from '../utils/localServiceRegistry'
import { useApiConfigStore } from './useApiConfigStore'
// Phase 9 批次1 模块8：离线降级 — 根据 effectiveMode 分流 sendMessage 到云端 WS 或本地 agent
import { useRuntimeModeStore } from './useRuntimeModeStore'
// Phase 9 批次2 模块2：本地 agent 调用 — 获取思考等级 + AgentEvent 类型
import { useThinkingLevelStore } from './useThinkingLevelStore'
import type { AgentEvent } from '../types/electron'
// Phase 12：搜索缓存失效（handleServerChange 接收服务器变更时 debounce 失效）
import { markSearchCacheStale } from '../utils/searchCache'
// Phase S3 缺口 C：sync_failed WS 事件载荷类型（spec 2.3.1 节）
import type { SyncFailedEvent } from '../types/syncLogs'

// ============================================================================
// WS message types (mirror of server/src/ws.ts)
// Phase 4：user_message 改用 panelId（spec 2.2 节），pi_event/session_ready/tool_call/error 增加 panelId
// ============================================================================

type ClientMessage =
  | { kind: 'user_message'; panelId?: string; content: string; sessionId?: string; apiConfig?: { endpoint: string; apiKey: string; model: string }; callerWidgetId?: string }
  | { kind: 'dispose_session'; panelId?: string; sessionId?: string }
  | { kind: 'tool_result'; requestId: string; success: boolean; data?: unknown; error?: string }
  | { kind: 'error_report'; widgetId: string; panelId?: string; message: string; stack?: string; source: string }
  | { kind: 'ping' }
  | { kind: 'proxy_response'; requestId: string; status: number; headers: Record<string, string>; body: string }
  // Phase 8 批次5 模块D：ask_user_response（客户端回复 ask_user 选择结果）
  | { kind: 'ask_user_response'; panelId: string; requestId: string; selectedValues: string[] }
  // Phase 8 批次5 模块F：permission_response（权限请求回复）
  | { kind: 'permission_response'; requestId: string; approved: boolean; rememberChoice?: boolean }
  // Phase 8 批次5 模块F：data_send_response（数据发送预览回复）
  | { kind: 'data_send_response'; sessionId: string; approved: boolean }

type ServerMessage =
  | { kind: 'tool_call'; requestId: string; tool: string; params: unknown; targetDeviceId?: string; panelId?: string }
  | { kind: 'pi_event'; event: string; data: unknown; panelId?: string }
  | { kind: 'session_ready'; sessionId: string; panelId?: string }
  | { kind: 'error'; message: string; panelId?: string }
  | { kind: 'pong' }
  | { kind: 'change'; changeType: string; data: unknown; sourceDeviceId?: string }
  | { kind: 'proxy_request'; requestId: string; serviceName: string; method: string; path: string; headers: Record<string, string>; body: string | null }
  // Phase 8 批次5 模块D：ask_user（AI 主动向用户提问，选项框形式）
  | { kind: 'ask_user'; panelId: string; requestId: string; question: string; options: AskUserOption[]; allowMultiple: boolean }
  // Phase 13.2.2：permission_request（服务端发起的权限请求，UI 弹 PermissionCard）
  | { kind: 'permission_request'; panelId: string; requestId: string; toolName: string; description: string; permission: string; storeName?: string; irreversible?: boolean; callerWidgetId?: string; arguments: Record<string, unknown> }

// ============================================================================
// Phase 8 批次3：SessionMeta + 会话列表持久化
// ============================================================================

// Phase 8 批次5 模块D：ask_user 待处理请求
interface AskUserPendingRequest {
  requestId: string
  sessionId: string
  question: string
  options: AskUserOption[]
  allowMultiple: boolean
  panelId: string
}

interface SessionMeta {
  sessionId: string
  title: string
  boundPanelId: string | null
  apiConfigId: string
  modelId: string
  createdAt: number
  updatedAt: number
  lastActivityAt: number
  messageCount: number
}

const SESSION_LIST_KEY = 'ai-session-list'

function loadSessionList(): SessionMeta[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(SESSION_LIST_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as SessionMeta[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function persistSessionList(list: SessionMeta[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(SESSION_LIST_KEY, JSON.stringify(list))
  } catch (err) {
    console.error('[useAIStore] persist sessionList failed:', err)
  }
}

function upsertSessionMeta(list: SessionMeta[], session: SessionState): SessionMeta[] {
  const meta: SessionMeta = {
    sessionId: session.sessionId,
    title: session.title,
    boundPanelId: session.boundPanelId,
    apiConfigId: session.apiConfigId,
    modelId: session.modelId,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    lastActivityAt: Date.now(),
    messageCount: session.messages.length,
  }
  const idx = list.findIndex(m => m.sessionId === meta.sessionId)
  if (idx >= 0) {
    const next = [...list]
    next[idx] = meta
    return next
  }
  return [...list, meta]
}

function removeSessionMeta(list: SessionMeta[], sessionId: string): SessionMeta[] {
  return list.filter(m => m.sessionId !== sessionId)
}

// ============================================================================
// WS connection manager (module-level singleton)
// ============================================================================

// WS_URL 基础地址（不含 query 参数）
// Phase 14 B1：prod 模式 file:// 协议下用绝对 URL，dev 模式用 window.location.host
// Phase 14 C4：从主进程获取动态端口（PORT=0 时由 OS 分配），fallback 到 3456
const WS_URL_BASE = (import.meta.env.VITE_WS_URL as string | undefined)
  ?? (typeof window !== 'undefined' && window.location.protocol === 'file:'
    ? `ws://localhost:${window.serverPortApi?.getServerPort() ?? 3456}/ws`
    : `ws://${window.location.host}/ws`)

/**
 * 构建带 deviceId + token 的完整 WS URL
 * 每次连接时调用（deviceId/token 可能在运行时被设置面板修改）
 */
function buildWsUrl(): string {
  const deviceId = getDeviceId()
  const token = getServerToken()
  const params = new URLSearchParams({ deviceId })
  if (token) params.set('token', token)
  return `${WS_URL_BASE}?${params.toString()}`
}
const WS_RECONNECT_BASE_MS = 1000
const WS_RECONNECT_MAX_MS = 30_000
const WS_PING_INTERVAL_MS = 30_000 // 每30秒发一次ping，防止代理超时关闭连接

let ws: WebSocket | null = null
let wsReconnectAttempts = 0
let wsReconnectTimer: ReturnType<typeof setTimeout> | null = null
let wsManuallyClosed = false
let wsPingTimer: ReturnType<typeof setInterval> | null = null

/** Callback invoked when WS connection state changes */
type OnlineHandler = (online: boolean) => void
/** Callback invoked when a server message arrives */
type MessageHandler = (msg: ServerMessage) => void

const onlineHandlers = new Set<OnlineHandler>()
const messageHandlers = new Set<MessageHandler>()

function notifyOnline(online: boolean): void {
  for (const h of onlineHandlers) {
    try {
      h(online)
    } catch (err) {
      console.error('[useAIStore] online handler error:', err)
    }
  }
}

function notifyMessage(msg: ServerMessage): void {
  for (const h of messageHandlers) {
    try {
      h(msg)
    } catch (err) {
      console.error('[useAIStore] message handler error:', err)
    }
  }
}

function scheduleReconnect(): void {
  if (wsManuallyClosed) return
  if (wsReconnectTimer) return
  const delay = Math.min(
    WS_RECONNECT_BASE_MS * Math.pow(2, wsReconnectAttempts),
    WS_RECONNECT_MAX_MS,
  )
  wsReconnectAttempts++
  console.log(`[useAIStore] WS reconnect in ${delay}ms (attempt ${wsReconnectAttempts})`)
  wsReconnectTimer = setTimeout(() => {
    wsReconnectTimer = null
    connectWs()
  }, delay)
}

function connectWs(): void {
  if (wsManuallyClosed) return
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return
  }

  const wsUrl = buildWsUrl()
  let thisWs: WebSocket
  try {
    thisWs = new WebSocket(wsUrl)
  } catch (err) {
    console.error('[useAIStore] WS construction failed:', err)
    scheduleReconnect()
    return
  }
  ws = thisWs

  thisWs.onopen = () => {
    console.log('[useAIStore] WS connected to', wsUrl.replace(/token=([^&]+)/, 'token=***'))
    wsReconnectAttempts = 0
    notifyOnline(true)

    // 启动心跳ping，防止代理/负载均衡器超时关闭空闲连接
    if (wsPingTimer) clearInterval(wsPingTimer)
    wsPingTimer = setInterval(() => {
      if (ws === thisWs && thisWs.readyState === WebSocket.OPEN) {
        try {
          thisWs.send(JSON.stringify({ kind: 'ping' }))
        } catch {
          // 连接可能已关闭，忽略
        }
      }
    }, WS_PING_INTERVAL_MS)

    // Phase 6.2：WS 连接成功后注册本地服务（spec 3.3.6 节）
    void (async () => {
      try {
        await localServiceRegistry.loadConfig()
        await localServiceRegistry.registerAll()
        localServiceRegistry.startHeartbeat()
      } catch (err) {
        console.error('[useAIStore] local service registry failed:', err)
      }
    })()
  }

  thisWs.onmessage = (event: MessageEvent) => {
    let msg: ServerMessage
    try {
      const raw = typeof event.data === 'string' ? event.data : String(event.data)
      msg = JSON.parse(raw) as ServerMessage
    } catch (err) {
      console.error('[useAIStore] WS message parse failed:', err)
      return
    }
    notifyMessage(msg)
  }

  thisWs.onclose = (ev: CloseEvent) => {
    console.log('[useAIStore] WS closed, code:', ev.code, 'reason:', ev.reason)
    // 只有当关闭的连接仍然是当前活跃连接时，才通知离线并触发重连。
    // 如果 ws !== thisWs，说明新连接已经建立（单连接模式下旧连接被踢掉），
    // 此时不应影响在线状态，也不应触发重连。
    if (ws === thisWs) {
      ws = null
      // 停止心跳定时器（仅在当前活跃连接关闭时清理）
      if (wsPingTimer) {
        clearInterval(wsPingTimer)
        wsPingTimer = null
      }
      // Phase 6.2：停止本地服务心跳（spec 3.3.6 节）
      localServiceRegistry.stopHeartbeat()
      // 如果被服务器主动踢掉（新连接替换），使用更长的退避时间重连，
      // 避免多标签页竞争时形成快速重连循环。
      // 正常断连使用指数退避（1s, 2s, 4s...），被替换时使用固定30s退避。
      if (ev.code === 1000 && ev.reason === 'replaced by new connection') {
        console.log('[useAIStore] Replaced by new connection, reconnecting in 30s')
        wsReconnectTimer = setTimeout(() => {
          wsReconnectTimer = null
          connectWs()
        }, 30_000)
        // 不立即通知离线 — 可能是同标签页的HMR重连，新连接即将建立
        // 如果5秒内没有新连接建立，再通知离线
        setTimeout(() => {
          if (!ws || ws.readyState !== WebSocket.OPEN) {
            notifyOnline(false)
          }
        }, 5000)
        return
      }
      notifyOnline(false)
      scheduleReconnect()
    }
  }

  thisWs.onerror = (err) => {
    console.error('[useAIStore] WS error:', err)
    // onclose will be called after onerror; reconnect scheduled there
  }
}

function sendWs(msg: ClientMessage): boolean {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.warn('[useAIStore] WS not open, cannot send:', msg.kind)
    return false
  }
  try {
    ws.send(JSON.stringify(msg))
    return true
  } catch (err) {
    console.error('[useAIStore] WS send failed:', err)
    return false
  }
}

function closeWs(): void {
  wsManuallyClosed = true
  if (wsReconnectTimer) {
    clearTimeout(wsReconnectTimer)
    wsReconnectTimer = null
  }
  if (wsPingTimer) {
    clearInterval(wsPingTimer)
    wsPingTimer = null
  }
  if (ws) {
    try {
      ws.close()
    } catch {
      // ignore
    }
    ws = null
  }
}

// ============================================================================
// Phase 3: useAppStore ref 机制（避免循环依赖，对称 useAppStore.setUseAIStoreRef）
// ============================================================================

let _useAppStoreRef: (() => typeof import('./useAppStore')['useAppStore']) | null = null
export function setUseAppStoreRef(ref: () => typeof import('./useAppStore')['useAppStore']): void {
  _useAppStoreRef = ref
}
function getUseAppStore(): typeof import('./useAppStore')['useAppStore'] {
  if (!_useAppStoreRef) {
    throw new Error('[useAIStore] useAppStore ref not set. Call setUseAppStoreRef first.')
  }
  return _useAppStoreRef()
}

// ============================================================================
// AIStoreState interface (unchanged from Phase 1 — consumers depend on it)
// ============================================================================

/** Phase 1 stub: app state provider not used; Phase 2 WS rewrite keeps it for compat */
export function registerAppStateProvider(_fn: () => Record<string, unknown>): void {
  // no-op
}

interface AIStoreState {
  // Sessions
  sessions: Record<string, SessionState>
  activeSessionId: string | null
  // Phase 8 批次3：会话列表持久化
  sessionList: SessionMeta[]

  // LLM config
  llmConfig: LLMConfig | null
  availableModels: string[]

  // Permission requests
  pendingPermissionRequests: Map<string, PermissionRequest>
  /** Separate map for permission responses (avoids mutating PermissionRequest type) */
  _permissionResponses: Map<string, PermissionResponse>

  // Phase 8 批次5 模块D：ask_user 待处理请求
  pendingAskUserRequests: Map<string, AskUserPendingRequest>

  // Privacy settings
  privacySettings: PrivacySettings

  // Global state
  isInitialized: boolean
  isOnline: boolean

  // Actions
  initialize: () => Promise<void>
  createSession: (options?: {
    title?: string
    boundPanelId?: string
    apiConfigId?: string
    modelId?: string
  }) => string
  sendMessage: (sessionId: string, content: string, callerWidgetId?: string, widgetPanelId?: string) => Promise<void>
  cancelRequest: (sessionId: string) => void
  respondToPermission: (requestId: string, response: PermissionResponse) => void
  // Phase 8 批次5 模块D：ask_user 回复
  respondToAskUser: (requestId: string, selectedValues: string[]) => void
  setLLMConfig: (config: Partial<LLMConfig>) => void
  acceptPrivacyNotice: () => void
  markStoreReadable: (storeName: string) => void
  markStoreUnreadable: (storeName: string) => void
  deleteSession: (sessionId: string) => Promise<void>
  loadSessionHistory: (sessionId: string) => Promise<void>
  checkApiAvailability: () => Promise<{ ok: boolean; error?: string }>
  fetchModels: () => Promise<{ models: string[]; error?: string }>
  getModelsUrl: () => string
  saveApiKey: (apiKey: string, mode: ApiKeyStorageMode, passphrase?: string) => Promise<void>
  loadApiKey: (passphrase?: string) => Promise<string | null>
  revokePersistedApiKey: () => Promise<void>
  confirmDataSend: (sessionId: string, preview: DataSendPreview) => void
  // Phase 8 批次5 模块F：拒绝数据发送预览
  rejectDataSend: (sessionId: string) => void
  revokeSessionStoreAuth: (sessionId: string, storeName: string) => void
  switchSession: (sessionId: string) => Promise<void>
  // Phase 8 批次3：会话 CRUD
  renameSession: (sessionId: string, newTitle: string) => void
  bindPanelToSession: (sessionId: string, panelId: string | null) => void
  setSessionApiConfig: (sessionId: string, apiConfigId: string) => void
  setSessionModel: (sessionId: string, modelId: string) => void
  // Widget 错误回传（Phase 3B：iframe 运行时错误 → 后端 → agent 自我修复）
  // S2 缺口 D：携带 panelId 让服务器三级兜底路由到对应面板的 agent
  reportWidgetError: (widgetId: string, panelId: string, error: { message: string; stack?: string; source: string }) => void
  // 记忆管理
  memories: AIMemory[]
  loadMemories: () => Promise<AIMemory[]>
  updateMemory: (id: string, updates: Partial<AIMemory>) => Promise<void>
  toggleMemoryPin: (id: string) => Promise<void>
  deleteMemory: (id: string) => Promise<void>
  clearAllMemories: () => Promise<void>

  // Phase 12：搜索结果缓存（spec 3.9 节改造点 1）
  searchResults: SearchSourceEntry[]
  addSearchResult: (entry: Omit<SearchSourceEntry, 'id' | 'timestamp'>) => void
  clearSearchResults: () => void
}

function createEmptySession(sessionId: string, options?: {
  title?: string
  boundPanelId?: string
  apiConfigId?: string
  modelId?: string
}): SessionState {
  // Phase 8 批次3：从 useApiConfigStore 获取默认 API 配置
  let defaultApiConfigId = ''
  let defaultModelId = 'step-3.7-flash'
  try {
    const apiState = useApiConfigStore.getState()
    const activePreset = apiState.presets.find(p => p.id === apiState.activePresetId) ?? apiState.presets[0]
    if (activePreset) {
      defaultApiConfigId = activePreset.id
      defaultModelId = activePreset.models[0] ?? defaultModelId
    }
  } catch {
    // useApiConfigStore 未初始化时用默认值
  }

  return {
    sessionId,
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    model: options?.modelId ?? defaultModelId,  // @deprecated 保留兼容
    modelId: options?.modelId ?? defaultModelId,
    status: 'idle',
    authorizedPrivateStores: [],
    hasConfirmedFirstSend: false,
    confirmedDataCategories: new Set(),
    confirmedModel: null,
    role: '生活助手',
    title: options?.title ?? `新会话 ${new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`,
    boundPanelId: options?.boundPanelId ?? null,
    apiConfigId: options?.apiConfigId ?? defaultApiConfigId,
  }
}

// ============================================================================
// pi event handling helpers
// ============================================================================

/**
 * Extract text delta from a pi message_update event.
 * pi sends: { type: 'message_update', message, assistantMessageEvent: { type: 'text_delta', delta } }
 */
function extractTextDelta(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null
  const e = data as { assistantMessageEvent?: { type?: string; delta?: string; text?: string } }
  const evt = e.assistantMessageEvent
  if (!evt) return null
  if (evt.type === 'text_delta') {
    if (typeof evt.delta === 'string') return evt.delta
    if (typeof evt.text === 'string') return evt.text
  }
  return null
}

/**
 * Extract tool info from a pi tool_execution_start event.
 * pi sends: { type: 'tool_execution_start', toolCallId, toolName, args }
 */
function extractToolStart(data: unknown): { toolCallId: string; toolName: string } | null {
  if (!data || typeof data !== 'object') return null
  const e = data as { toolCallId?: string; toolName?: string }
  if (typeof e.toolCallId === 'string' && typeof e.toolName === 'string') {
    return { toolCallId: e.toolCallId, toolName: e.toolName }
  }
  return null
}

// ============================================================================
// Store implementation
// ============================================================================

// Phase 12：handleServerChange debounce timer（模块级，跨 change 调用复用）
let cacheInvalidateTimer: ReturnType<typeof setTimeout> | null = null

// 修复：panelId → sessionId 映射，用于 handlePiEvent/error 按 panel 路由事件。
// 在 sendMessage 发送 user_message 时记录，解决画布 widget 用自己的 sessionId
// 而 handlePiEvent 硬编码用 activeSessionId 导致事件路由错误、widget 永远卡在 thinking 的问题。
const panelSessionMap = new Map<string, string>()

export const useAIStore = create<AIStoreState>((set, get) => {
  // ===== WS event handlers (closure-private) =====

  function handleServerMessage(msg: ServerMessage): void {
    // Phase 6.2：proxy_request 是设备级消息，不带 panelId，在 panelId 过滤之前处理
    if (msg.kind === 'proxy_request') {
      void handleProxyRequest(msg)
      return
    }

    // 修复：放宽 panelId 硬过滤。
    // 原逻辑：只处理当前活跃面板的事件，非活跃面板的消息全部丢弃。
    // 问题：画布会渲染非活跃面板的 widget，这些 widget 发消息后 server 回复的 pi_event
    //       会按 panelId 路由，但客户端按 activePanelId 过滤后全部丢弃，导致 widget 永远卡在 thinking。
    // 新逻辑：不再按 activePanelId 硬过滤，改为交给各 handler 用 panelId 自行路由。
    //   - pi_event → handlePiEvent 用 panelId 查 panelSessionMap 路由
    //   - error → 用 panelId 查 panelSessionMap 路由
    //   - session_ready → 用 msg.sessionId
    //   - ask_user/permission_request → 本身已按 panelId 查 session，不需要额外过滤
    //   - tool_call → 执行工具并返回结果，不更新 session 状态，不需要过滤
    //   - change/pong → 不带 panelId，不受影响

    switch (msg.kind) {
      case 'session_ready': {
        set({ activeSessionId: msg.sessionId })
        // 修复：仅在映射不存在时设置，避免服务端 sessionId 覆盖客户端的 sessionId 映射。
        // 服务端 session_ready 的 sessionId 是 pi-coding-agent SDK 的内部 ID，
        // 与客户端 createSession 生成的 uuidv4 不同，覆盖会导致后续 pi_event 路由到不存在的 session。
        if (msg.panelId && !panelSessionMap.has(msg.panelId)) {
          panelSessionMap.set(msg.panelId, msg.sessionId)
        }
        console.log('[useAIStore] session_ready:', msg.sessionId, 'panelId:', msg.panelId)
        break
      }

      case 'pi_event': {
        handlePiEvent(msg.event, msg.data, msg.panelId)
        break
      }

      case 'tool_call': {
        // Backend pi customTool wants us to execute a tool and return the result
        // 修复：传递 panelId 给工具执行，让 create_html_widget 等工具在正确的 panel 上操作
        void handleToolCall(msg.requestId, msg.tool, msg.params, msg.panelId)
        break
      }

      case 'error': {
        console.error('[useAIStore] server error:', msg.message)
        // 修复：优先用 panelId 查映射路由到正确 session，fallback 到 activeSessionId
        const sessionId = msg.panelId
          ? panelSessionMap.get(msg.panelId)
          : get().activeSessionId
        if (sessionId) {
          appendAssistantMessage(sessionId, `[error] ${msg.message}`)
          setSessionStatus(sessionId, 'error', msg.message)
        }
        break
      }

      case 'change': {
        // Phase 3 新增：服务器变更广播（其他设备修改数据后触发本端刷新）
        handleServerChange(msg.changeType, msg.data, msg.sourceDeviceId)
        break
      }

      case 'ask_user': {
        // Phase 8 批次5 模块D：AI 主动向用户提问
        // 找到对应的 session（通过 panelId → boundPanelId 映射）
        const session = Object.values(get().sessions).find(s => s.boundPanelId === msg.panelId)
        if (!session) break

        // 存入 pendingAskUserRequests
        const pending: AskUserPendingRequest = {
          requestId: msg.requestId,
          sessionId: session.sessionId,
          question: msg.question,
          options: msg.options,
          allowMultiple: msg.allowMultiple,
          panelId: msg.panelId,
        }
        get().pendingAskUserRequests.set(msg.requestId, pending)

        // 把 askUser 消息追加到 session.messages
        const askUserMessage: ChatMessage = {
          role: 'assistant',
          content: msg.question,
          timestamp: Date.now(),
          askUser: {
            requestId: msg.requestId,
            question: msg.question,
            options: msg.options,
            allowMultiple: msg.allowMultiple,
            answered: false,
          },
        }
        set(state => {
          const s = state.sessions[session.sessionId]
          if (!s) return state
          return {
            sessions: {
              ...state.sessions,
              [session.sessionId]: {
                ...s,
                messages: [...s.messages, askUserMessage],
                status: 'waiting_user_input',
              },
            },
          }
        })
        break
      }

      case 'permission_request': {
        // Phase 13.2.2：服务端发起权限请求，存入 pendingPermissionRequests 供 PermissionCard 渲染
        const request: PermissionRequest = {
          toolName: msg.toolName,
          permission: msg.permission as PermissionLevel,
          storeName: msg.storeName,
          arguments: msg.arguments,
          description: msg.description,
          irreversible: msg.irreversible,
          callerWidgetId: msg.callerWidgetId,
        }
        set(state => {
          const newMap = new Map(state.pendingPermissionRequests)
          newMap.set(msg.requestId, request)
          return { pendingPermissionRequests: newMap }
        })
        break
      }
    }
  }

  function handlePiEvent(event: string, data: unknown, panelId?: string): void {
    // 修复：优先用 panelId 查映射路由到正确 session。
    // 原逻辑硬编码用 activeSessionId，导致画布 widget（用自己的 sessionId）
    // 发消息后，回复事件被错误应用到 activeSessionId 对应的 session，
    // widget 的 session 永远停留在 thinking 状态。
    // 新逻辑：有 panelId 时用映射查 sessionId，找不到则不处理（避免错误应用）；
    //         无 panelId 时 fallback 到 activeSessionId（向后兼容）。
    const sessionId = panelId
      ? panelSessionMap.get(panelId)
      : get().activeSessionId
    if (!sessionId) return

    switch (event) {
      case 'agent_start': {
        setSessionStatus(sessionId, 'thinking')
        // Start a new assistant message buffer
        ensureStreamingAssistantMessage(sessionId)
        break
      }

      case 'agent_end': {
        // Finalize streaming assistant message
        finalizeStreamingAssistantMessage(sessionId)
        setSessionStatus(sessionId, 'idle')
        break
      }

      case 'message_start': {
        // A new assistant message begins — ensure streaming buffer exists
        ensureStreamingAssistantMessage(sessionId)
        break
      }

      case 'message_update': {
        const delta = extractTextDelta(data)
        if (delta) {
          appendTextDelta(sessionId, delta)
        }
        break
      }

      case 'message_end': {
        // Finalize current streaming message
        finalizeStreamingAssistantMessage(sessionId)
        break
      }

      case 'tool_execution_start': {
        const info = extractToolStart(data)
        if (info) {
          setSessionStatus(sessionId, 'tool_calling')
          // Append a tool-call marker message (UI can render progress)
          appendToolCallMessage(sessionId, info.toolName, info.toolCallId)
        }
        break
      }

      case 'tool_execution_end': {
        // Tool finished — restore thinking status (agent may continue)
        const s = get().sessions[sessionId]
        if (s && s.status === 'tool_calling') {
          setSessionStatus(sessionId, 'thinking')
        }
        break
      }

      default:
        // Other events (turn_start, turn_end, compaction_*, auto_retry_*, queue_update)
        // are ignored — UI doesn't need them for basic operation
        break
    }
  }

  async function handleToolCall(requestId: string, tool: string, params: unknown, panelId?: string): Promise<void> {
    const result = await executeToolCall(tool, params, panelId)
    sendWs({
      kind: 'tool_result',
      requestId,
      success: result.success,
      data: result.data,
      error: result.error,
    })

    // Phase 12：搜索工具结果缓存到 searchResults（spec 3.9 节改造点 2）
    if (result.success && isSearchTool(tool)) {
      const kind = SEARCH_TOOL_KIND_MAP[tool]
      const queryStr = typeof params === 'object' && params !== null && 'query' in params
        ? String((params as { query: unknown }).query || '')
        : ''
      let hits: ReadonlyArray<LocalSearchHit | WebSearchHit | AcademicPaper | GithubRepoHit> = []
      let total = 0
      let tookMs: number | undefined
      if (isLocalSearchResult(result.data)) {
        hits = result.data.results
        total = result.data.total
        tookMs = result.data.tookMs
      } else if (result.data && typeof result.data === 'object' && 'results' in result.data) {
        const d = result.data as { results?: unknown[]; total?: number; tookMs?: number }
        hits = Array.isArray(d.results) ? d.results as SearchSourceEntry['hits'] : []
        total = typeof d.total === 'number' ? d.total : 0
        tookMs = typeof d.tookMs === 'number' ? d.tookMs : undefined
      }
      get().addSearchResult({
        requestId,
        toolName: tool,
        kind,
        query: queryStr,
        hits,
        total,
        tookMs,
      })
    }
  }

  /**
   * Phase 9 批次2 模块2：处理本地 agent 事件
   *
   * 与 handlePiEvent（WS 模式）逻辑对齐，但接收的是简化后的 AgentEvent
   * （由 LocalAgentService.mapSessionEventToAgentEvent 转换）。
   *
   * 事件类型：
   * - text_delta：追加文本到当前 streaming assistant message
   * - tool_call：标记 tool_calling 状态 + 追加 tool call marker
   * - tool_result：恢复 thinking 状态（agent 可能继续）
   * - turn_end：finalize streaming message + 设置 idle 状态
   * - error：追加错误消息 + 设置 error 状态
   */
  function handleAgentEvent(sessionId: string, event: AgentEvent): void {
    switch (event.type) {
      case 'text_delta': {
        // 文本流：确保 streaming buffer 存在 + 追加 delta
        ensureStreamingAssistantMessage(sessionId)
        appendTextDelta(sessionId, event.text)
        break
      }

      case 'tool_call': {
        // 工具调用开始：标记 tool_calling + 追加 tool call marker
        setSessionStatus(sessionId, 'tool_calling')
        appendToolCallMessage(sessionId, event.toolName, event.requestId)
        break
      }

      case 'tool_result': {
        // 工具调用结束：恢复 thinking 状态（agent 可能继续）
        const s = get().sessions[sessionId]
        if (s && s.status === 'tool_calling') {
          setSessionStatus(sessionId, 'thinking')
        }
        break
      }

      case 'turn_end': {
        // agent 结束：finalize streaming message + 设置 idle
        finalizeStreamingAssistantMessage(sessionId)
        setSessionStatus(sessionId, 'idle')
        break
      }

      case 'error': {
        // 错误：追加错误消息 + 设置 error 状态
        appendAssistantMessage(sessionId, `[error] ${event.message}`)
        setSessionStatus(sessionId, 'error', event.message)
        break
      }
    }
  }

  /**
   * Phase 6.2：处理服务器发来的 proxy_request（spec 3.3.7 节）
   * 调用 localServiceRegistry 执行本地 fetch，返回 proxy_response
   */
  async function handleProxyRequest(msg: {
    requestId: string
    serviceName: string
    method: string
    path: string
    headers: Record<string, string>
    body: string | null
  }): Promise<void> {
    const response = await localServiceRegistry.handleProxyRequest(msg)
    sendWs({ kind: 'proxy_response', ...response })
  }

  /**
   * Phase 3: 处理服务器变更广播
   * 当其他设备修改数据时，服务器通过 WS 广播 change 消息，客户端刷新对应数据
   * 使用 ref 机制调用 useAppStore.getState()，避免循环依赖（F5 修复）
   * 注意：refreshPanels/refreshWidgets/refreshSettings 在步骤 18 中添加到 useAppStore，
   * 此处用可选类型 + optional chaining 保证前向兼容
   */
  function handleServerChange(changeType: string, data: unknown, sourceDeviceId?: string): void {
    // 如果是自己发起的变更，忽略（避免重复刷新）
    if (sourceDeviceId === getDeviceId()) return

    console.log(`[useAIStore] Received change: ${changeType}`, data)

    // Phase 12：跳过自己发起变更的检查之后，任何服务器变更都可能影响本地搜索缓存
    // 用 500ms debounce 合并连续 change，避免频繁重建
    if (cacheInvalidateTimer) clearTimeout(cacheInvalidateTimer)
    cacheInvalidateTimer = setTimeout(() => {
      markSearchCacheStale()
      cacheInvalidateTimer = null
    }, 500)

    // 通过 ref 机制调用 useAppStore.getState()，避免循环依赖
    const appStore = getUseAppStore().getState() as {
      refreshPanels?: () => Promise<void>
      refreshWidgets?: () => Promise<void>
      refreshSettings?: () => Promise<void>
      refreshDynamicWidgets?: () => Promise<void>
      addSyncFailedEntry?: (event: SyncFailedEvent) => void
    }
    switch (changeType) {
      case 'panel_created':
      case 'panel_updated':
      case 'panel_deleted':
      case 'panel_active_changed':
      case 'panels_reordered':
        void appStore.refreshPanels?.()
        break
      case 'widget_created':
      case 'widget_updated':
      case 'widget_deleted':
        void appStore.refreshWidgets?.()
        break
      case 'favorite_added':
      case 'favorite_removed':
      case 'favorite_panel_cleared':
        void (getUseAppStore().getState() as { refreshFavorites?: () => Promise<void> }).refreshFavorites?.()
        break
      case 'dynamic_widget_updated':
        // 动态组件元数据更新，刷新 dynamicWidgets 列表
        void appStore.refreshDynamicWidgets?.()
        break
      case 'entity_created':
      case 'entity_updated':
      case 'entity_deleted':
        // entities 按需刷新（当前不主动刷新，避免性能问题）
        break
      case 'settings_updated':
        void appStore.refreshSettings?.()
        break
      case 'data_imported':
        // 导入数据后全量刷新（panels + widgets + settings）
        void appStore.refreshPanels?.()
        void appStore.refreshWidgets?.()
        void appStore.refreshSettings?.()
        break
      case 'sync_failed': {
        // Phase S3 缺口 C：sync_failed WS 事件（spec 2.3.3 节）
        // 服务端 sync_logs PUT status=failed 时通过 sendToDevice + broadcastChange 推送
        // 客户端调用 useAppStore.addSyncFailedEntry 加入失败记录（去重 + 双源合并）
        const event = data as SyncFailedEvent
        appStore.addSyncFailedEntry?.(event)
        break
      }
      default:
        // 未知变更类型，忽略
        break
    }
  }

  // ===== Session message helpers =====

  function setSessionStatus(sessionId: string, status: SessionState['status'], error?: string): void {
    set(state => {
      const s = state.sessions[sessionId]
      if (!s) return state
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: { ...s, status, error, updatedAt: Date.now() },
        },
      }
    })
  }

  function appendAssistantMessage(sessionId: string, content: string): void {
    set(state => {
      const s = state.sessions[sessionId]
      if (!s) return state
      const msg: ChatMessage = {
        role: 'assistant',
        content,
        timestamp: Date.now(),
      }
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...s,
            messages: [...s.messages, msg],
            updatedAt: Date.now(),
          },
        },
      }
    })
  }

  /**
   * Ensure there's a "streaming" assistant message at the end of the messages
   * array. If the last message isn't an assistant message, append an empty one.
   */
  function ensureStreamingAssistantMessage(sessionId: string): void {
    set(state => {
      const s = state.sessions[sessionId]
      if (!s) return state
      const last = s.messages[s.messages.length - 1]
      if (last && last.role === 'assistant') return state
      const msg: ChatMessage = {
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
      }
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...s,
            messages: [...s.messages, msg],
            updatedAt: Date.now(),
          },
        },
      }
    })
  }

  function appendTextDelta(sessionId: string, delta: string): void {
    set(state => {
      const s = state.sessions[sessionId]
      if (!s) return state
      const messages = [...s.messages]
      const last = messages[messages.length - 1]
      if (!last || last.role !== 'assistant') {
        // No streaming assistant message — create one
        messages.push({
          role: 'assistant',
          content: delta,
          timestamp: Date.now(),
        })
      } else {
        messages[messages.length - 1] = {
          ...last,
          content: last.content + delta,
        }
      }
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: { ...s, messages, updatedAt: Date.now() },
        },
      }
    })
  }

  /**
   * Finalize the streaming assistant message — currently a no-op since we
   * append directly. Kept for future hooks (e.g. trimming, metadata).
   */
  function finalizeStreamingAssistantMessage(sessionId: string): void {
    set(state => {
      const s = state.sessions[sessionId]
      if (!s) return state
      const last = s.messages[s.messages.length - 1]
      if (!last || last.role !== 'assistant') return state
      // If the assistant message is empty, drop it (no content streamed)
      if (last.content.length === 0) {
        return {
          sessions: {
            ...state.sessions,
            [sessionId]: {
              ...s,
              messages: s.messages.slice(0, -1),
              updatedAt: Date.now(),
            },
          },
        }
      }
      return state
    })
  }

  function appendToolCallMessage(sessionId: string, toolName: string, toolCallId: string): void {
    set(state => {
      const s = state.sessions[sessionId]
      if (!s) return state
      const msg: ChatMessage = {
        role: 'tool',
        content: `调用工具: ${toolName}`,
        toolCallId,
        timestamp: Date.now(),
      }
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...s,
            messages: [...s.messages, msg],
            updatedAt: Date.now(),
          },
        },
      }
    })
  }

  function appendSystemMessage(sessionId: string, content: string): void {
    set(state => {
      const s = state.sessions[sessionId]
      if (!s) return state
      const msg: ChatMessage = {
        role: 'system',
        content,
        timestamp: Date.now(),
      }
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...s,
            messages: [...s.messages, msg],
            updatedAt: Date.now(),
          },
        },
      }
    })
  }

  // ===== Store state =====

  return {
    sessions: {},
    activeSessionId: null,
    sessionList: loadSessionList(),
    llmConfig: null,
    availableModels: [],
    pendingPermissionRequests: new Map(),
    _permissionResponses: new Map(),
    pendingAskUserRequests: new Map(),

    privacySettings: {
      hasAcceptedPrivacyNotice: false,
      aiReadableStores: [],
      apiKeyStorage: null,
    },
    isInitialized: false,
    isOnline: false,
    memories: [],
    // Phase 12：搜索结果缓存初始值（spec 3.9 节改造点 2）
    searchResults: [],

    // ===== Actions =====

    initialize: async () => {
      if (get().isInitialized) return

      // Register WS handlers
      onlineHandlers.add((online) => {
        set({ isOnline: online })
      })
      messageHandlers.add(handleServerMessage)

      // Start WS connection
      wsManuallyClosed = false
      connectWs()

      // Set up LLM config stub (pi backend uses env var VITE_STEPFUN_API_KEY)
      const envApiKey = import.meta.env.VITE_STEPFUN_API_KEY as string | undefined
      set({
        llmConfig: {
          endpoint: 'wss://pi-bridge-local',
          apiKey: envApiKey ?? '',
          model: 'step-3.7-flash',
          maxTokens: 8192,
          temperature: 0.7,
        },
        availableModels: ['step-3.7-flash'],
        isInitialized: true,
      })
    },

    createSession: (options) => {
      const sessionId = uuidv4()
      const session = createEmptySession(sessionId, options)
      set(state => ({
        sessions: { ...state.sessions, [sessionId]: session },
        activeSessionId: sessionId,
        sessionList: upsertSessionMeta(state.sessionList, session),
      }))
      persistSessionList(get().sessionList)
      return sessionId
    },

    sendMessage: async (sessionId, content, callerWidgetId?, widgetPanelId?) => {
      const session = get().sessions[sessionId]
      if (!session) return

      // Phase 9 批次1 模块8：根据 useRuntimeModeStore.effectiveMode 分流
      // - 'cloud'：走原有 WS 逻辑（服务器 Pi Agent）
      // - 'local'：走本地轻 agent（LocalAgentService，Phase 9 批次 2 实现）
      // 注意：保守改造，只加分支不删逻辑
      const runtimeModeState = useRuntimeModeStore.getState()
      if (runtimeModeState.effectiveMode === 'local') {
        // Phase 9 批次2 模块2：调用本地轻 agent
        // 通过 window.agentApi.sendMessage 发起 agent loop，事件通过 onEvent 推送
        const agentApi = window.agentApi
        if (!agentApi) {
          appendAssistantMessage(sessionId, '[本地 Agent] agentApi 不可用（preload 未加载或主进程未注册）')
          setSessionStatus(sessionId, 'error', 'agentApi not available')
          return
        }

        // 获取或生成 panelId（参考 server piBridge.ts:1146 纯对话模式 fallback）
        // 本地 agent 模式下 panelId 必须存在（用于 per-panel session 隔离）
        // 修复：优先用 widgetPanelId（widget 所在面板），避免跨 panel 错位
        const panelId = widgetPanelId ?? session.boundPanelId
          ?? getUseAppStore().getState().activePanelId
          ?? `session-only:${sessionId}`

        // 修复：记录 panelId → sessionId 映射，供 handleAgentEvent 路由（虽然 local 模式用闭包路由，但保持一致）
        if (panelId) panelSessionMap.set(panelId, sessionId)

        // 获取思考等级（useThinkingLevelStore 已映射到 pi 6 档中的 4 档）
        const piThinkingLevel = useThinkingLevelStore.getState().getPiThinkingLevel()

        // 订阅 agent 事件（按 panelId 过滤，避免跨面板串扰）
        const unsubscribe = agentApi.onEvent((data) => {
          if (data.panelId !== panelId) return
          handleAgentEvent(sessionId, data.event)
        })

        // 设置初始状态：thinking + 准备 streaming buffer
        setSessionStatus(sessionId, 'thinking')
        ensureStreamingAssistantMessage(sessionId)

        try {
          await agentApi.sendMessage({
            panelId,
            message: content,
            thinkingLevel: piThinkingLevel,
          })
          // agent loop 正常结束（turn_end 事件已在 handleAgentEvent 中处理）
        } catch (err) {
          appendAssistantMessage(sessionId, `[error] ${(err as Error).message}`)
          setSessionStatus(sessionId, 'error', (err as Error).message)
        } finally {
          unsubscribe()
        }
        return
      }

      // Phase 8 批次3：优先用 session.boundPanelId，fallback 到 activePanelId，都为 null 时进入纯对话模式
      // 修复：优先用 widgetPanelId（widget 所在面板），避免跨 panel 错位
      const panelId = widgetPanelId ?? session.boundPanelId ?? getUseAppStore().getState().activePanelId ?? undefined

      // Phase 8 批次3：apiKey 前置检查（M3 修复：apiConfigId 为空时也提示）
      const preset = useApiConfigStore.getState().getPreset(session.apiConfigId)
      if (!preset) {
        appendAssistantMessage(sessionId, '[提示] 未选择 API 配置，请在 ⚙️ API 配置中选择预设。')
        setSessionStatus(sessionId, 'error', 'no api config selected')
        return
      }
      // 从 safeStorage 异步读取加密存储的 apiKey（Electron 环境），
      // 非 Electron 环境 fallback 到 preset.apiKey 字段
      const apiKey = await useApiConfigStore.getState().resolveApiKey(preset.id)
      if (!apiKey) {
        appendAssistantMessage(sessionId, '[提示] 当前 API 配置未填写 apiKey，请先在 ⚙️ API 配置 中填写。')
        setSessionStatus(sessionId, 'error', 'api key missing')
        return
      }

      // Phase 8 批次3：携带 apiConfig
      const apiConfig = {
        endpoint: preset.endpoint,
        apiKey,
        model: session.modelId,
      }

      // Append user message to session
      const userMessage: ChatMessage = {
        role: 'user',
        content,
        timestamp: Date.now(),
      }
      set(state => {
        const s = state.sessions[sessionId]
        if (!s) return state
        const updatedSession = {
          ...s,
          messages: [...s.messages, userMessage],
          updatedAt: Date.now(),
        }
        return {
          sessions: {
            ...state.sessions,
            [sessionId]: updatedSession,
          },
          sessionList: upsertSessionMeta(state.sessionList, updatedSession),
        }
      })
      persistSessionList(get().sessionList)

      // Send to backend pi bridge via WS（Phase 8 批次3：携带 panelId/sessionId/apiConfig/callerWidgetId）
      const sent = sendWs({ kind: 'user_message', panelId, content, sessionId, apiConfig, callerWidgetId })
      if (!sent) {
        appendAssistantMessage(sessionId, '[连接错误] 无法连接到 AI 服务，请稍后重试。')
        setSessionStatus(sessionId, 'error', 'websocket not connected')
        return
      }

      // 修复：记录 panelId → sessionId 映射，供 handlePiEvent 按 panel 路由事件
      if (panelId) panelSessionMap.set(panelId, sessionId)

      // Set status to thinking (agent_start event will confirm)
      setSessionStatus(sessionId, 'thinking')
    },

    cancelRequest: (_sessionId) => {
      // Phase 2: pi session.cancel() not exposed via WS protocol yet
      // Future: add { kind: 'cancel' } message
    },

    respondToPermission: (requestId, response) => {
      // Phase 8 批次5 模块F：记录响应 + 发 WS permission_response 回复服务端
      // 注：不从 pendingPermissionRequests 删除，UI 通过 _permissionResponses 判断已处理状态（spec F.1 "已处理后显示状态"）
      set(state => {
        const newRespMap = new Map(state._permissionResponses)
        newRespMap.set(requestId, response)
        return { _permissionResponses: newRespMap }
      })
      sendWs({
        kind: 'permission_response',
        requestId,
        approved: response.approved,
        rememberChoice: response.rememberChoice,
      })
    },

    // Phase 8 批次5 模块D：ask_user 回复
    respondToAskUser: (requestId, selectedValues) => {
      const pending = get().pendingAskUserRequests.get(requestId)
      if (!pending) return

      // 发 WS 回复
      sendWs({
        kind: 'ask_user_response',
        requestId,
        selectedValues,
        panelId: pending.panelId,
      })

      // 更新对应 message 的 askUser 状态
      set(state => {
        const session = state.sessions[pending.sessionId]
        if (!session) return state
        const messages = session.messages.map(m =>
          m.askUser?.requestId === requestId
            ? { ...m, askUser: { ...m.askUser, answered: true, selectedValues } }
            : m
        )
        return {
          sessions: {
            ...state.sessions,
            [pending.sessionId]: {
              ...session,
              messages,
              status: session.status === 'waiting_user_input' ? 'thinking' : session.status,
            },
          },
        }
      })

      get().pendingAskUserRequests.delete(requestId)
    },

    setLLMConfig: (config) => {
      set(state => ({
        llmConfig: { ...state.llmConfig ?? { endpoint: '', apiKey: '', model: '', maxTokens: 8192, temperature: 0.7 }, ...config } as LLMConfig,
      }))
    },

    acceptPrivacyNotice: () => {
      set(state => ({
        privacySettings: {
          ...state.privacySettings,
          hasAcceptedPrivacyNotice: true,
        },
      }))
    },

    markStoreReadable: (storeName) => {
      set(state => ({
        privacySettings: {
          ...state.privacySettings,
          aiReadableStores: state.privacySettings.aiReadableStores.includes(storeName)
            ? state.privacySettings.aiReadableStores
            : [...state.privacySettings.aiReadableStores, storeName],
        },
      }))
    },

    markStoreUnreadable: (storeName) => {
      set(state => ({
        privacySettings: {
          ...state.privacySettings,
          aiReadableStores: state.privacySettings.aiReadableStores.filter(s => s !== storeName),
        },
      }))
    },

    deleteSession: async (sessionId) => {
      const session = get().sessions[sessionId]
      const meta = get().sessionList.find(m => m.sessionId === sessionId)
      const boundPanelId = session?.boundPanelId ?? meta?.boundPanelId ?? null
      // Phase 8 批次3：同步服务端 dispose_session（C3 修复：支持 session-only 模式 fallback）
      if (boundPanelId) {
        const sent = sendWs({ kind: 'dispose_session', panelId: boundPanelId })
        if (!sent) {
          console.warn(`[useAIStore] WS not open, dispose_session not sent for panel ${boundPanelId}`)
        }
      } else {
        // C3 修复：纯对话模式用 sessionId 让服务端清理 session-only:xxx
        const sent = sendWs({ kind: 'dispose_session', sessionId })
        if (!sent) {
          console.warn(`[useAIStore] WS not open, dispose_session not sent for session ${sessionId}`)
        }
      }

      // Phase 8 批次3：自动切换到下一个会话（M5 修复）
      const currentList = get().sessionList
      const idx = currentList.findIndex(m => m.sessionId === sessionId)
      const nextList = removeSessionMeta(currentList, sessionId)
      let nextActiveId: string | null = get().activeSessionId
      if (get().activeSessionId === sessionId) {
        // 取被删会话之后的第一个；若已是最后一个，取前一个
        nextActiveId = nextList[idx]?.sessionId ?? nextList[idx - 1]?.sessionId ?? null
      }

      set(state => {
        const newSessions = { ...state.sessions }
        delete newSessions[sessionId]
        return {
          sessions: newSessions,
          activeSessionId: nextActiveId,
          sessionList: nextList,
        }
      })
      persistSessionList(nextList)
    },

    loadSessionHistory: async (sessionId) => {
      const session = get().sessions[sessionId]
      if (!session) return
      const panelId = session.boundPanelId
      if (!panelId) return  // 未绑定面板的会话没有服务端历史

      try {
        const deviceId = getDeviceId()
        const token = getServerToken()
        // Phase 14 B1：prod 模式 file:// 协议下用绝对 URL，dev 模式用 window.location.origin
        // Phase 14 C4：从主进程获取动态端口（PORT=0 时由 OS 分配），fallback 到 3456
        const baseUrl = (import.meta.env.VITE_API_URL as string | undefined)
          ?? (typeof window !== 'undefined' && window.location.protocol === 'file:'
            ? `http://localhost:${window.serverPortApi?.getServerPort() ?? 3456}`
            : window.location.origin)
        const url = `${baseUrl}/api/panels/${encodeURIComponent(panelId)}/conversations?limit=50`
        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
        if (deviceId) headers['x-device-id'] = deviceId
        if (token) headers['Authorization'] = `Bearer ${token}`

        const resp = await fetch(url, { headers })
        if (!resp.ok) {
          console.warn(`[useAIStore] loadSessionHistory HTTP ${resp.status}`)
          return
        }
        const data = await resp.json() as Array<{
          role: string
          content: string
          tool_calls?: unknown
          tool_result?: { toolCallId?: string } | null
          created_at: number | string
        }>

        const messages: ChatMessage[] = data.map(item => ({
          role: (item.role === 'assistant' ? 'assistant' : item.role === 'user' ? 'user' : item.role === 'tool' ? 'tool' : 'system') as ChatMessage['role'],
          content: item.content ?? '',
          toolCallId: (item.tool_result as { toolCallId?: string } | null)?.toolCallId,
          toolCalls: Array.isArray(item.tool_calls) ? (item.tool_calls as ToolCallRequest[]) : undefined,
          timestamp: typeof item.created_at === 'number' ? item.created_at : new Date(item.created_at).getTime() || Date.now(),
        }))

        set(state => {
          const s = state.sessions[sessionId]
          if (!s) return state
          const updatedSession = {
            ...s,
            messages,
            updatedAt: Date.now(),
          }
          return {
            sessions: {
              ...state.sessions,
              [sessionId]: updatedSession,
            },
            sessionList: upsertSessionMeta(state.sessionList, updatedSession),
          }
        })
        persistSessionList(get().sessionList)
      } catch (err) {
        console.warn('[useAIStore] loadSessionHistory failed:', err)
      }
    },

    // ===== Phase 8 批次3：会话 CRUD =====

    renameSession: (sessionId, newTitle) => {
      set(state => {
        const s = state.sessions[sessionId]
        if (!s) return state
        const updatedSession = { ...s, title: newTitle, updatedAt: Date.now() }
        return {
          sessions: { ...state.sessions, [sessionId]: updatedSession },
          sessionList: upsertSessionMeta(state.sessionList, updatedSession),
        }
      })
      persistSessionList(get().sessionList)
    },

    bindPanelToSession: (sessionId, panelId) => {
      set(state => {
        const s = state.sessions[sessionId]
        if (!s) return state
        const updatedSession = { ...s, boundPanelId: panelId, updatedAt: Date.now() }
        return {
          sessions: { ...state.sessions, [sessionId]: updatedSession },
          sessionList: upsertSessionMeta(state.sessionList, updatedSession),
        }
      })
      persistSessionList(get().sessionList)
    },

    setSessionApiConfig: (sessionId, apiConfigId) => {
      set(state => {
        const s = state.sessions[sessionId]
        if (!s) return state
        const updatedSession = { ...s, apiConfigId, updatedAt: Date.now() }
        return {
          sessions: { ...state.sessions, [sessionId]: updatedSession },
          sessionList: upsertSessionMeta(state.sessionList, updatedSession),
        }
      })
      persistSessionList(get().sessionList)
    },

    setSessionModel: (sessionId, modelId) => {
      set(state => {
        const s = state.sessions[sessionId]
        if (!s) return state
        const updatedSession = { ...s, modelId, model: modelId, updatedAt: Date.now() }
        return {
          sessions: { ...state.sessions, [sessionId]: updatedSession },
          sessionList: upsertSessionMeta(state.sessionList, updatedSession),
        }
      })
      persistSessionList(get().sessionList)
    },

    checkApiAvailability: async () => {
      const online = get().isOnline
      if (online) return { ok: true }
      return { ok: false, error: 'websocket not connected to pi bridge' }
    },

    fetchModels: async () => {
      // pi backend is pre-configured with step-3.7-flash
      return { models: ['step-3.7-flash'] }
    },

    getModelsUrl: () => {
      // No HTTP models endpoint — pi bridge uses WS
      return ''
    },

    saveApiKey: async (apiKey, _mode, _passphrase) => {
      // Phase 2 stub: pi backend uses VITE_STEPFUN_API_KEY env var
      set(state => ({
        llmConfig: { ...state.llmConfig ?? { endpoint: '', apiKey: '', model: '', maxTokens: 8192, temperature: 0.7 }, apiKey } as LLMConfig,
      }))
    },

    loadApiKey: async () => {
      return get().llmConfig?.apiKey ?? null
    },

    revokePersistedApiKey: async () => {
      // Phase 2 stub: no persisted API key (env var)
    },

    confirmDataSend: (sessionId, _preview) => {
      // Phase 8 批次5 模块F：确认数据发送 — 清除 pendingSendPreview + 发 WS data_send_response
      set(state => {
        const s = state.sessions[sessionId]
        if (!s) return state
        const updatedSession = { ...s, pendingSendPreview: undefined, hasConfirmedFirstSend: true, updatedAt: Date.now() }
        return {
          sessions: { ...state.sessions, [sessionId]: updatedSession },
        }
      })
      sendWs({
        kind: 'data_send_response',
        sessionId,
        approved: true,
      })
    },

    rejectDataSend: (sessionId) => {
      // Phase 8 批次5 模块F：拒绝数据发送 — 清除 pendingSendPreview + 发 WS data_send_response(approved=false)
      set(state => {
        const s = state.sessions[sessionId]
        if (!s) return state
        const updatedSession = { ...s, pendingSendPreview: undefined, updatedAt: Date.now() }
        return {
          sessions: { ...state.sessions, [sessionId]: updatedSession },
        }
      })
      sendWs({
        kind: 'data_send_response',
        sessionId,
        approved: false,
      })
    },

    revokeSessionStoreAuth: (_sessionId, _storeName) => {
      // Phase 2 stub
    },

    switchSession: async (sessionId) => {
      set({ activeSessionId: sessionId })
      await get().loadSessionHistory(sessionId)
    },

    // ===== Widget 错误回传（Phase 3B） =====

    reportWidgetError: (widgetId, panelId, error) => {
      // 通过 WS 发送 error_report 到后端，后端再注入 agent 上下文
      // S2 缺口 D：携带 panelId 让服务器正确路由（不依赖 panelActiveDevices 反向查找）
      const sent = sendWs({
        kind: 'error_report',
        widgetId,
        panelId,
        message: error.message,
        stack: error.stack,
        source: error.source,
      })
      if (!sent) {
        console.warn(`[useAIStore] WS not open, widget error not reported: widgetId=${widgetId}`, error)
      }
      // 在当前会话追加一条系统消息（UI 可见，便于用户感知）
      const sessionId = get().activeSessionId
      if (sessionId) {
        appendSystemMessage(sessionId, `[Widget ${widgetId} 错误] ${error.message}`)
      }
    },

    // ===== 记忆管理（保留不动，使用 aiData dbStore） =====

    loadMemories: async () => {
      const memories = await getAllAIMemories()
      set({ memories })
      return memories
    },

    updateMemory: async (id, updates) => {
      await updateAIMemory(id, updates)
      const memories = await getAllAIMemories()
      set({ memories })
    },

    toggleMemoryPin: async (id) => {
      await toggleAIMemoryPin(id)
      const memories = await getAllAIMemories()
      set({ memories })
    },

    deleteMemory: async (id) => {
      await deleteAIMemoryData(id)
      const memories = await getAllAIMemories()
      set({ memories })
    },

    clearAllMemories: async () => {
      await clearAllAIMemories()
      set({ memories: [] })
    },

    // ===== Phase 12：搜索结果缓存 actions（spec 3.9 节改造点 3） =====

    addSearchResult: (entry) => {
      // 注：uuidv4 已在文件顶部 import（行 29：import { v4 as uuidv4 } from 'uuid'）
      const id = uuidv4()
      const timestamp = Date.now()
      set((state) => {
        const newEntry: SearchSourceEntry = { ...entry, id, timestamp }
        const next = [newEntry, ...state.searchResults]
        if (next.length > 20) next.length = 20  // LRU 截断
        return { searchResults: next }
      })
    },

    clearSearchResults: () => set({ searchResults: [] }),
  }
})

// Cleanup WS on page unload (browser-only)
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    closeWs()
  })
}

// HMR 边界处理：修改本文件时清理旧 WS 连接并自动重连
// 避免模块重载后 ws 变量重置为 null、旧 WebSocket 孤儿化、新 store 不初始化导致"离线中"
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    closeWs()
  })
  // HMR 重载后自动初始化（首次加载时 data.isHmr 为 undefined，不执行，由 App.tsx 正常调用）
  if (import.meta.hot.data.isHmr) {
    useAIStore.getState().initialize()
  }
  import.meta.hot.data.isHmr = true
}

// Phase 6.2：监听主进程 before-quit 通知，注销本地服务（spec 3.3.6 节）
if (typeof window !== 'undefined' && window.localServicesApi) {
  window.localServicesApi.onUnregister(() => {
    void localServiceRegistry.unregisterAll()
  })
}

// v10: 导出 useAIStoreType 供 useAppStore lazy reference 使用（避免循环依赖）
export type useAIStoreType = typeof useAIStore
