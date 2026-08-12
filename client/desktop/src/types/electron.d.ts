// Electron webview 标签及自定义 window API 的类型声明
// 此文件供渲染进程使用（tsconfig.app.json 包含 src 目录）

// ========== Webview 事件类型 ==========
export interface DidNavigateEvent {
  url: string
  httpResponseCode: number
  httpStatusText: string
}

export interface LoadCommitEvent {
  url: string
  isMainFrame: boolean
}

export interface DidFailLoadEvent {
  errorCode: number
  errorDescription: string
  validatedURL: string
  isMainFrame: boolean
}

export interface DidNavigateInPageEvent {
  url: string
  isMainFrame: boolean
}

export interface PageTitleUpdatedEvent {
  title: string
  explicitSet: boolean
}

export interface PageFaviconUpdatedEvent {
  favicons: string[]
}

export interface ConsoleMessageEvent {
  level: number
  message: string
  line: number
  sourceId: string
}

export interface NewWindowEvent {
  url: string
  frameName: string
  disposition: string
  options: unknown
  additionalFeatures: string[]
}

export interface CloseEvent {
  // webview close 事件无特殊字段
}

export interface ResponsiveEvent {
  // webview responsive 事件无特殊字段
}

export interface UnresponsiveEvent {
  // webview unresponsive 事件无特殊字段
}

// ========== Webview 事件映射 ==========
export interface WebviewEventMap {
  'load-commit': LoadCommitEvent
  'did-finish-load': void
  'did-fail-load': DidFailLoadEvent
  'did-frame-finish-load': void
  'did-start-loading': void
  'did-stop-loading': void
  'did-get-response-details': unknown
  'did-get-redirect-request': unknown
  'dom-ready': void
  'console-message': ConsoleMessageEvent
  'found-in-page': unknown
  'will-navigate': unknown
  'did-navigate': DidNavigateEvent
  'did-navigate-in-page': DidNavigateInPageEvent
  'close': CloseEvent
  'responsive': ResponsiveEvent
  'unresponsive': UnresponsiveEvent
  'page-title-updated': PageTitleUpdatedEvent
  'page-favicon-updated': PageFaviconUpdatedEvent
  'enter-html-full-screen': void
  'leave-html-full-screen': void
  'new-window': NewWindowEvent
  'media-started-playing': void
  'media-paused': void
  'did-change-theme-color': unknown
  'update-target-url': unknown
  'gpu-crashed': unknown
}

// ========== WebviewTag 接口 ==========
export interface WebviewTag extends HTMLElement {
  // 常用属性
  src: string
  partition?: string
  allowpopups?: boolean
  webpreferences?: string
  disablewebsecurity?: boolean
  httpreferrer?: string
  useragent?: string
  preload?: string
  nodeintegration?: boolean
  nodeintegrationinsubframes?: boolean
  plugins?: boolean
  autosize?: boolean
  minwidth?: number
  minheight?: number
  maxwidth?: number
  maxheight?: number
  blinkfeatures?: string
  disableblinkfeatures?: string
  guestinstance?: string

  // 常用方法
  loadURL(url: string, options?: { httpReferrer?: string; userAgent?: string; extraHeaders?: string }): Promise<void>
  getURL(): string
  getTitle(): string
  isLoading(): boolean
  isWaitingForResponse(): boolean
  stop(): void
  reload(): void
  reloadIgnoringCache(): void
  canGoBack(): boolean
  canGoForward(): boolean
  canGoToOffset(offset: number): boolean
  goBack(): void
  goForward(): void
  goToOffset(offset: number): void
  isCrashed(): boolean
  setUserAgent(userAgent: string): void
  getUserAgent(): string
  executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>
  openDevTools(): void
  closeDevTools(): void
  isDevToolsOpened(): boolean
  getWebContentsId(): number
  print(options?: unknown): Promise<void>
  printToPDF(options?: unknown): Promise<Uint8Array>
  capturePage(rect?: { x: number; y: number; width: number; height: number }): Promise<{ toDataURL: () => string }>
  setAudioMuted(muted: boolean): void
  isAudioMuted(): boolean
  clearHistory(): void
  findInPage(text: string, options?: { forward?: boolean; findNext?: boolean; matchCase?: boolean }): void
  stopFindInPage(action: 'clearSelection' | 'keepSelection' | 'activateSelection'): void

