import type { PersistedRecord, StorageWriteOutcome } from '../types/v2'

export type TxPromise<T> = Promise<T> & { __txBrand: true }

function brand<T>(p: Promise<T>): TxPromise<T> {
  const branded = p as TxPromise<T>
  branded.__txBrand = true
  return branded
}

export type IdbErrorKind =
  | 'transaction_failed_before_commit'
  | 'programming_error_after_commit'
  | 'version_conflict'
  | 'quota_exceeded'
  | 'constraint'
  | 'not_found'
  | 'condition_mismatch'
  | 'accessor_rejected'
  | 'key_path_invalid'
  | 'unknown'

export class IdbTransactionError extends Error {
  kind: IdbErrorKind
  current?: PersistedRecord<unknown>
  cause?: unknown

  constructor(kind: IdbErrorKind, options?: { current?: PersistedRecord<unknown>; cause?: unknown }) {
    super(`IdbTransactionError: ${kind}`)
    this.name = 'IdbTransactionError'
    this.kind = kind
    if (options?.current !== undefined) this.current = options.current
    if (options?.cause !== undefined) this.cause = options.cause
  }
}

export class VersionConflictError extends Error {
  current?: PersistedRecord<unknown>

  constructor(current?: PersistedRecord<unknown>) {
    super('VersionConflictError')
    this.name = 'VersionConflictError'
    if (current !== undefined) this.current = current
  }
}

export type DeleteCheckedErrorKind = 'not_found' | 'version_mismatch' | 'field_mismatch' | 'accessor_rejected' | 'key_path_invalid'

export class DeleteCheckedError extends Error {
  kind: DeleteCheckedErrorKind

  constructor(kind: DeleteCheckedErrorKind) {
    super(`DeleteCheckedError: ${kind}`)
    this.name = 'DeleteCheckedError'
    this.kind = kind
  }
}

export function getNestedValue(obj: unknown, path: string): { found: boolean; value: unknown } {
  const parts = path.split('.')
  let current: unknown = obj
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return { found: false, value: undefined }
    }
    if (part === '__proto__' || part === 'constructor' || part === 'prototype') {
      return { found: false, value: undefined }
    }
    const desc = Object.getOwnPropertyDescriptor(current, part)
    if (!desc) {
      return { found: false, value: undefined }
    }
    if (desc.get) {
      return { found: false, value: undefined }
    }
    current = (current as Record<string, unknown>)[part]
  }
  return { found: true, value: current }
}

export interface IdbTxContext {
  now(): number
  get<T>(storeName: string, id: string): TxPromise<PersistedRecord<T> | undefined>
  addNew<T>(storeName: string, input: { id: string; data: T }): TxPromise<PersistedRecord<T>>
  putCas<T>(storeName: string, input: { id: string; expectedVersion: number; data: T }): TxPromise<PersistedRecord<T>>
  deleteChecked(
    storeName: string,
    input: {
      id: string
      expectedVersion?: number
      expectedFields?: Record<string, unknown>
      fieldPredicates?: Record<string, { op: 'lte'; value: number }>
    }
  ): TxPromise<void>
  indexGetAll<T>(storeName: string, indexName: string, query: IDBKeyRange | IDBValidKey): TxPromise<PersistedRecord<T>[]>
  iterateIndex<T>(
    storeName: string,
    indexName: string,
    query: IDBKeyRange | IDBValidKey | null,
    visitor: (record: PersistedRecord<T>, cursor: { stop(): void }) => void
  ): TxPromise<void>
  iterateStore<T>(
    storeName: string,
    visitor: (record: PersistedRecord<T>, cursor: { stop(): void }) => void
  ): TxPromise<void>
  countIndex(storeName: string, indexName: string, query: IDBKeyRange | IDBValidKey): TxPromise<number>
}

function wrapRequest<T>(request: IDBRequest<T>): TxPromise<T> {
  return brand(
    new Promise<T>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  )
}

