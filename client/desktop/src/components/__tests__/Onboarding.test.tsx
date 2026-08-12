/**
 * Onboarding Phase 13.1.4 单元测试
 *
 * 测试目标（Task 5）：
 * 1. Step 1 渲染（WelcomeStep 显示 "Daily" 标题）
 * 2. 点击 "开始" 按钮跳到 Step 2（CanvasStep 显示 "收藏组件"）
 * 3. 点击 "跳过" 按钮调用 setHasCompletedOnboarding(true)
 * 4. Step 5 AiConfigStep：apiKey 输入 + "配置完成" 按钮触发 window.aiKeyApi.setApiKey + setActiveProvider
 *
 * mock 策略：
 * - vi.mock('../../stores/useOnboardingStore')：mock step + actions
 * - vi.mock('../../stores/useAppStore')：mock setHasCompletedOnboarding
 * - vi.mock('../../api/client')：mock api.post（连接测试用）
 * - window.aiKeyApi：通过 Object.assign(window, ...) 注入 mock
 *
 * 注意：Onboarding.tsx 中 step=0 显示 "开始"，step>0 显示 "下一步"；step=4 (AiConfig) 隐藏底部"下一步"
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

// ============================================================================
// mock useOnboardingStore
// ============================================================================
const mockOnboardingStore = vi.hoisted(() => {
  const state = {
    step: 0,
    aiConfig: {
      provider: 'deepseek' as 'deepseek' | 'openai' | 'anthropic' | 'google',
      endpoint: 'https://api.deepseek.com/v1/chat/completions',
      model: 'deepseek-v4-flash',
      apiKey: '',
    },
    testStatus: 'idle' as 'idle' | 'testing' | 'success' | 'error',
    testMessage: '',
    setStep: vi.fn(),
    next: vi.fn(),
    prev: vi.fn(),
    skip: vi.fn(),
    complete: vi.fn(),
    setAiConfig: vi.fn(),
    setTestStatus: vi.fn(),
  }
  return { state }
})

vi.mock('../../stores/useOnboardingStore', () => ({
  useOnboardingStore: Object.assign(
    (selector?: (s: typeof mockOnboardingStore.state) => unknown) =>
      selector ? selector(mockOnboardingStore.state) : mockOnboardingStore.state,
    {
      setState: (next: Partial<typeof mockOnboardingStore.state>) =>
        Object.assign(mockOnboardingStore.state, next),
    }
  ),
  ONBOARDING_TOTAL_STEPS: 6,
}))

// ============================================================================
// mock useAppStore（提供 setHasCompletedOnboarding）
// ============================================================================
const mockAppStore = vi.hoisted(() => {
  const state = {
    setHasCompletedOnboarding: vi.fn().mockResolvedValue(undefined),
  }
  return { state }
})

vi.mock('../../stores/useAppStore', () => ({
  useAppStore: Object.assign(
    (selector?: (s: typeof mockAppStore.state) => unknown) =>
      selector ? selector(mockAppStore.state) : mockAppStore.state,
    {
      getState: () => mockAppStore.state,
      setState: (next: Partial<typeof mockAppStore.state>) =>
        Object.assign(mockAppStore.state, next),
    }
  ),
}))

// ============================================================================
// mock api client（AiConfigStep 连接测试用）
// ============================================================================
vi.mock('../../api/client', () => ({
  api: {
    post: vi.fn().mockResolvedValue({ ok: true, message: 'mock ok' }),
    get: vi.fn(),
    put: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    constructor(msg: string) { super(msg) }
  },
}))

// ============================================================================
// mock window.aiKeyApi
// ============================================================================
const mockAiKeyApi = vi.hoisted(() => ({
  setApiKey: vi.fn().mockResolvedValue(undefined),
  setActiveProvider: vi.fn().mockResolvedValue(undefined),
  getApiKey: vi.fn().mockResolvedValue(''),
}))

// ============================================================================
// 导入被测组件与 mocked api（必须在所有 vi.mock 之后）
// ============================================================================
import Onboarding from '../Onboarding'
import { api } from '../../api/client'

// ============================================================================
// 公共重置逻辑
// ============================================================================
beforeEach(() => {
  // 重置 onboarding store
  mockOnboardingStore.state.step = 0
  mockOnboardingStore.state.aiConfig = {
    provider: 'deepseek',
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
    model: 'deepseek-v4-flash',
    apiKey: '',
  }
  mockOnboardingStore.state.testStatus = 'idle'
  mockOnboardingStore.state.testMessage = ''
  mockOnboardingStore.state.setStep = vi.fn()
  mockOnboardingStore.state.next = vi.fn()
  mockOnboardingStore.state.prev = vi.fn()
  // skip 实现链路：调用 skip → setHasCompletedOnboarding(true)
  mockOnboardingStore.state.skip = vi.fn(async () => {
    await mockAppStore.state.setHasCompletedOnboarding(true)
  })
  mockOnboardingStore.state.complete = vi.fn(async () => {
    await mockAppStore.state.setHasCompletedOnboarding(true)
  })
  // setAiConfig 真实更新 state（handleComplete 读取 aiConfig.apiKey 时需要最新值）
  mockOnboardingStore.state.setAiConfig = vi.fn((patch) => {
    Object.assign(mockOnboardingStore.state.aiConfig, patch)
  })
  mockOnboardingStore.state.setTestStatus = vi.fn()

  // 重置 app store
  mockAppStore.state.setHasCompletedOnboarding = vi.fn().mockResolvedValue(undefined)

  // 重置 api.post（通过 vi.mocked 获取 mock 函数）
  vi.mocked(api.post).mockClear()
  vi.mocked(api.post).mockResolvedValue({ ok: true, message: 'mock ok' })

  // 重置 window.aiKeyApi
  mockAiKeyApi.setApiKey = vi.fn().mockResolvedValue(undefined)
  mockAiKeyApi.setActiveProvider = vi.fn().mockResolvedValue(undefined)
  mockAiKeyApi.getApiKey = vi.fn().mockResolvedValue('')
  ;(window as unknown as { aiKeyApi: typeof mockAiKeyApi }).aiKeyApi = mockAiKeyApi
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  delete (window as unknown as { aiKeyApi?: typeof mockAiKeyApi }).aiKeyApi
})

// ============================================================================
// 1. Step 1 渲染：WelcomeStep 显示 "Daily"
// ============================================================================
describe('Step 1 渲染', () => {
  test('初始渲染显示 WelcomeStep 内容（"Daily" 标题 + 副标题）', () => {
    render(<Onboarding />)
    // WelcomeStep 中 h1 标题为 "Daily"
    // 注意：MacosWindow 标题栏也显示 "Daily"，故用 getAllByText
    const matches = screen.getAllByText('Daily')
    expect(matches.length).toBeGreaterThanOrEqual(1)
    // 至少有一个是 h1（WelcomeStep 主标题）
    expect(matches.some(el => el.tagName === 'H1')).toBe(true)
    // 副标题
    expect(screen.getByText('你的可定制 AI 学习工作台')).toBeInTheDocument()
  })

  test('初始渲染显示 "开始" 按钮（step=0 时下一步按钮文案为 "开始"）', () => {
    render(<Onboarding />)
    expect(screen.getByRole('button', { name: /开始/ })).toBeInTheDocument()
  })

  test('初始渲染显示 "跳过" 按钮（右上角）', () => {
    render(<Onboarding />)
    expect(screen.getByRole('button', { name: '跳过' })).toBeInTheDocument()
  })
})

// ============================================================================
// 2. 点击 "开始" 跳到 Step 2（CanvasStep）
// ============================================================================
describe('点击 "开始" 跳到 Step 2', () => {
  test('点击 "开始" 按钮调用 next() 切换到下一步', () => {
    render(<Onboarding />)
    const startBtn = screen.getByRole('button', { name: /开始/ })
    fireEvent.click(startBtn)
    expect(mockOnboardingStore.state.next).toHaveBeenCalledTimes(1)
  })

  test('Step 2 渲染 CanvasStep 内容（"收藏组件" 标签）', () => {
    mockOnboardingStore.state.step = 1
    render(<Onboarding />)
    // CanvasStep 有 "收藏组件" 文本和 "进入画布" 按钮
    expect(screen.getByText('收藏组件')).toBeInTheDocument()
    expect(screen.getByText('进入画布')).toBeInTheDocument()
  })
})

// ============================================================================
// 3. 点击 "跳过" 调用 setHasCompletedOnboarding(true)
// ============================================================================
describe('点击 "跳过" 调用 setHasCompletedOnboarding', () => {
  test('点击 "跳过" 按钮触发 skip() 并最终调用 setHasCompletedOnboarding(true)', async () => {
    render(<Onboarding />)
    const skipBtn = screen.getByRole('button', { name: '跳过' })
    fireEvent.click(skipBtn)
    // 等待异步 skip 完成
    await vi.waitFor(() => {
      expect(mockOnboardingStore.state.skip).toHaveBeenCalledTimes(1)
    })
    // skip 内部调用 setHasCompletedOnboarding(true)
    await vi.waitFor(() => {
      expect(mockAppStore.state.setHasCompletedOnboarding).toHaveBeenCalledWith(true)
    })
  })
})

// ============================================================================
// 4. Step 5 AiConfigStep：apiKey 输入 + "配置完成" 按钮
// ============================================================================
describe('Step 5 AiConfigStep', () => {
  test('Step 5 渲染 Provider 选择 + Endpoint + Model + API Key 输入框', () => {
    mockOnboardingStore.state.step = 4
    render(<Onboarding />)
    // AiConfigStep 标题
    expect(screen.getByText('配置 AI 助手')).toBeInTheDocument()
    // 4 个 label
    expect(screen.getByText('Provider')).toBeInTheDocument()
    expect(screen.getByText('API Endpoint')).toBeInTheDocument()
    expect(screen.getByText('Model')).toBeInTheDocument()
    expect(screen.getByText('API Key')).toBeInTheDocument()
    // 完成按钮存在
    expect(screen.getByRole('button', { name: /配置完成/ })).toBeInTheDocument()
    // 连接测试按钮存在
    expect(screen.getByRole('button', { name: /连接测试/ })).toBeInTheDocument()
  })

  test('输入 API Key 并点击 "配置完成" 调用 window.aiKeyApi.setApiKey + setActiveProvider + next', async () => {
    mockOnboardingStore.state.step = 4
    render(<Onboarding />)

    // 找到 API Key 密码输入框（placeholder="sk-..."）
    const apiKeyInput = screen.getByPlaceholderText('sk-...')
    expect(apiKeyInput).toHaveAttribute('type', 'password')
    fireEvent.change(apiKeyInput, { target: { value: 'sk-test-key-123' } })

    // 点击 "配置完成" 按钮
    const completeBtn = screen.getByRole('button', { name: /配置完成/ })
    fireEvent.click(completeBtn)

    // 等待异步 handleComplete 完成（setApiKey → setActiveProvider → next 串行 await）
    await vi.waitFor(() => {
      expect(mockAiKeyApi.setApiKey).toHaveBeenCalledTimes(1)
      expect(mockAiKeyApi.setActiveProvider).toHaveBeenCalledTimes(1)
      expect(mockOnboardingStore.state.next).toHaveBeenCalledTimes(1)
    })
    // setApiKey 参数：provider, apiKey, endpoint, model
    expect(mockAiKeyApi.setApiKey).toHaveBeenCalledWith(
      'deepseek',
      'sk-test-key-123',
      'https://api.deepseek.com/v1/chat/completions',
      'deepseek-v4-flash',
    )
    // setActiveProvider 被调用
    expect(mockAiKeyApi.setActiveProvider).toHaveBeenCalledWith('deepseek')
  })

  test('点击 "连接测试" 在 API Key 为空时显示错误提示', async () => {
    mockOnboardingStore.state.step = 4
    render(<Onboarding />)

    const testBtn = screen.getByRole('button', { name: /连接测试/ })
    fireEvent.click(testBtn)

    // API Key 为空时 setTestStatus 被调用 with 'error' + 错误消息
    await vi.waitFor(() => {
      expect(mockOnboardingStore.state.setTestStatus).toHaveBeenCalledWith('error', '请先输入 API Key')
    })
    // api.post 不应被调用
    expect(api.post).not.toHaveBeenCalled()
  })
})
