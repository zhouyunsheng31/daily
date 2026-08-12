/**
 * Dev 模式白屏调试脚本（Raw CDP 版）
 *
 * 用途：通过原始 CDP（Chrome DevTools Protocol）WebSocket 连接到运行中的
 *       dev 模式 Electron 渲染进程，收集 console 日志、JS 异常、网络失败、
 *       非 2xx 响应，截图并分析 DOM，找出浏览器搜索白屏的真实根因。
 *
 * 为什么用 raw CDP 而非 Playwright connectOverCDP：
 *   Playwright connectOverCDP 在连接后做 CDP 协议初始化时会超时（30s+），
 *   可能因为 Electron 31 的 CDP 实现与 Playwright 的预期不一致，
 *   或因为渲染页 URL 为空导致 Playwright 的 target 枚举卡住。
 *   raw CDP 直接操作协议，更可控。
 *
 * 使用方法：
 *   1. 启动 dev 模式 Electron（带远程调试）：
 *      $env:REMOTE_DEBUGGING_PORT=9222; npm run dev -- --remote-debugging-port=9222
 *   2. 等待应用启动（约 15-30s）
 *   3. 运行本脚本：
 *      node e2e/debug-dev-white-screen.cjs
 *
 * 输出：
 *   - f:\allmylife\event\e2e\screenshots\dev-debug-1.png  （触发搜索前）
 *   - f:\allmylife\event\e2e\screenshots\dev-debug-2.png  （触发搜索后）
 *   - stdout：所有 console / pageerror / requestfailed / 非 2xx response
 */

const http = require('http')
const fs = require('fs')
const path = require('path')
const WebSocket = require('ws')

const CDP_HOST = '127.0.0.1'
const CDP_PORT = 9222
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots')
const SHOT1 = path.join(SCREENSHOT_DIR, 'dev-debug-1.png')
const SHOT2 = path.join(SCREENSHOT_DIR, 'dev-debug-2.png')

// 收集器
const consoleLogs = []
const pageErrors = []          // exceptionThrown 事件
const requestFailed = []       // loadingFailed 事件
const responses = []           // responseReceived 非 2xx
const entryMap = new Map()     // requestId -> {url, method} 用于 loadingFailed 时获取 URL

let msgId = 0
function nextId() { return ++msgId }

function ts() {
  return new Date().toISOString()
}

/** 通过 HTTP 获取 CDP targets */
function getTargets() {
  return new Promise((resolve, reject) => {
    http.get(`http://${CDP_HOST}:${CDP_PORT}/json`, { timeout: 15000 }, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => {
        try { resolve(JSON.parse(d)) } catch (e) { reject(e) }
      })
    }).on('error', reject).on('timeout', () => reject(new Error('HTTP timeout')))
  })
}

/** 创建 CDP 会话：连接到 page-level WebSocket */
function createCdpSession(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 })
    const pending = new Map() // id -> {resolve, reject}
    const eventHandlers = new Map() // method -> handler

    const send = (method, params = {}) => {
      return new Promise((resolve, reject) => {
        const id = nextId()
        pending.set(id, { resolve, reject })
        ws.send(JSON.stringify({ id, method, params }))
      })
    }

    const on = (event, handler) => {
      eventHandlers.set(event, handler)
    }

    ws.on('open', () => {
      resolve({ send, on, ws })
    })

    ws.on('message', (data) => {
      let msg
      try { msg = JSON.parse(data.toString()) } catch { return }
      // 响应
      if (msg.id !== undefined && pending.has(msg.id)) {
        const p = pending.get(msg.id)
        pending.delete(msg.id)
        if (msg.error) p.reject(new Error(`CDP error: ${JSON.stringify(msg.error)}`))
        else p.resolve(msg.result)
        return
      }
      // 事件
      if (msg.method && eventHandlers.has(msg.method)) {
        try { eventHandlers.get(msg.method)(msg.params) } catch (e) { console.error('Event handler error:', e) }
      }
      // 通配事件（用于调试）
      if (msg.method && eventHandlers.has('*')) {
        try { eventHandlers.get('*')(msg) } catch (e) { console.error('Wildcard handler error:', e) }
      }
    })

    ws.on('error', (err) => {
      reject(new Error(`WebSocket error: ${err.message}`))
    })

    ws.on('close', () => {
      // 拒绝所有 pending
      for (const [, p] of pending) p.reject(new Error('WebSocket closed'))
    })
  })
}