  // addEventListener 重载：支持 webview 特有事件及 options 参数
  addEventListener<K extends keyof WebviewEventMap>(
    type: K,
    listener: (this: WebviewTag, event: WebviewEventMap[K] extends void ? Event : CustomEvent<WebviewEventMap[K]>) => void,
    options?: boolean | AddEventListenerOptions
  ): void
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ): void

  removeEventListener<K extends keyof WebviewEventMap>(
    type: K,
    listener: (this: WebviewTag, event: WebviewEventMap[K] extends void ? Event : CustomEvent<WebviewEventMap[K]>) => void,
    options?: boolean | EventListenerOptions
  ): void
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions
  ): void
}

// ========== Cookie 相关类型（与 Electron 类型结构兼容） ==========
export interface CookieDetails {
  name: string
  value: string
  domain: string
  hostOnly: boolean
  path: string
  secure: boolean
  httpOnly: boolean
  session: boolean
  expirationDate?: number
  sameSite?: 'unspecified' | 'no_restriction' | 'lax' | 'strict'
}

export interface CookiesSetDetails {
  url: string
  name?: string
  value?: string
  domain?: string
  path?: string
  secure?: boolean
  httpOnly?: boolean
  expirationDate?: number
  sameSite?: 'unspecified' | 'no_restriction' | 'lax' | 'strict'
}

export interface CookieRemoveDetails {
  url: string
  name: string
}

// ========== window 上的自定义 API 声明 ==========
export interface ContextMenuApi {
  show(items: Array<{ label: string; enabled?: boolean }>): Promise<number>
}

export interface CookieApi {
  get(url: string): Promise<CookieDetails[]>
  set(cookie: CookiesSetDetails): Promise<void>
  remove(details: CookieRemoveDetails): Promise<void>
}

export interface WebviewApi {
  onOpenUrl(callback: (url: string) => void): () => void
}

export interface MenuApi {
  onMenuAction(callback: (action: string) => void): () => void
}

// Phase 7 批次3 任务6：快捷键 IPC API（主进程拦截 Ctrl+W/Ctrl+R/F5 后转发到渲染进程）
export interface ShortcutApi {
  onShortcutAction(callback: (action: string) => void): () => void
}

// Phase 4: syncLog API（spec 2.6 节）
export interface SyncLogEntry {
  timestamp: number
  op: unknown  // SyncQueueEntry 序列化后的对象
  status: 'success' | 'failed'
  error?: string
}

export interface SyncLogApi {
  append(entry: SyncLogEntry): Promise<void>
  read(): Promise<SyncLogEntry[]>
  rotate(): Promise<void>
}

// Phase 6.2: 本地服务注册 API（spec 3.3.6 节）
export interface LocalServiceConfig {
  serviceName: string
  endpoint: string
  description?: string
}

export interface LocalServicesApi {
  readConfig(): Promise<{ services: LocalServiceConfig[] } | null>
  onUnregister(callback: () => void): () => void
}

// Phase 6.1：内存监控 API（spec 第 7 节）
export interface MemoryApi {
  getMemoryUsage(): Promise<{ rss: number; heapUsed: number; heapTotal: number; external: number }>
}

// Phase 7 批次5：缩略图捕获 API（spec 7.1.1 节）
export interface ThumbnailApi {
  /** 通过 webContentsId 调用主进程 capturePage，返回 PNG dataURL（失败返回 null） */
  capture(webContentsId: number): Promise<string | null>
}

