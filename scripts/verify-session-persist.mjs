// 会话持久化端到端验证：①发消息建立上下文 ②服务端重启 ③验证 AI 记得（不重启则跳过②）
// 用法：node scripts/verify-session-persist.mjs [--restart]
import { chromium } from 'playwright'

const BASE = 'https://shadowshub.xyz'
const restart = process.argv.includes('--restart')
const convId = `persist-test-${Date.now()}`
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })

async function makeToken() {
  const r = await fetch(`${BASE}/api/auth/guest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: `persist-verify-${Date.now()}` }),
  })
  const j = await r.json()
  return j.token
}

async function chat(token, text, conversationId) {
  const r = await fetch(`${BASE}/webos/api/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `access_token=${token}` },
    body: JSON.stringify({
      messages: [{ role: 'user', content: text }],
      model: 'flash', thinking: 'low', conversationId,
    }),
  })
  const text2 = await r.text()
  const doneMatch = text2.match(/"type":"done"[\s\S]*?"content":"([^"]{0,120})/)
  const errorMatch = text2.match(/"type":"error"[\s\S]*?"message":"([^"]{0,120})/)
  return { ok: r.status === 200 && !errorMatch, reply: doneMatch?.[1] ?? errorMatch?.[1] ?? text2.slice(0, 80) }
}

const token = await makeToken()
// 第一步：告诉 AI 一个"秘密"（建立上下文）
const r1 = await chat(token, '请记住这个秘密数字：7284。只需要回答"记住了"', convId)
console.log('STEP1 记住秘密:', JSON.stringify(r1))

if (restart) {
  console.log('>>> 等待人工/脚本重启服务（3s）...')
  await new Promise((res) => setTimeout(res, 3000))
}

// 第二步：验证 AI 是否记得
const r2 = await chat(token, '我刚才让你记住的秘密数字是什么？只回答数字', convId)
console.log('STEP2 追问秘密:', JSON.stringify(r2))

await browser.close()