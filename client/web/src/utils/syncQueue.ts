import { api } from '../api/client'
import * as favoritesApi from '../api/favorites'
import { upsertSyncLog } from '../api/syncLogs'
import { getDeviceId } from './deviceAuth'
import type { PositionSnapshot } from '../types'
import type { SyncLogEntry } from '../types/electron'
import type { SyncLogEntry as ServerSyncLogEntry, SyncLogStatus } from '../types/syncLogs'

const SYNC_QUEUE_DB = 'daily-sync'
const SYNC_QUEUE_STORE = 'pendingOps'
const SYNC_FLUSH_INTERVAL_MS = 60_000

// Phase 4: 无上限重试 + 指数退避（spec 2.6 节）
// 注：不再有 MAX_RETRY_COUNT，失败的操作会一直保留在队列中
const RETRY_DELAYS = [1000, 2000, 4000, 8000, 16000, 60000] // 指数退避，最大 60s
const FAILED_THRESHOLD = 10  // 超过 10 次标记为 failed，触发 UI 提示

function getRetryDelay(retryCount: number): number {
  return RETRY_DELAYS[Math.min(retryCount, RETRY_DELAYS.length - 1)]
}

export interface SyncQueueEntry {
  id: string
  operation: 'create' | 'update' | 'delete'
  entityType: string
  entityId: string
  payload: unknown
  createdAt: number
  retryCount: number
  nextRetryAt?: number  // Phase 4: 下次重试时间戳（指数退避）
}

let flushTimer: ReturnType<typeof setInterval> | null = null
let isFlushing = false

// Phase 4: 失败标记集合（供 UI 监听显示提示）
export const syncQueueFailedEntries = new Set<string>()

/**
 * Phase 4: 写入 sync-log 文件（通过 Electron IPC）
 * 非 Electron 环境下静默跳过（如纯浏览器开发模式）
 */
async function appendSyncLog(entry: SyncLogEntry): Promise<void> {
  try {
    if (typeof window !== 'undefined' && window.syncLogApi) {
      await window.syncLogApi.append(entry)
    }
  } catch (err) {
    console.warn('[SyncQueue] Failed to append sync-log:', err)
  }
}

/**
 * Phase 4: 读取 sync-log 文件（通过 Electron IPC）
 * 非 Electron 环境下返回空数组
 */
async function readSyncLog(): Promise<SyncLogEntry[]> {
  try {
    if (typeof window !== 'undefined' && window.syncLogApi) {
      return await window.syncLogApi.read()
    }
  } catch (err) {
    console.warn('[SyncQueue] Failed to read sync-log:', err)
  }
  return []
}

/**
 * Phase 4: 轮转 sync-log 文件（超过 1000 条时清理 success 记录）
 */
async function rotateSyncLog(): Promise<void> {
  try {
    if (typeof window !== 'undefined' && window.syncLogApi) {
      await window.syncLogApi.rotate()
    }
  } catch (err) {
    console.warn('[SyncQueue] Failed to rotate sync-log:', err)
  }
}

/**
 * 初始化 syncQueue（应用启动时调用）
 * Phase 4: 启动时从日志恢复 failed 记录到 IndexedDB（清缓存后不丢）
 */
export async function initSyncQueue(): Promise<void> {
  // Phase 4: 从日志文件恢复 failed 记录到 IndexedDB
  try {
    const logEntries = await readSyncLog()
    const failedEntries = logEntries.filter(e => e.status === 'failed' && e.op)
    if (failedEntries.length > 0) {
      console.log(`[SyncQueue] Recovering ${failedEntries.length} failed entries from sync-log`)
      for (const entry of failedEntries) {
        const op = entry.op as SyncQueueEntry | undefined
        if (op && op.id && op.entityType && op.operation) {
          // 恢复到 IDB 队列（如果不存在）
          const existing = await getAllFromIdbQueue()
          if (!existing.some(e => e.id === op.id)) {
            await addToIdbQueue(op)
          }
        }
      }
    }
    // 启动时轮转一次
    await rotateSyncLog()
  } catch (err) {
    console.warn('[SyncQueue] Failed to recover from sync-log:', err)
  }

  // 启动定时刷新任务
  if (!flushTimer) {
    flushTimer = setInterval(() => {
      flushSyncQueue().catch((err) => {
        console.error('[SyncQueue] Flush failed:', err)
      })
    }, SYNC_FLUSH_INTERVAL_MS)
  }
}

/**
 * 添加操作到 syncQueue
 * 当 API 不可用时调用，API 恢复后由 flushSyncQueue 批量回写
 *
 * S3 缺口 B：服务器端 sync_logs 双写（spec 2.2.5 节）
 * **S-5 修复**：enqueueSyncOp 是面向用户操作（如点击保存）的同步入口，
 * 服务器双写必须**异步不阻塞主流程**（避免网络抖动导致 UI 卡顿）。
 * 用 `void promise.catch(...)` 模式触发异步但不 await；与 4.1 风险表第 2 行一致。
 */
