# Phase M3 详细 Spec：AI 集成（移动端）

> 生成日期：2026-06-28
> 基于 [roadmap_mobile_v1.md Phase M3](../roadmap_mobile_v1.md) + [architecture_refactor.md 第二/三/十三章](../architecture_refactor.md)
> 关联：[layout-design-mobile.md](../layout-design-mobile.md)（CanvasHomeScreen AI 输入框展开态、底部栏 AI 模式、思考等级滑块）
> 测试说明：[roadmap_mobile_v1.md 十三、AI 接入测试说明](../roadmap_mobile_v1.md)

---

## 一、项目目的与范围

### 1.1 目的

完成移动端 AI 集成全链路，让用户在画布主页、画布面板内 AI 助手组件、浏览器底部栏 AI 输入框三处都能与 AI 对话；AI 能操控浏览器（15 个 browser_* 工具）、操作画布（创建/更新/删除组件、导航/创建面板）、读写本地存储、询问用户；CLOUD 模式下与服务器 Pi Agent 共享上下文；LOCAL/AUTO 模式下复用 M8 的本地轻 agent；思考等级 UI 升级为 operit 风格 4 档滑块；AI 对话持久化到 Room，App 重启可恢复。

### 1.2 与已有 Phase 的关系

| Phase | 关系 |
|------|------|
| M0/M1/M2 | M3 复用 LivingWebView / CanvasRepository / BottomBar / Routes |
| M8（已完成） | M3 复用 LlmClient / AgentLoop / Tool / ToolRegistry / Session / ApiKeyStore / ThinkingLevel / SkillLoader / RuntimeModeManager / LocalAgentService / ActiveHolders / AskUserDialogState / AgentEvent；M3 在其上扩展 CLOUD 模式、新增 12 个工具、新增 PanelEventRouter / WsToolCallDispatcher / 持久化、UI 升级（滑块、底部栏 AI 模式、AIAssistantWidget 真实化） |
| M4（脚本系统） | 不依赖，M3 不实现脚本注入 |
| M5（数据同步） | 不依赖，M3 的 ai_conversations 表是本地表，M5 后续把它纳入同步 |
| M9（发布） | M3 完成后必须生成签名 release apk + 真机安装 |
| M10（AI 自动化测试） | M3 落地后启动，覆盖 WS 派发 / 工具执行 / 持久化 |

### 1.3 范围（roadmap M3 任务清单逐项映射）

| roadmap 任务 | 本 Spec 落地文件 |
|------|------|
| AI 对话框（画布主页，类 Tabbit） | `ui/canvas/components/AIInputPill.kt`（M8 已实现，M3 不改） |
| AI 助手组件（每面板独立） | `ui/widget/AIAssistantWidget.kt`（M2 占位 → M3 真实化） + `ui/widget/AiWidgetViewModel.kt`（新增） |
| 底部栏 AI 模式 | `ui/components/BottomBar.kt`（改） + `ui/browser/BrowserAiModeState.kt`（新增） + `ui/browser/BrowserScreen.kt`（接入） |
| AI 指令执行器 | `ai/WsToolCallDispatcher.kt`（新增） + `ai/PanelEventRouter.kt`（新增） |
| AI 浏览器工具（15 个） | `ai/tools/` 新增 12 个：BrowserClickTool / BrowserInputTool / BrowserScrollTool / BrowserWaitForTool / BrowserScreenshotTool / BrowserGetDomTool / BrowserGetTitleTool / BrowserBackTool / BrowserForwardTool / BrowserReloadTool / BrowserGetCookieTool / BrowserSetCookieTool |
| AI 导航 | `ai/tools/NavigateToPanelTool.kt` + `CreatePanelTool.kt`（新增）+ `ai/ActiveNavigatorHolder.kt`（新增） |
| AI 基于网页对话 | `ai/LocalAgentService.kt`（改：注入页面上下文） + `ai/CloudAgentService.kt`（新增） |
| 思考等级 UI（4 档滑块） | `ui/canvas/components/ThinkingLevelSlider.kt`（新增，替换 ThinkingLevelDropdown） |
| 按面板上下文 | `ai/PanelEventRouter.kt`（新增 Map<panelId, Flow>） + `ai/CloudAgentService.kt` |
| 多端并行 | `ai/WsToolCallDispatcher.kt`（按 targetDeviceId 过滤）+ 服务器侧已实现（不属本 spec） |

### 1.4 不在 M3 范围

- ❌ 脚本系统（M4 任务）—— 脚本注入 onPageStarted 不在 M3 实现
- ❌ 数据同步到服务器（M5 任务）—— ai_conversations 表先纯本地，M5 后续纳入同步
- ❌ 完整 28 个工具（架构 13.4/13.10）—— M3 实现 24 个（M8 的 10 + 新增 12 个 browser_* + 2 个 navigate_*），缺 web_search/academic_search/github_search（M11）/memory_*（架构 13.x 后置）
- ❌ 桌面端 AI 集成（Phase 9 已做）
- ❌ AI 自动化测试覆盖（M10 任务）—— M3 只补关键单测，覆盖率目标不在 M3 强制

### 1.5 与 M8 的关键差异

| 维度 | M8（已完成） | M3（本 Spec） |
|------|------|------|
| Agent 模式 | 仅 LOCAL/AUTO 离线降级 | CLOUD/LOCAL/AUTO 全实现 |
| browser_* 工具数 | 3 个（eval/navigate/get_url） | 15 个（新增 12 个） |
| AIAssistantWidget | M2 占位 | 真实化，每面板独立对话 |
| 底部栏 AI 模式 | 不实现 | 上滑切换 AI 输入框 |
| 思考等级 UI | Dropdown 下拉 | 4 档水平滑块（operit 风格） |
| AI 对话持久化 | inMemory Session | Room ai_conversations 表 |
| AI 导航 | 不支持 | navigate_to_panel / create_panel |
| AI 基于网页对话 | 不注入页面上下文 | 自动注入 URL/title 到 system prompt |
| WS 消息派发 | 不派发（仅 SettingsViewModel 调试显示） | WsToolCallDispatcher + PanelEventRouter 全链路 |

---

## 二、与架构文档对应

| 架构章节 | 本 Spec 章节 |
|------|------|
| 第二章 按面板 session | 六、6.1（PanelEventRouter）+ 6.5（CloudAgentService）+ 6.8（持久化） |
| 第三章 按面板路由工具调用 | 六、6.2（WsToolCallDispatcher） |
| 第十三章 单机轻 Agent | M8 已落地，M3 仅扩展 CLOUD 模式 + 持久化 |
| 第十三章 13.7 Agent 切换 UI | 六、6.11（AgentModeSwitcher 升级滑块） |

---

## 三、当前代码现状（M0/M1/M2/M8 已完成）

### 3.1 已有相关文件（M3 复用 / 改造）

| 文件 | M3 复用点 / 改造点 |
|------|---------|
| `sync/WsClient.kt` | 复用：`state` / `messages` / `send`；不改 |
| `sync/WsMessage.kt` | 复用：`ClientMessage.UserMessage` / `ClientMessage.ToolResult` / `ServerMessage.ToolCall` / `ServerMessage.PiEvent`；不改 |
| `ai/LocalAgentService.kt` | 改：注入 `ActiveWebViewHolder` 自动注入页面上下文；与 `CloudAgentService` 共同实现 `AgentService` 接口 |
| `ai/AgentLoop.kt` | 不改（CLOUD 模式不走 AgentLoop，由服务器 Pi Agent 内部循环） |
| `ai/LlmClient.kt` | 不改 |
| `ai/Session.kt` | 改：增加 `loadFromHistory(messages)` 方法从 Room 恢复 |
| `ai/Tool.kt` / `ai/ToolRegistry.kt` | 不改 |
| `ai/ActiveHolders.kt` | 改：新增 `ActiveNavigatorHolder` 类 |
| `ai/RuntimeModeManager.kt` | 不改（CLOUD/LOCAL/AUTO + 离线降级已就绪） |
| `ai/ThinkingLevel.kt` | 不改（4 档枚举 + Mapper 已就绪） |
| `ai/AgentEvent.kt` | 不改 |
| `browser/LivingWebView.kt` | 改：`WebViewController` 新增 `captureVisibleBitmap()` 接口供 screenshot 工具用 |
| `browser/CookieManagerWrapper.kt` | 复用：getCookies / setCookie；不改 |
| `data/db/LivingDatabase.kt` | 改：新增 `AiConversationEntity` + `AiConversationDao` + version 2→3 + `MIGRATION_2_3` |
| `data/repository/CanvasRepository.kt` | 复用已有 `createHtmlWidget(panelId, html, ...)` 给 create_panel 工具用（M3 不实现 browser_open，不新增 createWebviewWidget） |
| `data/repository/TabRepository.kt` | 复用：`getAll()` 给 browser_list_tabs 工具用；不改 |
| `ui/canvas/CanvasHomeViewModel.kt` | 改：注入 `AgentService`（接口）替代直接 `LocalAgentService`；onAiSend 走 AgentService 接口 |
| `ui/canvas/components/AgentModeSwitcher.kt` | 改：替换 `ThinkingLevelDropdown` 为 `ThinkingLevelSlider` |
| `ui/canvas/components/ThinkingLevelSlider.kt` | 新增 |
| `ui/widget/AIAssistantWidget.kt` | 改：M2 占位 → M3 真实化 |
| `ui/widget/AiWidgetViewModel.kt` | 新增 |
| `ui/components/BottomBar.kt` | 改：增加 AI 输入框模式（上滑切换） |
| `ui/browser/BrowserScreen.kt` | 改：接入底部栏 AI 模式 |
| `ui/browser/BrowserAiModeState.kt` | 新增 |
| `di/AppModule.kt` | 改：注册 12 个新工具 + PanelEventRouter + WsToolCallDispatcher + ActiveNavigatorHolder + CloudAgentService |
| `assets/pi/skills/browser-agent/SKILL.md` | 新增 |

### 3.2 关键依赖就绪情况

| 依赖 | 是否就绪 | M3 需补 |
|------|---------|--------|
| OkHttp 4.12.0 | ✅ | 已有 WebSocket / SSE |
| Coroutines 1.7.3 | ✅ | Flow + StateFlow + SharedFlow |
| kotlinx.serialization 1.6.3 | ✅ | 工具参数 JSON Schema |
| Hilt 2.48 | ✅ | @Singleton / @Inject |
| Room 2.6.1 | ✅ | 新增 1 张表 + migration |
| Compose BOM 2024.06.00 | ✅ | Slider 组件已有 |
| material-icons-extended | ✅ | 新增图标用 |
| EncryptedSharedPreferences | ✅ | M8 已加 |

### 3.3 现有测试基础

M8 已落地 131 用例（LlmClientTest 23 / AgentLoopTest 10 / ToolRegistryTest 6 / SessionTest 8 / SkillLoaderTest 6 / ApiKeyStoreTest 7 / ThinkingLevelMapperTest 26 / RuntimeModeManagerTest 5 / LocalAgentServiceTest 6 / ToolsTest 30 / WsMessageTest 4）。

M3 需扩展：
- `WsToolCallDispatcherTest`（新增）
- `PanelEventRouterTest`（新增）
- `AiConversationDaoTest`（新增，Robolectric Room 测试）
- `ToolsTest` 扩展 12 个新工具用例
- `ThinkingLevelSliderTest`（新增，Compose UI 测试用 Robolectric）
- `CloudAgentServiceTest`（新增，MockK WsClient）

---

## 四、文件清单

### 4.1 新增文件（22 个）

#### AI 核心（6 个）

- `ai/AgentService.kt` — Agent 服务接口（Local + Cloud 共同实现）
- `ai/CloudAgentService.kt` — 云端 Agent 服务（WS 路由 + PiEvent 转 AgentEvent）
- `ai/PanEventRouter.kt` — 按 panelId 路由 AgentEvent 流
- `ai/WsToolCallDispatcher.kt` — WS ToolCall → ToolRegistry 派发 + ToolResult 回传
- `ai/ActiveNavigatorHolder.kt` — 持有 NavController 供 AI 导航工具用
- `ai/PageContextProvider.kt` — 提供当前活跃 WebView 的 URL/title 供 system prompt 注入

#### 工具（12 个 browser_* + 2 个导航）

- `ai/tools/BrowserClickTool.kt`
- `ai/tools/BrowserInputTool.kt`
- `ai/tools/BrowserScrollTool.kt`
- `ai/tools/BrowserWaitForTool.kt`
- `ai/tools/BrowserScreenshotTool.kt`
- `ai/tools/BrowserGetDomTool.kt`
- `ai/tools/BrowserGetTitleTool.kt`
- `ai/tools/BrowserBackTool.kt`
- `ai/tools/BrowserForwardTool.kt`
- `ai/tools/BrowserReloadTool.kt`
- `ai/tools/BrowserGetCookieTool.kt`
- `ai/tools/BrowserSetCookieTool.kt`
- `ai/tools/NavigateToPanelTool.kt`
- `ai/tools/CreatePanelTool.kt`

#### 数据层（3 个）

- `data/entity/AiConversationEntity.kt`
- `data/dao/AiConversationDao.kt`
- `data/repository/AiConversationRepository.kt`

#### UI（4 个）

- `ui/canvas/components/ThinkingLevelSlider.kt` — operit 风格 4 档滑块
- `ui/widget/AiWidgetViewModel.kt` — AIAssistantWidget 的 ViewModel
- `ui/browser/BrowserAiModeState.kt` — 浏览器底部栏 AI 模式状态
- `assets/pi/skills/browser-agent/SKILL.md` — 浏览器操作 Skill 文档

#### 测试（6 个）

- `app/src/test/java/com/livingdashboard/ai/WsToolCallDispatcherTest.kt`
- `app/src/test/java/com/livingdashboard/ai/PanelEventRouterTest.kt`
- `app/src/test/java/com/livingdashboard/ai/CloudAgentServiceTest.kt`
- `app/src/test/java/com/livingdashboard/ai/PageContextProviderTest.kt`
- `app/src/test/java/com/livingdashboard/data/dao/AiConversationDaoTest.kt`（Robolectric）
- `app/src/test/java/com/livingdashboard/ui/canvas/components/ThinkingLevelSliderTest.kt`（Robolectric Compose UI）

### 4.2 修改文件（11 个）

- `ai/LocalAgentService.kt` — 实现 `AgentService` 接口；注入 `PageContextProvider` 在 system prompt 末尾追加页面上下文
- `ai/Session.kt` — 新增 `loadFromHistory(messages: List<LlmMessage>)` 用于从 Room 恢复
- `ai/ActiveHolders.kt` — 新增 `ActiveNavigatorHolder` 类
- `browser/LivingWebView.kt` — `WebViewController` 新增 `captureVisibleBitmap(): Bitmap?` 方法
- `data/db/LivingDatabase.kt` — version 2→3 + `MIGRATION_2_3` + 注册 `aiConversationDao()`
- `data/repository/CanvasRepository.kt` — 复用已有 `createHtmlWidget(panelId, html, x, y, w, h, title)` 方法（M3 不实现 browser_open，故不新增 createWebviewWidget；create_panel 工具调 createHtmlWidget 生成 widgetId）
- `di/AppModule.kt` — 注册 14 个新工具 + PanelEventRouter + WsToolCallDispatcher + ActiveNavigatorHolder + CloudAgentService + PageContextProvider + AiConversationRepository
- `ui/canvas/CanvasHomeViewModel.kt` — 注入 `AgentService`（接口）+ `AiConversationRepository`；onAiSend 走接口；启动时从 Room 加载历史
- `ui/canvas/CanvasHomeScreen.kt` — 挂载 ThinkingLevelSlider 替换 Dropdown
- `ui/canvas/components/AgentModeSwitcher.kt` — 用 ThinkingLevelSlider 替换 ThinkingLevelDropdown；移除切换到 CLOUD 模式时的 Toast 提示（CLOUD 模式为常态，无需每次弹 Toast 打扰用户）
- `ui/widget/AIAssistantWidget.kt` — 真实化（接入 AiWidgetViewModel）
- `ui/widget/WidgetModule.kt` — 不改（AIAssistantWidget 仍由 WidgetRegistry 注册，但内部用 hiltViewModel()）
- `ui/components/BottomBar.kt` — 增加 AI 输入框模式参数
- `ui/browser/BrowserScreen.kt` — 接入底部栏 AI 模式
- `app/build.gradle.kts` — versionCode 8→9 / versionName 0.1.0-m8 → 0.1.0-m3；新增 Compose UI 测试依赖（详见 6.21）
- `ui/widget/WidgetRenderParams.kt` — `panelId: String` 字段加默认值 `= ""`（不破坏既有调用方，AIAssistantWidget 传入实际 panelId）
- `ui/widget/CanvasScreen.kt`（如存在调用 WidgetRenderParams 的位置）— **不改**：因 WidgetRenderParams.panelId 已加默认值，现有构造调用无需修改；仅在 AIAssistantWidget 内部传入真实 panelId

> 实际改动会更多（如 AppNavGraph 注入 ActiveNavigatorHolder、MainActivity 注册 Navigator），4.2 节列核心改动文件。

---

## 五、AI 指令协议与 15 个 browser_* 工具规范

### 5.1 AI 指令协议（与桌面端共享，复用 M8 的 WsMessage.kt）

**传输层**：WebSocket + JSON-RPC，`WsJson` 配置 `classDiscriminator = "kind"` 与服务器对齐。

**M3 复用 M8 已有类型**（不在本 spec 重定义，仅说明）：
- `ServerMessage` 已有：`ToolCall` / `PiEvent` / `SessionReady` / `Error` / `Pong` / `Change`（6 种，M8 已实现）
- `ClientMessage` 已有：`UserMessage` / `ToolResult` / `Pong` / `Authenticate` / `Subscribe`（M8 已实现）
- 服务器 `ws.ts:43-51` 的 `proxy_request` 类型 M3 不实现（桌面端本地服务代理用），`WsJson` 配 `ignoreUnknownKeys = true` 会静默丢弃。

**M3 在 WsMessage.kt 补充新增类型**（必须，否则 CLOUD 模式 ask_user 与 dispose_session 失效）：

```kotlin
// === ServerMessage 新增 ===

/** 服务器 ask_user 工具执行时下发，弹窗询问用户 */
@Serializable @SerialName("ask_user")
data class AskUser(
    val requestId: String,        // 关联的 ToolCall requestId（用于回传 ToolResult）
    val prompt: String,           // 询问提示文案（兼容服务器 question 字段，反序列化时映射）
    val message: String? = null,  // 服务器兼容字段（部分版本用 message 而非 prompt）
    val options: List<String> = emptyList(),  // 可选项；为空则任意文本回答
    val allowMultiple: Boolean = false,
    val panelId: String? = null,
) : ServerMessage()

// === ClientMessage 新增 ===

/** 客户端回传 ask_user 的用户响应（作为 ToolResult 的一种特化封装） */
@Serializable @SerialName("ask_user_response")
data class AskUserResponse(
    val requestId: String,        // 对应 AskUser.requestId
    val success: Boolean,
    val data: JsonElement? = null,  // 用户选择/输入的值，序列化为 JSON
    val panelId: String? = null,
) : ClientMessage()

/** 客户端通知服务器销毁指定面板的 Pi Agent session（面板删除 / ViewModel onCleared 时调） */
@Serializable @SerialName("dispose_session")
data class DisposeSession(
    val panelId: String,
) : ClientMessage()
```

