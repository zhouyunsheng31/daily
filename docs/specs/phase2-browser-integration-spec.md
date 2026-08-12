# Phase 2 Spec: 浏览器引擎集成（v8 修订版）

> 生成日期：2026-06-23
> 修订日期：2026-06-23（v8 修订版，修复 v7 对抗审查发现的 3 个致命 + 8 个严重问题）
> 目标：在 Electron 客户端中集成浏览器引擎，实现网页组件 + AI 操控浏览器
> 范围：含 Phase 1 依赖项（TabBar/Sidebar/系统托盘/菜单栏），因 Phase 2 的"标签页 ↔ 网页组件转换"和"地址栏"依赖标签页管理

## v8 修订说明

本次修订基于对 v7 的对抗审查，修复以下问题：

**致命问题（3 个）**：
- F1：`createWindow` 修改代码用注释省略了关键现有逻辑（`ready-to-show`、dev server URL 加载、`setWindowOpenHandler`、BrowserWindow 配置都被注释掉）。给出完整的 createWindow 函数代码，对照真实代码 `main/index.ts` L8-L49，包含所有现有逻辑 + 新增逻辑，禁止用注释省略
- F2：Omnibox 的 `navigateToUrl` 没有 `normalizeUrl`，导致 URL 无协议时 webview 加载失败。在 `navigateToUrl` 内部第一行添加 `url = normalizeUrl(url)`
- F3：WebviewWidget 的 useEffect 2 在 webview 未就绪时跳过导航，导致 webview 可能永远空白。在 useEffect 1 中监听 `dom-ready` 事件触发首次导航，useEffect 2 保持 try/catch 跳过未就绪导航（由 useEffect 1 的 dom-ready 处理）

**严重问题（8 个）**：
- S1：useEffect 1 和 useEffect 3 的 cleanup 重复注销 webview 和重复提交 state。明确分工：useEffect 1 只负责注册/注销 webview + dom-ready 首次导航；useEffect 3 只负责事件监听/清理 + loadTimeoutRef 清理；state 提交（pendingRef + updateTimerRef）只放在 useEffect 3 的 cleanup 中
- S2：`awaitReady` 方法中 `setTimeout` 泄漏（Promise.race 中 setTimeout 未清除）。用 `finally` 块清除 timer
- S3：`awaitReady` 方法错误地认为 `getURL()` 不抛错就代表 webview 已就绪。在 BrowserToolBridge 中维护 `private ready = false`，在 `registerWebview` 时监听 `dom-ready` 设置 `ready=true`，`awaitReady` 检查 ready flag
- S4：`browserScreenshot` 对隐藏 webview 截图可能失败（visibility 设置后未等待重绘，且父元素可能也是 hidden）。设置 visibility 后等待 `requestAnimationFrame` + `setTimeout(0)` 确保重绘；检查父元素（面板层）是否也是 hidden，如果是临时移除 `panel-layer--hidden` 类
- S5：`addWidget` 5-webview 限制实现不完整（只用注释省略现有逻辑）。给出完整的修改后 addWidget 函数代码，对照真实代码 `useAppStore.ts` L939-L1047，把 5-webview 检查逻辑插入到函数开头
- S6：`handleSlashCommand` 的 `/open` 命令没有 URL 校验和规范化。在 `/open` 命令中调用 `normalizeUrl(arg)`
- S7：`types/v2.ts` 的 `PanelData.settings` 不支持扩展字段（无索引签名）。在 `PanelData.settings` 中添加索引签名 `[key: string]: unknown`
- S8：`createAppMenu` 缺少"面板"菜单。在"视图"和"帮助"之间添加"面板"菜单（新建面板/管理面板）

**修复原则**：
1. 禁止"伪保留"：所有修改现有函数的代码必须给出完整函数实现，不能用 `// ... 现有逻辑保留` 注释省略
2. 保留 v7 已修复的内容：v6 审查的 4 致命 + 18 严重问题的修复必须保留
3. 内部一致性：修复后 Spec 内部不能有矛盾
4. 对照真实代码：所有现有代码引用必须与实际文件一致

---

## v7 修订说明

本次修订基于对 v6 的对抗审查，修复以下问题：

**致命问题（4 个）**：
- F1：`WebviewTag.addEventListener` 接口签名不支持 `options` 参数。在 WebviewTag 接口中添加 addEventListener 重载，支持 `{ once?: boolean }` 选项
- F2：`WebviewTag.addEventListener` 不支持类型化事件监听器（`Electron.DidNavigateEvent` 等类型未声明）。将所有事件监听器改为 `(e: unknown) => void` 并在内部做类型断言
- F3：JSX `<webview>` 接口缺少 `partition` 属性声明。在 JSX IntrinsicElements 声明中添加 `partition?: string`
- F4：`browserEval` 的 `safeSerialize` 对 `undefined` 返回值处理导致运行时崩溃（`JSON.stringify(undefined)` 返回 undefined，传给 WS 会出错）。在 safeSerialize 中将 `undefined` 转为 `null`，同时在 browserEval 中使用 `JSON.stringify(safeResult ?? null)` 作为额外保护

**严重问题（18 个）**：
- S1：`awaitReady` 方法无超时，webview 卡死时工具调用永久挂起。添加 10s 超时（Promise.race）
- S2：`browserEval` 的 `Promise.race` 超时未清除 `setTimeout`，导致 timer 泄漏。用 `finally` 块清除 timer
- S3：`useEffect` 3 的 cleanup 未清除 `loadTimeoutRef`，组件卸载时可能触发已卸载组件的 setState。在 cleanup 中清除 loadTimeoutRef
- S4：`webPageWidgetDef` 的方法体为占位符（`{ ... }`），无法编译。提供完整的 validateState/normalizeState/migrateState 实现，参考现有 widget 定义模式
- S5：`webviewConfig` 的 `icon` 为占位符（`/* globe icon */`）。提供具体的 SVG 图标，使用 builtIn.tsx 的 `svg` 函数
- S6：`builtIn.tsx` 中 `webPageWidgetDef` 未 import。在 builtIn.tsx 代码片段中添加 import，同时在 widgetDefinitions.ts 中 export webPageWidgetDef
- S7：`useAppStore` 新增 actions 未添加到 `AppState` 接口。在 Spec 中明确展示 AppState 接口的修改
- S8：`TabBar` 组件未显示 `+` 按钮和 Omnibox 集成代码。提供完整的 TabBar 实现
- S9：`Sidebar` 组件未显示完整实现。提供完整的 Sidebar 实现（header/panel-list/折叠/footer）
- S10：`WebviewWidget`/`TabBar`/`Omnibox` 的 CSS 类未提供样式定义。为所有新增 CSS 类提供样式定义
- S11：`localUrl` 状态不会随 `state.url` prop 变化更新。添加 useEffect 同步 localUrl 与 state.url
- S12：`createWindow` 修改未保留现有逻辑。明确说明"在现有 createWindow 基础上添加 mainWindow = 赋值、close 和 closed 事件监听，保留所有现有逻辑"
- S13：`main/index.ts` 的 import 未合并现有 import。展示合并后的 import 语句
- S14：`build/tray-icon.png` 图标文件未提供。说明使用 Electron 内置默认图标 `nativeImage.createEmpty()` 作为托盘图标
- S15：`browserSetCookie` 未检查 `data:`/`blob:` URL。添加协议检查
- S16：`app.on('window-all-closed')` 修改为永不退出，createTray 失败时无法退出。在 createTray 失败时回退到默认行为
- S17：`Electron.LoadCommitEvent`/`DidFailLoadEvent` 等类型未声明。在 electron.d.ts 中声明这些事件类型
- S18：`useEffect` 2（URL 导航）未 debounce，频繁的 state.url 变化会触发频繁导航。添加 webview 加载状态检查

**中等问题（3 个）**：
- M1：`showContextMenu` 的 `onClick` 签名不支持 async。将 onClick 类型改为 `() => void | Promise<void>`
- M3：动态 import 说明。在 Spec 中说明"动态 import 用于避免循环依赖"
- M5：`WebviewWidgetState` 类型位置。明确说明添加到 `types/index.ts`

**轻微问题（3 个）**：
- L1：`panel.settings?.url` 使用可选链但 settings 是必需字段。改为 `panel.settings.url`
- L2：`TOOL_TIMEOUT_MS` 重复声明。明确说明"仅新增 BROWSER_TOOL_TIMEOUT_MS，TOOL_TIMEOUT_MS 已存在"
- L3：`handleSlashCommand` 只处理部分命令。明确说明"当前版本仅支持 /new-panel 和 /open，其他命令未来扩展"

---

## v6 修订说明

本次修订基于对 v5 的对抗审查，修复以下问题：

**致命问题（2 个）**：
- F1：Omnibox `isUrl`/`normalizeUrl` 逻辑问题（localhost 含空格被放行、about:blank 等特殊协议被误判、注释与代码不一致）。重写为 URL 构造 + try/catch 校验，明确禁止 `javascript:` 和 `data:` 协议，含空格一律视为非 URL
- F2：WebviewWidget `useEffect` 依赖 `onUpdateState`（内联箭头函数，每次渲染新引用）导致反复注销/重注册。用 `useRef` 缓存 `onUpdateState`，useEffect 依赖数组只留 `widgetId`，并拆分为注册/URL 导航/事件监听三个独立 useEffect

**严重问题（17 个）**：
- S1：`<webview src>` 与 `loadURL` 双重导航冲突。删除 `<webview src>` 属性，完全由 useEffect 控制 `loadURL`
- S2：`convertWidgetToTab` 未 `await updatePanelSettings`。添加 `await`
- S3：`browser_eval` 无安全强制。添加 code 长度 10KB 限制、5s 执行超时、返回值 1MB 限制
- S4：`browser_screenshot` 不截断 base64。限制截图大小，超过 1MB 返回错误
- S5：`browser_input` 用已废弃的 `el.__proto__`。改用 `el.constructor.prototype`
- S6：`browser_wait_for` 100ms 轮询产生 300 次 IPC。改用 MutationObserver 在 webview 内部轮询，单次 IPC
- S7：`browserToolBridgeRegistry` 生命周期未定义。明确"registry 生命周期与 WebviewWidget 组件生命周期一致，组件卸载时自动清理"
- S8：`BrowserToolBridge.executeJavaScript` 未处理 webview 未就绪。添加 `awaitReady` 方法
- S9：`browser_click`/`browser_input` 未处理 Shadow DOM 和 iframe。明确限制"当前不支持 Shadow DOM 和跨域 iframe"
- S10：`browser_get_cookie`/`browser_set_cookie` 通过 document.cookie 无法获取 HttpOnly cookie。明确说明"通过主进程 session.defaultSession.cookies API，可获取 HttpOnly cookie"
- S11：`webviewTag` 配置位置和 webPreferences 完整性。明确完整 webPreferences 配置，为每个 webview 设置独立 partition 隔离 cookie
- S12：`executeViaWs` 链路描述矛盾。补充完整数据流图
- S13：5-webview 限制策略不全。明确"只计算非隐藏面板上的 webPage 类型 widget"，addWidget 抛出 Error 由调用方捕获
- S14：`setLastActiveWidget` 调用时机。明确 currentWidgetId 来源为 `useAppStore.getState().lastActiveWidgetId`
- S15：面板菜单功能迁移遗漏。在 Sidebar 底部增加"模板"和"自动布局"按钮
- S16：`Workspace.tsx` wheel handler 未排除 webview。在正文给出修改后的 wheel handler 代码
- S17：`WidgetContainer.handleContainerMouseDown` 阻止 webview 获得焦点。检测 WEBVIEW 标签时不 stopPropagation

**中等问题（3 个）**：
- M2：`browser_scroll` 参数单位说明。明确 amount 是像素，添加 unit 参数（可选）
- M5：webview 的 partition。已在 S11 修复中添加 `partition={`persist:webview-${widgetId}`}`
- M7：browserToolBridgeRegistry 并发安全。说明"webview.executeJavaScript 支持并发，无需额外锁"

**轻微问题（2 个）**：
- L2：CATEGORY_LABELS 未补充 'web' 标签。明确要求在 UnifiedToolbar.tsx 的 CATEGORY_LABELS 中添加 `'web': '浏览器'`
- L5：修订记录。在 Spec 末尾添加修订记录章节

---

## v5 修订说明

本次修订基于对 v4 的三次对抗审查，修复以下问题：

**严重问题（5 个）**：
- S1：`window.electron?.ipcRenderer?.on()` 返回 void 不是清理函数，导致 `webview:open-url` 监听器内存泄漏。在 preload 新增 `webviewApi`（与 `menuApi` 同模式，返回清理函数），App.tsx 改用 `window.webviewApi?.onOpenUrl`，并在 electron.d.ts 添加类型声明
- S2：Sidebar 组件 CSS 类名（.sidebar/.sidebar--collapsed/.sidebar__header）与现有 index.css L192-L229 的 .sidebar/.sidebar.collapsed/.sidebar-header 冲突。改为 `.panel-sidebar` 前缀，给出完整 CSS
- S3：.app-root 已存在（index.css L181-L187），Spec 没说明是覆盖还是追加。明确说明"修改现有 .app-root"，给出完整修改后 CSS
- S4：Omnibox 组件使用 `browserToolBridge.getRegisteredWebviews()` 但无 import。在组件顶部添加 `import { useState, useRef, useEffect } from 'react'` 和 `import { browserToolBridge } from '../utils/browserToolBridge'`
- S5：`convertWidgetToTab` 中 addWidget 因 5-webview 限制 throw 时，addPanel 已创建的空面板不会被清理。添加 try/catch，失败时调用 `deletePanel(newPanelId)` 清理空面板后重新抛出

**中等问题（8 个）**：
- M1：`browserScreenshot` 对隐藏的 webview 返回空白截图。截图前临时设为 visible，finally 块中恢复
- M2：`browserInput` 不支持 React/Vue 控制的输入框（直接赋值 value 不触发框架监听）。改用 native value setter + dispatch input/change 事件
- M3：`loadTimeoutRef` 在子框架 load-commit 时重置，导致主框架超时计时器被错误清除。只在 `e.isMainFrame` 为 true 时处理
- M4：`safeSerialize` 深度嵌套对象可能栈溢出。添加 depth 参数，最大深度 10
- M5：`normalizeUrl` 对 localhost 和 IP 地址处理不当（被当作搜索词）。新增 localhost 和 IP 地址识别
- M6：preload 的 else 分支未暴露新增 API。添加注释说明"contextIsolation 始终为 true，else 分支仅作兜底"
- M7：`contextMenuApi` 暴露位置不明确。在 preload 修改的 contextIsolated 分支中明确包含 contextMenuApi 和 webviewApi
- M8：`browserGetDom` selector 为空时返回包含 script/style 的完整 HTML。过滤掉 script/style/noscript 标签

**轻微问题（2 个）**：
- L3：App.tsx 菜单监听器中 `addPanel` 返回 Promise 未 await，错误未捕获。改为 `void useAppStore.getState().addPanel('新面板').catch(console.error)`
- L5：Omnibox 组件缺少 React hooks import（已在 S4 修复中添加）

---

## v4 修订说明

本次修订基于对 v3 的二次对抗审查，修复以下问题：

**致命问题（6 个）**：
- F1：`appendSystemPromptOverride` 必须保留 piBridge.ts L252-L265 现有完整 canvasPrompt（iframe sandbox、canvasStorage API、localStorage 不可用约束），只在数组末尾追加 browserPrompt，不 paraphrase
- F2：`showContextMenu` 在 renderer 中 `import { ipcRenderer } from 'electron'` 违反 contextIsolation，改用 preload 暴露的 `window.contextMenuApi`
- F3：`WebviewTag` 接口未继承 `HTMLElement`，导致 `webview.style.visibility` 无类型，改为 `interface WebviewTag extends HTMLElement`
- F4：`useRef<Electron.WebviewTag>(null)` 与 JSX `<webview>` ref 类型 `Ref<HTMLElement>` 不匹配，修改 JSX IntrinsicElements 将 HTMLElement 替换为 Electron.WebviewTag
- F5：`browserTools` 使用 `inputSchema` 而非 `parameters`，且缺少 `label`/`execute` 字段，按现有 ToolDefinition 结构（piBridge.ts L74-L94）重写 15 个工具
- F6：`executeViaWs(tool: string, ...)` 中 `tool` 是 string，原代码 `tool.name.startsWith` 错误，改为 `tool.startsWith('browser_')`

**严重问题（13 个）**：
- S1：删除 S13 修复节，运行时 `Panel.settings` 已通过 `PanelSettings` 索引签名（types/index.ts L15）支持 `url`，无需修改 types/v2.ts
- S2：`window.cookieApi` 未做 null 检查，在 browserGetCookie/browserSetCookie 开头添加守卫
- S3：`browserOpen` 中 `newWidget` 可能 undefined，添加存在性检查
- S4：`convertWidgetToTab` 调用 `addPanel` 不传 `skipPrimaryAI`，明确说明新面板自动添加主 AI 助手是预期行为
- S5：`Omnibox.navigateToUrl` 不捕获 5-webview 限制错误，添加 try/catch
- S6：`showContextMenu` 主进程 IPC handler 泄漏（`ipcMain.on` 未移除），改用 click 回调直接 resolve + menu-will-close 守卫
- S7：`WebviewWidget` 未 import `browserToolBridge`/`useAppStore`/`WidgetProps`，补全 import
- S8：`wsToolHandlers.ts` 未 import `browserToolBridge`，补全 import
- S9：`browserSetCookie` 对 `about:blank` URL 会失败，添加 URL 有效性检查
- S10：`TabBar` 中 `closeOtherPanels`/`startRename` 函数未定义，给出实现
- S11：`webview:open-url` IPC 在 renderer 端无监听器，在 App.tsx 添加监听
- S12：`WebviewWidget` return 结构在 3.2 节和 F6 修复节冲突，统一合并到 3.2 节
- S13：`browserEval` 安全序列化用 `JSON.parse(JSON.stringify())` 无法处理循环引用，改用自定义递归序列化器（WeakSet 跟踪）

**中等问题（2 个）**：
- M4：`browserClick` 不传 `userGesture=true`，改为 `executeJavaScript(script, true)`
- M7：`executeViaWs` 修改展示完整代码（含 timeout 使用）

**轻微问题（2 个）**：
- L3：`state.url as string` 强制类型转换不安全，改为 `typeof state.url === 'string' ? state.url : ''`
- L4：`WebviewWidget` 未 import `WidgetProps` 类型（已在 S7 修复中补全）

---

## 一、项目上下文

### 1.1 项目目的
多端 AI 浏览器客户端，融合 Living Dashboard 的自由画布 + Tabbit 的 AI 浏览器能力。客户端本身是浏览器，能打开真实网页；**标签页 = 面板 = 画布**，网页作为组件嵌入画布；AI 能操控浏览器（DOM/Cookie/截图/点击）。

### 1.2 核心设计原则（不可违反）
1. **标签页 = 面板 = 画布** — 所有标签页都是画布面板，不存在"纯网页标签页"。网页始终以 WebviewWidget 形式存在于画布上
2. **不喧宾夺主** — 新增 UI 元素（TabBar/Sidebar/Omnibox）不挤压画布空间，Sidebar 可折叠
3. **AI 为核心** — AI 通过 15 个浏览器工具操控浏览器
4. **自由画布** — WebviewWidget 与其他组件平级，可拖拽/调整大小/删除

### 1.3 当前状态
- Phase 0 已完成：Electron + Vite + React 集成
- Phase 1 部分完成：本地 Pi Agent + 数据库已就绪，缺 TabBar/Sidebar/系统托盘/菜单栏
- 8 个组件已就绪
- WS 协议已建立：6 个 customTools

### 1.4 约束条件
- TypeScript 优先
- 不下载到 C 盘
- git 版本管理
- 单 WS 连接，浏览器工具必须复用
- 单 Pi session，所有工具共享上下文
- `contextIsolation: true`，preload 必须用 contextBridge
- `noTools: 'builtin'`，浏览器工具必须走 customTools

### 1.5 Phase 2 验收标准（自包含，不依赖外部 roadmap）
| 验收项 | 量化指标 | 验证方法 |
|--------|---------|---------|
| 能在 Electron 里打开真实网页 | 贴吧/知乎正常加载，3 个网页组件同时运行帧率 ≥ 30fps | 添加网页组件，输入 URL，观察加载 |
| 网页组件能拖拽/调整大小 | 拖拽响应延迟 < 50ms，调整大小无闪烁 | 拖拽网页组件，调整大小 |
| 标签页 ↔ 网页组件双向转换 | 转换后数据不丢失，URL 正确保留 | 标签页右键转组件，组件右键转标签页 |
| AI 能通过工具操作浏览器 | 15 个工具调用成功率 ≥ 95%，平均延迟 < 3s | AI 对话"打开贴吧并截图"，验证工具调用链 |
| 地址栏正常工作 | URL 导航/搜索/AI 对话/斜杠命令 4 种模式正确 | 输入 URL、搜索词、ai: 前缀、/ 前缀 |
| 系统托盘正常 | 关闭窗口最小化到托盘，托盘单击恢复 | 关闭窗口，托盘单击 |

---

## 二、Phase 1 依赖项（最小集）

### 2.1 TabBar 组件（顶部标签栏）

**文件**：`client/desktop/src/components/TabBar.tsx`（新建）

**功能**：
- 顶部水平标签栏，每个标签页对应一个 Panel
- 新建标签页（+ 按钮）
- 关闭标签页（× 按钮，中键关闭）
- 切换标签页（单击）
- 拖拽重排标签页（HTML5 drag and drop）
- 标签页右键菜单（关闭/关闭其他/重命名/转换为网页组件）
- 标签页显示面板名称，双击可重命名
- 集成 Omnibox（地址栏）在标签栏中间区域

**数据流**：
- 订阅 `useAppStore(s => s.panels)` 和 `s.activePanelId`
- 调用 `s.setActivePanel`、`s.addPanel`、`s.deletePanel`、`s.renamePanel`、`s.reorderPanels`

**UI 布局**：
```
┌──────────────────────────────────────────────────────────────┐
│ [面板1 ×] [面板2 ×] [+]    [Omnibox 地址栏]    [侧栏][设置]  │
└──────────────────────────────────────────────────────────────┘
```

**Props**：无（直接订阅 store）

**关键实现**：
- 使用 HTML5 drag and drop API 实现拖拽重排
- 标签页宽度自适应（min 120px, max 240px），超出时水平滚动
- 活跃标签页高亮（accent color 底边 2px）
- 关闭按钮 hover 显示
- Omnibox 集成在标签栏右侧（flex: 1 占据中间空间）

