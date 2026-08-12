// @vitest-environment node
/**
 * electron/main/index.ts IPC 测试 — Phase 11 P0
 *
 * 覆盖重点：
 * 1. app.whenReady 触发后调用 localAgentService.initialize
 * 2. app.whenReady 触发后调用 registerAgentIpc + initializeApiKeyStore
 * 3. createWindow 调用 BrowserWindow，且 webPreferences 安全设置正确
 *   （contextIsolation: true / nodeIntegration: false / preload 路径正确）
 * 4. window-all-closed 事件处理（非 darwin 时 app.quit）
 * 5. before-quit 事件触发 local-services:unregister 通知 + localAgentService.disposeAll
 * 6. ipcMain.handle 注册 sync-log / cookie / context-menu / thumbnail 等通道
 * 7. activate 事件且无窗口时调用 createWindow（BrowserWindow 再次被调用）
 *
 * Mock 策略：
 * - vi.mock('electron')：替换 app/BrowserWindow/ipcMain/Menu/Tray 等
 * - vi.mock('@electron-toolkit/utils')：替换 electronApp/optimizer
 * - vi.mock('../ipc/agentIpc')：替换 registerAgentIpc/initializeApiKeyStore/createToolExecutor
 * - vi.mock('../localAgent/LocalAgentService')：替换 localAgentService 单例
 * - vi.resetModules + 动态 import：每个测试重新执行 main 模块
 *
 * 关键：main 进程脚本是 top-level 副作用模块，import 时立即注册 ipcMain.handle
 *       和 app.whenReady().then(...)，需通过 mock 把回调推迟到测试代码主动触发
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'

// ============================================================================
// vi.hoisted：electron mock（工厂模式 + 回调存储便于测试主动触发）
// ============================================================================

const electronMock = vi.hoisted(() => {
  const whenReadyCallbacks: Array<() => void | Promise<void>> = []
  const eventHandlers: Record<string, Array<(...args: unknown[]) => void>> = {}
  const ipcHandlers: Record<string, (...args: unknown[]) => unknown> = {}
  // Phase 14 C4：ipcMain.on 通道处理器（同步 IPC，如 server:get-port-sync）
  const ipcOnHandlers: Record<string, (...args: unknown[]) => void> = {}

  // BrowserWindow 实例 mock
  // 注意：loadURL / loadFile 是 BrowserWindow 实例方法（不在 webContents 上）
  const winInstance = {
    on: vi.fn(),
    loadURL: vi.fn(),
    loadFile: vi.fn(),
    webContents: {
      on: vi.fn(),
      send: vi.fn(),
      openDevTools: vi.fn(),
      setWindowOpenHandler: vi.fn(),
      capturePage: vi.fn().mockResolvedValue({
        isEmpty: () => false,
        toDataURL: () => 'data:image/png;base64,mock',
      }),
    },
    show: vi.fn(),
    hide: vi.fn(),
    isVisible: vi.fn().mockReturnValue(true),
    isDestroyed: vi.fn().mockReturnValue(false),
    // Phase 13.1.1：自绘标题栏窗口控制方法（minimize/maximize/unmaximize/isMaximized/close）
    minimize: vi.fn(),
    maximize: vi.fn(),
    unmaximize: vi.fn(),
    isMaximized: vi.fn().mockReturnValue(false),
    close: vi.fn(),
  }

  // 注意：mockImplementation 必须用 function 关键字（不能用箭头函数），
  // 否则 `new BrowserWindow(...)` 会抛 "is not a constructor"
  const BrowserWindow = vi.fn(function (this: unknown, options: unknown) {
    ;(BrowserWindow as unknown as { _lastOptions: unknown })._lastOptions = options
    ;(BrowserWindow as unknown as { _lastInstance: unknown })._lastInstance = winInstance
    return winInstance
  })
  ;(BrowserWindow as unknown as { getAllWindows: () => unknown[] }).getAllWindows = vi.fn().mockReturnValue([])

  return {
    whenReadyCallbacks,
    eventHandlers,
    ipcHandlers,
    ipcOnHandlers,
    winInstance,

    app: {
      whenReady: vi.fn().mockImplementation(() => ({
        then: (cb: () => void | Promise<void>) => {
          whenReadyCallbacks.push(cb)
          return Promise.resolve()
        },
      })),
      on: vi.fn().mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
        if (!eventHandlers[event]) eventHandlers[event] = []
        eventHandlers[event].push(handler)
      }),
      quit: vi.fn(),
      getPath: vi.fn().mockReturnValue('/tmp/test-userdata'),
      setAppUserModelId: vi.fn(),
    },

    BrowserWindow,

    shell: {
      openExternal: vi.fn(),
    },

    Tray: vi.fn(function (this: unknown) {
      return {
        setToolTip: vi.fn(),
        on: vi.fn(),
        setContextMenu: vi.fn(),
      }
    }),

    Menu: {
      buildFromTemplate: vi.fn().mockImplementation((template: unknown) => ({
        template,
        popup: vi.fn(),
        on: vi.fn(),
      })),
      setApplicationMenu: vi.fn(),
    },

    nativeImage: {
      createFromPath: vi.fn().mockReturnValue({ isEmpty: () => true }),
      createEmpty: vi.fn().mockReturnValue({ isEmpty: () => true }),
    },

    ipcMain: {
      handle: vi.fn().mockImplementation((channel: string, handler: (...args: unknown[]) => unknown) => {
        ipcHandlers[channel] = handler
      }),
      // Phase 14 C4：ipcMain.on 用于同步 IPC 通道（server:get-port-sync）
      // 存储到独立 map 避免与 handle 通道冲突
      on: vi.fn().mockImplementation((channel: string, handler: (...args: unknown[]) => void) => {
        ipcOnHandlers[channel] = handler
      }),
      once: vi.fn(),
      removeAllListeners: vi.fn(),
      removeHandler: vi.fn(),
    },

    session: {
      defaultSession: {
        cookies: {
          get: vi.fn().mockResolvedValue([]),
          set: vi.fn().mockResolvedValue(undefined),
          remove: vi.fn().mockResolvedValue(undefined),
        },
      },
    },

    webContents: {
      fromId: vi.fn().mockReturnValue(null),
    },
  }
})

vi.mock('electron', () => electronMock)

// ============================================================================
// vi.mock：@electron-toolkit/utils
// ============================================================================

const toolkitMock = vi.hoisted(() => ({
  electronApp: { setAppUserModelId: vi.fn() },
  optimizer: { watchWindowShortcuts: vi.fn() },
}))

vi.mock('@electron-toolkit/utils', () => toolkitMock)

// ============================================================================
// vi.mock：./ipc/agentIpc + ./localAgent/LocalAgentService
// ============================================================================

const agentIpcMock = vi.hoisted(() => ({
  registerAgentIpc: vi.fn(),
  initializeApiKeyStore: vi.fn(),
  createToolExecutor: vi.fn().mockImplementation(() => ({ execute: vi.fn() })),
}))

vi.mock('../ipc/agentIpc', () => agentIpcMock)

const localAgentMock = vi.hoisted(() => ({
  localAgentService: {
    initialize: vi.fn().mockResolvedValue(undefined),
    setToolExecutor: vi.fn(),
    disposeAll: vi.fn(),
  },
}))

vi.mock('../localAgent/LocalAgentService', () => localAgentMock)

// ============================================================================
// vi.mock：./serverProcess（Phase 14 C3 — server 子进程管理）
// main/index.ts 在 whenReady 中 await startServer()，before-quit 中调用 stopServer()，
// ipcMain.on('server:get-port-sync') 中调用 getServerPort()
// ============================================================================

const serverProcessMock = vi.hoisted(() => ({
  startServer: vi.fn().mockResolvedValue(3456),
  stopServer: vi.fn(),
  getServerPort: vi.fn().mockReturnValue(3456),
}))

vi.mock('../serverProcess', () => serverProcessMock)

// ============================================================================
// 辅助：动态 import main 模块（每次重新执行 top-level 副作用）
// ============================================================================

async function loadMain(): Promise<void> {
  vi.resetModules()
  // 重新引用 vi.mock（resetModules 不会清空 vi.mock 缓存）
  vi.doMock('electron', () => electronMock)
  vi.doMock('@electron-toolkit/utils', () => toolkitMock)
  vi.doMock('../ipc/agentIpc', () => agentIpcMock)
  vi.doMock('../localAgent/LocalAgentService', () => localAgentMock)
  vi.doMock('../serverProcess', () => serverProcessMock)
  await import('../index')
}

/** 触发 app.whenReady().then() 注册的回调 */
async function triggerWhenReady(): Promise<void> {
  for (const cb of electronMock.whenReadyCallbacks) {
    await cb()
  }
}

