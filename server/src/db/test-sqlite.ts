// ============================================================================
// C1 SQLite 改造：临时测试脚本
// 验证 SQLite 模式下的 driver + schema + seed
//
// 运行方式：
//   cd server && npx tsx src/db/test-sqlite.ts
// ============================================================================

// 必须在导入 connection.ts 之前设置环境变量（ESM 模块加载时读取）
process.env.DB_DRIVER = 'sqlite'
process.env.SQLITE_PATH = process.env.SQLITE_PATH || './test-daily.db'

async function main() {
  console.log('=== C1 SQLite 测试开始 ===')
  console.log('DB_DRIVER:', process.env.DB_DRIVER)
  console.log('SQLITE_PATH:', process.env.SQLITE_PATH)

  // 动态导入（确保 env 已设置）
  const { initDb, closeDb, getPool, query } = await import('./connection.js')
  const { initializeSchema } = await import('./schema.js')
  const { seedBuiltinTemplates } = await import('./seed.js')

  // 1. 初始化 DB
  console.log('\n--- 1. 初始化数据库 ---')
  await initDb()
  console.log('✓ initDb() 成功')

  // 2. 初始化 schema
  console.log('\n--- 2. 初始化 schema ---')
  await initializeSchema()
  console.log('✓ initializeSchema() 成功')

  // 3. 验证 22+ 张表
  console.log('\n--- 3. 验证表创建 ---')
  const tableResult = await query(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  )
  const tables = tableResult.rows.map(r => r.name)
  console.log(`✓ 创建了 ${tables.length} 张表:`)
  tables.forEach(t => console.log(`   - ${t}`))

  // 验证关键表都存在
  const expectedTables = [
    'panels', 'widgets', 'entities', 'entity_relations', 'settings',
    'dynamic_widgets', 'panel_templates', 'activity_sessions', 'schema_version',
    'sync_queue', 'ai_conversations', 'ai_memories', 'ai_settings',
    'user_skills', 'tool_settings', 'skill_settings', 'favorited_widgets',
    'local_service_registry', 'panel_memory_states', 'api_usage_log',
    'component_capabilities', 'entity_conflict_logs', 'sync_logs'
  ]
  const missing = expectedTables.filter(t => !tables.includes(t))
  if (missing.length > 0) {
    console.error(`✗ 缺少表: ${missing.join(', ')}`)
    process.exit(1)
  }
  console.log(`✓ 所有 ${expectedTables.length} 张预期表都存在`)

  // 4. 验证幂等 ALTER（dynamic_widgets 扩展列）
  console.log('\n--- 4. 验证幂等 ALTER（dynamic_widgets 扩展列）---')
  const dwColumns = await query("PRAGMA table_info(dynamic_widgets)")
  const dwColNames = dwColumns.rows.map(r => r.name)
  const expectedDwCols = ['component_env', 'local_services', 'cross_platform', 'desktop_only']
  const missingDwCols = expectedDwCols.filter(c => !dwColNames.includes(c))
  if (missingDwCols.length > 0) {
    console.error(`✗ dynamic_widgets 缺少列: ${missingDwCols.join(', ')}`)
    process.exit(1)
  }
  console.log(`✓ dynamic_widgets 扩展列都存在: ${expectedDwCols.join(', ')}`)

  // 验证 api_usage_log.credits_consumed
  const aulColumns = await query("PRAGMA table_info(api_usage_log)")
  const aulColNames = aulColumns.rows.map(r => r.name)
  if (!aulColNames.includes('credits_consumed')) {
    console.error('✗ api_usage_log 缺少 credits_consumed 列')
    process.exit(1)
  }
  console.log('✓ api_usage_log.credits_consumed 列存在')

  // 验证 entity_conflict_logs.panel_id
  const eclColumns = await query("PRAGMA table_info(entity_conflict_logs)")
  const eclColNames = eclColumns.rows.map(r => r.name)
  if (!eclColNames.includes('panel_id')) {
    console.error('✗ entity_conflict_logs 缺少 panel_id 列')
    process.exit(1)
  }
  console.log('✓ entity_conflict_logs.panel_id 列存在')

  // 5. 测试 seed
  console.log('\n--- 5. 测试 seed 数据 ---')
  await seedBuiltinTemplates()
  const tplResult = await query('SELECT id, name FROM panel_templates ORDER BY id')
  console.log(`✓ seed 插入 ${tplResult.rows.length} 个模板:`)
  tplResult.rows.forEach(r => console.log(`   - ${r.id}: ${r.name}`))

  // 6. 测试 schema_version
  console.log('\n--- 6. 验证 schema_version ---')
  const svResult = await query("SELECT version FROM schema_version WHERE key = 'current'")
  const version = svResult.rows[0]?.version
  console.log(`✓ schema_version: ${version}`)

  // 7. 测试 PG 兼容 SQL 转换
  console.log('\n--- 7. 测试 PG 兼容 SQL 转换 ---')

  // 测试 $N → ? 转换
  const test1 = await query('SELECT $1 as val', ['hello'])
  console.log(`✓ $N → ? 转换: ${test1.rows[0].val}`)

  // 测试 ::jsonb 类型转换剥离
  const pool = getPool()
  await pool.query(
    `INSERT INTO settings (key, value, updated_at) VALUES ('test_jsonb', $1, $2)
     ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = $2`,
    [JSON.stringify({ foo: 'bar' }), Date.now()]
  )
  const test2 = await query("SELECT value FROM settings WHERE key = 'test_jsonb'")
  const val = test2.rows[0].value
  console.log(`✓ JSONB 存取: value = ${JSON.stringify(val)}, type = ${typeof val}`)
  if (typeof val !== 'object' || val === null) {
    console.error(`✗ JSONB 自动解析失败：期望 object，实际 ${typeof val}`)
    process.exit(1)
  }
  if (val.foo !== 'bar') {
    console.error(`✗ JSONB 解析结果错误：期望 {foo: 'bar'}，实际 ${JSON.stringify(val)}`)
    process.exit(1)
  }
  console.log('✓ JSONB 自动解析正确（TEXT → object）')

  // 测试 ANY($N::text[]) 展开
  console.log('\n--- 8. 测试 ANY() 展开 ---')
  // 先插入几条测试数据
  const now = Date.now()
  await pool.query(
    "INSERT INTO tool_settings (tool_name, enabled, updated_at) VALUES ('test_tool_1', 1, $1) ON CONFLICT (tool_name) DO NOTHING",
    [now]
  )
  await pool.query(
    "INSERT INTO tool_settings (tool_name, enabled, updated_at) VALUES ('test_tool_2', 1, $1) ON CONFLICT (tool_name) DO NOTHING",
    [now]
  )
  // 测试 ANY($1::text[])
  const anyResult = await query(
    "SELECT tool_name FROM tool_settings WHERE tool_name = ANY($1::text[]) ORDER BY tool_name",
    [['test_tool_1', 'test_tool_2']]
  )
  console.log(`✓ ANY($1::text[]) 展开: 找到 ${anyResult.rows.length} 条记录`)
  if (anyResult.rows.length !== 2) {
    console.error(`✗ 期望 2 条，实际 ${anyResult.rows.length}`)
    process.exit(1)
  }

  // 测试数组列存取（summary_of）
  console.log('\n--- 9. 测试数组列存取 ---')
  await pool.query(
    `INSERT INTO ai_conversations (panel_id, role, content, retention_level, summary_of, created_at, updated_at)
     VALUES ($1, 'assistant', 'test summary', 'summary', $2, $3, $3)`,
    ['test-panel', [1, 2, 3], now]
  )
  const arrResult = await query(
    "SELECT summary_of FROM ai_conversations WHERE panel_id = 'test-panel' AND retention_level = 'summary'"
  )
  const summaryOf = arrResult.rows[0]?.summary_of
  console.log(`✓ 数组列 summary_of: ${JSON.stringify(summaryOf)}, type = ${Array.isArray(summaryOf) ? 'array' : typeof summaryOf}`)
  if (!Array.isArray(summaryOf) || summaryOf.length !== 3) {
    console.error(`✗ 数组列解析失败：期望 [1,2,3]，实际 ${JSON.stringify(summaryOf)}`)
    process.exit(1)
  }
  console.log('✓ 数组列自动序列化/反序列化正确')

  // 测试事务
  console.log('\n--- 10. 测试事务 ---')
  const { withTransaction } = await import('./connection.js')
  await withTransaction(async (client) => {
    await client.query(
      "INSERT INTO settings (key, value, updated_at) VALUES ('tx_test', $1, $2) ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = $2",
      [JSON.stringify({ tx: 'ok' }), now]
    )
  })
  const txResult = await query("SELECT value FROM settings WHERE key = 'tx_test'")
  if (txResult.rows[0]?.value?.tx !== 'ok') {
    console.error(`✗ 事务测试失败`)
    process.exit(1)
  }
  console.log('✓ 事务提交成功')

  // 测试事务回滚
  try {
    await withTransaction(async (client) => {
      await client.query(
        "INSERT INTO settings (key, value, updated_at) VALUES ('rollback_test', $1, $2)",
        [JSON.stringify({ should: 'not_exist' }), now]
      )
      throw new Error('intentional rollback')
    })
  } catch (e) {
    // expected
  }
  const rbResult = await query("SELECT value FROM settings WHERE key = 'rollback_test'")
  if (rbResult.rows.length > 0) {
    console.error(`✗ 事务回滚失败：rollback_test 记录仍存在`)
    process.exit(1)
  }
  console.log('✓ 事务回滚成功')

  // 11. 关闭
  console.log('\n--- 11. 关闭数据库 ---')
  await closeDb()
  console.log('✓ closeDb() 成功')

  console.log('\n=== 全部测试通过 ===')
}

main().catch(err => {
  console.error('测试失败:', err)
  process.exit(1)
})
