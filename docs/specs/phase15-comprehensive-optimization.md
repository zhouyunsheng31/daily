# Phase 15：P7 补完 + 全方位优化（合并 Phase）

> 生成日期：2026-07-05（v2，已根据用户反馈 + 深度调研重写）
> 依据：用户反馈 + 桌面端 roadmap Phase 7 打磨（标记完成但实际从未实施）+ Phase 13 发布门禁部分项
> 关联文档：
> - [roadmap_desktop_v1.md](../roadmap_desktop_v1.md) Phase 7/13
> - [phase7-polish-optimization.md](phase7-polish-optimization.md) —— P7 spec（已写但从未实施，本 Phase 引用其详细任务分解）
> - [layout-design-desktop.md](../layout-design-desktop.md) 布局设计
> - [ui-prototype/desktop/index.html](../ui-prototype/desktop/index.html) UI 原型（权威）
>
> **本 Phase 性质**：P7 spec 标记完成但 git log 无 phase7 commit，实际从未实施。本 Phase 合并 P7 所有未完成项 + 用户新需求 + 新发现的 initialize 时序 bug 修复。
>
> **核心目标**：解决用户实际反馈的"浏览器完全用不了"问题，让产品真正可用
>
> **执行铁律**：写 Spec → 对抗审查 → 编码 → 对抗审查（含运行时验证）→ git commit

---

## 一、背景

### 1.1 用户反馈的真实问题

