# Phase 13：发布前质量门禁 — 详细执行计划

> **生成日期**：2026-06-30
> **目标**：100% 通过 Phase 13 全部 6 项验收，产出 Living Dashboard 1.0.0 未签名内部正式版（Windows NSIS 安装包）
> **强制标准**：禁止"基本合格""条件通过"。任何一项不通过 → 不发布。所有任务必须运行时验证（截图/视频/日志存证于 `docs/verify/phase13/`）

---

## 一、前置条件

| 项 | 状态 |
|---|---|
| Phase 0-12 + 14 全部完成 | ✅ |
| 真实 LLM API Key | ✅ DeepSeek sk-<DEEPSEEK_API_KEY>（从环境变量读取）（优先用 deepseek-v4-flash，若 Key 不支持 V4 则 fallback 到 deepseek-chat；必须真实测试不逃避报错） |
| 代码签名 | 暂不签名，内部分发 |
| API Key 统一策略 | 正向同步为主（aiKeyApi.setApiKey → PUT /ai/settings）；反向同步本期不做，记为已知限制 |
| onboarding 设计方式 | huashu-design skill 设计 5 步 HTML 原型 |
| Windows Sandbox | 需 Windows 10/11 Pro/Enterprise + 硬件虚拟化；若不可用 fallback 到新用户账户测试 |

---

## 二、13.1 桌面端原生体验补全（5 个子任务）

### 13.1.1 自绘标题栏

**现状**：`client/desktop/electron/main/index.ts:214-229` BrowserWindow 配置缺少 frame/titleBarStyle/titleBarOverlay 字段，使用系统原生标题栏。无 TitleBar 组件，无窗口控制 IPC，preload 未暴露 windowApi。

**新增文件**：
- `client/desktop/src/components/TitleBar.tsx` — 自绘标题栏组件
- `client/desktop/src/components/__tests__/TitleBar.test.tsx` — 单测

**修改文件**：
1. `client/desktop/electron/main/index.ts:214-229` — BrowserWindow 配置改为：
   ```ts
   frame: false,
   titleBarStyle: process.platform === 'darwin' ? 'hidden' : undefined,
   titleBarOverlay: process.platform === 'win32' 
     ? { color: '#1e1e2e', symbolColor: '#cdd6f4', height: 36 } 
     : undefined,
   ```
2. `client/desktop/electron/main/index.ts` — 新增 ipcMain.handle：`window:minimize` / `window:maximize-toggle` / `window:close` / `window:is-maximized`，以及 `window:maximize-change` 事件监听
3. `client/desktop/electron/preload/index.ts` — 暴露 `windowApi: { minimize, maximizeToggle, close, isMaximized, onMaximizeChange }`
4. `client/desktop/src/types/electron.d.ts:358-372` — 新增 `WindowApi` 接口 + Window 接口加 `windowApi`
5. `client/desktop/src/App.tsx:395-468` — 在 OfflineBanner 之前插入 `<TitleBar />`
6. `client/desktop/src/index.css` — 标题栏 `-webkit-app-region: drag`，按钮 `no-drag`
7. `client/desktop/src/test/mocks/mockElectronAPI.ts` — 补 windowApi mock

**验收标准**：
- 无 Windows 原生标题栏
- 拖拽标题栏区域可移动窗口
- 三按钮（最小化/最大化/关闭）可用
- 双击标题栏切换最大化
- 截图存证于 `docs/verify/phase13/ui/12-titlebar.png`

**风险点**：
- `frame: false` 后窗口阴影消失 → 用 `BrowserWindow` 的 `backgroundColor` + CSS `box-shadow` 处理
- `-webkit-app-region: drag` 与按钮点击冲突 → 按钮区域显式 `no-drag`
- 现有 `app-topbar`（Omnibox+TabBar）布局需调整 flex 高度

### 13.1.2 应用图标

**现状**：`build/` 目录只有 `.gitkeep`，无任何图标资源。`electron-builder.yml:48` 注释掉了 icon 字段。`main/index.ts:108` 托盘图标路径 `build/tray-icon.png` 不存在，fallback 到空图标。

