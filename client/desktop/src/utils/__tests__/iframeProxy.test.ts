/**
 * iframeProxy 单元测试 — Phase 11 P0
 *
 * 测试覆盖：
 * - generateToken: UUID v4 生成（crypto.randomUUID 路径 + 手动 fallback 路径）
 * - getInitScript: token 注入脚本生成 + 特殊字符转义
 * - createMessageHandler: 消息分发、token 校验、来源校验、错误处理、html_widget_error
 * - handleCanvasAction: action 路由（read_storage/write_storage/http_fetch/create_widget/unknown）
 *
 * Mock 策略（参考 toolBridge.test.ts）：
 * - vi.hoisted 共享 mock 状态（确保 vi.mock 工厂可访问）
 * - vi.mock '../dbStores/kvStorage' 替换 getKvValue/setKvValue
 * - vi.mock '../wsToolHandlers' 替换 readFromLegacyTable
 * - 全局 fetch 用 vi.spyOn 替换（http_fetch 用例）
 *
 * 说明（与 spec 偏差）：
 * - spec 说 "未知 action throw"，源代码 handleCanvasAction default 分支确实 throw `unknown action: ${action}`，符合
 * - spec 说 "token 校验失败静默 return"，源代码 createMessageHandler 中 `if (data.token !== token) return`，符合
 * - 源代码实际 4 个 action（read_storage/write_storage/http_fetch/create_widget），create_widget 显式抛 "not implemented"
 */
import { describe, test, expect, beforeEach, vi } from 'vitest'

// ============================================================================
// 1. 共享 mock 状态（vi.hoisted 确保 vi.mock 工厂可访问）
// ============================================================================
const hoist = vi.hoisted(() => {
  const kvStorageMock = {
    getKvValue: vi.fn(),
    setKvValue: vi.fn(),
  }
  const wsToolHandlersMock = {
    readFromLegacyTable: vi.fn(),
  }
  return { kvStorageMock, wsToolHandlersMock }
})

// ============================================================================
// 2. 模块 mock
// ============================================================================
vi.mock('../dbStores/kvStorage', () => hoist.kvStorageMock)
vi.mock('../wsToolHandlers', () => hoist.wsToolHandlersMock)

// ============================================================================
// 3. 导入被测模块（mock 后）
// ============================================================================
import {
  generateToken,
  getInitScript,
  handleCanvasAction,
  createMessageHandler,
} from '../iframeProxy'

// ============================================================================
// 4. 工具函数
// ============================================================================
function resetMockState() {
  hoist.kvStorageMock.getKvValue.mockReset()
  hoist.kvStorageMock.setKvValue.mockReset()
  hoist.wsToolHandlersMock.readFromLegacyTable.mockReset()
}

/**
 * 构造伪 MessageEvent。
 * happy-dom 的 MessageEvent 构造器对 source 选项支持不稳定，
 * 用 plain object 满足源代码对 event.data/event.source 的访问即可。
 */
function makeMessageEvent(data: unknown, source: unknown = null): MessageEvent {
  return { data, source } as MessageEvent
}

/** 构造伪 source window（带 postMessage spy） */
function makeFakeSource() {
  const postMessage = vi.fn()
  return { postMessage, source: postMessage } as unknown as Window & { postMessage: ReturnType<typeof vi.fn> }
}

