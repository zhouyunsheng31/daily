/**
 * piBridge permission_request 链路单测 — Phase 13.2.2
 *
 * 覆盖：
 * 1. executeWithPermission 发送 permission_request 到面板活跃设备
 * 2. handlePermissionResponse(approved=true) → resolve { approved: true }
 * 3. handlePermissionResponse(approved=false) → resolve { approved: false }
 * 4. handlePermissionResponse 对未知 requestId 是 no-op
 * 5. executeWithPermission 超时 reject
 * 6. executeWithPermission 无活跃设备时 throw
 * 7. executeWithPermission sendToDevice 返回 false 时 reject
 *
 * Mock 策略：
 * - vi.mock('../src/ws.js')：拦截 sendToDevice，捕获调用参数
 * - vi.mock('../src/db/*')：避免触发 pg native binding
 * - vi.mock('@earendil-works/pi-coding-agent')：避免加载重依赖
 * - vi.mock('typebox')：Type.* 构造器 stub
 * - 通过 setPanelActiveDevice（export）设置 panelActiveDevices
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// ============================================================================
// vi.mock：拦截 piBridge 的重依赖（hoisted，在 import 之前执行）
// ============================================================================

vi.mock('@earendil-works/pi-coding-agent', () => ({
  AuthStorage: class {},
  createAgentSession: vi.fn(),
  DefaultResourceLoader: class {},
  getAgentDir: vi.fn(),
  ModelRegistry: class {},
  SessionManager: class {},
}))

vi.mock('typebox', () => ({
  // 用 Proxy 让所有 Type.xxx 调用返回空对象（piBridge 顶层模块级只构造一次 ToolDefinition 参数 schema）
  Type: new Proxy({}, {
    get: () => () => ({}),
  }),
}))

vi.mock('../src/db/aiContext.js', () => ({
  persistConversation: vi.fn(),
  restoreSessionContext: vi.fn(),
  persistPiEvent: vi.fn(),
}))

vi.mock('../src/db/aiSettingsStore.js', () => ({
  getAiSettings: vi.fn().mockResolvedValue({}),
  getPromptOverrides: vi.fn().mockResolvedValue({}),
  clearPromptCache: vi.fn(),
  DEFAULT_PROMPTS: {},
}))

vi.mock('../src/db/connection.js', () => ({
  getPool: vi.fn(),
}))

vi.mock('../src/utils/aiTools.js', () => ({
  AI_TOOL_MAP: {},
  DISABLEABLE_TOOL_NAMES: [],
}))

vi.mock('../src/utils/searchTools.js', () => ({
  searchTools: [],
  withSearchUser: <T>(_scope: string, fn: () => Promise<T>) => fn(),
  getSearchUserKey: () => null,
}))

vi.mock('../src/utils/capabilityTools.js', () => ({
  queryCapabilitiesTool: {},
}))

// 关键 mock：拦截 sendToDevice，返回 true 让 executeWithPermission 进入 pending
vi.mock('../src/ws.js', () => ({
  onClientMessage: vi.fn(),
  onClientConnect: vi.fn(),
  onClientDisconnect: vi.fn(),
  onErrorReport: vi.fn(),
  sendToClient: vi.fn(),
  sendToDevice: vi.fn().mockReturnValue(true),
  sendToolCall: vi.fn(),
  broadcast: vi.fn(),
  hasClient: vi.fn(),
  hasDevice: vi.fn(),
}))

// ============================================================================
// 动态 import（在 mock 生效后）
// ============================================================================

const piBridge = await import('../src/piBridge.js')
const { executeWithPermission, handlePermissionResponse, setPanelActiveDevice } = piBridge

const wsModule = await import('../src/ws.js')
const sendToDeviceMock = wsModule.sendToDevice as unknown as ReturnType<typeof vi.fn>

const TEST_PANEL = 'test-panel-perm'
const TEST_DEVICE = 'test-device-perm'

describe('piBridge permission_request 链路', () => {
  beforeEach(() => {
    sendToDeviceMock.mockClear()
    sendToDeviceMock.mockReturnValue(true)
    setPanelActiveDevice(TEST_PANEL, TEST_DEVICE)
  })

  it('1. executeWithPermission 发送 permission_request 到面板活跃设备', async () => {
    const promise = executeWithPermission(TEST_PANEL, {
      toolName: 'storage_write',
      description: '写入存储：key=foo',
      permission: 'write',
      arguments: { key: 'foo' },
    })

    expect(sendToDeviceMock).toHaveBeenCalledTimes(1)
    const [deviceId, msg] = sendToDeviceMock.mock.calls[0]
    expect(deviceId).toBe(TEST_DEVICE)
    expect(msg.kind).toBe('permission_request')
    expect(msg.panelId).toBe(TEST_PANEL)
    expect(msg.toolName).toBe('storage_write')
    expect(msg.permission).toBe('write')
    expect(msg.description).toBe('写入存储：key=foo')
    expect(msg.arguments).toEqual({ key: 'foo' })
    expect(typeof msg.requestId).toBe('string')
    expect(msg.requestId.startsWith('perm-')).toBe(true)

    // 通过 handlePermissionResponse resolve
    handlePermissionResponse({ requestId: msg.requestId, approved: true })
    const result = await promise
    expect(result).toEqual({ approved: true })
  })

  it('2. handlePermissionResponse(approved=true) → resolve { approved: true }', async () => {
    const promise = executeWithPermission(TEST_PANEL, {
      toolName: 'storage_write',
      description: 'd',
      permission: 'write',
      arguments: {},
    })
    const msg = sendToDeviceMock.mock.calls[0][1]
    handlePermissionResponse({ requestId: msg.requestId, approved: true })
    await expect(promise).resolves.toEqual({ approved: true })
  })

  it('3. handlePermissionResponse(approved=false) → resolve { approved: false }', async () => {
    const promise = executeWithPermission(TEST_PANEL, {
      toolName: 'delete_html_widget',
      description: 'd',
      permission: 'dangerous',
      irreversible: true,
      arguments: { id: 'w1' },
    })
    const msg = sendToDeviceMock.mock.calls[0][1]
    // 验证 dangerous 工具的 irreversible 字段透传
    expect(msg.irreversible).toBe(true)
    expect(msg.permission).toBe('dangerous')

    handlePermissionResponse({ requestId: msg.requestId, approved: false })
    await expect(promise).resolves.toEqual({ approved: false })
  })

  it('4. handlePermissionResponse 对未知 requestId 是 no-op（不抛错）', () => {
    expect(() => handlePermissionResponse({ requestId: 'unknown-id', approved: true })).not.toThrow()
  })

  it('5. executeWithPermission 超时 reject（permission timeout）', async () => {
    vi.useFakeTimers()
    try {
      const promise = executeWithPermission(TEST_PANEL, {
        toolName: 't',
        description: 'd',
        permission: 'write',
        arguments: {},
      })
      // 推进 120s 触发超时
      vi.advanceTimersByTime(120_000)
      await expect(promise).rejects.toThrow(/permission timeout/)
    } finally {
      vi.useRealTimers()
    }
  })

  it('6. executeWithPermission 无活跃设备时同步 throw', async () => {
    await expect(
      executeWithPermission('no-such-panel', {
        toolName: 't',
        description: 'd',
        permission: 'write',
        arguments: {},
      }),
    ).rejects.toThrow(/no active device for panel no-such-panel/)
    // sendToDevice 不应被调用
    expect(sendToDeviceMock).not.toHaveBeenCalled()
  })

  it('7. executeWithPermission sendToDevice 返回 false 时 reject', async () => {
    sendToDeviceMock.mockReturnValueOnce(false)
    await expect(
      executeWithPermission(TEST_PANEL, {
        toolName: 't',
        description: 'd',
        permission: 'write',
        arguments: {},
      }),
    ).rejects.toThrow(/failed to send permission_request/)
  })

  it('8. callerWidgetId 在上下文中时透传到 permission_request 消息', async () => {
    // 默认无 callerWidgetId 上下文，msg.callerWidgetId 应为 undefined
    const promise = executeWithPermission(TEST_PANEL, {
      toolName: 't',
      description: 'd',
      permission: 'write',
      arguments: {},
    })
    const msg = sendToDeviceMock.mock.calls[0][1]
    expect(msg.callerWidgetId).toBeUndefined()
    handlePermissionResponse({ requestId: msg.requestId, approved: true })
    await promise
  })
})