**新增文件**：
- `build/icon.ico` — Windows 应用主图标（256/128/64/48/32/16 多分辨率 ICO）
- `build/icon.png` — 通用 PNG 源（256×256）
- `build/tray-icon.png` — 系统托盘图标（32×32 PNG 透明背景）

**修改文件**：
1. `electron-builder.yml:48` — 取消注释 `icon: build/icon.ico`
2. `client/desktop/electron/main/index.ts:108` — 确认 `build/tray-icon.png` 路径生效（文件存在后即生效）
3. `client/desktop/public/favicon.svg` — 可选更新为品牌 logo SVG

**图标生成方案**：
- 用现有 `client/desktop/src/assets/logo.png` 作为设计源
- 用 Node.js `png-to-ico` 包或 Sharp 生成多分辨率 ICO（脚本生成到 build/ 目录，不在 C 盘）
- 托盘图标单独裁剪为 32×32 透明背景 PNG

**验收标准**：
- 任务栏显示自定义图标（非 Electron 默认）
- 桌面快捷方式显示自定义图标
- 系统托盘显示自定义图标
- 安装包 exe 图标为自定义图标
- 截图存证

**风险点**：
- ICO 必须含 256×256 分辨率，否则 electron-builder 警告
- 托盘图标过大被缩放失真 → 严格 32×32

### 13.1.3 品牌化 NSIS 安装界面

**现状**：`electron-builder.yml:53-65` 基础 NSIS 配置完整（oneClick:false / perMachine:false / allowToChangeInstallationDirectory:true），但无品牌化资源（banner/sidebar BMP）。

**新增文件**：
- `build/installer-banner.bmp` — 安装向导顶部 banner（150×57 px，24-bit BMP）
- `build/installer-sidebar.bmp` — 安装向导左侧 sidebar（164×314 px，24-bit BMP）
- `build/uninstaller-sidebar.bmp` — 卸载向导 sidebar（164×314 px）

**修改文件**：
1. `electron-builder.yml:53-65` — nsis 块新增：
   ```yaml
   installerBanner: build/installer-banner.bmp
   installerSidebar: build/installer-sidebar.bmp
   uninstallerSidebar: build/uninstaller-sidebar.bmp
   installerIcon: build/icon.ico
   uninstallerIcon: build/icon.ico
   ```
2. 新增 `nsis.language: zh_CN` 配置（中文安装向导）

**BMP 生成方案**：
- 用 huashu-design skill 或脚本生成 banner/sidebar 视觉
- 用 Sharp 将 PNG 转 24-bit BMP（严格尺寸）

**验收标准**：
- 安装向导非默认 electron-builder 皮肤
- 中文界面
- 干净 Windows 实测截图存证于 `docs/verify/phase13/install/`

**风险点**：
- BMP 尺寸严格（150×57 / 164×314），尺寸错会拉伸
- 必须 24-bit 或 32-bit BMP

### 13.1.4 首次启动 onboarding

**现状**：完全未实现。无 Onboarding 组件、无 store、无门控。原型 `docs/ui-prototype/desktop/index.html` 未设计 onboarding。

**设计阶段**（前置）：
- 调用 `huashu-design` skill 设计 5 步 onboarding HTML 原型
- 5 步：欢迎页 / 数据目录选择 / 服务器连接引导 / AI 配置引导 / 完成跳转
- 视觉风格参考 `docs/ui-prototype/desktop/index.html` 现有风格（深色主题 + 圆角 + 无边框美学）
- 设计稿存于 `docs/ui-prototype/desktop/onboarding.html`

**新增文件**：
- `client/desktop/src/components/Onboarding.tsx` — onboarding 主组件（步骤路由）
- `client/desktop/src/components/onboarding/WelcomeStep.tsx`
- `client/desktop/src/components/onboarding/DataDirStep.tsx`
- `client/desktop/src/components/onboarding/ServerStep.tsx`
- `client/desktop/src/components/onboarding/AiConfigStep.tsx`
- `client/desktop/src/components/onboarding/CompleteStep.tsx`
- `client/desktop/src/stores/useOnboardingStore.ts` — onboarding 状态 store
- `client/desktop/src/components/__tests__/Onboarding.test.tsx`