**S8 修复（v7）：完整 TabBar 实现**（含 + 按钮、Omnibox 集成、拖拽重排、中键关闭、右键菜单、双击重命名）：

```tsx
// client/desktop/src/components/TabBar.tsx
import { useState, useRef } from 'react'
import { useAppStore } from '../stores/useAppStore'
import { showContextMenu } from '../utils/contextMenu'
import Omnibox from './Omnibox'

export default function TabBar() {
  const panels = useAppStore(s => s.panels)
  const activePanelId = useAppStore(s => s.activePanelId)
  const setActivePanel = useAppStore(s => s.setActivePanel)
  const addPanel = useAppStore(s => s.addPanel)
  const deletePanel = useAppStore(s => s.deletePanel)
  const renamePanel = useAppStore(s => s.renamePanel)
  const reorderPanels = useAppStore(s => s.reorderPanels)
  const closeOtherPanels = useAppStore(s => s.closeOtherPanels)

  // S10 修复：startRename 用局部状态控制 input 显示
  const [renamingPanelId, setRenamingPanelId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  // S8 修复（v7）：拖拽重排状态
  const [draggedPanelId, setDraggedPanelId] = useState<string | null>(null)
  const tabsRef = useRef<HTMLDivElement>(null)

  const startRename = (panelId: string) => {
    const panel = panels.find(p => p.id === panelId)
    if (!panel) return
    setRenamingPanelId(panelId)
    setRenameValue(panel.name)
  }

  const commitRename = () => {
    if (renamingPanelId && renameValue.trim()) {
      renamePanel(renamingPanelId, renameValue.trim())
    }
    setRenamingPanelId(null)
  }

  // S8 修复（v7）：+ 按钮新建标签页
  const handleNewPanel = () => {
    addPanel('新面板').catch(console.error)
  }

  // S8 修复（v7）：中键关闭标签页
  const handleMouseDown = (e: React.MouseEvent, panelId: string) => {
    if (e.button === 1) {  // 中键
      e.preventDefault()
      deletePanel(panelId).catch(console.error)
    }
  }

  // S8 修复（v7）：HTML5 drag and drop 拖拽重排
  const handleDragStart = (e: React.DragEvent, panelId: string) => {
    setDraggedPanelId(panelId)
    e.dataTransfer.effectAllowed = 'move'
  }
  const handleDragOver = (e: React.DragEvent, panelId: string) => {
    if (draggedPanelId && draggedPanelId !== panelId) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
    }
  }
  const handleDrop = (e: React.DragEvent, targetPanelId: string) => {
    e.preventDefault()
    if (!draggedPanelId || draggedPanelId === targetPanelId) return
    // 重新排序 panels 数组
    const newPanels = [...panels]
    const fromIdx = newPanels.findIndex(p => p.id === draggedPanelId)
    const toIdx = newPanels.findIndex(p => p.id === targetPanelId)
    if (fromIdx === -1 || toIdx === -1) return
    const [moved] = newPanels.splice(fromIdx, 1)
    newPanels.splice(toIdx, 0, moved)
    reorderPanels(newPanels).catch(console.error)
    setDraggedPanelId(null)
  }
  const handleDragEnd = () => setDraggedPanelId(null)

  return (
    <div className="tab-bar">
      <div className="tab-bar__tabs" ref={tabsRef}>
        {panels.map(panel => (
          <div
            key={panel.id}
            className={`tab-bar__tab ${panel.id === activePanelId ? 'tab-bar__tab--active' : ''}`}
            onClick={() => setActivePanel(panel.id)}
            onMouseDown={(e) => handleMouseDown(e, panel.id)}
            onDoubleClick={() => startRename(panel.id)}
            draggable
            onDragStart={(e) => handleDragStart(e, panel.id)}
            onDragOver={(e) => handleDragOver(e, panel.id)}
            onDrop={(e) => handleDrop(e, panel.id)}
            onDragEnd={handleDragEnd}
            onContextMenu={(e) => {
              e.preventDefault()
              const items: Array<{ label: string; onClick: () => void | Promise<void> }> = [
                { label: '关闭', onClick: () => deletePanel(panel.id) },
                { label: '关闭其他', onClick: () => closeOtherPanels(panel.id) },
                { label: '重命名', onClick: () => startRename(panel.id) },
              ]
              // L1 修复（v7）：panel.settings 是必需字段（Panel 接口定义），不用可选链
              if (panel.settings.url) {
                items.push({
                  label: '转换为网页组件',
                  // S13 修复：捕获 5-webview 限制错误，提示用户
                  onClick: () => useAppStore.getState().convertTabToWidget(panel.id).catch(err => window.alert((err as Error).message)),
                })
              }
              showContextMenu(e, items)
            }}
          >
            {renamingPanelId === panel.id ? (
              <input
                className="tab-bar__tab-rename-input"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename()
                  if (e.key === 'Escape') setRenamingPanelId(null)
                }}
                onClick={(e) => e.stopPropagation()}
                autoFocus
              />
            ) : (
              <span className="tab-bar__tab-title">{panel.name}</span>
            )}
            <span
              className="tab-bar__tab-close"
              onClick={(e) => {
                e.stopPropagation()
                deletePanel(panel.id).catch(console.error)
              }}
            >
              ×
            </span>
          </div>
        ))}
        {/* S8 修复（v7）：+ 按钮新建标签页 */}
        <button
          className="tab-bar__new-btn"
          onClick={handleNewPanel}
          title="新建标签页"
        >
          +
        </button>
      </div>
      {/* S8 修复（v7）：Omnibox 集成在标签栏右侧（flex: 1 占据中间空间） */}
      <div className="tab-bar__omnibox">
        <Omnibox />
      </div>
    </div>
  )
}
```

**CSS 类名**：
- `.tab-bar` — 容器（flex 布局）
- `.tab-bar__tabs` — 标签列表区域
- `.tab-bar__tab` — 单个标签
- `.tab-bar__tab--active` — 活跃标签
- `.tab-bar__tab-title` — 标签标题
- `.tab-bar__tab-close` — 关闭按钮
- `.tab-bar__new-btn` — 新建按钮
- `.tab-bar__omnibox` — 地址栏区域
- `.tab-bar__tab-rename-input` — 重命名输入框

### 2.2 Sidebar 组件（侧边栏面板库）

**文件**：`client/desktop/src/components/Sidebar.tsx`（新建）

**功能**：
- 左侧竖向侧边栏，显示所有面板列表
- **可折叠/展开**（按钮或 Ctrl+B 快捷键），折叠后仅显示 40px 宽的图标条
- 点击面板项切换到该面板（等同点击 TabBar 标签）
- 面板项右键菜单（重命名/删除/复制/转换为网页组件）
- 底部"新建面板"按钮
- 面板模板快速创建（从 PanelTemplate 创建）
- **S15 修复：迁移 UnifiedToolbar 面板菜单功能** — 底部增加"模板"和"自动布局"按钮（从 UnifiedToolbar L278-L286 按钮 + L490-L566 Popover 迁移）

**数据流**：
- 订阅 `useAppStore(s => s.panels)`、`s.activePanelId`、`s.setActivePanel`、`s.addPanel`、`s.deletePanel`、`s.renamePanel`、`s.addPanelFromTemplate`
- 订阅 `useAppStore(s => s.sidebarCollapsed)` 和 `s.toggleSidebar`（新增状态）
- **S15 修复**：订阅 `useAppStore(s => s.autoLayoutPanel)`（从 UnifiedToolbar 迁移）
- **S15 修复**：调用 `getBuiltinPanelTemplates()`（从 `../utils/dbStores/panelTemplates` 导入，与 UnifiedToolbar 一致）

**useAppStore 新增状态**（S7 修复（v7）：明确展示 AppState 接口的修改和 create() 初始化对象的修改）：

```typescript
// useAppStore.ts AppState 接口新增字段（S7 修复（v7））
interface AppState {
  // ... 现有字段保留（panels/activePanelId/panelWidgets/...）

  // ========== Phase 1/2 新增：侧边栏 + 标签页转换 ==========
  sidebarCollapsed: boolean                                                    // 侧边栏是否折叠，默认 false
  toggleSidebar: () => void                                                    // 切换折叠状态
  convertWidgetToTab: (widgetId: string) => Promise<void>                      // 网页组件 → 新标签页
  convertTabToWidget: (sourcePanelId: string, targetPanelId?: string) => Promise<void>  // 标签页 → 网页组件
  closeOtherPanels: (keepPanelId: string) => Promise<void>                     // 关闭其他所有面板
}

// create<AppState>(...) 初始化对象新增（S7 修复（v7））
sidebarCollapsed: false,
toggleSidebar: () => set(state => ({ sidebarCollapsed: !state.sidebarCollapsed })),
convertWidgetToTab: async (widgetId: string) => { /* 见 3.4 节实现 */ },
convertTabToWidget: async (sourcePanelId: string, targetPanelId?: string) => { /* 见 3.4 节实现 */ },
closeOtherPanels: async (keepPanelId: string) => {
  const state = get()
  const toDelete = state.panels.filter(p => p.id !== keepPanelId).map(p => p.id)
  for (const pid of toDelete) {
    await state.deletePanel(pid)
  }
},
```

**CSS 类名**（S2 修复：为避免与现有 index.css L192-L229 的 `.sidebar`/`.sidebar.collapsed`/`.sidebar-header`/`.sidebar-tab` 冲突，新 Sidebar 组件容器改用 `.panel-sidebar` 前缀，不复用现有 .sidebar）：
- `.panel-sidebar` — 容器（width: 200px，折叠时 width: 40px）
- `.panel-sidebar--collapsed` — 折叠状态
- `.panel-sidebar__header` — 头部（标题 + 折叠按钮）
- `.panel-sidebar__panel-list` — 面板列表（overflow-y: auto）
- `.panel-sidebar__panel-item` — 面板项
- `.panel-sidebar__panel-item--active` — 活跃面板
- `.panel-sidebar__footer` — 底部按钮区
- `.panel-sidebar__footer-btn` — 底部按钮（新建/模板/自动布局）

**完整 CSS**（追加到 index.css，不修改现有 .sidebar 规则）：
```css
.panel-sidebar {
  width: 200px;
  background: var(--bg-surface);
  border-right: 1px solid var(--border-default);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: width 0.2s ease;
}
.panel-sidebar--collapsed {
  width: 40px;
}
.panel-sidebar__header {
  padding: 8px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--border-default);
}
.panel-sidebar__panel-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px;
}
.panel-sidebar__panel-item {
  padding: 8px 12px;
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
}
.panel-sidebar__panel-item:hover {
  background: var(--bg-hover);
}
.panel-sidebar__panel-item--active {
  background: var(--bg-active);
}
.panel-sidebar__footer {
  padding: 8px 12px;
  border-top: 1px solid var(--border-default);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.panel-sidebar__footer-btn {
  padding: 6px 8px;
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}
.panel-sidebar__footer-btn:hover {
  background: var(--bg-hover);
}
```

**S9 修复（v7）：完整 Sidebar 实现**（含 header/panel-list/折叠状态/footer，整合 S15 底部按钮区）：

```tsx
// client/desktop/src/components/Sidebar.tsx
import { useState, useEffect } from 'react'
import { useAppStore } from '../stores/useAppStore'
import { showContextMenu } from '../utils/contextMenu'
import { Plus, LayoutGrid, Sparkles, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { getBuiltinPanelTemplates } from '../utils/dbStores/panelTemplates'
import type { PanelTemplate } from '../types'

export default function Sidebar() {
  // 订阅 store
  const panels = useAppStore(s => s.panels)
  const activePanelId = useAppStore(s => s.activePanelId)
  const setActivePanel = useAppStore(s => s.setActivePanel)
  const addPanel = useAppStore(s => s.addPanel)
  const deletePanel = useAppStore(s => s.deletePanel)
  const renamePanel = useAppStore(s => s.renamePanel)
  const addPanelFromTemplate = useAppStore(s => s.addPanelFromTemplate)
  const autoLayoutPanel = useAppStore(s => s.autoLayoutPanel)
  const sidebarCollapsed = useAppStore(s => s.sidebarCollapsed)
  const toggleSidebar = useAppStore(s => s.toggleSidebar)

  // 模板 popover 状态
  const [templatePopoverOpen, setTemplatePopoverOpen] = useState(false)
  const [templates, setTemplates] = useState<PanelTemplate[]>([])

  useEffect(() => {
    if (templatePopoverOpen) {
      getBuiltinPanelTemplates().then(setTemplates).catch(() => setTemplates([]))
    }
  }, [templatePopoverOpen])

  const handleTemplateClick = (templateId: string) => {
    addPanelFromTemplate(templateId)
    setTemplatePopoverOpen(false)
  }

  const handleAutoLayout = () => {
    autoLayoutPanel()
  }

  // 折叠状态下不显示面板列表和 footer 文字，只显示图标条
  if (sidebarCollapsed) {
    return (
      <aside className="panel-sidebar panel-sidebar--collapsed">
        <div className="panel-sidebar__header">
          <button
            className="panel-sidebar__collapse-btn"
            onClick={toggleSidebar}
            title="展开侧边栏"
          >
            <PanelLeftOpen size={16} />
          </button>
        </div>
        {/* 折叠状态下只显示新建按钮图标 */}
        <div className="panel-sidebar__footer">
          <button
            className="panel-sidebar__footer-btn"
            onClick={() => addPanel('新面板').catch(console.error)}
            title="新建面板"
          >
            <Plus size={14} />
          </button>
        </div>
      </aside>
    )
  }

  return (
    <aside className="panel-sidebar">
      {/* header 区域：标题 + 折叠按钮 */}
      <div className="panel-sidebar__header">
        <span className="panel-sidebar__title">面板库</span>
        <button
          className="panel-sidebar__collapse-btn"
          onClick={toggleSidebar}
          title="折叠侧边栏"
        >
          <PanelLeftClose size={16} />
        </button>
      </div>

      {/* panel-list 区域：面板列表 */}
      <div className="panel-sidebar__panel-list">
        {panels.map(panel => (
          <div
            key={panel.id}
            className={`panel-sidebar__panel-item ${panel.id === activePanelId ? 'panel-sidebar__panel-item--active' : ''}`}
            onClick={() => setActivePanel(panel.id)}
            onContextMenu={(e) => {
              e.preventDefault()
              const items: Array<{ label: string; onClick: () => void | Promise<void> }> = [
                { label: '重命名', onClick: () => {
                  const newName = window.prompt('新名称', panel.name)
                  if (newName && newName.trim()) renamePanel(panel.id, newName.trim())
                }},
                { label: '删除', onClick: () => deletePanel(panel.id) },
                { label: '复制', onClick: () => addPanel(`${panel.name} 副本`) },
              ]
              // L1 修复（v7）：panel.settings 是必需字段，不用可选链
              if (panel.settings.url) {
                items.push({
                  label: '转换为网页组件',
                  onClick: () => useAppStore.getState().convertTabToWidget(panel.id).catch(err => window.alert((err as Error).message)),
                })
              }
              showContextMenu(e, items)
            }}
          >
            <span className="panel-sidebar__panel-name">{panel.name}</span>
          </div>
        ))}
      </div>

      {/* footer 区域：新建/模板/自动布局按钮 */}
      <div className="panel-sidebar__footer">
        <button
          className="panel-sidebar__footer-btn"
          onClick={() => addPanel('新面板').catch(console.error)}
        >
          <Plus size={14} /> 新建面板
        </button>
        {/* S15 修复：从 UnifiedToolbar 迁移的模板按钮 */}
        <button
          className="panel-sidebar__footer-btn"
          onClick={() => setTemplatePopoverOpen(!templatePopoverOpen)}
          title="从模板创建面板"
        >
          <LayoutGrid size={14} /> 模板
        </button>
        {/* S15 修复：从 UnifiedToolbar 迁移的自动布局按钮 */}
        <button
          className="panel-sidebar__footer-btn"
          onClick={handleAutoLayout}
          title="自动布局所有面板"
        >
          <Sparkles size={14} /> 自动布局
        </button>
        {templatePopoverOpen && (
          <div className="panel-sidebar__template-popover">
            {templates.map(t => (
              <div
                key={t.id}
                className="panel-sidebar__template-item"
                onClick={() => handleTemplateClick(t.id)}
              >
                {t.name}
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  )
}
```

### 2.3 移除 UnifiedToolbar 面板菜单

**文件**：`client/desktop/src/components/UnifiedToolbar.tsx`（修改）

**修改点**：
- 移除面板菜单按钮（L278-L286）
- 移除面板菜单 Popover（L490-L566）
- 移除 `panelMenuOpen` 状态和相关逻辑
- 移除 `panelBtnRef`
- 保留其他工具栏功能（画布模式、undo/redo、添加组件、缩放等）

**L2 修复：CATEGORY_LABELS 补充 'web' 标签**：

当前 `CATEGORY_LABELS`（L14-L23）缺少 `'web'` 分类，会导致"添加组件"菜单中网页组件显示在"基础组件"分类下（因为 `widgetDefinitionMap.get(config.widgetType)?.category ?? 'basic'` 回退到 'basic'）。必须补充：

```typescript
// UnifiedToolbar.tsx L14-L23 修改
const CATEGORY_LABELS: Record<string, string> = {
  basic: '基础组件',
  work: '时间与任务',
  life: '生活与健康',
  media: '媒体与阅读',
  stats: '统计面板',
  ai: 'AI 助手',
  study: '学习工具',
  fun: '趣味',
  web: '浏览器',  // L2 修复：新增 'web' 分类标签
}
```

同时，`CATEGORY_ORDER`（L13）也需要追加 `'web'`：
```typescript
// UnifiedToolbar.tsx L13 修改
const CATEGORY_ORDER: WidgetCategory[] = ['basic', 'work', 'life', 'media', 'stats', 'ai', 'study', 'fun', 'web']
```

**理由**：面板管理职责完全转移给 TabBar + Sidebar，避免三处入口管理面板（违反"不喧宾夺主"原则）。

### 2.4 系统托盘 + 菜单栏

**文件**：`client/desktop/electron/main/index.ts`（修改）

**系统托盘**：
- 使用 `Tray` 类创建托盘图标
- 托盘菜单：显示窗口/隐藏窗口/退出
- 单击托盘图标切换窗口显示
- **关闭窗口时最小化到托盘**（拦截 `mainWindow.on('close')`，而非退出）

**菜单栏**：
- 使用 `Menu.buildFromTemplate` 创建应用菜单
- 菜单项：文件（新建面板/导出/导入/退出）、编辑（撤销/重做/复制/粘贴）、视图（缩放/全屏/开发者工具/切换侧边栏）、面板（新建/管理）、帮助（关于/快捷键）
- 通过统一 IPC 频道 `menu:action` 发送菜单事件到渲染进程

**托盘图标资源**（S14 修复（v7）：不依赖外部 PNG 文件，使用 Electron 内置 API 创建图标）：
- **方案 A（推荐）**：使用 `nativeImage.createEmpty()` 创建空白图标作为托盘图标（无需任何资源文件，Electron 内置 API）
- **方案 B（可选）**：若需可见图标，提供 16x16 PNG 文件 `build/tray-icon.png`（用 sharp 或 canvas 库从 SVG 生成，不依赖外部下载资源）
- **createTray 实现兼容两种方案**：先尝试加载 `build/tray-icon.png`，失败则回退到 `nativeImage.createEmpty()`

```typescript
// S14 修复（v7）：createTray 兼容两种图标方案
function createTray(win: BrowserWindow): void {
  // 方案 A：尝试加载 PNG 文件
  let icon: Electron.NativeImage
  try {
    icon = nativeImage.createFromPath(join(__dirname, '../../build/tray-icon.png'))
    if (icon.isEmpty()) {
      // 方案 B：文件不存在或加载失败，回退到空白图标
      icon = nativeImage.createEmpty()
    }
  } catch {
    icon = nativeImage.createEmpty()
  }
  tray = new Tray(icon)
  // ... 其余托盘逻辑
}
```

