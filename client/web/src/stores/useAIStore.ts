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
 *
 * S13 改造说明（web 端，spec 改造1-8）：
 * - 改造1：WS_URL_BASE 删除 file:// 分支 + serverPortApi，始终用 window.location.host
 * - 改造3：sendMessage 删除 agentApi 分支，仅保留云端 WS 路径
 * - 改造4：initialize 保留无改造（无 agentApi 初始化，心跳在 connectWs onopen 中启动）
 * - 改造5：loadSessionHistory URL 删除 file:// 分支 + serverPortApi
 * - 改造6：删除 localServiceRegistry 所有使用处（import / connectWs onopen/onclose /
 *   handleProxyRequest / handleServerMessage proxy_request 分支 / handleAgentEvent /
 *   localServicesApi onUnregister 监听）
 * - 改造7：删除 handleServerChange 函数，'change' case 直接调用 useAppStore.handleServerChange
 * - 改造8：保留所有其他逻辑 + 新增 getUseAppStoreRef 导出（兼容 S12 stub 接口）
 *
 * 因 noUnusedLocals:true，删除后不再使用的 import 也一并删除：
 * - useRuntimeModeStore（仅 sendMessage agentApi 分支使用）
 * - useThinkingLevelStore（仅 sendMessage agentApi 分支使用）
 * - AgentEvent type（仅 handleAgentEvent 使用）
 * - markSearchCacheStale（仅 handleServerChange 使用）
 * - SyncFailedEvent type（仅 handleServerChange 使用）
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
  // S14.2-T4：GitHub 搜索子类型
  GithubCodeHit,
  GithubUserHit,
  GithubIssueHit,
  GithubDownloadResult,
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
// S13 改造6.7：删除 localServiceRegistry import（web 端无本地服务）
import { useApiConfigStore } from './useApiConfigStore'
// S13 改造3：删除 useRuntimeModeStore import（web 端只有云端模式，effectiveMode 分支已删）
// S13 改造3：删除 useThinkingLevelStore import（仅 sendMessage agentApi 分支使用，已删）
// S13 改造6.5：删除 AgentEvent type import（仅 handleAgentEvent 使用，已删）
// S13 改造7：删除 markSearchCacheStale + SyncFailedEvent import（仅 handleServerChange 使用，已删）

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
  // A6：cancel_request（用户主动停止 AI 响应，通知服务端 disposePanelSession）
  | { kind: 'cancel_request'; panelId?: string; sessionId?: string }

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