**UserMessage 字段设计决策（C4）**：
- 服务器 `ws.ts:31` 的 `user_message` 协议有 `panelId?` / `sessionId?` / `apiConfig?` / `callerWidgetId?` 字段，其中 `panelId` 可选。
- 客户端 `WsMessage.kt:17-21` 现有 `UserMessage(val panelId: String, val content: String)` 仅传 `panelId + content`，**这是设计决策**：
  - 客户端始终显式传 `panelId`（不为 null），让服务器 `piBridge.ts:1146` 的 `effectivePanelId = msg.panelId ?? ...` 直接走 panelId 分支。
  - `apiConfig` / `callerWidgetId` / `sessionId` 服务器侧不要求客户端传：`apiConfig` 缺失 → 服务器用环境变量配置的 LLM；`callerWidgetId` 缺失 → permission_request 路由退化为广播（M3 不实现权限请求 UI，可接受）；`sessionId` 缺失 → 服务器用 `panelId` 作为 session key。
  - 若 M11 后需要让服务器用客户端 LLM 配置（apiConfig），再扩字段。
- **结论：客户端 UserMessage 只发 panelId + content，其他字段不要求对齐服务器协议。**

**协议映射总结表**：

| 服务器协议类型（ws.ts/piBridge.ts） | 客户端类型 | M3 处理 |
|------------------------------------|-----------|---------|
| `tool_call` | `ServerMessage.ToolCall` | ✅ WsToolCallDispatcher 派发 |
| `pi_event` | `ServerMessage.PiEvent` | ✅ WsToolCallDispatcher 转 AgentEvent |
| `session_ready` | `ServerMessage.SessionReady` | ✅ 通知 UI |
| `error` | `ServerMessage.Error` | ✅ 派发 Error 到 PanelEventRouter |
| `pong` | `ServerMessage.Pong` | ✅ 心跳响应 |
| `change` | `ServerMessage.Change` | ⏸ M3 不处理（M5 任务） |
| `ask_user` | `ServerMessage.AskUser`（M3 新增） | ✅ 转 AskUserDialogState |
| `proxy_request` | 不实现 | ⏸ M3 不实现（桌面端用），`ignoreUnknownKeys` 丢弃 |
| `user_message`（入） | `ClientMessage.UserMessage` | ✅ 仅发 panelId+content |
| `tool_result`（出） | `ClientMessage.ToolResult` | ✅ 工具结果回传 |
| `ask_user_response`（出） | `ClientMessage.AskUserResponse`（M3 新增） | ✅ ask_user 弹窗用户响应 |
| `dispose_session`（出） | `ClientMessage.DisposeSession`（M3 新增） | ✅ 通知服务器销毁 session |
| `authenticate` / `subscribe` / `pong`（出） | M8 已有 | ✅ M8 已实现 |

### 5.2 15 个 browser_* 工具清单（与服务器 piBridge.ts 18 个对齐，M3 实现 15 个）

> 桌面端有 18 个，移动端 M3 实现 15 个（缺 browser_open / browser_switch_tab / browser_list_tabs，因为移动端多 WebView 共存池未实现；这些工具的"列出/切换标签"功能改由服务器侧处理或 M7 后补）。
>
> **修订**：经审查，移动端 M3 阶段 `browser_open` 改为"在当前面板创建 WebviewWidget"语义（而非新开 tab），`browser_list_tabs` 用 `list_widgets` 工具的 webview 类型过滤即可，`browser_switch_tab` 改为 `navigate_to_panel`。所以 M3 实际新增 12 个 browser_* 工具，加上 M8 已有 3 个，共 15 个。

| # | 工具名 | 参数 | 返回 | 实现文件 |
|---|--------|------|------|---------|
| 1 | `browser_eval` | `script: String` | `{result: String?}` | M8 已有 |
| 2 | `browser_navigate` | `url: String` | `{url, success}` | M8 已有 |
| 3 | `browser_get_url` | 无 | `{url}` | M8 已有 |
| 4 | `browser_click` | `selector: String` | `{clicked: Boolean}` | 新增 |
| 5 | `browser_input` | `selector: String, text: String` | `{filled: Boolean}` | 新增 |
| 6 | `browser_scroll` | `x?: Int, y?: Int, selector?: String` | `{scrolled: Boolean}` | 新增 |
| 7 | `browser_wait_for` | `selector: String, timeoutMs?: Int` | `{found: Boolean}` | 新增 |
| 8 | `browser_screenshot` | 无 | `{imageBase64: String}` | 新增 |
| 9 | `browser_get_dom` | `selector?: String` | `{html: String}` | 新增 |
| 10 | `browser_get_title` | 无 | `{title: String}` | 新增 |
| 11 | `browser_back` | 无 | `{success: Boolean}` | 新增 |
| 12 | `browser_forward` | 无 | `{success: Boolean}` | 新增 |
| 13 | `browser_reload` | 无 | `{success: Boolean}` | 新增 |
| 14 | `browser_get_cookie` | 无 | `{cookies: String}` | 新增 |
| 15 | `browser_set_cookie` | `name: String, value: String, domain?: String` | `{success: Boolean}` | 新增 |

### 5.3 工具返回格式统一

所有工具 `execute` 返回 `ToolResult`：
- 成功：`ToolResult.success(buildJsonObject { put("xxx", ...) })`
- 失败：`ToolResult.error("错误描述")`

服务器侧（CLOUD 模式）调用工具时，`WsToolCallDispatcher` 把 `ToolResult` 转 `ClientMessage.ToolResult(requestId, success, data, error)` 回传；`data` 字段用 `ToolResult.data ?: JsonNull`，`error` 用 `ToolResult.error`。

### 5.4 路由规则

- **CLOUD 模式**：用户消息 → WS `UserMessage` → 服务器 Pi Agent → 服务器调 LLM + 决定调工具 → 若是 DEVICE_SPECIFIC_TOOLS（含 15 个 browser_* + local_search 等）→ 服务器 WS `ToolCall` 下发到客户端 → `WsToolCallDispatcher` 派发到 `ToolRegistry` → 结果回传 → 服务器继续 LLM 循环 → PiEvent 流（text_delta 等）下发到客户端 → `PanelEventRouter.dispatch(panelId, event)` → UI 订阅
- **LOCAL 模式**：用户消息 → `LocalAgentService.sendMessage` → `AgentLoop.run` → 本地 LLM + 本地工具执行 → Flow<AgentEvent> → UI 订阅
- **AUTO 模式**：服务器在线走 CLOUD；离线自动降级 LOCAL

### 5.5 超时

- 工具执行超时：30s（与服务器 `TOOL_TIMEOUT_MS = 30_000` 对齐），本地用 `withTimeoutOrNull(30_000)` 包装
- WS 工具调用超时：服务器侧 30s 后自动 reject；客户端无需额外处理
- **CloudAgentService 超时**：120s（覆盖 browser_wait_for 30s + browser_screenshot 30s + LLM 推理 60s 的最坏情况），见 6.5 节
- **BrowserWaitForTool 内部超时**：默认 `timeoutMs = 25000`，硬上限 29000（留 1s 给外层 `withTimeoutOrNull(30_000)` 兜底）

### 5.6 未实现工具降级处理（C2 修复）

**背景**：服务器 `piBridge.ts:785-826` 已注册 `browser_open` / `browser_switch_tab` / `browser_list_tabs` / `local_search` 等 4 个工具的 ToolDefinition，AI 可能看到并调用。M3 客户端不实现这 4 个工具，需明确降级行为。

**降级策略**：
- `ToolRegistry.execute(name, params)` 找不到工具时，**返回** `ToolResult.success(buildJsonObject { put("success", false); put("error", "tool not implemented on mobile: $name") })`（注意：用 `success=true` 包装错误信息，让 AI 看到结构化错误而非 ToolRegistry 异常）
- AI（Pi Agent / 本地 LLM）收到该错误后自行降级：
  - `browser_open` → 改用 `browser_navigate(url)` 在当前 WebView 加载
  - `browser_list_tabs` → 改用 `list_widgets(type=webview)` 列出 WebviewWidget
  - `browser_switch_tab` → 改用 `navigate_to_panel(panelId)` 切换面板
  - `local_search` → 改用 `browser_get_dom` 后自行 grep（或直接告知用户该能力未实现）

**实现位置**：`ToolRegistry.execute` 内部，无需在工具层每个工具写 fallback。

```kotlin
// ToolRegistry.kt 改造（不在 M3 文件清单，M8 已有，仅 patch 一行）
suspend fun execute(name: String, args: JsonObject): ToolResult {
    val tool = tools[name] ?: return ToolResult.success(buildJsonObject {
        put("success", false)
        put("error", "tool not implemented on mobile: $name")
        put("fallback_hint", when (name) {
            "browser_open" -> "use browser_navigate instead"
            "browser_list_tabs" -> "use list_widgets with type=webview"
            "browser_switch_tab" -> "use navigate_to_panel"
            "local_search" -> "use browser_get_dom and grep manually"
            else -> "no fallback"
        })
    })
    return tool.execute(args)
}
```

---

## 六、详细设计

### 6.1 PanelEventRouter（按 panelId 路由 AgentEvent 流）

**文件**：`ai/PanelEventRouter.kt`

**职责**：维护 `Map<panelId, MutableSharedFlow<AgentEvent>>`，让 UI 按面板订阅事件流，让 CLOUD 模式的 `WsToolCallDispatcher` 和 `CloudAgentService` 按面板派发事件。

**接口**：

```kotlin
class PanelEventRouter {
    private val flows = ConcurrentHashMap<String, MutableSharedFlow<AgentEvent>>()
    private val scope: CoroutineScope  // 注入 applicationScope

    /** 获取或创建指定面板的事件流（UI 订阅） */
    fun getOrCreate(panelId: String): Flow<AgentEvent>

    /** 派发事件到指定面板的所有订阅者 */
    fun dispatch(panelId: String, event: AgentEvent)

    /** 清理指定面板的事件流（面板删除时调） */
    fun dispose(panelId: String)

    /** 列出所有活跃面板 ID */
    fun activePanelIds(): Set<String>
}
```

**实现要点**：
- `MutableSharedFlow<AgentEvent>(extraBufferCapacity = 64, onBufferOverflow = DROP_OLDEST)`
- `getOrCreate` 返回 `Flow<AgentEvent>`（热流，SharedFlow 无 replay，新订阅者收不到历史事件）
- **UI 订阅方式（m9）**：`SharedFlow` 不能直接 `collectAsStateWithLifecycle()`（缺初始值编译错误）。UI 订阅时用 `.scan(emptyList<AgentEvent>()) { acc, v -> acc + v }.collectAsStateWithLifecycle(initialValue = emptyList())` 把事件累积为 List；或 ViewModel 自己在 `init` 里 collect 并维护 `_uiMessages`，UI 直接订阅 `uiMessages: StateFlow<List<UiChatMessage>>`（推荐后者，因为 UI 已经在订阅 uiMessages）。**绝不能直接对 SharedFlow 调 `collectAsStateWithLifecycle()` 不传 initialValue**。
- `dispatch` 用 `tryEmit`，避免阻塞
- `dispose` 从 map 移除并 cancel flow
- 线程安全：`ConcurrentHashMap`

**与现有代码集成**：
- `CanvasHomeViewModel` 在 `init` 中订阅 `panelEventRouter.getOrCreate(currentPanelId)` 接收 CLOUD 模式事件
- `CanvasHomeViewModel.onPanelDeleted` 调 `panelEventRouter.dispose(panelId)`
- `CloudAgentService` 内部用 `panelEventRouter.dispatch` 派发 PiEvent 转 AgentEvent

### 6.2 WsToolCallDispatcher（WS 工具调用派发）

**文件**：`ai/WsToolCallDispatcher.kt`

**职责**：订阅 `WsClient.messages`，把 `ServerMessage.ToolCall` 派发到 `ToolRegistry.execute`，结果通过 `WsClient.send(ClientMessage.ToolResult)` 回传。

**接口**：

```kotlin
class WsToolCallDispatcher(
    private val wsClient: WsClient,
    private val toolRegistry: ToolRegistry,
    private val deviceAuth: DeviceAuth,
    private val panelEventRouter: PanelEventRouter,
    private val askUserDialogState: AskUserDialogState,  // C1 新增：处理 ask_user 工具
    private val scope: CoroutineScope,  // applicationScope
) {
    private var job: Job? = null

    /** 启动派发（Application.onCreate 后由 Hilt 注入后自动启动） */
    fun start()

    /** 停止派发（Application.onTerminate 调） */
    fun stop()
}
```

**派发逻辑**：

```kotlin
fun start() {
    job?.cancel()
    job = scope.launch {
        wsClient.messages.collect { msg ->
            when (msg) {
                is ServerMessage.ToolCall -> handleToolCall(msg)
                is ServerMessage.PiEvent -> handlePiEvent(msg)
                is ServerMessage.AskUser -> handleAskUser(msg)        // C1 新增
                is ServerMessage.Error -> handleError(msg)
                is ServerMessage.SessionReady -> { /* 可选：通知 UI session 已就绪 */ }
                is ServerMessage.Change -> { /* M5 任务，M3 暂不处理 */ }
                is ServerMessage.Pong -> { /* 心跳响应，无需处理 */ }
            }
        }
    }
}

private suspend fun handleToolCall(msg: ServerMessage.ToolCall) {
    // 1. 多端路由过滤：targetDeviceId 不为 null 且不等于本机 deviceId 则跳过
    val myDeviceId = deviceAuth.getDeviceId()
    if (msg.targetDeviceId != null && msg.targetDeviceId != myDeviceId) return

    val params = (msg.params as? JsonObject) ?: JsonObject(emptyMap())

    // 2. 先派发 ToolCallStart（M9：让 UI 看到工具调用中间态，与 ToolCallEnd 分开）
    msg.panelId?.let { panelId ->
        panelEventRouter.dispatch(panelId, AgentEvent.ToolCallStart(
            callId = msg.requestId,
            toolName = msg.tool,
            args = params,
        ))
    }

    // 3. 执行工具（带 30s 超时）
    val result = withTimeoutOrNull(30_000) {
        toolRegistry.execute(msg.tool, params)
    } ?: ToolResult.error("tool timeout after 30s")

    // 4. 回传 ToolResult
    wsClient.send(ClientMessage.ToolResult(
        requestId = msg.requestId,
        success = result.success,
        data = result.data,
        error = result.error,
    ))

    // 5. 再派发 ToolCallEnd（M9：在工具执行完之后）
    msg.panelId?.let { panelId ->
        panelEventRouter.dispatch(panelId, AgentEvent.ToolCallEnd(
            callId = msg.requestId,
            success = result.success,
            result = result.error ?: result.data?.toString() ?: "",
        ))
    }
}

/**
 * C1 新增：处理服务器 ask_user 工具下发的弹窗请求。
 * 服务器 piBridge.ts:833 把 ask_user 作为独立 ServerMessage（不是 tool_call）下发。
 */
private fun handleAskUser(msg: ServerMessage.AskUser) {
    val panelId = msg.panelId ?: return
    val promptText = msg.prompt.ifBlank { msg.message ?: "" }
    scope.launch {
        // 调 AskUserDialogState.show 弹窗，suspend 等待用户响应
        val userResponse = askUserDialogState.show(
            prompt = promptText,
            options = msg.options,
            allowMultiple = msg.allowMultiple,
        )
        // 把用户响应回传给服务器（作为 ask_user_response）
        val dataJson = buildJsonObject {
            when (userResponse) {
                is AskUserResult.Selected -> {
                    put("type", "selected")
                    putJsonArray("values") { userResponse.values.forEach { add(it) } }
                }
                is AskUserResult.TextInput -> {
                    put("type", "text")
                    put("value", userResponse.text)
                }
                is AskUserResult.Cancelled -> {
                    put("type", "cancelled")
                }
            }
        }
        wsClient.send(ClientMessage.AskUserResponse(
            requestId = msg.requestId,
            success = userResponse !is AskUserResult.Cancelled,
            data = dataJson,
            panelId = panelId,
        ))
        // 同时派发到 PanelEventRouter 让 UI 看到弹窗已响应
        panelEventRouter.dispatch(panelId, AgentEvent.ToolCallEnd(
            callId = msg.requestId,
            success = userResponse !is AskUserResult.Cancelled,
            result = "ask_user: ${userResponse::class.simpleName}",
        ))
    }
}

/**
 * C5 风险注解：event.type 来自 pi-coding-agent SDK，需在实施首步用 logcat 抓取实际值后固化映射。
 * 临时映射：text_delta / thinking_delta / turn_start / turn_end / error。
 * 若服务器实际发送的是 text / delta / llm_delta 等不同名称，需调整 when 分支。
 * 实施首步：在 AndroidManifest 加 android:debuggable="true"，启动 App 切 CLOUD 模式发一条消息，
 * adb logcat -s LivingDashboard.WS:* 抓取 ServerMessage.PiEvent 的实际 event 字段值。
 */
private fun handlePiEvent(msg: ServerMessage.PiEvent) {
    val panelId = msg.panelId ?: return
    // m8: msg.data 安全转换（避免类型不匹配 NPE）
    val data = msg.data as? JsonObject ?: JsonObject(emptyMap())
    val event = when (msg.event) {
        "text_delta" -> {
            val text = data["text"]?.jsonPrimitive?.contentOrNull ?: return
            AgentEvent.TextDelta(text)
        }
        "thinking_delta" -> {
            val text = data["text"]?.jsonPrimitive?.contentOrNull ?: return
            AgentEvent.ThinkingDelta(text)
        }
        "turn_start" -> AgentEvent.TurnStart
        "turn_end" -> {
            val reason = data["finishReason"]?.jsonPrimitive?.contentOrNull
            AgentEvent.TurnEnd(reason ?: "stop")
        }
        "error" -> {
            val message = data["message"]?.jsonPrimitive?.contentOrNull ?: "unknown error"
            AgentEvent.Error(message, recoverable = false)
        }
        else -> {
            // C5：未知事件类型记 log，便于实施时抓取真实事件名固化映射
            Log.w("WsToolCallDispatcher", "unknown pi event type: ${msg.event}, data: $data")
            return
        }
    }
    panelEventRouter.dispatch(panelId, event)
}

private fun handleError(msg: ServerMessage.Error) {
    val panelId = msg.panelId ?: return
    panelEventRouter.dispatch(panelId, AgentEvent.Error(msg.message, recoverable = true))
}
```

**构造参数变更**：`WsToolCallDispatcher` 构造新增 `askUserDialogState: AskUserDialogState` 注入（C1 必需）。

**DeviceAuth.getDeviceId()** 复用 M8 已有方法（首次启动生成 UUID 持久化到 SharedPreferences）。