**修改文件**：
1. `client/desktop/src/App.tsx:386-393` — MigrationPage 门控之后插入 onboarding 门控：
   ```tsx
   if (!hasCompletedOnboarding) { return <Onboarding /> }
   ```
2. `client/desktop/src/stores/useAppStore.ts` — 新增 `hasCompletedOnboarding` 状态 + setter（持久化到 IDB kvStorage）
3. `client/desktop/src/utils/kvStorage.ts` 或 `dbV2.ts` — 新增 onboarding 完成状态持久化 key
4. `client/desktop/electron/preload/index.ts` — 新增 `dialogApi: { selectDirectory }`（数据目录选择用 `dialog.showOpenDialog`）
5. `client/desktop/src/types/electron.d.ts` — 新增 `DialogApi` 接口

**AI 配置步骤复用**：
- 复用 `aiKeyApi.setApiKey` + `aiKeyApi.setActiveProvider`（13.2 双向同步后也自动 PUT /ai/settings）
- 复用 `useApiConfigStore` 的 preset 列表
- 简化为引导流程（provider 选择 + apiKey 输入 + 连接测试）

**服务器连接步骤复用**：
- 复用 `serverHealthCheck.ts` 探测逻辑
- 提供输入框让用户填服务器地址（默认 `http://localhost:3456`）
- 实时探测 + 状态显示

**验收标准**：
- 首次启动有引导流程，非空白直进主页
- 5 步全部可完成
- 完成后不再出现（持久化生效）
- Playwright MCP 截图存证于 `docs/verify/phase13/ui/onboarding-*.png`

**风险点**：
- 与 MigrationPage 时序冲突 → onboarding 在迁移之后执行
- 数据目录选择需重新初始化 IDB → 时序复杂，本期数据目录步骤允许"使用默认"跳过
- 持久化必须存 IDB 而非 localStorage（避免清缓存丢失）

### 13.1.5 publish.url 处理

**现状**：`electron-builder.yml:74-77` publish 配置为占位符 `https://example.com/auto-updates`，未集成 electron-updater。

**方案**：移除 publish 块（方案 A，最快通过验收）

**修改文件**：
1. `electron-builder.yml:74-77` — 删除整个 `publish` 块

**验收标准**：
- 启动应用不出现"自动更新失败"错误
- 打包正常不报 publish 相关警告

---

## 三、13.2 核心功能缺陷修复（4 个子任务）

### 13.2.1 switchSession 加载历史 bug

**现状**：`client/desktop/src/stores/useAIStore.ts:1579-1581` switchSession 只 `set({ activeSessionId })`，未调 `loadSessionHistory`。loadSessionHistory（:1398-1454）实现完整但未被串联。

**修改文件**：
1. `client/desktop/src/stores/useAIStore.ts:1579-1581` — 改为：
   ```ts
   switchSession: async (sessionId) => {
     set({ activeSessionId: sessionId })
     await get().loadSessionHistory(sessionId)
   },
   ```

**验收标准**：
- 切换会话后 UI 显示该会话历史消息
- Playwright MCP 切会话截图存证
- Network 面板观察到 `/api/panels/{panelId}/conversations` 请求

**测试**：
- 补单测：mock fetch，调 switchSession 后断言 messages 非空 + fetch 被调用

### 13.2.2 permission_request 链路

**现状**：7 个缺失点。UI 层（PermissionCard + 挂载 + respondToPermission）已完整，但服务端发送 + 接收响应 + 客户端分发完全缺失，导致 pendingPermissionRequests 永远为空。

**修改文件**：

服务端：
1. `server/src/ws.ts:43-51` — ServerMessage 新增 `permission_request` kind
2. `server/src/ws.ts:30-37` — ClientMessage 新增 `permission_response` kind
3. `server/src/piBridge.ts` — 新增：
   - `permissionPending: Map<string, { resolve, reject, timer }>`（参照 askUserPending :318-325）
   - `PERMISSION_TIMEOUT_MS = 120_000`
   - `executeWithPermission(panelId, payload): Promise<{ approved: boolean }>` — 发送 permission_request，等待 permission_response
   - `handlePermissionResponse(msg)` — 从 pending 取出 resolve
