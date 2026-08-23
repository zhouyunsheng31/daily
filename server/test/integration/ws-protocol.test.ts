// ============================================================================
// S8.3 ws.ts 集成测试（真实 WS server + 客户端）
// ============================================================================
// 测试范围：
// - SERVER_TOKEN 鉴权三路径（错误/无/正确 token）+ dev 模式放行
// - 心跳 ping→pong + 90s 超时（fake timers）
// - 消息分发 / 广播 / 断开清理
// - 重连竞态 / 重连恢复 / 多端并行
// - sendProxyRequest 路由 + 30s 超时 + 设备断开 reject
// - error_report 路由
// ============================================================================

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest'
import http from 'http'
import { WebSocket } from 'ws'
import type { AddressInfo } from 'net'
import {
  startWebSocketServer,
  sendProxyRequest,
  broadcastChange,
  onClientMessage,
  onClientDisconnect,
  onErrorReport,
  hasDevice,
  getOnlineDeviceIds,
} from '../../src/ws.js'

// ============================================================================
// 共享 server
// ============================================================================
let httpServer: http.Server
let port: number
const createdClients: WebSocket[] = []
const unsubscribers: (() => void)[] = []

function connectClient(
  deviceId: string,
  opts?: { token?: string; cookie?: string; origin?: string },
): Promise<WebSocket> {
  const params = new URLSearchParams({ deviceId })
  if (opts?.token !== undefined) params.set('token', opts.token)
  const url = `ws://localhost:${port}/ws?${params.toString()}`
  const wsOpts = {} as unknown as ConstructorParameters<typeof WebSocket>[1]
  const headers: Record<string, string> = {}
  if (opts?.cookie) headers.Cookie = opts.cookie
  if (opts?.origin) headers.Origin = opts.origin
  if (Object.keys(headers).length > 0) {
    (wsOpts as { headers?: Record<string, string> }).headers = headers
  }
  const ws = new WebSocket(url, wsOpts)
  createdClients.push(ws)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`connect timeout for ${deviceId}`)), 5000)
    ws.on('open', () => { clearTimeout(timer); resolve(ws) })
    ws.on('error', (err) => { clearTimeout(timer); reject(err) })
  })
}

function connectExpectReject(
  deviceId: string,
  opts?: { token?: string; origin?: string },
): Promise<{ ws: WebSocket; error: Error | null }> {
  const params = new URLSearchParams({ deviceId })
  if (opts?.token !== undefined) params.set('token', opts.token)
  const url = `ws://localhost:${port}/ws?${params.toString()}`
  const wsOpts = {} as unknown as ConstructorParameters<typeof WebSocket>[1]
  if (opts?.origin) {
    (wsOpts as { headers?: Record<string, string> }).headers = { Origin: opts.origin }
  }
  const client = new WebSocket(url, wsOpts)
  createdClients.push(client)
  return new Promise(resolve => {
    let error: Error | null = null
    const timer = setTimeout(() => {
      resolve({ ws: client, error: error ?? new Error('timeout — no error/open') })
    }, 3000)
    client.on('open', () => { clearTimeout(timer); resolve({ ws: client, error: null }) })
    client.on('error', (err) => { error = err; })
    client.on('close', () => { clearTimeout(timer); resolve({ ws: client, error: error ?? new Error('closed') }) })
  })
}

function waitForMessage(
  ws: WebSocket,
  predicate: (msg: { kind: string; [key: string]: unknown }) => boolean,
  timeoutMs = 3000,
): Promise<{ kind: string; [key: string]: unknown }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('message timeout')), timeoutMs)
    const handler = (data: Buffer | ArrayBuffer | Buffer[]) => {
      try {
        const msg = JSON.parse(
          Buffer.isBuffer(data) ? data.toString('utf8')
            : Array.isArray(data) ? Buffer.concat(data).toString('utf8')
            : Buffer.from(data).toString('utf8')
        )
        if (predicate(msg)) { clearTimeout(timer); ws.off('message', handler); resolve(msg) }
      } catch { /* ignore */ }
    }
    ws.on('message', handler)
  })
}

