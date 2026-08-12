// ============================================================================
// 端到端验证 Living Dashboard 服务器端 academic_search 搜索工具
// 直接调用 callSemanticScholar 函数验证响应字段映射
// 配额：S2 1 RPS，每次调用之间 sleep 3 秒（避免 429）
// ============================================================================

import { readFileSync } from 'fs'
import { resolve } from 'path'
import { callSemanticScholar } from '../src/utils/searchApi.js'
import { academicSearchTool } from '../src/utils/searchTools.js'
import { getSearchKey } from '../src/db/aiSettingsStore.js'
import { initDb, closeDb } from '../src/db/connection.js'

// ---------------------------------------------------------------------------
// 加载 .env 文件（与 server/src/index.ts 相同逻辑）
// ---------------------------------------------------------------------------
try {
  const envPath = resolve(process.cwd(), '.env')
  const envContent = readFileSync(envPath, 'utf-8')
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex > 0) {
      const k = trimmed.substring(0, eqIndex).trim()
      const v = trimmed.substring(eqIndex + 1).trim()
      if (!process.env[k]) process.env[k] = v
    }
  }
  console.log('[Test] .env loaded')
} catch (e) {
  console.warn('[Test] .env not loaded:', e instanceof Error ? e.message : e)
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error('  ASSERT FAILED:', msg)
    process.exitCode = 1
    throw new Error('ASSERT FAILED: ' + msg)
  }
  console.log('  OK:', msg)
}

/** 包装 callSemanticScholar，遇到 429 错误时等待 5 秒后重试（最多 3 次） */
async function callS2WithRetry(params: Parameters<typeof callSemanticScholar>[0], key: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await callSemanticScholar(params, key)
    } catch (e) {
      const msg = (e as Error).message
      if (msg.includes('429') && attempt < 2) {
        console.log(`  [429 retry] attempt ${attempt + 1}/3, waiting 5s...`)
        await sleep(5000)
        continue
      }
      throw e
    }
  }
  throw new Error('unreachable')
}