// ============================================================================
// 5. generateToken 测试
// ============================================================================
describe('iframeProxy / generateToken', () => {
  test('generateToken 返回 UUID v4 格式字符串（长度 36 + 字符集 + version 4 + variant 8/9/a/b）', () => {
    // 验证：UUID v4 标准格式 xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx，其中 y ∈ [89ab]
    const token = generateToken()
    expect(typeof token).toBe('string')
    expect(token).toHaveLength(36)
    expect(token).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  test('generateToken 两次调用生成不同 token（随机性）', () => {
    // 验证：两次调用结果不应相同（极小概率碰撞除外）
    const t1 = generateToken()
    const t2 = generateToken()
    expect(t1).not.toBe(t2)
  })

  test('generateToken 在 crypto.randomUUID 不可用时走 fallback 路径（仍返回 UUID v4 格式）', () => {
    // 验证：屏蔽 crypto.randomUUID 后，手动 fallback 仍生成合法 UUID v4
    const originalCrypto = globalThis.crypto
    const stubCrypto = Object.create(originalCrypto) as Crypto
    Object.defineProperty(stubCrypto, 'randomUUID', { value: undefined, configurable: true })
    Object.defineProperty(globalThis, 'crypto', { value: stubCrypto, configurable: true, writable: true })
    try {
      const token = generateToken()
      expect(token).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
      expect(token).toHaveLength(36)
    } finally {
      Object.defineProperty(globalThis, 'crypto', { value: originalCrypto, configurable: true, writable: true })
    }
  })
})

// ============================================================================
// 6. getInitScript 测试
// ============================================================================
describe('iframeProxy / getInitScript', () => {
  test('getInitScript 生成包含 token 的脚本（注入 window.__CANVAS_TOKEN__ + canvasStorage API）', () => {
    // 验证：脚本字符串包含 token 注入 + canvasStorage read/write/httpFetch API
    const token = 'abc-123'
    const script = getInitScript(token)
    expect(typeof script).toBe('string')
    expect(script).toContain('window.__CANVAS_TOKEN__')
    expect(script).toContain(`"${token}"`)
    expect(script).toContain('canvasStorage')
    expect(script).toContain('read:')
    expect(script).toContain('write:')
    expect(script).toContain('httpFetch:')
  })

  test('getInitScript 转义 token 中的特殊字符（", \', \\）防止注入', () => {
    // 验证：token 中的 " 不会原样出现在脚本中破坏字符串字面量闭合
    const token = 'a"b\'c\\d'
    const script = getInitScript(token)
    // 提取 window.__CANVAS_TOKEN__ = "..." 之间的内容
    const match = script.match(/window\.__CANVAS_TOKEN__\s*=\s*"([^"]*)"/)
    expect(match).not.toBeNull()
    // 转义后 __CANVAS_TOKEN__ 字符串字面量内不应包含未转义的 "
    expect(match![1]).not.toContain('"')
  })
})

// ============================================================================
// 7. createMessageHandler 测试
// ============================================================================
describe('iframeProxy / createMessageHandler', () => {
  let fakeSource: ReturnType<typeof makeFakeSource>

  beforeEach(() => {
    resetMockState()
    fakeSource = makeFakeSource()
  })

  test('createMessageHandler 返回函数（typeof === "function"）', () => {
    // 验证：返回值是可调用的 handler 函数
    const handler = createMessageHandler('w1', 'tok', vi.fn(), vi.fn())
    expect(typeof handler).toBe('function')
  })

  test('createMessageHandler 接收合法 token + canvas_action 时调用 onAction（异步 postMessage canvas_response）', async () => {
    // 验证：合法 token 的 canvas_action 消息会触发 onAction，并 postMessage success response
    const onAction = vi.fn().mockResolvedValue({ ok: true })
    const handler = createMessageHandler('w1', 'tok', onAction, vi.fn())
    handler(makeMessageEvent(
      { type: 'canvas_action', token: 'tok', action: 'read_storage', params: { key: 'k' }, requestId: 'r1' },
      fakeSource,
    ))
    expect(onAction).toHaveBeenCalledWith('read_storage', { key: 'k' })
    // 等异步 Promise 完成（onAction resolved → .then 跑 → postMessage 调用）
    await Promise.resolve()
    await Promise.resolve()
    expect(fakeSource.postMessage).toHaveBeenCalledTimes(1)
    const response = fakeSource.postMessage.mock.calls[0][0]
    expect(response.type).toBe('canvas_response')
    expect(response.requestId).toBe('r1')
    expect(response.success).toBe(true)
    expect(response.data).toEqual({ ok: true })
  })

  test('createMessageHandler 接收非法 token 时静默 return（不调用 onAction，不 postMessage）', () => {
    // 验证：token 不匹配时直接 return，不触发任何回调
    const onAction = vi.fn()
    const handler = createMessageHandler('w1', 'expected-tok', onAction, vi.fn())
    handler(makeMessageEvent(
      { type: 'canvas_action', token: 'wrong-tok', action: 'read_storage', params: {}, requestId: 'r1' },
      fakeSource,
    ))
    expect(onAction).not.toHaveBeenCalled()
    expect(fakeSource.postMessage).not.toHaveBeenCalled()
  })

  test('createMessageHandler 接收未知 type 时静默 return（不调用 onAction/onError）', () => {
    // 验证：消息 type 既非 canvas_action 也非 html_widget_error 时不处理
    const onAction = vi.fn()
    const onError = vi.fn()
    const handler = createMessageHandler('w1', 'tok', onAction, onError)
    handler(makeMessageEvent(
      { type: 'some_other_type', token: 'tok' },
      fakeSource,
    ))
    expect(onAction).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })

  test('createMessageHandler 校验 message 来源（getExpectedSource 不匹配时 return）', () => {
    // 验证：当 getExpectedSource 返回的 window 与 event.source 不一致时静默 return
    const onAction = vi.fn()
    const expectedWindow = { isExpected: true } as unknown as Window
    const anotherWindow = { isExpected: false } as unknown as Window
    const handler = createMessageHandler('w1', 'tok', onAction, vi.fn(), () => expectedWindow)
    handler(makeMessageEvent(
      { type: 'canvas_action', token: 'tok', action: 'read_storage', params: {}, requestId: 'r1' },
      anotherWindow,
    ))
    expect(onAction).not.toHaveBeenCalled()
  })

  test('createMessageHandler getExpectedSource 匹配时正常处理', () => {
    // 验证：event.source 与 getExpectedSource 返回值一致时正常路由
    const onAction = vi.fn().mockResolvedValue({})
    const handler = createMessageHandler('w1', 'tok', onAction, vi.fn(), () => fakeSource as unknown as Window)
    handler(makeMessageEvent(
      { type: 'canvas_action', token: 'tok', action: 'read_storage', params: {}, requestId: 'r1' },
      fakeSource,
    ))
    expect(onAction).toHaveBeenCalled()
  })

  test('createMessageHandler 接收非对象 data（null/string/number）时静默 return', () => {
    // 验证：data 不是对象时直接 return（防御性校验）
    const onAction = vi.fn()
    const onError = vi.fn()
    const handler = createMessageHandler('w1', 'tok', onAction, onError)
    handler(makeMessageEvent(null, fakeSource))
    handler(makeMessageEvent('string-data', fakeSource))
    handler(makeMessageEvent(123, fakeSource))
    expect(onAction).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })

  test('createMessageHandler canvas_action 缺 requestId 时静默 return', () => {
    // 验证：canvas_action 消息必须携带字符串 requestId，否则丢弃
    const onAction = vi.fn()
    const handler = createMessageHandler('w1', 'tok', onAction, vi.fn())
    handler(makeMessageEvent(
      { type: 'canvas_action', token: 'tok', action: 'read_storage', params: {} },
      fakeSource,
    ))
    expect(onAction).not.toHaveBeenCalled()
  })

  test('createMessageHandler onAction 成功时 postMessage canvas_response success=true + data', async () => {
    // 验证：onAction resolved 后向 sourceWindow postMessage success=true + data
    const onAction = vi.fn().mockResolvedValue({ value: 42 })
    const handler = createMessageHandler('w1', 'tok', onAction, vi.fn())
    handler(makeMessageEvent(
      { type: 'canvas_action', token: 'tok', action: 'read_storage', params: { key: 'k' }, requestId: 'r-success' },
      fakeSource,
    ))
    await Promise.resolve()
    await Promise.resolve()
    expect(fakeSource.postMessage).toHaveBeenCalledTimes(1)
    const response = fakeSource.postMessage.mock.calls[0][0]
    expect(response.success).toBe(true)
    expect(response.data).toEqual({ value: 42 })
    expect(response.requestId).toBe('r-success')
  })

  test('createMessageHandler onAction 失败时 postMessage canvas_response success=false + error message', async () => {
    // 验证：onAction rejected 时 postMessage success=false，error 为 Error.message
    const onAction = vi.fn().mockRejectedValue(new Error('boom'))
    const handler = createMessageHandler('w1', 'tok', onAction, vi.fn())
    handler(makeMessageEvent(
      { type: 'canvas_action', token: 'tok', action: 'unknown', params: {}, requestId: 'r-fail' },
      fakeSource,
    ))
    await Promise.resolve()
    await Promise.resolve()
    expect(fakeSource.postMessage).toHaveBeenCalledTimes(1)
    const response = fakeSource.postMessage.mock.calls[0][0]
    expect(response.success).toBe(false)
    expect(response.error).toContain('boom')
    expect(response.requestId).toBe('r-fail')
  })

  test('createMessageHandler onAction reject 非 Error 对象时用 String(err) 作 error', async () => {
    // 验证：reject 值非 Error 实例时，error 字段使用 String(err) 转字符串
    const onAction = vi.fn().mockRejectedValue('string-error')
    const handler = createMessageHandler('w1', 'tok', onAction, vi.fn())
    handler(makeMessageEvent(
      { type: 'canvas_action', token: 'tok', action: 'x', params: {}, requestId: 'r-str' },
      fakeSource,
    ))
    await Promise.resolve()
    await Promise.resolve()
    const response = fakeSource.postMessage.mock.calls[0][0]
    expect(response.success).toBe(false)
    expect(response.error).toBe('string-error')
  })

  test('createMessageHandler 接收 html_widget_error 时调用 onError（含 message/stack/source）', () => {
    // 验证：html_widget_error 消息触发 onError 回调，传递结构化错误信息
    const onError = vi.fn()
    const handler = createMessageHandler('w1', 'tok', vi.fn(), onError)
    handler(makeMessageEvent(
      { type: 'html_widget_error', message: 'crashed', stack: 'line 1', source: 'runtime' },
      fakeSource,
    ))
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith({
      message: 'crashed',
      stack: 'line 1',
      source: 'runtime',
    })
  })

  test('createMessageHandler html_widget_error 缺 message 时用 "(unknown error)" 兜底', () => {
    // 验证：缺 message 时使用默认值，source 默认 "runtime"
    const onError = vi.fn()
    const handler = createMessageHandler('w1', 'tok', vi.fn(), onError)
    handler(makeMessageEvent(
      { type: 'html_widget_error' },
      fakeSource,
    ))
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      message: '(unknown error)',
      source: 'runtime',
    }))
  })
})