function waitMs(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

beforeAll(async () => {
  httpServer = http.createServer()
  await new Promise<void>(resolve => httpServer.listen(0, resolve))
  port = (httpServer.address() as AddressInfo).port
  startWebSocketServer(httpServer)
})

afterAll(async () => {
  for (const ws of createdClients) { try { ws.close() } catch { /* ignore */ } }
  for (const unsub of unsubscribers) { try { unsub() } catch { /* ignore */ } }
  await new Promise<void>(resolve => httpServer.close(() => resolve()))
})

beforeEach(async () => {
  for (const ws of createdClients.splice(0)) { try { ws.close() } catch { /* ignore */ } }
  for (const unsub of unsubscribers.splice(0)) { try { unsub() } catch { /* ignore */ } }
  await waitMs(50)
})

afterEach(async () => {
  for (const ws of createdClients.splice(0)) { try { ws.close() } catch { /* ignore */ } }
  for (const unsub of unsubscribers.splice(0)) { try { unsub() } catch { /* ignore */ } }
  await waitMs(50)
})

// ============================================================================
// 鉴权
// ============================================================================
describe('鉴权', () => {
  it('SERVER_TOKEN 设置时：错误 token 被拒绝', async () => {
    const { ws, error } = await connectExpectReject('dev-auth-wrong', { token: 'wrong-token' })
    expect(error).not.toBeNull()
    expect(ws.readyState).not.toBe(WebSocket.OPEN)
  })

  it('SERVER_TOKEN 设置时：无 token 被拒绝', async () => {
    const { ws, error } = await connectExpectReject('dev-auth-notoken')
    expect(error).not.toBeNull()
    expect(ws.readyState).not.toBe(WebSocket.OPEN)
  })

  it('SERVER_TOKEN 设置时：正确 token 通过', async () => {
    const ws = await connectClient('dev-auth-ok', { token: 'test-token' })
    expect(ws.readyState).toBe(WebSocket.OPEN)
    expect(hasDevice('dev-auth-ok')).toBe(true)
  })

  it('SERVER_TOKEN 未设置时：开发模式放行（无 Origin = 同源）', async () => {
    const savedToken = process.env.SERVER_TOKEN
    delete process.env.SERVER_TOKEN
    try {
      const ws = await connectClient('dev-auth-devmode')
      expect(ws.readyState).toBe(WebSocket.OPEN)
      expect(hasDevice('dev-auth-devmode')).toBe(true)
    } finally {
      process.env.SERVER_TOKEN = savedToken
    }
  })
})

// ============================================================================
// 心跳
// ============================================================================
describe('心跳', () => {
  it('ping → pong 响应', async () => {
    const ws = await connectClient('dev-ping', { token: 'test-token' })

    const pongPromise = waitForMessage(ws, m => m.kind === 'pong')
    ws.send(JSON.stringify({ kind: 'ping' }))
    const pong = await pongPromise
    expect(pong.kind).toBe('pong')
  })
})

// ============================================================================
// 消息分发
// ============================================================================
describe('消息分发', () => {
  it('客户端发 user_message，server messageHandler 被调用', async () => {
    const ws = await connectClient('dev-msg-dispatch', { token: 'test-token' })

    const calls: Array<{ msg: unknown; deviceId: string }> = []
    const unsub = onClientMessage((msg, deviceId) => {
      calls.push({ msg, deviceId })
    })
    unsubscribers.push(unsub)

    ws.send(JSON.stringify({
      kind: 'user_message',
      panelId: 'panel-dispatch',
      content: 'hello dispatch',
    }))

    await waitMs(100)

    expect(calls.length).toBe(1)
    expect(calls[0].deviceId).toBe('dev-msg-dispatch')
    const msg = calls[0].msg as { kind: string; panelId: string; content: string }
    expect(msg.kind).toBe('user_message')
    expect(msg.panelId).toBe('panel-dispatch')
    expect(msg.content).toBe('hello dispatch')
  })

  it('无 handler 注册时发 user_message 收到 error 回复', async () => {
    // 先取消所有 handler（beforeEach 已清理，此处不注册任何 handler）
    const ws = await connectClient('dev-no-handler', { token: 'test-token' })

    const errorPromise = waitForMessage(ws, m => m.kind === 'error')
    ws.send(JSON.stringify({
      kind: 'user_message',
      panelId: 'panel-no-handler',
      content: 'no handler test',
    }))

    const errorMsg = await errorPromise
    expect(errorMsg.kind).toBe('error')
    expect((errorMsg as unknown as { message: string }).message).toContain('AI 服务尚未就绪')
  })
})

// ============================================================================
// 广播
// ============================================================================
describe('广播', () => {
  it('多客户端连接，broadcastChange 推送到所有客户端（除 source）', async () => {
    const ws1 = await connectClient('dev-bcast-src', { token: 'test-token' })
    const ws2 = await connectClient('dev-bcast-2', { token: 'test-token' })
    const ws3 = await connectClient('dev-bcast-3', { token: 'test-token' })

    // 清空可能的初始消息
    await waitMs(50)

    const p2 = waitForMessage(ws2, m => m.kind === 'change' && m.changeType === 'panel_created')
    const p3 = waitForMessage(ws3, m => m.kind === 'change' && m.changeType === 'panel_created')

    broadcastChange(
      { kind: 'panel_created', data: { id: 'panel-bcast', name: 'Test Panel' } },
      'dev-bcast-src',
    )

    const msg2 = await p2
    const msg3 = await p3

    expect(msg2.changeType).toBe('panel_created')
    expect((msg2 as unknown as { data: { id: string } }).data.id).toBe('panel-bcast')
    expect(msg3.changeType).toBe('panel_created')

    // source (ws1) 不应收到 change 消息
    await expect(
      waitForMessage(ws1, m => m.kind === 'change', 300),
    ).rejects.toThrow('message timeout')
  })
})

// ============================================================================
// 断开清理
// ============================================================================
describe('断开清理', () => {
  it('客户端断开，clients Map 清理 + disconnectHandler 调用', async () => {
    const disconnectCalls: string[] = []
    const unsub = onClientDisconnect((deviceId) => {
      disconnectCalls.push(deviceId)
    })
    unsubscribers.push(unsub)

    const ws = await connectClient('dev-cleanup', { token: 'test-token' })
    expect(hasDevice('dev-cleanup')).toBe(true)

    ws.close()

    // 等待服务端处理 close 事件
    await waitMs(150)

    expect(hasDevice('dev-cleanup')).toBe(false)
    expect(disconnectCalls).toContain('dev-cleanup')
  })
})

// ============================================================================
// 重连竞态
// ============================================================================
describe('重连竞态', () => {
  it('同 deviceId 新连接替换旧连接，旧连接 close 不清理新连接状态', async () => {
    const ws1 = await connectClient('dev-race', { token: 'test-token' })
    expect(hasDevice('dev-race')).toBe(true)

    // 等待 ws1 的 close 事件
    const ws1Closed = new Promise<void>(resolve => {
      ws1.on('close', () => resolve())
    })

    // 新连接替换旧连接
    const ws2 = await connectClient('dev-race', { token: 'test-token' })
    expect(hasDevice('dev-race')).toBe(true)

    // 等待 ws1 被关闭
    await ws1Closed
    expect(ws1.readyState).toBe(WebSocket.CLOSED)

    // 等待服务端处理 ws1 的 close 事件
    await waitMs(100)

    // 关键：新连接 ws2 仍然在线，旧连接 close 没有清理新连接状态
    expect(ws2.readyState).toBe(WebSocket.OPEN)
    expect(hasDevice('dev-race')).toBe(true)

    // 验证 ws2 仍能正常通信
    const pongPromise = waitForMessage(ws2, m => m.kind === 'pong')
    ws2.send(JSON.stringify({ kind: 'ping' }))
    await pongPromise
  })
})

// ============================================================================
// 重连恢复
// ============================================================================
describe('重连恢复', () => {
  it('客户端断开后用相同 deviceId 重连，连接正常工作', async () => {
    // 第一次连接
    const ws1 = await connectClient('dev-recovery', { token: 'test-token' })
    expect(hasDevice('dev-recovery')).toBe(true)

    // 断开
    ws1.close()
    await waitMs(150)
    expect(hasDevice('dev-recovery')).toBe(false)

    // 用相同 deviceId 重连
    const ws2 = await connectClient('dev-recovery', { token: 'test-token' })
    expect(hasDevice('dev-recovery')).toBe(true)

    // 验证新连接正常工作（ping → pong）
    const pongPromise = waitForMessage(ws2, m => m.kind === 'pong')
    ws2.send(JSON.stringify({ kind: 'ping' }))
    const pong = await pongPromise
    expect(pong.kind).toBe('pong')

    // 验证消息分发正常
    const calls: Array<{ msg: unknown; deviceId: string }> = []
    const unsub = onClientMessage((msg, deviceId) => {
      calls.push({ msg, deviceId })
    })
    unsubscribers.push(unsub)

    ws2.send(JSON.stringify({
      kind: 'user_message',
      panelId: 'panel-recovery',
      content: 'after reconnect',
    }))

    await waitMs(100)
    expect(calls.length).toBe(1)
    expect(calls[0].deviceId).toBe('dev-recovery')
  })
})

// ============================================================================
// 多端并行
// ============================================================================
describe('多端并行', () => {
  it('≥2 客户端连不同 panelId 并发 user_message，互不污染', async () => {
    const ws1 = await connectClient('dev-parallel-1', { token: 'test-token' })
    const ws2 = await connectClient('dev-parallel-2', { token: 'test-token' })

    const messages: Array<{ deviceId: string; panelId: string; content: string }> = []
    const unsub = onClientMessage((msg, deviceId) => {
      const m = msg as { kind: string; panelId?: string; content?: string }
      if (m.kind === 'user_message') {
        messages.push({ deviceId, panelId: m.panelId ?? '', content: m.content ?? '' })
      }
    })
    unsubscribers.push(unsub)

    // 并发发送不同 panelId 的 user_message
    ws1.send(JSON.stringify({
      kind: 'user_message',
      panelId: 'panel-A',
      content: 'from device 1',
    }))
    ws2.send(JSON.stringify({
      kind: 'user_message',
      panelId: 'panel-B',
      content: 'from device 2',
    }))

    await waitMs(150)

    // 两条消息都被正确路由到 handler，携带各自的 deviceId 和 panelId
    expect(messages.length).toBe(2)
    const msg1 = messages.find(m => m.deviceId === 'dev-parallel-1')
    const msg2 = messages.find(m => m.deviceId === 'dev-parallel-2')
    expect(msg1).toBeDefined()
    expect(msg1?.panelId).toBe('panel-A')
    expect(msg1?.content).toBe('from device 1')
    expect(msg2).toBeDefined()
    expect(msg2?.panelId).toBe('panel-B')
    expect(msg2?.content).toBe('from device 2')
  })
})

// ============================================================================
// 代理请求
// ============================================================================
describe('代理请求 sendProxyRequest', () => {
  it('路由到目标设备 + 响应 resolve', async () => {
    const ws = await connectClient('dev-proxy-route', { token: 'test-token' })

    const proxyMsgPromise = waitForMessage(ws, m => m.kind === 'proxy_request')

    const promise = sendProxyRequest('dev-proxy-route', {
      serviceName: 'test-svc',
      method: 'GET',
      path: '/api/test',
      headers: { 'X-Test': 'true' },
      body: null,
    })

    const proxyMsg = await proxyMsgPromise
    expect(proxyMsg.kind).toBe('proxy_request')
    expect((proxyMsg as unknown as { serviceName: string }).serviceName).toBe('test-svc')
    expect((proxyMsg as unknown as { method: string }).method).toBe('GET')
    expect((proxyMsg as unknown as { path: string }).path).toBe('/api/test')

    // 发送 proxy_response
    const requestId = (proxyMsg as unknown as { requestId: string }).requestId
    ws.send(JSON.stringify({
      kind: 'proxy_response',
      requestId,
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: '{"ok":true}',
    }))

    const result = await promise
    expect(result.status).toBe(200)
    expect(result.headers['Content-Type']).toBe('application/json')
    expect(result.body).toBe('{"ok":true}')
  })

  it('目标设备离线时 reject with device_offline', async () => {
    // 不连接任何设备
    await expect(
      sendProxyRequest('dev-proxy-offline', {
        serviceName: 'test',
        method: 'GET',
        path: '/',
        headers: {},
        body: null,
      }),
    ).rejects.toThrow('device_offline')
  })

  it('目标设备 WS 断开时 reject with device_disconnected + 清理 pending', async () => {
    const ws = await connectClient('dev-proxy-disc', { token: 'test-token' })

    // 监听 proxy_request 确认已发送
    const proxyMsgPromise = waitForMessage(ws, m => m.kind === 'proxy_request')

    const promise = sendProxyRequest('dev-proxy-disc', {
      serviceName: 'test',
      method: 'GET',
      path: '/test',
      headers: {},
      body: null,
    })
    // 立即附加 catch 防止 unhandled rejection 警告
    const errorPromise = promise.then(
      () => { throw new Error('Expected rejection, got resolution') },
      (err: Error) => err,
    )

    // 等待 proxy_request 消息到达客户端
    await proxyMsgPromise

    // 关闭客户端 WS
    ws.close()

    // 等待服务端处理 close 事件
    await waitMs(150)

    // Promise 应 reject with 'device_disconnected'
    const error = await errorPromise
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toBe('device_disconnected')
  })

  it('30s 超时 reject with proxy_timeout（fake timers）', async () => {
    const ws = await connectClient('dev-proxy-timeout', { token: 'test-token' })

    // 确认 proxy_request 消息已发送
    const proxyMsgPromise = waitForMessage(ws, m => m.kind === 'proxy_request')

    vi.useFakeTimers()

    const promise = sendProxyRequest('dev-proxy-timeout', {
      serviceName: 'test',
      method: 'GET',
      path: '/timeout',
      headers: {},
      body: null,
    })
    // 立即附加 catch 防止 unhandled rejection 警告
    const errorPromise = promise.then(
      () => { throw new Error('Expected rejection, got resolution') },
      (err: Error) => err,
    )

    // 等待 proxy_request 发送（I/O 在 useFakeTimers 后仍可工作）
    await vi.advanceTimersByTimeAsync(100)
    await proxyMsgPromise

    // 推进 31s 超过 30s 超时
    await vi.advanceTimersByTimeAsync(31_000)

    const error = await errorPromise
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toBe('proxy_timeout')

    vi.useRealTimers()
  })
})

// ============================================================================
// error_report 路由
// ============================================================================
describe('error_report 路由', () => {
  it('客户端发 error_report，errorReportHandler 被调用', async () => {
    const ws = await connectClient('dev-err-route', { token: 'test-token' })

    const calls: Array<{ report: unknown; deviceId: string }> = []
    const unsub = onErrorReport((report, deviceId) => {
      calls.push({ report, deviceId })
    })
    unsubscribers.push(unsub)

    ws.send(JSON.stringify({
      kind: 'error_report',
      widgetId: 'widget-err',
      panelId: 'panel-err',
      message: 'runtime error',
      stack: 'Error: crash',
      source: 'iframe',
    }))

    await waitMs(100)

    expect(calls.length).toBe(1)
    expect(calls[0].deviceId).toBe('dev-err-route')
    const report = calls[0].report as {
      widgetId: string; panelId?: string; message: string; stack?: string; source: string
    }
    expect(report.widgetId).toBe('widget-err')
    expect(report.panelId).toBe('panel-err')
    expect(report.message).toBe('runtime error')
    expect(report.source).toBe('iframe')
  })
})

// ============================================================================
// 心跳超时（fake timers + fresh module）
// ============================================================================
// 注：startWebSocketServer 有 wss 守卫，共享 server 的 heartbeatCheckTimer
// 是真实 setInterval，无法用 fake timers 加速。此处用 vi.resetModules() 获取
// 新模块实例，启动新 server，使 heartbeatCheckTimer 使用 fake setInterval。
describe('心跳超时（fake timers）', () => {
  let fakeServer: http.Server
  let fakePort: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let wsModule: any
  const fakeClients: WebSocket[] = []

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.resetModules()
    wsModule = await import('../../src/ws.js')

    fakeServer = http.createServer()
    await new Promise<void>(resolve => fakeServer.listen(0, resolve))
    fakePort = (fakeServer.address() as AddressInfo).port
    wsModule.startWebSocketServer(fakeServer)
  })

  afterEach(async () => {
    for (const ws of fakeClients.splice(0)) { try { ws.close() } catch { /* ignore */ } }
    vi.useRealTimers()
    vi.clearAllTimers()
    await new Promise<void>(resolve => fakeServer.close(() => resolve()))
    await waitMs(50)
  })

  it('90s 无 ping 连接被关闭', async () => {
    const ws = new WebSocket(`ws://localhost:${fakePort}/ws?deviceId=dev-hb-timeout&token=test-token`)
    fakeClients.push(ws)

    // 等待连接建立（I/O 事件不依赖 fake timers）
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve())
      ws.on('error', (err) => reject(err))
    })

    // 推进少量时间让 I/O 回调执行
    await vi.advanceTimersByTimeAsync(100)

    // 确认设备在线
    expect(wsModule.hasDevice('dev-hb-timeout')).toBe(true)

    // 推进时间超过 90s 超时 + 30s 检查间隔
    // 在 120s 时 heartbeat check 触发：120000 - 0 > 90000 = true → close
    await vi.advanceTimersByTimeAsync(121_000)

    // 设备应已被清理（clients.delete 在心跳检查中同步执行）
    expect(wsModule.hasDevice('dev-hb-timeout')).toBe(false)

    // WS 应已开始关闭流程（CLOSING 或 CLOSED；fake timers 下 TCP 握手可能未完全 flush）
    // 关键验证点：连接不再是 OPEN 状态（心跳超时已触发 ws.close）
    expect(ws.readyState).not.toBe(WebSocket.OPEN)

    // 额外推进时间确认 close 事件在服务端已处理
    await vi.advanceTimersByTimeAsync(500)
  })
})
