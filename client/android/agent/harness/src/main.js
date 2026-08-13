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

/**
 * pi 事件 → 桥事件（WebOsChatEvent 词汇）。
 * 映射对齐 server/src/routes/webos.ts 的 subscribe 处理（唯一权威）：
 * - message_update.assistantMessageEvent 的 text_delta → delta、thinking_delta → thinking
 * - tool_execution_start/update/end → tool_start/tool_update/tool_end
 * - agent_end → done（含 usage 提取）
 * 返回 null = 忽略（turn_start/message_* 等结构事件不转发）。
 */
function mapPiEvent(raw) {
  const e = raw || {}
  switch (e.type) {
    case 'message_update': {
      const inner = e.assistantMessageEvent || {}
      if (inner.type === 'text_delta' && typeof inner.delta === 'string' && inner.delta) {
        return { kind: 'delta', content: inner.delta }
      }
      if (inner.type === 'thinking_delta' && typeof inner.delta === 'string' && inner.delta) {
        return { kind: 'thinking', content: inner.delta }
      }
      // toolcall_start/toolcall_delta：工具参数生成进度（M0-2 占位忽略，M1 补 tool_update 进度）
      return null
    }
    case 'tool_execution_start':
      return { kind: 'tool_start', tool: typeof e.toolName === 'string' ? e.toolName : (e.tool || e.name || '') }
    case 'tool_execution_update': {
      const tool = typeof e.toolName === 'string' ? e.toolName : ''
      const content = e.partialResult && e.partialResult.content
      if (Array.isArray(content)) {
        const text = content
          .map((p) => (p && p.type === 'text' && typeof p.text === 'string' ? p.text : ''))
          .join('')
          .trim()
        if (text) return { kind: 'tool_update', tool, content: text }
      }
      return null
    }
    case 'tool_execution_end':
      return { kind: 'tool_end', tool: typeof e.toolName === 'string' ? e.toolName : '', ok: !e.isError }
    case 'agent_end': {
      // pi 的 auto_retry 中间态（willRetry=true）不是最终状态：不发 done，等重试结果。
      // 对齐 webos.ts：stop=error 的最终态视为失败（不发 done，发 error）。
      if (e.willRetry === true) return null
      const msgs = Array.isArray(e.messages) ? e.messages : []
      const last = msgs[msgs.length - 1]
      if (last && last.role === 'assistant' && last.stopReason === 'error') {
        return { kind: 'error', code: 'PI_STOP_ERROR', message: typeof last.errorMessage === 'string' ? last.errorMessage : 'assistant stopped with error' }
      }
      return { kind: 'done', usage: extractUsage(e) }
    }
    case 'error':
      return { kind: 'error', code: e.code || 'PI_ERROR', message: e.message || String(e.error || '') }
    default:
      return null
  }
}

/** 从 agent_end 的 messages 提取最后一个 assistant 消息的用量 */
function extractUsage(e) {
  const msgs = Array.isArray(e.messages) ? e.messages : []
  const last = msgs.filter((m) => m && m.role === 'assistant').pop()
  if (!last || !last.usage) return null
  const u = last.usage
  return {
    totalTokens: typeof u.totalTokens === 'number' ? u.totalTokens : 0,
    model: typeof last.model === 'string' ? last.model : '',
    thinking: '',
    estimatedMinor: 0,
    actualMinor: 0,
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

  // delta/thinking 合并（120ms 窗口，同 webos.ts pushDelta/flushDelta 策略）：
  // DeepSeek medium/high 档思考产生海量 thinking_delta 碎片，逐条转发会让 Kotlin 端
  // 每事件全量渲染，事件数降一个数量级，内容与顺序不变（按事件拼接，合并等价）。
  const FLUSH_MS = 120
  let pendingDelta = null // { convId, kind, content }
  let flushTimer = null

  function flushPending() {
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    if (!pendingDelta) return
    const out = pendingDelta
    pendingDelta = null
    sendEvent(out.convId, { type: out.kind, content: out.content })
  }

  function pushMerged(convId, kind, content) {
    if (pendingDelta && pendingDelta.kind === kind && pendingDelta.convId === convId) {
      pendingDelta.content += content
    } else {
      flushPending()
      pendingDelta = { convId, kind, content }
    }
    if (!flushTimer) flushTimer = setTimeout(flushPending, FLUSH_MS)
  }

  /** pi 订阅回调：映射 + 合并后转发 */
  function forwardPiEvent(conversationId, rawEvent) {
    const mapped = mapPiEvent(rawEvent)
    if (!mapped) return
    if (mapped.kind === 'delta' || mapped.kind === 'thinking') {
      pushMerged(conversationId, mapped.kind, mapped.content)
      return
    }
    // 非增量事件（tool_*/done/error）先冲刷挂起增量，保持事件顺序
    flushPending()
    const { kind, ...rest } = mapped
    sendEvent(conversationId, { type: kind, ...rest })
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
        manager.subscribe(conversationId, (event) => forwardPiEvent(conversationId, event))
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
        let mem = null
        try { mem = process.memoryUsage() } catch { /* proot 下 uv_resident_set_memory 可能不可用 */ }
        send({
          jsonrpc: '2.0',
          id,
          result: {
            pid: process.pid,
            sessions: manager.count(),
            rss: mem ? mem.rss : null,
            heapUsed: mem ? mem.heapUsed : null,
          },
        })
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