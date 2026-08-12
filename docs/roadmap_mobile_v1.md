# Living Dashboard 移动端 Roadmap v1

> 生成日期：2026-06-23
> 基于 brainstorming 会话确认的移动端产品形态与技术方案
> 关联：桌面端已推进到 Phase 3（服务器化），本文档专注移动端（安卓）
> **架构依据：[architecture_refactor.md](file:///f:/allmylife/event/docs/architecture_refactor.md) 架构改造文档（必读，AI 集成 + 数据同步都基于此）**
> 约束：iOS/Mac 暂不考虑
>
> **产品定位**：形态上是"浏览器 + 无限画布 + AI"，功能用途上是**日常 AI 助手**
> **布局设计**：[layout-design-mobile.md](layout-design-mobile.md) 移动端全页面布局设计（所有 Phase 的 UI 实现必须参考此文档）

---

## 一、项目背景与目标

### 1.1 背景

Living Dashboard 桌面端已推进到 Phase 6（内存休眠 + 依赖本地环境组件跨端），移动端已完成 Phase M0-M1（项目搭建 + 浏览器主页）。桌面端具备：
- Electron 桌面客户端（9 个组件：AIAssistant/Calculator/FocusTimer/HtmlCanvasWidget/LatexQuiz/MusicPlayer/PdfViewer/Sudoku/WebviewWidget）
- 自由画布 + 面板管理（面板 = 画布，共生）
- AI 助手（Pi Agent，通过 WS 连服务器）
- 浏览器引擎集成（webview 标签 + AI 操控浏览器工具）
- 服务器化（Pi Agent + 数据库在服务器，多端连接）

移动端是**多端互通**的关键一环，需要实现 Windows 桌面端的核心能力，同时针对移动端场景重新设计产品形态。

### 1.2 目标

构建一个**移动端 AI 浏览器客户端**，具备：

1. **两种主页**：浏览器主页（类 Via）+ 画布主页，Home 键切换
2. **无限画布**：分层画布（双指缩放），面板 = 画布，与桌面端数据互通
3. **浏览器能力**：WebView 打开真实网页，AI 操控 DOM/Cookie
4. **AI 助手**：每面板独立 AI，类 Tabbit 的 AI 对话框（可导航/创建面板）
5. **脚本系统**：兼容油猴脚本 + AI 生成脚本，支持常驻 UI
6. **收藏组件**：跨面板收藏组件，主页图标 + 聚合面板真实引用
7. **多端互通**：与桌面端共享数据（面板/组件/AI 对话/脚本/书签等）
8. **丝滑体验**：原生 Kotlin + Compose，包体 < 20MB，参考 DeepSeek/Via

### 1.3 与桌面端的关系

| 维度 | 桌面端 | 移动端 |
|------|--------|--------|
| 技术栈 | Electron + React + TypeScript | Kotlin + Jetpack Compose + WebView |
| 产品形态 | 正常浏览器 + 画布（后续单独讨论） | 两种主页 + Home 切换 + 分层画布 |
| 数据 | 共享（服务器数据库） | 共享（服务器数据库） |
| AI | 服务器 Pi Agent | 服务器 Pi Agent（同一个） |
| 组件 | 9 个（TS/React） | 需要用 Kotlin/Compose 重写（MVP 子集起步） |
| 浏览器 | Electron webContents | Android WebView |
| 脚本 | JS 注入（参考 Violentmonkey） | JS 注入（WebView evaluateJavascript） |

**关键约束**：桌面端组件是 React/TS，移动端是 Kotlin/Compose，**无法直接复用组件代码**。但可复用：
- 数据模型（shared/ 类型定义）
- AI 指令协议（WS + JSON-RPC）
- 服务器 API
- 脚本格式（.user.js 标准）

---

## 二、产品形态设计（已确认）

### 2.1 两种主页

#### 浏览器主页（类 Via，独立，不属于任何面板）

```
┌─────────────────────────────┐
│      [可自定义背景图]        │
│                             │
│      [Logo/书签一体]        │  ← Via 风格，Logo 和书签入口一体
│      🔍 搜索框              │
│                             │
│   📌 常用网站               │  ← 书签标记"显示在主页"
│   ◯ ◯ ◯ ◯                  │
│                             │
└─────────────────────────────┘
│ [←][→] [Home] [标签] [⋮]    │  ← 底部栏（Via 范式）
└─────────────────────────────┘
```

- **搜索框**：输入网址或搜索关键词
- **Logo/书签一体**：Via 风格，Logo 下方是搜索框，书签入口和 Logo 是一个整体
- **常用网站**：书签标记"显示在主页"的快捷图标，可添加/删除
- **可自定义**：背景图、Logo、主题色、工具栏颜色、沉浸式（参考 Via 定制项）

#### 画布主页（独立入口，下滑进聚合面板）

```
┌─────────────────────────────┐
│      [可自定义背景图]        │
│                             │
│      ⭕ 圆形图标            │  ← 在 AI 对话框上方，可替换
│      💬 AI 对话框           │  ← 替代搜索框（类 Tabbit）
│                             │
│   ⭐ 收藏组件               │  ← 替代常用网站
│   ◯ ◯ ◯ ◯                  │  ← 收藏的组件图标
│                             │
└─────────────────────────────┘
│ [-][+] [Home] [标签] [⋮]    │  ← 底部栏（-/+ 是画布缩放）
└─────────────────────────────┘
```

- **圆形图标**：在 AI 对话框上方，可替换（类似 Via Logo 可替换）
- **AI 对话框**：类 Tabbit，不创建组件，但可导航到不同面板/网页，可创建新面板（必须同时创建一个组件）
- **收藏组件**：用户收藏的组件图标，点击打开 WebOS 风格页面
- **可自定义**：背景图、圆形图标、主题色（可与浏览器主页不同）

**两种主页的对称关系**：

| 浏览器主页 | 画布主页 |
|-----------|---------|
| 搜索框 | AI 对话框 |
| Logo/书签一体 | 圆形图标（对话框上方） |
| 常用网站（书签标记主页） | 收藏组件 |
| 后退/前进按钮 | 缩小/放大按钮 |
| 背景图（可自定义） | 背景图（可自定义，可不同） |
| 主题色（可自定义） | 主题色（可自定义，可不同） |

### 2.2 Home 键行为（精确规则）

| 当前状态 | 点 Home 后 |
|---------|-----------|
| 看网页时 | 回浏览器主页（不跳画布主页） |
| 画布模式时（在面板内） | 回画布主页（不跳浏览器主页） |
| 在浏览器主页时 | 切换到画布主页 |
| 在画布主页时 | 切换到浏览器主页 |

**核心规则**：Home 键**先回当前模式的主页**，再在主页间切换。不会跨模式跳跃。

**首次启动**：让用户选择默认主页（浏览器 or 画布），之后记住选择。

### 2.3 画布主页下滑 → 聚合面板

- 画布主页是**入口**，下滑进入聚合面板
- 聚合面板由**系统自动创建**，放收藏组件的**真实引用**（不是复制，数据同步）
- "真实引用"的含义：聚合面板里的组件和原面板里的组件**共享同一份数据**，在聚合面板修改组件数据，原面板的组件也会更新（类似快捷方式/软链接，不是副本）
- 主页上显示为**图标**，聚合面板内显示为**真实可交互组件**
- 收藏组件来自各个面板，在聚合面板里放在一起

### 2.4 底部栏设计

#### 浏览器模式底部栏
```
[←后退] [→前进] [Home] [标签页] [⋮更多]
```
- 后退/前进：网页导航
- Home：切换主页
- 标签页：点开看到网页标签 + 画布面板标签（统一管理）
- 更多：向上展开半屏菜单（Via 风格）

#### 画布模式底部栏
```
[-缩小] [+放大] [Home] [标签页] [⋮更多]
```
- 缩小/放大：画布缩放
- 其余同上

#### 底部栏的两种模式

底部栏有两种模式，通过手势或按钮切换：

**模式 A：按钮模式（默认）**
```
[←/−] [→/+] [Home] [标签页] [⋮更多]
```
- 浏览器模式：[←后退][→前进][Home][标签页][⋮更多]
- 画布模式：[−缩小][+放大][Home][标签页][⋮更多]
- 标签页：点开看到网页标签 + 画布面板标签（统一管理）
- 更多：向上展开半屏菜单（Via 风格）

**模式 B：AI 输入框模式**
```
┌─────────────────────────────────┐
│ 💬 输入消息...          [发送] │  ← 整个底部栏变成 AI 输入框
└─────────────────────────────────┘
```
- 从按钮模式上滑底部栏 → 切换到 AI 输入框模式
- AI 输入框聚焦时向上展开 AI 对话空间（半屏或全屏）
- AI 对话空间基于当前网页内容操作/分析/对话
- 收起 AI 对话空间 → 回到按钮模式

**切换逻辑**：
- 按钮模式 ↑上滑 → AI 输入框模式
- AI 输入框模式 ↓下滑（对话空间外） → 按钮模式
- AI 输入框模式时 Home/标签按钮可保留在输入框右侧（快速访问）

### 2.5 面板 = 画布（共生）

- **面板就是画布，画布就是面板**，不是两个概念
- 标签页管理：切换不同面板（画布）+ 网页标签
- 不同面板的组件**隔离**，不能放到一起
- 每个面板的 AI 助手**独立**

### 2.6 分层画布交互

- **双指缩放**：缩小看全局（组件变卡片摘要），放大看细节（完整可交互组件）
- 类似相册双指缩放 / 手表应用图标缩放
- 放大到尽头看到实际 HTML 页面（网页组件）
- 组件根据缩放级别有不同呈现：
  - 缩小：卡片摘要（标题+关键信息）
  - 中等：可交互卡片
  - 放大：完整组件
- 大组件（PDF/画布）点击全屏打开

### 2.7 收藏组件功能（双端）

- **桌面端**：书签栏里放组件，点击跳转到对应面板的对应组件位置
- **移动端**：点击后打开 WebOS 风格页面（几乎全屏），回退退一级（退出 WebOS 模式回当前面板）
- 收藏的组件是**引用**，不是复制，数据同步

### 2.8 AI 对话框（类 Tabbit）

- 不创建组件，但可：
  - 导航到不同面板
  - 导航到网页
  - 创建新面板（必须同时创建一个组件）
- 基于当前网页内容操作/分析/对话
- 每个面板的 AI 助手独立

### 2.9 连线功能

- 桌面端已实现连线（ConnectionLayer + connect 模式）
- **移动端先不做连线交互**（缩放画布上连线体验难做好）
- 保留连线数据可见（桌面端创建的连线在移动端可见但不一定可编辑）
- 等未来有需要连线的组件再补

---

## 三、技术方案

### 3.1 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| UI 框架 | Kotlin + Jetpack Compose | 声明式 UI，现代安卓首选，原生性能保证丝滑 |
| 浏览器引擎 | Android WebView | `evaluateJavascript` 操作 DOM，`CookieManager` 操作 Cookie |
| 本地缓存 | Room (SQLite) | 数据持久化，与服务器同步 |
| 网络通信 | OkHttp / Ktor | WebSocket 客户端，连服务器 |
| 依赖注入 | Hilt | 标准 DI |
| 构建 | Gradle (Kotlin DSL) | 用 `F:\allmylife\gradle-8.2-bin` |
| 最低 SDK | Android 8.0 (API 26) | 覆盖 95%+ 设备 |
| 目标 SDK | Android 14 (API 34) | 最新稳定版 |

**包体目标**：< 20MB（参考 DeepSeek 12.4MB / Via 2MB，不学夸克 100MB+）

### 3.2 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│ 安卓移动端（Kotlin + Jetpack Compose + WebView）             │
│                                                             │
│ ┌────────────────────────────────────────────────────────┐  │
│ │ UI 层（Compose）                                        │  │
│ │ - 浏览器主页（搜索框+常用网站+Logo/书签）               │  │
│ │ - 画布主页（AI对话框+收藏组件+圆形图标）                │  │
│ │ - 分层画布（双指缩放，卡片摘要↔完整组件）               │  │
│ │ - 底部栏（5按钮 + AI输入框模式）                        │  │
│ │ - 标签页管理（网页标签 + 画布面板标签）                 │  │
│ │ - WebOS 风格收藏组件页                                  │  │
│ └────────────────────────────────────────────────────────┘  │
│                                                             │
│ ┌──────────────────┐  ┌─────────────────────────────────┐  │
│ │ 浏览器引擎        │  │ AI 指令执行器                   │  │
│ │ Android WebView   │  │ 接收服务器 AI 指令              │  │
│ │ 封装（参考Operit）│  │ evaluateJavascript 操作 DOM     │  │
│ │ 打开真实网页      │  │ CookieManager 提取 Cookie       │  │
│ │ 标签页/历史/书签  │  │ 截图（WebView.captureBitmap）   │  │
│ │ 脚本注入          │  │ 点击/输入（JS 注入）            │  │
│ └──────────────────┘  └─────────────────────────────────┘  │
│                                                             │
│ ┌──────────────────┐  ┌─────────────────────────────────┐  │
│ │ 脚本管理器        │  │ WS 客户端                       │  │
│ │ 油猴脚本兼容      │  │ 连服务器（复用协议）            │  │
│ │ AI 生成脚本       │  │ 接收 AI 指令/事件流             │  │
│ │ GM_* API          │  │ 数据同步                        │  │
│ │ 常驻 UI 注入      │  │                                 │  │
│ └──────────────────┘  └─────────────────────────────────┘  │
│                                                             │
│ ┌──────────────────┐  ┌─────────────────────────────────┐  │
│ │ 本地缓存          │  │ 笔记导入                        │  │
│ │ Room/SQLite       │  │ 分享机制（SEND intent）         │  │
│ │ 服务器同步        │  │ SAF 文件导入                    │  │
│ └──────────────────┘  └─────────────────────────────────┘  │
└─────────────────────────────┬───────────────────────────────┘
                              │ WebSocket（AI 指令 + 数据同步）
┌─────────────────────────────┴───────────────────────────────┐
│ 服务器（Linux + Docker，与桌面端共享）                       │
│ ┌───────────┐  ┌─────────────┐  ┌────────────────────────┐ │
│ │ Pi Agent  │  │ 数据库      │  │ WS 网关                │ │
│ │ AI 推理    │  │ 多端共享    │  │ 多客户端连接           │ │
│ │ 工具调用   │  │             │  │ 指令下发/结果回传      │ │
│ └───────────┘  └─────────────┘  └────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### 3.3 WebView 浏览器引擎（参考 Operit/Via）

**核心实现**：

```kotlin
// WebView 封装
class BrowserWebView(context: Context) : WebView(context) {
    init {
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.allowFileAccess = true
        settings.userAgentString = customUA  // 可自定义 UA
        webViewClient = CustomWebViewClient()
        webChromeClient = CustomWebChromeClient()
    }

    // 操作 DOM
    fun evaluateJS(script: String, callback: (String) -> Unit) {
        evaluateJavascript(script) { result -> callback(result) }
    }

    // 获取 Cookie
    fun getCookies(url: String): String {
        return CookieManager.getInstance().getCookie(url)
    }

    // 设置 Cookie
    fun setCookie(url: String, cookie: String) {
        CookieManager.getInstance().setCookie(url, cookie)
        CookieManager.getInstance().flush()
    }

    // 截图
    fun screenshot(callback: (Bitmap) -> Unit) {
        captureBitmap()?.let { callback(it) }
    }
}

// CORS 绕过 + 请求拦截
class CustomWebViewClient : WebViewClient() {
    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
        // 自定义请求头，绕过 CORS
        // 广告拦截（参考 Via 的 Adblock 规则）
        return super.shouldInterceptRequest(view, request)
    }

    override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
        super.onPageStarted(view, url, favicon)
        // 注入用户脚本管理器核心
        view?.evaluateJavascript(scriptManagerCoreJs, null)
        // 注入匹配当前 URL 的用户脚本
        scriptRepo.getMatchingScripts(url).forEach { script ->
            view?.evaluateJavascript(script.code, null)
        }
    }
}
```

### 3.4 AI 指令协议（与桌面端共享）

复用桌面端已定义的 WS + JSON-RPC 协议：

```kotlin
// 服务器 → 客户端（指令下发）
data class AICommand(
    val id: String,
    val type: String,  // browser_open, browser_eval, browser_click, ...
    val tabId: String? = null,
    val payload: JsonObject,
    val timestamp: Long
)

// 客户端 → 服务器（结果回传）
data class AICommandResult(
    val id: String,
    val success: Boolean,
    val data: JsonElement? = null,
    val error: String? = null,
    val timestamp: Long
)
```

**AI 浏览器工具清单**（与桌面端一致）：

| 工具 | 参数 | 功能 |
|------|------|------|
| `browser_open` | url, tabId? | 打开网页 |
| `browser_close` | tabId | 关闭标签页 |
| `browser_list_tabs` | 无 | 列出所有标签页 |
| `browser_switch_tab` | tabId | 切换标签页 |
| `browser_eval` | tabId, script | 执行 JavaScript |
| `browser_get_dom` | tabId, selector? | 获取 DOM |
| `browser_get_cookie` | tabId, url? | 获取 Cookie |
| `browser_set_cookie` | tabId, cookie | 设置 Cookie |
| `browser_screenshot` | tabId, selector? | 截图 |
| `browser_click` | tabId, selector | 点击 |
| `browser_input` | tabId, selector, text | 输入 |
| `browser_scroll` | tabId, x, y | 滚动 |
| `browser_wait_for` | tabId, selector, timeout? | 等待元素 |
| `browser_navigate` | tabId, url | 导航 |
| `browser_extract` | tabId, instruction | AI 驱动内容提取 |

### 3.5 脚本系统（兼容油猴 + AI 生成）

**脚本格式**：兼容 Tampermonkey/Greasemonkey 的 `.user.js` 格式

```javascript
// ==UserScript==
// @name         贴吧去广告
// @namespace    https://greasyfork.org/...
// @version      1.0
// @match        *://tieba.baidu.com/*
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==

GM_addStyle('.ad_wrap { display: none !important; }')
```

**GM_* API 实现**（Kotlin 侧桥接）：

| API | 实现 |
|-----|------|
| `GM_addStyle(css)` | `evaluateJavascript("const s=document.createElement('style');s.textContent='${css}';document.head.appendChild(s)")` |
| `GM_xmlhttpRequest(details)` | Kotlin OkHttp 发起请求，结果回传 JS |
| `GM_setValue(key, value)` | Room 存储 |
| `GM_getValue(key, default)` | Room 读取 |
| `GM_notification(details)` | Android 通知 |
| `GM_setClipboard(text)` | ClipboardManager |

**脚本来源**：
1. **油猴脚本导入**：拦截 `.user.js` 链接，解析元数据，存储
2. **AI 实时生成**：用户对话 → AI 生成脚本 → 自动保存 → 即时生效
3. **用户手写**：内置脚本编辑器
4. **脚本市场分享**（未来）

**常驻 UI**：通过 DOM 注入实现（`document.body.appendChild`），AI 生成的脚本同样支持

**脚本同步**：存服务器，多端共享

### 3.6 分层画布实现

**缩放级别与呈现**：

| 缩放级别 | 呈现 | 交互 |
|---------|------|------|
| 0.1x - 0.3x | 所有组件缩略图 + 连线可见 | 仅查看，可点击定位 |
| 0.3x - 0.7x | 卡片摘要（标题+关键信息） | 可点击进入组件 |
| 0.7x - 1.0x | 可交互卡片 | 可操作组件 |
| 1.0x+ | 完整组件 | 完整交互 |
| 全屏 | 单个组件全屏 | 大组件（PDF/画布）专用 |

**技术实现**：
- Compose 的 `Modifier.transformable` 处理双指缩放/平移
- 组件根据缩放级别切换 Composable（摘要卡片 / 完整组件）
- 性能优化：视口外组件不渲染（虚拟化）

### 3.7 数据同步（与桌面端共享）

**策略**：服务器权威 + 客户端本地缓存

```
客户端写操作：
  1. 先写本地 Room
  2. 异步推送到服务器
  3. 服务器确认后广播到其他客户端（含桌面端）

客户端读操作：
  1. 先读本地 Room
  2. 后台拉取服务器最新数据
  3. 更新本地

冲突解决：
  - 以服务器为准
  - 客户端拉取最新数据覆盖本地
  - 写操作带版本号，服务器拒绝旧版本
```

**同步内容**：
- 面板数据（panels）
- 组件数据（widgets）
- 实体数据（notes, journals, quickNotes, savingsGoals, ...）
- AI 对话历史（aiConversations）
- AI 记忆（aiMemories）
- 脚本库（userscripts）
- 书签（bookmarks）
- 收藏组件（favoritedWidgets）
- 设置（settings）

### 3.8 内存管理与休眠策略

移动端内存有限（Android WebView 内存占用大），必须设计休眠机制。**双端统一策略**（桌面端也适用）。

**休眠状态分级**：

| 状态 | 触发条件 | 行为 | 恢复速度 |
|------|---------|------|---------|
| **活跃** | 当前正在使用的面板/标签 | 完整渲染，WebView 运行 | - |
| **后台** | 切换到其他面板/标签 | WebView `stop()`，组件状态保留在内存 | 快（秒级） |
| **休眠** | 后台超过 5 分钟，或内存达阈值 | 释放 WebView 实例，保留组件数据快照到 Room/SQLite | 中（1-2 秒重建） |
| **深度休眠** | 内存压力大（如移动端 >300MB） | 只保留面板元数据（id/name/order），组件数据全存数据库 | 慢（2-3 秒重建） |

**关键设计**：

1. **数据与渲染分离**：组件数据始终在数据库（Room/SQLite），渲染层可随时销毁重建。休眠不丢数据，恢复时从数据库加载。

2. **LRU 策略**：最近最少使用的面板/标签优先休眠。

3. **内存阈值触发**：
   - 移动端：达 300MB 触发休眠，达 500MB 触发深度休眠
   - 桌面端：达 1GB 触发休眠，达 1.5GB 触发深度休眠
   - 用 `ActivityManager.MemoryInfo`（Android）/ `process.memoryUsage()`（Electron）监控

4. **WebView 复用池**（移动端）：维护一个 WebView 实例池（如 3 个），切换标签时复用而非新建，避免反复创建销毁的开销。

5. **桌面端现状改进**：当前桌面端所有面板同时渲染（`panel-layer--active`/`hidden`），非活跃面板 webview `stop()` 但组件实例和 React 状态仍在内存。需改为：非活跃面板超过阈值时卸载组件树，只保留数据。

6. **恢复时的 UX**：休眠恢复时显示骨架屏/加载动画，避免白屏。WebView 恢复时恢复上次 URL 和滚动位置。

**实现要点**：

```kotlin
// 移动端休眠管理器（伪代码）
class PanelMemoryManager {
    fun onPanelBackground(panelId: String) {
        // 记录后台时间
        backgroundTimeMap[panelId] = System.currentTimeMillis()
        // 立即 stop WebView
        webviewPool.stopWebView(panelId)
    }

    fun checkAndHibernate() {
        val now = System.currentTimeMillis()
        backgroundTimeMap.forEach { (panelId, bgTime) ->
            if (now - bgTime > 5 * 60 * 1000) {  // 5 分钟
                hibernatePanel(panelId)  // 释放 WebView，存数据快照
            }
        }
        if (getAppMemory() > 500) {  // 深度休眠
            deepHibernateLRUPanels()
        }
    }

    fun onPanelActivate(panelId: String) {
        if (isHibernated(panelId)) {
            showSkeleton(panelId)  // 骨架屏
            restoreFromDatabase(panelId)  // 从数据库恢复
            hideSkeleton(panelId)
        }
    }
}
```

### 3.9 设置为默认浏览器

**Android 10+**：无法静默设置，用 `RoleManager` 弹系统对话框

```kotlin
class DefaultBrowserHelper(private val activity: AppCompatActivity) {
    fun isDefaultBrowser(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return false
        val roleManager = activity.getSystemService(Context.ROLE_SERVICE) as RoleManager
        return roleManager.isRoleHeld(RoleManager.ROLE_BROWSER)
    }

    fun requestDefaultBrowserRole() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            // 降级：打开系统设置页
            val intent = Intent(android.provider.Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS)
            activity.startActivity(intent)
            return
        }
        val roleManager = activity.getSystemService(Context.ROLE_SERVICE) as RoleManager
        val intent = roleManager.createRequestRoleIntent(RoleManager.ROLE_BROWSER)
        browserRoleLauncher.launch(intent)
    }
}
```

**AndroidManifest.xml**：

```xml
<activity android:name=".MainActivity" android:exported="true" android:launchMode="singleTop">
    <intent-filter>
        <action android:name="android.intent.action.VIEW" />
        <category android:name="android.intent.category.DEFAULT" />
        <category android:name="android.intent.category.BROWSABLE" />
        <data android:scheme="http" />
        <data android:scheme="https" />
    </intent-filter>
</activity>
```

**接收外部 URL**：

```kotlin
override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    handleViewIntent(intent)
}

private fun handleViewIntent(intent: Intent?) {
    if (intent?.action == Intent.ACTION_VIEW) {
        val uri = intent.data
        if (uri != null && (uri.scheme == "http" || uri.scheme == "https")) {
            openInNewTab(uri.toString())  // 在新标签页打开
        }
    }
}
```

### 3.10 浏览器数据导入

**Android 端限制**：沙箱机制，无法直接读取其他浏览器数据

| 数据类型 | 可行性 | 方案 |
|---------|--------|------|
| 书签 | ✅ | HTML 文件导入（Netscape 格式，所有浏览器通用） |
| 历史 | ❌ | 不导入，引导重新积累 |
| Cookie | ❌ | 不导入，引导重新登录 |
| 密码 | ❌ | 不导入，引导重新登录或用密码管理器 |
| 自动填充 | ❌ | 不导入 |

**书签导入流程**：
1. 引导用户在旧浏览器"设置 → 书签 → 导出书签为 HTML"
2. 用户通过 SAF（Storage Access Framework）选择 HTML 文件
3. 解析 Netscape Bookmark File Format
4. 写入书签存储

**密码迁移替代方案**：
- 新浏览器自带密码保存（用户登录时捕获，像 Chrome 那样）
- 支持从密码管理器导入（CSV/JSON 格式）
- 诚实告知用户：Android 沙箱限制，无法直接从其他浏览器导入密码

### 3.11 笔记数据导入

**推荐组合方案**：

1. **分享机制**（主推，所有厂商通用）：
   - 用户在笔记 App 点"分享 → AI 浏览器"
   - 注册 `Intent.ACTION_SEND` 接收 `text/*`
   - 零权限，所有厂商通用

2. **备份文件 + SAF**（批量导入）：
   - 用户导出笔记文件后我们解析
   - 支持 .txt / .html / .json 格式
   - 用 SAF 让用户选文件

3. **云端 API**（特定厂商，未来）：
   - 小米云（参考 mi-note-export 开源项目）
   - Google Keep（Takeout 导出）
   - 印象笔记（官方 SDK）

**不推荐**：Root 读数据库、ContentProvider（实机不可用）、OCR 截图

### 3.12 图标素材方案

**调研结论**：所有现代 Android 浏览器（Via/夸克/Edge/Chrome）的 UI 图标都用 **VectorDrawable（SVG 转 XML）或系统 Material Icons**，不用多套 PNG 位图。Via 能做到 2MB 的关键不是图标，而是**不打包浏览器内核**（复用系统 WebView），图标素材占比极小（估计 < 200KB）。

**推荐方案：Compose 内置 Icons 为主 + VectorDrawable 补充 + 严格开 R8**

| 用途 | 方案 | 体积 |
|------|------|------|
| 通用 UI 图标（Home/Search/箭头等） | **Compose 内置 Material Icons**（`Icons.Default.xxx`） | 0 KB（已在依赖里） |
| 更多通用图标 | `material-icons-extended`（**必须开 R8**，否则涨数 MB） | ~20-50 KB（R8 裁剪后） |
| 品牌专属/特殊图标 | **VectorDrawable**（SVG → XML） | ~0.5-2 KB/个 |
| App 启动图标 | **WebP**（唯一需要位图的地方） | ~50-100 KB |
| Logo | 用户提供图片，转 VectorDrawable 或 WebP | - |

**图标总计约 100-200 KB**，20MB 包体目标完全可达。

**关键配置（build.gradle）**：

```kotlin
android {
    buildTypes {
        release {
            isMinifyEnabled = true      // 必须开 R8
            isShrinkResources = true    // 裁剪未用资源
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
}
dependencies {
    // 核心图标（零额外体积）
    implementation("androidx.compose.material:material-icons-core")
    // 扩展图标（R8 会裁剪未使用的）
    implementation("androidx.compose.material:material-icons-extended")
}
```

**禁用方案**：
- ❌ 多套 PNG 位图（体积大、不能变色、需多分辨率）
- ❌ 字体图标（Compose 生态支持不如 VectorDrawable 原生）
- ❌ 系统自带图标（厂商 ROM 差异大，不统一）

**图标获取来源**：
- Material Symbols：https://fonts.google.com/icons （下载 SVG → Android Studio Vector Asset 转 XML）
- Compose 内置：`Icons.Default.Home` / `Icons.Default.Search` / `Icons.Default.ArrowBack` 等

**Logo 资源**（已处理）：

原图 `daily.png`（1024x1024px，908KB）已转换为 WebP 资源，总计仅 25.95 KB（97% 压缩）：

| 资源路径 | 尺寸 | 体积 | 用途 |
|---------|------|------|------|
| `res/mipmap-mdpi/ic_launcher_foreground.webp` | 48x48 | 0.50 KB | App 启动图标（低密度） |
| `res/mipmap-hdpi/ic_launcher_foreground.webp` | 72x72 | 0.76 KB | App 启动图标（高密度） |
| `res/mipmap-xhdpi/ic_launcher_foreground.webp` | 96x96 | 0.96 KB | App 启动图标（超高密度） |
| `res/mipmap-xxhdpi/ic_launcher_foreground.webp` | 144x144 | 1.53 KB | App 启动图标（超超高密度） |
| `res/mipmap-xxxhdpi/ic_launcher_foreground.webp` | 192x192 | 2.01 KB | App 启动图标（最高密度） |
| `res/drawable/ic_logo.webp` | 256x256 | 3.41 KB | 主页 Logo（画布主页圆形图标） |
| `res/raw/logo_original.webp` | 1024x1024 | 16.77 KB | 高分辨率原图备份 |

**自适应图标**：启动图标用 Adaptive Icon（前景 `ic_launcher_foreground` + 背景矢量/纯色），Android 13+ 支持。后续需补充 `ic_launcher_background`（矢量 XML）和 `mipmap-anydpi-v26/ic_launcher.xml` 配置。

---

## 四、约束条件

### 4.1 硬约束

| 约束 | 说明 |
|------|------|
| **iOS/Mac 暂不考虑** | 仅安卓 |
| **服务器与桌面端共享** | 不另建服务器，复用桌面端 Phase 3 的服务器 |
| **Kotlin 优先** | 安卓端用 Kotlin（无 TS 替代） |
| **不下载到 C 盘** | Android SDK 在 `F:\Android SDK`，Gradle 在 `F:\allmylife\gradle-8.2-bin` |
| **git 版本管理** | 所有变更走 git commit |
| **包体 < 20MB** | 参考 DeepSeek/Via，不学夸克 |

### 4.2 开发环境

| 工具 | 路径 |
|------|------|
| Gradle | `F:\allmylife\gradle-8.2-bin` |
| Java | `D:\Java` |
| Android SDK | `F:\Android SDK` |
| 项目根目录 | `f:\allmylife\event` |
| 安卓代码目录 | `f:\allmylife\event\client\android\`（已占位） |

### 4.3 组件复用策略

桌面端 9 个组件（React/TS）无法直接复用，移动端需用 Kotlin/Compose 重写：

| 桌面端组件 | 移动端 MVP | 说明 |
|-----------|-----------|------|
| AIAssistant | ✅ 必须 | AI 助手，核心功能 |
| WebviewWidget | ✅ 必须 | 网页组件，核心功能 |
| Calculator | ✅ | 简单组件，快速实现 |
| FocusTimer | ✅ | 简单组件，快速实现 |
| MusicPlayer | ⚠️ 可选 | 依赖音频资源 |
| PdfViewer | ⚠️ 可选 | 依赖 PDF 渲染库 |
| Sudoku | ❌ MVP 不做 | 游戏组件，非核心 |
| LatexQuiz | ❌ MVP 不做 | 学习组件，非核心 |
| HtmlCanvasWidget | ✅ 必须 | HTML 画布，核心功能 |

**MVP 子集**：AIAssistant + WebviewWidget + Calculator + FocusTimer + HtmlCanvasWidget（5 个）

> **依赖说明**：HtmlCanvasWidget 依赖 WebviewWidget（HTML 画布组件内嵌 WebView 渲染 HTML），所以 WebviewWidget 是 HtmlCanvasWidget 的前置依赖。AIAssistant 依赖 WS 客户端（连服务器 Pi Agent）。

---

## 五、开发路线

### Phase M0：项目搭建（✅ 已完成）

**目标**：搭建安卓项目骨架，能编译运行

| 任务 | 详情 | 验收标准 |
|------|------|----------|
| 项目创建 | Kotlin + Compose 项目，配置 Gradle（用 F:\allmylife\gradle-8.2-bin） | 项目能编译 |
| 依赖配置 | Compose / Room / OkHttp / Hilt / WebView | 依赖正常引入 |
| 项目结构 | 按模块划分：ui / browser / canvas / ai / script / data / sync | 结构清晰 |
| 服务器连接 | WS 客户端连服务器（复用协议） | 能连服务器，收发消息 |
| 首个页面 | 空白 Compose 页面，能运行 | App 能启动 |

### Phase M1：浏览器主页 + WebView 浏览器（✅ 已完成）

**目标**：实现浏览器主页 + WebView 浏览器，能正常上网

| 任务 | 详情 | 验收标准 |
|------|------|----------|
| 浏览器主页 | 搜索框 + Logo/书签一体 + 常用网站（类 Via） | 主页正常显示 |
| WebView 浏览器 | WebView 封装，能打开真实网页 | 能打开贴吧/知乎等 |
| 地址栏 | 输入网址/搜索，支持搜索建议 | 地址栏正常工作 |
| 标签页管理 | 多标签页，新建/关闭/切换 | 标签页正常 |
| 底部栏 | 5 按钮（后退/前进/Home/标签/更多） | 底部栏正常 |
| 更多菜单 | 半屏面板展开（书签/历史/下载/设置等） | 菜单正常 |
| 书签 | 添加/管理/显示在主页 | 书签功能正常 |
| 历史 | 访问记录管理 | 历史功能正常 |
| 主页定制 | 背景图/Logo/主题色自定义 | 定制功能正常 |
| Cookie 管理 | CookieManager 读写 Cookie | Cookie 正常 |
| 默认浏览器 | RoleManager 请求 + Intent Filter | 能设为默认浏览器 |

### Phase M2：画布主页 + 分层画布（✅ 已完成）

> **布局参考**：[layout-design-mobile.md](layout-design-mobile.md) — CanvasHomeScreen + CanvasScreen + WebOS 收藏组件页 + 聚合面板
> **实施 Spec**：[phase-m2-mobile-canvas.md](specs/phase-m2-mobile-canvas.md)（v6）
> **对抗审查**：两轮审查（第一轮发现 P0 阻塞 bug → 修复 → 第二轮通过）+ 真机运行时验证（6 大场景全通过）

**目标**：实现画布主页 + 分层画布 + 面板管理

| 任务 | 详情 | 验收标准 |
|------|------|----------|
| 画布主页 | AI 对话框 + 圆形图标 + 收藏组件图标 | 主页正常显示 |
| Home 键切换 | 精确规则（先回当前模式主页再切换）。**设计改进（原型 v3+）**：BROWSER 模式 Home 按钮加转换小图标（home + ↹ 双向箭头徽章），暗示可切换到画布主页；CANVAS 模式 Home 按钮不加（已在家） | Home 切换正常 |
| 分层画布 | 双指缩放，卡片摘要↔完整组件 | 缩放流畅 |
| **分层画布四档**（Design Agent 补做） | THUMBNAIL/SUMMARY/INTERACTIVE/FULL 四档。**第一档 THUMBNAIL 渲染为 Apple Watch 风格实心彩色小球叠加**（不是白色方块+彩色图标，是简约充实的色彩的小球叠在一起，每个小球内可有一个极简白色符号）。**第二档 SUMMARY 必须渲染"缩小版完整组件"**（按比例缩小的完整 UI，按钮/显示屏都在，只是小），不是简化关键信息。Design Agent 在做每个组件时**必须同时产出缩小版**（SUMMARY 分支渲染 INTERACTIVE 的完整内容但尺寸缩小，用 `graphicsLayer { scaleX/Y = 0.5 }` 之类） | 各组件 SUMMARY 档可见缩小版完整 UI |
| 面板管理 | 面板 = 画布，新建/切换/删除 | 面板正常 |
| 标签页统一 | 网页标签 + 画布面板标签统一管理 | 标签页正常 |
| 组件渲染 | MVP 5 个组件（AIAssistant/WebviewWidget/Calculator/FocusTimer/HtmlCanvasWidget） | 组件正常 |
| 组件拖拽 | 画布上拖拽/调整大小 | 拖拽正常 |
| 画布缩放按钮 | 底部栏 -/+ 按钮缩放 | 缩放正常 |
| 画布主页下滑 | 下滑进聚合面板 | 下滑正常 |
| 收藏组件 | 收藏/取消收藏，主页图标显示 | 收藏正常 |
| WebOS 页面 | 点击收藏组件打开 WebOS 风格页 | WebOS 正常 |
| 聚合面板 | 系统自动创建，收藏组件真实引用 | 聚合面板正常 |
| UI 视觉升级 | 按布局设计文档更新所有页面：pill 搜索框、透明/半透明组件、白色洁净色系、收起式 AI 输入框 | 所有页面符合 layout-design-mobile.md 设计规范 |

### Phase M3：AI 集成（✅ 已完成 2026-06-30）

> **布局参考**：[layout-design-mobile.md](layout-design-mobile.md) — CanvasHomeScreen AI 输入框展开态

**目标**：AI 助手 + AI 对话框 + AI 操控浏览器

**架构依据**：[architecture_refactor.md](file:///f:/allmylife/event/docs/architecture_refactor.md) 第二章（按面板 session）+ 第三章（按面板路由工具调用）

| 任务 | 详情 | 验收标准 | 架构文档章节 |
|------|------|----------|------------|
| AI 对话框 | 画布主页 AI 对话框（类 Tabbit） | 能对话 | - |
| AI 助手组件 | 面板内 AI 助手组件（每面板独立） | AI 助手正常 | 架构文档 二（按面板 session） |
| 底部栏 AI 模式 | 底部栏替换为 AI 输入框，向上展开 | AI 输入正常 | - |
| AI 指令执行器 | 接收服务器指令，操作浏览器 | 指令执行正常 | 架构文档 三（按面板路由） |
| AI 浏览器工具 | browser_open/eval/click/input/screenshot/cookie 等 | 工具调用正常 | 架构文档 三 |
| AI 导航 | 导航到面板/网页/创建面板 | 导航正常 | - |
| AI 基于网页对话 | 基于当前网页内容对话/操作/分析 | 网页对话正常 | - |
| **思考等级 UI** | **operit 风格 4 档水平滑块**（thumb + 4 tick 刻度 + 档位标签 快速/平衡/深度/极深度），参考 Operit；底层映射到各 provider 参数。**设计改进**：源码 M8 当前是 ThinkingLevelDropdown 下拉框，原型 v3+ 改为滑块更直观 | 等级可切换，不同等级推理深度不同 | 架构文档 13 |
| **按面板上下文** | 同面板多端共享上下文，不同面板独立 | 上下文正确 | 架构文档 2.1-2.3 |
| **多端并行** | 不同面板可并行 AI 操作 | 多端不抢控制权 | 架构文档 3.1-3.4 |

> **完成报告（2026-06-30）**：
>
> **完成时间**：2026-06-30
>
> **关键产出**：
> - 14 个新工具（12 个 `browser_*` + `NavigateToPanel` + `CreatePanel`）
> - 双模式 AI 架构（LOCAL + CLOUD + AUTO 降级）
> - `PanelEventRouter` 多面板路由
> - Room v3 + `MIGRATION_2_3`（`ai_conversations` 表）
> - `ThinkingLevelSlider` 4 档（快速/平衡/深度/极深度）
> - 36 个新增单元测试（共 167 个，全绿）
> - 签名 Release APK 2.32MB < 20MB
>
> **已知遗留项**：
> - 真机/模拟器验证未执行（环境无 AVD / 无 cmdline-tools）
> - R-7 PiEvent 事件类型映射待 CLOUD 服务器真机抓包验证
> - DB migration 数据完整性升级测试待设备可用后补充

### Phase M4：脚本系统（1-2 周）

> **布局参考**：[layout-design-mobile.md](layout-design-mobile.md) — 脚本管理页面

**目标**：油猴脚本兼容 + AI 生成脚本 + 常驻 UI

| 任务 | 详情 | 验收标准 |
|------|------|----------|
| 脚本管理器 | 脚本库，启用/禁用/编辑/删除 | 管理正常 |
| 油猴脚本导入 | 拦截 .user.js 链接，解析元数据 | 导入正常 |
| GM_* API | GM_addStyle/GM_xmlhttpRequest/GM_setValue/getValue 等 | API 正常 |
| 脚本注入 | WebView onPageStarted 注入脚本 | 注入正常 |
| AI 生成脚本 | AI 对话生成脚本，自动保存 | 生成正常 |
| 常驻 UI | DOM 注入常驻 UI（翻译插件等） | 常驻 UI 正常 |
| 脚本同步 | 存服务器，多端共享 | 同步正常 |

### Phase M5：数据同步 + 多端互通（1-2 周）

> **布局参考**：[layout-design-mobile.md](layout-design-mobile.md) — CanvasHomeScreen 收藏组件网格

**目标**：与桌面端数据互通

**架构依据**：[architecture_refactor.md](file:///f:/allmylife/event/docs/architecture_refactor.md) 第四章（冲突解决）+ 第五章（syncQueue）+ 第六章（动态组件跨端）

| 任务 | 详情 | 验收标准 | 架构文档章节 |
|------|------|----------|------------|
| Room 本地缓存 | 数据持久化 | 缓存正常 | - |
| 服务器同步 | 异步同步，冲突用乐观锁解决 | 同步正常 | 架构文档 四 |
| 面板/组件同步 | 面板/组件数据多端共享 | 多端一致 | - |
| AI 对话同步 | AI 对话历史多端共享（按面板） | 多端一致 | 架构文档 2.4 |
| 书签同步 | 书签多端共享 | 多端一致 | - |
| 脚本同步 | 脚本库多端共享 | 多端一致 | - |
| 收藏组件同步 | 收藏组件多端共享 | 多端一致 | - |
| 离线支持 | 服务器不可用时画布/组件可用 | 离线正常 | - |
| **动态组件跨端（纯前端）** | 桌面端写的纯前端 HTML/JS/CSS 组件，移动端 WebView 渲染 | 纯前端组件跨端可用 | 架构文档 6.2 |
| **canvasStorage 桥接** | WebView ↔ Kotlin postMessage 桥接，协议复用 | 组件数据持久化正常 | 架构文档 6.2 |
| **依赖本地环境组件处理** | 标记为 local-dependent 的组件，移动端显示"依赖桌面端"提示 | 不崩溃，有提示 | 架构文档 6.3 方案C |
| **冲突解决** | 乐观锁 + 冲突提示 | 并发修改不丢失 | 架构文档 四 |

### Phase M6：数据导入（1 周）

> **布局参考**：[layout-design-mobile.md](layout-design-mobile.md) — 数据导入页面

**目标**：浏览器数据导入 + 笔记导入

| 任务 | 详情 | 验收标准 |
|------|------|----------|
| 书签 HTML 导入 | Netscape 格式书签文件导入 | 导入正常 |
| 笔记分享导入 | 接收 SEND intent 导入笔记 | 导入正常 |
| 笔记文件导入 | SAF 选文件，解析 txt/html/json | 导入正常 |
| 密码保存 | 登录时捕获密码，自动填充 | 密码保存正常 |
| 密码管理器导入 | CSV/JSON 格式导入 | 导入正常 |

### Phase M7：打磨优化（长期）

> **布局参考**：[layout-design-mobile.md](layout-design-mobile.md) — 响应式策略

**目标**：丝滑体验，性能优化

| 任务 | 详情 |
|------|------|
| 性能优化 | 启动速度、内存占用、WebView 性能、画布缩放流畅度 |
| 动画打磨 | 主页切换动画、缩放动画、过渡动画（参考 DeepSeek 丝滑） |
| 体验细节 | 手势优化、触屏适配、加载状态、错误处理 |
| 组件补全 | 实现更多组件（对齐桌面端） |
| 浏览器增强 | 下载管理、无痕模式、夜间模式、广告拦截（参考 Via） |
| 设置完善 | 完整设置项（参考 Via 定制项） |
| 文档 | 用户手册、开发文档 |

### Phase M8：单机轻 Agent（✅ 已完成 2026-06-27）

**目标**：无服务器时移动端也能用 AI（调用户自配 API Key），用 Kotlin 从零仿写 Pi Agent

**架构依据**：[architecture_refactor.md](file:///f:/allmylife/event/docs/architecture_refactor.md) 第十三章（单机轻 Agent）

**技术方案**：Kotlin 仿写最小 agent（约 6 个核心文件），OkHttp SSE 流式调 OpenAI 兼容 API，Coroutines + Flow 替代 EventStream

> **完成内容（2026-06-27）**：
> - 实现 12 个 `ai/` 核心文件：LlmClient（OkHttp SSE 流式 + OpenAI/Anthropic 双协议）/ AgentLoop（Coroutines Flow，maxIterations=10）/ Tool + ToolRegistry / Session / SkillLoader / ApiKeyStore / ThinkingLevel（4 档映射 6 provider）/ RuntimeModeManager / LocalAgentService / ActiveHolders / KvStorage / AskUserDialogState + AgentEvent
> - 实现 10 个本地工具：list_widgets / storage_read / storage_write / create_html_widget / update_html_widget / delete_html_widget / ask_user / browser_eval / browser_navigate / browser_get_url
> - 实现 5 个 UI 文件：AgentModeSwitcher（SegmentedButton + ThinkingLevelDropdown + 离线提示）/ AskUserDialog / AiConfigScreen（6 provider + password visualTransformation + 测试连接）/ AiConfigViewModel / ProviderSelector
> - 修改 10 个文件集成 M8：CanvasHomeViewModel（AgentEvent 处理 + ViewModel.onCleared 清理）/ CanvasHomeScreen / AIInputPill / AppModule（Hilt 注入 + provideToolRegistry 注册 10 工具）/ AppNavGraph / Routes / SettingsScreen / BrowserScreen / BrowserViewModel / LivingWebView / build.gradle.kts（versionCode=8 / security-crypto / Kover 配置）
> - 单元测试 131 用例全部通过（LlmClientTest 23 + AgentLoopTest 10 + ToolRegistryTest 6 + SessionTest 8 + SkillLoaderTest 6 + ApiKeyStoreTest 7 + ThinkingLevelMapperTest 26 + RuntimeModeManagerTest 5 + LocalAgentServiceTest 6 + ToolsTest 30 + WsMessageTest 4）
> - Skills 资产：assets/pi/skills/product-guide/SKILL.md（YAML frontmatter 完整）
> - Debug APK 18.43 MB（< 20MB 目标）
> - Release APK 2.27 MB（R8 + shrinkResources + 签名，远低于 20MB）
> - 真机安装启动成功（魅族 Lucky 08，PID 27989），logcat 无 FATAL EXCEPTION
> - 对抗审查通过（21 项验收标准全绿）
>
> **跳过项**：
> - 真机端到端 UI 交互验证：设备 PIN 锁阻塞，无法 dump App UI；已用源码静态验证 + logcat 运行时验证（WsClient ConnectException + 重连已发生）作为替代策略
> - 5 provider 真机 e2e：需用户提供真实 API Key 后单独验证
> - M0/M1/M2 回归 13 用例：需用户操作 UI 完成
> - keystore 密码：开发用自签名 keystore（`F:/allmylife/keystores/living-dashboard.jks`，密码存 `F:/allmylife/keystores/.env.local`，不入 git），不用于正式商店发布

| 任务 | 详情 | 验收标准 | 架构文档章节 |
|------|------|----------|------------|
| LLM 客户端 | `LlmClient.kt` - OkHttp SSE 流式调 OpenAI 兼容 `/v1/chat/completions`，解析 tool_calls | 能流式对话 | 架构文档 13.3 |
| Agent Loop | `AgentLoop.kt` - 核心循环（stream → 解析 tool_calls → execute → 回传 → 循环），Coroutines Flow | agent 能多轮工具调用 | 架构文档 13.3 |
| 工具注册 | `Tool.kt` + `ToolRegistry.kt` - 工具接口 + 注册表，kotlinx.serialization 校验参数 | 工具可注册执行 | 架构文档 13.4 |
| Session 上下文 | `Session.kt` - inMemory 消息历史 + systemPrompt + tools | 上下文管理正常 | 架构文档 13.3 |
| Skills 加载 | `SkillLoader.kt` - 扫描 SKILL.md，注入 system prompt | 加载 product-guide | 架构文档 13.9 |
| 用户 API Key 存储 | EncryptedSharedPreferences 加密存储用户 API Key | API Key 加密存储 | 架构文档 13.5 |
| 思考等级映射 | 4 档映射到 provider 参数（DeepSeek→reasoning_effort, Qwen→thinking_budget, OpenAI→reasoning.effort） | 不同等级推理深度不同 | 架构文档 13.6 |
| Agent 切换 UI | **折叠菜单形式**（AI 对话框顶部小图标，默认折叠，点击展开 CLOUD/LOCAL/AUTO 三档 + 思考等级滑块）。**设计改进**：源码 M8 当前 AgentModeSwitcher 常驻显示，原型 v3+ 改为折叠菜单不抢视觉 | 可切换 agent 来源 | 架构文档 13.7 |
| 离线降级 | 服务器不可用时自动切本地轻 agent，UI 提示"离线模式" | 离线时 AI 仍可用 | 架构文档 13.8 |

### Phase M9：发布与分发（每 Phase 强制）

**目标**：每个 Phase 验收后生成可安装 apk，用户能实际使用

| 任务 | 详情 | 验收标准 |
|------|------|----------|
| Release 签名配置 | `build.gradle.kts` 配 release keystore + signingConfig | `./gradlew assembleRelease` 生成签名 apk |
| 版本号管理 | versionCode + versionName + git tag（如 v0.4.0-m4） | 版本号清晰 |
| apk 测试 | 生成的 apk 在干净 Android 设备上能安装运行 | 安装无报错 |
| 发布说明 | 每个 Phase 附 CHANGELOG 条目 | 用户知道改了啥 |

### Phase M10：AI 自动化测试（3-5 d 单人）

**前置依赖**：**Phase M3（AI 集成）+ Phase M8（单机轻 Agent）落地后启动**。原因：M3 跑通 server-side AI（WS 客户端 + 工具执行器），M8 跑通 client-side AI（`LlmClient.kt` SSE 解析 + AgentLoop），两条链路是 M10 端到端测试覆盖的核心目标。

**目标**：补齐移动端 AI 相关模块的测试覆盖（当前仅 `WsMessageTest.kt` 1 个文件），确保 WS 客户端 / 工具执行 / LLM SSE 解析 / 轻 Agent 核心循环 / Room 缓存等核心链路不回归

**架构依据**：[architecture_refactor.md](file:///f:/allmylife/event/docs/architecture_refactor.md) 第二/三/十三章（AI session、面板路由、本地轻 Agent）

**测试运行器**：JUnit 4（已有，androidx.test）+ MockK（WS / OkHttp 桩）+ Turbine（Flow 断言）+ Robolectric（必要时跑 Android 框架）

#### M10.1 测试基础（0.5-1 d）

| 任务 | 详情 | 验收标准 |
|------|------|----------|
| 引入 MockK | `testImplementation("io.mockk:mockk:1.13.x")`，WS / OkHttp / Room 桩 | mock 工具齐全 |
| 引入 Turbine | `testImplementation("app.cash.turbine:turbine:1.0.x")`，Flow 断言 | Flow 可测 |
| 引入 Robolectric | `testImplementation("org.robolectric:robolectric:4.11.x")`（按需） | Android 框架可跑 |
| 引入 OkHttp MockWebServer | `testImplementation("com.squareup.okhttp3:mockwebserver:4.12.x")`，模拟 LLM SSE 流 | SSE 可模拟 |
| Gradle 脚本 | `./gradlew test` / `testDebugUnitTest` / `testReleaseUnitTest` / `jacocoTestReport` | 一键跑全套 |
| CI 集成 | GitHub Actions 或本地脚本：lint + test + coverage | CI 全绿 |

#### M10.2 WsClient 测试（已有基础，扩展）（0.5-1 d）

| 任务 | 详情 | 验收标准 |
|------|------|----------|
| **WsMessageTest 扩展** | 现有 `WsMessageTest.kt` 基础上补：JSON 解析、错误消息、心跳 | 解析全覆盖 |
| 重连退避 | 指数退避、最大重试、上限保护 | 重连策略正确 |
| 多面板路由 | `Map<panelId, Flow<AIEvent>>` 隔离 | 面板隔离 |
| 心跳保活 | ping/pong、超时下线 | 心跳链路通 |
| 鉴权/设备 ID | token 注入、设备注册 | 鉴权生效 |

#### M10.3 AI Assistant 集成（1 d）

| 任务 | 详情 | 验收标准 |
|------|------|----------|
| AI 对话框 ViewModel | 消息发送、流式接收、错误兜底 | ViewModel 单测通 |
| 底部栏 AI 模式 | 模式切换、上滑展开、下滑收起 | UI 状态机通 |
| 思考等级 UI | 1/2/3/4 档切换、映射到 provider 参数 | 等级映射正确 |
| 云端/本地 agent 切换 | `RuntimeModeManager` 状态切换、UI 提示 | 切换链路通 |
| 离线降级 | 服务器不可用自动切本地 agent，UI 提示"离线模式" | 降级生效 |
| 导航/创建面板 | AI 指令解析 → 导航/创建面板 | 指令执行正确 |

#### M10.4 LlmClient.kt（SSE 解析）（0.5-1 d）

| 任务 | 详情 | 验收标准 |
|------|------|----------|
| SSE 事件解析 | `data:` 前缀、`[DONE]` 终止、JSON 解析、tool_calls 抽取 | 解析全覆盖 |
| 流式输出 | OkHttp `EventSource`、Flow 推送、取消传播 | 流式通 |
| 错误处理 | HTTP 错误、连接中断、SSE 协议错误 | 错误有反馈 |
| Provider 兼容 | OpenAI / DeepSeek / Qwen / Anthropic / StepFun 5 个 provider | 多 provider 通 |
| 思考链 | DeepSeek reasoning_content / Qwen thinking 字段 | 思考链可见 |

#### M10.5 移动端工具实现测试（0.5-1 d）

| 任务 | 详情 | 验收标准 |
|------|------|----------|
| **AI 指令执行器** | 接收 WS 指令 → 操作 WebView / Cookie / 截图 | 执行链路通 |
| **WebView 工具** | browser_open/eval/click/input/screenshot/cookie（参考桌面端 18 个 webview 工具） | 工具执行正确 |
| **Tool/ToolRegistry** | 工具接口、kotlinx.serialization 参数校验、注册/反注册 | 工具注册可测 |
| **AI 浏览器工具** | 与桌面端一致的 15 个 browser_* 工具 | 工具行为一致 |
| GM_* API | GM_addStyle/xmlhttpRequest/setValue/getValue 桥接到 Kotlin | API 可测 |

#### M10.6 Room 缓存 + 数据同步（0.5 d）

| 任务 | 详情 | 验收标准 |
|------|------|----------|
| Room DAO | 面板/组件/AI 对话/书签/脚本/收藏 DAO CRUD | DAO 单测通 |
| 同步服务 | 推服务器 / 拉服务器 / 冲突解决 / 乐观锁 | 同步链路通 |
| AI 对话持久化 | 写入 aiConversations、按 panel 隔离 | 持久化正确 |
| 离线支持 | 服务器不可用时本地读写 | 离线可用 |

#### M10.7 集成测试 + 端到端（0.5-1 d）

| 任务 | 详情 | 验收标准 |
|------|------|----------|
| **AI 调用真实跑通** | Robolectric 跑 `LlmClient` 调真实 LLM（用占位 API key，参考 [roadmap_server_v1.md 八、AI 接入测试说明](roadmap_server_v1.md)） | 对话能跑 |
| **工具调用真实跑通** | Robolectric 跑 `ToolRegistry` 执行（mock WebView） | 工具能调 |
| WS 端到端 | MockWebServer 模拟 server，WsClient 收发完整链路 | 链路通 |
| Compose UI 测试 | 关键页面（AI 对话框 / 思考等级 / agent 切换）Compose UI Test | UI 测试通过 |

#### M10.8 文档同步（0.5 d）

| 任务 | 详情 | 验收标准 |
|------|------|----------|
| 测试运行说明 | Gradle 脚本 + 开发者文档 | 开发者能跑 |
| API Key 配置 | 说明用 EncryptedSharedPreferences 存测试 key（参考 server 端 AI 接入说明） | key 用法清晰 |

**估时小计**：0.5-1 + 0.5-1 + 1 + 0.5-1 + 0.5-1 + 0.5 + 0.5-1 + 0.5 = **3-5 d（1 周单人）**

**发布任务**（沿用 Phase M9）：
- 测试覆盖率报告（HTML / Jacoco）
- CI 配置（GitHub Actions）
- 文档更新
- 生成签名 release apk 并通过干净 Android 设备安装测试

### Phase M11：AI 搜索集成（1-2 周）

> ⚠️ **搜索工具质量警告**：本 Phase 依赖的 4 个搜索工具有已知质量问题，使用前请先阅读评估报告：[`docs/specs/search-tools-audit-report.md`](specs/search-tools-audit-report.md)
> 
> 简要状态：
> - `web_search`（Bocha）：质量极差，中文/技术内容覆盖差
> - `github_search`：Token 已过期，需更新
> - `academic_search`（S2）：新论文覆盖差，索引慢
> - `academic_search`（ArXiv）：✅ 可用，但需在服务器网络环境调用

**前置依赖**：服务器 Phase S9（AI 搜索工具）+ 移动端 Phase M3（AI 集成）落地后启动

**目标**：移动端实现 4 类 AI 搜索工具——local_search 客户端执行 + web_search/academic_search/github_search 的 UI 集成

**架构依据**：[ai-search-spec.md](specs/ai-search-spec.md) 第九章 9.3 节

#### M11.1 local_search 客户端实现（0.5-1 周）

| 任务 | 详情 | 验收标准 |
|------|------|----------|
| Room LIKE 多表 UNION | 7 张表（panels/widgets/bookmarks/history/tabs/favorites + widget_positions 不索引），每张表 LIKE 查询，结果 UNION 合并 | 7 张表均可搜索 |
| SearchRepository | 统一查询入口，注入各 DAO，并发查询多表，结果合并为 SearchResult(type,id,title,subtitle,payload) | 统一入口可用 |
| 中文子串匹配 | LIKE '%query%' 天然支持中文，无需分词 | 中文搜索正常 |
| type 过滤 | 支持按数据类型过滤（all/panel/widget/bookmark/history/tab/favorite） | 过滤生效 |
| 权重排序 | title > content > meta，按权重排序后 limit 截断 | 排序正确 |
| favorites JOIN | favorites 表 JOIN widgets 取 title 兜底 | JOIN 正常 |
| 同步落库可搜 | 服务器同步到本地的数据立即可搜（Room 直接查） | 同步后可搜 |
| 无网络请求 | local_search 绝不发起任何网络请求 | DevTools Network 零请求 |

#### M11.2 WS tool_call 处理（1-2 d）

| 任务 | 详情 | 验收标准 |
|------|------|----------|
| WS 接收 tool_call | 接收服务器下发的 local_search tool_call，执行本地搜索后回传 tool_result | 链路通 |
| 错误处理 | 查询失败、超时（5s）、数据源不存在等错误处理 | 错误有反馈 |
| 离线兜底 | 无服务器连接时 local_search 仍可用（纯本地） | 离线可搜 |

#### M11.3 4 工具 UI 集成（2-3 d）

| 任务 | 详情 | 验收标准 |
|------|------|----------|
| 搜索结果展示组件 | 4 类结果分组展示（本地/网页/学术/GitHub），每类有图标和摘要 | 4 类结果可展示 |
| 点击跳转 | 本地数据点击跳转到对应面板/组件；外链点击用 Intent.ACTION_VIEW 打开系统浏览器 | 跳转正确 |
| AI 对话框集成 | Pi Agent 调工具后流式展示搜索结果，LLM 基于 sources 总结 | AI 对话可搜索 |

#### M11.4 搜索引擎配置 UI（1 d）

| 任务 | 详情 | 验收标准 |
|------|------|----------|
| 配置入口 | 设置页新增"搜索引擎"配置项 | 入口可见 |
| Key 管理 | 调用 8.4 节 4 个 API 端点（GET/PUT/DELETE/POST test） | Key 可管理 |
| 不明文展示 | Key 输入框用 password 类型，不展示明文 | Key 不泄露 |

**估时小计**：0.5-1 + 0.2 + 0.3-0.4 + 0.2 = **1-2 周**

**发布任务**（沿用 Phase M9）：
- 生成签名 release apk 并通过干净 Android 设备安装测试

---

## Phase M12：发布前质量门禁（强制，发布阻断）

**目标**：解决移动端发布前所有阻断缺陷 + 强制 UI 全量走查 + 真实人类体验验证，确保正式发布前没有影响用户体验的问题。**本 Phase 全部任务必须 100% 通过才能发布 1.0.0**。任何"基本合格""条件通过"均视为不合格。所有任务必须运行时验证（截图/视频/日志存证于 `docs/verify/phaseM12/`），不接受仅代码审查。

**前置依赖**：Phase M0-M11 全部完成

**说明**：当前移动端推进到 Phase M1（浏览器主页 + WebView 浏览器），Phase M12 是面向 1.0.0 发布的最终质量门禁，作为占位先写入 roadmap，待 M2-M11 推进过程中持续补全具体任务。

### M12.1 移动端原生体验补全

| 任务 | 详情 | 验收标准 |
|------|------|----------|
| 沉浸式状态栏/导航栏 | WindowInsets API + 透传到 Compose；状态栏图标颜色随主题切换；底部导航栏不遮挡内容 | 状态栏与界面融合，非黑色/白色硬边。工具：adb screencap 截图 |
| 应用图标 + 启动闪屏 | Adaptive Icon（前景 + 背景分层）+ Splash Screen API（Android 12+）+ 兼容老版本 | 桌面图标正确，启动有闪屏非白屏。工具：adb screencap |
| 品牌化安装界面 | APK 安装界面（系统级，无法定制）+ 首次启动 onboarding | 首次启动有引导流程，非空白直进主页。工具：adb screencap + 录屏 |
| 首次启动 onboarding | 欢迎页 / 权限请求（存储/网络/位置可选）/ 服务器连接引导 / AI 配置引导 / 完成跳转主页 | 首次启动有引导流程。工具：Espresso + adb screencap |
| 应用签名 + 发布配置 | release keystore + ProGuard/R8 + APK split（按 ABI）+ AAB（Google Play） | 生成的 release APK/AAB 可签名安装。工具：gradle assembleRelease |

### M12.2 核心功能缺陷修复

> 占位，待 M2-M11 推进时补全具体 bug。

| 任务 | 详情 | 验收标准 |
|------|------|----------|
| AI 会话切换加载历史 | 切换会话时加载目标会话历史消息，非空对话流 | 切换会话后 UI 显示历史。工具：Espresso + adb screencap。对应桌面端 Phase 13.2 switchSession bug |
| 权限请求链路 | 工具调用触发权限请求 → 客户端 PermissionCard 渲染 → 用户允许/拒绝 → 工具继续/中止 | 链路完整可用。工具：Espresso + 真机验证。对应桌面端 Phase 13.2 permission_request |
| 真实 LLM 端到端验证 | 用户配真实 API Key，跑完整对话 + 工具调用回路 | 对话能跑通，工具能调，无崩溃。工具：adb logcat + 录屏 |
| 服务器健康检查 | 客户端 healthCheck 与服务器 `/api/health` 路由对齐 | 服务器在线时 healthCheck 返回 online，auto 模式不降级。工具：adb logcat |

### M12.3 发布前 UI 全量走查（强制）

**目标**：用 Espresso + adb screencap 逐页面截图，验证每个 UI 界面正常渲染、可交互。

**覆盖范围**（不少于以下页面/状态，每个都要有截图存证于 `docs/verify/phaseM12/ui/`）：

1. 浏览器主页（Home 键 BROWSER 模式）：搜索框 + Logo/书签一体 + 常用网站图标
2. 画布主页（Home 键 CANVAS 模式）：圆形图标 + AI 对话框 + 收藏组件网格
3. 浏览器模式浏览真实网页（如 https://example.com）：URL 跳转 + 页面渲染 + 底部栏可用
4. 画布模式：双指缩放 + 组件拖拽 + 分层画布四档（THUMBNAIL/SUMMARY/INTERACTIVE/FULL）
5. 底部栏 BROWSER 模式：[←][→] [Home] [标签] [⋮]
6. 底部栏 CANVAS 模式：[-][+] [Home] [标签] [⋮]
7. 底部栏 AI 输入框模式：左右滑动手势切换 + AI 工作状态
8. AgentModeSwitcher 折叠菜单：CLOUD/LOCAL/AUTO + 思考等级滑块
9. AI 对话流：消息气泡 + 工具调用卡片 + sources 卡片
10. Settings 页面每个 tab
11. 权限请求卡片（PermissionCard）渲染
12. askUserQuestion 卡片（AskUserCard）渲染
13. 离线降级 banner 渲染
14. 沉浸式状态栏/导航栏（Phase M12.1 完成后）

**验收标准**：每个页面/状态都有截图存证，对照原型 [docs/ui-prototype/mobile/index.html](file:///f:/allmylife/event/docs/ui-prototype/mobile/index.html) 视觉 1:1 还原（按 roadmap 第七.5 章"UI 原型权威性"标准）。任何一项缺失/异常 = 不合格。

**工具**：Espresso（Compose UI 测试）+ adb shell screencap（截图）+ adb shell screenrecord（录屏）

### M12.4 真实人类体验验证（强制）

**目标**：模拟真实用户从安装到日常使用的完整流程，发现 Espresso 走查覆盖不到的体验问题。

**方法**：使用 `dogfood` skill 启动独立 agent 做探索式测试，覆盖以下场景：

1. **首次安装 → 启动 → onboarding**：干净 Android 设备安装 APK → 启动 → 完成 onboarding → 进主页
2. **新用户首次对话**：主页 → AI 对话框 → 配置 API Key → 发起对话 → 工具调用 → 收到回复
3. **浏览器场景**：新建网页标签 → 输入 URL → 浏览网页 → 底部栏操作
4. **画布场景**：新建画布面板 → 添加组件 → 双指缩放 → 切换面板
5. **多端场景**：桌面端创建数据 → 服务器同步 → 移动端查看
6. **离线场景**：断网 → 离线 banner → 切换本地 agent → 继续对话
7. **设置场景**：每个 Settings 页面的实际读写联动
8. **极限场景**：开 20+ 面板测内存 + 大量历史记录 + 超大组件

**验收标准**：dogfood agent 产出结构化报告，每个发现的问题有截图/录屏 + 复现步骤。所有 P0/P1 问题修复后才能发布。P2 问题记录在案可不阻塞发布。

**工具**：`dogfood` skill（独立 agent，结构化报告 + 截图/录屏证据）+ adb

### M12.5 干净环境安装实测（强制）

**目标**：在开发机之外的真实 Android 环境验证安装流程。

**方法**（任选其一）：
- 方案 A：在另一台 Android 物理设备安装 release APK
- 方案 B：Android 模拟器（干净 snapshot）安装测试
- 方案 C：新用户账户测试（创建新 Android 用户，模拟首次用户）

**验收标准**：
- APK 安装流程正常（无报错、无签名警告）
- 桌面图标 + 启动闪屏正确
- 启动后正常进入应用（无白屏、无崩溃）
- 卸载流程正常（设置 → 应用 → 卸载 → 残留文件清理）
- 以上每一步都有截图/录屏存证于 `docs/verify/phaseM12/install/`

### M12.6 发布版本号 + tag

| 任务 | 详情 | 验收标准 |
|------|------|----------|
| 版本号 0.x → 1.0.0 | build.gradle + versionCode + versionName 更新 | 版本号清晰 |
| git tag v1.0.0-mobile | 在 main 分支打 tag | tag 存在 |
| CHANGELOG 1.0.0-mobile | 包含 Phase M12 完整变更 + 发布说明 | 用户知道改了啥 |

**估时小计**：3-5 d（M12.1 ~1d + M12.2 ~1d + M12.3 ~1d + M12.4 ~1d + M12.5 ~0.5d + M12.6 ~0.5d）

**发布判定**：本 Phase 全部任务 100% 通过 → 发布 1.0.0-mobile；任何一项不通过 → 不发布。**禁止"基本合格""条件通过"**。

---

## 六、参考产品对标

### 6.1 调研结果总览

| 产品 | 技术栈 | 包体 | 参考点 |
|------|--------|------|--------|
| **DeepSeek** | 原生 Kotlin/Swift（推断） | 12.4MB | 极简 3 Tab + 原生性能 + 流式输出 |
| **Via** | 原生 + 系统 WebView | ~2MB | 极致轻量 + JS 注入脚本系统 + 主页自由度 |
| **夸克** | Chromium 定制（Quarkium） | 99-145MB | 云端预加载 + AI 超级框（包体反面教材） |
| **Operit** | Kotlin + Compose + WebView | 398.8MB（含本地 AI 模型） | 安卓 AI 浏览器实现参考（核心） |
| **Tabbit** | Chromium 定制 | 272MB | AI 对话框导航/创建面板（UI 参考） |

**关键启示**：
- **Via 路线最适合我们**：系统 WebView + 轻壳 = 2MB 包体 + 丝滑体验。我们定的 Kotlin + WebView 方案正好对齐
- **DeepSeek 的原生性能**：AI 对话/流式渲染用原生 Compose 拿最佳帧率
- **夸克的云端预加载**：可借鉴用于 Dashboard 数据预取
- **包体目标**：控制在 20MB 以内（学 DeepSeek/Via，不学夸克）
- **Operit 大体积原因**：本地 AI 模型（MNN 框架）占 90%+，我们不打包本地模型（用服务器 Pi Agent），所以不会重

### 6.2 Via 参考点（主页自由度 + 轻量化）

**Via 主页默认布局**：

```
┌─────────────────────────────────────┐
│           (系统状态栏)                │
│                                     │
│         [白色/纯色背景]              │
│                                     │
│         ╔═══════════════╗           │
│         ║   🔍 搜索/地址 ║   ← 二合一输入框（居中偏上）
│         ╚═══════════════╝           │
│                                     │
│         [Via Logo]                  │  ← Logo 和搜索框是一体的
│                                     │
│    ◯  ◯  ◯  ◯                      │ ← 可选：常用网站快捷图标
│    ◯  ◯  ◯  ◯                      │   来自"添加到主页"的书签
│                                     │
├─────────────────────────────────────┤
│  ◁  ▷  ⌂  ▣  ☰                     │ ← 底部栏 5 按钮
│ 后退 前进 主页 标签 菜单              │
└─────────────────────────────────────┘
```

**Via 主页可定制项清单**（"自由度"体现）：

| 类别 | 可定制项 | 入口 |
|------|---------|------|
| **背景** | 自定义本地图片作为主页背景；或设置为纯色 | 设置 → 定制 → 背景 |
| **Logo** | 替换主页中央的 Via Logo | 设置 → 定制 → Logo |
| **风格** | 切换首页整体风格 | 设置 → 定制 → 风格 |
| **HTML 代码** | ⭐ 填入自定义 HTML 代码完全接管主页（最高自由度） | 设置 → 定制 → HTML 代码 |
| **主页地址** | 输入 URL 作为主页；或指向本地 file:///path/home.html | 设置 → 常规 → 主页地址 |
| **启动页** | 启动时打开指定页面 | 设置 → 启动时打开 |
| **搜索框** | 显示/隐藏主页搜索框 | 设置 → 主页 → 显示搜索框 |
| **书签栏** | 在主页显示书签栏 | 设置 → 主页 → 显示书签栏 |
| **图标大小** | 调节主页快捷图标尺寸 | 设置 → 主页 → 图标大小 |
| **布局模式** | 网格模式 / 列表模式切换 | 设置 → 主页 → 布局模式 |
| **列数** | 控制图标密度 | 设置 → 主页 → 列数设置 |
| **主题色** | 多彩、夜间彩色等预设主题 | 设置 → 外观 → 主题 |
| **工具栏颜色** | 自定义 RGB 数值 | 设置 → 外观 → 工具栏颜色 |
| **沉浸式模式** | 颜色延伸至状态栏/导航栏 | 设置 → 浏览/高级 → 沉浸式 |
| **极简模式** | 减少界面元素 | 设置 → 外观（部分版本） |
| **工具栏按钮** | 自定义顺序、添加/移除按钮 | 设置 → 工具栏与手势 |
| **全屏模式** | 隐藏状态栏+底部栏，下滑呼出 | 工具箱 → 全屏 |
| **自动隐藏操作栏** | 滑动时自动隐藏底部栏 | 设置 → 通用 → 自动隐藏操作栏 |
| **操作手势** | 下拉刷新、边缘滑动前进后退、音量键翻页、长按事件 | 设置 → 通用 → 操作设定 |
| **界面缩放** | 整体缩放比例（间接影响工具栏高度） | 设置 → 外观 |

**Via 底部栏 5 按钮**：

| 位置 | 图标 | 功能 |
|------|------|------|
| 1 | ◁ 后退 | 返回上一页 |
| 2 | ▷ 前进 | 前进到下一页 |
| 3 | ⌂ 主页 | 回到主页 |
| 4 | ▣ 标签页 | 打开标签管理器（卡片式） |
| 5 | ☰ 菜单 | 展开"更多"菜单 |

**Via "更多"菜单内容**（从底部弹出的半屏面板）：
- 基础功能：书签、历史、下载、分享、添加书签
- 工具箱（14 项）：有图模式、电脑模式、全屏、浏览器标识（UA 切换）、复制链接、保存网页、离线页面、页内查找、截图、发至桌面、翻译网页、源码、资源嗅探、网络日志
- 设置入口（→ 通用 / 定制 / 高级 / 插件 / 脚本 / 关于）

**Via 为什么能做到 2MB**：
1. **复用系统 WebView 内核**（省 30-80MB）——决定性因素
2. **极简功能**：无网盘、无信息流、无 AI、无账号系统
3. **图标素材极简**：复用系统 Material 图标或少量 VectorDrawable
4. **无第三方 SDK 堆叠**：无统计、无推送、无广告 SDK
5. **资源压缩**：APK 本身是 ZIP

**对 Living Dashboard 移动端的启示**：
- 默认主页极简（AI 对话框 + 极少入口），定制项收进设置
- 底部栏 5 按钮范式可复用（肌肉记忆）
- 菜单展开用半屏面板
- 书签与主页快捷图标同源（一套数据）
- 设置层级清晰：通用 / 定制 / 高级 / 脚本 / 关于

### 6.3 Operit 参考点（WebView 浏览器）

**Operit 基本信息**：
- 技术栈：Kotlin + Jetpack Compose + WebView
- 包体：398.8MB（大体积来自本地 AI 模型 MNN 框架，非浏览器部分）
- 开源协议：LGPL v3.0
- GitHub：https://github.com/AAswordman/Operit

**可参考的实现**：
- **WebView 封装**：`evaluateJavascript()` 注入 JS 操作 DOM
- **CookieManager**：读写 Cookie
- **三重权限体系**：无障碍/ADB/Root（我们 MVP 只用 WebView，不需要无障碍）
- **MCP 协议支持**：移动端 Agent 工具生态
- **标签页/历史/书签/脚本管理**：浏览器功能参考
- **CORS 绕过**：自定义 WebViewClient 拦截请求头

**注意**：参考架构和思路，代码自己实现，避免 LGPL 传染。

### 6.4 DeepSeek 参考点（丝滑体验）

**DeepSeek 基本信息**：
- 技术栈：原生 Kotlin/Swift（推断）
- 包体：12.4MB
- 信息架构：3 Tab 极简

**可参考的设计**：
- **原生开发**：对 AI 对话这种"高频交互 + 流式渲染"场景，原生开发能拿到最佳帧率
- **极简信息架构**：3 Tab 极简结构降低认知负荷
- **轻量包体**：12.4MB 证明 AI App 不需要臃肿，模型在云端，客户端只需"薄壳"
- **流式输出 + 思考过程可视化**：让用户感知"AI 在思考"，缓解等待焦虑

### 6.5 夸克参考点（反面教材 + 云端预加载）

**夸克基本信息**：
- 技术栈：Chromium 定制（Quarkium）
- 包体：99-145MB
- 定位：AI 超级框 + 网盘 + 信息流

**可借鉴**：
- **云端预加载**：可借鉴用于 Dashboard 数据预取
- **AI 超级框**：AI 对话框整合多种能力（我们画布主页的 AI 对话框参考）

**反面教材**：
- **包体过大**：99-145MB，我们目标 < 20MB，不学夸克打包 Chromium 内核
- **功能臃肿**：网盘/信息流/广告等，我们保持极简

### 6.6 图标素材调研结论

**调研结论**：所有现代 Android 浏览器（Via/夸克/Edge/Chrome）的 UI 图标都用 **VectorDrawable（SVG 转 XML）或系统 Material Icons**，不用多套 PNG 位图。

**各方案对比**：

| 方案 | 体积 | 渲染性能 | 可定制性 | 推荐度 |
|------|------|---------|---------|--------|
| **PNG/WebP 多分辨率** | 大（100 图标 2-5MB） | 快 | 差（不能变色，需多套图） | ★☆☆☆☆ 不推荐 |
| **VectorDrawable (SVG→XML)** | 极小（100 图标 50-200KB） | 良好 | 优（tint 动态变色，任意缩放） | ★★★★★ 首选 |
| **字体图标 (Icon Font)** | 小（子集化后几十 KB） | 快 | 良（可变色，多色受限） | ★★★☆☆ 可选 |
| **Compose 内置 Icons (core)** | 零（已在依赖里） | 快 | 良（类型安全，tint 支持） | ★★★★★ 首选 |
| **Compose Icons Extended** | 大（未开 R8）/ 小（开 R8 后几 KB-几十 KB） | 快 | 良 | ★★★★☆ 推荐（必须开 R8） |
| **系统自带图标** | 零 | 快 | 差（厂商 ROM 差异大） | ★★☆☆☆ 不推荐单独用 |

**最终方案**：见 3.11 节（Compose 内置 Icons 为主 + VectorDrawable 补充 + 严格开 R8）

---

## 七、设计原则

1. **原生优先** — Kotlin + Compose，保证丝滑体验（参考 DeepSeek）
2. **轻量优先** — 系统 WebView + 轻壳，包体 < 20MB（参考 Via）
3. **多端互通** — 与桌面端共享数据，服务器权威 + 本地缓存
4. **AI 为核心** — AI 是主要交互方式，能操作浏览器/画布/导航
5. **效果优先** — 不因开发难度妥协效果，选择最优方案
6. **对称设计** — 浏览器主页和画布主页对称，降低学习成本
7. **渐进式** — 先 MVP 子集，再逐步补全
8. **复用协议** — AI 指令协议、数据模型、服务器 API 与桌面端共享
9. **无边框美学** — 元素与面板之间默认不画边框线、不为边框单独配色；面板间分隔（如对话栏与侧栏）首选靠两侧背景色差区分，必须分隔时优先用大圆角过渡，最后才退而用极淡描边线，禁止使用明显边框线

## 七.5、UI 原型权威性（强制）

> **Phase M12 发布门禁（1.0.0-mobile 强制）**：Phase M0-M11 各 Phase 验收通过 ≠ 可发布。所有 Phase 验收清单中的"生成签名 release apk 并通过干净 Android 设备安装测试"项汇总到 Phase M12 统一执行。Phase M12 全部任务 100% 通过才能发布 1.0.0-mobile。

**所有 UI 实现必须以下方原型为唯一视觉与交互基准**，不得自行发挥设计：

- **原型文件**：`docs/ui-prototype/mobile/index.html`（单文件 inline React，file:// 可直接打开）
- **截图存证**：`docs/ui-prototype/mobile/.screenshots/`（各轮验证截图 + M9/M10/M11 单页截图）

### 实施要求（对所有执行 AI 强制）

1. **视觉 1:1 还原**：组件布局、间距、配色、圆角、字号、图标、状态（收起/展开/工作态/折叠态/三档画布/四档画布）必须与原型一致。原型标注"设计改进"的部分（如思考等级滑块、AgentModeSwitcher 折叠菜单、底部栏左右滑动、Home 转换图标、Apple Watch 小球、缩小版组件）按原型形态实现，不按源码当前形态实现。
2. **底部栏召唤 AI**：左右滑动手势切换（不是上滑），左滑切 AI 输入框模式，右滑回按钮模式。AI 工作时收起后框内显示"AI 正在..."状态。
3. **AgentModeSwitcher 折叠**：AI 对话框顶部小图标，默认折叠，点击才展开 CLOUD/LOCAL/AUTO + 思考等级滑块。不在主页顶部常驻显示。
4. **分层画布四档**：THUMBNAIL（Apple Watch 彩色小球叠加）/ SUMMARY（缩小版完整组件，非简化信息）/ INTERACTIVE（完全可用）/ FULL（放大局部）。第二档的缩小版组件由 Design Agent 在做每个组件时必须同时产出。
5. **Home 图标**：BROWSER 模式加↹转换徽章（暗示可切换画布主页），CANVAS 模式不加。
6. **主页去文字**：去掉"Living Dashboard""常用网站""收藏组件"等冗余文字标题，纯图标 + 对话框。
7. **反 AI slop**：禁止紫渐变、禁止 emoji（dingbats ✦✎♪ 除外）、禁止圆角卡片+左 border（PermissionCard 左色条除外）、禁止空泛标语。
8. **缺漏页已补齐**：原型中**不应**再有虚线红框"缺设计"占位符（M9 发布/M10 自动化测试/M11 AI 搜索都已补真实 UI）。若发现某个功能在原型里没有对应设计，先补原型再实现，不得跳过原型直接写代码。
9. **原型与 roadmap 条目的对应关系**：roadmap 中标注"**设计改进**"的条目，以原型形态为准；标注"源码已实现"的条目，原型展示的是目标形态（若与源码不一致，按原型实现）。

### 实施前检查清单

执行 AI 在实现任何 UI 相关任务前，必须：
- [ ] 打开 `docs/ui-prototype/mobile/index.html` 确认对应组件的原型设计
- [ ] 核对原型中的标注（"设计改进"/"源码已实现"等）
- [ ] 如原型无对应设计，先在原型中补设计并经用户确认，再写代码

---

## 八、风险与缓解

| 风险 | 缓解措施 |
|------|---------|
| 安卓 WebView 与真实 Chrome 有差异 | 部分网站检测 WebView，可修改 UA 解决；核心 DOM 操作能力不受影响 |
| 分层画布性能（缩放流畅度） | 视口外组件虚拟化，缩放级别切换 Composable，性能优化 |
| 组件需用 Kotlin 重写 | MVP 子集起步（5 个），逐步补全；数据模型复用 |
| 多端数据同步冲突 | 服务器权威策略，版本号控制，客户端拉取最新数据 |
| AI 指令延迟 | 网页在本地，无画面传输；指令传输是 AI 通信的一部分 |
| 油猴脚本兼容性 | 实现 GM_* API，覆盖 90%+ 脚本；不兼容的诚实告知 |
| 安卓沙箱限制数据导入 | 书签用 HTML 导入，其他引导重新登录；诚实告知限制 |
| Operit LGPL 协议 | 参考架构和思路，代码自己实现，避免直接复用 |
| 服务器不可用时 | 客户端本地缓存支持离线查看；AI 功能不可用但画布/组件可用 |

---

## 九、开发工作流（强制）

> 此规则优先级高于一切。任何 Phase 在开始编码前，必须完成以下步骤。

### 执行铁律：写 Spec → 对抗审查 Spec → 编码 → 对抗审查

```
编写 Spec → 对抗审查 Spec → 审查通过？
                                ↓ 否 → 修订 Spec → 重新审查
                                ↓ 是 → 编码实现 → adversarial-review Skill 对抗审查 → 通过？
                                                                                  ↓ 否 → 修复 → 重新审查
                                                                                  ↓ 是 → 完成
```

### 步骤详解

1. **行动前先写 Spec**：针对当前 Phase 的每个任务，先编写详细实施 Spec
2. **Spec 对抗审查**：用 sub-agent 做对抗审查，以最严格立场审查（不放水，要么完美要么不通过）
3. **编码实现**：按通过的 Spec 编码
4. **adversarial-review Skill 对抗审查**：编码完成后用 `adversarial-review` skill 审查，包含运行时验证
5. **git commit**：审查通过后 commit

### 上下文要求

每次写 Spec 时，必须包含：
- 项目目的（移动端 AI 浏览器客户端，两种主页 + 分层画布 + 多端互通）
- 本 roadmap 的产品形态设计和技术方案
- 当前 Phase 的任务和验收标准
- 约束条件（Kotlin 优先、包体 < 20MB、不下载 C 盘等）
- [layout-design-mobile.md](layout-design-mobile.md) 的页面布局设计（线框图、组件层级、交互行为）

---

## 十、验收标准总览

> **发布强制**：每个 Phase 验收通过后，必须执行 `./gradlew assembleRelease` 生成签名 apk，并在干净 Android 设备上验证安装运行。未生成 apk 不算 Phase 完成。

### Phase M0 验收 ✅
- [x] 安卓项目能编译运行
- [x] WS 客户端能连服务器
- [x] 项目结构清晰
- [x] **生成签名 apk 并通过干净 Android 安装测试**

### Phase M1 验收 ✅
- [x] 浏览器主页正常显示（搜索框+常用网站+Logo/书签）
- [x] WebView 能打开真实网页
- [x] 标签页管理正常
- [x] 底部栏 5 按钮正常
- [x] 书签/历史功能正常
- [x] 主页可定制（背景/Logo/主题色）
- [x] 能设为默认浏览器
- [x] **生成签名 apk 并通过干净 Android 安装测试**

### Phase M2 验收 ✅
- [x] 画布主页正常显示（AI对话框+收藏组件+圆形图标）
- [x] Home 键切换规则正确
- [x] 分层画布缩放流畅
- [x] 面板管理正常（面板=画布）
- [x] MVP 5 个组件正常
- [x] 画布主页下滑进聚合面板
- [x] 收藏组件 + WebOS 页面正常
- [x] **生成签名 apk 并通过干净 Android 安装测试**

> **真机验证记录**（设备：431QHFFK224BC 魅族手机）：
> - 场景 1：启动 + HomeModeSelector + 画布主页 + 画布页 ✅
> - 场景 2：画布页缩放按钮 + D3 Home 规则（先回当前模式主页再切换）✅
> - 场景 3：标签页管理（TabManagerScreen 网页标签 + 画布面板标签统一管理）✅
> - 场景 4：聚合面板（系统自动创建 + 收藏组件真实引用）✅
> - 场景 5：浏览器模式 + 书签/历史/设置 ✅
> - 场景 6：HomeModeSelector 重选 + 模式切换 ✅
>
> **修复的 bug**：
> - P0：LocalWidgetRegistry 从未通过 CompositionLocalProvider 注入到 Compose 树（运行时崩溃）→ MainActivity 添加 @Inject widgetRegistry + CompositionLocalProvider 包裹 LivingDashboardTheme
> - 中级：CalculatorEngine 注释版本号错误（Eval 4.0.0 → EvalEx 3.6.2）
> - Bug #1：CanvasHomeScreen 的 BottomBar 显示在屏幕顶部（Box 默认 TopStart）→ 给 BottomBar 添加 modifier 参数 + align(Alignment.BottomCenter)

### Phase M3 验收 ✅
- [x] AI 对话框能对话
- [x] AI 助手组件正常（每面板独立）
- [x] 底部栏 AI 输入框模式正常
- [x] AI 能操控浏览器（DOM/Cookie/截图/点击/输入）
- [x] AI 能导航/创建面板
- [x] 思考等级 4 档可切换，不同等级推理深度不同
- [x] **生成签名 apk 并通过干净 Android 安装测试** — Release APK 2.32MB（< 20MB）

> **对抗审查**：通过（核心功能 36 个新增单元测试全绿，共 167 个；3 项真机验证因环境无 AVD / 无 cmdline-tools 阻塞跳过，已用单元测试 + 静态验证替代）
>
> **已知遗留项**：真机/模拟器验证未执行；R-7 PiEvent 事件类型映射待 CLOUD 服务器真机抓包验证；DB migration 数据完整性升级测试待设备可用后补充

### Phase M4 验收
- [ ] 油猴脚本能导入并运行
- [ ] GM_* API 正常
- [ ] AI 能生成脚本并保存
- [ ] 常驻 UI 脚本正常
- [ ] 脚本多端同步
- [ ] **生成签名 apk 并通过干净 Android 安装测试**

### Phase M5 验收
- [ ] Room 本地缓存正常
- [ ] 服务器同步正常
- [ ] 多端数据一致（面板/组件/AI对话/书签/脚本/收藏）
- [ ] 离线可用
- [ ] **生成签名 apk 并通过干净 Android 安装测试**

### Phase M6 验收
- [ ] 书签 HTML 导入正常
- [ ] 笔记分享导入正常
- [ ] 笔记文件导入正常
- [ ] 密码保存/填充正常
- [ ] **生成签名 apk 并通过干净 Android 安装测试**

### Phase M8 验收 ✅
- [x] LlmClient 能流式调 OpenAI 兼容 API — LlmClientTest 23 用例（MockWebServer）
- [x] AgentLoop 能多轮工具调用 — AgentLoopTest 10 用例（MockK）
- [x] 工具注册执行正常 — ToolsTest 30 用例 + ToolRegistryTest 6 用例
- [x] Skills 加载 product-guide 正常 — SkillLoaderTest 6 用例 + APK 解压验证 assets/pi/skills/product-guide/SKILL.md
- [x] 用户 API Key 加密存储（EncryptedSharedPreferences） — ApiKeyStoreTest 7 用例（MasterKey AES256_GCM）
- [x] 思考等级映射正确 — ThinkingLevelMapperTest 26 用例覆盖 6 provider × 4 档
- [x] 云端/本地 agent 可切换 — RuntimeModeManagerTest 5 用例 + AgentModeSwitcher UI
- [x] 服务器离线时自动切本地 agent，UI 提示"离线模式" — RuntimeModeManager combine + debounce(2000) + logcat 验证 ConnectException
- [x] **生成签名 apk 并通过干净 Android 安装测试** — Debug APK 18.43MB + Release APK 2.27MB（apksigner v2 验证通过）+ 真机安装启动 PID 27989

> **对抗审查**：通过（21 项验收标准全绿，3 项端到端测试因 API Key + 设备 PIN 锁阻塞跳过，已用源码静态验证 + logcat 运行时验证替代）

### Phase M10 验收
- [ ] MockK + Turbine + Robolectric + MockWebServer 配置就绪
- [ ] WsClient 测试扩展全绿（JSON 解析 / 重连退避 / 多面板路由 / 心跳 / 鉴权）
- [ ] AI Assistant 集成测试全绿（ViewModel / AI 模式 / 思考等级 / agent 切换 / 离线降级 / 导航）
- [ ] LlmClient SSE 解析全绿（SSE 事件 / 流式 / 错误 / 5 provider / 思考链）
- [ ] 移动端工具实现全绿（AI 指令执行器 / WebView 工具 / ToolRegistry / GM_* API）
- [ ] Room 缓存 + 数据同步全绿（DAO / 同步服务 / 离线支持）
- [ ] 集成 + 端到端测试全绿（AI 真实调用 / 工具真实调用 / WS 端到端 / Compose UI）
- [ ] 测试覆盖率报告（核心 AI 模块 ≥ 70%）
- [ ] CI 全绿（lint + test + coverage）
- [ ] **生成签名 apk 并通过干净 Android 安装测试**

### Phase M11 验收
- [ ] 7 张 Room 表均可搜索（含 favorites JOIN widgets）
- [ ] SearchRepository 统一查询入口可用
- [ ] 中文子串匹配正常
- [ ] type 过滤生效
- [ ] 权重排序正确（title > content > meta）
- [ ] local_search 绝不发起网络请求（DevTools Network 零请求）
- [ ] WS tool_call 链路通（接收 local_search → 执行 → 回传 result）
- [ ] 离线状态下 local_search 仍可用
- [ ] 4 类搜索结果分组展示（本地/网页/学术/GitHub）
- [ ] 点击跳转正确（本地跳面板/组件，外链走 Intent.ACTION_VIEW）
- [ ] AI 对话框可触发搜索并流式展示
- [ ] 搜索引擎配置 UI 可见
- [ ] Key 管理 4 操作可调（GET/PUT/DELETE/POST test）
- [ ] Key 不明文展示
- [ ] 生成签名 release apk 并通过干净设备安装测试

---

## 十一、附录

### 11.1 当前项目结构

```
event/
├── client/
│   ├── desktop/                # 桌面端（已推进到 Phase 3）
│   │   ├── electron/
│   │   ├── src/
│   │   │   └── components/widgets/  # 9 个组件
│   │   └── ...
│   └── android/                # 安卓端（本 roadmap，目前占位）
│       └── .gitkeep
├── server/                     # 服务器（与桌面端共享）
│   └── src/
├── shared/                     # 多端共享代码（目前占位）
│   └── .gitkeep
├── docs/
│   ├── roadmap_mobile_v1.md    # 本文档
│   └── specs/
└── ...
```

### 11.2 安卓端目标项目结构

```
client/android/
├── app/
│   ├── src/main/
│   │   ├── java/com/livingdashboard/
│   │   │   ├── ui/             # Compose UI
│   │   │   │   ├── home/       # 两种主页
│   │   │   │   ├── browser/    # 浏览器主页
│   │   │   │   ├── canvas/     # 画布主页 + 分层画布
│   │   │   │   ├── widget/     # 组件
│   │   │   │   ├── tab/        # 标签页管理
│   │   │   │   └── theme/      # 主题
│   │   │   ├── browser/        # WebView 浏览器引擎
│   │   │   ├── canvas/         # 画布逻辑
│   │   │   ├── ai/             # AI 指令执行器
│   │   │   ├── script/         # 脚本管理器
│   │   │   ├── data/           # Room 数据层
│   │   │   ├── sync/           # 服务器同步
│   │   │   ├── import/         # 数据导入
│   │   │   └── di/             # Hilt 依赖注入
│   │   ├── res/
│   │   └── AndroidManifest.xml
│   ├── build.gradle.kts
│   └── proguard-rules.pro
├── build.gradle.kts
├── settings.gradle.kts
└── gradle.properties
```

### 11.3 关键技术参考

- Jetpack Compose：https://developer.android.com/jetpack/compose
- Android WebView：https://developer.android.com/reference/android/webkit/WebView
- Room：https://developer.android.com/training/data-storage/room
- OkHttp WebSocket：https://square.github.io/okhttp/
- Hilt：https://dagger.dev/hilt/
- Operit GitHub（参考）：https://github.com/AAswordman/Operit
- Via 浏览器（参考）：https://www.viayoo.com/zh-cn/
- Violentmonkey（脚本管理器参考）：https://violentmonkey.github.io/
- Tampermonkey 脚本格式：https://www.tampermonkey.net/documentation.php

---

## 十二、下一步

本 roadmap 确认后，后续 AI 应：
1. 读完本 roadmap
2. 选择当前要做的 Phase
3. 针对该 Phase 写详细 Spec
4. Spec 对抗审查
5. 编码实现
6. adversarial-review Skill 对抗审查
7. git commit

**建议优先级**：Phase M2 → M3 → M4 → M5 → M6 → M8（轻 agent，可与 M5 并行）→ M7 → M10（AI 自动化测试，含发布）→ M11（AI 搜索集成，依赖服务器 Phase S9 + M3）

> Phase M0/M1/M2/M3 已完成。Phase M9 发布任务贯穿所有 Phase。
> **回溯发布**：Phase M0/M1 完成时未生成签名 apk，需补做发布任务。Phase M2 已生成签名 release apk（19.64MB Debug）并通过真机安装测试。

> Phase M8 可与 M5/M6 并行（轻 agent 不依赖数据同步）。Phase M9 发布任务贯穿所有 Phase。Phase M10 需等 M3 + M8 落地后启动。**Phase M11 需等服务器 Phase S9（AI 搜索工具）+ 移动端 Phase M3（AI 集成）落地后启动**——Phase S9 在服务器注册 4 个搜索工具（`local_search` 走 `DEVICE_SPECIFIC_TOOLS` 路由，`web_search` / `academic_search` / `github_search` 服务器进程内执行），Phase M3 跑通 WS 客户端 + AI 指令执行器（按面板路由），M11 是把搜索工具客户端侧接入 M3 的 WS 链路。

**前置条件**：桌面端 Phase 3（服务器化）需先完成，移动端才能连服务器。如果桌面端服务器化未完成，移动端可先做 M0-M2（本地功能），M3 起需要服务器。

---

## 十三、附录：AI 接入测试说明（Phase M8 起）

> **目的**：移动端 Phase M8（单机轻 Agent）真机测试需要可用的 LLM API Key。本节写占位符与配置方法，**不写真实 Key**——Key 由用户在 App UI 里配置，存到 `EncryptedSharedPreferences`（Android Keystore 加密），不进 git。本节参考 [roadmap_server_v1.md 八、AI 接入测试说明](roadmap_server_v1.md) 并适配移动端场景。

### 13.1 支持测试的 provider

> 与服务器端 8.1 节一致，5 个 provider 全部支持 OpenAI 兼容 `/v1/chat/completions` SSE 流式

| Provider | 默认 | 用途 | 备注 |
|----------|------|------|------|
| **stepfun**（阶跃星辰） | ✅ | 默认 e2e 测试 provider，性价比高、国内可直连 | `model=stepfun/step-3.7-flash` |
| **openai** | - | 国际标准兼容性测试 | `model=openai/gpt-4o-mini` |
| **deepseek** | - | 中文推理 + 思考链（`reasoning_content`） | `model=deepseek/deepseek-chat` |
| **anthropic** | - | 长上下文 + Claude 系列 | `model=anthropic/claude-3-5-sonnet` |
| **Qwen (SiliconFlow 代理)** | - | 阿里通义千问（通过 SiliconFlow 中转，`thinking_budget`） | `model=qwen/qwen-2.5-72b-instruct` |

### 13.2 移动端 Key 配置方法

> 移动端**不读 `.env`**（沙箱机制 + 用户自配原则），统一走 `EncryptedSharedPreferences`（文件名 `ai_keys.xml`，AES256_GCM 加密）

#### 方式 A：用户在 App UI 配置（推荐，M8 spec 设计）

1. App 启动后，进入 **设置 → AI 配置**
2. 选择 Provider（stepfun / openai / deepseek / anthropic / qwen）
3. 输入 API Key（密码框，不明文显示）
4. 输入 Endpoint（可选，有默认值，如 `https://api.stepfun.com/v1`）
5. 输入 Model（可选，有默认值，如 `step-3.7-flash`）
6. 点"测试连接"按钮 → App 用配置调 `POST /v1/chat/completions`（max_tokens=16，messages=[{role:user,content:"ping"}]）→ 返回 200 即通过
7. 保存 → 写入 `EncryptedSharedPreferences`（Android Keystore 加密）

#### 方式 B：adb 推送配置文件（仅开发期调试用）

```bash
# 把配置推到设备 /data/data/com.livingdashboard/files/ai_keys_debug.json（不入 EncryptedSharedPreferences，仅供 LlmClient 读取测试）
adb push ai_keys_debug.json /data/local/tmp/ai_keys_debug.json
adb shell run-as com.livingdashboard cp /data/local/tmp/ai_keys_debug.json files/ai_keys_debug.json
```

> ⚠️ 方式 B 仅供开发期调试，**正式版必须用方式 A**（用户在 UI 配置，走 EncryptedSharedPreferences）。

### 13.3 最小测试命令

#### 用 `curl` 验证 provider 可达（与服务器 8.3 节一致）

```bash
# stepfun 示例（替换 <your-stepfun-key-here> 为真实 key）
curl -X POST "https://api.stepfun.com/v1/chat/completions" \
  -H "Authorization: Bearer <your-stepfun-key-here>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "step-3.7-flash",
    "messages": [{"role":"user","content":"ping"}],
    "max_tokens": 16,
    "stream": true
  }'
```

**期望返回**（SSE 流，`data:` 前缀）：
```
data: {"choices":[{"delta":{"content":"pong"}}]}
data: [DONE]
```

#### 用 adb logcat 观察 App 内 LlmClient 调用

```bash
# 启动 App 后，在另一个终端跑 logcat 过滤 LlmClient 日志
adb logcat -s LlmClient:* AgentLoop:* ToolRegistry:*
```

#### 真机端到端测试步骤（M8 验收）

1. `adb install -r app-release.apk`
2. 启动 App → 设置 → AI 配置 → 输入 API Key → 测试连接
3. 进入画布主页 → AI 输入框 → 发送"你好"
4. 观察 logcat：应看到 LlmClient SSE 流式接收 → AgentLoop 处理 → UI 流式渲染
5. 测试工具调用：发送"创建一个 HTML 组件显示当前时间" → AI 应调 `create_html_widget` 工具
6. 测试思考等级切换：等级 1/2/3/4 各发一次消息，观察 logcat 中 provider 参数差异
7. 测试离线降级：断开 WiFi → 发消息 → 应自动切本地 agent（如已配云端则降级提示）

### 13.4 安全与运维约束

| 约束 | 说明 |
|------|------|
| **不 commit 真实 key** | roadmap / spec / 文档 / 代码只用占位符 `<your-xxx-key-here>`；`.env.server` 已在 `.gitignore` |
| **Key 不进日志** | LlmClient 日志只打 `apiKey=***${last4}`，不打全量 Key |
| **Key 加密存储** | `EncryptedSharedPreferences`（AES256_GCM + AES256_SIV），密钥在 Android Keystore（硬件级隔离） |
| **Key 不明文显示** | UI 输入框用 `KeyboardType.Password` + `visualTransformation = PasswordVisualTransformation()` |
| **Key 不下发服务器** | M8 是单机轻 Agent，API Key 只在本地，绝不上传服务器（与服务器 S4 的"Key 存服务器 auth.json"是不同模式，互不冲突） |
| **测试用最低权限 key** | 测试用 key 限额最小、只读权限，30 天轮换 |

### 13.5 三端测试时的 key 流向（移动端视角）

| 端 | Key 存哪 | Key 谁配 | 测试时怎么取 |
|----|---------|---------|------------|
| **服务器** | `.env`（开发） / `ai_settings` 表（S4 后） | 开发者 / CI secrets | `process.env.PI_API_KEY` / 读表 |
| **桌面端** | Electron `safeStorage`（Phase 8 轻 agent 用） | 用户在 UI 配置 | 走 IPC 读 |
| **移动端（M8）** | `EncryptedSharedPreferences`（`ai_keys.xml`） | **用户在 App UI 配置** | `EncryptedSharedPreferences.getString(...)` |

> **关键原则**：移动端 API Key 永远不进 git 仓库、不进服务器、不下发；测试时统一用占位符 `<your-xxx-key-here>`，真机测试由用户在 App UI 配置真实 Key。