**AskUserResult 类型**（新增 sealed class，定义在 `ai/AgentEvent.kt` 或独立文件）：
```kotlin
sealed class AskUserResult {
    data class Selected(val values: List<String>) : AskUserResult()
    data class TextInput(val text: String) : AskUserResult()
    object Cancelled : AskUserResult()
}
```

**AskUserDialogState.show 签名**（M8 已有 `AskUserDialogState`，M3 新增 suspend show 方法）：
```kotlin
suspend fun show(prompt: String, options: List<String>, allowMultiple: Boolean): AskUserResult
```
（具体实现：用 `suspendCancellableCoroutine` 包装 Compose Dialog 的回调，主线程弹窗，用户点击后 resume。）

### 6.3 AgentService 接口（Local + Cloud 共同实现）

**文件**：`ai/AgentService.kt`

```kotlin
interface AgentService {
    /**
     * 发送消息到指定面板，返回 AgentEvent 流。
     *
     * - CLOUD 模式：通过 WS 把消息发到服务器 Pi Agent，订阅 PanelEventRouter 收 PiEvent
     * - LOCAL 模式：调 LocalAgentService 走本地 LlmClient + AgentLoop
     *
     * 实现由 RuntimeModeManager.state.value.effectiveMode 决定走哪个分支。
     */
    fun sendMessage(
        panelId: String,
        userMessage: String,
        thinkingLevel: ThinkingLevel = ThinkingLevel.STANDARD,
    ): Flow<AgentEvent>

    /** 销毁指定面板的 Session（面板删除 / ViewModel onCleared 时调）
     *  CLOUD 实现：必须发 ClientMessage.DisposeSession 到服务器（C3 修复） */
    fun disposeSession(panelId: String)

    /** 测试连接（仅 LOCAL 模式有意义，CLOUD 走 WS 状态） */
    suspend fun testConnection(config: LlmProviderConfig): Boolean
}
```

### 6.4 LocalAgentService（改：实现 AgentService 接口 + 注入页面上下文）

**改动**：

1. 实现 `AgentService` 接口（签名不变，仅 `: AgentService`）
2. **C7 修复**：`sessions` 改用 `ConcurrentHashMap<String, Session>`（M8 原为 `mutableMapOf` 普通 HashMap，多 ViewModel 并发访问不安全）。
3. **代码 C2 修复**：`buildSystemPrompt()` 拆为非 suspend 部分（基础 + skills，by lazy 缓存）+ suspend 部分（页面上下文，每次 sendMessage 时取）。`PageContextProvider.getCurrentContext()` 是 suspend，**不**在 `buildSystemPrompt()` 内调用，而是 sendMessage flow 内调用后拼接到 `cachedSystemPrompt`。

```kotlin
class LocalAgentService @Inject constructor(
    ...,
    private val pageContextProvider: PageContextProvider,  // M3 新增注入
) : AgentService {

    // C7 修复：sessions 改用 ConcurrentHashMap
    private val sessions = ConcurrentHashMap<String, Session>()

    // 代码 C2 修复：cachedSystemPrompt 仅含 SYSTEM_PROMPT_BASE + skill appendix（非 suspend，by lazy）
    private val cachedSkills by lazy { skillLoader.loadAll() }
    private val cachedSkillAppendix by lazy { skillLoader.buildSystemPromptAppendix(cachedSkills) }
    private val cachedSystemPrompt by lazy {
        buildString {
            append(SYSTEM_PROMPT_BASE)
            append(cachedSkillAppendix)
        }
    }

    // 非suspend：仅构建基础 system prompt（不含页面上下文）
    private fun buildSystemPrompt(): String = cachedSystemPrompt

    override fun sendMessage(
        panelId: String,
        userMessage: String,
        thinkingLevel: ThinkingLevel,
    ): Flow<AgentEvent> = flow {
        // C7: ConcurrentHashMap.getOrPut 线程安全
        val session = sessions.getOrPut(panelId) { Session(buildSystemPrompt(), toolRegistry.definitions) }

        // 代码 C2：在 flow 内（已切到 IO 线程）取页面上下文（suspend），拼接成新 system prompt
        val pageContext = pageContextProvider.getCurrentContext()  // suspend
        val dynamicSystemPrompt = if (pageContext != null) {
            buildString {
                append(cachedSystemPrompt)
                append("\n\n## 当前浏览器上下文\n")
                append("- URL: ${pageContext.url}\n")
                if (pageContext.title.isNotBlank()) append("- 标题: ${pageContext.title}\n")
                append("用户可能基于此页面提问或要求操作。\n")
            }
        } else {
            cachedSystemPrompt
        }
        // Session.updateSystemPrompt 是普通 fun（在 flow 内调用，已切到 IO 线程）
        session.updateSystemPrompt(dynamicSystemPrompt)

        // 后续走 M8 已有 AgentLoop.run（session 自身用 Mutex 保护 _messages，见 6.17）
        agentLoop.run(session, userMessage, thinkingLevel).collect { emit(it) }
    }

    override fun disposeSession(panelId: String) {
        sessions.remove(panelId)
    }

    override suspend fun testConnection(config: LlmProviderConfig): Boolean {
        // LOCAL 模式测试连接：用 config 调 LlmClient
        return llmClient.testConnection(config)
    }
}
```

**关键设计点**：
- `cachedSystemPrompt` 用 `by lazy` 缓存（首次访问构建，线程安全由 lazy 默认 SYNCHRONIZED 模式保证）
- `pageContextProvider.getCurrentContext()` 是 suspend，只在 flow builder 内调用（flow builder 内是 suspend 上下文）
- `Session.updateSystemPrompt` 是普通 fun，在 flow 内调用时已切到 IO 线程，无主线程问题
- 不会出现"buildSystemPrompt 是 suspend 但被 cachedSystemPrompt by lazy 调用"的编译错误

**M3 与 M3 报告 M3 一致性**：删除原 spec 中"Session 只在首次创建时构建 system prompt；后续若想更新 system prompt，调用 session.updateSystemPrompt(newPrompt)"的矛盾描述。统一为：**首次创建 Session 时用 `cachedSystemPrompt`（非 suspend，无页面上下文），每次 sendMessage 时调 `session.updateSystemPrompt(cachedSystemPrompt + pageContext)` 动态拼接**。

### 6.5 CloudAgentService（新增）

**文件**：`ai/CloudAgentService.kt`

**职责**：CLOUD 模式下，通过 WS 把用户消息发到服务器 Pi Agent，订阅 `PanelEventRouter` 收 PiEvent，转 AgentEvent 流。

**C8 修复**：超时从 60s 改为 120s。120s 上限依据：覆盖 `browser_wait_for 30s` + `browser_screenshot 30s` + LLM 推理 60s 的最坏情况。超时后发 `ClientMessage.DisposeSession(panelId)` 通知服务器释放 session（避免服务器继续无用执行，导致下次发消息时 session 状态不一致）。

**代码 C7 修复**：用 `takeWhile` 方案替代 `return@collect`（`return@collect` 不停止外层 collect，只是 return 当前 lambda）。先单独 emit 最后一个事件再终止。

```kotlin
class CloudAgentService(
    private val wsClient: WsClient,
    private val panelEventRouter: PanelEventRouter,
    private val scope: CoroutineScope,
) : AgentService {

    override fun sendMessage(
        panelId: String,
        userMessage: String,
        thinkingLevel: ThinkingLevel,
    ): Flow<AgentEvent> = flow {
        // 1. 检查 WS 状态（实时状态，非 debounced isServerOnline）
        if (wsClient.state.value != WsState.CONNECTED) {
            emit(AgentEvent.Error("服务器未连接，请稍后重试或切换到本地模式", true))
            return@flow
        }

        // 2. 发送 UserMessage 到服务器（仅 panelId + content，见 5.1 节 C4 设计决策）
        val sent = wsClient.send(ClientMessage.UserMessage(panelId, userMessage))
        if (!sent) {
            emit(AgentEvent.Error("发送消息失败（WS 不可用）", true))
            return@flow
        }

        // 3. 订阅 PanelEventRouter 该面板的事件流
        //    服务器会下发：TurnStart → TextDelta* → ToolCallStart/End → TurnEnd
        //    用 takeWhile 收集非终止事件，再单独 emit 终止事件（TurnEnd / Error）
        //    超时 120s（C8：覆盖最坏情况）
        val events = panelEventRouter.getOrCreate(panelId)
        val terminalEvent = withTimeoutOrNull(120_000L) {
            // takeWhile 会在 predicate 为 false 时停止 collect，但不会 emit 那个让 predicate 失败的事件
            // 所以我们要么 onEach 内 emit 后再 takeWhile，要么用 firstOrNull 找终止事件
            // 这里用 collect + 手动 break 的等价写法：把事件分成"非终止"和"终止"两类
            var terminal: AgentEvent? = null
            events.takeWhile { event ->
                val isTerminal = event is AgentEvent.TurnEnd || event is AgentEvent.Error
                if (isTerminal) {
                    terminal = event
                }
                !isTerminal  // 非终止时继续，终止时停止
            }.collect { event ->
                emit(event)  // emit 非终止事件
            }
            terminal  // 返回终止事件（null 表示 flow 被外部取消）
        }

        when {
            terminalEvent == null -> {
                // 超时（120s 内没收到 TurnEnd/Error）
                emit(AgentEvent.Error("服务器响应超时（120s）", true))
                // C8：通知服务器释放 session，避免后续事件污染
                wsClient.send(ClientMessage.DisposeSession(panelId))
            }
            terminalEvent is AgentEvent.Error -> {
                emit(terminalEvent)  // emit Error 终止事件
                // 服务器侧 Error 后 session 可能不可用，主动清理
                wsClient.send(ClientMessage.DisposeSession(panelId))
            }
            else -> {
                emit(terminalEvent)  // emit TurnEnd
            }
        }

        // 4. 清理本地 PanelEventRouter flow（C3 修复：本地清理 + 服务器 dispose 分离）
        //    注意：此处不调 panelEventRouter.dispose(panelId)，因为 disposeSession 会调
        //    仅在 TurnEnd/Error 后允许后续 sendMessage 重新 getOrCreate
    }

    /**
     * C3 修复：销毁指定面板的 session。
     * - 本地：panelEventRouter.dispose(panelId) 清理事件流
     * - 服务器：wsClient.send(ClientMessage.DisposeSession(panelId)) 通知服务器清理 session
     *           （piBridge.ts:1170-1186 已支持 dispose_session 消息）
     *   不发送则服务器侧 session 驻留 7 天才超时清理（piBridge.ts:180）。
     */
    override fun disposeSession(panelId: String) {
        panelEventRouter.dispose(panelId)
        // 通过 scope.launch 异步发送（disposeSession 是非 suspend 方法）
        scope.launch {
            wsClient.send(ClientMessage.DisposeSession(panelId))
        }
    }

    override suspend fun testConnection(config: LlmProviderConfig): Boolean {
        // CLOUD 模式测试连接 = WS 是否已连接（忽略 config，注释说明）
        return wsClient.state.value == WsState.CONNECTED
    }
}
```

**注意**：
- `withTimeoutOrNull` 超时返回 null，据此判断是否 emit Error。
- `takeWhile` 不会 emit 让 predicate 失败的事件，所以用 `terminal` 变量保存终止事件后单独 emit。
- `disposeSession` 是非 suspend 方法（接口要求），内部用 `scope.launch` 异步发 WS。
- 超时或 Error 后主动发 `DisposeSession`，避免服务器侧 session 状态不一致导致下次发消息时事件污染（旧事件尾巴被新订阅收到）。

**与 5.5 节超时层次对齐**：
- 工具层 30s（WsToolCallDispatcher 内 `withTimeoutOrNull(30_000)`，与服务器 `TOOL_TIMEOUT_MS` 对齐）
- CloudAgentService 120s（覆盖多工具串行 + LLM 推理的最坏情况）
- 客户端超时后发 DisposeSession 让服务器停止后续工具执行

### 6.6 AgentService 调度器（路由 Local / Cloud）

**实现位置**：在 `CanvasHomeViewModel` 内（不新建类，直接用 `RuntimeModeManager.state.value.effectiveMode` 判断）

```kotlin
class CanvasHomeViewModel @Inject constructor(
    ...,
    private val localAgentService: LocalAgentService,
    private val cloudAgentService: CloudAgentService,
    private val runtimeModeManager: RuntimeModeManager,
    ...
) : ViewModel() {
    ...
    fun onAiSend() {
        val message = _aiInputText.value.trim()
        if (message.isEmpty()) return
        _aiInputText.value = ""
        _uiMessages.update { it + UiChatMessage(role = "user", content = message) }
        agentJob?.cancel()
        agentJob = viewModelScope.launch {
            val panelId = currentPanelId.value ?: run { ...; return@launch }
            activePanelIdHolder.value.value = panelId
            // m18：effectiveMode 已由 RuntimeModeManager 把 AUTO 解析为 CLOUD 或 LOCAL
            //（AUTO + isServerOnline=true → CLOUD；AUTO + isServerOnline=false → LOCAL）
            // 所以这里只需匹配 CLOUD / LOCAL，无需 AUTO 分支
            val service = when (runtimeModeManager.state.value.effectiveMode) {
                AgentMode.CLOUD -> cloudAgentService
                else -> localAgentService  // LOCAL + 兜底
            }
            service.sendMessage(panelId, message, _currentThinkingLevel.value).collect { event ->
                handleAgentEvent(event)
            }
        }
    }
}
```

### 6.7 PageContextProvider（新增）

**文件**：`ai/PageContextProvider.kt`

```kotlin
data class PageContext(val url: String, val title: String)

class PageContextProvider(
    private val activeWebViewHolder: ActiveWebViewHolder,
) {
    /** 获取当前活跃 WebView 的 URL/title（不在主线程时返回 null） */
    fun getCurrentContext(): PageContext? {
        val webView = activeWebViewHolder.value.value ?: return null
        var ctx: PageContext? = null
        // webView.url 必须在主线程读，但用 post + suspendCancellableCoroutine 会改 suspend 签名
        // 简化：在调用方保证主线程，或用 CountDownLatch 同步（性能差但调用频率低）
        // 决策：用 runBlocking + post 读取（仅在 sendMessage 调用前，频率低）
        if (Thread.currentThread() == Looper.getMainLooper().thread) {
            ctx = PageContext(webView.url ?: "", webView.title ?: "")
        } else {
            val latch = CountDownLatch(1)
            webView.post {
                ctx = PageContext(webView.url ?: "", webView.title ?: "")
                latch.countDown()
            }
            latch.await(1, TimeUnit.SECONDS)
        }
        return ctx?.takeIf { it.url.isNotBlank() }
    }
}
```

**问题**：`runBlocking` 在协程中是反模式。**改进**：改为 suspend 函数：

```kotlin
suspend fun getCurrentContext(): PageContext? {
    val webView = activeWebViewHolder.value.value ?: return null
    return withContext(Dispatchers.Main) {
        PageContext(webView.url ?: "", webView.title ?: "").takeIf { it.url.isNotBlank() }
    }
}
```

`LocalAgentService.sendMessage` 已经是 flow，调用 `pageContextProvider.getCurrentContext()` 用 suspend 即可。

### 6.8 AI 对话持久化（Room ai_conversations 表）

**文件**：`data/entity/AiConversationEntity.kt`

```kotlin
@Entity(
    tableName = "ai_conversations",
    indices = [
        Index(value = ["panelId", "createdAt"], name = "idx_panel_created"),
        Index(value = ["panelId"], name = "idx_panel")
    ]
)
data class AiConversationEntity(
    // 实现采用 Long autoGenerate（Room 推荐用法，性能更好），与 spec 设计的 String UUID 偏离，但内部一致
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val panelId: String,
    val role: String,                      // user / assistant / assistant_thinking / tool_call / tool_result / error
    val content: String,
    val toolCallId: String? = null,        // role=tool_result 时关联的 tool call id
    val toolName: String? = null,          // role=tool_call / tool_result 时的工具名
    val args: String? = null,              // C6 新增：role=tool_call 时存 JSON 序列化后的 toolCalls 数组（用于 loadFromHistory 重建 assistant.toolCalls）
    val turnIndex: Int,                    // 第几轮 LLM 调用
    val createdAt: Long,
)
```

**文件**：`data/dao/AiConversationDao.kt`

```kotlin
@Dao
interface AiConversationDao {
    @Query("SELECT * FROM ai_conversations WHERE panelId = :panelId ORDER BY createdAt ASC")
    fun observeByPanel(panelId: String): Flow<List<AiConversationEntity>>

    @Query("SELECT * FROM ai_conversations WHERE panelId = :panelId ORDER BY createdAt ASC LIMIT :limit")
    suspend fun getRecentByPanel(panelId: String, limit: Int): List<AiConversationEntity>

    @Insert
    suspend fun insert(entity: AiConversationEntity)

    @Insert
    suspend fun insertAll(entities: List<AiConversationEntity>)

    @Query("DELETE FROM ai_conversations WHERE panelId = :panelId")
    suspend fun deleteByPanel(panelId: String)

    @Query("DELETE FROM ai_conversations WHERE panelId = :panelId AND createdAt < :before")
    suspend fun deleteOlderThan(panelId: String, before: Long)

    @Query("SELECT COUNT(*) FROM ai_conversations WHERE panelId = :panelId")
    suspend fun countByPanel(panelId: String): Int
}
```

**文件**：`data/repository/AiConversationRepository.kt`

```kotlin
class AiConversationRepository @Inject constructor(
    private val dao: AiConversationDao,
) {
    fun observeByPanel(panelId: String): Flow<List<AiConversationEntity>> = dao.observeByPanel(panelId)

    suspend fun appendMessage(
        panelId: String, role: String, content: String, turnIndex: Int,
        toolCallId: String? = null, toolName: String? = null,
        args: String? = null,  // C6 新增：role=tool_call 时传 JSON 序列化后的 toolCalls 数组
    ) {
        dao.insert(AiConversationEntity(
            // id 由 Room autoGenerate 自动赋值，无需显式传入（实现采用 Long autoGenerate，与 spec 设计的 String UUID 偏离，但内部一致）
            panelId = panelId,
            role = role,
            content = content,
            toolCallId = toolCallId,
            toolName = toolName,
            args = args,
            turnIndex = turnIndex,
            createdAt = System.currentTimeMillis(),
        ))
    }

    suspend fun appendBatch(messages: List<AiConversationEntity>) = dao.insertAll(messages)

    suspend fun deleteByPanel(panelId: String) = dao.deleteByPanel(panelId)

    /**
     * C6 + 代码 C3 修复：
     * - 过滤掉 tool_result 角色（不进 LlmMessage 列表）
     * - assistant 消息的 tool_calls 用 args 字段持久化，loadFromHistory 时从 args 反序列化 toolCalls 数组
     * - tool_result 角色仅 UI 展示用，不进 LLM 上下文（避免 tool message without matching tool_call 错误）
     *
     * 设计权衡：tool_result 不进 LLM 上下文意味着重启后 AI 不知道工具调用结果。
     * 但保留 assistant.tool_calls 让 AI 知道"我之前调过工具 X"，避免重复调用。
     * 完整工具结果保留在 DB 中供 UI 展示。
     */
    suspend fun getRecentForSessionRestore(panelId: String, limit: Int = 20): List<LlmMessage> {
        val entities = dao.getRecentByPanel(panelId, limit)
        return entities.mapNotNull { e ->
            when (e.role) {
                "user" -> LlmMessage(role = "user", content = e.content)
                "assistant" -> {
                    // C6：从 args 反序列化 toolCalls 数组（若有）
                    val toolCalls = e.args?.let { parseToolCalls(it) }
                    LlmMessage(role = "assistant", content = e.content, toolCalls = toolCalls)
                }
                // 代码 C3：tool_result 不进 LLM 上下文（仅 UI 展示）
                "tool_result", "tool_call", "assistant_thinking", "error" -> null
            }
        }
    }

    /** C6：把 List<ToolCall> 序列化为 JSON 字符串存到 args 字段 */
    fun serializeToolCalls(toolCalls: List<ToolCall>): String =
        WsJson.encodeToString(ListSerializer(ToolCall.serializer()), toolCalls)

    /** C6：从 args JSON 反序列化 toolCalls 数组 */
    private fun parseToolCalls(argsJson: String): List<ToolCall>? = try {
        WsJson.decodeFromString(ListSerializer(ToolCall.serializer()), argsJson)
    } catch (e: Exception) {
        null
    }
}
```