// Phase 9 批次1：API Key 加密存储 API（safeStorage 加密）
// 渲染进程通过此 API 读写主进程的 apiKeyStore，不再直接访问 localStorage 的明文 apiKey
export interface AiKeyApi {
  /** 设置 provider 的 API Key（加密存储到 userData/ai-keys.json） */
  setApiKey: (provider: string, apiKey: string, endpoint: string, model: string) => Promise<void>
  /** 读取 provider 的 API Key（解密后返回明文，未配置时返回 null） */
  getApiKey: (provider: string) => Promise<string | null>
  /** 设置当前激活的 provider */
  setActiveProvider: (provider: string) => Promise<void>
  /** 获取当前激活的 provider（未设置时返回 null） */
  getActiveProvider: () => Promise<string | null>
  /** 删除指定 provider 的配置 */
  deleteApiKey: (provider: string) => Promise<void>
  /** 列出所有已配置的 provider */
  listProviders: () => Promise<string[]>
}

// Phase 9 批次2 模块3：toolBridge API（工具执行 IPC 桥接）
// 方案 B（双向 IPC，spec 3.3 推荐）：
// - 主进程发 tool:execute:request → 渲染进程监听（onToolExecuteRequest）
// - 渲染进程执行后回 tool:execute:result（respondToolResult）
export interface ToolBridgeApi {
  /**
   * 监听主进程的 tool:execute:request 事件
   * @param callback 工具执行请求回调（参数为主进程发来的 ToolExecuteRequest）
   * @returns 清理函数（取消监听）
   */
  onToolExecuteRequest: (callback: (request: unknown) => void) => () => void
  /**
   * 回传工具执行结果给主进程
   * @param response 工具执行响应（含 requestId/success/data/error）
   */
  respondToolResult: (response: unknown) => Promise<void>
  /**
   * 备用方向：渲染进程主动调主进程执行工具（本地 agent 模式下不用，任务 2 要求暴露）
   * @param tool 工具名
   * @param params 工具参数
   */
  executeTool: (tool: string, params: unknown) => Promise<unknown>
}

// Phase 9 批次2 模块2：AgentEvent 类型（与 LocalAgentService 对齐）
// 这是主进程 → 渲染进程转发的简化事件类型（基于 spec 3.2.2 节 AgentEvent 定义）
export type AgentEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call'; toolName: string; params: unknown; requestId: string }
  | { type: 'tool_result'; requestId: string; success: boolean; data?: unknown; error?: string }
  | { type: 'turn_end'; totalTokens?: number }
  | { type: 'error'; message: string; recoverable: boolean }

// Phase 13.1.1：窗口控制 API（自绘标题栏）
// 渲染进程通过此 API 调用主进程的窗口控制 IPC（minimize / maximizeToggle / close 等）
// onMaximizeChange 返回清理函数（与 menuApi/shortcutApi 同模式，避免内存泄漏）
export interface WindowApi {
  /** 最小化窗口 */
  minimize: () => Promise<void>
  /** 切换最大化/还原 */
  maximizeToggle: () => Promise<void>
  /** 关闭窗口（触发 close 事件，由 isQuitting 逻辑接管最小化到托盘） */
  close: () => Promise<void>
  /** 查询当前是否最大化（用于初始渲染 + 双击标题栏切换图标） */
  isMaximized: () => Promise<boolean>
  /**
   * 订阅窗口最大化状态变化事件
   * @param callback 状态变化回调（参数为当前是否最大化）
   * @returns 清理函数（取消监听）
   */
  onMaximizeChange: (callback: (isMaximized: boolean) => void) => () => void
}