**关键代码结构**（S13 修复（v7）：合并 import，不重复声明；S12 修复（v7）：createWindow 保留所有现有逻辑）：
```typescript
// main/index.ts 顶部 import 合并（S13 修复（v7）：与现有 import 合并，不重复声明）
// 现有 import（保留）：app, shell, BrowserWindow, optimizer, electronApp
// 新增 import：Tray, Menu, nativeImage, ipcMain, session, MenuItemConstructorOptions
import { app, shell, BrowserWindow, Tray, Menu, nativeImage, ipcMain, session, MenuItemConstructorOptions } from 'electron'
// 现有其他 import 保留：optimizer, electronApp, join 等

// F1 修复：mainWindow 提升为模块级变量，确保 web-contents-created 回调可访问
let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false  // 区分"退出"和"最小化到托盘"

function createTray(win: BrowserWindow): void {
  // S14 修复（v7）：见上方"托盘图标资源"章节，兼容 PNG 文件和 createEmpty 两种方案
  let icon: Electron.NativeImage
  try {
    icon = nativeImage.createFromPath(join(__dirname, '../../build/tray-icon.png'))
    if (icon.isEmpty()) icon = nativeImage.createEmpty()
  } catch {
    icon = nativeImage.createEmpty()
  }
  tray = new Tray(icon)
  tray.setToolTip('Living Dashboard')
  tray.on('click', () => {
    if (win.isVisible()) win.hide()
    else win.show()
  })
  const contextMenu = Menu.buildFromTemplate([
    { label: '显示窗口', click: () => win.show() },
    { label: '隐藏窗口', click: () => win.hide() },
    { type: 'separator' },
    { label: '退出', click: () => { isQuitting = true; app.quit() } },
  ])
  tray.setContextMenu(contextMenu)
}

function createAppMenu(win: BrowserWindow): void {
  const template: MenuItemConstructorOptions[] = [
    { label: '文件', submenu: [
      { label: '新建面板', accelerator: 'CmdOrCtrl+N', click: () => win.webContents.send('menu:action', 'new-panel') },
      { label: '导出', accelerator: 'CmdOrCtrl+E', click: () => win.webContents.send('menu:action', 'export') },
      { label: '导入', accelerator: 'CmdOrCtrl+I', click: () => win.webContents.send('menu:action', 'import') },
      { type: 'separator' },
      { label: '退出', accelerator: 'CmdOrCtrl+Q', click: () => { isQuitting = true; app.quit() } },
    ]},
    { label: '编辑', submenu: [
      { label: '撤销', role: 'undo' },
      { label: '重做', role: 'redo' },
      { type: 'separator' },
      { label: '复制', role: 'copy' },
      { label: '粘贴', role: 'paste' },
    ]},
    { label: '视图', submenu: [
      { label: '放大', role: 'zoomIn' },
      { label: '缩小', role: 'zoomOut' },
      { label: '重置缩放', role: 'resetZoom' },
      { type: 'separator' },
      { label: '全屏', role: 'togglefullscreen' },
      { label: '开发者工具', role: 'toggleDevTools' },
      { type: 'separator' },
      { label: '切换侧边栏', accelerator: 'CmdOrCtrl+B', click: () => win.webContents.send('menu:action', 'toggle-sidebar') },
    ]},
    // S8 修复（v8）：新增"面板"菜单（在"视图"和"帮助"之间），与 2.4 节菜单项描述一致
    { label: '面板', submenu: [
      { label: '新建面板', accelerator: 'CmdOrCtrl+Shift+N', click: () => win.webContents.send('menu:action', 'new-panel') },
      { label: '管理面板', click: () => win.webContents.send('menu:action', 'manage-panels') },
    ]},
    { label: '帮助', submenu: [
      { label: '关于', click: () => win.webContents.send('menu:action', 'about') },
      { label: '快捷键', accelerator: 'CmdOrCtrl+/', click: () => win.webContents.send('menu:action', 'shortcuts') },
    ]},
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// S11 修复：createWindow 中赋值模块级 mainWindow，并注册 close 拦截
// S12 修复（v7）：在现有 createWindow 基础上添加 mainWindow = 赋值、close 和 closed 事件监听，
//   保留所有现有逻辑（ready-to-show、加载 dev server URL、setWindowOpenHandler、webPreferences 等）
// F1 修复（v8）：给出完整的 createWindow 函数代码，对照真实代码 main/index.ts L8-L49，
//   包含所有现有逻辑 + 新增逻辑（mainWindow 模块级赋值、webviewTag: true、close/closed 事件监听），
//   禁止用注释省略任何现有逻辑
function createWindow(): void {
  // F1 修复（v8）：完整 BrowserWindow 配置（对照 main/index.ts L9-L23，所有字段保留）
  //   修改点：const mainWindow → mainWindow（赋值给模块级变量，供 createTray/createAppMenu 使用）
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 768,
    show: false,
    autoHideMenuBar: true,
    title: 'Living Dashboard',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,  // 新增：启用 <webview> 标签（见 3.1 节）
    },
  })

  // F1 修复（v8）：保留现有的 ready-to-show 事件监听（对照 main/index.ts L25-L27）
  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // F1 修复（v8）：保留现有的 dev server URL 加载逻辑（对照 main/index.ts L29-L42）
  // 开发环境：加载 Vite dev server URL（支持 HMR）
  // 生产环境：加载本地打包后的 HTML 文件
  // 注：ELECTRON_RENDERER_URL 只在 electron-vite dev 模式下设置，是 dev 模式的可靠标志
  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (rendererUrl) {
    console.log('[Main] Loading dev server URL:', rendererUrl)
    mainWindow?.loadURL(rendererUrl)
    mainWindow?.webContents.openDevTools()
  } else {
    const filePath = join(__dirname, '../renderer/index.html')
    console.log('[Main] Loading file:', filePath)
    mainWindow?.loadFile(filePath)
  }

  // F1 修复（v8）：保留现有的 setWindowOpenHandler（对照 main/index.ts L45-L48）
  // 外部链接用系统浏览器打开
  mainWindow?.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // S11/S12 修复（v7）：新增 close 拦截（最小化到托盘），保留在现有 createWindow 中
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// S11 修复：在 app.whenReady() 中显式调用 createTray/createAppMenu
app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.allmylife.event')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))
  createWindow()
  // 新增：创建托盘和菜单（mainWindow 已提升为模块级变量）
  if (mainWindow) {
    createTray(mainWindow)
    createAppMenu(mainWindow)
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// S16 修复（v7）：window-all-closed 在 createTray 失败（tray 为 null）时回退到默认行为（退出）
//   避免 createTray 失败时窗口关闭后应用无法退出，导致进程残留
app.on('window-all-closed', () => {
  // S16 修复（v7）：tray 为 null 时（createTray 失败或未调用），回退到默认退出行为
  // macOS 默认不退出（Cmd+Q 退出），其他平台退出
  if (!tray || process.platform !== 'darwin') {
    app.quit()
  }
  // tray 存在且非 macOS：不退出，由托盘控制退出（最小化到托盘）
  // tray 存在且 macOS：不退出（macOS 默认行为）
})
```

**Preload 修改**（`client/desktop/electron/preload/index.ts`，S1/M6/M7 修复：在 contextIsolated 分支中明确暴露 contextMenuApi 和 webviewApi，else 分支添加注释说明仅作兜底）：
```typescript
import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    // 新增：菜单 API
    contextBridge.exposeInMainWorld('menuApi', {
      onMenuAction: (callback: (action: string) => void): (() => void) => {
        const handler = (_: unknown, action: string): void => callback(action)
        ipcRenderer.on('menu:action', handler)
        return () => ipcRenderer.removeListener('menu:action', handler)
      }
    })
    // 新增：Cookie API（供 browserToolBridge 使用）
    contextBridge.exposeInMainWorld('cookieApi', {
      get: (url: string) => ipcRenderer.invoke('cookie:get', url),
      set: (cookie: Electron.CookiesSetDetails) => ipcRenderer.invoke('cookie:set', cookie),
    })
    // M7 修复：contextMenuApi 在 contextIsolated 分支中明确暴露（F2 修复要求 renderer 通过 contextBridge 调用主进程）
    contextBridge.exposeInMainWorld('contextMenuApi', {
      show: (items: Array<{ label: string; enabled?: boolean }>): Promise<number> =>
        ipcRenderer.invoke('context-menu:show', items),
    })
    // S1 修复：webviewApi 暴露 webview:open-url 监听器，返回清理函数（与 menuApi 同模式）
    // 原代码用 window.electron?.ipcRenderer?.on() 返回 void 不是清理函数，导致内存泄漏
    contextBridge.exposeInMainWorld('webviewApi', {
      onOpenUrl: (callback: (url: string) => void): (() => void) => {
        const handler = (_: unknown, url: string): void => callback(url)
        ipcRenderer.on('webview:open-url', handler)
        return () => ipcRenderer.removeListener('webview:open-url', handler)
      }
    })
  } catch (error) {
    console.error(error)
  }
} else {
  // M6 修复：contextIsolation 始终为 true（见 1.4 约束条件），else 分支仅作兜底，新增 API 仅在 contextIsolated 分支暴露
  // @ts-expect-error contextIsolation 始终为 true，else 分支仅作兜底
  window.electron = electronAPI
  // 注：contextIsolation: true 时此分支不执行，menuApi/cookieApi/contextMenuApi/webviewApi 仅在 contextIsolated 分支暴露
}
```

**主进程 Cookie IPC**（main/index.ts，S13 修复（v7）：session 已在顶部 import 中合并，无需重复 import）：
```typescript
// main/index.ts 中新增（session 已在顶部 import，见上方"关键代码结构"）
ipcMain.handle('cookie:get', async (_, url: string) => {
  return await session.defaultSession.cookies.get({ url })
})

ipcMain.handle('cookie:set', async (_, cookie: Electron.CookiesSetDetails) => {
  return await session.defaultSession.cookies.set(cookie)
})
```

**App.tsx 菜单监听**（L3 修复：`addPanel` 返回 Promise，未 await 会导致错误未捕获，改为 `void ... .catch(console.error)`）：
```typescript
useEffect(() => {
  const cleanup = window.menuApi?.onMenuAction((action: string) => {
    switch (action) {
      // L3 修复：addPanel 返回 Promise，用 void + catch 捕获错误
      case 'new-panel': void useAppStore.getState().addPanel('新面板').catch(console.error); break
      case 'toggle-sidebar': useAppStore.getState().toggleSidebar(); break
      case 'export': /* 触发导出 */ break
      case 'import': /* 触发导入 */ break
      // ... 其他
    }
  })
  return cleanup
}, [])
```

### 2.5 App.tsx 布局调整

**文件**：`client/desktop/src/App.tsx`（修改）

**布局变更**：
```tsx
// 当前布局（App.tsx L246-L255）
<Workspace />
<UnifiedToolbar />
{appMode === 'desktop' && <DesktopChatBar />}
<GlobalQuickInput />
{showSettings && <SettingsPanel />}
{showSearch && <WidgetSearch />}

// 新布局
<div className="app-root">
  <TabBar />                    {/* 顶部标签栏（含 Omnibox） */}
  <div className="app-body">    {/* 主区域 */}
    <Sidebar />                 {/* 左侧侧边栏（可折叠） */}
    <div className="app-main">  {/* 画布区域 */}
      <Workspace />
      <UnifiedToolbar />
      {appMode === 'desktop' && <DesktopChatBar />}
      <GlobalQuickInput />
      {showSettings && <SettingsPanel />}
      {showSearch && <WidgetSearch />}
    </div>
  </div>
</div>
```

**CSS 修改**（index.css，S3 修复：明确说明是**修改现有 .app-root**（index.css L181-L187），不是追加新规则。给出完整的修改后 CSS；S10 修复（v7）：追加 WebviewWidget/TabBar/Omnibox 的 CSS 样式定义）：
```css
/* 修改现有 .app-root（index.css L181-L187） */
.app-root {
  display: flex;
  flex-direction: column;  /* 新增：改为纵向 flex */
  height: 100vh;
  width: 100vw;            /* 保留 */
  overflow: hidden;
  background: var(--bg-canvas);  /* 保留 */
}
/* 以下为新增规则 */
.app-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}
.app-main {
  flex: 1;
  position: relative;
  overflow: hidden;
}

/* ============ S10 修复（v7）：WebviewWidget 样式 ============ */
.webview-widget {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-surface);
  border-radius: 8px;
  overflow: hidden;
}
.webview-widget__toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  background: var(--toolbar-bg, var(--bg-surface));
  border-bottom: 1px solid var(--border-default);
}
.webview-widget__url-input {
  flex: 1;
  padding: 4px 8px;
  border: 1px solid var(--border-default);
  border-radius: 4px;
  background: var(--bg-canvas);
  color: var(--text-primary);
  font-size: 12px;
}
.webview-widget__loading {
  font-size: 11px;
  color: var(--text-secondary);
}
.webview-widget__error {
  padding: 8px 12px;
  background: var(--color-error-bg, #fef2f2);
  color: var(--text-primary);
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.webview-widget__error-url {
  font-size: 11px;
  color: var(--text-secondary);
  word-break: break-all;
}
.webview-widget__content {
  flex: 1;
  position: relative;
  overflow: hidden;
}
.webview-widget__webview {
  width: 100%;
  height: 100%;
  border: none;
}
.webview-widget__placeholder {
  position: absolute;
  inset: 0;
  background: var(--bg-surface);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  font-size: 12px;
}

/* ============ S10 修复（v7）：TabBar 样式 ============ */
.tab-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  background: var(--toolbar-bg, var(--bg-surface));
  border-bottom: 1px solid var(--border-default);
  height: 40px;
}
.tab-bar__tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  overflow-x: auto;
  flex-shrink: 0;
}
.tab-bar__tab {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  min-width: 120px;
  max-width: 240px;
}
.tab-bar__tab:hover {
  background: var(--toolbar-hover-bg, var(--bg-hover));
}
.tab-bar__tab--active {
  background: var(--bg-active);
  border-bottom: 2px solid var(--color-primary);
}
.tab-bar__tab-title {
  flex: 1;
  font-size: 12px;
  color: var(--toolbar-text, var(--text-primary));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tab-bar__tab-close {
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 2px;
  opacity: 0;
  font-size: 14px;
  cursor: pointer;
}
.tab-bar__tab:hover .tab-bar__tab-close {
  opacity: 1;
}
.tab-bar__tab-close:hover {
  background: var(--bg-hover);
}
.tab-bar__new-btn {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  cursor: pointer;
  color: var(--toolbar-text, var(--text-primary));
  font-size: 16px;
  background: none;
  border: none;
}
.tab-bar__new-btn:hover {
  background: var(--toolbar-hover-bg, var(--bg-hover));
}
.tab-bar__omnibox {
  flex: 1;
}
.tab-bar__tab-rename-input {
  flex: 1;
  padding: 2px 4px;
  border: 1px solid var(--color-primary);
  border-radius: 2px;
  background: var(--bg-canvas);
  color: var(--text-primary);
  font-size: 12px;
}

/* ============ S10 修复（v7）：Omnibox 样式 ============ */
.omnibox {
  position: relative;
  max-width: 600px;
  margin: 0 auto;
}
.omnibox__input {
  width: 100%;
  padding: 6px 12px;
  border: 1px solid var(--border-default);
  border-radius: 16px;
  background: var(--bg-canvas);
  color: var(--text-primary);
  font-size: 13px;
}
.omnibox__input:focus {
  outline: none;
  border-color: var(--color-primary);
}
.omnibox__suggestions {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  margin-top: 4px;
  background: var(--bg-elevated, var(--bg-surface));
  border: 1px solid var(--border-default);
  border-radius: 4px;
  box-shadow: var(--shadow-md, 0 4px 12px rgba(0,0,0,0.15));
  max-height: 200px;
  overflow-y: auto;
  z-index: 1000;
}
.omnibox__suggestion {
  padding: 6px 12px;
  cursor: pointer;
  font-size: 12px;
  color: var(--text-primary);
}
.omnibox__suggestion:hover {
  background: var(--bg-hover);
}

/* ============ S10 修复（v7）：Sidebar 补充样式（折叠按钮/标题/模板 popover） ============ */
.panel-sidebar__title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}
.panel-sidebar__collapse-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
}
.panel-sidebar__collapse-btn:hover {
  background: var(--bg-hover);
}
.panel-sidebar__panel-name {
  font-size: 13px;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.panel-sidebar__template-popover {
  position: absolute;
  bottom: 100%;
  left: 0;
  right: 0;
  background: var(--bg-elevated, var(--bg-surface));
  border: 1px solid var(--border-default);
  border-radius: 4px;
  box-shadow: var(--shadow-md, 0 4px 12px rgba(0,0,0,0.15));
  max-height: 200px;
  overflow-y: auto;
  z-index: 1000;
}
.panel-sidebar__template-item {
  padding: 6px 12px;
  cursor: pointer;
  font-size: 12px;
  color: var(--text-primary);
}
.panel-sidebar__template-item:hover {
  background: var(--bg-hover);
}
```

---

## 三、Phase 2 核心：浏览器引擎集成

### 3.1 Electron webview 启用

**文件**：`client/desktop/electron/main/index.ts`（修改）

**修改点**：
```typescript
// S11 修复：明确完整 webPreferences 配置，保持现有值，新增 webviewTag: true
webPreferences: {
  preload: join(__dirname, '../preload/index.mjs'),
  sandbox: false,           // 保持现有值（preload 需要 Node.js API）
  contextIsolation: true,   // 保持现有值
  nodeIntegration: false,   // 保持现有值
  webviewTag: true,         // 新增：启用 <webview> 标签
}
```

**S11 修复：webview 独立 partition 隔离 cookie**：
每个 webview 设置独立 partition（`persist:webview-${widgetId}`），隔离 cookie/storage，避免不同网页组件之间共享登录态：
```tsx
<webview
  partition={`persist:webview-${widgetId}`}
  webpreferences="contextIsolation=yes,nodeIntegration=no"
  ...
/>
```
- `persist:` 前缀表示持久化存储（重启后保留），不带 `persist:` 前缀则为内存存储（重启后丢失）
- 每个 widgetId 对应独立 partition，互不影响

**webview 安全策略**：
- webview 默认 `contextIsolation=yes, nodeIntegration=no`（在 webview 标签属性中指定）
- 禁止 webview 访问 file:// 协议（除本地资源）
- webview 内的 `window.open` 通过 `setWindowOpenHandler` 拦截，在主窗口新标签页打开

```typescript
// F1 修复：使用模块级 mainWindow（在 2.4 节已声明 let mainWindow: BrowserWindow | null = null）
app.on('web-contents-created', (_, contents) => {
  if (contents.getType() === 'webview') {
    contents.setWindowOpenHandler((details) => {
      mainWindow?.webContents.send('webview:open-url', details.url)
      return { action: 'deny' }
    })
  }
})
```

**S11 修复：renderer 端必须监听 `webview:open-url` IPC**，否则主进程发送的事件无人接收，`window.open` 打开的 URL 会丢失。在 App.tsx 中添加监听器：

**S1 修复**：原代码用 `window.electron?.ipcRenderer?.on('webview:open-url', ...)` 返回 void 不是清理函数，导致 useEffect 无法清理监听器，每次组件重渲染都会新增一个监听器，造成内存泄漏。改用 preload 暴露的 `window.webviewApi?.onOpenUrl`（返回清理函数，与 `menuApi.onMenuAction` 同模式）。

```typescript
// App.tsx 中新增 useEffect 监听 webview:open-url
import { useEffect } from 'react'
import { useAppStore } from './stores/useAppStore'

useEffect(() => {
  // S1 修复：改用 window.webviewApi?.onOpenUrl（返回清理函数），原 window.electron?.ipcRenderer?.on() 返回 void 导致内存泄漏
  // S11 修复：监听 webview 内 window.open 触发的 URL，在当前活跃面板创建网页组件
  return window.webviewApi?.onOpenUrl((url: string) => {
    useAppStore.getState().addWidget('webPage', {
      panelId: useAppStore.getState().activePanelId || undefined,
      position: { x: 100, y: 100, w: 480, h: 600 },
      initialState: { url, title: url, schemaVersion: 1 },
    })
  })
}, [])
```

**注意**：`window.webviewApi` 由 preload 中的 `contextBridge.exposeInMainWorld('webviewApi', ...)` 暴露（见 2.4 节 preload 修改），其 `onOpenUrl` 方法返回清理函数。

### 3.2 WebviewWidget 组件（网页组件）

**文件**：
- `client/desktop/src/components/widgets/WebviewWidget.tsx`（新建）
- `client/desktop/src/registry/widgetDefinitions.ts`（修改，添加 webPage 定义）
- `client/desktop/src/registry/builtIn.tsx`（修改，添加 WebviewWidget 配置）

**WebviewWidgetState 类型**（M5 修复（v7）：明确添加到 `client/desktop/src/types/index.ts`，与现有 widget state 类型同位置，便于 `useAppStore.ts`/`widgetDefinitions.ts`/`builtIn.tsx` 统一 import）：
```typescript
// client/desktop/src/types/index.ts 新增
export interface WebviewWidgetState {
  url: string                    // 当前 URL
  title: string                  // 页面标题（自动从 webview 获取）
  schemaVersion: 1
}
```

**注意**：
- 不在 state 中维护 `history`/`historyIndex`/`canGoBack`/`canGoForward`/`isLoading` — 这些用组件局部 state（不持久化），避免频繁 onUpdateState
- 历史导航用 webview 内置的 `canGoBack()`/`canGoForward()`/`goBack()`/`goForward()`
- 只有 `url` 和 `title` 需要持久化（用户重启后恢复）
- L3 修复：移除了未使用的 `zoomLevel` 字段（如需缩放，用 webview 内置 `setZoomLevel`，不持久化）

