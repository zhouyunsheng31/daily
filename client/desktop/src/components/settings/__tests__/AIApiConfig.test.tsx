/**
 * AIApiConfig 组件 vitest 单元测试（Phase 11.2 P0）
 *
 * 测试目标（spec 要求 5 个点）：
 * - 表单校验：model/apiKey/endpoint 输入框、placeholder、label/desc 渲染
 * - API Key 加密：type="password"、加载后不回填、保存后清空、hasApiKey 描述切换
 * - 连接测试：testing/success/error 三态、按钮 disabled、消息显示、api.post 调用
 * - 配置保存：api.put 调用、body 构造、savedAt "已保存" 提示、保存失败 alert
 * - 配置读取：loading 占位、api.get 调用、model/endpoint 回填、hasApiKey 同步
 *
 * mock 策略：
 * - vi.mock('../../api/client') 替换 api 对象和 ApiError 类
 * - 用 vi.hoisted 暴露可变 mockState，便于每个用例控制返回值/抛错
 * - 用 fake timers 控制 setTimeout（savedAt 2s 后重置）
 *
 * 注意：
 * - vitest 4.x 的 vi.fn 不再支持双泛型
 * - 不修改源代码；只读源代码以对齐行为
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

// ============================================================================
// mock api/client：暴露可变 mockApi 对象 + MockApiError 类
// 注意：vi.mock 工厂函数会被 hoisted 到顶部，不能引用模块外的变量，
// 所以 MockApiError 也必须放在 vi.hoisted 内部。
// ============================================================================
const mockApi = vi.hoisted(() => {
  // ApiError 类需要真实抛出（instanceof 判断），定义一个真实 class
  class MockApiError extends Error {
    status: number
    data: unknown
    constructor(message: string, status: number, data?: unknown) {
      super(message)
      this.name = 'ApiError'
      this.status = status
      this.data = data
    }
  }

  const apiObj = {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
  }
  return { apiObj, MockApiError }
})

vi.mock('../../../api/client', () => ({
  api: mockApi.apiObj,
  ApiError: mockApi.MockApiError,
}))

// ============================================================================
// 导入被测组件（必须在 vi.mock 之后）
// ============================================================================
import AIApiConfig from '../AIApiConfig'

// ============================================================================
// 公共：默认 GET /ai/settings 返回值
// ============================================================================
function defaultSettingsResponse(overrides: Partial<{
  model: string
  endpoint: string | null
  hasApiKey: boolean
}> = {}) {
  return {
    model: 'stepfun/step-3.7-flash',
    endpoint: null,
    hasApiKey: false,
    ...overrides,
  }
}

// 保存原始 alert（happy-dom 中可能不存在，需兼容）
const originalAlert = (window as { alert?: unknown }).alert
const alertMock = vi.fn()

beforeEach(() => {
  // 注意：不使用 vi.useFakeTimers()，因为它会破坏 React 调度和 waitFor 轮询
  // 仅在需要测试 setTimeout 的用例中临时切换 fake timers

  // 默认 GET 成功返回（无 hasApiKey）
  mockApi.apiObj.get.mockResolvedValue(defaultSettingsResponse())
  mockApi.apiObj.post.mockResolvedValue({ ok: true, message: '连接测试通过' })
  mockApi.apiObj.put.mockResolvedValue({ ok: true })

  // mock alert（happy-dom 中可能无 alert，直接赋值更稳）
  ;(window as unknown as { alert: typeof alertMock }).alert = alertMock
  alertMock.mockClear()
  // 抑制源码 console.error 污染
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.clearAllMocks()
  // 恢复 alert
  ;(window as unknown as { alert: unknown }).alert = originalAlert
})

// ============================================================================
// 1. 配置读取 + loading 占位
// ============================================================================
describe('配置读取', () => {
  test('挂载时显示 loading spinner（Loader2），表单尚未渲染', () => {
    // 阻塞 GET，保持 loading=true
    mockApi.apiObj.get.mockImplementation(() => new Promise(() => {}))
    render(<AIApiConfig />)
    // "API 配置" 标题不应在 loading 时出现
    expect(screen.queryByText('API 配置')).not.toBeInTheDocument()
    // 但 loading 容器存在（Loader2 图标）
    expect(document.querySelector('.spin')).toBeInTheDocument()
  })

  test('GET /ai/settings 加载完成后渲染表单（包含 "API 配置" 标题）', async () => {
    render(<AIApiConfig />)
    // 等待 loading 结束
    await waitFor(() => {
      expect(screen.getByText('API 配置')).toBeInTheDocument()
    })
    // api.get 被调用一次
    expect(mockApi.apiObj.get).toHaveBeenCalledTimes(1)
    // 调用参数：path='/ai/settings'，无 params
    expect(mockApi.apiObj.get).toHaveBeenCalledWith('/ai/settings')
  })

  test('加载完成后回填 model 字段值', async () => {
    mockApi.apiObj.get.mockResolvedValue(
      defaultSettingsResponse({ model: 'custom/model-x' })
    )
    render(<AIApiConfig />)
    await waitFor(() => {
      expect(screen.getByDisplayValue('custom/model-x')).toBeInTheDocument()
    })
  })

  test('加载完成后回填 endpoint 字段值（endpoint 非 null 时）', async () => {
    mockApi.apiObj.get.mockResolvedValue(
      defaultSettingsResponse({ endpoint: 'https://api.example.com/v1' })
    )
    render(<AIApiConfig />)
    await waitFor(() => {
      expect(screen.getByDisplayValue('https://api.example.com/v1')).toBeInTheDocument()
    })
  })

  test('GET 失败时 loading 结束并渲染表单（不抛错，catch 兜底）', async () => {
    mockApi.apiObj.get.mockRejectedValue(new Error('network'))
    // 抑制 console.error 输出污染
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<AIApiConfig />)
    await waitFor(() => {
      expect(screen.getByText('API 配置')).toBeInTheDocument()
    })
    // model/endpoint 都为空字符串
    expect(screen.queryByDisplayValue('stepfun/step-3.7-flash')).not.toBeInTheDocument()
  })
})

// ============================================================================
// 2. API Key 加密 / 不回填 / 状态切换
// ============================================================================
describe('API Key 加密与状态', () => {
  test('API Key 输入框 type="password"（明文不展示）', async () => {
    render(<AIApiConfig />)
    await waitFor(() => {
      expect(screen.getByPlaceholderText('输入 API Key')).toBeInTheDocument()
    })
    const apiKeyInput = screen.getByPlaceholderText('输入 API Key')
    expect(apiKeyInput).toHaveAttribute('type', 'password')
  })

  test('加载后 apiKey 输入框始终为空（客户端不持有，不回填）', async () => {
    mockApi.apiObj.get.mockResolvedValue(
      defaultSettingsResponse({ hasApiKey: true })
    )
    render(<AIApiConfig />)
    await waitFor(() => {
      // hasApiKey=true → placeholder 变为 "••••••••（已配置）"
      expect(screen.getByPlaceholderText('••••••••（已配置）')).toBeInTheDocument()
    })
    // 输入框值必须为空
    const apiKeyInput = screen.getByPlaceholderText('••••••••（已配置）')
    expect((apiKeyInput as HTMLInputElement).value).toBe('')
  })

  test('hasApiKey=false 时描述显示 "输入 API Key（保存到服务器，客户端不持有）"', async () => {
    render(<AIApiConfig />)
    await waitFor(() => {
      expect(
        screen.getByText('输入 API Key（保存到服务器，客户端不持有）')
      ).toBeInTheDocument()
    })
  })

  test('hasApiKey=true 时描述显示 "已配置（输入新值可覆盖）"', async () => {
    mockApi.apiObj.get.mockResolvedValue(
      defaultSettingsResponse({ hasApiKey: true })
    )
    render(<AIApiConfig />)
    await waitFor(() => {
      expect(screen.getByText('已配置（输入新值可覆盖）')).toBeInTheDocument()
    })
  })
})

// ============================================================================
// 3. 表单校验 / 用户输入
// ============================================================================
describe('表单输入', () => {
  test('用户可输入 model/apiKey/endpoint 三个字段（受控更新）', async () => {
    render(<AIApiConfig />)
    await waitFor(() => {
      expect(screen.getByPlaceholderText('stepfun/step-3.7-flash')).toBeInTheDocument()
    })

    const modelInput = screen.getByPlaceholderText('stepfun/step-3.7-flash')
    const apiKeyInput = screen.getByPlaceholderText('输入 API Key')
    const endpointInput = screen.getByPlaceholderText('https://api.example.com/v1')

    fireEvent.change(modelInput, { target: { value: 'openai/gpt-4' } })
    fireEvent.change(apiKeyInput, { target: { value: 'sk-secret-key' } })
    fireEvent.change(endpointInput, { target: { value: 'https://api.openai.com' } })

    expect((modelInput as HTMLInputElement).value).toBe('openai/gpt-4')
    expect((apiKeyInput as HTMLInputElement).value).toBe('sk-secret-key')
    expect((endpointInput as HTMLInputElement).value).toBe('https://api.openai.com')
  })

  test('model/apiKey/endpoint 三个 label 与 desc 文本正确渲染', async () => {
    render(<AIApiConfig />)
    await waitFor(() => {
      expect(screen.getByText('模型')).toBeInTheDocument()
    })
    expect(screen.getByText('API Key')).toBeInTheDocument()
    expect(screen.getByText('Endpoint')).toBeInTheDocument()
    // desc
    expect(screen.getByText('格式：provider/model（如 stepfun/step-3.7-flash）')).toBeInTheDocument()
    expect(screen.getByText('自定义 API endpoint（可选，留空使用默认）')).toBeInTheDocument()
  })
})

// ============================================================================
// 4. 配置保存
// ============================================================================
describe('配置保存', () => {
  test('点击保存调用 api.put("/ai/settings", body)，body 含 model/apiKey/endpoint', async () => {
    render(<AIApiConfig />)
    await waitFor(() => {
      expect(screen.getByText('保存')).toBeInTheDocument()
    })

    // 输入三个字段
    fireEvent.change(screen.getByPlaceholderText('stepfun/step-3.7-flash'), {
      target: { value: 'openai/gpt-4' },
    })
    fireEvent.change(screen.getByPlaceholderText('输入 API Key'), {
      target: { value: 'sk-test-key' },
    })
    fireEvent.change(screen.getByPlaceholderText('https://api.example.com/v1'), {
      target: { value: 'https://api.openai.com' },
    })

    fireEvent.click(screen.getByText('保存'))

    // 等待 put 完成
    await waitFor(() => {
      expect(mockApi.apiObj.put).toHaveBeenCalledTimes(1)
    })
    expect(mockApi.apiObj.put).toHaveBeenCalledWith('/ai/settings', {
      model: 'openai/gpt-4',
      apiKey: 'sk-test-key',
      endpoint: 'https://api.openai.com',
    })
  })

  test('保存成功后显示 "已保存" 提示，并在 2 秒后自动消失', async () => {
    render(<AIApiConfig />)
    await waitFor(() => {
      expect(screen.getByText('保存')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('保存'))

    // 立即出现 "已保存"
    await waitFor(() => {
      expect(screen.getByText('已保存')).toBeInTheDocument()
    })
    // 等待 2 秒后 setTimeout 触发 setSavedAt(false)，"已保存" 消失
    // 用真实 timers（vitest 默认），waitFor 会持续轮询直到状态变化
    await waitFor(
      () => {
        expect(screen.queryByText('已保存')).not.toBeInTheDocument()
      },
      { timeout: 3000, interval: 100 }
    )
  }, 10000)

  test('保存成功后清空 apiKey 输入框并将 hasApiKey 切换为 true', async () => {
    render(<AIApiConfig />)
    await waitFor(() => {
      expect(screen.getByPlaceholderText('输入 API Key')).toBeInTheDocument()
    })

    const apiKeyInput = screen.getByPlaceholderText('输入 API Key')
    fireEvent.change(apiKeyInput, { target: { value: 'sk-new-key' } })
    fireEvent.click(screen.getByText('保存'))

    await waitFor(() => {
      expect(mockApi.apiObj.put).toHaveBeenCalledTimes(1)
    })
    // apiKey 输入框清空
    await waitFor(() => {
      expect((apiKeyInput as HTMLInputElement).value).toBe('')
    })
    // hasApiKey 切换为 true → placeholder 变为 "••••••••（已配置）"
    await waitFor(() => {
      expect(screen.getByPlaceholderText('••••••••（已配置）')).toBeInTheDocument()
    })
  })

  test('保存中按钮 disabled，文案变为 "保存中..."', async () => {
    // 阻塞 put 完成，保持 saving=true
    mockApi.apiObj.put.mockImplementation(() => new Promise(() => {}))
    render(<AIApiConfig />)
    await waitFor(() => {
      expect(screen.getByText('保存')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('保存'))

    // 按钮变为 "保存中..." 且 disabled
    await waitFor(() => {
      const btn = screen.getByText('保存中...')
      expect(btn).toBeInTheDocument()
      expect(btn.closest('button')).toBeDisabled()
    })
  })

  test('保存失败（ApiError）时调用 alert 显示 "保存失败: <msg>"', async () => {
    mockApi.apiObj.put.mockRejectedValue(
      new mockApi.MockApiError('无效的 API Key', 400)
    )
    render(<AIApiConfig />)
    await waitFor(() => {
      expect(screen.getByText('保存')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('保存'))

    await waitFor(() => {
      expect(alertMock).toHaveBeenCalledWith('保存失败: 无效的 API Key')
    })
  })

  test('保存失败（普通 Error）时 alert 显示 String(err)', async () => {
    mockApi.apiObj.put.mockRejectedValue(new Error('boom'))
    render(<AIApiConfig />)
    await waitFor(() => {
      expect(screen.getByText('保存')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('保存'))

    await waitFor(() => {
      // String(new Error('boom')) === 'Error: boom'（Error 类的 toString 含 name）
      expect(alertMock).toHaveBeenCalledWith('保存失败: Error: boom')
    })
  })

  test('body 中只包含非空字段（model/apiKey/endpoint 任一为空则不提交该字段）', async () => {
    render(<AIApiConfig />)
    await waitFor(() => {
      expect(screen.getByText('保存')).toBeInTheDocument()
    })
    // 只填 model，留空 apiKey 和 endpoint
    fireEvent.change(screen.getByPlaceholderText('stepfun/step-3.7-flash'), {
      target: { value: 'only-model' },
    })
    fireEvent.click(screen.getByText('保存'))

    await waitFor(() => {
      expect(mockApi.apiObj.put).toHaveBeenCalledTimes(1)
    })
    expect(mockApi.apiObj.put).toHaveBeenCalledWith('/ai/settings', {
      model: 'only-model',
    })
  })
})

// ============================================================================
// 5. 连接测试
// ============================================================================
describe('连接测试', () => {
  test('点击测试调用 api.post("/ai/test-connection", body)', async () => {
    render(<AIApiConfig />)
    await waitFor(() => {
      expect(screen.getByText('测试连接')).toBeInTheDocument()
    })

    // 输入字段
    fireEvent.change(screen.getByPlaceholderText('stepfun/step-3.7-flash'), {
      target: { value: 'm1' },
    })
    fireEvent.change(screen.getByPlaceholderText('输入 API Key'), {
      target: { value: 'k1' },
    })
    fireEvent.change(screen.getByPlaceholderText('https://api.example.com/v1'), {
      target: { value: 'e1' },
    })

    fireEvent.click(screen.getByText('测试连接'))

    await waitFor(() => {
      expect(mockApi.apiObj.post).toHaveBeenCalledTimes(1)
    })
    expect(mockApi.apiObj.post).toHaveBeenCalledWith('/ai/test-connection', {
      model: 'm1',
      apiKey: 'k1',
      endpoint: 'e1',
    })
  })

  test('result.ok=true 时显示成功消息（绿色框 + CheckCircle2）', async () => {
    mockApi.apiObj.post.mockResolvedValue({
      ok: true,
      message: '所有检查通过',
    })
    render(<AIApiConfig />)
    await waitFor(() => {
      expect(screen.getByText('测试连接')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('测试连接'))

    await waitFor(() => {
      expect(screen.getByText('所有检查通过')).toBeInTheDocument()
    })
  })

  test('result.ok=true 且无 message 时显示默认 "连接测试通过"', async () => {
    mockApi.apiObj.post.mockResolvedValue({ ok: true })
    render(<AIApiConfig />)
    await waitFor(() => {
      expect(screen.getByText('测试连接')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('测试连接'))

    await waitFor(() => {
      expect(screen.getByText('连接测试通过')).toBeInTheDocument()
    })
  })

  test('result.ok=false 时显示 error 消息（红色框 + XCircle）', async () => {
    mockApi.apiObj.post.mockResolvedValue({
      ok: false,
      error: 'API Key 无效',
    })
    render(<AIApiConfig />)
    await waitFor(() => {
      expect(screen.getByText('测试连接')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('测试连接'))

    await waitFor(() => {
      expect(screen.getByText('API Key 无效')).toBeInTheDocument()
    })
  })

  test('result.ok=false 且无 error 时显示默认 "连接测试失败"', async () => {
    mockApi.apiObj.post.mockResolvedValue({ ok: false })
    render(<AIApiConfig />)
    await waitFor(() => {
      expect(screen.getByText('测试连接')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('测试连接'))

    await waitFor(() => {
      expect(screen.getByText('连接测试失败')).toBeInTheDocument()
    })
  })

  test('api.post 抛 ApiError 时显示错误消息（红色框）', async () => {
    mockApi.apiObj.post.mockRejectedValue(
      new mockApi.MockApiError('网络不可达', 500)
    )
    render(<AIApiConfig />)
    await waitFor(() => {
      expect(screen.getByText('测试连接')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('测试连接'))

    await waitFor(() => {
      expect(screen.getByText('网络不可达')).toBeInTheDocument()
    })
  })

  test('测试中按钮显示 "测试中..." 且 disabled', async () => {
    // 阻塞 post 完成，保持 testing=true
    mockApi.apiObj.post.mockImplementation(() => new Promise(() => {}))
    render(<AIApiConfig />)
    await waitFor(() => {
      expect(screen.getByText('测试连接')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('测试连接'))

    await waitFor(() => {
      const btn = screen.getByText('测试中...')
      expect(btn).toBeInTheDocument()
      expect(btn.closest('button')).toBeDisabled()
    })
  })
})
