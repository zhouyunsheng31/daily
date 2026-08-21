// 线上验证：前端 shell-web 会话服务端同步（2026-08-17）
// 模拟「换设备登录站长账号」：干净上下文 + 注入站长 JWT cookie →
// 打开 /daily/ → boot → hydrate(身份变化) → syncServerConversations 应把
// 服务端历史会话拉进 localStorage（daily-webos-conv:user:<id>）并显示在侧边栏。
// 用法：ADMIN_TOKEN=<jwt> node scripts/verify-conv-sync.mjs
import { chromium } from 'playwright'

const TOKEN = process.env.ADMIN_TOKEN
if (!TOKEN) { console.error('ADMIN_TOKEN env required'); process.exit(1) }
const USER_KEY = 'user:fb9f2d90-a79c-4ab4-af3e-c3b13fb668d6'
const CONV_KEY = `daily-webos-conv:${USER_KEY}`
const CONV_PREFIX = 'daily-webos-conv:'

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
})
// 注入站长账号 JWT（等价登录态）
await context.addCookies([{ name: 'access_token', value: TOKEN, domain: 'shadowshub.xyz', path: '/' }])

// 页内网络/JS 错误捕获
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`)
})

await page.goto('https://shadowshub.xyz/daily/', { waitUntil: 'domcontentloaded', timeout: 30000 })
console.log('[*] 页面已加载，等待 boot + 会话同步…')

// 轮询等待 syncServerConversations 把会话写入 localStorage（最多 40s）
let convRaw = null
let syncTries = 0
while (syncTries < 40) {
  await page.waitForTimeout(1000)
  syncTries += 1
  convRaw = await page.evaluate((key) => {
    try { return localStorage.getItem(key) } catch { return null }
  }, CONV_KEY)
  if (convRaw && JSON.parse(convRaw).conversations?.length > 0) break
}
await page.waitForTimeout(2500) // 等 UI 渲染

if (!convRaw) {
  console.log('[✗] 未在 localStorage 找到同步后的会话缓存')
  const allKeys = await page.evaluate(() => {
    try {
      return Object.keys(localStorage).filter((k) => k.startsWith('daily-webos-conv')).slice(0, 10)
    } catch { return [] }
  })
  console.log('    localStorage conv keys:', allKeys)
  console.log('    JS errors:', errors.slice(0, 5))
  await page.screenshot({ path: 'scripts/verify-conv-sync-fail.png' })
  await browser.close()
  process.exit(1)
}

const parsed = JSON.parse(convRaw)
const convs = parsed.conversations ?? []
const ids = convs.map((c) => c.id)
const dupIds = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))]
console.log(`[✓] 同步成功：本地会话 ${convs.length} 个，active=${parsed.activeId}`)
if (dupIds.length > 0) {
  console.log(`[✗] 有重复会话 id（${dupIds.length} 个去重后）：${dupIds.slice(0, 5)}`)
  process.exitCode = 2
} else {
  console.log('[✓] 无重复会话 id（防并发修复生效）')
}
for (const c of convs) {
  console.log(`    - ${c.id} | "${c.title}" | 消息 ${c.messages?.length ?? 0} | updated ${new Date(c.updatedAt).toISOString()}`)
}

// 截图：进入 assistant 页看侧边栏渲染
console.log('[*] 截图确认 UI 渲染…')
await page.screenshot({ path: 'scripts/verify-conv-sync.png' })
const sidebarText = await page.evaluate(() => document.body.innerText.slice(0, 600))
console.log('--- 页面首屏文本(前600字) ---')
console.log(sidebarText)

console.log('--- JS errors ---')
console.log(errors.length ? errors.slice(0, 8) : '无')

await browser.close()
console.log('\nDONE')
