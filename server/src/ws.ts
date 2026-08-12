import { WebSocketServer, WebSocket } from 'ws'
import type { Server as HttpServer, IncomingMessage } from 'http'
import { URL } from 'url'
import { randomUUID } from 'crypto'
import { verifyToken, parseCookies, getCookieName } from './utils/jwt.js'
import { safeCompare } from './utils/crypto.js'

let devModeWarnedWs = false

/**
 * 判断是否为 Electron fork server 模式（桌面端内嵌 server）。
 * Electron fork 时 ELECTRON_RUN_AS_NODE=1，且不需要 Web 端认证。
 */
function isElectronForkWs(): boolean {
  return process.env.ELECTRON_RUN_AS_NODE === '1'
}

// ============================================================================
// 消息协议（Spec 4.1 节）
// ============================================================================

// 前端 → 后端
// 注：sync_queue_flush 已删除，统一用 HTTP 回写方案（Spec 6.6 节 syncQueue.ts）
// Phase 4：user_message 增加 panelId 字段（必填，spec 2.2 节）
// Phase 6.2：新增 proxy_response（桌面端本地服务代理响应，spec 3.3.4 节）
// Phase 8 批次3 模块C：user_message.panelId 改为可选，新增 sessionId/apiConfig/callerWidgetId 可选字段；
//                       新增 dispose_session 消息（删除会话时清理服务端 session）
// Phase 8 批次5 模块D：新增 ask_user_response（客户端回复 ask_user 选择结果）
export type ApiConfigPayload = {
  endpoint: string
  apiKey: string
  model: string
}

// Phase 8 批次5 模块D：ask_user 工具的选项结构
export interface AskUserOption {
  label: string
  description?: string
  value: string
}

export type ClientMessage =
  | { kind: 'user_message'; panelId?: string; content: string; sessionId?: string; apiConfig?: ApiConfigPayload; callerWidgetId?: string }
  | { kind: 'dispose_session'; panelId?: string; sessionId?: string }
  | { kind: 'tool_result'; requestId: string; success: boolean; data?: unknown; error?: string }
  | { kind: 'error_report'; widgetId: string; panelId?: string; message: string; stack?: string; source: string }
  | { kind: 'ping' }
  | { kind: 'proxy_response'; requestId: string; status: number; headers: Record<string, string>; body: string }
  | { kind: 'ask_user_response'; panelId: string; requestId: string; selectedValues: string[] }
  // Phase 13.2.2：permission_response（客户端回复 permission_request 的批准/拒绝）
  | { kind: 'permission_response'; requestId: string; approved: boolean; rememberChoice?: boolean }
  // v3 修复：cancel_request（用户主动停止 AI 响应，对应客户端 cancelRequest 实现）
  | { kind: 'cancel_request'; panelId: string; sessionId?: string }

// 后端 → 前端
// Phase 4：pi_event/session_ready/tool_call/error 增加 panelId（spec 2.2 节）
// Phase 6.2：新增 proxy_request（服务器转发代理请求到桌面端，spec 3.3.4 节）
// Phase 8 批次5 模块D：新增 ask_user（AI 主动向用户提问，选项框形式）
export type ServerMessage =
  | { kind: 'tool_call'; requestId: string; tool: string; params: unknown; targetDeviceId?: string; panelId?: string }
  | { kind: 'pi_event'; event: string; data: unknown; panelId?: string }
  | { kind: 'session_ready'; sessionId: string; panelId?: string }
  | { kind: 'error'; message: string; panelId?: string }
  | { kind: 'pong' }
  | { kind: 'change'; changeType: string; data: unknown; sourceDeviceId?: string }
  | { kind: 'proxy_request'; requestId: string; serviceName: string; method: string; path: string; headers: Record<string, string>; body: string | null }
  | { kind: 'ask_user'; panelId: string; requestId: string; question: string; options: AskUserOption[]; allowMultiple: boolean }
  // Phase 13.2.2：permission_request（危险/写操作前向客户端请求授权）
  | { kind: 'permission_request'; panelId: string; requestId: string; toolName: string; description: string; permission: string; storeName?: string; irreversible?: boolean; callerWidgetId?: string; arguments: Record<string, unknown> }

