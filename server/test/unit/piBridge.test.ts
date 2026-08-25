/**
 * Phase S8.2：piBridge 单元测试
 *
 * 覆盖范围（spec 第四章 S8.2）：
 * - 纯函数测试：formatErrorMessage / isSessionReady / getPanelSessionId / setPanelActiveDevice
 *               cleanupDeviceFromOtherPanels / handlePermissionResponse / handleAskUserResponse
 * - Mock 测试：executeWithPermission / executeAskUser / executeViaWs / forwardEventToClient
 *             getEnabledCustomTools / disposePanelSession / disposePiBridge
 *             onClientMessage 5 种消息分发 / onClientDisconnect / setActiveDevice
 *             getOrCreatePanelSession 7 天超时清理
 * - AsyncLocalStorage 测试：withPanelContext / withCallerWidgetContext / 并发不污染
 * - 超时测试：vi.useFakeTimers() + vi.advanceTimersByTime()
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest'

// ============================================================================
// vi.mock：拦截 piBridge 的重依赖（hoisted，在 import 之前执行）
// ============================================================================

vi.mock('@earendil-works/pi-coding-agent', () => ({
  AuthStorage: class {
    static create() { return { setRuntimeApiKey: vi.fn() } }
  },
  createAgentSession: vi.fn(),
  DefaultResourceLoader: class {
    reload = vi.fn()
    getExtensions = vi.fn(() => ({ runtime: { pendingProviderRegistrations: [] } }))
  },
  getAgentDir: vi.fn(() => '/tmp/test-agent-dir'),
  ModelRegistry: class {
    static create() { return { find: vi.fn(() => ({})), registerProvider: vi.fn() } }
  },
  SessionManager: class {
    static inMemory = vi.fn(() => ({}))
  },
}))

vi.mock('@earendil-works/pi-ai', () => ({}))

vi.mock('typebox', () => ({
  Type: new Proxy({}, {
    get: () => () => ({}),
  }),
}))

vi.mock('../../src/ws.js', () => ({
  onClientMessage: vi.fn(),
  onClientConnect: vi.fn(),
  onClientDisconnect: vi.fn(),
  onErrorReport: vi.fn(),
  sendToClient: vi.fn(),
  sendToDevice: vi.fn().mockReturnValue(true),
  sendToolCall: vi.fn().mockReturnValue(true),
  broadcast: vi.fn(),
  hasClient: vi.fn().mockReturnValue(true),
  hasDevice: vi.fn().mockReturnValue(true),
  isGuestDevice: vi.fn().mockReturnValue(false),
  getGuestDeviceId: vi.fn().mockReturnValue(undefined),
}))

vi.mock('../../src/db/aiContext.js', () => ({
  persistConversation: vi.fn(),
  restoreSessionContext: vi.fn(),
  persistPiEvent: vi.fn(),
}))

vi.mock('../../src/db/aiSettingsStore.js', () => ({
  getAiSettings: vi.fn().mockResolvedValue({}),
  getPromptOverrides: vi.fn().mockResolvedValue({}),
  clearPromptCache: vi.fn(),
  DEFAULT_PROMPTS: {},
  getSearchKey: vi.fn(),
}))

vi.mock('../../src/db/connection.js', () => ({
  getPool: vi.fn(),
}))

vi.mock('../../src/utils/aiTools.js', () => {
  const map = new Map<string, { canDisable: boolean; defaultEnabled: boolean }>()
  return {
    AI_TOOL_MAP: map,
    DISABLEABLE_TOOL_NAMES: new Set<string>(),
    isValidToolName: (name: string) => map.has(name),
  }
})

vi.mock('../../src/utils/searchTools.js', () => ({
  searchTools: [],
  withSearchUser: <T>(_scope: string, fn: () => Promise<T>) => fn(),
  getSearchUserKey: () => null,
}))

vi.mock('../../src/utils/capabilityTools.js', () => ({
  queryCapabilitiesTool: {},
}))

vi.mock('../../src/utils/fileSystemTools.js', () => ({
  fileSystemTools: [],
}))

vi.mock('../../src/sandbox/index.js', () => ({
  initSandbox: vi.fn(),
}))

vi.mock('../../src/routes/background.js', () => ({
  BACKGROUNDS_DIR: '/tmp/test-backgrounds',
  default: { get: vi.fn(), post: vi.fn() },
}))

// ============================================================================
// 动态 import（在 mock 生效后）
// ============================================================================

const piBridge = await import('../../src/piBridge.js')
const {
  __test,
  setPanelActiveDevice,
  executeWithPermission,
  handlePermissionResponse,
  handleUserMessage,
  isSessionReady,
  getPanelSessionId,
  getSessionId,
  disposePanelSession,
  disposePiBridge,
  setActiveDevice,
  initPiBridge,
} = piBridge

const wsMod = await import('../../src/ws.js')
const wsSendToDevice = wsMod.sendToDevice as unknown as ReturnType<typeof vi.fn>
const wsSendToolCall = wsMod.sendToolCall as unknown as ReturnType<typeof vi.fn>
const wsBroadcast = wsMod.broadcast as unknown as ReturnType<typeof vi.fn>
const wsHasClient = wsMod.hasClient as unknown as ReturnType<typeof vi.fn>
const wsHasDevice = wsMod.hasDevice as unknown as ReturnType<typeof vi.fn>
const wsOnClientMessage = wsMod.onClientMessage as unknown as ReturnType<typeof vi.fn>
const wsOnClientDisconnect = wsMod.onClientDisconnect as unknown as ReturnType<typeof vi.fn>
const wsOnClientConnect = wsMod.onClientConnect as unknown as ReturnType<typeof vi.fn>
const wsOnErrorReport = wsMod.onErrorReport as unknown as ReturnType<typeof vi.fn>
const wsIsGuestDevice = wsMod.isGuestDevice as unknown as ReturnType<typeof vi.fn>
const wsGetGuestDeviceId = wsMod.getGuestDeviceId as unknown as ReturnType<typeof vi.fn>

const aiContextMod = await import('../../src/db/aiContext.js')
const persistConversationMock = aiContextMod.persistConversation as unknown as ReturnType<typeof vi.fn>
const persistPiEventMock = aiContextMod.persistPiEvent as unknown as ReturnType<typeof vi.fn>
const restoreSessionContextMock = aiContextMod.restoreSessionContext as unknown as ReturnType<typeof vi.fn>

const connMod = await import('../../src/db/connection.js')
const getPoolMock = connMod.getPool as unknown as ReturnType<typeof vi.fn>

const aiToolsMod = await import('../../src/utils/aiTools.js')
const mockAiToolMap = aiToolsMod.AI_TOOL_MAP as Map<string, { canDisable: boolean; defaultEnabled: boolean }>

const piAgentMod = await import('@earendil-works/pi-coding-agent')
const createAgentSessionMock = piAgentMod.createAgentSession as unknown as ReturnType<typeof vi.fn>

// ============================================================================
// 测试常量
// ============================================================================

const TEST_PANEL = 'test-panel-1'
const TEST_DEVICE = 'test-device-1'
const TEST_DEVICE_2 = 'test-device-2'

// ============================================================================
// Helper：创建 fake session（用于 getOrCreatePanelSession/handleUserMessage 测试）
// ============================================================================

function makeFakeSession(sessionId = 'fake-session-id'): any {
  return {
    sessionId,
    prompt: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn(),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
  }
}

// 默认让 createAgentSession 返回一个可用的 session（覆盖 createSession 成功路径）
createAgentSessionMock.mockResolvedValue({ session: makeFakeSession('mock-created-session') })

// ============================================================================
// 测试套件
// ============================================================================

describe('piBridge 纯函数测试', () => {
  beforeEach(() => {
    __test.__resetInternalState()
    wsSendToDevice.mockClear()
    wsSendToDevice.mockReturnValue(true)
  })

  describe('formatErrorMessage', () => {
    it('1. 格式化含 stack 的 widget 错误', () => {
      const report = {
        widgetId: 'w1',
        message: 'ReferenceError: foo is not defined',
        stack: 'at eval (widget:1:1)',
        source: 'iframe',
      }
      const result = __test.formatErrorMessage(report)
      expect(result).toContain('widgetId: w1')
      expect(result).toContain('ReferenceError: foo is not defined')
      expect(result).toContain('iframe')
      expect(result).toContain('堆栈')
      expect(result).toContain('at eval (widget:1:1)')
      expect(result).toContain('请检查并修复')
    })

    it('2. 格式化不含 stack 的 widget 错误', () => {
      const report = {
        widgetId: 'w2',
        message: 'SyntaxError',
        source: 'iframe',
      }
      const result = __test.formatErrorMessage(report)
      expect(result).toContain('widgetId: w2')
      expect(result).toContain('SyntaxError')
      expect(result).not.toContain('堆栈')
    })

    it('3. 格式化含 panelId 的 widget 错误', () => {
      const report = {
        widgetId: 'w3',
        panelId: 'panel-xyz',
        message: 'TypeError',
        source: 'iframe',
      }
      const result = __test.formatErrorMessage(report)
      expect(result).toContain('widgetId: w3')
      expect(result).toContain('TypeError')
    })
  })

  describe('isSessionReady', () => {
    it('4. 初始状态 isSessionReady 返回 false', () => {
      expect(isSessionReady()).toBe(false)
    })

    it('5. set session ready 后 isSessionReady 返回 true', () => {
      __test.__panelSessionReady.add(TEST_PANEL)
      expect(isSessionReady()).toBe(true)
    })
  })

  describe('getPanelSessionId', () => {
    it('6. 未创建 session 时返回 undefined', () => {
      expect(getPanelSessionId(TEST_PANEL)).toBeUndefined()
    })

    it('7. 创建 session 后返回 sessionId', () => {
      const fakeSession = makeFakeSession('sid-123')
      __test.__panelSessions.set(TEST_PANEL, fakeSession)
      expect(getPanelSessionId(TEST_PANEL)).toBe('sid-123')
    })
  })

  describe('setPanelActiveDevice', () => {
    it('8. 设置后 panelActiveDevices 更新', () => {
      setPanelActiveDevice(TEST_PANEL, TEST_DEVICE)
      expect(__test.__panelActiveDevices.get(TEST_PANEL)).toBe(TEST_DEVICE)
    })
  })

  describe('cleanupDeviceFromOtherPanels', () => {
    it('9. 设备切面板时清理旧面板的 activeDevice 映射', () => {
      // 设备在 panel-A 是活跃设备
      __test.__panelActiveDevices.set('panel-A', TEST_DEVICE)
      // 设备切到 panel-B
      __test.cleanupDeviceFromOtherPanels(TEST_DEVICE, 'panel-B')
      expect(__test.__panelActiveDevices.has('panel-A')).toBe(false)
      // panel-B 不受影响（没设置过）
      expect(__test.__panelActiveDevices.get('panel-B')).toBeUndefined()
    })

    it('10. 设备切面板时从旧面板的 onlineDevices 移除', () => {
      // 设备在 panel-A 的在线集合中
      __test.__panelOnlineDevices.set('panel-A', new Set([TEST_DEVICE, TEST_DEVICE_2]))
      // 设备切到 panel-B
      __test.cleanupDeviceFromOtherPanels(TEST_DEVICE, 'panel-B')
      const onlineSet = __test.__panelOnlineDevices.get('panel-A')
      expect(onlineSet?.has(TEST_DEVICE)).toBe(false)
      expect(onlineSet?.has(TEST_DEVICE_2)).toBe(true) // 其他设备不受影响
    })

    it('11. session-only 面板也会被清理', () => {
      __test.__panelOnlineDevices.set('session-only:xyz', new Set([TEST_DEVICE]))
      __test.cleanupDeviceFromOtherPanels(TEST_DEVICE, TEST_PANEL)
      // session-only 面板的在线集合应该被清理（空集合被删除）
      expect(__test.__panelOnlineDevices.has('session-only:xyz')).toBe(false)
    })

    it('12. 当前面板不受影响', () => {
      __test.__panelActiveDevices.set(TEST_PANEL, TEST_DEVICE)
      __test.__panelOnlineDevices.set(TEST_PANEL, new Set([TEST_DEVICE]))
      __test.cleanupDeviceFromOtherPanels(TEST_DEVICE, TEST_PANEL)
      expect(__test.__panelActiveDevices.get(TEST_PANEL)).toBe(TEST_DEVICE)
      expect(__test.__panelOnlineDevices.get(TEST_PANEL)?.has(TEST_DEVICE)).toBe(true)
    })
  })

  describe('handlePermissionResponse', () => {
    beforeEach(() => {
      setPanelActiveDevice(TEST_PANEL, TEST_DEVICE)
    })

    it('13. approved=true resolve pending', async () => {
      const promise = executeWithPermission(TEST_PANEL, {
        toolName: 'storage_write',
        description: 'd',
        permission: 'write',
        arguments: {},
      })
      const msg = wsSendToDevice.mock.calls[0][1] as { requestId: string }
      handlePermissionResponse({ requestId: msg.requestId, approved: true })
      await expect(promise).resolves.toEqual({ approved: true })
    })

    it('14. approved=false resolve pending', async () => {
      const promise = executeWithPermission(TEST_PANEL, {
        toolName: 'storage_write',
        description: 'd',
        permission: 'write',
        arguments: {},
      })
      const msg = wsSendToDevice.mock.calls[0][1] as { requestId: string }
      handlePermissionResponse({ requestId: msg.requestId, approved: false })
      await expect(promise).resolves.toEqual({ approved: false })
    })

    it('15. 未知 requestId 是 no-op（不抛错）', () => {
      expect(() => handlePermissionResponse({ requestId: 'unknown', approved: true })).not.toThrow()
    })
  })

  describe('handleAskUserResponse', () => {
    it('16. resolve selectedValues', async () => {
      // 先创建一个 ask_user pending
      setPanelActiveDevice(TEST_PANEL, TEST_DEVICE)
      const promise = __test.executeAskUser(TEST_PANEL, '选择?', [
        { label: 'A', value: 'a' },
        { label: 'B', value: 'b' },
      ], false)
      const msg = wsSendToDevice.mock.calls[0][1] as { requestId: string }
      __test.handleAskUserResponse({ requestId: msg.requestId, selectedValues: ['a'] })
      await expect(promise).resolves.toEqual(['a'])
    })

    it('17. 未知 requestId 是 no-op', () => {
      expect(() => __test.handleAskUserResponse({ requestId: 'unknown', selectedValues: [] })).not.toThrow()
    })
  })
})

// ============================================================================
// AsyncLocalStorage 测试
// ============================================================================

describe('piBridge AsyncLocalStorage 测试', () => {
  beforeEach(() => {
    __test.__resetInternalState()
  })

  it('18. withPanelContext 内 getCurrentPanelId 返回 panelId', async () => {
    let captured: string | null = null
    await __test.withPanelContext(TEST_PANEL, async () => {
      captured = __test.getCurrentPanelId()
    })
    expect(captured).toBe(TEST_PANEL)
  })

  it('19. withPanelContext 外 getCurrentPanelId 返回 null', () => {
    expect(__test.getCurrentPanelId()).toBeNull()
  })

  it('20. withCallerWidgetContext 内 getCurrentCallerWidgetId 返回 widgetId', async () => {
    let captured: string | undefined
    await __test.withCallerWidgetContext('widget-1', async () => {
      captured = __test.getCurrentCallerWidgetId()
    })
    expect(captured).toBe('widget-1')
  })

  it('21. withCallerWidgetContext 传 undefined 不进入 storage 上下文', async () => {
    let captured: string | undefined = 'sentinel'
    await __test.withCallerWidgetContext(undefined, async () => {
      captured = __test.getCurrentCallerWidgetId()
    })
    expect(captured).toBeUndefined()
  })

  it('22. withCallerWidgetContext 传 null 不进入 storage 上下文', async () => {
    let captured: string | undefined = 'sentinel'
    await __test.withCallerWidgetContext(null, async () => {
      captured = __test.getCurrentCallerWidgetId()
    })
    expect(captured).toBeUndefined()
  })

  it('23. 两个 withPanelContext 并发不污染', async () => {
    let capturedA: string | null = null
    let capturedB: string | null = null

    // 模拟并发：A 先进入上下文，B 进入前 A 不读取
    await Promise.all([
      __test.withPanelContext('panel-A', async () => {
        // 让出控制权让 B 进入
        await new Promise(r => setTimeout(r, 5))
        capturedA = __test.getCurrentPanelId()
      }),
      __test.withPanelContext('panel-B', async () => {
        await new Promise(r => setTimeout(r, 1))
        capturedB = __test.getCurrentPanelId()
      }),
    ])

    expect(capturedA).toBe('panel-A')
    expect(capturedB).toBe('panel-B')
  })

  it('24. 嵌套 withPanelContext 内层覆盖外层', async () => {
    let outer: string | null = null
    let inner: string | null = null
    await __test.withPanelContext('outer-panel', async () => {
      outer = __test.getCurrentPanelId()
      await __test.withPanelContext('inner-panel', async () => {
        inner = __test.getCurrentPanelId()
      })
    })
    expect(outer).toBe('outer-panel')
    expect(inner).toBe('inner-panel')
  })
})

// ============================================================================
// executeWithPermission 测试
// ============================================================================

describe('piBridge executeWithPermission 测试', () => {
  beforeEach(() => {
    __test.__resetInternalState()
    wsSendToDevice.mockClear()
    wsSendToDevice.mockReturnValue(true)
    setPanelActiveDevice(TEST_PANEL, TEST_DEVICE)
  })

  it('25. 发送 permission_request 到面板活跃设备', async () => {
    const promise = executeWithPermission(TEST_PANEL, {
      toolName: 'storage_write',
      description: '写入存储',
      permission: 'write',
      arguments: { key: 'foo' },
    })
    expect(wsSendToDevice).toHaveBeenCalledTimes(1)
    const [deviceId, msg] = wsSendToDevice.mock.calls[0]
    expect(deviceId).toBe(TEST_DEVICE)
    expect(msg.kind).toBe('permission_request')
    expect(msg.panelId).toBe(TEST_PANEL)
    expect(msg.toolName).toBe('storage_write')
    expect(msg.requestId.startsWith('perm-')).toBe(true)
    handlePermissionResponse({ requestId: msg.requestId, approved: true })
    await promise
  })

  it('26. 超时 reject（fake timers 推进 120s）', async () => {
    vi.useFakeTimers()
    try {
      const promise = executeWithPermission(TEST_PANEL, {
        toolName: 't',
        description: 'd',
        permission: 'write',
        arguments: {},
      })
      vi.advanceTimersByTime(120_000)
      await expect(promise).rejects.toThrow(/permission timeout/)
    } finally {
      vi.useRealTimers()
    }
  })

  it('27. 无活跃设备时 throw', async () => {
    await expect(
      executeWithPermission('no-such-panel', {
        toolName: 't',
        description: 'd',
        permission: 'write',
        arguments: {},
      }),
    ).rejects.toThrow(/no active device for panel no-such-panel/)
    expect(wsSendToDevice).not.toHaveBeenCalled()
  })

  it('28. sendToDevice 返回 false 时 reject', async () => {
    wsSendToDevice.mockReturnValueOnce(false)
    await expect(
      executeWithPermission(TEST_PANEL, {
        toolName: 't',
        description: 'd',
        permission: 'write',
        arguments: {},
      }),
    ).rejects.toThrow(/failed to send permission_request/)
  })

  it('29. 透传 irreversible 字段', async () => {
    const promise = executeWithPermission(TEST_PANEL, {
      toolName: 'delete_html_widget',
      description: '删除组件',
      permission: 'dangerous',
      irreversible: true,
      arguments: { id: 'w1' },
    })
    const msg = wsSendToDevice.mock.calls[0][1]
    expect(msg.irreversible).toBe(true)
    expect(msg.permission).toBe('dangerous')
    handlePermissionResponse({ requestId: msg.requestId, approved: true })
    await promise
  })
})

// ============================================================================
// executeAskUser 测试
// ============================================================================

describe('piBridge executeAskUser 测试', () => {
  beforeEach(() => {
    __test.__resetInternalState()
    wsSendToDevice.mockClear()
    wsSendToDevice.mockReturnValue(true)
    setPanelActiveDevice(TEST_PANEL, TEST_DEVICE)
  })

  it('30. 发送 ask_user 到面板活跃设备', async () => {
    const promise = __test.executeAskUser(TEST_PANEL, '选择?', [
      { label: 'A', value: 'a' },
      { label: 'B', value: 'b' },
    ], false)
    expect(wsSendToDevice).toHaveBeenCalledTimes(1)
    const [deviceId, msg] = wsSendToDevice.mock.calls[0]
    expect(deviceId).toBe(TEST_DEVICE)
    expect(msg.kind).toBe('ask_user')
    expect(msg.panelId).toBe(TEST_PANEL)
    expect(msg.question).toBe('选择?')
    expect(msg.options).toHaveLength(2)
    expect(msg.allowMultiple).toBe(false)

    __test.handleAskUserResponse({ requestId: msg.requestId, selectedValues: ['a'] })
    await expect(promise).resolves.toEqual(['a'])
  })

  it('31. 超时 reject（fake timers 推进 120s）', async () => {
    vi.useFakeTimers()
    try {
      const promise = __test.executeAskUser(TEST_PANEL, 'q?', [
        { label: 'A', value: 'a' },
        { label: 'B', value: 'b' },
      ], false)
      vi.advanceTimersByTime(120_000)
      await expect(promise).rejects.toThrow(/ask_user timeout/)
    } finally {
      vi.useRealTimers()
    }
  })

  it('32. 无活跃设备时 reject', async () => {
    await expect(
      __test.executeAskUser('no-such-panel', 'q?', [
        { label: 'A', value: 'a' },
        { label: 'B', value: 'b' },
      ], false),
    ).rejects.toThrow(/No active device for panel no-such-panel/)
  })

  it('33. sendToDevice 返回 false 时 reject', async () => {
    wsSendToDevice.mockReturnValueOnce(false)
    await expect(
      __test.executeAskUser(TEST_PANEL, 'q?', [
        { label: 'A', value: 'a' },
        { label: 'B', value: 'b' },
      ], false),
    ).rejects.toThrow(/Failed to send ask_user/)
  })
})

// ============================================================================
// executeViaWs 测试
// ============================================================================

describe('piBridge executeViaWs 测试', () => {
  beforeEach(() => {
    __test.__resetInternalState()
    wsSendToolCall.mockClear()
    wsSendToolCall.mockReturnValue(true)
    wsSendToDevice.mockClear()
    wsSendToDevice.mockReturnValue(true)
    wsHasDevice.mockClear()
    wsHasDevice.mockReturnValue(true)
    wsHasClient.mockClear()
    wsHasClient.mockReturnValue(true)
  })

  it('34. DEVICE_SPECIFIC_TOOLS 路由到活跃设备', async () => {
    setPanelActiveDevice(TEST_PANEL, TEST_DEVICE)
    const promise = __test.executeViaWs('browser_eval', { script: '1+1' }, TEST_PANEL)
    expect(wsSendToolCall).toHaveBeenCalledTimes(1)
    const callArg = wsSendToolCall.mock.calls[0][0]
    expect(callArg.tool).toBe('browser_eval')
    expect(callArg.targetDeviceId).toBe(TEST_DEVICE)
    expect(callArg.panelId).toBe(TEST_PANEL)
    expect(typeof callArg.requestId).toBe('string')

    // 模拟 tool_result 成功
    __test.__pendingRequests.get(callArg.requestId)?.resolve({ success: true })
    await expect(promise).resolves.toEqual({ success: true })
  })

  it('35. 无活跃设备时 DEVICE_SPECIFIC_TOOLS reject', async () => {
    wsHasDevice.mockReturnValue(false)
    await expect(
      __test.executeViaWs('browser_eval', {}, TEST_PANEL),
    ).rejects.toThrow(/no active device for panel/)
  })

  it('36. 30s 超时 reject（fake timers）', async () => {
    vi.useFakeTimers()
    try {
      setPanelActiveDevice(TEST_PANEL, TEST_DEVICE)
      const promise = __test.executeViaWs('browser_eval', {}, TEST_PANEL)
      vi.advanceTimersByTime(30_000)
      await expect(promise).rejects.toThrow(/timeout/)
    } finally {
      vi.useRealTimers()
    }
  })

  it('37. 画布工具（非 DEVICE_SPECIFIC）需要 hasClient', async () => {
    wsHasClient.mockReturnValue(false)
    await expect(
      __test.executeViaWs('list_widgets', {}, TEST_PANEL),
    ).rejects.toThrow(/no websocket client connected/)
  })

  it('38. sendToolCall 返回 false 时 reject', async () => {
    wsSendToolCall.mockReturnValueOnce(false)
    setPanelActiveDevice(TEST_PANEL, TEST_DEVICE)
    await expect(
      __test.executeViaWs('browser_eval', {}, TEST_PANEL),
    ).rejects.toThrow(/failed to send tool_call/)
  })

  it('39. tool_result 失败时 reject', async () => {
    const uniquePanel = 'test-panel-tf-reject'
    setPanelActiveDevice(uniquePanel, TEST_DEVICE)
    const promise = __test.executeViaWs('browser_eval', {}, uniquePanel)
    const callArg = wsSendToolCall.mock.calls[0][0]
    __test.__pendingRequests.get(callArg.requestId)?.reject(new Error('client error'))
    await expect(promise).rejects.toThrow(/client error/)
  })

  it('40. 工具失败超过阈值后拒绝重试', async () => {
    const thresholdPanel = 'test-panel-threshold'
    setPanelActiveDevice(thresholdPanel, TEST_DEVICE)
    // 制造 3 次失败（TOOL_FAILURE_THRESHOLD=3）
    for (let i = 0; i < 3; i++) {
      wsSendToolCall.mockReturnValueOnce(false)
      try { await __test.executeViaWs('browser_eval', {}, thresholdPanel) } catch { /* expected */ }
    }
    // 第 4 次应被拒绝（failure threshold reached）
    await expect(
      __test.executeViaWs('browser_eval', {}, thresholdPanel),
    ).rejects.toThrow(/has failed 3 times/)
  })
})

