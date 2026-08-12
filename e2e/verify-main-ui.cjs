/**
 * 简化版 CDP 验证脚本：检查应用是否进入主界面（而非 Onboarding 卡死）
 *
 * 使用方法：node e2e/verify-main-ui.cjs
 */
const http = require('http')
const WebSocket = require('ws')

const CDP_HOST = '127.0.0.1'
const CDP_PORT = 9222

function getTargets() {
  return new Promise((resolve, reject) => {
    http.get(`http://${CDP_HOST}:${CDP_PORT}/json`, { timeout: 10000 }, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => {
        try { resolve(JSON.parse(d)) } catch (e) { reject(e) }
      })
    }).on('error', reject).on('timeout', () => reject(new Error('HTTP timeout')))
  })
}

function createCdpSession(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 })
    const pending = new Map()
    const eventHandlers = new Map()
    let msgId = 0

    const send = (method, params = {}) => {
      return new Promise((resolve, reject) => {
        const id = ++msgId
        pending.set(id, { resolve, reject })
        ws.send(JSON.stringify({ id, method, params }))
      })
    }

    const on = (event, handler) => eventHandlers.set(event, handler)

    ws.on('open', () => resolve({ send, on, ws }))
    ws.on('message', (data) => {
      let msg
      try { msg = JSON.parse(data.toString()) } catch { return }
      if (msg.id !== undefined && pending.has(msg.id)) {
        const p = pending.get(msg.id)
        pending.delete(msg.id)
        if (msg.error) p.reject(new Error(`CDP error: ${JSON.stringify(msg.error)}`))
        else p.resolve(msg.result)
        return
      }
      if (msg.method && eventHandlers.has(msg.method)) {
        try { eventHandlers.get(msg.method)(msg.params) } catch (e) { console.error('Handler error:', e) }
      }
    })
    ws.on('error', (err) => reject(new Error(`WebSocket error: ${err.message}`)))
    ws.on('close', () => {
      for (const [, p] of pending) p.reject(new Error('WebSocket closed'))
    })
  })
}

async function main() {
  console.log('[1] Getting CDP targets...')
  const targets = await getTargets()
  const pageTarget = targets.find(t => t.type === 'page' && !t.url.startsWith('devtools://'))
  if (!pageTarget) {
    console.error('No page target found!')
    process.exit(1)
  }
  console.log(`[2] Connecting to: ${pageTarget.webSocketDebuggerUrl}`)
  const cdp = await createCdpSession(pageTarget.webSocketDebuggerUrl)

  // 收集 console 日志
  const consoleLogs = []
  await cdp.send('Runtime.enable')
  cdp.on('Runtime.consoleAPICalled', (params) => {
    const argsText = params.args.map(a => {
      if (a.value !== undefined) return JSON.stringify(a.value)
      if (a.description) return a.description
      if (a.unserializableValue) return a.unserializableValue
      return a.type
    }).join(' ')
    consoleLogs.push({ type: params.type, text: argsText })
  })

  // 捕获 JS 异常
  const pageErrors = []
  cdp.on('Runtime.exceptionThrown', (params) => {
    const ex = params.exceptionDetails
    pageErrors.push(ex.exception ? ex.exception.description : ex.text)
  })

  console.log('[3] Evaluating DOM state...')
  const result = await cdp.send('Runtime.evaluate', {
    expression: `JSON.stringify({
      location: window.location.href,
      readyState: document.readyState,
      title: document.title,
      hasAppRoot: !!document.querySelector('.app-root'),
      hasOnboarding: !!document.querySelector('[class*="onboarding"]') || document.body.innerText.includes('跳过'),
      hasBrowserHome: !!document.querySelector('.browser-home'),
      hasOmnibox: !!document.querySelector('.omnibox'),
      hasTitleBar: !!document.querySelector('[class*="titlebar"]') || !!document.querySelector('[class*="TitleBar"]'),
      hasSidebar: !!document.querySelector('.sidebar') || !!document.querySelector('[class*="Sidebar"]'),
      hasTabBar: !!document.querySelector('[class*="tab-bar"]') || !!document.querySelector('[class*="TabBar"]'),
      hasToast: !!document.querySelector('[class*="toast"]') || !!document.querySelector('[class*="Toast"]'),
      bodyInnerText: document.body ? document.body.innerText.substring(0, 1000) : '',
      rootFirstChildClass: document.getElementById('root')?.firstElementChild?.className || '(none)',
      inputCount: document.querySelectorAll('input').length,
      buttonCount: document.querySelectorAll('button').length,
    })`,
    returnByValue: true,
  })

  const state = JSON.parse(result.result.value)
  console.log('\n=== DOM State ===')
  console.log(JSON.stringify(state, null, 2))

  console.log('\n=== Analysis ===')
  if (state.hasAppRoot && (state.hasOmnibox || state.hasSidebar || state.hasTitleBar)) {
    console.log('✓ 应用已进入主界面（app-root + 主组件存在）')
  } else if (state.hasOnboarding || state.bodyInnerText.includes('跳过')) {
    console.log('⚠ 应用显示 Onboarding 页面（首次启动或 IDB 重建后正常）')
  } else {
    console.log('✗ 应用可能卡死（无 app-root 也无 Onboarding）')
  }

  console.log(`\n=== Console Logs (${consoleLogs.length}, last 20) ===`)
  consoleLogs.slice(-20).forEach((l, i) => {
    console.log(`  [${i}] [${l.type}] ${l.text.substring(0, 200)}`)
  })

  console.log(`\n=== Page Errors (${pageErrors.length}) ===`)
  pageErrors.forEach((e, i) => {
    console.log(`  [${i}] ${e.substring(0, 300)}`)
  })

  // 关键判断
  console.log('\n=== VERIFICATION RESULT ===')
  const hasMainUI = state.hasAppRoot && (state.hasOmnibox || state.hasSidebar || state.hasTitleBar)
  const hasOnboarding = state.hasOnboarding || state.bodyInnerText.includes('跳过')
  const isWhiteScreen = !hasMainUI && !hasOnboarding && state.bodyInnerText.length < 50

  if (hasMainUI) {
    console.log('PASS: 应用进入主界面，未卡死')
  } else if (hasOnboarding) {
    console.log('PASS: 应用显示 Onboarding（可跳过，未卡死）')
  } else if (isWhiteScreen) {
    console.log('FAIL: 应用白屏卡死')
  } else {
    console.log('UNKNOWN: 应用状态需人工检查')
  }

  cdp.ws.close()
}

main().catch((err) => {
  console.error('FATAL:', err)
  process.exit(1)
})
