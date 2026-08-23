// ============================================================================
// S8.3 ws.ts 单元测试
// ============================================================================
// 测试目标：ws.ts 导出的 API 函数（sendToDevice/broadcast/sendToolCall/...）
// 方法：启动真实 WS server + 真实 ws 客户端连接，通过 API 函数操作内部 clients Map
// 注：clients Map 未导出，只能通过 startWebSocketServer + 客户端连接间接填充
// ============================================================================

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest'
import http from 'http'
import { WebSocket } from 'ws'
import type { AddressInfo } from 'net'
import {
  startWebSocketServer,
  sendToDevice,
  broadcast,
  broadcastChange,
  sendToolCall,
  sendToClient,
  hasClient,
  hasDevice,
  isGuestDevice,
  getGuestDeviceId,
  getOnlineDeviceIds,
  onClientMessage,
  onClientConnect,
  onClientDisconnect,
  onErrorReport,
} from '../../src/ws.js'
import { signGuestToken } from '../../src/utils/jwt.js'

// ============================================================================
// 共享 server（startWebSocketServer 有 wss 守卫，只能启动一次）
// ============================================================================
let httpServer: http.Server
let port: number
const createdClients: WebSocket[] = []
const unsubscribers: (() => void)[] = []

function connectClient(deviceId: string, opts?: { token?: string; cookie?: string }): Promise<WebSocket> {
  const params = new URLSearchParams({ deviceId })
  if (opts?.token !== undefined) params.set('token', opts.token)
  const url = `ws://localhost:${port}/ws?${params.toString()}`
  const wsOpts = {} as unknown as ConstructorParameters<typeof WebSocket>[1]
  if (opts?.cookie) {
    (wsOpts as { headers?: Record<string, string> }).headers = { Cookie: opts.cookie }
  }
  const ws = new WebSocket(url, wsOpts)
  createdClients.push(ws)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`connect timeout for ${deviceId}`)), 5000)
    ws.on('open', () => { clearTimeout(timer); resolve(ws) })
    ws.on('error', (err) => { clearTimeout(timer); reject(err) })
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
  // 每个测试前清理上一轮残留的客户端和 handler
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
// sendToDevice
// ============================================================================
describe('sendToDevice', () => {
  it('设备在线时发送成功返回 true', async () => {
    const ws = await connectClient('dev-send-online', { token: 'test-token' })

    const pongPromise = waitForMessage(ws, m => m.kind === 'pong')
    const sent = sendToDevice('dev-send-online', { kind: 'pong' })
    expect(sent).toBe(true)
    await pongPromise
  })

  it('设备离线时返回 false', () => {
    const sent = sendToDevice('dev-not-exists', { kind: 'pong' })
    expect(sent).toBe(false)
  })

  it('设备已断开但 Map 未清理时返回 false', async () => {
    const ws = await connectClient('dev-closing', { token: 'test-token' })
    ws.close()
    // 等待服务端 close 事件清理
    await waitMs(100)
    // 清理后 sendToDevice 应返回 false
    const sent = sendToDevice('dev-closing', { kind: 'pong' })
    expect(sent).toBe(false)
  })
})

// ============================================================================
// broadcast
// ============================================================================
describe('broadcast', () => {
  it('广播消息到所有在线客户端', async () => {
    const ws1 = await connectClient('dev-bcast-1', { token: 'test-token' })
    const ws2 = await connectClient('dev-bcast-2', { token: 'test-token' })
    const ws3 = await connectClient('dev-bcast-3', { token: 'test-token' })

    const p1 = waitForMessage(ws1, m => m.kind === 'pong')
    const p2 = waitForMessage(ws2, m => m.kind === 'pong')
    const p3 = waitForMessage(ws3, m => m.kind === 'pong')

    broadcast({ kind: 'pong' })

    await Promise.all([p1, p2, p3])
  })

  it('排除指定设备不接收广播', async () => {
    const ws1 = await connectClient('dev-excl-1', { token: 'test-token' })
    const ws2 = await connectClient('dev-excl-2', { token: 'test-token' })

    // ws2 接收到 pong，ws1 不应接收到
    const p2 = waitForMessage(ws2, m => m.kind === 'pong')
    broadcast({ kind: 'pong' }, 'dev-excl-1')

    await p2

    // ws1 不应收到消息（等待短暂时间确认）
    await expect(
      waitForMessage(ws1, m => m.kind === 'pong', 300),
    ).rejects.toThrow('message timeout')
  })
})

