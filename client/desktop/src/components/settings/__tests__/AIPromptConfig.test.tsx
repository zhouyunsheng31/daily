/**
 * AIPromptConfig 组件 vitest 单元测试（Phase 11 P0）
 *
 * 测试目标：
 * - 渲染 3 个 textarea（系统/画布/浏览器提示词）+ label/desc
 * - GET /ai/prompts 加载后回填 3 个 textarea 值
 * - 编辑 textarea 后点击"保存"调用 api.put('/ai/prompts', body)
 * - 保存成功显示 "已保存" 提示（2s 后消失）
 * - 点击"恢复默认" → confirm 确认 → 调用 api.post('/ai/prompts/reset') 并回填 defaults
 * - 点击"恢复默认" → confirm 取消 → 不调用 api.post
 * - loading 状态：挂载时显示 spinner，标题未渲染
 *
 * mock 策略：
 * - vi.mock('../../../api/client') 替换 api 对象和 ApiError 类
 * - 用 vi.hoisted 暴露可变 mockApi，便于每个用例控制返回值/抛错
 * - window.confirm / window.alert 用 vi.fn() 替换
 *
 * 注意：
 * - 实际源码【没有 tab 切换】，是同时显示 3 个 textarea（与任务描述不同，按实际源码）
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
import AIPromptConfig from '../AIPromptConfig'

// ============================================================================
// 公共：默认 GET /ai/prompts 返回值
// ============================================================================
function defaultPromptsResponse(overrides: Partial<{
  systemPrompt: string
  canvasPrompt: string
  browserPrompt: string
  defaults: { systemPrompt: string; canvasPrompt: string; browserPrompt: string }
}> = {}) {
  return {
    systemPrompt: 'default-system',
    canvasPrompt: 'default-canvas',
    browserPrompt: 'default-browser',
    defaults: {
      systemPrompt: 'factory-system',
      canvasPrompt: 'factory-canvas',
      browserPrompt: 'factory-browser',
    },
    ...overrides,
  }
}

// 保存原始 alert/confirm
const originalAlert = (window as { alert?: unknown }).alert
const originalConfirm = (window as { confirm?: unknown }).confirm
const alertMock = vi.fn()
const confirmMock = vi.fn()

beforeEach(() => {
  // 默认 GET 成功返回
  mockApi.apiObj.get.mockResolvedValue(defaultPromptsResponse())
  mockApi.apiObj.post.mockResolvedValue(defaultPromptsResponse())
  mockApi.apiObj.put.mockResolvedValue({ ok: true })

  // mock alert/confirm（happy-dom 中可能无，直接赋值更稳）
  ;(window as unknown as { alert: typeof alertMock }).alert = alertMock
  ;(window as unknown as { confirm: typeof confirmMock }).confirm = confirmMock
  alertMock.mockClear()
  confirmMock.mockReturnValue(true) // 默认 confirm 确认
  // 抑制源码 console.error 污染
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.clearAllMocks()
  // 恢复 alert/confirm
  ;(window as unknown as { alert: unknown }).alert = originalAlert
  ;(window as unknown as { confirm: unknown }).confirm = originalConfirm
})

// ============================================================================
// 1. 渲染：3 个 label + 3 个 textarea + 操作按钮
// ============================================================================
describe('渲染：3 个 textarea + label/desc + 操作按钮', () => {
  test('加载完成后渲染 3 个 label（系统/画布/浏览器提示词）+ 标题', async () => {
    // 用例目的：验证组件渲染 3 个 label 和标题
    render(<AIPromptConfig />)
    await waitFor(() => {
      expect(screen.getByText('提示词配置')).toBeInTheDocument()
    })
    expect(screen.getByText('系统提示词')).toBeInTheDocument()
    expect(screen.getByText('画布提示词')).toBeInTheDocument()
    expect(screen.getByText('浏览器提示词')).toBeInTheDocument()
  })

  test('渲染 3 个 desc 描述文本', async () => {
    // 用例目的：验证 3 个 desc 文本正确渲染
    render(<AIPromptConfig />)
    await waitFor(() => {
      expect(screen.getByText('提示词配置')).toBeInTheDocument()
    })
    expect(screen.getByText('覆盖/追加默认系统提示词（影响所有 AI 对话）')).toBeInTheDocument()
    expect(screen.getByText('画布模式下的 AI 行为提示词')).toBeInTheDocument()
    expect(screen.getByText('浏览器模式下的 AI 行为提示词')).toBeInTheDocument()
  })

  test('渲染 3 个 textarea（通过 placeholder 定位）+ 2 个操作按钮', async () => {
    // 用例目的：验证 3 个 textarea 和"恢复默认"/"保存"按钮渲染
    render(<AIPromptConfig />)
    await waitFor(() => {
      expect(screen.getByPlaceholderText('输入系统提示词...')).toBeInTheDocument()
    })
    expect(screen.getByPlaceholderText('输入画布提示词...')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('输入浏览器提示词...')).toBeInTheDocument()
    // 操作按钮
    expect(screen.getByText('恢复默认')).toBeInTheDocument()
    expect(screen.getByText('保存')).toBeInTheDocument()
  })
})

// ============================================================================
// 2. GET /ai/prompts 加载后回填 textarea 值
// ============================================================================
describe('GET /ai/prompts 加载与回填', () => {
  test('挂载时调用 api.get("/ai/prompts") 加载提示词', async () => {
    // 用例目的：验证挂载时发起 GET 请求
    render(<AIPromptConfig />)
    await waitFor(() => {
      expect(mockApi.apiObj.get).toHaveBeenCalledWith('/ai/prompts')
    })
    expect(mockApi.apiObj.get).toHaveBeenCalledTimes(1)
  })

  test('加载完成后 3 个 textarea 回填 GET 返回值', async () => {
    // 用例目的：验证 GET 返回的 3 个提示词被回填到 textarea
    mockApi.apiObj.get.mockResolvedValue(
      defaultPromptsResponse({
        systemPrompt: 'custom-sys',
        canvasPrompt: 'custom-canvas',
        browserPrompt: 'custom-browser',
      })
    )
    render(<AIPromptConfig />)
    await waitFor(() => {
      expect(screen.getByDisplayValue('custom-sys')).toBeInTheDocument()
    })
    expect(screen.getByDisplayValue('custom-canvas')).toBeInTheDocument()
    expect(screen.getByDisplayValue('custom-browser')).toBeInTheDocument()
  })
})

// ============================================================================
// 3. 编辑 textarea 后点击"保存"调用 api.put
// ============================================================================
describe('保存提示词', () => {
  test('编辑 textarea 后点击"保存"调用 api.put("/ai/prompts", body)', async () => {
    // 用例目的：验证编辑后保存调用 PUT，body 包含 3 个字段
    render(<AIPromptConfig />)
    await waitFor(() => {
      expect(screen.getByPlaceholderText('输入系统提示词...')).toBeInTheDocument()
    })

    // 编辑 3 个 textarea
    fireEvent.change(screen.getByPlaceholderText('输入系统提示词...'), {
      target: { value: 'new-system' },
    })
    fireEvent.change(screen.getByPlaceholderText('输入画布提示词...'), {
      target: { value: 'new-canvas' },
    })
    fireEvent.change(screen.getByPlaceholderText('输入浏览器提示词...'), {
      target: { value: 'new-browser' },
    })

    fireEvent.click(screen.getByText('保存'))

    await waitFor(() => {
      expect(mockApi.apiObj.put).toHaveBeenCalledTimes(1)
    })
    expect(mockApi.apiObj.put).toHaveBeenCalledWith('/ai/prompts', {
      systemPrompt: 'new-system',
      canvasPrompt: 'new-canvas',
      browserPrompt: 'new-browser',
    })
  })

  test('保存成功后显示 "已保存" 提示，并在 2 秒后消失', async () => {
    // 用例目的：验证保存成功后短暂显示"已保存"提示
    render(<AIPromptConfig />)
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
})

// ============================================================================
// 4. "恢复默认" 按钮 → confirm → api.post('/ai/prompts/reset')
// ============================================================================
describe('恢复默认提示词', () => {
  test('点击"恢复默认" → confirm 确认 → 调用 api.post("/ai/prompts/reset") 并回填 defaults', async () => {
    // 用例目的：验证 confirm 确认后调用 POST reset，并用返回的 defaults 回填
    confirmMock.mockReturnValue(true)
    // reset 返回的 defaults 与初始 GET 不同，便于验证回填
    mockApi.apiObj.post.mockResolvedValue(
      defaultPromptsResponse({
        defaults: {
          systemPrompt: 'factory-system-new',
          canvasPrompt: 'factory-canvas-new',
          browserPrompt: 'factory-browser-new',
        },
      })
    )
    render(<AIPromptConfig />)
    await waitFor(() => {
      expect(screen.getByText('恢复默认')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('恢复默认'))

    await waitFor(() => {
      expect(mockApi.apiObj.post).toHaveBeenCalledWith('/ai/prompts/reset')
    })
    expect(confirmMock).toHaveBeenCalledTimes(1)
    // 验证 confirm 提示文本
    expect(confirmMock).toHaveBeenCalledWith(
      '确定要恢复默认提示词吗？当前自定义提示词将被覆盖。'
    )
    // 验证用返回的 defaults 回填 textarea
    await waitFor(() => {
      expect(screen.getByDisplayValue('factory-system-new')).toBeInTheDocument()
    })
    expect(screen.getByDisplayValue('factory-canvas-new')).toBeInTheDocument()
    expect(screen.getByDisplayValue('factory-browser-new')).toBeInTheDocument()
  })

  test('点击"恢复默认" → confirm 取消 → 不调用 api.post', async () => {
    // 用例目的：验证 confirm 取消时不会发起 POST 请求
    confirmMock.mockReturnValue(false)
    render(<AIPromptConfig />)
    await waitFor(() => {
      expect(screen.getByText('恢复默认')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('恢复默认'))

    // confirm 被调用，但 post 不应被调用
    expect(confirmMock).toHaveBeenCalledTimes(1)
    // 等待一个微任务周期确保没有异步调用
    await new Promise((r) => setTimeout(r, 50))
    expect(mockApi.apiObj.post).not.toHaveBeenCalled()
  })

  test('恢复中按钮显示 "恢复中..." 文案且 disabled', async () => {
    // 用例目的：验证 reset 期间按钮文案变化和 disabled 状态
    confirmMock.mockReturnValue(true)
    // 阻塞 post 完成，保持 resetting=true
    mockApi.apiObj.post.mockImplementation(() => new Promise(() => {}))
    render(<AIPromptConfig />)
    await waitFor(() => {
      expect(screen.getByText('恢复默认')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('恢复默认'))

    // 按钮变为 "恢复中..." 且 disabled
    await waitFor(() => {
      const btn = screen.getByText('恢复中...')
      expect(btn).toBeInTheDocument()
      expect(btn.closest('button')).toBeDisabled()
    })
  })
})

// ============================================================================
// 5. loading 状态
// ============================================================================
describe('loading 状态', () => {
  test('挂载时 loading=true，标题未渲染，显示 spinner', () => {
    // 用例目的：验证 loading 期间不渲染表单
    // 阻塞 GET，保持 loading=true
    mockApi.apiObj.get.mockImplementation(() => new Promise(() => {}))
    render(<AIPromptConfig />)
    // loading 期间标题和 textarea 不应渲染
    expect(screen.queryByText('提示词配置')).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText('输入系统提示词...')).not.toBeInTheDocument()
    // spinner 存在（lucide Loader2 渲染为 svg，className="animate-spin"）
    expect(document.querySelector('.animate-spin')).toBeInTheDocument()
  })
})
