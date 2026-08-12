// ============================================================================
// C1 SQLite 改造：SQLite driver 层（兼容 pg.Pool 接口）
//
// 设计要点：
// 1. 导出与 connection.ts（PG driver）相同的 API：getPool/initDb/closeDb/withTransaction/query
// 2. query(text, params) 内部做 SQL 转换，使 route 文件无需改动：
//    - $1, $2 → ?, ?
//    - ::jsonb / ::BIGINT / ::text[] 等类型转换 → 删除
//    - ANY($N) / ANY($N::text[]) → IN (?, ?, ...) 动态展开
//    - 数组参数 → JSON.stringify（存入 TEXT 列）
//    - 读出的 TEXT 值若为合法 JSON 对象/数组 → 自动 JSON.parse（模拟 PG JSONB 行为）
// 3. withTransaction 用 BEGIN/COMMIT/ROLLBACK
// 4. PRAGMA journal_mode=WAL + synchronous=NORMAL
// ============================================================================

import { openSqliteDatabase, getSqliteDriverName, type SqliteDatabase, type SqliteStatement } from './sqlite-compat.js'
import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg'
import { resolve } from 'node:path'

// ---------------------------------------------------------------------------
// DB 实例管理
// ---------------------------------------------------------------------------

let db: SqliteDatabase | null = null
let poolMock: Pool | null = null

function getDb(): SqliteDatabase {
  if (!db) {
    throw new Error('SQLite database not initialized. Call initDb() first.')
  }
  return db
}

/**
 * 获取底层 SQLite 实例（供 schema-sqlite.ts 做 DDL 操作用）
 * 仅在 SQLite 模式下可用
 */
export function getDbInstance(): SqliteDatabase {
  return getDb()
}

function getSqlitePath(): string {
  return process.env.SQLITE_PATH || resolve(process.cwd(), 'daily.db')
}

// ---------------------------------------------------------------------------
// SQL 转换：$N → ?，剥离类型转换，展开 ANY()
// ---------------------------------------------------------------------------

interface TransformedQuery {
  sql: string
  params: unknown[]
}

/**
 * 将 PG 风格的 SQL 转换为 SQLite 风格
 *
 * 转换规则：
 * 1. 剥离 ::type 类型转换（::jsonb, ::BIGINT, ::text[], ::bigint[], ::int, ::varchar 等）
 * 2. ANY($N) / ANY($N::type[]) → IN (?, ?, ...)，数组参数展开
 * 3. $N → ?（保留 1-indexed 到 0-indexed 的映射；同一 $N 多次引用时重复取值）
 * 4. 数组类型的标量参数（如 summary_of BIGINT[]）→ JSON.stringify
 */
function transformQuery(text: string, params: unknown[] = []): TransformedQuery {
  // 1. 剥离类型转换（::word 或 ::word[]）
  // 注意：必须先剥离，否则 ANY($1::text[]) 中的 ::text[] 会干扰后续解析
  let sql = text.replace(/::[a-zA-Z_][a-zA-Z0-9_]*(\[\])?/g, '')

  // 2. 扫描 SQL，处理 ANY($N) 和 $N
  // 使用单次正则扫描，按出现顺序处理占位符
  // 匹配优先级：
  //   1. = ANY($N)  → 替换为 IN (?, ?, ...)（去掉前导 =）
  //   2. ANY($N)    → 替换为 IN (?, ?, ...)（无前导 =，少见）
  //   3. $N         → 替换为 ?
  const tokenRegex = /=\s*ANY\(\$(\d+)\)|ANY\(\$(\d+)\)|\$(\d+)/g
  const parts: string[] = []
  const newParams: unknown[] = []
  let cursor = 0
  let match: RegExpExecArray | null

  while ((match = tokenRegex.exec(sql)) !== null) {
    parts.push(sql.slice(cursor, match.index))

    if (match[1] !== undefined) {
      // = ANY($N) → IN (?, ?, ...)（去掉前导 =）
      const origIdx = parseInt(match[1], 10) - 1
      const arr = params[origIdx]
      if (Array.isArray(arr)) {
        if (arr.length === 0) {
          parts.push('IN (NULL)')
        } else {
          const placeholders = arr.map(() => '?').join(', ')
          parts.push(`IN (${placeholders})`)
          for (const el of arr) {
            newParams.push(serializeParam(el))
          }
        }
      } else if (arr === null || arr === undefined) {
        parts.push('IN (NULL)')
      } else {
        parts.push('= ?')
        newParams.push(serializeParam(arr))
      }
    } else if (match[2] !== undefined) {
      // ANY($N) 无前导 = → IN (?, ?, ...)
      const origIdx = parseInt(match[2], 10) - 1
      const arr = params[origIdx]
      if (Array.isArray(arr)) {
        if (arr.length === 0) {
          parts.push('IN (NULL)')
        } else {
          const placeholders = arr.map(() => '?').join(', ')
          parts.push(`IN (${placeholders})`)
          for (const el of arr) {
            newParams.push(serializeParam(el))
          }
        }
      } else if (arr === null || arr === undefined) {
        parts.push('IN (NULL)')
      } else {
        parts.push('= ?')
        newParams.push(serializeParam(arr))
      }
    } else if (match[3] !== undefined) {
      // $N → ?（同一 $N 多次引用时重复取值）
      const origIdx = parseInt(match[3], 10) - 1
      const val = params[origIdx]
      if (val === undefined) {
        parts.push('NULL')
      } else {
        parts.push('?')
        newParams.push(serializeParam(val))
      }
    }

    cursor = match.index + match[0].length
  }
  parts.push(sql.slice(cursor))

  return { sql: parts.join(''), params: newParams }
}

