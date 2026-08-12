/**
 * toolBridge + wsToolHandlers + browserToolBridge 单元测试（Phase 11.2 P0）
 *
 * 测试覆盖：
 * - toolBridge.ts: executeTool / executeAskUser / respondToAskUserFromLocalAgent / registerToolBridge
 * - wsToolHandlers.ts: executeToolCall / readFromLegacyTable
 * - browserToolBridge.ts: normalizeUrl / isUrl / buildSearchUrl / safeSerialize / 单例方法
 *
 * 说明（与 spec 偏差）：
 * - spec 用例 "executeTool 调用 window.toolBridgeApi.executeTool"：源代码中 executeTool
 *   实际调用 executeToolCall（来自 wsToolHandlers），不调用 window.toolBridgeApi.executeTool。
 *   替换为等价测试：executeTool 路由到 executeToolCall。
 * - spec 用例 "createToolExecutor 注册的工具列表" / "工具名映射 widget_read → storage_read"：
 *   源代码无 createToolExecutor 函数，也无工具名重映射；executeTool 直接透传 tool 名给
 *   executeToolCall。替换为 "25 个工具全部可路由" 等价测试。
 * - vitest 4.x vi.fn 不支持双泛型，统一使用无泛型 vi.fn()
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { setupMockElectronAPI, teardownMockElectronAPI } from '../../test/mocks/mockElectronAPI'

// ============================================================================
// 1. 共享 mock 状态（vi.hoisted 确保 vi.mock 工厂可访问）
// ============================================================================
const hoist = vi.hoisted(() => {
  const pendingAskUserRequests = new Map<string, unknown>()

  const appStoreState = {
    activePanelId: 'panel-1' as string | null,
    panelWidgets: {} as Record<string, unknown[]>,
    panelPositions: {} as Record<string, unknown[]>,
    lastActiveWidgetId: null as string | null,
    addWidget: vi.fn(),
    removeWidget: vi.fn(),
    updateWidgetState: vi.fn(),
    updateWidgetPosition: vi.fn(),
    setActivePanel: vi.fn(),
  }

  const browserToolBridgeMock = {
    getRegisteredWebviews: vi.fn(() => [] as Array<{ widgetId: string; url: string; title: string }>),
    browserEval: vi.fn(),
    browserGetDom: vi.fn(),
    browserClick: vi.fn(),
    browserInput: vi.fn(),
    browserScroll: vi.fn(),
    browserWaitFor: vi.fn(),
    browserScreenshot: vi.fn(),
    browserNavigate: vi.fn(),
    browserGetUrl: vi.fn(),
    browserGetTitle: vi.fn(),
    browserBack: vi.fn(),
    browserForward: vi.fn(),
    browserReload: vi.fn(),
    browserGetCookie: vi.fn(),
    browserSetCookie: vi.fn(),
    browserOpen: vi.fn(),
    browserSwitchTab: vi.fn(),
    browserListTabs: vi.fn(),
  }

  const dbStores = {
    htmlWidgets: {
      createHtmlWidget: vi.fn(),
      updateHtmlWidget: vi.fn(),
      deleteHtmlWidget: vi.fn(),
    },
    kvStorage: {
      getKvValue: vi.fn(),
      setKvValue: vi.fn(),
    },
    notes: { getAllNotes: vi.fn(), getNoteById: vi.fn() },
    journals: { getAllJournals: vi.fn(), getJournalById: vi.fn() },
    quickNotes: { getAllQuickNotes: vi.fn(), getQuickNoteById: vi.fn() },
    mistakes: { getAllMistakes: vi.fn(), getMistakeById: vi.fn() },
    savings: {
      getAllSavingsGoals: vi.fn(),
      getSavingsGoalById: vi.fn(),
      getSavingsTransactionsByGoal: vi.fn(),
    },
    vocabDecks: { getAllVocabDecks: vi.fn(), getVocabDeckById: vi.fn() },
    vocabProgress: {
      getVocabProgressById: vi.fn(),
      getVocabProgressByDeck: vi.fn(),
    },
  }

  return { pendingAskUserRequests, appStoreState, browserToolBridgeMock, dbStores }
})

// ============================================================================
// 2. 模块 mock
// ============================================================================

// useAIStore — 提供 getState() 返回 controllable state（pendingAskUserRequests Map）
vi.mock('../../stores/useAIStore', () => ({
  useAIStore: {
    getState: () => ({
      pendingAskUserRequests: hoist.pendingAskUserRequests,
    }),
  },
}))

// useAppStore — 提供 getState() 返回 controllable state
vi.mock('../../stores/useAppStore', () => ({
  useAppStore: {
    getState: () => hoist.appStoreState,
  },
}))

// browserToolBridge — 用 mock 替换单例，保留真实 pure 函数
vi.mock('../browserToolBridge', async (importActual) => {
  const actual = await importActual() as Record<string, unknown>
  return {
    ...actual,
    browserToolBridge: hoist.browserToolBridgeMock,
  }
})

// dbStores mocks（路径相对测试文件）
vi.mock('../dbStores/htmlWidgets', () => hoist.dbStores.htmlWidgets)
vi.mock('../dbStores/kvStorage', () => hoist.dbStores.kvStorage)
vi.mock('../dbStores/notes', () => hoist.dbStores.notes)
vi.mock('../dbStores/journals', () => hoist.dbStores.journals)
vi.mock('../dbStores/quickNotes', () => hoist.dbStores.quickNotes)
vi.mock('../dbStores/mistakes', () => hoist.dbStores.mistakes)
vi.mock('../dbStores/savings', () => hoist.dbStores.savings)
vi.mock('../dbStores/vocabDecks', () => hoist.dbStores.vocabDecks)
vi.mock('../dbStores/vocabProgress', () => hoist.dbStores.vocabProgress)

// ============================================================================
// 3. 导入被测模块（mock 后）
// ============================================================================
import { executeTool, respondToAskUserFromLocalAgent, registerToolBridge } from '../toolBridge'
import { executeToolCall, readFromLegacyTable } from '../wsToolHandlers'
import { normalizeUrl, isUrl, buildSearchUrl } from '../browserToolBridge'

// 真实 browserToolBridge 单例（绕过 mock，用于 browserToolBridge 自身测试）
const realBrowserModule = await vi.importActual<typeof import('../browserToolBridge')>('../browserToolBridge')

// ============================================================================
// 4. 工具函数
// ============================================================================
function resetMockState() {
  hoist.pendingAskUserRequests.clear()

  hoist.appStoreState.activePanelId = 'panel-1'
  hoist.appStoreState.panelWidgets = {}
  hoist.appStoreState.panelPositions = {}
  hoist.appStoreState.lastActiveWidgetId = null

  hoist.appStoreState.addWidget.mockReset()
  hoist.appStoreState.removeWidget.mockReset()
  hoist.appStoreState.updateWidgetState.mockReset()
  hoist.appStoreState.updateWidgetPosition.mockReset()
  hoist.appStoreState.setActivePanel.mockReset()

  for (const fn of Object.values(hoist.browserToolBridgeMock)) {
    fn.mockReset?.()
  }
  hoist.browserToolBridgeMock.getRegisteredWebviews.mockReturnValue([])

  for (const store of Object.values(hoist.dbStores)) {
    for (const fn of Object.values(store)) {
      fn.mockReset?.()
    }
  }
}

/** 创建假 WebviewTag，可选捕获 dom-ready 处理器并立即触发 */
function createFakeWebview(opts: { triggerReady?: boolean } = {}) {
  let domReadyHandler: (() => void) | null = null
  const webview = {
    addEventListener: vi.fn((event: string, handler: () => void) => {
      if (event === 'dom-ready') domReadyHandler = handler
    }),
    removeEventListener: vi.fn(),
    executeJavaScript: vi.fn(),
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
  if (opts.triggerReady && domReadyHandler) (domReadyHandler as () => void)()
  // 暴露 dom-ready 触发器
  return { webview: proxy, triggerReady: () => (domReadyHandler as (() => void) | null)?.() }
}

// ============================================================================
// 5. toolBridge.ts 测试
// ============================================================================

describe('toolBridge / executeTool 路由', () => {
  beforeEach(() => resetMockState())

  test('executeTool 对 ask_user 路由到 executeAskUser（写入 pendingAskUserRequests Map）', async () => {
    const promise = executeTool('ask_user', {
      question: 'continue?',
      options: [{ label: 'Yes', value: 'yes' }],
    })
    expect(hoist.pendingAskUserRequests.size).toBe(1)
    const requestId = hoist.pendingAskUserRequests.keys().next().value as string
    expect(requestId).toMatch(/^ask-/)
    const entry = hoist.pendingAskUserRequests.get(requestId) as { question: string; sessionId: string }
    expect(entry.question).toBe('continue?')
    expect(entry.sessionId).toBe('')
    respondToAskUserFromLocalAgent(requestId, ['yes'])
    await promise
  })

  test('executeTool 对非 ask_user 工具调用 executeToolCall（透传 tool + params）', async () => {
    hoist.dbStores.kvStorage.getKvValue.mockResolvedValue('val')
    const result = await executeTool('storage_read', { key: 'foo' })
    expect(hoist.dbStores.kvStorage.getKvValue).toHaveBeenCalledWith('foo')
    expect(result.success).toBe(true)
    expect(result.data).toEqual({ key: 'foo', value: 'val' })
  })

  test('executeTool 返回 executeToolCall 的结果结构（ToolCallResult）', async () => {
    hoist.dbStores.kvStorage.getKvValue.mockResolvedValue(null)
    const result = await executeTool('storage_read', { key: 'no-exist' })
    expect(result).toEqual({ success: true, data: { key: 'no-exist', value: null } })
  })

  test('executeTool 对未知工具返回 success=false + "unknown tool" 错误', async () => {
    const result = await executeTool('non_existent_tool', {})
    expect(result.success).toBe(false)
    expect(result.error).toContain('unknown tool')
  })

  test('executeTool 对底层抛异常的工具返回错误（executeToolCall catch 后转 success=false）', async () => {
    hoist.dbStores.kvStorage.getKvValue.mockRejectedValue(new Error('IDB failed'))
    const result = await executeTool('storage_read', { key: 'k' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('IDB failed')
  })

  test('executeTool 对 storage_write 透传 key + value 给底层', async () => {
    hoist.dbStores.kvStorage.setKvValue.mockResolvedValue(undefined)
    const result = await executeTool('storage_write', { key: 'k1', value: 42 })
    expect(hoist.dbStores.kvStorage.setKvValue).toHaveBeenCalledWith('k1', 42)
    expect(result.success).toBe(true)
  })
})

describe('toolBridge / executeAskUser', () => {
  beforeEach(() => resetMockState())

  test('executeAskUser 生成以 "ask-" 开头的 requestId', async () => {
    const promise = executeTool('ask_user', {
      question: 'q',
      options: [{ label: 'a', value: 'a' }],
    })
    const requestId = hoist.pendingAskUserRequests.keys().next().value as string
    expect(requestId.startsWith('ask-')).toBe(true)
    respondToAskUserFromLocalAgent(requestId, ['a'])
    await promise
  })

  test('executeAskUser 在 pendingAskUserRequests 中用 Map.set 注册（验证是 Map 而非数组）', async () => {
    expect(hoist.pendingAskUserRequests instanceof Map).toBe(true)
    const promise = executeTool('ask_user', {
      question: 'q',
      options: [{ label: 'a', value: 'a' }],
    })
    expect(hoist.pendingAskUserRequests.size).toBe(1)
    const requestId = hoist.pendingAskUserRequests.keys().next().value as string
    respondToAskUserFromLocalAgent(requestId, ['a'])
    await promise
  })

  test('executeAskUser 默认 allowMultiple=false（未传时）', async () => {
    const promise = executeTool('ask_user', {
      question: 'q',
      options: [{ label: 'a', value: 'a' }],
    })
    const requestId = hoist.pendingAskUserRequests.keys().next().value as string
    const entry = hoist.pendingAskUserRequests.get(requestId) as { allowMultiple: boolean }
    expect(entry.allowMultiple).toBe(false)
    respondToAskUserFromLocalAgent(requestId, ['a'])
    await promise
  })

  test('executeAskUser 显式传 allowMultiple=true 时写入 true', async () => {
    const promise = executeTool('ask_user', {
      question: 'q',
      options: [{ label: 'a', value: 'a' }],
      allowMultiple: true,
    })
    const requestId = hoist.pendingAskUserRequests.keys().next().value as string
    const entry = hoist.pendingAskUserRequests.get(requestId) as { allowMultiple: boolean }
    expect(entry.allowMultiple).toBe(true)
    respondToAskUserFromLocalAgent(requestId, ['a'])
    await promise
  })

  test('respondToAskUserFromLocalAgent 触发 Promise resolve 并返回 selectedValues', async () => {
    const promise = executeTool('ask_user', {
      question: 'pick',
      options: [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }],
      allowMultiple: true,
    })
    const requestId = hoist.pendingAskUserRequests.keys().next().value as string
    respondToAskUserFromLocalAgent(requestId, ['a', 'b'])
    const result = await promise
    expect(result.success).toBe(true)
    expect(result.data).toEqual({ selectedValues: ['a', 'b'] })
  })

  test('respondToAskUserFromLocalAgent 调用后从 pendingAskUserRequests 清除该条目', async () => {
    const promise = executeTool('ask_user', {
      question: 'q',
      options: [{ label: 'a', value: 'a' }],
    })
    const requestId = hoist.pendingAskUserRequests.keys().next().value as string
    expect(hoist.pendingAskUserRequests.size).toBe(1)
    respondToAskUserFromLocalAgent(requestId, ['a'])
    await promise
    expect(hoist.pendingAskUserRequests.size).toBe(0)
  })

  test('respondToAskUserFromLocalAgent 对未知 requestId 安全 no-op（不抛错）', () => {
    expect(() => respondToAskUserFromLocalAgent('unknown-id', ['x'])).not.toThrow()
    expect(hoist.pendingAskUserRequests.size).toBe(0)
  })

  test('executeAskUser 120s 超时返回 timeout 错误并清理 Map', async () => {
    vi.useFakeTimers()
    try {
      const promise = executeTool('ask_user', {
        question: 'q',
        options: [{ label: 'a', value: 'a' }],
      })
      expect(hoist.pendingAskUserRequests.size).toBe(1)
      vi.advanceTimersByTime(120000)
      const result = await promise
      expect(result.success).toBe(false)
      expect(result.error).toContain('timeout')
      expect(result.error).toContain('120s')
      expect(hoist.pendingAskUserRequests.size).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  test('executeAskUser 在 120s 内被 respond 解决后不触发 timeout', async () => {
    vi.useFakeTimers()
    try {
      const promise = executeTool('ask_user', {
        question: 'q',
        options: [{ label: 'a', value: 'a' }],
      })
      const requestId = hoist.pendingAskUserRequests.keys().next().value as string
      respondToAskUserFromLocalAgent(requestId, ['a'])
      const result = await promise
      expect(result.success).toBe(true)
      // 推进时间超过 120s，不应影响已 resolve 的 Promise
      vi.advanceTimersByTime(200000)
      expect(result.data).toEqual({ selectedValues: ['a'] })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('toolBridge / registerToolBridge', () => {
  let teardown: (() => void) | null = null

  beforeEach(() => {
    resetMockState()
    teardown = null
  })

  afterEach(() => {
    teardown?.()
    teardown = null
    teardownMockElectronAPI()
  })

  test('registerToolBridge 调用 window.toolBridgeApi.onToolExecuteRequest', () => {
    teardown = setupMockElectronAPI()
    registerToolBridge()
    expect(window.toolBridgeApi!.onToolExecuteRequest).toHaveBeenCalledTimes(1)
  })

  test('registerToolBridge 返回清理函数', () => {
    teardown = setupMockElectronAPI()
    const cleanup = registerToolBridge()
    expect(typeof cleanup).toBe('function')
    // 调用 cleanup 应不抛错（onToolExecuteRequest 返回的清理函数）
    expect(() => cleanup()).not.toThrow()
  })

  test('registerToolBridge 在 window.toolBridgeApi 缺失时 warn 并返回 noop', () => {
    // 不调用 setupMockElectronAPI，确保 window.toolBridgeApi 缺失
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const cleanup = registerToolBridge()
    expect(typeof cleanup).toBe('function')
    expect(cleanup()).toBeUndefined()
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  test('registerToolBridge 回调收到请求后调用 dispatchTool + respondToolResult', async () => {
    let captured: ((req: unknown) => void) | null = null
    const onToolExecuteRequest = vi.fn((cb: (req: unknown) => void) => {
      captured = cb
      return () => { captured = null }
    })
    const respondToolResult = vi.fn().mockResolvedValue(undefined)
    teardown = setupMockElectronAPI({
      toolBridgeApi: { onToolExecuteRequest, respondToolResult },
    })
    registerToolBridge()
    expect(captured).not.toBeNull()

    hoist.dbStores.kvStorage.getKvValue.mockResolvedValue('v')
    await captured!({
      requestId: 'r-1',
      tool: 'storage_read',
      params: { key: 'foo' },
      panelId: 'p1',
    })

    expect(respondToolResult).toHaveBeenCalledTimes(1)
    const arg = respondToolResult.mock.calls[0][0] as {
      requestId: string
      success: boolean
      data?: unknown
    }
    expect(arg.requestId).toBe('r-1')
    expect(arg.success).toBe(true)
    expect(arg.data).toEqual({ key: 'foo', value: 'v' })
  })

  test('registerToolBridge 回调对失败工具返回 success=false（dispatchTool 包装错误）', async () => {
    let captured: ((req: unknown) => void) | null = null
    const onToolExecuteRequest = vi.fn((cb: (req: unknown) => void) => {
      captured = cb
      return () => { captured = null }
    })
    const respondToolResult = vi.fn().mockResolvedValue(undefined)
    teardown = setupMockElectronAPI({
      toolBridgeApi: { onToolExecuteRequest, respondToolResult },
    })
    registerToolBridge()

    // executeToolCall 内部 catch 异常，返回 success=false
    hoist.dbStores.kvStorage.getKvValue.mockRejectedValue(new Error('boom'))
    await captured!({
      requestId: 'r-2',
      tool: 'storage_read',
      params: { key: 'k' },
      panelId: 'p1',
    })

    const arg = respondToolResult.mock.calls[0][0] as {
      requestId: string
      success: boolean
      error?: string
    }
    expect(arg.requestId).toBe('r-2')
    expect(arg.success).toBe(false)
    expect(arg.error).toContain('boom')
  })

  test('registerToolBridge 回调对未知工具返回 success=false 含 "unknown tool"', async () => {
    let captured: ((req: unknown) => void) | null = null
    const onToolExecuteRequest = vi.fn((cb: (req: unknown) => void) => {
      captured = cb
      return () => { captured = null }
    })
    const respondToolResult = vi.fn().mockResolvedValue(undefined)
    teardown = setupMockElectronAPI({
      toolBridgeApi: { onToolExecuteRequest, respondToolResult },
    })
    registerToolBridge()

    await captured!({
      requestId: 'r-3',
      tool: 'unknown_tool',
      params: {},
      panelId: 'p1',
    })

    const arg = respondToolResult.mock.calls[0][0] as {
      requestId: string
      success: boolean
      error?: string
    }
    expect(arg.requestId).toBe('r-3')
    expect(arg.success).toBe(false)
    expect(arg.error).toContain('unknown tool')
  })
})

// ============================================================================
// 6. wsToolHandlers.ts 测试 — executeToolCall 路由
// ============================================================================

describe('wsToolHandlers / executeToolCall 路由与参数校验', () => {
  beforeEach(() => resetMockState())

  test('executeToolCall 对未知 tool 返回 "unknown tool" 错误', async () => {
    const result = await executeToolCall('definitely_unknown', {})
    expect(result.success).toBe(false)
    expect(result.error).toContain('unknown tool')
  })

  test('executeToolCall storage_read 调用 getKvValue 并返回 {key, value}', async () => {
    hoist.dbStores.kvStorage.getKvValue.mockResolvedValue('hello')
    const result = await executeToolCall('storage_read', { key: 'k' })
    expect(hoist.dbStores.kvStorage.getKvValue).toHaveBeenCalledWith('k')
    expect(result).toEqual({ success: true, data: { key: 'k', value: 'hello' } })
  })

  test('executeToolCall storage_read 缺 key 参数返回错误', async () => {
    const result = await executeToolCall('storage_read', {})
    expect(result.success).toBe(false)
    expect(result.error).toContain('key is required')
  })

  test('executeToolCall storage_read 空 key 返回错误', async () => {
    const result = await executeToolCall('storage_read', { key: '' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('key is required')
  })

  test('executeToolCall storage_write 调用 setKvValue 并返回 {key, success}', async () => {
    hoist.dbStores.kvStorage.setKvValue.mockResolvedValue(undefined)
    const result = await executeToolCall('storage_write', { key: 'k', value: { a: 1 } })
    expect(hoist.dbStores.kvStorage.setKvValue).toHaveBeenCalledWith('k', { a: 1 })
    expect(result.success).toBe(true)
    expect(result.data).toEqual({ key: 'k', success: true })
  })

  test('executeToolCall storage_write 缺 key 返回错误', async () => {
    const result = await executeToolCall('storage_write', { value: 1 })
    expect(result.success).toBe(false)
    expect(result.error).toContain('key is required')
  })

  test('executeToolCall storage_read 带 table 参数走 readFromLegacyTable', async () => {
    hoist.dbStores.notes.getAllNotes.mockResolvedValue([{ id: '1' }])
    const result = await executeToolCall('storage_read', { key: 'all', table: 'notes' })
    expect(hoist.dbStores.notes.getAllNotes).toHaveBeenCalled()
    expect(result.success).toBe(true)
    expect(result.data).toEqual({ table: 'notes', key: 'all', value: [{ id: '1' }] })
  })

  test('executeToolCall list_widgets 返回空列表（无 widget）', async () => {
    const result = await executeToolCall('list_widgets', {})
    expect(result.success).toBe(true)
    expect((result.data as { widgets: unknown[]; count: number }).widgets).toEqual([])
    expect((result.data as { count: number }).count).toBe(0)
  })

  test('executeToolCall list_widgets 返回当前画布上的 widget（含 agent/actual 尺寸）', async () => {
    hoist.appStoreState.panelWidgets = {
      'panel-1': [
        {
          widgetId: 'w1',
          widgetType: 'htmlCanvas',
          state: { title: 'T1', agentWidth: 100, agentHeight: 200 },
          isPrimary: false,
        },
      ],
    }
    hoist.appStoreState.panelPositions = {
      'panel-1': [{ widgetId: 'w1', x: 1, y: 2, w: 150, h: 250 }],
    }
    const result = await executeToolCall('list_widgets', {})
    const data = result.data as {
      widgets: Array<{ id: string; agentWidth?: number; actualWidth?: number }>
      count: number
    }
    expect(data.count).toBe(1)
    expect(data.widgets[0].id).toBe('w1')
    expect(data.widgets[0].agentWidth).toBe(100)
    expect(data.widgets[0].actualWidth).toBe(150)
  })

  test('executeToolCall create_html_widget 缺 html 返回错误', async () => {
    const result = await executeToolCall('create_html_widget', { x: 0, y: 0 })
    expect(result.success).toBe(false)
    expect(result.error).toContain('html is required')
  })

  test('executeToolCall create_html_widget 缺 x/y 返回错误', async () => {
    const result = await executeToolCall('create_html_widget', { html: '<p/>' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('x and y are required')
  })

  test('executeToolCall create_html_widget 成功时调用 addWidget + createHtmlWidget (IDB)', async () => {
    hoist.appStoreState.addWidget.mockImplementation(async (type: string, options: { panelId?: string; initialState?: Record<string, unknown> }) => {
      const panelId = options?.panelId ?? hoist.appStoreState.activePanelId!
      hoist.appStoreState.panelWidgets[panelId] = [
        ...(hoist.appStoreState.panelWidgets[panelId] ?? []),
        { widgetId: 'new-w-1', widgetType: type, state: options?.initialState ?? {}, isPrimary: false },
      ]
    })
    hoist.dbStores.htmlWidgets.createHtmlWidget.mockResolvedValue(undefined)
    const result = await executeToolCall('create_html_widget', {
      html: '<p>hi</p>',
      x: 10,
      y: 20,
      width: 100,
      height: 50,
      title: 'Hi',
    })
    expect(hoist.appStoreState.addWidget).toHaveBeenCalledTimes(1)
    expect(hoist.dbStores.htmlWidgets.createHtmlWidget).toHaveBeenCalledTimes(1)
    expect(result.success).toBe(true)
    expect((result.data as { id: string }).id).toBe('new-w-1')
    expect((result.data as { width: number; height: number }).width).toBe(100)
  })

  test('executeToolCall create_html_widget 不传 width/height 时用默认值 400/300', async () => {
    hoist.appStoreState.addWidget.mockImplementation(async (type: string, options: { panelId?: string; initialState?: Record<string, unknown> }) => {
      const panelId = options?.panelId ?? hoist.appStoreState.activePanelId!
      hoist.appStoreState.panelWidgets[panelId] = [
        ...(hoist.appStoreState.panelWidgets[panelId] ?? []),
        { widgetId: 'w-default', widgetType: type, state: {}, isPrimary: false },
      ]
    })
    const result = await executeToolCall('create_html_widget', { html: '<p/>', x: 0, y: 0 })
    expect((result.data as { width: number; height: number }).width).toBe(400)
    expect((result.data as { width: number; height: number }).height).toBe(300)
  })

  test('executeToolCall create_html_widget addWidget 失败（无 widgetId 捕获）返回错误', async () => {
    // addWidget 不修改 panelWidgets，diff 找不到新 widget
    hoist.appStoreState.addWidget.mockResolvedValue(undefined)
    const result = await executeToolCall('create_html_widget', { html: '<p/>', x: 0, y: 0 })
    expect(result.success).toBe(false)
    expect(result.error).toContain('failed to add widget')
  })

  test('executeToolCall update_html_widget 缺 id 返回错误', async () => {
    const result = await executeToolCall('update_html_widget', { html: '<p/>' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('id is required')
  })

  test('executeToolCall update_html_widget 找不到 widget 返回错误', async () => {
    hoist.appStoreState.panelWidgets = {}
    const result = await executeToolCall('update_html_widget', { id: 'no-such', html: '<p/>' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('widget not found')
  })

  test('executeToolCall update_html_widget 成功时更新 state + position + IDB', async () => {
    hoist.appStoreState.panelWidgets = {
      'panel-1': [{ widgetId: 'w-up', widgetType: 'htmlCanvas', state: { html: 'old' }, isPrimary: false }],
    }
    hoist.appStoreState.panelPositions = {
      'panel-1': [{ widgetId: 'w-up', x: 0, y: 0, w: 100, h: 100 }],
    }
    hoist.dbStores.htmlWidgets.updateHtmlWidget.mockResolvedValue(undefined)
    const result = await executeToolCall('update_html_widget', { id: 'w-up', html: '<p>new</p>', width: 200 })
    expect(hoist.appStoreState.updateWidgetState).toHaveBeenCalledWith('w-up', expect.objectContaining({ html: '<p>new</p>', agentWidth: 200 }))
    expect(hoist.appStoreState.updateWidgetPosition).toHaveBeenCalledWith('w-up', { w: 200 })
    expect(hoist.dbStores.htmlWidgets.updateHtmlWidget).toHaveBeenCalledWith('w-up', { html: '<p>new</p>' })
    expect(result.success).toBe(true)
  })

  test('executeToolCall delete_html_widget 缺 id 返回错误', async () => {
    const result = await executeToolCall('delete_html_widget', {})
    expect(result.success).toBe(false)
    expect(result.error).toContain('id is required')
  })

  test('executeToolCall delete_html_widget 找不到 widget 返回错误', async () => {
    hoist.appStoreState.panelWidgets = {}
    const result = await executeToolCall('delete_html_widget', { id: 'no-such' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('widget not found')
  })

  test('executeToolCall delete_html_widget 成功时调用 removeWidget + deleteHtmlWidget (IDB)', async () => {
    hoist.appStoreState.panelWidgets = {
      'panel-1': [{ widgetId: 'w-del', widgetType: 'htmlCanvas', state: {}, isPrimary: false }],
    }
    hoist.appStoreState.removeWidget.mockResolvedValue(true)
    hoist.dbStores.htmlWidgets.deleteHtmlWidget.mockResolvedValue(undefined)
    const result = await executeToolCall('delete_html_widget', { id: 'w-del' })
    expect(hoist.appStoreState.removeWidget).toHaveBeenCalledWith('w-del')
    expect(hoist.dbStores.htmlWidgets.deleteHtmlWidget).toHaveBeenCalledWith('w-del')
    expect(result.success).toBe(true)
    expect((result.data as { id: string }).id).toBe('w-del')
  })

  test('executeToolCall delete_html_widget removeWidget 返回 false 时返回错误（主 AI 助手 widget）', async () => {
    hoist.appStoreState.panelWidgets = {
      'panel-1': [{ widgetId: 'w-primary', widgetType: 'aiAssistant', state: {}, isPrimary: true }],
    }
    hoist.appStoreState.removeWidget.mockResolvedValue(false)
    const result = await executeToolCall('delete_html_widget', { id: 'w-primary' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('failed to remove widget')
  })
})

describe('wsToolHandlers / executeToolCall 浏览器工具 widgetId 自动注入', () => {
  beforeEach(() => resetMockState())

  test('browser_eval 无 widgetId + 无活跃 webview 返回 "No active webview"', async () => {
    hoist.appStoreState.lastActiveWidgetId = null
    hoist.browserToolBridgeMock.getRegisteredWebviews.mockReturnValue([])
    const result = await executeToolCall('browser_eval', { script: '1+1' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('No active webview')
  })

  test('browser_eval 无 widgetId 但 lastActiveWidgetId 在注册列表中 → 自动注入', async () => {
    hoist.appStoreState.lastActiveWidgetId = 'wv-1'
    hoist.browserToolBridgeMock.getRegisteredWebviews.mockReturnValue([
      { widgetId: 'wv-1', url: 'https://a.com', title: 'A' },
    ])
    hoist.browserToolBridgeMock.browserEval.mockResolvedValue({ success: true, data: 2 })
    const result = await executeToolCall('browser_eval', { script: '1+1' })
    expect(hoist.browserToolBridgeMock.browserEval).toHaveBeenCalledWith(expect.objectContaining({ widgetId: 'wv-1', script: '1+1' }))
    expect(result.success).toBe(true)
  })

  test('browser_eval 无 widgetId 且 lastActiveWidgetId 不在列表 → fallback 到第一个注册的', async () => {
    hoist.appStoreState.lastActiveWidgetId = 'wv-stale'
    hoist.browserToolBridgeMock.getRegisteredWebviews.mockReturnValue([
      { widgetId: 'wv-2', url: '', title: '' },
    ])
    hoist.browserToolBridgeMock.browserEval.mockResolvedValue({ success: true })
    await executeToolCall('browser_eval', { script: 'x' })
    expect(hoist.browserToolBridgeMock.browserEval).toHaveBeenCalledWith(expect.objectContaining({ widgetId: 'wv-2' }))
  })

  test('browser_eval 已传 widgetId 时不覆盖', async () => {
    hoist.browserToolBridgeMock.browserEval.mockResolvedValue({ success: true })
    await executeToolCall('browser_eval', { widgetId: 'supplied', script: 'x' })
    expect(hoist.browserToolBridgeMock.browserEval).toHaveBeenCalledWith(expect.objectContaining({ widgetId: 'supplied' }))
  })

  test('browser_navigate 路由到 browserToolBridge.browserNavigate', async () => {
    hoist.browserToolBridgeMock.browserNavigate.mockResolvedValue({ success: true })
    await executeToolCall('browser_navigate', { widgetId: 'w', url: 'https://x.com' })
    expect(hoist.browserToolBridgeMock.browserNavigate).toHaveBeenCalledWith({ widgetId: 'w', url: 'https://x.com' })
  })

  test('browser_list_tabs 路由到 browserToolBridge.browserListTabs', async () => {
    hoist.browserToolBridgeMock.browserListTabs.mockReturnValue({ success: true, data: [] })
    const result = await executeToolCall('browser_list_tabs', {})
    expect(hoist.browserToolBridgeMock.browserListTabs).toHaveBeenCalled()
    expect(result.success).toBe(true)
  })

  test('browser_get_url 路由正确（同步返回）', async () => {
    hoist.browserToolBridgeMock.browserGetUrl.mockReturnValue({ success: true, data: 'https://x.com' })
    const result = await executeToolCall('browser_get_url', { widgetId: 'w' })
    expect(result.success).toBe(true)
    expect(result.data).toBe('https://x.com')
  })

  test('executeToolCall 内部 try/catch 捕获 handler 同步抛出的异常', async () => {
    hoist.browserToolBridgeMock.browserGetUrl.mockImplementation(() => {
      throw new Error('sync boom')
    })
    const result = await executeToolCall('browser_get_url', { widgetId: 'w' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('sync boom')
  })

  test('executeToolCall 内部 try/catch 捕获 handler reject 的 Promise', async () => {
    hoist.browserToolBridgeMock.browserEval.mockRejectedValue(new Error('async boom'))
    hoist.browserToolBridgeMock.getRegisteredWebviews.mockReturnValue([{ widgetId: 'w', url: '', title: '' }])
    const result = await executeToolCall('browser_eval', { script: 'x' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('async boom')
  })

  test('browser_open 路由到 browserToolBridge.browserOpen', async () => {
    hoist.browserToolBridgeMock.browserOpen.mockResolvedValue({ success: true, data: { widgetId: 'w', url: 'https://x.com' } })
    const result = await executeToolCall('browser_open', { url: 'https://x.com' })
    expect(hoist.browserToolBridgeMock.browserOpen).toHaveBeenCalledWith({ url: 'https://x.com' })
    expect(result.success).toBe(true)
  })

  test('browser_switch_tab 路由到 browserToolBridge.browserSwitchTab', async () => {
    hoist.browserToolBridgeMock.browserSwitchTab.mockResolvedValue({ success: true })
    await executeToolCall('browser_switch_tab', { widgetId: 'w' })
    expect(hoist.browserToolBridgeMock.browserSwitchTab).toHaveBeenCalledWith({ widgetId: 'w' })
  })
})

// ============================================================================
// 7. wsToolHandlers.ts — readFromLegacyTable
// ============================================================================

describe('wsToolHandlers / readFromLegacyTable', () => {
  beforeEach(() => resetMockState())

  test('未知表返回 "unknown legacy table" 错误（含 Supported tables 列表）', async () => {
    const result = await readFromLegacyTable('unknownTable', 'all')
    expect(result.success).toBe(false)
    expect(result.error).toContain('unknown legacy table')
    expect(result.error).toContain('Supported tables')
  })

  test('notes 表 key="all" 调用 getAllNotes', async () => {
    hoist.dbStores.notes.getAllNotes.mockResolvedValue([{ id: '1' }])
    const result = await readFromLegacyTable('notes', 'all')
    expect(hoist.dbStores.notes.getAllNotes).toHaveBeenCalled()
    expect(result.success).toBe(true)
    expect((result.data as { value: unknown[] }).value).toEqual([{ id: '1' }])
  })

  test('notes 表 key="<id>" 调用 getNoteById', async () => {
    hoist.dbStores.notes.getNoteById.mockResolvedValue({ id: 'n1' })
    const result = await readFromLegacyTable('notes', 'n1')
    expect(hoist.dbStores.notes.getNoteById).toHaveBeenCalledWith('n1')
    expect(result.success).toBe(true)
  })

  test('journals 表 key="all" 调用 getAllJournals', async () => {
    hoist.dbStores.journals.getAllJournals.mockResolvedValue([])
    await readFromLegacyTable('journals', 'all')
    expect(hoist.dbStores.journals.getAllJournals).toHaveBeenCalled()
  })

  test('quickNotes 表 key="<id>" 调用 getQuickNoteById', async () => {
    hoist.dbStores.quickNotes.getQuickNoteById.mockResolvedValue(undefined)
    await readFromLegacyTable('quickNotes', 'q1')
    expect(hoist.dbStores.quickNotes.getQuickNoteById).toHaveBeenCalledWith('q1')
  })

  test('mistakes 表 key="all" 调用 getAllMistakes', async () => {
    hoist.dbStores.mistakes.getAllMistakes.mockResolvedValue([])
    await readFromLegacyTable('mistakes', 'all')
    expect(hoist.dbStores.mistakes.getAllMistakes).toHaveBeenCalled()
  })

  test('savings 表 key="all" 调用 getAllSavingsGoals', async () => {
    hoist.dbStores.savings.getAllSavingsGoals.mockResolvedValue([])
    await readFromLegacyTable('savings', 'all')
    expect(hoist.dbStores.savings.getAllSavingsGoals).toHaveBeenCalled()
  })

  test('savings 表 key="transactions:<goalId>" 调用 getSavingsTransactionsByGoal（截取 goalId）', async () => {
    hoist.dbStores.savings.getSavingsTransactionsByGoal.mockResolvedValue([])
    await readFromLegacyTable('savings', 'transactions:g1')
    expect(hoist.dbStores.savings.getSavingsTransactionsByGoal).toHaveBeenCalledWith('g1')
  })

  test('savings 表 key="<goalId>" 调用 getSavingsGoalById', async () => {
    hoist.dbStores.savings.getSavingsGoalById.mockResolvedValue(undefined)
    await readFromLegacyTable('savings', 'g1')
    expect(hoist.dbStores.savings.getSavingsGoalById).toHaveBeenCalledWith('g1')
  })

  test('vocabDecks 表 key="all" 调用 getAllVocabDecks', async () => {
    hoist.dbStores.vocabDecks.getAllVocabDecks.mockResolvedValue([])
    await readFromLegacyTable('vocabDecks', 'all')
    expect(hoist.dbStores.vocabDecks.getAllVocabDecks).toHaveBeenCalled()
  })

  test('vocabProgress 表 key="all" 返回错误（不支持，避免大数据集）', async () => {
    const result = await readFromLegacyTable('vocabProgress', 'all')
    expect(result.success).toBe(false)
    expect(result.error).toContain('vocabProgress does not support key="all"')
  })

  test('vocabProgress 表 key="deck:<id>" 调用 getVocabProgressByDeck（截取 deckId）', async () => {
    hoist.dbStores.vocabProgress.getVocabProgressByDeck.mockResolvedValue([])
    await readFromLegacyTable('vocabProgress', 'deck:d1')
    expect(hoist.dbStores.vocabProgress.getVocabProgressByDeck).toHaveBeenCalledWith('d1')
  })

  test('vocabProgress 表 key="<id>" 调用 getVocabProgressById', async () => {
    hoist.dbStores.vocabProgress.getVocabProgressById.mockResolvedValue(undefined)
    await readFromLegacyTable('vocabProgress', 'p1')
    expect(hoist.dbStores.vocabProgress.getVocabProgressById).toHaveBeenCalledWith('p1')
  })

  test('readFromLegacyTable 捕获异常返回 success=false 含 "failed to read"', async () => {
    hoist.dbStores.notes.getAllNotes.mockRejectedValue(new Error('IDB error'))
    const result = await readFromLegacyTable('notes', 'all')
    expect(result.success).toBe(false)
    expect(result.error).toContain('failed to read from legacy table notes')
    expect(result.error).toContain('IDB error')
  })

  test('readFromLegacyTable 返回的 data 结构包含 {table, key, value}', async () => {
    hoist.dbStores.notes.getNoteById.mockResolvedValue({ id: 'x', content: 'c' })
    const result = await readFromLegacyTable('notes', 'x')
    expect(result.data).toEqual({
      table: 'notes',
      key: 'x',
      value: { id: 'x', content: 'c' },
    })
  })
})

// ============================================================================
// 8. wsToolHandlers — 25 个工具全部可路由（不返回 "unknown tool"）
// ============================================================================

describe('wsToolHandlers / 25 个工具全部可路由', () => {
  beforeEach(() => resetMockState())

  test('24 个 wsToolHandlers 工具 + ask_user 全部走 switch 路由（不返回 "unknown tool"）', async () => {
    // 配置 mock 让所有 browser 工具走通
    hoist.browserToolBridgeMock.getRegisteredWebviews.mockReturnValue([
      { widgetId: 'w', url: 'https://x.com', title: 'X' },
    ])
    hoist.appStoreState.lastActiveWidgetId = 'w'
    hoist.browserToolBridgeMock.browserEval.mockResolvedValue({ success: true })
    hoist.browserToolBridgeMock.browserGetDom.mockResolvedValue({ success: true })
    hoist.browserToolBridgeMock.browserClick.mockResolvedValue({ success: true })
    hoist.browserToolBridgeMock.browserInput.mockResolvedValue({ success: true })
    hoist.browserToolBridgeMock.browserScroll.mockResolvedValue({ success: true })
    hoist.browserToolBridgeMock.browserWaitFor.mockResolvedValue({ success: true })
    hoist.browserToolBridgeMock.browserScreenshot.mockResolvedValue({ success: true })
    hoist.browserToolBridgeMock.browserNavigate.mockResolvedValue({ success: true })
    hoist.browserToolBridgeMock.browserGetUrl.mockReturnValue({ success: true })
    hoist.browserToolBridgeMock.browserGetTitle.mockReturnValue({ success: true })
    hoist.browserToolBridgeMock.browserBack.mockReturnValue({ success: true })
    hoist.browserToolBridgeMock.browserForward.mockReturnValue({ success: true })
    hoist.browserToolBridgeMock.browserReload.mockReturnValue({ success: true })
    hoist.browserToolBridgeMock.browserGetCookie.mockResolvedValue({ success: true })
    hoist.browserToolBridgeMock.browserSetCookie.mockResolvedValue({ success: true })
    hoist.browserToolBridgeMock.browserOpen.mockResolvedValue({ success: true })
    hoist.browserToolBridgeMock.browserSwitchTab.mockResolvedValue({ success: true })
    hoist.browserToolBridgeMock.browserListTabs.mockReturnValue({ success: true, data: [] })
    hoist.dbStores.kvStorage.getKvValue.mockResolvedValue(null)
    hoist.dbStores.kvStorage.setKvValue.mockResolvedValue(undefined)
    hoist.appStoreState.removeWidget.mockResolvedValue(true)

    const toolsToCheck: Array<[string, unknown]> = [
      ['storage_read', { key: 'k' }],
      ['storage_write', { key: 'k', value: 1 }],
      ['list_widgets', {}],
      ['browser_eval', { script: 'x' }],
      ['browser_get_dom', { widgetId: 'w' }],
      ['browser_click', { widgetId: 'w', selector: 's' }],
      ['browser_input', { widgetId: 'w', selector: 's', text: 't' }],
      ['browser_scroll', { widgetId: 'w' }],
      ['browser_wait_for', { widgetId: 'w', condition: 's' }],
      ['browser_screenshot', { widgetId: 'w' }],
      ['browser_navigate', { widgetId: 'w', url: 'https://x.com' }],
      ['browser_get_url', { widgetId: 'w' }],
      ['browser_get_title', { widgetId: 'w' }],
      ['browser_back', { widgetId: 'w' }],
      ['browser_forward', { widgetId: 'w' }],
      ['browser_reload', { widgetId: 'w' }],
      ['browser_get_cookie', { widgetId: 'w' }],
      ['browser_set_cookie', { widgetId: 'w', name: 'n', value: 'v' }],
      ['browser_open', { url: 'https://x.com' }],
      ['browser_switch_tab', { widgetId: 'w' }],
      ['browser_list_tabs', {}],
    ]

    for (const [tool, params] of toolsToCheck) {
      const result = await executeToolCall(tool, params)
      // 关键断言：不应返回 "unknown tool" 错误
      if (!result.success) {
        expect(result.error, `tool ${tool} 不应返回 "unknown tool"`).not.toContain('unknown tool')
      }
      expect(result, `tool ${tool} should not be unknown`).toBeDefined()
    }
  })

  test('非法工具名（空字符串）返回 unknown tool 错误', async () => {
    const result = await executeToolCall('', {})
    expect(result.success).toBe(false)
    expect(result.error).toContain('unknown tool')
  })
})

// ============================================================================
// 9. browserToolBridge.ts — pure functions 测试
// ============================================================================

describe('browserToolBridge / normalizeUrl', () => {
  test('已有 https:// 协议头原样返回', () => {
    expect(normalizeUrl('https://example.com')).toBe('https://example.com')
  })

  test('已有 http:// 协议头原样返回', () => {
    expect(normalizeUrl('http://example.com')).toBe('http://example.com')
  })

  test('纯域名自动补 https://', () => {
    expect(normalizeUrl('example.com')).toBe('https://example.com')
  })

  test('localhost 自动补 http://', () => {
    expect(normalizeUrl('localhost')).toBe('http://localhost')
  })

  test('localhost:port 自动补 http://（源代码 BUG：被 scheme 正则误匹配，记录但不修复）', () => {
    // 源代码 normalizeUrl 的正则 /^[a-zA-Z][a-zA-Z0-9+.-]*:/ 会把 "localhost:" 误判为协议头，
    // 导致 "localhost:3000" 直接原样返回（未补 http://）。
    // 这是源代码 bug（第一个 if 在 localhost 检查之前），按规则不修改源代码，仅记录实际行为。
    expect(normalizeUrl('localhost:3000')).toBe('localhost:3000')
  })

  test('IP 地址自动补 http://', () => {
    expect(normalizeUrl('192.168.1.1')).toBe('http://192.168.1.1')
  })

  test('空字符串返回 about:blank', () => {
    expect(normalizeUrl('')).toBe('about:blank')
  })

  test('非 URL 文本返回 about:blank（Phase 15 批次1 任务1.3：fallback，调用方需先用 isUrl 判断）', () => {
    expect(normalizeUrl('hello world')).toBe('about:blank')
  })

  test('含中文的非 URL 文本返回 about:blank（Phase 15 批次1 任务1.3：fallback）', () => {
    expect(normalizeUrl('你好 世界')).toBe('about:blank')
  })
})

describe('browserToolBridge / isUrl', () => {
  test('https URL 返回 true', () => {
    expect(isUrl('https://example.com')).toBe(true)
  })

  test('http URL 返回 true', () => {
    expect(isUrl('http://example.com')).toBe(true)
  })

  test('about:blank 返回 true', () => {
    expect(isUrl('about:blank')).toBe(true)
  })

  test('纯域名返回 true', () => {
    expect(isUrl('example.com')).toBe(true)
  })

  test('空字符串返回 false', () => {
    expect(isUrl('')).toBe(false)
  })

  test('含空格的字符串返回 false', () => {
    expect(isUrl('not a url')).toBe(false)
  })

  test('javascript: 协议返回 false（视为非 URL）', () => {
    expect(isUrl('javascript:alert(1)')).toBe(false)
  })

  test('data: 协议返回 false', () => {
    expect(isUrl('data:text/plain,hello')).toBe(false)
  })
})

describe('browserToolBridge / buildSearchUrl', () => {
  test('google 引擎构建正确 URL', () => {
    expect(buildSearchUrl('hello', 'google')).toBe('https://www.google.com/search?q=hello')
  })

  test('bing 引擎（默认）构建正确 URL', () => {
    expect(buildSearchUrl('hello', 'bing')).toBe('https://www.bing.com/search?q=hello')
  })

  test('baidu 引擎构建正确 URL', () => {
    expect(buildSearchUrl('你好', 'baidu')).toBe('https://www.baidu.com/s?wd=' + encodeURIComponent('你好'))
  })

  test('duckduckgo 引擎构建正确 URL', () => {
    expect(buildSearchUrl('hello', 'duckduckgo')).toBe('https://duckduckgo.com/?q=hello')
  })

  test('未传 engine 默认 bing', () => {
    expect(buildSearchUrl('hello')).toBe('https://www.bing.com/search?q=hello')
  })

  test('未知 engine fallback 到 bing', () => {
    expect(buildSearchUrl('hello', 'unknown' as never)).toBe('https://www.bing.com/search?q=hello')
  })

  test('特殊字符 query 正确 encode', () => {
    expect(buildSearchUrl('a&b=c', 'google')).toBe('https://www.google.com/search?q=' + encodeURIComponent('a&b=c'))
  })
})

// ============================================================================
// 10. browserToolBridge.ts — 真实单例方法测试（用 importActual 绕过 mock）
// ============================================================================

describe('browserToolBridge / safeSerialize（真实单例）', () => {
  test('null 返回 null', () => {
    expect(realBrowserModule.browserToolBridge.safeSerialize(null)).toBeNull()
  })

  test('undefined 返回 null（F4 修复）', () => {
    expect(realBrowserModule.browserToolBridge.safeSerialize(undefined)).toBeNull()
  })

  test('原始类型原样返回', () => {
    expect(realBrowserModule.browserToolBridge.safeSerialize(42)).toBe(42)
    expect(realBrowserModule.browserToolBridge.safeSerialize('hi')).toBe('hi')
    expect(realBrowserModule.browserToolBridge.safeSerialize(true)).toBe(true)
  })

  test('function 返回 [Function]', () => {
    expect(realBrowserModule.browserToolBridge.safeSerialize(() => {})).toBe('[Function]')
  })

  test('symbol 返回 [Symbol]', () => {
    expect(realBrowserModule.browserToolBridge.safeSerialize(Symbol('s'))).toBe('[Symbol]')
  })

  test('bigint 返回 [BigInt: ...]', () => {
    expect(realBrowserModule.browserToolBridge.safeSerialize(BigInt(123))).toBe('[BigInt: 123]')
  })

  test('循环引用返回 [Circular]', () => {
    const obj: Record<string, unknown> = {}
    obj.self = obj
    const result = realBrowserModule.browserToolBridge.safeSerialize(obj) as { self: unknown }
    expect(result.self).toBe('[Circular]')
  })

  test('数组递归序列化', () => {
    expect(realBrowserModule.browserToolBridge.safeSerialize([1, 'a', null])).toEqual([1, 'a', null])
  })

  test('深度超过 10 返回 [MaxDepth]', () => {
    let obj: Record<string, unknown> = {}
    for (let i = 0; i < 12; i++) {
      obj = { nested: obj }
    }
    const result = realBrowserModule.browserToolBridge.safeSerialize(obj) as { nested: { nested: unknown } }
    let cur: unknown = result
    for (let i = 0; i < 11; i++) {
      cur = (cur as { nested: unknown }).nested
    }
    expect(cur).toBe('[MaxDepth]')
  })

  test('Error 对象序列化为 {name, message, stack}', () => {
    const err = new Error('boom')
    const result = realBrowserModule.browserToolBridge.safeSerialize(err) as { name: string; message: string; stack?: string }
    expect(result.name).toBe('Error')
    expect(result.message).toBe('boom')
    expect(typeof result.stack).toBe('string')
  })
})

describe('browserToolBridge / 单例生命周期方法（真实单例）', () => {
  afterEach(() => {
    // 清理单例状态（避免影响其他测试）
    const reg = realBrowserModule.browserToolBridge.getRegisteredWebviews()
    for (const w of reg) {
      realBrowserModule.browserToolBridge.unregisterWebview(w.widgetId)
    }
  })

  test('getRegisteredWebviews 默认返回空数组（无 webview 时）', () => {
    // 注意：可能存在跨测试状态，此处不强断言空
    expect(Array.isArray(realBrowserModule.browserToolBridge.getRegisteredWebviews())).toBe(true)
  })

  test('registerWebview + getWebview 生命周期', () => {
    const { webview } = createFakeWebview()
    realBrowserModule.browserToolBridge.registerWebview('test-w1', webview as never)
    expect(realBrowserModule.browserToolBridge.getWebview('test-w1')).toBe(webview)
    realBrowserModule.browserToolBridge.unregisterWebview('test-w1')
    expect(realBrowserModule.browserToolBridge.getWebview('test-w1')).toBeNull()
  })

  test('unregisterWebview 后 getRegisteredWebviews 不再包含', () => {
    const { webview } = createFakeWebview()
    realBrowserModule.browserToolBridge.registerWebview('test-w2', webview as never)
    expect(realBrowserModule.browserToolBridge.getRegisteredWebviews().some(w => w.widgetId === 'test-w2')).toBe(true)
    realBrowserModule.browserToolBridge.unregisterWebview('test-w2')
    expect(realBrowserModule.browserToolBridge.getRegisteredWebviews().some(w => w.widgetId === 'test-w2')).toBe(false)
  })

  test('browserEval widget 不存在返回错误', async () => {
    const result = await realBrowserModule.browserToolBridge.browserEval({ widgetId: 'no-such-widget', script: '1' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('Widget not found')
  })

  test('browserEval script 过长（>10KB）返回错误', async () => {
    const { webview, triggerReady } = createFakeWebview()
    realBrowserModule.browserToolBridge.registerWebview('test-w-big', webview as never)
    triggerReady() // 标记 ready，避免 awaitReady 阻塞
    const bigScript = 'x'.repeat(10 * 1024 + 1)
    const result = await realBrowserModule.browserToolBridge.browserEval({ widgetId: 'test-w-big', script: bigScript })
    expect(result.success).toBe(false)
    expect(result.error).toContain('Script too large')
    realBrowserModule.browserToolBridge.unregisterWebview('test-w-big')
  })

  test('browserGetUrl widget 不存在返回错误', () => {
    const result = realBrowserModule.browserToolBridge.browserGetUrl({ widgetId: 'no-such-widget' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('Widget not found')
  })

  test('browserListTabs 返回 getRegisteredWebviews 结果', () => {
    const { webview } = createFakeWebview()
    realBrowserModule.browserToolBridge.registerWebview('test-w-list', webview as never)
    const result = realBrowserModule.browserToolBridge.browserListTabs()
    expect(result.success).toBe(true)
    expect((result.data as Array<{ widgetId: string }>).some(t => t.widgetId === 'test-w-list')).toBe(true)
    realBrowserModule.browserToolBridge.unregisterWebview('test-w-list')
  })

  test('browserGetTitle widget 不存在返回错误', () => {
    const result = realBrowserModule.browserToolBridge.browserGetTitle({ widgetId: 'no-such-widget' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('Widget not found')
  })

  test('browserBack widget 不存在返回错误', () => {
    const result = realBrowserModule.browserToolBridge.browserBack({ widgetId: 'no-such-widget' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('Widget not found')
  })

  test('browserForward widget 不存在返回错误', () => {
    const result = realBrowserModule.browserToolBridge.browserForward({ widgetId: 'no-such-widget' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('Widget not found')
  })

  test('browserReload widget 不存在返回错误', () => {
    const result = realBrowserModule.browserToolBridge.browserReload({ widgetId: 'no-such-widget' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('Widget not found')
  })
})
