/**
 * electron/preload/index 单元测试 — Phase 11 P1
 *
 * 覆盖重点：
 * 1. contextIsolated=true 时 contextBridge.exposeInMainWorld 被调用 14 次
 * 2. 暴露的 API 名称列表正确（14 个 API，含 Phase 13.1.1 windowApi）
 * 3. menuApi.onMenuAction 注册 ipcRenderer.on 并返回清理函数
 * 4. cookieApi.get 调用 ipcRenderer.invoke('cookie:get', url)
 * 5. aiKeyApi.setApiKey 调用 ipcRenderer.invoke('agent:set-api-key', payload)
 * 6. agentApi.sendMessage 调用 ipcRenderer.invoke('agent:send-message', payload)
 * 7. agentApi.onEvent 注册 ipcRenderer.on('agent:event') 并返回清理函数
 * 8. contextIsolated=false 时走 else 分支（window.electron = electronAPI）
 *
 * Mock 策略：
 * - vi.mock('electron')：替换 contextBridge + ipcRenderer
 * - vi.mock('@electron-toolkit/preload')：替换 electronAPI
 * - vi.resetModules + 动态 import：每个测试重新执行 preload 脚本
 * - Object.defineProperty(process, 'contextIsolated')：控制 contextIsolation 分支
 *
 * 注意：
 * - preload 是脚本模块，import 时立即执行，需在 mock 就绪后动态 import
 * - happy-dom 提供 window 对象，用于 else 分支测试
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'

// ============================================================================
// vi.mock：用 vi.hoisted 暴露 mock 对象，供测试断言
// ============================================================================
const electronMock = vi.hoisted(() => ({
  contextBridge: {
    exposeInMainWorld: vi.fn(),
  },
  ipcRenderer: {
    on: vi.fn(),
    invoke: vi.fn().mockResolvedValue(undefined),
    removeListener: vi.fn(),
    // Phase 14 C4：sendSync 用于同步获取 server 端口（preload 中同步调用）
    sendSync: vi.fn().mockReturnValue(3456),
  },
}))

const toolkitMock = vi.hoisted(() => ({
  electronAPI: {
    ipcRenderer: {},
    process: {},
  },
}))

vi.mock('electron', () => electronMock)
vi.mock('@electron-toolkit/preload', () => ({
  electronAPI: toolkitMock.electronAPI,
}))

// ============================================================================
// 测试辅助：加载 preload 模块并返回 exposeInMainWorld 调用映射
// ============================================================================
async function loadPreload(): Promise<Record<string, unknown>> {
  vi.resetModules()
  await import('../index')
  const calls = electronMock.contextBridge.exposeInMainWorld.mock.calls
  const apiMap: Record<string, unknown> = {}
  for (const [name, api] of calls) {
    apiMap[name as string] = api
  }
  return apiMap
}

// ============================================================================
// 测试套件
// ============================================================================
describe('electron/preload/index', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // 默认 invoke 返回 resolved Promise（源码期望 Promise 返回值）
    electronMock.ipcRenderer.invoke.mockResolvedValue(undefined)
    // 默认 contextIsolated=true（走 contextBridge 分支）
    Object.defineProperty(process, 'contextIsolated', {
      value: true,
      configurable: true,
      writable: true,
    })
    // 清理 window.electron（else 分支可能设置）
    // 注：happy-dom 环境下 window === globalThis，用 globalThis 规避 tsconfig.node.json 无 DOM lib 的 TS2304
    delete (globalThis as unknown as { electron?: unknown }).electron
    // 抑制源码 console.error（catch 分支）
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // --------------------------------------------------------------------------
  // 1. contextBridge.exposeInMainWorld 调用次数
  // --------------------------------------------------------------------------
  test('1. contextIsolated=true 时 contextBridge.exposeInMainWorld 被调用 15 次', async () => {
    await loadPreload()
    expect(electronMock.contextBridge.exposeInMainWorld).toHaveBeenCalledTimes(15)
  })

  // --------------------------------------------------------------------------
  // 2. 暴露的 API 名称列表
  // --------------------------------------------------------------------------
  test('2. 暴露 15 个 API，名称与 spec 一致（含 Phase 14 C4 serverPortApi + Phase 13.1.1 windowApi）', async () => {
    const apis = await loadPreload()
    const expectedNames = [
      'electron',
      'serverPortApi',
      'menuApi',
      'cookieApi',
      'contextMenuApi',
      'webviewApi',
      'shortcutApi',
      'syncLogApi',
      'memoryApi',
      'localServicesApi',
      'thumbnailApi',
      'aiKeyApi',
      'toolBridgeApi',
      'agentApi',
      'windowApi',
    ]
    for (const name of expectedNames) {
      expect(apis[name]).toBeDefined()
    }
    expect(Object.keys(apis).sort()).toEqual(expectedNames.sort())
  })

  // --------------------------------------------------------------------------
  // 3. menuApi.onMenuAction 注册监听并返回清理函数
  // --------------------------------------------------------------------------
  test('3. menuApi.onMenuAction 调用 ipcRenderer.on("menu:action") 并返回清理函数', async () => {
    const apis = await loadPreload()
    const menuApi = apis.menuApi as {
      onMenuAction: (callback: (action: string) => void) => () => void
    }

    const callback = vi.fn()
    const cleanup = menuApi.onMenuAction(callback)

    // 验证 ipcRenderer.on 被调用，channel='menu:action'
    expect(electronMock.ipcRenderer.on).toHaveBeenCalledWith('menu:action', expect.any(Function))
    // 验证返回清理函数
    expect(typeof cleanup).toBe('function')

    // 捕获注册的 handler
    const handler = electronMock.ipcRenderer.on.mock.calls.find(
      c => c[0] === 'menu:action',
    )?.[1] as ((event: unknown, action: string) => void) | undefined
    expect(handler).toBeDefined()

    // 验证 handler 触发回调
    handler?.(null, 'save')
    expect(callback).toHaveBeenCalledWith('save')

    // 验证 cleanup 调用 removeListener
    cleanup()
    expect(electronMock.ipcRenderer.removeListener).toHaveBeenCalledWith(
      'menu:action',
      handler,
    )
  })

  // --------------------------------------------------------------------------
  // 4. cookieApi.get 调用 ipcRenderer.invoke
  // --------------------------------------------------------------------------
  test('4. cookieApi.get 调用 ipcRenderer.invoke("cookie:get", url)', async () => {
    const apis = await loadPreload()
    const cookieApi = apis.cookieApi as {
      get: (url: string) => Promise<unknown>
    }

    electronMock.ipcRenderer.invoke.mockResolvedValue('cookie-value')
    const result = await cookieApi.get('https://example.com')

    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      'cookie:get',
      'https://example.com',
    )
    expect(result).toBe('cookie-value')
  })

  // --------------------------------------------------------------------------
  // 5. aiKeyApi.setApiKey 调用 ipcRenderer.invoke with correct payload
  // --------------------------------------------------------------------------
  test('5. aiKeyApi.setApiKey 调用 ipcRenderer.invoke("agent:set-api-key", payload)', async () => {
    const apis = await loadPreload()
    const aiKeyApi = apis.aiKeyApi as {
      setApiKey: (
        provider: string,
        apiKey: string,
        endpoint: string,
        model: string,
      ) => Promise<unknown>
    }

    await aiKeyApi.setApiKey('deepseek', 'sk-key', 'https://api.deepseek.com', 'deepseek-chat')

    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      'agent:set-api-key',
      {
        provider: 'deepseek',
        apiKey: 'sk-key',
        endpoint: 'https://api.deepseek.com',
        model: 'deepseek-chat',
      },
    )
  })

  // --------------------------------------------------------------------------
  // 6. agentApi.sendMessage 调用 ipcRenderer.invoke
  // --------------------------------------------------------------------------
  test('6. agentApi.sendMessage 调用 ipcRenderer.invoke("agent:send-message", payload)', async () => {
    const apis = await loadPreload()
    const agentApi = apis.agentApi as {
      sendMessage: (payload: {
        panelId: string
        message: string
        thinkingLevel: string
      }) => Promise<unknown>
    }

    const payload = {
      panelId: 'panel-1',
      message: 'hello agent',
      thinkingLevel: 'medium',
    }
    await agentApi.sendMessage(payload)

    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      'agent:send-message',
      payload,
    )
  })

  // --------------------------------------------------------------------------
  // 7. agentApi.onEvent 注册监听并返回清理函数
  // --------------------------------------------------------------------------
  test('7. agentApi.onEvent 注册 ipcRenderer.on("agent:event") 并返回清理函数', async () => {
    const apis = await loadPreload()
    const agentApi = apis.agentApi as {
      onEvent: (
        callback: (data: { panelId: string; event: unknown }) => void,
      ) => () => void
    }

    const callback = vi.fn()
    const cleanup = agentApi.onEvent(callback)

    // 验证 ipcRenderer.on 被调用，channel='agent:event'
    expect(electronMock.ipcRenderer.on).toHaveBeenCalledWith(
      'agent:event',
      expect.any(Function),
    )
    expect(typeof cleanup).toBe('function')

    // 捕获 handler
    const handler = electronMock.ipcRenderer.on.mock.calls.find(
      c => c[0] === 'agent:event',
    )?.[1] as ((event: unknown, data: { panelId: string; event: unknown }) => void) | undefined
    expect(handler).toBeDefined()

    // 验证 handler 触发回调
    const eventData = { panelId: 'panel-1', event: { type: 'text_delta' } }
    handler?.(null, eventData)
    expect(callback).toHaveBeenCalledWith(eventData)

    // 验证 cleanup
    cleanup()
    expect(electronMock.ipcRenderer.removeListener).toHaveBeenCalledWith(
      'agent:event',
      handler,
    )
  })

  // --------------------------------------------------------------------------
  // 8. contextIsolated=false 时走 else 分支
  // --------------------------------------------------------------------------
  test('8. contextIsolated=false 时走 else 分支，window.electron = electronAPI', async () => {
    // 切换到非 contextIsolation 模式
    Object.defineProperty(process, 'contextIsolated', {
      value: false,
      configurable: true,
      writable: true,
    })

    await loadPreload()

    // contextBridge.exposeInMainWorld 不应被调用
    expect(electronMock.contextBridge.exposeInMainWorld).not.toHaveBeenCalled()
    // window.electron 应被设置为 electronAPI
    // 注：happy-dom 环境下 window === globalThis，用 globalThis 规避 tsconfig.node.json 无 DOM lib 的 TS2304
    expect((globalThis as unknown as { electron: unknown }).electron).toBe(
      toolkitMock.electronAPI,
    )
  })

  // --------------------------------------------------------------------------
  // 9. contextMenuApi.show 调用 ipcRenderer.invoke
  // --------------------------------------------------------------------------
  test('9. contextMenuApi.show 调用 ipcRenderer.invoke("context-menu:show", items)', async () => {
    const apis = await loadPreload()
    const contextMenuApi = apis.contextMenuApi as {
      show: (items: Array<{ label: string; enabled?: boolean }>) => Promise<number>
    }

    const items = [{ label: 'Cut' }, { label: 'Copy' }]
    await contextMenuApi.show(items)

    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      'context-menu:show',
      items,
    )
  })

  // --------------------------------------------------------------------------
  // 10. toolBridgeApi.executeTool 调用 ipcRenderer.invoke
  // --------------------------------------------------------------------------
  test('10. toolBridgeApi.executeTool 调用 ipcRenderer.invoke("tool:execute", {tool, params})', async () => {
    const apis = await loadPreload()
    const toolBridgeApi = apis.toolBridgeApi as {
      executeTool: (tool: string, params: unknown) => Promise<unknown>
    }

    await toolBridgeApi.executeTool('search', { query: 'test' })

    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('tool:execute', {
      tool: 'search',
      params: { query: 'test' },
    })
  })

  // --------------------------------------------------------------------------
  // 11. syncLogApi 三个方法都调用 ipcRenderer.invoke
  // --------------------------------------------------------------------------
  test('11. syncLogApi.append/read/rotate 分别调用对应 IPC channel', async () => {
    const apis = await loadPreload()
    const syncLogApi = apis.syncLogApi as {
      append: (entry: unknown) => Promise<unknown>
      read: () => Promise<unknown>
      rotate: () => Promise<unknown>
    }

    const entry = { timestamp: 123, message: 'test' }
    await syncLogApi.append(entry)
    await syncLogApi.read()
    await syncLogApi.rotate()

    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('sync-log:append', entry)
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('sync-log:read')
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('sync-log:rotate')
  })

  // --------------------------------------------------------------------------
  // 12. memoryApi.getMemoryUsage 调用 ipcRenderer.invoke
  // --------------------------------------------------------------------------
  test('12. memoryApi.getMemoryUsage 调用 ipcRenderer.invoke("app:getMemoryUsage")', async () => {
    const apis = await loadPreload()
    const memoryApi = apis.memoryApi as {
      getMemoryUsage: () => Promise<unknown>
    }

    await memoryApi.getMemoryUsage()

    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('app:getMemoryUsage')
  })

  // --------------------------------------------------------------------------
  // 13. thumbnailApi.capture 调用 ipcRenderer.invoke
  // --------------------------------------------------------------------------
  test('13. thumbnailApi.capture 调用 ipcRenderer.invoke("thumbnail:capture", webContentsId)', async () => {
    const apis = await loadPreload()
    const thumbnailApi = apis.thumbnailApi as {
      capture: (webContentsId: number) => Promise<string | null>
    }

    await thumbnailApi.capture(12345)

    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      'thumbnail:capture',
      12345,
    )
  })

  // --------------------------------------------------------------------------
  // 14. aiKeyApi 完整接口签名验证
  // --------------------------------------------------------------------------
  test('14. aiKeyApi 暴露 6 个方法（setApiKey/getApiKey/setActiveProvider/getActiveProvider/deleteApiKey/listProviders）', async () => {
    const apis = await loadPreload()
    const aiKeyApi = apis.aiKeyApi as Record<string, (...args: unknown[]) => unknown>

    expect(typeof aiKeyApi.setApiKey).toBe('function')
    expect(typeof aiKeyApi.getApiKey).toBe('function')
    expect(typeof aiKeyApi.setActiveProvider).toBe('function')
    expect(typeof aiKeyApi.getActiveProvider).toBe('function')
    expect(typeof aiKeyApi.deleteApiKey).toBe('function')
    expect(typeof aiKeyApi.listProviders).toBe('function')

    // 验证每个方法的 IPC 调用
    await aiKeyApi.getApiKey('deepseek')
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('agent:get-api-key', {
      provider: 'deepseek',
    })

    await aiKeyApi.setActiveProvider('openai')
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      'agent:set-active-provider',
      { provider: 'openai' },
    )

    await aiKeyApi.getActiveProvider()
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('agent:get-active-provider')

    await aiKeyApi.deleteApiKey('anthropic')
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('agent:delete-api-key', {
      provider: 'anthropic',
    })

    await aiKeyApi.listProviders()
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('agent:list-providers')
  })

  // --------------------------------------------------------------------------
  // 15. agentApi 完整接口签名验证
  // --------------------------------------------------------------------------
  test('15. agentApi 暴露 initialize/sendMessage/disposeSession/setThinkingLevel/onEvent', async () => {
    const apis = await loadPreload()
    const agentApi = apis.agentApi as Record<string, (...args: unknown[]) => unknown>

    expect(typeof agentApi.initialize).toBe('function')
    expect(typeof agentApi.sendMessage).toBe('function')
    expect(typeof agentApi.disposeSession).toBe('function')
    expect(typeof agentApi.setThinkingLevel).toBe('function')
    expect(typeof agentApi.onEvent).toBe('function')

    await agentApi.initialize()
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('agent:initialize')

    await agentApi.disposeSession('panel-1')
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      'agent:dispose-session',
      { panelId: 'panel-1' },
    )

    await agentApi.setThinkingLevel('panel-1', 'high')
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      'agent:set-thinking-level',
      { panelId: 'panel-1', level: 'high' },
    )
  })

  // --------------------------------------------------------------------------
  // 16. windowApi 完整接口签名验证（Phase 13.1.1 自绘标题栏）
  // --------------------------------------------------------------------------
  test('16. windowApi 暴露 minimize/maximizeToggle/close/isMaximized/onMaximizeChange', async () => {
    const apis = await loadPreload()
    const windowApi = apis.windowApi as Record<string, (...args: unknown[]) => unknown>

    expect(typeof windowApi.minimize).toBe('function')
    expect(typeof windowApi.maximizeToggle).toBe('function')
    expect(typeof windowApi.close).toBe('function')
    expect(typeof windowApi.isMaximized).toBe('function')
    expect(typeof windowApi.onMaximizeChange).toBe('function')

    await windowApi.minimize()
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('window:minimize')

    await windowApi.maximizeToggle()
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('window:maximize-toggle')

    await windowApi.close()
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('window:close')

    electronMock.ipcRenderer.invoke.mockResolvedValue(true)
    await windowApi.isMaximized()
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('window:is-maximized')

    // onMaximizeChange 注册 ipcRenderer.on('window:maximize-change') 并返回清理函数
    const cb = vi.fn()
    const cleanup = windowApi.onMaximizeChange(cb) as () => void
    expect(electronMock.ipcRenderer.on).toHaveBeenCalledWith(
      'window:maximize-change',
      expect.any(Function),
    )
    expect(typeof cleanup).toBe('function')

    // 捕获 handler 并验证回调触发
    const handler = electronMock.ipcRenderer.on.mock.calls.find(
      c => c[0] === 'window:maximize-change',
    )?.[1] as ((event: unknown, isMaximized: boolean) => void) | undefined
    expect(handler).toBeDefined()
    handler?.(null, true)
    expect(cb).toHaveBeenCalledWith(true)

    // 验证 cleanup 调用 removeListener
    cleanup()
    expect(electronMock.ipcRenderer.removeListener).toHaveBeenCalledWith(
      'window:maximize-change',
      handler,
    )
  })
})
