import { openSqliteDatabase, type SqliteDatabase } from './sqlite-compat.js'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { getPool, withTransaction } from './connection.js'

// 默认 SQLite 路径（跨平台：优先从环境变量获取，回退到项目 data 目录）
const DEFAULT_SQLITE_PATH = resolve(process.cwd(), 'data/daily.db')

interface MigrateOptions {
  sqlitePath?: string
  batchSize?: number
}

interface MigrateReport {
  tables: Record<string, number>
  errors: string[]
  startTime: number
  endTime: number
}

/**
 * 从旧 SQLite 数据库迁移到新 PostgreSQL（Spec 3.4 节）
 *
 * 触发方式：手动执行脚本 `npm run migrate`
 */
export async function migrateFromSqlite(options: MigrateOptions = {}): Promise<MigrateReport> {
  const sqlitePath = options.sqlitePath || process.env.SQLITE_PATH || DEFAULT_SQLITE_PATH
  const batchSize = options.batchSize || 500

  const report: MigrateReport = {
    tables: {},
    errors: [],
    startTime: Date.now(),
    endTime: 0,
  }

  console.log(`[Migrate] Opening SQLite: ${sqlitePath}`)
  const sqliteDb = openSqliteDatabase(sqlitePath, { readOnly: true })
  const pool = getPool()

  try {
    // 1. panels
    await migrateTable({
      name: 'panels',
      sqliteDb,
      pool,
      selectSql: 'SELECT * FROM panels ORDER BY sort_order ASC',
      insertSql: `INSERT INTO panels (id, name, sort_order, settings, canvas_transform, created_at, updated_at)
                  VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING`,
      mapRow: (r: any) => [
        r.id, r.name, r.sort_order,
        r.settings || '{}', r.canvas_transform,
        r.created_at, r.updated_at
      ],
      report,
      batchSize,
    })

    // 2. widgets
    await migrateTable({
      name: 'widgets',
      sqliteDb,
      pool,
      selectSql: 'SELECT * FROM widgets ORDER BY z_index ASC',
      insertSql: `INSERT INTO widgets (id, panel_id, type, x, y, width, height, z_index, minimized, locked, color_scheme, state, is_primary, version, created_at, updated_at)
                  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) ON CONFLICT (id) DO NOTHING`,
      mapRow: (r: any) => [
        r.id, r.panel_id, r.type, r.x, r.y, r.width, r.height, r.z_index,
        !!r.minimized, !!r.locked, r.color_scheme, r.state || '{}',
        !!r.is_primary, r.version || 1, r.created_at, r.updated_at
      ],
      report,
      batchSize,
    })

    // 3. entities
    await migrateTable({
      name: 'entities',
      sqliteDb,
      pool,
      selectSql: 'SELECT * FROM entities ORDER BY created_at DESC',
      insertSql: `INSERT INTO entities (id, type, scope, panel_id, widget_id, data, record_status, version, created_at, updated_at)
                  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (id) DO NOTHING`,
      mapRow: (r: any) => [
        r.id, r.type, r.scope, r.panel_id, r.widget_id,
        r.data || '{}', r.record_status, r.version || 1, r.created_at, r.updated_at
      ],
      report,
      batchSize,
    })

    // 4. entity_relations
    await migrateTable({
      name: 'entity_relations',
      sqliteDb,
      pool,
      selectSql: 'SELECT * FROM entity_relations ORDER BY created_at DESC',
      insertSql: `INSERT INTO entity_relations (id, source_id, target_id, type, metadata, created_at)
                  VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
      mapRow: (r: any) => [r.id, r.source_id, r.target_id, r.type, r.metadata || '{}', r.created_at],
      report,
      batchSize,
    })

    // 5. settings
    await migrateTable({
      name: 'settings',
      sqliteDb,
      pool,
      selectSql: 'SELECT * FROM settings',
      insertSql: `INSERT INTO settings (key, value, updated_at)
                  VALUES ($1, $2, $3) ON CONFLICT (key) DO NOTHING`,
      mapRow: (r: any) => [r.key, r.value || '{}', r.updated_at],
      report,
      batchSize,
    })

    // 6. dynamic_widgets
    await migrateTable({
      name: 'dynamic_widgets',
      sqliteDb,
      pool,
      selectSql: 'SELECT * FROM dynamic_widgets ORDER BY created_at',
      insertSql: `INSERT INTO dynamic_widgets (widget_type, display_name, icon, default_layout, default_state, code, created_at, updated_at)
                  VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (widget_type) DO NOTHING`,
      mapRow: (r: any) => [
        r.widget_type, r.display_name, r.icon,
        r.default_layout || '{}', r.default_state || '{}', r.code,
        r.created_at, r.updated_at
      ],
      report,
      batchSize,
    })

    // 7. panel_templates
    await migrateTable({
      name: 'panel_templates',
      sqliteDb,
      pool,
      selectSql: 'SELECT * FROM panel_templates ORDER BY created_at',
      insertSql: `INSERT INTO panel_templates (id, name, icon, description, widgets, is_builtin, created_at, updated_at)
                  VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING`,
      mapRow: (r: any) => [
        r.id, r.name, r.icon, r.description,
        r.widgets || '[]', !!r.is_builtin, r.created_at, r.updated_at
      ],
      report,
      batchSize,
    })

    // 8. activity_sessions（保留迁移，虽然 Phase 1 已停止写入）
    await migrateTable({
      name: 'activity_sessions',
      sqliteDb,
      pool,
      selectSql: 'SELECT * FROM activity_sessions ORDER BY started_at DESC',
      insertSql: `INSERT INTO activity_sessions (id, started_at, ended_at, duration_ms, process_name, window_title, category, site_name, url, is_browser, created_at)
                  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) ON CONFLICT (id) DO NOTHING`,
      mapRow: (r: any) => [
        r.id, r.started_at, r.ended_at, r.duration_ms,
        r.process_name, r.window_title, r.category,
        r.site_name, r.url, !!r.is_browser, r.created_at
      ],
      report,
      batchSize,
    })

    // 9. schema_version
    await migrateTable({
      name: 'schema_version',
      sqliteDb,
      pool,
      selectSql: 'SELECT * FROM schema_version',
      insertSql: `INSERT INTO schema_version (key, version) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
      mapRow: (r: any) => [r.key || 'current', r.version],
      report,
      batchSize,
    })

  } catch (err) {
    report.errors.push(`Migration failed: ${err instanceof Error ? err.message : String(err)}`)
    console.error('[Migrate] Failed:', err)
  } finally {
    sqliteDb.close()
  }

  report.endTime = Date.now()
  console.log(`[Migrate] Done in ${report.endTime - report.startTime}ms. Report:`, report)
  return report
}