// 变更广播事件类型（Spec 4.1 节）
// 注：delete 事件的 data 类型为 unknown 以支持批量删除（{ ids: string[] }）和单个删除（{ id: string }）
export type ChangeEvent =
  | { kind: 'panel_created'; data: unknown }
  | { kind: 'panel_updated'; data: unknown }
  | { kind: 'panel_deleted'; data: unknown }
  | { kind: 'panel_active_changed'; data: { activePanelId: string | null } }
  | { kind: 'panels_reordered'; data: { panelIds: string[] } }
  | { kind: 'widget_created'; data: unknown }
  | { kind: 'widget_updated'; data: unknown }
  | { kind: 'widget_deleted'; data: unknown }
  | { kind: 'entity_created'; data: unknown }
  | { kind: 'entity_updated'; data: unknown }
  | { kind: 'entity_deleted'; data: unknown }
  | { kind: 'settings_updated'; data: unknown }
  | { kind: 'relation_created'; data: unknown }
  | { kind: 'relation_deleted'; data: unknown }
  | { kind: 'dynamic_widget_created'; data: unknown }
  | { kind: 'dynamic_widget_deleted'; data: unknown }
  | { kind: 'panel_template_created'; data: unknown }
  | { kind: 'panel_template_deleted'; data: unknown }
  | { kind: 'data_imported'; data: unknown }
  | { kind: 'favorite_added'; data: unknown }
  | { kind: 'favorite_removed'; data: unknown }
  | { kind: 'favorite_panel_cleared'; data: { panelId: string } }
  | { kind: 'dynamic_widget_updated'; data: unknown }
  | { kind: 'component_capability_upserted'; data: unknown }
  | { kind: 'component_capability_updated'; data: unknown }
  | { kind: 'component_capability_deleted'; data: unknown }
  // Phase S3 缺口 C：sync_failed 事件（spec 2.3.1 节）
  // sync_logs 状态变为 failed 时通过 broadcastChange + sendToDevice 推送
  | { kind: 'sync_failed'; data: SyncFailedEvent }

// Phase S3 缺口 C：sync_failed 推送载荷（spec 2.3.1 节）
// 客户端可用 id 字段调 retry/delete API
export interface SyncFailedEvent {
  id: string                       // sync_log ID（客户端可用此 ID 调 retry/delete API）
  deviceId: string                // 失败操作发起设备
  operation: 'create' | 'update' | 'delete'
  entityType: string
  entityId: string
  lastError: string | null
  retryCount: number
  updatedAt: number
}

/** Widget 错误报告（Phase 3B：iframe 运行时错误回传后端） */
export type ErrorReport = {
  widgetId: string
  panelId?: string  // S2 缺口 D：客户端从 widgetId 反查 panel_id 后携带
  message: string
  stack?: string
  source: string
}

// ============================================================================
// 客户端连接管理（多客户端模式）
// ============================================================================

interface ClientConnection {
  ws: WebSocket
  deviceId: string
  authenticated: boolean
  lastPing: number
  /** 游客标记（true 表示游客 JWT 连接，piBridge 据此限频 AI 调用） */
  isGuest: boolean
  /** 游客设备 ID（仅游客连接携带，用于按 deviceId 限频） */
  guestDeviceId?: string
}

type ClientMessageHandler = (msg: ClientMessage, deviceId: string) => void
type ClientConnectHandler = (deviceId: string) => void
type ClientDisconnectHandler = (deviceId: string) => void
type ErrorReportHandler = (report: ErrorReport, deviceId: string) => void

let wss: WebSocketServer | null = null

// 多客户端管理：Map<deviceId, ClientConnection>
const clients = new Map<string, ClientConnection>()

// ============================================================================
// Phase 6.2：代理请求 pending 管理（spec 3.3.4 节）
// 防泄漏：超时后立即 delete，WS disconnect 时清理该设备的所有 pending 请求
// ============================================================================

const PROXY_TIMEOUT_MS = 30_000

interface PendingProxyRequest {
  resolve: (response: { status: number; headers: Record<string, string>; body: string }) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
  targetDeviceId: string
}

const pendingProxyRequests = new Map<string, PendingProxyRequest>()

