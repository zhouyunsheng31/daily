import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// 通过 contextBridge 安全地暴露 API 给渲染进程
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    // Phase 14 C4：同步获取 server 端口（主进程已 await startServer 完成，serverPort 已就绪）
    // 用 sendSync 同步获取，避免 preload 异步 IPC 阻塞窗口加载
    // 端口在主进程 startServer 后已确定，不会变化，所以预先取一次即可
    const serverPort = ipcRenderer.sendSync('server:get-port-sync') as number | null
    contextBridge.exposeInMainWorld('serverPortApi', {
      getServerPort: (): number | null => serverPort,
    })
    // 新增：菜单 API
    contextBridge.exposeInMainWorld('menuApi', {
      onMenuAction: (callback: (action: string) => void): (() => void) => {
        const handler = (_: unknown, action: string): void => callback(action)
        ipcRenderer.on('menu:action', handler)
        return () => ipcRenderer.removeListener('menu:action', handler)
      }
    })
    // 新增：Cookie API（供 browserToolBridge 使用）
    contextBridge.exposeInMainWorld('cookieApi', {
      get: (url: string) => ipcRenderer.invoke('cookie:get', url),
      set: (cookie: Electron.CookiesSetDetails) => ipcRenderer.invoke('cookie:set', cookie),
      remove: (details: { url: string; name: string }) => ipcRenderer.invoke('cookie:remove', details),
    })
    // M7 修复：contextMenuApi 在 contextIsolated 分支中明确暴露（F2 修复要求 renderer 通过 contextBridge 调用主进程）
    contextBridge.exposeInMainWorld('contextMenuApi', {
      show: (items: Array<{ label: string; enabled?: boolean }>): Promise<number> =>
        ipcRenderer.invoke('context-menu:show', items),
    })
    // S1 修复：webviewApi 暴露 webview:open-url 监听器，返回清理函数（与 menuApi 同模式）
    // 原代码用 window.electron?.ipcRenderer?.on() 返回 void 不是清理函数，导致内存泄漏
    contextBridge.exposeInMainWorld('webviewApi', {
      onOpenUrl: (callback: (url: string) => void): (() => void) => {
        const handler = (_: unknown, url: string): void => callback(url)
        ipcRenderer.on('webview:open-url', handler)
        return () => ipcRenderer.removeListener('webview:open-url', handler)
      }
    })
    // Phase 7 批次3 任务6：快捷键 IPC（主进程 before-input-event 拦截 Ctrl+W/Ctrl+R/F5 后转发）
    contextBridge.exposeInMainWorld('shortcutApi', {
      onShortcutAction: (callback: (action: string) => void): (() => void) => {
        const handler = (_: unknown, action: string): void => callback(action)
        ipcRenderer.on('shortcut:action', handler)
        return () => ipcRenderer.removeListener('shortcut:action', handler)
      }
    })
    // Phase 4: syncLog API（spec 2.6 节）—— syncQueue 文件持久化
    contextBridge.exposeInMainWorld('syncLogApi', {
      append: (entry: unknown) => ipcRenderer.invoke('sync-log:append', entry),
      read: () => ipcRenderer.invoke('sync-log:read'),
      rotate: () => ipcRenderer.invoke('sync-log:rotate'),
    })
    // Phase 6.1：内存监控 API（spec 第 7 节）
    contextBridge.exposeInMainWorld('memoryApi', {
      getMemoryUsage: () => ipcRenderer.invoke('app:getMemoryUsage'),
    })
    // Phase 6.2: 本地服务注册 API（spec 3.3.6 节）
    contextBridge.exposeInMainWorld('localServicesApi', {
      readConfig: () => ipcRenderer.invoke('local-services:read-config'),
      onUnregister: (callback: () => void): (() => void) => {
        const handler = (): void => callback()
        ipcRenderer.on('local-services:unregister', handler)
        return () => ipcRenderer.removeListener('local-services:unregister', handler)
      },
    })
    // Phase 7 批次5：缩略图捕获 API（spec 7.1.1 节）
    // 渲染进程通过 webContentsId 调用主进程 capturePage，返回 PNG dataURL
    contextBridge.exposeInMainWorld('thumbnailApi', {
      capture: (webContentsId: number): Promise<string | null> =>
        ipcRenderer.invoke('thumbnail:capture', webContentsId),
    })
    // Phase 9 批次1：API Key 加密存储 API（safeStorage 加密）
    // 渲染进程通过此 API 读写主进程的 apiKeyStore，不再直接访问 localStorage 的明文 apiKey
    contextBridge.exposeInMainWorld('aiKeyApi', {
      setApiKey: (provider: string, apiKey: string, endpoint: string, model: string) =>
        ipcRenderer.invoke('agent:set-api-key', { provider, apiKey, endpoint, model }),
      getApiKey: (provider: string) =>
        ipcRenderer.invoke('agent:get-api-key', { provider }),
      setActiveProvider: (provider: string) =>
        ipcRenderer.invoke('agent:set-active-provider', { provider }),
      getActiveProvider: () =>
        ipcRenderer.invoke('agent:get-active-provider'),
      deleteApiKey: (provider: string) =>
        ipcRenderer.invoke('agent:delete-api-key', { provider }),
      listProviders: () =>
        ipcRenderer.invoke('agent:list-providers'),
    })
    // Phase 9 批次2 模块3：toolBridge API（工具执行 IPC 桥接）
    // 方案 B（双向 IPC，spec 3.3 推荐）：
    // - 主进程发 tool:execute:request → 渲染进程监听（onToolExecuteRequest）
    // - 渲染进程执行后回 tool:execute:result（respondToolResult）
    // executeTool（备用方向，任务 2 要求暴露）：
    // - 渲染进程调 executeTool → ipcRenderer.invoke('tool:execute')
    // - 主进程 ipcMain.handle('tool:execute') 处理（备用，本地 agent 模式下不用）
    contextBridge.exposeInMainWorld('toolBridgeApi', {
      // 方案 B：主进程 → 渲染进程
      onToolExecuteRequest: (callback: (request: unknown) => void): (() => void) => {
        const handler = (_: unknown, request: unknown): void => callback(request)
        ipcRenderer.on('tool:execute:request', handler)
        return () => ipcRenderer.removeListener('tool:execute:request', handler)
      },
      respondToolResult: (response: unknown): Promise<void> =>
        ipcRenderer.invoke('tool:execute:result', response),
      // 备用方向：渲染进程 → 主进程（任务 2 要求暴露）
      executeTool: (tool: string, params: unknown): Promise<unknown> =>
        ipcRenderer.invoke('tool:execute', { tool, params }),
    })
    // Phase 13.1.1：窗口控制 API（自绘标题栏）
    // 渲染进程 TitleBar 组件通过此 API 调用主进程的窗口控制 IPC：
    //   - minimize / maximizeToggle / close：点击标题栏按钮触发
    //   - isMaximized：初始渲染时查询当前状态
    //   - onMaximizeChange：订阅主进程推送的 maximize/unmaximize 事件，更新 isMaximized 状态
    contextBridge.exposeInMainWorld('windowApi', {
      minimize: () => ipcRenderer.invoke('window:minimize'),
      maximizeToggle: () => ipcRenderer.invoke('window:maximize-toggle'),
      close: () => ipcRenderer.invoke('window:close'),
      isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
      onMaximizeChange: (callback: (isMaximized: boolean) => void): (() => void) => {
        const handler = (_: unknown, isMaximized: boolean): void => callback(isMaximized)
        ipcRenderer.on('window:maximize-change', handler)
        return () => ipcRenderer.removeListener('window:maximize-change', handler)
      }
    })
    // Phase 9 批次2 模块2：agent API（轻 agent 核心 IPC 桥接）
    // 渲染进程通过此 API 调用主进程的 LocalAgentService：
    // - initialize：初始化 SessionManager（在 app 启动时主进程已自动调用，渲染进程可选调）
    // - sendMessage：发送消息到指定面板的 agent，事件通过 onEvent 推送
    // - disposeSession：销毁指定面板的 session
    // - onEvent：订阅 agent 事件（text_delta / tool_call / tool_result / turn_end / error）
    contextBridge.exposeInMainWorld('agentApi', {
      initialize: (): Promise<{ ok: boolean }> =>
        ipcRenderer.invoke('agent:initialize'),
      sendMessage: (payload: {
        panelId: string
        message: string
        thinkingLevel: string  // PiThinkingLevel 字符串字面量（minimal/low/medium/high）
      }): Promise<{ ok: boolean }> =>
        ipcRenderer.invoke('agent:send-message', payload),
      disposeSession: (panelId: string): Promise<{ ok: boolean }> =>
        ipcRenderer.invoke('agent:dispose-session', { panelId }),
      // Phase 9 批次 3 模块 6：动态切换指定面板 session 的思考等级
      // level 取值：'minimal' | 'low' | 'medium' | 'high'（与 useThinkingLevelStore 4 档对齐）
      setThinkingLevel: (panelId: string, level: string): Promise<{ ok: boolean }> =>
        ipcRenderer.invoke('agent:set-thinking-level', { panelId, level }),
      onEvent: (callback: (data: { panelId: string; event: unknown }) => void): (() => void) => {
        const handler = (_: unknown, data: { panelId: string; event: unknown }): void => callback(data)
        ipcRenderer.on('agent:event', handler)
        return () => ipcRenderer.removeListener('agent:event', handler)
      },
    })
  } catch (error) {
    console.error(error)
  }
} else {
  // M6 修复：contextIsolation 始终为 true（见 1.4 约束条件），else 分支仅作兜底，新增 API 仅在 contextIsolated 分支暴露
  // @ts-expect-error contextIsolation 始终为 true，else 分支仅作兜底
  window.electron = electronAPI
  // 注：contextIsolation: true 时此分支不执行，menuApi/cookieApi/contextMenuApi/webviewApi 仅在 contextIsolated 分支暴露
}
