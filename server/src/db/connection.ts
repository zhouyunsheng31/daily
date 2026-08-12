// ============================================================================
// 数据库连接入口（driver 切换）
//
// 根据 process.env.DB_DRIVER 选择 driver：
// - DB_DRIVER=sqlite  → 使用 SQLite（node:sqlite 优先，旧运行时回退 better-sqlite3）
// - DB_DRIVER=postgres（或未设置）→ 使用 PostgreSQL（pg），开发/服务器用
//
// 导出 API 始终一致：getPool / initDb / closeDb / withTransaction / query
// 注意：getPool 保持同步（与原 PG 版本兼容，route 文件用 const pool = getPool()）
// ============================================================================

import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg'
// 静态导入 SQLite driver（仅加载模块，不打开连接；SQLite 模式下才真正使用）
import * as sqliteDriver from './connection-sqlite.js'

const DB_DRIVER = process.env.DB_DRIVER || 'postgres'
const USE_SQLITE = DB_DRIVER === 'sqlite'

// ---------------------------------------------------------------------------
// 测试专用：pool override（Phase S8.1）
//
// 测试可通过 setPoolOverride(mockPool) 注入 mock pool，getPool() 优先返回它。
// setPoolOverride(null) 清除 override，恢复真实 driver 行为。
// 生产代码不应调用 setPoolOverride。
// ---------------------------------------------------------------------------
let poolOverride: Pool | null = null

export function setPoolOverride(pool: Pool | null): void {
  poolOverride = pool
}

// ---------------------------------------------------------------------------
// 公共 API（与原 connection.ts 接口完全一致）
// ---------------------------------------------------------------------------

/**
 * 获取数据库连接池（同步）
 * SQLite 模式返回 pg.Pool 兼容包装对象；PG 模式返回真实 pg.Pool
 * 测试模式下若设置了 poolOverride，优先返回 override
 */
export function getPool(): Pool {
  if (poolOverride) return poolOverride
  if (USE_SQLITE) {
    return sqliteDriver.getPool()
  }
  return getPgPool()
}

/**
 * 初始化数据库连接
 */
export async function initDb(): Promise<Pool> {
  if (USE_SQLITE) {
    return sqliteDriver.initDb()
  }
  return initPgDb()
}

/**
 * 关闭数据库连接
 */
export async function closeDb(): Promise<void> {
  if (USE_SQLITE) {
    return sqliteDriver.closeDb()
  }
  return closePgDb()
}

/**
 * 在事务中执行函数
 * 用法：
 *   await withTransaction(async (client) => {
 *     await client.query('INSERT ...')
 *     await client.query('UPDATE ...')
 *   })
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  if (USE_SQLITE) {
    return sqliteDriver.withTransaction(fn)
  }
  return withPgTransaction(fn)
}

/**
 * 辅助查询函数，直接在 Pool 上执行（非事务）
 */
export async function query<R extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<R>> {
  if (USE_SQLITE) {
    return sqliteDriver.query<R>(text, params)
  }
  return pgQuery<R>(text, params)
}

// ---------------------------------------------------------------------------
// PostgreSQL 模式：原有逻辑（保留可切换）
// ---------------------------------------------------------------------------

function buildConnectionString(): string {
  // 优先使用 DATABASE_URL（Docker 部署用）
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL
  }

  // 本地开发：从分散环境变量构建
  const pgHost = process.env.PGHOST || 'localhost'
  const pgPort = process.env.PGPORT || '5432'
  const pgUser = process.env.PGUSER || 'livingdashboard'
  const pgPassword = process.env.PGPASSWORD || 'livingdashboard'
  const pgDatabase = process.env.PGDATABASE || 'living_dashboard'

  return `postgresql://${pgUser}:${pgPassword}@${pgHost}:${pgPort}/${pgDatabase}`
}

let pool: Pool | null = null

function getPgPool(): Pool {
  if (!pool) {
    throw new Error('Database pool not initialized. Call initDb() first.')
  }
  return pool
}

async function initPgDb(): Promise<Pool> {
  if (pool) return pool

  const connectionString = buildConnectionString()

  pool = new Pool({
    connectionString,
    max: 20,                    // 最大连接数
    idleTimeoutMillis: 30000,   // 空闲连接超时
    connectionTimeoutMillis: 5000, // 连接超时
  })

  // 测试连接
  const client = await pool.connect()
  try {
    await client.query('SELECT 1')
    console.log('[DB] PostgreSQL connected:', connectionString.replace(/:[^:@]+@/, ':***@'))
  } finally {
    client.release()
  }

  // 错误处理
  pool.on('error', (err) => {
    console.error('[DB] Pool error:', err)
  })

  return pool
}

async function closePgDb(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
    console.log('[DB] PostgreSQL pool closed')
  }
}

/**
 * 在事务中执行函数（PG 模式）
 */
async function withPgTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const p = getPgPool()
  const client = await p.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

/**
 * 辅助查询函数，直接在 Pool 上执行（非事务，PG 模式）
 */
async function pgQuery<R extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<R>> {
  const p = getPgPool()
  return p.query<R>(text, params as unknown[])
}
