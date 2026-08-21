// 临时：查询生产 webos_vision_usage（SQLite）视觉调用记录 V2
// 服务器运行：cd /root/daily/server && npx tsx tmp-vision-check.mts
import fs from 'fs'
for (const line of fs.readFileSync('/root/daily/server/.env', 'utf8').split('\n')) {
  const i = line.indexOf('=')
  if (i > 0 && !line.startsWith('#')) process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim()
}
const { initDb, query } = await import('./src/db/connection.js')
await initDb()

const cols = await query('PRAGMA table_info(webos_vision_usage)')
console.log('== 列 ==', cols.rows.map((c: { name: unknown }) => c.name).join(', '))

const dist = await query('SELECT status, COUNT(*) n FROM webos_vision_usage GROUP BY status ORDER BY n DESC')
console.log('== 状态分布 ==')
console.table(dist.rows)

console.log('== 所有记录 ==')
const all = await query('SELECT * FROM webos_vision_usage ORDER BY rowid ASC')
for (const r of all.rows) {
  const record = r as Record<string, unknown>
  const t = record.created_at
  console.log(`[${typeof t === 'number' ? new Date(t).toISOString() : String(t)}] status=${record.status} kind=${record.kind} media=${record.media_count} trigger=${record.trigger} req=${record.request_id}`)
  for (const k of Object.keys(record)) {
    if (['id', 'created_at', 'status', 'kind', 'media_count', 'trigger', 'request_id', 'conversation_id'].includes(k)) continue
    const v = record[k]
    if (v !== null && v !== '' && v !== undefined) {
      console.log(`    ${k} = ${String(v).slice(0, 220)}`)
    }
  }
  console.log('    conversation_id =', record.conversation_id)
}
process.exit(0)