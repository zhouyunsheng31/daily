# Phase 14：桌面端发布质量修复

> **生成日期**：2026-07-02
> **目标**：修复 P13 打包版桌面端的安装体验、品牌一致性、功能可用性问题，产出可正式分发的 Daily 1.0.0
> **强制标准**：禁止"基本合格""条件通过"。任何一项不通过 → 不发布。所有任务必须运行时验证（截图/视频/日志存证于 `docs/verify/phase14/`）

---

## 一、背景与问题清单

P13 完成后，打包出的桌面端存在以下问题（经 4 个 sub-agent 调研 + 运行时验证，全部确认属实）：

| # | 用户反馈 | 根因 | 严重度 |
|---|---------|------|--------|
| 1 | 安装界面太简陋 | BMP 设计质量不足，无自定义 NSIS 页面（开机启动/快捷方式选项） | 中 |
| 2 | 安装过程特别卡，拖动进度条才动 | `asar: false` 导致 3121 文件散装逐个解压，阻塞 NSIS UI 线程 | 高 |
| 3 | 安装路径应默认 daily 目录 | electron-builder 无配置，默认 `%LOCALAPPDATA%\Living Dashboard\` | 中 |
| 4 | 应用启动速度慢 | `detectBackend` 重试 10 次 ×1s = 10 秒空白 + `LocalAgentService.initialize()` 阻塞 `createWindow()` | 高 |
| 5 | 无开机启动/桌面快捷方式选项 | 无自定义 NSIS 脚本（`.nsh` 文件不存在） | 中 |
| 6 | 项目名是 Daily 但到处是 "Living Dashboard" | `productName: Living Dashboard`，12+ 处用户可见位置硬编码 | 高 |
| 7 | 软件图标没用上 | **部分误判**：daily.png 已复制为 logo.png（MD5 相同），icon.ico 已用上；但 `favicon.svg` 是 Vite 默认紫色闪电 | 低 |
| 8 | 应用内功能几乎全部无法使用 | **CRITICAL**：`client.ts:3` 的 `API_BASE='/api'` 在 prod `loadFile` 协议下变成 `file:///api/...`，所有 HTTP 请求必失败 | 致命 |
| 9 | 后端 server 未内嵌 | server 需手动启动，打包后无后端，所有 API 降级到 IDB | 致命 |
| 10 | "Electron" 字样 | **误判**：仅在注释/测试中出现，用户可见位置无 | — |

### 关键事实

- **daily.png = logo.png**（MD5 `8b09ba751b558dc581df9203910acdb1`），icon.ico/tray-icon.png 已从此生成
- **favicon.svg** 是 Vite 默认紫色闪电（`#863bff`），与 Daily 品牌无关
- **server 无 ORM**，裸 SQL 散布在 ~25 个文件，22 张表，~50-80 处 PG 特有语法
- **server 依赖** `@earendil-works/pi-coding-agent`（复杂私有包，Electron 兼容性未知，最大风险）

### 用户决策

1. **后端**：打包内嵌（PostgreSQL → SQLite）
2. **测试工具**：Playwright + Electron CDP
3. **安装界面**：重设计 BMP + 自定义 NSIS 页面
4. **图标**：用 daily.png（已用，仅需补 favicon.svg）

---

## 二、修复方案总览

5 个工作流，按依赖顺序分阶段执行：

| 工作流 | 任务 | 阶段 |
|--------|------|------|
| A 品牌统一 | A1 替换品牌名 / A2 补 favicon / A3 修测试 / A4 清理遗留 | 阶段 1（并行） |
| B 功能修复 | B1 修 baseURL / B2 修 LocalAgent 阻塞 / B3 优化启动 | 阶段 1（并行） |
| C 后端内嵌 | C1 SQLite 改造 / C2 server 打包 / C3 子进程拉起 / C4 端口动态分配 | 阶段 2-3（串行） |
| D 测试工具 | D1 搭框架 / D2 修 dogfood / D3 回归测试 | 阶段 1+4 |
| E 安装程序 | E1 重设计 BMP / E2 NSIS 脚本 / E3 修 asar / E4 打包验证 | 阶段 5-6 |

---

## 三、详细任务分解

### 工作流 A：品牌统一（Daily）