// ============================================================================
// forwardEventToClient 测试
// ============================================================================

describe('piBridge forwardEventToClient 测试', () => {
  beforeEach(() => {
    __test.__resetInternalState()
    wsSendToDevice.mockClear()
    wsBroadcast.mockClear()
  })

  it('41. 按面板定向广播到 panelOnlineDevices 中的所有设备', () => {
    __test.__panelOnlineDevices.set(TEST_PANEL, new Set([TEST_DEVICE, TEST_DEVICE_2]))
    __test.forwardEventToClient({ type: 'pi_thinking', data: 'hello' }, TEST_PANEL)
    expect(wsSendToDevice).toHaveBeenCalledTimes(2)
    const deviceIds = wsSendToDevice.mock.calls.map(c => c[0])
    expect(deviceIds).toContain(TEST_DEVICE)
    expect(deviceIds).toContain(TEST_DEVICE_2)
    // 不应调用 broadcast
    expect(wsBroadcast).not.toHaveBeenCalled()
  })

  it('42. 无在线设备时退化为 broadcast', () => {
    __test.forwardEventToClient({ type: 'pi_event', data: {} }, TEST_PANEL)
    expect(wsBroadcast).toHaveBeenCalledTimes(1)
    expect(wsBroadcast.mock.calls[0][0].kind).toBe('pi_event')
    expect(wsBroadcast.mock.calls[0][0].panelId).toBe(TEST_PANEL)
    expect(wsSendToDevice).not.toHaveBeenCalled()
  })

  it('43. 事件无 type 字段时直接返回（no-op）', () => {
    __test.__panelOnlineDevices.set(TEST_PANEL, new Set([TEST_DEVICE]))
    __test.forwardEventToClient({ data: 'no-type' }, TEST_PANEL)
    expect(wsSendToDevice).not.toHaveBeenCalled()
    expect(wsBroadcast).not.toHaveBeenCalled()
  })

  it('44. 事件 type 非 string 时直接返回', () => {
    __test.__panelOnlineDevices.set(TEST_PANEL, new Set([TEST_DEVICE]))
    __test.forwardEventToClient({ type: 123 }, TEST_PANEL)
    expect(wsSendToDevice).not.toHaveBeenCalled()
  })
})

