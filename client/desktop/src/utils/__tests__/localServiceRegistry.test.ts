/**
 * localServiceRegistry 单元测试 — Phase 11 P0
 *
 * 测试覆盖：
 * - loadConfig: 配置加载（成功/抛错/null/无 services/非数组 services/localServicesApi 缺失）
 * - registerAll: 批量注册（无服务 no-op/全部成功/单个失败不阻塞）
 * - startHeartbeat / stopHeartbeat: 心跳定时器生命周期（立即一次 + 30s 间隔/重复调用 no-op/无服务 no-op/停止/未启动 no-op）
 * - unregisterAll: 注销所有服务（成功/无服务 no-op/服务器失败不抛错）
 * - handleProxyRequest: 代理请求处理（文本响应/二进制 Base64/未知服务 404/fetch 失败 502/GET 不带 body/POST 带 body/空 path/HEAD 不带 body）
 *
 * Mock 策略（参考 toolBridge.test.ts）：
 * - vi.hoisted 共享 api mock + window.localServicesApi mock
 * - vi.mock '../api/client' 替换 api.post
 * - setup 中手动注入 window.localServicesApi.readConfig
 * - vi.spyOn(globalThis, 'fetch') 替换 fetch（用于 handleProxyRequest）
 * - vi.useFakeTimers() 控制 setInterval（心跳）
 *
 * 单例状态管理：
 * - localServiceRegistry 是模块级单例，services 数组私有
 * - 通过 loadConfig() 来重置/设置 services 状态（readConfig 返回 null/[] 即清空）
 * - afterEach 调用 stopHeartbeat 避免跨测试残留定时器
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'

// ============================================================================
// 1. 共享 mock 状态（vi.hoisted 确保 vi.mock 工厂可访问）
// ============================================================================
const hoist = vi.hoisted(() => {
  const apiMock = {
    post: vi.fn(),
  }
  const localServicesApiMock = {
    readConfig: vi.fn(),
    onUnregister: vi.fn(),
  }
  return { apiMock, localServicesApiMock }
})

// ============================================================================
// 2. 模块 mock
// ============================================================================
vi.mock('../../api/client', () => ({
  api: hoist.apiMock,
}))

// ============================================================================
// 3. 导入被测模块（mock 后）
// ============================================================================
import { localServiceRegistry } from '../localServiceRegistry'

// ============================================================================
// 4. 工具函数
// ============================================================================
function resetMockState() {
  hoist.apiMock.post.mockReset()
  hoist.localServicesApiMock.readConfig.mockReset()
  hoist.localServicesApiMock.onUnregister.mockReset()
  // 注入 window.localServicesApi（源代码用 optional chaining 访问）
  ;(window as unknown as { localServicesApi: typeof hoist.localServicesApiMock }).localServicesApi =
    hoist.localServicesApiMock
}

/** 重置单例状态：清空 services + 停止心跳 */
async function resetSingletonState() {
  hoist.localServicesApiMock.readConfig.mockResolvedValue(null)
  await localServiceRegistry.loadConfig()
  localServiceRegistry.stopHeartbeat()
}

/** 加载指定 services 到单例 */
async function loadServices(
  services: Array<{ serviceName: string; endpoint: string; description?: string }>,
) {
  hoist.localServicesApiMock.readConfig.mockResolvedValue({ services })
  await localServiceRegistry.loadConfig()
}

