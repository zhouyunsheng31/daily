/**
 * tool_result 消息大小边界测试 — Phase 11 P2（任务 1.4）
 *
 * 测试重点（与现有 toolBridge.test.ts 互补，不重复）：
 * - 小数据场景（1KB）：browserEval 正常返回 success
 * - 中等数据场景（50KB）：browserEval 正常返回 success
 * - 大数据场景（>1MB）：browserEval 返回 "Eval result too large" 错误
 * - DOM 内容 >100KB：browserGetDom 截断并附加 "<!-- truncated -->" 标记
 * - 脚本 >10KB：browserEval 返回 "Script too large" 错误
 *
 * 设计依据：
 * - browserToolBridge.ts 的 browserEval 有 MAX_SCRIPT_SIZE=10KB、MAX_RETURN_SIZE=1MB 限制
 * - browserGetDom 截断到 100KB（MAX_SIZE = 100 * 1024）
 * - safeSerialize 处理循环引用/函数/Symbol 后再 JSON.stringify 计算大小
 *
 * 测试策略：
 * - 用 vi.importActual 绕过 browserToolBridge mock，测试真实单例方法
 * - 用 createFakeWebview 构造可控的 webview，模拟 executeJavaScript 返回不同大小数据
 * - 不修改现有 toolBridge.test.ts
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'

// ============================================================================
// 1. vi.hoisted：mock 状态（避免触发 useAppStore / useAIStore 加载链）
// ============================================================================

const hoist = vi.hoisted(() => {
  const appStoreState = {
    activePanelId: 'panel-1' as string | null,
    panelWidgets: {} as Record<string, unknown[]>,
    panelPositions: {} as Record<string, unknown[]>,
    lastActiveWidgetId: null as string | null,
  }
  return { appStoreState }
})

vi.mock('../../stores/useAppStore', () => ({
  useAppStore: {
    getState: () => hoist.appStoreState,
  },
}))

vi.mock('../../stores/useAIStore', () => ({
  useAIStore: {
    getState: () => ({ pendingAskUserRequests: new Map() }),
  },
}))

// ============================================================================
// 2. 导入被测模块（用 importActual 绕过 mock，测试真实单例）
// ============================================================================

const browserModule = await vi.importActual<typeof import('../browserToolBridge')>('../browserToolBridge')

// ============================================================================
// 3. 工具函数：创建可控的 fake webview
// ============================================================================

interface FakeWebview {
  webview: unknown
  triggerReady: () => void
}

function createFakeWebview(opts: {
  evalResult?: unknown
  triggerReady?: boolean
} = {}): FakeWebview {
  // 收集所有 dom-ready handler，便于 triggerReady 函数触发
  const domReadyHandlers: Array<() => void> = []
  const webview = {
    addEventListener: vi.fn((event: string, handler: () => void) => {
      if (event === 'dom-ready') {
        domReadyHandlers.push(handler)
        // triggerReady=true 时立即同步触发 handler（模拟 webview 已就绪）
        // 关键：registerWebview 内部注册的 handler 会立即执行，readyMap.set(widgetId, true)
        //   之后 awaitReady 检查 readyMap=true 立即 return，不会等待 dom-ready 事件
        if (opts.triggerReady) handler()
      }
    }),
    removeEventListener: vi.fn(),
    executeJavaScript: vi.fn().mockResolvedValue(opts.evalResult ?? null),
    capturePage: vi.fn(),
    loadURL: vi.fn(),
    getURL: vi.fn(() => 'https://example.com'),
    getTitle: vi.fn(() => 'Example'),
    goBack: vi.fn(),
    goForward: vi.fn(),
    reload: vi.fn(),
    style: { visibility: '' },
    closest: vi.fn(() => null),
  }
  const proxy = new Proxy(webview, {
    get(target, prop) {
      if (prop in target) return (target as Record<string | symbol, unknown>)[prop]
      return undefined
    },
  })
  return {
    webview: proxy,
    triggerReady: () => {
      // 复制一份避免迭代中 push 干扰
      ;[...domReadyHandlers].forEach(h => h())
    },
  }
}

// ============================================================================
// 4. 测试套件：tool_result 消息大小边界
// ============================================================================

describe('tool_result 消息大小 / browserEval 数据大小边界', () => {
  const WIDGET_ID = 'test-widget-size'

  beforeEach(() => {
    // 确保每次都创建新的 fake webview 并注册
    const reg = browserModule.browserToolBridge.getRegisteredWebviews()
    for (const w of reg) {
      browserModule.browserToolBridge.unregisterWebview(w.widgetId)
    }
  })

  afterEach(() => {
    const reg = browserModule.browserToolBridge.getRegisteredWebviews()
    for (const w of reg) {
      browserModule.browserToolBridge.unregisterWebview(w.widgetId)
    }
  })

  test('小数据（1KB）：browserEval 正常返回 success=true', async () => {
    // 构造 1KB 的字符串数据（远低于 1MB 限制）
    const smallData = 'x'.repeat(1024) // 1KB
    const { webview, triggerReady } = createFakeWebview({
      evalResult: smallData,
      triggerReady: true,
    })
    browserModule.browserToolBridge.registerWebview(WIDGET_ID, webview as never)

    const result = await browserModule.browserToolBridge.browserEval({
      widgetId: WIDGET_ID,
      script: 'return "small"',
    })

    expect(result.success).toBe(true)
    expect(result.data).toBe(smallData)
    // 1KB 远低于 1MB 限制
    expect((result.data as string).length).toBe(1024)
  })

  test('中等数据（50KB）：browserEval 正常返回 success=true', async () => {
    // 构造 50KB 的对象数据
    const mediumData = { content: 'y'.repeat(50 * 1024) }
    const { webview, triggerReady } = createFakeWebview({
      evalResult: mediumData,
      triggerReady: true,
    })
    browserModule.browserToolBridge.registerWebview(WIDGET_ID, webview as never)

    const result = await browserModule.browserToolBridge.browserEval({
      widgetId: WIDGET_ID,
      script: 'return data',
    })

    expect(result.success).toBe(true)
    expect(result.data).toEqual(mediumData)
    // 序列化后约 50KB+（含 JSON 包装），仍远低于 1MB 限制
    const serialized = JSON.stringify(result.data)
    expect(serialized.length).toBeGreaterThan(50 * 1024)
    expect(serialized.length).toBeLessThan(1024 * 1024) // < 1MB
  })

  test('大数据（>1MB）：browserEval 返回 "Eval result too large" 错误', async () => {
    // 构造超过 1MB 的字符串数据
    const largeData = 'z'.repeat(1024 * 1024 + 100) // 1MB + 100 bytes
    const { webview, triggerReady } = createFakeWebview({
      evalResult: largeData,
      triggerReady: true,
    })
    browserModule.browserToolBridge.registerWebview(WIDGET_ID, webview as never)

    const result = await browserModule.browserToolBridge.browserEval({
      widgetId: WIDGET_ID,
      script: 'return large',
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('Eval result too large')
    // 错误消息应包含实际大小和最大限制（便于排查）
    expect(result.error).toContain('bytes')
    expect(result.error).toContain('max')
  })

  test('临界数据（恰好 1MB）：browserEval 正常返回（边界值）', async () => {
    // 恰好 1MB = 1024*1024 字节（序列化后等于 MAX_RETURN_SIZE，应通过）
    // 注：JSON.stringify(s) 对字符串会加上 "" 引号，所以实际序列化后是 1024*1024 + 2 = 1MB + 2 字节
    // 这里用 1024*1024 - 2 让序列化后恰好等于 1MB 边界
    const boundaryData = 'b'.repeat(1024 * 1024 - 2)
    const { webview, triggerReady } = createFakeWebview({
      evalResult: boundaryData,
      triggerReady: true,
    })
    browserModule.browserToolBridge.registerWebview(WIDGET_ID, webview as never)

    const result = await browserModule.browserToolBridge.browserEval({
      widgetId: WIDGET_ID,
      script: 'return boundary',
    })

    expect(result.success).toBe(true)
    expect(result.data).toBe(boundaryData)
  })
})

// ============================================================================
// 5. 测试套件：browserGetDom 截断边界
// ============================================================================

describe('tool_result 消息大小 / browserGetDom 截断边界', () => {
  const WIDGET_ID = 'test-widget-dom'

  beforeEach(() => {
    const reg = browserModule.browserToolBridge.getRegisteredWebviews()
    for (const w of reg) {
      browserModule.browserToolBridge.unregisterWebview(w.widgetId)
    }
  })

  afterEach(() => {
    const reg = browserModule.browserToolBridge.getRegisteredWebviews()
    for (const w of reg) {
      browserModule.browserToolBridge.unregisterWebview(w.widgetId)
    }
  })

  test('小 DOM（10KB）：browserGetDom 原样返回（不截断）', async () => {
    const smallDom = '<div>' + 'a'.repeat(10 * 1024) + '</div>'
    const { webview, triggerReady } = createFakeWebview({
      evalResult: smallDom,
      triggerReady: true,
    })
    browserModule.browserToolBridge.registerWebview(WIDGET_ID, webview as never)

    const result = await browserModule.browserToolBridge.browserGetDom({
      widgetId: WIDGET_ID,
    })

    expect(result.success).toBe(true)
    expect(result.data).toBe(smallDom)
    expect((result.data as string).length).toBe(smallDom.length)
  })

  test('大 DOM（>100KB）：browserGetDom 截断到 100KB 并附加 "<!-- truncated -->" 标记', async () => {
    // 构造超过 100KB 的 DOM 字符串
    const largeDom = '<div>' + 'b'.repeat(100 * 1024 + 500) + '</div>'
    const { webview, triggerReady } = createFakeWebview({
      evalResult: largeDom,
      triggerReady: true,
    })
    browserModule.browserToolBridge.registerWebview(WIDGET_ID, webview as never)

    const result = await browserModule.browserToolBridge.browserGetDom({
      widgetId: WIDGET_ID,
    })

    expect(result.success).toBe(true)
    const data = result.data as string
    // 应被截断到 100KB + 标记
    expect(data.length).toBeLessThanOrEqual(100 * 1024 + 50) // 留出标记长度
    expect(data.length).toBeGreaterThan(100 * 1024 - 1) // 至少 100KB
    // 必须包含截断标记
    expect(data).toContain('<!-- truncated -->')
  })

  test('临界 DOM（恰好 100KB）：browserGetDom 不截断（边界值）', async () => {
    // 恰好 100KB = 100 * 1024 字节
    const boundaryDom = 'c'.repeat(100 * 1024)
    const { webview, triggerReady } = createFakeWebview({
      evalResult: boundaryDom,
      triggerReady: true,
    })
    browserModule.browserToolBridge.registerWebview(WIDGET_ID, webview as never)

    const result = await browserModule.browserToolBridge.browserGetDom({
      widgetId: WIDGET_ID,
    })

    expect(result.success).toBe(true)
    expect(result.data).toBe(boundaryDom)
    // 不应包含截断标记
    expect(result.data).not.toContain('<!-- truncated -->')
  })
})

// ============================================================================
// 6. 测试套件：browserEval 脚本大小限制
// ============================================================================

describe('tool_result 消息大小 / browserEval 脚本大小限制', () => {
  const WIDGET_ID = 'test-widget-script'

  beforeEach(() => {
    const reg = browserModule.browserToolBridge.getRegisteredWebviews()
    for (const w of reg) {
      browserModule.browserToolBridge.unregisterWebview(w.widgetId)
    }
  })

  afterEach(() => {
    const reg = browserModule.browserToolBridge.getRegisteredWebviews()
    for (const w of reg) {
      browserModule.browserToolBridge.unregisterWebview(w.widgetId)
    }
  })

  test('小脚本（1KB）：browserEval 正常执行', async () => {
    const smallScript = 'd'.repeat(1024)
    const { webview, triggerReady } = createFakeWebview({
      evalResult: 'ok',
      triggerReady: true,
    })
    browserModule.browserToolBridge.registerWebview(WIDGET_ID, webview as never)

    const result = await browserModule.browserToolBridge.browserEval({
      widgetId: WIDGET_ID,
      script: smallScript,
    })

    expect(result.success).toBe(true)
  })

  test('大脚本（>10KB）：browserEval 返回 "Script too large" 错误', async () => {
    // 构造超过 10KB 的脚本
    const largeScript = 'e'.repeat(10 * 1024 + 1) // 10KB + 1 byte
    const { webview, triggerReady } = createFakeWebview({
      evalResult: null,
      triggerReady: true,
    })
    browserModule.browserToolBridge.registerWebview(WIDGET_ID, webview as never)

    const result = await browserModule.browserToolBridge.browserEval({
      widgetId: WIDGET_ID,
      script: largeScript,
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('Script too large')
    // 错误消息应包含实际大小和最大限制
    expect(result.error).toContain(String(largeScript.length))
    expect(result.error).toContain('10240') // 10 * 1024
  })

  test('临界脚本（恰好 10KB）：browserEval 正常执行（边界值）', async () => {
    // 恰好 10KB = 10 * 1024 字节
    const boundaryScript = 'f'.repeat(10 * 1024)
    const { webview, triggerReady } = createFakeWebview({
      evalResult: 'ok',
      triggerReady: true,
    })
    browserModule.browserToolBridge.registerWebview(WIDGET_ID, webview as never)

    const result = await browserModule.browserToolBridge.browserEval({
      widgetId: WIDGET_ID,
      script: boundaryScript,
    })

    expect(result.success).toBe(true)
  })
})
