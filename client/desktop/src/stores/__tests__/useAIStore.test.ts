/**
 * useAIStore 单元测试 — Phase 11.2 P0
 *
 * 覆盖重点：
 * 1. 状态管理基础（sessions / activeSessionId / pendingPermissionRequests）
 * 2. sendMessage cloud 模式分流（走 WebSocket.send）
 * 3. sendMessage local 模式分流（走 window.agentApi.sendMessage）
 * 4. handleAgentEvent 事件处理（text_delta / tool_call / tool_result / turn_end / error）
 *
 * Mock 策略：
 * - vi.mock('@/utils/wsToolHandlers')：拦截 executeToolCall，避免触发 useAppStore 加载链
 * - vi.mock('@/utils/localServiceRegistry')：拦截 WS onopen 中的副作用
 * - vi.mock('@/utils/dbStores/aiData')：拦截 idb 加载
 * - vi.mock('@/utils/deviceAuth')：固定 deviceId / token
 * - MockWebSocket.installGlobal()：替换全局 WebSocket（beforeAll 一次）
 * - setupMockElectronAPI()：注入 window.agentApi / aiKeyApi / toolBridgeApi（beforeAll 一次）
 * - setUseAppStoreRef(() => mockAppStore)：注入 mock useAppStore
 *
 * WS 生命周期管理：
 * - useAIStore 模块级 ws 变量在测试间持久，需要 beforeunload event 触发 closeWs() 清理
 * - beforeEach 中重置 store 业务状态，再 initialize 触发新 ws 创建 + simulateOpen
 *
 * 注意：handleAgentEvent 是 closure-private，无法直接调用，
 *      通过 setupMockElectronAPI + triggerAgentEvent 间接触发（local 模式路径）。
 */
import { describe, beforeEach, afterEach, beforeAll, afterAll, it, expect, vi } from 'vitest'
import { useAIStore, setUseAppStoreRef } from '../useAIStore'
import { useRuntimeModeStore } from '../useRuntimeModeStore'
import { useThinkingLevelStore } from '../useThinkingLevelStore'
import { useApiConfigStore } from '../useApiConfigStore'
import { MockWebSocket } from '@/test/mocks/mockWebSocket'
import {
  setupMockElectronAPI,
  triggerAgentEvent,
} from '@/test/mocks/mockElectronAPI'
import type { AgentEvent } from '@/types/electron'

// ============================================================================
// vi.mock：拦截 useAIStore 的重依赖（避免触发 useAppStore / idb / 网络等）
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
// 测试辅助
// ============================================================================

/** 重置 useAIStore 到初始状态（不重置 isInitialized，避免触发 WS 重连） */
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

/** 重置 useRuntimeModeStore */
function resetRuntimeModeStore(effectiveMode: 'cloud' | 'local' = 'cloud'): void {
  useRuntimeModeStore.setState({
    mode: effectiveMode,
    isServerOnline: effectiveMode === 'cloud',
    effectiveMode,
    isOfflineDowngraded: false,
    _debounceTimer: null,
  })
}

/** 重置 useThinkingLevelStore */
function resetThinkingLevelStore(): void {
  useThinkingLevelStore.setState({
    currentLevel: 'medium',
    defaultLevel: 'medium',
  })
}

/** 重置 useApiConfigStore，注入一个默认 preset */
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

/** 创建一个 session 并返回 sessionId */
function createTestSession(boundPanelId: string | undefined = 'test-panel-id'): string {
  return useAIStore.getState().createSession({
    title: 'Test Session',
    boundPanelId,
    apiConfigId: 'test-preset-1',
    modelId: 'test-model',
  })
}

