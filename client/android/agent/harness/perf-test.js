'use strict'

/**
 * M0-3 性能实测脚本（真机 rootfs 内运行）。
 * 测：① 冷启动（spawn → harness ready → ping RTT）
 *    ② 单会话 12 轮：首 token 延迟 + 每轮 done 后 node RSS（会话上下文增长曲线）
 *    ③ 10 会话各 1 轮：多会话上下文下的常态 RSS
 * 结果输出 JSON 到 stdout（供落档 perf-reports/）。
 */

const { spawn } = require('child_process')

const TURNS_SINGLE = 12
const SESSIONS = 10
const env = { ...process.env, BYOK_THINKING: process.env.BYOK_THINKING || 'low' }

const MAIN_JS = process.env.HARNESS_MAIN || '/srv/harness/src/main.js'
const proc = spawn(process.execPath, [MAIN_JS], {
  env,
  stdio: ['pipe', 'pipe', 'pipe'],
})

const t0 = Date.now()
let nextId = 1
let readyAt = null
const pending = new Map() // id -> resolver
const lineBuf = { data: '', handlers: [] }
const errBuf = { data: '', handlers: [] }

function onLine(handler) {
  lineBuf.handlers.push(handler)
}

function onErrLine(handler) {
  errBuf.handlers.push(handler)
}

function feedLines(chunk, source) {
  const buf = source === 'out' ? lineBuf : errBuf
  buf.data += chunk.toString()
  const lines = buf.data.split('\n')
  buf.data = lines.pop()
  for (const line of lines) {
    if (!line.trim()) continue
    for (const h of buf.handlers.slice()) {
      try { h(line, source) } catch (e) { /* ignore */ }
    }
  }
}

proc.stdout.on('data', (d) => feedLines(d, 'out'))
proc.stderr.on('data', (d) => feedLines(d, 'err'))

function request(method, params, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const id = nextId++
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error('request timeout: ' + method))
    }, timeoutMs)
    pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v) } })
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params: params || {} }) + '\n')
  })
}

onLine((line, source) => {
  let m
  try { m = JSON.parse(line) } catch { return }
  if (source === 'out' && typeof m.id === 'number' && pending.has(m.id)) {
    pending.get(m.id).resolve(m.result || m.error || null)
    pending.delete(m.id)
  }
})

/** 等待指定类型的事件（本轮 conversationId） */
function waitEvent(convId, type, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout waiting ' + type)), timeoutMs)
    const h = (line, source) => {
      if (source !== 'out') return
      let m
      try { m = JSON.parse(line) } catch { return }
      if (m.method === 'event' && m.params && m.params.conversationId === convId && m.params.event && m.params.event.type === type) {
        clearTimeout(timer)
        lineBuf.handlers.splice(lineBuf.handlers.indexOf(h), 1)
        resolve(m.params.event)
      }
    }
    onLine(h)
  })
}

/** 等待 done 或 error（本轮结束），返回事件 */
function waitTurnEnd(convId, timeoutMs = 90000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout waiting turn end')), timeoutMs)
    const h = (line, source) => {
      if (source !== 'out') return
      let m
      try { m = JSON.parse(line) } catch { return }
      if (m.method === 'event' && m.params && m.params.conversationId === convId && m.params.event) {
        const t = m.params.event.type
        if (t === 'done' || t === 'error') {
          clearTimeout(timer)
          lineBuf.handlers.splice(lineBuf.handlers.indexOf(h), 1)
          resolve(m.params.event)
        }
      }
    }
    onLine(h)
  })
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

async function main() {
  // ① 冷启动：等 ready（stderr）
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('ready timeout')), 60000)
    const h = (line, source) => {
      if (source === 'err' && line.includes('[harness] ready')) {
        clearTimeout(timer)
        errBuf.handlers.splice(errBuf.handlers.indexOf(h), 1)
        readyAt = Date.now()
        resolve()
      }
    }
    onErrLine(h)
  })
  const coldStartMs = readyAt - t0

  // ping RTT
  const pingT0 = Date.now()
  const pingRes = await request('ping')
  const pingRttMs = Date.now() - pingT0
  if (!pingRes || pingRes.ok !== true) throw new Error('ping failed')

  // ② 单会话 12 轮：首 token + RSS 曲线
  const conv = 'perf-main'
  const turns = []
  for (let i = 1; i <= TURNS_SINGLE; i++) {
    const tSend = Date.now()
    await request('session.turn', { conversationId: conv, text: `第${i}轮：只回复OK`, thinking: 'low' })
    let firstTokenAt = null
    const deltaPromise = waitEvent(conv, 'delta', 30000).then(() => { firstTokenAt = Date.now() }).catch(() => {})
    await waitTurnEnd(conv)
    await deltaPromise
    const st = await request('status')
    turns.push({
      turn: i,
      firstTokenMs: firstTokenAt ? firstTokenAt - tSend : null,
      rssMb: st && typeof st.rss === 'number' ? Math.round(st.rss / 1024 / 1024) : null,
    })
  }

  // ③ 10 会话各 1 轮（短回复）
  for (let s = 1; s <= SESSIONS; s++) {
    const c = 'perf-s' + s
    await request('session.turn', { conversationId: c, text: '回复OK', thinking: 'low' })
    await waitTurnEnd(c)
  }
  const finalSt = await request('status')

  console.log(JSON.stringify({
    coldStartMs,
    pingRttMs,
    turns,
    sessions: SESSIONS,
    finalRssMb: finalSt && typeof finalSt.rss === 'number' ? Math.round(finalSt.rss / 1024 / 1024) : null,
    finalHeapMb: finalSt && typeof finalSt.heapUsed === 'number' ? Math.round(finalSt.heapUsed / 1024 / 1024) : null,
  }, null, 2))

  proc.kill()
  process.exit(0)
}

main().catch((e) => {
  console.error('PERF_FAILED:', e.message)
  proc.kill()
  process.exit(1)
})