#### A1：全局替换 "Living Dashboard" → "Daily"

**P0 用户可见位置**（12 处）：

| 文件 | 行号 | 原文 | 改为 |
|------|------|------|------|
| `electron-builder.yml` | 6 | `productName: Living Dashboard` | `productName: Daily` |
| `client/desktop/index.html` | 7 | `<title>Living Dashboard</title>` | `<title>Daily</title>` |
| `client/desktop/electron/main/index.ts` | 117 | `tray.setToolTip('Living Dashboard')` | `'Daily'` |
| `client/desktop/electron/main/index.ts` | 221 | `title: 'Living Dashboard'` | `'Daily'` |
| `client/desktop/src/components/TitleBar.tsx` | 66 | `Living Dashboard` | `Daily` |
| `client/desktop/src/components/onboarding/WelcomeStep.tsx` | 21 | `Living Dashboard` | `Daily` |
| `client/desktop/src/components/onboarding/CompleteStep.tsx` | 27 | `你已准备好开始使用 Living Dashboard` | `你已准备好开始使用 Daily` |
| `client/desktop/src/components/onboarding/CanvasStep.tsx` | 23 | `Living Dashboard` | `Daily` |
| `client/desktop/src/components/onboarding/AiConfigStep.tsx` | 261 | `配置完成，可以开始使用 Living Dashboard` | `配置完成，可以开始使用 Daily` |
| `client/desktop/src/components/Onboarding.tsx` | 85 | `title = 'Living Dashboard'` | `'Daily'` |
| `client/desktop/src/components/BrowserHome.tsx` | 157 | `Living Dashboard` | `Daily` |
| `client/desktop/src/components/Workspace.tsx` | 109 | `欢迎使用 Living Dashboard` | `欢迎使用 Daily` |

**P1 文档/脚本**：
- `AGENT.md`、`README.md`、`dev.bat`、`start.bat`、`docker-up.bat`、`docker-down.bat`、`.env.example`
- `mcp/src/index.ts`（3 处工具描述）、`mcp/package.json`
- `client/desktop/src/index.css`（注释 `DailyLiving Dashboard` → `Daily`）
- `server/src/index.ts:145`（日志 `Living Dashboard API running` → `Daily API running`）
- `server/package.json:2`（`"name": "living-dashboard-server"` → `"name": "daily-server"`）

**不改**：
- Android 端 `client/android/` 的 `com.livingdashboard` 包名（包名重构风险大，且用户关注桌面端）
- 数据库标识符 `livingdashboard`（随 SQLite 迁移自然消失）

#### A2：补 favicon.svg

**现状**：daily.png 已用作 icon.ico/tray-icon.png（MD5 验证一致），但 `client/desktop/public/favicon.svg` 是 Vite 默认紫色闪电。

**步骤**：
1. 用 daily.png 为源生成一个 SVG 版本（或手写 SVG 描绘 Daily logo）
2. 替换 `client/desktop/public/favicon.svg`
3. 确认 `client/desktop/index.html:5` 引用 `/favicon.svg`

#### A3：修复测试断言

| 文件 | 行号 | 修改 |
|------|------|------|
| `client/desktop/src/components/__tests__/TitleBar.test.tsx` | 58, 60 | `'Living Dashboard'` → `'Daily'` |
| `client/desktop/src/components/__tests__/Onboarding.test.tsx` | 5, 160, 163, 165-167 | 同上 |

#### A4：清理遗留模板

- 删除根目录 `index.html`（标题 `fallmylifeevent-temp`，未被 electron-vite 使用）
- 删除根目录 `src/index.css`、`src/components/Sidebar.tsx`（遗留 Vite 模板，未被引用）

---

### 工作流 B：功能修复（不含后端）

#### B1：修复 prod 模式 baseURL bug（CRITICAL）

**文件**：`client/desktop/src/api/client.ts:3`

**问题**：
```typescript
const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api'
```
prod 模式 `loadFile` 下 `window.location.origin = 'file://'`，`fetch('/api/panels')` 变成 `file:///api/panels` → TypeError。

