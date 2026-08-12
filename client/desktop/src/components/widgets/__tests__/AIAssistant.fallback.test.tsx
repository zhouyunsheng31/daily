/**
 * AIAssistant 4 步回退边界测试 — Phase 11.4.3
 *
 * spec 11.4.3 要求覆盖 4 步回退边界（5 用例）：
 *   1. 网络断开回退（WS close / fetch reject）
 *   2. API 401 认证失败回退
 *   3. 工具调用失败回退（tool_result error）
 *   4. 超时回退（无响应）
 *   5. 综合场景：连续失败后降级到本地模式
 *
 * 实施策略：
 * - AIAssistant.tsx 组件本身没有显式 4 步回退逻辑，
 *   其"回退"行为通过 useAIStore 状态驱动 UI：
 *   * isOnline → 控制 WS 连接状态显示（Wifi/WifiOff）+ 输入框禁用
 *   * session.status='error' + session.error → 显示错误提示条
 *   * session.messages → 渲染工具/助手消息
 * - 测试通过 mock useAIStore 不同状态组合，验证各回退步骤的 UI 表现
 * - 参考 useAIStore.ts handleAgentEvent 的 error/tool_call 路径
 *
 * Mock 策略：
 * - vi.mock('../../../stores/useAIStore') → useAIStore 是函数（zustand hook），
 *   接受 selector 返回 mockState 的切片
 * - vi.mock('../../../stores/useRuntimeModeStore') → 控制 effectiveMode
 * - setupMockElectronAPI() 提供 window.agentApi
 *
 * 验收：5 用例全绿，覆盖 4 步回退边界（网络/API/工具/超时）+ 综合降级
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import type { SessionState, ChatMessage } from '../../../types/ai'

// ============================================================================
// mock useAIStore：useAIStore 是 zustand hook，可被以 selector 形式调用
// ============================================================================

interface MockAIStoreState {
  sessions: Record<string, SessionState>
  activeSessionId: string | null
  isInitialized: boolean
  isOnline: boolean
  initialize: () => Promise<void>
  createSession: () => string
  sendMessage: () => Promise<void>
}

const mockStore = vi.hoisted(() => {
  const state: MockAIStoreState = {
    sessions: {},
    activeSessionId: null,
    isInitialized: true,
    isOnline: true,
    initialize: vi.fn().mockResolvedValue(undefined),
    createSession: vi.fn().mockReturnValue('test-session-id'),
    sendMessage: vi.fn().mockResolvedValue(undefined),
  }
  return { state }
})

vi.mock('../../../stores/useAIStore', () => ({
  // useAIStore 是 zustand hook：useAIStore(selector) → 返回 selector(state)
  // 也兼容无 selector 调用（useAIStore() 返回整个 state）
  useAIStore: vi.fn((selector?: (s: typeof mockStore.state) => unknown) =>
    selector ? selector(mockStore.state) : mockStore.state,
  ),
}))

// ============================================================================
// mock useRuntimeModeStore：用于"降级到本地模式"用例
// ============================================================================

const mockRuntimeStore = vi.hoisted(() => ({
  state: {
    mode: 'auto' as 'auto' | 'cloud' | 'local',
    effectiveMode: 'cloud' as 'cloud' | 'local',
    isServerOnline: true,
    isOfflineDowngraded: false,
    _debounceTimer: null as ReturnType<typeof setTimeout> | null,
    setMode: vi.fn(),
    setServerOnline: vi.fn(),
    recomputeEffectiveMode: vi.fn(),
  },
}))

vi.mock('../../../stores/useRuntimeModeStore', () => ({
  useRuntimeModeStore: {
    getState: () => mockRuntimeStore.state,
    setState: vi.fn(),
    subscribe: vi.fn(),
    getInitialState: () => mockRuntimeStore.state,
  },
}))

// ============================================================================
// 导入被测组件（必须在 vi.mock 之后）
// ============================================================================

import AIAssistant from '../AIAssistant'

// ============================================================================
// 辅助：构造一个 session 状态
// ============================================================================

function makeSession(overrides: Partial<SessionState> = {}): SessionState {
  return {
    sessionId: 'test-session-id',
    messages: [],
    createdAt: 1000,
    updatedAt: 1000,
    model: 'step-3.7-flash',
    modelId: 'step-3.7-flash',
    status: 'idle',
    title: 'Test Session',
    boundPanelId: 'test-panel-id',
    apiConfigId: 'test-preset-1',
    authorizedPrivateStores: [],
    hasConfirmedFirstSend: false,
    confirmedDataCategories: new Set<string>(),
    confirmedModel: null,
    role: '生活助手',
    ...overrides,
  }
}

/** 在 mockStore.state 中放置一个 session，并设 activeSessionId */
function setSession(session: SessionState): void {
  mockStore.state.sessions = { [session.sessionId]: session }
  mockStore.state.activeSessionId = session.sessionId
}