| # | 反馈 | 根因（已深度调研定位到代码行） |
|---|------|---------------|
| 1 | BrowserHome "连用都用不了，每次输入后都要卡很久才能进一步使用" | **三重叠加 bug**（见 1.2 节）：① `onboardingChecked` 提前解锁 ② `autoFocus` 在初始化期间生效 ③ 串行 API 循环占用主线程 2-5 秒。**不是架构问题，是 P7 未实施导致的实现 bug** |
| 2 | "现在连设置都没有" | [App.tsx:92](file:///f:/allmylife/event/client/desktop/src/App.tsx#L92) 中 `showUnifiedToolbar` 仅在 `mainView.type === 'canvas-panel' \|\| 'canvas-home'` 时为 true，**browser-home 模式下 UnifiedToolbar 不渲染** |
| 3 | "默认的也不是 bing 搜索引擎" | [types/index.ts:236](file:///f:/allmylife/event/client/desktop/src/types/index.ts#L236) 默认值 `'bing'` 正确，BrowserHome 调用链也正确。但 [browserToolBridge.ts:32](file:///f:/allmylife/event/client/desktop/src/utils/browserToolBridge.ts#L32) 的 `normalizeUrl` 在 AI 工具调用 `browser_navigate`/`browser_open` 时 fallback 用 Google。Omnibox.tsx:41 也用 searchEngine，需排查 |
| 4 | "安装包太原始了，要那种现代的安装包样式" | 当前 NSIS 用 electron-builder 默认 MUI 模板，视觉是 Windows 95 风格，远不如 VSCode/Notion 现代化 |
| 5 | UI 与原型不一致 | BrowserHome 用 logo.png + 文字 'Daily'，原型用渐变 LD 字母圆形 Logo + 'Living Dashboard' 文字。多处差异（AI 输入框形态、收藏组件网格按钮等） |

### 1.2 浏览器卡顿三重叠加 bug（新发现，P0 阻塞）

**杀手 #1：`onboardingChecked` 提前解锁**
- 位置：[useAppStore.ts:660-668](file:///f:/allmylife/event/client/desktop/src/stores/useAppStore.ts#L660-668)
- 问题：`onboardingPromise` 在第 663 行 `set({ onboardingChecked: true })` 提前解锁，但 `initialize()` 后面还有 ~400 行代码（含串行 API 循环），要执行 2-5 秒
- 后果：主界面在 `initialize()` 完成前就渲染，BrowserHome 挂载并 autoFocus

**杀手 #2：BrowserHome 的 `autoFocus`**
- 位置：[BrowserHome.tsx:200](file:///f:/allmylife/event/client/desktop/src/components/BrowserHome.tsx#L200)
- 问题：主界面刚渲染（initialize 还在跑），输入框就立即聚焦
- 后果：用户开始输入 → `onChange` 与后台 API 响应处理竞争主线程 → "输入后卡很久"

**杀手 #3：串行 API 循环**
- 位置：[useAppStore.ts:727-750](file:///f:/allmylife/event/client/desktop/src/stores/useAppStore.ts#L727-750)
- 问题：`for (const panel of panels) { await widgetsApi.getPanelWidgets(panel.id) }` 串行执行
- 后果：N 个面板 = N 个串行 HTTP 请求，初始化耗时 = N × RTT，10 个面板 = 2-5 秒

### 1.3 架构路线决策（已确认）

**用户疑问**："为什么不用 Chrome？为什么 Tabbit 可以用我们不能用？"

**调研结论**：
- Tabbit = fork Chromium（自己定制内核，支持 Chrome 扩展）
- 我们 = Electron + webview（被 Electron 包裹的 Chromium）
- 当前体验差的根因是 **P7 未实施 + initialize 时序 bug**，不是架构限制

**用户已确认方向**：先修 bug，再评估是否换架构。本 Phase 只修 bug + 补功能，不换架构。

| 维度 | 修 bug 后能否达到 | 备注 |
|------|------------------|------|
| 日常浏览 | ✅ | 网页渲染兼容性无差距 |
| AI 操控 | ✅ | 已实现 |
| 书签/历史/Cookie | ✅ | 已实现 |
| Chrome 扩展 | ❌ | 需 fork Chromium，本 Phase 不处理 |
| 大量标签性能 | ⚠️ | webview 共享 GPU，建议 < 20 个标签 |

---

## 二、任务清单（按批次 + 优先级）

### 批次 1：浏览器能用了（P0，先修能用）

#### 任务 1.1：修复 initialize 时序三重 bug（P0 阻塞）

**修复方案**（已根据对抗审查 v1 修订）：

| # | 修复点 | 文件 | 改动 |
|---|--------|------|------|
| 1 | `onboardingChecked` 不再提前解锁（try 块） | `client/desktop/src/stores/useAppStore.ts` | **只删除 try 块第 663 行**的 `onboardingChecked: true`（保留 `hasCompletedOnboarding` 设置）。**保留 catch 块第 666 行不变**（IDB 损坏容错场景必须立即解锁，否则永久卡死）。在第 1040 行 `await onboardingPromise` 后追加 `set({ onboardingChecked: true })` |
| 2 | BrowserHome 移除 autoFocus，延迟聚焦 | `client/desktop/src/components/BrowserHome.tsx` | 移除第 200 行 `autoFocus`，改为 `useEffect` 监听 `isInitializing` 完成后再 `inputRef.current?.focus()` |
| 3 | 串行 API 循环改并行（分批限并发） | `client/desktop/src/stores/useAppStore.ts` | 第 727-750 行 `for...of await` 改为分批并行：`Promise.all(chunks(panels, 5).map(batch => Promise.all(batch.map(...))))`，每批 5 个并发，避免大量面板时请求洪流 |
| 4 | `isInitializing` state（已存在，无需新增） | `client/desktop/src/stores/useAppStore.ts` | **isInitializing 已存在**（类型定义第 230 行、初始值第 562 行、set true 第 650 行、set false 第 941/1042 行），无需重复添加 |
| 5 | App.tsx 订阅 isInitializing 并用于 render | `client/desktop/src/App.tsx` | 在 App 函数顶部添加 `const isInitializing = useAppStore(s => s.isInitializing)`，在 `if (!onboardingChecked)` 判断**之前**添加 `if (isInitializing) return <SuspenseFallback />`（SuspenseFallback 已存在于 App.tsx:45-49） |

**验收标准**：
- [ ] 应用启动后 `initialize()` 完成前显示加载态（不渲染 BrowserHome）
- [ ] `initialize()` 完成后 BrowserHome 挂载，输入框聚焦
- [ ] 用 `performance.now()` 在 onChange 前后打点，单次按键处理时间 < 50ms
- [ ] Playwright 模拟连续输入 10 个字符，总耗时 < 500ms
- [ ] 10 个面板初始化耗时 < 1s（并行加载）

#### 任务 1.2：补 BrowserHome 设置入口（P0）

**根因**：[App.tsx:92](file:///f:/allmylife/event/client/desktop/src/App.tsx#L92) `showUnifiedToolbar` 排除了 browser-home

**修复方案**（已根据对抗审查 v1 修订，调整为主方案 + 后续优化）：

**主方案（P0，本批次必做）**：BrowserHome 顶部加齿轮按钮
- 文件：`client/desktop/src/components/BrowserHome.tsx`
- 改动：在搜索框右侧或顶部右上角添加 `Settings` 图标按钮（lucide-react 的 Settings 图标）
- onClick：`useAppStore.setState({ showSettings: true })`
- 工作量小，立即可用

**后续优化（P1，本 Phase 批次 5 处理）**：UnifiedToolbar 精简模式
- 文件：`client/desktop/src/components/UnifiedToolbar.tsx`
- 改动：添加 `mainView.type` prop 或订阅，条件渲染画布工具按钮
- 浏览器模式下仅显示：设置 + 新建面板 + 添加书签
- 注意：当前 UnifiedToolbar 硬编码 13 个按钮，无精简模式支持，需新增"添加面板"按钮（当前只有"添加组件"按钮，是往画布添加 widget，不是创建 panel）
- 工作量中等（0.5-1 天），放到批次 5

**验收标准**：
- [ ] BrowserHome 顶部有齿轮图标按钮
- [ ] 点击齿轮按钮打开 SettingsPanel
- [ ] SettingsPanel 中能看到搜索引擎设置

#### 任务 1.3：修复搜索引擎默认值与 fallback 逻辑（P0）

**根因再排查**（已根据对抗审查 v1 修订）：
- BrowserHome 默认就是 bing（[BrowserHome.tsx:59-63](file:///f:/allmylife/event/client/desktop/src/components/BrowserHome.tsx#L59-63) `isUrl(trimmed) ? normalizeUrl(trimmed) : buildSearchUrl(trimmed, searchEngine)`）
- 用户反馈"默认不是 bing"的可能真实根因：
  - AI 工具调用 `browser_navigate`/`browser_open` 时走 [browserToolBridge.ts:32](file:///f:/allmylife/event/client/desktop/src/utils/browserToolBridge.ts#L32) 的 `normalizeUrl` Google fallback
  - `Omnibox.tsx:41` 也用 `searchEngine`，需排查其调用链
  - 用户可能曾手动改过设置后又恢复

**修复方案**：

| 修复点 | 文件 | 改动 |
|--------|------|------|
| `normalizeUrl` 明确契约 | `client/desktop/src/utils/browserToolBridge.ts` | `normalizeUrl` 只负责 URL 规范化（补 scheme），非 URL 输入时返回 `about:blank`（不抛错，不返回 Google） |
| `browserNavigate`/`browserOpen` 调用前先判断 | `client/desktop/src/utils/browserToolBridge.ts` | 调用 `normalizeUrl` 前先用 `isUrl` 判断，非 URL 时用 `buildSearchUrl(query, searchEngine)` 走搜索引擎 |
| 排查 Omnibox 调用链 | `client/desktop/src/components/Omnibox.tsx` | 检查 `Omnibox.tsx:41` 附近的搜索 URL 构建逻辑，如有同样问题一并修复 |
| BrowserHome 调用链确认 | `client/desktop/src/components/BrowserHome.tsx` | 当前已正确：`isUrl(trimmed) ? normalizeUrl(trimmed) : buildSearchUrl(trimmed, searchEngine)`，无需改动 |

**验收标准**：
- [ ] BrowserHome 默认输入"测试"回车 → `https://www.bing.com/search?q=测试`
- [ ] BrowserHome 改为 Google → `https://www.google.com/search?q=测试`
- [ ] BrowserHome 输入 `example.com` → `https://example.com`
- [ ] AI 工具调用 `browser_navigate` 输入非 URL 时，用当前 searchEngine 搜索（不再 fallback Google）
- [ ] Omnibox 搜索逻辑与 BrowserHome 一致

#### 任务 1.4：BrowserHome 输入卡顿辅助优化（P0）

**根因**：SitePreview 未 memoize + 搜索框未独立 + 内联 style 重建 + App.tsx 订阅粒度问题

**修复方案**（已根据对抗审查 v1 追加遗漏项）：

| 修复点 | 文件 | 改动 |
|--------|------|------|
| SitePreview 包裹 `React.memo` | `client/desktop/src/components/SitePreview.tsx` | `export default memo(SitePreview)` |
| 搜索框抽独立 memo 组件 | `client/desktop/src/components/BrowserHome.tsx` | 新建 `SearchBox` 子组件，`useState` 局部化（批次 2 在此组件上继续迭代 pill 样式） |
| `homeBookmarks` 用 `useMemo` | `client/desktop/src/components/BrowserHome.tsx` | `useMemo(() => bookmarks.filter(b => b.showOnHome), [bookmarks])` |
| 抽取书签项为 memo 组件 | `client/desktop/src/components/BrowserHome.tsx` | 新建 `BookmarkCard` / `BookmarkRow` 子组件 |
| SitePreview webview 截图后卸载 | `client/desktop/src/components/SitePreview.tsx` | 截图完成后 `setAcquired(false)` 触发 webview 卸载 |
| 内联 style 抽常量 | `client/desktop/src/components/BrowserHome.tsx` | 不变的 style 对象抽到文件顶部 |
| App.tsx 拆分 settings 订阅 | `client/desktop/src/App.tsx` | 第 73 行 `useAppStore(s => s.settings)` 整体订阅改为按需订阅（appearance/behavior 分别订阅），避免任何 settings 变化触发 App 重渲染 |
| UnifiedToolbar 避免布局重排 | `client/desktop/src/components/UnifiedToolbar.tsx` | 第 134 行渲染期间同步调用 `getBoundingClientRect()` 触发 layout thrashing，移到 useEffect 或 useCallback |

**验收标准**：
- [ ] Playwright 模拟快速输入 20 个字符，无可见卡顿（无输入框冻结、无字符丢失）
- [ ] 输入期间 FPS > 30（用 PerformanceObserver 观察）
- [ ] 不渲染任何 webview（除非用户主动切到预览模式）

#### 任务 1.5：常用网站 Favicon 自动加载（P1）

**修复方案**：
- 常用网站列表的 Globe 图标改为真实 favicon
- 用 Google s2 favicon API：`https://www.google.com/s2/favicons?domain={domain}&sz=64`
- 失败时 fallback 到 Globe 图标
- 缓存到 localStorage（避免重复请求）

**验收标准**：
- [ ] 常用网站显示真实 favicon
- [ ] favicon 加载失败时显示 Globe 图标
- [ ] 重复访问不重复请求 favicon

---

### 批次 2：UI 视觉升级 + 搜索性能 + TitleBar 升级（P0+P1）

> **引用**：[phase7-polish-optimization.md](phase7-polish-optimization.md) 第三章"批次 1：UI 视觉升级"完整任务分解
>
> **v3 追加**：基于用户反馈"搜索延迟太高，达不到正常浏览器水准"和"标题栏没用"，新增任务 2.0（搜索性能）和任务 2.7（TitleBar 升级）

#### 任务 2.0：搜索性能优化（P0，对标 Chrome）

**根因**（基于深度调研，已定位到代码行）：

| # | 瓶颈 | 位置 | 影响 |
|---|------|------|------|
| 1 | **每个 webview 独立 partition**（最大瓶颈） | [WebviewWidget.tsx:342](file:///f:/allmylife/event/client/desktop/src/components/widgets/WebviewWidget.tsx#L342) `partition={persist:webview-${widgetId}}` | 永远冷启动 2-5s，Chrome 共享 session 热加载 < 500ms |
| 2 | onConsoleMessage 全量转发 IPC | [WebviewWidget.tsx:203-210](file:///f:/allmylife/event/client/desktop/src/components/widgets/WebviewWidget.tsx#L203-210) | 加载期间 50-200 次 IPC，累计 100-500ms |
| 3 | 三次独立 zustand set | [BrowserHome.tsx:498-500](file:///f:/allmylife/event/client/desktop/src/components/BrowserHome.tsx#L498-500) | 10-30ms 提交延迟 |
| 4 | WebTabFullscreen 全量订阅 webTabs | [App.tsx:537](file:///f:/allmylife/event/client/desktop/src/App.tsx#L537) | 任何 tab 变化触发重渲染，放大 set 影响 |
| 5 | Omnibox 动态 import useAppStore | [Omnibox.tsx:40,53,78,91](file:///f:/allmylife/event/client/desktop/src/components/Omnibox.tsx#L40) | < 5ms 但代码风格不一致 |
| 6 | Omnibox 每次回车新建 widget | [Omnibox.tsx:51-73](file:///f:/allmylife/event/client/desktop/src/components/Omnibox.tsx#L51-73) | 50-100ms，且不复用现有 tab |

**修复方案**（用户已确认：混合方案，默认共享 partition，隐私模式可选。v3.1 对抗审查修复）：

| # | 修复点 | 文件 | 改动 |
|---|--------|------|------|
| 1 | webview 共享 partition（默认） | `client/desktop/src/components/widgets/WebviewWidget.tsx` | `partition` 改为 `privacyMode ? 'persist:webview-private' : 'persist:webview'`，默认共享 session/cache。**privacyMode 订阅路径**：WebviewWidget 顶部 `const privacyMode = useAppStore(s => s.settings?.behavior?.privacyMode) ?? false`，partition 变化会触发 webview 重载（可接受，用户主动切换隐私模式时预期重载） |
| 2 | 隐私模式类型定义 + 默认值 | `client/desktop/src/types/index.ts` | `BehaviorSettings` 接口新增 `privacyMode: boolean`，`DEFAULT_BEHAVIOR` 设 `privacyMode: false`。**注意**：这是 P0 前置依赖，必须先于修复点 1 完成 |
| 3 | 隐私模式开关 UI | `client/desktop/src/components/SettingsPanel.tsx` | behavior 设置区加 Toggle 开关，调用 `updateBehavior({ privacyMode: !current })` |
| 4 | onConsoleMessage 采样 | `client/desktop/src/components/widgets/WebviewWidget.tsx` | 生产环境（`import.meta.env.PROD`）仅保留 `console.error`，dev 环境加 1% sampling（`Math.random() < 0.01`），避免大量 IPC |
| 5 | 合并 handleSearch 三次 set | `client/desktop/src/components/BrowserHome.tsx` | `updateWebTab` + `setActiveWebTab` + `setMainView` 合并为 `useAppStore.setState({...})` 单次提交。**已确认安全**：updateWebTab/setActiveWebTab/setMainView 都是纯 set，持久化通过 `useAppStore.subscribe` 监听 webTabs 变化触发，合并 set 仍触发 subscribe |
| 6 | WebTabFullscreen selector 优化 | `client/desktop/src/App.tsx` | 改为 `useAppStore(s => s.webTabs.find(t => t.id === tabId))`，只订阅当前 tab。**注意**：zustand v5 selector 返回新对象需用 shallow equal，但 `find` 返回的是数组中已有引用，引用稳定，无需 shallow |
| 7 | Omnibox 静态 import | `client/desktop/src/components/Omnibox.tsx` | 顶部 `import { useAppStore } from '../stores/useAppStore'`，移除动态 import |
| 8 | Omnibox 按 mainView.type 分支 | `client/desktop/src/components/Omnibox.tsx` | `navigateToUrl` 改为按 mainView.type 分支（**P0 必须**，否则破坏 canvas 模式）：<br>- `web-tab`：复用 `activeWebTabId`（如有），调 `updateWebTab(tabId, { url })`，否则 `addWebTab(url)`<br>- `browser-home`：`addWebTab(url)` + `setMainView({ type: 'web-tab', tabId })`<br>- `canvas-panel` / `canvas-home`：**保持当前 `addWidget('webPage', {...})` 行为**（canvas 模式下用户预期是新打开网页组件） |
| 9 | 预连接搜索引擎域名 | `client/desktop/src/components/BrowserHome.tsx` | `<link rel="preconnect" href="https://www.bing.com">` 注入 head，节省 100-200ms DNS+TLS |
| 10 | SitePreview 保持独立 partition | `client/desktop/src/components/SitePreview.tsx` | **不改**，保持 `partition="persist:preview"`（预览用，cookie 隔离避免污染主 session） |

**验收标准**：
- [ ] 同一网站第二次访问 < 500ms（共享缓存命中，用 Playwright 实测）
- [ ] 隐私模式开启时，webview 用独立 partition（cookie 不共享）
- [ ] 隐私模式关闭时，webview 共享 partition（cookie 共享）
- [ ] 提交搜索后 < 100ms 进入 webview 加载状态
- [ ] WebTabFullscreen 不因其他 tab 变化重渲染（用 React DevTools Profiler 验证）
- [ ] onConsoleMessage 在生产环境不转发 log 级别（仅 error）
- [ ] canvas-panel 模式下 Omnibox 回车仍创建新 widget（行为不变）
- [ ] browser-home 模式下 Omnibox 回车复用 webTab（不创建 widget）

#### 任务 2.1：默认主题切换为白色洁净色系

详见 P7 spec 第 3.2.1 节。关键改动：
- `index.css` :root 默认值改为亮色
- `types/index.ts` DEFAULT_APPEARANCE 改为亮色色值
- `App.tsx` 第 191-193 行 fallback 值改为亮色
- 新增 `--radius-full`、`--spacing-*`、`--radius-*` Token
- `prefers-color-scheme: dark` 自动切换暗色

#### 任务 2.2：新增 ResizableDivider 组件

详见 P7 spec 第 3.2.2 节。可拖拽分割线，支持水平/垂直，双击重置。

#### 任务 2.3：改造 App.tsx 引入 ResizableDivider

详见 P7 spec 第 3.2.3 节。Omnibox/TabBar 间、Sidebar/主区域间插入分割线。

#### 任务 2.4：改造 CanvasHome AI 对话框为收起式

详见 P7 spec 第 3.2.4 节。pill 形状收起态 + 展开态对话区域 + WS 状态指示。

#### 任务 2.5：pill 形状统一 + 移除实线边框 + BrowserHome 书签圆形图标

详见 P7 spec 第 3.2.5-3.2.7 节。

#### 任务 2.6：BrowserHome Logo 对齐原型

**根因**：BrowserHome 用 logo.png + 文字 'Daily'，原型用渐变 LD 字母圆形 Logo + 'Living Dashboard' 文字

**修复方案**：
- 新建 `LdLogo.tsx` 组件，渲染渐变 LD 字母圆形 Logo（用 SVG，不依赖图片文件）
- BrowserHome 顶部用 `<LdLogo>` 替换 `<img src={logoUrl}>`
- 文字改为 'Living Dashboard'

#### 任务 2.7：TitleBar Chrome 风格全合并（P0，用户新需求）

**根因**（基于深度调研）：
- TitleBar 已渲染但功能简陋：只显示 "Daily" + 3 个窗口按钮，占 36px 却没有 tabs/地址栏/菜单
- 标签页、地址栏、菜单全在下一行 `app-topbar`，浪费 40px 垂直空间
- 对比 Chrome：Chrome 把 tabs + omnibox + nav buttons + window controls 全部压在一行
- `titleBarOverlay` 死代码 bug：[main/index.ts:230-234](file:///f:/allmylife/event/client/desktop/electron/main/index.ts#L230) `frame: false` + `titleBarOverlay` 互斥，overlay 不生效，React 渲染失败时无兜底关窗手段

**修复方案**（用户已确认：Chrome 风格全合并。v3.1 对抗审查修复，拆分子任务 + 补充细节）：

**子任务 2.7-a：修复 titleBarOverlay 死代码 bug + 高度同步**（P0 前置）

| # | 修复点 | 文件 | 改动 |
|---|--------|------|------|
| 1 | 删除 `frame: false`，改用 `titleBarStyle: 'hidden'` | `client/desktop/electron/main/index.ts` | `frame: false` 删除，`titleBarStyle: 'hidden'`（跨平台统一，Windows 上等价于无框但保留 overlay 能力，macOS 自动保留 traffic lights）+ 保留 `titleBarOverlay: {...}`，React 渲染失败时有原生 3 按钮兜底 |
| 2 | titleBarOverlay.height 同步调整 | `client/desktop/electron/main/index.ts` | TitleBar 高度从 36px → 40px（容纳 tabs + omnibox），`titleBarOverlay.height` 同步改为 40 |
| 3 | TitleBar CSS 高度同步 | `client/desktop/src/index.css` | `.titlebar { height: 40px }`（原 36px） |

**子任务 2.7-b：TabBar 拆分 + 迁移进 TitleBar**（P0）

| # | 修复点 | 文件 | 改动 |
|---|--------|------|------|
| 1 | TabBar 移除 PinButton | `client/desktop/src/components/TabBar.tsx` | PinButton（"钉到画布"）从 TabBar 移除，迁移到 panel toolbar（画布模式下显示）。TitleBar 中不应有钉功能 |
| 2 | TabBar 迁移到 TitleBar 中间区域 | `client/desktop/src/App.tsx` + `client/desktop/src/components/TitleBar.tsx` | 移除 `app-topbar` 中的独立 TabBar 渲染，改为在 TitleBar 中间区域渲染 `<TabBar />`（保持组件独立性，只改变渲染位置） |
| 3 | TabBar CSS 适配 TitleBar | `client/desktop/src/index.css` | TabBar 高度从 40px → 36px（适应 TitleBar 40px 高度，留 4px padding），移除与 app-topbar 耦合的样式 |
| 4 | drag-drop 限制 | `client/desktop/src/components/TabBar.tsx` | HTML5 drag-drop 拖拽重排限制在 tabs 区域，右侧 138px（3 按钮 × 46px）禁用 drag-drop，避免与窗口控制按钮冲突 |

**子任务 2.7-c：Omnibox 迁移进 TitleBar**（P0）

| # | 修复点 | 文件 | 改动 |
|---|--------|------|------|
| 1 | Omnibox 迁移到 TitleBar | `client/desktop/src/App.tsx` + `client/desktop/src/components/TitleBar.tsx` | Omnibox 从 `app-topbar` 移到 TitleBar（在 tabs 右侧、窗口控制按钮左侧），做成 Chrome 风格单栏 |
| 2 | Omnibox CSS 重写 | `client/desktop/src/index.css` | Omnibox 当前 CSS 与 app-topbar 位置耦合，需重写为 TitleBar 内的样式（高度 28px，圆角 14px pill） |
| 3 | app-topbar 完全移除 | `client/desktop/src/App.tsx` + `client/desktop/src/index.css` | TabBar 和 Omnibox 都迁移后，`app-topbar` div 和相关 CSS 完全删除 |

**子任务 2.7-d：TitleBar 增强（菜单 + 主题 + 当前 tab 标题）**（P1）

| # | 修复点 | 文件 | 改动 |
|---|--------|------|------|
| 1 | TitleBar 左侧加汉堡菜单 | `client/desktop/src/components/TitleBar.tsx` | 左侧加汉堡按钮（☰），点击弹出菜单（复用 `menuApi.onMenuAction`），访问"文件/视图/面板"等功能 |
| 2 | TitleBar 显示当前 tab 标题 | `client/desktop/src/components/TitleBar.tsx` | 订阅 `activeWebTabId` + `webTabs`，显示当前 tab title 而非固定 "Daily"（web-tab 模式）；canvas 模式显示面板名；browser-home 显示 "Living Dashboard" |
| 3 | TitleBar 主题跟随 appearance | `client/desktop/src/components/TitleBar.tsx` + `client/desktop/src/index.css` | 改用 CSS 变量 `var(--bg-surface)`、`var(--text-primary)` 等，不硬编码 `#1e1e2e`，亮色/暗色自动跟随 |
| 4 | UnifiedToolbar 显示规则保持 | `client/desktop/src/App.tsx` | **不改**，保持当前 `showUnifiedToolbar = mainView.type === 'canvas-panel' \|\| 'canvas-home'` 逻辑，browser-home/web-tab 模式下 UnifiedToolbar 隐藏 |

**布局参考**（Chrome 风格）：
```
┌─────────────────────────────────────────────────────────────┐
│ ☰  [Tab1] [Tab2] [+]    [地址栏/Omnibox]      [_] [□] [✕] │  ← TitleBar（单栏，40px）
├─────────────────────────────────────────────────────────────┤
│                                                             │
│                     主内容区域                               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**执行顺序**（v3.1 对抗审查修复）：
- 2.7-a → 2.7-b → 2.7-c → 2.7-d（子任务顺序执行，前一个完成才能进下一个）
- **2.7 必须先于 2.3 执行**（2.3 的 ResizableDivider 是在 Sidebar/主区域间，2.7 删除 app-topbar，如果 2.3 先做会废弃）
- 2.5（pill 形状统一）与 2.7-c 在 Omnibox 样式上对齐（统一圆角值 14px）

**验收标准**：
- [ ] TitleBar 包含 tabs + omnibox + 窗口控制按钮（Chrome 风格单栏）
- [ ] 节省 40px 垂直空间（移除独立 TabBar 行）
- [ ] React 渲染失败时仍有原生 3 按钮兜底（titleBarOverlay 生效）
- [ ] TitleBar 主题跟随 appearance 设置（亮色/暗色切换）
- [ ] 当前 tab 标题显示在 TitleBar
- [ ] 菜单按钮可点击弹出菜单
- [ ] 三个窗口按钮（最小化/最大化/关闭）可点击工作
- [ ] TabBar 的 PinButton 已移除（迁移到 panel toolbar）
- [ ] drag-drop 不与窗口控制按钮冲突
- [ ] canvas-panel 模式下 UnifiedToolbar 仍显示
- [ ] browser-home/web-tab 模式下 UnifiedToolbar 隐藏

**验收标准**（整个批次 2）：
- [ ] 同一网站第二次访问 < 500ms
- [ ] 隐私模式开关可用
- [ ] 默认主题为白色洁净色系
- [ ] ResizableDivider 可拖拽，双击重置
- [ ] CanvasHome AI 对话框有收起态/展开态
- [ ] 所有搜索框为 pill 形状
- [ ] BrowserHome 用 LD Logo + 'Living Dashboard' 文字
- [ ] TitleBar Chrome 风格全合并（tabs + omnibox + 窗口控制）
- [ ] 与 [ui-prototype/desktop/index.html](file:///f:/allmylife/event/docs/ui-prototype/desktop/index.html) 截图对照视觉一致

---

### 批次 3：主页切换动画 + 嵌入按钮交互优化（P1）

> **引用**：[phase7-polish-optimization.md](phase7-polish-optimization.md) 第四章"批次 2"

#### 任务 3.1：主页切换动画

详见 P7 spec 第 4.1 节。用 CSS transition + React state 实现 fade + slide 动画，不引入 framer-motion。

#### 任务 3.2：嵌入按钮交互优化

详见 P7 spec 第 4.2 节。嵌入按钮有 loading/成功/失败状态反馈，替代 window.alert。

**验收标准**：
- [ ] mainView.type 切换时有 fade + slide 过渡动画
- [ ] 嵌入按钮有 loading 状态（旋转图标）
- [ ] 嵌入成功/失败有视觉反馈

---

### 批次 4：收藏组件管理 + 快捷键完善（P2）

> **引用**：[phase7-polish-optimization.md](phase7-polish-optimization.md) 第五章"批次 3"

#### 任务 4.1：收藏组件管理（排序/分组/搜索）

详见 P7 spec 第 5.1 节。

#### 任务 4.2：快捷键完善（16 个新增快捷键）

详见 P7 spec 第 5.2 节。

---

### 批次 5：设置完善 + 预览性能优化（P2）

> **引用**：[phase7-polish-optimization.md](phase7-polish-optimization.md) 第六、七章

#### 任务 5.1：设置完善

详见 P7 spec 第六章。补充搜索引擎选择、内存管理、AI 配置等。

#### 任务 5.2：预览性能优化

详见 P7 spec 第七章。SitePreview webview 池管理 + 截图缓存 + IntersectionObserver。

---

### 批次 6：安装包界面现代化（P1，用户新需求）

#### 任务 6.1：重做 NSIS BMP 资源

**当前**：installer-banner.bmp（150×57）+ sidebar.bmp（164×314）+ uninstaller-sidebar.bmp，视觉原始

**目标**：现代 Electron 应用风格（参考 VSCode/Notion/Figma）

**修复方案**：
- 用 SVG → PNG → BMP 工具链重新生成 BMP 资源
- banner 用品牌渐变背景 + LD Logo + 'Living Dashboard' 文字
- sidebar 用品牌渐变 + 功能图标示意 + 版本号
- uninstaller-sidebar 用同风格但不同色调（区分安装/卸载）

#### 任务 6.2：自定义 NSIS 现代化页面

**修复方案**：
- 安装选项页用自定义 NSIS dialog（不是默认 checkbox 列表）
- 增加"安装完成"页（带"运行应用"按钮）
- 卸载页增加反馈问卷链接（可选）
- 字体用微软雅黑（不是默认宋体）
- 按钮用品牌色

**验收标准**：
- [ ] 安装包 banner/sidebar 视觉现代
- [ ] 安装选项页布局清晰
- [ ] 安装完成页有"运行应用"按钮
- [ ] 字体为微软雅黑
- [ ] 实际 `npm run build:win` 生成 setup.exe 并安装验证

---

### 批次 7：冗余文件保守清理（P3，用户新需求）

**用户已确认**：保守清理

**清理范围**：

| 路径 | 类型 | 操作 |
|------|------|------|
| `.dev-userdata/` | 运行时缓存 | 删除（git ignore，运行时自动重建） |
| `docs/screenshots/m0/`、`docs/screenshots/m1/` | 早期里程碑截图 | 删除（git 历史可追溯） |
| `docs/verify/fix-webview-whitescreen/` | 一次性验证 | 删除 |
| `daily.png` 散落图 | 临时图 | 删除 |
| 模板残留 `react.svg`、`vite.svg` | 脚手架残留 | 删除 |

**保留**：
- 所有 phase11/12/13 历史验证截图（git 历史可追溯，但保留方便回看）
- 所有 spec 文档（不删除任何 .md）
- roadmap_v2/v3、layout-design 等历史文档

**验收标准**：
- [ ] 上述清理范围内文件已删除
- [ ] `npm run dev` 正常启动
- [ ] `npm run build` 正常通过
- [ ] git status 显示删除的文件

---

## 三、执行计划

### 3.1 批次依赖关系

```
批次 1（浏览器能用）← P0，先做
   ↓
批次 2（UI 视觉升级）← 依赖批次 1 的组件结构稳定
   ↓
批次 3（动画 + 嵌入按钮）  ← 并行，依赖批次 2
批次 6（安装包现代化）  ← 并行，独立
批次 7（冗余清理）  ← 并行，独立
   ↓
批次 4（收藏管理 + 快捷键）  ← 依赖批次 2/3
批次 5（设置 + 预览性能）  ← 依赖批次 4
```

### 3.2 每批流程

1. 编码实施
2. `npm run typecheck` 通过
3. `npm run build` 通过
4. 对抗审查（含 Playwright MCP 运行时验证 + 截图存证）
5. git commit
6. 进入下一批

### 3.3 Git 策略

- 新建分支 `feature/phase15`（从 main）
- 每批一个 commit
- 全部完成后合并到 main

---

## 四、验收标准（整体）

### 4.1 功能验收

- [ ] 浏览器主页输入不卡顿（initialize 完成后 < 16ms 单次按键响应）
- [ ] 浏览器主页有设置入口
- [ ] 默认搜索引擎为 bing
- [ ] UI 与原型视觉一致（截图对照）
- [ ] 安装包视觉现代化（实际安装验证）
- [ ] 冗余文件已清理

### 4.2 技术验收

- [ ] `npm run typecheck` 通过
- [ ] `npm run build` 通过
- [ ] `npm run build:win` 生成 setup.exe
- [ ] 实际安装 setup.exe 验证安装流程
- [ ] Playwright MCP 运行时截图存证（保存到 `docs/verify/phase15/`）

### 4.3 对抗审查验收

- [ ] 每批完成后对抗审查（用 adversarial-review skill）
- [ ] 审查必须包含运行时验证，不能只读代码
- [ ] 发现的问题全部修复后才能进入下一批

---

## 五、风险与约束

### 5.1 约束条件

- TypeScript 优先
- 不下载到 C 盘
- git 版本管理（每批 commit，新建 `feature/phase15` 分支）
- 与移动端数据互通（共享服务器数据库，新字段需向后兼容）
- 不破坏 Phase 0-6 + 8-14 已完成功能
- 所有改动须通过 `npm run typecheck` + `npm run build`

### 5.2 风险

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| initialize 时序修复破坏现有功能 | 中 | 高 | 逐项修复 + 每步 typecheck + 对抗审查 |
| UI 视觉升级影响布局 | 中 | 中 | 与原型截图对照，逐页验证 |
| NSIS 自定义页面兼容性 | 低 | 中 | 实际安装验证 |
| 串行 API 改并行后并发请求过多 | 低 | 低 | Promise.all 限制并发数（如 5） |

---

## 六、本 Phase 不处理的事项

明确排除（避免范围蔓延）：

- ❌ switchSession 不加载历史（Phase 8 遗留，本 Phase 不处理）
- ❌ permission_request 链路未实现（Phase 8 遗留）
- ❌ serverHealthCheck 端点未对齐（Phase 8 遗留）
- ❌ Chrome 扩展支持（架构限制，需 fork Chromium）
- ❌ fork Chromium / CEF 迁移（用户已确认先修 bug 再评估）
- ❌ 主页模板（P7 任务 5，复杂度高，本 Phase 暂不处理，留待后续）
- ❌ 文档任务（P7 任务 10，本 Phase 不创建新文档）

如这些事项需要处理，单独开 Phase。

---

## 七、变更记录

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-07-05 | v1 | 初版（误建，内容不完整） |
| 2026-07-05 | v2 | 重写：合并 P7 未完成项 + 用户新需求 + 新发现 initialize 时序 bug 修复。明确不换架构，先修 bug |
| 2026-07-05 | v2.1 | 对抗审查 v1 修订：修复 6 个 P0 问题（catch 块保留、isInitializing 已存在、订阅步骤补充、UnifiedToolbar 拆分到批次 5、搜索引擎根因再排查、normalizeUrl 契约明确）+ 6 个 M 问题（行号偏差、验收标准可测量性、批次冲突说明、性能遗漏补充、Omnibox 排查） |
| 2026-07-05 | v3 | 用户反馈"搜索延迟太高，达不到正常浏览器水准"和"标题栏没用"。批次2新增任务 2.0（搜索性能优化：共享 partition + 隐私模式 + onConsoleMessage 采样 + zustand 合并 + WebTabFullscreen selector + Omnibox 复用 tabId + 预连接）和任务 2.7（TitleBar Chrome 风格全合并：titleBarOverlay 修复 + 三段式布局 + tabs/omnibox 合并 + 主题跟随 + 菜单入口）|
| 2026-07-05 | v3.1 | 对抗审查 v3 修复 3 个 P0 + 5 个 P1 问题：①privacyMode 类型定义前置依赖 ②Omnibox 按 mainView.type 分支（canvas 模式保持 addWidget） ③删除 frame: false 改 titleBarStyle: 'hidden' ④SitePreview 保持独立 partition ⑤TabBar 迁移拆分子任务（PinButton 处理 + drag-drop 限制） ⑥titleBarOverlay.height 同步 40px ⑦UnifiedToolbar 显示规则保持 ⑧执行顺序 2.7 先于 2.3 |
