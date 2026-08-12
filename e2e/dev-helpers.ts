/**
 * Dev 模式 Electron 启动辅助。
 *
 * 与 electron-helpers.ts 的关键差异：
 *   - 保留 ELECTRON_RENDERER_URL（让主进程走 loadURL 分支，而非 loadFile）
 *   - 用 vite Node API 启动 renderer dev server（端口 5173）
 *   - userData 隔离到 e2e/.tmp/userData-XXXX（项目内 .gitignore 目录，不污染 C 盘 %TEMP%）
 *   - 等待后端 /api/health 就绪（dev 模式 tsx 编译慢，超时 120s）
 *
 * 【维护提醒】此处的 vite 配置复制自 electron.vite.config.ts 的 renderer 部分，
 *   改动任一处时必须同步（plugins/alias/proxy/port/publicDir/envDir）。
 */
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { createServer, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'

const DEV_SERVER_PORT = 5173
// 用 127.0.0.1 而非 localhost：Windows 下 localhost 会优先解析到 IPv6 (::1)，
// 而 Node httpServer.listen(PORT) 在某些 Windows 配置下只绑 IPv4 (0.0.0.0)，
// 导致连接 ::1 失败、回退 127.0.0.1 又产生 AggregateError，是 vite proxy 间歇性
// "internalConnectMultiple" 报错的根因。强制 IPv4 一劳永逸。
const DEV_SERVER_URL = `http://127.0.0.1:${DEV_SERVER_PORT}`
const BACKEND_PORT = 3456
const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`
const PROJECT_ROOT = resolve(import.meta.dirname, '..')
const TMP_DIR = resolve(import.meta.dirname, '.tmp')

export interface DevElectronFixture {
  app: ElectronApplication
  window: Page
  viteServer: ViteDevServer
  userDataDir: string
}

/**
 * 用 vite Node API 启动 renderer dev server。
 *
 * 复制 electron.vite.config.ts 中 renderer 部分的关键配置（plugins/alias/proxy/port/publicDir/envDir），
 * 而非 import 整个 electron.vite.config.ts —— 它是 main/preload/renderer 三合一复合配置，
 * 直接喂给 vite.createServer 会报错。
 *
 * strictPort: true —— 端口被占则直接报错，避免静默换端口导致 ELECTRON_RENDERER_URL 不匹配。
 */
async function startViteDevServer(): Promise<ViteDevServer> {
  const server = await createServer({
    root: resolve(PROJECT_ROOT, 'client/desktop'),
    publicDir: resolve(PROJECT_ROOT, 'client/desktop/public'),
    envDir: PROJECT_ROOT,
    configFile: false, // 不读 electron.vite.config.ts
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': resolve(PROJECT_ROOT, 'client/desktop/src'),
        'shared': resolve(PROJECT_ROOT, 'shared'),
      },
    },
    server: {
      port: DEV_SERVER_PORT,
      strictPort: true,
      host: '127.0.0.1',  // 显式绑 IPv4，避免 IPv6 解析问题
      proxy: {
        '/api': { target: BACKEND_URL, changeOrigin: true },
        '/ws': { target: `ws://127.0.0.1:${BACKEND_PORT}`, ws: true, changeOrigin: true },
        '/llm-proxy/api.st0722.top': {
          target: 'https://api.st0722.top',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/llm-proxy\/api\.st0722\.top/, ''),
          secure: true,
        },
        '/llm-proxy/chat.st0722.top': {
          target: 'https://chat.st0722.top',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/llm-proxy\/chat\.st0722\.top/, ''),
          secure: true,
        },
        '/llm-proxy/api.stepfun.com': {
          target: 'https://api.stepfun.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/llm-proxy\/api\.stepfun\.com/, ''),
          secure: true,
        },
      },
    },
  })
  await server.listen()
  return server
}

/**
 * 等待 vite dev server 就绪（响应 HTTP 200）。
 *
 * 首次启动时 vite 会 "Re-optimizing dependencies because vite config has changed"，
 * 耗时可能 10-30s。期间 Electron 加载 5173 会卡在白屏 → waitForLoadState 超时 → beforeAll 失败。
 * 此函数在 electron.launch 之前轮询 5173，确保 vite 已完成首屏优化。
 */
