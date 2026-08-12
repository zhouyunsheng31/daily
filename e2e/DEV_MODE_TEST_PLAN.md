# Dev 模式冒烟测试方案

> 目标：让项目未来能自动测出 dev 模式启动问题（dev server URL 加载、vite proxy 透传 API、WebSocket 代理、pageerror/requestfailed）。
>
> 本文档只设计方案，不含落地代码文件。Review 通过后再实施。

---

## 1. 问题分析：为什么现有测试测不出 dev 模式问题

### 1.1 根因定位

`e2e\electron-helpers.ts` 第 27 行：

```ts
const env = { ...process.env }
delete env.ELECTRON_RENDERER_URL   // ← 强制 prod 模式
```

主进程 `client\desktop\electron\main\index.ts` 第 264-273 行用 `ELECTRON_RENDERER_URL` 作为 dev/prod 模式的**唯一开关**：

```ts
const rendererUrl = process.env['ELECTRON_RENDERER_URL']
if (rendererUrl) {
  mainWindow?.loadURL(rendererUrl)            // dev：加载 vite dev server
  mainWindow?.webContents.openDevTools()
} else {
  mainWindow?.loadFile('../renderer/index.html')  // prod：加载打包文件
}
```

`delete env.ELECTRON_RENDERER_URL` 让主进程走 `loadFile` 分支，**绕过了整个 dev server 链路**：
- ❌ 不经过 vite dev server（5173）
- ❌ 不经过 vite proxy（`/api` → 3456、`/ws` → 3456）
- ❌ 不触发 `serverProcess.ts` 的 dev 分支（PORT=3456 固定端口、tsx loader、system node 检测）
- ❌ 不加载 HMR client、不加载 dev-only 的 React Refresh

### 1.2 影响面

`smoke.spec.ts` 只验证了 prod 模式的「能启动 + 标题 + bounds + 截图」。dev 模式独有的以下风险**从未被覆盖**：

| 风险点 | 来源 | 现有测试是否覆盖 |
|---|---|---|
| vite dev server 启动失败 / 端口占用 | `electron.vite.config.ts` server.port=5173 | ❌ |
| `ELECTRON_RENDERER_URL` 未注入 / 拼写错误 | `electron-vite dev` 内部逻辑 | ❌ |
| vite proxy 配置错误（`/api`、`/ws`） | `electron.vite.config.ts` proxy | ❌ |
| 后端 dev 模式启动失败（tsx loader、system node 缺失、ABI 不匹配） | `serverProcess.ts` dev 分支 | ❌ |
| 后端固定端口 3456 被占用 | `serverProcess.ts` PORT=3456 | ❌ |
| preload `index.mjs` 路径在 dev 构建下不存在 | `main/index.ts` preload path | ❌ |
| dev 模式 console/pageerror（HMR、sourcemap、React Refresh 报错） | renderer | ❌ |

用户反馈「为什么之前没测出来」——答案就是**所有 e2e 测试都把 dev 模式开关删掉了**。

---

## 2. 方案设计

### 2.1 Helper 策略：新增 `dev-helpers.ts`（不修改 `electron-helpers.ts`）

**结论：新增 `e2e\dev-helpers.ts`，不修改现有 `electron-helpers.ts`。**

权衡：

| 维度 | 修改现有 helper | 新增 dev-helpers（推荐） |
|---|---|---|
| 对 prod 测试影响 | 高风险（一个 bug 影响两条链路） | 零影响 |
| 启动逻辑差异 | 巨大（dev 要起 vite server、等端口、等后端就绪） | 各自独立，清晰 |
| 环境变量差异 | delete vs keep `ELECTRON_RENDERER_URL`，互斥 | 各自硬编码 |
| 代码复用 | 仅 `closeApp` 容错模式可复用（10 行） | 复制 10 行代价极低 |
| 后续演进 | prod/dev 测试需求分歧会污染同一文件 | 独立演进 |

dev 启动逻辑与 prod 差异太大（需额外管理 vite 子进程、等待 dev server + 后端就绪、userData 隔离），强行合并会让 `launchApp` 变成一个满是 `if (isDev)` 的怪物。**隔离胜过复用**。