4. `server/src/piBridge.ts:547-565` — 在 storageWriteTool.execute 调 executeViaWs 之前插入门控
5. `server/src/piBridge.ts:1154-1225` — onClientMessage 新增 `permission_response` 分支
6. 对 delete_html_widget / browser_set_cookie / browser_eval 等危险工具按需追加门控

客户端：
7. `client/desktop/src/stores/useAIStore.ts:91-100` — 客户端 ServerMessage 新增 `permission_request` kind
8. `client/desktop/src/stores/useAIStore.ts:566-664` — handleServerMessage 新增 `case 'permission_request'`，写入 `pendingPermissionRequests`

UI 层无需改动（PermissionCard.tsx + AIAssistantSidebar.tsx:562-565 已完整）。

**门控插入位置**（以 storageWriteTool 为例）：
```
execute(toolCallId, params)
  ├─ 1. const pid = getCurrentPanelId()  // 已有
  ├─ 2. 【新增】executeWithPermission(pid, { toolName, description, permission, arguments })
  │     └─ sendToDevice({ kind: 'permission_request', ... })
  │     └─ await Promise（由 handlePermissionResponse resolve）
  ├─ 3. if (!approved) return { PERMISSION_DENIED }
  └─ 4. executeViaWs('storage_write', params, pid)  // 已有
```

**验收标准**：
- 触发写工具 → PermissionCard 渲染 → 用户允许 → 工具继续 → 成功回执
- 触发写工具 → PermissionCard 渲染 → 用户拒绝 → 工具中止 → PERMISSION_DENIED
- dangerous 工具二次确认
- Playwright MCP 录屏 + WS 帧抓包存证

**测试**：
- 服务端单测：mock sendToDevice，测 executeWithPermission + handlePermissionResponse + 超时
- 客户端单测：mock sendWs，dispatch permission_request，断言 pendingPermissionRequests 更新
- Playwright MCP E2E：真实触发写工具，验证 PermissionCard 可见 + Allow/Deny 流程

### 13.2.3 真实 LLM 端到端验证

**现状**：代码完整但有 2 个阻塞级缺陷（B3 已确认无需修复）：
- B1：三套 API Key 入口不一致（AIApiConfig.tsx 调 PUT /ai/settings，LocalAgentService 读本地 ai-keys.json）
- B2：ModelRegistry 依赖 extension provider 注册（已确认 pi-coding-agent 内置 deepseek provider，但只有 V4 系列模型）
- ~~B3：LocalAgentService.initialize() 调用时机需确认~~ → **已确认正确**（main/index.ts:332 在 createWindow 前 await initialize）

**修复 B1：正向同步（client → server）**

> 本期只做正向同步，反向同步（server → client）记为已知限制。

修改文件：
1. `client/desktop/src/components/settings/AIApiConfig.tsx:60-66` — 改为同时调用：
   - `window.aiKeyApi.setApiKey(provider, apiKey, endpoint, model)`（本地存储）
   - `api.put('/ai/settings', body)`（服务器同步，cloud 模式 fallback）
   - provider 来源：调用 `useApiConfigStore.inferProviderFromEndpoint(endpoint)` 推断（若不存在则新增该工具函数，从 endpoint 域名推断 provider：api.deepseek.com → deepseek）
2. `client/desktop/electron/main/apiKeyStore.ts` — setApiKey 时通过 IPC 事件通知渲染进程同步到服务器（`window.webContents.send('api-key:changed', { provider, endpoint, model })` → 渲染进程监听后调 `api.put('/ai/settings')`）

**修复 B2：确认 extension provider（已调研确认）**

调研结论（2026-06-30）：
- pi-coding-agent ^0.79.10 **已内置 deepseek provider**（baseUrl: `https://api.deepseek.com`，api: openai-completions）
- 内置 deepseek 模型只有 V4 系列：`deepseek-v4-flash`（推荐，便宜）/ `deepseek-v4-pro`
- LocalAgentService.initialize() 调用时机已确认正确（main/index.ts:332 在 createWindow 前）
- workerThreadsPatch 设计正确，应生效
- `.pi/extensions/` 目录路径（**注意：不是 `.pi/agent/extensions/`**，LocalAgentService.ts:342-344 agentDir=join(cwd,'.pi')，extensions 从 agentDir/extensions/ 加载）

