import { randomUUID } from 'crypto'
import { join, extname } from 'path'
import { writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'fs'
import { AsyncLocalStorage } from 'async_hooks'
// Phase 14 C5 修复：pi-coding-agent 改为懒加载，避免 server 启动时 import 超时
// 根因：tsx loader 给 pi-coding-agent import 增加巨大开销（8.4s 直接 → 26s with tsx），
//   在 server 进程中（已加载 50+ 模块，内存压力）超过 45s 超时。
//   但 initPiBridge() 完全不使用 pi-coding-agent 符号，只有 createSession() 使用。
//   createSession() 是懒加载的（收到 user_message 时才调用），所以可以安全推迟 import。
import type {
  AgentSession,
  ToolDefinition,
  SessionManager,
  ProviderConfig,
  ProviderModelConfig,
} from '@earendil-works/pi-coding-agent'

// 懒加载 pi-coding-agent：推迟到首次 AI 请求时才加载
let piAgentModule: Promise<typeof import('@earendil-works/pi-coding-agent')> | null = null
function loadPiAgent(): Promise<typeof import('@earendil-works/pi-coding-agent')> {
  if (!piAgentModule) {
    console.log('[PiBridge] Loading pi-coding-agent (lazy import)...')
    const start = Date.now()
    piAgentModule = import('@earendil-works/pi-coding-agent').then(m => {
      console.log(`[PiBridge] pi-coding-agent loaded in ${Date.now() - start}ms`)
      return m
    }).catch(err => {
      // 失败时重置缓存，允许后续重试（避免 rejected Promise 被永久缓存）
      piAgentModule = null
      throw err
    })
  }
  return piAgentModule
}
import { Type } from 'typebox'
import {
  onClientMessage,
  onClientConnect,
  onClientDisconnect,
  onErrorReport,
  sendToClient,
  sendToDevice,
  sendToolCall,
  broadcast,
  hasClient,
  hasDevice,
  isGuestDevice,
  getGuestDeviceId,
  type ErrorReport,
  type ApiConfigPayload,
  type AskUserOption,
} from './ws.js'
import { persistConversation, restoreSessionContext, persistPiEvent } from './db/aiContext.js'
import { getAiSettings, getPromptOverrides, clearPromptCache, DEFAULT_PROMPTS } from './db/aiSettingsStore.js'
import { getPool } from './db/connection.js'
import { AI_TOOL_MAP, isValidToolName } from './utils/aiTools.js'
import { searchTools, withSearchUser } from './utils/searchTools.js'
import { queryCapabilitiesTool } from './utils/capabilityTools.js'
import { fileSystemTools } from './utils/fileSystemTools.js'
import { initSandbox } from './sandbox/index.js'
import { BACKGROUNDS_DIR } from './routes/background.js'

// ============================================================================
// Pending request map for WS tool calls
// ============================================================================

type PendingRequest = {
  resolve: (data: unknown) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
  // Phase 4：记录 panelId，用于工具调用路由（spec 2.3 节）
  panelId: string
  // 工具失败计数修复：记录 tool 名字，用于 tool_result 成功时重置失败计数
  tool: string
}

const pendingRequests = new Map<string, PendingRequest>()

const TOOL_TIMEOUT_MS = 30_000

// ============================================================================
// 工具失败计数：防止 AI 工具调用失败后无限循环重试
// 同一 panelId + toolName 失败超过阈值后直接拒绝调用，向 LLM 返回明确错误
// 触发场景：客户端断连导致 list_widgets → TIMEOUT → turn_end → turn_start → list_widgets 无限循环
// ============================================================================
const panelToolFailures = new Map<string, Map<string, number>>()
const TOOL_FAILURE_THRESHOLD = 3  // 同一 panel + tool 失败 3 次后拒绝重试

// 修复：error_report 速率限制，防止 iframe JS 错误导致 error_report → prompt → 修复 → 又报错的无限循环。
// 每 panelId 的 error_report：10 秒冷却 + 每分钟最多 3 次
const panelErrorTimestamps = new Map<string, number[]>()
const ERROR_REPORT_COOLDOWN_MS = 10_000
const ERROR_REPORT_MAX_PER_MINUTE = 3

function getToolFailureCount(panelId: string, tool: string): number {
  return panelToolFailures.get(panelId)?.get(tool) ?? 0
}

function incrementToolFailure(panelId: string, tool: string): number {
  let toolMap = panelToolFailures.get(panelId)
  if (!toolMap) {
    toolMap = new Map()
    panelToolFailures.set(panelId, toolMap)
  }
  const count = (toolMap.get(tool) ?? 0) + 1
  toolMap.set(tool, count)
  return count
}

function resetToolFailure(panelId: string, tool: string): void {
  const toolMap = panelToolFailures.get(panelId)
  if (toolMap) {
    toolMap.delete(tool)
    if (toolMap.size === 0) panelToolFailures.delete(panelId)
  }
}

// ============================================================================
// 游客 AI 调用限频（内存 Map，重启重置）
// 按 guestDeviceId 限制：每分钟最多 5 次消息，每天最多 50 次
// 超限时返回友好提示"游客额度已用完，登录后继续使用"
// ============================================================================

const GUEST_RATE_PER_MINUTE = 5
const GUEST_RATE_PER_DAY = 50
const MINUTE_MS = 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

interface GuestRateEntry {
  minuteCount: number
  minuteWindowStart: number
  dayCount: number
  dayWindowStart: number
}

const guestRateMap = new Map<string, GuestRateEntry>()

/**
 * 检查游客 AI 调用限频
 * @returns null 表示通过，string 表示拒绝原因（友好提示）
 */
function checkGuestRateLimit(guestDeviceId: string): string | null {
  const now = Date.now()
  let entry = guestRateMap.get(guestDeviceId)
  if (!entry) {
    entry = { minuteCount: 0, minuteWindowStart: now, dayCount: 0, dayWindowStart: now }
    guestRateMap.set(guestDeviceId, entry)
  }

  // 重置过期的窗口
  if (now - entry.minuteWindowStart > MINUTE_MS) {
    entry.minuteCount = 0
    entry.minuteWindowStart = now
  }
  if (now - entry.dayWindowStart > DAY_MS) {
    entry.dayCount = 0
    entry.dayWindowStart = now
  }

  // 先检查日限（更严格）
  if (entry.dayCount >= GUEST_RATE_PER_DAY) {
    return '游客每日 AI 额度已用完（' + GUEST_RATE_PER_DAY + ' 次/天），登录后可继续无限使用。'
  }

  // 再检查分钟限
  if (entry.minuteCount >= GUEST_RATE_PER_MINUTE) {
    return '游客请求过于频繁（每分钟限 ' + GUEST_RATE_PER_MINUTE + ' 次），请稍后再试或登录后继续使用。'
  }

  // 通过限频，计数+1
  entry.minuteCount++
  entry.dayCount++
  return null
}

// 需要路由到特定设备的工具（browser_* 工具，Spec 4.3 节）
const DEVICE_SPECIFIC_TOOLS = new Set([
  'browser_eval', 'browser_get_dom', 'browser_click', 'browser_input',
  'browser_scroll', 'browser_wait_for', 'browser_screenshot', 'browser_navigate',
  'browser_get_url', 'browser_get_title', 'browser_back', 'browser_forward',
  'browser_reload', 'browser_get_cookie', 'browser_set_cookie',
  'browser_open', 'browser_switch_tab', 'browser_list_tabs',
  'local_search',  // Phase S9：本地搜索路由到面板活跃设备（spec 2.4 节）
])

// ============================================================================
// Phase 4：per-panel 路由工具调用（spec 2.3 节）
// 全局 activeDeviceId → Map<panelId, deviceId>
// ============================================================================

const panelActiveDevices = new Map<string, string>()

// ============================================================================
// Phase S2：设备-面板在线关系追踪（spec 缺口 A）
// 记录每个面板当前有哪些设备在查看/对话
// 用于 AI 思考流定向广播（避免全广播到所有设备）
// ============================================================================

const panelOnlineDevices = new Map<string, Set<string>>()

/**
 * S2 设备切换面板自动清理：从该设备关联的其他面板移除引用（spec 2.1.8）
 * - 从 panelOnlineDevices 中其他面板的在线集合移除该设备
 * - 从 panelActiveDevices 中以该 deviceId 为值的其他面板映射删除
 * - 不调用 disposePanelSession（保留旧面板的 session，下次切回可恢复上下文）
 *
 * S2 对抗审查 M-1 修复：不再跳过 session-only: 前缀的面板。
 * 原跳过逻辑会导致设备切走后仍在旧 session-only 面板的在线集合中，
 * 进而继续收到该面板的 pi_event（定向广播），与"设备切走后不应再收旧面板事件"语义冲突。
 * session-only 面板 sessionId 虽然可跨设备共享，但单个设备的引用仍需清理。
 */
function cleanupDeviceFromOtherPanels(deviceId: string, currentPanelId: string): void {
  // 1. 从其他面板的在线集合移除该设备
  for (const [pid, onlineSet] of panelOnlineDevices) {
    if (pid === currentPanelId) continue
    if (onlineSet.delete(deviceId)) {
      console.log(`[PiBridge] Device ${deviceId} left panel ${pid} (switched to ${currentPanelId})`)
      if (onlineSet.size === 0) {
        panelOnlineDevices.delete(pid)
      }
    }
  }

  // 2. 从 panelActiveDevices 中以该 deviceId 为值的其他面板映射删除
  for (const [pid, devId] of panelActiveDevices) {
    if (pid === currentPanelId) continue
    if (devId === deviceId) {
      panelActiveDevices.delete(pid)
      console.log(`[PiBridge] Cleared activeDevice for panel ${pid} (device ${deviceId} switched to ${currentPanelId})`)
    }
  }
}

/**
 * 设置某面板的活跃设备（用于工具调用路由，spec 2.3 节）
 * 当某个设备在该面板发送 user_message 时，设为该面板的活跃设备
 */
export function setPanelActiveDevice(panelId: string, deviceId: string): void {
  panelActiveDevices.set(panelId, deviceId)
  console.log(`[PiBridge] Panel ${panelId} active device: ${deviceId}`)
}

/**
 * 兼容旧 API：设置全局活跃设备（同时写入所有已知面板）
 * @deprecated 推荐使用 setPanelActiveDevice
 */
export function setActiveDevice(deviceId: string): void {
  // 旧 API 兼容：写入所有已知面板的活跃设备
  for (const panelId of panelSessions.keys()) {
    panelActiveDevices.set(panelId, deviceId)
  }
  console.log(`[PiBridge] Active device set (legacy): ${deviceId}`)
}

/**
 * 销毁指定面板的 session（S1 缺口 C）
 * - 调用 session.dispose() 清理内存
 * - 清理 panelSessions / sessionLastUsed / panelActiveDevices / panelSessionReady
 * - 拒绝 pendingRequests 中该 panelId 的等待请求（避免 30s 超时等待）
 * - 不删除 ai_conversations / ai_memories 数据（由调用方在事务中删除）
 */
export async function disposePanelSession(panelId: string): Promise<void> {
  // v3 修复 B1 race condition：入口立即 delete，避免新 user_message 在 dispose 进行中拿到旧 session
  const s = panelSessions.get(panelId)
  panelSessions.delete(panelId)
  const subscribeHandler = panelSessionSubscribeHandlers.get(panelId)
  panelSessionSubscribeHandlers.delete(panelId)
  panelSessionApiConfig.delete(panelId)  // C1 修复：清理 apiConfig 记录
  sessionLastUsed.delete(panelId)
  panelActiveDevices.delete(panelId)
  panelSessionReady.delete(panelId)
  panelOnlineDevices.delete(panelId)  // S2 缺口 A：清理该面板的在线设备集合
  // S17 对抗审查修复（中 Bug）：清理该面板的工具失败计数和 error_report 速率限制计数，
  // 否则用户主动 cancel_request 后再次发消息时，残留的失败计数会立即让工具调用被 TOOL_FAILURE_THRESHOLD 拒绝
  panelToolFailures.delete(panelId)
  panelErrorTimestamps.delete(panelId)

  // v3 修复 B4：清理该 panelId 的所有 pending（pendingRequests + askUserPending + permissionPending）
  rejectAllPendingForPanel(panelId)

  // v3 修复 B4：unsubscribe SDK 事件，防止 disposed session 继续向客户端发送 pi_event
  if (subscribeHandler) {
    try {
      // SDK 可能支持 unsubscribe，尝试调用
      ;(s as any)?.unsubscribe?.(subscribeHandler)
    } catch (err) {
      console.warn(`[PiBridge] unsubscribe failed for ${panelId}:`, err)
    }
  }

  // 1. 销毁 AgentSession（注：pi-coding-agent SDK 中 dispose() 是同步方法返回 void，await 仅作兼容）
  if (s) {
    try { await s.dispose?.() } catch (err) { console.warn(`[PiBridge] dispose panel session ${panelId} failed:`, err) }
  }

  console.log(`[PiBridge] Panel session ${panelId} disposed`)
}

// ============================================================================
// Phase 4：per-panel session（spec 2.2 节）
// 全局单 session → Map<panelId, AgentSession>
// ============================================================================

const panelSessions = new Map<string, AgentSession>()

// v3 修复 B4：保存每个面板的 subscribe handler 引用，disposePanelSession 时 unsubscribe
// 防止 disposed session 继续向客户端发送 pi_event（spec 2.2 节）
const panelSessionSubscribeHandlers = new Map<string, (event: unknown) => void>()

// Phase 8 批次3：记录每个 panelId 上次使用的 apiConfig，避免每次消息都重建 session
const panelSessionApiConfig = new Map<string, string>()

// session 超时清理（7 天未用，决策 12.1）
const SESSION_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000
const sessionLastUsed = new Map<string, number>()

// 共享的 SessionManager（单例，AgentSession 内部使用）
let sharedSessionManager: ReturnType<typeof SessionManager.inMemory> | null = null

/**
 * 获取或创建面板的 AgentSession（spec 2.2 节）
 * - 7 天未用的 session 自动清理
 * - 新建 session 时从数据库恢复上下文
 */
async function getOrCreatePanelSession(panelId: string, apiConfig?: ApiConfigPayload): Promise<AgentSession> {
  // 检查超时清理（S1：统一调用 disposePanelSession 保证清理逻辑单一来源）
  const lastUsed = sessionLastUsed.get(panelId)
  if (lastUsed && Date.now() - lastUsed > SESSION_TIMEOUT_MS) {
    await disposePanelSession(panelId)
  }

  let s = panelSessions.get(panelId)
  if (!s) {
    s = await createSession(panelId, apiConfig)
    if (apiConfig) {
      panelSessionApiConfig.set(panelId, JSON.stringify(apiConfig))
    }
    // 从数据库恢复上下文（架构文档 2.5）
    try {
      await restoreSessionContext(s, panelId)
    } catch (err) {
      console.warn(`[PiBridge] restoreSessionContext failed for panel ${panelId}:`, err)
    }
    panelSessions.set(panelId, s)
  } else if (apiConfig) {
    // Phase 8 批次3：仅在 apiConfig 变化时重建 session（C1 修复）
    const lastConfigJson = panelSessionApiConfig.get(panelId)
    const newConfigJson = JSON.stringify(apiConfig)
    if (lastConfigJson !== newConfigJson) {
      // apiConfig 变化，需要 dispose 旧 session 并重建
      try { await s.dispose?.() } catch (err) { console.warn(`[PiBridge] dispose old session for ${panelId} failed:`, err) }
      panelSessions.delete(panelId)
      panelSessionApiConfig.set(panelId, newConfigJson)
      s = await createSession(panelId, apiConfig)
      try {
        await restoreSessionContext(s, panelId)
      } catch (err) {
        console.warn(`[PiBridge] restoreSessionContext failed for panel ${panelId}:`, err)
      }
      panelSessions.set(panelId, s)
    }
    // apiConfig 未变，复用现有 session
  }
  sessionLastUsed.set(panelId, Date.now())
  return s
}

// 定时清理（每小时扫描一次，spec 2.2 节）
// S1：统一调用 disposePanelSession 保证清理逻辑单一来源（含 panelSessionReady + pendingRequests）
const cleanupTimer = setInterval(() => {
  const now = Date.now()
  const expiredPanels: string[] = []
  for (const [panelId, lastUsed] of sessionLastUsed) {
    if (now - lastUsed > SESSION_TIMEOUT_MS) {
      expiredPanels.push(panelId)
    }
  }
  for (const panelId of expiredPanels) {
    disposePanelSession(panelId).catch((err) => {
      console.warn(`[PiBridge] cleanupTimer dispose failed for ${panelId}:`, err)
    })
  }
}, 60 * 60 * 1000)
// 不阻止进程退出
cleanupTimer.unref?.()

// ============================================================================
// executeViaWs - 通过 WS 路由工具调用到目标设备（spec 2.3 节）
// ============================================================================

function executeViaWs(tool: string, params: unknown, panelId: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    // 检查工具失败计数：超过阈值直接拒绝，防止 AI 无限重试（客户端断连场景）
    const failureCount = getToolFailureCount(panelId, tool)
    if (failureCount >= TOOL_FAILURE_THRESHOLD) {
      const errorMsg = `tool ${tool} has failed ${failureCount} times in panel ${panelId}, DO NOT retry. The client may be disconnected or the tool may be broken. Please tell the user to check the connection or simplify the task.`
      console.warn('[PiBridge] tool_call rejected (failure threshold reached):', tool, panelId, 'count:', failureCount)
      reject(new Error(errorMsg))
      return
    }

    // 确定目标设备（Phase 4：按面板路由，spec 2.3 节）
    const targetDeviceId = panelActiveDevices.get(panelId)

    if (DEVICE_SPECIFIC_TOOLS.has(tool)) {
      // browser_* 工具：路由到该面板的活跃设备
      if (!targetDeviceId || !hasDevice(targetDeviceId)) {
        incrementToolFailure(panelId, tool)
        reject(new Error(`no active device for panel ${panelId}, tool: ${tool}`))
        return
      }
    } else {
      // 画布工具：发到任意客户端（或该面板的活跃设备）
      if (!hasClient()) {
        incrementToolFailure(panelId, tool)
        reject(new Error('no websocket client connected'))
        return
      }
    }

    const requestId = randomUUID()
    // v3 修复 B3：关键诊断日志
    console.log('[PiBridge] tool_call start', tool, panelId, 'requestId:', requestId)
    const timer = setTimeout(() => {
      pendingRequests.delete(requestId)
      const count = incrementToolFailure(panelId, tool)
      // v3 修复 B3：超时日志
      console.warn('[PiBridge] tool_call TIMEOUT', tool, panelId, 'requestId:', requestId, 'failureCount:', count)
      // v3 修复 B2：合成 tool_execution_end 事件通知前端
      // 字段参考 aiContext.ts:128-156 真实事件结构（toolName 必填，aiContext.ts:134 有 if(!toolName) return）
      const syntheticEvent = {
        type: 'tool_execution_end',
        toolCallId: requestId,
        toolName: tool,
        result: { content: 'tool execution timeout (30s)' },
        isError: true,
      }
      if (targetDeviceId && hasDevice(targetDeviceId)) {
        sendToDevice(targetDeviceId, {
          kind: 'pi_event',
          event: 'tool_execution_end',
          data: syntheticEvent,
          panelId,
        })
      } else {
        broadcast({
          kind: 'pi_event',
          event: 'tool_execution_end',
          data: syntheticEvent,
          panelId,
        })
      }
      reject(new Error(`timeout (failure #${count})`))
    }, TOOL_TIMEOUT_MS)

    pendingRequests.set(requestId, { resolve, reject, timer, panelId, tool })

    const ok = sendToolCall({
      kind: 'tool_call',
      requestId,
      tool,
      params,
      targetDeviceId,
      panelId,
    })
    if (!ok) {
      clearTimeout(timer)
      pendingRequests.delete(requestId)
      incrementToolFailure(panelId, tool)
      reject(new Error('failed to send tool_call to client'))
    }
  })
}