// ============================================================================
// getEnabledCustomTools 测试
// ============================================================================

describe('piBridge getEnabledCustomTools 测试', () => {
  beforeEach(() => {
    __test.__resetInternalState()
    mockAiToolMap.clear()
  })

  it('45. DB 失败时返回全部 customTools', async () => {
    getPoolMock.mockReturnValue({
      query: vi.fn().mockRejectedValue(new Error('DB unavailable')),
    })
    const tools = await __test.getEnabledCustomTools()
    expect(tools.length).toBeGreaterThan(0)
  })

  it('46. 按 tool_settings 过滤禁用的工具', async () => {
    // 设置 AI_TOOL_MAP：storage_write 可禁用且默认启用
    mockAiToolMap.set('storage_write', { canDisable: true, defaultEnabled: true })
    mockAiToolMap.set('storage_read', { canDisable: true, defaultEnabled: false })

    // 模拟 tool_settings 查询结果：storage_write 被禁用
    getPoolMock.mockReturnValue({
      query: vi.fn().mockResolvedValue({
        rows: [{ tool_name: 'storage_write', enabled: false }],
      }),
    })

    const tools = await __test.getEnabledCustomTools()
    const toolNames = tools.map(t => t.name)
    // storage_write 被禁用
    expect(toolNames).not.toContain('storage_write')
    // storage_read 默认禁用
    expect(toolNames).not.toContain('storage_read')
    // 其他未在 AI_TOOL_MAP 中的工具仍然启用
    expect(toolNames).toContain('create_html_widget')
  })

  it('47. tool_settings 中未记录的工具用 defaultEnabled', async () => {
    mockAiToolMap.set('storage_write', { canDisable: true, defaultEnabled: true })
    getPoolMock.mockReturnValue({
      query: vi.fn().mockResolvedValue({ rows: [] }),
    })
    const tools = await __test.getEnabledCustomTools()
    expect(tools.map(t => t.name)).toContain('storage_write')
  })

  it('48. 系统工具（canDisable=false）永远启用', async () => {
    mockAiToolMap.set('ask_user', { canDisable: false, defaultEnabled: true })
    getPoolMock.mockReturnValue({
      query: vi.fn().mockResolvedValue({
        rows: [{ tool_name: 'ask_user', enabled: false }],
      }),
    })
    const tools = await __test.getEnabledCustomTools()
    // canDisable=false 的工具即使 tool_settings.enabled=false 也启用
    expect(tools.map(t => t.name)).toContain('ask_user')
  })
})