**修复**（分两步）：
- 阶段 1（B1）：先硬编码 fallback 到固定端口（注意：必须用 `??` 而非 `||`，否则运算符优先级错误）
  ```typescript
  const API_BASE = import.meta.env.VITE_API_BASE_URL
    ?? (typeof window !== 'undefined' && window.location.protocol === 'file:'
      ? 'http://localhost:3456/api'
      : '/api')
  ```
  **同时修改 WebSocket URL 硬编码**（3 处）：
  - `client/desktop/src/App.tsx:106`：`wsUrlBase` fallback 改为动态获取
  - `client/desktop/src/App.tsx:107`：`healthUrl` fallback 改为动态获取
  - `client/desktop/src/stores/useAIStore.ts:184`：`WS_URL_BASE` fallback 改为动态获取
  阶段 1 临时统一用 `3456`，阶段 3（C4）改为从 `window.electronAPI.getServerPort()` 获取
- 阶段 3（C4 完成后）：改为从 preload 注入的 `window.electronAPI.getServerPort()` 动态拼接 `'http://localhost:' + port + '/api'` 和 `'ws://localhost:' + port + '/ws'`

#### B2：修复 LocalAgentService 阻塞 createWindow（HIGH）

**文件**：`client/desktop/electron/main/index.ts:366-416`

**问题**：`await localAgentService.initialize()`（第 383 行）失败则 `createWindow()`（第 389 行）永不执行 → 进程在跑但无窗口。

**修复**：调整顺序，先建窗口再异步初始化 agent：
```typescript
app.whenReady().then(async () => {
  initializeApiKeyStore()
  registerAgentIpc()
  createWindow()                          // 先建窗口
  createTray()
  createAppMenu()
  registerShortcutInterception()
  try {
    await localAgentService.initialize()  // 异步初始化，失败不阻塞
    localAgentService.setToolExecutor(createToolExecutor(() => mainWindow))
  } catch (err) {
    console.error('[main] LocalAgent init failed:', err)
    // 窗口已显示，用户可在设置中查看错误
  }
})
```

#### B3：优化启动速度

**文件**：`client/desktop/src/api/adapter.ts:14-34`、`client/desktop/src/stores/useAppStore.ts`

**问题**：`detectBackend` 重试 10 次 × 1 秒 = 10 秒空白加载。

**修复**：
1. 后端内嵌后（C3 完成），server 启动快（SQLite ~300ms），但 fork 进程 + schema 初始化可能需 1-2s。改为**指数退避重试**：500ms, 1000ms, 2000ms, 4000ms（总 7.5s，比 10×1s 更合理）
2. **更优方案**：server 子进程启动后通过 IPC 主动通知主进程"就绪"，主进程通过 preload 通知渲染进程，无需轮询。`detectBackend` 仅作为 fallback
3. `useAppStore.initialize()` 中 `detectBackend` 失败不阻塞 `onboardingChecked`（让 onboarding 先显示）
4. `SuspenseFallback` 增加进度文字（"正在初始化..."）

---

### 工作流 C：后端内嵌

#### C1：PG → SQLite 数据库改造

**策略**：新增 SQLite driver，保留 PG driver 可切换（env `DB_DRIVER=sqlite|postgres`）。

**新增文件**：
- `server/src/db/connection-sqlite.ts` — better-sqlite3 包装，导出与 `connection.ts` 相同 API（`getPool`/`initDb`/`closeDb`/`withTransaction`/`query`）。**关键**：`query(text, params)` 内部需把 pg 的 `$1, $2` 占位符正则替换为 SQLite 的 `?, ?`，使 route 文件无需改动
- `server/src/db/schema-sqlite.ts` — 重写 DDL

**修改文件**：
- `server/src/db/connection.ts` — 加 driver 切换（根据 `process.env.DB_DRIVER`）
- `server/src/db/schema.ts` — 引用对应 schema
- 22 个 route 文件 — ~50 处 SQL 微调（占位符由 driver 层统一处理，无需逐文件改 `$1`→`?`）：