function rejectAllPending(reason: string): void {
  for (const [requestId, pending] of pendingRequests) {
    clearTimeout(pending.timer)
    pending.reject(new Error(reason))
    pendingRequests.delete(requestId)
  }
}

/**
 * v3 修复 B4：清理指定 panelId 的所有 pending 请求
 * - pendingRequests（工具调用）
 * - askUserPending（ask_user 等待用户回复）
 * - permissionPending（permission_request 等待用户授权）
 * 在 disposePanelSession 中调用，确保 session 销毁后无遗留 pending
 */
function rejectAllPendingForPanel(panelId: string, reason: string = `panel ${panelId} disposed`): void {
  // 1. 清理 pendingRequests（工具调用）
  for (const [requestId, req] of pendingRequests) {
    if (req.panelId === panelId) {
      clearTimeout(req.timer)
      req.reject(new Error(reason))
      pendingRequests.delete(requestId)
    }
  }

  // 2. 清理 askUserPending（ask_user 等待用户回复）
  for (const [requestId, pending] of askUserPending) {
    if (pending.panelId === panelId) {
      clearTimeout(pending.timer)
      pending.reject(new Error(reason))
      askUserPending.delete(requestId)
    }
  }

  // 3. 清理 permissionPending（permission_request 等待用户授权）
  for (const [requestId, pending] of permissionPending) {
    if (pending.panelId === panelId) {
      clearTimeout(pending.timer)
      pending.reject(new Error(reason))
      permissionPending.delete(requestId)
    }
  }
}

// ============================================================================
// Phase 8 批次5 模块D：ask_user pending 管理
// AI 主动向用户提问，等待用户通过 WS 回复 ask_user_response
// 超时 120s（用户可能正在深度对话），dispose 时清理所有 pending
// ============================================================================

interface AskUserPending {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timer: ReturnType<typeof setTimeout>
  panelId: string
}

const askUserPending = new Map<string, AskUserPending>()

const ASK_USER_TIMEOUT_MS = 120_000

/**
 * 执行 ask_user：发送问题到客户端，等待用户选择
 * 超时 120s，超时后 reject('ask_user timeout (120s)')
 */
function executeAskUser(
  panelId: string,
  question: string,
  options: AskUserOption[],
  allowMultiple: boolean,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const requestId = randomUUID()
    const timer = setTimeout(() => {
      askUserPending.delete(requestId)
      reject(new Error('ask_user timeout (120s)'))
    }, ASK_USER_TIMEOUT_MS)

    askUserPending.set(requestId, { resolve, reject, timer, panelId })

    const targetDeviceId = panelActiveDevices.get(panelId)
    if (!targetDeviceId) {
      clearTimeout(timer)
      askUserPending.delete(requestId)
      reject(new Error(`No active device for panel ${panelId}`))
      return
    }

    const ok = sendToDevice(targetDeviceId, {
      kind: 'ask_user',
      panelId,
      requestId,
      question,
      options,
      allowMultiple,
    })
    if (!ok) {
      clearTimeout(timer)
      askUserPending.delete(requestId)
      reject(new Error(`Failed to send ask_user to device ${targetDeviceId}`))
    }
  })
}

/**
 * 处理客户端的 ask_user_response 回复
 * L3 修复：安全检查以 requestId 命中为准，不再校验 panelId 严格相等
 */
function handleAskUserResponse(msg: { requestId: string; selectedValues: string[] }): void {
  const pending = askUserPending.get(msg.requestId)
  if (!pending) return  // 已超时或不存在
  clearTimeout(pending.timer)
  askUserPending.delete(msg.requestId)
  pending.resolve(msg.selectedValues)
}

// ============================================================================
// Phase 13.2.2：permission_request pending 管理
// 危险/写操作执行前向客户端请求授权，等待客户端通过 WS 回复 permission_response
// 超时 120s（用户可能正在仔细确认 irreversible 操作），dispose 时清理所有 pending
// ============================================================================

interface PermissionPending {
  resolve: (value: { approved: boolean }) => void
  reject: (reason: Error) => void
  timer: ReturnType<typeof setTimeout>
  panelId: string
}

const permissionPending = new Map<string, PermissionPending>()

const PERMISSION_TIMEOUT_MS = 120_000

/**
 * 执行带权限门控的工具：发送 permission_request 到客户端，等待用户批准/拒绝
 * 超时 120s，超时后 reject('permission timeout (120s)')
 * 注：panelId 从 AsyncLocalStorage 上下文获取（与 executeViaWs 一致）
 */