export async function enqueueSyncOp(entry: Omit<SyncQueueEntry, 'id' | 'createdAt' | 'retryCount'>): Promise<void> {
  const fullEntry: SyncQueueEntry = {
    ...entry,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
    retryCount: 0,
  }
  await addToIdbQueue(fullEntry)
  // S3 缺口 B：异步写入服务器 sync_logs（pending 状态）— 不 await 不阻塞
  void upsertSyncLogToServer(fullEntry, 'pending').catch((err) => {
    console.warn('[SyncQueue] Failed to upsert sync_log to server (pending):', err)
  })
  console.log(`[SyncQueue] Enqueued: ${entry.operation} ${entry.entityType}/${entry.entityId}`)
}

/**
 * 刷新 syncQueue（API 恢复后批量回写）
 * Phase 4: 无上限重试 + 指数退避
 * - 遍历队列中所有 entry，逐个执行回写
 * - 成功则移除并记录 success 日志
 * - 失败则增加重试计数，设置下次重试时间（指数退避），记录 failed 日志
 * - 不再放弃任何操作（无上限重试）
 */
export async function flushSyncQueue(): Promise<void> {
  if (isFlushing) return
  isFlushing = true

  try {
    const entries = await getAllFromIdbQueue()
    if (entries.length === 0) return

    console.log(`[SyncQueue] Flushing ${entries.length} entries`)
    const now = Date.now()

    for (const entry of entries) {
      // Phase 4: 检查下次重试时间（指数退避）
      if (entry.nextRetryAt && entry.nextRetryAt > now) {
        continue  // 还没到重试时间，跳过
      }

      try {
        await executeSyncOp(entry)
        await removeFromIdbQueue(entry.id)
        // 从失败集合中移除（如果之前标记为失败）
        syncQueueFailedEntries.delete(entry.id)
        console.log(`[SyncQueue] Synced: ${entry.operation} ${entry.entityType}/${entry.entityId}`)
        // 记录 success 日志
        await appendSyncLog({
          timestamp: now,
          op: entry,
          status: 'success',
        })
        // S3 缺口 B：服务器 sync_logs 双写 success（flushSyncQueue 在异步 flush 任务中，可以 await 不阻塞主流程）
        await upsertSyncLogToServer(entry, 'success')
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        console.warn(`[SyncQueue] Failed to sync ${entry.id} (retry ${entry.retryCount + 1}):`, err)
        entry.retryCount++
        // Phase 4: 设置下次重试时间（指数退避）
        entry.nextRetryAt = now + getRetryDelay(entry.retryCount)
        await updateInIdbQueue(entry)
        // 记录 failed 日志
        await appendSyncLog({
          timestamp: now,
          op: entry,
          status: 'failed',
          error: errorMsg,
        })
        // S3 缺口 B：服务器 sync_logs 双写 failed（flushSyncQueue 在异步 flush 任务中，可以 await 不阻塞主流程）
        await upsertSyncLogToServer(entry, 'failed', errorMsg)
        // Phase 4: 超过阈值标记为 failed，触发 UI 提示
        if (entry.retryCount >= FAILED_THRESHOLD) {
          syncQueueFailedEntries.add(entry.id)
        }
      }
    }

    // Phase 4: 定期轮转日志文件
    await rotateSyncLog()
  } finally {
    isFlushing = false
  }
}

/**
 * 获取 syncQueue 长度
 */
export async function getSyncQueueSize(): Promise<number> {
  const entries = await getAllFromIdbQueue()
  return entries.length
}

/**
 * Phase 4: 获取失败操作数量（供 UI 显示提示）
 */
export function getFailedCount(): number {
  return syncQueueFailedEntries.size
}

// ============================================================================
// S3 缺口 B：服务器端 sync_logs 双写（spec 2.2.5 节）
// ============================================================================

/**
 * 服务器端 sync_logs 双写内部函数
 *
 * 将客户端 syncQueue 的 entry 组装为 ServerSyncLogEntry 并 PUT 到服务器。
 * - enqueueSyncOp 调用时：用 `void promise.catch(...)` 不 await（避免阻塞用户操作）
 * - flushSyncQueue 调用时：可以 await（已在异步 flush 任务中，不阻塞主流程）
 *
 * **M-7 修复**：lastError 应用层截断 1000 字符（与服务端 routes/syncLogs.ts PUT 路由一致）
 *
 * @param entry      客户端 syncQueue entry
 * @param status     pending / success / failed
 * @param lastError  失败时携带错误信息（会被截断到 1000 字符）
 */
async function upsertSyncLogToServer(
  entry: SyncQueueEntry,
  status: SyncLogStatus,
  lastError?: string,
): Promise<void> {
  const now = Date.now()
  const truncatedError = lastError ? String(lastError).slice(0, 1000) : null
  const serverEntry: ServerSyncLogEntry = {
    id: entry.id,
    deviceId: getDeviceId(),
    operation: entry.operation,
    entityType: entry.entityType,
    entityId: entry.entityId,
    payload: entry.payload,
    status,
    retryCount: entry.retryCount,
    lastError: truncatedError,
    createdAt: entry.createdAt,
    updatedAt: now,
    nextRetryAt: entry.nextRetryAt ?? null,
  }
  await upsertSyncLog(serverEntry)
}