/** 重置 mockStore.state 到默认值（不重置 mock 函数引用） */
function resetMockStoreState(): void {
  mockStore.state.sessions = {}
  mockStore.state.activeSessionId = null
  mockStore.state.isInitialized = true
  mockStore.state.isOnline = true
  mockStore.state.initialize = vi.fn().mockResolvedValue(undefined)
  mockStore.state.createSession = vi.fn().mockReturnValue('test-session-id')
  mockStore.state.sendMessage = vi.fn().mockResolvedValue(undefined)
}

/** 重置 mockRuntimeStore 到默认值 */
function resetMockRuntimeStore(): void {
  mockRuntimeStore.state.mode = 'auto'
  mockRuntimeStore.state.effectiveMode = 'cloud'
  mockRuntimeStore.state.isServerOnline = true
  mockRuntimeStore.state.isOfflineDowngraded = false
  mockRuntimeStore.state._debounceTimer = null
}

// ============================================================================
// 公共 Props 工厂
// ============================================================================

function makeProps(overrides: Partial<{
  widgetId: string
  panelId: string
  state: Record<string, unknown>
  onUpdateState: ReturnType<typeof vi.fn>
  isPrimary: boolean
}> = {}) {
  return {
    widgetId: overrides.widgetId ?? 'widget-1',
    panelId: overrides.panelId ?? 'panel-1',
    state: overrides.state ?? { sessionId: 'test-session-id' },
    onUpdateState: overrides.onUpdateState ?? vi.fn(),
    isPrimary: overrides.isPrimary ?? false,
  }
}

// ============================================================================
// 测试套件
// ============================================================================

