// ============================================================================
// Phase S2 Living Dashboard 多端并行改造 - 完整运行时验证脚本
// 覆盖：item 2, 3, 5, 6, 9, 11, 12（WS 协议多端场景）
// 运行：cd f:\allmylife\event\server && npx tsx test/s2-verify-test.ts
// 依赖：本地 server 在 3456 端口运行；s2-server.log 可被读取
// ============================================================================

import { WebSocket } from 'ws'
import { readFileSync } from 'fs'

const SERVER_WS_URL = 'ws://localhost:3456/ws'
const SERVER_LOG_PATH = 'f:/allmylife/event/server/s2-server.log'

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

function createClient(deviceId: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${SERVER_WS_URL}?deviceId=${deviceId}`)
    const timer = setTimeout(() => reject(new Error(`connect timeout for ${deviceId}`)), 5000)
    ws.on('open', () => {
      clearTimeout(timer)
      resolve(ws)
    })
    ws.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

function sendMsg(ws: WebSocket, msg: unknown): void {
  ws.send(JSON.stringify(msg))
}

/** 等待满足条件的下一条消息（predicate 返回 true） */
function waitForMessage(
  ws: WebSocket,
  predicate: (msg: any) => boolean,
  timeoutMs = 8000,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', handler)
      reject(new Error(`message timeout after ${timeoutMs}ms`))
    }, timeoutMs)
    const handler = (raw: any) => {
      try {
        const msg = JSON.parse(raw.toString())
        if (predicate(msg)) {
          clearTimeout(timer)
          ws.off('message', handler)
          resolve(msg)
        }
      } catch {
        // ignore parse errors
      }
    }
    ws.on('message', handler)
  })
}

/** 收集一段时间内所有消息 */
function collectMessages(ws: WebSocket, durationMs: number): Promise<any[]> {
  return new Promise((resolve) => {
    const messages: any[] = []
    const handler = (raw: any) => {
      try {
        messages.push(JSON.parse(raw.toString()))
      } catch {
        // ignore
      }
    }
    ws.on('message', handler)
    setTimeout(() => {
      ws.off('message', handler)
      resolve(messages)
    }, durationMs)
  })
}

/** 关闭 WS 并等待 close 事件 */
function closeAndWait(ws: WebSocket, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(), timeoutMs)
    ws.on('close', () => {
      clearTimeout(timer)
      resolve()
    })
    try {
      ws.close(1000, 'test cleanup')
    } catch {
      // ignore
    }
  })
}

/** 读取 server log 内容 */
function readServerLog(): string {
  try {
    return readFileSync(SERVER_LOG_PATH, 'utf-8')
  } catch (err) {
    return `(read log failed: ${err instanceof Error ? err.message : String(err)})`
  }
}

/** 截取日志中包含某关键字的行（带前后文） */
function grepLog(log: string, keyword: string, contextLines = 0): string[] {
  const lines = log.split('\n')
  const matches: string[] = []
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(keyword)) {
      const start = Math.max(0, i - contextLines)
      const end = Math.min(lines.length, i + contextLines + 1)
      for (let j = start; j < end; j++) {
        if (!matches.includes(lines[j])) matches.push(lines[j])
      }
    }
  }
  return matches
}

/** 在日志中查找若干关键字，返回第一个匹配段（多行） */
function findFirstContaining(log: string, keywords: string[]): string | null {
  const lines = log.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (keywords.every(kw => lines.slice(Math.max(0, i - 5), i + 6).some(l => l.includes(kw)))) {
      // 找到包含所有关键字的连续段
      return lines.slice(Math.max(0, i - 2), i + 3).join('\n')
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// 测试结果收集
// ---------------------------------------------------------------------------

interface TestResult {
  id: string
  name: string
  pass: boolean
  detail: string
  logSnippet?: string
}

const results: TestResult[] = []

function record(id: string, name: string, pass: boolean, detail: string, logSnippet?: string) {
  results.push({ id, name, pass, detail, logSnippet })
  console.log(`[${pass ? 'PASS' : 'FAIL'}] [${id}] ${name}: ${detail}`)
  if (logSnippet) {
    console.log(`  --- LOG ---\n${logSnippet.split('\n').map(l => '  ' + l).join('\n')}\n  --- END ---`)
  }
}

// ---------------------------------------------------------------------------
// 主测试流程
// ---------------------------------------------------------------------------

async function main() {
  console.log('=== Phase S2 多端并行改造运行时验证 ===')
  console.log(`Server WS URL: ${SERVER_WS_URL}`)
  console.log(`Server log path: ${SERVER_LOG_PATH}`)
  console.log('')

  // ----------------------------------------------------------------------
  // 验证项 2: per-panel activeDeviceId + 在线集合 + cleanup
  // ----------------------------------------------------------------------
  console.log('--- 验证项 2: per-panel activeDeviceId + cleanup ---')
  {
    const deviceA = await createClient('dev2-A')
    const deviceB = await createClient('dev2-B')
    await sleep(300)

    // device-A 在 panel-1 发 user_message
    sendMsg(deviceA, {
      kind: 'user_message',
      panelId: 'panel-2-1',
      content: 'hello from device A',
    })
    await sleep(800)

    // device-B 在 panel-1 发 user_message（同 panel，接管 activeDevice）
    sendMsg(deviceB, {
      kind: 'user_message',
      panelId: 'panel-2-1',
      content: 'hello from device B',
    })
    await sleep(800)

    // device-A 切到 panel-2 发 user_message
    sendMsg(deviceA, {
      kind: 'user_message',
      panelId: 'panel-2-2',
      content: 'switching to panel 2',
    })
    await sleep(1500)

    const log = readServerLog()
    // 期望日志：
    // 1. Panel panel-2-1 active device: dev2-A
    // 2. Panel panel-2-1 active device: dev2-B
    // 3. Panel panel-2-2 active device: dev2-A
    // 4. Device dev2-A left panel panel-2-1 (switched to panel-2-2)
    const hasActiveA = log.includes('Panel panel-2-1 active device: dev2-A')
    const hasActiveB = log.includes('Panel panel-2-1 active device: dev2-B')
    const hasActiveA_panel2 = log.includes('Panel panel-2-2 active device: dev2-A')
    const hasLeftLog = log.includes('Device dev2-A left panel panel-2-1 (switched to panel-2-2)')

    const pass = hasActiveA && hasActiveB && hasActiveA_panel2 && hasLeftLog
    const snippet = grepLog(log, 'panel-2-1 active device').concat(grepLog(log, 'panel-2-2 active device')).concat(grepLog(log, 'left panel panel-2-1')).join('\n')
    record('2', 'per-panel activeDeviceId + cleanup', pass,
      `activeA=${hasActiveA}, activeB=${hasActiveB}, activeA_panel2=${hasActiveA_panel2}, leftLog=${hasLeftLog}`,
      snippet)

    // 清理 - 关闭客户端
    await closeAndWait(deviceA)
    await closeAndWait(deviceB)
    await sleep(500)
  }

  // ----------------------------------------------------------------------
  // 验证项 3: dispose_session 多端保护 (S-1 修复)
  // ----------------------------------------------------------------------
  console.log('--- 验证项 3: dispose_session 多端保护 ---')
  {
    const deviceA = await createClient('dev3-A')
    const deviceB = await createClient('dev3-B')
    await sleep(300)

    // device-A 和 device-B 都在 panel-3 发 user_message
    sendMsg(deviceA, {
      kind: 'user_message',
      panelId: 'panel-3-shared',
      content: 'device A joining panel-3',
    })
    await sleep(800)
    sendMsg(deviceB, {
      kind: 'user_message',
      panelId: 'panel-3-shared',
      content: 'device B joining panel-3',
    })
    await sleep(800)

    // device-A 发送 dispose_session { panelId: 'panel-3-shared' }
    sendMsg(deviceA, {
      kind: 'dispose_session',
      panelId: 'panel-3-shared',
    })
    await sleep(1500)

    const log = readServerLog()
    // 关键验证：服务器日志应输出 "Device dev3-A left panel panel-3-shared, 1 device(s) still active, keeping session"
    const keepingLog = log.includes('Device dev3-A left panel panel-3-shared, 1 device(s) still active, keeping session')
    // 且不应有 "Panel session panel-3-shared disposed"
    const disposedLog = log.includes('Panel session panel-3-shared disposed')

    // 后续 device-B 应能继续工作（再发 user_message 不应被 reject）
    sendMsg(deviceB, {
      kind: 'user_message',
      panelId: 'panel-3-shared',
      content: 'device B continuing after device A disposed',
    })
    await sleep(1000)

    // 验证 device-B 没有收到 'panel disposed' 错误
    const afterDisposeLog = readServerLog().slice(log.length)
    const noReject = !afterDisposeLog.includes('panel panel-3-shared disposed')

    const pass = keepingLog && !disposedLog && noReject
    const snippet = grepLog(log, 'panel-3-shared').join('\n')
    record('3', 'dispose_session 多端保护 (S-1)', pass,
      `keepingLog=${keepingLog}, disposedLog=${disposedLog}, noReject=${noReject}`,
      snippet)

    await closeAndWait(deviceA)
    await closeAndWait(deviceB)
    await sleep(500)
  }

  // ----------------------------------------------------------------------
  // 验证项 5: 设备断开清理 (缺口 B)
  // ----------------------------------------------------------------------
  console.log('--- 验证项 5: 设备断开清理 ---')
  {
    const deviceA = await createClient('dev5-A')
    await sleep(300)

    sendMsg(deviceA, {
      kind: 'user_message',
      panelId: 'panel-5-x',
      content: 'device A in panel X',
    })
    await sleep(800)

    // 主动关闭 WS 连接
    await closeAndWait(deviceA)
    await sleep(1500)

    const log = readServerLog()
    // 期望日志：
    // 1. Cleared activeDevice for panel panel-5-x (device dev5-A disconnected)
    // 2. Device dev5-A left panel panel-5-x (disconnected)
    const clearedLog = log.includes('Cleared activeDevice for panel panel-5-x (device dev5-A disconnected)')
    const leftLog = log.includes('Device dev5-A left panel panel-5-x (disconnected)')

    const pass = clearedLog && leftLog
    const snippet = grepLog(log, 'dev5-A').join('\n')
    record('5', '设备断开清理 (缺口 B)', pass,
      `clearedLog=${clearedLog}, leftLog=${leftLog}`,
      snippet)
  }

  // ----------------------------------------------------------------------
  // 验证项 6: forwardEventToClient 定向广播 (缺口 A)
  // ----------------------------------------------------------------------
  console.log('--- 验证项 6: forwardEventToClient 定向广播 ---')
  {
    const deviceA = await createClient('dev6-A')
    const deviceB = await createClient('dev6-B')
    await sleep(300)

    // device-A 在 panel-Y 发 user_message
    sendMsg(deviceA, {
      kind: 'user_message',
      panelId: 'panel-6-y',
      content: 'device A in panel Y',
    })
    await sleep(800)
    // device-B 在 panel-Z 发 user_message（不同 panel）
    sendMsg(deviceB, {
      kind: 'user_message',
      panelId: 'panel-6-z',
      content: 'device B in panel Z',
    })
    await sleep(800)

    // 触发 device-A 在 panel-Y 上的 AI 回复（再发一条 user_message）
    sendMsg(deviceA, {
      kind: 'user_message',
      panelId: 'panel-6-y',
      content: '请回复 hello',
    })

    // 收集 8 秒内两个客户端收到的所有 pi_event 消息
    const [msgsA, msgsB] = await Promise.all([
      collectMessages(deviceA, 8000),
      collectMessages(deviceB, 8000),
    ])

    // device-A 应收到 panel-Y 的 pi_event
    const aGotPanelY = msgsA.some(m => m.kind === 'pi_event' && m.panelId === 'panel-6-y')
    // device-B 应收到 panel-Z 的 pi_event（如果有 AI 回复）
    const bGotPanelZ = msgsB.some(m => m.kind === 'pi_event' && m.panelId === 'panel-6-z')
    // device-A 不应收到 panel-Z 的 pi_event
    const aGotPanelZ = msgsA.some(m => m.kind === 'pi_event' && m.panelId === 'panel-6-z')
    // device-B 不应收到 panel-Y 的 pi_event
    const bGotPanelY = msgsB.some(m => m.kind === 'pi_event' && m.panelId === 'panel-6-y')

    // 通过标准：device-A 收到 panel-Y 事件；device-A 未收到 panel-Z 事件；device-B 未收到 panel-Y 事件
    // （bGotPanelZ 为可选，依赖 AI 是否实际回复；至少要求 device-A 收到 panel-Y pi_event 证明定向路由生效）
    const pass = aGotPanelY && !aGotPanelZ && !bGotPanelY

    const detail = `aGotPanelY=${aGotPanelY}, aGotPanelZ=${aGotPanelZ}, bGotPanelY=${bGotPanelY}, bGotPanelZ=${bGotPanelZ}; msgsA=${msgsA.length}, msgsB=${msgsB.length}`
    const snippet = `device-A msgs kinds: ${msgsA.map(m => m.kind + (m.panelId ? '/' + m.panelId : '')).join(', ')}\n` +
      `device-B msgs kinds: ${msgsB.map(m => m.kind + (m.panelId ? '/' + m.panelId : '')).join(', ')}`
    record('6', 'forwardEventToClient 定向广播 (缺口 A)', pass, detail, snippet)

    await closeAndWait(deviceA)
    await closeAndWait(deviceB)
    await sleep(500)
  }

  // ----------------------------------------------------------------------
  // 验证项 9: error_report 携带 panelId 透传 (缺口 D)
  // ----------------------------------------------------------------------
  console.log('--- 验证项 9: error_report 携带 panelId 透传 ---')
  {
    const deviceA = await createClient('dev9-A')
    await sleep(300)

    // 先让 device-A 加入 panel-test-panel（这样 error_report 才能找到 targetPanelId）
    sendMsg(deviceA, {
      kind: 'user_message',
      panelId: 'panel-test-9',
      content: 'setup device in panel-test-9',
    })
    await sleep(800)

    // 发送 error_report 携带 panelId
    sendMsg(deviceA, {
      kind: 'error_report',
      widgetId: 'test-widget-9',
      panelId: 'panel-test-9',
      message: 'test error from s2 verify',
      source: 'test',
    })

    await sleep(2000)

    const log = readServerLog()
    // 期望日志：
    // [PiBridge] Widget error reported (widgetId=test-widget-9, panelId=panel-test-9, device=dev9-A)
    const expectedLog = log.includes('Widget error reported (widgetId=test-widget-9, panelId=panel-test-9, device=dev9-A)')

    const pass = expectedLog
    const snippet = grepLog(log, 'test-widget-9').join('\n')
    record('9', 'error_report 携带 panelId 透传 (缺口 D)', pass,
      `expectedLog=${expectedLog}`,
      snippet)

    await closeAndWait(deviceA)
    await sleep(500)
  }

  // ----------------------------------------------------------------------
  // 验证项 11: cleanupDeviceFromOtherPanels 多端正确性 (2.1.8)
  // ----------------------------------------------------------------------
  console.log('--- 验证项 11: cleanupDeviceFromOtherPanels 多端正确性 ---')
  {
    const deviceA = await createClient('dev11-A')
    const deviceB = await createClient('dev11-B')
    await sleep(300)

    // device-A 和 device-B 都在 panel-A
    sendMsg(deviceA, {
      kind: 'user_message',
      panelId: 'panel-11-a',
      content: 'device A joining panel-A',
    })
    await sleep(800)
    sendMsg(deviceB, {
      kind: 'user_message',
      panelId: 'panel-11-a',
      content: 'device B joining panel-A',
    })
    await sleep(800)

    // device-A 切到 panel-B 发 user_message
    sendMsg(deviceA, {
      kind: 'user_message',
      panelId: 'panel-11-b',
      content: 'device A switching to panel-B',
    })
    await sleep(1500)

    // 触发 panel-A 的 pi_event（通过 device-B 发 user_message）
    sendMsg(deviceB, {
      kind: 'user_message',
      panelId: 'panel-11-a',
      content: 'device B sending another message on panel-A',
    })

    // 收集 device-A 的消息 6 秒
    const msgsA = await collectMessages(deviceA, 6000)
    // device-A 不应再收到 panel-A 的 pi_event（已被清理出 panel-11-a 的在线集合）
    const aGotPanelAEvent = msgsA.some(m => m.kind === 'pi_event' && m.panelId === 'panel-11-a')

    const log = readServerLog()
    // 期望日志：Device dev11-A left panel panel-11-a (switched to panel-11-b)
    const leftLog = log.includes('Device dev11-A left panel panel-11-a (switched to panel-11-b)')

    // 通过标准：日志显示 device-A 离开 panel-11-a；device-A 不再收到 panel-11-a 事件
    const pass = leftLog && !aGotPanelAEvent
    const snippet = grepLog(log, 'dev11-A').concat(grepLog(log, 'panel-11-a')).join('\n')
    record('11', 'cleanupDeviceFromOtherPanels 多端正确性 (2.1.8)', pass,
      `leftLog=${leftLog}, aGotPanelAEvent=${aGotPanelAEvent} (should be false), msgsA=${msgsA.length}`,
      snippet)

    await closeAndWait(deviceA)
    await closeAndWait(deviceB)
    await sleep(500)
  }

  // ----------------------------------------------------------------------
  // 验证项 12: session-only 面板切换场景 (M-1 修复)
  // ----------------------------------------------------------------------
  console.log('--- 验证项 12: session-only 面板切换场景 (M-1) ---')
  {
    const deviceA = await createClient('dev12-A')
    await sleep(300)

    // device-A 在 session-only:shared-anon 发 user_message
    sendMsg(deviceA, {
      kind: 'user_message',
      panelId: 'session-only:shared-anon',
      content: 'device A in session-only panel',
    })
    await sleep(800)

    // device-A 切到普通面板 panel-real 发 user_message
    sendMsg(deviceA, {
      kind: 'user_message',
      panelId: 'panel-12-real',
      content: 'device A switching to real panel',
    })
    await sleep(1500)

    const log = readServerLog()
    // 期望日志：Device dev12-A left panel session-only:shared-anon (switched to panel-12-real)
    // 这是 M-1 修复的关键：不再跳过 session-only: 前缀的面板
    const leftSessionOnlyLog = log.includes('Device dev12-A left panel session-only:shared-anon (switched to panel-12-real)')

    const pass = leftSessionOnlyLog
    const snippet = grepLog(log, 'session-only:shared-anon').join('\n')
    record('12', 'session-only 面板切换场景 (M-1)', pass,
      `leftSessionOnlyLog=${leftSessionOnlyLog}`,
      snippet)

    await closeAndWait(deviceA)
    await sleep(500)
  }

  // ----------------------------------------------------------------------
  // 汇总报告
  // ----------------------------------------------------------------------
  console.log('')
  console.log('=== 验证汇总 ===')
  const passed = results.filter(r => r.pass).length
  const failed = results.filter(r => !r.pass).length
  console.log(`总计: ${results.length} 项, 通过 ${passed} 项, 失败 ${failed} 项`)
  console.log('')

  for (const r of results) {
    const status = r.pass ? 'PASS' : 'FAIL'
    console.log(`[${status}] [${r.id}] ${r.name}`)
    console.log(`  detail: ${r.detail}`)
    if (r.logSnippet) {
      console.log(`  log:`)
      for (const line of r.logSnippet.split('\n')) {
        console.log(`    ${line}`)
      }
    }
  }

  // 退出码
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('Test runner crashed:', err)
  process.exit(2)
})
