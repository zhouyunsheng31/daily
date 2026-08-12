/**
 * 状态机 + WS 集成测试 — Phase 11.5.2
 *
 * 测试目标（任务 2.2，4+ 用例）：
 * - 完整状态机周期：idle → thinking → idle（via WS pi_event agent_start/agent_end）
 * - 工具调用状态机：idle → thinking → tool_calling → thinking → idle
 *   （via WS pi_event tool_execution_start/tool_execution_end + agent_end）
 * - session_ready WS 消息设置 activeSessionId
 * - error WS 消息追加错误消息 + status=error
 * - text_delta WS 消息追加文本到 streaming assistant message
 *
 * 与 useAIStore.test.ts 的区别：
 * - useAIStore.test.ts 主要测试 local 模式（via triggerAgentEvent）的状态机
 * - 本测试专注 cloud 模式下的 WS 消息 → 状态机集成（via MockWebSocket.simulateMessage）
 *   验证 WS transport → handleServerMessage → handlePiEvent → state transitions 完整链路
 *
 * Mock 策略（参考 useAIStore.test.ts）：
 * - vi.mock 拦截重依赖（wsToolHandlers / localServiceRegistry / aiData / deviceAuth）
 * - MockWebSocket.installGlobal() 替换全局 WebSocket
 * - setupMockElectronAPI() 注入 window.agentApi（虽然 cloud 模式不调，但避免未定义错误）
 * - setUseAppStoreRef 注入 mock useAppStore（activePanelId='test-panel-id'）
 */
import { describe, beforeEach, afterEach, beforeAll, afterAll, it, expect, vi } from 'vitest'
import { useAIStore, setUseAppStoreRef } from '../useAIStore'
import { useRuntimeModeStore } from '../useRuntimeModeStore'
import { useThinkingLevelStore } from '../useThinkingLevelStore'
import { useApiConfigStore } from '../useApiConfigStore'
import { MockWebSocket } from '@/test/mocks/mockWebSocket'
import { setupMockElectronAPI } from '@/test/mocks/mockElectronAPI'

// ============================================================================
// vi.mock：拦截 useAIStore 的重依赖
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
// Mock useAppStore（用 setUseAppStoreRef 注入）
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
// 测试辅助函数
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