function createIdbTxContext(tx: IDBTransaction, options: { now: () => number }): IdbTxContext {
  const ctx: IdbTxContext = {
    now: options.now,

    get<T>(storeName: string, id: string): TxPromise<PersistedRecord<T> | undefined> {
      const store = tx.objectStore(storeName)
      return wrapRequest<PersistedRecord<T> | undefined>(store.get(id))
    },

    addNew<T>(storeName: string, input: { id: string; data: T }): TxPromise<PersistedRecord<T>> {
      const record: PersistedRecord<T> = {
        id: input.id,
        version: 1,
        updatedAt: ctx.now(),
        data: input.data,
      }
      const store = tx.objectStore(storeName)
      const addReq = store.add(record)
      return brand(
        new Promise<PersistedRecord<T>>((resolve, reject) => {
          addReq.onsuccess = () => resolve(record)
          addReq.onerror = () => {
            if (addReq.error?.name === 'ConstraintError') {
              reject(new IdbTransactionError('constraint', { cause: addReq.error }))
            } else if (addReq.error?.name === 'QuotaExceededError') {
              reject(new IdbTransactionError('quota_exceeded', { cause: addReq.error }))
            } else {
              reject(addReq.error)
            }
          }
        })
      )
    },

    putCas<T>(storeName: string, input: { id: string; expectedVersion: number; data: T }): TxPromise<PersistedRecord<T>> {
      const store = tx.objectStore(storeName)
      return brand(
        ctx
          .get<T>(storeName, input.id)
          .then((existing) => {
            if (!existing) {
              throw new IdbTransactionError('not_found')
            }
            if (existing.version !== input.expectedVersion) {
              throw new VersionConflictError(existing)
            }
            const updated: PersistedRecord<T> = {
              id: input.id,
              version: existing.version + 1,
              updatedAt: ctx.now(),
              data: input.data,
            }
            const putReq = store.put(updated)
            return new Promise<PersistedRecord<T>>((resolve, reject) => {
              putReq.onsuccess = () => resolve(updated)
              putReq.onerror = () => {
                if (putReq.error?.name === 'QuotaExceededError') {
                  reject(new IdbTransactionError('quota_exceeded', { cause: putReq.error }))
                } else {
                  reject(putReq.error)
                }
              }
            })
          })
      )
    },

    deleteChecked(
      storeName: string,
      input: {
        id: string
        expectedVersion?: number
        expectedFields?: Record<string, unknown>
        fieldPredicates?: Record<string, { op: 'lte'; value: number }>
      }
    ): TxPromise<void> {
      return brand(
        ctx
          .get<unknown>(storeName, input.id)
          .then((existing) => {
            if (!existing) {
              throw new DeleteCheckedError('not_found')
            }
            if (input.expectedVersion !== undefined && existing.version !== input.expectedVersion) {
              throw new DeleteCheckedError('version_mismatch')
            }
            if (input.expectedFields) {
              for (const [path, expectedValue] of Object.entries(input.expectedFields)) {
                if (path === '') {
                  throw new DeleteCheckedError('key_path_invalid')
                }
                if (path.split('.').some((s) => s === '')) {
                  throw new DeleteCheckedError('key_path_invalid')
                }
                const { found, value } = getNestedValue(existing, path)
                if (!found) {
                  throw new DeleteCheckedError('field_mismatch')
                }
                if (value !== expectedValue) {
                  throw new DeleteCheckedError('field_mismatch')
                }
              }
            }
            if (input.fieldPredicates) {
              for (const [path, predicate] of Object.entries(input.fieldPredicates)) {
                if (path === '') {
                  throw new DeleteCheckedError('key_path_invalid')
                }
                if (path.split('.').some((s) => s === '')) {
                  throw new DeleteCheckedError('key_path_invalid')
                }
                const { found, value } = getNestedValue(existing, path)
                if (!found) {
                  throw new DeleteCheckedError('field_mismatch')
                }
                if (predicate.op === 'lte') {
                  if (typeof value !== 'number' || value > predicate.value) {
                    throw new DeleteCheckedError('field_mismatch')
                  }
                }
              }
            }
            const store = tx.objectStore(storeName)
            const deleteReq = store.delete(input.id)
            return new Promise<void>((resolve, reject) => {
              deleteReq.onsuccess = () => resolve()
              deleteReq.onerror = () => reject(deleteReq.error)
            })
          })
      )
    },

    indexGetAll<T>(storeName: string, indexName: string, query: IDBKeyRange | IDBValidKey): TxPromise<PersistedRecord<T>[]> {
      const store = tx.objectStore(storeName)
      const index = store.index(indexName)
      return wrapRequest<PersistedRecord<T>[]>(index.getAll(query))
    },

    iterateIndex<T>(
      storeName: string,
      indexName: string,
      query: IDBKeyRange | IDBValidKey | null,
      visitor: (record: PersistedRecord<T>, cursor: { stop(): void }) => void
    ): TxPromise<void> {
      const store = tx.objectStore(storeName)
      const index = store.index(indexName)
      return brand(
        new Promise<void>((resolve, reject) => {
          let stopped = false
          const cursorCtrl = { stop() { stopped = true } }
          const req = index.openCursor(query ?? undefined)
          req.onsuccess = () => {
            if (stopped) {
              resolve()
              return
            }
            const cursor = req.result
            if (!cursor) {
              resolve()
              return
            }
            visitor(cursor.value as PersistedRecord<T>, cursorCtrl)
            if (stopped) {
              resolve()
              return
            }
            cursor.continue()
          }
          req.onerror = () => reject(req.error)
        })
      )
    },

    iterateStore<T>(
      storeName: string,
      visitor: (record: PersistedRecord<T>, cursor: { stop(): void }) => void
    ): TxPromise<void> {
      const store = tx.objectStore(storeName)
      return brand(
        new Promise<void>((resolve, reject) => {
          let stopped = false
          const cursorCtrl = { stop() { stopped = true } }
          const req = store.openCursor()
          req.onsuccess = () => {
            if (stopped) {
              resolve()
              return
            }
            const cursor = req.result
            if (!cursor) {
              resolve()
              return
            }
            visitor(cursor.value as PersistedRecord<T>, cursorCtrl)
            if (stopped) {
              resolve()
              return
            }
            cursor.continue()
          }
          req.onerror = () => reject(req.error)
        })
      )
    },

    countIndex(storeName: string, indexName: string, query: IDBKeyRange | IDBValidKey): TxPromise<number> {
      const store = tx.objectStore(storeName)
      const index = store.index(indexName)
      return wrapRequest<number>(index.count(query))
    },
  }

  return ctx
}

