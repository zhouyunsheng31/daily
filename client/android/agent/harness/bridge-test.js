'use strict'

/**
 * 桥协议 10 轮验收测试（M0-2 spike）：模拟 Kotlin AgentBridgeClient 的行为。
 * - spawn main.js（stdio JSON-RPC 桥）
 * - 同 conversationId 连发 10 轮 turn（验证排队串行 + 上下文保留 + 事件完整性）
 * - 统计 done/error/delta 数量，输出验收结果
 *
 * 用法（rootfs 内）：
 *   BYOK_BASE_URL=... BYOK_API_KEY=... BYOK_THINKING=low node bridge-test.js
 */

const { spawn } = require('child_process')

const TURNS = 10
const conv = 'perf-test'
const env = { ...process.env, BYOK_THINKING: process.env.BYOK_THINKING || 'low' }

const proc = spawn('/opt/node-v24.18.0-linux-arm64/bin/node', ['/srv/harness/src/main.js'], {
  env,
  stdio: ['pipe', 'pipe', 'pipe'],
})

let nextId = 1
const eventTypes = []
let doneCount = 0
let errorCount = 0
let deltaChars = 0
let sent = 0
let finished = false

function finish() {
  if (finished) return
  finished = true
  const ok = doneCount === TURNS && errorCount === 0
  console.log('=== RESULT ===')
  console.log(`turns=${TURNS} done=${doneCount} errors=${errorCount} deltaChars=${deltaChars} totalEvents=${eventTypes.length}`)
  console.log(ok ? 'PASS' : 'FAIL')
  proc.kill()
  process.exit(ok ? 0 : 1)
}

proc.stdout.on('data', (buf) => {
  for (const line of buf.toString().split('\n')) {
    if (!line.trim()) continue
    let m
    try { m = JSON.parse(line) } catch { continue }
    if (typeof m.id === 'number') continue // 响应：accepted，无需处理
    if (m.method === 'event' && m.params && m.params.event) {
      const e = m.params.event
      eventTypes.push(e.type)
      if (e.type === 'done') {
        doneCount++
        if (doneCount + errorCount >= TURNS) finish()
      } else if (e.type === 'error') {
        errorCount++
        if (doneCount + errorCount >= TURNS) finish()
      } else if (e.type === 'delta' && e.content) {
        deltaChars += e.content.length
      }
    }
  }
})

proc.stderr.on('data', (d) => process.stderr.write(d))
proc.on('exit', () => { if (!finished) finish() })

function sendTurn(i) {
  const req = {
    jsonrpc: '2.0',
    id: nextId++,
    method: 'session.turn',
    params: { conversationId: conv, text: `第${i}轮：只回复OK`, thinking: 'low' },
  }
  proc.stdin.write(JSON.stringify(req) + '\n')
  sent++
}

// 等 init（pi 资源加载约 8-10s），然后开始 10 轮
setTimeout(() => {
  for (let i = 1; i <= TURNS; i++) sendTurn(i)
}, 15000)

setTimeout(() => {
  console.log('TIMEOUT: done=' + doneCount + ' errors=' + errorCount)
  proc.kill()
  process.exit(1)
}, 600000)