function resetRuntimeModeStore(): void {
  useRuntimeModeStore.setState({
    mode: 'cloud',
    isServerOnline: true,
    effectiveMode: 'cloud',
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

function createTestSession(boundPanelId: string = 'test-panel-id'): string {
  return useAIStore.getState().createSession({
    title: 'Test Session',
    boundPanelId,
    apiConfigId: 'test-preset-1',
    modelId: 'test-model',
  })
}

function flushMicrotasks(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

function forceCloseModuleWs(): void {
  window.dispatchEvent(new Event('beforeunload'))
}

// ============================================================================
// 测试套件
// ============================================================================

describe('状态机 + WS 集成测试', () => {
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
    resetRuntimeModeStore()
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

  // ==========================================================================
  // 1. 完整状态机周期：idle → thinking → idle（via WS pi_event）
  //    验证 WS transport → handleServerMessage → handlePiEvent → state 链路
  // ==========================================================================

  it('1. WS pi_event agent_start → status=thinking，agent_end → status=idle', async () => {
    const sessionId = createTestSession()
    expect(useAIStore.getState().sessions[sessionId].status).toBe('idle')

    // WS 推送 agent_start：状态机应进入 thinking
    MockWebSocket.simulateMessage(mockWs, {
      kind: 'pi_event',
      event: 'agent_start',
      data: {},
      panelId: 'test-panel-id',
    })

    expect(useAIStore.getState().sessions[sessionId].status).toBe('thinking')

    // WS 推送 agent_end：状态机应回到 idle
    MockWebSocket.simulateMessage(mockWs, {
      kind: 'pi_event',
      event: 'agent_end',
      data: {},
      panelId: 'test-panel-id',
    })

    expect(useAIStore.getState().sessions[sessionId].status).toBe('idle')
  })

  // ==========================================================================
  // 2. 工具调用状态机：idle → thinking → tool_calling → thinking → idle
  // ==========================================================================

  it('2. WS pi_event tool_execution_start → status=tool_calling，tool_execution_end → status=thinking', async () => {
    const sessionId = createTestSession()

    // 先进入 thinking（agent_start）
    MockWebSocket.simulateMessage(mockWs, {
      kind: 'pi_event',
      event: 'agent_start',
      data: {},
      panelId: 'test-panel-id',
    })
    expect(useAIStore.getState().sessions[sessionId].status).toBe('thinking')

    // tool_execution_start：状态机应进入 tool_calling
    MockWebSocket.simulateMessage(mockWs, {
      kind: 'pi_event',
      event: 'tool_execution_start',
      data: { toolCallId: 'tc-1', toolName: 'storage_read' },
      panelId: 'test-panel-id',
    })
    expect(useAIStore.getState().sessions[sessionId].status).toBe('tool_calling')

    // tool_execution_end：状态机应回到 thinking（agent 可能继续）
    MockWebSocket.simulateMessage(mockWs, {
      kind: 'pi_event',
      event: 'tool_execution_end',
      data: {},
      panelId: 'test-panel-id',
    })
    expect(useAIStore.getState().sessions[sessionId].status).toBe('thinking')

    // agent_end：最终回到 idle
    MockWebSocket.simulateMessage(mockWs, {
      kind: 'pi_event',
      event: 'agent_end',
      data: {},
      panelId: 'test-panel-id',
    })
    expect(useAIStore.getState().sessions[sessionId].status).toBe('idle')
  })

  // ==========================================================================
  // 3. session_ready WS 消息设置 activeSessionId
  // ==========================================================================

  it('3. WS session_ready 消息设置 activeSessionId', async () => {
    expect(useAIStore.getState().activeSessionId).toBeNull()

    // WS 推送 session_ready
    MockWebSocket.simulateMessage(mockWs, {
      kind: 'session_ready',
      sessionId: 'ws-session-123',
      panelId: 'test-panel-id',
    })

    expect(useAIStore.getState().activeSessionId).toBe('ws-session-123')
  })

  // ==========================================================================
  // 4. error WS 消息追加错误消息 + status=error
  // ==========================================================================

  it('4. WS error 消息追加 [error] 消息到 active session + status=error', async () => {
    const sessionId = createTestSession()
    useAIStore.setState({ activeSessionId: sessionId })
    const beforeMsgCount = useAIStore.getState().sessions[sessionId].messages.length

    // WS 推送 error
    MockWebSocket.simulateMessage(mockWs, {
      kind: 'error',
      message: 'agent runtime crashed',
      panelId: 'test-panel-id',
    })

    const afterSession = useAIStore.getState().sessions[sessionId]
    expect(afterSession.status).toBe('error')
    expect(afterSession.error).toBe('agent runtime crashed')
    // 应追加 [error] 消息
    expect(afterSession.messages.length).toBe(beforeMsgCount + 1)
    const lastMsg = afterSession.messages[afterSession.messages.length - 1]
    expect(lastMsg.role).toBe('assistant')
    expect(lastMsg.content).toContain('[error]')
    expect(lastMsg.content).toContain('agent runtime crashed')
  })

  // ==========================================================================
  // 5. text_delta WS 消息追加文本到 streaming assistant message
  // ==========================================================================

  it('5. WS pi_event message_update text_delta 追加文本到 streaming message', async () => {
    const sessionId = createTestSession()

    // agent_start：创建 streaming assistant message
    MockWebSocket.simulateMessage(mockWs, {
      kind: 'pi_event',
      event: 'agent_start',
      data: {},
      panelId: 'test-panel-id',
    })

    // message_update with text_delta
    MockWebSocket.simulateMessage(mockWs, {
      kind: 'pi_event',
      event: 'message_update',
      data: {
        assistantMessageEvent: {
          type: 'text_delta',
          delta: 'Hello ',
        },
      },
      panelId: 'test-panel-id',
    })

    // 再次 message_update with text_delta
    MockWebSocket.simulateMessage(mockWs, {
      kind: 'pi_event',
      event: 'message_update',
      data: {
        assistantMessageEvent: {
          type: 'text_delta',
          delta: 'World',
        },
      },
      panelId: 'test-panel-id',
    })

    const messages = useAIStore.getState().sessions[sessionId].messages
    const lastMsg = messages[messages.length - 1]
    expect(lastMsg.role).toBe('assistant')
    expect(lastMsg.content).toBe('Hello World')
  })

  // ==========================================================================
  // 6. tool_call WS 消息触发 handleToolCall + 回传 tool_result（via WS.send）
  // ==========================================================================

  it('6. WS tool_call 消息触发 handleToolCall → executeToolCall → WS.send tool_result', async () => {
    const sessionId = createTestSession()
    useAIStore.setState({ activeSessionId: sessionId })

    const sentBefore = mockWs.sentMessages.length

    // WS 推送 tool_call（主进程要求渲染进程执行工具）
    MockWebSocket.simulateMessage(mockWs, {
      kind: 'tool_call',
      requestId: 'tool-call-req-1',
      tool: 'storage_read',
      params: { key: 'test-key' },
      panelId: 'test-panel-id',
    })

    // 等待异步 handleToolCall → executeToolCall → sendWs
    await flushMicrotasks()

    // 应通过 WS.send 回传 tool_result
    const sentAfter = mockWs.sentMessages.length
    expect(sentAfter).toBeGreaterThan(sentBefore)

    // 找到 tool_result 消息
    const toolResultRaw = mockWs.sentMessages[sentAfter - 1] as string
    const toolResult = JSON.parse(toolResultRaw)
    expect(toolResult.kind).toBe('tool_result')
    expect(toolResult.requestId).toBe('tool-call-req-1')
    expect(toolResult.success).toBe(true)
  })

  // ==========================================================================
  // 7. panelId 过滤：非活跃面板的 WS 消息被忽略
  // ==========================================================================

  it('7. WS 消息 panelId 不匹配 activePanelId 时被忽略（状态不变）', async () => {
    const sessionId = createTestSession()
    const beforeStatus = useAIStore.getState().sessions[sessionId].status
    const beforeMsgCount = useAIStore.getState().sessions[sessionId].messages.length

    // WS 推送 panelId 不匹配的消息
    MockWebSocket.simulateMessage(mockWs, {
      kind: 'pi_event',
      event: 'agent_start',
      data: {},
      panelId: 'other-panel-id',
    })

    // 状态不应变化
    expect(useAIStore.getState().sessions[sessionId].status).toBe(beforeStatus)
    expect(useAIStore.getState().sessions[sessionId].messages.length).toBe(beforeMsgCount)
  })

  // ==========================================================================
  // 8. ask_user WS 消息存入 pendingAskUserRequests + status=waiting_user_input
  // ==========================================================================

  it('8. WS ask_user 消息存入 pendingAskUserRequests + status=waiting_user_input', async () => {
    const sessionId = createTestSession()
    useAIStore.setState({ activeSessionId: sessionId })

    // WS 推送 ask_user
    MockWebSocket.simulateMessage(mockWs, {
      kind: 'ask_user',
      panelId: 'test-panel-id',
      requestId: 'ask-req-1',
      question: '确认执行此操作?',
      options: [{ label: 'Yes', value: 'yes' }, { label: 'No', value: 'no' }],
      allowMultiple: false,
    })

    const afterSession = useAIStore.getState().sessions[sessionId]
    expect(afterSession.status).toBe('waiting_user_input')

    // pendingAskUserRequests 应有一条记录
    const pending = useAIStore.getState().pendingAskUserRequests
    expect(pending.size).toBe(1)
    expect(pending.has('ask-req-1')).toBe(true)

    // session.messages 应追加 askUser 消息
    const lastMsg = afterSession.messages[afterSession.messages.length - 1]
    expect(lastMsg.role).toBe('assistant')
    expect(lastMsg.askUser).toBeDefined()
    expect(lastMsg.askUser?.requestId).toBe('ask-req-1')
    expect(lastMsg.askUser?.question).toBe('确认执行此操作?')
  })
})