let _dbInstance: IDBDatabase | null = null

export async function getDbInstance(): Promise<IDBDatabase> {
  if (!_dbInstance) {
    throw new Error('IDB database instance not initialized. Call setDbInstance first.')
  }
  return _dbInstance
}

export function setDbInstance(db: IDBDatabase): void {
  _dbInstance = db
}

export type IdbRunContext = 'ai' | 'user' | 'system'

export async function runIdbTransaction<T>(
  storeNames: string[],
  mode: IDBTransactionMode,
  fn: (ctx: IdbTxContext) => Promise<T>
): Promise<T> {
  const db = await getDbInstance()
  const tx = db.transaction(storeNames, mode)
  let fnResolved = false
  let txAborted = false
  let errorCaptured: unknown = null
  const fixedTime = Date.now()
  const rawCtx = createIdbTxContext(tx, { now: () => fixedTime })

  // Phase 1 completion: aiAuditLog store restored with by_sessionId and by_createdAt indexes
  const ctx: IdbTxContext = rawCtx

  return new Promise<T>((resolve, reject) => {
    tx.oncomplete = () => {
      if (!fnResolved) {
        reject(new IdbTransactionError('programming_error_after_commit'))
      }
    }

    tx.onabort = () => {
      txAborted = true
      const err = errorCaptured || tx.error || new IdbTransactionError('transaction_failed_before_commit')
      reject(err instanceof IdbTransactionError ? err : classifyToIdbTransactionError(err, 'create'))
    }

    tx.onerror = () => {
      const err = tx.error || new IdbTransactionError('unknown')
      reject(err instanceof IdbTransactionError ? err : classifyToIdbTransactionError(err, 'create'))
    }

    fn(ctx)
      .then((result) => {
        fnResolved = true
        tx.oncomplete = () => {
          resolve(result)
        }
      })
      .catch((err) => {
        errorCaptured = err
        if (!txAborted) {
          try {
            tx.abort()
          } catch {
            // tx may already be inactive
          }
        }
        if (err instanceof IdbTransactionError) {
          reject(err)
        } else if (err instanceof VersionConflictError) {
          reject(
            new IdbTransactionError('version_conflict', {
              current: err.current,
              cause: err,
            })
          )
        } else if (err instanceof DeleteCheckedError) {
          reject(deleteCheckedToIdbError(err))
        } else {
          reject(classifyToIdbTransactionError(err, 'create'))
        }
      })
  })
}