// ============================================================================
// disposePanelSession 测试
// ============================================================================

describe('piBridge disposePanelSession 测试', () => {
  beforeEach(() => {
    __test.__resetInternalState()
  })

  it('49. 清理所有相关状态（9 个 Map）', async () => {
    // 在所有 Map 中设置 panelId
    const fakeSession = makeFakeSession('sid-dispose')
    __test.__panelSessions.set(TEST_PANEL, fakeSession)
    __test.__panelSessionApiConfig.set(TEST_PANEL, '{}')
    __test.__sessionLastUsed.set(TEST_PANEL, Date.now())
    __test.__panelActiveDevices.set(TEST_PANEL, TEST_DEVICE)
    __test.__panelSessionReady.add(TEST_PANEL)
    __test.__panelOnlineDevices.set(TEST_PANEL, new Set([TEST_DEVICE]))

    // 设置 pendingRequests
    let permRejected = false
    executeWithPermission(TEST_PANEL, {
      toolName: 't', description: 'd', permission: 'write', arguments: {},
    }).catch(() => { permRejected = true })

    await disposePanelSession(TEST_PANEL)
    // 等待 microtask 刷新
    await new Promise(r => setTimeout(r, 0))

    // 验证所有 Map 都已清理
    expect(__test.__panelSessions.has(TEST_PANEL)).toBe(false)
    expect(__test.__panelSessionApiConfig.has(TEST_PANEL)).toBe(false)
    expect(__test.__sessionLastUsed.has(TEST_PANEL)).toBe(false)
    expect(__test.__panelActiveDevices.has(TEST_PANEL)).toBe(false)
    expect(__test.__panelSessionReady.has(TEST_PANEL)).toBe(false)
    expect(__test.__panelOnlineDevices.has(TEST_PANEL)).toBe(false)
    expect(__test.__pendingRequests.size).toBe(0)
    expect(__test.__askUserPending.size).toBe(0)
    expect(__test.__permissionPending.size).toBe(0)

    // session.dispose 被调用
    expect(fakeSession.dispose).toHaveBeenCalled()

    // pending permission 被 reject
    expect(permRejected).toBe(true)
  })

  it('50. 不存在的 panelId 也不报错', async () => {
    await expect(disposePanelSession('nonexistent-panel')).resolves.not.toThrow()
  })
})

// ============================================================================
// disposePiBridge 测试
// ============================================================================

describe('piBridge disposePiBridge 测试', () => {
  beforeEach(() => {
    __test.__resetInternalState()
  })

  it('51. 销毁所有面板 session', async () => {
    const fakeSession1 = makeFakeSession('sid-1')
    const fakeSession2 = makeFakeSession('sid-2')
    __test.__panelSessions.set('panel-1', fakeSession1)
    __test.__panelSessions.set('panel-2', fakeSession2)
    __test.__sessionLastUsed.set('panel-1', Date.now())
    __test.__panelActiveDevices.set('panel-1', TEST_DEVICE)
    __test.__panelSessionReady.add('panel-1')
    __test.__panelOnlineDevices.set('panel-1', new Set([TEST_DEVICE]))

    await disposePiBridge()

    expect(__test.__panelSessions.size).toBe(0)
    expect(__test.__sessionLastUsed.size).toBe(0)
    expect(__test.__panelActiveDevices.size).toBe(0)
    expect(__test.__panelSessionReady.size).toBe(0)
    expect(__test.__panelOnlineDevices.size).toBe(0)
    expect(fakeSession1.dispose).toHaveBeenCalled()
    expect(fakeSession2.dispose).toHaveBeenCalled()
  })

  it('52. 清理所有 askUserPending', async () => {
    setPanelActiveDevice(TEST_PANEL, TEST_DEVICE)
    wsSendToDevice.mockReturnValue(true)
    let askRejected = false
    __test.executeAskUser(TEST_PANEL, 'q?', [
      { label: 'A', value: 'a' },
      { label: 'B', value: 'b' },
    ], false).catch(() => { askRejected = true })

    await disposePiBridge()
    await new Promise(r => setTimeout(r, 0))
    expect(askRejected).toBe(true)
    expect(__test.__askUserPending.size).toBe(0)
  })
})

// ============================================================================
// setActiveDevice（@deprecated）测试
// ============================================================================

describe('piBridge setActiveDevice（@deprecated）测试', () => {
  beforeEach(() => {
    __test.__resetInternalState()
  })

  it('53. setActiveDevice 写入所有已知面板', () => {
    const fakeSession1 = makeFakeSession('sid-1')
    const fakeSession2 = makeFakeSession('sid-2')
    __test.__panelSessions.set('panel-1', fakeSession1)
    __test.__panelSessions.set('panel-2', fakeSession2)

    setActiveDevice('device-deprecated')

    expect(__test.__panelActiveDevices.get('panel-1')).toBe('device-deprecated')
    expect(__test.__panelActiveDevices.get('panel-2')).toBe('device-deprecated')
  })

  it('54. 无面板时也不报错', () => {
    expect(() => setActiveDevice('device-x')).not.toThrow()
  })
})

// ============================================================================
// getOrCreatePanelSession 7 天超时清理
// ============================================================================

describe('piBridge getOrCreatePanelSession 7 天超时清理', () => {
  beforeEach(() => {
    __test.__resetInternalState()
  })

  it('55. 7 天未用的 session 被清理（fake timers）', async () => {
    vi.useFakeTimers()
    createAgentSessionMock.mockClear()
    createAgentSessionMock.mockResolvedValue({ session: makeFakeSession('new-after-expire') })
    try {
      const fakeSession = makeFakeSession('sid-old')
      __test.__panelSessions.set(TEST_PANEL, fakeSession)
      // 设置 lastUsed 为 8 天前
      __test.__sessionLastUsed.set(TEST_PANEL, Date.now() - 8 * 24 * 60 * 60 * 1000)

      // getOrCreatePanelSession 会先 dispose 旧 session（过期），然后 createSession 创建新 session
      const session = await __test.getOrCreatePanelSession(TEST_PANEL)

      // 旧 session 被 dispose
      expect(fakeSession.dispose).toHaveBeenCalled()
      // 新 session 被创建并返回
      expect(session.sessionId).toBe('new-after-expire')
      // 新 session 被存入 panelSessions
      expect(__test.__panelSessions.get(TEST_PANEL)).toBe(session)
    } finally {
      vi.useRealTimers()
    }
  })

  it('56. 过期 session 清理后 sessionLastUsed 也被清理', async () => {
    // cleanupTimer 在模块加载时已注册（real timers），无法用 fake timers 触发
    // 改为直接测试 disposePanelSession 清理逻辑（cleanupTimer 内部也调用它）
    const fakeSession = makeFakeSession('sid-cleanup')
    __test.__panelSessions.set(TEST_PANEL, fakeSession)
    __test.__sessionLastUsed.set(TEST_PANEL, Date.now() - 8 * 24 * 60 * 60 * 1000)

    await disposePanelSession(TEST_PANEL)

    expect(fakeSession.dispose).toHaveBeenCalled()
    expect(__test.__panelSessions.has(TEST_PANEL)).toBe(false)
    expect(__test.__sessionLastUsed.has(TEST_PANEL)).toBe(false)
  })

  it('57. 未过期的 session 不被清理', async () => {
    const fakeSession = makeFakeSession('sid-fresh')
    __test.__panelSessions.set(TEST_PANEL, fakeSession)
    __test.__sessionLastUsed.set(TEST_PANEL, Date.now())

    // getOrCreatePanelSession 会复用现有 session
    const session = await __test.getOrCreatePanelSession(TEST_PANEL)
    expect(session).toBe(fakeSession)
    expect(fakeSession.dispose).not.toHaveBeenCalled()
  })
})

// ============================================================================
// onClientMessage 分发测试
// ============================================================================