| PG 语法 | 出现次数 | SQLite 替代 |
|---------|---------|------------|
| `JSONB` 列类型 | ~25 | `TEXT`（应用层已 JSON.stringify） |
| `BIGSERIAL` | 4 表 | `INTEGER PRIMARY KEY AUTOINCREMENT` |
| `BIGINT[]` / `TEXT[]` | 2 列 | `TEXT`（JSON 序列化） |
| `ANY($1::text[])` | 3 | `IN (?, ?, ...)` 动态展开 |
| `array_agg(... ORDER BY ...)` | 1（aiContext.ts:346） | 子查询或应用层聚合 |
| `EXTRACT(EPOCH FROM now()) * 1000` | ~20 | 应用层 `Date.now()` 填充 |
| `DO $$ ... END $$` 幂等 ALTER | 5 | `PRAGMA table_info()` 检查 |
| `::jsonb` / `::BIGINT` 类型转换 | 多处 | 删除 |

**好消息**：无 JSONB 操作符（`->`/`->>`）、无全文搜索、无触发器/视图，JSONB 仅作存储类型。

**风险**：`aiContext.ts` 的 `array_agg` 需改写。

#### C2：server 打包进 Electron

**方案**：server 作为 `resources/server/` 子目录随安装包分发，fork 子进程运行（避免 native 模块 ABI 冲突）。

**步骤**：
1. `server/` 执行 `npm run build` 生成 `dist/`
2. `server/` 执行 `npm prune --production` 清理 devDependencies，估算 `node_modules` 大小
3. 修改 `electron-builder.yml` files，包含：
   - `server/dist/**/*`
   - `server/node_modules/**/*`（已 prune）
   - `server/package.json`
   - `.pi/skills/**/*`（skills 目录）
4. **better-sqlite3 编译**：由于 server 以 `ELECTRON_RUN_AS_NODE=1` 子进程运行（纯 Node 模式，ABI 为 Node ABI 而非 Electron ABI），用普通 `npm rebuild` 即可（better-sqlite3 提供 prebuilt binaries）。**不要用 `electron-rebuild`**（会编译为 Electron ABI 导致不匹配）。`electron-builder.yml` 保持 `npmRebuild: false`
5. `asarUnpack` 排除 native 模块：`**/node_modules/better-sqlite3/**`

#### C3：启动时自动拉起 server 子进程

**新增文件**：`client/desktop/electron/main/serverProcess.ts`

**功能**：
```typescript
// 伪代码
export function startServer(): Promise<number> {
  const serverPath = join(process.resourcesPath, 'server', 'dist', 'index.js')
  const child = fork(serverPath, [], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',          // 必须设置！否则 fork 会启动新 Electron 窗口
      DB_DRIVER: 'sqlite',
      SQLITE_PATH: join(app.getPath('userData'), 'daily.db'),
      PORT: '0',                    // OS 分配空闲端口
      SERVER_TOKEN: '',             // localhost 无需认证
      SKILLS_DIR: join(process.resourcesPath, '.pi', 'skills'),
    },
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
  })
  // 监听子进程 stdout 获取实际端口（server 须 console.log('PORT:' + port)）
  // 日志持久化：stdout/stderr 写入 app.getPath('logs')/server.log（10MB 轮转）
  // 子进程崩溃自动重启（最多 3 次）
  // app quit 时优雅关闭
  return waitForPort(child)
}
```

**关键注意**：
1. `ELECTRON_RUN_AS_NODE: '1'` 必须设置 —— 打包后 `process.execPath` 是 `electron.exe`，不加此环境变量会启动新窗口而非执行 Node 脚本
2. **workerThreadsPatch**：`LocalAgentService.ts:25-42` 注释指出 pi-coding-agent 内部 undici 在 Electron 31 (Node 20.x) 下从 `node:worker_threads` 解构 `markAsUncloneable` 会崩溃。子进程是独立 Node 进程，**不继承主进程的 polyfill**。解决方案：在 `server/src/index.ts` 入口处 `import './workerThreadsPatch'`（将 patch 文件复制到 server/src/）
3. **日志持久化**：主进程消费子进程 stdout/stderr，写入 `app.getPath('logs')/server.log`（10MB 轮转），设置面板增加"查看日志"入口

**集成到 main/index.ts**：
```typescript
app.whenReady().then(async () => {
  const serverPort = await startServer()  // 启动后端
  createWindow()                          // 建窗口
  // ...
})
```

