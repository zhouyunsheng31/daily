/**
 * 渲染进程侧工具执行桥接（Phase 9 批次2 模块3）
 *
 * 职责：
 * - 监听主进程的 'tool:execute:request' IPC 事件（由 preload 的 toolBridgeApi 转发）
 * - dispatch 到 wsToolHandlers.executeToolCall（24 个工具）或 handleAskUser（ask_user）
 * - 通过 'tool:execute:result' IPC 回传结果
 *
 * 设计原则（与 spec 3.3 对齐）：
 * - **不维护 dispatch 表**：24 个工具（4 widget + 2 storage + 18 browser）全部
 *   直接复用 wsToolHandlers.executeToolCall，该函数已实现完整 dispatch（含 widgetId
 *   自动注入逻辑，见 wsToolHandlers.ts:489-575）
 * - **仅 ask_user 单独处理**：需要通过 useAIStore 弹 AskUserCard 收集用户选择
 *
 * 关键事实（基于 wsToolHandlers.ts 实际 export + useAIStore.ts 实际类型）：
 * - wsToolHandlers.ts 仅 export `executeToolCall`、`readFromLegacyTable`、`ToolCallResult`
 * - AskUserPendingRequest 类型（useAIStore.ts:92-99）不含 resolve/reject/onRespond/timestamp
 *   字段，所以用独立的 pendingAskUserPromises Map 管理 Promise
 * - pendingAskUserRequests 是 **Map**（useAIStore.ts:408），必须用 .set 而非 .push
 */

import { executeToolCall, type ToolCallResult } from './wsToolHandlers'
import { useAIStore } from '../stores/useAIStore'
import type { AskUserOption } from '../types/ai'

/** 主进程发来的工具执行请求 */
export interface ToolExecuteRequest {
  requestId: string
  tool: string
  params: unknown
  panelId: string
}

/** 回传给主进程的工具执行结果 */
export interface ToolExecuteResponse {
  requestId: string
  success: boolean
  data?: unknown
  error?: string
}

/** ask_user 工具的参数 */
interface AskUserParams {
  question: string
  options: AskUserOption[]
  allowMultiple?: boolean
}

/**
 * ask_user Promise 管理器
 *
 * 因为 useAIStore.pendingAskUserRequests 的 AskUserPendingRequest 类型不含
 * resolve/reject 字段（见 useAIStore.ts:92-99），所以用独立的 Map 管理 Promise。
 *
 * 当用户在 AskUserCard 选择后，由 respondToAskUserFromLocalAgent 触发 resolve。
 * 120s 超时兜底（避免 Promise 永远 pending）。
 */
const pendingAskUserPromises = new Map<string, {
  resolve: (response: ToolExecuteResponse) => void
  timer: ReturnType<typeof setTimeout>
}>()

/**
 * 工具执行入口（任务 1 要求导出）
 *
 * 25 个工具中：24 个通过 executeToolCall 统一分发，ask_user 单独处理。
 *
 * @param tool 工具名（25 个之一）
 * @param params 工具参数
 * @returns ToolCallResult（success/data/error 结构，可序列化）
 */
export async function executeTool(tool: string, params: unknown): Promise<ToolCallResult> {
  // ask_user 工具：通过 useAIStore 弹 AskUserCard，等用户选择
  if (tool === 'ask_user') {
    return executeAskUser(params as AskUserParams)
  }

  // 其余 24 个工具：直接复用 wsToolHandlers.executeToolCall
  // executeToolCall 内部已根据 tool 名分发到对应处理函数
  // （含 widgetId 自动注入逻辑，无需本文件传 panelId）
  return executeToolCall(tool, params)
}

