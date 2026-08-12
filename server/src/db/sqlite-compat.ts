// ============================================================================
// SQLite runtime compatibility
//
// Node 22.5+ provides the synchronous built-in `node:sqlite` module. Older
// runtimes used by the Electron desktop shell do not, so they fall back to
// better-sqlite3. Keeping the selection here prevents the rest of the server
// from depending on either driver's concrete TypeScript API.
// ============================================================================

import { createRequire } from 'node:module'

export interface SqliteStatement {
  all(...params: unknown[]): unknown[]
  get(...params: unknown[]): unknown
  run(...params: unknown[]): {
    changes: number | bigint
    lastInsertRowid: number | bigint
  }
}

export interface SqliteDatabase {
  prepare(sql: string): SqliteStatement
  exec(sql: string): unknown
  close(): unknown
}

interface NodeSqliteModule {
  DatabaseSync?: new (
    path: string,
    options?: { timeout?: number; readOnly?: boolean },
  ) => unknown
}

type BetterSqliteConstructor = new (
  path: string,
  options?: { timeout?: number; readonly?: boolean },
) => unknown

const require = createRequire(import.meta.url)

let selectedDriver: 'node:sqlite' | 'better-sqlite3' | null = null

function loadNodeSqlite(): NodeSqliteModule | null {
  try {
    const module = require('node:sqlite') as NodeSqliteModule
    return typeof module.DatabaseSync === 'function' ? module : null
  } catch {
    return null
  }
}

/**
 * Open a synchronous SQLite database using the best driver available in the
 * current runtime. `readOnly` is normalized because the two drivers spell the
 * option differently (`readOnly` vs `readonly`).
 */
export function openSqliteDatabase(
  path: string,
  options: { readOnly?: boolean; timeout?: number } = {},
): SqliteDatabase {
  const timeout = options.timeout ?? 5000
  const readOnly = options.readOnly ?? false
  const nodeSqlite = loadNodeSqlite()

  if (nodeSqlite?.DatabaseSync) {
    selectedDriver = 'node:sqlite'
    return new nodeSqlite.DatabaseSync(path, { timeout, readOnly }) as SqliteDatabase
  }

  try {
    const BetterDatabase = require('better-sqlite3') as BetterSqliteConstructor
    selectedDriver = 'better-sqlite3'
    return new BetterDatabase(path, { timeout, readonly: readOnly }) as SqliteDatabase
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(
      `No compatible SQLite driver is available. `
      + `Node 22.5+ provides node:sqlite; older runtimes need a working `
      + `better-sqlite3 binary. Last error: ${detail}`,
    )
  }
}

export function getSqliteDriverName(): string {
  return selectedDriver ?? 'not-opened'
}