**方案优先级**：
1. **方案 0（优先尝试）**：直接用内置 deepseek provider + `deepseek-v4-flash` 模型。若用户 API Key 支持 V4 则无需任何 extension。
2. **方案 1（V4 不支持时）**：用 openai provider + deepseek baseUrl（`provider='openai'` + `endpoint='https://api.deepseek.com'` + `model='deepseek-chat'`），pi-coding-agent 的 openai-completions provider 会自动兼容 DeepSeek API。
3. **方案 2（最后手段）**：创建 `.pi/extensions/deepseek-provider.ts` 注册 `deepseek-chat`/`deepseek-reasoner` 模型。参考 `node_modules/@earendil-works/pi-coding-agent/docs/custom-provider.md`。

**注意**：`process.env.PI_API_ENDPOINT` 在 pi-coding-agent 中无读取处（无效代码），endpoint 字段对内置 provider 无效，但内置 deepseek provider 的 baseUrl 已是 `https://api.deepseek.com`，不影响验证。

**真实 LLM 端到端验证流程**：
1. 配置 API Key：DeepSeek sk-<DEEPSEEK_API_KEY>，endpoint `https://api.deepseek.com`，model 优先 `deepseek-v4-flash`，若 Key 不支持 V4 则 fallback 到方案 1（openai provider + deepseek-chat）
2. 启动桌面端 dev 模式
3. 切换到 local agent 模式
4. 发送测试消息："你好，请回复一句话"
5. 验证：流式 text_delta + turn_end 事件
6. 测试工具调用：发送"帮我用 storage_write 写一个 kv:test=hello"（**依赖 13.2.2 permission_request 完成**）
7. 验证：tool_call + tool_result 事件 + permission_request 链路
8. 录屏 + 日志存证于 `docs/verify/phase13/llm-e2e/`

> **依赖说明**：步骤 6-7 依赖 13.2.2 permission_request 链路完成。步骤 1-5（纯对话验证）可与 13.2.2 并行。

**验收标准**：
- 对话能跑通，无崩溃
- 工具能调，无崩溃
- 流式响应正常
- 必须真实测试，不能逃避报错（遇到报错就修复）

**风险点**：
- DeepSeek API Key 可能不支持 V4 模型 → 方案 0 失败则用方案 1（openai provider + deepseek-chat），最后手段方案 2（创建 .pi/extensions/）
- pi-coding-agent 内部 HTTP client 可能不走 global.fetch → 真实测试可绕过此问题
- workerThreadsPatch 兼容性 → 已有补丁，需确认生效

### 13.2.4 serverHealthCheck 端点对齐

**现状**：5 个问题：
- Bug 1（中危）：双健康检查循环并存（serverHealthCheck.ts + adapter.ts:detectBackend），状态不同步
- Bug 2（低危）：客户端 HEAD 方法，服务端仅 GET，依赖 Express 隐式行为
- Bug 3（低危）：初始状态竞态，启动有伪离线窗口
- Bug 4（低危）：无重试 + 30s 间隔，瞬态故障恢复慢
- Bug 5（信息性）：响应体未校验

**修复方案**（修复 Bug 1 + Bug 2，其余记录在案）：

修改文件：
1. `client/desktop/src/utils/serverHealthCheck.ts:80` — HEAD 改为 GET
2. `client/desktop/src/api/adapter.ts:12-56` — 移除 detectBackend 内的 setInterval 健康检查，改为复用 serverHealthCheck 的结果（通过 useRuntimeModeStore.isServerOnline）
3. `client/desktop/src/api/adapter.ts` — detectBackend 初始探测保留（10×1s 重试），但后续监听 useRuntimeModeStore 变化切换 currentBackend

**验收标准**：
- 服务器在线时 healthCheck 返回 online，auto 模式不降级
- Network 面板只看到一组 `/api/health` 请求（非两组）
- 客户端用 GET 方法，服务端 `app.get` 显式对齐
- 运行时验证存证

---

## 四、13.3 发布前 UI 全量走查（12 个页面/状态）

