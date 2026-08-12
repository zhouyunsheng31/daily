// ============================================================================
// 日志记录测试：通过 githubSearchTool.execute 调用，验证 api_usage_log 记录
// 运行：cd f:\allmylife\event\server && npx tsx test/search-github-log-test.ts
// ============================================================================

import { readFileSync } from 'fs'
import { resolve } from 'path'
import { githubSearchTool } from '../src/utils/searchTools.js'
import { initDb, closeDb, getPool } from '../src/db/connection.js'

// .env 手动加载
try {
  const envPath = resolve(process.cwd(), '.env')
  const envContent = readFileSync(envPath, 'utf-8')
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex > 0) {
      const key = trimmed.substring(0, eqIndex).trim()
      const value = trimmed.substring(eqIndex + 1).trim()
      if (!process.env[key]) process.env[key] = value
    }
  }
  console.log('[Test] .env file loaded')
} catch (e) {
  console.warn('[Test] .env file not loaded:', e instanceof Error ? e.message : String(e))
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

await initDb()

// 记录测试前的日志数量
const pool = getPool()
const beforeResult = await pool.query("SELECT COUNT(*) as cnt FROM api_usage_log WHERE provider='github'")
const beforeCount = parseInt(beforeResult.rows[0].cnt, 10)
console.log('[Test] api_usage_log github count before:', beforeCount)

// 通过 githubSearchTool.execute 调用 search_repos
console.log('\n[Log Test] Calling githubSearchTool.execute for search_repos...')
try {
  const result = await githubSearchTool.execute(
    'test-call-id-1',
    { mode: 'search_repos', query: 'living-dashboard', perPage: 2 } as any,
    undefined as any,
    undefined as any,
    undefined as any,
  )
  const text = result.content?.[0]?.text
  const parsed = text ? JSON.parse(text) : null
  console.log('  result mode:', parsed?.mode, 'items:', parsed?.items?.length, 'total:', parsed?.total)
  console.log('  PASS: githubSearchTool.execute succeeded')
} catch (e) {
  console.log('  FAIL: githubSearchTool.execute threw:', (e as Error).message)
}

await sleep(2500)

// 调用 download_file
console.log('\n[Log Test] Calling githubSearchTool.execute for download_file...')
try {
  const result = await githubSearchTool.execute(
    'test-call-id-2',
    { mode: 'download_file', owner: 'microsoft', repo: 'vscode', path: 'README.md' } as any,
    undefined as any,
    undefined as any,
    undefined as any,
  )
  const text = result.content?.[0]?.text
  const parsed = text ? JSON.parse(text) : null
  console.log('  result mode:', parsed?.mode, 'fileName:', parsed?.download?.fileName, 'size:', parsed?.download?.size)
  console.log('  PASS: githubSearchTool.execute succeeded')
} catch (e) {
  console.log('  FAIL: githubSearchTool.execute threw:', (e as Error).message)
}

await sleep(1000)

// 检查日志是否被记录
const afterResult = await pool.query(
  "SELECT id, endpoint, status, latency_ms, LEFT(error_msg, 50) as err, to_timestamp(created_at/1000) as time FROM api_usage_log WHERE provider='github' AND id > (SELECT COALESCE(MAX(id),0) FROM api_usage_log WHERE provider='github') - 10 ORDER BY id DESC LIMIT 10"
)
console.log('\n[Log Test] api_usage_log recent entries:')
console.table(afterResult.rows)

const afterCount = parseInt((await pool.query("SELECT COUNT(*) as cnt FROM api_usage_log WHERE provider='github'")).rows[0].cnt, 10)
console.log(`\n[Test] api_usage_log github count: before=${beforeCount}, after=${afterCount}, delta=${afterCount - beforeCount}`)

if (afterCount - beforeCount >= 2) {
  console.log('[Test] PASS: api_usage_log recorded tool calls')
} else {
  console.log('[Test] FAIL: api_usage_log did not record tool calls')
}

// 验证 endpoint 命名是否符合 mode.replace(/_/g, '-') 模式
const endpointsResult = await pool.query(
  "SELECT DISTINCT endpoint FROM api_usage_log WHERE provider='github' ORDER BY endpoint"
)
console.log('\n[Test] All github endpoints in api_usage_log:')
for (const row of endpointsResult.rows) {
  console.log(`  - ${row.endpoint}`)
  // 验证 endpoint 命名模式
  const expected = ['search-repos', 'search-code', 'search-users', 'search-issues', 'download-release', 'download-file', 'rate-limit']
  if (expected.includes(row.endpoint)) {
    console.log(`    ✓ matches mode.replace(/_/g, '-') pattern`)
  } else if (row.endpoint.startsWith('https://')) {
    console.log(`    ✗ SPEC DEVIATION: endpoint should be short name (e.g. 'rate-limit'), not full URL`)
  } else {
    console.log(`    ? unexpected endpoint name`)
  }
}

await closeDb()
console.log('\n[Test] All done.')