/** 代理请求超时处理：reject 并立即 delete */
function handleProxyTimeout(requestId: string): void {
  const pending = pendingProxyRequests.get(requestId)
  if (pending) {
    pending.reject(new Error('proxy_timeout'))
    clearTimeout(pending.timeout)
    pendingProxyRequests.delete(requestId)
  }
}

/** 设备 WS 断开时清理该设备的所有 pending 请求（防泄漏） */
function handleDeviceDisconnect(deviceId: string): void {
  for (const [requestId, pending] of pendingProxyRequests) {
    if (pending.targetDeviceId === deviceId) {
      pending.reject(new Error('device_disconnected'))
      clearTimeout(pending.timeout)
      pendingProxyRequests.delete(requestId)
    }
  }
}

/**
 * 发送代理请求到指定设备，等待桌面端通过 WS 返回 proxy_response
 * 超时 30 秒，超时后 reject('proxy_timeout')
 */
export function sendProxyRequest(
  deviceId: string,
  request: {
    serviceName: string
    method: string
    path: string
    headers: Record<string, string>
    body: string | null
  },
): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  return new Promise((resolve, reject) => {
    const requestId = randomUUID()
    const message: ServerMessage = {
      kind: 'proxy_request',
      requestId,
      serviceName: request.serviceName,
      method: request.method,
      path: request.path,
      headers: request.headers,
      body: request.body,
    }

    const sent = sendToDevice(deviceId, message)
    if (!sent) {
      reject(new Error('device_offline'))
      return
    }

    const timeout = setTimeout(() => {
      handleProxyTimeout(requestId)
    }, PROXY_TIMEOUT_MS)

    pendingProxyRequests.set(requestId, { resolve, reject, timeout, targetDeviceId: deviceId })
  })
}

const messageHandlers: Set<ClientMessageHandler> = new Set()
const connectHandlers: Set<ClientConnectHandler> = new Set()
const disconnectHandlers: Set<ClientDisconnectHandler> = new Set()
const errorReportHandlers: Set<ErrorReportHandler> = new Set()

// 认证 token（从环境变量读取）
function getServerToken(): string | null {
  return process.env.SERVER_TOKEN || null
}

// 心跳超时（毫秒）：90 秒无 ping 视为断开
const HEARTBEAT_TIMEOUT_MS = 90_000
// 心跳检查间隔
const HEARTBEAT_CHECK_INTERVAL_MS = 30_000
let heartbeatCheckTimer: ReturnType<typeof setInterval> | null = null

function safeSend(ws: WebSocket, message: ServerMessage): boolean {
  if (ws.readyState !== WebSocket.OPEN) return false
  try {
    ws.send(JSON.stringify(message))
    return true
  } catch (err) {
    console.error('[WS] Failed to send message:', err)
    return false
  }
}

/**
 * 启动 WS 服务器（Spec 4.1 节，Phase S11 双路径鉴权升级）
 *
 * 鉴权双路径（在 verifyClient 阶段执行，拒绝则不建立连接）：
 * - 路径 1：JWT cookie 优先（Web 端）—— parseCookies + verifyToken
 * - 路径 2：SERVER_TOKEN query token fallback（桌面/移动端）
 *
 * dev 模式（SERVER_TOKEN 空）下：
 * - Electron fork server（ELECTRON_RUN_AS_NODE=1）：放行
 * - 同源请求（无 Origin 头，桌面端 renderer/curl）：放行
 * - 跨域请求（带 Origin 头，Web 端浏览器）：拒绝，强制走 JWT cookie 登录
 */
