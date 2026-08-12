import type { EffectiveRuntimeMode } from '../types/v2'

interface EditorLease {
  tabId: string
  acquiredAt: number
  expiresAt: number
  heartbeatInterval: number
}

type LeaseEvent =
  | { kind: 'lease_acquired'; tabId: string }
  | { kind: 'lease_lost'; tabId: string; reason: 'conflict' | 'expired' | 'manual_release' }
  | { kind: 'lease_renewed'; tabId: string }
  | { kind: 'lease_denied'; tabId: string; reason: 'conflict' }
  | { kind: 'other_tab_released'; tabId: string }

type LeaseChannelMessage =
  | { type: 'lease_request'; tabId: string; timestamp: number }
  | { type: 'lease_granted'; tabId: string; timestamp: number }
  | { type: 'lease_released'; tabId: string; timestamp: number }
  | { type: 'lease_heartbeat'; tabId: string; timestamp: number; expiresAt: number }
  | { type: 'lease_conflict'; tabId: string; timestamp: number }

const LEASE_CHANNEL_NAME = 'editor-lease-coordination'
const ACQUIRE_WAIT_MS = 500
const HEARTBEAT_INTERVAL_MS = 5000
const LEASE_TTL_MS = 15000
const MAX_BACKOFF_MS = 3000
const QUOTA_CHECK_INTERVAL_MS = 30000

export class EditorLeaseManager {
  private tabId: string
  private lease: EditorLease | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private channel: BroadcastChannel | null = null
  private listeners: Set<(event: LeaseEvent) => void> = new Set()
  private conflictReceived = false
  private expiryTimer: ReturnType<typeof setTimeout> | null = null

  constructor() {
    this.tabId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    this.initChannel()
  }

  private initChannel(): void {
    if (typeof BroadcastChannel === 'undefined') return
    this.channel = new BroadcastChannel(LEASE_CHANNEL_NAME)
    this.channel.onmessage = (event: MessageEvent<LeaseChannelMessage>) => {
      this.handleMessage(event.data)
    }
  }

  private handleMessage(msg: LeaseChannelMessage): void {
    if (msg.tabId === this.tabId) return

    switch (msg.type) {
      case 'lease_request': {
        if (this.isLeaseHolder) {
          this.channel?.postMessage({
            type: 'lease_conflict',
            tabId: this.tabId,
            timestamp: Date.now(),
          } satisfies LeaseChannelMessage)
        }
        break
      }
      case 'lease_conflict': {
        this.conflictReceived = true
        break
      }
      case 'lease_released': {
        this.emit({ kind: 'other_tab_released', tabId: msg.tabId })
        break
      }
      case 'lease_heartbeat': {
        if (this.isLeaseHolder) {
          this.channel?.postMessage({
            type: 'lease_conflict',
            tabId: this.tabId,
            timestamp: Date.now(),
          } satisfies LeaseChannelMessage)
        }
        break
      }
      default:
        break
    }
  }

  async acquire(): Promise<boolean> {
    if (this.isLeaseHolder) return true

    this.conflictReceived = false

    this.channel?.postMessage({
      type: 'lease_request',
      tabId: this.tabId,
      timestamp: Date.now(),
    } satisfies LeaseChannelMessage)

    await this.delay(ACQUIRE_WAIT_MS)

    if (this.conflictReceived) {
      const backoff = Math.random() * MAX_BACKOFF_MS
      await this.delay(backoff)
      this.emit({ kind: 'lease_denied', tabId: this.tabId, reason: 'conflict' })
      return false
    }

    const now = Date.now()
    this.lease = {
      tabId: this.tabId,
      acquiredAt: now,
      expiresAt: now + LEASE_TTL_MS,
      heartbeatInterval: HEARTBEAT_INTERVAL_MS,
    }

    this.startHeartbeat()
    this.startExpiryMonitor()
    this.emit({ kind: 'lease_acquired', tabId: this.tabId })
    return true
  }

  release(): void {
    if (!this.lease) return

    this.stopHeartbeat()
    this.stopExpiryMonitor()

    const releasedTabId = this.lease.tabId
    this.lease = null

    this.channel?.postMessage({
      type: 'lease_released',
      tabId: this.tabId,
      timestamp: Date.now(),
    } satisfies LeaseChannelMessage)

    this.emit({ kind: 'lease_lost', tabId: releasedTabId, reason: 'manual_release' })
  }

  async renew(): Promise<boolean> {
    if (!this.lease) return false

    this.conflictReceived = false

    this.channel?.postMessage({
      type: 'lease_request',
      tabId: this.tabId,
      timestamp: Date.now(),
    } satisfies LeaseChannelMessage)

    await this.delay(ACQUIRE_WAIT_MS)

    if (this.conflictReceived) {
      this.stopHeartbeat()
      this.stopExpiryMonitor()
      const lostTabId = this.lease.tabId
      this.lease = null
      this.emit({ kind: 'lease_lost', tabId: lostTabId, reason: 'conflict' })
      return false
    }

    const now = Date.now()
    this.lease = {
      ...this.lease,
      acquiredAt: now,
      expiresAt: now + LEASE_TTL_MS,
    }

    this.stopExpiryMonitor()
    this.startExpiryMonitor()
    this.emit({ kind: 'lease_renewed', tabId: this.tabId })
    return true
  }

