/**
 * LocalAgentService（Phase 9 批次 2 模块 2）
 *
 * 主进程单例服务：管理 per-panel AgentSession，通过 IPC 桥接到渲染进程执行工具。
 *
 * 设计要点（按真实 pi-coding-agent API，参考 server/src/piBridge.ts:1022-1136）：
 * - `DefaultResourceLoader({ cwd, agentDir, additionalSkillPaths, extensionFactories })`
 *   构造（非字符串参数，spec 骨架代码偏差已修正）
 * - `ToolDefinition` 真实签名：5 参数 execute + 必填 label 字段
 * - `AgentSession.subscribe(listener) + prompt(text)` 模式（非 async generator）
 * - `agentDir` 指向 `<projectRoot>/.pi`（auth.json 写入此目录），并通过
 *   `additionalSkillPaths` 显式注入 `<projectRoot>/.pi/skills` 路径
 *   （DefaultResourceLoader 默认 includeDefaults=false，不会自动扫描）
 * - 25 个 customTools 的 execute 通过 toolExecutor 转发到渲染进程执行
 *
 * 关键差异（与 spec 3.2.2 节骨架代码对比，均已按真实 API 修正）：
 * - `session.send(text)` 不存在 → 用 `session.subscribe() + session.prompt(text)`
 * - `async *sendMessage()` 返回 AsyncGenerator → 改为 `sendMessage(onEvent)` 回调模式
 * - `ToolDefinition.inputSchema` → `ToolDefinition.parameters`（真实字段名）
 * - `execute(input)` 单参数 → `execute(toolCallId, params, signal, onUpdate, ctx)` 5 参数
 * - 缺失 `label` 字段 → 补充（真实必填字段）
 */

