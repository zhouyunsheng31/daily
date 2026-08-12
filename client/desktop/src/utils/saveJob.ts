import type { PersistedRecord, StorageWriteOutcome, DeletableEntityData } from '../types/v2'
import { runIdbTransaction, toStorageWriteOutcome, IdbTransactionError } from './idbTx'
import { V2_STORE_NAMES } from './dbV2'

const DELETABLE_STORES = new Set([
  'widgetRecords',
  'tasks',
  'calendarEvents',
  'moodEntries',
])

export async function casWrite<T>(
  storeName: string,
  id: string,
  expectedVersion: number,
  newData: T
): Promise<StorageWriteOutcome> {
  try {
    await runIdbTransaction([storeName], 'readwrite', async (ctx) => {
      const current = await ctx.get<T>(storeName, id)
      if (!current) {
        throw new IdbTransactionError('not_found')
      }
      if (current.version !== expectedVersion) {
        throw new IdbTransactionError('version_conflict', { current })
      }
      await ctx.putCas(storeName, { id, expectedVersion, data: newData })
    })
    return { ok: true } as StorageWriteOutcome & { ok: true }
  } catch (err) {
    return toStorageWriteOutcome(err)
  }
}

export type SaveJobKind =
  | 'panel'
  | 'widget_record'
  | 'widget_state'
  | 'task'
  | 'calendar_event'
  | 'focus_session'
  | 'habit'
  | 'habit_checkin'
  | 'mood_entry'
  | 'batch'

export interface SaveJob {
  id: string
  kind: SaveJobKind
  storeName: string
  recordId: string
  expectedVersion: number
  data: unknown
  createdAt: number
  retryCount: number
  maxRetries: number
}

export interface BatchSaveJob extends SaveJob {
  kind: 'batch'
  operations: Array<{
    storeName: string
    recordId: string
    expectedVersion: number
    data: unknown
  }>
}

export type SaveJobFailKind =
  | 'quota_exceeded'
  | 'version_conflict'
  | 'condition_mismatch'
  | 'not_found'
  | 'constraint'
  | 'retryable_abort'
  | 'readonly_required'
  | 'programming_error_after_commit'

export type SaveJobResult =
  | { ok: true; newVersion: number }
  | { ok: false; kind: SaveJobFailKind; current?: PersistedRecord<unknown> }

let _jobCounter = 0

function nextJobId(): string {
  return `sj_${Date.now()}_${++_jobCounter}`
}

export class SaveJobQueue {
  private queue: SaveJob[] = []
  private processing = false
  private listeners: Set<(jobId: string, result: SaveJobResult) => void> = new Set()

  enqueue(job: Omit<SaveJob, 'id' | 'createdAt' | 'retryCount'>): string {
    const id = nextJobId()
    const fullJob: SaveJob = {
      ...job,
      id,
      createdAt: Date.now(),
      retryCount: 0,
    }
    this.queue.push(fullJob)
    void this.process()
    return id
  }

  enqueueBatch(
    operations: Array<{
      storeName: string
      recordId: string
      expectedVersion: number
      data: unknown
    }>
  ): string {
    const id = nextJobId()
    const batchJob: BatchSaveJob = {
      id,
      kind: 'batch',
      storeName: '',
      recordId: '',
      expectedVersion: 0,
      data: null,
      createdAt: Date.now(),
      retryCount: 0,
      maxRetries: 3,
      operations,
    }
    this.queue.push(batchJob)
    void this.process()
    return id
  }

  async process(): Promise<void> {
    if (this.processing) return
    this.processing = true
    try {
      while (this.queue.length > 0) {
        const job = this.queue.shift()!
        let result: SaveJobResult

        if (job.kind === 'batch') {
          result = await this.processBatch(job as BatchSaveJob)
        } else {
          result = await this.processOne(job)
        }

        if (!result.ok) {
          if (
            (result.kind === 'version_conflict' || result.kind === 'retryable_abort') &&
            job.retryCount < job.maxRetries
          ) {
            job.retryCount++
            if (result.kind === 'version_conflict' && result.current) {
              job.expectedVersion = result.current.version
              job.data =
                typeof job.data === 'object' && job.data !== null && typeof result.current.data === 'object' && result.current.data !== null
                  ? { ...(result.current.data as Record<string, unknown>), ...(job.data as Record<string, unknown>) }
                  : job.data
            }
            if (result.kind === 'retryable_abort') {
              await backoffDelay(job.retryCount)
            }
            this.queue.unshift(job)
            continue
          }
        }

        this.emitResult(job.id, result)
      }
    } finally {
      this.processing = false
    }
  }