// Phase 9 批次2 模块2：AgentApi 接口（preload 暴露的 agent API）
export interface AgentApi {
  /**
   * 初始化 LocalAgentService（创建 SessionManager 单例）
   * 主进程 app.whenReady 时已自动调用，渲染进程可选调（幂等）
   */
  initialize: () => Promise<{ ok: boolean }>
  /**
   * 发送消息到指定面板的 agent session
   * 事件通过 onEvent 回调推送（text_delta / tool_call / tool_result / turn_end / error）
   * @param payload.panelId 面板 ID
   * @param payload.message 用户消息
   * @param payload.thinkingLevel pi 思考等级（minimal/low/medium/high）
   */
  sendMessage: (payload: {
    panelId: string
    message: string
    thinkingLevel: string
  }) => Promise<{ ok: boolean }>
  /**
   * 销毁指定面板的 agent session（释放资源）
   */
  disposeSession: (panelId: string) => Promise<{ ok: boolean }>
  /**
   * 动态切换指定面板 session 的思考等级（Phase 9 批次 3 模块 6）
   *
   * 行为：
   * - session 已存在：调用 pi 原生 session.setThinkingLevel(level) 实时切换
   * - session 不存在：缓存到 pendingThinkingLevels，下次 createSession 时使用
   *
   * @param panelId 面板 ID
   * @param level pi 思考等级字符串（minimal/low/medium/high，与 useThinkingLevelStore 4 档对齐）
   */
  setThinkingLevel: (panelId: string, level: string) => Promise<{ ok: boolean }>
  /**
   * 订阅 agent 事件（流式推送）
   * @param callback 事件回调（参数含 panelId + event）
   * @returns 清理函数（取消监听）
   */
  onEvent: (callback: (data: { panelId: string; event: AgentEvent }) => void) => () => void
}

// Phase 14 C4：server 端口 API（preload 通过 sendSync 同步获取后暴露给 renderer）
// 主进程 startServer 后端口已确定，renderer 同步读取，避免异步 IPC 阻塞
export interface ServerPortApi {
  /**
   * 同步获取 server 监听端口
   * @returns 端口号（未启动时返回 null，调用方应 fallback 到默认端口 3456）
   */
  getServerPort: () => number | null
}

declare global {
  interface Window {
    contextMenuApi?: ContextMenuApi
    cookieApi?: CookieApi
    webviewApi?: WebviewApi
    menuApi?: MenuApi
    shortcutApi?: ShortcutApi
    syncLogApi?: SyncLogApi
    localServicesApi?: LocalServicesApi
    memoryApi?: MemoryApi
    thumbnailApi?: ThumbnailApi
    aiKeyApi?: AiKeyApi
    toolBridgeApi?: ToolBridgeApi
    agentApi?: AgentApi
    windowApi?: WindowApi
    // Phase 14 C4：server 端口 API（同步获取）
    serverPortApi?: ServerPortApi
  }

  // JSX IntrinsicElements 声明：支持 <webview> 标签
  namespace JSX {
    interface IntrinsicElements {
      webview: {
        src?: string
        partition?: string
        allowpopups?: boolean
        webpreferences?: string
        disablewebsecurity?: boolean
        httpreferrer?: string
        useragent?: string
        preload?: string
        nodeintegration?: boolean
        plugins?: boolean
        autosize?: boolean
        minwidth?: number
        minheight?: number
        maxwidth?: number
        maxheight?: number
        blinkfeatures?: string
        disableblinkfeatures?: string
        guestinstance?: string
        allowtransparency?: boolean
        class?: string
        style?: React.CSSProperties
        id?: string
        key?: string | number
        ref?: React.Ref<WebviewTag>
        onLoadCommit?: (event: CustomEvent<LoadCommitEvent>) => void
        onDidNavigate?: (event: CustomEvent<DidNavigateEvent>) => void
        onDidFailLoad?: (event: CustomEvent<DidFailLoadEvent>) => void
        onDidNavigateInPage?: (event: CustomEvent<DidNavigateInPageEvent>) => void
        onPageTitleUpdated?: (event: CustomEvent<PageTitleUpdatedEvent>) => void
        onPageFaviconUpdated?: (event: CustomEvent<PageFaviconUpdatedEvent>) => void
        onConsoleMessage?: (event: CustomEvent<ConsoleMessageEvent>) => void
        onNewWindow?: (event: CustomEvent<NewWindowEvent>) => void
        onClose?: (event: Event) => void
        onResponsive?: (event: Event) => void
        onUnresponsive?: (event: Event) => void
        onDomReady?: (event: Event) => void
        onDidStartLoading?: (event: Event) => void
        onDidStopLoading?: (event: Event) => void
        onDidFinishLoad?: (event: Event) => void
      }
    }
  }
}

export {}