### 2.2 启动方式：`electron.launch` + 独立启动 vite dev server（不用 `npm run dev` 子进程）

**结论：用 Playwright `_electron` API 直接 `electron.launch`，vite dev server 由测试用 vite Node API 独立启动。不调用 `npm run dev` / `electron-vite dev`。**

三种方案权衡：

| 方案 | 描述 | 优点 | 缺点 |
|---|---|---|---|
| A. `npm run dev` 子进程 | spawn `electron-vite dev`，等 stdout，用 CDP 连 | 最贴近真实开发体验 | ❶ Playwright `_electron` API 无法连接外部进程，只能用 `chromium.connectOverCDP`，失去主进程 evaluate 能力 ❷ 需要给 electron-vite 注入 `--remote-debugging-port`（要改 package.json 或环境变量） ❸ electron-vite dev 启动的 Electron 会和我们测试控制的 Electron 冲突 ❹ stdout 解析脆弱 |
| B. `electron.launch` + 手动 vite server（**推荐**） | 测试用 vite Node API 启动 renderer dev server，再用 `_electron.launch` 启动 main | ❶ 复用现有 `_electron` API（自动 CDP、pageerror、requestfailed、主进程 evaluate） ❷ 与 `electron-helpers.ts` 模式一致 ❸ 完全可控 | 需要确保 main/preload 已构建到 `out/` |
| C. 直接跑源码 .ts | 用 tsx 跑 `client/desktop/electron/main/index.ts` | 不依赖 out/ | ❶ Electron 主进程不能用 tsx 直接跑（Electron 二进制只加载 .js） ❷ 与 electron-vite dev 实际行为不一致 |

**选 B。** 关键点：
- main/preload 仍需 electron-vite 编译到 `out/main/index.js`、`out/preload/index.mjs`（dev 构建带 sourcemap，与 prod 构建内容不同但入口路径相同）
- 测试前先跑 `electron-vite build` 确保 `out/` 存在（CI 里可在 test:e2e:dev 前加 build 步骤）
- renderer 部分用 vite Node API 在测试进程内启动 dev server（不依赖 electron-vite 命令）

#### 方案 B 的失真风险与缓解

方案 B 用 vite Node API **复制** `electron.vite.config.ts` 的 renderer 配置来启动 dev server，而非用 `electron-vite dev` 原生命令。这意味着：

- ✅ **能测出**：vite proxy 配置错误（`/api`、`/ws`）、端口冲突、`ELECTRON_RENDERER_URL` 注入、后端 dev 启动链路（tsx/system node/ABI）、preload 路径、pageerror、requestfailed —— 这些是 dev 模式高频出问题的环节
- ⚠️ **测不出**：`electron.vite.config.ts` 的 renderer 部分独有的配置（如 `envDir`、`define`、`optimizeDeps`、未来新增的插件）若被改动但未同步到 `dev-helpers.ts`，测试仍会绿

缓解措施：
1. `dev-helpers.ts` 顶部加注释：「此处的 vite 配置复制自 `electron.vite.config.ts` 的 renderer 部分，改动任一处时必须同步」
2. 实施时逐字段对比 `electron.vite.config.ts` renderer 部分与 `dev-helpers.ts` 的 `startViteDevServer`，确保 plugins/alias/proxy/port/publicDir/envDir 完全一致
3. 更优解（实施时评估）：动态 `import('../electron.vite.config.ts')` 取 `default.renderer`，但要处理 electron-vite `defineConfig` 的 `ConfigEnv` 包装（可能需要 `.render({ mode: 'development', command: 'serve' })`），复杂度较高，初版先用复制
4. 冒烟测试目标是「dev 主链路通」，不追求 100% 还原 dev server；失真部分由开发本机 `npm run dev` 兜底

### 2.3 Dev server URL 获取：固定端口 5173

**结论：直接用 `http://localhost:5173`，不解析 stdout。**

理由：
- `electron.vite.config.ts` 第 67 行硬编码 `server.port: 5173`
- 测试用 vite Node API 启动时显式传 `port: 5173`，端口由测试掌控
- 避免脆弱的 stdout 正则解析

启动后用 `waitForPort(5173)` 确认监听就绪，再注入到 `ELECTRON_RENDERER_URL`。

### 2.4 端口冲突避免