async function main() {
  console.log(`[${ts()}] Step 1: Getting CDP targets ...`)

  // 确保截图目录存在
  if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })

  const targets = await getTargets()
  console.log(`[${ts()}] Targets: ${targets.length}`)
  targets.forEach((t, i) => {
    console.log(`  [${i}] type=${t.type} title="${t.title}" url="${t.url ? t.url.substring(0, 100) : ''}"`)
  })

  // 找到主渲染页（非 devtools）
  let pageTarget = targets.find(t => t.type === 'page' && !t.url.startsWith('devtools://'))
  if (!pageTarget) {
    console.error('No renderer page target found!')
    process.exit(1)
  }

  console.log(`[${ts()}] Step 2: Connecting to page WebSocket: ${pageTarget.webSocketDebuggerUrl}`)
  const cdp = await createCdpSession(pageTarget.webSocketDebuggerUrl)
  console.log(`[${ts()}] CDP session connected.`)

  // ===== 注册事件收集器 =====

  // Runtime 域：捕获 JS 异常
  await cdp.send('Runtime.enable')
  cdp.on('Runtime.exceptionThrown', (params) => {
    const ex = params.exceptionDetails
    pageErrors.push({
      t: ts(),
      text: ex.exception ? ex.exception.description : ex.text,
      line: ex.lineNumber,
      col: ex.columnNumber,
      url: ex.url,
    })
  })

  // Log 域：捕获 console 日志（Runtime.consoleAPICalled 也可以，但 Log 域更全）
  await cdp.send('Log.enable')
  cdp.on('Log.entryAdded', (params) => {
    const entry = params.entry
    consoleLogs.push({
      t: ts(),
      type: entry.level,
      text: entry.text,
      url: entry.url,
      line: entry.lineNumber,
    })
  })

  // 也监听 Runtime.consoleAPICalled（捕获 console.log/error 等）
  cdp.on('Runtime.consoleAPICalled', (params) => {
    const argsText = params.args.map(a => {
      if (a.value !== undefined) return JSON.stringify(a.value)
      if (a.description) return a.description
      if (a.unserializableValue) return a.unserializableValue
      return a.type
    }).join(' ')
    consoleLogs.push({
      t: ts(),
      type: params.type, // log, error, warning, info, debug
      text: argsText,
    })
  })

  // Network 域：捕获网络失败和非 2xx 响应
  await cdp.send('Network.enable')
  cdp.on('Network.requestWillBeSent', (params) => {
    entryMap.set(params.requestId, {
      url: params.request.url,
      method: params.request.method,
    })
  })
  cdp.on('Network.responseReceived', (params) => {
    const status = params.response.status
    if (status < 200 || status >= 300) {
      responses.push({
        t: ts(),
        url: params.response.url,
        status,
        statusText: params.response.statusText,
      })
    }
  })
  cdp.on('Network.loadingFailed', (params) => {
    const entry = entryMap.get(params.requestId)
    requestFailed.push({
      t: ts(),
      url: entry ? entry.url : '(unknown)',
      method: entry ? entry.method : '?',
      errorText: params.errorText,
      blockedReason: params.blockedReason,
    })
  })

  // Page 域
  await cdp.send('Page.enable')

  console.log(`[${ts()}] Step 3: All CDP domains enabled. Checking current page state ...`)

  // ===== 检查当前页面状态 =====
  let pageState
  try {
    const result = await cdp.send('Runtime.evaluate', {
      expression: `JSON.stringify({
        location: window.location.href,
        readyState: document.readyState,
        title: document.title,
        bodyExists: !!document.body,
        bodyInnerHTMLLen: document.body ? document.body.innerHTML.length : -1,
        bodyInnerTextLen: document.body ? document.body.innerText.length : -1,
        rootExists: !!document.getElementById('root'),
        rootInnerHTMLLen: document.getElementById('root') ? document.getElementById('root').innerHTML.length : -1,
        hasServerPortApi: typeof window.serverPortApi !== 'undefined',
        serverPort: typeof window.serverPortApi !== 'undefined' ? String(window.serverPortApi.getServerPort()) : 'undefined',
        hasMenuApi: typeof window.menuApi !== 'undefined',
        hasWebviewApi: typeof window.webviewApi !== 'undefined',
        hasWindowApi: typeof window.windowApi !== 'undefined',
        hasAgentApi: typeof window.agentApi !== 'undefined',
        hasCookieApi: typeof window.cookieApi !== 'undefined',
      })`,
      returnByValue: true,
    })
    pageState = JSON.parse(result.result.value)
    console.log(`[${ts()}] Page State:`)
    console.log(JSON.stringify(pageState, null, 2))
  } catch (e) {
    console.log(`[${ts()}] Runtime.evaluate failed: ${e.message}`)
    pageState = { error: e.message }
  }

  // ===== 如果页面 URL 为空，尝试导航到 dev server =====
  if (!pageState.location || pageState.location === '' || pageState.location === 'about:blank') {
    console.log(`[${ts()}] Page URL is empty! Attempting to navigate to http://localhost:5173/ ...`)
    try {
      const navResult = await cdp.send('Page.navigate', { url: 'http://localhost:5173/' })
      console.log(`[${ts()}] Navigate result: ${JSON.stringify(navResult)}`)
      // 等待页面加载
      console.log(`[${ts()}] Waiting 10s for page to load ...`)
      await new Promise(r => setTimeout(r, 10000))

      // 重新检查
      const result2 = await cdp.send('Runtime.evaluate', {
        expression: `JSON.stringify({
          location: window.location.href,
          readyState: document.readyState,
          bodyInnerHTMLLen: document.body ? document.body.innerHTML.length : -1,
        })`,
        returnByValue: true,
      })
      console.log(`[${ts()}] After navigate: ${result2.result.value}`)
    } catch (e) {
      console.log(`[${ts()}] Navigate failed: ${e.message}`)
    }
  }

  // ===== 等待页面稳定 =====
  console.log(`[${ts()}] Waiting 5s for events to accumulate ...`)
  await new Promise(r => setTimeout(r, 5000))

  // ===== 截图 1：触发搜索前 =====
  console.log(`[${ts()}] Step 4: Taking screenshot 1 -> ${SHOT1}`)
  try {
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(SHOT1, Buffer.from(shot.data, 'base64'))
    console.log(`[${ts()}] Screenshot 1 saved.`)
  } catch (e) {
    console.log(`[${ts()}] Screenshot 1 failed: ${e.message}`)
  }

  // ===== DOM 检查 1 =====
  console.log(`[${ts()}] Step 5: DOM inspection 1 ...`)
  let domInfo1
  try {
    const result = await cdp.send('Runtime.evaluate', {
      expression: `JSON.stringify({
        location: window.location.href,
        bodyFirst2000: document.body ? document.body.innerHTML.substring(0, 2000) : '(no body)',
        rootFirst2000: document.getElementById('root') ? document.getElementById('root').innerHTML.substring(0, 2000) : '(no #root)',
        hasAppRoot: !!document.querySelector('.app-root'),
        hasBrowserHome: !!document.querySelector('.browser-home'),
        hasOmnibox: !!document.querySelector('.omnibox'),
        hasTitleBar: !!document.querySelector('.titlebar, [class*="title"]'),
        hasOfflineBanner: !!document.querySelector('[class*="offline"], [class*="banner"]'),
        bodyInnerText: document.body ? document.body.innerText.substring(0, 500) : '',
        webviewCount: document.querySelectorAll('webview').length,
        inputCount: document.querySelectorAll('input').length,
        inputPlaceholders: Array.from(document.querySelectorAll('input')).map(i => i.placeholder).filter(Boolean),
      })`,
      returnByValue: true,
    })
    domInfo1 = JSON.parse(result.result.value)
    console.log(`[${ts()}] DOM Info 1:`)
    console.log(JSON.stringify(domInfo1, null, 2))
  } catch (e) {
    console.log(`[${ts()}] DOM evaluate 1 failed: ${e.message}`)
    domInfo1 = { error: e.message }
  }

  // ===== 尝试触发搜索 =====
  console.log(`[${ts()}] Step 6: Attempting to trigger search ...`)

  // 策略 1：BrowserHome 搜索框
  let searchTriggered = false
  try {
    const findResult = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const input = document.querySelector('input[placeholder*="输入网址"]');
        return input ? 'found-browserhome' : 'not-found';
      })()`,
      returnByValue: true,
    })
    if (findResult.result.value === 'found-browserhome') {
      console.log(`[${ts()}] Found BrowserHome search input. Filling and pressing Enter ...`)
      // 用 DOM 操作填充 input 并触发 React onChange
      await cdp.send('Runtime.evaluate', {
        expression: `(() => {
          const input = document.querySelector('input[placeholder*="输入网址"]');
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          nativeInputValueSetter.call(input, 'test search');
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
          return 'done';
        })()`,
        returnByValue: true,
      })
      searchTriggered = true
      console.log(`[${ts()}] Search triggered via BrowserHome input.`)
    } else {
      console.log(`[${ts()}] BrowserHome search input not found.`)
    }
  } catch (e) {
    console.log(`[${ts()}] BrowserHome search trigger failed: ${e.message}`)
  }

  // 策略 2：Omnibox
  if (!searchTriggered) {
    try {
      const findResult = await cdp.send('Runtime.evaluate', {
        expression: `(() => {
          const input = document.querySelector('.omnibox__input');
          return input ? 'found-omnibox' : 'not-found';
        })()`,
        returnByValue: true,
      })
      if (findResult.result.value === 'found-omnibox') {
        console.log(`[${ts()}] Found Omnibox input. Filling and pressing Enter ...`)
        await cdp.send('Runtime.evaluate', {
          expression: `(() => {
            const input = document.querySelector('.omnibox__input');
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            nativeInputValueSetter.call(input, 'test search');
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            return 'done';
          })()`,
          returnByValue: true,
        })
        searchTriggered = true
        console.log(`[${ts()}] Search triggered via Omnibox input.`)
      } else {
        console.log(`[${ts()}] Omnibox input not found.`)
      }
    } catch (e) {
      console.log(`[${ts()}] Omnibox search trigger failed: ${e.message}`)
    }
  }

  // 策略 3：任何 input
  if (!searchTriggered) {
    try {
      const findResult = await cdp.send('Runtime.evaluate', {
        expression: `(() => {
          const inputs = document.querySelectorAll('input');
          return inputs.length > 0 ? 'found-' + inputs.length : 'not-found';
        })()`,
        returnByValue: true,
      })
      if (findResult.result.value.startsWith('found-')) {
        console.log(`[${ts()}] Found ${findResult.result.value}. Using first input ...`)
        await cdp.send('Runtime.evaluate', {
          expression: `(() => {
            const input = document.querySelectorAll('input')[0];
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            nativeInputValueSetter.call(input, 'test search');
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            return 'done';
          })()`,
          returnByValue: true,
        })
        searchTriggered = true
        console.log(`[${ts()}] Search triggered via first input.`)
      } else {
        console.log(`[${ts()}] No input found on page.`)
      }
    } catch (e) {
      console.log(`[${ts()}] Generic input search trigger failed: ${e.message}`)
    }
  }

  // ===== 等待观察搜索后状态 =====
  console.log(`[${ts()}] Step 7: Waiting 8s to observe post-search state ...`)
  await new Promise(r => setTimeout(r, 8000))

  // ===== 截图 2：触发搜索后 =====
  console.log(`[${ts()}] Step 8: Taking screenshot 2 -> ${SHOT2}`)
  try {
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(SHOT2, Buffer.from(shot.data, 'base64'))
    console.log(`[${ts()}] Screenshot 2 saved.`)
  } catch (e) {
    console.log(`[${ts()}] Screenshot 2 failed: ${e.message}`)
  }

  // ===== DOM 检查 2 =====
  console.log(`[${ts()}] Step 9: DOM inspection 2 ...`)
  let domInfo2
  try {
    const result = await cdp.send('Runtime.evaluate', {
      expression: `JSON.stringify({
        location: window.location.href,
        bodyFirst2000: document.body ? document.body.innerHTML.substring(0, 2000) : '(no body)',
        rootFirst2000: document.getElementById('root') ? document.getElementById('root').innerHTML.substring(0, 2000) : '(no #root)',
        hasAppRoot: !!document.querySelector('.app-root'),
        hasBrowserHome: !!document.querySelector('.browser-home'),
        hasWebTabFullscreen: !!document.querySelector('.web-tab-fullscreen'),
        webviewCount: document.querySelectorAll('webview').length,
        webviewInfo: Array.from(document.querySelectorAll('webview')).map(w => {
          const info = {};
          try { info.url = w.getURL() } catch(e) { info.url = '(error: ' + e.message + ')' }
          try { info.title = w.getTitle() } catch(e) { info.title = '(error)' }
          info.style = w.style.cssText;
          return info;
        }),
        hasErrorUi: !!document.querySelector('.webview-widget__error'),
        bodyInnerText: document.body ? document.body.innerText.substring(0, 500) : '',
      })`,
      returnByValue: true,
    })
    domInfo2 = JSON.parse(result.result.value)
    console.log(`[${ts()}] DOM Info 2:`)
    console.log(JSON.stringify(domInfo2, null, 2))
  } catch (e) {
    console.log(`[${ts()}] DOM evaluate 2 failed: ${e.message}`)
    domInfo2 = { error: e.message }
  }

  // ===== 输出所有收集的事件 =====
  console.log('\n')
  console.log('='.repeat(80))
  console.log('COLLECTED EVENTS REPORT')
  console.log('='.repeat(80))

  console.log(`\n--- Console Logs (${consoleLogs.length}) ---`)
  consoleLogs.forEach((l, i) => {
    console.log(`[${i}] ${l.t} [${l.type}] ${l.text}${l.url ? ' (' + l.url + ':' + (l.line || 0) + ')' : ''}`)
  })

  console.log(`\n--- Page Errors / Exceptions (${pageErrors.length}) ---`)
  pageErrors.forEach((e, i) => {
    console.log(`[${i}] ${e.t} ${e.text}${e.url ? ' (' + e.url + ':' + (e.line || 0) + ')' : ''}`)
  })

  console.log(`\n--- Request Failed (${requestFailed.length}) ---`)
  requestFailed.forEach((r, i) => {
    console.log(`[${i}] ${r.t} ${r.method} ${r.url} -> ${r.errorText}${r.blockedReason ? ' (blocked: ' + r.blockedReason + ')' : ''}`)
  })

  console.log(`\n--- Non-2xx Responses (${responses.length}) ---`)
  responses.forEach((r, i) => {
    console.log(`[${i}] ${r.t} ${r.status} ${r.statusText} ${r.url}`)
  })

  // ===== 汇总 =====
  console.log('\n')
  console.log('='.repeat(80))
  console.log('SUMMARY')
  console.log('='.repeat(80))
  console.log(`Page URL: ${pageState.location || '(empty)'}`)
  console.log(`Page readyState: ${pageState.readyState || '?'}`)
  console.log(`Console logs: ${consoleLogs.length}`)
  console.log(`  - error: ${consoleLogs.filter(l => l.type === 'error' || l.type === 'Error').length}`)
  console.log(`  - warning: ${consoleLogs.filter(l => l.type === 'warning' || l.type === 'Warning').length}`)
  console.log(`  - log: ${consoleLogs.filter(l => l.type === 'log' || l.type === 'info').length}`)
  console.log(`Page errors/exceptions: ${pageErrors.length}`)
  console.log(`Request failed: ${requestFailed.length}`)
  console.log(`Non-2xx responses: ${responses.length}`)
  console.log(`Screenshot 1: ${fs.existsSync(SHOT1) ? 'saved' : 'FAILED'} (${SHOT1})`)
  console.log(`Screenshot 2: ${fs.existsSync(SHOT2) ? 'saved' : 'FAILED'} (${SHOT2})`)

  // 关闭 WebSocket
  cdp.ws.close()
  console.log(`\n[${ts()}] Done. CDP session closed (Electron stays running).`)
}

main().catch((err) => {
  console.error('FATAL:', err)
  process.exit(1)
})