**WebviewWidget 组件结构**：
```tsx
// S7 修复：补全所有 import（useRef/useState/useEffect、browserToolBridge、useAppStore、WidgetProps、normalizeUrl、showContextMenu）
import { useRef, useState, useEffect } from 'react'
import { browserToolBridge } from '../utils/browserToolBridge'
import { useAppStore } from '../stores/useAppStore'
import type { WidgetProps } from '../types'
import { normalizeUrl } from '../utils/url'
import { showContextMenu } from '../utils/contextMenu'

export default function WebviewWidget({ widgetId, panelId, state, onUpdateState, onEditingChange }: WidgetProps) {
  const webviewRef = useRef<Electron.WebviewTag>(null)
  // F2 修复：用 useRef 缓存 onUpdateState，避免内联箭头函数每次渲染新引用导致 useEffect 反复注销/重注册
  const onUpdateStateRef = useRef(onUpdateState)
  onUpdateStateRef.current = onUpdateState
  // L3 修复：state.url 强制类型转换不安全，改为 typeof 守卫
  const initialUrl = typeof state.url === 'string' ? state.url : ''
  const [localUrl, setLocalUrl] = useState(initialUrl)
  const [isLoading, setIsLoading] = useState(false)
  const [canGoBack, setCanGoBack] = useState(false)
  const [canGoForward, setCanGoForward] = useState(false)
  // S15 修复：错误状态 UI
  const [error, setError] = useState<{ message: string; url: string } | null>(null)
  const updateTimerRef = useRef<ReturnType<typeof setTimeout>>()
  // S5 修复：pendingRef 保存待提交的 state，trailing 模式不丢弃更新
  const pendingRef = useRef<Record<string, unknown>>()
  // S15 修复：加载超时计时器
  const loadTimeoutRef = useRef<ReturnType<typeof setTimeout>>()

  // S5 修复：节流更新 state 改为 trailing 模式（500ms 内的多次更新合并，最后一次必定刷新）
  // F2 修复：使用 onUpdateStateRef.current 而非 onUpdateState，避免闭包捕获旧引用
  const throttledUpdateState = (partial: Record<string, unknown>) => {
    pendingRef.current = { ...pendingRef.current, ...partial }
    if (updateTimerRef.current) return
    updateTimerRef.current = setTimeout(() => {
      if (pendingRef.current) {
        onUpdateStateRef.current(pendingRef.current)
        pendingRef.current = undefined
      }
      updateTimerRef.current = undefined
    }, 500)
  }

  // 导航
  const navigate = (url: string) => {
    const normalized = normalizeUrl(url)
    if (webviewRef.current) {
      webviewRef.current.loadURL(normalized)
      setLocalUrl(normalized)
    }
  }
  const goBack = () => webviewRef.current?.goBack()
  const goForward = () => webviewRef.current?.goForward()
  const reload = () => {
    setError(null)
    webviewRef.current?.reload()
  }

  // F2 修复：拆分为三个独立 useEffect，避免 onUpdateState 变化导致反复注销/重注册
  // useEffect 1：注册 webview 到 browserToolBridge + dom-ready 首次导航（只依赖 widgetId）
  // F3 修复（v8）：在 useEffect 1 中监听 dom-ready 事件触发首次导航，
  //   解决 useEffect 2 在 webview 未就绪时跳过导航导致 webview 永远空白的问题
  // S1 修复（v8）：useEffect 1 只负责注册/注销 webview + dom-ready 首次导航，
  //   不在 cleanup 中提交 state 或清理 timer（state 提交和 timer 清理由 useEffect 3 负责，避免重复）
  useEffect(() => {
    const webview = webviewRef.current
    if (!webview) return
    browserToolBridge.registerWebview(widgetId, webview)
    // F3 修复（v8）：dom-ready 时触发首次导航，确保 webview 不会永远空白
    const onDomReady = () => {
      const url = typeof state.url === 'string' ? state.url : ''
      if (url) {
        try { if (webview.getURL() !== url) webview.loadURL(url) } catch { webview.loadURL(url) }
      }
    }
    webview.addEventListener('dom-ready', onDomReady, { once: true })
    return () => {
      webview.removeEventListener('dom-ready', onDomReady)
      browserToolBridge.unregisterWebview(widgetId)
    }
  }, [widgetId])

  // F2 修复：useEffect 2：URL 变化时导航（单独的 useEffect，只依赖 state.url）
  // S1 修复：删除 <webview src> 属性后，完全由此 useEffect 控制 loadURL
  // S18 修复（v7）：用 try/catch 包裹 getURL()，避免 webview 未就绪时抛错；只在 URL 不同时导航，避免频繁 loadURL
  // F3 修复（v8）：catch 块保持 try/catch 跳过未就绪导航，因为 useEffect 1 的 dom-ready 会处理首次导航
  useEffect(() => {
    const webview = webviewRef.current
    if (!webview) return
    const url = typeof state.url === 'string' ? state.url : ''
    if (!url) return
    // S18 修复（v7）：检查 webview 是否正在加载/已加载相同 URL，避免频繁导航
    try {
      if (webview.getURL() !== url) {
        webview.loadURL(url)
      }
    } catch {
      // F3 修复（v8）：webview 未就绪（getURL 抛错），忽略本次导航，由 useEffect 1 的 dom-ready 处理首次导航
    }
  }, [state.url])

  // S11 修复（v7）：localUrl 同步 state.url，避免 prop 变化时输入框不更新
  // 场景：AI 调用 browser_navigate 改变了 state.url，但 localUrl 仍是旧值，导致输入框显示旧 URL
  useEffect(() => {
    if (typeof state.url === 'string') setLocalUrl(state.url)
  }, [state.url])

  // F2 修复：useEffect 3：webview 事件监听（只依赖 widgetId，使用 onUpdateStateRef.current）
  // F2 修复（v7）：所有事件监听器改为 (e: unknown) => void，内部用 `as` 断言为 S17 声明的事件类型
  //   原因：WebviewTag.addEventListener 签名是 (event: string, listener: (e: unknown) => void)，
  //   传入类型化监听器 (e: Electron.DidNavigateEvent) => void 会因逆变导致类型不兼容
  useEffect(() => {
    const webview = webviewRef.current
    if (!webview) return

    const onDidNavigate = (e: unknown) => {
      const event = e as Electron.DidNavigateEvent
      setLocalUrl(event.url)
      setCanGoBack(webview.canGoBack())
      setCanGoForward(webview.canGoForward())
      throttledUpdateState({ url: event.url })
    }
    const onDidNavigateInPage = (e: unknown) => {
      const event = e as Electron.DidNavigateInPageEvent
      setLocalUrl(event.url)
      setCanGoBack(webview.canGoBack())
      setCanGoForward(webview.canGoForward())
      throttledUpdateState({ url: event.url })
    }
    const onTitleChange = (e: unknown) => {
      const event = e as Electron.PageTitleUpdatedEvent
      throttledUpdateState({ title: event.title })
    }
    // S15 修复：load-commit 时启动 10s 加载超时计时器
    // M3 修复：只在主框架的 load-commit 上启动超时，子框架（iframe/ad）的 load-commit 不重置主框架超时计时器
    const onLoadCommit = (e: unknown) => {
      const event = e as Electron.LoadCommitEvent
      if (!event.isMainFrame) return  // 只处理主框架
      setIsLoading(true)
      setError(null)
      if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current)
      loadTimeoutRef.current = setTimeout(() => {
        setIsLoading(false)
        setError({ message: '加载超时（10s）', url: '' })
      }, 10000)
    }
    // S15 修复：did-finish-load 时清除超时计时器
    const onDidFinishLoad = () => {
      setIsLoading(false)
      if (loadTimeoutRef.current) {
        clearTimeout(loadTimeoutRef.current)
        loadTimeoutRef.current = undefined
      }
    }
    // S15 修复：did-fail-load 事件监听器，显示错误页面
    const onDidFailLoad = (e: unknown) => {
      const event = e as Electron.DidFailLoadEvent
      setIsLoading(false)
      if (loadTimeoutRef.current) {
        clearTimeout(loadTimeoutRef.current)
        loadTimeoutRef.current = undefined
      }
      setError({ message: event.errorDescription || '加载失败', url: event.url })
    }

    webview.addEventListener('did-navigate', onDidNavigate)
    webview.addEventListener('did-navigate-in-page', onDidNavigateInPage)
    webview.addEventListener('page-title-updated', onTitleChange)
    webview.addEventListener('load-commit', onLoadCommit)
    webview.addEventListener('did-finish-load', onDidFinishLoad)
    webview.addEventListener('did-fail-load', onDidFailLoad)

    return () => {
      webview.removeEventListener('did-navigate', onDidNavigate)
      webview.removeEventListener('did-navigate-in-page', onDidNavigateInPage)
      webview.removeEventListener('page-title-updated', onTitleChange)
      webview.removeEventListener('load-commit', onLoadCommit)
      webview.removeEventListener('did-finish-load', onDidFinishLoad)
      webview.removeEventListener('did-fail-load', onDidFailLoad)
      // S3 修复：cleanup 中清除 loadTimeoutRef，避免组件卸载后计时器仍触发 setState
      if (loadTimeoutRef.current) {
        clearTimeout(loadTimeoutRef.current)
        loadTimeoutRef.current = undefined
      }
      // S1 修复（v8）：state 提交（pendingRef + updateTimerRef）只放在 useEffect 3 的 cleanup 中
      //   （useEffect 1 的 cleanup 不再提交 state 或清理 timer，避免重复提交）
      if (updateTimerRef.current) {
        clearTimeout(updateTimerRef.current)
        if (pendingRef.current) onUpdateStateRef.current(pendingRef.current)
      }
      // S1 修复（v8）：不再在此 cleanup 中调用 browserToolBridge.unregisterWebview，
      //   注销由 useEffect 1 的 cleanup 统一负责，避免重复注销
    }
  }, [widgetId])

  // F6 修复：监听 activePanelId 变化，非活跃面板的 webview 暂停网络活动
  const activePanelId = useAppStore(s => s.activePanelId)
  const isActive = activePanelId === panelId

  useEffect(() => {
    const webview = webviewRef.current
    if (!webview) return
    if (isActive) {
      // 活跃面板：恢复渲染
      webview.style.visibility = 'visible'
    } else {
      // 非活跃面板：暂停网络请求（stop() 停止当前加载和网络活动）
      webview.stop()
      // 隐藏 webview（visibility:hidden 不影响画布坐标，与 display:none 不同）
      webview.style.visibility = 'hidden'
    }
  }, [isActive])

  // S12 修复：合并后的完整 return JSX（统一 3.2 节与 F6 修复节，含 toolbar + error + content(webview + placeholder)）
  // L3 修复：state.url 用 typeof 守卫，不强制 as string
  // S1 修复：currentUrl 变量已删除（不再用于 webview src，URL 导航由 useEffect 2 控制）

  return (
    <div
      className="webview-widget"
      onMouseEnter={() => useAppStore.getState().setLastActiveWidget(widgetId)}
    >
      <div
        className="webview-widget__toolbar"
        data-widget-drag-handle
        onContextMenu={(e) => {
          e.preventDefault()
          showContextMenu(e, [
            {
              label: '在新标签页打开',
              // S13 修复：捕获 5-webview 限制错误，提示用户
              onClick: () => useAppStore.getState().convertWidgetToTab(widgetId).catch(err => window.alert((err as Error).message)),
            },
          ])
        }}
      >
        <button onClick={goBack} disabled={!canGoBack}>←</button>
        <button onClick={goForward} disabled={!canGoForward}>→</button>
        <button onClick={reload}>⟳</button>
        <input
          className="webview-widget__url-input"
          value={localUrl}
          onChange={(e) => setLocalUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && navigate(localUrl)}
          placeholder="输入 URL"
        />
        {isLoading && <span className="webview-widget__loading">加载中...</span>}
      </div>
      {/* S15 修复：错误状态 UI（错误消息 + 重试按钮） */}
      {error && (
        <div className="webview-widget__error">
          <p>{error.message}</p>
          {error.url && <p className="webview-widget__error-url">{error.url}</p>}
          <button onClick={reload}>重试</button>
        </div>
      )}
      {/* F6 修复：webview 包裹在 content div 中，非活跃时覆盖占位 div */}
      <div className="webview-widget__content" style={{ position: 'relative' }}>
        {/* S1 修复：删除 src 属性，完全由 useEffect 2 控制 loadURL，避免双重导航冲突 */}
        {/* S11 修复：添加 partition 属性，每个 webview 独立 partition 隔离 cookie */}
        <webview
          ref={webviewRef}
          className="webview-widget__webview"
          webpreferences="contextIsolation=yes,nodeIntegration=no"
          allowpopups
          partition={`persist:webview-${widgetId}`}
          style={{ visibility: isActive ? 'visible' : 'hidden' }}
        />
        {!isActive && (
          <div
            className="webview-widget__placeholder"
            style={{
              position: 'absolute',
              inset: 0,
              background: 'var(--bg-surface, #f5f5f5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 10,
            }}
          >
            <span>面板未活跃，渲染已暂停</span>
          </div>
        )}
      </div>
    </div>
  )
}

// M4 修复：normalizeUrl 已移到 utils/url.ts，此处不再定义
```

**utils/url.ts 新建**（M4 修复：共用 normalizeUrl；M5 修复：支持 localhost 和 IP 地址；**F1 修复：重写为 URL 构造 + try/catch 校验，明确禁止 javascript: 和 data: 协议，含空格一律视为非 URL**）：
```typescript
// client/desktop/src/utils/url.ts
// F1 修复：重写 normalizeUrl 和 isUrl，使用 URL 构造 + try/catch 校验
// 修复问题：
//   1. localhost 含空格被放行（原正则 /^localhost:\d+/ 不检查空格）
//   2. about:blank 等特殊协议被误判（原 isUrl 只认 http/https）
//   3. 注释与代码不一致
// 安全：明确禁止 javascript: 和 data: 协议（XSS 风险）

export function normalizeUrl(input: string): string {
  const t = input.trim()
  if (!t) return 'about:blank'
  // 已有协议的（含 :// 或 about:）
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(t) && !t.includes(' ')) {
    return t
  }
  // localhost 或 IP 地址用 http
  if (t === 'localhost' || /^localhost:\d+/.test(t)) return `http://${t}`
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?/.test(t)) return `http://${t}`
  // 裸域名用 https
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(t) && !t.includes(' ')) return `https://${t}`
  // 其他当作搜索词
  return `https://www.google.com/search?q=${encodeURIComponent(t)}`
}

export function isUrl(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  if (t.includes(' ')) return false  // 含空格一定不是 URL
  try {
    const normalized = normalizeUrl(t)
    const u = new URL(normalized)
    // 允许的协议白名单（明确禁止 javascript: 和 data:）
    return ['http:', 'https:', 'about:', 'file:'].includes(u.protocol)
  } catch {
    return false
  }
}
```

**拖拽边界处理**：
- toolbar 区域添加 `data-widget-drag-handle` 属性，WidgetContainer 仅在此区域启用拖拽
- webview 区域内的鼠标事件被 webview 标签捕获，不会冒泡到 WidgetContainer（webview 标签默认行为）
- 在 WidgetContainer 中对 `webPage` 类型特殊处理：仅 `data-widget-drag-handle` 区域触发拖拽

**WidgetContainer 修改**（`client/desktop/src/components/WidgetContainer.tsx`）：
```typescript
// S16/S17 修复：使用正确的函数名 handleContainerMouseDown（与现有代码 L282-L290 一致）
// 在 useDraggable 的 onMouseDown 回调中增加判断
const handleContainerMouseDown = useCallback((e: React.MouseEvent) => {
  if (e.button !== 0) return
  onBringToFront()
  const target = e.target as HTMLElement
  if (isInteractiveElement(target)) return

  // S17 修复：检测到 WEBVIEW 标签时不 stopPropagation，让 webview 获得焦点
  // webview 标签会吞掉鼠标事件，但若事件冒泡到这里，说明点击的是 webview 内部
  // 此时不应触发拖拽，也不应 stopPropagation（让 webview 正常处理点击/聚焦）
  if (target.tagName === 'WEBVIEW' || target.closest('webview')) {
    return
  }

  // webPage 类型：仅 toolbar 区域可拖拽（非 webview 区域）
  if (type === 'webPage' && !target.closest('[data-widget-drag-handle]')) return
  e.stopPropagation()
  dragMouseDown(e)
}, [dragMouseDown, onBringToFront, type])
```

**S17 修复说明**：
- WEBVIEW 标签检测必须在 `e.stopPropagation()` 之前，否则 webview 无法获得焦点
- 检测方式：`target.tagName === 'WEBVIEW' || target.closest('webview')`（与 S16 wheel handler 一致）
- 检测到 WEBVIEW 时直接 `return`，不调用 `dragMouseDown(e)`，避免误触发拖拽

**widgetDefinitions.ts 新增**（S4 修复（v7）：提供完整的 validateState/normalizeState/migrateState 实现，参考现有 widget 定义模式；S6 修复（v7）：export webPageWidgetDef 供 builtIn.tsx import）：

注：现有 `widgetDefinitions.ts` 使用 `ValidationResult<T>` 的结构是 `{ ok: boolean, fallbackState?: T, errors?: string[], state?: T }`（见 L68-L86），而非 `{ valid, error, state }`。下面按现有结构实现：

```typescript
// widgetDefinitions.ts 新增（在文件末尾 allDefinitions 数组之前）
// S6 修复（v7）：import WebviewWidgetState 类型
import type { WebviewWidgetState } from '../types'

const webPageWidgetDef: WidgetDefinitionV2A<WebviewWidgetState> = {
  type: 'webPage',
  widgetVersion: '1.0.0',
  stateVersion: 1,
  category: 'web',  // 新增分类
  capabilities: { aiReadable: true, aiWritable: true, connectable: false, exportable: true },
  // connectable: false 因为网页组件的输出是非结构化的网页内容，不适合用视觉连接线连接到其他组件
  createDefaultState(): WebviewWidgetState {
    return { url: '', title: '新网页', schemaVersion: 1 }
  },
  validateState(raw: unknown): ValidationResult<WebviewWidgetState> {
    const def = this.createDefaultState()
    if (!isObject(raw)) return { ok: false, fallbackState: def, errors: ['state is not an object'] }
    const err = checkSchemaVersion(raw)
    if (err) return { ok: false, fallbackState: def, errors: [err] }
    return {
      ok: true,
      state: {
        url: str(raw.url, def.url),
        title: str(raw.title, def.title),
        schemaVersion: 1,
      },
    }
  },
  normalizeStateForSave(state: WebviewWidgetState): JSONValue {
    return { url: state.url, title: state.title, schemaVersion: 1 }
  },
  normalizeState(raw: unknown): WebviewWidgetState {
    const def = this.createDefaultState()
    if (!isObject(raw)) return def
    return {
      url: str(raw.url, def.url),
      title: str(raw.title, def.title),
      schemaVersion: 1,
    }
  },
  getAISummary(state: WebviewWidgetState): string {
    return `网页组件: ${state.title}, URL=${state.url}`
  },
  migrateState(oldState: unknown, fromVersion: number): WebviewWidgetState {
    if (fromVersion === this.stateVersion) return oldState as WebviewWidgetState
    return this.normalizeState(oldState)
  },
  lifecycle: {},
}

// S6 修复（v7）：将 webPageWidgetDef 加入 allDefinitions 数组，并通过 widgetDefinitionMap 暴露
const allDefinitions: WidgetDefinitionV2A[] = [
  pdfViewerDef,
  musicPlayerDef,
  focusTimerDef,
  latexQuizDef,
  calculatorDef,
  sudokuDef,
  aiAssistantDef,
  htmlCanvasWidgetDef,
  webPageWidgetDef,  // S6 修复（v7）：新增
]

// S6 修复（v7）：export webPageWidgetDef 供 builtIn.tsx import 获取 defaultState
export { webPageWidgetDef }
```

**builtIn.tsx 新增**（S5 修复（v7）：提供具体的 SVG 图标，使用 builtIn.tsx 现有的 `svg` 函数；S6 修复（v7）：import webPageWidgetDef）：

注：现有 `builtIn.tsx` 的 `svg` 函数签名是 `(paths: string, vb = '0 0 20 20') => JSX.Element`，paths 用 `|` 分隔多个 path。下面按现有模式新增 globe icon：

```typescript
// builtIn.tsx 顶部新增 import（S6 修复（v7））
import { registerWidget } from './index'
import type { WidgetConfig } from '../types'
import LatexQuiz from '../components/widgets/LatexQuiz'
import Calculator from '../components/widgets/Calculator'
import MusicPlayer from '../components/widgets/MusicPlayer'
import FocusTimer from '../components/widgets/FocusTimer'
import Sudoku from '../components/widgets/Sudoku'
import PdfViewer from '../components/widgets/PdfViewer'
import AIAssistant from '../components/widgets/AIAssistant'
import HtmlCanvasWidget from '../components/widgets/HtmlCanvasWidget'
// S6 修复（v7）：新增 WebviewWidget 和 webPageWidgetDef import
import WebviewWidget from '../components/widgets/WebviewWidget'
import { webPageWidgetDef } from './widgetDefinitions'

// ============ SVG Icons ============
const svg = (paths: string, vb = '0 0 20 20') => (
  <svg width="18" height="18" viewBox={vb} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    {paths.split('|').map((p, i) => <path key={i} d={p} />)}
  </svg>
)

const ICONS = {
  pdfViewer: svg('M4 2h9l4 4v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1ZM13 2v4h4M7 10h6M7 13h6'),
  musicPlayer: svg('M9 2v12a3 3 0 1 1-2-2.83V4l8-2v10a3 3 0 1 1-2-2.83V5'),
  focusTimer: svg('M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16ZM10 6v4l2.5 2.5M8 1h4'),
  aiAssistant: svg('M10 2a6 6 0 0 0-6 6c0 2 1 3.5 2.5 4.5V16l2-1 1.5 1 1.5-1 2 1v-3.5C14.5 11.5 16 10 16 8a6 6 0 0 0-6-6ZM8 8h.01M12 8h.01M8 12c.5.5 1.2.8 2 .8s1.5-.3 2-.8'),
  latexQuiz: svg('M3 5l3-2v14M16 3l-4 7 4 7M9 10h4M7 7l3 3-3 3'),
  calculator: svg('M4 2h12a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1ZM7 6h.01M13 6h.01M7 10h.01M13 10h.01M7 14h6'),
  sudoku: svg('M3 3h14v14H3zM3 8h14M3 12h14M8 3v14M12 3v14'),
  htmlCanvas: svg('M3 3h14v14H3zM3 9h14M9 3v14'),
  // S5 修复（v7）：网页组件 globe icon（地球仪，表示浏览器/网络）
  webPage: svg('M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16ZM2 10h16M10 2c2.5 2.5 2.5 13.5 0 16M10 2c-2.5 2.5-2.5 13.5 0 16'),
} as const

const builtInConfigs: WidgetConfig[] = [
  // ... 现有 8 个 config ...
  // S5/S6 修复（v7）：新增 webPage config
  {
    widgetType: 'webPage',
    displayName: '网页',
    icon: ICONS.webPage,
    defaultLayout: { w: 480, h: 600, minW: 320, minH: 400 },
    // S6 修复（v7）：通过 webPageWidgetDef.createDefaultState() 获取默认 state，与 widgetDefinitions 保持单一数据源
    defaultState: webPageWidgetDef.createDefaultState(),
    component: WebviewWidget,
    serialize: (s) => s,
    deserialize: (d) => d,
  },
]
```

**types/v2.ts 新增分类**：
```typescript
export type WidgetCategory = 'basic' | 'study' | 'work' | 'life' | 'media' | 'stats' | 'fun' | 'ai' | 'web'
```

### 3.3 Workspace wheel 事件冲突解决

**文件**：`client/desktop/src/components/Workspace.tsx`（修改）

**问题**：现有 wheel handler（L1064-L1125）挂在 window 上，capture 阶段截获所有 wheel 事件。webview 标签会吞掉鼠标 click 事件导致 `lastActiveWidgetId` 不更新，因此 wheel handler 无法识别"活跃 webview widget"，会 preventDefault 导致网页无法滚动。

**S16 修复：完整 wheel handler 代码**（替换现有 L1064-L1125 的 useEffect）：
```typescript
// Workspace.tsx — 替换现有 wheel handler useEffect（L1064-L1125）
useEffect(() => {
  let wheelRafId: number | null = null
  let pendingDelta: number = 0
  let lastMouseX: number = 0
  let lastMouseY: number = 0

  const flushWheel = () => {
    wheelRafId = null
    if (pendingDelta === 0) return

    const current = useAppStore.getState().canvasTransform
    const newZoom = Math.max(0.2, Math.min(3, current.zoom + pendingDelta))
    pendingDelta = 0

    if (newZoom === current.zoom) return

    const area = widgetsAreaRef.current
    let newX = current.x
    let newY = current.y
    if (area) {
      const mX = lastMouseX
      const mY = lastMouseY
      newX = mX * (1 / newZoom - 1 / current.zoom) + current.x
      newY = mY * (1 / newZoom - 1 / current.zoom) + current.y
    }

    setCanvasTransform({ x: newX, y: newY, zoom: newZoom })
  }

  const handler = (e: WheelEvent) => {
    const target = e.target as HTMLElement
    if (!target) return

    // S16 修复：webview 内的 wheel 事件直接放行，让网页自己滚动
    // 必须放在 closest 检查之前，确保 webview 滚动优先级最高
    if (target.tagName === 'WEBVIEW' || target.closest('webview')) {
      return
    }

    // 现有逻辑：工具栏/侧边栏/弹层等区域不缩放
    if (target.closest(
      '.unified-toolbar-container, .sidebar, .panel-sidebar, .modal-overlay, .fab-menu, .widget-context-menu, .unified-toolbar-popover, .popover, [role="dialog"], .minimap-container'
    )) {
      return
    }

    // 现有逻辑：活跃 widget 内不缩放（由 setLastActiveWidget 维护）
    const activeWidgetEl = activeWidgetElRef.current
    if (activeWidgetEl && target.closest(`[data-widget-id="${CSS.escape(activeWidgetEl.dataset.widgetId ?? '')}"]`)) {
      return
    }

    e.preventDefault()
    pendingDelta += e.deltaY > 0 ? -0.08 : 0.08
    lastMouseX = e.clientX
    lastMouseY = e.clientY
    if (wheelRafId === null) {
      wheelRafId = requestAnimationFrame(flushWheel)
    }
  }
  window.addEventListener('wheel', handler, { passive: false, capture: true })
  return () => {
    window.removeEventListener('wheel', handler, true)
    if (wheelRafId !== null) {
      cancelAnimationFrame(wheelRafId)
      wheelRafId = null
    }
  }
}, [setCanvasTransform])
```

**S16 修复说明**：
- webview 检查 `target.tagName === 'WEBVIEW' || target.closest('webview')` 必须放在 closest 检查**之前**，确保 webview 滚动优先级最高
- 在 closest 选择器中追加 `.panel-sidebar`（S15 新增的 Sidebar 类名），确保侧边栏内滚动不被缩放
- 其余逻辑与现有代码一致（flushWheel、activeWidgetEl 检查、raf 节流）

**同时**：WebviewWidget 添加 `mouseenter` 事件，进入时设置 `lastActiveWidgetId`，确保其他 wheel 逻辑也能正确识别：
```typescript
// WebviewWidget.tsx
<div
  className="webview-widget"
  onMouseEnter={() => {
    // F5 修复：使用现有 setLastActiveWidget action（签名为 (widgetId: string | null) => void）
    useAppStore.getState().setLastActiveWidget(widgetId)
  }}