interface MigrateTableParams {
  name: string
  sqliteDb: SqliteDatabase
  pool: ReturnType<typeof getPool>
  selectSql: string
  insertSql: string
  mapRow: (row: any) => unknown[]
  report: MigrateReport
  batchSize: number
}

async function migrateTable(params: MigrateTableParams): Promise<void> {
  const { name, sqliteDb, pool, selectSql, insertSql, mapRow, report, batchSize } = params
  console.log(`[Migrate] Migrating table: ${name}`)

  const rows = sqliteDb.prepare(selectSql).all() as any[]
  let count = 0

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize)
    await withTransaction(async (client) => {
      for (const row of batch) {
        try {
          await client.query(insertSql, mapRow(row))
          count++
        } catch (err) {
          report.errors.push(`[${name}] row ${row.id || row.key || JSON.stringify(row).slice(0, 100)}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    })
  }

  report.tables[name] = count
  console.log(`[Migrate] ${name}: ${count} rows migrated`)
}

// 直接执行入口（npm run migrate）
async function main(): Promise<void> {
  // 初始化 PG 连接池 + schema（迁移前必须先连上 PG 并建表）
  const { initDb } = await import('./connection.js')
  const { initializeSchema } = await import('./schema.js')
  await initDb()
  await initializeSchema()

  const report = await migrateFromSqlite()
  if (report.errors.length > 0) {
    console.error(`[Migrate] Completed with ${report.errors.length} errors`)
    process.exit(1)
  }
  process.exit(0)
}

// ESM 入口守卫：仅当本文件作为直接入口（npm run migrate / tsx src/db/migrateFromSqlite.ts）时执行 main()
// 被 import（如 docker-migrate.bat 的 dynamic import）时不执行，避免双执行竞态
const __filename = fileURLToPath(import.meta.url)
const isMainModule = process.argv[1] !== undefined && resolve(process.argv[1]) === __filename
if (isMainModule) {
  main().catch((err) => {
    console.error('[Migrate] Unhandled error:', err)
    process.exit(1)
  })
}