// ============================================================================
// M-6 修复：syncQueueFailedEntries Set 的封装函数（spec 2.3.3 节）
// 不直接暴露 Set，避免 useAppStore 等外部模块直接修改模块内 Set 状态
// ============================================================================

export function addFailedEntry(id: string): void {
  syncQueueFailedEntries.add(id)
}

export function removeFailedEntry(id: string): void {
  syncQueueFailedEntries.delete(id)
}

export function clearFailedEntries(): void {
  syncQueueFailedEntries.clear()
}

export function getFailedEntries(): Set<string> {
  return new Set(syncQueueFailedEntries)
}

/**
 * 执行单个同步操作
 * 注意：create 用 POST，update 用 PUT（与 RESTful 约定一致）
 * - panel create: POST /api/panels
 * - panel update: PUT /api/panels/:id
 * - widget create: POST /api/panels/:panelId/widgets（payload 需包含 panelId）
 * - widget update: PUT /api/widgets/:id
 * - entity create: POST /api/entities
 * - entity update: PUT /api/entities/:id
 */
async function executeSyncOp(entry: SyncQueueEntry): Promise<void> {
  const { operation, entityType, entityId, payload } = entry
  const p = payload as Record<string, unknown>

  switch (entityType) {
    case 'panel':
      if (operation === 'create') {
        await api.post('/panels', payload)
      } else if (operation === 'update') {
        await api.put(`/panels/${entityId}`, payload)
      } else if (operation === 'delete') {
        await api.delete(`/panels/${entityId}`)
      }
      break
    case 'widget':
      if (operation === 'create') {
        // widget create 需要 panelId（POST /api/panels/:panelId/widgets）
        const panelId = p.panelId as string
        if (!panelId) throw new Error('[SyncQueue] widget create missing panelId in payload')
        await api.post(`/panels/${panelId}/widgets`, payload)
      } else if (operation === 'update') {
        await api.put(`/widgets/${entityId}`, payload)
      } else if (operation === 'delete') {
        await api.delete(`/widgets/${entityId}`)
      }
      break
    case 'entity':
      if (operation === 'create') {
        await api.post('/entities', payload)
      } else if (operation === 'update') {
        await api.put(`/entities/${entityId}`, payload)
      } else if (operation === 'delete') {
        await api.delete(`/entities/${entityId}`)
      }
      break
    case 'settings':
      if (operation === 'update') {
        await api.put('/settings', payload)
      }
      break
    case 'favorite':
      if (operation === 'create') {
        await favoritesApi.createFavorite({
          id: entityId,
          widgetId: p.widgetId as string,
          panelId: p.panelId as string,
          widgetType: p.widgetType as string,
          displayName: p.displayName as string,
          positionSnapshot: p.positionSnapshot as PositionSnapshot,
          stateSnapshot: p.stateSnapshot as Record<string, unknown>,
        })
      } else if (operation === 'delete') {
        if (entityId === 'batch' && p.panelId) {
          await favoritesApi.deleteFavoritesByPanelId(p.panelId as string)
        } else if (p.id) {
          await favoritesApi.deleteFavorite(p.id as string)
        } else if (p.widgetId) {
          await favoritesApi.deleteFavoriteByWidgetId(p.widgetId as string)
        } else {
          await favoritesApi.deleteFavorite(entityId)
        }
      }
      break
    default:
      console.warn(`[SyncQueue] Unknown entityType: ${entityType}`)
  }
}

// ============================================================================
// IndexedDB 操作（syncQueue 自己的 IDB store）
// ============================================================================

function openSyncDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SYNC_QUEUE_DB, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(SYNC_QUEUE_STORE)) {
        db.createObjectStore(SYNC_QUEUE_STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function addToIdbQueue(entry: SyncQueueEntry): Promise<void> {
  const db = await openSyncDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SYNC_QUEUE_STORE, 'readwrite')
    tx.objectStore(SYNC_QUEUE_STORE).add(entry)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}

async function getAllFromIdbQueue(): Promise<SyncQueueEntry[]> {
  const db = await openSyncDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SYNC_QUEUE_STORE, 'readonly')
    const req = tx.objectStore(SYNC_QUEUE_STORE).getAll()
    req.onsuccess = () => { db.close(); resolve(req.result as SyncQueueEntry[]) }
    req.onerror = () => { db.close(); reject(req.error) }
  })
}

async function removeFromIdbQueue(id: string): Promise<void> {
  const db = await openSyncDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SYNC_QUEUE_STORE, 'readwrite')
    tx.objectStore(SYNC_QUEUE_STORE).delete(id)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}

async function updateInIdbQueue(entry: SyncQueueEntry): Promise<void> {
  const db = await openSyncDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SYNC_QUEUE_STORE, 'readwrite')
    tx.objectStore(SYNC_QUEUE_STORE).put(entry)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}