/**
 * ask_user 工具执行
 *
 * 通过 useAIStore.pendingAskUserRequests（Map）注册请求，
 * AskUserCard 组件渲染后等用户选择。
 *
 * 注意：pendingAskUserRequests 是 Map（useAIStore.ts:408），必须用 .set 而非 .push。
 * AskUserPendingRequest 类型字段：requestId/sessionId/question/options/allowMultiple/panelId
 * （不含 resolve/reject/onRespond/timestamp），所以用独立的 pendingAskUserPromises
 * Map 管理 Promise。
 */
async function executeAskUser(params: AskUserParams): Promise<ToolCallResult> {
  const requestId = `ask-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const { question, options, allowMultiple } = params

  return new Promise<ToolCallResult>((resolve) => {
    // 120s 超时兜底
    const timer = setTimeout(() => {
      pendingAskUserPromises.delete(requestId)
      useAIStore.getState().pendingAskUserRequests.delete(requestId)
      resolve({
        success: false,
        error: 'ask_user timeout (120s)',
      })
    }, 120000)

    pendingAskUserPromises.set(requestId, {
      resolve: (response: ToolExecuteResponse) => {
        clearTimeout(timer)
        resolve({
          success: response.success,
          data: response.data,
          error: response.error,
        })
      },
      timer,
    })

    // 写入 useAIStore.pendingAskUserRequests（Map.set，不是 push）
    // AskUserPendingRequest 类型字段：requestId/sessionId/question/options/allowMultiple/panelId
    // 本地 agent 模式下 sessionId 暂留空（由后续模块补充）
    useAIStore.getState().pendingAskUserRequests.set(requestId, {
      requestId,
      sessionId: '',
      question,
      options,
      allowMultiple: allowMultiple ?? false,
      panelId: '',
    })
  })
}

/**
 * 响应 ask_user 请求（本地 agent 模式）
 *
 * 由 AskUserCard 组件在用户选择后调用（替代 useAIStore.respondToAskUser，
 * 后者发 WS ask_user_response，本地 agent 模式下无 WS）。
 *
 * 也供主进程 LocalAgentService 通过 webContents.executeJavaScript 调用，
 * 或由后续模块在 useAIStore.respondToAskUser 中分流调用。
 *
 * @param requestId ask_user 请求 ID
 * @param selectedValues 用户选择的 value 列表
 */
export function respondToAskUserFromLocalAgent(
  requestId: string,
  selectedValues: string[],
): void {
  const pending = pendingAskUserPromises.get(requestId)
  if (pending) {
    pending.resolve({
      requestId,
      success: true,
      data: { selectedValues },
    })
  }
  // 清理 useAIStore.pendingAskUserRequests
  useAIStore.getState().pendingAskUserRequests.delete(requestId)
}

/**
 * dispatch 工具执行请求并返回响应
 *
 * 内部调用 executeTool，包装为 ToolExecuteResponse 结构（含 requestId）。
 */
async function dispatchTool(request: ToolExecuteRequest): Promise<ToolExecuteResponse> {
  try {
    const result = await executeTool(request.tool, request.params)
    return {
      requestId: request.requestId,
      success: result.success,
      data: result.data,
      error: result.error,
    }
  } catch (err) {
    return {
      requestId: request.requestId,
      success: false,
      error: (err as Error).message,
    }
  }
}

/**
 * 注册 toolBridge 监听（在 App.tsx mount 时调用一次）
 *
 * 监听主进程通过 preload.toolBridgeApi.onToolExecuteRequest 转发的
 * 'tool:execute:request' IPC 事件，dispatch 后通过 respondToolResult 回传。
 *
 * @returns 清理函数（取消监听）
 */
export function registerToolBridge(): () => void {
  if (!window.toolBridgeApi) {
    console.warn('[toolBridge] window.toolBridgeApi not available (preload not ready)')
    return () => {}
  }

  return window.toolBridgeApi.onToolExecuteRequest(async (request: unknown) => {
    const req = request as ToolExecuteRequest
    const response = await dispatchTool(req)
    await window.toolBridgeApi!.respondToolResult(response)
  })
}