/**
 * 序列化单个参数：
 * - 数组 → JSON.stringify（用于 BIGINT[]/TEXT[] 列存为 TEXT）
 * - boolean → 0/1（SQLite 不支持原生 boolean 绑定）
 * - 其他 → 原样返回
 */
function serializeParam(val: unknown): unknown {
  if (Array.isArray(val)) {
    return JSON.stringify(val)
  }
  if (typeof val === 'boolean') {
    return val ? 1 : 0
  }
  return val
}

// ---------------------------------------------------------------------------
// 读出行的 JSON 自动解析（模拟 PG JSONB 行为）
// ---------------------------------------------------------------------------

/**
 * 对 SELECT/RETURNING 返回的行做后处理：
 * - TEXT 值若以 { 或 [ 开头且为合法 JSON → 解析为对象/数组
 * - 仅解析结果为 object/array 的情况（避免把 "123" 解析为 number）
 *
 * 这是为了让 route 文件中 `row.settings || {}` 之类代码在 SQLite 模式下也能工作
 * （PG 的 JSONB 列会自动返回对象，SQLite TEXT 列需手动解析）
 */
function autoParseRows<T extends QueryResultRow>(rows: T[]): T[] {
  const result: T[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') {
      result.push(row)
      continue
    }
    const parsed: QueryResultRow = {}
    for (const key of Object.keys(row)) {
      parsed[key] = tryParseJson(row[key])
    }
    result.push(parsed as T)
  }
  return result
}

function tryParseJson(val: unknown): unknown {
  if (typeof val !== 'string' || val.length === 0) return val
  // 仅尝试解析以 { 或 [ 开头的字符串
  if (val[0] !== '{' && val[0] !== '[') return val
  try {
    const parsed = JSON.parse(val)
    // 仅在解析结果为对象/数组时返回（避免 "123" → 123 之类的不期望转换）
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed
    }
    return val
  } catch {
    return val
  }
}

// ---------------------------------------------------------------------------
// 执行 SQL（内部辅助）
// ---------------------------------------------------------------------------

interface SqliteQueryResult {
  rows: QueryResultRow[]
  rowCount: number
  command: string
}

function isTransactionControl(text: string): boolean {
  const upper = text.trim().toUpperCase()
  return upper === 'BEGIN' || upper === 'COMMIT' || upper === 'ROLLBACK'
    || upper.startsWith('BEGIN ') || upper.startsWith('COMMIT ') || upper.startsWith('ROLLBACK ')
}

function isSelectOrReturning(text: string): boolean {
  const trimmed = text.trim()
  const isSelect = /^\s*(SELECT|WITH|PRAGMA)\b/i.test(trimmed)
  const hasReturning = /\bRETURNING\b/i.test(trimmed)
  return isSelect || hasReturning
}