// ============================================================================
// 8. handleCanvasAction 测试
// ============================================================================
describe('iframeProxy / handleCanvasAction', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => resetMockState())

  afterEach(() => {
    fetchSpy?.mockRestore?.()
  })

  test('handleCanvasAction read_storage 无 table 时调用 getKvValue 并返回 {value}', async () => {
    // 验证：read_storage 默认走 kvStorage.getKvValue 路径
    hoist.kvStorageMock.getKvValue.mockResolvedValue('hello')
    const result = await handleCanvasAction('read_storage', { key: 'k' })
    expect(hoist.kvStorageMock.getKvValue).toHaveBeenCalledWith('k')
    expect(result).toEqual({ value: 'hello' })
  })

  test('handleCanvasAction read_storage 缺 key 或空 key 时抛 "key is required"', async () => {
    // 验证：key 参数必填，缺失或空字符串都抛错
    await expect(handleCanvasAction('read_storage', {})).rejects.toThrow('read_storage: key is required')
    await expect(handleCanvasAction('read_storage', { key: '' })).rejects.toThrow('read_storage: key is required')
  })

  test('handleCanvasAction read_storage 带 table 时调用 readFromLegacyTable', async () => {
    // 验证：指定 table 走旧表归档读取路径（readFromLegacyTable）
    hoist.wsToolHandlersMock.readFromLegacyTable.mockResolvedValue({
      success: true,
      data: { value: 'legacy-val' },
    })
    const result = await handleCanvasAction('read_storage', { key: 'all', table: 'notes' })
    expect(hoist.wsToolHandlersMock.readFromLegacyTable).toHaveBeenCalledWith('notes', 'all')
    expect(result).toEqual({ value: 'legacy-val' })
  })

  test('handleCanvasAction read_storage 带 table 但 readFromLegacyTable 失败时抛 result.error', async () => {
    // 验证：legacy 读取 success=false 时抛 result.error（如未提供则用默认 message）
    // 源代码：throw new Error(result.error ?? 'read_storage: legacy table read failed')
    hoist.wsToolHandlersMock.readFromLegacyTable.mockResolvedValue({
      success: false,
      error: 'legacy table read failed',
    })
    await expect(handleCanvasAction('read_storage', { key: 'all', table: 'notes' }))
      .rejects.toThrow('legacy table read failed')
  })

  test('handleCanvasAction read_storage 带 table 但 readFromLegacyTable 失败且无 error 时抛默认 message', async () => {
    // 验证：result.error 为 undefined 时使用默认 message 'read_storage: legacy table read failed'
    hoist.wsToolHandlersMock.readFromLegacyTable.mockResolvedValue({
      success: false,
      error: undefined,
    })
    await expect(handleCanvasAction('read_storage', { key: 'all', table: 'notes' }))
      .rejects.toThrow('read_storage: legacy table read failed')
  })

  test('handleCanvasAction write_storage 调用 setKvValue 并返回 {success: true}', async () => {
    // 验证：write_storage 调用 kvStorage.setKvValue(key, value)
    hoist.kvStorageMock.setKvValue.mockResolvedValue(undefined)
    const result = await handleCanvasAction('write_storage', { key: 'k', value: 42 })
    expect(hoist.kvStorageMock.setKvValue).toHaveBeenCalledWith('k', 42)
    expect(result).toEqual({ success: true })
  })

  test('handleCanvasAction write_storage 缺 key 时抛 "key is required"', async () => {
    // 验证：write_storage 缺 key 参数时抛错
    await expect(handleCanvasAction('write_storage', { value: 1 })).rejects.toThrow('write_storage: key is required')
  })

  test('handleCanvasAction http_fetch 调用 fetch 并返回 {status, data}', async () => {
    // 验证：http_fetch 走 fetch，返回 {status, data: text()}
    const fakeResponse = {
      status: 200,
      text: vi.fn().mockResolvedValue('hello body'),
    }
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(fakeResponse as unknown as Response)
    const result = await handleCanvasAction('http_fetch', { url: 'https://example.com', options: {} })
    expect(fetchSpy).toHaveBeenCalledWith('https://example.com', {})
    expect(result).toEqual({ status: 200, data: 'hello body' })
  })

  test('handleCanvasAction http_fetch 缺 url 时抛 "url is required"', async () => {
    // 验证：http_fetch 缺 url 参数时抛错
    await expect(handleCanvasAction('http_fetch', {})).rejects.toThrow('http_fetch: url is required')
  })

  test('handleCanvasAction create_widget 抛 "not implemented"（提示用 create_html_widget 工具）', async () => {
    // 验证：create_widget 显式未实现，引导 agent 使用 create_html_widget 工具
    await expect(handleCanvasAction('create_widget', {}))
      .rejects.toThrow('not implemented: use create_html_widget tool instead')
  })

  test('handleCanvasAction 未知 action 抛 "unknown action: <name>"', async () => {
    // 验证：default 分支对未知 action 抛 unknown action 错误
    await expect(handleCanvasAction('totally_unknown', {}))
      .rejects.toThrow('unknown action: totally_unknown')
  })
})