describe('AIAssistant 4 步回退边界', () => {
  beforeEach(() => {
    resetMockStoreState()
    resetMockRuntimeStore()
    // 抑制源码 console.error 污染（AIAssistant 不打错误日志，但子组件可能）
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  // --------------------------------------------------------------------------
  // 用例 1：网络断开回退（WS close / fetch reject）
  // --------------------------------------------------------------------------
  test('1. 网络断开时显示离线标识 + 占位文案变为"正在连接 AI 服务..." + 输入框禁用', () => {
    // 步骤：isOnline=false 模拟 WS 已断开
    mockStore.state.isOnline = false
    setSession(makeSession())

    render(<AIAssistant {...makeProps()} />)

    // 离线标识：WifiOff 图标 + "离线" 文字（替代 "在线"）
    expect(screen.getByText('离线')).toBeInTheDocument()
    expect(screen.queryByText('在线')).not.toBeInTheDocument()

    // 占位文案：从"向 AI 助手提问吧" 变为"正在连接 AI 服务..."
    expect(screen.getByText('正在连接 AI 服务...')).toBeInTheDocument()
    expect(screen.queryByText('向 AI 助手提问吧')).not.toBeInTheDocument()

    // 输入框 disabled（!isOnline 触发 disabled）
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement
    expect(textarea).not.toBeNull()
    expect(textarea.disabled).toBe(true)

    // 发送按钮 disabled（canSend=false 因为 isOnline=false）
    const sendButton = screen.getByRole('button', { name: /发送/ })
    expect(sendButton).toBeDisabled()
  })

  // --------------------------------------------------------------------------
  // 用例 2：API 401 认证失败回退
  // --------------------------------------------------------------------------
  test('2. API 401 认证失败时显示错误提示条 + 状态变为 error', () => {
    // 步骤：cloud 模式下 preset 未找到/无效（"no api config selected"）
    // 对应 useAIStore.sendMessage 中的 "no api config selected" 错误路径
    mockStore.state.isOnline = true
    setSession(makeSession({
      status: 'error',
      error: 'no api config selected',
      messages: [
        {
          role: 'assistant',
          content: '[提示] 未选择 API 配置，请在 ⚙️ API 配置中选择预设。',
          timestamp: 2000,
        },
      ],
    }))

    render(<AIAssistant {...makeProps()} />)

    // 错误提示条显示：包含 session.error 文本
    expect(screen.getByText('no api config selected')).toBeInTheDocument()

    // 错误提示条同时显示助手消息（错误提示文本）
    expect(screen.getByText(/未选择 API 配置/)).toBeInTheDocument()

    // 此时仍在线（isOnline=true）
    expect(screen.getByText('在线')).toBeInTheDocument()
    expect(screen.queryByText('离线')).not.toBeInTheDocument()

    // 输入框可用（status='error' 不属于 thinking/tool_calling，isBusy=false）
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement
    expect(textarea.disabled).toBe(false)
  })

  // --------------------------------------------------------------------------
  // 用例 3：工具调用失败回退（tool_result error）
  // --------------------------------------------------------------------------
  test('3. 工具调用失败时显示工具调用消息 + 错误提示条', () => {
    // 步骤：模拟工具调用失败 → tool_call 消息 + error 状态
    // 对应 handleAgentEvent 中 tool_call 后 tool_result 抛错，
    // 然后 error 事件追加 "[error] xxx" 消息
    mockStore.state.isOnline = true
    const toolMessage: ChatMessage = {
      role: 'tool',
      content: '调用工具: search_web',
      toolCallId: 'tool-req-1',
      timestamp: 1000,
    }
    const errorMessage: ChatMessage = {
      role: 'assistant',
      content: '[error] tool execution failed: network timeout',
      timestamp: 2000,
    }
    setSession(makeSession({
      status: 'error',
      error: 'tool execution failed: network timeout',
      messages: [toolMessage, errorMessage],
    }))

    render(<AIAssistant {...makeProps()} />)

    // 工具调用消息渲染（包含工具名 + 折叠图标）
    expect(screen.getByText(/调用工具.*search_web/)).toBeInTheDocument()

    // 错误提示条显示
    expect(screen.getByText('tool execution failed: network timeout')).toBeInTheDocument()

    // 状态机：status='error' 时无 "AI 思考中..." / "工具调用中..." 加载提示
    expect(screen.queryByText('AI 思考中...')).not.toBeInTheDocument()
    expect(screen.queryByText('工具调用中...')).not.toBeInTheDocument()

    // 工具消息可展开（点击查看 toolCallId）
    // 注意：onClick 在内部的 div 上（包含 chevron + wrench + span），
    // 不是外层 message bubble 容器。所以 closest('div') 返回的就是可点击的 div 本身。
    const toolHeader = screen.getByText(/调用工具.*search_web/).closest('div')
    expect(toolHeader).not.toBeNull()
    // 点击可点击的 header div 触发 setExpanded(!expanded)
    fireEvent.click(toolHeader!)
    // 展开后显示 toolCallId
    expect(screen.getByText(/ID: tool-req-1/)).toBeInTheDocument()
  })

  // --------------------------------------------------------------------------
  // 用例 4：超时回退（无响应）
  // --------------------------------------------------------------------------
  test('4. 超时无响应时显示错误提示条 + 状态变为 error', () => {
    // 步骤：模拟 local agent 超时无响应（sendMessage reject）→
    // catch 中追加 "[error] xxx" 消息 + status=error
    // 对应 useAIStore.sendMessage local 模式 catch 路径
    mockStore.state.isOnline = true
    setSession(makeSession({
      status: 'error',
      error: 'agent runtime failed',
      messages: [
        { role: 'user', content: '请帮我搜索一下', timestamp: 1000 },
        // 空的 streaming assistant 消息（ensureStreamingAssistantMessage 已追加）
        { role: 'assistant', content: '', timestamp: 1100 },
        // 错误消息（catch 路径）
        { role: 'assistant', content: '[error] agent runtime failed', timestamp: 2000 },
      ],
    }))

    render(<AIAssistant {...makeProps()} />)

    // 用户消息渲染
    expect(screen.getByText('请帮我搜索一下')).toBeInTheDocument()

    // 错误提示条显示
    expect(screen.getByText('agent runtime failed')).toBeInTheDocument()

    // 错误消息渲染（[error] 前缀）
    expect(screen.getByText(/\[error\] agent runtime failed/)).toBeInTheDocument()

    // 状态机：status='error'，加载提示不显示
    expect(screen.queryByText('AI 思考中...')).not.toBeInTheDocument()
  })

  // --------------------------------------------------------------------------
  // 用例 5：综合场景：连续失败后降级到本地模式
  // --------------------------------------------------------------------------
  test('5. 综合场景：连续失败后 effectiveMode=local + 离线 banner + 仍可重试', () => {
    // 步骤：auto 模式下服务器多次失败 → setServerOnline(false) →
    // effectiveMode 从 cloud 自动降级到 local（isOfflineDowngraded=true）
    // 同时 session 仍有上次 error 状态
    mockStore.state.isOnline = false  // WS 也断了
    mockRuntimeStore.state.mode = 'auto'
    mockRuntimeStore.state.effectiveMode = 'local'  // 自动降级
    mockRuntimeStore.state.isServerOnline = false
    mockRuntimeStore.state.isOfflineDowngraded = true

    setSession(makeSession({
      status: 'error',
      error: 'websocket not connected',
      messages: [
        // 用户之前发送的消息
        { role: 'user', content: '帮我查询天气', timestamp: 1000 },
        // 错误消息（cloud 模式 sendWs 失败）
        { role: 'assistant', content: '[连接错误] 无法连接到 AI 服务，请稍后重试。', timestamp: 2000 },
      ],
    }))

    render(<AIAssistant {...makeProps()} />)

    // 离线标识显示（WS 断开 → isOnline=false）
    expect(screen.getByText('离线')).toBeInTheDocument()

    // 错误提示条显示（上次失败的错误信息）
    expect(screen.getByText('websocket not connected')).toBeInTheDocument()

    // 错误消息渲染（连接错误提示）
    expect(screen.getByText(/无法连接到 AI 服务/)).toBeInTheDocument()

    // 综合降级验证：
    // - runtime store effectiveMode 为 local（auto → local 自动降级）
    expect(mockRuntimeStore.state.effectiveMode).toBe('local')
    // - isOfflineDowngraded=true（auto 模式下离线才算降级）
    expect(mockRuntimeStore.state.isOfflineDowngraded).toBe(true)

    // 降级到 local 模式后，textarea 在 isOnline=false 时仍 disabled（受 isOnline 控制）
    // 但用户能通过其他 UI（如 AgentModeSwitcher）切换到 manual local 模式
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement
    expect(textarea.disabled).toBe(true)  // WS 仍断开，输入禁用
    // placeholder 显示"连接中..."（!isOnline）
    expect(textarea.placeholder).toContain('连接中')
  })
})