// ============================================================================
// broadcastChange
// ============================================================================
describe('broadcastChange', () => {
  it('包装为 change 消息广播，sourceDeviceId 排除发起方', async () => {
    const ws1 = await connectClient('dev-chg-1', { token: 'test-token' })
    const ws2 = await connectClient('dev-chg-2', { token: 'test-token' })

    // ws2 应收到 change 消息
    const p2 = waitForMessage(ws2, m => m.kind === 'change' && m.changeType === 'panel_created')
    broadcastChange({ kind: 'panel_created', data: { id: 'panel-xyz' } }, 'dev-chg-1')

    const msg = await p2
    expect(msg.changeType).toBe('panel_created')
    expect((msg as unknown as { data: { id: string } }).data.id).toBe('panel-xyz')
    expect((msg as { sourceDeviceId?: string }).sourceDeviceId).toBe('dev-chg-1')

    // ws1 不应收到（被排除）
    await expect(
      waitForMessage(ws1, m => m.kind === 'change', 300),
    ).rejects.toThrow('message timeout')
  })

  it('不指定 sourceDeviceId 时广播到所有客户端', async () => {
    const ws1 = await connectClient('dev-chg-all-1', { token: 'test-token' })
    const ws2 = await connectClient('dev-chg-all-2', { token: 'test-token' })

    const p1 = waitForMessage(ws1, m => m.kind === 'change' && m.changeType === 'widget_updated')
    const p2 = waitForMessage(ws2, m => m.kind === 'change' && m.changeType === 'widget_updated')

    broadcastChange({ kind: 'widget_updated', data: { id: 'w1' } })

    await Promise.all([p1, p2])
  })
})

// ============================================================================
// sendToolCall
// ============================================================================
describe('sendToolCall', () => {
  it('按 targetDeviceId 路由到指定设备', async () => {
    const ws1 = await connectClient('dev-tool-1', { token: 'test-token' })
    const ws2 = await connectClient('dev-tool-2', { token: 'test-token' })

    // ws2 应收到 tool_call，ws1 不应收到
    const p2 = waitForMessage(ws2, m => m.kind === 'tool_call' && (m as unknown as { tool: string }).tool === 'test_tool')
    const sent = sendToolCall({
      kind: 'tool_call',
      requestId: 'req-1',
      tool: 'test_tool',
      params: {},
      targetDeviceId: 'dev-tool-2',
    })

    expect(sent).toBe(true)
    const msg = await p2
    expect((msg as unknown as { requestId: string }).requestId).toBe('req-1')

    // ws1 不应收到
    await expect(
      waitForMessage(ws1, m => m.kind === 'tool_call', 300),
    ).rejects.toThrow('message timeout')
  })

  it('无 targetDeviceId 时发到任一在线客户端', async () => {
    const ws = await connectClient('dev-tool-any', { token: 'test-token' })

    const p = waitForMessage(ws, m => m.kind === 'tool_call')
    const sent = sendToolCall({
      kind: 'tool_call',
      requestId: 'req-2',
      tool: 'any_tool',
      params: {},
    })

    expect(sent).toBe(true)
    const msg = await p
    expect((msg as unknown as { tool: string }).tool).toBe('any_tool')
  })
})

// ============================================================================
// sendToClient
// ============================================================================
describe('sendToClient', () => {
  it('发送到任一在线客户端返回 true', async () => {
    const ws = await connectClient('dev-client-1', { token: 'test-token' })

    const p = waitForMessage(ws, m => m.kind === 'pong')
    const sent = sendToClient({ kind: 'pong' })
    expect(sent).toBe(true)
    await p
  })

  it('无在线客户端时返回 false', async () => {
    // 确保没有客户端连接
    for (const ws of createdClients.splice(0)) { try { ws.close() } catch { /* ignore */ } }
    await waitMs(100)

    const sent = sendToClient({ kind: 'pong' })
    expect(sent).toBe(false)
  })
})

// ============================================================================
// 查询函数 hasClient / hasDevice / getOnlineDeviceIds
// ============================================================================
describe('查询函数', () => {
  it('hasClient: 有客户端时返回 true，无客户端时返回 false', async () => {
    const ws = await connectClient('dev-has-1', { token: 'test-token' })
    expect(hasClient()).toBe(true)

    ws.close()
    await waitMs(100)

    expect(hasClient()).toBe(false)
  })

  it('hasDevice: 在线设备返回 true，离线返回 false', async () => {
    const ws = await connectClient('dev-has-2', { token: 'test-token' })
    expect(hasDevice('dev-has-2')).toBe(true)
    expect(hasDevice('dev-not-exists')).toBe(false)

    ws.close()
    await waitMs(100)
    expect(hasDevice('dev-has-2')).toBe(false)
  })

  it('getOnlineDeviceIds: 返回所有在线设备 ID', async () => {
    await connectClient('dev-ids-1', { token: 'test-token' })
    await connectClient('dev-ids-2', { token: 'test-token' })

    const ids = getOnlineDeviceIds()
    expect(ids).toContain('dev-ids-1')
    expect(ids).toContain('dev-ids-2')
    expect(ids.length).toBeGreaterThanOrEqual(2)
  })
})

