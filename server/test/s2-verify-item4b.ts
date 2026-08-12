// 验证项 4 续：连接 device-B 到 panel-4-test，观察 AI 响应中是否包含 tool 错误
import { WebSocket } from 'ws'

const SERVER_WS_URL = 'ws://localhost:3456/ws'
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

async function main() {
  const ws = new WebSocket(`${SERVER_WS_URL}?deviceId=dev4-B`)
  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => resolve())
    ws.on('error', reject)
    setTimeout(() => reject(new Error('connect timeout')), 5000)
  })

  console.log('device-B connected, sending user_message to panel-4-test...')

  const received: any[] = []
  ws.on('message', (raw: any) => {
    try {
      const msg = JSON.parse(raw.toString())
      received.push(msg)
      const summary = JSON.stringify(msg).slice(0, 300)
      console.log(`[${new Date().toISOString()}] RECV kind=${msg.kind}: ${summary}`)
    } catch {}
  })

  // 发送 user_message 让 device-B 成为 panel-4-test 的活跃设备
  ws.send(JSON.stringify({
    kind: 'user_message',
    panelId: 'panel-4-test',
    content: '请告诉我你刚才是否尝试调用 browser_eval 工具？是否遇到了错误？',
  }))

  console.log('Waiting 20 seconds for AI response...')
  await sleep(20000)

  console.log(`\nTotal messages received: ${received.length}`)
  console.log('Kinds:', received.map(m => m.kind).join(', '))

  ws.close()
  process.exit(0)
}

main().catch(err => {
  console.error('Crashed:', err)
  process.exit(1)
})
