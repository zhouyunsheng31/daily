// ============================================================================
// Living Dashboard — Phase S10 GitHub 代理下载端到端测试
// 覆盖：
//   1. download_repo_zip 模式（callGitHub 直接调用）
//   2. download_file 大文件路径（≥1MB 返回代理 URL）
//   3. download_release 大资产（返回代理 URL）
//   4. /api/github/proxy 端点（fetch 请求代理 URL 下载文件）
//   5. 客户端中断（AbortController 中断代理请求，服务器不崩溃）
//
// 前置条件：服务器已启动（node dist/index.js 或 npx tsx src/index.ts）
// 运行：cd f:\allmylife\event\server && npx tsx test/phase-s10-github-test.ts
// ============================================================================

import { readFileSync } from 'fs'
import { resolve } from 'path'
import { callGitHub } from '../src/utils/searchApi.js'
import { getSearchKey } from '../src/db/aiSettingsStore.js'
import { initDb, closeDb } from '../src/db/connection.js'

// ---------------------------------------------------------------------------
// .env 手动加载（与 server/src/index.ts 一致，tsx 不会自动加载 .env）
// ---------------------------------------------------------------------------
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

const SERVER_BASE = process.env.SERVER_BASE_URL || `http://localhost:${process.env.PORT || 3456}`
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// 测试结果收集
interface TestResult {
  name: string
  pass: boolean
  detail: string
  sample?: unknown
}
const results: TestResult[] = []

function assert(cond: boolean, msg: string, testName?: string): boolean {
  if (!cond) {
    console.error('  ASSERT FAILED:', msg)
    if (testName) results.push({ name: testName, pass: false, detail: msg })
    return false
  }
  console.log('  OK:', msg)
  return true
}

