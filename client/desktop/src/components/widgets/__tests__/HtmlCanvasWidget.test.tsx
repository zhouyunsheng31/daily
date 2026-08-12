/**
 * HtmlCanvasWidget 组件 vitest 单元测试（Phase 11 P0）
 *
 * 测试目标：
 * - html 为空时显示 "等待 agent 生成内容..." 占位
 * - html 非空时渲染 iframe，显示 "加载中..."，iframe onLoad 后 "加载中..." 消失
 * - 收到 html_widget_error postMessage 时调用 useAIStore.reportWidgetError 回传错误
 * - 错误状态下显示 "⚠ {lastError}" 提示条
 *
 * mock 策略：
 * - vi.mock('../../../utils/iframeProxy') 替换 generateToken/getInitScript/handleCanvasAction
 *   createMessageHandler 保留核心逻辑（处理 html_widget_error → 调用 onError）
 * - vi.mock('../../../stores/useAIStore') 替换 useAIStore.getState().reportWidgetError
 * - vi.mock('../../../utils/dbStores/htmlWidgets') 替换数据库操作，避免副作用
 *
 * 注意：
 * - 实际源码确实用 useAIStore.reportWidgetError 回传错误（与任务描述的怀疑不同）
 * - onError 用 queueMicrotask 异步调用 setLastError，需用 waitFor
 * - reportWidgetError 是同步调用
 * - 不修改源代码；只读源代码以对齐行为
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

// ============================================================================
// mock useAIStore：提供 getState() 返回 reportWidgetError
// ============================================================================
const mockUseAIStore = vi.hoisted(() => {
  const state = {
    reportWidgetError: vi.fn(),
  }
  return { state }
})

vi.mock('../../../stores/useAIStore', () => ({
  useAIStore: {
    getState: () => mockUseAIStore.state,
  },
}))

// ============================================================================
// 注意：不 mock iframeProxy，使用真实实现。
// 原因：mock iframeProxy 会在 --no-file-parallelism 模式下泄漏到 iframeProxy.test.ts，
// 导致其 mock 被覆盖。iframeProxy 是纯函数模块（createMessageHandler 不依赖数据库），
// 真实导入安全。handleCanvasAction 不会被触发（测试不发送 canvas_action 消息）。
// ============================================================================

// ============================================================================
// mock dbStores/htmlWidgets：避免数据库副作用
// ============================================================================
vi.mock('../../../utils/dbStores/htmlWidgets', () => ({
  getHtmlWidget: vi.fn().mockResolvedValue(null),
  updateHtmlWidget: vi.fn().mockResolvedValue({ id: 'test-id' }),
  createHtmlWidget: vi.fn().mockResolvedValue({ id: 'new-id' }),
}))

// ============================================================================
// 导入被测组件（必须在 vi.mock 之后）
// ============================================================================
import HtmlCanvasWidget from '../HtmlCanvasWidget'

// ============================================================================
// 公共 Props 工厂
// ============================================================================
function makeProps(overrides: Partial<{
  widgetId: string
  panelId: string
  html: string
  title: string
  htmlWidgetId: string
  onUpdateState: ReturnType<typeof vi.fn>
}> = {}) {
  const state: Record<string, unknown> = {}
  if (overrides.html !== undefined) state.html = overrides.html
  if (overrides.title !== undefined) state.title = overrides.title
  if (overrides.htmlWidgetId !== undefined) state.htmlWidgetId = overrides.htmlWidgetId
  return {
    widgetId: overrides.widgetId ?? 'widget-1',
    panelId: overrides.panelId ?? 'panel-1',
    state,
    onUpdateState: overrides.onUpdateState ?? vi.fn(),
  }
}

beforeEach(() => {
  mockUseAIStore.state.reportWidgetError = vi.fn()
  // 抑制源码 console.error 污染
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

/**
 * 强制 iframe.contentWindow 为 null
 *
 * 必要性：happy-dom 中 iframe.contentWindow 是 BrowserWindow 对象（非 null），
 * 导致 HtmlCanvasWidget 的 createMessageHandler 中 source 校验：
 *   if (expected && event.source !== expected) return
 * expected 是 BrowserWindow，event.source 是 undefined，进入 return，消息被丢弃。
 *
 * 修复：render 后强制设置 contentWindow = null，让 expected = null，
 * 短路条件不成立，html_widget_error 消息能正常处理。
 */