**PoC 失败的 fallback 策略**（pi-coding-agent 不兼容子进程时）：
- 选项 A：server 去掉 piBridge 模块，AI 功能由主进程 LocalAgentService 承担（server 只做数据 API）
- 选项 B：用 `spawn` + 独立 Node 22+ 可执行文件（不依赖 Electron 的 Node）

#### C4：端口动态分配 + IPC 通知

**问题**：server 端口 3456 可能被占用。

**修复**：
1. server 监听 `PORT=0`，OS 分配空闲端口
2. **修改 `server/src/index.ts:144-145`**：在 listen 回调中通过 `process.send({ type: 'port', port: httpServer.address().port })` 通知主进程（fork 的 IPC 通道）。同时把日志中的 "Living Dashboard" 改为 "Daily"
3. 主进程 `serverProcess.ts` 监听子进程 `message` 事件获取端口
4. preload 暴露 `electronAPI.getServerPort()`（同步返回，主进程在窗口加载前已拿到端口）
5. `client.ts` 的 `API_BASE` 改为 `'http://localhost:' + window.electronAPI.getServerPort() + '/api'`
6. `App.tsx:106`、`App.tsx:107`、`useAIStore.ts:184` 的 WS/health URL 同样用动态端口拼接

---

### 工作流 D：测试工具

#### D1：搭建 Playwright + Electron CDP 框架

**新增文件**：
- `e2e/electron-helpers.ts` — 启动 Electron 应用，连接 CDP
- `e2e/playwright.config.ts` — Electron 配置
- `e2e/fixtures.ts` — Playwright fixtures

**方案**：
```typescript
// e2e/electron-helpers.ts（伪代码）
import { _electron as electron } from '@playwright/test'
import { join } from 'path'

export async function launchApp() {
  // 不需要 --remote-debugging-port，Playwright Electron API 自动处理 CDP
  const env = { ...process.env }
  delete env.ELECTRON_RENDERER_URL  // 强制 prod 模式（loadFile）
  const app = await electron.launch({
    args: [join(__dirname, '../out/main/index.js')],  // 打包后的 main 入口
    env,
    cwd: join(__dirname, '..'),  // 确保 process.resourcesPath 正确
  })
  const window = await app.firstWindow()
  return { app, window }
}
```

**注意**：
- `--remote-debugging-port` 不需要，Playwright Electron API 内部自动处理 CDP 连接
- `ELECTRON_RENDERER_URL` 必须 `delete` 而非设为 `undefined`（env 对象不接受 undefined 值）
- 现有 `e2e/phase11-*.mjs`、`phase12-verify.mjs` 保留，新增的 Electron 测试放 `e2e/electron/` 子目录

**优势**：能测试真实 IPC（`window.aiKeyApi`）、`<webview>` 标签、系统托盘等 Electron 专有功能。

#### D2：修复现有 dogfood 脚本

**问题清单**（来自 final-adversarial-review.md）：
- C8：`error !== undefined` 算 PASS（造假断言）→ 改为 `apiKeySet === true`
- C9：引用不存在的 `/src/services/AuthStorage.ts` → 改用 `window.aiKeyApi.setApiKey`
- C10：`sessions.find is not a function`（Map/Array 误用）→ `Array.from(sessions.values()).find`
- G5：onboarding 断言宽松 → 改为 `hasOnboardingEl === true`
- G6：持久化验证硬编码 true → 改为实际判断
- G7：OR 改 AND

**步骤**：把 `docs/verify/phase13/dogfood/scripts/*.mjs` 迁移到 `e2e/` 下，用 D1 框架重写。

#### D3：编写关键功能回归测试

**测试用例**：
1. 启动 → onboarding 5 步 → 主页
2. 创建面板 → 添加 widget（calculator/focusTimer）→ 拖拽 → 切换面板 → 状态保留
3. AI 对话（配置 API Key 后）→ 发送消息 → 验证响应
4. 浏览器标签 → 导航 → 嵌入画布
5. 设置面板 → 5 tab 切换 → 修改 → 持久化
6. 离线模式 → banner → local 模式
7. 极限场景 → 22 面板 → 内存检查

---

### 工作流 E：安装程序

#### E1：用 huashu-design 重设计 BMP

