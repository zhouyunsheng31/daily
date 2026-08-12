// ============================================================================
// PhoneBuddy 搜索测试 - 使用项目自己的搜索工具
// 运行：cd f:\allmylife\event\server && npx tsx test/search-phonebuddy.ts
// ============================================================================

import { readFileSync } from 'fs'
import { resolve } from 'path'
import { callGitHub, callBocha, callAcademicSearch } from '../src/utils/searchApi.js'
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
  console.log('PhoneBuddy 搜索测试 — 使用 Living Dashboard 自研搜索工具')
  console.log('='.repeat(80))

  await initDb()

  const githubKey = await getSearchKey('github')
  const bochaKey = await getSearchKey('bocha')
  const s2Key = await getSearchKey('semanticScholar')

  console.log(`\n[Keys] GitHub: ${githubKey ? '✓ 已配置' : '✗ 未配置'}`)
  console.log(`[Keys] Bocha (网页搜索): ${bochaKey ? '✓ 已配置' : '✗ 未配置'}`)
  console.log(`[Keys] Semantic Scholar (学术搜索): ${s2Key ? '✓ 已配置' : '✗ 未配置'}`)

  // =========================================================================
  // 1. GitHub 仓库搜索
  // =========================================================================
  console.log('\n' + '='.repeat(80))
  console.log('【1/3】GitHub 仓库搜索: "PhoneBuddy"')
  console.log('='.repeat(80))

  if (githubKey) {
    try {
      const result = await callGitHub(
        { mode: 'search_repos', query: 'PhoneBuddy', perPage: 10, sort: 'stars' },
        githubKey
      )
      console.log(`\n找到 ${result.total} 个仓库，展示前 ${result.items?.length ?? 0} 个:\n`)
      if (result.items && result.items.length > 0) {
        result.items.forEach((repo: any, i: number) => {
          console.log(`${i + 1}. ${repo.fullName}`)
          console.log(`   ⭐ ${repo.stargazersCount}  🍴 ${repo.forksCount}  📝 ${repo.language ?? 'N/A'}`)
          console.log(`   🔗 ${repo.htmlUrl}`)
          if (repo.description) console.log(`   ${repo.description}`)
          if (repo.topics && repo.topics.length > 0) {
            console.log(`   🏷️  ${repo.topics.slice(0, 5).join(', ')}`)
          }
          console.log()
        })
      } else {
        console.log('  未找到相关仓库')
      }
    } catch (e) {
      console.error('  GitHub 搜索失败:', (e as Error).message)
    }
  } else {
    console.log('  跳过：未配置 GitHub API Key')
  }

  await sleep(2000)

  // =========================================================================
  // 2. 学术论文搜索
  // =========================================================================
  console.log('='.repeat(80))
  console.log('【2/3】学术论文搜索: "PhoneBuddy"')
  console.log('='.repeat(80))

  if (s2Key) {
    try {
      const result = await callAcademicSearch(
        { query: 'PhoneBuddy', limit: 10 },
        s2Key
      )
      console.log(`\n找到 ${result.total} 篇论文，展示前 ${result.papers?.length ?? 0} 篇:\n`)
      if (result.papers && result.papers.length > 0) {
        result.papers.forEach((paper: any, i: number) => {
          console.log(`${i + 1}. ${paper.title}`)
          console.log(`   📅 ${paper.year}  📊 引用: ${paper.citationCount}  📍 ${paper.venue ?? 'N/A'}`)
          if (paper.authors && paper.authors.length > 0) {
            console.log(`   👤 ${paper.authors.slice(0, 3).join(', ')}${paper.authors.length > 3 ? ' 等' : ''}`)
          }
          if (paper.openAccessPdf?.url) {
            console.log(`   📄 PDF: ${paper.openAccessPdf.url}`)
          }
          if (paper.externalIds?.DOI) {
            console.log(`   🔗 DOI: ${paper.externalIds.DOI}`)
          }
          if (paper.externalIds?.ArXiv) {
            console.log(`   📄 ArXiv: ${paper.externalIds.ArXiv}`)
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
        console.log('  未找到相关论文')
      }
    } catch (e) {
      console.error('  学术搜索失败:', (e as Error).message)

      // 降级到 ArXiv（不需要 Key）
      console.log('\n  尝试降级到 ArXiv 搜索（不需要 Key）...')
      try {
        const arxivResult = await callAcademicSearch(
          { query: 'PhoneBuddy', limit: 10, mode: 'latest' }
        )
        console.log(`\nArXiv 找到 ${arxivResult.total} 篇论文，展示前 ${arxivResult.papers?.length ?? 0} 篇:\n`)
        if (arxivResult.papers && arxivResult.papers.length > 0) {
          arxivResult.papers.forEach((paper: any, i: number) => {
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
          console.log('  ArXiv 也未找到相关论文')
        }
      } catch (e2) {
        console.error('  ArXiv 搜索也失败:', (e2 as Error).message)
      }
    }
  } else {
    console.log('  Semantic Scholar Key 未配置，尝试 ArXiv（不需要 Key）...')
    try {
      const arxivResult = await callAcademicSearch(
        { query: 'PhoneBuddy', limit: 10, mode: 'latest' }
      )
      console.log(`\nArXiv 找到 ${arxivResult.total} 篇论文，展示前 ${arxivResult.papers?.length ?? 0} 篇:\n`)
      if (arxivResult.papers && arxivResult.papers.length > 0) {
        arxivResult.papers.forEach((paper: any, i: number) => {
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
  }

  await sleep(2000)

  // =========================================================================
  // 3. 网页搜索
  // =========================================================================
  console.log('='.repeat(80))
  console.log('【3/3】网页搜索: "PhoneBuddy"')
  console.log('='.repeat(80))

  if (bochaKey) {
    try {
      const result = await callBocha(
        { query: 'PhoneBuddy', count: 10, summary: true },
        bochaKey
      )
      console.log(`\n找到约 ${result.total} 个结果，展示前 ${result.results?.length ?? 0} 个:\n`)
      if (result.results && result.results.length > 0) {
        result.results.forEach((hit: any, i: number) => {
          console.log(`${i + 1}. ${hit.title}`)
          console.log(`   🔗 ${hit.url}`)
          if (hit.siteName) console.log(`   🌐 ${hit.siteName}`)
          if (hit.datePublished) console.log(`   📅 ${hit.datePublished}`)
          if (hit.summary) {
            console.log(`   💡 ${hit.summary}`)
          } else if (hit.snippet) {
            console.log(`   📝 ${hit.snippet}`)
          }
          console.log()
        })
      } else {
        console.log('  未找到相关网页')
      }
    } catch (e) {
      console.error('  网页搜索失败:', (e as Error).message)
    }
  } else {
    console.log('  跳过：未配置 Bocha API Key')
  }

  console.log('='.repeat(80))
  console.log('搜索完成！')
  console.log('='.repeat(80))

  await closeDb()
}

main().catch(console.error)
