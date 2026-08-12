// @vitest-environment node
/**
 * 主进程 ↔ 渲染进程 IPC 集成测试 — Phase 11.5.1
 *
 * 测试目标（任务 2.1，4+ 用例）：
 * - registerAgentIpc 注册全部 11 个 IPC 通道（与 preload 暴露的 API 数量一致）
 * - agent:set-api-key handler 正确转发到 apiKeyStore.setApiKey（参数透传）
 * - agent:get-api-key handler 正确转发到 apiKeyStore.getApiKey（返回值透传）
 * - agent:list-providers handler 正确转发到 apiKeyStore.listProviders
 * - tool:execute:result handler 通过 requestId 关联 pending Promise（超时兜底）
 *
 * Mock 策略（参考 electron/main/__tests__/index.test.ts）：
 * - vi.mock('electron')：替换 ipcMain.handle 捕获 handler 注册
 * - vi.mock('../apiKeyStore')：替换 apiKeyStore 单例
 * - vi.mock('../localAgent/LocalAgentService')：替换 localAgentService 单例
 *
 * 这是"集成测试"而非"单元测试"：
 * - 单元测试只验证 registerAgentIpc 调用了 ipcMain.handle 11 次
 * - 集成测试验证 handler 内部逻辑（handler → apiKeyStore/localAgentService 转发链）
 *
 * 设计依据：agentIpc.ts 的 11 个 ipcMain.handle 注册
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'

// ============================================================================
// vi.hoisted：electron mock + 共享状态
// ============================================================================

const electronMock = vi.hoisted(() => {
  const ipcHandlers: Record<string, (...args: unknown[]) => unknown> = {}
  return {
    ipcHandlers,
    app: {
      getPath: vi.fn().mockReturnValue('/tmp/test-userdata'),
    },
    ipcMain: {
      handle: vi.fn().mockImplementation((channel: string, handler: (...args: unknown[]) => unknown) => {
        ipcHandlers[channel] = handler
      }),
    },
    BrowserWindow: {
      fromWebContents: vi.fn().mockReturnValue(null),
    },
  }
})

vi.mock('electron', () => electronMock)

// ============================================================================
// vi.mock：fs（避免实际文件系统副作用，initializeApiKeyStore 会调 existsSync/mkdirSync）
// ============================================================================

const fsMock = vi.hoisted(() => ({
  existsSync: vi.fn().mockReturnValue(true),
  mkdirSync: vi.fn(),
}))

vi.mock('fs', () => fsMock)

// ============================================================================
// vi.mock：apiKeyStore + LocalAgentService
// ============================================================================

const apiKeyStoreMock = vi.hoisted(() => ({
  apiKeyStore: {
    setApiKey: vi.fn(),
    getApiKey: vi.fn().mockResolvedValue(null),
    setActiveProvider: vi.fn(),
    getActiveProvider: vi.fn().mockReturnValue(null),
    deleteApiKey: vi.fn(),
    listProviders: vi.fn().mockReturnValue([]),
    loadStore: vi.fn().mockReturnValue({ keys: {} }),
  },
}))

vi.mock('../apiKeyStore', () => apiKeyStoreMock)

const localAgentMock = vi.hoisted(() => ({
  localAgentService: {
    initialize: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    disposeSession: vi.fn(),
    setThinkingLevel: vi.fn().mockResolvedValue(undefined),
  },
  // 注意：AgentEvent / ToolExecuteRequest / ToolExecuteResponse 是类型，不需要 mock
}))

vi.mock('../localAgent/LocalAgentService', () => localAgentMock)

// ============================================================================
// 导入被测模块（mock 后）
// 注意：agentIpc.ts 位于 ../ipc/agentIpc（相对 __tests__ 目录）
// ============================================================================

import { registerAgentIpc, initializeApiKeyStore, createToolExecutor } from '../ipc/agentIpc'

// ============================================================================
// 测试套件
// ============================================================================

describe('agentIpc / 主进程 ↔ 渲染进程 IPC 集成', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // 清空 handlers
    for (const k of Object.keys(electronMock.ipcHandlers)) {
      delete electronMock.ipcHandlers[k]
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // --------------------------------------------------------------------------
  // 1. registerAgentIpc 注册全部 11 个 IPC 通道
  // --------------------------------------------------------------------------

  test('registerAgentIpc 注册 11 个 IPC 通道（与 preload 暴露的 API 对齐）', () => {
    registerAgentIpc()

    // 预期的 11 个通道（与 agentIpc.ts 实际注册一致）
    const expectedChannels = [
      'agent:set-api-key',
      'agent:get-api-key',
      'agent:set-active-provider',
      'agent:get-active-provider',
      'agent:delete-api-key',
      'agent:list-providers',
      'agent:initialize',
      'agent:send-message',
      'agent:dispose-session',
      'agent:set-thinking-level',
      'tool:execute:result',
    ]

    // 全部通道都应注册了 handler
    for (const channel of expectedChannels) {
      expect(electronMock.ipcHandlers[channel], `channel ${channel} should be registered`).toBeDefined()
    }

    // 总数应为 11
    expect(Object.keys(electronMock.ipcHandlers).length).toBe(11)
  })

  // --------------------------------------------------------------------------
  // 2. agent:set-api-key handler → apiKeyStore.setApiKey 转发链
  // --------------------------------------------------------------------------

  test('agent:set-api-key handler 转发到 apiKeyStore.setApiKey（参数透传）', async () => {
    registerAgentIpc()

    const handler = electronMock.ipcHandlers['agent:set-api-key']
    expect(handler).toBeDefined()

    // 模拟渲染进程通过 ipcRenderer.invoke('agent:set-api-key', payload) 调用
    // handler 签名：(event, payload) => result
    // Phase 13.2.3 B1：handler 会通过 event.sender.send 转发 'api-key:changed' 事件
    // 因此 event 需包含 sender mock（含 isDestroyed / send）
    const mockSender = {
      isDestroyed: vi.fn().mockReturnValue(false),
      send: vi.fn(),
    }
    const mockEvent = { sender: mockSender }

    const payload = {
      provider: 'deepseek',
      apiKey: 'sk-test-123',
      endpoint: 'https://api.deepseek.com',
      model: 'deepseek-chat',
    }
    const result = await handler(mockEvent as never, payload)

    // 验证 apiKeyStore.setApiKey 被调用，参数与 payload 一致
    expect(apiKeyStoreMock.apiKeyStore.setApiKey).toHaveBeenCalledTimes(1)
    expect(apiKeyStoreMock.apiKeyStore.setApiKey).toHaveBeenCalledWith(
      'deepseek',
      'sk-test-123',
      'https://api.deepseek.com',
      'deepseek-chat',
    )
    // Phase 13.2.3 B1：验证 'api-key:changed' 事件被转发到渲染进程
    // payload 不含明文 apiKey（安全考虑），只含 provider/endpoint/model
    expect(mockSender.isDestroyed).toHaveBeenCalledTimes(1)
    expect(mockSender.send).toHaveBeenCalledTimes(1)
    expect(mockSender.send).toHaveBeenCalledWith('api-key:changed', {
      provider: 'deepseek',
      endpoint: 'https://api.deepseek.com',
      model: 'deepseek-chat',
    })
    // 返回值应为 { ok: true }
    expect(result).toEqual({ ok: true })
  })

  test('agent:set-api-key handler 在 sender 已销毁时不抛错（安全兜底）', async () => {
    // Phase 13.2.3 B1：agent loop 期间窗口可能被关闭，sender 可能已 destroyed
    registerAgentIpc()
    const handler = electronMock.ipcHandlers['agent:set-api-key']

    const mockSender = {
      isDestroyed: vi.fn().mockReturnValue(true), // 模拟 sender 已销毁
      send: vi.fn(),
    }
    const mockEvent = { sender: mockSender }

    const payload = {
      provider: 'deepseek',
      apiKey: 'sk-test-123',
      endpoint: 'https://api.deepseek.com',
      model: 'deepseek-chat',
    }
    // 不应抛错（sender 已销毁时跳过 send，但仍返回 { ok: true }）
    const result = await handler(mockEvent as never, payload)
    expect(mockSender.send).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: true })
  })

  test('agent:set-api-key handler 对缺 provider 抛错（参数校验集成）', () => {
    registerAgentIpc()
    const handler = electronMock.ipcHandlers['agent:set-api-key']

    // 缺 provider（源码 handler 是同步函数，同步 throw Error）
    // 注：ipcMain.handle 在生产环境会捕获同步抛错并 reject Promise，
    //     但单元测试直接调用 handler，需用同步形式断言
    expect(() => handler({} as never, { provider: '', apiKey: 'k', endpoint: 'e', model: 'm' }))
      .toThrow('provider is required')
    // apiKeyStore.setApiKey 不应被调用
    expect(apiKeyStoreMock.apiKeyStore.setApiKey).not.toHaveBeenCalled()
  })

  // --------------------------------------------------------------------------
  // 3. agent:get-api-key handler → apiKeyStore.getApiKey 转发链
  // --------------------------------------------------------------------------

  test('agent:get-api-key handler 转发到 apiKeyStore.getApiKey（返回值透传）', async () => {
    registerAgentIpc()
    apiKeyStoreMock.apiKeyStore.getApiKey.mockReturnValue('sk-decrypted-key')

    const handler = electronMock.ipcHandlers['agent:get-api-key']
    const result = await handler({} as never, { provider: 'deepseek' })

    expect(apiKeyStoreMock.apiKeyStore.getApiKey).toHaveBeenCalledWith('deepseek')
    expect(result).toBe('sk-decrypted-key')
  })

  test('agent:get-api-key handler 对缺 provider 抛错', () => {
    registerAgentIpc()
    const handler = electronMock.ipcHandlers['agent:get-api-key']

    // 同步抛错（同 set-api-key handler）
    expect(() => handler({} as never, {})).toThrow('provider is required')
    expect(apiKeyStoreMock.apiKeyStore.getApiKey).not.toHaveBeenCalled()
  })

  // --------------------------------------------------------------------------
  // 4. agent:list-providers handler → apiKeyStore.listProviders 转发链
  // --------------------------------------------------------------------------

  test('agent:list-providers handler 转发到 apiKeyStore.listProviders（返回值透传）', async () => {
    registerAgentIpc()
    apiKeyStoreMock.apiKeyStore.listProviders.mockReturnValue(['deepseek', 'openai', 'anthropic'])

    const handler = electronMock.ipcHandlers['agent:list-providers']
    const result = await handler({} as never)

    expect(apiKeyStoreMock.apiKeyStore.listProviders).toHaveBeenCalledTimes(1)
    expect(result).toEqual(['deepseek', 'openai', 'anthropic'])
  })

  // --------------------------------------------------------------------------
  // 5. agent:set-active-provider / agent:get-active-provider / agent:delete-api-key
  // --------------------------------------------------------------------------

  test('agent:set-active-provider handler 转发到 apiKeyStore.setActiveProvider', async () => {
    registerAgentIpc()
    const handler = electronMock.ipcHandlers['agent:set-active-provider']

    const result = await handler({} as never, { provider: 'openai' })

    expect(apiKeyStoreMock.apiKeyStore.setActiveProvider).toHaveBeenCalledWith('openai')
    expect(result).toEqual({ ok: true })
  })

  test('agent:get-active-provider handler 转发到 apiKeyStore.getActiveProvider', async () => {
    registerAgentIpc()
    apiKeyStoreMock.apiKeyStore.getActiveProvider.mockReturnValue('openai')

    const handler = electronMock.ipcHandlers['agent:get-active-provider']
    const result = await handler({} as never)

    expect(apiKeyStoreMock.apiKeyStore.getActiveProvider).toHaveBeenCalledTimes(1)
    expect(result).toBe('openai')
  })

  test('agent:delete-api-key handler 转发到 apiKeyStore.deleteApiKey', async () => {
    registerAgentIpc()
    const handler = electronMock.ipcHandlers['agent:delete-api-key']

    const result = await handler({} as never, { provider: 'deepseek' })

    expect(apiKeyStoreMock.apiKeyStore.deleteApiKey).toHaveBeenCalledWith('deepseek')
    expect(result).toEqual({ ok: true })
  })

  // --------------------------------------------------------------------------
  // 6. agent:initialize / agent:dispose-session / agent:set-thinking-level
  // --------------------------------------------------------------------------

  test('agent:initialize handler 调用 localAgentService.initialize（返回 {ok:true}）', async () => {
    registerAgentIpc()
    const handler = electronMock.ipcHandlers['agent:initialize']

    const result = await handler({} as never)

    expect(localAgentMock.localAgentService.initialize).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ ok: true })
  })

  test('agent:dispose-session handler 转发到 localAgentService.disposeSession', async () => {
    registerAgentIpc()
    const handler = electronMock.ipcHandlers['agent:dispose-session']

    const result = await handler({} as never, { panelId: 'panel-1' })

    expect(localAgentMock.localAgentService.disposeSession).toHaveBeenCalledWith('panel-1')
    expect(result).toEqual({ ok: true })
  })

  test('agent:set-thinking-level handler 转发到 localAgentService.setThinkingLevel', async () => {
    registerAgentIpc()
    const handler = electronMock.ipcHandlers['agent:set-thinking-level']

    const result = await handler({} as never, { panelId: 'panel-1', level: 'high' })

    expect(localAgentMock.localAgentService.setThinkingLevel).toHaveBeenCalledWith('panel-1', 'high')
    expect(result).toEqual({ ok: true })
  })

  // --------------------------------------------------------------------------
  // 7. initializeApiKeyStore 集成（创建 userData 目录 + 加载 store）
  // --------------------------------------------------------------------------

  test('initializeApiKeyStore 调用 apiKeyStore.loadStore（不抛错即通过）', () => {
    // 实际行为：检查 userData 目录存在，然后 loadStore
    // 这里 mock 了 fs 和 apiKeyStore，仅验证调用链
    expect(() => initializeApiKeyStore()).not.toThrow()
    expect(apiKeyStoreMock.apiKeyStore.loadStore).toHaveBeenCalled()
  })

  // --------------------------------------------------------------------------
  // 8. tool:execute:result handler 通过 requestId 关联 pending Promise
  // --------------------------------------------------------------------------

  test('tool:execute:result handler 通过 requestId resolve pending Promise（createToolExecutor 集成）', async () => {
    registerAgentIpc()

    // 模拟渲染进程回传工具执行结果
    // 先用 createToolExecutor 创建一个 pending Promise
    // 注意：createToolExecutor 需要 BrowserWindow，这里 BrowserWindow.fromWebContents 返回 null
    // 所以 mock 一个 fake window
    const fakeWin = {
      isDestroyed: vi.fn().mockReturnValue(false),
      webContents: {
        send: vi.fn(),
      },
    }
    const toolExecutor = createToolExecutor(() => fakeWin as never)

    // 触发工具执行（会通过 webContents.send 发送 'tool:execute:request'）
    // 此时 pendingToolResults Map 中应该有一个 requestId 对应的 Promise
    const request = {
      requestId: 'tool-req-int-1',
      tool: 'storage_read',
      params: { key: 'foo' },
      panelId: 'panel-1',
    }
    const resultPromise = toolExecutor(request)

    // 验证 webContents.send 被调用（主进程 → 渲染进程方向）
    expect(fakeWin.webContents.send).toHaveBeenCalledWith('tool:execute:request', request)

    // 模拟渲染进程通过 'tool:execute:result' IPC 回传结果
    const toolResultHandler = electronMock.ipcHandlers['tool:execute:result']
    const response = {
      requestId: 'tool-req-int-1',
      success: true,
      data: { value: 'data-from-renderer' },
    }
    await toolResultHandler({} as never, response)

    // 验证 toolExecutor 的 Promise 被 resolve
    const result = await resultPromise
    expect(result.success).toBe(true)
    expect(result.data).toEqual({ value: 'data-from-renderer' })
    expect(result.requestId).toBe('tool-req-int-1')
  })

  test('tool:execute:result handler 对未知 requestId 安全 no-op（不抛错）', async () => {
    registerAgentIpc()
    const handler = electronMock.ipcHandlers['tool:execute:result']

    // 没有对应的 pending Promise，应安全返回 {ok:true}，不抛错
    const result = await handler({} as never, {
      requestId: 'unknown-req-id',
      success: true,
    })
    expect(result).toEqual({ ok: true })
  })
})
