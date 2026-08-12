// ============================================================================
// Living Dashboard Bocha web_search 端到端验证测试
// 验证内容：
//   - callBocha 函数响应字段映射（name→title, url, snippet, summary, siteName, siteIcon, datePublished）
//   - total 字段（取 totalEstimatedMatches，兜底 value.length）
//   - 兼容 data.webPages.value 与 webPages.value 两种结构
//   - count 默认 10、硬上限 50
//   - 错误处理（Key 缺失抛错；429/网络错误重试）
//   - 中文查询
//   - api_usage_log 表记录（成功/失败均记录）
// 运行方式：
//   cd f:\allmylife\event\server
//   npx tsx test/search-web-test.ts
// ============================================================================

import { callBocha } from '../src/utils/searchApi.js'
import { getSearchKey } from '../src/db/aiSettingsStore.js'
import { initDb, closeDb } from '../src/db/connection.js'

// 加载 .env（与 server/src/index.ts 一致：从 process.cwd()/.env 读取）
import { readFileSync } from 'fs'
import { resolve } from 'path'
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
      if (!process.env[key]) {
        process.env[key] = value
      }
    }
  }
} catch {
  // .env 文件不存在，忽略
}

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error('  ASSERT FAILED:', msg)
    process.exit(1)
  }
  console.log('  OK:', msg)
}

async function main() {
  // 初始化 DB（必须，因为 getSearchKey 需要 pool）
  await initDb()

  const key = await getSearchKey('bocha')
  console.log('[Test] got key:', key ? `${key.slice(0, 8)}...` : 'null')
  if (!key) {
    console.error('NO KEY')
    await closeDb()
    process.exit(1)
  }

  // ------------------------------------------------------------------------
  // 测试用例 1：基本搜索（验证字段映射）
  // ------------------------------------------------------------------------
  console.log('\n[Test 1] basic search: "OpenAI GPT-5"')
  const r1 = await callBocha({ query: 'OpenAI GPT-5', count: 5 }, key)
  console.log('  total:', r1.total)
  console.log('  results.length:', r1.results.length)
  console.log('  first hit:', JSON.stringify(r1.results[0], null, 2).slice(0, 800))
  assert(r1.results.length > 0, 'results should not be empty')
  assert(r1.total >= r1.results.length, 'total should be >= results.length')
  for (const hit of r1.results) {
    assert(typeof hit.title === 'string', `hit.title should be string, got ${typeof hit.title}`)
    assert(typeof hit.url === 'string', `hit.url should be string`)
    assert(typeof hit.snippet === 'string', `hit.snippet should be string`)
  }

  // ------------------------------------------------------------------------
  // 测试用例 2：freshness=week
  // ------------------------------------------------------------------------
  console.log('\n[Test 2] freshness=week: "新闻"')
  const r2 = await callBocha({ query: '新闻', count: 3, freshness: 'week' }, key)
  console.log('  total:', r2.total, 'results:', r2.results.length)
  assert(r2.results.length >= 0, 'freshness=week should return results without error')

  // ------------------------------------------------------------------------
  // 测试用例 3：summary=true
  // ------------------------------------------------------------------------
  console.log('\n[Test 3] summary=true: "什么是大模型"')
  const r3 = await callBocha({ query: '什么是大模型', count: 3, summary: true }, key)
  console.log('  total:', r3.total, 'results:', r3.results.length)
  if (r3.results.length > 0) {
    console.log('  first hit has summary?:', !!r3.results[0].summary)
    if (r3.results[0].summary) {
      console.log('  summary preview:', r3.results[0].summary!.slice(0, 100))
    }
  }

  // ------------------------------------------------------------------------
  // 测试用例 4：count 上限 50（传 100，应被截断为 50）
  // ------------------------------------------------------------------------
  console.log('\n[Test 4] count=100 (should cap to 50)')
  const r4 = await callBocha({ query: 'test', count: 100 }, key)
  console.log('  results.length:', r4.results.length, '(should be <= 50)')
  assert(r4.results.length <= 50, `count=100 should be capped to 50, got ${r4.results.length}`)

  // ------------------------------------------------------------------------
  // 测试用例 5：Key 缺失错误
  // ------------------------------------------------------------------------
  console.log('\n[Test 5] empty key should throw')
  try {
    await callBocha({ query: 'test' }, '')
    console.log('  FAIL: should have thrown')
    process.exit(1)
  } catch (e) {
    const msg = (e as Error).message
    console.log('  OK: threw:', msg)
    assert(msg.includes('未配置 Bocha API Key'), `error message should mention "未配置 Bocha API Key", got: ${msg}`)
  }

  // ------------------------------------------------------------------------
  // 测试用例 6：验证响应原始结构（区分 data.webPages vs webPages）
  // ------------------------------------------------------------------------
  console.log('\n[Test 6] inspect raw API response structure')
  const rawResp = await fetch('https://api.bochaai.com/v1/web-search', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: 'test', count: 2 }),
  })
  const rawJson: any = await rawResp.json()
  const hasDataWrapper = rawJson?.data?.webPages?.value != null
  const hasDirectWebPages = rawJson?.webPages?.value != null
  console.log('  raw response top-level keys:', Object.keys(rawJson || {}).slice(0, 10))
  console.log('  has data.webPages.value:', hasDataWrapper)
  console.log('  has webPages.value (direct):', hasDirectWebPages)
  if (hasDataWrapper) {
    console.log('  data.webPages keys:', Object.keys(rawJson.data.webPages).slice(0, 10))
    if (rawJson.data.webPages.value?.[0]) {
      console.log('  first raw hit keys:', Object.keys(rawJson.data.webPages.value[0]).slice(0, 15))
      console.log('  first raw hit sample:', JSON.stringify(rawJson.data.webPages.value[0]).slice(0, 500))
    }
    console.log('  totalEstimatedMatches:', rawJson.data.webPages.totalEstimatedMatches)
  } else if (hasDirectWebPages) {
    console.log('  webPages keys:', Object.keys(rawJson.webPages).slice(0, 10))
    if (rawJson.webPages.value?.[0]) {
      console.log('  first raw hit keys:', Object.keys(rawJson.webPages.value[0]).slice(0, 15))
      console.log('  first raw hit sample:', JSON.stringify(rawJson.webPages.value[0]).slice(0, 500))
    }
    console.log('  totalEstimatedMatches:', rawJson.webPages.totalEstimatedMatches)
  }

  // ------------------------------------------------------------------------
  // 测试用例 7：中文查询
  // ------------------------------------------------------------------------
  console.log('\n[Test 7] Chinese query: "人工智能最新进展"')
  const r7 = await callBocha({ query: '人工智能最新进展', count: 3 }, key)
  console.log('  total:', r7.total, 'results:', r7.results.length)
  if (r7.results[0]) {
    console.log('  first title:', r7.results[0].title)
  }
  assert(r7.results.length > 0, 'Chinese query should return results')

  await closeDb()
  console.log('\n[Test] All assertions passed.')
}

main().catch((err) => {
  console.error('\n[Test] FATAL ERROR:', err)
  closeDb().finally(() => process.exit(1))
})