/**
 * node:sqlite 的 prepare() 对多语句 SQL 可能只准备第一条语句，
 * 不像 better-sqlite3 那样可靠地抛出多语句错误。执行 schema 批量 DDL
 * 前先做一个忽略字符串与注释的分号扫描，确保整批语句交给 exec()。
 */
function hasMultipleStatements(sql: string): boolean {
  let quote: "'" | '"' | '`' | null = null
  let lineComment = false
  let blockComment = false

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]
    const next = sql[i + 1]

    if (lineComment) {
      if (ch === '\\n' || ch === '\\r') lineComment = false
      continue
    }
    if (blockComment) {
      if (ch === '*' && next === '/') {
        blockComment = false
        i++
      }
      continue
    }
    if (quote) {
      if (ch === quote) {
        // SQL escapes a quote by doubling it, e.g. 'it''s'.
        if (next === quote) {
          i++
        } else {
          quote = null
        }
      }
      continue
    }

    if (ch === '-' && next === '-') {
      lineComment = true
      i++
      continue
    }
    if (ch === '/' && next === '*') {
      blockComment = true
      i++
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch
      continue
    }
    if (ch === ';') {
      // A semicolon followed only by whitespace/comments terminates the
      // current statement; anything else means another statement follows.
      for (let j = i + 1; j < sql.length; j++) {
        const rest = sql[j]
        const restNext = sql[j + 1]
        if (/\s/.test(rest)) continue
        if (rest === '-' && restNext === '-') {
          const newline = sql.indexOf('\\n', j + 2)
          if (newline === -1) return false
          j = newline
          continue
        }
        if (rest === '/' && restNext === '*') {
          const end = sql.indexOf('*/', j + 2)
          if (end === -1) return false
          j = end + 1
          continue
        }
        return true
      }
    }
  }
  return false
}

/**
 * 在指定 Database 上执行 SQL（pg 兼容接口）
 */
function executeOn(dbInstance: SqliteDatabase, text: string, params: unknown[] = []): SqliteQueryResult {
  // 事务控制语句用 exec
  if (isTransactionControl(text)) {
    dbInstance.exec(text)
    return { rows: [], rowCount: 0, command: text.trim().toUpperCase().split(/\s+/)[0] }
  }

  const { sql, params: transformedParams } = transformQuery(text, params)

  // node:sqlite 的 prepare() 在多语句 SQL 上可能只准备第一条语句。
  // 批量 schema DDL 没有绑定参数，直接使用 exec() 执行完整脚本。
  if (transformedParams.length === 0 && hasMultipleStatements(sql)) {
    dbInstance.exec(sql)
    return { rows: [], rowCount: 0, command: 'EXEC' }
  }

  // 尝试用 prepare（单语句）；若为多语句（如批量 DDL），回退到 exec
  let stmt: SqliteStatement
  try {
    stmt = dbInstance.prepare(sql)
  } catch (err) {
    if (err instanceof Error && err.message.includes('more than one statement')) {
      // 多语句 SQL（如 SCHEMA_SQL 批量 DDL），用 exec 执行
      // 注意：exec 不支持参数绑定，仅适用于无参数的多语句
      if (transformedParams.length > 0) {
        throw new Error('Cannot execute multi-statement SQL with parameters: ' + text.slice(0, 100))
      }
      dbInstance.exec(sql)
      return { rows: [], rowCount: 0, command: 'EXEC' }
    }
    throw err
  }

  const boundParams = transformedParams
  if (isSelectOrReturning(text)) {
    const rows = stmt.all(...boundParams) as QueryResultRow[]
    const parsed = autoParseRows(rows)
    return { rows: parsed, rowCount: parsed.length, command: 'SELECT' }
  } else {
    const info = stmt.run(...boundParams)
    return { rows: [], rowCount: Number(info.changes), command: text.trim().toUpperCase().split(/\s+/)[0] || 'EXEC' }
  }
}

// ---------------------------------------------------------------------------
// pg.Pool 兼容层
// ---------------------------------------------------------------------------

/**
 * 创建一个兼容 pg.Pool 接口的对象
 * - query(text, params): Promise<QueryResult>
 * - connect(): 返回一个 PoolClient 兼容对象（事务内用）
 */
