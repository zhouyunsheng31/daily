// ============================================================================
// 补丁测试：重跑失败的 Test 2 (search_code) 和 Test 5a/5b (download_release)
// 新增：大资产 downloadUrl 测试
// 运行：cd f:\allmylife\event\server && npx tsx test/search-github-test-fix.ts
// ============================================================================

import { readFileSync } from 'fs'
import { resolve } from 'path'
import { callGitHub } from '../src/utils/searchApi.js'
import { getSearchKey } from '../src/db/aiSettingsStore.js'
import { initDb, closeDb } from '../src/db/connection.js'

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

interface TestResult { name: string; pass: boolean; detail: string; sample?: unknown }
const results: TestResult[] = []

function assert(cond: boolean, msg: string): boolean {
  if (!cond) { console.error('  ASSERT FAILED:', msg); return false }
  console.log('  OK:', msg)
  return true
}

function recordResult(name: string, pass: boolean, detail: string, sample?: unknown) {
  results.push({ name, pass, detail, sample })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name}: ${detail}`)
}

await initDb()
const key = await getSearchKey('github')
console.log('[Test] got key:', key ? `${key.slice(0, 8)}...${key.slice(-4)} (len=${key.length})` : 'null')
if (!key) { console.error('NO KEY'); await closeDb(); process.exit(1) }

// ===========================================================================
// Test 2 (fix): search_code with "callGitHub" language:TypeScript
// ===========================================================================
console.log('\n[Test 2-fix] search_code: "callGitHub" (language: TypeScript)')
try {
  const r2 = await callGitHub({ mode: 'search_code', query: 'callGitHub', language: 'TypeScript', perPage: 3 }, key)
  console.log('  total:', r2.total, 'items:', r2.items?.length)
  if (r2.items && r2.items.length > 0) {
    const item = r2.items[0] as any
    console.log('  first item:', JSON.stringify(item, null, 2))
    const okName = assert(typeof item.name === 'string' && item.name.length > 0, 'name should be non-empty string')
    const okPath = assert(typeof item.path === 'string' && item.path.length > 0, 'path should be non-empty string')
    const okHtmlUrl = assert(typeof item.htmlUrl === 'string' && item.htmlUrl.startsWith('https://'), 'htmlUrl should be string')

    // === Spec 偏差检查：spec 6.1 GithubCodeHit 定义是 repo: { fullName, htmlUrl } ===
    const hasRepo = typeof item.repo === 'object' && item.repo !== null
    const hasRepository = typeof item.repository === 'object' && item.repository !== null
    console.log(`  [Spec Check] item.repo exists: ${hasRepo}, item.repository exists: ${hasRepository}`)
    if (hasRepository && !hasRepo) {
      console.log('  [Spec DEVIATION] spec 6.1 GithubCodeHit.repo should be named "repo", but code returns "repository"')
    }
    const okRepoField = assert(hasRepo, 'SPEC 6.1: item.repo should exist (spec says repo, not repository)')

    let okRepoFullName = false, okRepoHtmlUrl = false
    if (hasRepository) {
      okRepoFullName = assert(typeof item.repository.fullName === 'string' && item.repository.fullName.length > 0, 'repository.fullName should be non-empty string (mapped from repository.full_name)')
      okRepoHtmlUrl = assert(typeof item.repository.htmlUrl === 'string' && item.repository.htmlUrl.startsWith('https://'), 'repository.htmlUrl should be string (mapped from repository.html_url)')
    }
    // 反向检查：不应残留 snake_case
    const noSnake = assert(
      item.repository?.full_name === undefined && item.repository?.html_url === undefined,
      'no snake_case leak in repository object',
    )
    recordResult('Test 2-fix: search_code', okName && okPath && okHtmlUrl && okRepoField && okRepoFullName && okRepoHtmlUrl && noSnake,
      hasRepository && !hasRepo ? 'SPEC DEVIATION: returns "repository" but spec 6.1 requires "repo"' : 'all assertions passed', item)
  } else {
    recordResult('Test 2-fix: search_code', false, 'no items returned')
  }
} catch (e) {
  recordResult('Test 2-fix: search_code', false, `exception: ${(e as Error).message}`)
}

await sleep(8000) // Code search 9 req/min

// ===========================================================================
// Test 5a (fix): download_release latest: owner=cli, repo=cli
// ===========================================================================
console.log('\n[Test 5a-fix] download_release latest: owner=cli, repo=cli')
try {
  const r5a = await callGitHub({ mode: 'download_release', owner: 'cli', repo: 'cli' }, key)
  console.log('  result keys:', Object.keys(r5a))
  console.log('  items:', r5a.items?.length, 'total:', r5a.total)
  const okMode = assert(r5a.mode === 'download_release', 'mode should be download_release')
  const okItems = assert(Array.isArray(r5a.items) && r5a.items.length === 1, 'items should be array with 1 release')
  if (r5a.items && r5a.items.length > 0) {
    const release = r5a.items[0] as any
    console.log('  release tagName:', release.tagName, 'fileName:', release.fileName?.slice(0, 60))
    console.log('  assets count:', release.assets?.length)
    const okTagName = assert(typeof release.tagName === 'string' && release.tagName.length > 0, 'tagName should be non-empty string (mapped from tag_name)')
    const okFileName = assert(typeof release.fileName === 'string', 'fileName should be string (mapped from name)')
    const okAssets = assert(Array.isArray(release.assets) && release.assets.length > 0, 'assets should be non-empty array')
    if (release.assets && release.assets.length > 0) {
      // 验证第一个 asset 的字段映射
      const asset = release.assets[0]
      console.log('  first asset:', JSON.stringify(asset, null, 2))
      const okAssetId = assert(typeof asset.id === 'number', 'asset.id should be number')
      const okAssetName = assert(typeof asset.name === 'string', 'asset.name should be string')
      const okAssetSize = assert(typeof asset.size === 'number', 'asset.size should be number')
      const okAssetUrl = assert(typeof asset.downloadUrl === 'string' && asset.downloadUrl.startsWith('https://'), 'asset.downloadUrl should be string (mapped from browser_download_url)')
      const noSnake = assert(asset.browser_download_url === undefined, 'no snake_case leak (browser_download_url should not exist)')
      recordResult('Test 5a-fix: download_release latest (cli/cli)', okMode && okItems && okTagName && okFileName && okAssets && okAssetId && okAssetName && okAssetSize && okAssetUrl && noSnake, 'all assertions passed', { tagName: release.tagName, assetsCount: release.assets.length, firstAsset: asset })

      // 找小资产（<1MB）测试 base64
      const smallAsset = release.assets.find((a: any) => a.size < 1_000_000 && a.size > 0)
      // 找大资产（≥1MB）测试 downloadUrl
      const largeAsset = release.assets.find((a: any) => a.size >= 1_000_000)

      if (smallAsset) {
        console.log(`\n[Test 5b-fix] download_release small asset: ${smallAsset.name} (${smallAsset.size}B, id=${smallAsset.id})`)
        await sleep(2500)
        try {
          const r5b = await callGitHub({ mode: 'download_release', owner: 'cli', repo: 'cli', assetId: smallAsset.id }, key)
          const dl = r5b.download
          console.log('  download:', JSON.stringify({ ...dl, content: dl?.content ? `<base64 len=${dl.content.length}>` : undefined }, null, 2))
          const okModeB = assert(r5b.mode === 'download_release', 'mode should be download_release')
          const okDownload = assert(!!dl, 'download should be defined')
          let okFileName = false, okSize = false, okContent = false, okDecode = false
          if (dl) {
            okFileName = assert(typeof dl.fileName === 'string' && dl.fileName.length > 0, 'download.fileName should be non-empty string')
            okSize = assert(typeof dl.size === 'number' && dl.size > 0, 'download.size should be positive number')
            okContent = assert(typeof dl.content === 'string' && dl.content.length > 0, 'small file (<1MB) should return base64 content')
            // 验证不应返回 downloadUrl（小文件应该返回 content 而不是 downloadUrl）
            const noUrl = assert(dl.downloadUrl === undefined || dl.downloadUrl === '', 'small file should NOT return downloadUrl (only content)')
            // 验证 base64 可解码且大小匹配
            if (dl.content) {
              try {
                const decoded = Buffer.from(dl.content, 'base64')
                console.log(`  decoded size: ${decoded.byteLength}B (should match ${dl.size})`)
                okDecode = assert(decoded.byteLength === dl.size, 'decoded base64 size should match reported size')
                // 解码后应为可读文本（checksums.txt 是文本）
                const text = decoded.toString('utf-8')
                console.log(`  decoded preview: ${JSON.stringify(text.slice(0, 100))}`)
                const okText = assert(text.length > 0, 'decoded content should be non-empty text')
                recordResult('Test 5b-fix: download_release small asset (base64)', okModeB && okDownload && okFileName && okSize && okContent && noUrl && okDecode && okText, 'all assertions passed', { ...dl, content: `<base64 len=${dl.content?.length}>` })
              } catch (e) {
                okDecode = assert(false, `base64 decode failed: ${(e as Error).message}`)
                recordResult('Test 5b-fix: download_release small asset (base64)', okModeB && okDownload && okFileName && okSize && okContent && okDecode, 'decode failed', { ...dl, content: `<base64 len=${dl.content?.length}>` })
              }
            } else {
              recordResult('Test 5b-fix: download_release small asset (base64)', okModeB && okDownload && okFileName && okSize && okContent, 'no content', dl)
            }
          } else {
            recordResult('Test 5b-fix: download_release small asset (base64)', false, 'no download object')
          }
        } catch (e) {
          recordResult('Test 5b-fix: download_release small asset (base64)', false, `exception: ${(e as Error).message}`)
        }
      } else {
        recordResult('Test 5b-fix: download_release small asset (base64)', false, 'no small asset (<1MB) found')
      }

      if (largeAsset) {
        console.log(`\n[Test 5c-fix] download_release large asset: ${largeAsset.name} (${largeAsset.size}B, id=${largeAsset.id})`)
        await sleep(2500)
        try {
          const r5c = await callGitHub({ mode: 'download_release', owner: 'cli', repo: 'cli', assetId: largeAsset.id }, key)
          const dl = r5c.download
          console.log('  download:', JSON.stringify({ ...dl, content: dl?.content ? `<base64 len=${dl.content.length}>` : undefined }, null, 2))
          const okModeC = assert(r5c.mode === 'download_release', 'mode should be download_release')
          const okDownload = assert(!!dl, 'download should be defined')
          let okFileName = false, okSize = false, okUrl = false, noContent = false
          if (dl) {
            okFileName = assert(typeof dl.fileName === 'string' && dl.fileName.length > 0, 'download.fileName should be non-empty string')
            okSize = assert(typeof dl.size === 'number' && dl.size >= 1_000_000, 'download.size should be >= 1MB')
            okUrl = assert(typeof dl.downloadUrl === 'string' && dl.downloadUrl.startsWith('https://'), 'large file (>=1MB) should return downloadUrl')
            // 大文件不应返回 content（应该返回 downloadUrl 而不是 content）
            noContent = assert(dl.content === undefined || dl.content === '', 'large file should NOT return base64 content')
            console.log(`  downloadUrl: ${dl.downloadUrl?.slice(0, 100)}...`)
            recordResult('Test 5c-fix: download_release large asset (downloadUrl)', okModeC && okDownload && okFileName && okSize && okUrl && noContent, 'all assertions passed', { ...dl, content: undefined })
          } else {
            recordResult('Test 5c-fix: download_release large asset (downloadUrl)', false, 'no download object')
          }
        } catch (e) {
          recordResult('Test 5c-fix: download_release large asset (downloadUrl)', false, `exception: ${(e as Error).message}`)
        }
      }
    } else {
      recordResult('Test 5a-fix: download_release latest (cli/cli)', false, 'no assets in latest release')
    }
  } else {
    recordResult('Test 5a-fix: download_release latest (cli/cli)', false, 'no items returned')
  }
} catch (e) {
  recordResult('Test 5a-fix: download_release latest (cli/cli)', false, `exception: ${(e as Error).message}`)
}

// ===========================================================================
// 汇总
// ===========================================================================
console.log('\n' + '='.repeat(80))
console.log('补丁测试汇总')
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