**文件**：`data/db/LivingDatabase.kt`（改）

```kotlin
@Database(
    entities = [
        BookmarkEntity::class, HistoryEntity::class, TabEntity::class,
        PanelEntity::class, WidgetEntity::class, WidgetPositionEntity::class,
        FavoriteEntryEntity::class,
        AiConversationEntity::class,  // M3 新增
    ],
    version = 3, exportSchema = false
)
@TypeConverters(Converters::class)
abstract class LivingDatabase : RoomDatabase() {
    abstract fun bookmarkDao(): BookmarkDao
    abstract fun historyDao(): HistoryDao
    abstract fun tabDao(): TabDao
    abstract fun panelDao(): PanelDao
    abstract fun widgetDao(): WidgetDao
    abstract fun widgetPositionDao(): WidgetPositionDao
    abstract fun favoriteDao(): FavoriteDao
    abstract fun aiConversationDao(): AiConversationDao  // M3 新增

    companion object {
        // C6 修复：MIGRATION_2_3 SQL 加 args TEXT 列
        val MIGRATION_2_3 = object : Migration(2, 3) {
            override fun migrate(database: SupportSQLiteDatabase) {
                database.execSQL("""
                    CREATE TABLE IF NOT EXISTS ai_conversations (
                        id TEXT NOT NULL PRIMARY KEY,
                        panelId TEXT NOT NULL,
                        role TEXT NOT NULL,
                        content TEXT NOT NULL,
                        toolCallId TEXT,
                        toolName TEXT,
                        args TEXT,
                        turnIndex INTEGER NOT NULL,
                        createdAt INTEGER NOT NULL
                    )
                """.trimIndent())
                database.execSQL("CREATE INDEX IF NOT EXISTS idx_panel_created ON ai_conversations(panelId, createdAt)")
                database.execSQL("CREATE INDEX IF NOT EXISTS idx_panel ON ai_conversations(panelId)")
            }
        }
    }
}
```

**DatabaseModule 修改**（含 m23 fallbackToDestructiveMigrationOnDowngrade）：

```kotlin
@Provides @Singleton
fun provideLivingDatabase(@ApplicationContext context: Context): LivingDatabase =
    Room.databaseBuilder(context, LivingDatabase::class.java, "living.db")
        .addMigrations(LivingDatabase.MIGRATION_2_3)  // M3 新增
        .fallbackToDestructiveMigration()  // 兜底（不应触发，但保留）
        // m23：downgrade 时销毁重建（虽然 M3 实际不会发生 downgrade，但 Room 安全保险）
        .fallbackToDestructiveMigrationOnDowngrade()
        .build()
```

**持久化时机**：

- `CanvasHomeViewModel.handleAgentEvent` 处理每条事件后，立即用 `viewModelScope.launch { aiConversationRepository.appendMessage(...) }` 异步写入
- 不要在事件处理内同步写（阻塞 UI 流式渲染）
- `CanvasHomeViewModel.init` 时从 Room 加载最近 20 条消息恢复 `_uiMessages`

### 6.9 12 个新 browser_* 工具实现规范

所有工具位于 `ai/tools/`，统一实现 `Tool` 接口。通用模式（参考 M8 的 `BrowserEvalTool.kt`）：

1. 构造注入 `webviewProvider: () -> WebView?`（cookie 工具注入 `CookieManagerWrapper`）
2. `webView.post { ... }` 切主线程
3. 异步回调用 `suspendCancellableCoroutine` 包装
4. 错误统一 `ToolResult.error(msg)`，成功 `ToolResult.success(buildJsonObject{...})`
5. 用 `toolObjectSchema { ... }` 构建参数 Schema
6. 30s 超时（`withTimeoutOrNull(30_000)`）

#### 6.9.1 BrowserClickTool

**代码 C1 修复**：删除 `stringSchema(...)` 用法（该函数不存在），统一改为 `putJsonObject("xxx") { put("type", "string"); put("description", "...") }`，与现有 `BrowserEvalTool.kt` 一致。

**代码 C5 修复**：删除 `String.format` 用法（与 selector 中的 `%` 字符冲突），改用字符串拼接。

```kotlin
class BrowserClickTool(private val webviewProvider: () -> WebView?) : Tool {
    override val definition = ToolDefinition(
        name = "browser_click",
        description = "点击页面中匹配 CSS selector 的元素。",
        parameters = toolObjectSchema {
            // 代码 C1：用 putJsonObject 替代不存在的 stringSchema
            putJsonObject("selector") {
                put("type", "string")
                put("description", "CSS selector，如 #login-btn 或 .submit")
            }
            putJsonArray("required") { add("selector") }
        },
    )

    override suspend fun execute(args: JsonObject): ToolResult {
        val webView = webviewProvider() ?: return ToolResult.error("no active webview")
        val selector = args["selector"]?.jsonPrimitive?.contentOrNull
            ?: return ToolResult.error("missing selector")
        // 代码 C5：用字符串拼接 + JSONObject.quote 转义，避免 String.format 与 % 冲突
        val quotedSelector = JSONObject.quote(selector)
        val js = """
            (function(){
                try {
                    const selector = $quotedSelector;
                    const el = document.querySelector(selector);
                    if (!el) return JSON.stringify({clicked: false, error: "element not found"});
                    el.click();
                    return JSON.stringify({clicked: true});
                } catch(e) {
                    return JSON.stringify({clicked: false, error: e.message});
                }
            })()
        """.trimIndent()
        val result = withTimeoutOrNull(30_000) {
            suspendCancellableCoroutine { cont ->
                webView.post {
                    webView.evaluateJavascript(js) { value ->
                        if (cont.isActive) cont.resume(value)
                    }
                }
            }
        } ?: return ToolResult.error("click timeout")
        return parseResult(result, "clicked")
    }
}
```

#### 6.9.2 BrowserInputTool

```kotlin
// selector, text → 设置 input.value + dispatch input/change event
// JS: el.value = text; el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('change', {bubbles:true}))
```

#### 6.9.3 BrowserScrollTool

```kotlin
// x?, y?, selector? → 若 selector 则 el.scrollIntoView({behavior:'smooth', block:'center'}); 否则 window.scrollTo(x, y)
// 默认 x=0, y=0（滚动到顶部）
```

#### 6.9.4 BrowserWaitForTool

**代码 C4 修复**：原 Promise + MutationObserver 方案不可行——`WebView.evaluateJavascript` 的回调**只接收同步返回值或 Promise 的 resolve 值，但 Android WebView 的 `evaluateJavascript` 实现不会 await Promise**（API 19+ 文档说会 await，但实测在部分 API level 上不稳定，且无法捕获 Promise rejection）。改用 polling 模式：JS 注入全局轮询函数 + Kotlin 侧用 `while + delay + evaluateJavascript` 轮询全局变量。

**实现思路**：
1. JS 注入：定义全局函数 `__livingCheckWaitFor(selector, timeoutMs)` 用 `setInterval` 轮询，找到元素后写入全局变量 `__livingWaitResult`
2. Kotlin 侧用 `while` 循环 + `delay(200)` + `evaluateJavascript("__livingWaitResult")` 轮询，直到返回非 null 或超时
3. 完成后清理全局变量（避免下次复用污染）

**JS 实现**（注入到 WebView）：

```javascript
(function(selector, timeoutMs){
    // 清理上次的轮询结果
    window.__livingWaitResult = null;
    window.__livingWaitPolling && clearInterval(window.__livingWaitPolling);
    const start = Date.now();
    window.__livingWaitPolling = setInterval(function(){
        try {
            if (document.querySelector(selector)) {
                window.__livingWaitResult = JSON.stringify({found: true, elapsedMs: Date.now() - start});
                clearInterval(window.__livingWaitPolling);
                return;
            }
        } catch(e) {
            window.__livingWaitResult = JSON.stringify({found: false, error: e.message});
            clearInterval(window.__livingWaitPolling);
            return;
        }
        if (Date.now() - start >= timeoutMs) {
            window.__livingWaitResult = JSON.stringify({found: false, elapsedMs: Date.now() - start});
            clearInterval(window.__livingWaitPolling);
        }
    }, 100);
})(${quotedSelector}, ${timeoutMs});
```

**Kotlin 完整实现**：

```kotlin
class BrowserWaitForTool(private val webviewProvider: () -> WebView?) : Tool {
    override val definition = ToolDefinition(
        name = "browser_wait_for",
        description = "等待匹配 CSS selector 的元素出现在页面中。",
        parameters = toolObjectSchema {
            putJsonObject("selector") {
                put("type", "string")
                put("description", "CSS selector")
            }
            putJsonObject("timeoutMs") {
                put("type", "integer")
                put("description", "超时毫秒，默认 25000，硬上限 29000")
                put("default", 25000)
            }
            putJsonArray("required") { add("selector") }
        },
    )

    override suspend fun execute(args: JsonObject): ToolResult {
        val webView = webviewProvider() ?: return ToolResult.error("no active webview")
        val selector = args["selector"]?.jsonPrimitive?.contentOrNull
            ?: return ToolResult.error("missing selector")
        // 5.5 节超时层次：硬上限 29000ms，留 1s 给外层 withTimeoutOrNull(30_000) 兜底
        val timeoutMs = (args["timeoutMs"]?.jsonPrimitive?.intOrNull ?: 25000).coerceAtMost(29000)

        val quotedSelector = JSONObject.quote(selector)
        // 1. 注入 JS：启动 setInterval 轮询，结果写到 window.__livingWaitResult
        val injectJs = """
            (function(selector, timeoutMs){
                window.__livingWaitResult = null;
                window.__livingWaitPolling && clearInterval(window.__livingWaitPolling);
                const start = Date.now();
                window.__livingWaitPolling = setInterval(function(){
                    try {
                        if (document.querySelector(selector)) {
                            window.__livingWaitResult = JSON.stringify({found: true, elapsedMs: Date.now() - start});
                            clearInterval(window.__livingWaitPolling);
                            return;
                        }
                    } catch(e) {
                        window.__livingWaitResult = JSON.stringify({found: false, error: e.message});
                        clearInterval(window.__livingWaitPolling);
                        return;
                    }
                    if (Date.now() - start >= timeoutMs) {
                        window.__livingWaitResult = JSON.stringify({found: false, elapsedMs: Date.now() - start});
                        clearInterval(window.__livingWaitPolling);
                    }
                })($quotedSelector, $timeoutMs);
            })();
        """.trimIndent()

        // 2. 注入 JS（主线程），不等待回调
        withContext(Dispatchers.Main) {
            webView.evaluateJavascript(injectJs, null)
        }

        // 3. Kotlin 侧 polling：每 200ms 查一次 __livingWaitResult
        val result = withTimeoutOrNull(timeoutMs + 1000L) {
            while (isActive) {
                delay(200)
                val raw = withContext(Dispatchers.Main) {
                    suspendCancellableCoroutine<String?> { cont ->
                        webView.evaluateJavascript("__livingWaitResult") { value ->
                            if (cont.isActive) cont.resume(value)
                        }
                    }
                }
                // evaluateJavascript 返回 "null" 字符串表示变量为 null，返回 JSON 字符串表示有结果
                if (raw != null && raw != "null") {
                    return@withTimeoutOrNull raw
                }
            }
            null
        } ?: return ToolResult.error("wait_for timeout after ${timeoutMs}ms")

        // 4. 清理全局变量
        withContext(Dispatchers.Main) {
            webView.evaluateJavascript("window.__livingWaitResult = null;", null)
        }

        // 5. 解析 JSON 结果
        return try {
            val obj = Json.parseToJsonElement(result).jsonObject
            val found = obj["found"]?.jsonPrimitive?.booleanOrNull ?: false
            ToolResult.success(buildJsonObject {
                put("found", found)
                obj["elapsedMs"]?.let { put("elapsedMs", it) }
            })
        } catch (e: Exception) {
            ToolResult.error("invalid result: $result")
        }
    }
}
```

**关键点**：
- 用 `delay(200)` 而非 busy wait，不阻塞线程
- `withContext(Dispatchers.Main)` 切主线程调 `evaluateJavascript`
- `while (isActive)` 检查协程是否被取消（外层 `withTimeoutOrNull` 取消时退出循环）
- 硬上限 29000ms，留 1s 给外层 `withTimeoutOrNull(30_000)` 兜底
- 完成后清理 `__livingWaitResult` 避免下次复用污染

#### 6.9.5 BrowserScreenshotTool

**M6 修复**：webView.width/height <= 0 防御（页面未布局完成时避免 `IllegalArgumentException: width and height must be > 0`）。
**m17 修复**：截图压缩，PNG quality=80（注：PNG 是无损格式，quality 参数对 PNG 不生效，实际用 JPEG quality=80 + PNG fallback），最大尺寸 1080x1920，超出按比例缩放。
**M7 修复**：说明 LLM 如何消费截图。

```kotlin
class BrowserScreenshotTool(
    private val webviewProvider: () -> WebView?,
) : Tool {
    override suspend fun execute(args: JsonObject): ToolResult {
        val webView = webviewProvider() ?: return ToolResult.error("no active webview")
        val bitmap = withTimeoutOrNull(30_000) {
            suspendCancellableCoroutine<Bitmap?> { cont ->
                webView.post {
                    // M6 修复：防御 width/height <= 0（页面未布局完成时 createBitmap 会抛 IllegalArgumentException）
                    if (webView.width <= 0 || webView.height <= 0) {
                        if (cont.isActive) cont.resume(null)
                        return@post
                    }
                    try {
                        val rawBitmap = Bitmap.createBitmap(
                            webView.width, webView.height, Bitmap.Config.ARGB_8888
                        )
                        val canvas = Canvas(rawBitmap)
                        webView.draw(canvas)
                        if (cont.isActive) cont.resume(rawBitmap)
                    } catch (e: Exception) {
                        if (cont.isActive) cont.resumeWith(Result.failure(e))
                    }
                }
            }
        } ?: return ToolResult.error("screenshot timeout")
            // M6：bitmap 为 null 表示 width/height <= 0，工具返回错误而非崩溃
        ?: return ToolResult.error("webview not laid out yet (width/height <= 0)")

        // m17：压缩 + 缩放
        val (scaledBitmap, actualWidth, actualHeight) = withContext(Dispatchers.Default) {
            // 1. 按最大尺寸 1080x1920 等比缩放
            val maxW = 1080
            val maxH = 1920
            val srcW = bitmap.width
            val srcH = bitmap.height
            val scaleW = maxW.toFloat() / srcW
            val scaleH = maxH.toFloat() / srcH
            val scale = minOf(scaleW, scaleH, 1f)  // 不放大，只缩小
            val scaled = if (scale < 1f) {
                Bitmap.createScaledBitmap(bitmap, (srcW * scale).toInt(), (srcH * scale).toInt(), true)
            } else {
                bitmap
            }
            Triple(scaled, scaled.width, scaled.height)
        }

        // m17：JPEG quality=80（PNG 无损 quality 不生效；用 JPEG 减小体积，UI 显示足够）
        val base64 = withContext(Dispatchers.Default) {
            ByteArrayOutputStream().use { baos ->
                scaledBitmap.compress(Bitmap.CompressFormat.JPEG, 80, baos)
                Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP)
            }
        }
        // 释放 scaled bitmap（若是新建的）
        if (scaledBitmap !== bitmap) scaledBitmap.recycle()

        return ToolResult.success(buildJsonObject {
            put("imageBase64", base64)
            put("width", actualWidth)
            put("height", actualHeight)
            put("format", "jpeg")  // m17：实际用 JPEG
            put("mimeType", "image/jpeg")
        })
    }
}
```

**注意**：`View.draw(Canvas)` 不含 WebGL 内容（已知 trade-off），对 99% 网页足够。

**M7：LLM 如何消费截图**：
- `browser_screenshot` 工具返回 `{imageBase64: String, width: Int, height: Int, format: "jpeg", mimeType: "image/jpeg"}`，LLM 通过 base64 字符串识别截图元信息
- **M3 阶段 LLM 主要靠 `browser_get_dom` / `browser_get_title` / `browser_get_url` 文本信息理解页面**，截图主要给用户在 UI 上看（tool_result 显示缩略图）
- 如果 LLM 是 vision 模型（如 GPT-4V / Claude 3.5 Sonnet），会自动把 base64 解码为图片输入；非 vision 模型只能从 base64 长度推断"截图存在"
- **运行时验证（场景 4）只需验证**：
  - 工具返回 base64 长度 > 0
  - UI 在 tool_result 中显示缩略图
  - **不要求 LLM 描述截图内容**（vision 能力依赖 LLM 模型，超出 M3 验收范围）

#### 6.9.6 BrowserGetDomTool

```kotlin
// selector? → 不传取 document.documentElement.outerHTML；传则取 el.outerHTML
// m16：限制返回长度 50000 字符——从末尾截断保留前面的 DOM 结构（前面的 head/body 开头比末尾的 script 更重要）
// 截断时在末尾追加 "\n...[truncated, total=X chars]"
```

**完整实现要点**：