| 端口 | 用途 | 占用方 | 冲突场景 | 解决 |
|---|---|---|---|---|
| 5173 | vite dev server | dev 测试 | 用户手动 `npm run dev` 同时跑测试 | 测试启动前检测占用，报错提示关闭手动 dev |
| 3456 | 后端 API + WS | dev 测试（主进程 fork） | 用户手动 dev / 残留进程 | 同上；测试结束后 `app.close()` 会触发 `stopServer()` 释放 |
| 9223 | （预留）CDP | 不使用 | — | — |

**dev 测试与 prod 测试不冲突**：
- prod 测试用 `loadFile`，不起 vite server，后端用 PORT=0 随机端口
- dev 测试固定 5173 + 3456
- 但 `playwright.config.ts` `workers: 1` 已保证串行，无需额外处理

**dev 测试自身不可并行**（5173/3456 固定），继承 `workers: 1` 即可。

### 2.5 单实例锁处理

**结论：本项目未启用单实例锁，无需特殊处理。**

搜索 `requestSingleInstanceLock|second-instance` 在 `client/desktop/electron/` 下无匹配——项目从未调用单实例锁 API。多个 Electron 实例可共存。

但仍需 **userData 目录隔离**（避免 dev/prod 测试共用 userData 导致 DB、配置、缓存污染）：
- 用 `--user-data-dir=<tmp>` 命令行参数指向临时目录
- 用 `mkdtempSync` 在 `%TEMP%` 下创建唯一目录（非 C 盘，符合用户规则）
- 测试结束 `closeApp` 后清理（可选；CI 每次跑完清 temp）

---

## 3. 测试用例清单

文件：`e2e\dev-smoke.spec.ts`（新增，不修改 `smoke.spec.ts`）

| # | test name | 断言 | 说明 |
|---|---|---|---|
| 1 | `dev: 应用以 dev 模式启动并加载 dev server URL` | `window.url()` 含 `localhost:5173`；`window.title()` === `'Daily'`；窗口 bounds 非空 | 验证 loadURL 分支生效 |
| 2 | `dev: 后端 API 通过 vite proxy 可达 (/api/health)` | `window.evaluate(() => fetch('/api/health').then(r => r.status))` === 200；body.status === 'ok' | 验证 `/api` proxy + 后端 dev 启动 |
| 3 | `dev: WebSocket 通过 vite proxy 可连接` | `window.evaluate` 内 `new WebSocket('ws://localhost:5173/ws')` 在 5s 内触发 `onopen` | 验证 `/ws` proxy + ws:true |
| 4 | `dev: 无 pageerror` | 整个测试期间 `pageerror` 事件数组为空 | 捕获 React Refresh / HMR / sourcemap 报错 |
| 5 | `dev: 无 requestfailed` | 整个测试期间 `requestfailed` 事件数组为空（排除外网 webview） | 捕获 preload、API、WS 资源加载失败 |
| 6 | `dev: 后端启动日志出现在主进程 stdout` | `app.evaluate` 或捕获的 stdout 含 `Daily API running on http://localhost:3456` | 验证 serverProcess dev 分支正常 |

**用例 5 注意**：`requestfailed` 要排除 `<webview>` 加载的外网 URL（用户内容），只断言 `localhost:5173` / `localhost:3456` 相关请求。

---

## 4. 代码骨架

### 4.1 `e2e\dev-helpers.ts`（新增）

```ts
/**
 * Dev 模式 Electron 启动辅助。
 *
 * 与 electron-helpers.ts 的关键差异：
 *   - 保留 ELECTRON_RENDERER_URL（让主进程走 loadURL 分支）
 *   - 用 vite Node API 启动 renderer dev server（端口 5173）
 *   - userData 隔离（--user-data-dir 指向临时目录）
 *   - 等待后端 /api/health 就绪（dev 模式 tsx 编译慢，最多等 60s）
 */
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { createServer, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEV_SERVER_PORT = 5173
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`
const BACKEND_PORT = 3456
const PROJECT_ROOT = resolve(import.meta.dirname, '..')

export interface DevElectronFixture {
  app: ElectronApplication
  window: Page
  viteServer: ViteDevServer
  userDataDir: string
}