>
```

**F5 修复说明**：使用 `useAppStore` 现有的 `setLastActiveWidget` action（签名为 `(widgetId: string | null) => void`），**不新增** `setLastActiveWidgetId`。原 v2 spec 提议新增 `setLastActiveWidgetId` 已删除。

**S14 修复：setLastActiveWidget 调用时机说明**：

- **currentWidgetId 来源**：wheel handler 中的 `activeWidgetElRef.current` 对应的 widgetId 来自 `useAppStore.getState().lastActiveWidgetId`（由 `setLastActiveWidget` action 设置）。WebviewWidget 的 `onMouseEnter` 调用 `setLastActiveWidget(widgetId)` 更新此值
- **不需要防抖**：`setLastActiveWidget` 是同步的 Zustand `set` 调用，开销极小（仅更新一个字符串字段，不触发组件重渲染，因为 wheel handler 通过 `useAppStore.getState()` 读取而非订阅）。鼠标在 webview 上移动时 `mouseenter` 只触发一次（不是 `mousemove`），无需防抖
- **wheel handler 读取方式**：wheel handler 中通过 `useAppStore.getState().lastActiveWidgetId` 读取最新值（而非闭包捕获），确保 mouseenter 更新后 wheel handler 立即看到新值

### 3.4 标签页 ↔ 网页组件双向转换

**设计原则**：所有标签页都是画布面板，不存在"纯网页标签页"。转换的本质是**移动 WebviewWidget**。

**S7 修复（v8）：types/v2.ts PanelData.settings 添加索引签名**：

运行时 `Panel.settings` 已通过 `PanelSettings` 索引签名（`types/index.ts` L15 的 `[key: string]: unknown`）支持 `url` 等扩展字段。但持久化层 `types/v2.ts` 的 `PanelData.settings` 类型是 `{ layoutMode: 'free' | 'grid'; gridSize: number }`，**没有索引签名**，如果持久化层代码访问 `panelData.settings.url`，TypeScript 会报错。`useAppStore.ts` L930 使用 `as Record<string, unknown>` 强制类型转换绕过了类型检查，但不安全。必须在 `types/v2.ts` 中添加索引签名：

```typescript
// client/desktop/src/types/v2.ts L19-L32 修改（S7 修复（v8））
export interface PanelData {
  name: string
  createdAt: number
  zIndex: number
  width: number
  height: number
  offsetX: number
  offsetY: number
  importBatchId?: string
  order?: number
  // S7 修复（v8）：添加索引签名 [key: string]: unknown，支持 url 等扩展字段
  //   原 settings?: { layoutMode: 'free' | 'grid'; gridSize: number } 无索引签名，
  //   持久化层访问 panelData.settings.url 会 TypeScript 报错
  settings?: { layoutMode: 'free' | 'grid'; gridSize: number; [key: string]: unknown }
  canvasTransform?: { x: number; y: number; zoom: number }
  schemaVersion: number
}
```

**持久化方案**：使用 `panel.settings` 存储 URL（settings 是 JSON，无需 schema 迁移）：
```typescript
// panel.settings.url — 如果面板有关联的 URL（表示该面板是"从网页创建的"）
// panel.settings.sourceWidgetId — 创建该面板的源 widget ID（可选，用于追踪）
```

**转换逻辑**：

1. **网页组件 → 标签页**（WebviewWidget 右键 → "在新标签页打开"）：
   - 创建新 Panel，`settings.url = widget.state.url`
   - 在新 Panel 上创建新的 WebviewWidget，初始 state 为原 widget 的 state
   - 删除原 Panel 上的 WebviewWidget（可选，用户可选择保留或移动）

2. **标签页 → 网页组件**（TabBar 标签右键 → "转换为网页组件"）：
   - 仅当 Panel 有 `settings.url` 时显示此选项
   - 在当前活跃 Panel 上创建新的 WebviewWidget，初始 state 从 `panel.settings.url` 恢复
   - 删除原 Panel（可选，用户可选择保留或移动）

**useAppStore 新增 action**（F2 修复：内联查找 widget，不依赖未导出的 `findWidgetInstance`；S5 修复：addWidget 失败时清理空面板）：
```typescript
// 将网页组件移动到新标签页（新 Panel）
convertWidgetToTab: async (widgetId: string) => {
  const state = useAppStore.getState()
  // F2 修复：内联查找 widget（findWidgetInstance 未导出，不能依赖）
  let widget: { widgetId: string; widgetType: string; state: Record<string, unknown> } | undefined
  let sourcePanelId: string | undefined
  for (const [pid, widgets] of Object.entries(state.panelWidgets)) {
    const found = widgets.find(w => w.widgetId === widgetId)
    if (found) { widget = found; sourcePanelId = pid; break }
  }
  if (!widget || widget.widgetType !== 'webPage' || !sourcePanelId) return

  const widgetState = widget.state as WebviewWidgetState
  // S4 修复：新面板会自动添加主 AI 助手 widget（符合"所有标签页都是画布面板"原则），这是预期行为，无需传 skipPrimaryAI
  const newPanelId = await state.addPanel(widgetState.title || '网页')
  // S5 修复：addWidget 可能因 5-webview 限制 throw，此时 addPanel 已创建空面板，必须清理
  try {
    await state.addWidget('webPage', {
      panelId: newPanelId,
      position: { x: 0, y: 0, w: 800, h: 600 },
      initialState: { ...widgetState },
    })
    // 更新新 panel 的 settings.url
    // S2 修复：await updatePanelSettings，确保 URL 持久化完成后再继续
    await state.updatePanelSettings(newPanelId, { url: widgetState.url })
    // 删除原 widget
    await state.removeWidget(widgetId)
    // 切换到新面板
    await state.setActivePanel(newPanelId)
  } catch (e) {
    // S5 修复：清理空面板，避免遗留无 widget 的空面板
    await state.deletePanel(newPanelId)
    throw e  // 重新抛出，让调用者处理（如 WebviewWidget 右键菜单的 onClick）
  }
}

// 将标签页（有 settings.url 的 Panel）转换为当前画布上的网页组件
convertTabToWidget: async (sourcePanelId: string, targetPanelId?: string) => {
  const state = useAppStore.getState()
  const sourcePanel = state.panels.find(p => p.id === sourcePanelId)
  // L1 修复（v7）：sourcePanel 可能 undefined（find 返回 undefined），用 ?. ；但 settings 是必需字段，不用 ?.
  if (!sourcePanel || !sourcePanel.settings.url) return

  const targetId = targetPanelId || state.activePanelId
  if (!targetId) return

  // 在目标面板上创建 WebviewWidget（L3 修复：移除 zoomLevel）
  await state.addWidget('webPage', {
    panelId: targetId,
    position: { x: 100, y: 100, w: 480, h: 600 },
    initialState: { url: sourcePanel.settings.url as string, title: sourcePanel.name, schemaVersion: 1 },
  })
  // 删除源面板（可选，询问用户）
  // await state.deletePanel(sourcePanelId)
}
```

**S10 修复：UI 入口（右键菜单）**：

转换功能必须连接到 UI，否则用户无法触发。实现方式：

1. **WebviewWidget toolbar 右键菜单**（"在新标签页打开"）：
```tsx
// WebviewWidget.tsx 在 toolbar 上添加 contextmenu
<div
  className="webview-widget__toolbar"
  data-widget-drag-handle
  onContextMenu={(e) => {
    e.preventDefault()
    showContextMenu(e, [
      {
        label: '在新标签页打开',
        // S13 修复：捕获 5-webview 限制错误，提示用户
        onClick: () => useAppStore.getState().convertWidgetToTab(widgetId).catch(e => window.alert((e as Error).message)),
      },
    ])
  }}
>
```

2. **TabBar 标签右键菜单**（"转换为网页组件"，仅当 `panel.settings.url` 存在时显示）：

**S10 修复：`closeOtherPanels` 和 `startRename` 必须定义**，否则右键菜单调用未定义函数。`closeOtherPanels` 在 useAppStore 中新增 action（见 2.2 节 AppState 接口）；`startRename` 在 TabBar 内联实现（局部状态 `renamingPanelId` 控制 input 显示）。

**S8 修复（v7）**：TabBar 的完整实现（含 + 按钮、Omnibox 集成、拖拽重排、中键关闭、右键菜单、双击重命名）已统一整合到 2.1 节中，此处不再重复展示代码，避免两处实现冲突。请参见 2.1 节的完整实现。

**L1 修复（v7）**：TabBar 右键菜单中 `panel.settings?.url` 改为 `panel.settings.url`（`panel.settings` 是 Panel 接口的必需字段，见 `types/index.ts` Panel 定义，不需要可选链）。已在 2.1 节的完整实现中修正。

**useAppStore 新增 `closeOtherPanels` action**（S7 修复（v7）：已整合到 2.2 节 AppState 接口和 create() 初始化中，此处仅展示实现细节）：
```typescript
// useAppStore.ts 新增（S7 修复（v7）：已包含在 2.2 节 AppState 初始化对象中）
closeOtherPanels: async (keepPanelId: string) => {
  const state = get()
  const toDelete = state.panels.filter(p => p.id !== keepPanelId).map(p => p.id)
  for (const pid of toDelete) {
    await state.deletePanel(pid)
  }
}
```

3. **showContextMenu 工具函数**（F2 修复：renderer 不能 `import 'electron'`，必须通过 contextBridge；S6 修复：主进程 IPC handler 不泄漏）：

**F2 修复**：renderer 进程不能 `import { ipcRenderer } from 'electron'`（违反 contextIsolation），必须通过 preload 暴露的 `window.contextMenuApi` 调用主进程。

**S6 修复**：主进程 `ipcMain.handle('context-menu:show')` 中原实现用 `ipcMain.on('context-menu:select')` 监听选择事件但从不移除，导致 handler 泄漏。改为在 `click` 回调中直接 resolve，并用 `menu-will-close` 事件 + `resolved` 守卫处理"用户点击空白处关闭菜单"的情况。

```typescript
// utils/contextMenu.ts（renderer 端，不 import electron）
// F2 修复：通过 window.contextMenuApi 调用主进程，不直接 import ipcRenderer
// M1 修复（v7）：onClick 类型改为 () => void | Promise<void>，支持 async onClick（如 convertWidgetToTab）
export async function showContextMenu(
  e: React.MouseEvent,
  items: Array<{ label: string; onClick: () => void | Promise<void>; disabled?: boolean }>
): Promise<void> {
  e.preventDefault()
  if (!window.contextMenuApi) return
  const index = await window.contextMenuApi.show(
    items.map(i => ({ label: i.label, enabled: !i.disabled }))
  )
  if (typeof index === 'number' && index >= 0 && items[index]) {
    // M1 修复（v7）：onClick 可能返回 Promise，用 void 处理（不 await，让调用方自行 .catch）
    // 注：onClick 内部应自行 .catch 错误（如 convertWidgetToTab().catch(...)），此处不统一捕获
    void items[index].onClick()
  }
}

// preload/index.ts 新增 contextMenuApi（F2 修复：通过 contextBridge 暴露）
contextBridge.exposeInMainWorld('contextMenuApi', {
  show: (items: Array<{ label: string; enabled?: boolean }>): Promise<number> =>
    ipcRenderer.invoke('context-menu:show', items),
})

// 主进程 IPC（main/index.ts）— S6 修复：click 回调直接 resolve，menu-will-close 守卫，无 handler 泄漏
ipcMain.handle('context-menu:show', async (event, items) => {
  return new Promise<number>(resolve => {
    let resolved = false
    const safeResolve = (val: number) => {
      if (!resolved) { resolved = true; resolve(val) }
    }
    const menu = Menu.buildFromTemplate(items.map((item: { label: string; enabled?: boolean }, index: number) => ({
      label: item.label,
      enabled: item.enabled !== false,
      click: () => safeResolve(index),
    })))
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) { safeResolve(-1); return }
    menu.popup(win)
    // S6 修复：menu-will-close 会在选择后或点击空白处触发，用 resolved 守卫避免多次 resolve
    menu.on('menu-will-close', () => safeResolve(-1))
  })
})
```

### 3.5 browserToolBridge（浏览器工具桥接器）

**文件**：`client/desktop/src/utils/browserToolBridge.ts`（新建）

**核心机制**：
- 维护 `Map<string, Electron.WebviewTag>`，key 为 widgetId
- WebviewWidget 在 mount 时注册 webview 实例（见 3.2）
- unmount 时注销
- 工具执行时通过 widgetId 查找 webview

**完整实现**：
```typescript
// browserToolBridge.ts
import type { ToolCallResult } from './wsToolHandlers'
// M4 修复：normalizeUrl 提取到 utils/url.ts 共用，避免重复定义
import { normalizeUrl } from './url'

interface BrowserToolBridge {
  registerWebview(widgetId: string, webview: Electron.WebviewTag): void
  unregisterWebview(widgetId: string): void
  getRegisteredWebviews(): Array<{ widgetId: string; url: string; title: string }>
  executeBrowserTool(tool: string, params: unknown): Promise<ToolCallResult>
}

class BrowserToolBridgeImpl implements BrowserToolBridge {
  private webviews = new Map<string, Electron.WebviewTag>()
  // S3 修复（v8）：维护每个 webview 的 ready 状态（dom-ready 事件触发后设为 true）
  //   原 awaitReady 用 getURL() 不抛错判断就绪是错误的（getURL() 返回空字符串不抛错但 webview 可能未就绪）
  private readyMap = new Map<string, boolean>()

  registerWebview(widgetId: string, webview: Electron.WebviewTag): void {
    this.webviews.set(widgetId, webview)
    // S3 修复（v8）：注册时初始化 ready 为 false，监听 dom-ready 事件设为 true
    this.readyMap.set(widgetId, false)
    webview.addEventListener('dom-ready', () => { this.readyMap.set(widgetId, true) }, { once: true })
  }

  unregisterWebview(widgetId: string): void {
    this.webviews.delete(widgetId)
    // S3 修复（v8）：注销时清理 readyMap，避免内存泄漏
    this.readyMap.delete(widgetId)
  }

  getRegisteredWebviews(): Array<{ widgetId: string; url: string; title: string }> {
    const result: Array<{ widgetId: string; url: string; title: string }> = []
    this.webviews.forEach((webview, widgetId) => {
      try {
        result.push({ widgetId, url: webview.getURL(), title: webview.getTitle() })
      } catch {
        result.push({ widgetId, url: '', title: '' })
      }
    })
    return result
  }