export async function executeWithPermission(panelId: string, payload: {
  toolName: string
  description: string
  permission: string
  storeName?: string
  irreversible?: boolean
  arguments: Record<string, unknown>
}): Promise<{ approved: boolean }> {
  const requestId = `perm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const callerWidgetId = getCurrentCallerWidgetId()
  const targetDeviceId = panelActiveDevices.get(panelId)
  if (!targetDeviceId) throw new Error(`no active device for panel ${panelId}`)

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      permissionPending.delete(requestId)
      reject(new Error(`permission timeout (${PERMISSION_TIMEOUT_MS}ms)`))
    }, PERMISSION_TIMEOUT_MS)

    permissionPending.set(requestId, { resolve, reject, timer, panelId })

    const ok = sendToDevice(targetDeviceId, {
      kind: 'permission_request',
      requestId,
      panelId,
      callerWidgetId,
      toolName: payload.toolName,
      description: payload.description,
      permission: payload.permission,
      storeName: payload.storeName,
      irreversible: payload.irreversible,
      arguments: payload.arguments,
    })
    if (!ok) {
      clearTimeout(timer)
      permissionPending.delete(requestId)
      reject(new Error(`failed to send permission_request to device ${targetDeviceId}`))
    }
  })
}

/**
 * 处理客户端的 permission_response 回复
 * 安全检查以 requestId 命中为准
 */
export function handlePermissionResponse(msg: {
  requestId: string
  approved: boolean
}): void {
  const pending = permissionPending.get(msg.requestId)
  if (!pending) return  // 已超时或不存在
  clearTimeout(pending.timer)
  permissionPending.delete(msg.requestId)
  pending.resolve({ approved: msg.approved })
}

// ============================================================================
// 6 customTools - all execute via WS to frontend
// 注意：customTools 数组本身不改动，只改 execute 内部的路由逻辑（spec 2.3 节）
// 工具调用的 panelId 通过 AsyncLocalStorage 上下文传递
// ============================================================================

// 工具执行上下文：当前面板 ID
// 使用 AsyncLocalStorage 保证多面板并行 AI 操作时的上下文隔离（spec 2.3 节）
// 避免 currentPanelId 被并发的其他面板覆盖
const panelIdStorage = new AsyncLocalStorage<string>()

/**
 * 获取当前异步上下文中的 panelId（spec 2.3 节）
 * 在 withPanelContext 内的任何异步调用中都能正确获取
 */
function getCurrentPanelId(): string | null {
  return panelIdStorage.getStore() ?? null
}

/**
 * 在面板上下文中执行函数（设置 panelId 到 AsyncLocalStorage，spec 2.3 节）
 * 用于让 customTools 的 execute 函数能获取到当前 panelId
 * AsyncLocalStorage 保证多面板并行时上下文不互相污染
 */
async function withPanelContext<T>(panelId: string, fn: () => Promise<T>): Promise<T> {
  return panelIdStorage.run(panelId, fn)
}

// 工具执行上下文：当前 callerWidgetId（spec 7.2 M4 修复）
// 与 panelIdStorage 配合使用，让 customTools 能获取到当前调用方 widget ID
// 用于 permission_request 路由到正确的 AIAssistantSidebar / AIAssistant widget
const callerWidgetIdStorage = new AsyncLocalStorage<string | undefined>()

/**
 * 获取当前异步上下文中的 callerWidgetId（spec 7.2 M4 修复）
 * 在 withCallerWidgetContext 内的任何异步调用中都能正确获取
 * 返回 undefined 表示无 callerWidgetId 上下文（如纯对话模式或老客户端未传 callerWidgetId）
 */
function getCurrentCallerWidgetId(): string | undefined {
  return callerWidgetIdStorage.getStore()
}

/**
 * 在 callerWidgetId 上下文中执行函数（spec 7.2 M4 修复）
 * 通常与 withPanelContext 嵌套使用：先 panelIdStorage.run，再 callerWidgetIdStorage.run
 * 如果 callerWidgetId 为 undefined / null，直接执行 fn（不进入 storage 上下文）
 */
async function withCallerWidgetContext<T>(
  callerWidgetId: string | undefined | null,
  fn: () => Promise<T>,
): Promise<T> {
  if (!callerWidgetId) return fn()
  return callerWidgetIdStorage.run(callerWidgetId, fn)
}

const createHtmlWidgetTool: ToolDefinition = {
  name: 'create_html_widget',
  label: 'Create HTML Widget',
  description:
    'Create a new HTML widget on the canvas. The widget renders the provided HTML in a sandboxed iframe.',
  parameters: Type.Object({
    html: Type.String({ description: 'Complete HTML document or fragment to render' }),
    x: Type.Number({ description: 'Canvas X position' }),
    y: Type.Number({ description: 'Canvas Y position' }),
    width: Type.Optional(Type.Number({ description: 'Widget width in px (default 400)' })),
    height: Type.Optional(Type.Number({ description: 'Widget height in px (default 300)' })),
    title: Type.Optional(Type.String({ description: 'Widget title for the header' })),
  }),
  execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
    const pid = getCurrentPanelId()
    if (!pid) throw new Error('no panel context for tool create_html_widget')
    const result = await executeViaWs('create_html_widget', params, pid)
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      details: {},
    }
  },
}

const updateHtmlWidgetTool: ToolDefinition = {
  name: 'update_html_widget',
  label: 'Update HTML Widget',
  description:
    'Update an existing HTML widget on the canvas. Only provided fields are updated.',
  parameters: Type.Object({
    id: Type.String({ description: 'Widget instance ID' }),
    html: Type.Optional(Type.String({ description: 'New HTML content' })),
    width: Type.Optional(Type.Number({ description: 'New widget width' })),
    height: Type.Optional(Type.Number({ description: 'New widget height' })),
    title: Type.Optional(Type.String({ description: 'New widget title' })),
  }),
  execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
    const pid = getCurrentPanelId()
    if (!pid) throw new Error('no panel context for tool update_html_widget')
    const result = await executeViaWs('update_html_widget', params, pid)
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      details: {},
    }
  },
}

// ============================================================================
// Phase 2 决策38/39：mini/icon 档 AI 自定义 HTML 工具
// mini 档（决策38）：AI 自己选择的精简 HTML 形态（不是简单缩放）
// icon 档（决策39）：AI 自己画的 HTML 图标（圆形/任意形状，不是固定方形）
// 通过 WS 转发到客户端，更新 widget.state.miniHtml / iconHtml
// 客户端在 wsToolHandlers.ts 中处理，渲染时优先使用这两个字段
// ============================================================================

const setWidgetMiniHtmlTool: ToolDefinition = {
  name: 'set_widget_mini_html',
  label: 'Set Widget Mini HTML',
  description:
    'Set the mini-tier (simplified) HTML for a widget. ' +
    'The mini tier is the middle zoom level in album zoom (decision 38): ' +
    'it should be a concise HTML form (NOT a simple scale-down of the full widget). ' +
    'Use this when you want to customize how a widget looks when zoomed out to mini tier. ' +
    'The HTML will be rendered via dangerouslySetInnerHTML (no iframe), so keep it self-contained. ' +
    'If never called, the client falls back to a default mini summary generated from title + first 100 chars.',
  parameters: Type.Object({
    widgetId: Type.String({ description: 'Widget instance ID to set mini HTML for' }),
    html: Type.String({ description: 'Complete self-contained HTML fragment for the mini tier (e.g. <div>...</div>)' }),
  }),
  execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
    const pid = getCurrentPanelId()
    if (!pid) throw new Error('no panel context for tool set_widget_mini_html')
    const result = await executeViaWs('set_widget_mini_html', params, pid)
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      details: {},
    }
  },
}

const setWidgetIconHtmlTool: ToolDefinition = {
  name: 'set_widget_icon_html',
  label: 'Set Widget Icon HTML',
  description:
    'Set the icon-tier HTML for a widget. ' +
    'The icon tier is the smallest zoom level in album zoom (decision 39): ' +
    'it should be an HTML icon drawn by AI (can be circular or any shape, NOT a fixed square). ' +
    'Use this when you want to customize how a widget looks when zoomed out to icon tier. ' +
    'The HTML will be rendered via dangerouslySetInnerHTML (no iframe), so keep it self-contained. ' +
    'If never called, the client falls back to a default circular icon with the first letter.',
  parameters: Type.Object({
    widgetId: Type.String({ description: 'Widget instance ID to set icon HTML for' }),
    html: Type.String({ description: 'Complete self-contained HTML fragment for the icon tier (e.g. <div>...</div>)' }),
  }),
  execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
    const pid = getCurrentPanelId()
    if (!pid) throw new Error('no panel context for tool set_widget_icon_html')
    const result = await executeViaWs('set_widget_icon_html', params, pid)
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      details: {},
    }
  },
}

const deleteHtmlWidgetTool: ToolDefinition = {
  name: 'delete_html_widget',
  label: 'Delete HTML Widget',
  description: 'Delete an HTML widget from the canvas by ID.',
  parameters: Type.Object({
    id: Type.String({ description: 'Widget instance ID to delete' }),
  }),
  execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
    const pid = getCurrentPanelId()
    if (!pid) throw new Error('no panel context for tool delete_html_widget')
    // Phase 13.2.2：危险且不可逆操作门控，需二次确认
    const { approved } = await executeWithPermission(pid, {
      toolName: 'delete_html_widget',
      description: `删除 HTML 组件：id=${(params as { id?: string }).id ?? ''}`,
      permission: 'dangerous',
      irreversible: true,
      arguments: params as Record<string, unknown>,
    })
    if (!approved) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: false, error: { code: 'PERMISSION_DENIED', message: 'User denied delete_html_widget' } }) }],
        details: {},
      }
    }
    const result = await executeViaWs('delete_html_widget', params, pid)
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      details: {},
    }
  },
}

const listWidgetsTool: ToolDefinition = {
  name: 'list_widgets',
  label: 'List Widgets',
  description: 'List all widgets currently on the canvas (including their IDs, types, and positions).',
  parameters: Type.Object({}),
  execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
    const pid = getCurrentPanelId()
    if (!pid) throw new Error('no panel context for tool list_widgets')
    const result = await executeViaWs('list_widgets', params, pid)
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      details: {},
    }
  },
}

const storageReadTool: ToolDefinition = {
  name: 'storage_read',
  label: 'Storage Read',
  description:
    'Read a value from the unified key-value storage, or read from an archived legacy table. ' +
    'When `table` is omitted, reads from kvStorage (unified KV store). ' +
    'When `table` is provided, reads from the corresponding archived legacy IndexedDB table ' +
    '(notes/journals/mistakes/quickNotes/savings/vocabDecks/vocabProgress). ' +
    'For legacy tables: use key="all" to list all records, or key="<id>" to get a single record by id. ' +
    'Special keys: savings table supports "transactions:<goalId>"; vocabProgress supports "deck:<deckId>" (no "all" support).',
  parameters: Type.Object({
    key: Type.String({ description: 'Storage key (e.g. "notes", "sudokuGames", "kv:user_pref") or legacy record id' }),
    table: Type.Optional(Type.String({
      description: 'Optional legacy table name (notes/journals/mistakes/quickNotes/savings/vocabDecks/vocabProgress). If omitted, reads from kvStorage.',
    })),
  }),
  execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
    const pid = getCurrentPanelId()
    if (!pid) throw new Error('no panel context for tool storage_read')
    const result = await executeViaWs('storage_read', params, pid)
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      details: {},
    }
  },
}

const storageWriteTool: ToolDefinition = {
  name: 'storage_write',
  label: 'Storage Write',
  description:
    'Write a value to the unified key-value storage. The frontend uses adapter.withFallback() to auto-coordinate IndexedDB/API.',
  parameters: Type.Object({
    key: Type.String({ description: 'Storage key' }),
    value: Type.Any({ description: 'Value to store (any JSON-serializable value)' }),
  }),
  execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
    const pid = getCurrentPanelId()
    if (!pid) throw new Error('no panel context for tool storage_write')
    // Phase 13.2.2：写操作门控，等待用户批准
    const { approved } = await executeWithPermission(pid, {
      toolName: 'storage_write',
      description: `写入存储：key=${(params as { key?: string }).key ?? ''}`,
      permission: 'write',
      arguments: params as Record<string, unknown>,
    })
    if (!approved) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: false, error: { code: 'PERMISSION_DENIED', message: 'User denied storage_write' } }) }],
        details: {},
      }
    }
    const result = await executeViaWs('storage_write', params, pid)
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      details: {},
    }
  },
}

// ============================================================================
// Browser tools - operate on the active web widget via WS
// ============================================================================

const browserEvalTool: ToolDefinition = {
  name: 'browser_eval',
  label: '浏览器执行脚本',
  description: '在当前活跃的网页组件中执行 JavaScript 脚本',
  parameters: Type.Object({
    script: Type.String({ description: '要执行的 JavaScript 代码' }),
  }),
  execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
    const pid = getCurrentPanelId()
    if (!pid) throw new Error('no panel context for tool browser_eval')
    // Phase 13.2.2：危险且不可逆操作门控（任意 JS 执行），需二次确认
    const { approved } = await executeWithPermission(pid, {
      toolName: 'browser_eval',
      description: '在网页组件中执行 JavaScript 脚本',
      permission: 'dangerous',
      irreversible: true,
      arguments: params as Record<string, unknown>,
    })
    if (!approved) {
      return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: { code: 'PERMISSION_DENIED', message: 'User denied browser_eval' } }) }], details: {} }
    }
    const result = await executeViaWs('browser_eval', params, pid)
    return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} }
  },
}

const browserGetDomTool: ToolDefinition = {
  name: 'browser_get_dom',
  label: '浏览器获取 DOM',
  description: '获取当前活跃网页组件的 DOM 内容（全部或指定选择器）',
  parameters: Type.Object({
    selector: Type.Optional(Type.String({ description: 'CSS 选择器，不填则获取整个 body' })),
  }),
  execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
    const pid = getCurrentPanelId()
    if (!pid) throw new Error('no panel context for tool browser_get_dom')
    const result = await executeViaWs('browser_get_dom', params, pid)
    return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} }
  },
}

const browserClickTool: ToolDefinition = {
  name: 'browser_click',
  label: '浏览器点击',
  description: '点击当前活跃网页组件中的元素',
  parameters: Type.Object({
    selector: Type.String({ description: 'CSS 选择器' }),
  }),
  execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
    const pid = getCurrentPanelId()
    if (!pid) throw new Error('no panel context for tool browser_click')
    const result = await executeViaWs('browser_click', params, pid)
    return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} }
  },
}

const browserInputTool: ToolDefinition = {
  name: 'browser_input',
  label: '浏览器输入',
  description: '在当前活跃网页组件的输入框输入文本',
  parameters: Type.Object({
    selector: Type.String({ description: 'CSS 选择器' }),
    text: Type.String({ description: '要输入的文本' }),
  }),
  execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
    const pid = getCurrentPanelId()
    if (!pid) throw new Error('no panel context for tool browser_input')
    const result = await executeViaWs('browser_input', params, pid)
    return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} }
  },
}

const browserScrollTool: ToolDefinition = {
  name: 'browser_scroll',
  label: '浏览器滚动',
  description: '滚动当前活跃网页组件到指定位置或元素',
  parameters: Type.Object({
    x: Type.Optional(Type.Number({ description: '水平滚动位置，单位像素' })),
    y: Type.Optional(Type.Number({ description: '垂直滚动位置，单位像素' })),
    selector: Type.Optional(Type.String({ description: '滚动到指定元素（CSS 选择器）' })),
  }),
  execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
    const pid = getCurrentPanelId()
    if (!pid) throw new Error('no panel context for tool browser_scroll')
    const result = await executeViaWs('browser_scroll', params, pid)
    return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} }
  },
}

const browserWaitForTool: ToolDefinition = {
  name: 'browser_wait_for',
  label: '浏览器等待',
  description: '等待条件满足（元素出现等）',
  parameters: Type.Object({
    condition: Type.String({ description: '等待条件（如 CSS 选择器或表达式）' }),
    timeout: Type.Optional(Type.Number({ description: '超时毫秒，默认 30000' })),
  }),
  execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
    const pid = getCurrentPanelId()
    if (!pid) throw new Error('no panel context for tool browser_wait_for')
    const result = await executeViaWs('browser_wait_for', params, pid)
    return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} }
  },
}

const browserScreenshotTool: ToolDefinition = {
  name: 'browser_screenshot',
  label: '浏览器截图',
  description: '截取当前活跃网页组件的可视区域截图',
  parameters: Type.Object({}),
  execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
    const pid = getCurrentPanelId()
    if (!pid) throw new Error('no panel context for tool browser_screenshot')
    const result = await executeViaWs('browser_screenshot', params, pid)
    return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} }
  },
}

const browserNavigateTool: ToolDefinition = {
  name: 'browser_navigate',
  label: '浏览器导航',
  description: '在当前活跃网页组件中导航到指定 URL',
  parameters: Type.Object({
    url: Type.String({ description: '要导航到的 URL' }),
  }),
  execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
    const pid = getCurrentPanelId()
    if (!pid) throw new Error('no panel context for tool browser_navigate')
    const result = await executeViaWs('browser_navigate', params, pid)
    return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} }
  },
}

const browserGetUrlTool: ToolDefinition = {
  name: 'browser_get_url',
  label: '浏览器获取 URL',
  description: '获取当前活跃网页组件的 URL',
  parameters: Type.Object({}),
  execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
    const pid = getCurrentPanelId()
    if (!pid) throw new Error('no panel context for tool browser_get_url')
    const result = await executeViaWs('browser_get_url', params, pid)
    return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} }
  },
}

const browserGetTitleTool: ToolDefinition = {
  name: 'browser_get_title',
  label: '浏览器获取标题',
  description: '获取当前活跃网页组件的页面标题',
  parameters: Type.Object({}),
  execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
    const pid = getCurrentPanelId()
    if (!pid) throw new Error('no panel context for tool browser_get_title')
    const result = await executeViaWs('browser_get_title', params, pid)
    return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} }
  },
}

const browserBackTool: ToolDefinition = {
  name: 'browser_back',
  label: '浏览器后退',
  description: '当前活跃网页组件后退到上一页',
  parameters: Type.Object({}),
  execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
    const pid = getCurrentPanelId()
    if (!pid) throw new Error('no panel context for tool browser_back')
    const result = await executeViaWs('browser_back', params, pid)
    return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} }
  },
}

const browserForwardTool: ToolDefinition = {
  name: 'browser_forward',
  label: '浏览器前进',
  description: '当前活跃网页组件前进到下一页',
  parameters: Type.Object({}),
  execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
    const pid = getCurrentPanelId()
    if (!pid) throw new Error('no panel context for tool browser_forward')
    const result = await executeViaWs('browser_forward', params, pid)
    return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} }
  },
}

const browserReloadTool: ToolDefinition = {
  name: 'browser_reload',
  label: '浏览器刷新',
  description: '刷新当前活跃网页组件',
  parameters: Type.Object({}),
  execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
    const pid = getCurrentPanelId()
    if (!pid) throw new Error('no panel context for tool browser_reload')
    const result = await executeViaWs('browser_reload', params, pid)
    return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} }
  },
}

const browserGetCookieTool: ToolDefinition = {
  name: 'browser_get_cookie',
  label: '浏览器获取 Cookie',
  description: '获取当前活跃网页组件的 Cookie',
  parameters: Type.Object({}),
  execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
    const pid = getCurrentPanelId()
    if (!pid) throw new Error('no panel context for tool browser_get_cookie')
    const result = await executeViaWs('browser_get_cookie', params, pid)
    return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} }
  },
}

const browserSetCookieTool: ToolDefinition = {
  name: 'browser_set_cookie',
  label: '浏览器设置 Cookie',
  description: '设置当前活跃网页组件的 Cookie',
  parameters: Type.Object({
    name: Type.String({ description: 'Cookie 名称' }),
    value: Type.String({ description: 'Cookie 值' }),
    domain: Type.Optional(Type.String({ description: 'Cookie 域名' })),
  }),
  execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
    const pid = getCurrentPanelId()
    if (!pid) throw new Error('no panel context for tool browser_set_cookie')
    // Phase 13.2.2：危险且不可逆操作门控（Cookie 可影响会话状态），需二次确认
    const { approved } = await executeWithPermission(pid, {
      toolName: 'browser_set_cookie',
      description: '设置网页组件 Cookie',
      permission: 'dangerous',
      irreversible: true,
      arguments: params as Record<string, unknown>,
    })
    if (!approved) {
      return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: { code: 'PERMISSION_DENIED', message: 'User denied browser_set_cookie' } }) }], details: {} }
    }
    const result = await executeViaWs('browser_set_cookie', params, pid)
    return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} }
  },
}

const browserOpenTool: ToolDefinition = {
  name: 'browser_open',
  label: '浏览器打开',
  description: '打开新网页（在当前面板创建新网页组件）',
  parameters: Type.Object({
    url: Type.String({ description: '要打开的 URL' }),
  }),
  execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
    const pid = getCurrentPanelId()
    if (!pid) throw new Error('no panel context for tool browser_open')
    const result = await executeViaWs('browser_open', params, pid)
    return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} }
  },
}

const browserSwitchTabTool: ToolDefinition = {
  name: 'browser_switch_tab',
  label: '浏览器切换标签',
  description: '切换到包含指定网页组件的面板',
  parameters: Type.Object({
    widgetId: Type.String({ description: '网页组件 ID' }),
  }),
  execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
    const pid = getCurrentPanelId()
    if (!pid) throw new Error('no panel context for tool browser_switch_tab')
    const result = await executeViaWs('browser_switch_tab', params, pid)
    return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} }
  },
}

const browserListTabsTool: ToolDefinition = {
  name: 'browser_list_tabs',
  label: '浏览器列出标签',
  description: '列出所有打开的网页组件',
  parameters: Type.Object({}),
  execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
    const pid = getCurrentPanelId()
    if (!pid) throw new Error('no panel context for tool browser_list_tabs')
    const result = await executeViaWs('browser_list_tabs', params, pid)
    return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} }
  },
}

// ============================================================================
// Phase 8 批次5 模块D：ask_user 工具
// AI 主动向用户提问（选项框形式），不阻塞 AI 思考
// ============================================================================

const askUserTool: ToolDefinition = {
  name: 'ask_user',
  label: 'Ask User',
  description:
    'Ask the user a question with selectable options. Use this when you need user input to proceed. ' +
    'The user will see a card with options to choose from. This does NOT stop the AI - the user can answer while AI continues thinking about other things.',
  parameters: Type.Object({
    question: Type.String({ description: 'The question to ask the user' }),
    options: Type.Array(
      Type.Object({
        label: Type.String({ description: 'Short label for the option' }),
        description: Type.Optional(
          Type.String({ description: 'Optional longer description of this option' }),
        ),
        value: Type.String({ description: 'The value to return when this option is selected' }),
      }),
      { minItems: 2, maxItems: 4 },
    ),
    allowMultiple: Type.Optional(
      Type.Boolean({ description: 'Whether to allow multiple selections. Default: false' }),
    ),
  }),
  execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
    const { question, options, allowMultiple } = params as {
      question: string
      options: AskUserOption[]
      allowMultiple?: boolean
    }
    const panelId = getCurrentPanelId()
    if (!panelId) throw new Error('No panel context for ask_user')

    // M12 修复：直接返回 executeAskUser 的 Promise，去掉冗余 Promise 包装
    const result = await executeAskUser(panelId, question, options, allowMultiple ?? false)
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      details: {},
    }
  },
}

// ============================================================================
// Phase S9：local_search 工具（路由到客户端执行，spec 2.4 节）
// 检索本端已同步数据（面板/笔记/任务/书签等），需在客户端执行
// ============================================================================

const localSearchTool: ToolDefinition = {
  name: 'local_search',
  label: '本地搜索',
  description: '检索本端已同步数据（面板/笔记/任务/书签等）',
  parameters: Type.Object({
    query: Type.String({ description: '搜索关键词（中英文混合，支持子串匹配）' }),
    type: Type.Optional(
      Type.String({
        description:
          '限定数据类型（可选）：panel/task/calendarEvent/habit/note/journal/quickNote/mistake/vocabDeck/vocabProgress/panelTemplate/bookmark/webTab/widget/dynamicWidget/htmlWidget/favorite/aiConversation/aiMemory/moodEntry/savingsTransaction/drawingStroke/widgetConnection/focusSession',
      }),
    ),
    limit: Type.Optional(Type.Number({ description: '返回条数上限，默认 20，硬上限 50' })),
  }),
  execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
    const pid = getCurrentPanelId()
    if (!pid) throw new Error('no panel context for tool local_search')
    const result = await executeViaWs('local_search', params, pid)
    return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} }
  },
}

// ============================================================================
// Phase 5：背景层 + 弹出层工具（spec §3.2/§3.3）
// 均通过 WS 路由到客户端执行（操作前端 store + DOM）
// ============================================================================

const setBackgroundTool: ToolDefinition = {
  name: 'set_background',
  label: '设置背景',
  description:
    'Set the canvas background layer. The background is fixed to the viewport and does NOT participate in album zoom. ' +
    'Supports three types: color (solid color), gradient (CSS gradient string), image (URL or data URL).',
  parameters: Type.Object({
    type: Type.String({ description: 'Background type: "color" | "gradient" | "image"' }),
    color: Type.Optional(Type.String({ description: 'CSS color value (required when type=color), e.g. "#1a1a2e" or "rgb(26,26,46)"' })),
    gradient: Type.Optional(Type.String({ description: 'CSS gradient string (required when type=gradient), e.g. "linear-gradient(135deg, #1a1a2e, #0f3460)"' })),
    imageUrl: Type.Optional(Type.String({ description: 'Image URL or data URL (required when type=image)' })),
  }),
  execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
    const pid = getCurrentPanelId()
    if (!pid) throw new Error('no panel context for tool set_background')
    const result = await executeViaWs('set_background', params, pid)
    return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} }
  },
}

const uploadBackgroundImageTool: ToolDefinition = {
  name: 'upload_background_image',
  label: '上传背景图片',
  description:
    'Upload a binary image as the canvas background. AI provides base64-encoded image data and a filename. ' +
    'The image is saved on the server and automatically set as the background. ' +
    'Supported formats: png, jpg, jpeg, gif, webp, svg, bmp. Max size: 10MB.',
  parameters: Type.Object({
    imageBase64: Type.String({ description: 'Base64-encoded image data (without data: prefix). Example: "iVBORw0KGgoAAAANSUhEUg..."' }),
    filename: Type.String({ description: 'Original filename with extension, e.g. "bg.png" or "photo.jpg". Used to determine the file type.' }),
  }),
  execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
    const pid = getCurrentPanelId()
    if (!pid) throw new Error('no panel context for tool upload_background_image')
    const { imageBase64, filename } = params as { imageBase64: string; filename: string }

    if (!imageBase64 || typeof imageBase64 !== 'string') {
      throw new Error('imageBase64 is required and must be a string')
    }
    if (!filename || typeof filename !== 'string') {
      throw new Error('filename is required')
    }

    // 验证扩展名
    const ALLOWED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'])
    const ext = extname(filename).toLowerCase()
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      throw new Error(`File type ${ext} not allowed. Allowed: ${Array.from(ALLOWED_EXTENSIONS).join(', ')}`)
    }

    // 解码 base64
    let buffer: Buffer
    try {
      // 移除可能存在的前缀（data:image/png;base64,）
      const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '')
      buffer = Buffer.from(base64Data, 'base64')
    } catch (e) {
      throw new Error(`Failed to decode base64: ${e instanceof Error ? e.message : String(e)}`)
    }

    // 大小检查（10MB）
    if (buffer.length > 10 * 1024 * 1024) {
      throw new Error(`Image too large: ${buffer.length} bytes (max 10MB)`)
    }

    // 确保目录存在
    if (!existsSync(BACKGROUNDS_DIR)) {
      mkdirSync(BACKGROUNDS_DIR, { recursive: true })
    }

    // 保存文件
    const savedFilename = `${randomUUID()}${ext}`
    const filePath = join(BACKGROUNDS_DIR, savedFilename)
    writeFileSync(filePath, buffer)

    const imageUrl = `/backgrounds/${savedFilename}`

    // 自动调用 set_background 设置背景
    const bgResult = await executeViaWs('set_background', {
      type: 'image',
      imageUrl,
    }, pid)

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          imageUrl,
          filename: savedFilename,
          size: buffer.length,
          backgroundSet: bgResult,
        }),
      }],
      details: {},
    }
  },
}

const addEffectTool: ToolDefinition = {
  name: 'add_effect',
  label: '添加背景特效',
  description:
    'Add a visual effect to the background layer. Effects are rendered on top of the background but below widgets. ' +
    'Supported effects: rain, snow, particles, stars. Only one effect at a time (calling again replaces the previous).',
  parameters: Type.Object({
    effect: Type.String({ description: 'Effect type: "rain" | "snow" | "particles" | "stars" | "none" (to remove)' }),
    config: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: 'Effect configuration (e.g. {count: 100, speed: 1, color: "#fff"} for particles)' })),
  }),
  execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
    const pid = getCurrentPanelId()
    if (!pid) throw new Error('no panel context for tool add_effect')
    const result = await executeViaWs('add_effect', params, pid)
    return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} }
  },
}

const placeBasicComponentTool: ToolDefinition = {
  name: 'place_basic_component',
  label: '放置背景基础组件',
  description:
    'Place a basic component on the background layer (fixed to viewport, does NOT participate in album zoom). ' +
    'Supported types: clock (analog/digital clock), text (static text), image (static image). ' +
    'Returns a componentId that can be used to remove it later.',
  parameters: Type.Object({
    componentType: Type.String({ description: 'Component type: "clock" | "text" | "image"' }),
    position: Type.Object({
      x: Type.Number({ description: 'Viewport X position in px' }),
      y: Type.Number({ description: 'Viewport Y position in px' }),
    }),
    config: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: 'Component config (e.g. {format: "HH:mm:ss"} for clock, {content: "Hello"} for text, {url: "..."} for image)' })),
  }),
  execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
    const pid = getCurrentPanelId()
    if (!pid) throw new Error('no panel context for tool place_basic_component')
    const result = await executeViaWs('place_basic_component', params, pid)
    return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} }
  },
}

const showPopupTool: ToolDefinition = {
  name: 'show_popup',
  label: '显示弹出层',
  description:
    'Show a popup on the popup layer (z-index 1000, topmost layer). Multiple popups can stack. ' +
    'Supports types: login (login window), html (custom HTML content), text (simple text message), image (image popup). ' +
    'Close conditions can be specified: login_success, manual, timer, ai_dismiss.',
  parameters: Type.Object({
    popupType: Type.String({ description: 'Popup type: "login" | "html" | "text" | "image"' }),
    content: Type.Optional(Type.String({ description: 'Content (HTML string for html type, text for text type, URL for image type)' })),
    title: Type.Optional(Type.String({ description: 'Popup title' })),
    closeOn: Type.Optional(Type.Array(Type.String(), { description: 'Close conditions: ["login_success", "manual", "timer", "ai_dismiss"]. Default: ["manual"]' })),
    autoCloseMs: Type.Optional(Type.Number({ description: 'Auto-close after N ms (requires "timer" in closeOn)' })),
    position: Type.Optional(Type.Object({
      x: Type.Optional(Type.Number({ description: 'Viewport X (default: centered)' })),
      y: Type.Optional(Type.Number({ description: 'Viewport Y (default: centered)' })),
    })),
  }),
  execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
    const pid = getCurrentPanelId()
    if (!pid) throw new Error('no panel context for tool show_popup')
    const result = await executeViaWs('show_popup', params, pid)
    return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} }
  },
}

const dismissPopupTool: ToolDefinition = {
  name: 'dismiss_popup',
  label: '关闭弹出层',
  description:
    'Dismiss a popup by ID, or all popups if no ID specified. ' +
    'Only popups with "ai_dismiss" or "manual" in their closeOn conditions can be dismissed by AI.',
  parameters: Type.Object({
    popupId: Type.Optional(Type.String({ description: 'Popup ID to dismiss. If omitted, dismisses all dismissible popups.' })),
  }),
  execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
    const pid = getCurrentPanelId()
    if (!pid) throw new Error('no panel context for tool dismiss_popup')
    const result = await executeViaWs('dismiss_popup', params, pid)
    return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} }
  },
}

const customTools: ToolDefinition[] = [
  createHtmlWidgetTool,
  updateHtmlWidgetTool,
  // Phase 2 决策38/39：mini/icon 档 AI 自定义 HTML 工具
  setWidgetMiniHtmlTool,
  setWidgetIconHtmlTool,
  deleteHtmlWidgetTool,
  listWidgetsTool,
  // Phase 5：背景层 + 弹出层工具（路由到客户端执行，spec §3.2/§3.3）
  setBackgroundTool,
  uploadBackgroundImageTool,
  addEffectTool,
  placeBasicComponentTool,
  showPopupTool,
  dismissPopupTool,
  storageReadTool,
  storageWriteTool,
  // 浏览器工具（操作当前活跃的网页组件）
  browserEvalTool,
  browserGetDomTool,
  browserClickTool,
  browserInputTool,
  browserScrollTool,
  browserWaitForTool,
  browserScreenshotTool,
  browserNavigateTool,
  browserGetUrlTool,
  browserGetTitleTool,
  browserBackTool,
  browserForwardTool,
  browserReloadTool,
  browserGetCookieTool,
  browserSetCookieTool,
  browserOpenTool,
  browserSwitchTabTool,
  browserListTabsTool,
  // Phase 8 批次5 模块D：AI 主动向用户提问
  askUserTool,
  // Phase S9：4 个搜索工具（local_search 路由到客户端，其余 3 个直接调外部 API）
  localSearchTool,
  ...searchTools,  // webSearchTool, readWebpageTool, academicSearchTool, exaFindSimilarTool
  // Phase 14.4：查询组件能力声明（system 工具，不可禁用）
  queryCapabilitiesTool,
  // Phase 3：7 个文件系统工具（PI 原生工具，在服务端沙箱内运行，默认禁用，spec §7）
  ...fileSystemTools,
]

// ============================================================================
// Pi session lifecycle（Phase 4：per-panel session，spec 2.2 节）
// ============================================================================

// sessionReady 改为按面板标记（不再全局）
const panelSessionReady = new Set<string>()

/**
 * 把 pi 事件转发到客户端（携带 panelId，spec 2.2 节）
 * S2 缺口 A：按面板定向广播（避免全广播到所有设备）
 * 客户端按 panelId 过滤，只处理当前活跃面板的事件
 */
function forwardEventToClient(event: unknown, panelId: string): void {
  const e = event as { type?: string; [key: string]: unknown }
  if (!e || typeof e.type !== 'string') return

  // S2 缺口 A：按面板定向广播（避免全广播到所有设备）
  const onlineSet = panelOnlineDevices.get(panelId)
  if (onlineSet && onlineSet.size > 0) {
    // 定向广播到该面板的所有在线设备
    for (const deviceId of onlineSet) {
      sendToDevice(deviceId, { kind: 'pi_event', event: e.type, data: e, panelId })
    }
  } else {
    // 兜底：无在线设备记录时（如客户端未发 user_message 就已订阅），
    // 退化为全广播 + panelId 过滤（兼容旧客户端）
    broadcast({ kind: 'pi_event', event: e.type, data: e, panelId })
  }
}

/**
 * 把 widget 错误报告格式化为 agent 可读的 user message（spec 5.1）
 * 错误作为 user message 注入 agent 上下文，让 agent 自我修复 HTML 代码
 */
function formatErrorMessage(report: ErrorReport): string {
  const lines = [
    `HTML Widget 运行时错误（widgetId: ${report.widgetId}）：`,
    `错误信息：${report.message}`,
    `错误来源：${report.source}`,
  ]
  if (report.stack) {
    lines.push(`堆栈：`)
    lines.push(report.stack)
  }
  lines.push('')
  lines.push('请检查并修复 HTML 代码中的问题。')
  return lines.join('\n')
}

/**
 * 读取已启用的工具列表（Phase S4，spec 9.3.4 节 + Phase 3 spec §7）
 * 从 tool_settings 表读取用户配置，按以下规则过滤：
 * - 系统工具（canDisable=false）永远启用，不受配置影响
 * - 其他工具：tool_settings 表中有记录则用表中的值，否则用 defaultEnabled 字段
 *   - 现有 30 个工具 defaultEnabled=true（默认启用）
 *   - 7 个文件系统工具 defaultEnabled=false（默认禁用，需用户手动开启）
 */
async function getEnabledCustomTools(): Promise<ToolDefinition[]> {
  // 1. 从 tool_settings 表读取所有工具的启用状态
  const enabledStates = new Map<string, boolean>()
  try {
    const pool = getPool()
    const result = await pool.query('SELECT tool_name, enabled FROM tool_settings')
    for (const row of result.rows) {
      // 仅处理已知的 AI 工具（过滤掉 skills 误存的 builtin:/user: 记录）
      if (isValidToolName(row.tool_name)) {
        enabledStates.set(row.tool_name, row.enabled)
      }
    }
  } catch (err) {
    console.warn('[PiBridge] getEnabledCustomTools failed, registering all tools:', err)
    return customTools
  }

  // 2. 过滤 customTools
  const filtered = customTools.filter(tool => {
    const info = AI_TOOL_MAP.get(tool.name)
    if (!info) return true // 未知工具，默认启用（兜底）
    if (!info.canDisable) return true // 系统工具（ask_user, query_capabilities），永远启用
    // 按表配置 + defaultEnabled 决定
    const enabled = enabledStates.get(tool.name) ?? info.defaultEnabled
    return enabled
  })

  const disabledCount = customTools.length - filtered.length
  if (disabledCount > 0) {
    const disabledNames = customTools
      .filter(t => !filtered.includes(t))
      .map(t => t.name)
    console.log(`[PiBridge] Tool filter: ${customTools.length} total, ${filtered.length} enabled, ${disabledCount} disabled: ${disabledNames.join(', ')}`)
  } else {
    console.log(`[PiBridge] Tool filter: ${customTools.length} total, all enabled`)
  }
  return filtered
}

/**
 * 创建面板的 AgentSession（spec 2.2 节）
 * - 共享 SessionManager 单例
 * - 从 ai_settings 表读取模型配置和提示词
 * - 订阅 pi 事件，广播到该面板的所有在线设备
 */
async function createSession(panelId: string, apiConfig?: ApiConfigPayload): Promise<AgentSession> {
  // Phase 14 C5 修复：懒加载 pi-coding-agent 运行时符号（避免 server 启动时 import 超时）
  const {
    AuthStorage,
    createAgentSession,
    DefaultResourceLoader,
    getAgentDir,
    ModelRegistry,
    SessionManager,
  } = await loadPiAgent()

  const cwd = process.cwd()
  const agentDir = getAgentDir()

  // SessionManager 单例（只创建一次，spec 2.2 节）
  if (!sharedSessionManager) {
    sharedSessionManager = SessionManager.inMemory(cwd)
  }

  // 加载提示词（spec 3.2 节，从 ai_settings 表读取）
  const overrides = await getPromptOverrides()
  const prompts = {
    canvas: overrides.canvasPrompt ?? DEFAULT_PROMPTS.canvasPrompt,
    browser: overrides.browserPrompt ?? DEFAULT_PROMPTS.browserPrompt,
    system: overrides.systemPrompt ?? DEFAULT_PROMPTS.systemPrompt,
  }

  // 读取已启用的工具列表（Phase S4：基于 tool_settings 表过滤，spec 9.3.4 节）
  // 在 resourceLoader.reload() 之前读取一次，闭包复用，确保 extensionFactories 与
  // createAgentSession 使用同一份过滤结果（避免重复查询数据库）
  const effectiveTools = await getEnabledCustomTools()

  // Phase 14.3：加载 .pi/skills/ 下的 Skill CLI（canvas-cli/memory-cli/life-cli/music-cli 等）
  // DefaultResourceLoader 默认 includeDefaults=false，不会自动扫描 .pi/skills/，
  // 必须通过 additionalSkillPaths 注入（与桌面端 LocalAgentService.ts 对齐）
  const skillsDir = join(cwd, '.pi', 'skills')

  // Load extensions (this picks up ~/.pi/agent/extensions/stepfun-provider.ts)
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    additionalSkillPaths: [skillsDir],
    extensionFactories: [
      (pi) => {
        // Register our custom tools via extension API as well.
        // This ensures they appear in the tool registry regardless of
        // how createAgentSession handles customTools.
        // Phase S4：使用 effectiveTools（已按 tool_settings 过滤）
        for (const tool of effectiveTools) {
          pi.registerTool(tool)
        }
      },
    ],
    appendSystemPromptOverride: (base) => {
      const result = [...base]
      if (prompts.canvas) result.push(prompts.canvas)
      if (prompts.browser) result.push(prompts.browser)
      if (prompts.system) result.push(prompts.system)
      return result
    },
  })
  await resourceLoader.reload()

  // Phase 8 批次3：模型配置优先级 apiConfig > ai_settings > env
  const aiSettings = await getAiSettings()

  // 解析 model：apiConfig.model > aiSettings.model > env
  const modelEnv = apiConfig?.model || aiSettings.model || process.env.PI_MODEL || 'stepfun/step-3.7-flash'

  // S17.9 修复：根据 endpoint 域名推断 provider（与 aiSettings.ts resolveModelsEndpoint 保持一致）
  // - modelEnv 含 / → 直接 split
  // - modelEnv 不含 / → 根据 endpoint 域名推断 provider（stepfun/deepseek/openai/anthropic）
  // - endpoint 也为空 → 默认 stepfun
  // 【安全修复 2026-08-16（H8）】：客户端 apiConfig.endpoint 此前可指向任意地址
  // （SSRF），且会改写全局 process.env.PI_API_ENDPOINT 污染其他会话。现在：
  // - endpoint 只允许 https + 白名单域名（stepfun/deepseek/openai/anthropic）
  // - 不再改写全局 env（改为仅本次会话局部使用）
  const endpoint = apiConfig?.endpoint || aiSettings.endpoint || process.env.PI_API_ENDPOINT
  const ALLOWED_ENDPOINT_HOSTS = new Set([
    'api.stepfun.com', 'api.deepseek.com', 'api.openai.com', 'api.anthropic.com',
  ])
  const sanitizeEndpoint = (raw: string | undefined): string | undefined => {
    if (!raw || typeof raw !== 'string') return undefined
    const trimmed = raw.trim()
    if (!/^https:\/\//.test(trimmed)) return undefined // 只允许 https
    try {
      const u = new URL(trimmed)
      const host = u.hostname.toLowerCase()
      // 拒绝 IP 字面量 / localhost / 内网
      if (host === 'localhost' || /^[\d.]+$/.test(host) || host.includes(':')) return undefined
      // 【回归审查修正】：精确域名或 .域名 后缀（防 evilstepfun.com 绕过）
      if (![...ALLOWED_ENDPOINT_HOSTS].some((allowed) => host === allowed || host.endsWith('.' + allowed))) return undefined
      return trimmed
    } catch {
      return undefined
    }
  }
  const effectiveEndpoint = sanitizeEndpoint(endpoint)
  let providerName: string
  let modelName: string
  if (modelEnv.includes('/')) {
    const parts = modelEnv.split('/')
    providerName = parts[0]!
    modelName = parts.slice(1).join('/')
  } else {
    modelName = modelEnv
    if (effectiveEndpoint) {
      const lower = effectiveEndpoint.toLowerCase()
      if (lower.includes('stepfun.com')) providerName = 'stepfun'
      else if (lower.includes('deepseek.com')) providerName = 'deepseek'
      else if (lower.includes('openai.com')) providerName = 'openai'
      else if (lower.includes('anthropic.com')) providerName = 'anthropic'
      else providerName = 'stepfun' // 自定义 endpoint 默认 stepfun
    } else {
      providerName = 'stepfun' // 无 endpoint 默认 stepfun
    }
  }

  // API Key 优先级：apiConfig.apiKey > aiSettings.apiKey > PI_API_KEY > VITE_STEPFUN_API_KEY
  const authStorage = AuthStorage.create(agentDir ? join(agentDir, 'auth.json') : undefined)
  const piApiKey = apiConfig?.apiKey || aiSettings.apiKey || process.env.PI_API_KEY
  if (piApiKey) {
    authStorage.setRuntimeApiKey(providerName, piApiKey)
  } else if (providerName === 'stepfun' && process.env.VITE_STEPFUN_API_KEY) {
    authStorage.setRuntimeApiKey('stepfun', process.env.VITE_STEPFUN_API_KEY)
  }

  // 自定义 endpoint：仅本次会话临时生效（H8 修复——不再永久改写全局 process.env，
  // 会话结束/异常后恢复原值，杜绝 apiConfig.endpoint 污染其他会话）
  const sessionEndpoint = effectiveEndpoint
  const prevEndpointEnv = process.env.PI_API_ENDPOINT
  if (sessionEndpoint) {
    process.env.PI_API_ENDPOINT = sessionEndpoint
  }

  const modelRegistry = ModelRegistry.create(authStorage)

  // Flush extension provider registrations into modelRegistry BEFORE model
  // 修复（Daily AI Provider 配置不匹配问题）：
  //   用户家目录 ~/.pi/agent/extensions/stepfun-provider.ts 加载时，apiKey 取自
  //   process.env.VITE_STEPFUN_API_KEY；但 Daily server 进程未加载项目根目录的
  //   .env.local（server 只读 server/.env），导致 apiKey 为空字符串，SDK 抛
  //   "Provider stepfun: apiKey or oauth is required when defining models"，
  //   进而整个 createSession 失败，登录用户发 AI 消息报错。
  //
  // 修复策略：以 DB aiSettings 为单一可信源
  //   - 对于 apiKey 为空的非内置 provider extension 注册：
  //     * 若该 provider 名与 DB 配置推断出的 providerName 相同，用 DB 的 piApiKey 填充
  //     * 否则跳过该 provider 注册（不影响 DB 配置的主 provider 走内置注册路径）
  //   - 注册过程用 try/catch 包裹，避免单个 extension 失败导致整个 createSession 失败
  const extensionsResult = resourceLoader.getExtensions()
  for (const { name, config } of extensionsResult.runtime.pendingProviderRegistrations) {
    if (!config.apiKey && !config.oauth) {
      if (name === providerName && piApiKey) {
        // DB 配置的 provider 与该 extension 注册的 provider 相同，用 DB 的 apiKey 填充
        config.apiKey = piApiKey
        console.log(`[PiBridge] Filled provider "${name}" apiKey from DB aiSettings`)
      } else {
        // 跳过该 provider 注册（不影响主流程，DB 用的是其他 provider 走内置路径）
        console.warn(`[PiBridge] Skipping provider "${name}" registration: no apiKey or oauth (extension unusable). DB provider is "${providerName}".`)
        continue
      }
    }
    try {
      modelRegistry.registerProvider(name, config)
    } catch (err) {
      console.warn(`[PiBridge] Failed to register provider "${name}":`, err instanceof Error ? err.message : err)
    }
  }
  extensionsResult.runtime.pendingProviderRegistrations = []

  // 3. 显式选择模型
  const model = modelRegistry.find(providerName, modelName)
  if (!model) {
    throw new Error(`model not found in registry: ${modelEnv}. Ensure provider "${providerName}" is registered and model "${modelName}" exists, and API key is set.`)
  }

  console.log(`[PiBridge] Panel ${panelId}: using model ${providerName}/${modelName}`)

  let sessionInstance: AgentSession
  try {
    const { session: s } = await createAgentSession({
      cwd,
      agentDir,
      resourceLoader,
      sessionManager: sharedSessionManager,  // 共享单例
      authStorage,
      modelRegistry,
      model,
      noTools: 'builtin',
      customTools: effectiveTools,
    })
    sessionInstance = s
  } finally {
    // H8 修复：恢复被临时改写的全局 endpoint（防止污染后续会话）
    if (sessionEndpoint) {
      if (prevEndpointEnv === undefined) delete process.env.PI_API_ENDPOINT
      else process.env.PI_API_ENDPOINT = prevEndpointEnv
    }
  }

  // 订阅 pi 事件，广播到该面板的所有在线设备（携带 panelId）
  // v3 修复 B4：保存 handler 引用，disposePanelSession 时 unsubscribe
  const subscribeHandler = (event: unknown) => {
    const e = event as { type?: string; [key: string]: unknown }
    // v3 修复 B3：关键诊断日志
    console.log('[PiBridge] event', e.type, panelId)

    // 1. 转发到客户端（原有逻辑）
    forwardEventToClient(event, panelId)

    // 2. 持久化 assistant / tool 消息（S1 缺口 A）
    void persistPiEvent(panelId, e).catch((err) => {
      console.warn(`[PiBridge] persistPiEvent failed for panel ${panelId}:`, err)
    })
  }
  sessionInstance.subscribe(subscribeHandler)
  panelSessionSubscribeHandlers.set(panelId, subscribeHandler)

  return sessionInstance
}

export async function initPiBridge(): Promise<void> {
  // Phase 3：初始化文件系统工具沙箱目录（spec §7）
  try {
    initSandbox()
  } catch (err) {
    console.warn('[PiBridge] Sandbox init failed, filesystem tools may not work:', err)
  }

  // Phase 4：不再创建全局 session，改为按需创建 per-panel session（spec 2.2 节）
  console.log('[PiBridge] Initialized (per-panel session mode, lazy creation)')

  // WS message handler（携带 deviceId + panelId，spec 2.2 节）
  onClientMessage((msg, deviceId) => {
    if (msg.kind === 'user_message') {
      // Phase 8 批次3：panelId 可选（M2 修复），纯对话模式用 session-only:panelId
      const effectivePanelId = msg.panelId ?? (msg.sessionId ? `session-only:${msg.sessionId}` : `session-only:anon-${deviceId}`)

      // 游客限频检查：游客设备按 guestDeviceId 限频（5次/分，50次/天）
      if (isGuestDevice(deviceId)) {
        const guestDeviceId = getGuestDeviceId(deviceId) ?? deviceId
        const rateLimitMsg = checkGuestRateLimit(guestDeviceId)
        if (rateLimitMsg) {
          console.warn(`[PiBridge] Guest rate limited: deviceId=${deviceId}, guestDeviceId=${guestDeviceId}`)
          sendToDevice(deviceId, {
            kind: 'error',
            message: rateLimitMsg,
            panelId: effectivePanelId,
          })
          return
        }
      }

      // 设置该面板的活跃设备
      setPanelActiveDevice(effectivePanelId, deviceId)

      // S2 缺口 A：加入该面板的在线设备集合（用于定向广播）
      let onlineSet = panelOnlineDevices.get(effectivePanelId)
      if (!onlineSet) {
        onlineSet = new Set()
        panelOnlineDevices.set(effectivePanelId, onlineSet)
      }
      onlineSet.add(deviceId)

      // S2 2.1.8：设备切换面板自动清理（清理该设备在其他面板的在线集合 + activeDevice 映射）
      cleanupDeviceFromOtherPanels(deviceId, effectivePanelId)

      // Phase 8 批次3 + spec 7.2 M4 修复：传递 apiConfig + callerWidgetId
      handleUserMessage(msg.content, deviceId, effectivePanelId, msg.apiConfig, msg.callerWidgetId).catch((err) => {
        console.error('[PiBridge] Error handling user_message:', err)
        sendToDevice(deviceId, {
          kind: 'error',
          message: `Failed to handle user message: ${err instanceof Error ? err.message : String(err)}`,
        })
      })
    } else if (msg.kind === 'dispose_session') {
      // Phase 8 批次3：处理 dispose_session 消息（C3 修复：支持 sessionId fallback）
      // S2 对抗审查 S-1 修复：dispose_session 仅移除当前设备的在线记录；
      // 只有当该面板已无其他在线设备时才销毁 session，避免多端场景下误销毁其他设备的会话上下文
      const effectivePanelId = msg.panelId ?? (msg.sessionId ? `session-only:${msg.sessionId}` : null)
      if (effectivePanelId) {
        // S2 缺口 A：从该面板的在线设备集合移除（用户主动删除会话场景）
        let remainingCount = 0
        const onlineSet = panelOnlineDevices.get(effectivePanelId)
        if (onlineSet) {
          onlineSet.delete(deviceId)
          remainingCount = onlineSet.size
          if (remainingCount === 0) {
            panelOnlineDevices.delete(effectivePanelId)
          }
        }

        // S2 对抗审查 S-1 修复：只有该面板无其他在线设备时才销毁 session
        if (remainingCount === 0) {
          disposePanelSession(effectivePanelId).catch((err) => {
            console.warn(`[PiBridge] dispose_session failed for ${effectivePanelId}:`, err)
          })
        } else {
          console.log(`[PiBridge] Device ${deviceId} left panel ${effectivePanelId}, ${remainingCount} device(s) still active, keeping session`)
        }
      }
    } else if (msg.kind === 'tool_result') {
      const pending = pendingRequests.get(msg.requestId)
      if (!pending) {
        console.warn('[PiBridge] Received tool_result for unknown requestId:', msg.requestId)
        return
      }
      clearTimeout(pending.timer)
      pendingRequests.delete(msg.requestId)
      if (msg.success) {
        // 工具成功，重置该 panel+tool 的失败计数
        resetToolFailure(pending.panelId, pending.tool)
        pending.resolve(msg.data)
      } else {
        // 修复：工具逻辑失败也递增失败计数，防止 AI 反复调用返回 {success: false} 的工具导致无限循环
        incrementToolFailure(pending.panelId, pending.tool)
        pending.reject(new Error(msg.error || 'tool execution failed on client'))
      }
    } else if (msg.kind === 'ask_user_response') {
      // Phase 8 批次5 模块D：处理用户对 ask_user 的回复
      handleAskUserResponse(msg)
    } else if (msg.kind === 'permission_response') {
      // Phase 13.2.2：处理用户对 permission_request 的批准/拒绝回复
      handlePermissionResponse(msg)
    } else if (msg.kind === 'cancel_request') {
      // v3 修复 B1/A6：用户主动取消 AI 响应
      // 调用 disposePanelSession 销毁 session（停止 SDK 内部循环的最好努力）
      // 不保证 SDK 立即停止，但 session 销毁后下次 prompt 会创建新 session
      console.log(`[PiBridge] cancel_request from device ${deviceId} for panel ${msg.panelId}`)
      void disposePanelSession(msg.panelId).catch((err) => {
        console.warn(`[PiBridge] cancel_request dispose failed for ${msg.panelId}:`, err)
      })
    }
    // 注：sync_queue_flush 消息处理已删除，统一用 HTTP 回写方案（Spec 6.6 节）
  })

  // Phase 3B：注册 error_report handler（携带 deviceId）
  // iframe 运行时错误 → WS → 这里 → 注入 agent 上下文作为 user message
  // S2 缺口 D：error_report 携带 panelId（客户端从 widgetId 反查），服务器优先用之
  // 三级兜底：report.panelId → panelOnlineDevices 反向（取最近活跃）→ panelActiveDevices 反向（取最近活跃）
  onErrorReport((report, deviceId) => {
    const errorMessage = formatErrorMessage(report)
    console.log(`[PiBridge] Widget error reported (widgetId=${report.widgetId}, panelId=${report.panelId ?? 'N/A'}, device=${deviceId}), injecting to agent context`)

    // S2 缺口 D：优先用 report.panelId
    let targetPanelId: string | undefined = report.panelId
    if (!targetPanelId) {
      // 兜底 1：从 panelOnlineDevices 反向查找该 deviceId 关联的面板（取最近活跃）
      let bestTimestamp = -1
      for (const [pid, onlineSet] of panelOnlineDevices) {
        if (onlineSet.has(deviceId) && !pid.startsWith('session-only:')) {
          const ts = sessionLastUsed.get(pid) ?? 0
          if (ts > bestTimestamp) {
            bestTimestamp = ts
            targetPanelId = pid
          }
        }
      }
    }
    if (!targetPanelId) {
      // 兜底 2：从 panelActiveDevices 反向查找（S1 旧逻辑，取最近活跃）
      let bestTimestamp = -1
      for (const [pid, devId] of panelActiveDevices) {
        if (devId === deviceId) {
          const ts = sessionLastUsed.get(pid) ?? 0
          if (ts > bestTimestamp) {
            bestTimestamp = ts
            targetPanelId = pid
          }
        }
      }
    }
    if (!targetPanelId) {
      console.warn('[PiBridge] No panel found for error_report, dropping')
      return
    }

    // 修复：error_report 速率限制，阻断 error_report → prompt → 修复 → 又报错的无限循环
    const now = Date.now()
    const timestamps = panelErrorTimestamps.get(targetPanelId) ?? []
    const recent = timestamps.filter(t => now - t < 60_000)
    if (recent.length >= ERROR_REPORT_MAX_PER_MINUTE) {
      console.warn(`[PiBridge] error_report rate limited for panel ${targetPanelId} (max ${ERROR_REPORT_MAX_PER_MINUTE}/min), dropping`)
      return
    }
    if (recent.length > 0 && now - recent[recent.length - 1] < ERROR_REPORT_COOLDOWN_MS) {
      console.warn(`[PiBridge] error_report cooldown for panel ${targetPanelId} (${ERROR_REPORT_COOLDOWN_MS}ms), dropping`)
      return
    }
    recent.push(now)
    panelErrorTimestamps.set(targetPanelId, recent)

    // 不 await，让事件流驱动（spec 5.1）
    handleUserMessage(errorMessage, deviceId, targetPanelId).catch((err) => {
      console.error('[PiBridge] Error injecting widget error to agent:', err)
      sendToDevice(deviceId, {
        kind: 'error',
        message: `Failed to inject widget error to agent: ${err instanceof Error ? err.message : String(err)}`,
      })
    })
  })

  // WS disconnect：清理该设备相关的状态（Spec 5.1 节 + S2 缺口 A + S2 缺口 B）
  onClientDisconnect((deviceId) => {
    // S2 缺口 B：清理 panelActiveDevices 中以该 deviceId 为值的映射
    for (const [pid, devId] of panelActiveDevices) {
      if (devId === deviceId) {
        panelActiveDevices.delete(pid)
        console.log(`[PiBridge] Cleared activeDevice for panel ${pid} (device ${deviceId} disconnected)`)
      }
    }

    // S2 缺口 A：从所有面板的在线设备集合移除该设备
    for (const [pid, onlineSet] of panelOnlineDevices) {
      if (onlineSet.delete(deviceId)) {
        console.log(`[PiBridge] Device ${deviceId} left panel ${pid} (disconnected)`)
        if (onlineSet.size === 0) {
          panelOnlineDevices.delete(pid)
        }
      }
    }

    if (pendingRequests.size > 0) {
      console.log(`[PiBridge] Device disconnected: ${deviceId}, ${pendingRequests.size} pending tool calls`)
      // 不全部拒绝，只拒绝超时的（由 timer 处理）
    }
  })

  // WS connect：Phase 4 不再发送全局 session_ready
  // 客户端发送 user_message 时按需创建 session，session_ready 在创建后单独发送
  onClientConnect((deviceId) => {
    console.log(`[PiBridge] Device connected: ${deviceId}, waiting for user_message to create panel session`)
  })
}

/**
 * 处理用户消息（Phase 4：携带 panelId，spec 2.2 节）
 * - 获取或创建该面板的 session
 * - 持久化到 ai_conversations
 * - 设置该面板的活跃设备
 * - 在面板上下文中发送到 agent
 */
export async function handleUserMessage(
  content: string,
  deviceId?: string,
  panelId?: string,
  apiConfig?: ApiConfigPayload,
  callerWidgetId?: string,  // Phase 8 spec 7.2 M4 修复
): Promise<void> {
  if (!panelId) {
    throw new Error('panelId is required for handleUserMessage (Phase 4)')
  }
  const session = await getOrCreatePanelSession(panelId, apiConfig)

  // 持久化到 ai_conversations（仅对非 session-only 的 panelId 持久化）
  if (!panelId.startsWith('session-only:')) {
    try {
      await persistConversation(panelId, 'user', content, deviceId)
    } catch (err) {
      console.warn('[PiBridge] persistConversation failed:', err)
    }
  }

  // 在面板上下文中执行（让 customTools 能获取到 panelId，spec 2.3 节）
  // 同时在 callerWidgetId 上下文中执行（spec 7.2 M4 修复：让 customTools 能获取到 callerWidgetId）
  // 2026-08-17 追加搜索用户上下文（user_key = panel:<panelId>），供搜索工具落库记录调用方
  // prompt is async; do not await - let event stream drive the UI
  void withSearchUser(`panel:${panelId}`, async () => {
    return withPanelContext(panelId, async () => {
      return withCallerWidgetContext(callerWidgetId, async () => {
        // v3 修复 B3：关键诊断日志
        const promptStart = Date.now()
        console.log('[PiBridge] prompt START', panelId, 'content:', content.slice(0, 80))
        try {
          // v3 修复 B1：3 分钟整体超时，防止 SDK 内部工具循环无限运行
          await Promise.race([
            session.prompt(content),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('prompt timeout 180s')), 180_000),
            ),
          ])
          // v3 修复 B3：prompt END 日志
          console.log('[PiBridge] prompt END', panelId, 'durationMs:', Date.now() - promptStart)
          // 标记该面板 session ready（首次成功 prompt 后）
          if (!panelSessionReady.has(panelId)) {
            panelSessionReady.add(panelId)
            broadcast({ kind: 'session_ready', sessionId: session.sessionId, panelId })
          }
        } catch (err) {
          console.error(`[PiBridge] prompt error for panel ${panelId}:`, err)
          const message = err instanceof Error ? err.message : String(err)
          if (message.includes('timeout')) {
            console.warn('[PiBridge] prompt TIMEOUT', panelId, '180s')
          }
          // v3 修复 B1：销毁 session（超时或错误都销毁，避免 SDK 内部状态不一致）
          void disposePanelSession(panelId)
          // 通知客户端
          const errorMsg = {
            kind: 'error' as const,
            message: message.includes('timeout')
              ? 'AI 响应超时（3 分钟），已终止。请重新发送或简化任务。'
              : `Agent prompt failed: ${message}`,
            panelId,
          }
          // 优先发送到发起消息的设备，无 deviceId 时广播
          if (deviceId) {
            sendToDevice(deviceId, errorMsg)
          } else {
            broadcast(errorMsg)
          }
        }
      })
    })
  })
}

/**
 * Phase 4：是否任一面板 session 已就绪
 */
export function isSessionReady(): boolean {
  return panelSessionReady.size > 0
}

/**
 * Phase 4：获取指定面板的 session ID
 */
export function getPanelSessionId(panelId: string): string | undefined {
  return panelSessions.get(panelId)?.sessionId
}

/**
 * 兼容旧 API：获取任一就绪 session 的 ID
 * @deprecated 推荐使用 getPanelSessionId
 */
export function getSessionId(): string | undefined {
  for (const s of panelSessions.values()) {
    return s.sessionId
  }
  return undefined
}

export async function disposePiBridge(): Promise<void> {
  // Phase 4：销毁所有面板 session
  for (const [panelId, s] of panelSessions) {
    try {
      s.dispose()
    } catch (err) {
      console.warn(`[PiBridge] dispose session for panel ${panelId} failed:`, err)
    }
  }
  panelSessions.clear()
  panelSessionApiConfig.clear()  // 第二轮审查 MINOR 修复：清理 apiConfig 记录
  sessionLastUsed.clear()
  panelActiveDevices.clear()
  panelSessionReady.clear()
  panelOnlineDevices.clear()  // S2 缺口 A：清理所有面板的在线设备集合
  rejectAllPending('pi bridge disposed')

  // Phase 8 批次5 模块D：清理所有 askUserPending
  for (const [requestId, pending] of askUserPending) {
    clearTimeout(pending.timer)
    pending.reject(new Error('pi bridge disposed'))
    askUserPending.delete(requestId)
  }
}

// 导出 clearPromptCache 供外部使用（从 aiSettingsStore 重新导出）
export { clearPromptCache }

// ============================================================================
// 测试专用导出（Phase S8.1）
// 仅在测试环境中通过 vi.mock 拦截后使用，生产代码不应引用
// ============================================================================

export const __test = {
  // 内部函数
  cleanupDeviceFromOtherPanels,
  getOrCreatePanelSession,
  executeViaWs,
  executeAskUser,
  handleAskUserResponse,
  withPanelContext,
  withCallerWidgetContext,
  forwardEventToClient,
  formatErrorMessage,
  getEnabledCustomTools,
  getCurrentPanelId,
  getCurrentCallerWidgetId,
  rejectAllPending,

  // 模块级状态 reset（仅供测试 reset 用，不应在生产代码调用）
  __resetInternalState(): void {
    pendingRequests.clear()
    panelSessions.clear()
    panelSessionApiConfig.clear()
    sessionLastUsed.clear()
    panelActiveDevices.clear()
    panelOnlineDevices.clear()
    panelSessionReady.clear()
    askUserPending.clear()
    permissionPending.clear()
    guestRateMap.clear()
  },

  // 内部 Map/Set 引用（仅供测试断言用，不应直接操作）
  __panelActiveDevices: panelActiveDevices,
  __panelOnlineDevices: panelOnlineDevices,
  __panelSessions: panelSessions,
  __pendingRequests: pendingRequests,
  __askUserPending: askUserPending,
  __permissionPending: permissionPending,
  __panelSessionReady: panelSessionReady,
  __sessionLastUsed: sessionLastUsed,
  __panelSessionApiConfig: panelSessionApiConfig,
}

// ============================================================================
// webOS：pi agent + DeepSeek（2026-07-31 架构修正）
//
// 背景：webOS 早期端点自研了 DeepSeek HTTP 直连（模型名 deepseek-chat /
// deepseek-reasoner、自造 fast/balanced/deep/high 档位），偏离了“AI 能力由
// pi agent 提供”的项目架构。现改为复用 pi-coding-agent 会话链路：
// - 模型：pi 内置 deepseek provider 的 `deepseek/deepseek-v4-flash`（zen 聚合
//   网关，baseUrl https://opencode.ai/zen/go/v1，可用 DEEPSEEK_MODEL /
//   DEEPSEEK_BASE_URL 覆盖）
// - 思考档：DeepSeek 官方四档 low/medium/high/max（pi 原生 xhigh 对应 max）
// - API Key：服务端 DEEPSEEK_API_KEY（pi AuthStorage 显式注入）
// - webOS 纯文字会话不注册画布工具（noTools + 空 customTools）
// ============================================================================

/** webOS 会话思考档：pi 原生档位（off=不思考；low/medium/high/xhigh 对应官方 low/medium/high/max） */
export type WebosSessionThinking = 'off' | 'low' | 'medium' | 'high' | 'xhigh'

// ============================================================================
// webOS「AI 即系统」会话提示词（2026-08-01 方向升级）
// 核心：除了 AI 对话页的输入框与对话内容之外，系统是 AI 的家——
// AI 可以自由修改系统桌面（system.desktop）、管理自己的工作区文件、
// 创建/修改 App、添加页面、定制视觉。唯一禁区是对话页本身。
// ============================================================================
const WEBOS_SYSTEM_PROMPT = [
  '你是 Daily webOS 的系统 AI。这个系统是你的家：除了 AI 对话页（assistant）的输入框和对话内容不允许改动之外，其他一切你都可以自由修改。',
  '',
  '## 你拥有的能力',
  '- 工作区与 App（核心心智）：工作区是你私有的磁盘空间（home/ 用户可见、agent/ 你的草稿区、system/ 系统素材、apps/ App、shared/ 跨 App 共享）。**App 就是 apps/ 下的一个文件夹**：mkdir 即自动注册（系统写骨架），写 index.html 即发布新版本立即生效——所有 App 创建/修改/素材/数据保存/自测规范见 **app-dev skill**（`read` 读取 `.pi/skills-webos/app-dev/SKILL.md`，涉及 App 一律先读它）。',
  '- 工作流（create_workflow / run_workflow / list_workflows / delete_workflow，2026-08-13）：把"生成 → 处理 → 生成视频 → 处理"等多步骤素材流水线保存为可复用工作流（步骤参数用 $0.files[].path 引用前一步输出，支持 generate_image / edit_image / generate_video / edit_video 四个工具）。用户说"跑一遍/重做那个流程/再生成一批"时用 run_workflow 一键执行，不用重新描述；同一批图有不同后处理（有的去背景、有的图生视频）就拆成多个工作流或在一个工作流里分多条并行思路。',
  '- 系统源码只读可搜（agent_src_list / agent_src_read / agent_src_grep）：用户需求涉及"系统能不能做"时先查源码确认能力，不要臆测、不要拒绝；运行中的 Shell 源码不可修改（安全带），但 App/桌面/工作区文件可自由改。',
  '- Skill 与记忆：做任何视觉相关的东西（桌面、App 界面、海报、动画）必须先用 read 读 design skill 再按规范执行（用户指定风格时按用户要求设计）；myself 是你的长期记忆（只属于当前用户、跨会话保留），有发现/经验/偏好时用 manage_skill 更新，新会话先读它回忆自己。',
  '- 可替换的系统素材：Logo（system/logo.svg）、用户头像（system/avatar.svg）、称呼（set_display_name）、加载页（system/boot.html + boot.json）、桌面形态（apps/system.desktop/index.html）、商店形态（apps/system.store/index.html）——用户说"换/改"时读写对应文件，告知刷新生效；删除的 App 在 apps/.trash/ 可恢复；用户上传的文件在 home/uploads/。用户上传的图片要作为桌面壁纸或 App 图片时，必须使用 agent_fs_list / agent_fs_stat / agent_fs_read 返回的 publicUrl（形如 /webos/api/imagegen/file/up-... 的免鉴权公开 URL），不要使用 /webos/api/workspace/files/raw?path=... 或相对路径 home/uploads/...（桌面 sandbox iframe 不带 cookie，鉴权 URL 会 401/404）。',
  '- 对话内互动（show_interactive_html）：用户要"在对话里直接看/玩/操作"（计算器、投票、小游戏、表单、设计方向选择等）时用它，宽度 100%、高度 120-480px（建议 220-320）；完整 App 用文件夹方式创建（apps/<名称>/ 下写 index.html，见 app-dev skill）。互动 HTML 里放选择按钮时 postMessage interactive_answer（channel:"daily-webos-sdk"）把用户点击回传给你，形成问答闭环。',
  '- 应用商店（publish_webos_app / unpublish_webos_app）：用户说"发布/上架/分享到商店"时调用；商店形态 = system.store App 可改（改形态不改数据）。',
  '- App 侧 SDK（写进 App HTML 的能力，严禁在沙箱中写 fetch 同站接口）：DailyWebOs.media.generateImage({ prompt, size })（平台原生 AI 生图，自动扣当前用户积分并返回可展示 URL，做生图 App 必用！）、DailyWebOs.ai.chat({ prompt, messages })（平台原生 AI 对话与模型推理，自动扣用户算力，做 AI 对话/写作 App 必用！）、DailyWebOs.user.getCredits() / getProfile()（获取用户身份与剩余积分）、DailyWebOs.storage（私有 KV 存储）、DailyWebOs.http（外部第三方公网 API 代理）、DailyWebOs.api（App 间互联）、DailyWebOs.useApi（调用 App API 包）、DailyWebOs.apps.open（App 跳转）、DailyWebOs.fs（文件读写）——做生图/AI对话/工具类 App 时一律使用 DailyWebOs SDK，绝对禁止写 fetch(/webos/api/...)（沙箱跨域无 Cookie 会 100% 报 401 失败）！',
  '- **App API（让你读到 App 内数据的关键，2026-08-21 W2/W3 已上线）：在 packages/ 下建 api 包（文件夹即包），系统会自动把你的每个端点注册成 `appapi_<namespace>_<endpoint>` 工具——之后你在对话里直接调用它，就能读到用户在 App 里存的数据（用户记了什么、进度、配置等）。做法：`agent_fs_mkdir packages/<id>/` → 写 `daily.pkg.json`（type=api、id、version），再写 `api.json`（namespace + endpoints 声明，每个端点含 name/method/path/handler/storage 读写范围）与 `handlers/*.js`（handler 函数，`ctx.storage.get/set/del` 读写、`ctx.http` 受限请求、`ctx.secrets` 取密钥）→ 系统校验通过自动注册+建版本，**下一轮对话/重建会话后** `appapi_*` 工具即注入可用。用户问"我在 App 里记了什么/存了什么/进度如何"必须先查该 api 包工具再回答；没建过 api 包的 App 你读不到它的私有数据（隐私边界），需要读取时应主动建议补建 api 包（严格按 api.json storage 声明的最小范围）。规范见 04 文档/packages 校验反馈（写文件结果里的 ⚠️ 会告诉你哪里不合格）。',
  '- 媒体工具手册：工作区 system/tools/ 下有 ffmpeg.md / imagemagick.md / imagegen.md / edit-image.md——处理音视频/图片素材前先读对应手册；游戏角色动画用 edit_video 的 to-sprite 一键生成透明精灵图（生成视频时明确要求纯色背景方便抠图）。',
  '- 客服：站长联系方式是敏感信息，不要主动提供、不要写进 App/桌面/任何生成物；用户问"怎么联系站长/购买/反馈"时引导去个人主页查看，不要编造。',
  '- **云服务器与微信网关运维工具（remote_server_exec / remote_server_get_wechat_qr / remote_server_status）：你已直连并拥有远程 Linux 云服务器 (154.219.108.99) 的管理权限。当用户要求“获取微信二维码、连接微信、查看服务器状态、运行服务器命令、查看日志、拉取代码”时，直接调用这些工具！获取到微信二维码时，配合 show_interactive_html 弹出一个带二维码图片和点击直接打开链接的优雅卡片，供用户微信秒扫！',
  '',
  '## 禁区（绝对不能碰）',
  '- AI 对话页（assistant）的输入框和对话内容：这是唯一的用户交互核心，不可删除、不可遮挡、不可改写。',
  '- 系统功能页（文件、设置、余额与支付）：这些是系统机制页，保持它们正常工作；不要试图用 update_webos_app 修改它们。',
  '- 不要声称调用不存在的工具、不要伪造扣款、不要伪造邮件。',
  '',
  '## 工作习惯',
  '- 并行工具调用（重要）：多个**互不依赖**的工具调用要在同一轮一次性发出（pi 会并行执行它们），不要一个一个来。典型场景：同时读取多个文件（read/agent_fs_read 各读各的）、同时列出多个目录、同时查多个 App、同时读源码与工作区文件。只有后续调用依赖前一个的结果时（如先读 App 源码才能改它），才必须等前一个完成。',
  '- 改桌面/App 前先用 agent_fs_read 读取工作区源码（apps/<appId>/index.html），在保留原有功能的基础上修改。',
  '- 改砸了不要慌：系统有版本历史，用户可以回滚；你也可以参考 system.desktop 的早期版本恢复。',
  '- 用户要求保存文件时，写入工作区（home/ 用户可见，agent/ 草稿，system/ 系统素材）。',
].join('\n')

const webosSessions = new Map<string, AgentSession>()

/**
 * 2026-08-10 性能优化：pi 组件跨会话共享。
 * 实测首次建会话 18.4s（webos.ts 日志 chat req → sse start），大头是
 * DefaultResourceLoader.reload() 全量扫描 skills（design skill 247 文件 / 33M）
 * + pi-coding-agent 模块加载。resourceLoader / authStorage / modelRegistry 都是
 * 只读配置，pi SDK（sdk.js）支持传入已创建实例且不会重复 reload——跨会话复用
 * 后，每个新用户的首次会话从「秒级」降到「百毫秒级」（只剩 createAgentSession）。
 * 按 systemPrompt 内容隔离（不同 systemPrompt 需要不同 loader；目前只有默认）。
 */
type PiModule = Awaited<ReturnType<typeof loadPiAgent>>
type SharedResourceLoader = InstanceType<PiModule['DefaultResourceLoader']>
type SharedAuthStorage = ReturnType<PiModule['AuthStorage']['create']>
type SharedModelRegistry = ReturnType<PiModule['ModelRegistry']['create']>
interface SharedWebosServices {
  loader: SharedResourceLoader
  authStorage: SharedAuthStorage
  modelRegistry: SharedModelRegistry
  agentDir: string
  skillsDir: string
}
const sharedWebosServices = new Map<string, SharedWebosServices>()

/** 预热 pi 模块（2026-08-10）：server 启动后后台 import pi-coding-agent，
 *  首次对话不再承担模块加载开销（tsx 环境加载约 8-26s）。幂等，失败自动重试。 */
let piPreheatScheduled = false
export function preheatPiAgent(): void {
  if (piPreheatScheduled) return
  piPreheatScheduled = true
  setTimeout(() => {
    loadPiAgent().catch(() => { /* 失败静默，首次对话时再加载 */ })
  }, 1500)
}

/**
 * pi 内置 deepseek-v4-flash/v4-pro 的 thinkingLevelMap 把 low/medium 标为 null
 * （视为不支持），导致 pi-coding-agent 的 clampThinkingLevel 会把 low/medium
 * 静默升级为 high。DeepSeek 官方 API 实际支持 reasoning_effort=low/medium/
 * high/max，这里用 ModelRegistry.registerProvider 覆盖模型定义，让四档全部可用。
 * （幂等：registerProvider 会替换该 provider 的全部模型定义。）
 */
function registerDeepseekModels(
  modelRegistry: { registerProvider(name: string, config: ProviderConfig): void },
  apiKey: string,
  baseUrl?: string,
): void {
  // 2026-08-17 用户决定：web 端 AI 改用**对话模型**（不输出推理流）。
  // 背景：推理网关（deepseek-v4-flash-0731 reasoning:true，ChatST）下出现
  // 「思考与回答杂糅」「标题生成失败」——推理流 reasoning_effort 在网关侧
  // 返回结构不稳，前端 thinking/delta 混排、completeSimple 标题拿不到 content。
  // 对策：模型注册改 reasoning:false + thinkingLevelMap 置空，pi 不再请求
  // reasoning_effort → 网关返回纯 content 流（无 thinking_delta），对话纯净、
  // 标题生成稳定。DEEPSEEK_MODEL=deepseek/deepseek-v4-flash + DEEPSEEK_BASE_URL
  // （当前 opencode.ai/zen/go/v1）不变；保留原模型名便于改回推理时只改此处。
  const effectiveBaseUrl = baseUrl?.trim() || 'https://api.deepseek.com'
  const flashModel = (id: string): ProviderModelConfig => ({
    id,
    name: 'DeepSeek V4 Flash',
    api: 'openai-completions',
    baseUrl: effectiveBaseUrl,
    compat: { requiresReasoningContentOnAssistantMessages: false, thinkingFormat: 'deepseek' },
    reasoning: false,
    thinkingLevelMap: {},
    input: ['text'],
    // 2026-08-17 修复：缺少 cost 导致 completeSimple 计算费用时
    // model.cost.input 抛「Cannot read properties of undefined (reading 'input')」
    // → 标题生成永远失败返回 null（对话走 AgentSession 路径未触发）。
    cost: { input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0 },
    contextWindow: 1_000_000,
    maxTokens: 384_000,
  })
  modelRegistry.registerProvider('deepseek', {
    baseUrl: effectiveBaseUrl,
    apiKey,
    models: [
      // 2026-08-23 模型切换：主模型走 zen 网关（opencode.ai/zen/go/v1）的
      // deepseek-v4-flash；ChatST 聚合网关专属的 gemini-3.7-flash 与
      // deepseek-v4-flash-0731 已从注册表移除（zen 上不存在，不再可选）。
      // 识图功能模型（deepseek-v4-flash-vision-exp，DeepSeek 官方）不走本
      // 注册表——由 vision/deepseekVision.ts 直连，见 m3Vision.describeMedia。
      flashModel('deepseek-v4-flash'),
      {
        id: 'deepseek-v4-pro',
        name: 'DeepSeek V4 Pro',
        api: 'openai-completions',
        baseUrl: effectiveBaseUrl,
        compat: { requiresReasoningContentOnAssistantMessages: false, thinkingFormat: 'deepseek' },
        reasoning: false,
        thinkingLevelMap: {},
        input: ['text'],
        cost: { input: 0.435, output: 0.87, cacheRead: 0.003625, cacheWrite: 0 },
        contextWindow: 1_000_000,
        maxTokens: 384_000,
      },
    ],
  })
}

/**
 * 创建/复用 webOS 的 AgentSession（按 scope + conversationId + thinking 缓存）。
 * scope 建议：对话用 principal.key，App 生成用 `${principal.key}:gen`（固定 'off'）。
 * options.conversationId 用于多会话隔离：同一用户的不同会话拥有独立 pi 上下文，
 * 可并行对话互不干扰（缺省 'default' 保持旧行为）。
 * options.systemPrompt 可覆盖默认对话系统提示。
 * options.customTools 可注入额外工具（对话会话注入 App 工具集 + 工作区文件系统工具，
 * 创建 App 走「文件夹即 App」路径：agent_fs_mkdir apps/<名称>/ + agent_fs_write index.html；
 * 注意 customTools 需在首次创建会话时传入，复用会话时以首次注册的工具为准）。
 */
export async function createWebosSession(
  scope: string,
  thinking: WebosSessionThinking,
  options?: { systemPrompt?: string[]; customTools?: ToolDefinition[]; conversationId?: string },
): Promise<AgentSession> {
  const conversationId = options?.conversationId ?? 'default'
  // 2026-08-17 会话持久化修复（用户反馈：重启丢上下文 + 换设备看不到历史）：
  // - key 不再含 thinking：切换思考档（浅/中/深/极深）沿用同一会话文件，上下文不丢
  // - 会话按 (scope, conversationId) 固定文件持久化（SessionManager.create + sessionDir），
  //   重启后 buildSessionContext() 从 JSONL 文件恢复完整历史（含工具调用/记忆）
  const key = `webos:${scope}:${conversationId}`
  const existing = webosSessions.get(key)
  if (existing) return existing

  const startMs = Date.now()

  const {
    AuthStorage,
    createAgentSession,
    DefaultResourceLoader,
    getAgentDir,
    ModelRegistry,
    SessionManager,
  } = await loadPiAgent()

  const cwd = process.cwd()
  const agentDir = getAgentDir()

  // webOS 多会话（2026-08-05）：每个会话创建独立的 SessionManager。
  // pi 的 createAgentSession 会通过 sessionManager.buildSessionContext() 恢复历史，
  // 若所有 webOS 会话共享同一个 inMemory(cwd) 实例，不同会话的上下文会互相串扰
  // （会话 B 能看到会话 A 的内容）。独立实例 = 独立上下文，天然支持并行会话。
  //
  // 2026-08-17 持久化修复：inMemory → create(cwd, sessionDir) 文件持久化。
  // sessionDir 按 (scope, conversationId) 固定 → 重启/部署后 buildSessionContext()
  // 自动从 JSONL 文件恢复完整上下文（此前纯内存，重启即失忆）。
  // 会话文件命名：scope 与 conversationId 均含 : 等特殊字符，统一编码为安全文件名。
  const sessionDir = join(
    process.env.WEBOS_SESSION_DIR ?? join(cwd, 'data', 'webos-sessions'),
    encodeURIComponent(scope),
    encodeURIComponent(conversationId),
  )
  const sessionManager = SessionManager.create(cwd, sessionDir)

  // webOS 专用 skills 目录（2026-08-11 起分两层）：
  // 1) 用户级 skills：<workspace>/skills/（myself 记忆等用户专属 skill，每个用户独立）
  // 2) 全局系统级 skills：.pi/skills-webos/（design 等只读系统 skill，所有人共享）
  // 只加载受控的 webOS skill，不加载 .pi/skills/ 下会操作服务器真实 cwd 的
  // 文件系统 skill（fs-cli 等），避免 webOS 会话越权访问服务器文件。
  // 全局目录优先 cwd（server/.pi/），回退项目根（../.pi/）。
  let globalSkillsDir = join(cwd, '.pi', 'skills-webos')
  try {
    if (!existsSync(globalSkillsDir) && existsSync(join(cwd, '..', '.pi', 'skills-webos'))) {
      globalSkillsDir = join(cwd, '..', '.pi', 'skills-webos')
    }
  } catch { /* 保持默认 */ }
  // 用户级 skills：scope 即 principal.key（user:<id> / guest:<deviceId>），
  // 独立于全局系统 skill；不存在时（如 App 生成内部会话）只用全局。
  let userSkillsDir = ''
  try {
    if (scope && !scope.includes(':')) {
      // scope 不是 principal.key（如 App 生成会话），回退全局
      userSkillsDir = ''
    } else if (scope) {
      const { getUserSkillsDir } = await import('./utils/webosWorkspace.js')
      userSkillsDir = getUserSkillsDir(scope)
    }
  } catch { /* 用户 skills 解析失败不阻断（只用全局） */ }
  const skillsDirs = userSkillsDir ? [userSkillsDir, globalSkillsDir] : [globalSkillsDir]
  const systemPrompt = options?.systemPrompt ?? WEBOS_SYSTEM_PROMPT
  const systemPromptText = Array.isArray(systemPrompt) ? systemPrompt.join('\n') : String(systemPrompt)
  // 2026-08-11 缓存 key 必须包含 scope：不同用户 skillsDir 不同，resourceLoader
  // 的 skills 扫描结果不能跨用户复用（否则 A 的 myself 记忆被 B 加载）。
  const systemKey = `${scope}:${systemPromptText}`
  // 2026-08-10 性能优化：resourceLoader（含 skills 扫描）/ authStorage / modelRegistry
  // 跨会话共享——reload 只做一次，后续会话复用已加载的资源（见上方注释）。
  let shared = sharedWebosServices.get(systemKey)
  if (!shared || shared.agentDir !== agentDir || shared.skillsDir !== skillsDirs.join('|')) {
    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir,
      additionalSkillPaths: skillsDirs,
      extensionFactories: [],
      appendSystemPromptOverride: (base) => [...base, ...systemPrompt],
    })
    await resourceLoader.reload()

    const authStorage = AuthStorage.create(agentDir ? join(agentDir, 'auth.json') : undefined)
    const modelRegistry = ModelRegistry.create(authStorage)
    // 覆盖 pi 内置 DeepSeek 模型定义：启用官方 low/medium/high/max 全部四档
    registerDeepseekModels(modelRegistry, process.env.DEEPSEEK_API_KEY?.trim() ?? '', process.env.DEEPSEEK_BASE_URL)

    shared = { loader: resourceLoader, authStorage, modelRegistry, agentDir, skillsDir: skillsDirs.join('|') }
    sharedWebosServices.set(systemKey, shared)
    console.log(`[PiBridge] pi services initialized (reload once) skillsDirs=[${skillsDirs.join(', ')}] in ${Date.now() - startMs}ms`)
  }
  const { loader: resourceLoader, authStorage, modelRegistry } = shared

  const deepseekKey = process.env.DEEPSEEK_API_KEY?.trim()
  if (deepseekKey) {
    authStorage.setRuntimeApiKey('deepseek', deepseekKey)
  }

  const modelRef = process.env.DEEPSEEK_MODEL?.trim() || 'deepseek/deepseek-v4-flash'
  const [providerName = 'deepseek', ...modelParts] = modelRef.split('/')
  const modelName = modelParts.join('/') || 'deepseek-v4-flash'
  const model = modelRegistry.find(providerName, modelName)
  if (!model) {
    throw new Error(`[webos] model not found in registry: ${modelRef}. Ensure provider "${providerName}" is built-in and DEEPSEEK_API_KEY is set.`)
  }

  console.log(`[PiBridge] webos session ${key}: model ${providerName}/${modelName}, thinking ${thinking}`)

  const { session: s } = await createAgentSession({
    cwd,
    agentDir,
    resourceLoader,
    sessionManager,
    authStorage,
    modelRegistry,
    model,
    thinkingLevel: thinking,
    noTools: 'builtin',
    customTools: options?.customTools ?? [],
  })
  // 2026-08-10 性能观测：会话创建总耗时（含组件初始化；共享后仅 createAgentSession）
  console.log(`[PiBridge] webos session created in ${Date.now() - startMs}ms (key=${key.slice(-40)})`)

  // 简单防泄漏：超过 256 个 session 时丢弃最旧的一个
  if (webosSessions.size > 256) {
    const oldestKey = webosSessions.keys().next().value
    if (oldestKey) {
      const oldest = webosSessions.get(oldestKey)
      webosSessions.delete(oldestKey)
      try { oldest?.dispose?.() } catch { /* ignore */ }
    }
  }

  // 2026-08-17 搜索 API 状态可视化：包装 session.prompt，使每次 prompt 执行
  // 都处于 withSearchUser(scope) 上下文中（scope = principal.key，如 user:<id> /
  // guest:<deviceId>），搜索工具落库时可记录调用方 user_key。
  // 不修改 webos.ts：webos.ts 通过 session.prompt()（runPiPrompt）调用，命中实例属性。
  const originalPrompt = s.prompt.bind(s)
  s.prompt = ((content: string, options?: unknown) =>
    withSearchUser(scope, () => originalPrompt(content, options as never))) as typeof s.prompt

  webosSessions.set(key, s)
  return s
}