**工具**：Playwright MCP（`node "F:\Operit_workspace_full_backup\workspace_backup\.mcp-playwright-runtime\playwright-cli.js" run <script>`）

**截图存证目录**：`docs/verify/phase13/ui/`

**12 个必走页面/状态**：
1. 浏览器主页（新建网页标签）— `01-browser-home.png`
2. 画布主页（新建画布面板）— `02-canvas-home.png`
3. 浏览器模式浏览真实网页（https://example.com）— `03-browser-webpage.png`
4. 画布模式（组件拖拽+缩放+多选+连线）— `04-canvas-edit.png`
5. Sidebar canvas 模式（面板列表+切换+增删+重命名）— `05-sidebar-canvas.png`
6. Sidebar ai-assistant 模式（会话选择器+对话流+pill 输入+AgentModeSwitcher+思考等级）— `06-sidebar-ai.png`
7. SettingsPanel 每个 tab：
   - 通用设置 — `07-settings-general.png`
   - AI 配置 — `08-settings-ai.png`
   - 主页定制 — `09-settings-homepage.png`
   - 收藏管理 — `10-settings-favorites.png`
   - 休眠配置 — `11-settings-sleep.png`
   - 搜索引擎配置 — `12-settings-search.png`
8. 权限请求卡片（PermissionCard）— `13-permission-card.png`
9. askUserQuestion 卡片（AskUserCard）— `14-ask-user-card.png`
10. 离线降级 banner（OfflineBanner）— `15-offline-banner.png`
11. 系统托盘菜单+右键菜单 — `16-tray-menu.png`
12. 自绘标题栏 — `17-titlebar.png`

**额外**：onboarding 5 步 — `18-onboarding-welcome.png` ~ `22-onboarding-complete.png`

**验收标准**：每个页面/状态都有截图存证，对照原型视觉 1:1 还原。任何一项缺失/异常 = 不合格。

---

## 五、13.4 真实人类体验验证（8 个场景）

**工具**：`dogfood` skill（独立 agent，结构化报告 + 截图/录屏证据）

**8 个场景**：
1. 首次安装→启动→onboarding→进主页
2. 新用户首次对话（配置 API Key → 发起对话 → 工具调用 → 收到回复）
3. 浏览器场景（新建网页标签 → 输入 URL → 浏览 → 嵌入画布 → 画布操作）
4. 画布场景（新建画布面板 → 添加组件 → 拖拽布局 → 切换面板 → 休眠恢复）
5. 多端场景（桌面端创建数据 → 服务器同步 → 移动端查看，若无移动端则跳过并记录）
6. 离线场景（断网 → 离线 banner → 切换本地 agent → 继续对话）
7. 设置场景（每个 Settings tab 实际读写联动）
8. 极限场景（20+ 面板测内存休眠 / 大量历史记录 / 超大 widget）

**验收标准**：
- dogfood agent 产出结构化报告
- 每个发现的问题有截图/录屏 + 复现步骤
- 所有 P0/P1 问题修复后才能发布
- P2 问题记录在案可不阻塞发布

---

## 六、13.5 干净环境安装实测

**方案**：Windows Sandbox（Windows 10/11 自带，干净环境）

**步骤**：
1. 启用 Windows Sandbox 功能（若未启用）
2. 生成 1.0.0 setup.exe（`npm run build:win`）
3. 在 Windows Sandbox 中安装 `dist/event-1.0.0-setup.exe`
4. 验证：
   - 安装向导流程正常（无报错、无乱码、品牌化界面）
   - 桌面快捷方式 + 开始菜单快捷方式正确创建
   - 启动后正常进入应用（无白屏、无崩溃）
   - 卸载流程正常（残留文件清理）
5. 每步截图/录屏存证于 `docs/verify/phase13/install/`

**验收标准**：以上每一步都有截图/录屏存证

---

## 七、13.6 发布版本号 + tag

**修改文件**：
1. `package.json` — version: `0.10.0` → `1.0.0`
2. `electron-builder.yml` — 注释版本号同步更新（如有）
3. `CHANGELOG.md` — 新增 1.0.0 条目，包含 Phase 10/11/12/13/14 完整变更 + 发布说明

**git 操作**：
1. `git tag v1.0.0`（在 main 分支）
2. 验证 tag 存在