describe('piBridge onClientMessage 分发测试', () => {
  let messageHandler: (msg: Record<string, unknown>, deviceId: string) => void

  beforeAll(async () => {
    await initPiBridge()
    messageHandler = wsOnClientMessage.mock.calls[0][0]
  })

  beforeEach(() => {
    __test.__resetInternalState()
    wsSendToDevice.mockClear()
    wsSendToDevice.mockReturnValue(true)
    wsIsGuestDevice.mockReturnValue(false)
    wsGetGuestDeviceId.mockReturnValue(undefined)
  })

  it('58. user_message 设置 panelActiveDevice + 加入 panelOnlineDevices', () => {
    messageHandler({ kind: 'user_message', content: 'hello', panelId: TEST_PANEL }, TEST_DEVICE)
    expect(__test.__panelActiveDevices.get(TEST_PANEL)).toBe(TEST_DEVICE)
    expect(__test.__panelOnlineDevices.get(TEST_PANEL)?.has(TEST_DEVICE)).toBe(true)
  })

  it('59. user_message 无 panelId 时用 session-only 前缀', () => {
    messageHandler({ kind: 'user_message', content: 'hi', sessionId: 'sess-123' }, TEST_DEVICE)
    // effectivePanelId = session-only:sess-123
    expect(__test.__panelActiveDevices.get('session-only:sess-123')).toBe(TEST_DEVICE)
  })

  it('60. user_message 设备切面板时清理旧面板', () => {
    // 先在 panel-A 注册设备
    messageHandler({ kind: 'user_message', content: 'a', panelId: 'panel-A' }, TEST_DEVICE)
    // 再切到 panel-B
    messageHandler({ kind: 'user_message', content: 'b', panelId: 'panel-B' }, TEST_DEVICE)
    // panel-A 的活跃设备应被清理
    expect(__test.__panelActiveDevices.has('panel-A')).toBe(false)
    // panel-B 的活跃设备应是 TEST_DEVICE
    expect(__test.__panelActiveDevices.get('panel-B')).toBe(TEST_DEVICE)
  })

  it('61. dispose_session 清理在线设备集合', async () => {
    // 先注册设备到面板
    messageHandler({ kind: 'user_message', content: 'hi', panelId: TEST_PANEL }, TEST_DEVICE)
    expect(__test.__panelOnlineDevices.get(TEST_PANEL)?.has(TEST_DEVICE)).toBe(true)

    // 发送 dispose_session
    messageHandler({ kind: 'dispose_session', panelId: TEST_PANEL }, TEST_DEVICE)

    // 等待异步 disposePanelSession
    await new Promise(r => setTimeout(r, 10))

    // 在线设备集合应被清理（空集合被删除）
    // 注：dispose_session 先从 onlineSet 移除设备，如果 size=0 则删除整个 entry
    expect(__test.__panelOnlineDevices.has(TEST_PANEL)).toBe(false)
  })

  it('62. tool_result resolve pending 请求', async () => {
    // 先创建一个 pending 请求
    setPanelActiveDevice(TEST_PANEL, TEST_DEVICE)
    wsSendToolCall.mockClear()
    wsSendToolCall.mockReturnValue(true)
    wsHasClient.mockReturnValue(true)
    const promise = __test.executeViaWs('list_widgets', {}, TEST_PANEL)
    const requestId = wsSendToolCall.mock.calls[0][0].requestId

    // 模拟客户端返回 tool_result
    messageHandler({ kind: 'tool_result', requestId, success: true, data: { widgets: [] } }, TEST_DEVICE)
    await expect(promise).resolves.toEqual({ widgets: [] })
  })

  it('63. tool_result 未知 requestId 不报错', () => {
    expect(() => {
      messageHandler({ kind: 'tool_result', requestId: 'unknown', success: true, data: {} }, TEST_DEVICE)
    }).not.toThrow()
  })

  it('64. ask_user_response 分发到 handleAskUserResponse', async () => {
    // 先创建 ask_user pending
    setPanelActiveDevice(TEST_PANEL, TEST_DEVICE)
    wsSendToDevice.mockReturnValue(true)
    const promise = __test.executeAskUser(TEST_PANEL, 'q?', [
      { label: 'A', value: 'a' },
      { label: 'B', value: 'b' },
    ], false)
    const requestId = wsSendToDevice.mock.calls[0][1].requestId

    // 客户端回复
    messageHandler({ kind: 'ask_user_response', requestId, selectedValues: ['a'] }, TEST_DEVICE)
    await expect(promise).resolves.toEqual(['a'])
  })

  it('65. permission_response 分发到 handlePermissionResponse', async () => {
    setPanelActiveDevice(TEST_PANEL, TEST_DEVICE)
    wsSendToDevice.mockReturnValue(true)
    const promise = executeWithPermission(TEST_PANEL, {
      toolName: 't', description: 'd', permission: 'write', arguments: {},
    })
    const requestId = wsSendToDevice.mock.calls[0][1].requestId

    messageHandler({ kind: 'permission_response', requestId, approved: true }, TEST_DEVICE)
    await expect(promise).resolves.toEqual({ approved: true })
  })

  it('66. cancel_request 触发 disposePanelSession', async () => {
    // 先设置面板状态
    const fakeSession = makeFakeSession('sid-cancel')
    __test.__panelSessions.set(TEST_PANEL, fakeSession)
    __test.__panelOnlineDevices.set(TEST_PANEL, new Set([TEST_DEVICE]))

    messageHandler({ kind: 'cancel_request', panelId: TEST_PANEL }, TEST_DEVICE)

    // 等待异步 disposePanelSession
    await new Promise(r => setTimeout(r, 10))

    expect(fakeSession.dispose).toHaveBeenCalled()
    expect(__test.__panelSessions.has(TEST_PANEL)).toBe(false)
  })
})

// ============================================================================
// onClientMessage session-only 跳过持久化
// ============================================================================

describe('piBridge onClientMessage session-only 跳过持久化', () => {
  beforeEach(() => {
    __test.__resetInternalState()
    persistConversationMock.mockClear()
    persistPiEventMock.mockClear()
  })

  it('67. session-only panelId 不触发 persistConversation', async () => {
    // 设置 fake session 避免 createSession 失败
    const fakeSession = makeFakeSession('sid-sess-only')
    __test.__panelSessions.set('session-only:test', fakeSession)
    __test.__sessionLastUsed.set('session-only:test', Date.now())

    await handleUserMessage('hello', TEST_DEVICE, 'session-only:test')

    // persistConversation 不应被调用
    expect(persistConversationMock).not.toHaveBeenCalled()
  })

  it('68. 正常 panelId 触发 persistConversation', async () => {
    const fakeSession = makeFakeSession('sid-normal')
    __test.__panelSessions.set(TEST_PANEL, fakeSession)
    __test.__sessionLastUsed.set(TEST_PANEL, Date.now())

    await handleUserMessage('hello', TEST_DEVICE, TEST_PANEL)

    expect(persistConversationMock).toHaveBeenCalledWith(TEST_PANEL, 'user', 'hello', TEST_DEVICE)
  })
})

// ============================================================================
// onClientDisconnect 测试
// ============================================================================

describe('piBridge onClientDisconnect 测试', () => {
  let disconnectHandler: (deviceId: string) => void

  beforeAll(async () => {
    await initPiBridge()
    disconnectHandler = wsOnClientDisconnect.mock.calls[0][0]
  })

  beforeEach(() => {
    __test.__resetInternalState()
  })

  it('69. 清理 panelActiveDevices 中以该 deviceId 为值的映射', () => {
    __test.__panelActiveDevices.set('panel-A', TEST_DEVICE)
    __test.__panelActiveDevices.set('panel-B', TEST_DEVICE_2)

    disconnectHandler(TEST_DEVICE)

    expect(__test.__panelActiveDevices.has('panel-A')).toBe(false)
    expect(__test.__panelActiveDevices.get('panel-B')).toBe(TEST_DEVICE_2)
  })

  it('70. 从 panelOnlineDevices 移除该设备', () => {
    __test.__panelOnlineDevices.set('panel-A', new Set([TEST_DEVICE, TEST_DEVICE_2]))
    __test.__panelOnlineDevices.set('panel-B', new Set([TEST_DEVICE]))

    disconnectHandler(TEST_DEVICE)

    // panel-A 还剩 TEST_DEVICE_2
    expect(__test.__panelOnlineDevices.get('panel-A')?.has(TEST_DEVICE)).toBe(false)
    expect(__test.__panelOnlineDevices.get('panel-A')?.has(TEST_DEVICE_2)).toBe(true)
    // panel-B 只有一个设备，移除后整个 entry 被删除
    expect(__test.__panelOnlineDevices.has('panel-B')).toBe(false)
  })
})

// ============================================================================
// getSessionId（@deprecated）测试
// ============================================================================

describe('piBridge getSessionId（@deprecated）测试', () => {
  beforeEach(() => {
    __test.__resetInternalState()
  })

  it('71. 无 session 时返回 undefined', () => {
    expect(getSessionId()).toBeUndefined()
  })

  it('72. 有 session 时返回任一 sessionId', () => {
    const fakeSession = makeFakeSession('sid-get-1')
    __test.__panelSessions.set(TEST_PANEL, fakeSession)
    expect(getSessionId()).toBe('sid-get-1')
  })
})

// ============================================================================
// rejectAllPending 测试
// ============================================================================

describe('piBridge rejectAllPending 测试', () => {
  beforeEach(() => {
    __test.__resetInternalState()
    wsSendToDevice.mockClear()
    wsSendToDevice.mockReturnValue(true)
    wsSendToolCall.mockClear()
    wsSendToolCall.mockReturnValue(true)
    setPanelActiveDevice(TEST_PANEL, TEST_DEVICE)
  })

  it('73. rejectAllPending 清理所有 pendingRequests', async () => {
    const promise1 = __test.executeViaWs('list_widgets', {}, TEST_PANEL).catch(e => e)
    const promise2 = __test.executeViaWs('storage_read', {}, TEST_PANEL).catch(e => e)

    __test.rejectAllPending('test reject all')

    const err1 = await promise1
    const err2 = await promise2
    expect(err1).toBeInstanceOf(Error)
    expect(err2).toBeInstanceOf(Error)
    expect((err1 as Error).message).toBe('test reject all')
    expect(__test.__pendingRequests.size).toBe(0)
  })
})

// ============================================================================
// getOrCreatePanelSession 创建/复用 session 测试
// ============================================================================