  async executeBrowserTool(tool: string, params: unknown): Promise<ToolCallResult> {
    try {
      switch (tool) {
        case 'browser_open': return await this.browserOpen(params as { url: string; targetWidgetId?: string })
        case 'browser_close': return await this.browserClose(params as { widgetId: string })
        case 'browser_list_tabs': return this.browserListTabs()
        case 'browser_switch_tab': return await this.browserSwitchTab(params as { widgetId: string })
        case 'browser_eval': return await this.browserEval(params as { widgetId: string; script: string })
        case 'browser_get_dom': return await this.browserGetDom(params as { widgetId: string; selector?: string })
        case 'browser_get_cookie': return await this.browserGetCookie(params as { widgetId: string; url?: string })
        case 'browser_set_cookie': return await this.browserSetCookie(params as { widgetId: string; cookie: { name: string; value: string; domain?: string; path?: string } })
        case 'browser_screenshot': return await this.browserScreenshot(params as { widgetId: string })
        case 'browser_click': return await this.browserClick(params as { widgetId: string; selector: string })
        case 'browser_input': return await this.browserInput(params as { widgetId: string; selector: string; text: string })
        case 'browser_scroll': return await this.browserScroll(params as { widgetId: string; x?: number; y?: number })
        case 'browser_wait_for': return await this.browserWaitFor(params as { widgetId: string; selector: string; timeout?: number })
        case 'browser_get_url': return this.browserGetUrl(params as { widgetId: string })
        case 'browser_navigate': return await this.browserNavigate(params as { widgetId: string; url: string })
        default: return { success: false, error: `unknown browser tool: ${tool}` }
      }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  private getWebview(widgetId: string): Electron.WebviewTag | null {
    return this.webviews.get(widgetId) || null
  }

  // S8 修复：等待 webview 就绪（dom-ready），防止在 webview 未就绪时调用 executeJavaScript 报错
  // S1 修复（v7）：添加 10s 超时，避免 webview 卡死时工具调用永久挂起
  // S2 修复（v8）：用 finally 块清除 setTimeout，避免 Promise.race 中 dom-ready 先触发时 timer 泄漏
  // S3 修复（v8）：用 readyMap 判断就绪状态（而非 getURL() 不抛错），因为 getURL() 返回空字符串不抛错但 webview 可能未就绪
  private async awaitReady(widgetId: string): Promise<void> {
    const webview = this.webviews.get(widgetId)
    if (!webview) return
    // S3 修复（v8）：检查 readyMap 而非 getURL()，readyMap 在 dom-ready 事件触发时设为 true
    if (this.readyMap.get(widgetId)) return
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        new Promise<void>(resolve => {
          const handler = () => { this.readyMap.set(widgetId, true); resolve() }
          webview.addEventListener('dom-ready', handler, { once: true })
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('webview dom-ready timeout (10s)')), 10000)
        }),
      ])
    } finally {
      // S2 修复（v8）：无论成功/失败/超时，都清除 timer，避免泄漏
      if (timer) clearTimeout(timer)
    }
  }

  private async browserOpen(params: { url: string; targetWidgetId?: string }): Promise<ToolCallResult> {
    const { useAppStore } = await import('../stores/useAppStore')
    const url = normalizeUrl(params.url)

    if (params.targetWidgetId) {
      // 在指定 widget 中导航
      const webview = this.getWebview(params.targetWidgetId)
      if (!webview) return { success: false, error: `Widget not found: ${params.targetWidgetId}` }
      webview.loadURL(url)
      return { success: true, data: { widgetId: params.targetWidgetId, url } }
    }

    // 在当前活跃面板创建新 WebviewWidget
    const state = useAppStore.getState()
    const panelId = state.activePanelId
    if (!panelId) return { success: false, error: 'No active panel' }

    // 捕获新 widget ID
    const beforeIds = new Set(state.panelWidgets[panelId]?.map(w => w.widgetId) || [])
    // S13 修复：捕获 5-webview 限制错误，返回 ToolCallResult 而非抛出异常
    try {
      await state.addWidget('webPage', {
        panelId,
        position: { x: 100, y: 100, w: 480, h: 600 },
        // L3 修复：移除 zoomLevel
        initialState: { url, title: url, schemaVersion: 1 },
      })
    } catch (e) {
      // 5-webview 限制或其他错误，返回错误信息给 AI
      return { success: false, error: (e as Error).message }
    }
    const afterWidgets = useAppStore.getState().panelWidgets[panelId] || []
    const newWidget = afterWidgets.find(w => !beforeIds.has(w.widgetId))
    // S3 修复：newWidget 可能是 undefined（addWidget 失败或被 5-webview 限制拒绝），必须检查
    if (!newWidget) return { success: false, error: 'Failed to create webview widget' }
    return { success: true, data: { widgetId: newWidget.widgetId, url } }
  }

  private async browserClose(params: { widgetId: string }): Promise<ToolCallResult> {
    const { useAppStore } = await import('../stores/useAppStore')
    const ok = await useAppStore.getState().removeWidget(params.widgetId)
    return ok ? { success: true } : { success: false, error: 'Failed to close widget' }
  }

  private browserListTabs(): ToolCallResult {
    return { success: true, data: this.getRegisteredWebviews() }
  }

  // F3 修复：改为 async，使用 await import() 替代 require()（ESM 环境）
  private async browserSwitchTab(params: { widgetId: string }): Promise<ToolCallResult> {
    const { useAppStore } = await import('../stores/useAppStore')
    // 找到 widget 所在的 panel 并切换
    const state = useAppStore.getState()
    for (const [panelId, widgets] of Object.entries(state.panelWidgets)) {
      if (widgets.some(w => w.widgetId === params.widgetId)) {
        state.setActivePanel(panelId)
        return { success: true }
      }
    }
    return { success: false, error: `Widget not found: ${params.widgetId}` }
  }

  // S2/S13 修复：返回值做安全序列化，移除函数/Symbol/循环引用/DOM 节点
  // S13 修复：JSON.parse(JSON.stringify()) 无法处理循环引用会抛错，改用自定义递归序列化器（WeakSet 跟踪已访问对象）
  // S3 修复：添加安全强制 — code 长度 10KB 限制、5s 执行超时、返回值 1MB 限制
  // S2 修复（v7）：Promise.race 超时用 finally 清除 setTimeout，避免 timer 泄漏
  // F4 修复（v7）：safeSerialize 处理 undefined（转为 null），browserEval 用 JSON.stringify(safeResult ?? null) 双重保护
  private async browserEval(params: { widgetId: string; script: string }): Promise<ToolCallResult> {
    const webview = this.getWebview(params.widgetId)
    if (!webview) return { success: false, error: `Widget not found: ${params.widgetId}` }
    // S3 修复：限制 code 长度 10KB，防止超大脚本
    const MAX_SCRIPT_SIZE = 10 * 1024
    if (params.script.length > MAX_SCRIPT_SIZE) {
      return { success: false, error: `Script too large (${params.script.length} bytes, max ${MAX_SCRIPT_SIZE} bytes)` }
    }
    // S8 修复：等待 webview 就绪（S3 修复（v8）：传 widgetId 而非 webview）
    await this.awaitReady(params.widgetId)
    // S3 修复：5s 执行超时，防止死循环
    // S2 修复（v7）：用 finally 清除 timer，避免超时未触发时 timer 仍残留
    const EVAL_TIMEOUT_MS = 5000
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const result = await Promise.race([
        webview.executeJavaScript(params.script, true),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`browser_eval timeout (${EVAL_TIMEOUT_MS}ms)`)), EVAL_TIMEOUT_MS)
        }),
      ])
      // S13 修复：使用自定义 safeSerialize 处理循环引用、函数、Symbol、DOM 节点、BigInt
      const safeResult = this.safeSerialize(result)
      // F4 修复（v7）：safeResult 可能是 undefined（如脚本返回 undefined），用 ?? null 双重保护
      // JSON.stringify(undefined) 返回 undefined（不是字符串），会导致后续 .length 访问报错
      const serialized = JSON.stringify(safeResult ?? null)
      // S3 修复：限制返回值大小 1MB，防止 WS 消息过大
      const MAX_RETURN_SIZE = 1024 * 1024
      if (serialized.length > MAX_RETURN_SIZE) {
        return { success: false, error: `Eval result too large (${serialized.length} bytes, max ${MAX_RETURN_SIZE} bytes)` }
      }
      return { success: true, data: safeResult ?? null }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    } finally {
      // S2 修复（v7）：无论成功/失败/超时，都清除 timer，避免泄漏
      if (timer) clearTimeout(timer)
    }
  }

  // S13 修复：递归序列化器，用 WeakSet 跟踪已访问对象避免循环引用导致栈溢出
  // M4 修复：添加 depth 参数，最大深度 10，防止深度嵌套对象栈溢出
  // F4 修复（v7）：处理 undefined 返回值，转为 null 以便 JSON 序列化（JSON.stringify(undefined) 返回 undefined 而非字符串）
  private safeSerialize(obj: unknown, seen: WeakSet<object> = new WeakSet(), depth = 0): unknown {
    if (depth > 10) return '[MaxDepth]'
    // F4 修复（v7）：undefined 转为 null，确保 JSON.stringify 能正常序列化
    if (obj === undefined) return null
    if (obj === null || typeof obj !== 'object') {
      if (typeof obj === 'function') return '[Function]'
      if (typeof obj === 'symbol') return '[Symbol]'
      if (typeof obj === 'bigint') return `[BigInt: ${obj.toString()}]`
      return obj
    }
    if (seen.has(obj as object)) return '[Circular]'
    seen.add(obj as object)
    if (obj instanceof Error) return { name: obj.name, message: obj.message, stack: obj.stack }
    if (obj instanceof Node) return `[${obj.nodeName}]`
    if (Array.isArray(obj)) return obj.map(item => this.safeSerialize(item, seen, depth + 1))
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(obj as Record<string, unknown>)) {
      try {
        result[key] = this.safeSerialize((obj as Record<string, unknown>)[key], seen, depth + 1)
      } catch {
        result[key] = '[Unserializable]'
      }
    }
    return result
  }

  // S9 修复：截断返回值到 100KB，防止 WS 消息过大
  // M8 修复：selector 为空时过滤掉 script/style/noscript 标签，避免返回大量内联脚本/CSS 干扰 AI 分析
  private async browserGetDom(params: { widgetId: string; selector?: string }): Promise<ToolCallResult> {
    const webview = this.getWebview(params.widgetId)
    if (!webview) return { success: false, error: `Widget not found: ${params.widgetId}` }
    // S8 修复：等待 webview 就绪（S3 修复（v8）：传 widgetId 而非 webview）
    await this.awaitReady(params.widgetId)
    const script = params.selector
      ? `document.querySelector(${JSON.stringify(params.selector)})?.outerHTML || ''`
      : `(() => { const clone = document.body.cloneNode(true); clone.querySelectorAll('script, style, noscript').forEach(el => el.remove()); return clone.innerHTML })()`
    let result = await webview.executeJavaScript(script)
    // 截断到 100KB 防止 WS 消息过大
    const MAX_SIZE = 100 * 1024
    if (typeof result === 'string' && result.length > MAX_SIZE) {
      result = result.slice(0, MAX_SIZE) + '\n<!-- truncated -->'
    }
    return { success: true, data: result }
  }

  // S10 修复说明：cookie 操作通过主进程 session.defaultSession.cookies API（经 cookieApi IPC），
  //   可获取 HttpOnly cookie，不受 document.cookie 限制
  private async browserGetCookie(params: { widgetId: string; url?: string }): Promise<ToolCallResult> {
    const webview = this.getWebview(params.widgetId)
    if (!webview) return { success: false, error: `Widget not found: ${params.widgetId}` }
    // S2 修复：cookieApi 可能未注入（preload 加载失败时），做 null 检查
    if (!window.cookieApi) return { success: false, error: 'cookieApi not available' }
    const url = params.url || webview.getURL()
    // 使用 cookieApi（通过 IPC 调用主进程 session.cookies）
    // S10 修复：session.defaultSession.cookies.get() 可获取 HttpOnly cookie，不受 document.cookie 限制
    const cookies = await window.cookieApi.get(url)
    return { success: true, data: cookies }
  }

  // S1 修复：完全忽略 params.cookie.domain，强制使用当前标签页域名，拒绝跨域设置
  // S9 修复：对 about:blank URL 拒绝设置 cookie（new URL('about:blank') 会抛错或 domain 为空）
  // S15 修复（v7）：对 data:/blob: URL 也拒绝设置 cookie（这些协议无 cookie 概念）
  private async browserSetCookie(params: { widgetId: string; cookie: { name: string; value: string; domain?: string; path?: string } }): Promise<ToolCallResult> {
    const webview = this.getWebview(params.widgetId)
    if (!webview) return { success: false, error: `Widget not found: ${params.widgetId}` }
    // S2 修复：cookieApi 可能未注入，做 null 检查
    if (!window.cookieApi) return { success: false, error: 'cookieApi not available' }
    const url = webview.getURL()
    // S15 修复（v7）：about:blank/data:/blob: 等 URL 无法设置 cookie，提前拒绝
    if (!url || url === 'about:blank' || url.startsWith('data:') || url.startsWith('blob:')) {
      return { success: false, error: 'Cannot set cookie on this URL scheme' }
    }
    const urlObj = new URL(url)
    // 安全：完全忽略 params.cookie.domain，强制使用当前标签页域名
    await window.cookieApi.set({
      url,
      name: params.cookie.name,
      value: params.cookie.value,
      domain: urlObj.hostname,  // 强制使用当前域名，拒绝跨域
      path: params.cookie.path || '/',
    })
    return { success: true }
  }

  // S4 修复：移除 selector 参数（Electron webview 不支持元素级截图）
  // M1 修复：非活跃面板的 webview 被 visibility:hidden 隐藏，capturePage 会返回空白截图。
  //   截图前临时设为 visible，finally 块中恢复原状，确保隐藏 webview 也能正常截图
  // S4 修复：限制截图大小，超过 1MB 返回错误（防止 WS 消息过大）
  // S4 修复（v8）：设置 visibility 后等待 requestAnimationFrame + setTimeout(0) 确保重绘；
  //   检查父元素（面板层）是否也是 hidden（.panel-layer--hidden），如果是临时移除该类
  private async browserScreenshot(params: { widgetId: string }): Promise<ToolCallResult> {
    const webview = this.getWebview(params.widgetId)
    if (!webview) return { success: false, error: `Widget not found: ${params.widgetId}` }

    // S4 修复（v8）：查找可能隐藏的父元素（面板层 .panel-layer--hidden）
    const panelLayer = webview.closest('.panel-layer--hidden') as HTMLElement | null
    const wasWebviewHidden = webview.style.visibility === 'hidden'
    const wasPanelHidden = panelLayer !== null

    // 临时显示 webview 和面板层
    if (wasWebviewHidden) webview.style.visibility = 'visible'
    if (wasPanelHidden) panelLayer!.classList.remove('panel-layer--hidden')

    try {
      // S4 修复（v8）：等待重绘完成（requestAnimationFrame + setTimeout(0) 确保浏览器完成重绘）
      await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)))
      await new Promise(resolve => setTimeout(resolve, 0))

      // webview.capturePage() 返回 NativeImage
      const image = await webview.capturePage()
      const dataURL = image.toDataURL()  // data:image/png;base64,...
      // S4 修复：限制大小 — 超过 512KB 返回错误，防止 WS 消息过大
      const MAX_SIZE = 512 * 1024
      if (dataURL.length > MAX_SIZE) {
        return { success: false, error: `Screenshot too large (${dataURL.length} bytes, max ${MAX_SIZE} bytes), please resize the widget` }
      }
      // 注意：fullPage 截图在 Electron webview 中不支持，只能截取可视区域
      return { success: true, data: { image: dataURL, width: image.getSize().width, height: image.getSize().height } }
    } finally {
      // M1 修复：恢复原 visibility 状态
      // S4 修复（v8）：恢复面板层的 hidden 类
      if (wasWebviewHidden) webview.style.visibility = 'hidden'
      if (wasPanelHidden) panelLayer!.classList.add('panel-layer--hidden')
    }
  }

  // S9 修复说明：当前实现不支持 Shadow DOM 和跨域 iframe 内的元素操作。
  //   document.querySelector 无法穿透 Shadow DOM 边界，跨域 iframe 受同源策略限制。
  //   未来可通过 deepQuerySelector 递归穿透 Shadow DOM 扩展。
  private async browserClick(params: { widgetId: string; selector: string }): Promise<ToolCallResult> {
    const webview = this.getWebview(params.widgetId)
    if (!webview) return { success: false, error: `Widget not found: ${params.widgetId}` }
    // S8 修复：等待 webview 就绪（S3 修复（v8）：传 widgetId 而非 webview）
    await this.awaitReady(params.widgetId)
    const script = `
      const el = document.querySelector(${JSON.stringify(params.selector)})
      if (el) { el.click(); true } else { throw new Error('Element not found: ' + ${JSON.stringify(params.selector)}) }
    `
    // M4 修复：传 userGesture=true，否则某些网页的 click 事件会被浏览器忽略（如需要用户激活的 API）
    await webview.executeJavaScript(script, true)
    return { success: true }
  }

  // M2 修复：直接赋值 el.value 不支持 React/Vue 控制的输入框（框架监听 value 属性变化，不监听直接赋值）
  //   改用 Object.getOwnPropertyDescriptor 获取原型链上的 native value setter，调用 setter 触发框架监听
  // S5 修复：el.__proto__ 已废弃，改用 el.constructor.prototype
  private async browserInput(params: { widgetId: string; selector: string; text: string }): Promise<ToolCallResult> {
    const webview = this.getWebview(params.widgetId)
    if (!webview) return { success: false, error: `Widget not found: ${params.widgetId}` }
    // S8 修复：等待 webview 就绪（S3 修复（v8）：传 widgetId 而非 webview）
    await this.awaitReady(params.widgetId)
    const script = `
      const el = document.querySelector(${JSON.stringify(params.selector)})
      if (el) {
        // S5 修复：el.__proto__ 已废弃，改用 el.constructor.prototype
        const proto = el.constructor.prototype
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
        if (setter) setter.call(el, ${JSON.stringify(params.text)})
        else el.value = ${JSON.stringify(params.text)}
        el.dispatchEvent(new Event('input', {bubbles:true}))
        el.dispatchEvent(new Event('change', {bubbles:true}))
        true
      } else { throw new Error('Element not found: ' + ${JSON.stringify(params.selector)}) }
    `
    await webview.executeJavaScript(script, true)
    return { success: true }
  }

  // M9 修复：显式应用默认值（Type.Number({ default: 0 }) 不实际应用默认值）
  // M2 修复：明确 x/y 单位为像素，添加 unit 参数（可选，默认 'px'，当前仅支持 'px'）
  private async browserScroll(params: { widgetId: string; x?: number; y?: number; unit?: 'px' }): Promise<ToolCallResult> {
    const webview = this.getWebview(params.widgetId)
    if (!webview) return { success: false, error: `Widget not found: ${params.widgetId}` }
    // S8 修复：等待 webview 就绪（S3 修复（v8）：传 widgetId 而非 webview）
    await this.awaitReady(params.widgetId)
    // M2 修复：unit 参数当前仅支持 'px'（像素），未来可扩展 'vh'/'%'
    const unit = params.unit ?? 'px'
    if (unit !== 'px') {
      return { success: false, error: `Unsupported unit: ${unit}, only 'px' is supported` }
    }
    const x = params.x ?? 0
    const y = params.y ?? 0
    // 滚动到绝对位置 (x, y)，单位像素
    await webview.executeJavaScript(`window.scrollTo(${x}, ${y})`)
    return { success: true }
  }

  // S6 修复：用 MutationObserver 在 webview 内部轮询，单次 IPC（原 100ms 轮询产生 300 次 IPC）
  private async browserWaitFor(params: { widgetId: string; selector: string; timeout?: number }): Promise<ToolCallResult> {
    const webview = this.getWebview(params.widgetId)
    if (!webview) return { success: false, error: `Widget not found: ${params.widgetId}` }
    // S8 修复：等待 webview 就绪（S3 修复（v8）：传 widgetId 而非 webview）
    await this.awaitReady(params.widgetId)
    const timeout = params.timeout ?? 30000
    // S6 修复：在 webview 内部用 MutationObserver 监听 DOM 变化，单次 IPC 调用
    const script = `
      new Promise((resolve) => {
        const check = () => { try { if (document.querySelector(${JSON.stringify(params.selector)})) return resolve(true) } catch {} }
        check()
        const obs = new MutationObserver(check)
        obs.observe(document.body, { childList: true, subtree: true })
        setTimeout(() => { obs.disconnect(); resolve(false) }, ${timeout})
      })
    `
    const matched = await webview.executeJavaScript(script)
    return matched ? { success: true } : { success: false, error: `Timeout waiting for selector: ${params.selector}` }
  }

  private browserGetUrl(params: { widgetId: string }): ToolCallResult {
    const webview = this.getWebview(params.widgetId)
    if (!webview) return { success: false, error: `Widget not found: ${params.widgetId}` }
    return { success: true, data: webview.getURL() }
  }

  private async browserNavigate(params: { widgetId: string; url: string }): Promise<ToolCallResult> {
    const webview = this.getWebview(params.widgetId)
    if (!webview) return { success: false, error: `Widget not found: ${params.widgetId}` }
    webview.loadURL(normalizeUrl(params.url))
    return { success: true }
  }
}

// M4 修复：normalizeUrl 已提取到 utils/url.ts，此处不再重复定义
// F1 修复：utils/url.ts 内容（重写为 URL 构造 + try/catch，禁止 javascript:/data: 协议）：
// export function normalizeUrl(input: string): string {
//   const t = input.trim()
//   if (!t) return 'about:blank'
//   if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(t) && !t.includes(' ')) return t
//   if (t === 'localhost' || /^localhost:\d+/.test(t)) return `http://${t}`
//   if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?/.test(t)) return `http://${t}`
//   if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(t) && !t.includes(' ')) return `https://${t}`
//   return `https://www.google.com/search?q=${encodeURIComponent(t)}`
// }
// export function isUrl(text: string): boolean {
//   const t = text.trim()
//   if (!t || t.includes(' ')) return false
//   try {
//     const u = new URL(normalizeUrl(t))
//     return ['http:', 'https:', 'about:', 'file:'].includes(u.protocol)
//   } catch { return false }
// }

export const browserToolBridge: BrowserToolBridge = new BrowserToolBridgeImpl()
```

**S7 修复：browserToolBridgeRegistry 生命周期说明**：
- registry（`Map<string, Electron.WebviewTag>`）生命周期与 WebviewWidget 组件生命周期一致
- WebviewWidget useEffect mount 时调用 `browserToolBridge.registerWebview(widgetId, webview)` 注册
- WebviewWidget unmount 时调用 `browserToolBridge.unregisterWebview(widgetId)` 注销（见 3.2 节 useEffect 1 的 cleanup）
- 组件卸载时自动清理，无需手动管理
- 应用退出时无需特殊清理（所有 webview 随窗口销毁，BrowserToolBridge 实例随进程退出释放）

**M7 修复：并发安全说明**：
- `webview.executeJavaScript` 支持并发调用（Electron 内部排队执行），BrowserToolBridge 无需额外锁
- 但建议 AI 不要同时调用多个会修改 DOM 的工具（如 `browser_click` + `browser_input`），避免竞态条件

**TypeScript 全局类型声明**（`client/desktop/src/types/electron.d.ts` 新建，S1 修复：新增 webviewApi 类型声明）：
```typescript
interface Window {
  menuApi?: {
    onMenuAction: (callback: (action: string) => void) => (() => void)
  }
  cookieApi?: {
    get: (url: string) => Promise<Electron.Cookie[]>
    set: (cookie: Electron.CookiesSetDetails) => Promise<void>
  }
  // F2 修复：contextMenuApi 通过 contextBridge 暴露（renderer 不能直接 import ipcRenderer）
  contextMenuApi?: {
    show: (items: Array<{ label: string; enabled?: boolean }>) => Promise<number>
  }
  // S1 修复：webviewApi 通过 contextBridge 暴露，onOpenUrl 返回清理函数（避免 ipcRenderer.on 返回 void 导致内存泄漏）
  webviewApi?: {
    onOpenUrl: (callback: (url: string) => void) => (() => void)
  }
}

declare namespace Electron {
  // F3 修复：WebviewTag 必须继承 HTMLElement，否则 webview.style.visibility 无类型（F6 修复依赖 style 属性）
  interface WebviewTag extends HTMLElement {
    loadURL(url: string): Promise<void>
    getURL(): string
    getTitle(): string
    canGoBack(): boolean
    canGoForward(): boolean
    goBack(): void
    goForward(): void
    reload(): void
    executeJavaScript<T = unknown>(script: string, userGesture?: boolean): Promise<T>
    capturePage(): Promise<Electron.NativeImage>
    stop(): void
    // F1 修复：addEventListener 添加重载，支持 options 参数（{ once?: boolean }）
    // 原签名只接受 (event, listener)，不支持 { once: true }，导致 awaitReady 中的 once 选项类型错误
    addEventListener(event: string, listener: (e: unknown) => void): void
    addEventListener(event: string, listener: (e: unknown) => void, options: { once?: boolean }): void
    removeEventListener(event: string, listener: (e: unknown) => void): void
  }

  // S17 修复：声明 webview 事件类型，供 WebviewWidget 内部类型断言使用
  // 注：这些类型仅在组件内部用 `as` 断言时引用，addEventListener 签名本身用 (e: unknown) => void
  interface LoadCommitEvent { url: string; isMainFrame: boolean }
  interface DidFailLoadEvent { errorCode: number; errorDescription: string; url: string; isMainFrame: boolean }
  interface DidNavigateEvent { url: string }
  interface DidNavigateInPageEvent { url: string; isMainFrame: boolean }
  interface PageTitleUpdatedEvent { title: string; explicitSet: boolean }
}

// F4 修复：声明 <webview> JSX 内联元素，ref 类型必须与 useRef<Electron.WebviewTag> 匹配
// 将 HTMLElement 替换为 Electron.WebviewTag，否则 useRef<Electron.WebviewTag>(null) 与 ref={webviewRef} 类型不兼容
// F3 修复：添加 partition 属性声明，否则 <webview partition={...}> 类型错误
declare global {
  namespace React {
    namespace JSX {
      interface IntrinsicElements {
        webview: React.DetailedHTMLProps<React.HTMLAttributes<Electron.WebviewTag> & {
          src?: string
          webpreferences?: string
          allowpopups?: boolean
          partition?: string
        }, Electron.WebviewTag>
      }
    }
  }
}
```

### 3.6 WS 协议扩展 + Pi Agent 浏览器工具

**文件**：
- `server/src/ws.ts`（修改，不新增 kind，复用现有 tool_call/tool_result）
- `server/src/piBridge.ts`（修改，新增 15 个浏览器工具）
- `client/desktop/src/utils/wsToolHandlers.ts`（修改，新增 15 个浏览器工具 handler）

**WS 协议**：**不扩展**，复用现有 `tool_call`/`tool_result`。浏览器工具与其他工具一样通过 `executeViaWs` 下发，前端通过 `executeToolCall` 分发到 `browserToolBridge.executeBrowserTool`。

**S12 修复：executeViaWs 完整数据流图**：
```
Pi Agent → customTools[i].execute(toolCallId, params)
  → executeViaWs(toolName, params)              [piBridge.ts, 服务端]
  → WS tool_call 消息 { kind: 'tool_call', requestId, tool, params }  [sendToClient]
  → 客户端 wsToolHandlers.executeToolCall(tool, params)  [wsToolHandlers.ts]
  → browserToolBridge.executeBrowserTool(tool, params)   [browserToolBridge.ts]
  → BrowserToolBridge 方法（browserOpen/browserClick/...）
  → webview.executeJavaScript(script)            [Electron webview]
  → WS tool_result 消息 { kind: 'tool_result', requestId, result }  [客户端回传]
  → executeViaWs 返回结果（pendingRequests.get(requestId).resolve(result)）
  → customTools[i].execute 返回 { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} } 给 Pi
```

**piBridge.ts 新增 15 个浏览器工具**：

**F5 修复**：现有 ToolDefinition（piBridge.ts L74-L94）使用 `name`/`label`/`description`/`parameters`（Type.Object）/`execute` 字段，**不是** `inputSchema`。原 v3 spec 用 `inputSchema` 且缺少 `label`/`execute`，会导致工具无法注册和执行。按现有结构重写 15 个工具，每个工具通过 `executeViaWs` 下发到前端，返回 `{ content: [{ type: 'text', text: JSON.stringify(result) }], details: {} }` 格式（与现有 6 个 customTools 一致）。

```typescript
// F5 修复：按现有 ToolDefinition 结构（piBridge.ts L74-L94）定义，使用 parameters（非 inputSchema）+ label + execute
const browserOpenTool: ToolDefinition = {
  name: 'browser_open',
  label: 'Browser Open',
  description: '打开网页。在当前面板创建新网页组件，或在指定组件中导航。',
  parameters: Type.Object({
    url: Type.String({ description: '要打开的 URL' }),
    targetWidgetId: Type.Optional(Type.String({ description: '指定网页组件 ID，不填则新建组件' })),
  }),
  execute: async (_toolCallId, params) => {
    const result = await executeViaWs('browser_open', params)
    return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} }
  },
}