**验收标准**：
- 版本号清晰（package.json + electron-builder.yml 一致）
- git tag v1.0.0 存在
- CHANGELOG 1.0.0 包含完整变更说明

---

## 八、执行顺序与并行性

### 阶段 1a：6 线并行（无依赖）
- **A 线**：13.1.1 自绘标题栏 + 13.1.2 应用图标（并行，无共改文件）→ 13.1.3 NSIS 品牌化
- **B 线**：13.2.1 switchSession bug（1 行修复）→ 13.2.4 serverHealthCheck
- **C 线**：13.2.2 permission_request 链路（服务端 + 客户端）
- **D1 线**：13.2.3 B1 正向同步 + B2 provider 确认（不含真实测试）
- **E 线**：13.1.4 onboarding（huashu-design 设计 → React 实现）
  - **注意**：A 线和 E 线都修改 App.tsx，插入点相邻（A 在 :395-398，E 在 :386-393）。**缓解方案**：E 线的 App.tsx 修改在 A 线完成后串行进行；或合并到同一分支完成两处修改
- **F 线**：13.1.5 publish.url（删除 publish 块，1 分钟）

### 阶段 1b：D2 真实 LLM 测试（依赖 C 线完成）
- **D2 线**：13.2.3 真实 LLM 端到端测试
  - 步骤 1-5（纯对话验证）：可与 C 线并行（阶段 1a）
  - 步骤 6-7（工具调用 + permission_request）：依赖 C 线完成（阶段 1b）

### 阶段 2：13.3 UI 走查（依赖 13.1 全部完成）
- 编写 Playwright MCP 截图脚本（12+5 个页面）
- 用 Playwright MCP 逐页面截图存证

### 阶段 3：13.4 dogfood（依赖 13.1 + 13.2 全部完成含 D2）
- 8 个场景探索式测试

### 阶段 4：13.5 干净环境安装（依赖 13.1 + 13.6 版本号）
- 先 13.6 版本号更新 → build:win 生成 setup.exe → 13.5 Windows Sandbox 安装

### 阶段 5：13.6 正式 tag（依赖所有完成 + 最终对抗审核通过）
- 最终对抗审核通过 → 打 tag v1.0.0

### 预备工作
- 创建 `docs/verify/phase13/` 目录及子目录（ui/、install/、llm-e2e/）

---

## 九、对抗审核计划

### 计划审核（本计划文档）
- 检查 6 项子任务拆分完整性
- 检查依赖关系正确性
- 检查并行性可行性
- 检查运行时验证方式

### 执行中审核（每个子任务完成后）
- 代码审查 + 运行时验证
- 截图/录屏存证

### 最终审核（所有 6 项完成后）
- 用 `adversarial-review` skill 做全量对抗审查
- 包含运行时验证（不接受仅代码审查）
- 验证所有截图/录屏存证齐全
- 验证 1.0.0 setup.exe 产出
- 验证 git tag v1.0.0 存在

---

## 十、风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| DeepSeek API Key 不支持 V4 模型 | 中 | 阻塞 13.2.3 | 方案 0 失败则用方案 1（openai provider + deepseek-chat），最后手段方案 2（创建 .pi/extensions/） |
| onboarding 设计稿与现有视觉不统一 | 低 | 影响 13.3 走查 | huashu-design 时提供现有原型作为参考 |
| Windows Sandbox 不可用（Home 版） | 低 | 阻塞 13.5 | 需 Pro/Enterprise + 虚拟化；fallback 到新用户账户测试 |
| ICO 多分辨率生成失败 | 低 | 阻塞 13.1.2 | 用 Sharp/png-to-ico 生成，失败用在线工具 |
| permission_request 链路跨端调试复杂 | 中 | 阻塞 13.2.2 | 先单测验证逻辑，再 Playwright E2E |
| A/E 线共改 App.tsx 冲突 | 高 | 阶段 1a 合并冲突 | E 线 App.tsx 修改在 A 线后串行，或合并同分支 |
| V4 模型思考等级限制 | 低 | 影响 13.2.3 | V4 只支持 high/xhigh，pi 会自动 clamp，不影响验证 |