function nullifyIframeContentWindow(): void {
  const iframe = document.querySelector('iframe')
  if (iframe) {
    Object.defineProperty(iframe, 'contentWindow', {
      value: null,
      configurable: true,
      writable: true,
    })
  }
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

// ============================================================================
// 1. html 为空时显示占位
// ============================================================================
describe('html 为空时显示占位', () => {
  test('state.html 为空时显示 "等待 agent 生成内容..."，不渲染 iframe', () => {
    // 用例目的：验证空内容时显示占位文本，不渲染 iframe
    render(<HtmlCanvasWidget {...makeProps({ html: '' })} />)
    expect(screen.getByText('等待 agent 生成内容...')).toBeInTheDocument()
    expect(document.querySelector('iframe')).not.toBeInTheDocument()
  })

  test('state.html 为 undefined 时也显示占位（typeof state.html !== "string" 兜底）', () => {
    // 用例目的：验证 state.html 非 string 时也显示占位
    render(<HtmlCanvasWidget {...makeProps({})} />)
    expect(screen.getByText('等待 agent 生成内容...')).toBeInTheDocument()
  })
})

// ============================================================================
// 2. html 非空时渲染 iframe + 加载状态
// ============================================================================
describe('html 非空时渲染 iframe', () => {
  test('html 非空时渲染 iframe，初始显示 "加载中..."（loading=true）', () => {
    // 用例目的：验证有内容时渲染 iframe，且初始 loading 状态显示加载提示
    render(<HtmlCanvasWidget {...makeProps({ html: '<p>hello</p>' })} />)
    const iframe = document.querySelector('iframe')
    expect(iframe).toBeInTheDocument()
    // 加载提示
    expect(screen.getByText('加载中...')).toBeInTheDocument()
  })

  test('iframe onLoad 后 "加载中..." 消失（loading=false）', () => {
    // 用例目的：验证 iframe 加载完成后隐藏加载提示
    const { container } = render(<HtmlCanvasWidget {...makeProps({ html: '<p>hello</p>' })} />)
    const iframe = container.querySelector('iframe')
    expect(iframe).toBeInTheDocument()
    expect(screen.getByText('加载中...')).toBeInTheDocument()

    // 触发 iframe onLoad
    fireEvent.load(iframe!)

    // 加载提示消失
    expect(screen.queryByText('加载中...')).not.toBeInTheDocument()
  })

  test('iframe 渲染时 title 来自 state.title', () => {
    // 用例目的：验证 iframe 的 title 属性来自 state.title
    const { container } = render(
      <HtmlCanvasWidget {...makeProps({ html: '<p>hi</p>', title: 'My Canvas' })} />
    )
    const iframe = container.querySelector('iframe')
    expect(iframe).toHaveAttribute('title', 'My Canvas')
  })

  test('iframe 渲染时 title 默认为 "HTML Canvas"（state.title 为空时）', () => {
    // 用例目的：验证无 title 时 iframe title 默认为 "HTML Canvas"
    const { container } = render(
      <HtmlCanvasWidget {...makeProps({ html: '<p>hi</p>' })} />
    )
    const iframe = container.querySelector('iframe')
    expect(iframe).toHaveAttribute('title', 'HTML Canvas')
  })
})

// ============================================================================
// 3. 错误回传：收到 html_widget_error postMessage 时调用 useAIStore.reportWidgetError
// ============================================================================
describe('错误回传：html_widget_error → useAIStore.reportWidgetError', () => {
  test('收到 html_widget_error postMessage 时调用 reportWidgetError(widgetId, panelId, error)', async () => {
    // 用例目的：验证错误消息触发 reportWidgetError，携带正确的 widgetId/panelId/error
    render(<HtmlCanvasWidget {...makeProps({ html: '<p>hello</p>', widgetId: 'w-1', panelId: 'p-1' })} />)
    nullifyIframeContentWindow()

    // 模拟 iframe 内抛出错误，postMessage 到父窗口
    window.dispatchEvent(new MessageEvent('message', {
      data: {
        type: 'html_widget_error',
        message: 'ReferenceError: x is not defined',
        stack: 'at line 1\nat line 2',
        source: 'runtime',
      },
    }))

    // reportWidgetError 应被调用，携带正确的参数
    await waitFor(() => {
      expect(mockUseAIStore.state.reportWidgetError).toHaveBeenCalledTimes(1)
    })
    expect(mockUseAIStore.state.reportWidgetError).toHaveBeenCalledWith(
      'w-1',
      'p-1',
      {
        message: 'ReferenceError: x is not defined',
        stack: 'at line 1\nat line 2',
        source: 'runtime',
      },
    )
  })

  test('source 缺失时默认为 "runtime"', async () => {
    // 用例目的：验证 source 字段缺失时回退为 'runtime'
    render(<HtmlCanvasWidget {...makeProps({ html: '<p>hello</p>' })} />)
    nullifyIframeContentWindow()

    window.dispatchEvent(new MessageEvent('message', {
      data: {
        type: 'html_widget_error',
        message: 'some error',
      },
    }))

    await waitFor(() => {
      expect(mockUseAIStore.state.reportWidgetError).toHaveBeenCalledTimes(1)
    })
    const callArgs = mockUseAIStore.state.reportWidgetError.mock.calls[0][2]
    expect(callArgs.source).toBe('runtime')
  })

  test('message 缺失时默认为 "(unknown error)"', async () => {
    // 用例目的：验证 message 字段缺失时回退为 '(unknown error)'
    render(<HtmlCanvasWidget {...makeProps({ html: '<p>hello</p>' })} />)
    nullifyIframeContentWindow()

    window.dispatchEvent(new MessageEvent('message', {
      data: {
        type: 'html_widget_error',
        source: 'promise',
      },
    }))

    await waitFor(() => {
      expect(mockUseAIStore.state.reportWidgetError).toHaveBeenCalledTimes(1)
    })
    const callArgs = mockUseAIStore.state.reportWidgetError.mock.calls[0][2]
    expect(callArgs.message).toBe('(unknown error)')
    expect(callArgs.source).toBe('promise')
  })
})

// ============================================================================
// 4. 错误状态下的 UI 显示
// ============================================================================
describe('错误状态下的 UI 显示', () => {
  test('收到错误消息后显示 "⚠ {lastError}" 提示条', async () => {
    // 用例目的：验证错误消息在 UI 上显示为警告条
    render(<HtmlCanvasWidget {...makeProps({ html: '<p>hello</p>' })} />)
    nullifyIframeContentWindow()

    // 初始无错误提示
    expect(screen.queryByText(/⚠/)).not.toBeInTheDocument()

    window.dispatchEvent(new MessageEvent('message', {
      data: {
        type: 'html_widget_error',
        message: 'TypeError: cannot read property',
        source: 'runtime',
      },
    }))

    // 错误提示条出现（⚠ + 消息文本）
    await waitFor(() => {
      expect(screen.getByText(/TypeError: cannot read property/)).toBeInTheDocument()
    })
    // 验证 ⚠ 符号也存在（用 title 属性或文本内容）
    const errorBar = screen.getByText(/TypeError: cannot read property/)
    expect(errorBar.title).toBe('TypeError: cannot read property')
  })

  test('html 内容变化时清除上一次的 lastError', async () => {
    // 用例目的：验证新内容加载时清除之前的错误状态
    // 通过 state.html 变化触发 html 更新 → setLastError(null) + setIframeLoaded(false)
    const onUpdateState = vi.fn()
    const { rerender } = render(
      <HtmlCanvasWidget
        {...makeProps({ html: '<p>old</p>', onUpdateState })}
      />
    )
    nullifyIframeContentWindow()

    // 触发一个错误
    window.dispatchEvent(new MessageEvent('message', {
      data: {
        type: 'html_widget_error',
        message: 'old error',
        source: 'runtime',
      },
    }))
    await waitFor(() => {
      expect(screen.getByText(/old error/)).toBeInTheDocument()
    })

    // 重新渲染，state.html 变化（模拟 agent 生成新内容）
    rerender(
      <HtmlCanvasWidget
        {...makeProps({ html: '<p>new content</p>', onUpdateState })}
      />
    )
    nullifyIframeContentWindow()

    // 上一次的错误提示应消失（setLastError(null)）
    await waitFor(() => {
      expect(screen.queryByText(/old error/)).not.toBeInTheDocument()
    })
  })

  test('收到非 html_widget_error 类型的 message 不触发错误回传', async () => {
    // 用例目的：验证只处理 html_widget_error，忽略其他 message 类型
    render(<HtmlCanvasWidget {...makeProps({ html: '<p>hello</p>' })} />)
    nullifyIframeContentWindow()

    // 发送 canvas_action 类型（不是 error）
    window.dispatchEvent(new MessageEvent('message', {
      data: {
        type: 'canvas_action',
        token: 'test-token-fixed',
        action: 'read_storage',
        params: { key: 'test' },
        requestId: 'req-1',
      },
    }))

    // 等待一个微任务周期
    await new Promise((r) => setTimeout(r, 50))

    // reportWidgetError 不应被调用
    expect(mockUseAIStore.state.reportWidgetError).not.toHaveBeenCalled()
    // 错误提示条不应显示
    expect(screen.queryByText(/⚠/)).not.toBeInTheDocument()
  })
})
