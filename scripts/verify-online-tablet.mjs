// 2026-08-17 线上验证：平板视口布局 + ChatST 网关对话链路
// 用法：node scripts/verify-online-tablet.mjs
import { chromium } from 'playwright'

const BASE = 'https://shadowshub.xyz'
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })

// 1. 游客身份注入
const guestRes = await fetch(`${BASE}/api/auth/guest`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ deviceId: `tablet-verify-${Date.now()}` }),
})
const { token } = await guestRes.json()

// 2. iPad 竖屏视口打开
const ctx = await browser.newContext({
  viewport: { width: 768, height: 1024 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 2,
})
await ctx.addCookies([{ name: 'access_token', value: token, domain: 'shadowshub.xyz', path: '/' }])
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.goto(`${BASE}/daily/`, { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)

// 3. 布局断言
const layout = await page.evaluate(() => {
  const el = document.querySelector('.shell-stage')
  if (!el) return null
  const r = el.getBoundingClientRect()
  const scroll = document.querySelector('.assistant-scroll')
  return {
    stageW: Math.round(r.width), vw: window.innerWidth,
    tabletRule: matchMedia('(min-width: 600px) and (pointer: coarse) and (hover: none)').matches,
    scrollPadding: scroll ? getComputedStyle(scroll).paddingLeft : null,
  }
})
console.log(`[online] layout=${JSON.stringify(layout)} errors=${errors.length ? errors.join(';') : 'none'}`)

// 4. 发一条消息验证 ChatST 网关（deepseek-v4-flash-0731）
const textarea = page.locator('textarea[aria-label="输入消息"]')
await textarea.fill('请只回复两个字：收到')
await page.locator('button[aria-label="发送消息"]').click()
await page.waitForTimeout(20000)
const chatText = await page.evaluate(() => document.querySelector('.assistant-scroll')?.textContent?.slice(-300) ?? '')
console.log(`[online] chatTail=${JSON.stringify(chatText.slice(0, 200))}`)

await page.screenshot({ path: 'scripts/online-tablet-portrait.png' })
await ctx.close()
await browser.close()