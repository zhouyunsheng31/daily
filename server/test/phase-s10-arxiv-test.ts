// ============================================================================
// Phase S10 功能 2 端到端验证：ArXiv 最新论文实时搜索
// 验证 callArxiv / arxivThrottledFetch / parseArxivAtomXml / callAcademicSearch
// ============================================================================

import { readFileSync } from 'fs'
import { resolve } from 'path'
import {
  callArxiv,
  callAcademicSearch,
} from '../src/utils/searchApi.js'

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

let passCount = 0
let failCount = 0

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error('  ASSERT FAILED:', msg)
    failCount++
    throw new Error('ASSERT FAILED: ' + msg)
  }
  console.log('  OK:', msg)
  passCount++
}

/** 验证 ISO 日期字符串格式 YYYY-MM-DD */
function isIsoDate(s: unknown): boolean {
  if (typeof s !== 'string') return false
  return /^\d{4}-\d{2}-\d{2}$/.test(s)
}

// ---------------------------------------------------------------------------
// 主测试流程
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  // =========================================================================
  // 测试用例 1：ArXiv 基础搜索
  // =========================================================================
  console.log('\n[Test 1] ArXiv basic search: "large language model", limit=5')
  const r1 = await callArxiv({ query: 'large language model', limit: 5 })
  console.log('  total:', r1.total)
  console.log('  papers.length:', r1.papers.length)
  console.log('  first paper:', JSON.stringify(r1.papers[0], null, 2))
  assert(r1.papers.length > 0, 'papers should not be empty')
  assert(r1.papers.length <= 5, `papers.length should be <= limit=5, got ${r1.papers.length}`)

  for (const p of r1.papers) {
    assert(typeof p.title === 'string' && p.title.length > 0, `title should be non-empty string, got: "${p.title}"`)
    assert(Array.isArray(p.authors) && p.authors.length > 0, `authors should be non-empty array, got: ${JSON.stringify(p.authors)}`)
    for (const a of p.authors) {
      assert(typeof a === 'string' && a.length > 0, `author should be non-empty string, got: "${a}"`)
    }
    assert(typeof p.abstract === 'string', `abstract should be string, got: ${typeof p.abstract}`)
    // url 验证：openAccessPdf.url 或 paperId（arxiv id）作为 url 标识
    if (p.openAccessPdf?.url) {
      assert(typeof p.openAccessPdf.url === 'string' && p.openAccessPdf.url.length > 0, `openAccessPdf.url should be non-empty string, got: "${p.openAccessPdf.url}"`)
    }
    assert(typeof p.paperId === 'string' && p.paperId.length > 0, `paperId should be non-empty string (arxiv id), got: "${p.paperId}"`)
    assert(p.venue === 'ArXiv', `venue should be 'ArXiv', got: "${p.venue}"`)
    assert(p.citationCount === 0, `citationCount should be 0 for ArXiv papers, got: ${p.citationCount}`)
    // externalIds.ArXiv 应填充
    assert(!!p.externalIds?.ArXiv, `externalIds.ArXiv should be filled, got: ${JSON.stringify(p.externalIds)}`)
  }

  // =========================================================================
  // 测试用例 2：publicationDate 填充（所有 paper 都应有 ISO 日期）
  // =========================================================================
  console.log('\n[Test 2] publicationDate filled for all papers')
  for (const p of r1.papers) {
    assert(isIsoDate(p.publicationDate), `publicationDate should be ISO YYYY-MM-DD, got: "${p.publicationDate}" (paperId=${p.paperId})`)
    // 验证 year 与 publicationDate 一致
    if (p.publicationDate) {
      const yearFromDate = parseInt(p.publicationDate.split('-')[0], 10)
      assert(p.year === yearFromDate, `year (${p.year}) should match publicationDate year (${yearFromDate})`)
    }
  }

  // =========================================================================
  // 测试用例 3：按 submittedDate 倒序（publicationDate 非递增）
  // =========================================================================
  console.log('\n[Test 3] sorted by submittedDate descending')
  const dates = r1.papers.map(p => p.publicationDate ?? '')
  console.log('  dates:', dates)
  for (let i = 1; i < dates.length; i++) {
    assert(dates[i - 1] >= dates[i], `papers should be sorted by publicationDate DESC, but papers[${i - 1}]=${dates[i - 1]} < papers[${i}]=${dates[i]}`)
  }

  // =========================================================================
  // 测试用例 4：节流器间隔（连续 2 次调用，总耗时 ≥ 3000ms）
  // =========================================================================
  console.log('\n[Test 4] throttle interval >= 3000ms between consecutive calls')
  // 自包含测试：连续调用 2 次 callArxiv，测量总耗时
  // 第一次调用设置 arxivNextAvailableAt = T0 + 3000
  // 第二次调用若 D1 < 3000 则需等待 (3000 - D1) ms，总耗时 = 3000 + D2 >= 3000
  // 第二次调用若 D1 >= 3000 则不等待，总耗时 = D1 + D2 >= 3000
  // 因此总耗时 >= 3000ms 是稳健的断言
  const t4_start = Date.now()
  const r4a = await callArxiv({ query: 'neural network', limit: 3 })
  const r4b = await callArxiv({ query: 'deep learning', limit: 3 })
  const t4_end = Date.now()
  const totalElapsed = t4_end - t4_start
  console.log(`  total elapsed for 2 consecutive calls: ${totalElapsed}ms`)
  console.log('  r4a papers.length:', r4a.papers.length)
  console.log('  r4b papers.length:', r4b.papers.length)
  assert(r4a.papers.length > 0, 'first call in Test 4 should return papers')
  assert(r4b.papers.length > 0, 'second call in Test 4 should return papers')
  assert(totalElapsed >= 3000, `throttle should ensure >= 3000ms total for 2 consecutive calls, got ${totalElapsed}ms`)

  // =========================================================================
  // 测试用例 5：callAcademicSearch latest 模式（不需要 S2 Key）
  // =========================================================================
  console.log('\n[Test 5] callAcademicSearch mode=latest (no S2 Key required)')
  const r5 = await callAcademicSearch({ query: 'transformer', mode: 'latest', limit: 3 })
  console.log('  total:', r5.total)
  console.log('  papers.length:', r5.papers.length)
  assert(r5.papers.length > 0, 'latest mode should return papers without S2 Key')
  for (const p of r5.papers) {
    assert(p.venue === 'ArXiv', `latest mode papers should be from ArXiv, got venue="${p.venue}"`)
    assert(isIsoDate(p.publicationDate), `publicationDate should be ISO date, got: "${p.publicationDate}"`)
  }

  // =========================================================================
  // 测试用例 6：callAcademicSearch relevance 模式无 Key 应抛错
  // =========================================================================
  console.log('\n[Test 6] callAcademicSearch mode=relevance without s2Key should throw')
  try {
    await callAcademicSearch({ query: 'test', mode: 'relevance' }, undefined)
    console.log('  FAIL: should have thrown')
    failCount++
    assert(false, 'callAcademicSearch mode=relevance without s2Key should throw')
  } catch (e) {
    const msg = (e as Error).message
    console.log('  OK: threw:', msg)
    assert(msg.includes('未配置 Semantic Scholar API Key'), `error message should mention "未配置 Semantic Scholar API Key", got: "${msg}"`)
  }

  console.log('\n[Test] All done. pass=' + passCount + ', fail=' + failCount)
  if (failCount > 0) {
    process.exitCode = 1
  }
}

main().catch((err) => {
  console.error('[Test] FATAL:', err)
  process.exit(1)
})
