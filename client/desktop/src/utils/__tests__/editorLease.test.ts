/**
 * editorLease 单元测试 — Phase 11 P1
 *
 * 覆盖重点：
 * 1. 获取租约成功（acquire → isLeaseHolder=true + lease_acquired 事件）
 * 2. 续约租约（renew → expiresAt 更新 + lease_renewed 事件）
 * 3. 释放租约（release → isLeaseHolder=false + lease_lost manual_release 事件）
 * 4. 冲突检测（其他 tab 持有租约时 acquire 失败 + lease_denied 事件）
 * 5. 租约过期自动释放（心跳停止后 TTL 到期 → lease_lost expired 事件）
 *
 * Mock 策略：
 * - 自定义 MockBroadcastChannel（同步分发），替换全局 BroadcastChannel
 *   原因：happy-dom 的 BroadcastChannel 跨实例投递行为不稳定，
 *   用同步分发的 mock 保证测试确定性
 * - vi.useFakeTimers + vi.setSystemTime：控制 ACQUIRE_WAIT_MS(500ms) /
 *   LEASE_TTL_MS(15000ms) / HEARTBEAT_INTERVAL_MS(5000ms)
 * - vi.spyOn(Math, 'random').mockReturnValue(0)：固定退避时间为 0
 *
 * 注意：editorLease.ts 模块加载时会创建单例 editorLeaseManager，
 *      该单例也会使用 MockBroadcastChannel，但不参与测试断言。
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { EditorLeaseManager } from '../editorLease'

// ============================================================================
// Mock BroadcastChannel：同步分发到同名 channel（不回传给发送者）
// ============================================================================
class MockBroadcastChannel {
  name: string
  onmessage: ((event: MessageEvent) => void) | null = null
  private static channels = new Map<string, Set<MockBroadcastChannel>>()

  constructor(name: string) {
    this.name = name
    if (!MockBroadcastChannel.channels.has(name)) {
      MockBroadcastChannel.channels.set(name, new Set())
    }
    MockBroadcastChannel.channels.get(name)!.add(this)
  }

  // 同步分发：保证测试确定性（不依赖 microtask 调度）
  postMessage(data: unknown): void {
    const channels = MockBroadcastChannel.channels.get(this.name)
    if (!channels) return
    for (const ch of channels) {
      if (ch === this) continue // 不回传给发送者（符合 BroadcastChannel 规范）
      ch.onmessage?.({ data } as MessageEvent)
    }
  }

  close(): void {
    MockBroadcastChannel.channels.get(this.name)?.delete(this)
  }

  static reset(): void {
    MockBroadcastChannel.channels.clear()
  }
}

// ============================================================================
// 测试套件
// ============================================================================
describe('EditorLeaseManager', () => {
  beforeEach(() => {
    // 重置 channel 注册表
    MockBroadcastChannel.reset()
    // 替换全局 BroadcastChannel
    vi.stubGlobal('BroadcastChannel', MockBroadcastChannel)
    // 假定时器
    vi.useFakeTimers()
    // 固定系统时间，保证 Date.now() 可预测
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'))
    // 固定 Math.random=0，使冲突退避时间为 0
    vi.spyOn(Math, 'random').mockReturnValue(0)
    // 抑制源码 console 噪音
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  // --------------------------------------------------------------------------
  // 1. 获取租约成功
  // --------------------------------------------------------------------------
  test('1. acquire 成功获取租约，isLeaseHolder 变为 true 并触发 lease_acquired', async () => {
    const manager = new EditorLeaseManager()
    const events: Array<{ kind: string }> = []
    manager.onLeaseEvent(e => events.push(e))

    const promise = manager.acquire()
    // 跳过 ACQUIRE_WAIT_MS(500ms)
    await vi.advanceTimersByTimeAsync(500)
    const result = await promise

    // 验证返回值
    expect(result).toBe(true)
    // 验证租约状态
    expect(manager.isLeaseHolder).toBe(true)
    expect(manager.currentLease).not.toBeNull()
    // 验证事件
    expect(events.some(e => e.kind === 'lease_acquired')).toBe(true)
    // 验证 lease 字段
    const lease = manager.currentLease!
    expect(lease.acquiredAt).toBeGreaterThan(0)
    expect(lease.expiresAt).toBe(lease.acquiredAt + 15000) // LEASE_TTL_MS
    expect(lease.heartbeatInterval).toBe(5000) // HEARTBEAT_INTERVAL_MS

    manager.destroy()
  })

  // --------------------------------------------------------------------------
  // 2. 续约租约
  // --------------------------------------------------------------------------
  test('2. renew 成功续约，expiresAt 更新并触发 lease_renewed', async () => {
    const manager = new EditorLeaseManager()
    const events: Array<{ kind: string }> = []
    manager.onLeaseEvent(e => events.push(e))

    // 先获取租约
    let p = manager.acquire()
    await vi.advanceTimersByTimeAsync(500)
    await p
    const oldExpiresAt = manager.currentLease!.expiresAt
    const oldAcquiredAt = manager.currentLease!.acquiredAt

    // 推进 3000ms（不触发 5000ms 的 heartbeat，避免心跳续期 expiresAt）
    await vi.advanceTimersByTimeAsync(3000)

    // 续约
    p = manager.renew()
    await vi.advanceTimersByTimeAsync(500) // ACQUIRE_WAIT_MS
    const result = await p

    // 验证返回值
    expect(result).toBe(true)
    // 验证续约后 expiresAt 更新（比旧值更晚）
    expect(manager.currentLease).not.toBeNull()
    expect(manager.currentLease!.expiresAt).toBeGreaterThan(oldExpiresAt)
    // acquiredAt 也应更新为续约时刻
    expect(manager.currentLease!.acquiredAt).toBeGreaterThan(oldAcquiredAt)
    // 验证事件
    expect(events.some(e => e.kind === 'lease_renewed')).toBe(true)

    manager.destroy()
  })

  // --------------------------------------------------------------------------
  // 3. 释放租约
  // --------------------------------------------------------------------------
  test('3. release 释放租约，isLeaseHolder 变为 false 并触发 lease_lost manual_release', async () => {
    const manager = new EditorLeaseManager()
    const events: Array<{ kind: string; reason?: string }> = []
    manager.onLeaseEvent(e => events.push(e))

    // 先获取租约
    let p = manager.acquire()
    await vi.advanceTimersByTimeAsync(500)
    await p
    expect(manager.isLeaseHolder).toBe(true)

    // 释放
    manager.release()

    // 验证状态
    expect(manager.isLeaseHolder).toBe(false)
    expect(manager.currentLease).toBeNull()
    // 验证事件
    expect(events.some(e => e.kind === 'lease_lost' && e.reason === 'manual_release')).toBe(true)

    manager.destroy()
  })

  // --------------------------------------------------------------------------
  // 4. 冲突检测：其他 tab 持有租约时获取失败
  // --------------------------------------------------------------------------
  test('4. 冲突检测：其他 tab 回复 lease_conflict 时 acquire 失败并触发 lease_denied', async () => {
    // 模拟其他 tab 持有租约：监听 lease_request 并回复 lease_conflict
    const otherChannel = new MockBroadcastChannel('editor-lease-coordination')
    otherChannel.onmessage = (event) => {
      const msg = event.data as { type: string }
      if (msg.type === 'lease_request') {
        // 模拟持有租约的 tab 回复冲突
        otherChannel.postMessage({
          type: 'lease_conflict',
          tabId: 'other-tab-id',
          timestamp: Date.now(),
        })
      }
    }

    const manager = new EditorLeaseManager()
    const events: Array<{ kind: string; reason?: string }> = []
    manager.onLeaseEvent(e => events.push(e))

    const promise = manager.acquire()
    // 跳过 ACQUIRE_WAIT_MS(500) + 冲突退避（Math.random=0 → backoff=0）
    await vi.advanceTimersByTimeAsync(1000)
    const result = await promise

    // 验证返回值
    expect(result).toBe(false)
    // 验证未持有租约
    expect(manager.isLeaseHolder).toBe(false)
    expect(manager.currentLease).toBeNull()
    // 验证事件
    expect(events.some(e => e.kind === 'lease_denied' && e.reason === 'conflict')).toBe(true)

    otherChannel.close()
    manager.destroy()
  })

  // --------------------------------------------------------------------------
  // 5. 租约过期自动释放
  // --------------------------------------------------------------------------
  test('5. 租约过期自动释放：心跳停止后 TTL 到期触发 lease_lost expired', async () => {
    const manager = new EditorLeaseManager()
    const events: Array<{ kind: string; reason?: string }> = []
    manager.onLeaseEvent(e => events.push(e))

    // 先获取租约
    let p = manager.acquire()
    await vi.advanceTimersByTimeAsync(500)
    await p
    expect(manager.isLeaseHolder).toBe(true)
    const leaseTabId = manager.currentLease!.tabId

    // 停止心跳模拟 tab 卡死（否则心跳每 5s 续期 expiresAt，lease 永不过期）
    // 通过类型断言访问私有方法 stopHeartbeat
    const internal = manager as unknown as { stopHeartbeat: () => void }
    internal.stopHeartbeat()

    // 推进超过 LEASE_TTL_MS(15000ms)，触发 expiry monitor
    await vi.advanceTimersByTimeAsync(15000)

    // 验证租约已过期释放
    expect(manager.isLeaseHolder).toBe(false)
    expect(manager.currentLease).toBeNull()
    // 验证事件
    const lostEvent = events.find(e => e.kind === 'lease_lost' && e.reason === 'expired')
    expect(lostEvent).toBeDefined()
    expect(lostEvent!.tabId).toBe(leaseTabId)

    manager.destroy()
  })

  // --------------------------------------------------------------------------
  // 6. onLeaseEvent 订阅与取消订阅
  // --------------------------------------------------------------------------
  test('6. onLeaseEvent 返回取消订阅函数，调用后不再接收事件', async () => {
    const manager = new EditorLeaseManager()
    const events: Array<{ kind: string }> = []
    const unsubscribe = manager.onLeaseEvent(e => events.push(e))

    // 获取租约 → 触发 lease_acquired
    let p = manager.acquire()
    await vi.advanceTimersByTimeAsync(500)
    await p
    expect(events.length).toBe(1) // lease_acquired

    // 取消订阅
    unsubscribe()

    // release 应触发 lease_lost，但已取消订阅，不应收到
    manager.release()
    expect(events.length).toBe(1) // 仍然是 1，未收到 lease_lost

    manager.destroy()
  })

  // --------------------------------------------------------------------------
  // 7. 无租约时状态
  // --------------------------------------------------------------------------
  test('7. 无租约时 isLeaseHolder 返回 false，currentLease 返回 null', () => {
    const manager = new EditorLeaseManager()
    expect(manager.isLeaseHolder).toBe(false)
    expect(manager.currentLease).toBeNull()
    manager.destroy()
  })

  // --------------------------------------------------------------------------
  // 8. release 在无租约时是 no-op
  // --------------------------------------------------------------------------
  test('8. release 在无租约时不抛错且不触发事件', () => {
    const manager = new EditorLeaseManager()
    const events: Array<{ kind: string }> = []
    manager.onLeaseEvent(e => events.push(e))

    expect(() => manager.release()).not.toThrow()
    expect(manager.currentLease).toBeNull()
    expect(events.length).toBe(0) // 无事件

    manager.destroy()
  })

  // --------------------------------------------------------------------------
  // 9. 已持有租约时再次 acquire 直接返回 true（幂等）
  // --------------------------------------------------------------------------
  test('9. 已持有租约时再次 acquire 直接返回 true（幂等）', async () => {
    const manager = new EditorLeaseManager()

    // 先获取租约
    let p = manager.acquire()
    await vi.advanceTimersByTimeAsync(500)
    await p
    expect(manager.isLeaseHolder).toBe(true)

    // 第二次 acquire 应直接返回 true（不重新走 acquire 流程）
    const result2 = await manager.acquire()
    expect(result2).toBe(true)

    manager.destroy()
  })

  // --------------------------------------------------------------------------
  // 10. renew 在无租约时返回 false
  // --------------------------------------------------------------------------
  test('10. renew 在无租约时返回 false', async () => {
    const manager = new EditorLeaseManager()

    const result = await manager.renew()
    expect(result).toBe(false)
    expect(manager.currentLease).toBeNull()

    manager.destroy()
  })

  // --------------------------------------------------------------------------
  // 11. destroy 释放租约并清理资源
  // --------------------------------------------------------------------------
  test('11. destroy 释放租约并清理 listeners', async () => {
    const manager = new EditorLeaseManager()
    const events: Array<{ kind: string }> = []
    manager.onLeaseEvent(e => events.push(e))

    // 先获取租约
    let p = manager.acquire()
    await vi.advanceTimersByTimeAsync(500)
    await p
    expect(events.length).toBe(1) // lease_acquired

    // destroy 应触发 release → lease_lost manual_release
    manager.destroy()
    expect(events.length).toBe(2) // lease_acquired + lease_lost
    expect(events[1].kind).toBe('lease_lost')

    // destroy 后 release 应为 no-op
    expect(() => manager.release()).not.toThrow()
  })

  // --------------------------------------------------------------------------
  // 12. other_tab_released 事件：其他 tab 释放租约时收到通知
  // --------------------------------------------------------------------------
  test('12. 其他 tab 释放租约时当前 manager 收到 other_tab_released 事件', async () => {
    const manager = new EditorLeaseManager()
    const events: Array<{ kind: string; tabId?: string }> = []
    manager.onLeaseEvent(e => events.push(e))

    // 模拟其他 tab 发送 lease_released 消息
    const otherChannel = new MockBroadcastChannel('editor-lease-coordination')
    otherChannel.postMessage({
      type: 'lease_released',
      tabId: 'some-other-tab',
      timestamp: Date.now(),
    })

    // 验证收到 other_tab_released 事件
    expect(events.some(e => e.kind === 'other_tab_released' && e.tabId === 'some-other-tab')).toBe(true)

    otherChannel.close()
    manager.destroy()
  })
})