/** 触发 app.on(event, handler) 注册的 handler（第一个匹配的） */
function triggerEvent(event: string, ...args: unknown[]): void {
  const handlers = electronMock.eventHandlers[event]
  if (!handlers || handlers.length === 0) {
    throw new Error(`No handler registered for event "${event}"`)
  }
  handlers[0](...args)
}

// ============================================================================
// 测试套件
// ============================================================================

describe('electron/main/index.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // 清空回调存储
    electronMock.whenReadyCallbacks.length = 0
    for (const k of Object.keys(electronMock.eventHandlers)) {
      delete electronMock.eventHandlers[k]
    }
    for (const k of Object.keys(electronMock.ipcHandlers)) {
      delete electronMock.ipcHandlers[k]
    }
    // Phase 14 C4：清空 ipcMain.on 处理器
    for (const k of Object.keys(electronMock.ipcOnHandlers)) {
      delete electronMock.ipcOnHandlers[k]
    }
    // 重置 platform 默认值（避免上一用例残留）
    Object.defineProperty(process, 'platform', {
      value: 'win32',
      configurable: true,
      writable: true,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.doUnmock('electron')
    vi.doUnmock('@electron-toolkit/utils')
    vi.doUnmock('../ipc/agentIpc')
    vi.doUnmock('../localAgent/LocalAgentService')
    vi.doUnmock('../serverProcess')
  })

  // --------------------------------------------------------------------------
  // 1. app.whenReady 触发后调用 localAgentService.initialize
  // --------------------------------------------------------------------------
  test('1. app.whenReady 触发后调用 localAgentService.initialize', async () => {
    await loadMain()
    await triggerWhenReady()

    expect(localAgentMock.localAgentService.initialize).toHaveBeenCalledTimes(1)
  })

  // --------------------------------------------------------------------------
  // 2. app.whenReady 触发后调用 registerAgentIpc + initializeApiKeyStore
  // --------------------------------------------------------------------------
  test('2. app.whenReady 触发后调用 registerAgentIpc 与 initializeApiKeyStore', async () => {
    await loadMain()
    await triggerWhenReady()

    expect(agentIpcMock.registerAgentIpc).toHaveBeenCalledTimes(1)
    expect(agentIpcMock.initializeApiKeyStore).toHaveBeenCalledTimes(1)
  })

  // --------------------------------------------------------------------------
  // 3. createWindow 创建 BrowserWindow 且 webPreferences 安全设置正确
  // --------------------------------------------------------------------------
  test('3. BrowserWindow 创建时 webPreferences 包含 contextIsolation=true / nodeIntegration=false / preload', async () => {
    await loadMain()
    await triggerWhenReady()

    expect(electronMock.BrowserWindow).toHaveBeenCalledTimes(1)
    const options = (electronMock.BrowserWindow as unknown as { _lastOptions: {
      webPreferences: {
        preload: string
        contextIsolation: boolean
        nodeIntegration: boolean
        sandbox: boolean
        webviewTag: boolean
      }
      width: number
      height: number
    } })._lastOptions
    expect(options).toBeDefined()
    expect(options.webPreferences.contextIsolation).toBe(true)
    expect(options.webPreferences.nodeIntegration).toBe(false)
    expect(options.webPreferences.preload).toMatch(/preload[\\/]index\.mjs$/)
    expect(options.webPreferences.webviewTag).toBe(true)
    expect(options.width).toBeGreaterThanOrEqual(1024)
    expect(options.height).toBeGreaterThanOrEqual(768)
  })

  // --------------------------------------------------------------------------
  // 4. window-all-closed 事件处理（非 darwin 时 app.quit）
  // --------------------------------------------------------------------------
  test('4. window-all-closed 在 win32 平台触发 app.quit', async () => {
    await loadMain()
    await triggerWhenReady()

    // tray 已在 createTray 后被赋值（mainWindow 存在），所以条件 !tray 为 false；
    // 但 process.platform=win32（非 darwin），所以应调用 app.quit
    expect(electronMock.app.quit).not.toHaveBeenCalled()
    triggerEvent('window-all-closed')
    expect(electronMock.app.quit).toHaveBeenCalledTimes(1)
  })

  // --------------------------------------------------------------------------
  // 4b. window-all-closed 在 darwin 平台不退出
  // --------------------------------------------------------------------------
  test('4b. window-all-closed 在 darwin 平台不触发 app.quit（tray 存在时）', async () => {
    Object.defineProperty(process, 'platform', {
      value: 'darwin',
      configurable: true,
      writable: true,
    })
    await loadMain()
    await triggerWhenReady()

    triggerEvent('window-all-closed')
    // tray 已创建（mainWindow 存在），darwin 平台不应退出
    expect(electronMock.app.quit).not.toHaveBeenCalled()
  })

  // --------------------------------------------------------------------------
  // 5. before-quit 事件：通知渲染进程 + localAgentService.disposeAll
  // --------------------------------------------------------------------------
  test('5. before-quit 事件触发 mainWindow.webContents.send + localAgentService.disposeAll', async () => {
    await loadMain()
    await triggerWhenReady()

    expect(electronMock.winInstance.webContents.send).not.toHaveBeenCalledWith(
      'local-services:unregister',
    )
    expect(localAgentMock.localAgentService.disposeAll).not.toHaveBeenCalled()

    triggerEvent('before-quit')

    expect(electronMock.winInstance.webContents.send).toHaveBeenCalledWith(
      'local-services:unregister',
    )
    expect(localAgentMock.localAgentService.disposeAll).toHaveBeenCalledTimes(1)
  })

  // --------------------------------------------------------------------------
  // 6. ipcMain.handle 注册 sync-log / cookie / context-menu / thumbnail 通道
  // --------------------------------------------------------------------------
  test('6. ipcMain.handle 注册 sync-log:append / sync-log:read / sync-log:rotate 等通道', async () => {
    await loadMain()

    expect(electronMock.ipcHandlers['sync-log:append']).toBeDefined()
    expect(electronMock.ipcHandlers['sync-log:read']).toBeDefined()
    expect(electronMock.ipcHandlers['sync-log:rotate']).toBeDefined()
    expect(electronMock.ipcHandlers['cookie:get']).toBeDefined()
    expect(electronMock.ipcHandlers['cookie:set']).toBeDefined()
    expect(electronMock.ipcHandlers['cookie:remove']).toBeDefined()
    expect(electronMock.ipcHandlers['context-menu:show']).toBeDefined()
    expect(electronMock.ipcHandlers['thumbnail:capture']).toBeDefined()
    expect(electronMock.ipcHandlers['app:getMemoryUsage']).toBeDefined()
    expect(electronMock.ipcHandlers['local-services:read-config']).toBeDefined()
  })

  // --------------------------------------------------------------------------
  // 7. activate 事件且无窗口时调用 createWindow（BrowserWindow 再次被调用）
  // --------------------------------------------------------------------------
  test('7. activate 事件且无窗口时调用 createWindow（BrowserWindow 再次被调用）', async () => {
    await loadMain()
    await triggerWhenReady()
    // 第一次 createWindow 在 whenReady 中调用
    expect(electronMock.BrowserWindow).toHaveBeenCalledTimes(1)

    // 模拟窗口已关闭（mainWindow = null）+ getAllWindows 返回空数组
    ;(electronMock.BrowserWindow as unknown as { getAllWindows: () => unknown[] }).getAllWindows = vi.fn().mockReturnValue([])

    triggerEvent('activate')

    expect(electronMock.BrowserWindow).toHaveBeenCalledTimes(2)
  })

  // --------------------------------------------------------------------------
  // 8. whenReady 后 createTray + createAppMenu 被调用（mainWindow 存在）
  // --------------------------------------------------------------------------
  test('8. whenReady 触发后创建 Tray 与应用菜单（mainWindow 存在）', async () => {
    await loadMain()
    await triggerWhenReady()

    expect(electronMock.Tray).toHaveBeenCalledTimes(1)
    expect(electronMock.Menu.setApplicationMenu).toHaveBeenCalledTimes(1)
    expect(electronMock.Menu.buildFromTemplate).toHaveBeenCalled()
  })

  // --------------------------------------------------------------------------
  // 9. localAgentService.setToolExecutor 在 createWindow 之后被调用
  // --------------------------------------------------------------------------
  test('9. whenReady 后调用 localAgentService.setToolExecutor（createToolExecutor 注入 mainWindow getter）', async () => {
    await loadMain()
    await triggerWhenReady()

    expect(localAgentMock.localAgentService.setToolExecutor).toHaveBeenCalledTimes(1)
    expect(agentIpcMock.createToolExecutor).toHaveBeenCalledTimes(1)
    // createToolExecutor 接收一个 getter 函数（返回 mainWindow）
    const getter = agentIpcMock.createToolExecutor.mock.calls[0][0] as () => unknown
    expect(typeof getter).toBe('function')
    // getter 调用应返回最后一次创建的 winInstance
    expect(getter()).toBe(electronMock.winInstance)
  })

  // --------------------------------------------------------------------------
  // 10. ipcMain.handle('cookie:get') 调用 session.defaultSession.cookies.get
  // --------------------------------------------------------------------------
  test('10. cookie:get handler 调用 session.defaultSession.cookies.get', async () => {
    await loadMain()

    const handler = electronMock.ipcHandlers['cookie:get']
    expect(handler).toBeDefined()
    await handler(undefined, 'https://example.com')
    expect(electronMock.session.defaultSession.cookies.get).toHaveBeenCalledWith({
      url: 'https://example.com',
    })
  })

  // --------------------------------------------------------------------------
  // 11. app:getMemoryUsage handler 返回 process.memoryUsage() 结果
  // --------------------------------------------------------------------------
  test('11. app:getMemoryUsage handler 返回 process.memoryUsage() 结构', async () => {
    await loadMain()

    const handler = electronMock.ipcHandlers['app:getMemoryUsage']
    expect(handler).toBeDefined()
    const result = handler() as NodeJS.MemoryUsage
    // 验证返回的是 memoryUsage 结构（不能直接 toEqual，因为两次调用数值会变）
    expect(typeof result.rss).toBe('number')
    expect(typeof result.heapTotal).toBe('number')
    expect(typeof result.heapUsed).toBe('number')
    expect(typeof result.external).toBe('number')
    expect(typeof result.arrayBuffers).toBe('number')
    expect(result.rss).toBeGreaterThan(0)
  })

  // --------------------------------------------------------------------------
  // 12. Phase 13.1.1：BrowserWindow 创建时配置 frame:false + titleBarOverlay（win32）
  // --------------------------------------------------------------------------
  test('12. BrowserWindow 配置 frame:false + titleBarOverlay（win32 平台）+ backgroundColor', async () => {
    Object.defineProperty(process, 'platform', {
      value: 'win32',
      configurable: true,
      writable: true,
    })
    await loadMain()
    await triggerWhenReady()

    const options = (electronMock.BrowserWindow as unknown as { _lastOptions: {
      frame: boolean
      titleBarStyle: unknown
      titleBarOverlay: { color: string; symbolColor: string; height: number } | undefined
      backgroundColor: string
    } })._lastOptions
    expect(options.frame).toBe(false)
    // win32 平台 titleBarStyle 为 undefined
    expect(options.titleBarStyle).toBeUndefined()
    // win32 平台启用 titleBarOverlay（兜底，防 React 未加载时无法关窗）
    expect(options.titleBarOverlay).toEqual({
      color: '#1e1e2e',
      symbolColor: '#cdd6f4',
      height: 36,
    })
    expect(options.backgroundColor).toBe('#1e1e2e')
  })

  // --------------------------------------------------------------------------
  // 12b. Phase 13.1.1：darwin 平台 titleBarStyle='hidden'，titleBarOverlay=undefined
  // --------------------------------------------------------------------------
  test('12b. darwin 平台 BrowserWindow 配置 titleBarStyle=hidden + titleBarOverlay=undefined', async () => {
    Object.defineProperty(process, 'platform', {
      value: 'darwin',
      configurable: true,
      writable: true,
    })
    await loadMain()
    await triggerWhenReady()

    const options = (electronMock.BrowserWindow as unknown as { _lastOptions: {
      frame: boolean
      titleBarStyle: string
      titleBarOverlay: unknown
    } })._lastOptions
    expect(options.frame).toBe(false)
    expect(options.titleBarStyle).toBe('hidden')
    expect(options.titleBarOverlay).toBeUndefined()
  })

  // --------------------------------------------------------------------------
  // 13. Phase 13.1.1：窗口控制 IPC handlers 注册并调用对应 mainWindow 方法
  // --------------------------------------------------------------------------
  test('13. window:minimize / window:maximize-toggle / window:close / window:is-maximized IPC handlers 注册', async () => {
    await loadMain()

    expect(electronMock.ipcHandlers['window:minimize']).toBeDefined()
    expect(electronMock.ipcHandlers['window:maximize-toggle']).toBeDefined()
    expect(electronMock.ipcHandlers['window:close']).toBeDefined()
    expect(electronMock.ipcHandlers['window:is-maximized']).toBeDefined()
  })

  // --------------------------------------------------------------------------
  // 13b. Phase 13.1.1：window:minimize handler 调用 mainWindow.minimize()
  // --------------------------------------------------------------------------
  test('13b. window:minimize handler 调用 mainWindow.minimize()', async () => {
    await loadMain()
    await triggerWhenReady() // mainWindow 在 whenReady 中创建

    const handler = electronMock.ipcHandlers['window:minimize']
    await handler()
    expect(electronMock.winInstance.minimize).toHaveBeenCalledTimes(1)
  })

  // --------------------------------------------------------------------------
  // 13c. Phase 13.1.1：window:maximize-toggle 在未最大化时调用 maximize()
  // --------------------------------------------------------------------------
  test('13c. window:maximize-toggle 在未最大化时调用 maximize()', async () => {
    await loadMain()
    await triggerWhenReady()

    electronMock.winInstance.isMaximized.mockReturnValue(false)
    const handler = electronMock.ipcHandlers['window:maximize-toggle']
    await handler()
    expect(electronMock.winInstance.maximize).toHaveBeenCalledTimes(1)
    expect(electronMock.winInstance.unmaximize).not.toHaveBeenCalled()
  })

  // --------------------------------------------------------------------------
  // 13d. Phase 13.1.1：window:maximize-toggle 在已最大化时调用 unmaximize()
  // --------------------------------------------------------------------------
  test('13d. window:maximize-toggle 在已最大化时调用 unmaximize()', async () => {
    await loadMain()
    await triggerWhenReady()

    electronMock.winInstance.isMaximized.mockReturnValue(true)
    const handler = electronMock.ipcHandlers['window:maximize-toggle']
    await handler()
    expect(electronMock.winInstance.unmaximize).toHaveBeenCalledTimes(1)
    expect(electronMock.winInstance.maximize).not.toHaveBeenCalled()
  })

  // --------------------------------------------------------------------------
  // 13e. Phase 13.1.1：window:close handler 调用 mainWindow.close()
  // --------------------------------------------------------------------------
  test('13e. window:close handler 调用 mainWindow.close()', async () => {
    await loadMain()
    await triggerWhenReady()

    const handler = electronMock.ipcHandlers['window:close']
    await handler()
    expect(electronMock.winInstance.close).toHaveBeenCalledTimes(1)
  })

  // --------------------------------------------------------------------------
  // 13f. Phase 13.1.1：window:is-maximized handler 返回 mainWindow.isMaximized() 结果
  // --------------------------------------------------------------------------
  test('13f. window:is-maximized handler 返回 mainWindow.isMaximized() 结果', async () => {
    await loadMain()
    await triggerWhenReady()

    electronMock.winInstance.isMaximized.mockReturnValue(true)
    const handler = electronMock.ipcHandlers['window:is-maximized']
    const result = await handler() as boolean
    expect(result).toBe(true)
    expect(electronMock.winInstance.isMaximized).toHaveBeenCalledTimes(1)
  })

  // --------------------------------------------------------------------------
  // 13g. Phase 13.1.1：mainWindow 'maximize' 事件触发 webContents.send('window:maximize-change', true)
  // --------------------------------------------------------------------------
  test('13g. mainWindow "maximize" 事件触发 webContents.send 通知渲染进程', async () => {
    await loadMain()
    await triggerWhenReady()

    // 找到 'maximize' 事件的 handler（在 createWindow 中注册）
    const calls = electronMock.winInstance.on.mock.calls as Array<[string, (...args: unknown[]) => void]>
    const maximizeCall = calls.find(c => c[0] === 'maximize')
    expect(maximizeCall).toBeDefined()
    maximizeCall?.[1]()
    expect(electronMock.winInstance.webContents.send).toHaveBeenCalledWith(
      'window:maximize-change',
      true,
    )
  })

  // --------------------------------------------------------------------------
  // 13h. Phase 13.1.1：mainWindow 'unmaximize' 事件触发 webContents.send('window:maximize-change', false)
  // --------------------------------------------------------------------------
  test('13h. mainWindow "unmaximize" 事件触发 webContents.send 通知渲染进程', async () => {
    await loadMain()
    await triggerWhenReady()

    const calls = electronMock.winInstance.on.mock.calls as Array<[string, (...args: unknown[]) => void]>
    const unmaximizeCall = calls.find(c => c[0] === 'unmaximize')
    expect(unmaximizeCall).toBeDefined()
    unmaximizeCall?.[1]()
    expect(electronMock.winInstance.webContents.send).toHaveBeenCalledWith(
      'window:maximize-change',
      false,
    )
  })
})