export function startWebSocketServer(server: HttpServer): void {
  if (wss) {
    console.warn('[WS] Server already started')
    return
  }

  wss = new WebSocketServer({
    server,
    path: '/ws',
    verifyClient: (info, cb) => {
      const req = info.req
      const url = new URL(req.url || '', 'http://localhost')
      const deviceId = url.searchParams.get('deviceId')
      const queryToken = url.searchParams.get('token')
      const origin = req.headers.origin

      // 路径 1：JWT cookie（Web 端）—— 必须先检查
      const cookies = parseCookies(req.headers.cookie)
      const jwtToken = cookies[getCookieName()]
      if (jwtToken) {
        const payload = verifyToken(jwtToken)
        if (payload?.authenticated) {
          if (!deviceId) { cb(false, 401, 'missing deviceId'); return }
          cb(true)
          return
        }
        // JWT 无效：拒绝（让前端跳登录页），不 fallback 到 SERVER_TOKEN
        cb(false, 401, 'invalid jwt')
        return
      }

      // 路径 2：SERVER_TOKEN query token（桌面/移动端 fallback）
      const serverToken = getServerToken()
      if (serverToken) {
        if (!queryToken || !safeCompare(queryToken, serverToken)) {
          console.warn('[WS] Connection rejected: invalid token')
          cb(false, 401, 'invalid token')
          return
        }
      } else {
        // dev 模式（SERVER_TOKEN 空 + 无 JWT cookie）放行规则：
        // - Electron fork server：放行
        // - 同源（无 Origin 头，桌面端 renderer）：放行
        // - 跨域（带 Origin 头，Web 端浏览器）：**拒绝**，强制走 JWT cookie
        if (origin && !isElectronForkWs()) {
          cb(false, 401, 'login required')
          return
        }
        if (!devModeWarnedWs && !isElectronForkWs()) {
          devModeWarnedWs = true
          console.warn('[WS] WARNING: SERVER_TOKEN not set — running in dev mode.')
        }
      }
      if (!deviceId) {
        cb(false, 401, 'missing deviceId')
        return
      }
      cb(true)
    },
  })

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    // 解析 query 参数（鉴权已在 verifyClient 完成，这里只取 deviceId）
    const url = new URL(req.url || '', 'http://localhost')
    const deviceId = url.searchParams.get('deviceId')!

    // 解析 JWT cookie 判断是否游客连接（verifyClient 已验证 JWT 有效性，此处仅提取 guest 标记）
    let isGuest = false
    let guestDeviceId: string | undefined
    const cookies = parseCookies(req.headers.cookie)
    const jwtToken = cookies[getCookieName()]
    if (jwtToken) {
      const payload = verifyToken(jwtToken)
      if (payload?.guest) {
        isGuest = true
        guestDeviceId = payload.deviceId
      }
    }

    // 同一 deviceId 的旧连接替换为新连接
    // 对抗审查修复（高 Bug）：替换旧连接前必须先清理该 deviceId 的所有 pending 代理请求，
    // 否则旧 ws 的 close 事件因守卫失败（clients[deviceId] 已是新 ws）而跳过 handleDeviceDisconnect，
    // 导致旧连接上的 pending 请求要等 30s 超时才 reject（违反 spec 3.3.4 节）
    const existing = clients.get(deviceId)
    if (existing && existing.ws.readyState === WebSocket.OPEN) {
      console.log(`[WS] Replacing existing connection for device: ${deviceId}`)
      // 先清理旧连接的 pending 代理请求（立即 reject，不等 30s 超时）
      handleDeviceDisconnect(deviceId)
      try {
        existing.ws.close(1000, 'replaced by new connection')
      } catch {
        // ignore
      }
      clients.delete(deviceId)
    }

    const conn: ClientConnection = {
      ws,
      deviceId,
      authenticated: true,
      lastPing: Date.now(),
      isGuest,
      guestDeviceId,
    }
    clients.set(deviceId, conn)
    console.log(`[WS] Client connected: deviceId=${deviceId}, isGuest=${isGuest}, total=${clients.size}`)

    // 通知连接建立
    for (const handler of connectHandlers) {
      try {
        handler(deviceId)
      } catch (err) {
        console.error('[WS] Connect handler error:', err)
      }
    }

    ws.on('message', (raw: Buffer | ArrayBuffer | Buffer[]) => {
      let text: string
      if (Buffer.isBuffer(raw)) {
        text = raw.toString('utf8')
      } else if (raw instanceof ArrayBuffer) {
        text = Buffer.from(raw).toString('utf8')
      } else if (Array.isArray(raw)) {
        text = Buffer.concat(raw).toString('utf8')
      } else {
        text = String(raw)
      }

      let msg: ClientMessage
      try {
        msg = JSON.parse(text) as ClientMessage
      } catch (err) {
        console.error('[WS] Failed to parse message:', err)
        safeSend(ws, { kind: 'error', message: 'invalid JSON' })
        return
      }

      // 更新 lastPing（任何消息都视为活跃）
      conn.lastPing = Date.now()

      // 心跳 ping
      if ((msg as { kind: string }).kind === 'ping') {
        safeSend(ws, { kind: 'pong' })
        return
      }

      // error_report 单独分发（携带 deviceId）
      if (msg.kind === 'error_report') {
        const report: ErrorReport = {
          widgetId: msg.widgetId,
          panelId: msg.panelId,  // S2 缺口 D：透传 panelId
          message: msg.message,
          stack: msg.stack,
          source: msg.source,
        }
        for (const handler of errorReportHandlers) {
          try {
            handler(report, deviceId)
          } catch (err) {
            console.error('[WS] Error report handler error:', err)
          }
        }
        return
      }

      // Phase 6.2：proxy_response 单独处理（resolve pending 请求，spec 3.3.4 节）
      if (msg.kind === 'proxy_response') {
        const pending = pendingProxyRequests.get(msg.requestId)
        if (pending) {
          clearTimeout(pending.timeout)
          pendingProxyRequests.delete(msg.requestId)
          pending.resolve({
            status: msg.status,
            headers: msg.headers,
            body: msg.body,
          })
        } else {
          console.warn(`[WS] proxy_response for unknown requestId: ${msg.requestId}`)
        }
        return
      }

      // 其他消息分发（携带 deviceId）
      // Bug 修复：degraded mode 反馈 — 如果 user_message 到达但无 handler 注册
      // （PiBridge 未初始化或加载失败），回发 error 避免客户端永久卡在"思考中"
      if (msg.kind === 'user_message' && messageHandlers.size === 0) {
        console.warn('[WS] user_message received but no handler registered (PiBridge not initialized), sending error')
        safeSend(ws, {
          kind: 'error',
          message: 'AI 服务尚未就绪（PiBridge 正在加载或加载失败），请稍后重试或切换到本地模式',
          panelId: (msg as { panelId?: string }).panelId,
        })
        return
      }

      for (const handler of messageHandlers) {
        try {
          handler(msg, deviceId)
        } catch (err) {
          console.error('[WS] Message handler error:', err)
        }
      }
    })

    ws.on('close', () => {
      // S2 修复 P1：将 handleDeviceDisconnect + disconnectHandlers 纳入守卫内
      // 避免重连竞态：旧 ws.close 触发时若新 ws 已替换 clients[deviceId]，
      // 守卫失败跳过清理，否则 S2 的 panelActiveDevices/panelOnlineDevices 状态会被错误清空。
      // 心跳超时路径已先 clients.delete 再调 disconnectHandlers，close 事件再触发时守卫失败，行为一致。
      if (clients.get(deviceId)?.ws === ws) {
        clients.delete(deviceId)
        console.log(`[WS] Client disconnected: deviceId=${deviceId}, total=${clients.size}`)
        // Phase 6.2：清理该设备的所有 pending 代理请求（防泄漏，spec 3.3.4 节）
        handleDeviceDisconnect(deviceId)
        for (const handler of disconnectHandlers) {
          try {
            handler(deviceId)
          } catch (err) {
            console.error('[WS] Disconnect handler error:', err)
          }
        }
      } else {
        console.log(`[WS] Client disconnected (replaced, skip cleanup): deviceId=${deviceId}, total=${clients.size}`)
      }
    })

    ws.on('error', (err: Error) => {
      console.error(`[WS] Client error (deviceId=${deviceId}):`, err)
      // 不调用 disconnectHandlers，error 之后必然触发 close，由 close 统一处理
    })
  })

  // 启动心跳检查
  startHeartbeatCheck()

  console.log('[WS] WebSocket server started at /ws (multi-client mode)')
}

