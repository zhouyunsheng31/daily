// 验证项 4: 无在线设备抛错
// 策略：发 user_message 让 AI 调用 browser_* 工具，立即断开设备，
// AI 后续的 tool_call 会命中 "no active device" 拒绝路径
import { WebSocket } from 'ws'

const SERVER_WS_URL = 'ws://localhost:3456/ws'
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

async function main() {
  const ws = new WebSocket(`${SERVER_WS_URL}?deviceId=dev4-A`)
  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => resolve())
    ws.on('error', reject)
    setTimeout(() => reject(new Error('connect timeout')), 5000)
  })

  console.log('Connected, sending user_message that asks AI to call browser_eval...')

  // 发送明确要求调用 browser_eval 的消息
  ws.send(JSON.stringify({
    kind: 'user_message',
    panelId: 'panel-4-test',
    content: '请立即调用 browser_eval 工具，参数 script 为 "document.title"',
  }))

  // 立即断开（不等 AI 处理）
  console.log('Immediately closing WS connection to clear activeDevice...')
  await sleep(200)  // 给 server 一点时间处理 user_message 并设置 activeDevice
  ws.close()

  console.log('Waiting 25 seconds for AI to attempt tool_call (should be rejected)...')
  await sleep(25000)

  console.log('Done. Check server log for "no active device" rejection.')
  console.log('Note: rejection is a Promise rejection caught by AI agent, may not appear in server log.')
  console.log('The rejection message would be: "no active device for panel panel-4-test, tool: browser_eval"')
  process.exit(0)
}

main().catch(err => {
  console.error('Crashed:', err)
  process.exit(1)
})
