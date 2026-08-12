// ============================================================================
// Phase S3 缺口 B：客户端 sync_logs API（spec 2.2.6 节）
// 引用客户端独立类型 types/syncLogs.ts（S-3 修复，不跨端引用服务端类型）
// ============================================================================

import { api } from './client'
import type { SyncLogEntry, RetryResponse } from '../types/syncLogs'

/**
 * PUT /api/sync/logs — upsert sync log
 * 客户端 syncQueue 双写时调用：写入 pending 或更新 success/failed
 */
export async function upsertSyncLog(entry: SyncLogEntry): Promise<void> {
  await api.put<{ ok: boolean; id: string; status: string }>('/sync/logs', {
    id: entry.id,
    operation: entry.operation,
    entityType: entry.entityType,
    entityId: entry.entityId,
    payload: entry.payload,
    status: entry.status,
    retryCount: entry.retryCount,
    lastError: entry.lastError,
    nextRetryAt: entry.nextRetryAt,
  })
}

/**
 * GET /api/sync/logs/failed — 查询所有失败日志
 * 供 SyncFailedBanner 初始化时拉取服务器端 failed 列表（多端协作）
 */
export async function getFailedSyncLogs(deviceId?: string): Promise<SyncLogEntry[]> {
  const params: Record<string, string> = {}
  if (deviceId) params.deviceId = deviceId
  const res = await api.get<{ items: SyncLogEntry[]; limit: number; offset: number }>(
    '/sync/logs/failed',
    params,
  )
  return res.items
}

/**
 * DELETE /api/sync/logs/:id — 删除单条 sync log
 * 用户在 SyncFailedBanner 点击"删除"按钮时调用
 */
export async function deleteSyncLog(id: string): Promise<void> {
  await api.delete<{ ok: boolean }>(`/sync/logs/${id}`)
}

/**
 * POST /api/sync/logs/:id/retry — 手动触发重试
 * 服务器端执行 payload 指向的操作，成功后 status=success
 * create 操作返回 { ok: false, status: 'skipped', reason: '...' }（S-7 修复）
 */
export async function retrySyncLog(id: string): Promise<RetryResponse> {
  return await api.post<RetryResponse>(`/sync/logs/${id}/retry`)
}