function createPoolLike(dbInstance: SqliteDatabase): Pool {
  const poolLike = {
    async query<R extends QueryResultRow = QueryResultRow>(
      text: string,
      params?: unknown[]
    ): Promise<QueryResult<R>> {
      const result = executeOn(dbInstance, text, params)
      return result as unknown as QueryResult<R>
    },
    async connect(): Promise<PoolClient> {
      // 返回一个 client 兼容对象（事务内用同一个 db 实例）
      // 注意：SQLite 是单连接，connect 只是返回包装器
      return createClientLike(dbInstance)
    },
    on(_event: string, _listener: (...args: unknown[]) => void): void {
      // pg.Pool 的 error 事件，SQLite 不需要（单连接，错误直接抛出）
    },
    async end(): Promise<void> {
      // 由 closeDb 统一处理
    },
  }
  return poolLike as unknown as Pool
}

/**
 * 创建一个 pg.PoolClient 兼容对象（用于 withTransaction）
 * 与 pool.query 共用同一个 db 实例，但所有 query 都在该事务内执行
 */
function createClientLike(dbInstance: SqliteDatabase): PoolClient {
  const client = {
    async query<R extends QueryResultRow = QueryResultRow>(
      text: string,
      params?: unknown[]
    ): Promise<QueryResult<R>> {
      const result = executeOn(dbInstance, text, params)
      return result as unknown as QueryResult<R>
    },
    release(): void {
      // SQLite 单连接，无需 release
    },
  }
  return client as unknown as PoolClient
}

// ---------------------------------------------------------------------------
// 公共 API（与 connection.ts 接口一致）
// ---------------------------------------------------------------------------

export function getPool(): Pool {
  if (!poolMock) {
    throw new Error('Database pool not initialized. Call initDb() first.')
  }
  return poolMock
}

export async function initDb(): Promise<Pool> {
  // [server-boot] 诊断日志（保留便于未来排查启动卡点）
  const t0 = Date.now()
  const logStep = (label: string): void => {
    console.error(`[server-boot] +${Date.now() - t0}ms [sqlite-initDb] ${label}`)
  }

  if (db && poolMock) return poolMock

  logStep('entry')
  const dbPath = getSqlitePath()
  console.log(`[DB] SQLite opening: ${dbPath}`)
  logStep(`path=${dbPath}`)

  logStep('before openSqliteDatabase()')
  db = openSqliteDatabase(dbPath, { timeout: 5000 })
  logStep(`openSqliteDatabase() done (${getSqliteDriverName()})`)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;')
  logStep('pragmas set')

  // 测试连接
  const result = db.prepare('SELECT 1 as ok').get() as { ok: number } | undefined
  if (!result || result.ok !== 1) {
    throw new Error('SQLite connection test failed')
  }
  console.log('[DB] SQLite connected')
  logStep('connection test passed')

  poolMock = createPoolLike(db)
  logStep('poolMock created')
  return poolMock
}

export async function closeDb(): Promise<void> {
  if (db) {
    db.close()
    db = null
    poolMock = null
    console.log('[DB] SQLite closed')
  }
}

/**
 * 在事务中执行函数（兼容 pg 的 withTransaction）
 *
 * 用法：
 *   await withTransaction(async (client) => {
 *     await client.query('INSERT ...')
 *     await client.query('UPDATE ...')
 *   })
 *
 * node:sqlite 与 better-sqlite3 都是同步 API，但 fn 可能是 async，所以用 BEGIN/COMMIT/ROLLBACK 包裹
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const dbInstance = getDb()
  dbInstance.exec('BEGIN')
  try {
    const client = createClientLike(dbInstance)
    const result = await fn(client)
    dbInstance.exec('COMMIT')
    return result
  } catch (err) {
    try {
      dbInstance.exec('ROLLBACK')
    } catch (rollbackErr) {
      console.error('[DB] ROLLBACK failed:', rollbackErr)
    }
    throw err
  }
}

/**
 * 辅助查询函数，直接在 Pool 上执行（非事务）
 */
export async function query<R extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<R>> {
  const p = getPool()
  return p.query<R>(text, params as unknown[])
}