// ============================================================================
// 5. loadConfig 测试
// ============================================================================
describe('localServiceRegistry / loadConfig', () => {
  beforeEach(async () => {
    resetMockState()
    await resetSingletonState()
  })

  test('loadConfig 加载本地配置（readConfig 返回 services 数组，存入单例）', async () => {
    // 验证：readConfig 返回的 services 被存入单例（通过 registerAll 副作用验证）
    const services = [
      { serviceName: 'notes', endpoint: 'http://localhost:3001' },
      { serviceName: 'todos', endpoint: 'http://localhost:3002' },
    ]
    hoist.localServicesApiMock.readConfig.mockResolvedValue({ services })
    await localServiceRegistry.loadConfig()
    hoist.apiMock.post.mockResolvedValue({})
    await localServiceRegistry.registerAll()
    expect(hoist.apiMock.post).toHaveBeenCalledTimes(2)
    expect(hoist.apiMock.post).toHaveBeenCalledWith('/local-services/register', expect.objectContaining({ serviceName: 'notes' }))
    expect(hoist.apiMock.post).toHaveBeenCalledWith('/local-services/register', expect.objectContaining({ serviceName: 'todos' }))
  })

  test('loadConfig readConfig 抛错时 services 被清空（catch 错误并设为 []）', async () => {
    // 验证：readConfig reject 时 catch 错误，services 设为空（后续 registerAll no-op）
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    hoist.localServicesApiMock.readConfig.mockRejectedValue(new Error('IPC fail'))
    await expect(localServiceRegistry.loadConfig()).resolves.not.toThrow()
    expect(errSpy).toHaveBeenCalled()
    // 验证 services 已清空
    await localServiceRegistry.registerAll()
    expect(hoist.apiMock.post).not.toHaveBeenCalled()
    errSpy.mockRestore()
  })

  test('loadConfig readConfig 返回 null 时 services 为空', async () => {
    // 验证：readConfig 返回 null（配置文件不存在场景）时 services 设为空
    hoist.localServicesApiMock.readConfig.mockResolvedValue(null)
    await localServiceRegistry.loadConfig()
    await localServiceRegistry.registerAll()
    expect(hoist.apiMock.post).not.toHaveBeenCalled()
  })

  test('loadConfig readConfig 返回无 services 字段时 services 为空', async () => {
    // 验证：返回对象但无 services 字段时 services 设为空
    hoist.localServicesApiMock.readConfig.mockResolvedValue({} as { services: never[] })
    await localServiceRegistry.loadConfig()
    await localServiceRegistry.registerAll()
    expect(hoist.apiMock.post).not.toHaveBeenCalled()
  })

  test('loadConfig readConfig 返回非数组 services 时 services 为空', async () => {
    // 验证：services 字段非数组时（Array.isArray 返回 false）走 else 分支
    hoist.localServicesApiMock.readConfig.mockResolvedValue({ services: 'not-an-array' })
    await localServiceRegistry.loadConfig()
    await localServiceRegistry.registerAll()
    expect(hoist.apiMock.post).not.toHaveBeenCalled()
  })

  test('loadConfig 在 window.localServicesApi 缺失时不抛错（optional chaining 返回 undefined）', async () => {
    // 验证：window.localServicesApi 缺失时 readConfig() 返回 undefined，services 设为空
    delete (window as unknown as { localServicesApi?: unknown }).localServicesApi
    await expect(localServiceRegistry.loadConfig()).resolves.not.toThrow()
  })
})

// ============================================================================
// 6. registerAll 测试
// ============================================================================
describe('localServiceRegistry / registerAll', () => {
  beforeEach(async () => {
    resetMockState()
    await resetSingletonState()
  })

  test('registerAll 无服务时 no-op（不调 api.post）', async () => {
    // 验证：services 为空时 registerAll 直接 return
    hoist.localServicesApiMock.readConfig.mockResolvedValue({ services: [] })
    await localServiceRegistry.loadConfig()
    await localServiceRegistry.registerAll()
    expect(hoist.apiMock.post).not.toHaveBeenCalled()
  })

  test('registerAll 注册所有服务到 /local-services/register（按顺序逐个 await）', async () => {
    // 验证：遍历 services 数组逐个调用 api.post，body 包含 serviceName/endpoint/description
    await loadServices([
      { serviceName: 'svc1', endpoint: 'http://localhost:3001', description: 'd1' },
      { serviceName: 'svc2', endpoint: 'http://localhost:3002' },
    ])
    hoist.apiMock.post.mockResolvedValue({})
    await localServiceRegistry.registerAll()
    expect(hoist.apiMock.post).toHaveBeenCalledTimes(2)
    expect(hoist.apiMock.post).toHaveBeenNthCalledWith(1, '/local-services/register', {
      serviceName: 'svc1',
      endpoint: 'http://localhost:3001',
      description: 'd1',
    })
    expect(hoist.apiMock.post).toHaveBeenNthCalledWith(2, '/local-services/register', {
      serviceName: 'svc2',
      endpoint: 'http://localhost:3002',
      description: undefined,
    })
  })

  test('registerAll 单个服务注册失败时不抛错（catch 错误后继续下一个）', async () => {
    // 验证：try/catch 包裹每个 api.post，失败仅 console.error，不阻塞后续服务
    await loadServices([
      { serviceName: 'fail-svc', endpoint: 'http://localhost:4001' },
      { serviceName: 'ok-svc', endpoint: 'http://localhost:4002' },
    ])
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    hoist.apiMock.post
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({})
    await expect(localServiceRegistry.registerAll()).resolves.not.toThrow()
    expect(hoist.apiMock.post).toHaveBeenCalledTimes(2)
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })
})