// ============================================================================
// Electron 31 + pi-coding-agent undici 兼容性补丁（必须在 pi-coding-agent 加载之前）
//
// 根因：pi-coding-agent 内置 undici 在 lib/web/webidl/index.js:5 从 node:worker_threads
// 解构 markAsUncloneable，但该 API 是 Node 22+ 才加入，Electron 31 内置 Node 20.x 无此 API。
// 详见 ./compat/workerThreadsPatch.ts 注释。
//
// ESM import 提升机制要求：此 import 必须在 @earendil-works/pi-coding-agent 之前，
// 否则 pi-coding-agent 加载时 undici 已 require 到没有 markAsUncloneable 的 worker_threads。
// ============================================================================
import '../compat/workerThreadsPatch'
import { app } from 'electron'
import { join } from 'path'
// 注意：pi-coding-agent 的值导入改为动态 import（见 initialize 方法）。
// 原因：ESM 静态 import 会被提升到模块顶部，导致 pi-coding-agent（external 依赖）
// 在 workerThreadsPatch 的 side-effect 代码之前加载，undici 崩溃时 patch 还没执行。
// 改为动态 import 后，pi-coding-agent 在 initialize() 内 await import()，
// 此时 workerThreadsPatch 的静态 import 已执行完毕，worker_threads 已被 patch。
// 仅保留类型导入（编译时擦除，不影响运行时加载顺序）。
import type {
  SessionManager,
  AgentSession,
  AgentSessionEvent,
  ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { apiKeyStore } from '../apiKeyStore'
import { getServerPort } from '../serverProcess'
import { type PiThinkingLevel } from '../../../src/utils/thinkingLevel'

// ============================================================================
// pi-coding-agent 动态加载缓存
// ============================================================================
/**
 * pi-coding-agent 模块的动态 import 缓存。
 *
 * 不能用静态 import 加载 pi-coding-agent，因为 ESM 静态 import 会被提升到模块顶部，
 * 导致 pi-coding-agent（external 依赖）在 workerThreadsPatch 的 side-effect 代码
 * 之前加载，undici 崩溃时 patch 还没执行。
 *
 * 改为在 initialize() 内 await import()，此时 workerThreadsPatch 已执行完毕，
 * worker_threads.markAsUncloneable 已注入，undici 加载时能正确解构到该函数。
 *
 * 类型用 `typeof import(...)` 推断，与静态 import 等价。
 * 类型的值成员（AuthStorage / ModelRegistry / DefaultResourceLoader / createAgentSession）
 * 通过 piPkg.xxx 访问；类型注解（SessionManager / AgentSession 等）见上方 import type。
 */
let piPkg: typeof import('@earendil-works/pi-coding-agent') | null = null

// ============================================================================
// 类型定义（与 spec 3.2.2 节 AgentEvent + IPC 桥接类型对齐）
// ============================================================================

/**
 * Agent 事件类型（IPC 转发到渲染进程的简化事件，与 spec 3.2.2 对齐）
 *
 * 设计原则：
 * - 简化 pi 的 AgentSessionEvent 为渲染进程易于处理的 5 种基础类型
 * - 未知事件类型不转发（避免噪音，渲染进程不需要处理所有 pi 内部事件）
 * - 与 server pi_event 事件对齐（renderer 的 handleAgentEvent 已实现这 5 种分支）
 */
export type AgentEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call'; toolName: string; params: unknown; requestId: string }
  | { type: 'tool_result'; requestId: string; success: boolean; data?: unknown; error?: string }
  | { type: 'turn_end'; totalTokens?: number }
  | { type: 'error'; message: string; recoverable: boolean }

/** 工具执行请求（主进程 → 渲染进程） */
export interface ToolExecuteRequest {
  requestId: string
  tool: string
  params: unknown
  panelId: string
}

/** 工具执行响应（渲染进程 → 主进程） */
export interface ToolExecuteResponse {
  requestId: string
  success: boolean
  data?: unknown
  error?: string
}

/**
 * ToolExecutor：由 main/index.ts 设置，通过 IPC 路由到渲染进程执行工具
 *
 * 设计：
 * - 主进程不直接执行工具（25 个工具的实现在渲染进程）
 * - LocalAgentService 通过此回调把 tool call 转发出去
 * - main/index.ts 在 app.whenReady 时调用 setToolExecutor 注入实现
 *   （实现内部用 BrowserWindow.getFocusedWindow().webContents.send +
 *    ipcMain.handle('tool:execute:result') 等待响应）
 */
export type ToolExecutor = (request: ToolExecuteRequest) => Promise<ToolExecuteResponse>

// ============================================================================
// LocalAgentService 单例
// ============================================================================

class LocalAgentService {
  /** 共享 SessionManager（inMemory，不持久化到磁盘） */
  private sessionManager: SessionManager | null = null
  /** per-panel AgentSession 映射 */
  private panelSessions = new Map<string, AgentSession>()
  /**
   * per-panel session 元信息（Phase 9 批次 3 模块 7）
   *
   * 在 createSession 成功后记录 provider / model / thinkingLevel，
   * 供 getActiveSessionInfo() 返回给 UI 显示当前激活会话的信息。
   */
  private panelSessionsInfo = new Map<string, { provider: string; model: string; thinkingLevel: string }>()
  /** 工具执行器（由 main/index.ts 注入） */
  private toolExecutor: ToolExecutor | null = null
  /** initialize 完成标志（防止重复初始化） */
  private initialized = false
  /**
   * per-panel 待应用的思考等级（Phase 9 批次 3 模块 6）
   *
   * 当 setThinkingLevel 被调用但 panelId 对应的 session 还未创建时，
   * 缓存到此 Map，下次 createSession 时取出作为初始 thinkingLevel。
   * 避免覆盖时机问题：用户在 sidebar 切了等级，但下一次发消息才创建 session。
   */
  private pendingThinkingLevels = new Map<string, PiThinkingLevel>()

  /**
   * 初始化 SessionManager 单例
   *
   * 在 app.whenReady 时调用，幂等（重复调用安全）。
   * SessionManager.inMemory(cwd) 创建内存中的 session（不写入磁盘），
   * 适合桌面端本地 agent 模式（无需跨进程持久化）。
   */
  async initialize(): Promise<void> {
    if (this.initialized) return
    // 动态加载 pi-coding-agent：此时 workerThreadsPatch 已执行（ESM 静态 import 先于
    // 普通代码），worker_threads.markAsUncloneable 已注入，undici 能正确解构到该函数。
    // 不能改为静态 import：ESM 静态 import 会被提升到模块顶部，导致 pi-coding-agent
    // 在 workerThreadsPatch 之前加载，undici 崩溃。
    piPkg = await import('@earendil-works/pi-coding-agent')
    const cwd = app.getAppPath()
    this.sessionManager = piPkg.SessionManager.inMemory(cwd)
    this.initialized = true
    console.log('[LocalAgent] SessionManager initialized (in-memory), cwd:', cwd)
  }

  /**
   * 设置 ToolExecutor（由 main/index.ts 在 app.whenReady 时调用）
   *
   * @param executor 工具执行器，内部通过 IPC 转发到渲染进程
   */
  setToolExecutor(executor: ToolExecutor): void {
    this.toolExecutor = executor
    console.log('[LocalAgent] ToolExecutor set')
  }

  /**
   * 发送消息到指定面板的 agent session
   *
   * 流程：
   * 1. 校验 activeProvider + apiKey 配置
   * 2. 获取或创建 per-panel session
   * 3. 订阅 session 事件，转发给 onEvent 回调
   * 4. 调用 session.prompt(message) 触发 agent loop
   * 5. prompt 完成后取消订阅，发出 turn_end 事件
   *
   * @param panelId 面板 ID
   * @param message 用户消息
   * @param thinkingLevel pi 思考等级（已映射，4 档 identity 映射）
   * @param onEvent 事件回调（每次 agent 事件触发）
   */
  async sendMessage(
    panelId: string,
    message: string,
    thinkingLevel: PiThinkingLevel,
    onEvent: (event: AgentEvent) => void,
  ): Promise<void> {
    if (!this.initialized || !this.sessionManager) {
      onEvent({ type: 'error', message: 'LocalAgentService not initialized', recoverable: false })
      return
    }

    // 1. 校验 activeProvider + config
    const activeProvider = apiKeyStore.getActiveProvider()
    if (!activeProvider) {
      onEvent({
        type: 'error',
        message: '未配置 active provider，请到设置 → AI 配置中切换',
        recoverable: true,
      })
      return
    }
    const config = apiKeyStore.getConfig(activeProvider)
    if (!config || !config.apiKey) {
      // safeStorage 中 apiKey 为空时，从后端数据库同步恢复
      try {
        const port = getServerPort()
        if (port) {
          const resp = await fetch(`http://localhost:${port}/api/ai/settings/api-key`)
          if (resp.ok) {
            const data = await resp.json() as { apiKey?: string }
            if (data.apiKey) {
              // 恢复到 safeStorage
              apiKeyStore.setApiKey(
                activeProvider,
                data.apiKey,
                config?.endpoint || '',
                config?.model || '',
              )
              // 重新读取 config
              const restoredConfig = apiKeyStore.getConfig(activeProvider)
              if (restoredConfig && restoredConfig.apiKey) {
                console.log(`[LocalAgent] apiKey restored from backend for ${activeProvider}`)
                // 继续使用 restoredConfig
                await this.continueSendMessage(panelId, message, thinkingLevel, onEvent, restoredConfig)
                return
              }
            }
          }
        }
      } catch (restoreErr) {
        console.error('[LocalAgent] Failed to restore apiKey from backend:', restoreErr)
      }
      onEvent({
        type: 'error',
        message: '未配置 API Key，请到设置 → AI 配置中配置',
        recoverable: true,
      })
      return
    }

    // 继续正常的消息发送流程
    await this.continueSendMessage(panelId, message, thinkingLevel, onEvent, config)
  }

  /**
   * continueSendMessage：实际的 session 获取/prompt 逻辑
   * 从 sendMessage 抽出，供 apiKey 恢复后复用
   */
  private async continueSendMessage(
    panelId: string,
    message: string,
    thinkingLevel: PiThinkingLevel,
    onEvent: (event: AgentEvent) => void,
    config: { provider: string; apiKey: string; endpoint: string; model: string },
  ): Promise<void> {

    // 2. 获取或创建 session
    let session = this.panelSessions.get(panelId)
    if (!session) {
      try {
        session = await this.createSession(panelId, config, thinkingLevel)
        this.panelSessions.set(panelId, session)
      } catch (err) {
        onEvent({
          type: 'error',
          message: `Failed to create agent session: ${(err as Error).message}`,
          recoverable: false,
        })
        return
      }
    }

    // 3. 订阅事件，转发给 onEvent
    const unsubscribe = session.subscribe((event) => {
      const mapped = this.mapSessionEventToAgentEvent(event)
      if (mapped) onEvent(mapped)
    })

    // 4. 调用 prompt 触发 agent loop
    try {
      await session.prompt(message)
      // prompt 正常结束，发出 turn_end 事件
      onEvent({ type: 'turn_end' })
    } catch (err) {
      onEvent({
        type: 'error',
        message: `Agent loop error: ${(err as Error).message}`,
        recoverable: false,
      })
    } finally {
      unsubscribe()
    }
  }

  /**
   * 销毁指定面板的 session
   */
  disposeSession(panelId: string): void {
    const session = this.panelSessions.get(panelId)
    if (session) {
      session.dispose()
      this.panelSessions.delete(panelId)
      this.panelSessionsInfo.delete(panelId)
      console.log(`[LocalAgent] Disposed session for panel ${panelId}`)
    }
  }

  /**
   * 销毁所有 session（app quit 时调用）
   */
  disposeAll(): void {
    for (const [panelId] of this.panelSessions) {
      this.disposeSession(panelId)
    }
  }

  // ========================================================================
  // 内部实现
  // ========================================================================

  /**
   * 动态切换指定面板 session 的思考等级（Phase 9 批次 3 模块 6）
   *
   * 调用时机：用户在 sidebar 切换思考等级后立即触发，无需等下一次发消息。
   *
   * 行为：
   * - session 已存在：调用 session.setThinkingLevel(level) 实时切换
   *   （pi-coding-agent 的 AgentSession.setThinkingLevel 是同步方法，见 sdk.d.ts:92）
   * - session 不存在：缓存到 pendingThinkingLevels，下次 createSession 时作为初始值
   *   （覆盖 sendMessage 传入的 thinkingLevel，确保用户最近一次切换生效）
   *
   * @param panelId 面板 ID
   * @param level pi 思考等级字符串（minimal/low/medium/high，与 PiThinkingLevel 对齐）
   */
  async setThinkingLevel(panelId: string, level: PiThinkingLevel): Promise<void> {
    const session = this.panelSessions.get(panelId)
    if (session) {
      // session 已存在：调用 pi 原生 setThinkingLevel 实时切换
      try {
        session.setThinkingLevel(level)
        console.log(`[LocalAgent] Panel ${panelId}: thinking level switched to "${level}" (live)`)
      } catch (err) {
        console.error(`[LocalAgent] Panel ${panelId}: failed to set thinking level "${level}":`, err)
        throw err
      }
    } else {
      // session 不存在：缓存到 pendingThinkingLevels，下次 createSession 时使用
      this.pendingThinkingLevels.set(panelId, level)
      console.log(`[LocalAgent] Panel ${panelId}: thinking level pending → "${level}" (will apply on next createSession)`)
    }
  }

  /**
   * 创建 per-panel AgentSession（参考 server piBridge.ts:1022-1136 真实调用方式）
   */
  private async createSession(
    panelId: string,
    config: { provider: string; apiKey: string; endpoint: string; model: string },
    thinkingLevel: PiThinkingLevel,
  ): Promise<AgentSession> {
    if (!this.sessionManager || !piPkg) {
      throw new Error('LocalAgentService not initialized')
    }

    // 应用 pending thinkingLevel（如果存在，覆盖传入的 thinkingLevel）
    // 用户在 sidebar 切了等级但 session 还没创建时，pending 优先
    const pendingLevel = this.pendingThinkingLevels.get(panelId)
    const effectiveLevel = pendingLevel ?? thinkingLevel
    if (pendingLevel) {
      this.pendingThinkingLevels.delete(panelId)
      console.log(`[LocalAgent] Panel ${panelId}: applied pending thinking level "${effectiveLevel}"`)
    }

    const cwd = app.getAppPath()
    // agentDir 指向 <projectRoot>/.pi（让 auth.json 写入 .pi/auth.json，
    // extensions 从 .pi/extensions/ 加载）
    const agentDir = join(cwd, '.pi')
    // additionalSkillPaths：显式指定 skills 扫描路径
    // DefaultResourceLoader 默认 includeDefaults=false，不会自动扫描
    // .pi/skills/，必须通过 additionalSkillPaths 注入
    const skillsDir = join(agentDir, 'skills')

    // 25 个 customTools（与 server piBridge.ts:871-899 对齐，但 execute 走 IPC 路由）
    const customTools = this.buildCustomTools(panelId)

    // ResourceLoader（参考 server piBridge.ts:1045-1066）
    const resourceLoader = new piPkg.DefaultResourceLoader({
      cwd,
      agentDir,
      additionalSkillPaths: [skillsDir],
      extensionFactories: [
        (pi) => {
          for (const tool of customTools) {
            pi.registerTool(tool)
          }
        },
      ],
    })
    await resourceLoader.reload()

    // Skills 加载验证（模块 9）
    const { skills, diagnostics } = resourceLoader.getSkills()
    console.log(`[LocalAgent] Panel ${panelId}: loaded ${skills.length} skills`)
    for (const skill of skills) {
      console.log(`[LocalAgent]   - ${skill.name}: ${skill.description}`)
    }
    if (diagnostics.length > 0) {
      console.warn(`[LocalAgent] Skill diagnostics:`, diagnostics)
    }

    // AuthStorage：用 pi-coding-agent 原生 AuthStorage.create 工厂方法
    // （参考 piBridge.ts:1079，不能用对象字面量实现）
    const authStorage = piPkg.AuthStorage.create(join(agentDir, 'auth.json'))
    authStorage.setRuntimeApiKey(config.provider, config.apiKey)

    // 自定义 endpoint 透传到环境变量（参考 piBridge.ts:1088-1091）
    if (config.endpoint) {
      process.env.PI_API_ENDPOINT = config.endpoint
    }

    // ModelRegistry（参考 piBridge.ts:1093）
    const modelRegistry = piPkg.ModelRegistry.create(authStorage)

    // Flush extension provider registrations into modelRegistry BEFORE model lookup
    // （参考 piBridge.ts:1096-1100）
    const extensionsResult = resourceLoader.getExtensions()
    for (const { name, config: providerConfig } of extensionsResult.runtime.pendingProviderRegistrations) {
      modelRegistry.registerProvider(name, providerConfig)
    }
    extensionsResult.runtime.pendingProviderRegistrations = []

    // 解析 model：find 返回 Model<Api> 对象（不是字符串）
    // 参考 piBridge.ts:1073-1076：支持 'provider/model' 或分开传
    const [providerName, modelName] = config.model.includes('/')
      ? config.model.split('/')
      : [config.provider, config.model]
    const model = modelRegistry.find(providerName, modelName)
    if (!model) {
      throw new Error(
        `model not found in registry: ${providerName}/${modelName}. ` +
          `Ensure provider "${providerName}" is registered and model "${modelName}" exists, and API key is set.`,
      )
    }

    console.log(`[LocalAgent] Panel ${panelId}: using model ${providerName}/${modelName}`)

    // createAgentSession（参考 piBridge.ts:1110-1120 真实调用方式）
    const { session } = await piPkg.createAgentSession({
      cwd,
      agentDir,
      resourceLoader,
      sessionManager: this.sessionManager,
      authStorage,
      modelRegistry,
      model,
      noTools: 'builtin', // 禁用内置 read/bash/edit/write，仅 customTools
      customTools,
      thinkingLevel: effectiveLevel, // pi-coding-agent 原生支持思考等级注入（spec 8.6）；优先用 pending 值
    })

    // Phase 9 批次 3 模块 7：记录 session 元信息，供 getActiveSessionInfo 查询
    this.panelSessionsInfo.set(panelId, {
      provider: providerName,
      model: modelName,
      thinkingLevel: effectiveLevel,
    })

    return session
  }

  /**
   * 获取指定面板当前激活会话的信息（Phase 9 批次 3 模块 7）
   *
   * 用途：UI 显示当前 agent 使用的 provider / model / 思考等级，
   * 帮助用户了解当前会话配置。
   *
   * @param panelId 面板 ID
   * @returns 会话信息对象；若面板无激活 session 返回 null
   */
  getActiveSessionInfo(panelId: string): { provider: string; model: string; thinkingLevel: string } | null {
    return this.panelSessionsInfo.get(panelId) ?? null
  }

  /**
   * 构建 26 个 customTools（execute 走 IPC 到渲染进程）
   *
   * 工具清单与 server piBridge.ts:871-899 完全对齐：
   * - 4 widget：create_html_widget / update_html_widget / delete_html_widget / list_widgets
   * - 2 storage：storage_read / storage_write
   * - 18 browser：browser_eval / browser_get_dom / browser_click / browser_input /
   *   browser_scroll / browser_wait_for / browser_screenshot / browser_navigate /
   *   browser_get_url / browser_get_title / browser_back / browser_forward /
   *   browser_reload / browser_get_cookie / browser_set_cookie / browser_open /
   *   browser_switch_tab / browser_list_tabs
   * - 1 ask_user
   * - 1 system（Phase 14.4）：query_capabilities
   *
   * 注：parameters schema 简化为 Type.Object({})，让 LLM 自由传参，
   * 实际参数校验由渲染进程 wsToolHandlers.executeToolCall 完成（复用现有逻辑）。
   */
  private buildCustomTools(panelId: string): ToolDefinition[] {
    const toolNames = [
      'create_html_widget', 'update_html_widget', 'delete_html_widget', 'list_widgets',
      'storage_read', 'storage_write',
      'browser_eval', 'browser_get_dom', 'browser_click', 'browser_input',
      'browser_scroll', 'browser_wait_for', 'browser_screenshot', 'browser_navigate',
      'browser_get_url', 'browser_get_title', 'browser_back', 'browser_forward',
      'browser_reload', 'browser_get_cookie', 'browser_set_cookie', 'browser_open',
      'browser_switch_tab', 'browser_list_tabs',
      'ask_user',
      // Phase 14.4：查询组件能力声明（system 工具，路由到服务器执行）
      'query_capabilities',
    ]
    return toolNames.map((name) => this.buildTool(name, panelId))
  }

  /**
   * 构建单个 customTool（真实 ToolDefinition 签名）
   *
   * 关键签名（与 spec 骨架代码不同，已按真实 API 修正）：
   * - 必填 label 字段
   * - parameters 字段（非 inputSchema）
   * - execute 5 参数：(toolCallId, params, signal, onUpdate, ctx)
   * - execute 返回 Promise<AgentToolResult>（含 content + details）
   */
  private buildTool(name: string, panelId: string): ToolDefinition {
    return {
      name,
      label: name, // 必填字段（spec 骨架漏掉，已补充）
      description: `Tool ${name} (local agent, IPC routed to renderer)`,
      parameters: Type.Object({}), // 简化 schema，实际校验由渲染进程完成
      execute: async (toolCallId, params, _signal, _onUpdate, _ctx) => {
        if (!this.toolExecutor) {
          throw new Error(`ToolExecutor not set (tool: ${name}, panelId: ${panelId})`)
        }
        const result = await this.toolExecutor({
          requestId: toolCallId,
          tool: name,
          params,
          panelId,
        })
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: result.success,
                data: result.data,
                error: result.error,
              }),
            },
          ],
          details: {},
        }
      },
    }
  }

  /**
   * 把 pi AgentSessionEvent 映射为简化的 AgentEvent
   *
   * 已知事件类型映射（基于 agent-session.d.ts:40-77 + AgentEvent 继承）：
   * - message_start / message_update（含 text delta） → text_delta
   * - tool_execution_start → tool_call
   * - tool_execution_end → tool_result
   * - agent_end → turn_end（不含 error 时）
   *
   * 未知事件返回 null（不转发到渲染进程，避免噪音）
   */
  private mapSessionEventToAgentEvent(event: AgentSessionEvent): AgentEvent | null {
    // 用 any 访问事件字段（AgentSessionEvent 是 union type，字段访问需要 narrowing）
    const e = event as { type?: string; [key: string]: unknown }

    switch (e.type) {
      // 文本流：message_start / message_update / text_delta
      // pi 在 streaming 时通过 message_update 携带增量文本
      case 'message_start':
      case 'message_update': {
        // 尝试从 event 中提取增量文本
        // pi 的 message 事件结构：{ type, message: { content: [{ type: 'text', text: ... }] } }
        const message = e.message as { content?: Array<{ type: string; text?: string }> } | undefined
        const text = message?.content?.find((c) => c.type === 'text')?.text
        if (text) {
          return { type: 'text_delta', text }
        }
        return null
      }

      // 工具调用开始
      case 'tool_execution_start': {
        const toolName = (e.toolName ?? e.name ?? '') as string
        const requestId = (e.toolCallId ?? e.id ?? '') as string
        const params = e.params ?? e.arguments ?? {}
        return { type: 'tool_call', toolName, params, requestId }
      }

      // 工具调用结束
      case 'tool_execution_end': {
        const requestId = (e.toolCallId ?? e.id ?? '') as string
        const success = (e.success ?? !e.error) as boolean
        const data = e.result
        const error = e.error as string | undefined
        return { type: 'tool_result', requestId, success, data, error }
      }

      // agent 结束（turn end）
      case 'agent_end': {
        return { type: 'turn_end' }
      }

      // 其他事件类型（compaction/session_info_changed/thinking_level_changed/
      // queue_update/auto_retry_*）不转发到渲染进程（避免噪音）
      default:
        return null
    }
  }
}

/** 主进程单例 */
export const localAgentService = new LocalAgentService()
