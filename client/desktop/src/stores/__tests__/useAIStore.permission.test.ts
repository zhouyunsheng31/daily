/**
 * useAIStore permission_request 链路单测 — Phase 13.2.2
 *
 * 覆盖：
 * 1. 收到 permission_request WS 消息 → pendingPermissionRequests 更新
 * 2. permission_request 字段映射（toolName/permission/irreversible/callerWidgetId/arguments）
 * 3. respondToPermission(approved=true) → 发送 permission_response WS 消息
 * 4. respondToPermission(approved=false) → 发送 permission_response WS 消息
 * 5. respondToPermission(rememberChoice=true) → WS 消息携带 rememberChoice
 * 6. respondToPermission 后 _permissionResponses 更新
 *
 * Mock 策略：复用 useAIStore.test.ts 的 mock 模式
 * - vi.mock wsToolHandlers / localServiceRegistry / dbStores/aiData / deviceAuth
 * - MockWebSocket.installGlobal() + setupMockElectronAPI()
 * - setUseAppStoreRef 注入 mock useAppStore
 */
import { describe, beforeEach, afterEach, beforeAll, afterAll, it, expect, vi } from 'vitest'
import { useAIStore, setUseAppStoreRef } from '../useAIStore'
import { useRuntimeModeStore } from '../useRuntimeModeStore'
import { useThinkingLevelStore } from '../useThinkingLevelStore'
import { useApiConfigStore } from '../useApiConfigStore'
import { MockWebSocket } from '@/test/mocks/mockWebSocket'
import { setupMockElectronAPI } from '@/test/mocks/mockElectronAPI'

// ============================================================================
// vi.mock：拦截 useAIStore 的重依赖（与 useAIStore.test.ts 一致）
// ============================================================================

vi.mock('@/utils/wsToolHandlers', () => ({
  executeToolCall: vi.fn().mockResolvedValue({ success: true, data: { ok: true } }),
}))

vi.mock('@/utils/localServiceRegistry', () => ({
  localServiceRegistry: {
    loadConfig: vi.fn().mockResolvedValue(undefined),
    registerAll: vi.fn().mockResolvedValue(undefined),
    startHeartbeat: vi.fn(),
    stopHeartbeat: vi.fn(),
    unregisterAll: vi.fn().mockResolvedValue(undefined),
    handleProxyRequest: vi.fn().mockResolvedValue({
      requestId: 'mock',
      status: 200,
      headers: {},
      body: '',
    }),
  },
}))

vi.mock('@/utils/dbStores/aiData', () => ({
  getAllAIMemories: vi.fn().mockResolvedValue([]),
  updateAIMemory: vi.fn().mockResolvedValue(undefined),
  toggleAIMemoryPin: vi.fn().mockResolvedValue(undefined),
  deleteAIMemory: vi.fn().mockResolvedValue(undefined),
  clearAllAIMemories: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/utils/deviceAuth', () => ({
  getDeviceId: vi.fn().mockReturnValue('test-device-id-1234'),
  getServerToken: vi.fn().mockReturnValue('test-token'),
}))

// ============================================================================
// Mock useAppStore
// ============================================================================

const mockAppStore = {
  getState: vi.fn().mockReturnValue({
    activePanelId: 'test-panel-id',
  }),
  setState: vi.fn(),
  subscribe: vi.fn(),
  getInitialState: vi.fn().mockReturnValue({ activePanelId: 'test-panel-id' }),
}

// ============================================================================
// 测试辅助（与 useAIStore.test.ts 一致）
// ============================================================================

function resetAIStoreState(): void {
  useAIStore.setState({
    sessions: {},
    activeSessionId: null,
    sessionList: [],
    llmConfig: null,
    availableModels: [],
    pendingPermissionRequests: new Map(),
    _permissionResponses: new Map(),
    pendingAskUserRequests: new Map(),
    privacySettings: {
      hasAcceptedPrivacyNotice: false,
      aiReadableStores: [],
      apiKeyStorage: null,
    },
    isInitialized: false,
    isOnline: false,
    memories: [],
  })
}

function resetRuntimeModeStore(effectiveMode: 'cloud' | 'local' = 'cloud'): void {
  useRuntimeModeStore.setState({
    mode: effectiveMode,
    isServerOnline: effectiveMode === 'cloud',
    effectiveMode,
    isOfflineDowngraded: false,
    _debounceTimer: null,
  })
}

