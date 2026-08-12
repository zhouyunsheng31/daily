/**
 * Dev 模式冒烟测试。
 *
 * 与 smoke.spec.ts 的区别：
 *   - 用 launchDevApp（保留 ELECTRON_RENDERER_URL，走 loadURL 分支）
 *   - 验证 dev server URL、vite proxy /api、WebSocket proxy /ws、pageerror、requestfailed、后端 dev 端口
 *   - 单独运行：npm run test:e2e:dev
 *
 * 设计要点：
 *   - 直接用 base test（不引入 fixtures.ts 的 electron fixture，那是 prod 专用）
 *   - beforeAll 启动一次，afterAll 关闭一次（dev 启动慢，避免每个 test 重启）
 *   - pageerror / requestfailed 在 beforeAll 后立即挂监听，捕获整个会话期间的异常
 *   - requestfailed 过滤外网 webview URL，只断言 127.0.0.1:5173 / 127.0.0.1:3456 本地资源
 *     （/api/ /ws/ 后端代理请求瞬态失败可接受，由 test 8/9 单独覆盖）
 */
import { test, expect } from '@playwright/test'
import { launchDevApp, closeDevApp, type DevElectronFixture } from './dev-helpers'

test.describe('Electron dev mode smoke', () => {
  let fixture: DevElectronFixture | null = null
  const pageerrors: Error[] = []
  const requestfailed: string[] = []

  // dev 启动慢（vite server + tsx 编译后端 30-60s），beforeAll 给 180s
  // （vite 首次 optimize deps 10-30s + 后端 tsx 编译 5-30s + waitForBackend 轮询）
  // 注：test.beforeAll(fn, timeout) 的 timeout 参数在某些 Playwright 版本不生效，
  //     必须在 hook 内部调 test.setTimeout() 才能可靠覆盖默认 60s
  test.beforeAll(async () => {
    test.setTimeout(180_000)
    fixture = await launchDevApp()
    fixture.window.on('pageerror', (e) => pageerrors.push(e))
    fixture.window.on('requestfailed', (req) => {
      const url = req.url()
      // 只关注本地 dev server / 后端请求，忽略外网 webview（用户内容可能加载各种外站）
      // 匹配 127.0.0.1:5173 / 127.0.0.1:3456（以及遗留的 localhost:5173 / localhost:3456）
      if (url.includes('127.0.0.1:5173') || url.includes('127.0.0.1:3456') ||
          url.includes('localhost:5173') || url.includes('localhost:3456')) {
        requestfailed.push(`${req.method()} ${url} -> ${req.failure()?.errorText ?? 'unknown'}`)
      }
    })
  })

  test.afterAll(async () => {
    await closeDevApp(fixture)
    fixture = null
  })

  test('dev: 应用以 dev 模式启动并加载 dev server URL', async () => {
    const url = fixture!.window.url()
    // dev 模式窗口 URL 应是 vite dev server（127.0.0.1:5173），而非 file://
    expect(url).toContain('127.0.0.1:5173')

    const title = await fixture!.window.title()
    expect(title).toBe('Daily')

    // 验证窗口确实可见（非空 bounds）
    const bounds = await fixture!.app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      return win ? win.getBounds() : null
    })
    expect(bounds).not.toBeNull()
    expect(bounds!.width).toBeGreaterThan(0)
    expect(bounds!.height).toBeGreaterThan(0)
  })

  test('dev: 后端 API 通过 vite proxy 可达 (/api/health)', async () => {
    // 经 vite proxy（/api -> localhost:3456）访问后端 health
    const result = await fixture!.window.evaluate(async () => {
      const res = await fetch('/api/health')
      return { status: res.status, body: await res.json() }
    })
    expect(result.status).toBe(200)
    expect(result.body.status).toBe('ok')
  })

  test('dev: WebSocket 通过 vite proxy 可连接', async () => {
    const connected = await fixture!.window.evaluate(async () => {
      return new Promise<boolean>((resolve) => {
        // 用 127.0.0.1 而非 localhost：避免 Windows IPv6 解析导致 ws 间歇性失败
        const ws = new WebSocket('ws://127.0.0.1:5173/ws')
        const timer = setTimeout(() => {
          ws.close()
          resolve(false)
        }, 5000)
        ws.onopen = () => {
          clearTimeout(timer)
          ws.close()
          resolve(true)
        }
        ws.onerror = () => {
          clearTimeout(timer)
          resolve(false)
        }
      })
    })
    expect(connected).toBe(true)
  })

  test('dev: 无 pageerror', async () => {
    // 给渲染进程一点时间触发可能的错误（HMR、sourcemap、React Refresh）
    await fixture!.window.waitForTimeout(2000)
    expect(pageerrors, pageerrors.map((e) => e.message).join('\n')).toEqual([])
  })

  test('dev: 无 requestfailed (本地静态资源)', async () => {
    await fixture!.window.waitForTimeout(2000)
    // 只断言本地静态资源失败（vite dev server 自身资源，如 .tsx/.css/.js HMR），
    // 过滤 /api/ 和 /ws 请求：这些是后端请求，dev 模式下后端启动慢、HMR 期间瞬态失败是预期的，
    // 不是 dev server 本身的问题。后端可用性已由 test 8 (/api/health) 和 test 9 (ws) 单独覆盖。
    const staticFailures = requestfailed.filter((entry) => {
      // /api/ 和 /ws 是后端代理请求，瞬态失败可接受
      if (entry.includes(' /api/') || entry.includes(' /ws')) return false
      return true
    })
    expect(staticFailures, staticFailures.join('\n')).toEqual([])
  })

  test('dev: 后端在 dev 固定端口 3456 启动（serverProcess dev 分支正常）', async () => {
    // 直连后端 dev 固定端口 3456（区别于 prod 的 PORT=0 随机端口）
    // 这验证 serverProcess.ts 的 dev 分支（tsx loader + system node + PORT=3456）正常工作
    // 等价于方案文档"后端启动日志出现在主进程 stdout"——server.log 由 serverProcess 写，
    // 3456 可达即证明 dev 分支已跑通
    //
    // 重试 3 次（间隔 1s）：主进程 fetch 127.0.0.1:3456 偶发 ECONNRESET（Windows 端口复用延迟），
    // 重试能消除瞬态失败。用 127.0.0.1 而非 localhost 避免 IPv6 ::1 解析问题。
    const result = await fixture!.app.evaluate(async () => {
      const rendererUrl = process.env.ELECTRON_RENDERER_URL
      let lastErr: string | null = null
      for (let i = 0; i < 3; i++) {
        try {
          const res = await fetch('http://127.0.0.1:3456/api/health')
          const body = await res.json()
          return { status: res.status, ok: res.ok, rendererUrl, body, attempts: i + 1 }
        } catch (err) {
          lastErr = String(err)
          await new Promise((r) => setTimeout(r, 1000))
        }
      }
      return { status: 0, ok: false, rendererUrl, err: lastErr, attempts: 3 }
    })
    expect(result.rendererUrl).toBe('http://127.0.0.1:5173')
    expect(result.ok).toBe(true)
    expect(result.status).toBe(200)
  })
})