  get currentLease(): EditorLease | null {
    return this.lease
  }

  get isLeaseHolder(): boolean {
    return this.lease !== null && this.lease.expiresAt > Date.now()
  }

  onLeaseEvent(listener: (event: LeaseEvent) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  destroy(): void {
    this.release()
    this.channel?.close()
    this.channel = null
    this.listeners.clear()
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      if (!this.lease) return
      this.lease = {
        ...this.lease,
        expiresAt: Date.now() + LEASE_TTL_MS,
      }
      this.channel?.postMessage({
        type: 'lease_heartbeat',
        tabId: this.tabId,
        timestamp: Date.now(),
        expiresAt: this.lease.expiresAt,
      } satisfies LeaseChannelMessage)
    }, HEARTBEAT_INTERVAL_MS)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private startExpiryMonitor(): void {
    this.stopExpiryMonitor()
    if (!this.lease) return
    const remaining = this.lease.expiresAt - Date.now()
    if (remaining <= 0) {
      this.handleExpiry()
      return
    }
    this.expiryTimer = setTimeout(() => {
      this.handleExpiry()
    }, remaining)
  }

  private stopExpiryMonitor(): void {
    if (this.expiryTimer !== null) {
      clearTimeout(this.expiryTimer)
      this.expiryTimer = null
    }
  }

  private handleExpiry(): void {
    if (!this.lease) return
    if (this.lease.expiresAt > Date.now()) {
      this.startExpiryMonitor()
      return
    }
    this.stopHeartbeat()
    const lostTabId = this.lease.tabId
    this.lease = null
    this.emit({ kind: 'lease_lost', tabId: lostTabId, reason: 'expired' })
  }

  private emit(event: LeaseEvent): void {
    this.listeners.forEach(fn => fn(event))
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

export async function probeQuota(): Promise<{ available: number; used: number; quota: number }> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
    return { available: 0, used: 0, quota: 0 }
  }
  try {
    const estimate = await navigator.storage.estimate()
    const quota = estimate.quota ?? 0
    const used = estimate.usage ?? 0
    const available = quota - used
    return { available, used, quota }
  } catch {
    return { available: 0, used: 0, quota: 0 }
  }
}

export async function isQuotaLow(thresholdBytes: number = 10 * 1024 * 1024): Promise<boolean> {
  const { available } = await probeQuota()
  return available < thresholdBytes
}

interface RuntimeModeState {
  mode: EffectiveRuntimeMode
  previousMode: EffectiveRuntimeMode
  reason?: string
  changedAt: number
}

export class RuntimeModeManager {
  private state: RuntimeModeState
  private listeners: Set<(state: RuntimeModeState) => void> = new Set()
  private leaseManager: EditorLeaseManager
  private quotaCheckInterval: ReturnType<typeof setInterval> | null = null
  private unsubscribeLease: (() => void) | null = null
  private running = false

  constructor(leaseManager: EditorLeaseManager) {
    this.leaseManager = leaseManager
    this.state = {
      mode: 'normal_editable',
      previousMode: 'normal_editable',
      changedAt: Date.now(),
    }
  }

  start(): void {
    if (this.running) return
    this.running = true

    this.unsubscribeLease = this.leaseManager.onLeaseEvent(event => {
      this.handleLeaseEvent(event)
    })

    this.checkQuota()
    this.quotaCheckInterval = setInterval(() => {
      this.checkQuota()
    }, QUOTA_CHECK_INTERVAL_MS)
  }

  stop(): void {
    if (!this.running) return
    this.running = false

    if (this.unsubscribeLease) {
      this.unsubscribeLease()
      this.unsubscribeLease = null
    }

    if (this.quotaCheckInterval !== null) {
      clearInterval(this.quotaCheckInterval)
      this.quotaCheckInterval = null
    }
  }

  get currentMode(): RuntimeModeState {
    return this.state
  }

  private handleLeaseEvent(event: LeaseEvent): void {
    switch (event.kind) {
      case 'lease_lost':
        if (this.state.mode === 'normal_editable') {
          this.transitionTo('readonly_lease_lost', `Lease lost: ${event.reason}`)
        }
        break
      case 'lease_acquired':
        if (this.state.mode === 'readonly_lease_lost') {
          this.transitionTo('normal_editable', 'Lease re-acquired')
        }
        break
      case 'lease_denied':
        if (this.state.mode === 'normal_editable') {
          this.transitionTo('readonly_lease_lost', `Lease denied: ${event.reason}`)
        }
        break
      default:
        break
    }
  }

  private async checkQuota(): Promise<void> {
    const low = await isQuotaLow()
    if (low && this.state.mode === 'normal_editable') {
      this.transitionTo('quota', 'Storage quota is low')
    } else if (!low && this.state.mode === 'quota') {
      this.transitionTo('normal_editable', 'Storage quota recovered')
    }
  }

  private transitionTo(mode: EffectiveRuntimeMode, reason?: string): void {
    if (this.state.mode === mode) return
    this.state = {
      mode,
      previousMode: this.state.mode,
      reason,
      changedAt: Date.now(),
    }
    this.listeners.forEach(fn => fn(this.state))
  }

  onModeChange(listener: (state: RuntimeModeState) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
}

export const editorLeaseManager = new EditorLeaseManager()
export const runtimeModeManager = new RuntimeModeManager(editorLeaseManager)