```kotlin
class BrowserGetDomTool(private val webviewProvider: () -> WebView?) : Tool {
    override val definition = ToolDefinition(
        name = "browser_get_dom",
        description = "获取页面 DOM HTML。可选 selector 仅获取子树。",
        parameters = toolObjectSchema {
            putJsonObject("selector") {
                put("type", "string")
                put("description", "CSS selector，可选。不传则取 document.documentElement.outerHTML")
            }
            putJsonArray("required") { /* 无必填 */ }
        },
    )

    override suspend fun execute(args: JsonObject): ToolResult {
        val webView = webviewProvider() ?: return ToolResult.error("no active webview")
        val selector = args["selector"]?.jsonPrimitive?.contentOrNull
        val quotedSelector = selector?.let { JSONObject.quote(it) } ?: "null"
        val js = """
            (function(){
                try {
                    const el = $quotedSelector ? document.querySelector($quotedSelector) : document.documentElement;
                    if (!el) return JSON.stringify({html: "", error: "element not found"});
                    const html = el.outerHTML;
                    // m16：50000 字符截断——从末尾截断保留前面的 DOM 结构
                    const MAX = 50000;
                    if (html.length <= MAX) return JSON.stringify({html: html, total: html.length, truncated: false});
                    return JSON.stringify({html: html.substring(0, MAX) + "\n...[truncated, total=" + html.length + " chars]", total: html.length, truncated: true});
                } catch(e) {
                    return JSON.stringify({html: "", error: e.message});
                }
            })()
        """.trimIndent()
        val result = withTimeoutOrNull(30_000) {
            suspendCancellableCoroutine<String?> { cont ->
                webView.post {
                    webView.evaluateJavascript(js) { value ->
                        if (cont.isActive) cont.resume(value)
                    }
                }
            }
        } ?: return ToolResult.error("get_dom timeout")
        // 解析 result JSON
        return try {
            val obj = Json.parseToJsonElement(result ?: "null").jsonObject
            if (obj["error"] != null) ToolResult.error(obj["error"]!!.jsonPrimitive.content)
            else ToolResult.success(obj)
        } catch (e: Exception) {
            ToolResult.error("invalid result: $result")
        }
    }
}
```

#### 6.9.7 BrowserGetTitleTool

```kotlin
// 读 webView.title（必须在主线程）
class BrowserGetTitleTool(private val webviewProvider: () -> WebView?) : Tool {
    override val definition = ToolDefinition(
        name = "browser_get_title",
        description = "获取当前页面标题。",
        parameters = toolObjectSchema { /* 无参数 */ },
    )
    override suspend fun execute(args: JsonObject): ToolResult {
        val webView = webviewProvider() ?: return ToolResult.error("no active webview")
        val title = withContext(Dispatchers.Main) { webView.title ?: "" }
        return ToolResult.success(buildJsonObject { put("title", title) })
    }
}
```

#### 6.9.8 BrowserBackTool / ForwardTool / ReloadTool

```kotlin
// webView.post { webView.goBack() / goForward() / reload() }
// 检查 canGoBack / canGoForward
class BrowserBackTool(private val webviewProvider: () -> WebView?) : Tool {
    override val definition = ToolDefinition(
        name = "browser_back",
        description = "浏览器后退。",
        parameters = toolObjectSchema { /* 无参数 */ },
    )
    override suspend fun execute(args: JsonObject): ToolResult {
        val webView = webviewProvider() ?: return ToolResult.error("no active webview")
        val canGo = withContext(Dispatchers.Main) { webView.canGoBack() }
        if (!canGo) return ToolResult.success(buildJsonObject { put("success", false); put("reason", "cannot go back") })
        withContext(Dispatchers.Main) { webView.goBack() }
        return ToolResult.success(buildJsonObject { put("success", true) })
    }
}
// ForwardTool / ReloadTool 同理
```

#### 6.9.9 BrowserGetCookieTool / SetCookieTool

**m7 修复**：删除 `?: ""` 多余 Elvis（`getCookies` 已返回 String?，null 时直接传 null 让 LLM 看到 "no cookies"）。

```kotlin
class BrowserGetCookieTool(
    private val cookieManagerWrapper: CookieManagerWrapper,
    private val webviewProvider: () -> WebView?,
) : Tool {
    override val definition = ToolDefinition(
        name = "browser_get_cookie",
        description = "获取当前 URL 的所有 cookies。",
        parameters = toolObjectSchema { /* 无参数 */ },
    )
    override suspend fun execute(args: JsonObject): ToolResult {
        val webView = webviewProvider() ?: return ToolResult.error("no active webview")
        val url = withContext(Dispatchers.Main) { webView.url }
            ?: return ToolResult.error("no url")
        // m7：删除 ?: ""，让 null 直接进 JSON（LLM 看到 cookies=null 知道无 cookie）
        val cookies = cookieManagerWrapper.getCookies(url)
        return ToolResult.success(buildJsonObject {
            put("cookies", cookies ?: JsonNull)
            put("url", url)
        })
    }
}

class BrowserSetCookieTool(
    private val cookieManagerWrapper: CookieManagerWrapper,
    private val webviewProvider: () -> WebView?,
) : Tool {
    override val definition = ToolDefinition(
        name = "browser_set_cookie",
        description = "设置 cookie。",
        parameters = toolObjectSchema {
            putJsonObject("name") { put("type", "string"); put("description", "cookie 名") }
            putJsonObject("value") { put("type", "string"); put("description", "cookie 值") }
            putJsonObject("domain") { put("type", "string"); put("description", "可选，未传用当前 URL host") }
            putJsonArray("required") { add("name"); add("value") }
        },
    )
    override suspend fun execute(args: JsonObject): ToolResult {
        val webView = webviewProvider() ?: return ToolResult.error("no active webview")
        val name = args["name"]?.jsonPrimitive?.contentOrNull
            ?: return ToolResult.error("missing name")
        val value = args["value"]?.jsonPrimitive?.contentOrNull
            ?: return ToolResult.error("missing value")
        val domain = args["domain"]?.jsonPrimitive?.contentOrNull
        val url = withContext(Dispatchers.Main) { webView.url }
            ?: return ToolResult.error("no url")
        // 提取 domain：若未传则用当前 URL 的 host
        val cookieDomain = domain ?: run {
            val host = Uri.parse(url).host ?: return ToolResult.error("cannot parse host from url")
            host
        }
        val cookie = "$name=$value; Domain=$cookieDomain; Path=/"
        cookieManagerWrapper.setCookie(url, cookie)
        return ToolResult.success(buildJsonObject { put("success", true) })
    }
}
```

#### 6.9.10 NavigateToPanelTool

**代码 C6 修复**：`NavController.post { ... }` 不存在（NavController 无 post 方法）。改为 `withContext(Dispatchers.Main) { navigator.navigate(...) }`，NavController 必须主线程访问。
**代码 C1 修复**：删除 `stringSchema(...)`，改用 `putJsonObject`。
**M8 修复**：调用 `activeNavigatorHolder.navigate(route)` 而非直接操作 NavController（封装主线程切换）。

```kotlin
class NavigateToPanelTool(
    private val activeNavigatorHolder: ActiveNavigatorHolder,
    private val canvasRepository: CanvasRepository,
) : Tool {
    override val definition = ToolDefinition(
        name = "navigate_to_panel",
        description = "切换到指定面板。可通过 panelId 或 panel 名称查找。",
        parameters = toolObjectSchema {
            putJsonObject("panelId") {
                put("type", "string")
                put("description", "面板 ID（可选，若提供则优先使用）")
            }
            putJsonObject("panelName") {
                put("type", "string")
                put("description", "面板名称（可选，若 panelId 未提供则按名称查找）")
            }
            // 至少传一个，required 用 custom validation
        },
    )

    override suspend fun execute(args: JsonObject): ToolResult {
        val panelId = args["panelId"]?.jsonPrimitive?.contentOrNull
        val panelName = args["panelName"]?.jsonPrimitive?.contentOrNull
        if (panelId == null && panelName == null) {
            return ToolResult.error("must provide panelId or panelName")
        }
        // 查面板
        val targetPanelId = panelId ?: run {
            canvasRepository.observePanels().firstOrNull()
                ?.firstOrNull { it.name == panelName }?.id
        } ?: return ToolResult.error("panel not found")
        // 代码 C6 + M8：调 activeNavigatorHolder.navigate（内部 withContext(Dispatchers.Main)）
        activeNavigatorHolder.navigate(Routes.canvas(targetPanelId))
        return ToolResult.success(buildJsonObject {
            put("panelId", targetPanelId)
            put("navigated", true)
        })
    }
}
```

#### 6.9.11 CreatePanelTool

**m4 修复**：删除"若当前实现不返回 widgetId，需要改返回类型"，改为"调用 canvasRepository.createHtmlWidget(panelId, html) 返回 widgetId"——M8 已实现该方法返回 String（widgetId），M3 直接复用，无需修改 CanvasRepository。
**代码 C6 + M8 修复**：调 `activeNavigatorHolder.navigate(route)` 而非 `nav.post { ... }`。

```kotlin
class CreatePanelTool(
    private val canvasRepository: CanvasRepository,
    private val activeNavigatorHolder: ActiveNavigatorHolder,
) : Tool {
    override suspend fun execute(args: JsonObject): ToolResult {
        val name = args["name"]?.jsonPrimitive?.contentOrNull ?: "新面板"
        val widgetType = args["widgetType"]?.jsonPrimitive?.contentOrNull ?: "html_canvas"
        val widgetTitle = args["widgetTitle"]?.jsonPrimitive?.contentOrNull ?: "AI 创建的组件"
        // 1. 创建面板
        val panel = canvasRepository.createPanel(name)
        // 2. 创建一个组件（根据 widgetType）
        val html = args["html"]?.jsonPrimitive?.contentOrNull ?: "<html><body><h1>$widgetTitle</h1></body></html>"
        // m4：M8 已实现 createHtmlWidget 返回 widgetId，直接复用
        val widgetId = canvasRepository.createHtmlWidget(panel.id, html, 100f, 100f, 400f, 300f, widgetTitle)
        // 3. 导航到新面板（代码 C6 + M8：调 activeNavigatorHolder.navigate）
        activeNavigatorHolder.navigate(Routes.canvas(panel.id))
        return ToolResult.success(buildJsonObject {
            put("panelId", panel.id)
            put("panelName", name)
            put("widgetId", widgetId)
        })
    }
}
```

### 6.10 ActiveNavigatorHolder

**文件**：`ai/ActiveNavigatorHolder.kt`（合入 `ActiveHolders.kt`）

**M8 修复**：新增 `suspend fun navigate(route: String)` 方法，内部 `withContext(Dispatchers.Main) { value.value?.navigate(route) }`。工具层调用 `activeNavigatorHolder.navigate(route)` 而非直接操作 NavController（保证主线程访问）。

```kotlin
class ActiveNavigatorHolder {
    val value: MutableStateFlow<NavController?> = MutableStateFlow(null)
    val state: StateFlow<NavController?> = value.asStateFlow()

    /**
     * M8 新增：工具层调用此方法导航，内部切主线程。
     * NavController 必须主线程访问，直接暴露 NavController 会让工具层误用。
     */
    suspend fun navigate(route: String) {
        withContext(Dispatchers.Main) {
            value.value?.navigate(route)
        }
    }

    /** M8 新增：可选的 popBackStack 等其他导航操作（同理切主线程） */
    suspend fun popBackStack() {
        withContext(Dispatchers.Main) {
            value.value?.popBackStack()
        }
    }
}
```

**集成**：
- `AppNavGraph` 创建 NavController 后写入 `activeNavigatorHolder.value.value = navController`
- `AppNavGraph` 销毁时 `activeNavigatorHolder.value.value = null`
- `AppModule.provideActiveNavigatorHolder` @Singleton

### 6.11 ThinkingLevelSlider（operit 风格 4 档滑块）

**文件**：`ui/canvas/components/ThinkingLevelSlider.kt`

**m22 修复**：把 tick 圆点放在 Slider 下方的 Row 中，与 Slider 分层，避免 thumb 与 tick 重叠。
**m24 修复**：双重映射简化，直接用 `selected.ordinal - 1` 计算 slider value（避免 `ThinkingLevel.fromValue()` 中间转换）。
**m1 修复**：steps 描述改为 "steps=N 表示在 valueRange 内插入 N 个离散点（不含两端），总档位数 = N + 2（含两端）"。

```kotlin
@Composable
fun ThinkingLevelSlider(
    selected: ThinkingLevel,
    onChange: (ThinkingLevel) -> Unit,
    modifier: Modifier = Modifier,
) {
    // 假设 ThinkingLevel 枚举顺序为 [AUTO, STANDARD, DEEP, MAX, ULTRA]，
    // slider 排除 AUTO（ordinal=0），用 4 个档位 STANDARD/DEEP/MAX/ULTRA（ordinal 1/2/3/4）
    val labels = listOf("快速", "平衡", "深度", "极深度")  // 4 档标签（M3 roadmap 要求）
    Column(modifier) {
        // m22：Slider 单独一层（thumb 不与 tick 重叠）
        Slider(
            // m24：直接用 ordinal - 1 计算（AUTO 在 ordinal 0，跳过；STANDARD=1→0, DEEP=2→1, MAX=3→2, ULTRA=4→3）
            value = (selected.ordinal - 1).toFloat().coerceIn(0f, 3f),
            onValueChange = { v ->
                // m24：v.toInt() + 1 反向映射回 ThinkingLevel（v=0→ordinal 1=STANDARD, v=3→ordinal 4=ULTRA）
                val level = ThinkingLevel.values()[(v.toInt() + 1).coerceIn(1, ThinkingLevel.values().size - 1)]
                onChange(level)
            },
            valueRange = 0f..3f,
            steps = 2,  // m1：steps=N 表示在 valueRange 内插入 N 个离散点（不含两端），总档位数 = N + 2。所以 4 档需要 steps=2
            modifier = Modifier.fillMaxWidth(),
        )
        // m22：tick 圆点放在 Slider 下方的 Row 中（与 Slider 分层，不重叠 thumb）
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            repeat(4) {
                Box(
                    modifier = Modifier
                        .size(6.dp)
                        .clip(CircleShape)
                        .background(MaterialTheme.colorScheme.outline)
                )
            }
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            labels.forEach { label ->
                Text(label, style = MaterialTheme.typography.labelSmall)
            }
        }
    }
}
```

**注意**：`Slider` 的 `steps` 参数含义：steps=N 表示在 valueRange 内插入 N 个离散点（不含两端），总档位数 = N + 2（含两端）。所以 4 档需要 steps=2。

**集成到 AgentModeSwitcher**：

```kotlin
@Composable
fun AgentModeSwitcher(...) {
    Row {
        AgentModeSegmentedButton(...)
        Spacer(Modifier.width(8.dp))
        ThinkingLevelSlider(
            selected = thinkingLevel,
            onChange = onThinkingLevelChange,
            modifier = Modifier.weight(1f),
        )
    }
}
```

**保留** `ThinkingLevelDropdown`（M8 旧实现）作为参考，但 `AgentModeSwitcher` 改用 `ThinkingLevelSlider`。

### 6.12 AIAssistantWidget 真实化

**文件**：`ui/widget/AIAssistantWidget.kt`（改）

**目标**：替换 M2 占位（"AI 功能将在 M3 接入"），让 AIAssistantWidget 真实工作：
- 每面板一个 AIAssistantWidget 实例
- 复用 CanvasHomeViewModel 的 `LocalAgentService` / `CloudAgentService` / `RuntimeModeManager`
- 通过 `WidgetRenderParams.widgetId` 拿不到 panelId，需要新增 `WidgetRenderParams.panelId`

**WidgetRenderParams 改动**（M5 修复）：

```kotlin
data class WidgetRenderParams(
    val widgetId: String,
    val panelId: String = "",  // M3 新增，M5 加默认值（不破坏现有 CanvasScreen.kt 调用方）
    val type: WidgetType,
    val title: String,
    val state: Map<String, Any>,
    val zoomLevel: ZoomLevel,
    val zoom: Float,
    val onStateChange: (Map<String, Any>) -> Unit,
)
```

**WidgetContainer 改动**：传入 panelId（来自 CanvasViewModel.observeWidgets）

**AiWidgetViewModel**（M2 守卫 + m12 真实 handleAgentEvent + m13 onCleared dispose）：

```kotlin
@HiltViewModel
class AiWidgetViewModel @Inject constructor(
    private val localAgentService: LocalAgentService,
    private val cloudAgentService: CloudAgentService,
    private val runtimeModeManager: RuntimeModeManager,
    val askUserDialogState: AskUserDialogState,
    private val activePanelIdHolder: ActivePanelIdHolder,
    private val aiConversationRepository: AiConversationRepository,
) : ViewModel() {
    private val _uiMessages = MutableStateFlow<List<UiChatMessage>>(emptyList())
    val uiMessages: StateFlow<List<UiChatMessage>> = _uiMessages.asStateFlow()

    private val _inputText = MutableStateFlow("")
    val inputText: StateFlow<String> = _inputText.asStateFlow()

    private var agentJob: Job? = null
    private var currentPanelId: String? = null

    // 流式缓冲（与 CanvasHomeViewModel 一致）
    private var pendingAssistantText = StringBuilder()
    private var pendingThinkingText = StringBuilder()

    fun initialize(panelId: String) {
        if (currentPanelId == panelId) return
        currentPanelId = panelId
        agentJob?.cancel()
        // M2 修复：仅当 UI 消息列表为空时才用 entities 覆盖（避免双源更新冲突）
        // 不主动清空 _uiMessages.value，让 Room flow 自然推送
        viewModelScope.launch {
            aiConversationRepository.observeByPanel(panelId).collect { entities ->
                // M2 守卫：仅当为空时才覆盖
                if (_uiMessages.value.isEmpty()) {
                    _uiMessages.value = entities.map { it.toUiChatMessage() }
                }
            }
        }
    }

    fun onInputTextChange(text: String) { _inputText.value = text }

    fun onSend() {
        val message = _inputText.value.trim()
        if (message.isEmpty()) return
        _inputText.value = ""
        _uiMessages.update { it + UiChatMessage("user", message) }
        // M1 修复：cancel 前先 flush pending（与 CanvasHomeViewModel 一致）
        flushPendingMessages(currentPanelId)
        agentJob?.cancel()
        agentJob = viewModelScope.launch {
            val panelId = currentPanelId ?: return@launch
            activePanelIdHolder.value.value = panelId
            val service = pickService()
            service.sendMessage(panelId, message, ThinkingLevel.STANDARD).collect { event ->
                handleAgentEvent(event, panelId)
            }
        }
    }

    private fun pickService(): AgentService {
        // 同 CanvasHomeViewModel：根据 effectiveMode 选 service（AUTO 已被 RuntimeModeManager 解析）
        return when (runtimeModeManager.state.value.effectiveMode) {
            AgentMode.CLOUD -> cloudAgentService
            else -> localAgentService
        }
    }

    /** m12：真实实现 handleAgentEvent（参考 CanvasHomeViewModel） */
    private fun handleAgentEvent(event: AgentEvent, panelId: String) {
        when (event) {
            is AgentEvent.TurnStart -> {
                pendingAssistantText = StringBuilder()
                pendingThinkingText = StringBuilder()
            }
            is AgentEvent.TextDelta -> {
                pendingAssistantText.append(event.text)
                _uiMessages.update { current ->
                    if (current.isNotEmpty() && current.last().role == "assistant") {
                        current.dropLast(1) + current.last().copy(content = pendingAssistantText.toString())
                    } else {
                        current + UiChatMessage("assistant", pendingAssistantText.toString())
                    }
                }
            }
            is AgentEvent.ThinkingDelta -> {
                pendingThinkingText.append(event.text)
                _uiMessages.update { current ->
                    if (current.isNotEmpty() && current.last().role == "assistant_thinking") {
                        current.dropLast(1) + current.last().copy(content = pendingThinkingText.toString())
                    } else {
                        current + UiChatMessage("assistant_thinking", pendingThinkingText.toString())
                    }
                }
            }
            is AgentEvent.ToolCallStart -> {
                _uiMessages.update { it + UiChatMessage("tool_call", "🔧 ${event.toolName}") }
            }
            is AgentEvent.ToolCallEnd -> {
                val status = if (event.success) "✅" else "❌"
                _uiMessages.update { it + UiChatMessage("tool_result", "$status ${event.result.take(100)}") }
            }
            is AgentEvent.TurnEnd -> {
                // 批量持久化
                viewModelScope.launch {
                    val turnIdx = _uiMessages.value.count { it.role == "user" }
                    if (pendingThinkingText.isNotEmpty()) {
                        aiConversationRepository.appendMessage(panelId, "assistant_thinking", pendingThinkingText.toString(), turnIdx)
                    }
                    if (pendingAssistantText.isNotEmpty()) {
                        aiConversationRepository.appendMessage(panelId, "assistant", pendingAssistantText.toString(), turnIdx)
                    }
                }
            }
            is AgentEvent.Error -> {
                _uiMessages.update { it + UiChatMessage("error", "⚠ ${event.message}") }
                viewModelScope.launch {
                    val turnIdx = _uiMessages.value.count { it.role == "user" }
                    aiConversationRepository.appendMessage(panelId, "error", "⚠ ${event.message}", turnIdx)
                }
            }
        }
    }

    /** M1 修复：cancel 前把 pending 文本持久化 */
    private fun flushPendingMessages(panelId: String?) {
        if (panelId == null) return
        if (pendingAssistantText.isEmpty() && pendingThinkingText.isEmpty()) return
        viewModelScope.launch {
            val turnIdx = _uiMessages.value.count { it.role == "user" }
            if (pendingThinkingText.isNotEmpty()) {
                aiConversationRepository.appendMessage(panelId, "assistant_thinking", pendingThinkingText.toString(), turnIdx)
                pendingThinkingText = StringBuilder()
            }
            if (pendingAssistantText.isNotEmpty()) {
                aiConversationRepository.appendMessage(panelId, "assistant", pendingAssistantText.toString(), turnIdx)
                pendingAssistantText = StringBuilder()
            }
        }
    }

    /** m13：onCleared 时主动调 disposeSession（释放 LocalAgentService sessions + 服务器 session） */
    override fun onCleared() {
        super.onCleared()
        agentJob?.cancel()
        currentPanelId?.let { panelId ->
            // m13：调 AgentService.disposeSession（按当前模式选）
            // 注意：与 CanvasHomeViewModel 共享 session 时，重复 dispose 是幂等的（ConcurrentHashMap.remove + 服务器 dispose_session 都是幂等）
            val service = pickService()
            service.disposeSession(panelId)
        }
    }
}
```