// ============================================================================
// 7. startHeartbeat / stopHeartbeat 测试
// ============================================================================
describe('localServiceRegistry / startHeartbeat + stopHeartbeat', () => {
  beforeEach(async () => {
    resetMockState()
    await resetSingletonState()
  })

  afterEach(() => {
    localServiceRegistry.stopHeartbeat()
    vi.useRealTimers()
  })

  test('startHeartbeat 立即发一次心跳 + 启动 30s 定时器', async () => {
    // 验证：startHeartbeat 立即调 sendHeartbeat（api.post '/local-services/heartbeat'），
    //       并注册 30s setInterval，定时器触发后再发一次心跳
    await loadServices([{ serviceName: 'svc1', endpoint: 'http://localhost:5001' }])
    hoist.apiMock.post.mockResolvedValue({})
    vi.useFakeTimers()
    localServiceRegistry.startHeartbeat()
    // 立即一次心跳
    expect(hoist.apiMock.post).toHaveBeenCalledWith('/local-services/heartbeat', { serviceNames: ['svc1'] })
    const initialCount = hoist.apiMock.post.mock.calls.length
    // 推进 30s 触发 setInterval 回调
    vi.advanceTimersByTime(30_000)
    expect(hoist.apiMock.post.mock.calls.length).toBeGreaterThan(initialCount)
    // 验证第二次仍是 heartbeat 调用
    const lastCall = hoist.apiMock.post.mock.calls[hoist.apiMock.post.mock.calls.length - 1]
    expect(lastCall[0]).toBe('/local-services/heartbeat')
  })

  test('startHeartbeat 重复调用不重复启动定时器（heartbeatInterval 已设置时 return）', async () => {
    // 验证：第二次调用 startHeartbeat 时因 heartbeatInterval 已设置直接 return
    await loadServices([{ serviceName: 'svc1', endpoint: 'http://localhost:5001' }])
    hoist.apiMock.post.mockResolvedValue({})
    vi.useFakeTimers()
    localServiceRegistry.startHeartbeat()
    const initialCount = hoist.apiMock.post.mock.calls.length
    localServiceRegistry.startHeartbeat()
    expect(hoist.apiMock.post.mock.calls.length).toBe(initialCount)
  })

  test('startHeartbeat 无服务时不启动（services.length === 0 时 return）', async () => {
    // 验证：无服务时 startHeartbeat 直接 return，不调 api.post
    hoist.localServicesApiMock.readConfig.mockResolvedValue({ services: [] })
    await localServiceRegistry.loadConfig()
    localServiceRegistry.startHeartbeat()
    expect(hoist.apiMock.post).not.toHaveBeenCalled()
  })

  test('stopHeartbeat 停止定时器（不再触发心跳）', async () => {
    // 验证：stopHeartbeat 后 clearInterval，advanceTimersByTime 不再触发心跳
    await loadServices([{ serviceName: 'svc1', endpoint: 'http://localhost:5001' }])
    hoist.apiMock.post.mockResolvedValue({})
    vi.useFakeTimers()
    localServiceRegistry.startHeartbeat()
    localServiceRegistry.stopHeartbeat()
    const countBefore = hoist.apiMock.post.mock.calls.length
    vi.advanceTimersByTime(60_000)
    expect(hoist.apiMock.post.mock.calls.length).toBe(countBefore)
  })

  test('stopHeartbeat 未启动时 no-op（不抛错）', () => {
    // 验证：heartbeatInterval 为 null 时 stopHeartbeat 不抛错
    expect(() => localServiceRegistry.stopHeartbeat()).not.toThrow()
  })
})