// S13 改造1：WS_URL_BASE 删除 file:// 分支 + serverPortApi
// Web 端始终同源，用 window.location.host
// S15 修复1：协议动态选择，HTTPS 下用 wss://，否则 ws://（避免混合内容拦截）
// S15 修复2：WS 路径跟随 vite BASE_URL 推导，/daily/ 子路径部署时自动用 /daily/ws
//           （避免与服务器现有 aihub /ws location 冲突）
const WS_PATH = import.meta.env.BASE_URL.replace(/\/$/, '') + '/ws'
const WS_URL_BASE = (import.meta.env.VITE_WS_URL as string | undefined)
  ?? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}${WS_PATH}`

/**
 * 构建带 deviceId + token 的完整 WS URL
 * 每次连接时调用（deviceId/token 可能在运行时被设置面板修改）
 *
 * S13 改造2：getServerToken() 已改造为优先从 sessionStorage['daily-jwt'] 读取 S12 JWT
 * （见 client/web/src/utils/deviceAuth.ts）
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

// ============================================================================
// A1：thinking 状态 watchdog（模块级 Map，避免放入 store state 触发 React 重渲染）
// 双层 watchdog 设计（v4 修复盲区）：
//   - 活动超时（120s 无 pi_event）→ 适合 WS 断开/无事件场景
//   - 绝对超时（5 分钟，不重置）→ 适合持续 message_update 但 agent_end 永不到达场景
// ============================================================================

const thinkingActivityWatchdogs = new Map<string, ReturnType<typeof setTimeout>>()
const thinkingAbsoluteWatchdogs = new Map<string, ReturnType<typeof setTimeout>>()
const THINKING_ACTIVITY_TIMEOUT_MS = 120_000 // 120s 无活动
const THINKING_ABSOLUTE_TIMEOUT_MS = 300_000 // 5 分钟绝对超时

/**
 * A1/A6：清理指定 session 的 pending 请求（ask_user + permission_request）
 * 用于 watchdog 触发、cancelRequest、WS 断开等场景，避免遗留 pending 卡住 UI
 */
function clearPendingForSession(sessionId: string): void {
  useAIStore.setState(s => {
    const newAskUser = new Map(s.pendingAskUserRequests)
    for (const [requestId, req] of newAskUser) {
      if (req.sessionId === sessionId) {
        newAskUser.delete(requestId)
      }
    }
    const newPermission = new Map(s.pendingPermissionRequests)
    for (const [requestId, req] of newPermission) {
      if (req.sessionId === sessionId) {
        newPermission.delete(requestId)
      }
    }
    return {
      pendingAskUserRequests: newAskUser,
      pendingPermissionRequests: newPermission,
    }
  })
}

/**
 * A1 触发动作：置 error 状态 + 追加系统消息 + 清理 pending + disarm
 */
function triggerWatchdogError(sessionId: string, reason: string, userMessage: string): void {
  const state = useAIStore.getState()
  const session = state.sessions[sessionId]
  if (!session) return
  // 双重检查：触发时若 session 已不在 thinking/tool_calling，不处理
  if (session.status !== 'thinking' && session.status !== 'tool_calling') return
  // 清理 pending
  clearPendingForSession(sessionId)
  // 追加系统消息 + 置 error 状态
  useAIStore.setState(s => {
    const sess = s.sessions[sessionId]
    if (!sess) return s
    const msg: ChatMessage = {
      role: 'assistant',
      content: userMessage,
      timestamp: Date.now(),
    }
    return {
      sessions: {
        ...s.sessions,
        [sessionId]: {
          ...sess,
          status: 'error' as const,
          error: reason,
          messages: [...sess.messages, msg],
          updatedAt: Date.now(),
        },
      },
    }
  })
  disarmThinkingWatchdog(sessionId)
}

/**
 * A1：arm thinking watchdog（同时启动活动超时 + 绝对超时）
 */
function armThinkingWatchdog(sessionId: string): void {
  disarmThinkingWatchdog(sessionId)
  // 活动超时：120s 无 pi_event → 触发
  const activityTimer = setTimeout(() => {
    triggerWatchdogError(
      sessionId,
      'AI 响应超时（120s 无活动），已自动结束',
      '[系统] AI 响应超时（120s 无活动），已自动结束。可重新发送或换种问法。',
    )
  }, THINKING_ACTIVITY_TIMEOUT_MS)
  thinkingActivityWatchdogs.set(sessionId, activityTimer)
  // 绝对超时：5 分钟（不重置，无论多少 pi_event）→ 触发
  const absoluteTimer = setTimeout(() => {
    triggerWatchdogError(
      sessionId,
      'AI 响应超时（5 分钟绝对超时），已自动结束',
      '[系统] AI 响应超时（5 分钟），已自动结束。可能 AI 陷入循环或任务过大，请简化任务或换种问法。',
    )
  }, THINKING_ABSOLUTE_TIMEOUT_MS)
  thinkingAbsoluteWatchdogs.set(sessionId, absoluteTimer)
}

/**
 * A1：重新 arm 活动超时（仅重置活动 timer，保留绝对 timer）
 * 用于收到 pi_event 时刷新活动信号
 */
function rearmActivityWatchdog(sessionId: string): void {
  const existing = thinkingActivityWatchdogs.get(sessionId)
  if (existing) {
    clearTimeout(existing)
  }
  const activityTimer = setTimeout(() => {
    triggerWatchdogError(
      sessionId,
      'AI 响应超时（120s 无活动），已自动结束',
      '[系统] AI 响应超时（120s 无活动），已自动结束。可重新发送或换种问法。',
    )
  }, THINKING_ACTIVITY_TIMEOUT_MS)
  thinkingActivityWatchdogs.set(sessionId, activityTimer)
}

/** A1：disarm thinking watchdog（清除活动 + 绝对两个 timer） */
function disarmThinkingWatchdog(sessionId: string): void {
  const activityTimer = thinkingActivityWatchdogs.get(sessionId)
  if (activityTimer) {
    clearTimeout(activityTimer)
    thinkingActivityWatchdogs.delete(sessionId)
  }
  const absoluteTimer = thinkingAbsoluteWatchdogs.get(sessionId)
  if (absoluteTimer) {
    clearTimeout(absoluteTimer)
    thinkingAbsoluteWatchdogs.delete(sessionId)
  }
}

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

    // S13 改造6.1：删除 connectWs onopen 中 localServiceRegistry 调用
    // Web 端无本地服务，onopen 仅保留 notifyOnline(true) + wsPingTimer 启动
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
      // S13 改造6.2：删除 localServiceRegistry.stopHeartbeat()（web 端无本地服务）
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

      // A3：WS 断开重置所有 thinking/tool_calling session（避免永久卡死）
      // setSessionStatus 会自动 disarm watchdog，但此处显式 disarm 以保险
      const sessions = useAIStore.getState().sessions
      const thinkingSids = Object.keys(sessions).filter(sid =>
        sessions[sid].status === 'thinking' || sessions[sid].status === 'tool_calling'
      )
      if (thinkingSids.length > 0) {
        useAIStore.setState(state => {
          const newSessions = { ...state.sessions }
          const now = Date.now()
          for (const sid of thinkingSids) {
            const s = newSessions[sid]
            if (!s) continue
            const msg: ChatMessage = {
              role: 'assistant',
              content: '[系统] 网络断开，AI 响应已中止。重连后可继续。',
              timestamp: now,
            }
            newSessions[sid] = {
              ...s,
              status: 'error' as const,
              error: 'websocket closed',
              messages: [...s.messages, msg],
              updatedAt: now,
            }
          }
          return { sessions: newSessions }
        })
        for (const sid of thinkingSids) {
          disarmThinkingWatchdog(sid)
        }
      }
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

// S13 改造8：新增 getUseAppStoreRef 导出（兼容 S12 stub 接口）
// 桌面端 L398 getUseAppStore 是内部函数不导出，但 web 端 S12 stub L75-77 导出了
// getUseAppStoreRef。S13 替换 useAIStore 时需新增此导出以兼容 S12 stub 接口。
export function getUseAppStoreRef(): typeof import('./useAppStore')['useAppStore'] {
  return getUseAppStore()
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
  sendMessage: (sessionId: string, content: string, callerWidgetId?: string) => Promise<void>
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

export const useAIStore = create<AIStoreState>((set, get) => {
  // ===== WS event handlers (closure-private) =====

  function handleServerMessage(msg: ServerMessage): void {
    // S13 改造6.4：删除 proxy_request if 分支（web 端无 localServiceRegistry）
    // 原桌面端在 panelId 过滤之前处理 proxy_request，web 端直接跳过

    // A2：error 消息一律 bypass panelId 过滤（不论是否携带 panelId）
    // 处理逻辑：用 activeSessionId 找当前 session；若没有则遍历找第一个 thinking/tool_calling session
    if (msg.kind === 'error') {
      console.error('[useAIStore] server error:', msg.message)
      const sid = get().activeSessionId
        ?? Object.values(get().sessions).find(s => s.status === 'thinking' || s.status === 'tool_calling')?.sessionId
      if (sid) {
        appendAssistantMessage(sid, `[error] ${msg.message}`)
        setSessionStatus(sid, 'error', msg.message)
      }
      return
    }

    // A4：pi_event + agent_end 按 boundPanelId 路由（兼容纯对话模式 session-only: 前缀）
    // 避免 panel A 的 agent_end 误关闭 panel B 的 session
    if (msg.kind === 'pi_event' && msg.event === 'agent_end' && msg.panelId !== undefined) {
      const sessions = get().sessions
      const msgPanelId = msg.panelId
      // 优先：boundPanelId !== null 且 === msg.panelId
      let targetSession = Object.values(sessions).find(s => s.boundPanelId !== null && s.boundPanelId === msgPanelId)
      // 若未找到且 msg.panelId 以 'session-only:' 开头（纯对话模式）
      if (!targetSession && msgPanelId.startsWith('session-only:')) {
        const sid = msgPanelId.slice('session-only:'.length)
        const candidate = sessions[sid]
        if (candidate && candidate.boundPanelId === null) {
          targetSession = candidate
        }
      }
      if (targetSession) {
        handlePiEvent(msg.event, msg.data, targetSession.sessionId)
        return
      }
      // 若仍未找到：fallback 走原 panelId 过滤（不 return，继续向下）
    }

    // 修复 1（核心）：bypass tool_call 的 panelId 过滤（避免静默丢弃导致服务端 30s TIMEOUT）
    // 服务端 executeViaWs 总是携带 panelId（piBridge.ts 第 319-326 行），
    // 若按原 panelId 过滤直接 return，tool_call 会被丢弃，不回 tool_result，
    // 服务端 30s 后必然 TIMEOUT，AI 进入无限循环。
    // 因此：panelId 不匹配时主动回传失败 tool_result，让服务端立即收到响应。
    if (msg.kind === 'tool_call') {
      const msgPanelId = msg.panelId
      const activePanelId = getUseAppStore().getState().activePanelId
      if (msgPanelId && (!activePanelId || msgPanelId !== activePanelId)) {
        // panelId 不匹配，主动回传失败 tool_result 避免服务端 30s TIMEOUT
        console.warn('[useAIStore] tool_call panelId mismatch, returning failure:', {
          tool: msg.tool,
          msgPanelId,
          activePanelId,
        })
        sendWs({
          kind: 'tool_result',
          requestId: msg.requestId,
          success: false,
          error: `panel not active (msgPanelId=${msgPanelId}, activePanelId=${activePanelId ?? 'null'})`,
        })
        return
      }
      // panelId 匹配或无 panelId，正常进入 handleToolCall 处理（不重复走 case 'tool_call' 分支）
      void handleToolCall(msg.requestId, msg.tool, msg.params)
      return
    }

    // Phase 4：按 panelId 过滤（spec 2.2 节）
    // 只处理当前活跃面板的事件；若消息未携带 panelId（如 change/pong），不过滤
    if ('panelId' in msg && msg.panelId !== undefined) {
      const activePanelId = getUseAppStore().getState().activePanelId
      // 活跃面板为 null 时，所有带 panelId 的消息都忽略（避免错乱）
      if (!activePanelId || msg.panelId !== activePanelId) {
        return
      }
    }

    switch (msg.kind) {
      case 'session_ready': {
        set({ activeSessionId: msg.sessionId })
        console.log('[useAIStore] session_ready:', msg.sessionId, 'panelId:', msg.panelId)
        break
      }

      case 'pi_event': {
        handlePiEvent(msg.event, msg.data)
        break
      }

      // 修复 1：case 'tool_call' 已移到函数顶部 bypass 处理（panelId 过滤之前），
      // 避免静默丢弃导致服务端 30s TIMEOUT；此处 switch 不可达，删除以通过 TS 类型收窄检查

      // A2：case 'error' 已移到函数顶部 bypass 处理，此处不再需要

      case 'change': {
        // S13 改造7：删除 useAIStore.handleServerChange 函数
        // 'change' case 直接调用 useAppStore.handleServerChange（S12 已实现）
        // 注意：useAppStore.handleServerChange 内部会忽略自己发起的变更
        void getUseAppStore().getState().handleServerChange(
          msg.changeType,
          msg.data,
          msg.sourceDeviceId,
        )
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
        // A1：disarm 当前 session 的 watchdog（通过 msg.panelId 反查 session，与 ask_user 一致）
        const session = Object.values(get().sessions).find(s => s.boundPanelId === msg.panelId)
        const sid = session?.sessionId ?? get().activeSessionId ?? ''
        if (sid) {
          disarmThinkingWatchdog(sid)
        }
        const request: PermissionRequest = {
          sessionId: sid, // A6 补充：保存 sessionId 用于 clearPendingForSession 清理
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

  function handlePiEvent(event: string, data: unknown, targetSessionId?: string): void {
    const sessionId = targetSessionId ?? get().activeSessionId
    if (!sessionId) return

    // A3：status guard — 防止重连后旧 pi_event 污染已 error 的 session
    // agent_end 仍允许处理（idempotent finalize，且能从 error 转为 idle 是合理的"恢复"信号）
    const session = get().sessions[sessionId]
    if (session && session.status === 'error' && event !== 'agent_end') {
      return
    }

    // A1：非 agent_end 事件重新 arm 活动 watchdog（活动信号，仅重置活动 timer，保留绝对 timer）
    // agent_start/tool_execution_start 会调用 setSessionStatus 重新 arm，此处 arm 是冗余但安全的
    // v4 修复盲区：持续 message_update 不应阻止绝对超时触发，所以用 rearmActivityWatchdog 而非 armThinkingWatchdog
    if (event !== 'agent_end' && session && (session.status === 'thinking' || session.status === 'tool_calling')) {
      rearmActivityWatchdog(sessionId)
    }

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

  async function handleToolCall(requestId: string, tool: string, params: unknown): Promise<void> {
    // 修复 2（防御性）：整段 try/catch 兜底，避免 executeToolCall 之外的异常导致无 tool_result
    try {
      const result = await executeToolCall(tool, params)
      const sent = sendWs({
        kind: 'tool_result',
        requestId,
        success: result.success,
        data: result.data,
        error: result.error,
      })
      if (!sent) {
        console.warn('[useAIStore] tool_result send failed (WS not open), server will TIMEOUT:', {
          requestId,
          tool,
        })
      }

    // Phase 12：搜索工具结果缓存到 searchResults（spec 3.9 节改造点 2）
    // S14.2-T4 改造：兼容 papers/items/download/mode 字段
    if (result.success && isSearchTool(tool)) {
      const kind = SEARCH_TOOL_KIND_MAP[tool]
      const queryStr = typeof params === 'object' && params !== null && 'query' in params
        ? String((params as { query: unknown }).query || '')
        : ''
      let hits: ReadonlyArray<LocalSearchHit | WebSearchHit | AcademicPaper | GithubRepoHit | GithubCodeHit | GithubUserHit | GithubIssueHit | GithubDownloadResult> = []
      let total = 0
      let tookMs: number | undefined
      // S14.2 新增字段
      let mode: string | undefined
      // S15 修复：items 类型从 unknown[] 改为与 hits 相同的联合类型（修复 TS2322）
      let items: ReadonlyArray<LocalSearchHit | WebSearchHit | AcademicPaper | GithubRepoHit | GithubCodeHit | GithubUserHit | GithubIssueHit | GithubDownloadResult> | undefined
      let download: GithubDownloadResult | undefined

      if (isLocalSearchResult(result.data)) {
        // local_search 结果
        hits = result.data.results
        total = result.data.total
        tookMs = result.data.tookMs
      } else if (result.data && typeof result.data === 'object') {
        const d = result.data as Record<string, unknown>
        // web_search 结果（results 字段）
        if (Array.isArray(d.results)) {
          hits = d.results as SearchSourceEntry['hits']
          total = typeof d.total === 'number' ? d.total : 0
          tookMs = typeof d.tookMs === 'number' ? d.tookMs : undefined
        }
        // academic_search 结果（papers 字段）
        else if (Array.isArray(d.papers)) {
          hits = d.papers as AcademicPaper[]
          total = typeof d.total === 'number' ? d.total : (d.papers as unknown[]).length
          tookMs = typeof d.tookMs === 'number' ? d.tookMs : undefined
        }
        // S14 修复（spec L674-679）：github_search download mode 优先判断（download mode 不含 items）
        // 必须放在 items 分支之前，避免 download mode 被误分到 items 分支
        else if (d.download && typeof d.download === 'object') {
          download = d.download as GithubDownloadResult
          mode = typeof d.mode === 'string' ? d.mode : undefined
          hits = [download]  // 单元素数组
          total = 1
        }
        // github_search 结果（items + mode 字段）
        else if (Array.isArray(d.items)) {
          // S15 修复：d.items 类型断言为联合类型（与 hits 类型一致）
          items = d.items as typeof items
          mode = typeof d.mode === 'string' ? d.mode : undefined
          hits = d.items as GithubRepoHit[]
          total = typeof d.total === 'number' ? d.total : d.items.length
          tookMs = typeof d.tookMs === 'number' ? d.tookMs : undefined
        }
      }

      get().addSearchResult({
        requestId,
        toolName: tool,
        kind,
        query: queryStr,
        hits,
        total,
        tookMs,
        // S14.2 新增字段（可选）
        mode,
        items,
        download,
      })
    }
    } catch (err) {
      console.error('[useAIStore] handleToolCall unexpected error:', err)
      sendWs({
        kind: 'tool_result',
        requestId,
        success: false,
        error: `unexpected error: ${err instanceof Error ? err.message : String(err)}`,
      })
    }
  }

  // S13 改造6.5：删除 handleAgentEvent 函数
  // 原桌面端 handleAgentEvent 仅用于本地 agent 模式（agentApi.onEvent 回调）
  // Web 端无本地 agent，pi_event 通过 WS 接收，由 handlePiEvent 处理

  // S13 改造6.3：删除 handleProxyRequest 函数
  // 原桌面端 handleProxyRequest 依赖 localServiceRegistry，web 端无此依赖

  // S13 改造7：删除 handleServerChange 函数
  // 原桌面端 handleServerChange 在 useAIStore 中实现，调用 refreshPanels/refreshWidgets 等
  // S12 已在 useAppStore 中实现 handleServerChange，S13 useAIStore 的 onmessage 'change' case
  // 直接调用 useAppStore.handleServerChange（见上方 case 'change'）

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
    // A1：根据目标状态 arm/disarm thinking watchdog
    // 切到 thinking/tool_calling → arm；切到 idle/error/waiting_user_input/waiting_confirmation → disarm
    if (status === 'thinking' || status === 'tool_calling') {
      armThinkingWatchdog(sessionId)
    } else {
      disarmThinkingWatchdog(sessionId)
    }
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

    // S13 改造4：initialize 保留无改造
    // 桌面端 initialize 中无 agentApi 初始化，不调用 startHeartbeat
    // 心跳在 connectWs 的 onopen 中启动（wsPingTimer）
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

    // S13 改造3：sendMessage 删除 agentApi 分支
    // 桌面端原版含 useRuntimeModeStore + window.agentApi 双路径（cloud / local）
    // Web 端只有云端模式，删除 agentApi 分支，仅保留云端 WS 路径 sendWs({kind:'user_message'})
    sendMessage: async (sessionId, content, callerWidgetId?) => {
      const session = get().sessions[sessionId]
      if (!session) return

      // Phase 8 批次3：优先用 session.boundPanelId，fallback 到 activePanelId，都为 null 时进入纯对话模式
      const panelId = session.boundPanelId ?? getUseAppStore().getState().activePanelId ?? undefined

      // Phase 8 批次3：preset 检查（仅检查预设是否存在，apiKey 由 server 端校验）
      // S17.8 修复：Web 端 preset.apiKey 永远为空（key 存在 server DB，不在客户端 store），
      // 删除客户端 apiKey 前置检查，由 server piBridge.ts:1218 的优先级链处理：
      // apiConfig.apiKey > aiSettings.apiKey > PI_API_KEY > VITE_STEPFUN_API_KEY
      const preset = useApiConfigStore.getState().getPreset(session.apiConfigId)
      if (!preset) {
        appendAssistantMessage(sessionId, '[提示] 未选择 API 配置，请在 ⚙️ API 配置中选择预设。')
        setSessionStatus(sessionId, 'error', 'no api config selected')
        return
      }

      // Phase 8 批次3：携带 apiConfig（apiKey 留空，由 server 端从 DB 解析）
      const apiConfig = preset ? {
        endpoint: preset.endpoint,
        apiKey: preset.apiKey,
        model: session.modelId,
      } : undefined

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

      // Set status to thinking (agent_start event will confirm)
      setSessionStatus(sessionId, 'thinking')
    },

    cancelRequest: (sessionId) => {
      // A6：客户端立即重置 + 通知服务端 disposePanelSession
      const session = get().sessions[sessionId]
      if (!session) return
      const panelId = session.boundPanelId ?? getUseAppStore().getState().activePanelId ?? undefined
      // 客户端立即重置（setSessionStatus('error') 会自动 disarm watchdog）
      clearPendingForSession(sessionId)
      appendAssistantMessage(sessionId, '[系统] 已停止 AI 响应。')
      setSessionStatus(sessionId, 'error', 'user cancelled')
      // 通知服务端（disposePanelSession 销毁 session，停止 SDK 内部循环）
      if (panelId) {
        sendWs({ kind: 'cancel_request', panelId, sessionId })
      }
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
      // A1：重新 arm watchdog（permission_request 入口时 disarm 了）
      const req = get().pendingPermissionRequests.get(requestId)
      if (req && req.sessionId) {
        const session = get().sessions[req.sessionId]
        if (session && (session.status === 'thinking' || session.status === 'tool_calling')) {
          armThinkingWatchdog(req.sessionId)
        }
      }
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

    // S13 改造5：loadSessionHistory URL 删除 file:// 分支 + serverPortApi
    // Web 端始终同源，用 window.location.origin
    loadSessionHistory: async (sessionId) => {
      const session = get().sessions[sessionId]
      if (!session) return
      const panelId = session.boundPanelId
      if (!panelId) return  // 未绑定面板的会话没有服务端历史

      try {
        const deviceId = getDeviceId()
        const token = getServerToken()
        // S13 改造5：Web 端始终同源，无 file:// 分支，无 serverPortApi
        // S15 修复：VITE_API_URL → VITE_API_BASE_URL，与全局统一
        const baseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined)
          ?? window.location.origin
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

// S13 改造6.6：删除 localServicesApi onUnregister 监听
// 原桌面端监听主进程 before-quit 通知注销本地服务，web 端无 localServicesApi

// v10: 导出 useAIStoreType 供 useAppStore lazy reference 使用（避免循环依赖）
export type useAIStoreType = typeof useAIStore
