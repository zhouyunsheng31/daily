import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push('[console] ' + m.text()) })
const resp = await page.goto('https://admin.shadowshub.xyz/', { waitUntil: 'networkidle', timeout: 30000 })
await page.waitForTimeout(3000)
const state = await page.evaluate(() => ({
  rootChildren: document.getElementById('root')?.children.length ?? -1,
  text: (document.getElementById('root')?.textContent ?? '').slice(0, 150),
  hasLogin: Boolean(document.querySelector('input[type=password]')),
}))
console.log('HTTP', resp?.status(), 'errors=', JSON.stringify(errors))
console.log('state=', JSON.stringify(state))
await page.screenshot({ path: 'scripts/admin-check.png' })
await browser.close()