/**
 * 心跳检查：定期清理超时连接（Spec 4.5 节）
 */
function startHeartbeatCheck(): void {
  if (heartbeatCheckTimer) return
  heartbeatCheckTimer = setInterval(() => {
    const now = Date.now()
    for (const [deviceId, conn] of clients) {
      if (now - conn.lastPing > HEARTBEAT_TIMEOUT_MS) {
        console.warn(`[WS] Heartbeat timeout, closing: deviceId=${deviceId}`)
        try {
          conn.ws.close(1001, 'heartbeat timeout')
        } catch {
          // ignore
        }
        clients.delete(deviceId)
        for (const handler of disconnectHandlers) {
          try {
            handler(deviceId)
          } catch (err) {
            console.error('[WS] Disconnect handler error (heartbeat):', err)
          }
        }
      }
    }
  }, HEARTBEAT_CHECK_INTERVAL_MS)
}

// ============================================================================
// 消息发送 API（Spec 4.1 节）
// ============================================================================

/**
 * 发送消息到指定设备
 */
export function sendToDevice(deviceId: string, message: ServerMessage): boolean {
  const conn = clients.get(deviceId)
  if (!conn || conn.ws.readyState !== WebSocket.OPEN) {
    return false
  }
  return safeSend(conn.ws, message)
}

