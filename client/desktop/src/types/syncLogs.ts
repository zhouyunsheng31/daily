// ============================================================================
// Phase S3 缺口 B：客户端 sync_logs 独立类型（spec 2.2.6 节）
// S-3 修复：客户端**不**跨端引用服务端类型（避免构建耦合 + 反模式）。
// 此文件与服务端 SyncLogEntry 结构相同但独立维护。
// ============================================================================

export type SyncLogStatus = 'pending' | 'success' | 'failed'

export interface SyncLogEntry {
  id: string
  deviceId: string
  operation: 'create' | 'update' | 'delete'
  entityType: string  // 'panel' | 'widget' | 'entity' | 'favorite' | 'settings'
  entityId: string
  payload: unknown
  status: SyncLogStatus
  retryCount: number
  lastError: string | null
  createdAt: number
  updatedAt: number
  nextRetryAt: number | null
}

// retry 响应可能返回 skipped（create 重试不支持，spec 2.2.3 S-7 修复）
export type RetryStatus = SyncLogStatus | 'skipped'

export interface RetryResponse {
  ok: boolean
  status: RetryStatus
  error?: string
  reason?: string
  id?: string
}

// ============================================================================
// Phase S3 缺口 C：sync_failed WS 事件载荷（spec 2.3.1 节）
// S-3 修复：客户端独立类型，不跨端引用 server/src/ws.ts
// 服务端 sync_logs PUT status=failed 时通过 sendToDevice + broadcastChange 推送
// 客户端 useAIStore.handleServerChange 监听 sync_failed 分支调用 useAppStore.addSyncFailedEntry
// ============================================================================
export interface SyncFailedEvent {
  id: string                       // sync_log ID（客户端可用此 ID 调 retry/delete API）
  deviceId: string                // 失败操作发起设备
  operation: 'create' | 'update' | 'delete'
  entityType: string
  entityId: string
  lastError: string | null
  retryCount: number
  updatedAt: number
}
