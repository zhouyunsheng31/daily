// ============================================================================
// PhoneBuddy 搜索测试 v2 - 补充搜索
// 运行：cd f:\allmylife\event\server && npx tsx test/search-phonebuddy-v2.ts
// ============================================================================

import { readFileSync } from 'fs'
import { resolve } from 'path'
import { callBocha, callAcademicSearch } from '../src/utils/searchApi.js'
import { getSearchKey } from '../src/db/aiSettingsStore.js'
import { initDb, closeDb } from '../src/db/connection.js'

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
  console.log('[Info] .env file loaded')
} catch (e) {
  console.warn('[Warn] .env file not loaded:', e instanceof Error ? e.message : String(e))
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function main() {
  console.log('='.repeat(80))
  console.log('PhoneBuddy 补充搜索 — GitHub 仓库 + ArXiv 论文')
  console.log('='.repeat(80))

  await initDb()
  const bochaKey = await getSearchKey('bocha')

  // =========================================================================
  // 1. 用网页搜索找 GitHub 仓库
  // =========================================================================
  console.log('\n' + '='.repeat(80))
  console.log('【1/2】网页搜索: "PhoneBuddy GitHub" (找 GitHub 仓库)')
  console.log('='.repeat(80))

  if (bochaKey) {
    try {
      const result = await callBocha(
        { query: 'PhoneBuddy GitHub', count: 10, summary: true },
        bochaKey
      )
      console.log(`\n找到约 ${result.total} 个结果，展示前 ${result.results?.length ?? 0} 个:\n`)
      if (result.results && result.results.length > 0) {
        const githubResults = result.results.filter((h: any) =>
          h.url?.includes('github.com')
        )
        console.log(`其中 GitHub 链接: ${githubResults.length} 个\n`)
        result.results.forEach((hit: any, i: number) => {
          const isGithub = hit.url?.includes('github.com')
          console.log(`${i + 1}. ${isGithub ? '🐙 ' : ''}${hit.title}`)
          console.log(`   🔗 ${hit.url}`)
          if (hit.siteName) console.log(`   🌐 ${hit.siteName}`)
          if (hit.summary) {
            console.log(`   💡 ${hit.summary.slice(0, 200)}${hit.summary.length > 200 ? '...' : ''}`)
          } else if (hit.snippet) {
            console.log(`   📝 ${hit.snippet.slice(0, 200)}${hit.snippet.length > 200 ? '...' : ''}`)
          }
          console.log()
        })
      }
    } catch (e) {
      console.error('  搜索失败:', (e as Error).message)
    }
  }

  await sleep(2000)

  // =========================================================================
  // 2. ArXiv 学术搜索（不需要 Key）
  // =========================================================================
  console.log('='.repeat(80))
  console.log('【2/2】ArXiv 学术搜索: "PhoneBuddy"')
  console.log('='.repeat(80))

  try {
    const result = await callAcademicSearch(
      { query: 'PhoneBuddy', limit: 10, mode: 'latest' }
    )
    console.log(`\n找到 ${result.total} 篇论文，展示前 ${result.papers?.length ?? 0} 篇:\n`)
    if (result.papers && result.papers.length > 0) {
      result.papers.forEach((paper: any, i: number) => {
        console.log(`${i + 1}. ${paper.title}`)
        console.log(`   📅 ${paper.publicationDate ?? paper.year}  📍 ${paper.venue}`)
        if (paper.authors && paper.authors.length > 0) {
          console.log(`   👤 ${paper.authors.slice(0, 3).join(', ')}${paper.authors.length > 3 ? ' 等' : ''}`)
        }
        if (paper.openAccessPdf?.url) {
          console.log(`   📄 PDF: ${paper.openAccessPdf.url}`)
        }
        if (paper.abstract) {
          const abs = paper.abstract.length > 200
            ? paper.abstract.slice(0, 200) + '...'
            : paper.abstract
          console.log(`   📝 ${abs}`)
        }
        console.log()
      })
    } else {
      console.log('  ArXiv 未找到相关论文')
    }
  } catch (e) {
    console.error('  ArXiv 搜索失败:', (e as Error).message)
  }

  console.log('='.repeat(80))
  console.log('补充搜索完成！')
  console.log('='.repeat(80))

  await closeDb()
}

main().catch(console.error)
