/**
 * MockWebSocket（Phase 11.1）
 *
 * 模拟浏览器/Electron 环境的 WebSocket 连接，供测试用例：
 * 1. 不实际建立网络连接
 * 2. 支持断言收发消息（sentMessages / receivedMessages）
 * 3. 静态方法 simulateMessage 模拟服务端推送
 * 4. 兼容 EventTarget 接口（addEventListener / dispatchEvent）
 *
 * 用法：
 *   const ws = new MockWebSocket('ws://test')
 *   ws.addEventListener('open', () => { ... })
 *   ws.send('hello')
 *   MockWebSocket.simulateOpen(ws)
 *   MockWebSocket.simulateMessage(ws, { type: 'tool_call', ... })
 */
import { vi } from 'vitest'

export type MockWebSocketState = 0 | 1 | 2 | 3 // CONNECTING / OPEN / CLOSING / CLOSED

export class MockWebSocket extends EventTarget {
  static readonly CONNECTING = 0 as const
  static readonly OPEN = 1 as const
  static readonly CLOSING = 2 as const
  static readonly CLOSED = 3 as const

  readonly url: string
  public readyState: MockWebSocketState = MockWebSocket.CONNECTING
  public bufferedAmount = 0
  public extensions = ''
  public protocol = ''
  public binaryType: 'blob' | 'arraybuffer' = 'blob'

  /** 记录所有 send 调用，供断言 */
  public sentMessages: (string | ArrayBuffer | Blob)[] = []
  /** 记录所有接收到的消息，供断言 */
  public receivedMessages: unknown[] = []
  /** onClose / onError / onMessage / onOpen 处理器 */
  public onopen: ((ev: Event) => void) | null = null
  public onmessage: ((ev: MessageEvent) => void) | null = null
  public onclose: ((ev: CloseEvent) => void) | null = null
  public onerror: ((ev: Event) => void) | null = null

  private static instances: MockWebSocket[] = []

  constructor(url: string, _protocols?: string | string[]) {
    super()
    this.url = url
    MockWebSocket.instances.push(this)
  }

  send(data: string | ArrayBuffer | Blob): void {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error(`WebSocket is not in OPEN state (current: ${this.readyState})`)
    }
    this.sentMessages.push(data)
  }

  close(code = 1000, reason?: string): void {
    if (this.readyState === MockWebSocket.CLOSED || this.readyState === MockWebSocket.CLOSING) return
    this.readyState = MockWebSocket.CLOSING
    const event = new CloseEvent('close', { code, reason, wasClean: code === 1000 })
    // 注意：happy-dom 下 EventTarget 会自动绑定 onXxx 属性到 dispatchEvent，
    //   所以只需 dispatchEvent 即可触发 onclose + addEventListener('close', ...)。
    //   手动调用 this.onclose?.(event) 会导致双重触发。
    this.dispatchEvent(event)
    this.readyState = MockWebSocket.CLOSED
  }

  // ========== 静态辅助方法（测试用例主动触发事件） ==========

  /** 模拟服务端 open 事件 */
  static simulateOpen(ws: MockWebSocket): void {
    ws.readyState = MockWebSocket.OPEN
    const event = new Event('open')
    // 同上：只用 dispatchEvent，由 happy-dom 自动触发 onopen
    ws.dispatchEvent(event)
  }

  /** 模拟服务端推送 message 事件（data 为对象时自动 JSON.stringify） */
  static simulateMessage(ws: MockWebSocket, data: unknown, isBinary = false): void {
    ws.receivedMessages.push(data)
    const payload: string | ArrayBuffer =
      typeof data === 'string' || data instanceof ArrayBuffer ? data : JSON.stringify(data)
    const event = new MessageEvent('message', { data: payload, origin: ws.url })
    Object.defineProperty(event, 'isTrusted', { value: true })
    if (isBinary) ws.binaryType = 'arraybuffer'
    // 同上：只用 dispatchEvent，由 happy-dom 自动触发 onmessage
    ws.dispatchEvent(event)
  }

  /** 模拟服务端 error 事件 */
  static simulateError(ws: MockWebSocket, error?: unknown): void {
    const event = new Event('error')
    ;(event as Event & { error?: unknown }).error = error
    // 同上：只用 dispatchEvent，由 happy-dom 自动触发 onerror
    ws.dispatchEvent(event)
  }

  /** 获取最近创建的 MockWebSocket 实例 */
  static lastInstance(): MockWebSocket | undefined {
    return MockWebSocket.instances[MockWebSocket.instances.length - 1]
  }

  /** 获取所有 MockWebSocket 实例 */
  static allInstances(): MockWebSocket[] {
    return [...MockWebSocket.instances]
  }

  /** 重置所有实例（每个测试前调用） */
  static reset(): void {
    MockWebSocket.instances = []
  }

  /** 安装为全局 WebSocket（替换 window.WebSocket） */
  static installGlobal(): () => void {
    const original = globalThis.WebSocket as unknown
    ;(globalThis as unknown as { WebSocket: typeof MockWebSocket }).WebSocket = MockWebSocket
    return () => {
      ;(globalThis as unknown as { WebSocket: typeof MockWebSocket }).WebSocket = original as typeof MockWebSocket
    }
  }
}

/** 便捷构造：自动 open */
export function createOpenMockWebSocket(url = 'ws://test'): MockWebSocket {
  const ws = new MockWebSocket(url)
  MockWebSocket.simulateOpen(ws)
  return ws
}

/** vi.fn() 包装的 mock，便于断言调用次数 */
export const mockWebSocketFn = vi.fn()