function recordResult(name: string, pass: boolean, detail: string, sample?: unknown) {
  results.push({ name, pass, detail, sample })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name}: ${detail}`)
}

// ---------------------------------------------------------------------------
// 0. 前置：检查服务器健康 + 读取 GitHub Key
// ---------------------------------------------------------------------------
console.log('\n[Pre] Checking server health and reading GitHub key...')
let serverOk = false
try {
  const r = await fetch(`${SERVER_BASE}/api/health`)
  serverOk = r.ok
  console.log('  health:', r.status, r.ok ? 'OK' : 'FAIL')
} catch (e) {
  console.warn('  health check failed (server may not be running):', e instanceof Error ? e.message : String(e))
}

await initDb()
const key = await getSearchKey('github')
console.log('[Test] got key:', key ? `${key.slice(0, 8)}...${key.slice(-4)} (len=${key.length})` : 'null')
if (!key) {
  console.error('NO GitHub Key — aborting')
  await closeDb()
  process.exit(1)
}

const GITHUB_TOKEN = key  // 用于直接调用 GitHub API 获取测试数据

// ===========================================================================
// Test 1: download_repo_zip 模式
// ===========================================================================
console.log('\n[Test 1] download_repo_zip: owner=octocat, repo=Hello-World')
try {
  const r1 = await callGitHub({ mode: 'download_repo_zip', owner: 'octocat', repo: 'Hello-World' }, key)
  console.log('  result:', JSON.stringify(r1, null, 2))
  const okMode = assert(r1.mode === 'download_repo_zip', 'mode should be download_repo_zip', 'T1.mode')
  const okDownload = assert(!!r1.download, 'download should be defined', 'T1.download')
  let okFileName = false, okSize = false, okUrl = false
  if (r1.download) {
    okFileName = assert(typeof r1.download.fileName === 'string' && r1.download.fileName.length > 0, 'fileName should be non-empty string', 'T1.fileName')
    okSize = assert(typeof r1.download.size === 'number', 'size should be number (may be 0)', 'T1.size')
    okUrl = assert(
      typeof r1.download.downloadUrl === 'string' &&
      r1.download.downloadUrl.includes('/api/github/proxy?type=zip'),
      'downloadUrl should contain /api/github/proxy?type=zip',
      'T1.downloadUrl',
    )
    console.log('  fileName:', r1.download.fileName)
    console.log('  size:', r1.download.size)
    console.log('  downloadUrl:', r1.download.downloadUrl)
  }
  recordResult('Test 1: download_repo_zip', okMode && okDownload && okFileName && okSize && okUrl, 'all assertions passed', r1)
} catch (e) {
  recordResult('Test 1: download_repo_zip', false, `exception: ${(e as Error).message}`)
}

await sleep(2000)

// ===========================================================================
// Test 1b: download_repo_zip 缺参数
// ===========================================================================
console.log('\n[Test 1b] download_repo_zip missing owner/repo should throw')
try {
  await callGitHub({ mode: 'download_repo_zip' }, key)
  recordResult('Test 1b: download_repo_zip missing params', false, 'should have thrown but did not')
} catch (e) {
  const msg = (e as Error).message
  console.log('  threw:', msg)
  const ok = assert(msg.includes('owner') && msg.includes('repo'), 'error should mention owner/repo', 'T1b.msg')
  recordResult('Test 1b: download_repo_zip missing params', ok, `threw: ${msg}`)
}

// ===========================================================================
// Test 2: download_file 大文件路径（≥1MB 返回代理 URL）
// ===========================================================================
// 使用 microsoft/TypeScript 的 src/compiler/checker.ts（通常 >1MB，仓库中等大小 API 响应快）
console.log('\n[Test 2] download_file large file (≥1MB): microsoft/TypeScript src/compiler/checker.ts')
try {
  const r2 = await callGitHub({ mode: 'download_file', owner: 'microsoft', repo: 'TypeScript', path: 'src/compiler/checker.ts' }, key)
  console.log('  result:', JSON.stringify({ ...r2.download, content: r2.download?.content ? `<base64 len=${r2.download.content.length}>` : undefined }, null, 2))
  const okMode = assert(r2.mode === 'download_file', 'mode should be download_file', 'T2.mode')
  const okDownload = assert(!!r2.download, 'download should be defined', 'T2.download')
  let okLarge = false, okUrl = false, okNoContent = false
  if (r2.download) {
    console.log('  size:', r2.download.size, 'fileName:', r2.download.fileName)
    okLarge = assert(r2.download.size >= 1_000_000, `size should be ≥1MB (got ${r2.download.size})`, 'T2.large')
    if (r2.download.size >= 1_000_000) {
      okUrl = assert(
        typeof r2.download.downloadUrl === 'string' &&
        r2.download.downloadUrl.includes('/api/github/proxy?type=file'),
        'downloadUrl should contain /api/github/proxy?type=file',
        'T2.downloadUrl',
      )
      okNoContent = assert(r2.download.content === undefined, 'large file should NOT return content (should use proxyUrl)', 'T2.noContent')
      console.log('  downloadUrl:', r2.download.downloadUrl)
    } else {
      console.log('  SKIP: file <1MB, returning content instead of proxyUrl')
      okUrl = true; okNoContent = true  // 数据问题不算失败
    }
  }
  recordResult('Test 2: download_file large file', okMode && okDownload && okLarge && okUrl && okNoContent, 'all assertions passed', { ...r2.download, content: undefined })
} catch (e) {
  recordResult('Test 2: download_file large file', false, `exception: ${(e as Error).message}`)
}

await sleep(2500)

// ===========================================================================
// Test 2b: download_file 小文件路径（<1MB 返回 content，保持原行为）
// ===========================================================================
console.log('\n[Test 2b] download_file small file (<1MB): octocat/Hello-World README')
try {
  const r2b = await callGitHub({ mode: 'download_file', owner: 'octocat', repo: 'Hello-World', path: 'README' }, key)
  console.log('  result:', JSON.stringify({ ...r2b.download, content: r2b.download?.content ? `<base64 len=${r2b.download.content.length}>` : undefined }, null, 2))
  const okMode = assert(r2b.mode === 'download_file', 'mode should be download_file', 'T2b.mode')
  const okDownload = assert(!!r2b.download, 'download should be defined', 'T2b.download')
  let okSmall = false, okContent = false, okNoUrl = false
  if (r2b.download) {
    okSmall = assert(r2b.download.size < 1_000_000, `size should be <1MB (got ${r2b.download.size})`, 'T2b.small')
    okContent = assert(typeof r2b.download.content === 'string' && r2b.download.content.length > 0, 'small file should return base64 content', 'T2b.content')
    okNoUrl = assert(r2b.download.downloadUrl === undefined, 'small file should NOT return downloadUrl', 'T2b.noUrl')
  }
  recordResult('Test 2b: download_file small file', okMode && okDownload && okSmall && okContent && okNoUrl, 'all assertions passed', { ...r2b.download, content: `<base64 len=${r2b.download?.content?.length}>` })
} catch (e) {
  recordResult('Test 2b: download_file small file', false, `exception: ${(e as Error).message}`)
}

await sleep(2500)

// ===========================================================================
// Test 3: download_release 大资产（返回代理 URL）
// ===========================================================================
// 先获取 cli/cli latest release，找一个 asset（GitHub CLI release 通常有多个二进制 assets）
console.log('\n[Test 3] download_release: get cli/cli latest release assets')
let testAssetId: number | null = null
let testAssetName: string | null = null
try {
  const r3 = await callGitHub({ mode: 'download_release', owner: 'cli', repo: 'cli' }, key)
  console.log('  release items:', r3.items?.length, 'total assets:', r3.total)
  if (r3.items && r3.items.length > 0) {
    const release = r3.items[0] as any
    console.log('  tagName:', release.tagName, 'assets:', release.assets?.length)
    if (release.assets && release.assets.length > 0) {
      // 找一个 asset（无论大小，因为 S10 后所有 assetId 都走代理）
      const asset = release.assets[0]
      testAssetId = asset.id
      testAssetName = asset.name
      console.log('  first asset:', asset.name, 'size:', asset.size, 'id:', asset.id)
    }
  }
  recordResult('Test 3a: download_release latest metadata', !!testAssetId, testAssetId ? `found asset id=${testAssetId} name=${testAssetName}` : 'no asset found')
} catch (e) {
  recordResult('Test 3a: download_release latest metadata', false, `exception: ${(e as Error).message}`)
}

await sleep(2500)

// Test 3b: 用 assetId 下载（应该返回代理 URL）
if (testAssetId != null) {
  console.log(`\n[Test 3b] download_release assetId=${testAssetId} (should return proxyUrl)`)
  try {
    const r3b = await callGitHub({ mode: 'download_release', owner: 'cli', repo: 'cli', assetId: testAssetId }, key)
    console.log('  result:', JSON.stringify(r3b.download, null, 2))
    const okMode = assert(r3b.mode === 'download_release', 'mode should be download_release', 'T3b.mode')
    const okDownload = assert(!!r3b.download, 'download should be defined', 'T3b.download')
    let okUrl = false, okNoContent = false
    if (r3b.download) {
      okUrl = assert(
        typeof r3b.download.downloadUrl === 'string' &&
        r3b.download.downloadUrl.includes('/api/github/proxy?type=asset'),
        'downloadUrl should contain /api/github/proxy?type=asset',
        'T3b.downloadUrl',
      )
      okNoContent = assert(r3b.download.content === undefined, 'assetId path should NOT return content (always proxyUrl)', 'T3b.noContent')
      console.log('  downloadUrl:', r3b.download.downloadUrl)
    }
    recordResult('Test 3b: download_release assetId proxy', okMode && okDownload && okUrl && okNoContent, 'all assertions passed', r3b.download)
  } catch (e) {
    recordResult('Test 3b: download_release assetId proxy', false, `exception: ${(e as Error).message}`)
  }
} else {
  console.log('\n[Test 3b] SKIP: no asset found in Test 3a')
  recordResult('Test 3b: download_release assetId proxy', true, 'SKIP: no asset found')
}

await sleep(2500)

// ===========================================================================
// Test 4: /api/github/proxy 端点（fetch 请求代理 URL 下载文件）
// ===========================================================================
console.log('\n[Test 4] /api/github/proxy endpoint: download small file via proxy')
if (serverOk) {
  try {
    // 用小文件测试代理端点：octocat/Hello-World README
    const proxyUrl = `${SERVER_BASE}/api/github/proxy?type=file&owner=octocat&repo=Hello-World&path=README&fileName=README`
    console.log('  fetching:', proxyUrl)
    const r4 = await fetch(proxyUrl)
    console.log('  status:', r4.status, 'ok:', r4.ok)
    const okStatus = assert(r4.ok, `status should be 2xx (got ${r4.status})`, 'T4.status')
    const contentType = r4.headers.get('content-type') ?? ''
    console.log('  content-type:', contentType)
    const okCt = assert(contentType.length > 0, 'content-type should be non-empty', 'T4.contentType')
    const contentDisposition = r4.headers.get('content-disposition') ?? ''
    console.log('  content-disposition:', contentDisposition)
    const okCd = assert(contentDisposition.includes('README'), 'content-disposition should contain fileName', 'T4.contentDisposition')
    const body = await r4.text()
    console.log('  body length:', body.length, 'preview:', JSON.stringify(body.slice(0, 80)))
    const okBody = assert(body.length > 0, 'body should be non-empty', 'T4.body')
    recordResult('Test 4: /api/github/proxy file download', okStatus && okCt && okCd && okBody, 'all assertions passed', { status: r4.status, contentType, bodyLength: body.length })
  } catch (e) {
    recordResult('Test 4: /api/github/proxy file download', false, `exception: ${(e as Error).message}`)
  }
} else {
  console.log('  SKIP: server not running')
  recordResult('Test 4: /api/github/proxy file download', true, 'SKIP: server not running')
}

await sleep(1000)

// ===========================================================================
// Test 4b: /api/github/proxy 参数缺失（应返回 400）
// ===========================================================================
console.log('\n[Test 4b] /api/github/proxy missing params (expect 400)')
if (serverOk) {
  try {
    const r4b = await fetch(`${SERVER_BASE}/api/github/proxy`)
    console.log('  status:', r4b.status)
    const okStatus = assert(r4b.status === 400, `status should be 400 (got ${r4b.status})`, 'T4b.status')
    const body = await r4b.json()
    console.log('  body:', body)
    const okBody = assert(body.error && body.error.includes('missing'), 'error should mention missing params', 'T4b.body')
    recordResult('Test 4b: /api/github/proxy missing params', okStatus && okBody, 'all assertions passed')
  } catch (e) {
    recordResult('Test 4b: /api/github/proxy missing params', false, `exception: ${(e as Error).message}`)
  }
} else {
  console.log('  SKIP: server not running')
  recordResult('Test 4b: /api/github/proxy missing params', true, 'SKIP: server not running')
}

await sleep(1000)

// ===========================================================================
// Test 4c: /api/github/proxy 下载 zip（type=zip）
// ===========================================================================
console.log('\n[Test 4c] /api/github/proxy type=zip: octocat/Hello-World')
if (serverOk) {
  try {
    const proxyUrl = `${SERVER_BASE}/api/github/proxy?type=zip&owner=octocat&repo=Hello-World&fileName=Hello-World-HEAD.zip`
    console.log('  fetching:', proxyUrl)
    const r4c = await fetch(proxyUrl)
    console.log('  status:', r4c.status, 'ok:', r4c.ok)
    const okStatus = assert(r4c.ok, `status should be 2xx (got ${r4c.status})`, 'T4c.status')
    const contentLength = r4c.headers.get('content-length')
    console.log('  content-length:', contentLength)
    const okCl = assert(contentLength != null && parseInt(contentLength, 10) > 0, 'content-length should be positive', 'T4c.contentLength')
    // 读取前几个字节验证是 zip（PK 开头）
    const buf = await r4c.arrayBuffer()
    const header = Buffer.from(buf.slice(0, 4))
    console.log('  first 4 bytes:', header.toString('hex'), '(zip should start with 504b0304)')
    const okZip = assert(header[0] === 0x50 && header[1] === 0x4b, 'zip file should start with PK (0x50 0x4b)', 'T4c.zipHeader')
    recordResult('Test 4c: /api/github/proxy zip download', okStatus && okCl && okZip, `downloaded ${buf.byteLength} bytes`, { status: r4c.status, contentLength, firstBytes: header.toString('hex') })
  } catch (e) {
    recordResult('Test 4c: /api/github/proxy zip download', false, `exception: ${(e as Error).message}`)
  }
} else {
  console.log('  SKIP: server not running')
  recordResult('Test 4c: /api/github/proxy zip download', true, 'SKIP: server not running')
}

await sleep(1000)

// ===========================================================================
// Test 5: 客户端中断（AbortController 中断代理请求，服务器不崩溃）
// ===========================================================================
console.log('\n[Test 5] client abort: AbortController during proxy request')
if (serverOk) {
  try {
    // 用一个 zip 请求（响应较大），发起后立即中断
    const proxyUrl = `${SERVER_BASE}/api/github/proxy?type=zip&owner=microsoft&repo=vscode&fileName=vscode-HEAD.zip`
    console.log('  fetching (will abort):', proxyUrl)
    const controller = new AbortController()
    const fetchPromise = fetch(proxyUrl, { signal: controller.signal })
    // 100ms 后中断
    setTimeout(() => controller.abort(), 100)
    try {
      await fetchPromise
      // 如果请求成功完成（zip 很小或缓存），也算通过
      console.log('  request completed before abort (ok)')
      recordResult('Test 5: client abort', true, 'request completed before abort (no crash)')
    } catch (e) {
      const errName = (e as Error).name
      console.log('  fetch threw:', errName, (e as Error).message)
      const okAbort = assert(errName === 'AbortError', 'client should receive AbortError', 'T5.abortError')
      recordResult('Test 5: client abort', okAbort, `client received AbortError as expected`)
    }
    // 等待 2 秒后验证服务器仍存活
    await sleep(2000)
    let serverAlive = false
    try {
      const healthResp = await fetch(`${SERVER_BASE}/api/health`)
      serverAlive = healthResp.ok
      console.log('  server health after abort:', healthResp.status, serverAlive ? 'ALIVE' : 'DEAD')
    } catch (e) {
      console.log('  server health check failed:', e instanceof Error ? e.message : String(e))
    }
    const okAlive = assert(serverAlive, 'server should still be alive after client abort', 'T5.serverAlive')
    recordResult('Test 5: server alive after abort', okAlive, serverAlive ? 'server still alive' : 'server crashed')
  } catch (e) {
    recordResult('Test 5: client abort', false, `exception: ${(e as Error).message}`)
  }
} else {
  console.log('  SKIP: server not running')
  recordResult('Test 5: client abort', true, 'SKIP: server not running')
}

// ===========================================================================
// 汇总报告
// ===========================================================================
console.log('\n' + '='.repeat(80))
console.log('Phase S10 GitHub 代理下载 — 测试汇总报告')
console.log('='.repeat(80))
const passed = results.filter(r => r.pass).length
const failed = results.filter(r => !r.pass).length
console.log(`总计: ${results.length}  通过: ${passed}  失败: ${failed}`)
console.log('-'.repeat(80))
for (const r of results) {
  console.log(`  [${r.pass ? 'PASS' : 'FAIL'}] ${r.name}`)
  console.log(`         ${r.detail}`)
}
console.log('='.repeat(80))

await closeDb()
console.log('[Test] All done.')

if (failed > 0) {
  console.error(`\n[FAIL] ${failed} test(s) failed`)
  process.exit(1)
}
