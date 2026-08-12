import { readFileSync } from 'fs'
import { resolve } from 'path'
import { callGitHub } from '../src/utils/searchApi.js'
import { getSearchKey } from '../src/db/aiSettingsStore.js'
import { initDb, closeDb } from '../src/db/connection.js'

try {
  const envContent = readFileSync(resolve(process.cwd(), '.env'), 'utf-8')
  for (const line of envContent.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i > 0 && !process.env[t.substring(0, i).trim()]) process.env[t.substring(0, i).trim()] = t.substring(i + 1).trim()
  }
} catch {}

await initDb()
const key = await getSearchKey('github')
console.log('=== search_code WITHOUT language param ===')
const r1 = await callGitHub({ mode: 'search_code', query: 'callGitHub', perPage: 2 }, key)
console.log('  total:', r1.total, 'items:', r1.items?.length)
if (r1.items?.length && r1.items.length > 0) {
  const item = r1.items[0] as any
  console.log('  first:', item.name, 'in', item.repository?.fullName)
  console.log('  has repository field:', !!item.repository, ', has repo field:', !!item.repo)
}
await new Promise(r => setTimeout(r, 8000))
console.log('=== search_code WITH language param (should be 0 due to bug) ===')
const r2 = await callGitHub({ mode: 'search_code', query: 'callGitHub', language: 'TypeScript', perPage: 2 }, key)
console.log('  total:', r2.total, 'items:', r2.items?.length)
console.log('')
console.log('=== CONCLUSION ===')
console.log('  Without language: works (total=' + r1.total + ')')
console.log('  With language: BROKEN (total=' + r2.total + ', should be >0)')
console.log('  Bug confirmed: language param + URLSearchParams encodes + as %2B')
await closeDb()