async function waitForViteReady(timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastErr: unknown = null
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${DEV_SERVER_URL}/`)
      if (res.ok) return
    } catch (err) {
      lastErr = err
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(
    `Vite dev server not ready within ${timeoutMs}ms at ${DEV_SERVER_URL} (last error: ${String(lastErr)})`,
  )
}

/**
 * 等待后端 /api/health 就绪。
 * dev 模式 tsx 编译 + PiBridge 加载可能需要 30-50s（见 serverProcess.ts 注释），
 * 用户要求超时 120s（覆盖方案的 60s），给慢机/CI 留足余量。
 *
 * 用 127.0.0.1 而非 localhost：Windows 下 localhost 会优先解析到 IPv6 (::1)，
 * 而 server 子进程的 httpServer.listen(PORT) 在 Windows 上默认只绑 IPv4 (0.0.0.0)，
 * 直接 fetch localhost:3456 会先尝试 ::1 → ECONNREFUSED → 回退 127.0.0.1，
 * 产生 AggregateError 和间歇性失败。强制 IPv4 避免此问题。
 */
async function waitForBackend(timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastErr: unknown = null
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BACKEND_URL}/api/health`)
      if (res.ok) return
    } catch (err) {
      lastErr = err
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error(
    `Backend /api/health not ready within ${timeoutMs}ms at ${BACKEND_URL} (last error: ${String(lastErr)})`,
  )
}

/**
 * 启动 dev 模式 Electron 应用。
 *
 * 步骤：
 *   1. 启动 vite renderer dev server（端口 5173，strictPort）
 *   2. 准备隔离的 userData 目录（e2e/.tmp/userData-XXXX，项目内非 C 盘）
 *   3. _electron.launch 启动 out/main/index.js，env 注入 ELECTRON_RENDERER_URL
 *   4. 等首个窗口 + domcontentloaded
 *   5. 等后端 /api/health 就绪（主进程 startServer 已 fork 后端，dev 模式启动慢）
 */
export async function launchDevApp(): Promise<DevElectronFixture> {
  // 1. 启动 vite dev server（renderer）
  const viteServer = await startViteDevServer()

  // 1.5 等 vite 完成首屏优化（否则 Electron 加载 5173 会白屏 → waitForLoadState 超时）
  await waitForViteReady()

  // 2. 准备隔离的 userData 目录（e2e/.tmp/userData-XXXX，项目内 .gitignore，不污染 C 盘）
  mkdirSync(TMP_DIR, { recursive: true })
  const userDataDir = mkdtempSync(join(TMP_DIR, 'userData-'))

  // 3. 启动 Electron —— 保留 ELECTRON_RENDERER_URL，让主进程走 loadURL 分支
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    ELECTRON_RENDERER_URL: DEV_SERVER_URL,
    // 不 delete ELECTRON_RENDERER_URL —— 这是 dev 模式的核心标志
  }
  const mainPath = join(PROJECT_ROOT, 'out', 'main', 'index.js')

  let app: ElectronApplication | null = null
  try {
    app = await electron.launch({
      args: [mainPath, `--user-data-dir=${userDataDir}`],
      env,
      cwd: PROJECT_ROOT,
    })

    // 4. 等首个窗口 + domcontentloaded
    // firstWindow 默认 30s 太短：主进程 await startServer() 在 dev 模式可能阻塞 60s（tsx 编译），
    // 窗口在 server 启动后才创建，firstWindow 需等更久。给 120s 覆盖最慢情况。
    const window = await app.firstWindow({ timeout: 120_000 })
    await window.waitForLoadState('domcontentloaded', { timeout: 60_000 })

    // 5. 等后端就绪（主进程 startServer 已 fork 后端，dev 模式 tsx 编译慢）
    await waitForBackend()

    return { app, window, viteServer, userDataDir }
  } catch (err) {
    // 清理容错：launchDevApp 任一步失败都先关 Electron + vite，避免泄漏
    // （特别是 beforeAll 失败时 afterAll 拿不到 fixture → vite server 泄漏 → 下次 strictPort 冲突）
    if (app) {
      try { await app.close() } catch { /* ignore */ }
    }
    try { await viteServer.close() } catch { /* ignore */ }
    throw err
  }
}

/**
 * 关闭 dev 模式 Electron 应用 + vite dev server，并清理临时 userData 目录。
 *
 * 容错策略：每一步都 try/catch，避免某一步失败影响后续清理。
 * userDataDir 清理失败不报错（Windows 下 Electron 退出后文件句柄延迟释放，强删可能失败）。
 */
export async function closeDevApp(fixture: DevElectronFixture | null | undefined): Promise<void> {
  if (fixture?.app) {
    try {
      await fixture.app.close()
    } catch {
      // ignore — 应用可能已退出
    }
    // app.close() 会触发主进程 before-quit → stopServer()，释放 3456 端口
  }
  if (fixture?.viteServer) {
    try {
      await fixture.viteServer.close()
    } catch {
      // ignore
    }
  }
  if (fixture?.userDataDir) {
    // 延迟一点再删，给 Electron 子进程句柄释放时间
    await new Promise((r) => setTimeout(r, 500))
    try {
      rmSync(fixture.userDataDir, { recursive: true, force: true })
    } catch {
      // ignore — Windows 下文件句柄可能未释放，留给 CI/下次启动清理
    }
  }
}
