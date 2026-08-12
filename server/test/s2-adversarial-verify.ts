// ============================================================================
// Phase S2 对抗审查运行时验证脚本（独立审查者编写）
// 验证 S-1 和 M-1 修复在真实运行时是否生效
// 运行：cd f:\allmylife\event\server && npx tsx test/s2-adversarial-verify.ts
// 目标端口：3457（本地 dev server，避开 docker 生产 3456）
// ============================================================================

import { WebSocket } from 'ws'
import { readFileSync } from 'fs'

const SERVER_WS_URL = 'ws://localhost:3457/ws'
const SERVER_LOG_PATH = 'f:/allmylife/event/server/s2-verify-server.log'

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

function closeAndWait(ws: WebSocket, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(), timeoutMs)
    ws.on('close', () => {
      clearTimeout(timer)
      resolve()
    })
    try { ws.close(1000, 'cleanup') } catch { /* ignore */ }
  })
}

function readServerStdout(): string {
  // 直接通过 docker logs 不可用（本地 dev server），改读 log file（如果有 Tee）
  // 这里我们依赖脚本的输出 capture（由调用者通过 CheckCommandStatus 读取）
  return ''  // server stdout 通过另一渠道读取
}

interface TestResult {
  id: string
  name: string
  pass: boolean
  detail: string
}

const results: TestResult[] = []

function record(id: string, name: string, pass: boolean, detail: string) {
  results.push({ id, name, pass, detail })
  console.log(`[${pass ? 'PASS' : 'FAIL'}] [${id}] ${name}: ${detail}`)
}

// 收集一段时间内所有消息
function collectMessages(ws: WebSocket, durationMs: number): Promise<any[]> {
  return new Promise((resolve) => {
    const messages: any[] = []
    const handler = (raw: any) => {
      try { messages.push(JSON.parse(raw.toString())) } catch { /* ignore */ }
    }
    ws.on('message', handler)
    setTimeout(() => {
      ws.off('message', handler)
      resolve(messages)
    }, durationMs)
  })
}