/**
 * 广播消息到所有在线客户端（可选排除某个设备）
 */
export function broadcast(message: ServerMessage, excludeDeviceId?: string): void {
  for (const [deviceId, conn] of clients) {
    if (excludeDeviceId && deviceId === excludeDeviceId) continue
    safeSend(conn.ws, message)
  }
}

/**
 * 广播变更事件（路由 handler 调用，Spec 4.4 节）
 * sourceDeviceId 用于排除发起方客户端（避免发起方收到自己触发的变更广播后重复刷新）
 */
export function broadcastChange(event: ChangeEvent, sourceDeviceId?: string): void {
  const message: ServerMessage = {
    kind: 'change',
    changeType: event.kind,
    data: event.data,
    sourceDeviceId,
  }
  broadcast(message, sourceDeviceId)
}

/**
 * 发送到任意一个在线客户端（兼容旧 API，用于无目标设备的工具调用）
 * 优先选择第一个连接的设备
 */
export function sendToClient(message: ServerMessage): boolean {
  for (const [, conn] of clients) {
    if (conn.ws.readyState === WebSocket.OPEN) {
      return safeSend(conn.ws, message)
    }
  }
  return false
}

/**
 * 发送工具调用消息（Spec 4.3 节）
 * 如果 message.targetDeviceId 存在，发到指定设备；否则发到任意客户端
 */
export function sendToolCall(message: ServerMessage & { targetDeviceId?: string }): boolean {
  if (message.targetDeviceId) {
    return sendToDevice(message.targetDeviceId, message)
  }
  return sendToClient(message)
}

export function hasClient(): boolean {
  return clients.size > 0
}

export function hasDevice(deviceId: string): boolean {
  const conn = clients.get(deviceId)
  return conn !== undefined && conn.ws.readyState === WebSocket.OPEN
}

/**
 * 判断指定设备是否为游客连接（piBridge 据此对游客 AI 调用限频）
 */
export function isGuestDevice(deviceId: string): boolean {
  const conn = clients.get(deviceId)
  return conn?.isGuest === true
}

/**
 * 获取游客设备的 guestDeviceId（用于按 deviceId 限频）
 * 非游客连接返回 undefined
 */
export function getGuestDeviceId(deviceId: string): string | undefined {
  const conn = clients.get(deviceId)
  return conn?.isGuest ? conn.guestDeviceId : undefined
}

export function getOnlineDeviceIds(): string[] {
  return Array.from(clients.keys())
}

// ============================================================================
// 事件订阅 API
// ============================================================================

export function onClientMessage(handler: ClientMessageHandler): () => void {
  messageHandlers.add(handler)
  return () => messageHandlers.delete(handler)
}

export function onClientConnect(handler: ClientConnectHandler): () => void {
  connectHandlers.add(handler)
  return () => connectHandlers.delete(handler)
}

export function onClientDisconnect(handler: ClientDisconnectHandler): () => void {
  disconnectHandlers.add(handler)
  return () => disconnectHandlers.delete(handler)
}

/**
 * 注册 error_report handler（Phase 3B）
 * 收到 iframe 运行时错误时调用，handler 应把错误作为 user message 发给 agent
 */
export function onErrorReport(handler: ErrorReportHandler): () => void {
  errorReportHandlers.add(handler)
  return () => errorReportHandlers.delete(handler)
}
