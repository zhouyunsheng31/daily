// 2026-08-17 平板布局验证：Playwright 平板视口（触屏）实测 shell-stage 铺满 + 截图
// 用法：node scripts/verify-tablet-layout.mjs
import { chromium } from 'playwright'
import { createServer } from 'http'
import { readFileSync, existsSync } from 'fs'
import { join, extname } from 'path'

const root = join(process.cwd(), 'server', 'public')
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf' }

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  // mock webOS bootstrap：让 Shell 真正渲染（本地无后端）
  if (url.pathname === '/webos/api/bootstrap') {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({
      session: {
        authenticated: true,
        guest: true,
        user: { id: 'verify-guest', username: '游客', role: 'guest' },
        guestState: {
          id: 'verify-guest', deviceId: 'verify-device', balanceMinor: 0, freeBalanceMinor: 100,
          usedMinor: 0, storageBytes: 0, storageLimitBytes: 52428800, createdAt: Date.now(),
          synced: false, kind: 'guest',
          credits: { quota: 100, used: 0, remaining: 100, totalRemaining: 100 },
        },
      },
      ai: { model: 'flash', thinking: 'medium', models: [{ id: 'flash', label: 'Flash', provider: 'DeepSeek', available: true, priceHint: '', supportsThinking: ['low', 'medium', 'high', 'max'] }] },
      apps: [],
      payment: { providerStatus: 'unavailable' },
      email: { state: 'idle', boundEmail: null },
      billing: { peak: false, peakMultiplier: 1, credits: { quota: 100, used: 0, remaining: 100 }, catalog: [] },
      logo: null,
      avatar: null,
      boot: { html: null, durationMs: 300 },
    }))
    return
  }
  let path = decodeURIComponent(url.pathname)
  // 生产部署在 /daily 前缀下，本地验证服务器同样处理
  if (path.startsWith('/daily/')) path = path.slice('/daily'.length)
  if (path === '/') path = '/index.html'
  const file = join(root, path)
  if (existsSync(file)) {
    res.setHeader('Content-Type', MIME[extname(file)] ?? 'application/octet-stream')
    res.end(readFileSync(file))
  } else {
    res.setHeader('Content-Type', 'text/html')
    res.end(readFileSync(join(root, 'index.html')))
  }
})

await new Promise((resolve) => server.listen(0, resolve))
const port = server.address().port
console.log(`[tablet-verify] static server on :${port}`)

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
const results = []

async function check(name, viewport) {
  const ctx = await browser.newContext({
    viewport,
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  })
  const page = await ctx.newPage()
  const errors = []
  const consoleLogs = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') consoleLogs.push(`[${m.type()}] ${m.text()}`) })
  page.on('requestfailed', (r) => consoleLogs.push(`[reqfail] ${r.url()} ${r.failure()?.errorText ?? ''}`))
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  const stage = await page.evaluate(() => {
    const el = document.querySelector('.shell-stage')
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { w: Math.round(r.width), vw: window.innerWidth, h: Math.round(r.height), vh: window.innerHeight }
  })
  const dom = await page.evaluate(() => ({
    bodyChildren: document.body.children.length,
    rootHtml: document.getElementById('root')?.innerHTML.slice(0, 200) ?? 'NO_ROOT',
    bootVisible: Boolean(document.querySelector('.boot-screen')),
    shellVisible: Boolean(document.querySelector('.shell-root')),
    mq: {
      coarse: matchMedia('(pointer: coarse)').matches,
      fine: matchMedia('(pointer: fine)').matches,
      hoverNone: matchMedia('(hover: none)').matches,
      hoverHover: matchMedia('(hover: hover)').matches,
      min600: matchMedia('(min-width: 600px)').matches,
      tabletRule: matchMedia('(min-width: 600px) and (pointer: coarse) and (hover: none)').matches,
    },
    scrollPadding: (() => { const el = document.querySelector('.assistant-scroll'); return el ? getComputedStyle(el).paddingLeft : null })(),
  }))
  const shot = join(process.cwd(), 'scripts', `tablet-${name}.png`)
  await page.screenshot({ path: shot, fullPage: false })
  results.push({ name, stage, errors, consoleLogs, dom, shot })
  await ctx.close()
}

await check('ipad-portrait', { width: 768, height: 1024 })   // iPad 竖屏
await check('ipad-landscape', { width: 1024, height: 768 })  // iPad 横屏
await check('phone', { width: 390, height: 844 })             // 手机对照（不应被平板规则影响）

for (const r of results) {
  console.log(`[tablet-verify] ${r.name}: stage=${JSON.stringify(r.stage)} dom=${JSON.stringify(r.dom)} errors=${r.errors.length ? r.errors.join(';') : 'none'} logs=${r.consoleLogs.length ? r.consoleLogs.slice(0, 5).join(' | ') : 'none'} shot=${r.shot}`)
}
await browser.close()
server.close()