/** 释放某 scope 的 webOS sessions（不传 conversationId 时释放该 scope 全部会话）
 *  2026-08-17：rebuild=true（编辑/回退重来）时同时删除会话文件——
 *  否则 SessionManager.create 会从旧 JSONL 恢复历史，与「重来」语义冲突。 */
export function disposeWebosSessions(scope: string, conversationId?: string): void {
  const prefix = conversationId ? `webos:${scope}:${conversationId}` : `webos:${scope}:`
  for (const [key, s] of webosSessions) {
    if (key.startsWith(prefix)) {
      webosSessions.delete(key)
      try { s.dispose?.() } catch { /* ignore */ }
    }
  }
  // 删除会话文件（若有）：下次 createWebosSession 从头开始
  try {
    const cwd = process.cwd()
    const base = process.env.WEBOS_SESSION_DIR ?? join(cwd, 'data', 'webos-sessions')
    const scopeDir = join(base, encodeURIComponent(scope))
    const targetDirs = conversationId
      ? [join(scopeDir, encodeURIComponent(conversationId))]
      : (existsSync(scopeDir) ? readdirSync(scopeDir).map((d) => join(scopeDir, d)) : [])
    for (const dir of targetDirs) {
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true })
      }
    }
  } catch (error) {
    console.warn('[PiBridge] disposeWebosSessions file cleanup failed:', error instanceof Error ? error.message : String(error))
  }
}