const browserCloseTool: ToolDefinition = {
  name: 'browser_close',
  label: 'Browser Close',
  description: '关闭网页组件。',
  parameters: Type.Object({ widgetId: Type.String({ description: '网页组件 ID' }) }),
  execute: async (_toolCallId, params) => {
    const result = await executeViaWs('browser_close', params)
    return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} }
  },
}

const browserListTabsTool: ToolDefinition = {
  name: 'browser_list_tabs',
  label: 'Browser List Tabs',
  description: '列出所有打开的网页组件。',
  parameters: Type.Object({}),
  execute: async (_toolCallId, params) => {
    const result = await executeViaWs('browser_list_tabs', params)
    return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} }
  },
}

const browserSwitchTabTool: ToolDefinition = {
  name: 'browser_switch_tab',
  label: 'Browser Switch Tab',
  description: '切换到包含指定网页组件的面板。',
  parameters: Type.Object({ widgetId: Type.String() }),
  execute: async (_toolCallId, params) => {
    const result = await executeViaWs('browser_switch_tab', params)
    return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} }
  },
}

const browserEvalTool: ToolDefinition = {
  name: 'browser_eval',
  label: 'Browser Eval',
  description: '在网页组件中执行 JavaScript。注意：可能存在安全风险，仅用于读取操作。',
  parameters: Type.Object({
    widgetId: Type.String(),
    script: Type.String({ description: '要执行的 JavaScript 代码' }),
  }),
  execute: async (_toolCallId, params) => {
    const result = await executeViaWs('browser_eval', params)
    return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} }
  },
}

const browserGetDomTool: ToolDefinition = {
  name: 'browser_get_dom',
  label: 'Browser Get DOM',
  description: '获取网页组件的 DOM 内容（全部或指定选择器）。',
  parameters: Type.Object({
    widgetId: Type.String(),
    selector: Type.Optional(Type.String({ description: 'CSS 选择器，不填则获取整个 body' })),
  }),
  execute: async (_toolCallId, params) => {
    const result = await executeViaWs('browser_get_dom', params)
    return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} }
  },
}

const browserGetCookieTool: ToolDefinition = {
  name: 'browser_get_cookie',
  label: 'Browser Get Cookie',
  description: '获取网页组件的 Cookie。',
  parameters: Type.Object({
    widgetId: Type.String(),
    url: Type.Optional(Type.String()),
  }),
  execute: async (_toolCallId, params) => {
    const result = await executeViaWs('browser_get_cookie', params)
    return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} }
  },
}

const browserSetCookieTool: ToolDefinition = {
  name: 'browser_set_cookie',
  label: 'Browser Set Cookie',
  description: '设置网页组件的 Cookie。仅限当前标签页域名，拒绝跨域设置。',
  parameters: Type.Object({
    widgetId: Type.String(),
    cookie: Type.Object({
      name: Type.String(),
      value: Type.String(),
      domain: Type.Optional(Type.String()),
      path: Type.Optional(Type.String()),
    }),
  }),
  execute: async (_toolCallId, params) => {
    const result = await executeViaWs('browser_set_cookie', params)
    return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} }
  },
}

const browserScreenshotTool: ToolDefinition = {
  name: 'browser_screenshot',
  label: 'Browser Screenshot',
  description: '截取网页组件截图（可视区域）。',
  parameters: Type.Object({ widgetId: Type.String() }),
  execute: async (_toolCallId, params) => {
    const result = await executeViaWs('browser_screenshot', params)
    return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} }
  },
}

const browserClickTool: ToolDefinition = {
  name: 'browser_click',
  label: 'Browser Click',
  description: '点击网页组件中的元素。',
  parameters: Type.Object({
    widgetId: Type.String(),
    selector: Type.String({ description: 'CSS 选择器' }),
  }),
  execute: async (_toolCallId, params) => {
    const result = await executeViaWs('browser_click', params)
    return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} }
  },
}

const browserInputTool: ToolDefinition = {
  name: 'browser_input',
  label: 'Browser Input',
  description: '在网页组件的输入框输入文本。',
  parameters: Type.Object({
    widgetId: Type.String(),
    selector: Type.String(),
    text: Type.String(),
  }),
  execute: async (_toolCallId, params) => {
    const result = await executeViaWs('browser_input', params)
    return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} }
  },
}

const browserScrollTool: ToolDefinition = {
  name: 'browser_scroll',
  label: 'Browser Scroll',
  description: '滚动网页组件到绝对位置 (x, y)，单位为像素。',
  parameters: Type.Object({
    widgetId: Type.String(),
    x: Type.Number({ default: 0, description: '水平滚动位置，单位像素' }),
    y: Type.Number({ default: 0, description: '垂直滚动位置，单位像素' }),
    // M2 修复：添加 unit 参数（可选，默认 'px'，当前仅支持 'px'）
    unit: Type.Optional(Type.Union([Type.Literal('px')], { description: '单位，默认 px，当前仅支持 px' })),
  }),
  execute: async (_toolCallId, params) => {
    const result = await executeViaWs('browser_scroll', params)
    return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} }
  },
}

const browserWaitForTool: ToolDefinition = {
  name: 'browser_wait_for',
  label: 'Browser Wait For',
  description: '等待元素出现。',
  parameters: Type.Object({
    widgetId: Type.String(),
    selector: Type.String(),
    timeout: Type.Optional(Type.Number({ default: 30000, description: '超时毫秒' })),
  }),
  execute: async (_toolCallId, params) => {
    const result = await executeViaWs('browser_wait_for', params)
    return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} }
  },
}

const browserGetUrlTool: ToolDefinition = {
  name: 'browser_get_url',
  label: 'Browser Get URL',
  description: '获取网页组件当前 URL。',
  parameters: Type.Object({ widgetId: Type.String() }),
  execute: async (_toolCallId, params) => {
    const result = await executeViaWs('browser_get_url', params)
    return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} }
  },
}

const browserNavigateTool: ToolDefinition = {
  name: 'browser_navigate',
  label: 'Browser Navigate',
  description: '导航网页组件到指定 URL。',
  parameters: Type.Object({ widgetId: Type.String(), url: Type.String() }),
  execute: async (_toolCallId, params) => {
    const result = await executeViaWs('browser_navigate', params)
    return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} }
  },
}

// F5 修复：将 15 个浏览器工具加入 customTools 数组（piBridge.ts L190-L197）
const customTools: ToolDefinition[] = [
  createHtmlWidgetTool,
  updateHtmlWidgetTool,
  deleteHtmlWidgetTool,
  listWidgetsTool,
  storageReadTool,
  storageWriteTool,
  // 新增 15 个浏览器工具
  browserOpenTool,
  browserCloseTool,
  browserListTabsTool,
  browserSwitchTabTool,
  browserEvalTool,
  browserGetDomTool,
  browserGetCookieTool,
  browserSetCookieTool,
  browserScreenshotTool,
  browserClickTool,
  browserInputTool,
  browserScrollTool,
  browserWaitForTool,
  browserGetUrlTool,
  browserNavigateTool,
]
```

**注意**：移除了 `browser_extract`（AI 直接用 `browser_get_dom` + 自身推理能力提取内容，避免前端→服务端的递归调用复杂度）。

**S8 修复：TOOL_TIMEOUT_MS 不全局调整，改为按工具类型设置超时**：

不为浏览器工具全局调整 `TOOL_TIMEOUT_MS`（保持 `TOOL_TIMEOUT_MS = 30_000` 不变），改为在 `executeViaWs` 中按工具类型设置不同超时。

**F6 修复**：`executeViaWs(tool: string, params: unknown)` 的 `tool` 参数是 **string**（见 piBridge.ts L38），原 v3 代码 `tool.name.startsWith('browser_')` 错误地把 `tool` 当对象。改为 `tool.startsWith('browser_')`。

**M7 修复**：展示完整的 `executeViaWs` 修改后代码，含 timeout 使用：
```typescript
// piBridge.ts 顶部新增常量（L2 修复（v7）：仅新增 BROWSER_TOOL_TIMEOUT_MS，TOOL_TIMEOUT_MS 已存在，不重复声明）
// 现有代码（保留，不重复声明）：const TOOL_TIMEOUT_MS = 30_000
const BROWSER_TOOL_TIMEOUT_MS = 60_000  // S8 修复：浏览器操作可能更慢（加载网页、等待元素）

// F6 + M7 修复：executeViaWs 完整修改后代码（tool 是 string，用 tool.startsWith）
function executeViaWs(tool: string, params: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!hasClient()) {
      reject(new Error('no websocket client connected'))
      return
    }

    const requestId = randomUUID()
    // F6 修复：tool 是 string，不是对象，用 tool.startsWith（不是 tool.name.startsWith）
    // M7 修复：按工具类型选择 timeout
    const isBrowserTool = tool.startsWith('browser_')
    const timeout = isBrowserTool ? BROWSER_TOOL_TIMEOUT_MS : TOOL_TIMEOUT_MS
    const timer = setTimeout(() => {
      pendingRequests.delete(requestId)
      reject(new Error('timeout'))
    }, timeout)

    pendingRequests.set(requestId, { resolve, reject, timer })

    const ok = sendToClient({ kind: 'tool_call', requestId, tool, params })
    if (!ok) {
      clearTimeout(timer)
      pendingRequests.delete(requestId)
      reject(new Error('failed to send tool_call to client'))
    }
  })
}
```

**S7 修复：System prompt 追加（保留 base + 现有 canvasPrompt，不 paraphrase）**：

修改 `piBridge.ts` 现有 `appendSystemPromptOverride`（L250-L266）。

**F1 修复（关键）**：原 v3 修改返回 `[...base, browserPrompt]`，但 `...base` 只是 base 数组（pi-ai 框架传入的默认 prompt），**不包含** piBridge.ts L252-L265 现有的 canvasPrompt（iframe sandbox="allow-scripts" 约束、localStorage/sessionStorage/IndexedDB 不可用警告、window.canvasStorage.write/read/httpFetch 持久化 API 说明、"创建日记、待办、笔记等需要持久化的工具时，必须用 canvasStorage" 指引）。必须保留现有 canvasPrompt 文本，只在数组末尾追加 browserPrompt。

**保留 piBridge.ts L252-L265 现有的完整 canvasPrompt 文本，不要删除或 paraphrase，只在数组末尾追加 browserPrompt**：

```typescript
// piBridge.ts 现有 appendSystemPromptOverride（L250-L266）修改为：
appendSystemPromptOverride: (base) => [
  ...base,  // pi-ai 框架默认 prompt
  // F1 修复：保留 piBridge.ts L252-L265 现有的完整 canvasPrompt 文本（不删除、不 paraphrase）
  `你是一个画布助手，运行在 event 画布应用中。你可以通过工具创建 HTML widget 摆放在画布上。

重要约束：
1. 你创建的 HTML 运行在 sandbox="allow-scripts" 的 iframe 里（无 allow-same-origin）
2. 因此 iframe 内部 localStorage / sessionStorage / IndexedDB 全部不可用，访问会抛 SecurityError
3. 持久化数据的唯一方式是调用 window.canvasStorage（已自动注入）：
   - await window.canvasStorage.write(key, value)  // 写入持久化 KV 存储（跨设备同步）
   - await window.canvasStorage.read(key)           // 读取持久化 KV 存储
   - await window.canvasStorage.httpFetch(url, options)  // 代理 HTTP 请求（绕过 CORS）

创建日记、待办、笔记等需要持久化的工具时，必须用 canvasStorage，不要用 localStorage。
初始化时先 await canvasStorage.read(key) 加载历史数据，用户输入后 await canvasStorage.write(key, value) 保存。

创建的 HTML 应该是完整的、美观的、可交互的页面。可以内联 CSS 和 JS。`,
  // F1 修复：在 canvasPrompt 之后追加 browserPrompt（不替换 canvasPrompt）
  `你也是一个浏览器助手，可以操作用户画布上的网页组件。

可用浏览器工具：
- browser_open: 打开网页（在当前面板创建新网页组件，或在指定组件中导航）
- browser_close: 关闭网页组件
- browser_list_tabs: 列出所有网页组件
- browser_switch_tab: 切换到包含指定网页组件的面板
- browser_eval: 执行 JavaScript（注意安全，优先用其他工具）
- browser_get_dom: 获取 DOM 内容
- browser_click/input/scroll: 交互操作
- browser_screenshot: 截图（可视区域）
- browser_get_cookie: 获取 Cookie
- browser_set_cookie: 设置 Cookie（仅限当前域名，拒绝跨域）
- browser_wait_for: 等待元素出现
- browser_get_url: 获取当前 URL
- browser_navigate: 导航到 URL

使用原则：
1. 操作前先 browser_list_tabs 了解当前网页组件
2. 操作后用 browser_screenshot 或 browser_get_dom 验证结果
3. 用户说"打开贴吧"时，调用 browser_open({ url: "https://tieba.baidu.com" })
4. 提取内容时用 browser_get_dom 获取 DOM，自己分析提取
5. browser_eval 有安全风险，仅用于读取操作，不做修改`,
]
```

**wsToolHandlers.ts 新增 case**：

**S8 修复**：`wsToolHandlers.ts` 必须在文件顶部 import `browserToolBridge`，否则 switch case 中调用 `browserToolBridge.executeBrowserTool` 会报未定义错误。

```typescript
// wsToolHandlers.ts 顶部新增 import（S8 修复）
import { browserToolBridge } from './browserToolBridge'

// 在 executeToolCall 的 switch 中添加（L488-L510）
case 'browser_open':
case 'browser_close':
case 'browser_list_tabs':
case 'browser_switch_tab':
case 'browser_eval':
case 'browser_get_dom':
case 'browser_get_cookie':
case 'browser_set_cookie':
case 'browser_screenshot':
case 'browser_click':
case 'browser_input':
case 'browser_scroll':
case 'browser_wait_for':
case 'browser_get_url':
case 'browser_navigate':
  return await browserToolBridge.executeBrowserTool(tool, params)
```

### 3.7 ~~Playwright 级 API 封装~~（S3 修复：已删除）

**S3 修复说明**：原 v2 spec 的 3.7 节提议新建 `client/desktop/src/utils/playwrightApi.ts`，但该文件与 `browserToolBridge.ts` 功能完全重复（都封装 webview 操作）。**已删除此节**，`browserToolBridge` 直接操作 webview，不引入额外的抽象层。

`browserToolBridge` 已提供类 Playwright 的 API（`browser_click`/`browser_input`/`browser_scroll`/`browser_eval`/`browser_screenshot`/`browser_wait_for` 等），无需单独的 `playwrightApi.ts`。

### 3.8 Omnibox（地址栏）

**文件**：`client/desktop/src/components/Omnibox.tsx`（新建）

**位置**：集成在 TabBar 中间区域（flex: 1）

**功能**：
- 地址栏 + 搜索 + AI 对话三合一
- 输入 URL → 导航到该 URL（在当前面板创建新 WebviewWidget，或在当前活跃 WebviewWidget 中导航）
- 输入搜索词 → 用 Google 搜索
- 输入 `ai: ` 前缀 → 发送给 AI 助手
- 输入 `/` 前缀 → 斜杠命令（如 `/new-panel`, `/open 贴吧`）
- 历史记录自动补全（从 browserToolBridge 获取已打开的 URL）
- 快捷键 `Ctrl+L` 聚焦地址栏

```tsx
// S4 + L5 修复：补全 import（useState/useRef/useEffect + browserToolBridge）
// F1 修复：isUrl 和 normalizeUrl 从 utils/url.ts 导入（共用，避免重复定义）
import { useState, useRef, useEffect } from 'react'
import { browserToolBridge } from '../utils/browserToolBridge'
import { isUrl, normalizeUrl } from '../utils/url'

export default function Omnibox() {
  const [value, setValue] = useState('')
  const [suggestions, setSuggestions] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  // Ctrl+L 聚焦
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // F3 修复：handleSubmit 改为 async，内部用 await import() 替代 require()
  const handleSubmit = async (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const trimmed = value.trim()
    if (!trimmed) return

    if (trimmed.startsWith('ai: ')) {
      // 发送给 AI
      const { useAIStore } = await import('../stores/useAIStore')
      const state = useAIStore.getState()
      if (state.activeSessionId) {
        state.sendMessage(state.activeSessionId, trimmed.slice(4))
      }
    } else if (trimmed.startsWith('/')) {
      // 斜杠命令
      await handleSlashCommand(trimmed)
    } else if (isUrl(trimmed)) {
      // URL 导航
      await navigateToUrl(trimmed)
    } else {
      // 搜索
      await navigateToUrl(`https://www.google.com/search?q=${encodeURIComponent(trimmed)}`)
    }
    setValue('')
  }

  // M13 修复：先检查 activePanelId，不存在时创建新面板（避免 panelId: undefined 静默失败）
  // F3 修复：改为 async，使用 await import()
  // L3 修复：移除 zoomLevel
  // S5 修复：捕获 5-webview 限制错误（addWidget 会 throw），用 alert 提示用户
  // F2 修复（v8）：在 navigateToUrl 内部第一行添加 normalizeUrl，确保 URL 无协议时自动补全 https://
  //   原 navigateToUrl 直接用原始 url，用户输入 "baidu.com" 时 webview.loadURL("baidu.com") 会失败
  const navigateToUrl = async (url: string) => {
    // F2 修复（v8）：规范化 URL（补全协议、禁止 javascript:/data: 协议）
    url = normalizeUrl(url)
    const { useAppStore } = await import('../stores/useAppStore')
    const state = useAppStore.getState()
    let panelId = state.activePanelId
    if (!panelId) {
      panelId = await state.addPanel('网页')
    }
    try {
      await state.addWidget('webPage', {
        panelId,
        position: { x: 100, y: 100, w: 480, h: 600 },
        initialState: { url, title: url, schemaVersion: 1 },
      })
    } catch (e) {
      // S5 修复：5-webview 限制或其他错误，提示用户而非静默失败
      alert(e instanceof Error ? e.message : '添加网页组件失败')
    }
  }

  // F3 修复：改为 async，使用 await import()
  // M3 修复（v7）：动态 import 用于避免循环依赖（useAppStore ↔ Omnibox ↔ useAIStore 之间可能存在循环引用）
  // L3 修复（v7）：当前版本仅支持 /new-panel 和 /open，其他命令（如 /close, /rename）未来扩展
  // S6 修复（v8）：/open 命令调用 normalizeUrl 规范化 URL（与 navigateToUrl 内部的 normalizeUrl 双重保护）
  const handleSlashCommand = async (cmd: string) => {
    const { useAppStore } = await import('../stores/useAppStore')
    const parts = cmd.slice(1).split(' ')
    const command = parts[0]
    const arg = parts.slice(1).join(' ')
    switch (command) {
      case 'new-panel':
        await useAppStore.getState().addPanel(arg || '新面板')
        break
      case 'open':
        // S6 修复（v8）：调用 normalizeUrl 规范化 URL（navigateToUrl 内部也会 normalizeUrl，双重保护）
        if (arg) await navigateToUrl(normalizeUrl(arg))
        break
      // L3 修复（v7）：当前版本仅支持 /new-panel 和 /open，其他命令未来扩展
      // 未来可添加：/close <panel>, /rename <panel> <name>, /layout 等
    }
  }

  const updateSuggestions = (input: string) => {
    if (!input) { setSuggestions([]); return }
    // 从 browserToolBridge 获取已打开的 URL 作为建议
    const tabs = browserToolBridge.getRegisteredWebviews()
    const urls = tabs.map(t => t.url).filter(Boolean)
    setSuggestions(urls.filter(u => u.includes(input)).slice(0, 5))
  }

  return (
    <div className="omnibox">
      <input
        ref={inputRef}
        className="omnibox__input"
        value={value}
        onChange={(e) => { setValue(e.target.value); updateSuggestions(e.target.value) }}
        onKeyDown={handleSubmit}
        placeholder="输入 URL、搜索内容、ai: 对话、/ 命令"
      />
      {suggestions.length > 0 && (
        <div className="omnibox__suggestions">
          {suggestions.map(s => <div key={s} className="omnibox__suggestion" onClick={() => { setValue(s); inputRef.current?.focus() }}>{s}</div>)}
        </div>
      )}
    </div>
  )
}