**AIAssistantWidget Composable**：

```kotlin
@Composable
fun AIAssistantWidget(params: WidgetRenderParams) {
    val viewModel: AiWidgetViewModel = hiltViewModel()
    LaunchedEffect(params.panelId) {
        viewModel.initialize(params.panelId)
    }
    
    when (params.zoomLevel) {
        ZoomLevel.THUMBNAIL -> {
            // 仅显示图标 + 标题
            Column(...) { Icon(Icons.Default.SmartToy); Text(params.title) }
        }
        ZoomLevel.SUMMARY -> {
            // 显示最近 3 条消息
            val messages by viewModel.uiMessages.collectAsStateWithLifecycle()
            Column(...) {
                Text("AI 助手", style = titleSmall)
                messages.takeLast(3).forEach { msg ->
                    Text("${msg.role}: ${msg.content.take(50)}", style = bodySmall)
                }
            }
        }
        ZoomLevel.INTERACTIVE, ZoomLevel.FULL -> {
            // 完整对话界面
            val messages by viewModel.uiMessages.collectAsStateWithLifecycle()
            val inputText by viewModel.inputText.collectAsStateWithLifecycle()
            Column(modifier = Modifier.fillMaxSize().padding(8.dp)) {
                LazyColumn(modifier = Modifier.weight(1f)) {
                    items(messages) { msg -> ChatMessageBubble(msg) }
                }
                Row {
                    TextField(
                        value = inputText,
                        onValueChange = viewModel::onInputTextChange,
                        modifier = Modifier.weight(1f),
                        placeholder = { Text("输入消息") },
                    )
                    IconButton(onClick = viewModel::onSend) {
                        Icon(Icons.Default.Send)
                    }
                }
            }
        }
    }
}
```

### 6.13 底部栏 AI 输入框模式

**文件**：`ui/components/BottomBar.kt`（改）

新增参数 `aiMode: Boolean` + `aiInputText: String` + `onAiInputTextChange: (String) -> Unit` + `onAiSend: () -> Unit` + `onSwipeUpToAiMode: () -> Unit` + `onSwipeDownToButtonMode: () -> Unit`

```kotlin
@Composable
fun BottomBar(
    mode: AppMode,
    onBack: () -> Unit, onForward: () -> Unit, onHome: () -> Unit,
    onTabs: () -> Unit, onMore: () -> Unit,
    canGoBack: Boolean = false, canGoForward: Boolean = false,
    tabCount: Int = 0,
    // M3 新增
    aiMode: Boolean = false,
    aiInputText: String = "",
    onAiInputTextChange: (String) -> Unit = {},
    onAiSend: () -> Unit = {},
    onSwipeUpToAiMode: () -> Unit = {},
    onSwipeDownToButtonMode: () -> Unit = {},
    modifier: Modifier = Modifier,
) {
    val swipeState = rememberSwipeState()
    Box(
        modifier = modifier
            .pointerInput(Unit) {
                detectVerticalDragGestures(
                    onDragEnd = {
                        if (swipeState.totalDrag > 80f) onSwipeUpToAiMode()  // 上滑切换 AI 模式
                        else if (swipeState.totalDrag < -80f) onSwipeDownToButtonMode()
                    }
                ) { _, dragAmount -> swipeState.totalDrag += dragAmount }
            }
    ) {
        if (aiMode) {
            AiInputBar(
                text = aiInputText,
                onTextChange = onAiInputTextChange,
                onSend = onAiSend,
                onHome = onHome,
                onTabs = onTabs,
            )
        } else {
            ButtonRow(
                mode = mode,
                onBack = onBack, onForward = onForward, onHome = onHome,
                onTabs = onTabs, onMore = onMore,
                canGoBack = canGoBack, canGoForward = canGoForward,
                tabCount = tabCount,
            )
        }
    }
}
```

**BrowserAiModeState**：

```kotlin
data class BrowserAiModeState(
    val aiMode: Boolean = false,
    val aiInputText: String = "",
    val aiExpanded: Boolean = false,
    val aiMessages: List<UiChatMessage> = emptyList(),
)
```

**BrowserScreen 接入**：

```kotlin
@Composable
fun BrowserScreen(...) {
    val aiState by viewModel.aiModeState.collectAsStateWithLifecycle()
    
    Column {
        AddressBar(...)
        ProgressBar(...)
        Box(modifier = Modifier.weight(1f)) {
            LivingWebView(...)
            // AI 对话空间浮层（半屏）
            if (aiState.aiExpanded) {
                AiConversationOverlay(
                    messages = aiState.aiMessages,
                    onSend = viewModel::onAiSend,
                    onClose = viewModel::collapseAi,
                    modifier = Modifier.align(Alignment.BottomCenter).fillMaxHeight(0.5f),
                )
            }
        }
        BottomBar(
            mode = AppMode.BROWSER,
            ...
            aiMode = aiState.aiMode,
            aiInputText = aiState.aiInputText,
            onAiInputTextChange = viewModel::onAiInputTextChange,
            onAiSend = viewModel::onAiSend,
            onSwipeUpToAiMode = viewModel::expandAiMode,
            onSwipeDownToButtonMode = viewModel::collapseAiMode,
        )
    }
}
```

**BrowserViewModel 改动**（m11 真实 handleAgentEvent + m14 init 加载历史）：

```kotlin
@HiltViewModel
class BrowserViewModel @Inject constructor(
    ...,
    private val localAgentService: LocalAgentService,
    private val cloudAgentService: CloudAgentService,
    private val runtimeModeManager: RuntimeModeManager,
    val askUserDialogState: AskUserDialogState,
    private val activePanelIdHolder: ActivePanelIdHolder,
    private val aiConversationRepository: AiConversationRepository,
) : ViewModel() {
    private val _aiModeState = MutableStateFlow(BrowserAiModeState())
    val aiModeState: StateFlow<BrowserAiModeState> = _aiModeState.asStateFlow()

    private var agentJob: Job? = null

    // 当前 tab 所属 panelId（默认 "browser" 字符串，与画布面板隔离）
    private val browserPanelId: String = "browser_session"  // 固定 ID

    // 流式缓冲
    private var pendingAssistantText = StringBuilder()
    private var pendingThinkingText = StringBuilder()

    init {
        // m14：从 Room 加载 browser_session 历史消息
        viewModelScope.launch {
            aiConversationRepository.observeByPanel(browserPanelId).collect { entities ->
                // M2 同款守卫：仅当为空时才覆盖
                if (_aiModeState.value.aiMessages.isEmpty()) {
                    _aiModeState.update { it.copy(aiMessages = entities.map { e -> e.toUiChatMessage() }) }
                }
            }
        }
    }

    fun expandAiMode() { _aiModeState.update { it.copy(aiMode = true, aiExpanded = true) } }
    fun collapseAiMode() { _aiModeState.update { it.copy(aiMode = false, aiExpanded = false) } }
    fun onAiInputTextChange(text: String) { _aiModeState.update { it.copy(aiInputText = text) } }

    fun onAiSend() {
        val message = _aiModeState.value.aiInputText.trim()
        if (message.isEmpty()) return
        _aiModeState.update { it.copy(aiInputText = "") }
        _aiModeState.update { it.copy(aiMessages = it.aiMessages + UiChatMessage("user", message)) }
        // M1 同款：cancel 前先 flush pending
        flushPendingMessages()
        agentJob?.cancel()
        agentJob = viewModelScope.launch {
            val service = pickService()
            service.sendMessage(browserPanelId, message, ThinkingLevel.STANDARD).collect { event ->
                handleAgentEvent(event)
            }
        }
    }

    private fun pickService(): AgentService {
        // m18：删除 AUTO 分支，用 effectiveMode 即可
        return when (runtimeModeManager.state.value.effectiveMode) {
            AgentMode.CLOUD -> cloudAgentService
            else -> localAgentService
        }
    }

    /** m11：真实实现 handleAgentEvent（参考 CanvasHomeViewModel） */
    private fun handleAgentEvent(event: AgentEvent) {
        when (event) {
            is AgentEvent.TurnStart -> {
                pendingAssistantText = StringBuilder()
                pendingThinkingText = StringBuilder()
            }
            is AgentEvent.TextDelta -> {
                pendingAssistantText.append(event.text)
                _aiModeState.update { state ->
                    val msgs = state.aiMessages.toMutableList()
                    if (msgs.isNotEmpty() && msgs.last().role == "assistant") {
                        msgs[msgs.lastIndex] = msgs.last().copy(content = pendingAssistantText.toString())
                    } else {
                        msgs.add(UiChatMessage("assistant", pendingAssistantText.toString()))
                    }
                    state.copy(aiMessages = msgs)
                }
            }
            is AgentEvent.ThinkingDelta -> {
                pendingThinkingText.append(event.text)
                _aiModeState.update { state ->
                    val msgs = state.aiMessages.toMutableList()
                    if (msgs.isNotEmpty() && msgs.last().role == "assistant_thinking") {
                        msgs[msgs.lastIndex] = msgs.last().copy(content = pendingThinkingText.toString())
                    } else {
                        msgs.add(UiChatMessage("assistant_thinking", pendingThinkingText.toString()))
                    }
                    state.copy(aiMessages = msgs)
                }
            }
            is AgentEvent.ToolCallStart -> {
                _aiModeState.update { state ->
                    state.copy(aiMessages = state.aiMessages + UiChatMessage("tool_call", "🔧 ${event.toolName}"))
                }
            }
            is AgentEvent.ToolCallEnd -> {
                val status = if (event.success) "✅" else "❌"
                _aiModeState.update { state ->
                    state.copy(aiMessages = state.aiMessages + UiChatMessage("tool_result", "$status ${event.result.take(100)}"))
                }
            }
            is AgentEvent.TurnEnd -> {
                viewModelScope.launch {
                    val turnIdx = _aiModeState.value.aiMessages.count { it.role == "user" }
                    if (pendingThinkingText.isNotEmpty()) {
                        aiConversationRepository.appendMessage(browserPanelId, "assistant_thinking", pendingThinkingText.toString(), turnIdx)
                    }
                    if (pendingAssistantText.isNotEmpty()) {
                        aiConversationRepository.appendMessage(browserPanelId, "assistant", pendingAssistantText.toString(), turnIdx)
                    }
                }
            }
            is AgentEvent.Error -> {
                _aiModeState.update { state ->
                    state.copy(aiMessages = state.aiMessages + UiChatMessage("error", "⚠ ${event.message}"))
                }
                viewModelScope.launch {
                    val turnIdx = _aiModeState.value.aiMessages.count { it.role == "user" }
                    aiConversationRepository.appendMessage(browserPanelId, "error", "⚠ ${event.message}", turnIdx)
                }
            }
        }
    }

    private fun flushPendingMessages() {
        if (pendingAssistantText.isEmpty() && pendingThinkingText.isEmpty()) return
        viewModelScope.launch {
            val turnIdx = _aiModeState.value.aiMessages.count { it.role == "user" }
            if (pendingThinkingText.isNotEmpty()) {
                aiConversationRepository.appendMessage(browserPanelId, "assistant_thinking", pendingThinkingText.toString(), turnIdx)
                pendingThinkingText = StringBuilder()
            }
            if (pendingAssistantText.isNotEmpty()) {
                aiConversationRepository.appendMessage(browserPanelId, "assistant", pendingAssistantText.toString(), turnIdx)
                pendingAssistantText = StringBuilder()
            }
        }
    }

    override fun onCleared() {
        super.onCleared()
        agentJob?.cancel()
        // m13 同款：disposeSession
        val service = pickService()
        service.disposeSession(browserPanelId)
    }
}
```

**注意**：BrowserViewModel 用固定 `browserPanelId = "browser_session"`，确保与画布面板的 Session 隔离。

### 6.14 Skill 文档（assets/pi/skills/browser-agent/SKILL.md）

```markdown
---
name: browser-agent
description: 浏览器操作 Skill，指导 AI 用 browser_* 工具高效操作浏览器
version: 1.0.0
---

# 浏览器操作指南

可用工具：
- `browser_navigate(url)` - 导航到 URL
- `browser_eval(script)` - 执行任意 JS
- `browser_click(selector)` - 点击元素
- `browser_input(selector, text)` - 在输入框输入文本
- `browser_scroll(x?, y?, selector?)` - 滚动页面
- `browser_wait_for(selector, timeoutMs?)` - 等待元素出现（默认 30s）
- `browser_screenshot()` - 截图当前页面（返回 base64）
- `browser_get_dom(selector?)` - 获取 DOM HTML
- `browser_get_url()` / `browser_get_title()` - 获取 URL/标题
- `browser_back()` / `browser_forward()` / `browser_reload()` - 导航控制
- `browser_get_cookie()` / `browser_set_cookie(name, value, domain?)` - Cookie 管理

使用建议：
1. 先 `browser_get_url` + `browser_get_title` 了解当前页面
2. 用 `browser_wait_for` 等待关键元素加载
3. 用 `browser_click` / `browser_input` 操作表单
4. 用 `browser_screenshot` 给用户确认操作结果
5. 用 `browser_get_dom` 提取结构化数据（注意 token 限制，selector 要精确）

CSS selector 示例：
- 按文本：`a:has-text("登录")` (Playwright 风格，原生 JS 不支持) → 改用 XPath 或 querySelectorAll 后过滤
- 按 ID：`#login-button`
- 按类：`.submit-btn`
- 按属性：`input[name="username"]`
```

### 6.15 AppModule 改动

```kotlin
@Provides @Singleton
fun provideToolRegistry(
    canvasRepository: CanvasRepository,
    kvStorage: KvStorage,
    webviewHolder: ActiveWebViewHolder,
    panelIdHolder: ActivePanelIdHolder,
    askUserDialogState: AskUserDialogState,
    navigatorHolder: ActiveNavigatorHolder,
    cookieManagerWrapper: CookieManagerWrapper,
): ToolRegistry = ToolRegistry().apply {
    val panelIdProvider: () -> String? = { panelIdHolder.value.value }
    val webviewProvider: () -> WebView? = { webviewHolder.value.value }
    
    // M8 已有 10 个
    register(ListWidgetsTool(canvasRepository, panelIdProvider))
    register(StorageReadTool(kvStorage))
    register(StorageWriteTool(kvStorage))
    register(CreateHtmlWidgetTool(canvasRepository, panelIdProvider))
    register(UpdateHtmlWidgetTool(canvasRepository))
    register(DeleteHtmlWidgetTool(canvasRepository))
    register(AskUserTool(askUserDialogState))
    register(BrowserEvalTool(webviewProvider))
    register(BrowserNavigateTool(webviewProvider))
    register(BrowserGetUrlTool(webviewProvider))
    
    // M3 新增 12 个 browser_*
    register(BrowserClickTool(webviewProvider))
    register(BrowserInputTool(webviewProvider))
    register(BrowserScrollTool(webviewProvider))
    register(BrowserWaitForTool(webviewProvider))
    register(BrowserScreenshotTool(webviewProvider))
    register(BrowserGetDomTool(webviewProvider))
    register(BrowserGetTitleTool(webviewProvider))
    register(BrowserBackTool(webviewProvider))
    register(BrowserForwardTool(webviewProvider))
    register(BrowserReloadTool(webviewProvider))
    register(BrowserGetCookieTool(cookieManagerWrapper, webviewProvider))
    register(BrowserSetCookieTool(cookieManagerWrapper, webviewProvider))
    
    // M3 新增 2 个导航
    register(NavigateToPanelTool(navigatorHolder, canvasRepository))
    register(CreatePanelTool(canvasRepository, navigatorHolder))
}

@Provides @Singleton
fun providePanelEventRouter(applicationScope: CoroutineScope): PanelEventRouter =
    PanelEventRouter(applicationScope)

// WsToolCallDispatcher 实现采用 @Inject constructor（@Singleton）由 Hilt 自动注入，无需 @Provides。
// start() 时机见 10.2 节：由 LivingDashboardApp.onCreate() 在 wsClient.connect() 之后调用，
// 比 @Provides .also { it.start() } 更可控——确保 WsClient 已先建立连接，避免订阅 SharedFlow 时无生产者。

@Provides @Singleton
fun provideActiveNavigatorHolder(): ActiveNavigatorHolder = ActiveNavigatorHolder()