function deleteCheckedToIdbError(err: DeleteCheckedError): IdbTransactionError {
  switch (err.kind) {
    case 'not_found':
      return new IdbTransactionError('not_found', { cause: err })
    case 'version_mismatch':
      return new IdbTransactionError('condition_mismatch', { cause: err })
    case 'field_mismatch':
      return new IdbTransactionError('condition_mismatch', { cause: err })
    case 'accessor_rejected':
      return new IdbTransactionError('accessor_rejected', { cause: err })
    case 'key_path_invalid':
      return new IdbTransactionError('key_path_invalid', { cause: err })
  }
}

export type IdbOperationContext = 'create' | 'cas_update' | 'delete' | 'import_commit' | 'staging_update' | 'quota_probe'

export function classifyToIdbTransactionError(error: unknown, context: IdbOperationContext): IdbTransactionError {
  if (error instanceof IdbTransactionError) {
    return error
  }
  if (error instanceof VersionConflictError) {
    return new IdbTransactionError('version_conflict', {
      current: error.current,
      cause: error,
    })
  }
  if (error instanceof DeleteCheckedError) {
    return deleteCheckedToIdbError(error)
  }
  if (error instanceof DOMException) {
    if (error.name === 'QuotaExceededError') {
      return new IdbTransactionError('quota_exceeded', { cause: error })
    }
    if (error.name === 'ConstraintError') {
      if (context === 'create') {
        return new IdbTransactionError('constraint', { cause: error })
      }
      return new IdbTransactionError('unknown', { cause: error })
    }
    if (error.name === 'TransactionInactiveError') {
      return new IdbTransactionError('transaction_failed_before_commit', { cause: error })
    }
    if (error.name === 'ReadOnlyError') {
      return new IdbTransactionError('transaction_failed_before_commit', { cause: error })
    }
    if (error.name === 'NotFoundError') {
      return new IdbTransactionError('not_found', { cause: error })
    }
    if (error.name === 'DataError') {
      return new IdbTransactionError('unknown', { cause: error })
    }
    if (error.name === 'InvalidStateError') {
      return new IdbTransactionError('transaction_failed_before_commit', { cause: error })
    }
    if (error.name === 'AbortError') {
      return new IdbTransactionError('transaction_failed_before_commit', { cause: error })
    }
    return new IdbTransactionError('unknown', { cause: error })
  }
  if (error instanceof Error && error.name === 'QuotaExceededError') {
    return new IdbTransactionError('quota_exceeded', { cause: error })
  }
  return new IdbTransactionError('unknown', { cause: error })
}

export function toStorageWriteOutcome(error: unknown): StorageWriteOutcome {
  if (error instanceof IdbTransactionError) {
    switch (error.kind) {
      case 'version_conflict':
        return { ok: false, kind: 'version_conflict', current: error.current }
      case 'quota_exceeded':
        return { ok: false, kind: 'quota_exceeded' }
      case 'constraint':
        return { ok: false, kind: 'constraint' }
      case 'not_found':
        return { ok: false, kind: 'not_found' }
      case 'condition_mismatch':
        return { ok: false, kind: 'condition_mismatch' }
      case 'accessor_rejected':
        return { ok: false, kind: 'condition_mismatch' }
      case 'key_path_invalid':
        return { ok: false, kind: 'condition_mismatch' }
      case 'transaction_failed_before_commit':
        return { ok: false, kind: 'retryable_abort' }
      case 'programming_error_after_commit':
        return { ok: false, kind: 'programming_error_after_commit' }
      case 'unknown':
        return { ok: false, kind: 'retryable_abort' }
    }
  }
  return { ok: false, kind: 'retryable_abort' }
}