  private async processOne(job: SaveJob): Promise<SaveJobResult> {
    try {
      const newVersion = await runIdbTransaction([job.storeName], 'readwrite', async (ctx) => {
        const current = await ctx.get(job.storeName, job.recordId)
        if (!current) {
          throw new IdbTransactionError('not_found')
        }
        if (current.version !== job.expectedVersion) {
          throw new IdbTransactionError('version_conflict', { current })
        }
        const updated = await ctx.putCas(job.storeName, {
          id: job.recordId,
          expectedVersion: job.expectedVersion,
          data: job.data,
        })
        return updated.version
      })
      return { ok: true, newVersion }
    } catch (err) {
      const outcome = toStorageWriteOutcome(err)
      if (outcome.ok) {
        return { ok: false, kind: 'retryable_abort' as SaveJobFailKind }
      }
      return {
        ok: false,
        kind: outcome.kind as SaveJobFailKind,
        current: outcome.kind === 'version_conflict' ? (outcome as { ok: false; kind: 'version_conflict'; current?: PersistedRecord<unknown> }).current : undefined,
      }
    }
  }

  private async processBatch(job: BatchSaveJob): Promise<SaveJobResult> {
    const storeNames = [...new Set(job.operations.map((op) => op.storeName))]
    try {
      const newVersion = await runIdbTransaction(storeNames, 'readwrite', async (ctx) => {
        let maxVersion = 0
        for (const op of job.operations) {
          const current = await ctx.get(op.storeName, op.recordId)
          if (!current) {
            throw new IdbTransactionError('not_found')
          }
          if (current.version !== op.expectedVersion) {
            throw new IdbTransactionError('version_conflict', { current })
          }
          const updated = await ctx.putCas(op.storeName, {
            id: op.recordId,
            expectedVersion: op.expectedVersion,
            data: op.data,
          })
          if (updated.version > maxVersion) maxVersion = updated.version
        }
        return maxVersion
      })
      return { ok: true, newVersion }
    } catch (err) {
      const outcome = toStorageWriteOutcome(err)
      if (outcome.ok) {
        return { ok: false, kind: 'retryable_abort' as SaveJobFailKind }
      }
      return {
        ok: false,
        kind: outcome.kind as SaveJobFailKind,
        current: outcome.kind === 'version_conflict' ? (outcome as { ok: false; kind: 'version_conflict'; current?: PersistedRecord<unknown> }).current : undefined,
      }
    }
  }