/** 等待所有 microtask 完成（用于 async action） */
function flushMicrotasks(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

/**
 * 强制清理 useAIStore 的 module-level ws 变量：
 * 触发 beforeunload event → useAIStore 顶层的 closeWs() 监听器 → ws=null + wsManuallyClosed=true
 * 然后通过 initialize() 重置 wsManuallyClosed=false 并重新 connectWs()。
 */
function forceCloseModuleWs(): void {
  window.dispatchEvent(new Event('beforeunload'))
}

// ============================================================================
// 测试套件
// ============================================================================

describe('useAIStore', () => {
  let restoreWs: () => void
  let restoreElectron: () => void

  beforeAll(() => {
    // 注入 mock useAppStore ref（替代真实 useAppStore，避免触发其加载链）
    setUseAppStoreRef(() => mockAppStore as unknown as typeof import('../useAppStore')['useAppStore'])
    // 安装 mock WebSocket（全局只装一次）
    restoreWs = MockWebSocket.installGlobal()
    // 安装 mock Electron API（全局只装一次）
    restoreElectron = setupMockElectronAPI()
  })

  afterAll(() => {
    restoreWs()
    restoreElectron()
  })

  beforeEach(() => {
    // 清空 localStorage（避免之前测试的 sessionList 等污染）
    window.localStorage.clear()

    // 强制清理 module-level ws（让 connectWs 下次能创建新 ws）
    forceCloseModuleWs()

    // 重置 MockWebSocket instances
    MockWebSocket.reset()

    // 重置所有相关 store
    resetAIStoreState()
    resetRuntimeModeStore('cloud')
    resetThinkingLevelStore()
    resetApiConfigStore()

    // 重置 mockAppStore 调用计数 + 恢复默认返回值
    mockAppStore.getState.mockReset()
    mockAppStore.getState.mockReturnValue({ activePanelId: 'test-panel-id' })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // ==========================================================================
  // 状态管理基础（5 个）
  // ==========================================================================

  describe('状态管理基础', () => {
    it('1. 初始 sessions 为空对象', () => {
      expect(useAIStore.getState().sessions).toEqual({})
    })

    it('2. 初始 activeSessionId 为 null', () => {
      expect(useAIStore.getState().activeSessionId).toBeNull()
    })

    it('3. 初始 pendingPermissionRequests 为空 Map', () => {
      expect(useAIStore.getState().pendingPermissionRequests).toBeInstanceOf(Map)
      expect(useAIStore.getState().pendingPermissionRequests.size).toBe(0)
    })

    it('4. createSession 后 sessions 长度 +1 且 activeSessionId 设为新 sessionId', () => {
      const beforeCount = Object.keys(useAIStore.getState().sessions).length
      const sessionId = createTestSession()
      const afterState = useAIStore.getState()

      expect(Object.keys(afterState.sessions).length).toBe(beforeCount + 1)
      expect(afterState.sessions[sessionId]).toBeDefined()
      expect(afterState.activeSessionId).toBe(sessionId)
      // 验证 session 内容
      const session = afterState.sessions[sessionId]
      expect(session.messages).toEqual([])
      expect(session.status).toBe('idle')
      expect(session.boundPanelId).toBe('test-panel-id')
    })

    it('5. deleteSession 后 sessions 长度 -1', async () => {
      const sessionId = createTestSession()
      expect(Object.keys(useAIStore.getState().sessions).length).toBe(1)

      await useAIStore.getState().deleteSession(sessionId)

      expect(useAIStore.getState().sessions[sessionId]).toBeUndefined()
    })
  })

  // ==========================================================================
  // sendMessage cloud 模式分流（5 个）
  // ==========================================================================

  describe('sendMessage cloud 模式分流', () => {
    let mockWs: MockWebSocket

    beforeEach(async () => {
      // 确保 cloud 模式
      resetRuntimeModeStore('cloud')
      resetApiConfigStore()

      // initialize 触发 connectWs（forceCloseModuleWs 已让 ws=null, wsManuallyClosed=true）
      // resetAIStoreState 已设 isInitialized=false，initialize 会重置 wsManuallyClosed=false
      await useAIStore.getState().initialize()
      mockWs = MockWebSocket.lastInstance()!
      expect(mockWs).toBeDefined()
      // 模拟 WS 连接 open
      MockWebSocket.simulateOpen(mockWs)
      // 等待 onopen 异步副作用完成（localServiceRegistry.registerAll 等）
      await flushMicrotasks()

      // 清空 agentApi.sendMessage 调用计数（setupMockElectronAPI 在 beforeAll 已装）
      const agentSendMessage = window.agentApi!.sendMessage as ReturnType<typeof vi.fn>
      agentSendMessage.mockClear()
    })

    it('6. cloud 模式 sendMessage → 触发 WebSocket.send', async () => {
      const sessionId = createTestSession()
      const sentBefore = mockWs.sentMessages.length

      await useAIStore.getState().sendMessage(sessionId, 'hello cloud')

      expect(mockWs.sentMessages.length).toBeGreaterThan(sentBefore)
    })

    it('7. cloud 模式 sendMessage → 不调用 window.agentApi.sendMessage', async () => {
      const sessionId = createTestSession()
      const agentSendMessage = window.agentApi!.sendMessage as ReturnType<typeof vi.fn>

      await useAIStore.getState().sendMessage(sessionId, 'hello cloud')

      expect(agentSendMessage).not.toHaveBeenCalled()
    })

    it('8. cloud 模式发送的 WS 消息格式正确（kind/panelId/content/sessionId）', async () => {
      const sessionId = createTestSession()
      await useAIStore.getState().sendMessage(sessionId, 'hello format')

      // 取最后一条 send 的消息（可能还有 ping）
      const sentRaw = mockWs.sentMessages[mockWs.sentMessages.length - 1] as string
      const sent = JSON.parse(sentRaw)
      expect(sent.kind).toBe('user_message')
      expect(sent.content).toBe('hello format')
      expect(sent.sessionId).toBe(sessionId)
      expect(sent.panelId).toBe('test-panel-id')
    })

    it('9. cloud 模式 sendMessage → append user message 到 session.messages', async () => {
      const sessionId = createTestSession()
      const beforeCount = useAIStore.getState().sessions[sessionId].messages.length

      await useAIStore.getState().sendMessage(sessionId, 'user input text')

      const afterMessages = useAIStore.getState().sessions[sessionId].messages
      expect(afterMessages.length).toBe(beforeCount + 1)
      // 最后一条应该是 user message
      const lastMsg = afterMessages[afterMessages.length - 1]
      expect(lastMsg.role).toBe('user')
      expect(lastMsg.content).toBe('user input text')
    })

    it('10. cloud 模式 sendMessage → session.status 变为 thinking', async () => {
      const sessionId = createTestSession()
      expect(useAIStore.getState().sessions[sessionId].status).toBe('idle')

      await useAIStore.getState().sendMessage(sessionId, 'think please')

      expect(useAIStore.getState().sessions[sessionId].status).toBe('thinking')
    })
  })

  // ==========================================================================
  // sendMessage local 模式分流（5 个）
  // ==========================================================================

  describe('sendMessage local 模式分流', () => {
    beforeEach(() => {
      // 切到 local 模式
      resetRuntimeModeStore('local')
      // local 模式不需要 WS，不调 initialize
    })

    it('11. local 模式 sendMessage → 调用 window.agentApi.sendMessage', async () => {
      const sessionId = createTestSession()
      const agentSendMessage = window.agentApi!.sendMessage as ReturnType<typeof vi.fn>
      agentSendMessage.mockClear()

      await useAIStore.getState().sendMessage(sessionId, 'hello local')

      expect(agentSendMessage).toHaveBeenCalledTimes(1)
      const payload = agentSendMessage.mock.calls[0][0] as {
        panelId: string
        message: string
        thinkingLevel: string
      }
      expect(payload.message).toBe('hello local')
    })

    it('12. local 模式 sendMessage → 不调用 WebSocket.send', async () => {
      const sessionId = createTestSession()
      // local 模式不应触发任何 WS send
      // 检查所有 MockWebSocket 实例的 sentMessages 都没有 user_message
      const sentBefore = MockWebSocket.allInstances().reduce(
        (sum, w) => sum + w.sentMessages.length,
        0,
      )

      await useAIStore.getState().sendMessage(sessionId, 'hello local')

      const sentAfter = MockWebSocket.allInstances().reduce(
        (sum, w) => sum + w.sentMessages.length,
        0,
      )
      expect(sentAfter).toBe(sentBefore)
    })

    it('13. local 模式 sendMessage payload 含 panelId / message / thinkingLevel', async () => {
      const sessionId = createTestSession()
      const agentSendMessage = window.agentApi!.sendMessage as ReturnType<typeof vi.fn>
      agentSendMessage.mockClear()

      await useAIStore.getState().sendMessage(sessionId, 'check payload')

      expect(agentSendMessage).toHaveBeenCalledTimes(1)
      const payload = agentSendMessage.mock.calls[0][0] as {
        panelId: string
        message: string
        thinkingLevel: string
      }
      expect(payload.panelId).toBeDefined()
      expect(typeof payload.panelId).toBe('string')
      expect(payload.message).toBe('check payload')
      expect(payload.thinkingLevel).toBeDefined()
      // useThinkingLevelStore 默认 'medium'，mapThinkingLevelToPi 应映射到 'medium'
      expect(payload.thinkingLevel).toBe('medium')
    })

    it('14. local 模式 sendMessage → 调用 agentApi.onEvent 注册回调（返回 unsubscribe）', async () => {
      const sessionId = createTestSession()
      const agentOnEvent = window.agentApi!.onEvent as ReturnType<typeof vi.fn>
      agentOnEvent.mockClear()

      await useAIStore.getState().sendMessage(sessionId, 'subscribe test')

      expect(agentOnEvent).toHaveBeenCalledTimes(1)
      // onEvent 应该返回一个清理函数
      const returnedCleanup = agentOnEvent.mock.results[0].value
      expect(typeof returnedCleanup).toBe('function')
    })

    it('15. local 模式 sendMessage → session.status 变为 thinking + 添加空 assistant 消息', async () => {
      const sessionId = createTestSession()

      await useAIStore.getState().sendMessage(sessionId, 'think locally')

      const afterSession = useAIStore.getState().sessions[sessionId]
      expect(afterSession.status).toBe('thinking')
      // ensureStreamingAssistantMessage 应该添加一个空 assistant message
      const lastMsg = afterSession.messages[afterSession.messages.length - 1]
      expect(lastMsg.role).toBe('assistant')
      expect(lastMsg.content).toBe('')
    })
  })

  // ==========================================================================
  // handleAgentEvent 事件处理（5 个）
  // 注意：handleAgentEvent 是 closure-private，通过 triggerAgentEvent 间接触发
  // ==========================================================================

  describe('handleAgentEvent 事件处理', () => {
    let sessionId: string
    const testPanelId = 'test-panel-id'

    beforeEach(async () => {
      // local 模式触发 sendMessage 才会订阅 onEvent，handleAgentEvent 才能被触发
      resetRuntimeModeStore('local')
      sessionId = createTestSession()
      // 清空之前的 onEvent 注册计数
      const agentOnEvent = window.agentApi!.onEvent as ReturnType<typeof vi.fn>
      agentOnEvent.mockClear()
      await useAIStore.getState().sendMessage(sessionId, 'setup streaming')
    })

    it('16. text_delta → 追加文本到当前 streaming assistant message', () => {
      // 此时已有空 assistant message（sendMessage 时已 ensureStreaming）
      const beforeContent = useAIStore.getState().sessions[sessionId].messages.slice(-1)[0].content
      expect(beforeContent).toBe('')

      const event: AgentEvent = { type: 'text_delta', text: 'Hello ' }
      triggerAgentEvent(testPanelId, event)

      const event2: AgentEvent = { type: 'text_delta', text: 'World' }
      triggerAgentEvent(testPanelId, event2)

      const afterMessages = useAIStore.getState().sessions[sessionId].messages
      const lastMsg = afterMessages[afterMessages.length - 1]
      expect(lastMsg.role).toBe('assistant')
      expect(lastMsg.content).toBe('Hello World')
    })

    it('17. tool_call → 添加 tool 消息 + status=tool_calling', () => {
      const beforeCount = useAIStore.getState().sessions[sessionId].messages.length

      const event: AgentEvent = {
        type: 'tool_call',
        toolName: 'search_web',
        params: { query: 'test' },
        requestId: 'tool-req-1',
      }
      triggerAgentEvent(testPanelId, event)

      const afterSession = useAIStore.getState().sessions[sessionId]
      expect(afterSession.status).toBe('tool_calling')
      const afterMessages = afterSession.messages
      expect(afterMessages.length).toBe(beforeCount + 1)
      const lastMsg = afterMessages[afterMessages.length - 1]
      expect(lastMsg.role).toBe('tool')
      expect(lastMsg.toolCallId).toBe('tool-req-1')
      expect(lastMsg.content).toContain('search_web')
    })

    it('18. tool_result → 恢复 status=thinking', () => {
      // 先触发 tool_call 让 status=tool_calling
      triggerAgentEvent(testPanelId, {
        type: 'tool_call',
        toolName: 'search_web',
        params: {},
        requestId: 'tool-req-2',
      })
      expect(useAIStore.getState().sessions[sessionId].status).toBe('tool_calling')

      // 再触发 tool_result
      triggerAgentEvent(testPanelId, {
        type: 'tool_result',
        requestId: 'tool-req-2',
        success: true,
      })

      expect(useAIStore.getState().sessions[sessionId].status).toBe('thinking')
    })

    it('19. turn_end → finalize streaming message + status=idle', () => {
      // 先追加一些文本
      triggerAgentEvent(testPanelId, { type: 'text_delta', text: 'final answer' })
      expect(useAIStore.getState().sessions[sessionId].status).toBe('thinking')

      // 触发 turn_end
      triggerAgentEvent(testPanelId, { type: 'turn_end', totalTokens: 100 })

      const afterSession = useAIStore.getState().sessions[sessionId]
      expect(afterSession.status).toBe('idle')
      // 最后一条消息应保留 'final answer'（finalizeStreamingAssistantMessage 不会清空非空内容）
      const lastMsg = afterSession.messages[afterSession.messages.length - 1]
      expect(lastMsg.content).toBe('final answer')
    })

    it('20. error → 追加错误消息 + status=error', () => {
      const beforeCount = useAIStore.getState().sessions[sessionId].messages.length

      triggerAgentEvent(testPanelId, {
        type: 'error',
        message: 'agent crashed',
        recoverable: false,
      })

      const afterSession = useAIStore.getState().sessions[sessionId]
      expect(afterSession.status).toBe('error')
      expect(afterSession.error).toBe('agent crashed')
      const afterMessages = afterSession.messages
      expect(afterMessages.length).toBe(beforeCount + 1)
      const lastMsg = afterMessages[afterMessages.length - 1]
      expect(lastMsg.role).toBe('assistant')
      expect(lastMsg.content).toContain('agent crashed')
      expect(lastMsg.content).toContain('[error]')
    })
  })

  // ==========================================================================
  // 额外补充：handleAgentEvent panelId 过滤 + 错误兜底（2 个）
  // ==========================================================================

  describe('handleAgentEvent panelId 过滤 + 错误兜底', () => {
    it('21. panelId 不匹配时 → 不修改 session 状态', async () => {
      resetRuntimeModeStore('local')
      const sessionId = createTestSession()
      await useAIStore.getState().sendMessage(sessionId, 'setup')

      const beforeStatus = useAIStore.getState().sessions[sessionId].status
      const beforeMsgCount = useAIStore.getState().sessions[sessionId].messages.length

      // 触发 panelId 不匹配的事件
      triggerAgentEvent('other-panel-id', { type: 'text_delta', text: 'should be ignored' })

      const afterSession = useAIStore.getState().sessions[sessionId]
      expect(afterSession.status).toBe(beforeStatus)
      expect(afterSession.messages.length).toBe(beforeMsgCount)
    })

    it('22. agentApi 不可用时（local 模式）→ 追加错误消息 + status=error', async () => {
      resetRuntimeModeStore('local')
      // 保存原 agentApi，测试结束后恢复（避免影响后续测试）
      const originalAgentApi = window.agentApi
      delete (window as { agentApi?: unknown }).agentApi

      try {
        const sessionId = createTestSession()
        await useAIStore.getState().sendMessage(sessionId, 'no agent api')

        const afterSession = useAIStore.getState().sessions[sessionId]
        expect(afterSession.status).toBe('error')
        expect(afterSession.error).toBe('agentApi not available')
        const lastMsg = afterSession.messages[afterSession.messages.length - 1]
        expect(lastMsg.content).toContain('agentApi')
      } finally {
        ;(window as { agentApi?: unknown }).agentApi = originalAgentApi
      }
    })
  })

  // ==========================================================================
  // sendMessage 错误路径补充（5 个，提升 sendMessage 分支覆盖率到 >70%）
  // ==========================================================================

  describe('sendMessage 错误路径', () => {
    it('23. cloud 模式 sessionId 不存在 → 不调用 WS.send / agentApi（!session 分支）', async () => {
      resetRuntimeModeStore('cloud')
      // 不创建 session，直接传一个不存在的 sessionId
      const fakeSessionId = 'non-existent-session-id'
      const sentBefore = MockWebSocket.allInstances().reduce(
        (sum, w) => sum + w.sentMessages.length,
        0,
      )
      const agentSendMessage = window.agentApi!.sendMessage as ReturnType<typeof vi.fn>
      agentSendMessage.mockClear()

      await useAIStore.getState().sendMessage(fakeSessionId, 'ghost message')

      // WS send 不增加
      const sentAfter = MockWebSocket.allInstances().reduce(
        (sum, w) => sum + w.sentMessages.length,
        0,
      )
      expect(sentAfter).toBe(sentBefore)
      // agentApi 不被调用
      expect(agentSendMessage).not.toHaveBeenCalled()
    })

    it('24. cloud 模式 apiConfigId 无效（preset 未找到）→ 追加错误消息 + status=error', async () => {
      resetRuntimeModeStore('cloud')
      // 创建一个 session，但 apiConfigId 指向不存在的 preset
      const sessionId = useAIStore.getState().createSession({
        title: 'Bad Config',
        boundPanelId: 'test-panel-id',
        apiConfigId: 'invalid-preset-id',
        modelId: 'test-model',
      })

      await useAIStore.getState().sendMessage(sessionId, 'hello with bad config')

      const afterSession = useAIStore.getState().sessions[sessionId]
      expect(afterSession.status).toBe('error')
      expect(afterSession.error).toBe('no api config selected')
      const lastMsg = afterSession.messages[afterSession.messages.length - 1]
      expect(lastMsg.content).toContain('API 配置')
    })

    it('25. cloud 模式 preset.apiKey 为空 → 追加错误消息 + status=error', async () => {
      resetRuntimeModeStore('cloud')
      // 注入一个 apiKey 为空的 preset
      useApiConfigStore.setState({
        presets: [
          {
            id: 'no-key-preset',
            name: 'No Key Preset',
            endpoint: 'https://test.example.com/v1/chat/completions',
            apiKey: '', // 空 apiKey
            provider: 'test',
            models: ['test-model'],
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        ],
        activePresetId: 'no-key-preset',
      })
      const sessionId = useAIStore.getState().createSession({
        title: 'No Key',
        boundPanelId: 'test-panel-id',
        apiConfigId: 'no-key-preset',
        modelId: 'test-model',
      })

      await useAIStore.getState().sendMessage(sessionId, 'hello no key')

      const afterSession = useAIStore.getState().sessions[sessionId]
      expect(afterSession.status).toBe('error')
      expect(afterSession.error).toBe('api key missing')
      const lastMsg = afterSession.messages[afterSession.messages.length - 1]
      expect(lastMsg.content).toContain('apiKey')
    })

    it('26. cloud 模式 WS 未 open → 追加连接错误消息 + status=error', async () => {
      resetRuntimeModeStore('cloud')
      // 不调 initialize，ws 仍然为 null（forceCloseModuleWs 已清空）
      // sendWs 会返回 false
      const sessionId = createTestSession()
      // 确认 ws 为 null：MockWebSocket.allInstances() 应为空
      expect(MockWebSocket.allInstances().length).toBe(0)

      await useAIStore.getState().sendMessage(sessionId, 'hello no ws')

      const afterSession = useAIStore.getState().sessions[sessionId]
      expect(afterSession.status).toBe('error')
      expect(afterSession.error).toBe('websocket not connected')
      const lastMsg = afterSession.messages[afterSession.messages.length - 1]
      expect(lastMsg.content).toContain('连接错误')
    })

    it('27. local 模式 agentApi.sendMessage 抛异常 → catch 追加错误消息 + status=error', async () => {
      resetRuntimeModeStore('local')
      // 让 agentApi.sendMessage 抛错
      const agentSendMessage = window.agentApi!.sendMessage as ReturnType<typeof vi.fn>
      agentSendMessage.mockClear()
      agentSendMessage.mockRejectedValueOnce(new Error('agent runtime failed'))

      const sessionId = createTestSession()
      await useAIStore.getState().sendMessage(sessionId, 'trigger error')

      const afterSession = useAIStore.getState().sessions[sessionId]
      expect(afterSession.status).toBe('error')
      expect(afterSession.error).toBe('agent runtime failed')
      const lastMsg = afterSession.messages[afterSession.messages.length - 1]
      expect(lastMsg.content).toContain('agent runtime failed')
      expect(lastMsg.content).toContain('[error]')
    })
  })
})
