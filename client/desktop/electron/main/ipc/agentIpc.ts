import { ipcMain, app, BrowserWindow } from 'electron'
import * as fs from 'fs'
import { apiKeyStore } from '../apiKeyStore'
import {
  localAgentService,
  type AgentEvent,
  type ToolExecuteRequest,
  type ToolExecuteResponse,
} from '../localAgent/LocalAgentService'
import { type PiThinkingLevel } from '../../../src/utils/thinkingLevel'

/**
 * Agent IPC handler 注册（Phase 9 模块 4 + 批次 2 模块 2 扩展）
 *
 * 本文件实现两部分：
 * 1. apiKey 相关 IPC（批次 1 已实现）：agent:set-api-key / agent:get-api-key 等 6 个
 * 2. agent 核心 IPC（批次 2 新增）：
 *    - agent:initialize：初始化 LocalAgentService（SessionManager 单例）
 *    - agent:send-message：发送消息到指定面板的 agent session，流式转发事件
 *    - agent:dispose-session：销毁指定面板的 agent session
 *    - tool:execute:result：接收渲染进程回传的工具执行结果（toolExecutor 实现）
 *
 * IPC 通道清单：
 * - agent:set-api-key：设置 provider 的 API Key（加密存储）
 * - agent:get-api-key：读取 provider 的 API Key（解密返回明文）
 * - agent:set-active-provider：设置当前激活的 provider
 * - agent:get-active-provider：获取当前激活的 provider
 * - agent:delete-api-key：删除 provider 的配置
 * - agent:list-providers：列出所有已配置的 provider
 * - agent:initialize：初始化 LocalAgentService（批次 2 新增）
 * - agent:send-message：发送消息到 agent，流式转发事件（批次 2 新增）
 * - agent:dispose-session：销毁指定面板 session（批次 2 新增）
 * - agent:set-thinking-level：动态切换指定面板 session 的思考等级（批次 3 模块 6 新增）
 * - tool:execute:result：接收渲染进程回传的工具执行结果（批次 2 新增，内部使用）
 */

// ============================================================================
// 工具执行结果 pending Map（tool:execute:result IPC 配套）
// ============================================================================

/**
 * 工具执行结果 Promise 管理器
 *
 * LocalAgentService 的 customTools.execute 通过 toolExecutor 调用渲染进程，
 * 渲染进程执行完后通过 'tool:execute:result' IPC 回传结果。
 * toolExecutor 实现内部用此 Map 关联 requestId → Promise。
 */
const pendingToolResults = new Map<string, {
  resolve: (response: ToolExecuteResponse) => void
  timer: ReturnType<typeof setTimeout>
}>()

/** 工具执行超时（毫秒） */
const TOOL_EXECUTION_TIMEOUT_MS = 120000

/**
 * 创建 ToolExecutor：通过 IPC 把工具调用路由到渲染进程执行
 *
 * 流程：
 * 1. LocalAgentService 的 customTools.execute 调用 toolExecutor(request)
 * 2. toolExecutor 通过 BrowserWindow.webContents.send 发送 'tool:execute:request' 到渲染进程
 * 3. 渲染进程的 toolBridge 监听此事件，执行工具后通过 'tool:execute:result' IPC 回传
 * 4. toolExecutor 收到回传后 resolve Promise，返回 ToolExecuteResponse
 *
 * @param getTargetWindow 获取目标 BrowserWindow 的函数（在 IPC 调用时取最新窗口）
 */
export function createToolExecutor(
  getTargetWindow: () => BrowserWindow | null,
): (request: ToolExecuteRequest) => Promise<ToolExecuteResponse> {
  return async (request: ToolExecuteRequest): Promise<ToolExecuteResponse> => {
    const win = getTargetWindow()
    if (!win || win.isDestroyed()) {
      return {
        requestId: request.requestId,
        success: false,
        error: 'No active BrowserWindow for tool execution',
      }
    }

    return new Promise<ToolExecuteResponse>((resolve) => {
      // 超时兜底（避免渲染进程不响应导致 Promise 永远 pending）
      const timer = setTimeout(() => {
        pendingToolResults.delete(request.requestId)
        resolve({
          requestId: request.requestId,
          success: false,
          error: `Tool execution timeout (${TOOL_EXECUTION_TIMEOUT_MS}ms): ${request.tool}`,
        })
      }, TOOL_EXECUTION_TIMEOUT_MS)

      pendingToolResults.set(request.requestId, { resolve, timer })

      // 发送工具执行请求到渲染进程
      win.webContents.send('tool:execute:request', request)
    })
  }
}