  onResult(listener: (jobId: string, result: SaveJobResult) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  get pending(): ReadonlyArray<SaveJob> {
    return this.queue
  }

  get isProcessing(): boolean {
    return this.processing
  }

  private emitResult(jobId: string, result: SaveJobResult): void {
    for (const listener of this.listeners) {
      try {
        listener(jobId, result)
      } catch {
        // listener errors are swallowed
      }
    }
  }
}

function backoffDelay(retryCount: number): Promise<void> {
  const ms = Math.min(100 * Math.pow(2, retryCount - 1), 5000)
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function softDelete(
  storeName: string,
  recordId: string,
  expectedVersion: number,
  deleteToken: string,
  expiresDelayMs: number = 30000
): Promise<StorageWriteOutcome> {
  try {
    await runIdbTransaction([storeName], 'readwrite', async (ctx) => {
      const current = await ctx.get<DeletableEntityData>(storeName, recordId)
      if (!current) {
        throw new IdbTransactionError('not_found')
      }
      if (current.version !== expectedVersion) {
        throw new IdbTransactionError('version_conflict', { current })
      }
      const patched: DeletableEntityData = {
        ...current.data,
        recordStatus: 'pending_delete',
        deleteToken,
        deleteExpiresAt: Date.now() + expiresDelayMs,
      }
      await ctx.putCas(storeName, {
        id: recordId,
        expectedVersion,
        data: patched,
      })
    })
    return { ok: true } as StorageWriteOutcome & { ok: true }
  } catch (err) {
    return toStorageWriteOutcome(err)
  }
}

export async function undoSoftDelete(
  storeName: string,
  recordId: string,
  deleteToken: string
): Promise<StorageWriteOutcome> {
  try {
    await runIdbTransaction([storeName], 'readwrite', async (ctx) => {
      const current = await ctx.get<DeletableEntityData>(storeName, recordId)
      if (!current) {
        throw new IdbTransactionError('not_found')
      }
      if (current.data.recordStatus !== 'pending_delete') {
        throw new IdbTransactionError('condition_mismatch')
      }
      if (current.data.deleteToken !== deleteToken) {
        throw new IdbTransactionError('condition_mismatch')
      }
      const patched: DeletableEntityData = {
        ...current.data,
        recordStatus: 'active',
        deleteToken: undefined,
        deleteExpiresAt: undefined,
      }
      await ctx.putCas(storeName, {
        id: recordId,
        expectedVersion: current.version,
        data: patched,
      })
    })
    return { ok: true } as StorageWriteOutcome & { ok: true }
  } catch (err) {
    return toStorageWriteOutcome(err)
  }
}

export async function hardDeleteExpired(): Promise<number> {
  let count = 0
  const now = Date.now()
  for (const storeName of V2_STORE_NAMES) {
    if (!DELETABLE_STORES.has(storeName)) continue
    try {
      await runIdbTransaction([storeName], 'readwrite', async (ctx) => {
        const ids: string[] = []
        await ctx.iterateStore<DeletableEntityData>(storeName, (record) => {
          if (
            record.data.recordStatus === 'pending_delete' &&
            record.data.deleteExpiresAt !== undefined &&
            record.data.deleteExpiresAt < now
          ) {
            ids.push(record.id)
          }
        })
        for (const id of ids) {
          await ctx.deleteChecked(storeName, { id })
          count++
        }
      })
    } catch {
      // continue to next store on error
    }
  }
  return count
}

export function startDeleteReaper(intervalMs: number = 60000): () => void {
  const handle = setInterval(() => {
    void hardDeleteExpired().catch(() => {
      // reaper errors are swallowed
    })
  }, intervalMs)
  return () => clearInterval(handle)
}

export type ResourceSaveState =
  | { kind: 'clean' }
  | { kind: 'dirty'; dirtySince: number }
  | { kind: 'saving'; jobId: string; dirtySince: number }
  | { kind: 'save_failed'; error: string; retryable: boolean; dirtySince: number }
  | { kind: 'version_conflict'; current?: PersistedRecord<unknown>; dirtySince: number }

export class ResourceSaveTracker {
  private states: Map<string, ResourceSaveState> = new Map()
  private listeners: Set<(resourceId: string, state: ResourceSaveState) => void> = new Set()

  markDirty(resourceId: string): void {
    const prev = this.states.get(resourceId)
    const dirtySince = prev && 'dirtySince' in prev ? prev.dirtySince : Date.now()
    this.states.set(resourceId, { kind: 'dirty', dirtySince })
    this.emitChange(resourceId)
  }

  markSaving(resourceId: string, jobId: string): void {
    const prev = this.states.get(resourceId)
    const dirtySince = prev && 'dirtySince' in prev ? prev.dirtySince : Date.now()
    this.states.set(resourceId, { kind: 'saving', jobId, dirtySince })
    this.emitChange(resourceId)
  }

  markSaved(resourceId: string): void {
    this.states.set(resourceId, { kind: 'clean' })
    this.emitChange(resourceId)
  }

  markFailed(resourceId: string, error: string, retryable: boolean): void {
    const prev = this.states.get(resourceId)
    const dirtySince = prev && 'dirtySince' in prev ? prev.dirtySince : Date.now()
    this.states.set(resourceId, { kind: 'save_failed', error, retryable, dirtySince })
    this.emitChange(resourceId)
  }

  markVersionConflict(resourceId: string, current?: PersistedRecord<unknown>): void {
    const prev = this.states.get(resourceId)
    const dirtySince = prev && 'dirtySince' in prev ? prev.dirtySince : Date.now()
    this.states.set(resourceId, { kind: 'version_conflict', current, dirtySince })
    this.emitChange(resourceId)
  }

  getState(resourceId: string): ResourceSaveState {
    return this.states.get(resourceId) ?? { kind: 'clean' }
  }

  onStateChange(listener: (resourceId: string, state: ResourceSaveState) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private emitChange(resourceId: string): void {
    const state = this.states.get(resourceId) ?? { kind: 'clean' }
    for (const listener of this.listeners) {
      try {
        listener(resourceId, state)
      } catch {
        // listener errors are swallowed
      }
    }
  }
}

export const saveJobQueue = new SaveJobQueue()
export const resourceSaveTracker = new ResourceSaveTracker()
export const deleteReaperStop = startDeleteReaper()