// F1 修复：isUrl 已从 utils/url.ts 导入，此处不再定义本地 isUrl 函数
// 原 M5 修复的本地 isUrl（用正则 /\.[a-z]{2,}(\/|$)/i）已删除，统一使用 utils/url.ts 中的 isUrl
```

---

## 四、实施顺序

### 4.1 第一批（Phase 1 依赖，可并行）
1. **TabBar 组件**（含 Omnibox 集成）
2. **Sidebar 组件**
3. **系统托盘 + 菜单栏 + Cookie IPC**（Electron 主进程 + preload）
4. **App.tsx 布局调整** + **UnifiedToolbar 移除面板菜单**
5. **useAppStore 新增状态**（sidebarCollapsed/toggleSidebar/convertWidgetToTab/convertTabToWidget；F5 修复：setLastActiveWidget 已存在，不新增 setLastActiveWidgetId）

### 4.2 第二批（Phase 2 基础，可并行）
6. **Electron webview 启用**（main/index.ts 修改）
7. **WebviewWidget 组件** + **widgetDefinitions/builtIn 注册** + **utils/url.ts**（M4 修复：normalizeUrl 共用）
8. **Workspace wheel 事件冲突解决**
9. **WidgetContainer 拖拽边界处理**（webPage 类型特殊处理）

### 4.3 第三批（Phase 2 AI 能力，可并行）
10. **browserToolBridge**（browserToolBridge.ts）— S3 修复：不再单独创建 playwrightApi.ts
11. **Pi Agent 浏览器工具**（piBridge.ts 新增 15 个工具）
12. **wsToolHandlers 扩展**（新增 15 个浏览器工具 handler）
13. **TypeScript 类型声明**（electron.d.ts，含 F4 修复的 webview JSX 声明）

### 4.4 第四批（Phase 2 集成）
14. **Omnibox 组件**（集成到 TabBar）
15. **标签页 ↔ 网页组件双向转换**（TabBar/WebviewWidget 右键菜单，S10 修复：含 contextMenu 工具）
16. **contextMenu 工具**（utils/contextMenu.ts + 主进程 IPC）

---

## 五、边界条件与异常处理

### 5.1 webview 加载失败
- `did-fail-load` 事件：显示错误页面，提供重试按钮
- 网络超时：10s 超时提示
- 无效 URL：自动补全 https://

### 5.2 AI 工具调用失败
- webview 不存在（widgetId 无效）：返回 `{ success: false, error: 'Widget not found' }`
- 执行超时：60s 后返回 `{ success: false, error: 'Tool timeout' }`
- 脚本执行错误：捕获异常，返回错误信息

### 5.3 标签页关闭时清理
- 关闭面板：销毁该面板上的所有 WebviewWidget，browserToolBridge 自动注销
- 关闭最后一个标签页：创建新的空白面板

### 5.4 多 webview 性能

**S13/S14 修复：5-webview 硬限制策略**：

**策略说明**：
- **只计算非隐藏面板上的 webPage 类型 widget**。当前 `Panel` 接口（`types/index.ts` L49-L55）没有 `hidden` 属性，所有面板均视为"非隐藏"，因此实际计算所有面板上的 webPage widget。若未来引入面板隐藏功能，隐藏面板上的 webview 不计入配额
- **addWidget 抛出 Error**：超过 5 个时 `throw new Error('已达到网页组件数量上限（5 个），请先关闭不用的网页组件')`，由调用方（Omnibox/browserOpen/convertTabToWidget/convertWidgetToTab）用 try/catch 捕获并提示用户
- **convertTabToWidget 也受 5 限制**：在 convertTabToWidget 中调用 addWidget 时，同样会触发 5-webview 检查，若超限 addWidget 抛出 Error，convertTabToWidget 不额外清理（因为 convertTabToWidget 不创建新面板，只是往现有面板加 widget）

在 `useAppStore` 的 `addWidget` action 中检查 `webPage` 类型 widget 数量，超过 5 个时拒绝创建：

**S5 修复（v8）：给出完整的修改后 addWidget 函数代码**（对照真实代码 `useAppStore.ts` L939-L1047，把 5-webview 检查逻辑插入到函数开头，禁止用注释省略现有逻辑）：

```typescript
// useAppStore.ts addWidget action（S5 修复（v8）：完整实现，含 5-webview 硬限制）
addWidget: async (widgetType: string, options?: {
  panelId?: string
  position?: { x: number; y: number; w: number; h: number }
  initialState?: Record<string, unknown>
  isPrimary?: boolean
}) => {
  // S13/S14 修复：webPage 类型硬限制 5 个
  // 只计算非隐藏面板上的 webPage widget（当前 Panel 无 hidden 属性，计算所有面板）
  // S5 修复（v8）：检查逻辑插入到函数开头（生成 widgetId 之前），超限时 throw Error 由调用方捕获
  if (widgetType === 'webPage') {
    const { panels, panelWidgets } = get()
    // 遍历所有非隐藏面板（当前所有面板均视为非隐藏）
    let webCount = 0
    for (const panel of panels) {
      // 未来扩展：if (panel.hidden) continue
      const widgets = panelWidgets[panel.id] ?? []
      webCount += widgets.filter(w => w.widgetType === 'webPage').length
    }
    if (webCount >= 5) {
      throw new Error('已达到网页组件数量上限（5 个），请先关闭不用的网页组件')
    }
  }

  // ========== 以下为现有 addWidget 逻辑（对照 useAppStore.ts L945-L1047，完整保留） ==========
  const config = getWidgetConfig(widgetType)
  if (!config) return
  const targetPanelId = options?.panelId ?? get().activePanelId
  if (!targetPanelId) return

  const widgetId = uuidv4()

  // Determine widget state
  let widgetState: Record<string, unknown> = { ...config.defaultState }
  if (options?.initialState) {
    widgetState = { ...config.defaultState, ...options.initialState }
  }

  // v10: newWidget 新增 isPrimary 顶层字段（保持现有行为，不新增 minimized/locked）
  const newWidget: WidgetInstance = {
    widgetId,
    widgetType,
    state: widgetState,
    minimized: false,
    isPrimary: options?.isPrimary ?? false,
  }

  const existingPositions = get().panelPositions[targetPanelId] ?? []
  const maxZ = existingPositions.reduce((max, p) => Math.max(max, p.zIndex), 0)

  let newPosition: WidgetPosition
  if (options?.position) {
    newPosition = {
      widgetId,
      x: options.position.x,
      y: options.position.y,
      w: options.position.w,
      h: options.position.h,
      zIndex: maxZ + 1,
    }
  } else {
    const { canvasTransform } = get()
    // 用 canvas-container 实测 ccRect 计算视口中心（避免 React mount + 内联 style 的 CSS zoom quirk）
    const ccRect = document.querySelector('.panel-layer--active .canvas-container')?.getBoundingClientRect() ?? null
    if (!ccRect) {
      // 活动画布容器未找到（理论上不会发生），使用 fallback 坐标 (0, 0) 兜底
      console.warn('addWidget: canvas-container not found, falling back to (0, 0)')
    }
    let centerX: number
    let centerY: number
    if (ccRect) {
      const vc = getViewportCenterCanvas(ccRect, canvasTransform.zoom, window.innerWidth, window.innerHeight)
      // 钳制基点到非负区域：当画布向右平移较多时，视口中心可能对应 canvas 负坐标，
      // 此时在负坐标创建组件会导致"重置视图"后组件不可见。强制基点 >= 0 保证组件始终在
      // canvas 正坐标区域（重置视图后默认可见）。
      centerX = Math.max(0, vc.x)
      centerY = Math.max(0, vc.y)
    } else {
      centerX = 0
      centerY = 0
    }
    // 兜底钳制：确保最终位置非负（即使基点钳制后，减去 widget 一半宽高仍可能为负）
    newPosition = {
      widgetId,
      x: Math.max(0, Math.round(centerX - config.defaultLayout.w / 2)),
      y: Math.max(0, Math.round(centerY - config.defaultLayout.h / 2)),
      w: config.defaultLayout.w,
      h: config.defaultLayout.h,
      zIndex: maxZ + 1,
    }
  }

  const updatedWidgets = [...(get().panelWidgets[targetPanelId] ?? []), newWidget]
  const updatedPositions = [...existingPositions, newPosition]

  await withFallback(
    async () => { await widgetsApi.createWidget(targetPanelId, {
      id: widgetId,
      type: widgetType,
      x: newPosition.x,
      y: newPosition.y,
      width: newPosition.w,
      height: newPosition.h,
      zIndex: newPosition.zIndex,
      state: widgetState,
      isPrimary: options?.isPrimary ?? false,  // v10: 传入 isPrimary（修复 Issue 10）
    }) },
    () => saveWidgets(targetPanelId, updatedWidgets),
  )
  await withFallback(
    () => widgetsApi.batchUpdatePositions(updatedPositions.map(p => ({
      id: p.widgetId,
      x: p.x,
      y: p.y,
      width: p.w,
      height: p.h,
      zIndex: p.zIndex,
    }))),
    () => savePositions(targetPanelId, updatedPositions),
  )
  resourceSaveTracker.markSaved(widgetId)

  set(state => ({
    panelWidgets: { ...state.panelWidgets, [targetPanelId]: updatedWidgets },
    panelPositions: { ...state.panelPositions, [targetPanelId]: updatedPositions },
    ...setSaved(),
  }))
},
```

**调用方捕获示例**（所有创建 webPage widget 的入口都必须 try/catch）：
```typescript
// Omnibox.navigateToUrl / browserOpen / convertWidgetToTab / convertTabToWidget
try {
  await useAppStore.getState().addWidget('webPage', { ... })
} catch (e) {
  // 提示用户，不静默失败
  window.alert((e as Error).message)
  return
}
```

**F6 修复：非活跃面板 webview 暂停实现**：

**不修改 CSS**（保持 `visibility: hidden`，因为 `display: none` 会破坏画布坐标计算）。改为在 WebviewWidget 中监听面板切换，非活跃时调用 `webview.stop()` 暂停网络请求，并覆盖占位 div 阻止渲染。

**S12 修复**：F6 的 `isActive` 状态、`useEffect` 监听、以及合并后的 return JSX（含 toolbar + error + content(webview + placeholder)）已统一整合到 3.2 节 WebviewWidget 组件中，此处不再重复展示代码，避免两处 return 结构冲突。请参见 3.2 节的完整实现。

**说明**：
- `webview.stop()` 暂停当前网络请求和加载，减少 CPU/网络开销
- `visibility: hidden` 隐藏 webview 渲染输出（不破坏画布坐标，与 `display: none` 不同）
- 占位 div 阻止用户与非活跃 webview 交互
- 活跃面板切换回来时，webview 自动恢复（用户可手动 reload 刷新内容）

- 内存告警时自动清理非活跃 webview（通过 `app.on('memory-warning')` 监听，调用 `webview.reload()` 或关闭最久未用的 webview）

### 5.5 安全边界
- webview 内 `nodeIntegration=false`、`contextIsolation=yes`（在 webview 标签属性中指定）
- 禁止 webview 访问 `file://` 协议（除本地资源）
- Cookie 操作用主进程 `session.defaultSession.cookies` API（通过 IPC），**S1 修复：完全忽略 `params.cookie.domain`，强制使用 `urlObj.hostname`，拒绝跨域设置**
- `browser_eval` 有安全风险：AI 可能被提示注入攻击，仅靠 system prompt 约束不够。**S2/S13 修复：返回值用自定义 safeSerialize 递归序列化**（WeakSet 跟踪循环引用，移除函数/Symbol/DOM 节点/BigInt），防止恶意网页通过返回值注入。system prompt 中约束 AI 仅用于读取操作
- 截图仅截取可视区域（Electron webview 不支持 fullPage 截图）
- `browser_get_dom` **S9 修复：返回值截断到 100KB**，防止 WS 消息过大导致连接中断

---

## 六、风险与缓解

| 风险 | 缓解措施 |
|------|---------|
| webview 性能差 | 限制活跃 webview 数量 ≤ 5（S14：addWidget 中硬限制），非活跃时 webview.stop() + 占位 div（F6：不修改 CSS） |
| AI 工具调用超时 | S8 修复：浏览器工具单独 60s 超时（BROWSER_TOOL_TIMEOUT_MS），其他工具保持 30s（TOOL_TIMEOUT_MS 不变） |
| webview wheel 冲突 | wheel handler 开头检查 webview 标签，直接放行 |
| webview 拖拽冲突 | 仅 toolbar 区域（data-widget-drag-handle）触发拖拽 |
| Cookie 跨域风险 | S1 修复：完全忽略 params.cookie.domain，强制使用 urlObj.hostname |
| browser_eval 安全风险 | S2/S13 修复：返回值用自定义 safeSerialize 递归序列化（WeakSet 跟踪循环引用，移除函数/Symbol/DOM 节点/BigInt）+ system prompt 约束 AI 仅用于读取 |
| 标签页管理复杂 | 复用现有 Panel 数据结构，用 settings.url 存 URL（S7 修复（v8）：types/v2.ts PanelData.settings 添加索引签名 `[key: string]: unknown`，支持 url 等扩展字段） |
| Omnibox 输入歧义 | 明确前缀规则（ai: / / URL 搜索词），提供自动补全；M5 修复：isUrl 要求公共后缀 |
| WS 消息过大 | S9 修复：browser_get_dom 截断到 100KB |

---

## 七、测试要求

### 7.1 运行时验证（必须）
1. **Electron 启动**：`npm run dev` 能启动，TabBar/Sidebar 显示正常，系统托盘正常（F1/S11：mainWindow 模块级，createTray/createAppMenu 已调用）
2. **标签页管理**：新建/关闭/切换/重排标签页正常，关闭窗口最小化到托盘
3. **网页组件**：添加网页组件，打开贴吧/知乎，页面正常显示，能滚动
4. **AI 浏览器工具**：AI 对话"打开贴吧"，AI 调用 browser_open，网页组件创建并加载
5. **标签页转换**：网页组件右键"在新标签页打开"，标签页右键"转换为网页组件"（S10：验证右键菜单 UI 入口）
6. **Omnibox**：输入 URL 导航，输入搜索词搜索，Ctrl+L 聚焦（M13：无活跃面板时自动创建）
7. **Cookie 操作**：AI 调用 browser_get_cookie 获取贴吧 Cookie；browser_set_cookie 验证跨域被拒绝（S1）
8. **5-webview 硬限制**（S14）：添加 6 个网页组件，第 6 个应被拒绝并提示
9. **加载失败/超时**（S15）：输入无效 URL，验证错误 UI + 重试按钮；模拟慢网络验证 10s 超时
10. **非活跃面板暂停**（F6）：切换到其他面板，原面板 webview 应 stop() + 显示占位 div
11. **browserEval 安全序列化**（S2/S13）：AI 调用 browser_eval 返回 DOM 节点，验证返回 `[DIV]`（nodeName）而非原始对象；验证循环引用返回 `[Circular]`
12. **browserGetDom 截断**（S9）：在超大页面调用 browser_get_dom，验证返回值 ≤ 100KB + truncated 标记

### 7.2 测试日志
每次测试记录请求参数和响应内容，作为测试日志存档。

---

## 八、修订记录

### v8 修订版（2026-06-23）

**修复范围**：基于对 v7 的对抗审查，修复 3 个致命 + 8 个严重问题。

**致命问题（3 个）**：
- **F1**：`createWindow` 给出完整函数代码（对照 `main/index.ts` L8-L49），包含所有现有逻辑（`ready-to-show`、dev server URL 加载、`setWindowOpenHandler`、BrowserWindow 完整配置）+ 新增逻辑（`mainWindow` 模块级赋值、`webviewTag: true`、close/closed 事件监听），禁止用注释省略
- **F2**：Omnibox `navigateToUrl` 内部第一行添加 `url = normalizeUrl(url)`，确保 URL 无协议时自动补全 `https://`
- **F3**：useEffect 1 中监听 `dom-ready` 事件触发首次导航，解决 useEffect 2 在 webview 未就绪时跳过导航导致 webview 永远空白的问题

**严重问题（8 个）**：
- **S1**：useEffect 1 和 useEffect 3 的 cleanup 明确分工 — useEffect 1 只负责注册/注销 webview + dom-ready 首次导航；useEffect 3 只负责事件监听/清理 + loadTimeoutRef 清理 + state 提交（pendingRef + updateTimerRef），不重复注销 webview
- **S2**：`awaitReady` 用 `finally` 块清除 `setTimeout`，避免 Promise.race 中 dom-ready 先触发时 timer 泄漏
- **S3**：`awaitReady` 用 `readyMap`（`Map<string, boolean>`）判断就绪状态（而非 `getURL()` 不抛错），`registerWebview` 时初始化 ready 为 false 并监听 `dom-ready` 设为 true，`unregisterWebview` 时清理 readyMap
- **S4**：`browserScreenshot` 设置 visibility 后等待 `requestAnimationFrame` + `setTimeout(0)` 确保重绘；检查父元素（面板层 `.panel-layer--hidden`）是否也是 hidden，如果是临时移除该类；截图大小限制从 1MB 调整为 512KB
- **S5**：`addWidget` 给出完整函数代码（对照 `useAppStore.ts` L939-L1047），5-webview 检查逻辑插入到函数开头（生成 widgetId 之前），禁止用注释省略现有逻辑
- **S6**：`handleSlashCommand` 的 `/open` 命令调用 `normalizeUrl(arg)` 规范化 URL
- **S7**：`types/v2.ts` 的 `PanelData.settings` 添加索引签名 `[key: string]: unknown`，支持 `url` 等扩展字段
- **S8**：`createAppMenu` 在"视图"和"帮助"之间添加"面板"菜单（新建面板/管理面板），与 2.4 节菜单项描述一致

### v7 修订版（2026-06-23）

**修复范围**：基于对 v6 的对抗审查，修复 4 个致命 + 18 个严重 + 3 个中等 + 3 个轻微问题。

**致命问题（4 个）**：
- **F1**：`WebviewTag.addEventListener` 添加 `options` 参数重载（支持 `{ once?: boolean }`）
- **F2**：useEffect 3 所有事件监听器改为 `(e: unknown) => void`，内部用 `as` 断言为 S17 声明的事件类型（解决逆变导致的类型不兼容）
- **F3**：JSX `<webview>` IntrinsicElements 添加 `partition?: string` 属性声明
- **F4**：`safeSerialize` 处理 `undefined`（转为 `null`），`browserEval` 用 `JSON.stringify(safeResult ?? null)` 双重保护

**严重问题（18 个）**：
- **S1**：`awaitReady` 添加 10s 超时（Promise.race），避免 webview 卡死时永久挂起
- **S2**：`browserEval` 的 `Promise.race` 超时用 `finally` 块清除 `setTimeout`，避免 timer 泄漏
- **S3**：useEffect 3 cleanup 清除 `loadTimeoutRef`/`updateTimerRef`/`pendingRef`，并注销 webview
- **S4**：`webPageWidgetDef` 提供完整的 validateState/normalizeState/migrateState 实现（按现有 widget 定义模式，使用 `isObject`/`str`/`checkSchemaVersion` 辅助函数和 `{ ok, fallbackState, errors, state }` ValidationResult 结构）
- **S5**：`webviewConfig` 的 icon 提供具体 SVG（globe icon），使用 builtIn.tsx 现有的 `svg` 函数
- **S6**：`builtIn.tsx` import `webPageWidgetDef`，`widgetDefinitions.ts` export `webPageWidgetDef` 并加入 `allDefinitions` 数组
- **S7**：`useAppStore` AppState 接口新增 `sidebarCollapsed`/`toggleSidebar`/`convertWidgetToTab`/`convertTabToWidget`/`closeOtherPanels` 字段，并展示 create() 初始化对象
- **S8**：TabBar 完整实现（含 + 按钮、Omnibox 集成、HTML5 拖拽重排、中键关闭、右键菜单、双击重命名）
- **S9**：Sidebar 完整实现（含 header/panel-list/折叠状态 UI/footer，整合 S15 底部按钮区）
- **S10**：WebviewWidget/TabBar/Omnibox/Sidebar 补充 CSS 样式定义（追加到 index.css）
- **S11**：添加 useEffect 同步 `localUrl` 与 `state.url`，避免 prop 变化时输入框不更新
- **S12**：`createWindow` 明确说明"在现有 createWindow 基础上添加 mainWindow = 赋值、close/closed 事件监听，保留所有现有逻辑（ready-to-show、dev server URL、setWindowOpenHandler 等）"
- **S13**：`main/index.ts` import 合并为单条语句（`app, shell, BrowserWindow, Tray, Menu, nativeImage, ipcMain, session, MenuItemConstructorOptions`），Cookie IPC 不再重复 import session
- **S14**：托盘图标使用 `nativeImage.createEmpty()` 作为回退（兼容 PNG 文件不存在的情况）
- **S15**：`browserSetCookie` 检查 `data:`/`blob:` URL，提前拒绝
- **S16**：`window-all-closed` 在 `tray` 为 null 时回退到默认退出行为（避免 createTray 失败时进程残留）
- **S17**：electron.d.ts 声明 `LoadCommitEvent`/`DidFailLoadEvent`/`DidNavigateEvent`/`DidNavigateInPageEvent`/`PageTitleUpdatedEvent` 类型
- **S18**：useEffect 2（URL 导航）用 try/catch 包裹 `getURL()`，避免 webview 未就绪时抛错

**中等问题（3 个）**：
- **M1**：`showContextMenu` 的 `onClick` 类型改为 `() => void | Promise<void>`，支持 async onClick
- **M3**：动态 import 说明（用于避免循环依赖）
- **M5**：`WebviewWidgetState` 类型明确添加到 `types/index.ts`

**轻微问题（3 个）**：
- **L1**：`panel.settings?.url` 改为 `panel.settings.url`（settings 是必需字段）
- **L2**：`TOOL_TIMEOUT_MS` 仅新增 `BROWSER_TOOL_TIMEOUT_MS`，不重复声明
- **L3**：`handleSlashCommand` 明确"当前版本仅支持 /new-panel 和 /open，其他命令未来扩展"

### v6 修订版（2026-06-23）

**修复范围**：基于对 v5 的对抗审查，修复 2 个致命 + 17 个严重 + 3 个中等 + 2 个轻微问题。

**致命问题（2 个）**：
- **F1**：Omnibox `isUrl`/`normalizeUrl` 逻辑重写为 URL 构造 + try/catch，禁止 `javascript:`/`data:` 协议
- **F2**：WebviewWidget `useEffect` 拆分为 3 个独立 useEffect（注册/URL 导航/事件监听），用 `useRef` 缓存 `onUpdateState`

**严重问题（17 个）**：
- **S1**：删除 `<webview src>` 属性，由 useEffect 控制 `loadURL`
- **S2**：`convertWidgetToTab` 添加 `await updatePanelSettings`
- **S3**：`browser_eval` 添加 10KB code 限制、5s 超时、1MB 返回值限制
- **S4**：`browser_screenshot` 限制 1MB base64
- **S5**：`browser_input` 改用 `el.constructor.prototype`
- **S6**：`browser_wait_for` 改用 MutationObserver 单次 IPC
- **S7**：明确 registry 生命周期与 WebviewWidget 一致
- **S8**：添加 `awaitReady` 方法
- **S9**：明确 Shadow DOM/iframe 限制
- **S10**：明确 session.defaultSession.cookies 可获取 HttpOnly cookie
- **S11**：明确完整 webPreferences + partition 隔离
- **S12**：补充 executeViaWs 完整数据流图
- **S13**：5-webview 限制策略明确（只计算非隐藏面板，addWidget 抛 Error，convertTabToWidget 也受限制）
- **S14**：setLastActiveWidget 调用时机说明（来源 lastActiveWidgetId，不需要防抖）
- **S15**：面板菜单功能迁移到 Sidebar（底部增加"模板"和"自动布局"按钮）
- **S16**：Workspace wheel handler 排除 webview（正文给出完整代码）
- **S17**：WidgetContainer handleContainerMouseDown 检测 WEBVIEW（不 stopPropagation）

**中等问题（3 个）**：
- **M2**：browser_scroll 参数单位说明（amount 是像素，添加 unit 参数可选）
- **M5**：webview 的 partition（已在 S11 修复中添加）
- **M7**：browserToolBridgeRegistry 并发安全（webview.executeJavaScript 支持并发）

**轻微问题（2 个）**：
- **L2**：CATEGORY_LABELS 补充 `'web': '浏览器'` 标签 + CATEGORY_ORDER 追加 'web'
- **L5**：新增本修订记录章节

### v5（2026-06-23）

修复 5 个严重 + 8 个中等 + 2 个轻微问题。详见 v5 修订说明。

### v4（2026-06-23）

修复 6 个致命 + 13 个严重 + 2 个中等 + 2 个轻微问题。详见 v4 修订说明。
