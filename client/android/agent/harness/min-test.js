'use strict'
const { spawn } = require('child_process')
const proc = spawn(process.execPath, ['/srv/harness/src/main.js'], {
  env: { ...process.env, BYOK_THINKING: 'low' },
  stdio: ['pipe', 'pipe', 'pipe'],
})
let nextId = 1
const pending = new Map()
function req(method, params, timeoutMs) {
  return new Promise((resolve, reject) => {
    const id = nextId++
    const t = setTimeout(() => { pending.delete(id); reject(new Error('timeout ' + method)) }, timeoutMs)
    pending.set(id, { resolve: (v) => { clearTimeout(t); resolve(v) } })
    console.error('[min] send ' + method + ' id=' + id)
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params: params || {} }) + '\n', () => console.error('[min] written id=' + id))
  })
}
let buf = ''
proc.stdout.on('data', (d) => {
  buf += d.toString()
  const lines = buf.split('\n')
  buf = lines.pop()
  for (const line of lines) {
    if (!line.trim()) continue
    let m
    try { m = JSON.parse(line) } catch { console.error('[min] bad json: ' + line.slice(0, 80)); continue }
    console.error('[min] got id=' + m.id + ' method=' + m.method)
    if (typeof m.id === 'number' && pending.has(m.id)) {
      pending.get(m.id).resolve(m.result || m.error || null)
      pending.delete(m.id)
    }
  }
})
proc.stderr.on('data', (d) => console.error('[main] ' + d.toString().trim()))
async function main() {
  await new Promise((r) => setTimeout(r, 15000))
  const p = await req('ping', {}, 15000)
  console.error('[min] ping ok=' + (p && p.ok))
  const st = await req('status', {}, 15000)
  console.error('[min] status rss=' + (st && st.rss))
  proc.kill()
  process.exit(0)
}
main().catch((e) => { console.error('[min] FAILED ' + e.message); proc.kill(); process.exit(1) })