describe('piBridge getOrCreatePanelSession 创建 session 测试', () => {
  beforeEach(() => {
    __test.__resetInternalState()
    createAgentSessionMock.mockClear()
    createAgentSessionMock.mockResolvedValue({ session: makeFakeSession('new-session') })
  })

  it('74. 无现有 session 时调用 createSession 创建新 session', async () => {
    const session = await __test.getOrCreatePanelSession(TEST_PANEL)
    expect(createAgentSessionMock).toHaveBeenCalledTimes(1)
    expect(session.sessionId).toBe('new-session')
    expect(__test.__panelSessions.get(TEST_PANEL)).toBe(session)
    expect(__test.__sessionLastUsed.has(TEST_PANEL)).toBe(true)
  })

  it('75. 有现有 session 时复用，不调用 createSession', async () => {
    const existing = makeFakeSession('existing-sid')
    __test.__panelSessions.set(TEST_PANEL, existing)
    __test.__sessionLastUsed.set(TEST_PANEL, Date.now())

    const session = await __test.getOrCreatePanelSession(TEST_PANEL)
    expect(session).toBe(existing)
    expect(createAgentSessionMock).not.toHaveBeenCalled()
  })

  it('76. apiConfig 变化时 dispose 旧 session 并创建新 session', async () => {
    const oldSession = makeFakeSession('old-sid')
    oldSession.dispose = vi.fn()
    __test.__panelSessions.set(TEST_PANEL, oldSession)
    __test.__panelSessionApiConfig.set(TEST_PANEL, JSON.stringify({ endpoint: 'old', apiKey: 'old', model: 'old' }))

    const newSession = makeFakeSession('new-sid')
    createAgentSessionMock.mockResolvedValueOnce({ session: newSession })

    const session = await __test.getOrCreatePanelSession(TEST_PANEL, { endpoint: 'new', apiKey: 'new', model: 'new' })
    expect(oldSession.dispose).toHaveBeenCalled()
    expect(session).toBe(newSession)
    expect(__test.__panelSessions.get(TEST_PANEL)).toBe(newSession)
  })

  it('77. apiConfig 未变化时复用现有 session', async () => {
    const existing = makeFakeSession('same-sid')
    __test.__panelSessions.set(TEST_PANEL, existing)
    __test.__panelSessionApiConfig.set(TEST_PANEL, JSON.stringify({ endpoint: 'e', apiKey: 'k', model: 'm' }))

    const session = await __test.getOrCreatePanelSession(TEST_PANEL, { endpoint: 'e', apiKey: 'k', model: 'm' })
    expect(session).toBe(existing)
    expect(createAgentSessionMock).not.toHaveBeenCalled()
  })

  it('78. 过期 session 被清理后创建新 session', async () => {
    const oldSession = makeFakeSession('expired-sid')
    oldSession.dispose = vi.fn()
    __test.__panelSessions.set(TEST_PANEL, oldSession)
    __test.__sessionLastUsed.set(TEST_PANEL, Date.now() - 8 * 24 * 60 * 60 * 1000)

    const newSession = makeFakeSession('fresh-sid')
    createAgentSessionMock.mockResolvedValueOnce({ session: newSession })

    const session = await __test.getOrCreatePanelSession(TEST_PANEL)
    expect(oldSession.dispose).toHaveBeenCalled()
    expect(session).toBe(newSession)
  })
})

// ============================================================================
// handleUserMessage 成功/错误路径测试
// ============================================================================

describe('piBridge handleUserMessage 路径测试', () => {
  beforeEach(() => {
    __test.__resetInternalState()
    createAgentSessionMock.mockClear()
    createAgentSessionMock.mockResolvedValue({ session: makeFakeSession('hmsg-session') })
    wsSendToDevice.mockClear()
    wsSendToDevice.mockReturnValue(true)
    wsBroadcast.mockClear()
    persistConversationMock.mockClear()
    persistPiEventMock.mockClear()
  })

  it('79. handleUserMessage 无 panelId 时 throw', async () => {
    await expect(handleUserMessage('hello', TEST_DEVICE)).rejects.toThrow(/panelId is required/)
  })

  it('80. handleUserMessage 成功路径调用 prompt + persistConversation + session_ready', async () => {
    const fakeSession = makeFakeSession('success-sid')
    fakeSession.prompt = vi.fn().mockResolvedValue(undefined)
    __test.__panelSessions.set(TEST_PANEL, fakeSession)
    __test.__sessionLastUsed.set(TEST_PANEL, Date.now())

    handleUserMessage('hello world', TEST_DEVICE, TEST_PANEL)

    // 等待异步 getOrCreatePanelSession + persistConversation + prompt 完成
    await new Promise(r => setTimeout(r, 20))

    // persistConversation 在 await getOrCreatePanelSession 之后调用
    expect(persistConversationMock).toHaveBeenCalledWith(TEST_PANEL, 'user', 'hello world', TEST_DEVICE)

    expect(fakeSession.prompt).toHaveBeenCalledWith('hello world')
    // 首次成功 prompt 后广播 session_ready
    expect(wsBroadcast).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'session_ready',
      panelId: TEST_PANEL,
    }))
  })

  it('81. handleUserMessage prompt 抛错时发送 error 到设备并 dispose session', async () => {
    const fakeSession = makeFakeSession('err-sid')
    fakeSession.prompt = vi.fn().mockRejectedValue(new Error('prompt failed'))
    __test.__panelSessions.set(TEST_PANEL, fakeSession)
    __test.__sessionLastUsed.set(TEST_PANEL, Date.now())

    handleUserMessage('hello', TEST_DEVICE, TEST_PANEL)

    // 等待异步 prompt + dispose 完成
    await new Promise(r => setTimeout(r, 30))

    expect(fakeSession.dispose).toHaveBeenCalled()
    expect(wsSendToDevice).toHaveBeenCalledWith(TEST_DEVICE, expect.objectContaining({
      kind: 'error',
      message: expect.stringContaining('prompt failed'),
    }))
  })

  it('82. handleUserMessage prompt 超时时发送超时 error', async () => {
    const fakeSession = makeFakeSession('timeout-sid')
    fakeSession.prompt = vi.fn().mockImplementation(() => new Promise(() => {})) // never resolves
    __test.__panelSessions.set(TEST_PANEL, fakeSession)
    __test.__sessionLastUsed.set(TEST_PANEL, Date.now())

    vi.useFakeTimers()
    try {
      handleUserMessage('hello', TEST_DEVICE, TEST_PANEL)
      // 推进超过 180s 触发「无活动」空闲超时（idle 检查为 5s 间隔，需略超过 180s
      // 才能被下一次 tick 捕获；advanceTimersByTimeAsync 会 flush microtasks）
      await vi.advanceTimersByTimeAsync(185_000)

      expect(wsSendToDevice).toHaveBeenCalledWith(TEST_DEVICE, expect.objectContaining({
        kind: 'error',
        message: expect.stringContaining('超时'),
      }))
    } finally {
      vi.useRealTimers()
    }
  })
})

// ============================================================================
// onClientMessage 额外路径测试
// ============================================================================

