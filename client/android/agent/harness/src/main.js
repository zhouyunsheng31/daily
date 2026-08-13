'use strict'

/**
 * Daily Agent Harness · stdio JSON-RPC 桥（M0-2 spike）
 *
 * 协议（单一事实源见 shared/agent-bridge-contract/bridge.schema.json）：
 * - 输入（stdin，每行一个 JSON）：{"jsonrpc":"2.0","id":N,"method":"session.turn","params":{...}}
 * - 输出（stdout，每行一个 JSON）：
 *    通知：{"jsonrpc":"2.0","method":"event","params":{"conversationId":...,"event":{...}}}
 *    响应：{"jsonrpc":"2.0","id":N,"result":{...}} / {"jsonrpc":"2.0","id":N,"error":{code,message}}
 * - 诊断日志只走 stderr（不污染 stdout 协议流）。
 *
 * 方法：
 * - ping
 * - session.turn {conversationId, text, thinking?}
 * - session.abort {conversationId}
 * - session.dispose {conversationId}
 * - status
 *
 * 事件转发：pi session.subscribe 事件 → event 通知（字段映射为 WebOsChatEvent 词汇）。
 */

const readline = require('readline')
const { initHarness, createConversationManager } = require('./core')

/** pi 事件 → 桥事件（WebOsChatEvent 词汇） */
function mapPiEvent(raw) {
  const e = raw || {}
  switch (e.type) {
    case 'delta':
      return { type: 'delta', content: e.text || e.content || '' }
    case 'thinking':
      return { type: 'thinking', content: e.text || e.content || '' }
    case 'tool_start':
      return { type: 'tool_start', tool: e.tool || e.name || '' }
    case 'tool_update':
      return { type: 'tool_update', tool: e.tool || e.name || '', content: e.text || e.content || '' }
    case 'tool_end':
      return { type: 'tool_end', tool: e.tool || e.name || '', ok: e.ok !== false }
    case 'agent_end':
      return { type: 'done', usage: null, raw: e }
    case 'error':
      return { type: 'error', code: e.code || 'PI_ERROR', message: e.message || String(e.error || '') }
    default:
      return { type: e.type || 'unknown', ...e }
  }
}

async function main() {
  const baseUrl = process.env.BYOK_BASE_URL
  const apiKey = process.env.BYOK_API_KEY
  if (!baseUrl || !apiKey) {
    console.error('[harness] BYOK_BASE_URL / BYOK_API_KEY env required')
    process.exit(2)
  }

  const services = await initHarness({ baseUrl, apiKey, modelId: process.env.BYOK_MODEL_ID || 'deepseek-v4-flash' })
  const manager = createConversationManager(services, {})

  const rl = readline.createInterface({ input: process.stdin, terminal: false })
  let nextId = 1
  const pending = new Map()

  function send(obj) {
    process.stdout.write(JSON.stringify(obj) + '\n')
  }

  function sendEvent(conversationId, event) {
    send({ jsonrpc: '2.0', method: 'event', params: { conversationId, event } })
  }

  rl.on('line', (line) => {
    const trimmed = line.trim()
    if (!trimmed) return
    let msg
    try { msg = JSON.parse(trimmed) } catch (e) {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error: ' + e.message } })
      return
    }
    const id = typeof msg.id === 'number' ? msg.id : null
    const params = msg.params || {}
    const conversationId = typeof params.conversationId === 'string' && params.conversationId ? params.conversationId.slice(0, 128) : 'default'

    switch (msg.method) {
      case 'ping':
        send({ jsonrpc: '2.0', id, result: { ok: true, pid: process.pid, sessions: manager.count() } })
        break

      case 'session.turn': {
        const text = typeof params.text === 'string' ? params.text : ''
        if (!text) {
          send({ jsonrpc: '2.0', id, error: { code: -32602, message: 'params.text required' } })
          break
        }
        const thinking = typeof params.thinking === 'string' ? params.thinking : undefined
        send({ jsonrpc: '2.0', id, result: { accepted: true, conversationId } })
        manager.subscribe(conversationId, (event) => sendEvent(conversationId, mapPiEvent(event)))
        manager.turn(conversationId, text, { thinking }).catch((err) => {
          sendEvent(conversationId, {
            type: 'error',
            code: err && err.code ? err.code : 'TURN_FAILED',
            message: err && err.message ? err.message : String(err),
          })
        })
        break
      }

      case 'session.abort': {
        const ok = manager.abort(conversationId)
        send({ jsonrpc: '2.0', id, result: { ok } })
        break
      }

      case 'session.dispose': {
        manager.dispose(conversationId).then(() => {
          send({ jsonrpc: '2.0', id, result: { ok: true } })
        }).catch((err) => {
          send({ jsonrpc: '2.0', id, error: { code: -32603, message: err.message } })
        })
        break
      }

      case 'status': {
        const mem = process.memoryUsage()
        send({ jsonrpc: '2.0', id, result: { pid: process.pid, sessions: manager.count(), rss: mem.rss, heapUsed: mem.heapUsed } })
        break
      }

      default:
        send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'method not found: ' + msg.method } })
    }
  })

  process.on('SIGTERM', async () => {
    await manager.disposeAll()
    process.exit(0)
  })
  process.on('SIGINT', async () => {
    await manager.disposeAll()
    process.exit(0)
  })

  console.error('[harness] ready pid=' + process.pid)
}

main().catch((err) => {
  console.error('[harness] fatal:', err)
  process.exit(1)
})