/** 2026-08-08 临时调试：获取指定会话的 pi 实例（不创建；用于 dump 上下文排查消息重复） */
export function getWebosSessionForDebug(scope: string, conversationId?: string): unknown {
  const prefix = conversationId ? `webos:${scope}:${conversationId}:` : `webos:${scope}:`
  for (const [key, s] of webosSessions) {
    if (key.startsWith(prefix)) return s
  }
  return null
}

/** 2026-08-18：判断 webOS 会话当前是否已存在（内存缓存命中）。
 *  rebuild（编辑/回退重来）时，若会话仍存活则复用上下文（不重跑开场 skill、
 *  不重复计算整段历史）；仅当会话不存在（服务重启/超时清理）才需回退重放历史。 */
export function hasWebosSession(scope: string, conversationId?: string): boolean {
  return getWebosSessionForDebug(scope, conversationId) != null
}

/**
 * 中断某 scope 当前正在运行的 prompt（用户按「终止」按钮）。
 * pi 的 session.abort() 会「中止当前操作并等待 agent 回到空闲」——
 * 与 dispose 不同：**会话上下文保留**，用户可立即继续对话；
 * 中断前已消耗的 usage 仍会随 agent_end 正常结算（照常扣积分）。
 */
export async function abortWebosSessions(scope: string, conversationId?: string): Promise<number> {
  const prefix = conversationId ? `webos:${scope}:${conversationId}:` : `webos:${scope}:`
  let aborted = 0
  for (const [key, s] of webosSessions) {
    if (key.startsWith(prefix)) {
      try {
        await s.abort?.()
        aborted += 1
      } catch (error) {
        console.warn('[webos] session abort failed:', error instanceof Error ? error.message : String(error))
      }
    }
  }
  return aborted
}