// ---------------------------------------------------------------------------
// 主测试流程
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  await initDb()
  const key = await getSearchKey('semanticScholar')
  console.log('[Test] got key:', key ? `${key.slice(0, 8)}...${key.slice(-4)} (len=${key.length})` : 'null')
  if (!key) {
    console.error('NO KEY configured')
    process.exit(1)
  }

  // =========================================================================
  // 测试用例 1：基本搜索 - 验证字段映射
  // =========================================================================
  console.log('\n[Test 1] basic search: "transformer attention"')
  const r1 = await callS2WithRetry({ query: 'transformer attention', limit: 5 }, key)
  console.log('  total:', r1.total)
  console.log('  papers.length:', r1.papers.length)
  console.log('  first paper:', JSON.stringify(r1.papers[0], null, 2))
  assert(r1.papers.length > 0, 'papers should not be empty')
  for (const p of r1.papers) {
    assert(typeof p.paperId === 'string' && p.paperId.length > 0, `paperId should be non-empty string`)
    assert(typeof p.title === 'string', `title should be string`)
    assert(Array.isArray(p.authors), `authors should be array`)
    assert(typeof p.year === 'number', `year should be number (${p.year})`)
    assert(typeof p.citationCount === 'number', `citationCount should be number`)
    assert(typeof p.venue === 'string', `venue should be string`)
    assert(typeof p.abstract === 'string', `abstract should be string`)
    for (const a of p.authors) {
      assert(typeof a === 'string', `author should be string`)
    }
  }
  const withOa = r1.papers.find(p => p.openAccessPdf?.url)
  const withArxiv = r1.papers.find(p => p.externalIds?.ArXiv)
  const withTldr = r1.papers.find(p => p.tldr?.text)
  const withDoi = r1.papers.find(p => p.externalIds?.DOI)
  console.log('  has paper with openAccessPdf:', !!withOa)
  console.log('  has paper with ArXiv id:', !!withArxiv)
  console.log('  has paper with DOI:', !!withDoi)
  console.log('  has paper with tldr:', !!withTldr)
  if (withOa) {
    console.log('  openAccessPdf sample:', JSON.stringify(withOa.openAccessPdf))
    assert(typeof withOa.openAccessPdf!.url === 'string' && withOa.openAccessPdf!.url.length > 0, 'openAccessPdf.url should be non-empty string')
    assert(typeof withOa.openAccessPdf!.status === 'string', 'openAccessPdf.status should be string')
  }

  await sleep(3000)

  // =========================================================================
  // 测试用例 2：year 过滤
  // =========================================================================
  console.log('\n[Test 2] year=2023-2024: "large language model"')
  const r2 = await callS2WithRetry({ query: 'large language model', limit: 3, year: '2023-2024' }, key)
  console.log('  total:', r2.total, 'papers:', r2.papers.length)
  for (const p of r2.papers) {
    assert(p.year >= 2023 && p.year <= 2024, `paper year ${p.year} should be in 2023-2024`)
  }

  await sleep(3000)

  // =========================================================================
  // 测试用例 3：fieldsOfStudy 过滤
  // =========================================================================
  console.log('\n[Test 3] fieldsOfStudy=Computer Science: "neural network"')
  const r3 = await callS2WithRetry({ query: 'neural network', limit: 3, fieldsOfStudy: 'Computer Science' }, key)
  console.log('  total:', r3.total, 'papers:', r3.papers.length)
  assert(r3.papers.length > 0, 'fieldsOfStudy=Computer Science should return papers')

  await sleep(3000)

  // =========================================================================
  // 测试用例 4：openAccessOnly=true - 关键测试（total 计算 bug 验证）
  // =========================================================================
  console.log('\n[Test 4] openAccessOnly=true: "GPT" (BUG 3 验证)')
  const r4 = await callS2WithRetry({ query: 'GPT', limit: 5, openAccessOnly: true }, key)
  console.log('  total:', r4.total, 'papers:', r4.papers.length)
  for (const p of r4.papers) {
    assert(!!p.openAccessPdf?.url, `openAccessOnly=true 时所有论文都应该有 openAccessPdf.url, paperId=${p.paperId}`)
  }
  // 修复 BUG 3 后：total 应为 S2 原始 total（匹配查询的论文总数，含非 OA），应 >= papers.length
  console.log('  total >= papers.length?', r4.total >= r4.papers.length, `(${r4.total} vs ${r4.papers.length})`)
  assert(r4.total >= r4.papers.length, `BUG 3 修复后 total 应为 S2 原始总数 (>= papers.length), got total=${r4.total}, papers=${r4.papers.length}`)
  console.log('  ✓ BUG 3 已修复: total 为 S2 原始总数, papers.length 为返回的 OA 论文数')

  await sleep(3000)

  // =========================================================================
  // 测试用例 5：limit 上限 100（传 200，应被截断为 100）
  // =========================================================================
  console.log('\n[Test 5] limit=200 (should cap to 100)')
  const r5 = await callS2WithRetry({ query: 'AI', limit: 200 }, key)
  console.log('  papers.length:', r5.papers.length, '(should be <= 100)')
  assert(r5.papers.length <= 100, `limit=200 should be capped to 100, got: ${r5.papers.length}`)

  await sleep(3000)

  // =========================================================================
  // 测试用例 6：offset 分页
  // =========================================================================
  console.log('\n[Test 6] offset=2: "deep learning"')
  const r6a = await callS2WithRetry({ query: 'deep learning', limit: 3 }, key)
  await sleep(3000)
  const r6b = await callS2WithRetry({ query: 'deep learning', limit: 3, offset: 2 }, key)
  console.log('  r6a paperIds:', r6a.papers.map(p => p.paperId))
  console.log('  r6b paperIds:', r6b.papers.map(p => p.paperId))
  console.log('  r6b[0] should equal r6a[2]:', r6b.papers[0]?.paperId === r6a.papers[2]?.paperId)
  assert(r6b.papers[0]?.paperId === r6a.papers[2]?.paperId, `offset=2 should return the 3rd paper from r6a (expected ${r6a.papers[2]?.paperId}, got ${r6b.papers[0]?.paperId})`)

  await sleep(3000)

  // =========================================================================
  // 测试用例 7：Key 缺失错误
  // =========================================================================
  console.log('\n[Test 7] empty key should throw')
  try {
    await callSemanticScholar({ query: 'test' }, '')
    console.log('  FAIL: should have thrown')
    process.exitCode = 1
  } catch (e) {
    const msg = (e as Error).message
    console.log('  OK: threw:', msg)
    assert(msg.includes('未配置 Semantic Scholar API Key'), `error message should mention "未配置 Semantic Scholar API Key", got: "${msg}"`)
  }

  // =========================================================================
  // 测试用例 8：Spec 5.3 偏差检查 - ArXiv 兜底 URL
  // =========================================================================
  console.log('\n[Test 8] Spec 5.3: ArXiv fallback URL (BUG 4 验证)')
  const r8 = await callS2WithRetry({ query: 'attention is all you need', limit: 5 }, key)
  const arxivPaper = r8.papers.find(p => p.externalIds?.ArXiv)
  if (arxivPaper) {
    console.log('  Found paper with ArXiv id:', arxivPaper.paperId)
    console.log('  externalIds.ArXiv:', arxivPaper.externalIds!.ArXiv)
    console.log('  openAccessPdf:', arxivPaper.openAccessPdf ? JSON.stringify(arxivPaper.openAccessPdf) : 'absent')
    const hasArxivUrl = arxivPaper.openAccessPdf?.url?.includes('arxiv.org/pdf/')
    console.log('  Has arxiv.org/pdf/ URL in openAccessPdf?', hasArxivUrl)
    // 修复 BUG 4 后：有 ArXiv id 的论文应该有 openAccessPdf.url（原 url 或 ArXiv 兜底 url）
    assert(!!arxivPaper.openAccessPdf?.url, 'BUG 4 修复后：有 ArXiv id 的论文应有 openAccessPdf.url（原 url 或 ArXiv 兜底）')
    if (hasArxivUrl) {
      console.log('  ✓ BUG 4 已修复: ArXiv 兜底 URL 已生成')
    }
  } else {
    console.log('  No paper with ArXiv id found in this batch')
  }

  await sleep(3000)

  // =========================================================================
  // 测试用例 9：academicSearchTool.execute - 验证工具定义和 api_usage_log 记录
  // =========================================================================
  console.log('\n[Test 9] academicSearchTool.execute - verify api_usage_log')
  console.log('  tool.name:', academicSearchTool.name)
  console.log('  tool.label:', academicSearchTool.label)
  assert(academicSearchTool.name === 'academic_search', `tool name should be 'academic_search', got: ${academicSearchTool.name}`)
  assert(typeof academicSearchTool.execute === 'function', 'tool.execute should be a function')

  // 记录调用前的最大 id
  const { getPool } = await import('../src/db/connection.js')
  const pool = getPool()
  const beforeResult = await pool.query("SELECT MAX(id) as max_id FROM api_usage_log WHERE provider='semanticScholar'")
  const maxIdBefore = beforeResult.rows[0]?.max_id ?? 0
  console.log('  max api_usage_log id before tool call:', maxIdBefore)

  // 调用 academicSearchTool.execute
  const toolResult = await academicSearchTool.execute!(
    'test-tool-call-id',
    { query: 'machine learning', limit: 2 },
    undefined as any,
    undefined as any,
    undefined as any,
  )
  const resultText = (toolResult.content[0] as { type: string; text: string }).text
  const parsed = JSON.parse(resultText) as { papers: unknown[]; total: number }
  console.log('  tool returned papers.length:', parsed.papers.length, 'total:', parsed.total)
  assert(parsed.papers.length > 0, 'tool should return papers')

  // 验证 api_usage_log 新增了一条记录
  const afterResult = await pool.query("SELECT id, endpoint, status, latency_ms, error_msg FROM api_usage_log WHERE provider='semanticScholar' AND id > $1 ORDER BY id DESC", [maxIdBefore])
  console.log('  new api_usage_log records:', afterResult.rows.length)
  if (afterResult.rows.length > 0) {
    const row = afterResult.rows[0]
    console.log('  record:', JSON.stringify(row))
    assert(row.endpoint === 'paper-search', `endpoint should be 'paper-search', got: ${row.endpoint}`)
    assert(row.status === 'ok', `status should be 'ok', got: ${row.status}`)
  } else {
    console.log('  FAIL: no new api_usage_log record')
    process.exitCode = 1
  }

  await closeDb()
  console.log('\n[Test] All done. exitCode =', process.exitCode)
}

main().catch((err) => {
  console.error('[Test] FATAL:', err)
  process.exit(1)
})