**资源**：
- `build/installer-banner.bmp`（150×57）— 顶部 banner
- `build/installer-sidebar.bmp`（164×314）— 安装侧边图
- `build/uninstaller-sidebar.bmp`（164×314）— 卸载侧边图

**设计方向**：参考 VSCode/Codex 安装界面风格，深色主题 + Daily 品牌色 + logo。用 huashu-design skill 生成 HTML 原型，再用脚本转 BMP。

#### E2：编写自定义 NSIS 脚本

**新增文件**：`build/installer.nsh`

**功能**（基于 electron-builder 官方支持的宏：`preInit`/`customInit`/`customInstall`/`customUnInstall`）：
1. **默认安装路径改 daily 目录**（用 `!macro preInit` 写注册表 `InstallLocation`，而非 `StrCpy $INSTDIR`）：
   ```nsis
   !macro preInit
     SetRegView 64
     WriteRegExpandStr HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation "$LOCALAPPDATA\Programs\daily"
     WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$LOCALAPPDATA\Programs\daily"
   !macroend
   ```
2. **自定义安装选项页面**（用 `!macro customInstall` + nsDialogs）：
   - 开机启动复选框（勾选则写 `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`）
   - 桌面快捷方式复选框
   - 开始菜单快捷方式复选框
3. **卸载时清理**（用 `!macro customUnInstall`）：删除 Run 注册表项

**注意**：`NSIS_HOOK_PREINSTALL` 宏不存在，electron-builder 实际支持的是 `preInit`/`customInit`/`customInstall`/`customUnInstall` 等。详见 https://www.electron.build/configuration/nsis#custom-nsis-script

**修改**：`electron-builder.yml` nsis 块新增 `include: build/installer.nsh`

#### E3：修复 asar 打包

**问题**：`asar: false`（注释说 58780 文件打包卡住），导致 3121 文件散装，安装卡顿。

**修复**：
1. 重新启用 `asar: true`（当前 files 是 allow-list，文件数已从 58780 大幅减少，可能不再卡住）
2. `asarUnpack` 排除 native 模块（`**/node_modules/better-sqlite3/**`、`**/node_modules/electron/**`）
3. **诊断步骤**（如仍卡住）：
   - 用 `electron-builder --verbose` 查看卡在哪个文件
   - 排查 Windows Defender 实时扫描（排除项目录 `f:\allmylife\event\` 和输出目录）
   - 排查文件锁（关闭 Trae/其他占用 out/ 的进程）
   - 排查路径过长（Windows 260 字符限制）
4. 若 asar 仍卡住，fallback 为 `asar: false` + 优化文件列表（用 `npm prune --production` 减少 node_modules）

#### E4：实际打包验证

1. `npm run build:win` 生成 setup.exe
2. 干净环境（新用户账户或 Sandbox）安装/启动/卸载
3. 验证：
   - 安装路径默认 `daily` 目录
   - 开机启动选项可选且生效
   - 桌面/开始菜单快捷方式选项可选且生效
   - 安装过程不卡顿（asar 启用后）
   - 安装界面专业美观
4. 截图存证于 `docs/verify/phase14/install/`

---

## 四、执行顺序与依赖

```
阶段 1（并行，互不依赖）：
  ├─ A1 替换品牌名 + A3 修测试断言（合并，避免中间测试失败）
  ├─ A2 补 favicon.svg
  ├─ A4 清理遗留模板（验证引用后删除）
  ├─ B1 修 baseURL + WebSocket URL（临时固定端口 3456）
  ├─ B2 修 LocalAgent 阻塞
  ├─ B3 优化启动（指数退避）
  ├─ D1 搭建测试框架
  └─ D2-pre 同步修 dogfood 脚本中的品牌名断言（与 A1 一起改）

  注：阶段 1-3 期间用 dev 模式（npm run dev）测试，dev 模式 Vite proxy 仍走 3456

阶段 2（依赖 C1 可与 A1 后并行）：
  └─ C1 SQLite 改造（大任务，独立 sub-agent）

阶段 3（依赖 C1）：
  ├─ C2 server 打包
  └─ C3 子进程拉起（含 PoC 验证 pi-coding-agent 兼容性）