function resetThinkingLevelStore(): void {
  useThinkingLevelStore.setState({
    currentLevel: 'medium',
    defaultLevel: 'medium',
  })
}

function resetApiConfigStore(): void {
  useApiConfigStore.setState({
    presets: [
      {
        id: 'test-preset-1',
        name: 'Test Preset',
        endpoint: 'https://test.example.com/v1/chat/completions',
        apiKey: 'test-api-key',
        provider: 'test',
        models: ['test-model'],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ],
    activePresetId: 'test-preset-1',
  })
}

function flushMicrotasks(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

function forceCloseModuleWs(): void {
  window.dispatchEvent(new Event('beforeunload'))
}

/** 构造一条 permission_request 服务端消息 */
function buildPermissionRequest(overrides: Partial<{
  requestId: string
  panelId: string
  toolName: string
  description: string
  permission: string
  storeName: string
  irreversible: boolean
  callerWidgetId: string
  arguments: Record<string, unknown>
}> = {}): Record<string, unknown> {
  return {
    kind: 'permission_request',
    requestId: overrides.requestId ?? 'perm-test-1',
    panelId: overrides.panelId ?? 'test-panel-id',
    toolName: overrides.toolName ?? 'storage_write',
    description: overrides.description ?? '写入存储：key=foo',
    permission: overrides.permission ?? 'write',
    irreversible: overrides.irreversible ?? false,
    arguments: overrides.arguments ?? { key: 'foo' },
    ...('storeName' in overrides ? { storeName: overrides.storeName } : {}),
    ...('callerWidgetId' in overrides ? { callerWidgetId: overrides.callerWidgetId } : {}),
  }
}

// ============================================================================
// 测试套件
// ============================================================================

describe('useAIStore permission_request 链路', () => {
  let restoreWs: () => void
  let restoreElectron: () => void
  let mockWs: MockWebSocket

  beforeAll(() => {
    setUseAppStoreRef(() => mockAppStore as unknown as typeof import('../useAppStore')['useAppStore'])
    restoreWs = MockWebSocket.installGlobal()
    restoreElectron = setupMockElectronAPI()
  })

  afterAll(() => {
    restoreWs()
    restoreElectron()
  })

  beforeEach(async () => {
    window.localStorage.clear()
    forceCloseModuleWs()
    MockWebSocket.reset()

    resetAIStoreState()
    resetRuntimeModeStore('cloud')
    resetThinkingLevelStore()
    resetApiConfigStore()

    mockAppStore.getState.mockReset()
    mockAppStore.getState.mockReturnValue({ activePanelId: 'test-panel-id' })

    // initialize 触发 connectWs
    await useAIStore.getState().initialize()
    mockWs = MockWebSocket.lastInstance()!
    expect(mockWs).toBeDefined()
    MockWebSocket.simulateOpen(mockWs)
    await flushMicrotasks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('1. 收到 permission_request → pendingPermissionRequests 更新', async () => {
    const msg = buildPermissionRequest({ requestId: 'perm-1' })
    MockWebSocket.simulateMessage(mockWs, msg)
    await flushMicrotasks()

    const pending = useAIStore.getState().pendingPermissionRequests
    expect(pending.size).toBe(1)
    const req = pending.get('perm-1')
    expect(req).toBeDefined()
    expect(req!.toolName).toBe('storage_write')
    expect(req!.permission).toBe('write')
    expect(req!.description).toBe('写入存储：key=foo')
    expect(req!.arguments).toEqual({ key: 'foo' })
    expect(req!.irreversible).toBe(false)
  })

  it('2. permission_request 字段映射（dangerous + irreversible + callerWidgetId + storeName）', async () => {
    const msg = buildPermissionRequest({
      requestId: 'perm-2',
      toolName: 'delete_html_widget',
      description: '删除 HTML 组件：id=w1',
      permission: 'dangerous',
      irreversible: true,
      callerWidgetId: 'test-panel-id',
      storeName: 'htmlWidgets',
      arguments: { id: 'w1' },
    })
    MockWebSocket.simulateMessage(mockWs, msg)
    await flushMicrotasks()

    const req = useAIStore.getState().pendingPermissionRequests.get('perm-2')!
    expect(req.toolName).toBe('delete_html_widget')
    expect(req.permission).toBe('dangerous')
    expect(req.irreversible).toBe(true)
    expect(req.callerWidgetId).toBe('test-panel-id')
    expect(req.storeName).toBe('htmlWidgets')
    expect(req.arguments).toEqual({ id: 'w1' })
  })

  it('3. respondToPermission(approved=true) → 发送 permission_response WS 消息', async () => {
    const msg = buildPermissionRequest({ requestId: 'perm-3' })
    MockWebSocket.simulateMessage(mockWs, msg)
    await flushMicrotasks()

    const sentBefore = mockWs.sentMessages.length
    useAIStore.getState().respondToPermission('perm-3', { approved: true })
    await flushMicrotasks()

    expect(mockWs.sentMessages.length).toBeGreaterThan(sentBefore)
    const sentRaw = mockWs.sentMessages[mockWs.sentMessages.length - 1] as string
    const sent = JSON.parse(sentRaw)
    expect(sent.kind).toBe('permission_response')
    expect(sent.requestId).toBe('perm-3')
    expect(sent.approved).toBe(true)
  })

  it('4. respondToPermission(approved=false) → 发送 permission_response WS 消息', async () => {
    const msg = buildPermissionRequest({ requestId: 'perm-4' })
    MockWebSocket.simulateMessage(mockWs, msg)
    await flushMicrotasks()

    useAIStore.getState().respondToPermission('perm-4', { approved: false })
    await flushMicrotasks()

    const sentRaw = mockWs.sentMessages[mockWs.sentMessages.length - 1] as string
    const sent = JSON.parse(sentRaw)
    expect(sent.kind).toBe('permission_response')
    expect(sent.requestId).toBe('perm-4')
    expect(sent.approved).toBe(false)
  })

  it('5. respondToPermission(rememberChoice=true) → WS 消息携带 rememberChoice', async () => {
    const msg = buildPermissionRequest({ requestId: 'perm-5' })
    MockWebSocket.simulateMessage(mockWs, msg)
    await flushMicrotasks()

    useAIStore.getState().respondToPermission('perm-5', { approved: true, rememberChoice: true })
    await flushMicrotasks()

    const sentRaw = mockWs.sentMessages[mockWs.sentMessages.length - 1] as string
    const sent = JSON.parse(sentRaw)
    expect(sent.rememberChoice).toBe(true)
  })

  it('6. respondToPermission 后 _permissionResponses 更新', async () => {
    const msg = buildPermissionRequest({ requestId: 'perm-6' })
    MockWebSocket.simulateMessage(mockWs, msg)
    await flushMicrotasks()

    useAIStore.getState().respondToPermission('perm-6', { approved: true })
    await flushMicrotasks()

    const responses = useAIStore.getState()._permissionResponses
    expect(responses.size).toBe(1)
    expect(responses.get('perm-6')).toEqual({ approved: true })
  })

  it('7. 收到多条 permission_request → pendingPermissionRequests 累加', async () => {
    MockWebSocket.simulateMessage(mockWs, buildPermissionRequest({ requestId: 'perm-7a' }))
    await flushMicrotasks()
    MockWebSocket.simulateMessage(mockWs, buildPermissionRequest({ requestId: 'perm-7b', toolName: 'browser_eval', permission: 'dangerous' }))
    await flushMicrotasks()

    const pending = useAIStore.getState().pendingPermissionRequests
    expect(pending.size).toBe(2)
    expect(pending.get('perm-7a')!.toolName).toBe('storage_write')
    expect(pending.get('perm-7b')!.toolName).toBe('browser_eval')
    expect(pending.get('perm-7b')!.permission).toBe('dangerous')
  })

  it('8. respondToPermission 对未知 requestId 仍发送 WS（防御性，不阻塞 UI）', async () => {
    const sentBefore = mockWs.sentMessages.length
    useAIStore.getState().respondToPermission('unknown-perm-id', { approved: false })
    await flushMicrotasks()

    expect(mockWs.sentMessages.length).toBeGreaterThan(sentBefore)
    const sentRaw = mockWs.sentMessages[mockWs.sentMessages.length - 1] as string
    const sent = JSON.parse(sentRaw)
    expect(sent.requestId).toBe('unknown-perm-id')
    expect(sent.approved).toBe(false)
  })
})