/**
 * 用 vite Node API 启动 renderer dev server。
 *
 * 复制 electron.vite.config.ts 中 renderer 部分的关键配置（proxy、alias、plugins），
 * 而非 import 整个 electron.vite.config.ts（它是 main/preload/renderer 三合一复合配置，
 * 直接喂给 vite 会报错）。
 */
async function startViteDevServer(): Promise<ViteDevServer> {
  const server = await createServer({
    root: resolve(PROJECT_ROOT, 'client/desktop'),
    publicDir: resolve(PROJECT_ROOT, 'client/desktop/public'),
    configFile: false,  // 不读 electron.vite.config.ts
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': resolve(PROJECT_ROOT, 'client/desktop/src'),
        'shared': resolve(PROJECT_ROOT, 'shared'),
      },
    },
    server: {
      port: DEV_SERVER_PORT,
      strictPort: true,  // 端口被占则直接报错（避免静默换端口导致 ELECTRON_RENDERER_URL 不匹配）
      proxy: {
        '/api': { target: `http://localhost:${BACKEND_PORT}`, changeOrigin: true },
        '/ws':  { target: `ws://localhost:${BACKEND_PORT}`, ws: true, changeOrigin: true },
        // llm-proxy 三条按需复制（dev 冒烟测试可省略，不影响主链路）
      },
    },
  })
  await server.listen()
  return server
}

/**
 * 等待后端 /api/health 就绪。
 * dev 模式 tsx 编译 + PiBridge 加载可能需要 30-50s（见 serverProcess.ts 注释）。
 */