/**
 * AI 生成会话标题（2026-08-06）：一次性轻量补全（pi-ai completeSimple，
 * thinking=off），不创建 agent 会话、不进会话历史、不注入工具。
 * 由前端在会话首次 AI 回复完成后调用；失败返回 null（调用方回退截取标题）。
 * 成本极小（输入 ≤4k 字符、输出 ≤64 token），不扣用户积分，仅落审计。
 */
export async function generateConversationTitle(texts: string[]): Promise<string | null> {
  try {
    const { AuthStorage, getAgentDir, ModelRegistry } = await loadPiAgent()
    const agentDir = getAgentDir()
    const authStorage = AuthStorage.create(agentDir ? join(agentDir, 'auth.json') : undefined)
    const deepseekKey = process.env.DEEPSEEK_API_KEY?.trim()
    if (deepseekKey) {
      authStorage.setRuntimeApiKey('deepseek', deepseekKey)
    }
    const modelRegistry = ModelRegistry.create(authStorage)
    // 覆盖 pi 内置 DeepSeek 模型定义（与 createWebosSession 一致，四档可用）
    registerDeepseekModels(modelRegistry, deepseekKey ?? '', process.env.DEEPSEEK_BASE_URL)
    const modelRef = process.env.DEEPSEEK_MODEL?.trim() || 'deepseek/deepseek-v4-flash'
    const [providerName = 'deepseek', ...modelParts] = modelRef.split('/')
    const modelName = modelParts.join('/') || 'deepseek-v4-flash'
    const model = modelRegistry.find(providerName, modelName)
    if (!model) return null

    const { completeSimple } = await import('@earendil-works/pi-ai')
    const result = await completeSimple(model, {
      systemPrompt: '你是会话标题生成器。根据用户与 AI 的对话内容，用中文生成一个 4-15 字的会话标题，概括这次对话的主题。要求：只输出标题本身，不要引号、不要书名号、不要"标题："等前缀、不要句末标点、不要任何解释。',
      messages: [{
        role: 'user',
        content: texts.join('\n'),
        timestamp: Date.now(),
      }],
    }, {
      // pi-ai 的 SimpleStreamOptions.reasoning 不含 'off'；minimal 会被模型的
      // thinkingLevelMap clamp 到 low（我们已覆盖四档定义），标题生成保持轻量
      reasoning: 'minimal',
      maxTokens: 384,
      temperature: 0.3,
    })

    const textBlock = result.content.find((block) => block.type === 'text') as { text?: string } | undefined
    const title = (textBlock?.text ?? '')
      .trim()
      .replace(/^["'「『]+|["'」』]+$/g, '')
      .replace(/[。.!！?？\s]+$/g, '')
      .slice(0, 20)
    return title || null
  } catch (error) {
    console.warn('[webos] generateConversationTitle failed:', error instanceof Error ? error.message : String(error))
    return null
  }
}