describe('piBridge onClientMessage 额外路径测试', () => {
  let messageHandler: (msg: Record<string, unknown>, deviceId: string) => void
  let connectHandler: (deviceId: string) => void
  let errorReportHandler: (report: Record<string, unknown>, deviceId: string) => void

  beforeAll(async () => {
    await initPiBridge()
    messageHandler = wsOnClientMessage.mock.calls[0][0]
    connectHandler = wsOnClientConnect.mock.calls[0][0]
    errorReportHandler = wsOnErrorReport.mock.calls[0][0]
  })

  beforeEach(() => {
    __test.__resetInternalState()
    createAgentSessionMock.mockClear()
    createAgentSessionMock.mockResolvedValue({ session: makeFakeSession('msg-session') })
    wsSendToDevice.mockClear()
    wsSendToDevice.mockReturnValue(true)
    wsBroadcast.mockClear()
    wsIsGuestDevice.mockReturnValue(false)
    wsGetGuestDeviceId.mockReturnValue(undefined)
    persistConversationMock.mockClear()
    persistPiEventMock.mockClear()
  })

  it('83. onClientConnect 不抛错', () => {
    expect(() => connectHandler(TEST_DEVICE)).not.toThrow()
  })

  it('84. 游客超过每分钟限频时发送 error 并 return', async () => {
    wsIsGuestDevice.mockReturnValue(true)
    wsGetGuestDeviceId.mockReturnValue('guest-device-rl')

    // 5 次在限频内
    for (let i = 0; i < 5; i++) {
      messageHandler({ kind: 'user_message', content: `msg-${i}`, panelId: `guest-panel-${i}` }, TEST_DEVICE)
    }

    // 第 6 次应被限频
    wsSendToDevice.mockClear()
    messageHandler({ kind: 'user_message', content: 'msg-5', panelId: 'guest-panel-5' }, TEST_DEVICE)

    expect(wsSendToDevice).toHaveBeenCalledWith(TEST_DEVICE, expect.objectContaining({
      kind: 'error',
      message: expect.stringContaining('游客请求过于频繁'),
    }))
  })

  it('85. dispose_session 有其他在线设备时不销毁 session', async () => {
    const fakeSession = makeFakeSession('multi-sid')
    __test.__panelSessions.set(TEST_PANEL, fakeSession)
    __test.__panelOnlineDevices.set(TEST_PANEL, new Set([TEST_DEVICE, TEST_DEVICE_2]))

    messageHandler({ kind: 'dispose_session', panelId: TEST_PANEL }, TEST_DEVICE)

    await new Promise(r => setTimeout(r, 10))

    // Session 应该仍然存在（另一个设备还在线）
    expect(__test.__panelSessions.has(TEST_PANEL)).toBe(true)
    expect(fakeSession.dispose).not.toHaveBeenCalled()
    // 但发起方的设备应从在线集合中移除
    const onlineSet = __test.__panelOnlineDevices.get(TEST_PANEL)
    expect(onlineSet?.has(TEST_DEVICE)).toBe(false)
    expect(onlineSet?.has(TEST_DEVICE_2)).toBe(true)
  })

  it('86. error_report 有 panelId 时注入到 agent 上下文', async () => {
    const PANEL_86 = 'panel-err-86'
    const fakeSession = makeFakeSession('err-report-sid')
    __test.__panelSessions.set(PANEL_86, fakeSession)
    __test.__sessionLastUsed.set(PANEL_86, Date.now())

    errorReportHandler({
      widgetId: 'w1',
      panelId: PANEL_86,
      message: 'ReferenceError: x is not defined',
      source: 'iframe',
    }, TEST_DEVICE)

    // 等待异步 handleUserMessage
    await new Promise(r => setTimeout(r, 20))

    // handleUserMessage 应被调用（通过 persistConversation 验证）
    expect(persistConversationMock).toHaveBeenCalledWith(
      PANEL_86, 'user', expect.stringContaining('ReferenceError'), TEST_DEVICE,
    )
  })

  it('87. error_report 无 panelId 且无设备关联面板时丢弃', () => {
    wsSendToDevice.mockClear()
    errorReportHandler({
      widgetId: 'w1',
      message: 'Error',
      source: 'iframe',
    }, 'unknown-device')

    // 不应创建任何 session
    expect(__test.__panelSessions.size).toBe(0)
    // 不应发送 error 到设备（因为 error_report 的 handleUserMessage 不会被调用）
    expect(persistConversationMock).not.toHaveBeenCalled()
  })

  it('88. error_report 冷却期内被丢弃', async () => {
    const PANEL_88 = 'panel-err-88'
    __test.__panelSessions.set(PANEL_88, makeFakeSession('cooldown-sid'))
    __test.__sessionLastUsed.set(PANEL_88, Date.now())

    // 第一次 error_report 通过
    errorReportHandler({
      widgetId: 'w1', panelId: PANEL_88, message: 'err1', source: 'iframe',
    }, TEST_DEVICE)
    await new Promise(r => setTimeout(r, 5))

    // 第二次立即发送应被冷却期拦截
    persistConversationMock.mockClear()
    errorReportHandler({
      widgetId: 'w2', panelId: PANEL_88, message: 'err2', source: 'iframe',
    }, TEST_DEVICE)
    await new Promise(r => setTimeout(r, 5))

    expect(persistConversationMock).not.toHaveBeenCalled()
  })

  it('89. error_report 无 panelId 时通过 panelOnlineDevices 兜底查找', async () => {
    const PANEL_89 = 'panel-err-89'
    const fakeSession = makeFakeSession('fallback-sid')
    __test.__panelSessions.set(PANEL_89, fakeSession)
    __test.__sessionLastUsed.set(PANEL_89, Date.now())
    __test.__panelOnlineDevices.set(PANEL_89, new Set([TEST_DEVICE]))

    // 不传 panelId，应通过 panelOnlineDevices 兜底
    errorReportHandler({
      widgetId: 'w1',
      message: 'TypeError: bad call',
      source: 'iframe',
    }, TEST_DEVICE)

    await new Promise(r => setTimeout(r, 20))

    expect(persistConversationMock).toHaveBeenCalledWith(
      PANEL_89, 'user', expect.stringContaining('TypeError'), TEST_DEVICE,
    )
  })

  it('90. error_report 无 panelId 时通过 panelActiveDevices 兜底查找', async () => {
    const PANEL_90 = 'panel-err-90'
    const fakeSession = makeFakeSession('active-fallback-sid')
    __test.__panelSessions.set(PANEL_90, fakeSession)
    __test.__sessionLastUsed.set(PANEL_90, Date.now())
    __test.__panelActiveDevices.set(PANEL_90, TEST_DEVICE)
    // panelOnlineDevices 为空，测试 panelActiveDevices 兜底

    errorReportHandler({
      widgetId: 'w1',
      message: 'SyntaxError: unexpected token',
      source: 'iframe',
    }, TEST_DEVICE)

    await new Promise(r => setTimeout(r, 20))

    expect(persistConversationMock).toHaveBeenCalledWith(
      PANEL_90, 'user', expect.stringContaining('SyntaxError'), TEST_DEVICE,
    )
  })
})

// ============================================================================
// disposePiBridge 错误路径测试
// ============================================================================

describe('piBridge disposePiBridge 错误路径测试', () => {
  beforeEach(() => {
    __test.__resetInternalState()
  })

  it('91. dispose 抛错时不崩溃并继续清理其他 session', async () => {
    const badSession = makeFakeSession('bad-sid')
    badSession.dispose = vi.fn(() => { throw new Error('dispose failed') })
    const goodSession = makeFakeSession('good-sid')
    goodSession.dispose = vi.fn()

    __test.__panelSessions.set('panel-bad', badSession)
    __test.__panelSessions.set('panel-good', goodSession)

    await disposePiBridge()

    // badSession.dispose 抛错但不应阻止 goodSession.dispose
    expect(badSession.dispose).toHaveBeenCalled()
    expect(goodSession.dispose).toHaveBeenCalled()
    // 所有 session 都被清理
    expect(__test.__panelSessions.size).toBe(0)
  })
})

// ============================================================================
// 工具 execute 函数覆盖测试
// 目标：覆盖所有 customTools 中 tool.execute 的 error path 和 success path
// ============================================================================

describe('piBridge 工具 execute 函数覆盖测试', () => {
  let allTools: { name: string; execute?: (toolCallId: string, params: unknown, signal: unknown, onUpdate: unknown, ctx: unknown) => Promise<unknown> }[]

  beforeAll(async () => {
    getPoolMock.mockReturnValue({
      query: vi.fn().mockRejectedValue(new Error('DB unavailable')),
    })
    allTools = await __test.getEnabledCustomTools() as any
  })

  beforeEach(() => {
    __test.__resetInternalState()
    wsSendToolCall.mockClear()
    wsSendToolCall.mockReturnValue(true)
    wsSendToDevice.mockClear()
    wsSendToDevice.mockReturnValue(true)
    wsHasClient.mockClear()
    wsHasClient.mockReturnValue(true)
    wsHasDevice.mockClear()
    wsHasDevice.mockReturnValue(true)
  })

  it('92. 所有工具在无 panel context 时 throw', async () => {
    for (const tool of allTools) {
      if (!tool.execute) continue
      await expect(
        tool.execute('tcid', {}, undefined, undefined, undefined),
      ).rejects.toThrow(/panel context/i)
    }
  })

  it('93. WS 工具在有 panel context 时成功调用 executeViaWs', async () => {
    const skipTools = new Set(['ask_user', 'upload_background_image', 'delete_html_widget', 'storage_write', 'browser_eval', 'browser_set_cookie'])
    const wsTools = allTools.filter(t => t.execute && !skipTools.has(t.name))

    for (const tool of wsTools) {
      __test.__resetInternalState()
      wsSendToolCall.mockClear()
      wsSendToolCall.mockReturnValue(true)
      wsHasClient.mockReturnValue(true)
      wsHasDevice.mockReturnValue(true)
      setPanelActiveDevice(TEST_PANEL, TEST_DEVICE)

      await __test.withPanelContext(TEST_PANEL, async () => {
        const promise = tool.execute!('tcid', {}, undefined, undefined, undefined)
        const lastCall = wsSendToolCall.mock.calls[wsSendToolCall.mock.calls.length - 1]
        const requestId = lastCall[0].requestId
        const pending = __test.__pendingRequests.get(requestId)
        if (pending) {
          pending.resolve({ success: true, data: {} })
        }
        const result = await promise as { content?: unknown }
        expect(result).toBeDefined()
        expect(result.content).toBeDefined()
      })
    }
  })

  it('94. 权限工具在 approved=false 时返回 PERMISSION_DENIED', async () => {
    const permissionTools = ['delete_html_widget', 'storage_write', 'browser_eval', 'browser_set_cookie']
    const tools = allTools.filter(t => t.execute && permissionTools.includes(t.name))

    for (const tool of tools) {
      __test.__resetInternalState()
      wsSendToDevice.mockClear()
      wsSendToDevice.mockReturnValue(true)
      setPanelActiveDevice(TEST_PANEL, TEST_DEVICE)

      await __test.withPanelContext(TEST_PANEL, async () => {
        const promise = tool.execute!('tcid', { id: 'w1' }, undefined, undefined, undefined)
        const lastCall = wsSendToDevice.mock.calls[wsSendToDevice.mock.calls.length - 1]
        const msg = lastCall[1]
        handlePermissionResponse({ requestId: msg.requestId, approved: false })
        const result = await promise as { content: Array<{ text: string }> }
        const text = JSON.parse(result.content[0].text)
        expect(text.success).toBe(false)
        expect(text.error.code).toBe('PERMISSION_DENIED')
      })
    }
  })

  it('95. ask_user 工具成功返回选择结果', async () => {
    const askTool = allTools.find(t => t.name === 'ask_user')
    if (!askTool?.execute) return

    __test.__resetInternalState()
    wsSendToDevice.mockClear()
    wsSendToDevice.mockReturnValue(true)
    setPanelActiveDevice(TEST_PANEL, TEST_DEVICE)

    await __test.withPanelContext(TEST_PANEL, async () => {
      const promise = askTool.execute!('tcid', {
        question: '选择?',
        options: [{ label: 'A', value: 'a' }],
        allowMultiple: false,
      }, undefined, undefined, undefined)
      const lastCall = wsSendToDevice.mock.calls[wsSendToDevice.mock.calls.length - 1]
      const msg = lastCall[1]
      __test.handleAskUserResponse({ requestId: msg.requestId, selectedValues: ['a'] })
      const result = await promise as { content: Array<{ text: string }> }
      const text = JSON.parse(result.content[0].text)
      expect(text).toEqual(['a'])
    })
  })
})

// ============================================================================
// rejectAllPendingForPanel 覆盖测试
// ============================================================================