async function waitForBackend(timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${BACKEND_PORT}/api/health`)
      if (res.ok) return
    } catch { /* 后端未就绪，继续等 */ }
    await new Promise(r => setTimeout(r, 1000))
  }
  throw new Error(`Backend /api/health not ready within ${timeoutMs}ms`)
}

export async function launchDevApp(): Promise<DevElectronFixture> {
  // 1. 启动 vite dev server（renderer）
  const viteServer = await startViteDevServer()

  // 2. 准备隔离的 userData 目录（%TEMP%\event-dev-test-XXXX，非 C 盘）
  const userDataDir = mkdtempSync(join(tmpdir(), 'event-dev-test-'))

  // 3. 启动 Electron —— 保留 ELECTRON_RENDERER_URL，让主进程走 loadURL 分支
  const env = {
    ...process.env,
    ELECTRON_RENDERER_URL: DEV_SERVER_URL,
    // 不 delete ELECTRON_RENDERER_URL —— 这是 dev 模式的核心标志
  }
  const mainPath = join(PROJECT_ROOT, 'out', 'main', 'index.js')
  const app = await electron.launch({
    args: [mainPath, `--user-data-dir=${userDataDir}`],
    env: env as Record<string, string>,
    cwd: PROJECT_ROOT,
  })

  // 4. 等首个窗口 + domcontentloaded
  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')

  // 5. 等后端就绪（主进程 startServer 已 fork 后端，但 dev 模式启动慢）
  await waitForBackend()

  return { app, window, viteServer, userDataDir }
}

export async function closeDevApp(fixture: DevElectronFixture | null | undefined): Promise<void> {
  if (fixture?.app) {
    try { await fixture.app.close() } catch { /* ignore */ }
    // app.close() 会触发主进程 before-quit → stopServer()，释放 3456 端口
  }
  if (fixture?.viteServer) {
    try { await fixture.viteServer.close() } catch { /* ignore */ }
  }
  // userDataDir 不主动删（Windows 下 Electron 退出后文件句柄延迟释放，强删可能失败）
}
```

### 4.2 `e2e\dev-smoke.spec.ts`（新增）

```ts
/**
 * Dev 模式冒烟测试。
 *
 * 与 smoke.spec.ts 的区别：
 *   - 用 launchDevApp（保留 ELECTRON_RENDERER_URL，走 loadURL 分支）
 *   - 验证 dev server URL、vite proxy、WebSocket、pageerror、requestfailed
 *   - 单独运行：npm run test:e2e:dev
 */
import { test, expect } from '@playwright/test'  // 直接用 base test，不引入 fixtures.ts 的 electron fixture（那是 prod 专用）
import { launchDevApp, closeDevApp, type DevElectronFixture } from './dev-helpers'

test.describe('Electron dev mode smoke', () => {
  let fixture: DevElectronFixture | null = null
  const pageerrors: Error[] = []
  const requestfailed: string[] = []

  test.beforeAll(async () => {
    fixture = await launchDevApp()
    fixture.window.on('pageerror', (e) => pageerrors.push(e))
    fixture.window.on('requestfailed', (req) => {
      const url = req.url()
      // 只关注本地 dev server / 后端请求，忽略外网 webview
      if (url.includes('localhost:5173') || url.includes('localhost:3456')) {
        requestfailed.push(`${req.method()} ${url} → ${req.failure()?.errorText}`)
      }
    })
  })

  test.afterAll(async () => {
    await closeDevApp(fixture)
    fixture = null
  })

  test('dev: 应用以 dev 模式启动并加载 dev server URL', async () => {
    const url = fixture!.window.url()
    expect(url).toContain('localhost:5173')

    const title = await fixture!.window.title()
    expect(title).toBe('Daily')

    const bounds = await fixture!.app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      return win ? win.getBounds() : null
    })
    expect(bounds).not.toBeNull()
    expect(bounds!.width).toBeGreaterThan(0)
  })

  test('dev: 后端 API 通过 vite proxy 可达 (/api/health)', async () => {
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
        const ws = new WebSocket('ws://localhost:5173/ws')
        const timer = setTimeout(() => { ws.close(); resolve(false) }, 5000)
        ws.onopen = () => { clearTimeout(timer); ws.close(); resolve(true) }
        ws.onerror = () => { clearTimeout(timer); resolve(false) }
      })
    })
    expect(connected).toBe(true)
  })

  test('dev: 无 pageerror', async () => {
    // 给渲染进程一点时间触发可能的错误（HMR、sourcemap）
    await fixture!.window.waitForTimeout(2000)
    expect(pageerrors, pageerrors.map(e => e.message).join('\n')).toEqual([])
  })

  test('dev: 无 requestfailed (本地资源)', async () => {
    await fixture!.window.waitForTimeout(2000)
    expect(requestfailed, requestfailed.join('\n')).toEqual([])
  })
})
```

### 4.3 关键依赖前置条件

测试前必须确保：
1. `out/main/index.js` 和 `out/preload/index.mjs` 已由 electron-vite 构建生成（dev 构建即可，带 sourcemap）
2. `server/node_modules/tsx/dist/loader.mjs` 存在（dev 模式后端依赖）
3. system `node` 在 PATH 中（`serverProcess.ts` 的 `getSystemNodePath()` 需要，否则后端会回退到 Electron 内置 node 触发 better-sqlite3 ABI 崩溃）

---

## 5. 运行方式

### 5.1 新增 npm script（实施时改 package.json，本方案不动）

```jsonc
{
  "scripts": {
    "test:e2e:dev": "npm run build && playwright test --config=e2e/playwright.config.ts e2e/dev-smoke.spec.ts"
  }
}
```

说明：
- `npm run build` 确保 `out/` 存在（`electron-vite build` 同时构建 main/preload/renderer；dev 测试只用 main+preprod 的 out，renderer 由测试内 vite server 提供）
- 显式指定 `e2e/dev-smoke.spec.ts`，避免和 prod 的 `smoke.spec.ts` 混跑
- prod 测试仍用 `npm run test:e2e`（不变）

### 5.2 手动单独运行

```powershell
# 前置：确保 out/ 已构建
npm run build

# 只跑 dev 冒烟测试
npx playwright test --config=e2e\playwright.config.ts e2e\dev-smoke.spec.ts
```

### 5.3 同时跑 prod + dev（不推荐）

```powershell
npx playwright test --config=e2e\playwright.config.ts
```

`workers: 1` 保证串行，端口不冲突。但 dev 测试慢（vite server + 后端 tsx 编译 30-60s），混跑会拖慢常规迭代。建议分开。

---

## 6. CI 集成考虑

### 6.1 是否在 CI 跑 dev 测试

**结论：推荐在 CI 跑，但放在独立 job，不阻塞 prod 测试。**

权衡：

| 维度 | CI 跑 dev 测试 | CI 不跑 dev 测试 |
|---|---|---|
| 能拦截的 bug | dev server 配置错误、proxy 失效、preload 路径错、ABI 崩溃 | 只能靠开发本机发现 |
| 耗时 | +60-90s（vite server + tsx 编译后端） | 0 |
| 失败稳定性 | tsx 编译慢可能偶发超时 | — |
| 价值 | 高（dev 模式是开发主战场，bug 影响所有开发者） | — |

**推荐策略**：
- CI 新增独立 job `e2e-dev`，与 `e2e-prod` 并行（不阻塞）
- `e2e-dev` 失败不阻塞主流程合并（初期），稳定后改为阻塞
- 超时设 180s（vite server + tsx 后端启动有波动）

### 6.2 CI 环境特殊注意

- **system node**：CI 必须装 Node.js（GitHub Actions `actions/setup-node` 已覆盖），`serverProcess.ts` 的 `getSystemNodePath()` 才能找到
- **tsx 依赖**：确保 `npm install` 在 `server/` 下也执行（或 workspace 统一安装）
- **端口冲突**：CI 每次跑在干净 VM，5173/3456 不会冲突；本地开发机需注意
- **Windows 特有**：`mkdtempSync(join(tmpdir(), 'event-dev-test-'))` 在 Windows 下 `tmpdir()` 是 `%TEMP%`（通常在 C 盘）——如需遵守「不下载存储到 C 盘」规则，可改为 `join(process.env.LOCALAPPDATA ?? tmpdir(), 'event-dev-test')` 或显式指向其他盘。**待用户确认是否需要遵守此规则**。

### 6.3 不在 CI 跑的备选

若 CI 资源紧张，可：
- 仅在 `pull_request` 触发 dev 测试（push 到开发分支不跑）
- 用 `test:e2e:dev` 手动触发（workflow_dispatch）

---

## 7. 风险与待确认项

| # | 待确认 | 影响 |
|---|---|---|
| 1 | `out/main/index.js` 在 dev 构建下是否与 prod 构建路径完全一致？（preload 是 `index.mjs`） | 若路径不同，`launchDevApp` 的 mainPath 需调整 |
| 2 | userData 临时目录是否必须避开 C 盘？（用户规则：「不允许将文件或软件或服务等内容下载存储在 C 盘」） | `%TEMP%` 默认在 C 盘，需用户确认是否豁免测试临时文件 |
| 3 | `server/node_modules/tsx` 是否已在根 `npm install` 后安装？还是要在 `server/` 单独 install？ | 影响 CI 是否需要额外 install 步骤 |
| 4 | dev 模式后端启动可能 30-60s，`waitForBackend(60_000)` 是否足够？ | 偶发超时风险，可能需放宽到 90s |
| 5 | `requestfailed` 排除外网 webview URL 的过滤是否足够？（某些第三方资源也可能失败） | 可能需要更精细的 URL 白名单 |
| 6 | 是否需要测试 HMR（修改文件后页面热更新）？ | 当前方案未覆盖 HMR，超出冒烟测试范围 |
| 7 | 方案 B 的 vite 配置复制失真：`electron.vite.config.ts` renderer 部分若新增配置（envDir/define/optimizeDeps/插件）未同步到 `dev-helpers.ts`，测试仍绿 | 见 2.2 节「失真风险与缓解」；初版接受，靠注释 + 人工同步兜底 |

---

## 8. 实施清单（Review 通过后执行）

- [ ] 新增 `e2e\dev-helpers.ts`（按 4.1 骨架）
- [ ] 新增 `e2e\dev-smoke.spec.ts`（按 4.2 骨架）
- [ ] `package.json` 新增 `test:e2e:dev` script（按 5.1）
- [ ] `playwright.config.ts` 无需改动（`testMatch: ['**/*.spec.ts']` 已覆盖 dev-smoke.spec.ts）
- [ ] 本机验证：`npm run build && npx playwright test --config=e2e\playwright.config.ts e2e\dev-smoke.spec.ts` 全绿
- [ ] 对抗审查：故意删除 vite proxy `/api` 配置，确认测试 2 失败；故意改错 5173 端口，确认测试 1 失败
- [ ] （可选）CI 新增 `e2e-dev` job