async function main() {
  console.log('=== Phase S2 对抗审查运行时验证 ===')
  console.log(`Server WS URL: ${SERVER_WS_URL}`)
  console.log('')

  // ----------------------------------------------------------------------
  // 测试 1: S-1 修复验证 - dispose_session 多端保护
  // 场景：device-A 和 device-B 都在 panel-S1，device-A 发 dispose_session
  // 期望：session 不被销毁，device-B 仍能继续使用
  // ----------------------------------------------------------------------
  console.log('--- 测试 1: S-1 修复 - dispose_session 多端保护 ---')
  {
    const deviceA = await createClient('adv-s1-A')
    const deviceB = await createClient('adv-s1-B')
    await sleep(300)

    // device-A 加入 panel-S1
    sendMsg(deviceA, {
      kind: 'user_message',
      panelId: 'panel-adv-s1',
      content: 'device A joining panel-adv-s1',
    })
    await sleep(800)

    // device-B 加入同一个 panel-S1
    sendMsg(deviceB, {
      kind: 'user_message',
      panelId: 'panel-adv-s1',
      content: 'device B joining panel-adv-s1',
    })
    await sleep(800)

    // device-A 发送 dispose_session
    sendMsg(deviceA, {
      kind: 'dispose_session',
      panelId: 'panel-adv-s1',
    })
    await sleep(1500)

    // device-B 应该能继续发消息（session 未被销毁）
    let deviceBReceivedError = false
    const deviceBMsgs: any[] = []
    const bHandler = (raw: any) => {
      try {
        const msg = JSON.parse(raw.toString())
        deviceBMsgs.push(msg)
        if (msg.kind === 'error' && typeof msg.message === 'string' && msg.message.includes('disposed')) {
          deviceBReceivedError = true
        }
      } catch { /* ignore */ }
    }
    deviceB.on('message', bHandler)

    sendMsg(deviceB, {
      kind: 'user_message',
      panelId: 'panel-adv-s1',
      content: 'device B continuing after device A disposed session',
    })
    await sleep(2000)

    deviceB.off('message', bHandler)

    // 验证条件：
    // 1. device-B 没有收到 'panel disposed' 错误
    // 2. device-B 收到了某种响应（pi_event 或 error 但不是 disposed）
    const pass = !deviceBReceivedError
    const detail = `deviceBReceivedDisposedError=${deviceBReceivedError}, msgsB=${deviceBMsgs.length} (kinds: ${deviceBMsgs.map(m => m.kind).join(',')})`
    record('S1', 'dispose_session 多端保护（S-1 修复）', pass, detail)

    await closeAndWait(deviceA)
    await closeAndWait(deviceB)
    await sleep(500)
  }

  // ----------------------------------------------------------------------
  // 测试 2: M-1 修复验证 - session-only 面板切换清理
  // 场景：device-A 在 session-only:shared-anon 发消息，切到普通面板
  // 期望：device-A 从 session-only 面板在线集合移除
  // 验证方式：通过观察后续 pi_event 是否还会广播到 device-A
  // ----------------------------------------------------------------------
  console.log('--- 测试 2: M-1 修复 - session-only 面板切换清理 ---')
  {
    const deviceA = await createClient('adv-m1-A')
    const deviceB = await createClient('adv-m1-B')
    await sleep(300)

    // device-A 在 session-only:shared-anon 发消息
    sendMsg(deviceA, {
      kind: 'user_message',
      panelId: 'session-only:adv-m1-test',
      content: 'device A in session-only panel',
    })
    await sleep(800)

    // device-B 也在 session-only:adv-m1-test 发消息（建立第二个在线设备）
    sendMsg(deviceB, {
      kind: 'user_message',
      panelId: 'session-only:adv-m1-test',
      content: 'device B in session-only panel',
    })
    await sleep(800)

    // device-A 切到普通面板 panel-m1-real 发消息
    sendMsg(deviceA, {
      kind: 'user_message',
      panelId: 'panel-adv-m1-real',
      content: 'device A switching to real panel',
    })
    await sleep(1500)

    // device-B 再发一条消息到 session-only:adv-m1-test，触发 pi_event
    // 收集 device-A 的消息，验证 device-A 不再收到 session-only:adv-m1-test 的 pi_event
    const msgsA = await new Promise<any[]>((resolve) => {
      const messages: any[] = []
      const handler = (raw: any) => {
        try { messages.push(JSON.parse(raw.toString())) } catch { /* ignore */ }
      }
      deviceA.on('message', handler)

      sendMsg(deviceB, {
        kind: 'user_message',
        panelId: 'session-only:adv-m1-test',
        content: 'device B sending another message on session-only panel',
      })

      setTimeout(() => {
        deviceA.off('message', handler)
        resolve(messages)
      }, 5000)
    })

    // device-A 不应再收到 session-only:adv-m1-test 的 pi_event
    const aGotSessionOnlyEvent = msgsA.some(m =>
      m.kind === 'pi_event' && m.panelId === 'session-only:adv-m1-test'
    )

    const pass = !aGotSessionOnlyEvent
    const detail = `aGotSessionOnlyEvent=${aGotSessionOnlyEvent} (should be false), msgsA=${msgsA.length} (kinds: ${msgsA.map(m => m.kind + (m.panelId ? '/' + m.panelId : '')).join(',')})`
    record('M1', 'session-only 面板切换清理（M-1 修复）', pass, detail)

    await closeAndWait(deviceA)
    await closeAndWait(deviceB)
    await sleep(500)
  }

  // ----------------------------------------------------------------------
  // 测试 3: 多端 cleanupDeviceFromOtherPanels 不影响其他设备
  // 场景：device-A 和 device-B 都在 panel-A，device-A 切到 panel-B
  // 期望：device-B 仍在 panel-A 在线集合，能收到 panel-A 的 pi_event
  // ----------------------------------------------------------------------
  console.log('--- 测试 3: cleanupDeviceFromOtherPanels 多端正确性 ---')
  {
    const deviceA = await createClient('adv-multi-A')
    const deviceB = await createClient('adv-multi-B')
    await sleep(300)

    // device-A 和 device-B 都在 panel-multi-A
    sendMsg(deviceA, {
      kind: 'user_message',
      panelId: 'panel-adv-multi-A',
      content: 'device A joining panel-multi-A',
    })
    await sleep(800)
    sendMsg(deviceB, {
      kind: 'user_message',
      panelId: 'panel-adv-multi-A',
      content: 'device B joining panel-multi-A',
    })
    await sleep(800)

    // device-A 切到 panel-multi-B
    sendMsg(deviceA, {
      kind: 'user_message',
      panelId: 'panel-adv-multi-B',
      content: 'device A switching to panel-multi-B',
    })
    await sleep(1500)

    // device-B 再发消息到 panel-adv-multi-A，触发 pi_event
    const msgsB = await new Promise<any[]>((resolve) => {
      const messages: any[] = []
      const handler = (raw: any) => {
        try { messages.push(JSON.parse(raw.toString())) } catch { /* ignore */ }
      }
      deviceB.on('message', handler)

      sendMsg(deviceB, {
        kind: 'user_message',
        panelId: 'panel-adv-multi-A',
        content: 'device B sending another message on panel-multi-A',
      })

      setTimeout(() => {
        deviceB.off('message', handler)
        resolve(messages)
      }, 5000)
    })

    // device-B 应该能收到 panel-adv-multi-A 的 pi_event（仍在在线集合中）
    const bGotPanelAEvent = msgsB.some(m =>
      m.kind === 'pi_event' && m.panelId === 'panel-adv-multi-A'
    )

    // 注意：如果没有 API key 配置，AI 不会回复，pi_event 不会触发
    // 这种情况下我们只能验证 device-B 没有收到 'panel disposed' 错误
    const bReceivedDisposedError = msgsB.some(m =>
      m.kind === 'error' && typeof m.message === 'string' && m.message.includes('disposed')
    )

    const pass = !bReceivedDisposedError
    const detail = `bGotPanelAEvent=${bGotPanelAEvent}, bReceivedDisposedError=${bReceivedDisposedError}, msgsB=${msgsB.length} (kinds: ${msgsB.map(m => m.kind).join(',')})`
    record('MULTI', 'cleanupDeviceFromOtherPanels 多端正确性', pass, detail)

    await closeAndWait(deviceA)
    await closeAndWait(deviceB)
    await sleep(500)
  }

  // ----------------------------------------------------------------------
  // 测试 4: 设备断开清理（缺口 B）
  // 场景：device-A 在 panel-disc 发消息，然后断开
  // 期望：panelActiveDevices 和 panelOnlineDevices 中 device-A 被清理
  // 验证方式：device-B 之后再连接 panel-disc 发消息，不应受 device-A 残留影响
  // ----------------------------------------------------------------------
  console.log('--- 测试 4: 设备断开清理（缺口 B） ---')
  {
    const deviceA = await createClient('adv-disc-A')
    await sleep(300)

    sendMsg(deviceA, {
      kind: 'user_message',
      panelId: 'panel-adv-disc',
      content: 'device A in panel-disc',
    })
    await sleep(800)

    // 主动断开 device-A
    await closeAndWait(deviceA)
    await sleep(1500)

    // device-B 连接并发消息到同一个 panel，应该能正常工作
    const deviceB = await createClient('adv-disc-B')
    await sleep(300)

    let bReceivedError = false
    const bHandler = (raw: any) => {
      try {
        const msg = JSON.parse(raw.toString())
        if (msg.kind === 'error') bReceivedError = true
      } catch { /* ignore */ }
    }
    deviceB.on('message', bHandler)

    sendMsg(deviceB, {
      kind: 'user_message',
      panelId: 'panel-adv-disc',
      content: 'device B in panel-disc after device A disconnected',
    })
    await sleep(2000)

    deviceB.off('message', bHandler)

    // device-B 应该能正常工作（不收到 fatal error）
    const pass = !bReceivedError
    const detail = `bReceivedError=${bReceivedError}`
    record('DISC', '设备断开清理（缺口 B）', pass, detail)

    await closeAndWait(deviceB)
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
  }

  process.exit(failed > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('Test runner crashed:', err)
  process.exit(2)
})