// ============================================================================
// isGuestDevice / getGuestDeviceId
// ============================================================================
describe('isGuestDevice / getGuestDeviceId', () => {
  it('游客 JWT 连接标记为 guest，getGuestDeviceId 返回设备 ID', async () => {
    const guestDeviceId = 'guest-conn-xyz'
    const jwt = signGuestToken(guestDeviceId)
    const ws = await connectClient(guestDeviceId, { cookie: `access_token=${jwt}` })

    expect(isGuestDevice(guestDeviceId)).toBe(true)
    expect(getGuestDeviceId(guestDeviceId)).toBe(guestDeviceId)
  })

  it('非游客连接 isGuestDevice 返回 false，getGuestDeviceId 返回 undefined', async () => {
    const ws = await connectClient('dev-nonguest', { token: 'test-token' })

    expect(isGuestDevice('dev-nonguest')).toBe(false)
    expect(getGuestDeviceId('dev-nonguest')).toBeUndefined()
  })
})

// ============================================================================
// 事件订阅 API
// ============================================================================
describe('onClientMessage', () => {
  it('注册 handler 被调用 + 取消订阅后不再调用', async () => {
    const ws = await connectClient('dev-msg-handler', { token: 'test-token' })

    const calls: Array<{ msg: unknown; deviceId: string }> = []
    const unsub = onClientMessage((msg, deviceId) => {
      calls.push({ msg, deviceId })
    })
    unsubscribers.push(unsub)

    ws.send(JSON.stringify({ kind: 'user_message', panelId: 'p1', content: 'hello' }))
    await waitMs(100)

    expect(calls.length).toBe(1)
    expect(calls[0].deviceId).toBe('dev-msg-handler')
    expect((calls[0].msg as { kind: string; content: string }).kind).toBe('user_message')
    expect((calls[0].msg as { kind: string; content: string }).content).toBe('hello')

    // 取消订阅
    unsub()

    ws.send(JSON.stringify({ kind: 'user_message', panelId: 'p1', content: 'world' }))
    await waitMs(100)

    // 不应增加新调用
    expect(calls.length).toBe(1)
  })
})

describe('onClientConnect', () => {
  it('注册 handler 在新连接时调用 + 取消订阅', async () => {
    const calls: string[] = []
    const unsub = onClientConnect((deviceId) => {
      calls.push(deviceId)
    })
    unsubscribers.push(unsub)

    const ws = await connectClient('dev-connect-handler', { token: 'test-token' })
    await waitMs(100)

    expect(calls).toContain('dev-connect-handler')

    // 取消订阅
    unsub()
    calls.length = 0

    const ws2 = await connectClient('dev-connect-handler-2', { token: 'test-token' })
    await waitMs(100)

    // 不应收到新连接通知
    expect(calls).not.toContain('dev-connect-handler-2')
  })
})

describe('onClientDisconnect', () => {
  it('注册 handler 在断开时调用 + 取消订阅', async () => {
    const calls: string[] = []
    const unsub = onClientDisconnect((deviceId) => {
      calls.push(deviceId)
    })
    unsubscribers.push(unsub)

    const ws = await connectClient('dev-disc-handler', { token: 'test-token' })
    await waitMs(50)

    ws.close()
    await waitMs(100)

    expect(calls).toContain('dev-disc-handler')

    // 取消订阅
    unsub()
    calls.length = 0

    const ws2 = await connectClient('dev-disc-handler-2', { token: 'test-token' })
    await waitMs(50)
    ws2.close()
    await waitMs(100)

    expect(calls).not.toContain('dev-disc-handler-2')
  })
})

describe('onErrorReport', () => {
  it('注册 handler 在 error_report 消息时调用 + 取消订阅', async () => {
    const ws = await connectClient('dev-err-handler', { token: 'test-token' })

    const calls: Array<{ report: unknown; deviceId: string }> = []
    const unsub = onErrorReport((report, deviceId) => {
      calls.push({ report, deviceId })
    })
    unsubscribers.push(unsub)

    ws.send(JSON.stringify({
      kind: 'error_report',
      widgetId: 'w-1',
      panelId: 'p-1',
      message: 'test error',
      stack: 'Error: test',
      source: 'unit-test',
    }))
    await waitMs(100)

    expect(calls.length).toBe(1)
    expect(calls[0].deviceId).toBe('dev-err-handler')
    const report = calls[0].report as { widgetId: string; message: string; source: string }
    expect(report.widgetId).toBe('w-1')
    expect(report.message).toBe('test error')
    expect(report.source).toBe('unit-test')

    // 取消订阅
    unsub()
    calls.length = 0

    ws.send(JSON.stringify({
      kind: 'error_report',
      widgetId: 'w-2',
      panelId: 'p-1',
      message: 'second error',
      source: 'unit-test',
    }))
    await waitMs(100)

    expect(calls.length).toBe(0)
  })
})