@Provides @Singleton
fun provideCloudAgentService(
    wsClient: WsClient,
    panelEventRouter: PanelEventRouter,
    applicationScope: CoroutineScope,
): CloudAgentService = CloudAgentService(wsClient, panelEventRouter, applicationScope)

@Provides @Singleton
fun providePageContextProvider(
    activeWebViewHolder: ActiveWebViewHolder,
): PageContextProvider = PageContextProvider(activeWebViewHolder)

@Provides @Singleton
fun provideAiConversationRepository(
    dao: AiConversationDao,
): AiConversationRepository = AiConversationRepository(dao)
```

### 6.16 LivingWebView 改动

**m5 修复**：删除原 spec 中 `WebViewController.captureVisibleBitmap()` 死代码——`BrowserScreenshotTool` 通过 `webviewProvider: () -> WebView?` 直接访问 WebView，不经过 WebViewController，所以 `captureVisibleBitmap` 没有调用方。**M3 不修改 LivingWebView.kt**，截图实现完全在工具层（参考 6.9.5 节）。

**4.2 节修改文件清单同步删除 `LivingWebView.kt`**（M3 不需要改）。

```kotlin
// WebViewController 维持 M8 原样，M3 不新增方法
class WebViewController {
    internal var webViewRef: WebView? = null

    fun goBack() { webViewRef?.takeIf { it.canGoBack() }?.goBack() }
    fun goForward() { webViewRef?.takeIf { it.canGoForward() }?.goForward() }
    fun reload() { webViewRef?.reload() }
    fun stopLoading() { webViewRef?.stopLoading() }
    fun loadUrl(url: String) { webViewRef?.loadUrl(url) }
    val currentUrl: String? get() = webViewRef?.url
    // 不新增 captureVisibleBitmap（m5：死代码，工具层直接用 WebView.draw）
}
```

### 6.17 Session.kt 改动（loadFromHistory + updateSystemPrompt + C7 Mutex）

**C7 修复**：`_messages` 改用 Mutex 保护（避免 AIAssistantWidget 与 CanvasHomeViewModel 并发操作同一 Session 导致 `ConcurrentModificationException`）。`addUserMessage` / `addAssistantMessage` / `addToolResultMessage` / `trim` / `clear` / `loadFromHistory` / `updateSystemPrompt` 全部用 `mutex.withLock { ... }` 包装。

```kotlin
class Session(val systemPrompt: String, val tools: List<ToolDefinition>) {
    private val mutex = Mutex()  // C7 新增
    private val _messages = mutableListOf<LlmMessage>()
    val messages: List<LlmMessage> get() = mutex.withLock { _messages.toList() }

    init { _messages.add(LlmMessage(role = "system", content = systemPrompt)) }

    /** C7：所有写操作用 mutex.withLock 保护 */
    suspend fun addUserMessage(content: String) = mutex.withLock {
        _messages.add(LlmMessage(role = "user", content = content))
    }
    suspend fun addAssistantMessage(content: String?, toolCalls: List<ToolCall>?) = mutex.withLock {
        _messages.add(LlmMessage(role = "assistant", content = content, toolCalls = toolCalls))
    }
    suspend fun addToolResultMessage(toolCallId: String, content: String) = mutex.withLock {
        _messages.add(LlmMessage(role = "tool", content = content, toolCallId = toolCallId))
    }
    suspend fun trim(keepRecent: Int = 20) = mutex.withLock {
        // 保留 system 消息 + 最近 keepRecent 条
        // M8 已有 tool_call/tool_result 配对修复逻辑
        ... // 原有 trim 逻辑
    }
    suspend fun clear() = mutex.withLock {
        _messages.clear()
        _messages.add(LlmMessage(role = "system", content = systemPrompt))
    }

    /** M3 新增：替换 system prompt（保留后续消息） */
    suspend fun updateSystemPrompt(newPrompt: String) = mutex.withLock {
        if (_messages.isNotEmpty() && _messages[0].role == "system") {
            _messages[0] = LlmMessage(role = "system", content = newPrompt)
        } else {
            _messages.add(0, LlmMessage(role = "system", content = newPrompt))
        }
    }

    /** M3 新增：从历史消息恢复（不覆盖 system 消息） */
    suspend fun loadFromHistory(history: List<LlmMessage>) = mutex.withLock {
        _messages.clear()
        _messages.add(LlmMessage(role = "system", content = systemPrompt))
        _messages.addAll(history.filter { it.role != "system" })
    }
}
```

**注意**：
- 所有写方法改为 `suspend`（因 `mutex.withLock` 是 suspend 函数）
- `messages` getter 也用 `mutex.withLock` 包装，保证读到一致快照
- 调用方（AgentLoop / LocalAgentService）需在协程内调用，已有 flow 上下文，无需额外改造
- M8 已有的 `trim` 中处理"跳过 tail 开头的 tool 消息"逻辑保留不变

### 6.18 CanvasHomeViewModel 改动

**M1 修复**：在 `agentJob?.cancel()` **前**加 `flushPendingMessages(panelId)` 调用，把 pendingAssistantText/pendingThinkingText 持久化到 DB（避免用户连发两条消息时丢失上一条未完成的 AI 回复）。
**M3 修复**：`init` 块用 `flatMapLatest` 替代嵌套 collect（避免内层 collect 不取消导致 N 个 collector 并发写 _uiMessages）。
**m10 修复**：`turnIndex` 改为按用户消息计数 `turnIndex = _uiMessages.value.count { it.role == "user" }`（原 `(_uiMessages.value.size + 1) / 2` 不准）。
**m18 修复**：删除 AUTO 分支（effectiveMode 已解析）。

```kotlin
@HiltViewModel
class CanvasHomeViewModel @Inject constructor(
    private val canvasRepository: CanvasRepository,
    private val localAgentService: LocalAgentService,
    private val cloudAgentService: CloudAgentService,
    private val runtimeModeManager: RuntimeModeManager,
    val askUserDialogState: AskUserDialogState,
    private val activePanelIdHolder: ActivePanelIdHolder,
    private val aiConversationRepository: AiConversationRepository,  // M3 新增
) : ViewModel() {
    // ... 现有字段 ...

    private var pendingAssistantText = StringBuilder()
    private var pendingThinkingText = StringBuilder()
    private var pendingToolCalls = mutableListOf<Pair<String, String>>()  // callId, toolName

    init {
        // M3 修复：用 flatMapLatest 替代嵌套 collect，避免内层不取消
        viewModelScope.launch {
            currentPanelId.filterNotNull().flatMapLatest { panelId ->
                aiConversationRepository.observeByPanel(panelId)
            }.collect { entities ->
                // M2 同款守卫：仅当 UI 消息列表为空时才覆盖
                if (_uiMessages.value.isEmpty()) {
                    _uiMessages.value = entities.map { it.toUiChatMessage() }
                }
            }
        }
    }

    fun onAiSend() {
        val message = _aiInputText.value.trim()
        if (message.isEmpty()) return
        _aiInputText.value = ""
        _uiMessages.update { it + UiChatMessage(role = "user", content = message) }

        // m10：turnIndex 按用户消息计数
        val turnIdx = _uiMessages.value.count { it.role == "user" }

        // 持久化用户消息
        viewModelScope.launch {
            aiConversationRepository.appendMessage(
                panelId = currentPanelId.value ?: return@launch,
                role = "user",
                content = message,
                turnIndex = turnIdx,
            )
        }

        // M1 修复：cancel 前先 flush pending（避免 pendingAssistantText/pendingThinkingText 丢失）
        flushPendingMessages(currentPanelId.value)

        agentJob?.cancel()
        agentJob = viewModelScope.launch {
            val panelId = currentPanelId.value ?: run {
                _uiMessages.update { it + UiChatMessage(role = "error", content = "⚠ 无可用面板") }
                return@launch
            }
            activePanelIdHolder.value.value = panelId

            // m18：删除 AUTO 分支（effectiveMode 已解析）
            val service = when (runtimeModeManager.state.value.effectiveMode) {
                AgentMode.CLOUD -> cloudAgentService
                else -> localAgentService  // LOCAL + 兜底
            }

            service.sendMessage(panelId, message, _currentThinkingLevel.value).collect { event ->
                handleAgentEvent(event, panelId)
            }
        }
    }

    /** 流式缓冲 + TurnEnd 批量持久化（避免 TextDelta 多次 IO） */
    private fun handleAgentEvent(event: AgentEvent, panelId: String) {
        when (event) {
            is AgentEvent.TurnStart -> {
                pendingAssistantText = StringBuilder()
                pendingThinkingText = StringBuilder()
                pendingToolCalls.clear()
            }
            is AgentEvent.TextDelta -> {
                pendingAssistantText.append(event.text)
                // UI 流式追加（与 CanvasHomeViewModel 现有逻辑一致）
            }
            is AgentEvent.ThinkingDelta -> {
                pendingThinkingText.append(event.text)
            }
            is AgentEvent.ToolCallStart -> {
                pendingToolCalls.add(event.callId to event.toolName)
                _uiMessages.update { it + UiChatMessage("tool_call", "🔧 ${event.toolName}") }
            }
            is AgentEvent.ToolCallEnd -> {
                val status = if (event.success) "✅" else "❌"
                _uiMessages.update { it + UiChatMessage("tool_result", "$status ${event.result.take(100)}") }
            }
            is AgentEvent.TurnEnd -> {
                // 批量持久化
                viewModelScope.launch {
                    val turnIdx = _uiMessages.value.count { it.role == "user" }
                    if (pendingThinkingText.isNotEmpty()) {
                        aiConversationRepository.appendMessage(panelId, "assistant_thinking", pendingThinkingText.toString(), turnIdx)
                    }
                    if (pendingAssistantText.isNotEmpty()) {
                        // C6：若同时有 toolCalls，序列化为 args 字段
                        val args = if (pendingToolCalls.isNotEmpty()) {
                            aiConversationRepository.serializeToolCalls(
                                pendingToolCalls.map { (callId, toolName) ->
                                    ToolCall(id = callId, name = toolName, arguments = JsonObject(emptyMap()))
                                }
                            )
                        } else null
                        aiConversationRepository.appendMessage(panelId, "assistant", pendingAssistantText.toString(), turnIdx, args = args)
                    }
                    pendingToolCalls.forEach { (callId, toolName) ->
                        aiConversationRepository.appendMessage(panelId, "tool_call", "🔧 $toolName", turnIdx, toolCallId = callId, toolName = toolName)
                    }
                }
            }
            is AgentEvent.Error -> {
                _uiMessages.update { it + UiChatMessage("error", "⚠ ${event.message}") }
                viewModelScope.launch {
                    val turnIdx = _uiMessages.value.count { it.role == "user" }
                    aiConversationRepository.appendMessage(panelId, "error", "⚠ ${event.message}", turnIdx)
                }
            }
        }
    }

    /** M1 修复：把 pending 文本持久化到 DB（cancel 前调用） */
    private fun flushPendingMessages(panelId: String?) {
        if (panelId == null) return
        if (pendingAssistantText.isEmpty() && pendingThinkingText.isEmpty() && pendingToolCalls.isEmpty()) return
        viewModelScope.launch {
            val turnIdx = _uiMessages.value.count { it.role == "user" }
            if (pendingThinkingText.isNotEmpty()) {
                aiConversationRepository.appendMessage(panelId, "assistant_thinking", pendingThinkingText.toString(), turnIdx)
                pendingThinkingText = StringBuilder()
            }
            if (pendingAssistantText.isNotEmpty()) {
                val args = if (pendingToolCalls.isNotEmpty()) {
                    aiConversationRepository.serializeToolCalls(
                        pendingToolCalls.map { (callId, toolName) ->
                            ToolCall(id = callId, name = toolName, arguments = JsonObject(emptyMap()))
                        }
                    )
                } else null
                aiConversationRepository.appendMessage(panelId, "assistant", pendingAssistantText.toString(), turnIdx, args = args)
                pendingAssistantText = StringBuilder()
            }
            pendingToolCalls.forEach { (callId, toolName) ->
                aiConversationRepository.appendMessage(panelId, "tool_call", "🔧 $toolName", turnIdx, toolCallId = callId, toolName = toolName)
            }
            pendingToolCalls.clear()
        }
    }
}
```

### 6.19 CanvasHomeScreen 改动

```kotlin
@Composable
fun CanvasHomeScreen(...) {
    val thinkingLevel by viewModel.currentThinkingLevel.collectAsStateWithLifecycle()
    val runtimeMode by viewModel.runtimeMode.collectAsStateWithLifecycle()
    
    Column {
        ...
        if (aiExpanded) {
            AgentModeSwitcher(
                runtimeMode = runtimeMode,
                thinkingLevel = thinkingLevel,
                onModeChange = viewModel::onAgentModeChange,
                onThinkingLevelChange = viewModel::onThinkingLevelChange,
            )
        }
        AIInputPill(...)
        ...
    }
}
```

`AgentModeSwitcher` 内部用 `ThinkingLevelSlider` 替换 `ThinkingLevelDropdown`。

### 6.20 AppNavGraph 改动

```kotlin
@Composable
fun AppNavGraph(
    navController: NavHostController,
    appMode: AppMode,
    mainViewModel: MainViewModel,
    activeNavigatorHolder: ActiveNavigatorHolder,  // M3 新增
) {
    LaunchedEffect(navController) {
        activeNavigatorHolder.value.value = navController
    }
    DisposableEffect(Unit) {
        onDispose { activeNavigatorHolder.value.value = null }
    }
    
    NavHost(navController = navController, startDestination = ...) {
        ...
    }
}
```

`MainActivity` 注入 `ActiveNavigatorHolder` 并传给 `AppNavGraph`。

### 6.21 build.gradle.kts 改动

```kotlin
android {
    defaultConfig {
        versionCode = 9  // M3
        versionName = "0.1.0-m3"
    }
}

dependencies {
    // === M3 新增：Compose UI 测试依赖（用于 ThinkingLevelSliderTest 的滑动交互测试） ===
    testImplementation("androidx.compose.ui:ui-test-junit4")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}