describe('piBridge rejectAllPendingForPanel 覆盖测试', () => {
  beforeEach(() => {
    __test.__resetInternalState()
    wsSendToolCall.mockClear()
    wsSendToolCall.mockReturnValue(true)
    wsSendToDevice.mockClear()
    wsSendToDevice.mockReturnValue(true)
    wsHasClient.mockReturnValue(true)
    wsHasDevice.mockReturnValue(true)
    setPanelActiveDevice(TEST_PANEL, TEST_DEVICE)
  })

  it('96. disposePanelSession 清理 pendingRequests + askUserPending + permissionPending', async () => {
    let toolRejected = false
    let askRejected = false
    let permRejected = false

    // 创建 pendingRequests (tool_call)
    __test.executeViaWs('list_widgets', {}, TEST_PANEL).catch(() => { toolRejected = true })
    // 创建 askUserPending
    __test.executeAskUser(TEST_PANEL, 'q?', [{ label: 'A', value: 'a' }], false).catch(() => { askRejected = true })
    // 创建 permissionPending
    executeWithPermission(TEST_PANEL, {
      toolName: 't', description: 'd', permission: 'write', arguments: {},
    }).catch(() => { permRejected = true })

    expect(__test.__pendingRequests.size).toBeGreaterThan(0)
    expect(__test.__askUserPending.size).toBeGreaterThan(0)
    expect(__test.__permissionPending.size).toBeGreaterThan(0)

    await disposePanelSession(TEST_PANEL)
    await new Promise(r => setTimeout(r, 0))

    expect(toolRejected).toBe(true)
    expect(askRejected).toBe(true)
    expect(permRejected).toBe(true)
    expect(__test.__pendingRequests.size).toBe(0)
    expect(__test.__askUserPending.size).toBe(0)
    expect(__test.__permissionPending.size).toBe(0)
  })
})

// ============================================================================
// checkGuestRateLimit 边界测试
// ============================================================================

describe('piBridge checkGuestRateLimit 边界测试', () => {
  let messageHandler: (msg: Record<string, unknown>, deviceId: string) => void

  beforeAll(async () => {
    await initPiBridge()
    messageHandler = wsOnClientMessage.mock.calls[0][0]
  })

  beforeEach(() => {
    __test.__resetInternalState()
    wsSendToDevice.mockClear()
    wsSendToDevice.mockReturnValue(true)
    wsIsGuestDevice.mockReturnValue(true)
    wsGetGuestDeviceId.mockReturnValue('guest-daily-test')
  })

  it('97. 游客超过每日限频时返回每日额度错误', async () => {
    // 模拟已用完每日 50 次额度（通过直接操作 guestRateMap 不可能，改用循环调用）
    // 用 fake timers 推进时间来绕过分钟限频
    vi.useFakeTimers()
    try {
      // 调用 50 次（每日额度），每 61 秒一次绕过分钟限频
      for (let i = 0; i < 50; i++) {
        wsSendToDevice.mockClear()
        messageHandler({ kind: 'user_message', content: `msg-${i}`, panelId: `daily-panel-${i}` }, 'guest-device-daily')
        // 推进 61 秒绕过分钟限频
        vi.advanceTimersByTime(61_000)
      }
      // 第 51 次应被日限拦截
      wsSendToDevice.mockClear()
      messageHandler({ kind: 'user_message', content: 'over-limit', panelId: 'daily-panel-51' }, 'guest-device-daily')

      expect(wsSendToDevice).toHaveBeenCalledWith('guest-device-daily', expect.objectContaining({
        kind: 'error',
        message: expect.stringContaining('每日'),
      }))
    } finally {
      vi.useRealTimers()
    }
  })

  it('98. 分钟限频窗口重置后可再次调用', async () => {
    vi.useFakeTimers()
    try {
      // 用完 5 次分钟额度（fake timers 下 Date.now() 被 mock，时间一致）
      for (let i = 0; i < 5; i++) {
        messageHandler({ kind: 'user_message', content: `msg-${i}`, panelId: `reset-panel-${i}` }, 'guest-device-reset')
      }
      // 第 6 次被限频
      wsSendToDevice.mockClear()
      messageHandler({ kind: 'user_message', content: 'blocked', panelId: 'reset-panel-5' }, 'guest-device-reset')
      expect(wsSendToDevice).toHaveBeenCalledWith('guest-device-reset', expect.objectContaining({
        message: expect.stringContaining('频繁'),
      }))

      // 推进 61 秒，分钟窗口重置（fake timers 下 Date.now() 也推进）
      vi.advanceTimersByTime(61_000)

      // 再次调用应通过（日限额度只用了 6 次，远未达 50）
      wsSendToDevice.mockClear()
      messageHandler({ kind: 'user_message', content: 'after-reset', panelId: 'reset-panel-6' }, 'guest-device-reset')
      expect(wsSendToDevice).not.toHaveBeenCalledWith('guest-device-reset', expect.objectContaining({
        kind: 'error',
        message: expect.stringContaining('频繁'),
      }))
    } finally {
      vi.useRealTimers()
    }
  })
})

// ============================================================================
// tool_result failure + handleUserMessage 边界覆盖
// ============================================================================

describe('piBridge tool_result failure + handleUserMessage 边界覆盖', () => {
  let messageHandler: (msg: Record<string, unknown>, deviceId: string) => void

  beforeAll(async () => {
    await initPiBridge()
    messageHandler = wsOnClientMessage.mock.calls[0][0]
  })

  beforeEach(() => {
    __test.__resetInternalState()
    createAgentSessionMock.mockClear()
    createAgentSessionMock.mockResolvedValue({ session: makeFakeSession('edge-session') })
    wsSendToolCall.mockClear()
    wsSendToolCall.mockReturnValue(true)
    wsSendToDevice.mockClear()
    wsSendToDevice.mockReturnValue(true)
    wsBroadcast.mockClear()
    wsHasClient.mockReturnValue(true)
    wsHasDevice.mockReturnValue(true)
    persistConversationMock.mockClear()
    persistConversationMock.mockResolvedValue(undefined)
    setPanelActiveDevice(TEST_PANEL, TEST_DEVICE)
  })

  it('99. tool_result success=false 时 reject pending', async () => {
    const promise = __test.executeViaWs('list_widgets', {}, TEST_PANEL)
    const requestId = wsSendToolCall.mock.calls[0][0].requestId

    messageHandler({ kind: 'tool_result', requestId, success: false, error: 'widget not found' }, TEST_DEVICE)

    await expect(promise).rejects.toThrow(/widget not found/)
  })

  it('100. handleUserMessage 无 deviceId 时 broadcast error', async () => {
    const fakeSession = makeFakeSession('err-noid-sid')
    fakeSession.prompt = vi.fn().mockRejectedValue(new Error('prompt boom'))
    __test.__panelSessions.set(TEST_PANEL, fakeSession)
    __test.__sessionLastUsed.set(TEST_PANEL, Date.now())

    handleUserMessage('hello', undefined, TEST_PANEL)

    await new Promise(r => setTimeout(r, 30))

    expect(fakeSession.dispose).toHaveBeenCalled()
    expect(wsBroadcast).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'error',
      message: expect.stringContaining('prompt boom'),
      panelId: TEST_PANEL,
    }))
  })

  it('101. persistConversation 失败时只 warn 不 throw', async () => {
    persistConversationMock.mockRejectedValueOnce(new Error('DB write failed'))
    const fakeSession = makeFakeSession('persist-err-sid')
    fakeSession.prompt = vi.fn().mockResolvedValue(undefined)
    __test.__panelSessions.set(TEST_PANEL, fakeSession)
    __test.__sessionLastUsed.set(TEST_PANEL, Date.now())

    // 不应 throw
    await expect(
      handleUserMessage('hello', TEST_DEVICE, TEST_PANEL),
    ).resolves.not.toThrow()

    // prompt 仍被调用（persistConversation 失败不阻塞）
    await new Promise(r => setTimeout(r, 10))
    expect(fakeSession.prompt).toHaveBeenCalledWith('hello')
  })
})

// ============================================================================
// getOrCreatePanelSession + restoreSessionContext 边界覆盖
// ============================================================================

describe('piBridge getOrCreatePanelSession 边界覆盖', () => {
  beforeEach(() => {
    __test.__resetInternalState()
    createAgentSessionMock.mockClear()
    createAgentSessionMock.mockResolvedValue({ session: makeFakeSession('edge-session') })
  })

  it('102. 新建 session 时携带 apiConfig 存入 panelSessionApiConfig', async () => {
    const apiConfig = { endpoint: 'http://test', apiKey: 'key', model: 'test/model' }
    const session = await __test.getOrCreatePanelSession(TEST_PANEL, apiConfig)

    expect(session.sessionId).toBe('edge-session')
    expect(__test.__panelSessionApiConfig.get(TEST_PANEL)).toBe(JSON.stringify(apiConfig))
  })

  it('103. restoreSessionContext 失败时只 warn 不 throw（新建 session 路径）', async () => {
    restoreSessionContextMock.mockRejectedValueOnce(new Error('restore failed'))

    const session = await __test.getOrCreatePanelSession(TEST_PANEL)

    // 不应 throw，session 仍被创建
    expect(session.sessionId).toBe('edge-session')
    expect(__test.__panelSessions.get(TEST_PANEL)).toBe(session)
  })

  it('104. restoreSessionContext 失败时只 warn 不 throw（apiConfig 变化路径）', async () => {
    restoreSessionContextMock.mockRejectedValueOnce(new Error('restore failed'))
    const oldSession = makeFakeSession('old-sid')
    oldSession.dispose = vi.fn()
    __test.__panelSessions.set(TEST_PANEL, oldSession)
    __test.__panelSessionApiConfig.set(TEST_PANEL, JSON.stringify({ endpoint: 'old', apiKey: 'old', model: 'old' }))

    const newSession = makeFakeSession('new-sid')
    createAgentSessionMock.mockResolvedValueOnce({ session: newSession })

    const session = await __test.getOrCreatePanelSession(TEST_PANEL, { endpoint: 'new', apiKey: 'new', model: 'new' })

    expect(session).toBe(newSession)
    expect(oldSession.dispose).toHaveBeenCalled()
  })
})
