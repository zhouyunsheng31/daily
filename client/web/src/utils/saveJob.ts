// S11 Web 端 stub：saveJob.ts 完整实现依赖 idbTx/dbV2（资源保存状态追踪 + CAS 写入），
// S11 范围内 Web 端不使用资源保存功能。推迟到 S12.3 数据层打通时改为真实实现。
// 当前仅提供 ResourceSaveState 类型让 v2.ts 的 re-export 编译通过。
//
// S12 新增：导出 saveJobQueue + resourceSaveTracker stub（useAppStore 引用）
// - saveJobQueue.onResult：no-op 回调注册，返回 cleanup 函数
// - saveJobQueue.pending：空 Promise（void 引用）
// - resourceSaveTracker.markSaving/markSaved/markDirty：no-op
// - resourceSaveTracker.onStateChange：no-op 回调注册，返回 cleanup 函数
import type { PersistedRecord } from '../types/v2'

export type ResourceSaveState =
  | { kind: 'clean' }
  | { kind: 'dirty'; dirtySince: number }
  | { kind: 'saving'; jobId: string; dirtySince: number }
  | { kind: 'save_failed'; error: string; retryable: boolean; dirtySince: number }
  | { kind: 'version_conflict'; current?: PersistedRecord<unknown>; dirtySince: number }

// ============================================================================
// S12 stub：saveJobQueue（资源保存队列，S12 no-op）
// ============================================================================

interface SaveJobResult {
  ok: boolean
  error?: string
}

interface SaveJobQueueStub {
  /** 注册任务结果回调（S12 stub: no-op，返回 cleanup 函数） */
  onResult(callback: (jobId: string, result: SaveJobResult) => void): () => void
  /** 当前待处理任务数（S12 stub: 始终 0） */
  readonly pending: number
}

const saveJobQueue: SaveJobQueueStub = {
  onResult: (_callback) => {
    // S12 stub: 无任务派发，cleanup 为 no-op
    return () => { /* no-op */ }
  },
  pending: 0,
}

// ============================================================================
// S12 stub：resourceSaveTracker（资源保存状态追踪，S12 no-op）
// ============================================================================

interface ResourceSaveTrackerStub {
  /** 标记资源正在保存（S12 stub: no-op） */
  markSaving(resourceId: string, jobId: string): void
  /** 标记资源已保存（S12 stub: no-op） */
  markSaved(resourceId: string): void
  /** 标记资源已修改（S12 stub: no-op） */
  markDirty(resourceId: string): void
  /** 订阅资源状态变更（S12 stub: no-op，返回 cleanup 函数） */
  onStateChange(callback: (resourceId: string, state: ResourceSaveState) => void): () => void
}

const resourceSaveTracker: ResourceSaveTrackerStub = {
  markSaving: (_resourceId, _jobId) => { /* S12 stub: no-op */ },
  markSaved: (_resourceId) => { /* S12 stub: no-op */ },
  markDirty: (_resourceId) => { /* S12 stub: no-op */ },
  onStateChange: (_callback) => {
    // S12 stub: 无状态变更，cleanup 为 no-op
    return () => { /* no-op */ }
  },
}

export { saveJobQueue, resourceSaveTracker }