/**
 * 初始化 API Key 存储
 *
 * 在 app.whenReady 时调用，确保 userData 目录存在。
 * 正常情况下 Electron 启动时 userData 目录已存在，此处仅做兜底。
 */
export function initializeApiKeyStore(): void {
  const userDataPath = app.getPath('userData')
  if (!fs.existsSync(userDataPath)) {
    fs.mkdirSync(userDataPath, { recursive: true })
    console.log('[AgentIpc] Created userData directory:', userDataPath)
  }
  // 触发一次 loadStore，确保存储文件可读写（不存在时返回空 store，不创建文件）
  const store = apiKeyStore.loadStore()
  console.log('[AgentIpc] ApiKeyStore initialized, configured providers:', Object.keys(store.keys))
}

/**
 * 注册 agent 相关 IPC handler
 *
 * 必须在 app.whenReady() 之前或之中调用（与现有 IPC 注册时机一致）。
 * 注册时机：main/index.ts 的 app.whenReady().then(async () => { ... }) 回调中，
 *           在 createWindow 之前调用。
 */
export function registerAgentIpc(): void {
  // ===== agent:set-api-key =====
  // 设置 provider 的 API Key（加密存储到 userData/ai-keys.json）
  // Phase 13.2.3 B1：保存后通过 'api-key:changed' 事件通知渲染进程，
  // 渲染进程收到后调 api.put('/ai/settings', ...) 同步到服务器（正向同步）。
  // 注：事件 payload 不含明文 apiKey（安全考虑），渲染进程需要时通过
  // window.aiKeyApi.getApiKey(provider) 读取。
  ipcMain.handle('agent:set-api-key', (event, payload: {
    provider: string
    apiKey: string
    endpoint: string
    model: string
  }) => {
    const { provider, apiKey, endpoint, model } = payload
    if (!provider || typeof provider !== 'string') {
      throw new Error('[agent:set-api-key] provider is required and must be a string')
    }
    if (typeof apiKey !== 'string') {
      throw new Error('[agent:set-api-key] apiKey is required and must be a string')
    }
    apiKeyStore.setApiKey(provider, apiKey, endpoint, model)
    // 通知渲染进程（sender 即发起 IPC 的 webContents），触发正向同步到服务器
    // 检查 webContents 是否已销毁（agent loop 期间窗口可能被关闭）
    if (!event.sender.isDestroyed()) {
      event.sender.send('api-key:changed', { provider, endpoint, model })
    }
    return { ok: true }
  })

  // ===== agent:get-api-key =====
  // 读取 provider 的 API Key（解密后返回明文）
  // 未配置时返回 null（不抛错，让渲染进程处理空值）
  ipcMain.handle('agent:get-api-key', (_event, payload: { provider: string }) => {
    const { provider } = payload
    if (!provider || typeof provider !== 'string') {
      throw new Error('[agent:get-api-key] provider is required and must be a string')
    }
    return apiKeyStore.getApiKey(provider)
  })

  // ===== agent:set-active-provider =====
  // 设置当前激活的 provider
  ipcMain.handle('agent:set-active-provider', (_event, payload: { provider: string }) => {
    const { provider } = payload
    if (!provider || typeof provider !== 'string') {
      throw new Error('[agent:set-active-provider] provider is required and must be a string')
    }
    apiKeyStore.setActiveProvider(provider)
    return { ok: true }
  })

  // ===== agent:get-active-provider =====
  // 获取当前激活的 provider（未设置时返回 null）
  ipcMain.handle('agent:get-active-provider', () => {
    return apiKeyStore.getActiveProvider()
  })

  // ===== agent:delete-api-key =====
  // 删除指定 provider 的配置
  ipcMain.handle('agent:delete-api-key', (_event, payload: { provider: string }) => {
    const { provider } = payload
    if (!provider || typeof provider !== 'string') {
      throw new Error('[agent:delete-api-key] provider is required and must be a string')
    }
    apiKeyStore.deleteApiKey(provider)
    return { ok: true }
  })

  // ===== agent:list-providers =====
  // 列出所有已配置的 provider
  ipcMain.handle('agent:list-providers', () => {
    return apiKeyStore.listProviders()
  })

  // ===== agent:initialize =====
  // 初始化 LocalAgentService（创建 SessionManager 单例）
  // 幂等：重复调用安全
  ipcMain.handle('agent:initialize', async () => {
    await localAgentService.initialize()
    return { ok: true }
  })

  // ===== agent:send-message =====
  // 发送消息到指定面板的 agent session，流式转发事件
  // 事件通过 'agent:event' IPC 通道推送到渲染进程（payload: { panelId, event: AgentEvent }）
  // 调用方（useAIStore）需先通过 preload 的 agentApi.onEvent 注册监听器
  ipcMain.handle('agent:send-message', async (event, payload: {
    panelId: string
    message: string
    thinkingLevel: PiThinkingLevel
  }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) {
      throw new Error('[agent:send-message] No BrowserWindow for sender')
    }

    const { panelId, message, thinkingLevel } = payload
    if (!panelId || typeof panelId !== 'string') {
      throw new Error('[agent:send-message] panelId is required and must be a string')
    }
    if (typeof message !== 'string') {
      throw new Error('[agent:send-message] message is required and must be a string')
    }

    // 调用 LocalAgentService.sendMessage，事件通过回调转发到渲染进程
    // 注：sendMessage 内部会 await session.prompt(message)，此 IPC 会等到 agent loop 结束
    await localAgentService.sendMessage(
      panelId,
      message,
      thinkingLevel,
      (agentEvent: AgentEvent) => {
        // 检查窗口是否仍存在（agent loop 可能很长，期间窗口可能被关闭）
        if (!win.isDestroyed()) {
          win.webContents.send('agent:event', { panelId, event: agentEvent })
        }
      },
    )

    return { ok: true }
  })

  // ===== agent:dispose-session =====
  // 销毁指定面板的 agent session（释放资源）
  ipcMain.handle('agent:dispose-session', (_event, payload: { panelId: string }) => {
    const { panelId } = payload
    if (!panelId || typeof panelId !== 'string') {
      throw new Error('[agent:dispose-session] panelId is required and must be a string')
    }
    localAgentService.disposeSession(panelId)
    return { ok: true }
  })

  // ===== agent:set-thinking-level =====
  // 动态切换指定面板 session 的思考等级（Phase 9 批次 3 模块 6）
  //
  // 行为（与 LocalAgentService.setThinkingLevel 对齐）：
  // - session 已存在：调用 pi 原生 session.setThinkingLevel(level) 实时切换
  // - session 不存在：缓存到 pendingThinkingLevels，下次 createSession 时使用
  //
  // 参数：{ panelId: string, level: PiThinkingLevel }
  // level 取值：'minimal' | 'low' | 'medium' | 'high'（与桌面端 4 档对齐）
  ipcMain.handle('agent:set-thinking-level', async (_event, payload: {
    panelId: string
    level: PiThinkingLevel
  }) => {
    const { panelId, level } = payload
    if (!panelId || typeof panelId !== 'string') {
      throw new Error('[agent:set-thinking-level] panelId is required and must be a string')
    }
    if (!level || typeof level !== 'string') {
      throw new Error('[agent:set-thinking-level] level is required and must be a string')
    }
    await localAgentService.setThinkingLevel(panelId, level)
    return { ok: true }
  })

  // ===== tool:execute:result =====
  // 接收渲染进程回传的工具执行结果（toolBridge.respondToolResult 调用）
  // 配套 createToolExecutor 使用：通过 requestId 关联 pending Promise
  // 注：此 IPC 是渲染进程 → 主进程方向，由 preload.toolBridgeApi.respondToolResult 触发
  ipcMain.handle('tool:execute:result', async (_event, response: ToolExecuteResponse) => {
    const pending = pendingToolResults.get(response.requestId)
    if (pending) {
      clearTimeout(pending.timer)
      pendingToolResults.delete(response.requestId)
      pending.resolve(response)
    } else {
      console.warn(`[tool:execute:result] No pending tool result for requestId: ${response.requestId}`)
    }
    return { ok: true }
  })
}