阶段 4（依赖 C3 + D1）：
  ├─ C4 端口动态分配（完成后回头改 B1 的 client.ts + WS URL）
  ├─ D2 修复 dogfood 脚本逻辑问题（C8/C9/C10 等）
  └─ D3 回归测试

阶段 5（依赖 A2 + C2）：
  ├─ E1 重设计 BMP（用新 logo）
  ├─ E2 NSIS 脚本
  └─ E3 修 asar

阶段 6（依赖全部）：
  ├─ E4 打包验证
  └─ 对抗审核
```

---

## 五、验证标准

### 5.1 功能验证（用 D1 测试工具，运行时验证）

- [ ] 应用启动 < 3 秒显示窗口（测量方式：`app.whenReady()` 到 `mainWindow.show()` 的时间，用 `performance.now()` 打点）
- [ ] onboarding 5 步流程完成，进入主页
- [ ] 面板 CRUD + widget 添加 + 拖拽 + 状态保留
- [ ] AI 对话（配置 Key 后）能发送消息并收到响应
- [ ] 浏览器标签创建 + 网页嵌入画布
- [ ] 设置 5 tab 切换 + 修改持久化
- [ ] 离线模式 banner + local 模式切换
- [ ] 22 面板内存 < 100MB

### 5.2 安装验证（干净环境实测）

- [ ] 安装路径默认 `daily` 目录
- [ ] 开机启动选项可选且生效（注册表写入）
- [ ] 桌面快捷方式选项可选且生效
- [ ] 开始菜单快捷方式选项可选且生效
- [ ] 安装过程不卡顿（进度条自动推进）
- [ ] 安装界面专业美观（BMP + 中文）
- [ ] 卸载干净（无残留）

### 5.3 品牌验证

- [ ] 用户可见位置无 "Living Dashboard" 字样
- [ ] `productName` = `Daily`
- [ ] 窗口标题 / 托盘 tooltip / 标题栏 = `Daily`
- [ ] favicon.svg 非 Vite 默认
- [ ] icon.ico 来自 daily.png（已确认）

### 5.4 后端验证

- [ ] server 自动启动（无需手动）
- [ ] SQLite 数据库文件创建于 `%APPDATA%/Daily/daily.db`
- [ ] API 请求成功（无 `file:///api` 错误）
- [ ] 端口动态分配，无冲突
- [ ] WebSocket 连接正常

---

## 六、风险与应对

| 风险 | 概率 | 应对 |
|------|------|------|
| pi-coding-agent 在 Electron 子进程不兼容 | 中 | 阶段 3 先做 PoC，失败则 server 去掉 piBridge，AI 由主进程 LocalAgentService 承担 |
| better-sqlite3 native 模块问题 | 低 | 用 prebuilt binaries（npm rebuild），不用 electron-rebuild；asarUnpack 排除 |
| SQLite 性能不足 | 低 | 单用户场景足够，`PRAGMA journal_mode=WAL` + `PRAGMA synchronous=NORMAL` |
| asar 打包卡住（历史问题） | 中 | allow-list 后文件数大减，可能已解决；卡住则按 E3 诊断步骤排查 |
| NSIS 脚本编写复杂 | 低 | 用 electron-builder 官方宏 `preInit`/`customInstall` |
| `array_agg` 改写困难 | 低 | 应用层聚合（先查明细再 group） |
| Windows Defender 实时扫描导致安装卡顿 | 中 | 排查时排除项目录和输出目录；文档说明用户可添加 Defender 排除项 |
| 未签名 exe 触发 SmartScreen 警告 | 高 | 本期内部分发，文档说明"点击'仍要运行'"；长期购买代码签名证书 |
| Windows 图标缓存不更新 | 低 | 文档说明"重启资源管理器或运行 `ie4uinit.exe -show`" |
| server 子进程日志无法查看 | 中 | 日志写入 `app.getPath('logs')/server.log`，设置面板增加"查看日志" |

---

## 七、Git 策略

- 当前分支：`phase13-release-gate`（HEAD `9a354a6`）
- 新建分支：`phase14-desktop-fix`
- 工作区有未提交更改（Android 脚本模块等），与本任务无关，先 `git stash` 或单独提交
- 每个工作流完成后提交一次，便于回溯
- 最终打 tag `v1.0.0`（P13 遗留未打）