```

**说明**：M8 已有 compose-ui / compose-material3 等运行时依赖，但缺 Compose UI 测试依赖。`ThinkingLevelSliderTest` 需用 `createComposeRule()` 验证滑动交互与刻度切换，必须引入 `ui-test-junit4`；`ui-test-manifest` 仅 debug 依赖，提供测试 Activity 容器。

其余运行时依赖（kotlinx-serialization / kotlinx-coroutines / room / hilt / okhttp 等）M8 已加，无需重复。

---

## 七、实现顺序

按依赖顺序，每步可独立编译测试：

### 7.1 数据层（独立，无 UI 依赖）

1. `AiConversationEntity.kt` + `AiConversationDao.kt`
2. `LivingDatabase.kt` 改（version 3 + MIGRATION_2_3）
3. `DatabaseModule.kt` 改（addMigrations）
4. `AiConversationRepository.kt`
5. `AiConversationDaoTest.kt`（Robolectric）

### 7.2 AI 核心层（独立，无 UI 依赖）

6. `PanelEventRouter.kt` + `PanelEventRouterTest.kt`
7. `ActiveNavigatorHolder`（合入 `ActiveHolders.kt`）
8. `PageContextProvider.kt` + `PageContextProviderTest.kt`
9. `WsToolCallDispatcher.kt` + `WsToolCallDispatcherTest.kt`
10. `AgentService.kt`（接口）
11. `CloudAgentService.kt` + `CloudAgentServiceTest.kt`
12. `Session.kt` 改（updateSystemPrompt + loadFromHistory）
13. `LocalAgentService.kt` 改（实现 AgentService + 注入 PageContextProvider）

### 7.3 工具层（独立，无 UI 依赖）

14. 12 个 browser_* 工具（按 6.9 节实现）
15. 2 个导航工具（NavigateToPanelTool / CreatePanelTool）
16. `CanvasRepository.createHtmlWidget` 改为返回 widgetId（供 create_panel 工具用，不新增 createWebviewWidget）
17. `ToolsTest.kt` 扩展 14 个新工具用例
18. `AppModule.provideToolRegistry` 注册 14 个新工具

### 7.4 UI 层

20. `ThinkingLevelSlider.kt` + `ThinkingLevelSliderTest.kt`
21. `AgentModeSwitcher.kt` 改（用 Slider 替换 Dropdown）
22. `WidgetRenderParams.kt` 改（新增 panelId）
23. `WidgetContainer.kt` 改（传 panelId）
24. `AiWidgetViewModel.kt` 新增
25. `AIAssistantWidget.kt` 改（真实化）
26. `BottomBar.kt` 改（AI 模式参数）
27. `BrowserAiModeState.kt` 新增
28. `BrowserViewModel.kt` 改（AI 模式状态 + onAiSend）
29. `BrowserScreen.kt` 改（AI 对话浮层 + 底部栏 AI 模式）
30. `CanvasHomeViewModel.kt` 改（AgentService 接口 + 持久化）
31. `CanvasHomeScreen.kt` 改（用 ThinkingLevelSlider）
32. `AppNavGraph.kt` 改（注入 ActiveNavigatorHolder）
33. `MainActivity.kt` 改（注入 + 传 ActiveNavigatorHolder）

### 7.5 资源

34. `assets/pi/skills/browser-agent/SKILL.md`

### 7.6 集成与测试

35. 编译 + 单测全绿（M8 用例 + M3 新增用例）
36. `./gradlew assembleDebug` + 真机安装
37. 运行时验证（按 9.1 节场景）
38. `./gradlew assembleRelease` + 签名验证

### 7.7 收尾

39. `roadmap_mobile_v1.md` 更新 Phase M3 状态为已完成
40. `git commit -m "feat(mobile): Phase M3 AI integration (cloud + browser tools + persistence + UI)"`

---

## 八、测试策略

### 8.1 单元测试（必须全绿）

#### 新增测试文件

| 文件 | 覆盖范围 |
|------|---------|
| `WsToolCallDispatcherTest.kt` | ToolCall 派发 / targetDeviceId 过滤 / 30s 超时 / ToolResult 回传 |
| `PanelEventRouterTest.kt` | getOrCreate / dispatch / dispose / 多面板隔离 |
| `CloudAgentServiceTest.kt` | WS 不在线 emit Error / send 失败 emit Error / PiEvent 转 AgentEvent / 120s 超时 + DisposeSession 回传 |
| `PageContextProviderTest.kt` | WebView null 返回 null / 主线程读取 URL/title / 非 UI 线程切到 Main |
| `AiConversationDaoTest.kt` | insert / observeByPanel / getRecentByPanel / deleteByPanel / countByPanel |
| `ThinkingLevelSliderTest.kt` | 4 档刻度 / 滑动切换 / 标签显示（Compose UI 测试，用 `createComposeRule()`） |
| `AiWidgetViewModelTest.kt` | initialize 守卫（重复调用不重置）/ TextDelta 累积 pendingAssistantText / TurnEnd 批量持久化 / ToolCallStart+End 配对 / onCleared 调 disposeSession / flushPendingMessages 在 cancel 前调用 |
| `BrowserViewModelTest.kt` | init 从 Room 加载 browser_session 历史 / handleAgentEvent 全链路（TurnStart/TextDelta/ThinkingDelta/ToolCallStart/End/TurnEnd/Error）/ flushPendingMessages / onCleared 调 disposeSession(browserPanelId) |

#### 扩展测试文件

| 文件 | 新增用例 |
|------|---------|
| `ToolsTest.kt` | 12 个新 browser_* 工具 + 2 个导航工具，每个工具：参数校验 + 成功 + 失败（mock WebView/CookieManager/NavController） |
| `SessionTest.kt` | updateSystemPrompt / loadFromHistory |
| `LocalAgentServiceTest.kt` | PageContextProvider 注入（M8 已有 6 用例，扩展验证 system prompt 末尾有 URL） |

### 8.2 集成测试（运行时验证）

详见第九章。

### 8.3 测试运行

```bash
cd f:\allmylife\event\client\android
F:\allmylife\gradle-8.2-bin\bin\gradle.bat testDebugUnitTest
F:\allmylife\gradle-8.2-bin\bin\gradle.bat test
```

---

## 九、运行时验证（必须真机或模拟器）

### 9.1 验证场景（10 个，必须全通过）

#### 场景 1：LOCAL 模式对话（M8 回归）

1. 启动 App → 设置 → AI 配置 → 输入 stepfun API Key → 测试连接
2. 切到画布主页 → 展开 AI 输入框 → 发送"你好"
3. 验证：流式输出 AI 回复，UI 显示加载态 → 完成态
4. 验证：logcat 看到 `LlmClient SSE 流式接收 → AgentLoop 处理 → UI 流式渲染`

#### 场景 2：CLOUD 模式对话（M3 新增）

1. 启动 App（WS 服务器在线）
2. 切换 Agent 模式为 CLOUD
3. 发送"你好" → 验证：消息通过 WS 发到服务器，PiEvent 流式返回
4. 验证：UI 显示流式回复
5. 验证：logcat 看到 `WS send: UserMessage → WS recv: PiEvent text_delta`

#### 场景 3：AI 操控浏览器（M3 新增）

1. 在画布主页发送"打开百度搜索'AI 浏览器'"
2. AI 调用 `browser_navigate` → `browser_wait_for` → `browser_input` → `browser_click`
3. 验证：浏览器自动打开百度，输入"AI 浏览器"，点击搜索
4. 验证：UI 显示每步工具调用进度
5. 验证：搜索结果页面加载完成

#### 场景 4：AI 截图（M3 新增）

1. 在画布主页发送"截图当前页面"
2. AI 调用 `browser_screenshot`
3. 验证：工具返回 base64 图片（至少 10KB）
4. 验证：AI 收到截图后能描述页面内容

#### 场景 5：AI 创建组件（M8 回归 + M3 扩展）

1. 在画布主页发送"创建一个 HTML 组件显示当前时间"
2. AI 调用 `create_html_widget`
3. 验证：画布上出现新组件，显示时间
4. 切到画布页 → 验证组件可交互

#### 场景 6：AI 导航到面板（M3 新增）

1. 在画布主页发送"切换到第一个面板"或"切换到名称为 XX 的面板"
2. AI 调用 `navigate_to_panel`
3. 验证：自动跳转到对应画布面板

#### 场景 7：AI 创建新面板（M3 新增）

1. 在画布主页发送"创建一个新面板叫'工作'，放一个 HTML 组件显示待办列表"
2. AI 调用 `create_panel`
3. 验证：新面板创建成功，自动跳转到新面板，组件已创建

#### 场景 8：思考等级滑块（M3 新增）

1. 画布主页 → 展开 AI → 看到 4 档滑块（快速/平衡/深度/极深度）
2. 滑动到"快速" → 发送消息 → 验证 LLM 请求参数变化（logcat）
3. 滑动到"极深度" → 发送消息 → 验证思考链显示 + 推理更深

#### 场景 9：底部栏 AI 模式（M3 新增）

1. 浏览器模式 → 上滑底部栏 → 切换到 AI 输入框模式
2. AI 输入框聚焦 → 验证半屏 AI 对话空间展开
3. 发送"总结当前页面" → 验证 AI 基于当前网页内容回复
4. 下滑 AI 对话空间 → 验证回到按钮模式

#### 场景 10：对话持久化（M3 新增）

1. 在画布主页发送几条消息
2. 杀掉 App（adb shell am force-stop com.livingdashboard）
3. 重新启动 App → 切到画布主页 → 验证：上次对话历史恢复显示

### 9.2 验证方法

- **adb logcat**：`adb logcat -s LivingDashboard.WS:* LlmClient:* AgentLoop:* ToolRegistry:*`
- **adb shell dumpsys**：`adb shell dumpsys activity activities | findstr com.livingdashboard`
- **adb shell am force-stop**：杀 App 测持久化
- **adb install -r**：装新 APK
- **截图**：`adb shell screencap /sdcard/verify.png && adb pull /sdcard/verify.png`

### 9.3 验证脚本（Playwright MCP 不适用，用 adb 直接验证）

> Playwright MCP 用于浏览器自动化，不是 Android 自动化。Android 用 adb + uiautomator。

每个场景：
1. `adb install -r app/build/outputs/apk/release/app-release.apk`
2. `adb shell am start -n com.livingdashboard/.MainActivity`
3. `adb logcat -c && adb logcat | findstr "LivingDashboard LlmClient AgentLoop ToolRegistry WsClient"`
4. 手动操作 UI（无法完全自动化，需要人 or adb input）
5. 验证 logcat 输出符合预期
6. `adb shell screencap` 截图证据

### 9.4 验证通过标准

10 个场景必须全部通过。任一场景失败 → 修复 → 重新验证。

允许跳过项（需在最终报告中说明原因）：
- 真机端到端 UI 交互（若设备 PIN 锁阻塞）：用 logcat + 源码静态验证替代
- 5 provider 真机 e2e：需用户提供真实 API Key 后单独验证

---

## 十、对抗审查检查清单

实现完成后必须用 `adversarial-review` skill 跑对抗审查，包含以下检查点：

### 10.1 代码层

- [ ] 所有 14 个新工具实现 `Tool` 接口，`execute` 有 `withTimeoutOrNull(30_000)` 超时
- [ ] 所有 WebView 操作用 `webView.post { ... }` 切主线程
- [ ] `PanelEventRouter` 线程安全（ConcurrentHashMap + tryEmit）
- [ ] `WsToolCallDispatcher` 处理 `targetDeviceId` 过滤（多端路由不串）
- [ ] `CloudAgentService` 120s 超时 emit Error + 发 `DisposeSession` 到服务器（架构 C8）
- [ ] `LocalAgentService` 每次发消息更新 system prompt（页面上下文变化）
- [ ] `Session.updateSystemPrompt` 不破坏 tool_call/tool_result 配对
- [ ] `LivingDatabase.MIGRATION_2_3` SQL 正确，索引创建
- [ ] `AiConversationRepository.getRecentForSessionRestore` 正确过滤 thinking/tool_call/error 消息
- [ ] `CanvasHomeViewModel` 持久化在 TurnEnd 批量写入（不在 TextDelta 多次写）
- [ ] `BrowserViewModel` 用固定 `browserPanelId` 与画布面板 Session 隔离
- [ ] `ThinkingLevelSlider` steps=2 正确（4 档 = 3 间隔 = steps=2）
- [ ] `build.gradle.kts` 新增 Compose UI 测试依赖（`ui-test-junit4` + `ui-test-manifest`）
- [ ] `WidgetRenderParams.panelId` 加默认值 `= ""`，既有调用方无需修改

### 10.2 集成层

- [ ] `AppModule.provideToolRegistry` 注册全部 14 个新工具
- [ ] `WsToolCallDispatcher` 由 `LivingDashboardApp.onCreate()` 调用 `start()` 自动启动（在 `wsClient.connect()` 之后）
- [ ] `AppNavGraph` 正确写入 `ActiveNavigatorHolder`
- [ ] `MainActivity` 注入 `ActiveNavigatorHolder` 传给 `AppNavGraph`
- [ ] `WidgetRenderParams` 新增 `panelId` 字段，`WidgetContainer` 传入
- [ ] `AIAssistantWidget` 真实化，不再回显占位文字
- [ ] `BottomBar` AI 模式切换正常（上滑 → AI 模式，下滑 → 按钮模式）

### 10.3 运行时验证

- [ ] 10 个验证场景全部通过
- [ ] logcat 无 FATAL EXCEPTION
- [ ] Debug APK < 20MB
- [ ] Release APK 签名验证通过
- [ ] 真机安装启动成功
- [ ] DB migration 不丢数据（升级前后对比）

### 10.4 测试

- [ ] 所有 M8 单测仍通过（131 用例）
- [ ] M3 新增单测全绿（WsToolCallDispatcher / PanelEventRouter / CloudAgentService / PageContextProvider / AiConversationDao / ThinkingLevelSlider + ToolsTest 扩展）
- [ ] 总用例数 ≥ 160

---

## 十一、验收标准（roadmap M3 行 1377-1384）

- [ ] AI 对话框能对话（场景 1 + 场景 2）
- [ ] AI 助手组件正常（每面板独立）（场景 5 + 场景 6）
- [ ] 底部栏 AI 输入框模式正常（场景 9）
- [ ] AI 能操控浏览器（DOM/Cookie/截图/点击/输入）（场景 3 + 场景 4）
- [ ] AI 能导航/创建面板（场景 6 + 场景 7）
- [ ] 思考等级 4 档可切换，不同等级推理深度不同（场景 8）
- [ ] **生成签名 apk 并通过干净 Android 安装测试**

---

## 十二、风险与缓解

| 风险 | 缓解措施 |
|------|---------|
| WS 服务器不可用 | RuntimeModeManager 已实现 AUTO 模式自动降级 LOCAL |
| LLM API Key 未配置 | LocalAgentService 已检查并 emit Error 提示去配置 |
| AI 调工具超时 | 所有工具有 30s `withTimeoutOrNull`，超时返回 ToolResult.error |
| DB migration 失败 | `MIGRATION_2_3` SQL 测试 + `fallbackToDestructiveMigration` 兜底 |
| WebView 在主线程外的访问 | 所有 WebView 操作 `webView.post { ... }` 切主线程 |
| 多端路由时收到非目标 ToolCall | `WsToolCallDispatcher` 检查 `targetDeviceId != myDeviceId` 跳过 |
| CloudAgentService 120s 无响应 | `withTimeoutOrNull(120_000)` 覆盖 browser_wait_for 30s + screenshot 30s + LLM 60s 最坏情况；超时后发 `ClientMessage.DisposeSession(panelId)` 强制清理服务器 session（架构 C8） |
| 持久化与流式渲染竞争 | 用 `pendingAssistantText` 缓冲，TurnEnd 时批量写；`flushPendingMessages` 在 job cancel 前调用避免丢失 |
| ThinkingLevelSlider steps 计算错误 | 测试覆盖 4 档切换 + 验证 logcat 中 LLM 请求参数 |
| AIAssistantWidget 与 CanvasHomeViewModel session 冲突 | 同面板共享 Session，但 `LocalAgentService.sessions` 改 `ConcurrentHashMap` + `Session` 内部 `Mutex` 保护所有写操作（架构 C7） |
| 浏览器模式 AI 与画布模式 AI session 隔离 | BrowserViewModel 用固定 `browserPanelId` |
| **R-7：PiEvent 事件类型未验证**（架构 C5） | `WsToolCallDispatcher.handlePiEvent` 假设 event.type 为 `text_delta`/`thinking_delta`/`turn_start`/`turn_end`/`error`，但 pi-coding-agent SDK 实际 emit 的 type 字符串未经验证。若 SDK 用不同命名（如 `text`/`reasoning`/`turn-start` 连字符），所有 CLOUD 模式事件会被 `else -> Log.w` 丢弃，UI 收不到流式回复。**缓解**：(1) `else` 分支用 `Log.w` 而非静默 return 便于 logcat 调试；(2) 实施前先跑最小 CLOUD demo，logcat 抓取实际 event.type 固化映射表；(3) 第九章场景 2 必须真机验证 CLOUD 流式回复可见 |

---

## 十三、附录

### 13.1 14 个新工具的 JSON Schema

每个工具用 `toolObjectSchema { ... }` 构建，格式与 M8 工具一致。示例（BrowserClickTool）：

```kotlin
override val definition = ToolDefinition(
    name = "browser_click",
    description = "点击页面中匹配 CSS selector 的元素。",
    parameters = toolObjectSchema {
        put("selector", buildJsonObject {
            put("type", "string")
            put("description", "CSS selector，如 #login-btn 或 .submit")
        })
        putJsonArray("required") { add("selector") }
    },
)
```

### 13.2 关键文件路径速查

#### 新增文件

```
app/src/main/java/com/livingdashboard/
├── ai/
│   ├── AgentService.kt
│   ├── CloudAgentService.kt
│   ├── PanelEventRouter.kt
│   ├── WsToolCallDispatcher.kt
│   ├── PageContextProvider.kt
│   └── tools/
│       ├── BrowserClickTool.kt
│       ├── BrowserInputTool.kt
│       ├── BrowserScrollTool.kt
│       ├── BrowserWaitForTool.kt
│       ├── BrowserScreenshotTool.kt
│       ├── BrowserGetDomTool.kt
│       ├── BrowserGetTitleTool.kt
│       ├── BrowserBackTool.kt
│       ├── BrowserForwardTool.kt
│       ├── BrowserReloadTool.kt
│       ├── BrowserGetCookieTool.kt
│       ├── BrowserSetCookieTool.kt
│       ├── NavigateToPanelTool.kt
│       └── CreatePanelTool.kt
├── data/
│   ├── entity/AiConversationEntity.kt
│   ├── dao/AiConversationDao.kt
│   └── repository/AiConversationRepository.kt
└── ui/
    ├── canvas/components/ThinkingLevelSlider.kt
    ├── widget/AiWidgetViewModel.kt
    └── browser/BrowserAiModeState.kt

app/src/main/assets/pi/skills/browser-agent/SKILL.md

app/src/test/java/com/livingdashboard/
├── ai/
│   ├── WsToolCallDispatcherTest.kt
│   ├── PanelEventRouterTest.kt
│   ├── CloudAgentServiceTest.kt
│   └── PageContextProviderTest.kt
├── data/dao/AiConversationDaoTest.kt
└── ui/canvas/components/ThinkingLevelSliderTest.kt
```

#### 修改文件

```
app/src/main/java/com/livingdashboard/
├── ai/
│   ├── ActiveHolders.kt           # 新增 ActiveNavigatorHolder
│   ├── LocalAgentService.kt       # 实现 AgentService + 注入 PageContextProvider
│   └── Session.kt                 # updateSystemPrompt + loadFromHistory
├── browser/LivingWebView.kt       # WebViewController.captureVisibleBitmap
├── data/
│   ├── db/LivingDatabase.kt       # version 3 + MIGRATION_2_3
│   └── repository/CanvasRepository.kt  # createHtmlWidget 返回 widgetId
├── di/
│   ├── AppModule.kt               # 注册 14 工具 + 5 新 @Provides
│   └── DatabaseModule.kt          # addMigrations
├── ui/
│   ├── canvas/
│   │   ├── CanvasHomeViewModel.kt  # AgentService 接口 + 持久化
│   │   ├── CanvasHomeScreen.kt     # ThinkingLevelSlider
│   │   └── components/AgentModeSwitcher.kt  # Slider 替换 Dropdown
│   ├── widget/
│   │   ├── AIAssistantWidget.kt    # 真实化
│   │   └── WidgetRenderParams.kt   # 新增 panelId
│   ├── components/BottomBar.kt     # AI 模式参数
│   ├── browser/
│   │   ├── BrowserScreen.kt        # AI 对话浮层
│   │   └── BrowserViewModel.kt     # AI 模式状态
│   ├── canvas/components/WidgetContainer.kt  # 传 panelId
│   ├── nav/AppNavGraph.kt          # 注入 ActiveNavigatorHolder
│   └── MainActivity.kt             # 注入 + 传 ActiveNavigatorHolder

app/build.gradle.kts                # versionCode 9 / versionName 0.1.0-m3
```

### 13.3 实施估算

- 新增文件 22 个 + 修改文件 18 个 = 40 个文件
- 新增代码量估算：~3500 行 Kotlin + ~200 行测试 + ~80 行 SKILL.md
- 单测新增 ~40 个用例 + 扩展 ~20 个用例

### 13.4 关键决策记录

1. **CLOUD 模式实现位置**：新建 `CloudAgentService` 类，与 `LocalAgentService` 平级，都实现 `AgentService` 接口。不在 `LocalAgentService` 内分支判断（避免类过大）。

2. **WsToolCallDispatcher 启动时机**：由 `LivingDashboardApp.onCreate()` 调用 `start()` 自动启动（在 `wsClient.connect()` 之后），依赖 `applicationScope`。此时机比 `@Provides .also { it.start() }` 更可控——确保 WsClient 已先建立连接，避免订阅 SharedFlow 时无生产者（实现采用 `@Inject constructor` + `@Singleton` 由 Hilt 自动注入，无需 `@Provides`）。

3. **AIAssistantWidget 与 CanvasHomeViewModel session 共享**：两者用同一 panelId 调 `LocalAgentService.sendMessage`，自动复用同一 Session（设计如此，同面板 AI 共享上下文）。

4. **BrowserViewModel 用固定 `browserPanelId`**：浏览器模式不绑定具体面板，用一个固定 ID `"browser_session"` 隔离 AI 上下文，避免与画布面板串扰。

5. **持久化时机**：用 `pendingAssistantText` 缓冲，TurnEnd 时批量写入，避免 TextDelta 多次 IO。

6. **ThinkingLevelSlider steps**：`Slider(valueRange = 0f..3f, steps = 2)` = 4 档（0, 1, 2, 3）。验证：steps=N 表示 N 个中间点，共 N+2 个档位（含两端）。

7. **WidgetRenderParams 新增 panelId**：M2 没传 panelId，AIAssistantWidget 无法知道所属面板。M3 在 WidgetRenderParams 加 `panelId: String = ""` 字段（带默认值，**非破坏性改动**），既有 Widget 渲染函数调用无需修改；AIAssistantWidget 内部传入真实 panelId。CanvasScreen.kt 等调用方因默认值存在，不需改动。

8. **DB version 3 migration**：必须写 SQL，不能用 destructive migration（会丢用户数据）。M3 是首次引入 ai_conversations 表，新表无数据，migration 仅 CREATE TABLE。

9. **PageContextProvider 用 suspend**：不用 runBlocking（反模式），改 `suspend fun getCurrentContext(): PageContext?` + `withContext(Dispatchers.Main)`。

10. **CloudAgentService 超时**：120s（覆盖 browser_wait_for 30s + browser_screenshot 30s + LLM 推理 60s 最坏情况，架构 C8）。超时 emit Error + 发 `ClientMessage.DisposeSession(panelId)` 清理服务器 session，不静默。

---

**Spec 结束**。

实施时按第七章顺序推进，每步可独立编译。完成后跑第八章测试，再跑第九章运行时验证，最后用 `adversarial-review` skill 跑第十章检查清单。
