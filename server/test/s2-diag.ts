// 测试单独捕获 AI 调用的错误内容
import { WebSocket } from 'ws'

const SERVER_WS_URL = 'ws://localhost:3456/ws'

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

async function main() {
  const ws = new WebSocket(`${SERVER_WS_URL}?deviceId=diag-A`)
  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => resolve())
    ws.on('error', reject)
    setTimeout(() => reject(new Error('connect timeout')), 5000)
  })

  console.log('Connected, sending user_message...')

  const received: any[] = []
  ws.on('message', (raw: any) => {
    try {
      const msg = JSON.parse(raw.toString())
      received.push(msg)
      console.log(`[${new Date().toISOString()}] RECV kind=${msg.kind}: ${JSON.stringify(msg).slice(0, 500)}`)
    } catch {}
  })

  ws.send(JSON.stringify({
    kind: 'user_message',
    panelId: 'panel-diag-1',
    content: '请回复 hello',
  }))

  console.log('Sent, waiting 25 seconds for response...')
  await sleep(25000)

  console.log(`Total messages received: ${received.length}`)
  console.log('Kinds:', received.map(m => m.kind).join(', '))

  ws.close()
  process.exit(0)
}

main().catch(err => {
  console.error('Crashed:', err)
  process.exit(1)
})
