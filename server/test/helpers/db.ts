/**
 * 测试 DB helper：基于 SQLite 临时文件
 *
 * 设计：每个测试 DB 独立文件，通过 closeDb()+initDb() 重置 SQLite 单例，
 * 让 connection-sqlite.ts 基于新的 SQLITE_PATH 创建新连接。
 */
import type { Pool } from 'pg'
import { closeDb, getPool, initDb, setPoolOverride } from '../../src/db/connection.js'
import { initializeSchema } from '../../src/db/schema.js'
import { seedBuiltinTemplates } from '../../src/db/seed.js'

let poolCounter = 0
const baseSqliteDir = process.env.SQLITE_PATH ? process.env.SQLITE_PATH.replace(/\.[0-9]+\.[0-9]+\.db.*$/, '') : '/tmp/test.db'

export async function createTestDb(): Promise<{ pool: Pool; cleanup: () => Promise<void> }> {
  // 每个测试 DB 独立文件，避免污染
  const dbPath = `${baseSqliteDir}.${process.pid}.${++poolCounter}.db`
  process.env.SQLITE_PATH = dbPath

  // 清除可能的 pool override，并关闭旧 pool（强制 initDb 创建新连接）
  setPoolOverride(null)
  await closeDb()
  await initDb()
  const pool = getPool()
  await initializeSchema()
  await seedBuiltinTemplates()

  return {
    pool,
    cleanup: async () => {
      try {
        await closeDb()
      } catch {
        // ignore
      }
    },
  }
}

export async function clearAllTables(pool: Pool): Promise<void> {
  // Phase S8.1：表名严格对齐 src/db/schema.ts 中的 CREATE TABLE 语句。
  // 删除顺序按 FK 依赖（子表先于父表），避免外键约束失败。
  // 注：sync_queue 为 Phase S0 死代码（schema.ts 行 127 标记 DEPRECATED），但表仍存在，需清理。
  // 注：scopes/relations 不是表名（实体类型在 entities 表中按 type 区分），bookmarks/favorites/search_keys 均非真实表名。
  const tables = [
    // 子表（有外键引用父表）
    'widgets',              // FK panels(id) ON DELETE CASCADE
    'entity_relations',     // FK entities(id) ON DELETE CASCADE
    'panel_memory_states',  // FK panels(id) ON DELETE CASCADE
    'favorited_widgets',    // 无 FK 但语义上是 panels/widgets 的子数据
    'entity_conflict_logs', // 无 FK，但逻辑上属于 entities
    'sync_logs',            // 无 FK
    'sync_queue',           // DEPRECATED 但表仍存在
    // 父表
    'entities',
    'panels',
    // 独立表（无外键）
    'settings',
    'dynamic_widgets',
    'panel_templates',
    'activity_sessions',
    'schema_version',
    'ai_conversations',
    'ai_memories',
    'ai_settings',
    'user_skills',
    'tool_settings',
    'skill_settings',
    'local_service_registry',
    'api_usage_log',
    'component_capabilities',
  ]
  for (const t of tables) {
    try {
      await pool.query(`DELETE FROM ${t}`)
    } catch (err) {
      // Phase S8.1：DEBUG 模式下打印 warn，便于发现表名拼写错误
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[clearAllTables] DELETE FROM ${t} failed: ${msg}`)
    }
  }
}