// ============================================================================
// 8. unregisterAll 测试
// ============================================================================
describe('localServiceRegistry / unregisterAll', () => {
  beforeEach(async () => {
    resetMockState()
    await resetSingletonState()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('unregisterAll 调用 /local-services/unregister 并 stopHeartbeat', async () => {
    // 验证：unregisterAll 调 api.post('/local-services/unregister')，body 为 { serviceNames: [...] }
    await loadServices([
      { serviceName: 's1', endpoint: 'http://localhost:6001' },
      { serviceName: 's2', endpoint: 'http://localhost:6002' },
    ])
    hoist.apiMock.post.mockResolvedValue({})
    // 启动心跳（验证 unregisterAll 内部 stopHeartbeat 不会抛错）
    vi.useFakeTimers()
    localServiceRegistry.startHeartbeat()
    await localServiceRegistry.unregisterAll()
    // 最后一次 api.post 调用应该是 unregister
    const calls = hoist.apiMock.post.mock.calls
    const lastCall = calls[calls.length - 1]
    expect(lastCall[0]).toBe('/local-services/unregister')
    expect(lastCall[1]).toEqual({ serviceNames: ['s1', 's2'] })
  })

  test('unregisterAll 无服务时 no-op（不调 api.post）', async () => {
    // 验证：services 为空时 unregisterAll 直接 return（不调 stopHeartbeat 也不调 api.post）
    hoist.localServicesApiMock.readConfig.mockResolvedValue({ services: [] })
    await localServiceRegistry.loadConfig()
    await localServiceRegistry.unregisterAll()
    expect(hoist.apiMock.post).not.toHaveBeenCalled()
  })

  test('unregisterAll 服务器失败时不抛错（catch 错误，依赖心跳超时自动 offline）', async () => {
    // 验证：api.post reject 时 catch 错误，仅 console.error
    await loadServices([{ serviceName: 's1', endpoint: 'http://localhost:6001' }])
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    hoist.apiMock.post.mockRejectedValue(new Error('server unavailable'))
    await expect(localServiceRegistry.unregisterAll()).resolves.not.toThrow()
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })
})

// ============================================================================
// 9. handleProxyRequest 测试
// ============================================================================
describe('localServiceRegistry / handleProxyRequest', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    resetMockState()
    await resetSingletonState()
  })

  afterEach(() => {
    fetchSpy?.mockRestore?.()
  })

  test('handleProxyRequest 成功路径（文本响应，application/json 走 text()）', async () => {
    // 验证：fetch 返回 application/json，调 res.text()，body 直接返回文本
    await loadServices([{ serviceName: 'notes', endpoint: 'http://localhost:7001' }])
    const fakeRes = {
      status: 200,
      headers: {
        forEach: (cb: (value: string, key: string) => void) => cb('application/json', 'content-type'),
        get: (name: string) => (name === 'content-type' ? 'application/json' : null),
      },
      text: vi.fn().mockResolvedValue('{"ok":true}'),
    }
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(fakeRes as unknown as Response)

    const result = await localServiceRegistry.handleProxyRequest({
      requestId: 'r1',
      serviceName: 'notes',
      method: 'GET',
      path: 'api/notes',
      headers: {},
      body: null,
    })

    expect(fetchSpy).toHaveBeenCalledWith('http://localhost:7001/api/notes', { method: 'GET', headers: {} })
    expect(result.requestId).toBe('r1')
    expect(result.status).toBe(200)
    expect(result.headers['content-type']).toBe('application/json')
    expect(result.body).toBe('{"ok":true}')
  })

  test('handleProxyRequest 成功路径（二进制响应，非文本 content-type 走 Base64 编码）', async () => {
    // 验证：fetch 返回 image/png（非文本），调 res.arrayBuffer()，body 编码为 Base64 + 添加 x-proxy-base64: true
    await loadServices([{ serviceName: 'img', endpoint: 'http://localhost:7002' }])
    const binaryData = new Uint8Array([0x01, 0x02, 0xff]).buffer
    const fakeRes = {
      status: 200,
      headers: {
        forEach: (cb: (value: string, key: string) => void) => cb('image/png', 'content-type'),
        get: (name: string) => (name === 'content-type' ? 'image/png' : null),
      },
      arrayBuffer: vi.fn().mockResolvedValue(binaryData),
    }
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(fakeRes as unknown as Response)

    const result = await localServiceRegistry.handleProxyRequest({
      requestId: 'r2',
      serviceName: 'img',
      method: 'GET',
      path: 'logo.png',
      headers: {},
      body: null,
    })

    expect(result.status).toBe(200)
    expect(result.headers['x-proxy-base64']).toBe('true')
    // base64 of [0x01, 0x02, 0xff]: AQKC/w==
    expect(result.body).toBe(btoa(String.fromCharCode(0x01, 0x02, 0xff)))
  })

  test('handleProxyRequest 未知服务名返回 404 + service_not_found', async () => {
    // 验证：serviceName 不在 services 中时返回 404，body 为 JSON 错误
    await loadServices([{ serviceName: 'exists', endpoint: 'http://localhost:7003' }])

    const result = await localServiceRegistry.handleProxyRequest({
      requestId: 'r3',
      serviceName: 'not-exist',
      method: 'GET',
      path: '',
      headers: {},
      body: null,
    })

    expect(result.status).toBe(404)
    expect(result.headers['content-type']).toBe('application/json')
    const body = JSON.parse(result.body)
    expect(body.error).toBe('service_not_found')
    expect(body.message).toContain('not-exist')
  })

  test('handleProxyRequest fetch 失败返回 502 + proxy_fetch_failed', async () => {
    // 验证：fetch reject 时 catch 返回 502，body 为 { error, message }
    await loadServices([{ serviceName: 'svc', endpoint: 'http://localhost:7004' }])
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('connection refused'))

    const result = await localServiceRegistry.handleProxyRequest({
      requestId: 'r4',
      serviceName: 'svc',
      method: 'GET',
      path: '',
      headers: {},
      body: null,
    })

    expect(result.status).toBe(502)
    expect(result.headers['content-type']).toBe('application/json')
    const body = JSON.parse(result.body)
    expect(body.error).toBe('proxy_fetch_failed')
    expect(body.message).toContain('connection refused')
  })

  test('handleProxyRequest GET 请求不附加 body（即使 msg.body 非 null）', async () => {
    // 验证：method === 'GET' 时跳过 body 字段（即使 msg.body 有值）
    await loadServices([{ serviceName: 'svc', endpoint: 'http://localhost:7005' }])
    const fakeRes = {
      status: 200,
      headers: {
        forEach: () => {},
        get: () => null,
      },
      text: vi.fn().mockResolvedValue(''),
    }
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(fakeRes as unknown as Response)

    await localServiceRegistry.handleProxyRequest({
      requestId: 'r5',
      serviceName: 'svc',
      method: 'GET',
      path: 'data',
      headers: { 'x-test': '1' },
      body: 'should-not-be-used',
    })

    expect(fetchSpy).toHaveBeenCalledWith('http://localhost:7005/data', {
      method: 'GET',
      headers: { 'x-test': '1' },
    })
  })

  test('handleProxyRequest POST 请求附加 body', async () => {
    // 验证：method !== 'GET' && !== 'HEAD' 且 body !== null 时附加 body
    await loadServices([{ serviceName: 'svc', endpoint: 'http://localhost:7006' }])
    const fakeRes = {
      status: 201,
      headers: {
        forEach: () => {},
        get: () => null,
      },
      text: vi.fn().mockResolvedValue('created'),
    }
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(fakeRes as unknown as Response)

    const result = await localServiceRegistry.handleProxyRequest({
      requestId: 'r6',
      serviceName: 'svc',
      method: 'POST',
      path: 'items',
      headers: { 'content-type': 'application/json' },
      body: '{"name":"x"}',
    })

    expect(fetchSpy).toHaveBeenCalledWith('http://localhost:7006/items', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"name":"x"}',
    })
    expect(result.status).toBe(201)
  })

  test('handleProxyRequest path 为空时直接用 endpoint 作 URL（不附加 /）', async () => {
    // 验证：path 为空字符串时 url = svc.endpoint（不拼接 /）
    await loadServices([{ serviceName: 'svc', endpoint: 'http://localhost:7007' }])
    const fakeRes = {
      status: 200,
      headers: {
        forEach: () => {},
        get: () => null,
      },
      text: vi.fn().mockResolvedValue(''),
    }
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(fakeRes as unknown as Response)

    await localServiceRegistry.handleProxyRequest({
      requestId: 'r7',
      serviceName: 'svc',
      method: 'GET',
      path: '',
      headers: {},
      body: null,
    })

    expect(fetchSpy).toHaveBeenCalledWith('http://localhost:7007', { method: 'GET', headers: {} })
  })

  test('handleProxyRequest HEAD 请求不附加 body', async () => {
    // 验证：method === 'HEAD' 时跳过 body 字段（与 GET 同等处理）
    await loadServices([{ serviceName: 'svc', endpoint: 'http://localhost:7008' }])
    const fakeRes = {
      status: 200,
      headers: {
        forEach: () => {},
        get: () => null,
      },
      text: vi.fn().mockResolvedValue(''),
    }
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(fakeRes as unknown as Response)

    await localServiceRegistry.handleProxyRequest({
      requestId: 'r8',
      serviceName: 'svc',
      method: 'HEAD',
      path: '',
      headers: {},
      body: 'should-be-ignored',
    })

    expect(fetchSpy).toHaveBeenCalledWith('http://localhost:7008', { method: 'HEAD', headers: {} })
  })
})
