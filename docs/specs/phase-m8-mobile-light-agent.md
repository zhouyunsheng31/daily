# Phase M8 详细 Spec：单机轻 Agent（移动端）

> 生成日期：2026-06-27
> 基于 [roadmap_mobile_v1.md Phase M8](../roadmap_mobile_v1.md) + [architecture_refactor.md 第十三章](../architecture_refactor.md)
> 关联：[layout-design-mobile.md](../layout-design-mobile.md)（CanvasHomeScreen AI 输入框展开态）
> 测试说明：[roadmap_mobile_v1.md 十三、AI 接入测试说明](../roadmap_mobile_v1.md)

---

## 一、项目目的与范围

### 1.1 目的

无服务器时移动端也能用 AI（调用户自配 API Key），用 Kotlin 从零仿写 Pi Agent 核心循环。云端 Pi Agent 作为增强（多端共享上下文 + skills 同步），本地是保底（离线 + 自配 Key 省钱）。

**双端 Pi Agent 对比**（参考架构 13.10）：

| 维度 | 云端 Pi Agent（M3） | 本地轻 Agent（M8） |
|------|---------------------|---------------------|
| 模型 | 服务器配置 | 用户自配（6 provider，含 gemini 可选） |
| 上下文 | 按面板共享，多端同步 | 本地 inMemory，不同步 |
| 工具 | 28 个（WS 路由到设备） | 10 个（直接执行） |
| 思考等级 | 6 provider × 4 档 | 6 provider × 4 档（M8 与云端同表） |
| 离线 | 不可用 | 可用（AUTO 模式自动降级） |
| 多端协作 | 支持 | 不支持 |
| Skills | 服务器 ai_settings + user_skills | 本地 assets/pi/skills/ |
| API Key | 服务器 auth.json（不下发） | 客户端 EncryptedSharedPreferences |

### 1.2 与已有 Phase 的关系

| Phase | 关系 |
|------|------|
| M0/M1/M2（已完成） | M8 复用已有的 WsClient（判在线）、CanvasRepository（工具操作）、LivingWebView（browser_* 工具）、SettingsStore |
| M3（未做） | M3 是云端 AI 集成（WS ToolCall 路由）；M8 是单机 AI。M8 不依赖 M3，独立运行 |
| M9（贯穿） | M8 完成后必须生成签名 release apk + 真机安装 |
| M10（后置） | M10 AI 自动化测试需 M3 + M8 落地后启动 |

### 1.3 范围（roadmap M8 任务清单逐项映射）

| roadmap 任务 | 本 Spec 落地文件 |
|------|------|
| LLM 客户端 | `ai/LlmClient.kt` |
| Agent Loop | `ai/AgentLoop.kt` |
| 工具注册 | `ai/Tool.kt` + `ai/ToolRegistry.kt` |
| Session 上下文 | `ai/Session.kt` |
| Skills 加载 | `ai/SkillLoader.kt` |
| 用户 API Key 存储 | `ai/ApiKeyStore.kt`（EncryptedSharedPreferences） |
| 思考等级映射 | `ai/ThinkingLevel.kt` |
| Agent 切换 UI | `ui/canvas/components/AgentModeSwitcher.kt` + CanvasHome 接入 |
| 离线降级 | `ai/RuntimeModeManager.kt` + UI 提示 |

### 1.4 不在 M8 范围

- ❌ 云端 Pi Agent 集成（M3 任务）—— `AgentModeSwitcher` 的"云端"按钮仅占位（点击 Toast "M3 未实现"）
- ❌ 脚本系统（M4 任务）
- ❌ 数据同步（M5 任务）—— Session 仅 inMemory，不持久化到 Room（避免与 M5 冲突）
- ❌ 完整 28 个工具（架构 13.4/13.10）——M8 实现 10 个最小集（见 6.9）
- ❌ 底部栏 AI 输入框模式（M3 任务）—— M8 只接入 CanvasHome AI 对话框

---

## 二、与架构文档第 13 章对应

| 架构 13.x | 本 Spec 章节 |
|------|------|
| 13.1 背景 | 一、1.1 |
| 13.2 Pi 包安装修复 | 不适用（属服务器端 npm install / 桌面端 workspace，M8 移动端从零仿写 Kotlin，不依赖 Pi 包） |
| 13.3 轻 agent 核心架构（移动端 Kotlin） | 六、6.1-6.4 |
| 13.4 工具桥接（移动端 Kotlin 接口） | 六、6.3 + 6.9 |
| 13.5 用户 API Key 存储（EncryptedSharedPreferences） | 六、6.6 |
| 13.6 思考等级映射 | 六、6.7 |
| 13.7 Agent 切换 UI | 六、6.11.1 |
| 13.8 离线降级 | 六、6.8（RuntimeModeManager） + 6.11.1（UI 离线提示） |
| 13.9 Skills 本地加载 | 六、6.5 |
| 13.10 与服务器 Pi Agent 的关系 | 一、1.1 + 表对比 |

---

## 三、当前代码现状（M0/M1/M2 已完成）

### 3.1 已有相关文件（M8 复用）

| 文件 | M8 复用点 |
|------|---------|
| `sync/WsClient.kt` | `state: StateFlow<WsState>` 判在线/离线；DISCONNECTED 持续触发降级 |
| `sync/WsMessage.kt` | 已有 `ToolCall`/`ToolResult`/`PiEvent` 协议（M8 不走 WS，但消息类型对齐） |
| `sync/DeviceAuth.kt` | deviceId（M8 的 Session 不依赖 deviceId，但 SkillLoader 用） |
| `browser/LivingWebView.kt` + `WebViewController` | browser_* 工具操作 WebView（currentUrl/loadUrl/evaluateJavascript） |
| `browser/CookieManagerWrapper.kt` | browser_get_cookie/set_cookie 工具 |
| `data/repository/CanvasRepository.kt` | list_widgets/create_html_widget/update/delete 工具 |
| `data/prefs/SettingsStore.kt` | storage_read/write 工具（DataStore 包装） |
| `ui/canvas/CanvasHomeViewModel.kt` | `aiInputText`/`aiExpanded`/`aiMessages` + `onAiSend()` 占位 |
| `ui/widget/AIAssistantWidget.kt` | M2 占位"AI 功能将在 M3 接入" → M8 接入本地 agent |
| `ui/settings/SettingsScreen.kt` + `SettingsViewModel.kt` | 已注入 WS 三件套，新增 AI 配置入口 |
| `.pi/skills/product-guide/SKILL.md` | SkillLoader 扫描目标（需复制到 `app/src/main/assets/pi/skills/product-guide/SKILL.md`） |

### 3.2 关键依赖就绪情况（build.gradle.kts 当前）

| 依赖 | 是否就绪 | M8 需补 |
|------|---------|--------|
| OkHttp 4.12.0 | ✅ | 用其 `RealWebSocket`/`RequestBody`/`Response`/`EventSource`（OkHttp 自带 SSE） |
| Coroutines 1.7.3 | ✅ | `Flow` + `suspend` |
| kotlinx.serialization 1.6.3 | ✅ | JSON 解析 + Tool 参数校验 |
| Hilt 2.48 | ✅ | @Singleton/@Inject |
| Room 2.6.1 | ✅ | （M8 不新增表，仅复用 CanvasRepository） |
| DataStore 1.1.1 | ✅ | SettingsStore 已用 |
| **EncryptedSharedPreferences** | ❌ | **新增 `androidx.security:security-crypto:1.1.0-alpha06`** |
| material-icons-extended | ✅ | 已开 R8 |

### 3.3 现有测试基础

仅 `WsMessageTest.kt`（4 个测试）。M8 需扩展：
- 引入 `com.squareup.okhttp3:mockwebserver:4.12.0`（模拟 SSE）
- 引入 `org.robolectric:robolectric:4.13`（Android 框架测试 EncryptedSharedPreferences；支持 SDK 35）
- 引入 `io.mockk:mockk:1.13.10`（mock 工具）

---

## 四、文件清单

### 4.1 新建文件（28 个）

#### `ai/` 目录（核心 12 个）

| 文件 | 行数估 | 职责 |
|------|--------|------|
| `ai/LlmClient.kt` | ~350 | OkHttp SSE 流式调 OpenAI 兼容 API，解析 tool_calls + reasoning_content |
| `ai/AgentLoop.kt` | ~200 | 核心循环：stream → 解析 tool_calls → execute → 回传 → 循环，返回 `Flow<AgentEvent>` |
| `ai/AgentEvent.kt` | ~50 | sealed class：TextDelta/ThinkingDelta/ToolCallStart/ToolCallEnd/ToolResult/TurnEnd/Error |
| `ai/Tool.kt` | ~80 | Tool 接口 + ToolResult + ToolCall + 参数 JSON Schema |
| `ai/ToolRegistry.kt` | ~100 | 工具注册表 + 按 name 查找 + execute 分发 |
| `ai/Session.kt` | ~120 | inMemory 消息历史 + systemPrompt + tools + addMessage/getMessages |
| `ai/SkillLoader.kt` | ~100 | 扫描 `assets/pi/skills/*/SKILL.md`，解析 YAML frontmatter，拼 systemPrompt |
| `ai/ApiKeyStore.kt` | ~120 | EncryptedSharedPreferences 封装：getApiKey/setApiKey/getConfig/testConnection |
| `ai/ThinkingLevel.kt` | ~150 | 4 档枚举 + 6 个 provider 映射函数 |
| `ai/RuntimeModeManager.kt` | ~150 | AgentMode 枚举（CLOUD/LOCAL/AUTO）+ 离线降级逻辑（订阅 WsClient.state） |
| `ai/LocalAgentService.kt` | ~150 | 整合 LlmClient + AgentLoop + ToolRegistry + Session + SkillLoader，对外暴露 `sendMessage(panelId, message, thinkingLevel): Flow<AgentEvent>` |
| `ai/KvStorage.kt` | ~30 行 | Key-Value 本地存储（包装 DataStore），供 StorageReadTool/StorageWriteTool 使用 |

#### `ai/tools/` 目录（10 个工具实现）

| 文件 | 行数估 | 工具名 |
|------|--------|------|
| `ai/tools/ListWidgetsTool.kt` | ~60 | list_widgets |
| `ai/tools/StorageReadTool.kt` | ~60 | storage_read |
| `ai/tools/StorageWriteTool.kt` | ~60 | storage_write |
| `ai/tools/CreateHtmlWidgetTool.kt` | ~100 | create_html_widget |
| `ai/tools/UpdateHtmlWidgetTool.kt` | ~80 | update_html_widget |
| `ai/tools/DeleteHtmlWidgetTool.kt` | ~60 | delete_html_widget |
| `ai/tools/AskUserTool.kt` | ~120 | ask_user（弹 Dialog 等用户选择，120s 超时） |
| `ai/tools/BrowserEvalTool.kt` | ~80 | browser_eval（操作当前活跃 WebView） |
| `ai/tools/BrowserNavigateTool.kt` | ~60 | browser_navigate |
| `ai/tools/BrowserGetUrlTool.kt` | ~50 | browser_get_url |

#### UI（5 个）+ 资源（1 个）

| 文件 | 行数估 | 职责 |
|------|--------|------|
| `ui/canvas/components/AgentModeSwitcher.kt` | ~150 | 云端/本地/AUTO 切换按钮 + 思考等级选择（1/2/3/4） |
| `ui/settings/AiConfigScreen.kt` | ~200 | AI 配置页：Provider 选择 + API Key + Endpoint + Model + 测试连接 |
| `ui/settings/AiConfigViewModel.kt` | ~120 行 | AI 配置页 ViewModel：state load/save/testConnection |
| `ui/settings/components/ProviderSelector.kt` | ~50 行 | Provider 下拉选择器（6 个 provider（含 gemini 可选）） |
| `ui/canvas/components/AskUserDialog.kt` | ~120 | AskUserTool 弹出的选项框 UI |
| `app/src/main/assets/pi/skills/product-guide/SKILL.md` | - | 从 `.pi/skills/product-guide/SKILL.md` 复制（Asset 打包用） |

### 4.2 修改文件（10 个）

| 文件 | 修改内容 |
|------|---------|
| `app/build.gradle.kts` | 新增依赖（security-crypto、mockwebserver、robolectric、mockk）；versionName → `0.1.0-m8` |
| `di/AppModule.kt` | 新增 `@Provides` for `ApiKeyStore`/`SkillLoader`/`ToolRegistry`/`LocalAgentService`/`RuntimeModeManager` |
| `ui/canvas/CanvasHomeScreen.kt` | AI 输入框旁加 AgentModeSwitcher + 思考等级；接入 LocalAgentService |
| `ui/canvas/CanvasHomeViewModel.kt` | `onAiSend()` 改为调 `LocalAgentService.sendMessage()`，流式收集 AgentEvent 更新 uiMessages |
| `ui/widget/AIAssistantWidget.kt` | 接入 LocalAgentService（面板内 AI 助手组件，每面板独立 Session） |
| `ui/settings/SettingsScreen.kt` | 新增"AI 配置"导航入口（→ AiConfigScreen） |
| `ui/nav/Routes.kt` + `AppNavGraph.kt` | 新增 `ai_config` 路由 |
| `LivingDashboardApp.kt` | onCreate 中初始化 SkillLoader（assets 扫描，预热） |
| `AndroidManifest.xml` | 无需新增权限（INTERNET + ACCESS_NETWORK_STATE 已有；LlmClient 走 HTTPS） |
| `data/repository/CanvasRepository.kt` | 新增 `createHtmlWidget(panelId, html, x, y, w, h, title)` 方法（内部调 createWidget + updatePosition），新增 1 个方法 |

---

## 五、依赖变更（build.gradle.kts）

```kotlin
dependencies {
    // 现有依赖保留...

    // M8 新增：API Key 加密存储
    implementation("androidx.security:security-crypto:1.1.0-alpha06")  // alpha 版本但支持 API 23+，minSdk=26 兼容；如不稳定可降级到 1.0.0

    // M8 测试依赖
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    testImplementation("org.robolectric:robolectric:4.13")  // Robolectric 4.13 支持 SDK 35；如使用 compileSdk=36，所有 Robolectric 测试类加 `@Config(sdk = [34])`
    testImplementation("io.mockk:mockk:1.13.10")
    testImplementation("com.google.truth:truth:1.1.5")
    testImplementation("com.google.dagger:hilt-android-testing:2.48")  // Hilt + Robolectric 集成
    kaptTest("com.google.dagger:hilt-compiler:2.48")  // Hilt 编译器（测试用）
    testImplementation("androidx.test:core:1.5.0")  // AndroidX Test
    testImplementation("androidx.test.ext:junit:1.1.5")  // AndroidX JUnit Extensions
}

android {
    defaultConfig {
        versionName = "0.1.0-m8"
        versionCode = 8  // M8
    }
    testOptions {
        unitTests {
            isIncludeAndroidResources = true  // Robolectric 需要
            isReturnDefaultValues = true  // 未 mock 的 Android API 返回默认值（避免 NPE）
        }
    }
}
```

### 5.1 Kover 覆盖率配置

```kotlin
plugins {
    id("org.jetbrains.kotlinx.kover") version "0.7.6"
}

kover {
    verify {
        rule {
            minBound(80, MetricType.LINE)
            minBound(70, MetricType.BRANCH)
        }
    }
}
```

执行 `gradle.bat testDebugUnitTest koverVerify` 校验覆盖率门槛：行 ≥ 80%，分支 ≥ 70%。

---

## 六、详细设计

### 6.1 LlmClient.kt（OkHttp SSE 流式）

**职责**：调 OpenAI 兼容 `POST /v1/chat/completions`（`stream: true`），解析 SSE 流，返回 `Flow<LlmStreamEvent>`。

**接口定义**：

```kotlin
package com.livingdashboard.ai

import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonObject

/** LLM 流式事件 */
sealed class LlmStreamEvent {
    /** 文本增量（assistant 消息内容） */
    data class TextDelta(val text: String) : LlmStreamEvent()
    /** 思考链增量（DeepSeek reasoning_content / Qwen thinking / OpenAI reasoning summary） */
    data class ThinkingDelta(val text: String) : LlmStreamEvent()
    /** 工具调用增量（tool_calls 累积） */
    data class ToolCallDelta(val index: Int, val id: String?, val name: String?, val argsDelta: String?) : LlmStreamEvent()
    /** 流结束（usage 信息） */
    data class Done(val finishReason: String?, val totalTokens: Int?) : LlmStreamEvent()
    /** 错误 */
    data class Error(val throwable: Throwable) : LlmStreamEvent()
}

/** LLM 消息（OpenAI 兼容格式） */
@kotlinx.serialization.Serializable
data class LlmMessage(
    val role: String,  // "system" | "user" | "assistant" | "tool"
    val content: String? = null,
    val tool_calls: List<ToolCall>? = null,
    val tool_call_id: String? = null,  // role=tool 时必填
)

@kotlinx.serialization.Serializable
data class ToolCall(
    val id: String,
    val type: String = "function",
    val function: ToolCallFunction,
)

@kotlinx.serialization.Serializable
data class ToolCallFunction(
    val name: String,
    val arguments: String,  // JSON 字符串（流式累积）
)

/** LLM 调用请求 */
data class LlmRequest(
    val provider: String,                // "stepfun" | "openai" | "deepseek" | "anthropic" | "qwen" | "gemini"
    val model: String,                    // "step-3.7-flash"（不带 provider 前缀）
    val messages: List<LlmMessage>,
    val tools: List<ToolDefinition>? = null,
    val thinkingLevel: ThinkingLevel = ThinkingLevel.STANDARD,
    val temperature: Double = 0.3,
    val maxTokens: Int? = null,
)

/** LLM 客户端配置 */
data class LlmClientConfig(
    val endpoint: String,    // "https://api.stepfun.com/v1"（不含 /chat/completions）
    val apiKey: String,
    val provider: String,    // 与 LlmRequest.provider 同步，用于分派协议路径（OpenAI 兼容 / Anthropic）
)

class LlmClient(
    private val httpClient: OkHttpClient,  // Hilt @Singleton 注入
) {
    /**
     * 流式调用 LLM。
     * - 构建 OpenAI 兼容请求体（含 tools/thinkingLevel 映射）
     * - 用 OkHttp 发 POST，读 SSE 流
     * - 解析 data: 行，[DONE] 终止
     * - 解析 choices[0].delta.content / reasoning_content / thinking / tool_calls
     * - 返回 Flow<LlmStreamEvent>
     */
    fun stream(request: LlmRequest, config: LlmClientConfig): Flow<LlmStreamEvent>
}
```

**关键实现要点**：

1. **URL 构建**（参考 `server/src/utils/llmCaller.ts` buildApiUrl）：
   - `endpoint` 以 `/chat/completions` 结尾 → 直接用
   - `endpoint` 以 `/v1` 或 `/v\d+` 结尾 → 追加 `/chat/completions`
   - 否则 → 追加 `/v1/chat/completions`

2. **请求体构建**（kotlinx.serialization）：
   ```kotlin
   val body = buildJsonObject {
       put("model", request.model)
       putJsonArray("messages") { request.messages.forEach { add(it.toJson()) } }
       put("stream", true)
       put("temperature", request.temperature)
       request.maxTokens?.let { put("max_tokens", it) }
       request.tools?.let { tools ->
           putJsonArray("tools") {
               tools.forEach { t -> addJsonObject {
                   put("type", "function")
                   putJsonObject("function") {
                       put("name", t.name)
                       put("description", t.description)
                       put("parameters", t.parametersJson)  // JSON Schema
                   }
               }}
           }
       }
       // 注入思考等级参数（见 6.7）
        ThinkingLevelMapper.applyToRequest(this, request.provider, request.thinkingLevel)
   }
   ```

3. **SSE 解析**（OkHttp `ResponseBody.source().buffer`按行读）：
   ```
   while ((line = source.readUtf8Line()) != null) {
       when {
           line.startsWith("data: [DONE]") -> emit(Done(...))
           line.startsWith("data: ") -> parseJson(line.removePrefix("data: "))
           line.isEmpty() || line.startsWith(":") -> continue  // keep-alive
       }
   }
   ```

4. **解析 SSE chunk**（OpenAI 兼容）：
   ```kotlin
   val chunk = Json.decodeFromString<StreamChunk>(data)
   val delta = chunk.choices.firstOrNull()?.delta ?: return
   delta.content?.let { emit(TextDelta(it)) }
   delta.reasoning_content?.let { emit(ThinkingDelta(it)) }  // DeepSeek
   delta.thinking?.let { emit(ThinkingDelta(it)) }  // Qwen
   delta.tool_calls?.forEach { tc ->
       emit(ToolCallDelta(tc.index, tc.id, tc.function?.name, tc.function?.arguments))
   }
   ```

5. **错误处理**：
   - HTTP 4xx/5xx：读 error body，emit Error
   - 网络异常：emit Error
   - SSE 协议错误（JSON 解析失败）：log + skip（不中断流）

6. **取消支持**：
   `LlmClient.stream()` 内部使用 `flow { ... }.cancellable()`；
   OkHttp Call 通过 `suspendCancellableCoroutine` 包裹后用 `cont.invokeOnCancellation { call.cancel() }` 注册取消回调；
   Flow 内部用 `currentCoroutineContext().ensureActive()` 检查取消点。
   LlmRequest 不暴露 signal 字段。

7. **OpenAI 兼容路径忽略 role 字段**：
   OpenAI 兼容 SSE 流首个 chunk 可能含 `delta.role="assistant"`，忽略此字段（仅 content/tool_calls/reasoning_* 有效）。

8. **SSE multi-line data 累积**：
   严格 SSE 规范允许多行 `data:`，累积到空行再 JSON 解析：
   ```kotlin
   val dataBuilder = StringBuilder()
   while ((line = source.readUtf8Line()) != null) {
       when {
           line.startsWith("data: [DONE]") -> { emit(Done(...)) }
           line.startsWith("data: ") -> dataBuilder.append(line.removePrefix("data: "))
           line.isEmpty() -> {
               if (dataBuilder.isNotEmpty()) {
                   parseAndEmit(dataBuilder.toString()); dataBuilder.clear()
               }
           }
           line.startsWith(":") -> continue  // keep-alive
       }
   }
   ```

9. **OkHttpClient 超时配置**：
   `connectTimeout=30s`，`readTimeout=0`（流式不超时），`writeTimeout=30s`。

10. **API key 错误（401/403）**：emit Error("API Key 无效或权限不足")。

11. **retry-after header**：429 时解析 retry-after，emit Error("限流，请在 X 秒后重试")。

12. **flowOn(Dispatchers.IO)**：LlmClient.stream 内部 `flowOn(Dispatchers.IO)`，UI collect 在 Main。

13. **finish_reason 检查**：检查 length（截断）/ content_filter（被过滤），分别 emit 警告。

---

#### 6.1.1 Provider 协议差异表

LlmClient 根据 `LlmClientConfig.provider` 分派到两条实现路径：

| Provider | URL 路径 | Header | Body 差异 | SSE 差异 |
|----------|---------|--------|----------|---------|
| stepfun/openai/deepseek/qwen | `/v1/chat/completions` | `Authorization: Bearer <key>` | messages 数组含 role=system；max_tokens 可选 | `data: {choices:[{delta:{...}}]}` + `data: [DONE]` |
| anthropic | `/v1/messages` | `x-api-key: <key>` + `anthropic-version: 2023-06-01` | system 提取为顶级字段；max_tokens 必填；tools 用 `input_schema` 而非 `parameters` | `event: content_block_delta\ndata: {...}` + `event: message_stop` |

**实现要点**：
- LlmClient 内部根据 `request.provider` 判断走哪条路径
- URL 构建保留三分支逻辑（`/chat/completions` 结尾、`/v1` 或 `/v\d+` 结尾、其他结尾），但 anthropic 走 `/messages` 结尾
- Anthropic body 序列化时把 messages 中 role=system 的内容移到顶级 `system` 字段
- Anthropic `max_tokens` 必填，缺省给 4096
- Anthropic tools 的 `parameters` 改为 `input_schema`
- SSE 解析：OpenAI 兼容路径只认 `data:` 行；Anthropic 路径认 `event:` + `data:` 双行，根据 event 类型分发到 content_block_start/content_block_delta/content_block_stop/message_stop

---

### 6.2 AgentLoop.kt（Coroutines Flow 核心循环）

**职责**：核心 agent 循环。stream → 解析 tool_calls → execute → 回传 → 循环。

**接口定义**：

```kotlin
package com.livingdashboard.ai

import kotlinx.coroutines.flow.Flow

/** Agent 事件（推送到 UI） */
sealed class AgentEvent {
    /** 每轮 LLM 请求开始时 emit，UI 重置 isComplete */
    object TurnStart : AgentEvent()
    /** AI 文本增量 */
    data class TextDelta(val text: String) : AgentEvent()
    /** AI 思考链增量（UI 折叠显示） */
    data class ThinkingDelta(val text: String) : AgentEvent()
    /** 工具调用开始 */
    data class ToolCallStart(val callId: String, val toolName: String, val args: JsonObject) : AgentEvent()
    /** 工具调用结束 */
    data class ToolCallEnd(val callId: String, val success: Boolean, val result: String) : AgentEvent()
    /** 一轮对话结束（无 tool_calls 或达到最大轮次） */
    data class TurnEnd(val finishReason: String) : AgentEvent()
    /** 错误 */
    data class Error(val message: String, val recoverable: Boolean) : AgentEvent()
}

class AgentLoop(
    private val llmClient: LlmClient,
    private val toolRegistry: ToolRegistry,
) {
    /**
     * Agent 主循环（返回 Flow，UI 收集）。
     *
     * @param session 当前面板 Session（含 messages + systemPrompt + tools）
     * @param userMessage 用户消息文本
     * @param thinkingLevel 思考等级
     * @param llmConfig LLM 客户端配置（endpoint + apiKey）
     * @return Flow<AgentEvent>，UI 流式收集
     *
     * 循环逻辑（架构 13.3）：
     * 1. session.addMessage(UserMessage(userMessage))
     * 2. while (true):
     *    a. llmClient.stream(...) 收集流，累积 assistantMsg + toolCalls
     *    b. 流结束后 session.addMessage(AssistantMessage(assistantMsg, toolCalls))
     *    c. if (toolCalls.isEmpty()) { emit(TurnEnd); break }
     *    d. for (call in toolCalls):
     *       - emit(ToolCallStart)
     *       - result = toolRegistry.execute(call.name, call.args)
     *       - session.addMessage(ToolResultMessage(call.id, result))
     *       - emit(ToolCallEnd)
     *    e. continue（下一轮 LLM 调用）
     *
     * 安全阀：最多 10 轮工具调用（防死循环），超过 emit Error
     */
    fun run(
        session: Session,
        userMessage: String,
        thinkingLevel: ThinkingLevel,
        llmConfig: LlmClientConfig,
    ): Flow<AgentEvent>
}
```

**关键实现要点**：

1. **tool_calls 累积**：流式响应中 tool_calls 是分片返回的（同一 index 的 id/name 在第一个 chunk，arguments 跨多个 chunk），需按 index 累积：
   ```kotlin
   val toolCallBuilders = mutableMapOf<Int, ToolCallBuilder>()
   flow.collect { ev ->
       when (ev) {
           is LlmStreamEvent.TextDelta -> { assistantText.append(ev.text); emit(AgentEvent.TextDelta(ev.text)) }
           is LlmStreamEvent.ThinkingDelta -> { thinkingText.append(ev.text); emit(AgentEvent.ThinkingDelta(ev.text)) }
           is LlmStreamEvent.ToolCallDelta -> {
               val builder = toolCallBuilders.getOrPut(ev.index) { ToolCallBuilder() }
               ev.id?.let { builder.id = it }
               ev.name?.let { builder.name = it }
               ev.argsDelta?.let { builder.args.append(it) }
           }
           is LlmStreamEvent.Done -> { /* 流结束 */ }
           is LlmStreamEvent.Error -> {
               emit(AgentEvent.Error(ev.throwable.message ?: "unknown", false))
               return@flow  // 中断整个 AgentLoop.run，避免 return@collect 导致死循环
           }
       }
   }
   ```

2. **Session.addMessage**：流结束后，把累积的 assistantText + toolCalls 写入 session.messages。

3. **工具执行**：
   ```kotlin
   for (call in toolCalls) {
       emit(AgentEvent.ToolCallStart(call.id, call.function.name, call.function.arguments.parseJson()))
       val result = try {
           toolRegistry.execute(call.function.name, Json.decodeFromString(call.function.arguments))
       } catch (e: Exception) {
           ToolResult.error(e.message ?: "tool execution failed")
       }
       session.addMessage(LlmMessage(role = "tool", content = result.toJsonString(), tool_call_id = call.id))
       emit(AgentEvent.ToolCallEnd(call.id, result.success, result.data?.toString() ?: result.error ?: ""))
   }
   ```

4. **最大轮次限制**：`var iterations = 0; while (iterations++ < 10) { ... }`，超过 emit Error("max iterations exceeded")。

5. **TurnStart 事件**：在 while 循环开头 `emit(AgentEvent.TurnStart)`，UI 收到后重置上一条 assistant 消息的 `isComplete=false`。

---

### 6.3 Tool.kt + ToolRegistry.kt

**接口定义**：

```kotlin
package com.livingdashboard.ai

import kotlinx.serialization.json.JsonObject

/** 工具执行结果 */
data class ToolResult(
    val success: Boolean,
    val data: JsonObject? = null,
    val error: String? = null,
) {
    companion object {
        fun success(data: JsonObject) = ToolResult(true, data)
        fun error(message: String) = ToolResult(false, error = message)
    }
}

/** 工具定义（OpenAI function schema） */
data class ToolDefinition(
    val name: String,
    val description: String,
    val parameters: JsonObject,  // JSON Schema
)

/** 工具接口（所有工具实现此接口） */
interface Tool {
    val definition: ToolDefinition
    suspend fun execute(args: JsonObject): ToolResult
}

/** 工具注册表 */
class ToolRegistry {
    private val tools = ConcurrentHashMap<String, Tool>()

    fun register(tool: Tool) { tools[tool.definition.name] = tool }
    fun unregister(name: String) { tools.remove(name) }
    fun get(name: String): Tool? = tools[name]
    fun listDefinitions(): List<ToolDefinition> = tools.values.map { it.definition }

    suspend fun execute(name: String, args: JsonObject): ToolResult {
        val tool = tools[name] ?: return ToolResult.error("unknown tool: $name")
        return try { tool.execute(args) }
        catch (e: Exception) { ToolResult.error(e.message ?: "tool execution failed") }
    }
}
```

**参数校验**（轻量级，不引 JSON Schema 库）：
- Tool 实现内部用 `args["key"]?.jsonPrimitive?.content` 取值
- 必填字段缺失 → `ToolResult.error("missing required arg: key")`
- 不做完整 JSON Schema 校验（避免依赖）

**JSON Schema 包装辅助函数**：

```kotlin
fun toolObjectSchema(block: JsonObjectBuilder.() -> Unit): JsonObject = buildJsonObject {
    put("type", "object")
    putJsonObject("properties") { block() }
    putJsonArray("required") {
        // 由 block 写入的 required 字段会被 ToolDefinition 自动收集
    }
}
```

所有工具的 parameters 必须用 `toolObjectSchema { ... }` 包装，示例：
```kotlin
parameters = toolObjectSchema {
    putJsonObject("key") {
        put("type", "string")
        put("description", "Storage key")
    }
    putJsonArray("required") { add("key") }
}
```

---

### 6.4 Session.kt（inMemory 上下文）

```kotlin
package com.livingdashboard.ai

class Session(
    val panelId: String,                  // 面板 ID（每面板独立 Session）
    val model: String,                    // "step-3.7-flash"
    val systemPrompt: String,             // 含 skills + canvas/browser prompt
    val tools: List<ToolDefinition>,      // 可用工具列表
) {
    private val _messages = mutableListOf<LlmMessage>()
    val messages: List<LlmMessage> get() = _messages.toList()

    init {
        // 初始 system prompt
        _messages.add(LlmMessage(role = "system", content = systemPrompt))
    }

    fun addUserMessage(content: String) {
        _messages.add(LlmMessage(role = "user", content = content))
    }

    fun addAssistantMessage(content: String, toolCalls: List<ToolCall>?) {
        _messages.add(LlmMessage(role = "assistant", content = content, tool_calls = toolCalls))
    }

    fun addToolResultMessage(toolCallId: String, content: String) {
        _messages.add(LlmMessage(role = "tool", content = content, tool_call_id = toolCallId))
    }

    /** 超过 N 条消息时清理旧消息（防 token 超限，N=20） */
    fun trim(keepRecent: Int = 20) {
        if (_messages.size <= keepRecent + 1) return
        val system = _messages.first()
        val tail = _messages.takeLast(keepRecent).toMutableList()
        // 跳过开头的 tool 消息（其对应 assistant tool_calls 已被裁掉，避免破坏配对）
        while (tail.isNotEmpty() && tail.first().role == "tool") tail.removeAt(0)
        _messages.clear()
        _messages.add(system)
        _messages.addAll(tail)
        // 注：不能简单 subList.clear + add(0, system)：
        // 1. 会导致重复 system（原 system 还在）
        // 2. 会破坏 tool_call/tool_result 配对（裁掉 assistant.tool_calls 但保留对应 tool result，
        //    导致下一轮 LLM 报错 "tool message without matching tool_call"）
    }

    fun clear() { _messages.clear(); _messages.add(LlmMessage(role = "system", content = systemPrompt)) }
}
```

**不持久化**：M8 是单机轻 agent，Session 仅 inMemory（roadmap 13.3 明确说 "inMemory"）。App 重启后 Session 丢失（用户需重新开始对话）。M5（数据同步）才考虑持久化到 Room。

---

### 6.5 SkillLoader.kt（扫描 assets SKILL.md）

```kotlin
package com.livingdashboard.ai

import android.content.Context
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive

data class Skill(
    val name: String,
    val description: String,
    val version: String,
    val content: String,  // Markdown 正文
)

class SkillLoader(private val context: Context) {
    /** 扫描 assets/pi/skills/*/SKILL.md，解析 YAML frontmatter + Markdown 正文 */
    fun loadAll(): List<Skill> {
        val skills = mutableListOf<Skill>()
        val dirs = context.assets.list("pi/skills") ?: return emptyList()
        for (dir in dirs) {
            val files = context.assets.list("pi/skills/$dir") ?: continue
            if ("SKILL.md" !in files) continue
            val content = context.assets.open("pi/skills/$dir/SKILL.md").bufferedReader().use { it.readText() }
            skills.add(parseSkill(dir, content))
        }
        return skills
    }

    /** 解析 YAML frontmatter（--- 之间的内容） + Markdown 正文 */
    private fun parseSkill(dirName: String, raw: String): Skill {
        // 简单 YAML 解析（不引 snakeyaml，避免增加依赖）
        val frontmatterRegex = Regex("""^---\s*\n(.*?)\n---\s*\n(.*)""", RegexOption.DOT_MATCHES_ALL)
        val match = frontmatterRegex.find(raw) ?: return Skill(dirName, "", "1.0", raw)
        val yaml = match.groupValues[1]
        val content = match.groupValues[2]
        val yamlMap = parseSimpleYaml(yaml)
        return Skill(
            name = yamlMap["name"] ?: dirName,
            description = yamlMap["description"] ?: "",
            version = yamlMap["version"] ?: "1.0",
            content = content,
        )
    }

    private fun parseSimpleYaml(yaml: String): Map<String, String> {
        // 简单 key: value 解析（不支持嵌套/数组）
        return yaml.lines().mapNotNull { line ->
            val idx = line.indexOf(':')
            if (idx < 0) null
            else line.substring(0, idx).trim() to line.substring(idx + 1).trim().trim('"')
        }.toMap()
    }

    /** 把所有 skills 拼成 system prompt 片段 */
    fun buildSystemPromptAppendix(skills: List<Skill>): String {
        if (skills.isEmpty()) return ""
        return buildString {
            append("\n\n## Available Skills\n")
            for (skill in skills) {
                append("### ${skill.name} (v${skill.version})\n")
                append(skill.description).append("\n\n")
                append(skill.content).append("\n\n---\n\n")
            }
        }
    }
}
```

**资源准备**：把 `.pi/skills/product-guide/SKILL.md` 复制到 `app/src/main/assets/pi/skills/product-guide/SKILL.md`。

---

### 6.6 ApiKeyStore.kt（EncryptedSharedPreferences）

```kotlin
package com.livingdashboard.ai

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/** LLM Provider 配置 */
data class LlmProviderConfig(
    val provider: String,    // "stepfun" | "openai" | "deepseek" | "anthropic" | "qwen" | "gemini"
    val apiKey: String,
    val endpoint: String,
    val model: String,
)

class ApiKeyStore(context: Context) {
    private val prefs: SharedPreferences = EncryptedSharedPreferences.create(
        context, "ai_keys",
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )

    fun saveConfig(provider: String, config: LlmProviderConfig) {
        prefs.edit()
            .putString("provider_${provider}_api_key", config.apiKey)
            .putString("provider_${provider}_endpoint", config.endpoint)
            .putString("provider_${provider}_model", config.model)
            .apply()
    }

    fun getConfig(provider: String): LlmProviderConfig? {
        val key = prefs.getString("provider_${provider}_api_key", null) ?: return null
        val endpoint = prefs.getString("provider_${provider}_endpoint", "") ?: ""
        val model = prefs.getString("provider_${provider}_model", "") ?: ""
        return LlmProviderConfig(provider, key, endpoint, model)
    }

    fun getActiveProvider(): String? = prefs.getString("active_provider", null)
    fun setActiveProvider(provider: String) { prefs.edit().putString("active_provider", provider).apply() }
    fun listConfiguredProviders(): List<String> = listOf("stepfun","openai","deepseek","anthropic","qwen","gemini")
        .filter { getConfig(it) != null }
    fun clearProvider(provider: String) {
        prefs.edit()
            .remove("provider_${provider}_api_key")
            .remove("provider_${provider}_endpoint")
            .remove("provider_${provider}_model")
            .apply()
    }
    fun hasConfig(provider: String): Boolean = getConfig(provider) != null
    fun clear() { prefs.edit().clear().apply() }
}
```

**注**：6 provider（含 gemini 可选）各自独立存储，互不覆盖；用户可同时配置多个 provider，通过 `setActiveProvider` 切换当前使用的 provider。

**测试连接**：单独方法在 `LocalAgentService` 里（用 LlmClient 发一个 ping，max_tokens=16）。

---

### 6.7 ThinkingLevel.kt（思考等级 4 档映射）

```kotlin
package com.livingdashboard.ai

import kotlinx.serialization.json.JsonObjectBuilder
import kotlinx.serialization.json.add
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject

enum class ThinkingLevel(val value: Int, val label: String) {
    AUTO(1, "自动"),
    STANDARD(2, "标准"),
    DEEP(3, "深度"),
    MAX(4, "最深");

    companion object { fun fromValue(v: Int) = entries.firstOrNull { it.value == v } ?: STANDARD }
}

/**
 * 4 档思考等级映射到 provider 参数（架构 13.6）。
 * 在构建 LLM 请求体时调用 applyToRequest(builder, provider, level)。
 */
object ThinkingLevelMapper {
    fun applyToRequest(builder: JsonObjectBuilder, provider: String, level: ThinkingLevel) {
        when (provider) {
            "deepseek" -> {
                // reasoning_effort: low | medium | high（DeepSeek 实际取值；注：原 Spec 误写 auto/high/high/max，修正为 low/medium/high/high）
                val effort = when (level) {
                    ThinkingLevel.AUTO -> "low"      // 不调思考
                    ThinkingLevel.STANDARD -> "medium"
                    ThinkingLevel.DEEP -> "high"
                    ThinkingLevel.MAX -> "high"      // DeepSeek 最高就是 high
                }
                builder.put("reasoning_effort", effort)
            }
            "qwen" -> {
                // thinking_budget: null | 4096 | 8192 | 16384
                val budget = when (level) {
                    ThinkingLevel.AUTO -> null
                    ThinkingLevel.STANDARD -> 4096
                    ThinkingLevel.DEEP -> 8192
                    ThinkingLevel.MAX -> 16384
                }
                budget?.let { builder.put("thinking_budget", it) }
            }
            "openai" -> {
                // reasoning.effort: low | medium | high（仅 reasoning 模型生效，如 o1/o3 系列；OpenAI 最高就是 high）
                val effort = when (level) {
                    ThinkingLevel.AUTO -> "low"
                    ThinkingLevel.STANDARD -> "medium"
                    ThinkingLevel.DEEP -> "high"
                    ThinkingLevel.MAX -> "high"
                }
                builder.putJsonObject("reasoning") { put("effort", effort) }
            }
            "anthropic" -> {
                // AUTO/STANDARD 不注入 thinking 参数（Claude 默认 adaptive）
                when (level) {
                    ThinkingLevel.AUTO, ThinkingLevel.STANDARD -> {
                        // 不注入 thinking 参数
                    }
                    ThinkingLevel.DEEP -> {
                        builder.putJsonObject("thinking") {
                            put("type", "enabled")
                            put("budget_tokens", 8000)
                        }
                    }
                    ThinkingLevel.MAX -> {
                        builder.putJsonObject("thinking") {
                            put("type", "enabled")
                            put("budget_tokens", 16000)
                        }
                    }
                }
            }
            "stepfun" -> {
                // StepFun 暂无思考等级参数（标准 OpenAI 兼容）
                // 等级 1-4 通过 temperature 微调（注：buildJsonObject 的 put 是覆盖语义，会覆盖 request 中的 temperature）
                val temp = when (level) {
                    ThinkingLevel.AUTO -> 0.5
                    ThinkingLevel.STANDARD -> 0.3
                    ThinkingLevel.DEEP -> 0.2
                    ThinkingLevel.MAX -> 0.1
                }
                builder.put("temperature", temp)
            }
            "gemini" -> {
                // Gemini: 等级 1/2 不注入，等级 3/4 注入 thinkingConfig.includeThoughts
                when (level) {
                    ThinkingLevel.AUTO, ThinkingLevel.STANDARD -> { /* 不注入 */ }
                    ThinkingLevel.DEEP, ThinkingLevel.MAX -> {
                        builder.putJsonObject("thinkingConfig") { put("includeThoughts", true) }
                    }
                }
            }
        }
    }

    /** 仅供内部 fallback，不应作为路由依据（路由依据应为 LlmRequest.provider 字段） */
    private fun parseProvider(fullModel: String): String {
        // fullModel 可能是 "stepfun/step-3.7-flash" 或 "step-3.7-flash"
        return if (fullModel.contains('/')) fullModel.substringBefore('/')
        else "stepfun"  // 默认 provider
    }
}
```

---

### 6.8 RuntimeModeManager.kt（Agent 模式 + 离线降级）

**依赖注入**：RuntimeModeManager 接收 `coroutineScope: CoroutineScope`，由 AppModule 提供：
```kotlin
@Singleton @Provides fun provideApplicationScope(): CoroutineScope =
    CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
```

```kotlin
package com.livingdashboard.ai

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.stateIn

enum class AgentMode(val label: String) {
    CLOUD("云端"),    // 服务器 Pi Agent（M3 未实现，占位）
    LOCAL("本地"),    // 单机轻 Agent（M8）
    AUTO("自动"),     // 在线用云端，离线降级到本地
}

data class RuntimeModeState(
    val mode: AgentMode,
    val isServerOnline: Boolean,    // WsClient.state == CONNECTED
    val effectiveMode: AgentMode,   // 实际生效的模式（AUTO 时根据在线状态计算）
    val isOfflineDowngraded: Boolean,  // 是否触发了离线降级
)

class RuntimeModeManager(
    private val wsClient: WsClient,  // 已有，提供 state: StateFlow<WsState>
    private val coroutineScope: CoroutineScope,  // 由 Application 注入 @Singleton CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
) {
    private val _selectedMode = MutableStateFlow(AgentMode.AUTO)
    val selectedMode: StateFlow<AgentMode> = _selectedMode.asStateFlow()

    /** 实际运行时状态（AUTO 模式自动降级） */
    val state: StateFlow<RuntimeModeState> = combine(
        _selectedMode,
        // 防 WS 状态抖动：WS 弱网时频繁在线/离线切换会导致 UI 抖动，加 2 秒 debounce 确保稳定后再切换 effectiveMode
        wsClient.state.debounce(2000),
    ) { mode, wsState ->
        val isOnline = wsState == WsState.CONNECTED
        val effective = when (mode) {
            AgentMode.CLOUD -> if (isOnline) AgentMode.CLOUD else AgentMode.LOCAL  // 云端不可用降级
            AgentMode.LOCAL -> AgentMode.LOCAL
            AgentMode.AUTO -> if (isOnline) AgentMode.CLOUD else AgentMode.LOCAL
        }
        RuntimeModeState(
            mode = mode,
            isServerOnline = isOnline,
            effectiveMode = effective,
            isOfflineDowngraded = (mode == AgentMode.CLOUD || mode == AgentMode.AUTO) && !isOnline,
        )
    }.stateIn(coroutineScope, SharingStarted.Eagerly, RuntimeModeState(AgentMode.AUTO, false, AgentMode.LOCAL, true))

    fun setMode(mode: AgentMode) { _selectedMode.value = mode }
}
```

**降级规则**：
- `CLOUD` 模式 + 离线 → 降级到 LOCAL + UI Toast"服务器不可用，已切换到本地 agent"
- `AUTO` 模式 + 离线 → 自动用 LOCAL + UI 提示"离线模式"
- `LOCAL` 模式 → 永远用 LOCAL（不依赖服务器）

---

### 6.9 本地工具实现（10 个）

所有工具实现 `Tool` 接口，注册到 `ToolRegistry`。

#### 6.9.1 ListWidgetsTool

```kotlin
class ListWidgetsTool(
    private val canvasRepository: CanvasRepository,
    private val panelIdProvider: () -> String?,  // 当前活跃面板 ID
) : Tool {
    override val definition = ToolDefinition(
        name = "list_widgets",
        description = "List all widgets on the current canvas panel. Returns id/type/title/position for each.",
        parameters = toolObjectSchema { /* 无参，type=object */ },
    )

    override suspend fun execute(args: JsonObject): ToolResult {
        val panelId = panelIdProvider() ?: return ToolResult.error("no active panel")
        val widgets = canvasRepository.observeWidgets(panelId).first()  // 取当前快照
        return ToolResult.success(buildJsonObject {
            putJsonArray("widgets") {
                widgets.forEach { w -> addJsonObject {
                    put("id", w.widgetId)
                    put("type", w.widgetType.name)
                    put("title", w.title ?: "")
                }}
            }
        })
    }
}
```

#### 6.9.2 StorageReadTool / StorageWriteTool

```kotlin
class StorageReadTool(private val kvStorage: KvStorage) : Tool {
    override val definition = ToolDefinition(
        name = "storage_read",
        description = "Read a value from local key-value storage (DataStore Preferences).",
        parameters = toolObjectSchema {
            putJsonObject("key") {
                put("type", "string")
                put("description", "Storage key")
            }
            putJsonArray("required") { add("key") }
        },
    )
    override suspend fun execute(args: JsonObject): ToolResult {
        val key = args["key"]?.jsonPrimitive?.contentOrNull() ?: return ToolResult.error("missing key")
        val value = kvStorage.read(key)  // KvStorage 类在 6.9.2 节末尾定义
        return ToolResult.success(buildJsonObject { put("key", key); put("value", value?.toString() ?: "") })
    }
}

class StorageWriteTool(private val kvStorage: KvStorage) : Tool {
    override val definition = ToolDefinition(
        name = "storage_write",
        description = "Write a value to local key-value storage.",
        parameters = toolObjectSchema {
            putJsonObject("key") {
                put("type", "string")
                put("description", "Storage key")
            }
            putJsonObject("value") {
                put("type", "string")
                put("description", "Storage value")
            }
            putJsonArray("required") { add("key"); add("value") }
        },
    )
    override suspend fun execute(args: JsonObject): ToolResult {
        val key = args["key"]?.jsonPrimitive?.contentOrNull() ?: return ToolResult.error("missing key")
        val value = args["value"]?.jsonPrimitive?.contentOrNull() ?: return ToolResult.error("missing value")
        kvStorage.write(key, value)
        return ToolResult.success(buildJsonObject { put("key", key); put("success", true) })
    }
}
```

> **注**：SettingsStore 需新增 `getRawValue(key: String): Any?` 和 `setRawValue(key: String, value: Any)` 方法（用 DataStore 的 `preferencesOf` dynamic key）。或者新建独立 `KvStorage` 类（更干净）。本 Spec 选择独立 `KvStorage` 类（避免污染 SettingsStore）：

```kotlin
class KvStorage(private val dataStore: DataStore<Preferences>) {
    suspend fun read(key: String): String? = dataStore.data.map { it[stringPreferencesKey(key)] }.first()
    suspend fun write(key: String, value: String) { dataStore.edit { it[stringPreferencesKey(key)] = value } }
    suspend fun listKeys(): List<String> = dataStore.data.map { it.asMap().keys.map { k -> k.name } }.first()
}
```

#### 6.9.3 CreateHtmlWidgetTool

```kotlin
class CreateHtmlWidgetTool(
    private val canvasRepository: CanvasRepository,
    private val panelIdProvider: () -> String?,
) : Tool {
    override val definition = ToolDefinition(
        name = "create_html_widget",
        description = "Create a new HTML widget on the current canvas panel.",
        parameters = toolObjectSchema {
            putJsonObject("html") {
                put("type", "string"); put("description", "HTML content")
            }
            putJsonObject("x") {
                put("type", "number"); put("description", "Canvas X position (default 100)")
            }
            putJsonObject("y") {
                put("type", "number"); put("description", "Canvas Y position (default 100)")
            }
            putJsonObject("width") {
                put("type", "number"); put("description", "Widget width px (default 400)")
            }
            putJsonObject("height") {
                put("type", "number"); put("description", "Widget height px (default 300)")
            }
            putJsonObject("title") {
                put("type", "string"); put("description", "Widget title")
            }
            putJsonArray("required") { add("html") }
        },
    )

    override suspend fun execute(args: JsonObject): ToolResult {
        val panelId = panelIdProvider() ?: return ToolResult.error("no active panel")
        val html = args["html"]?.jsonPrimitive?.contentOrNull() ?: return ToolResult.error("missing html")
        val x = args["x"]?.jsonPrimitive?.doubleOrNull() ?: 100.0
        val y = args["y"]?.jsonPrimitive?.doubleOrNull() ?: 100.0
        val width = args["width"]?.jsonPrimitive?.doubleOrNull() ?: 400.0
        val height = args["height"]?.jsonPrimitive?.doubleOrNull() ?: 300.0
        val title = args["title"]?.jsonPrimitive?.contentOrNull() ?: "HTML Widget"

        val widgetId = canvasRepository.createHtmlWidget(
            panelId = panelId,
            html = html, x = x, y = y, w = width, h = height, title = title,
        )
        return ToolResult.success(buildJsonObject {
            put("id", widgetId)
            put("width", width); put("height", height)
        })
    }
}
```

> **注**：`CanvasRepository` 需新增 `createHtmlWidget(...)` 方法（创建 WidgetEntity + WidgetPositionEntity + 写入 state["html"]）。

**CanvasRepository 新增 createHtmlWidget 方法**：

```kotlin
suspend fun createHtmlWidget(
    panelId: String, html: String, x: Float, y: Float,
    w: Float, h: Float, title: String
): String {
    val widget = createWidget(panelId, WidgetType.HTML_CANVAS,
        mapOf("html" to html, "title" to title,
              "agentWidth" to w, "agentHeight" to h,
              "createdAt" to System.currentTimeMillis(),
              "updatedAt" to System.currentTimeMillis()),
        w, h, title)
    updatePosition(panelId, widget.id, x, y)  // 必须写入位置（参考 wsToolHandlers.ts:170-182）
    return widget.id
}
```

参考桌面端 `client/desktop/src/utils/wsToolHandlers.ts:170-182` `addWidgetAndCaptureId`，Android 端必须分两步（createWidget + updatePosition）才能在画布上正确显示位置。

#### 6.9.4 UpdateHtmlWidgetTool / DeleteHtmlWidgetTool

```kotlin
class UpdateHtmlWidgetTool(
    private val canvasRepository: CanvasRepository,
) : Tool {
    override val definition = ToolDefinition(
        name = "update_html_widget",
        description = "Update an existing HTML widget's content or title.",
        parameters = toolObjectSchema {
            putJsonObject("widget_id") {
                put("type", "string"); put("description", "Widget ID to update")
            }
            putJsonObject("html") {
                put("type", "string"); put("description", "New HTML content (optional)")
            }
            putJsonObject("title") {
                put("type", "string"); put("description", "New widget title (optional)")
            }
            putJsonArray("required") { add("widget_id") }
        },
    )
    override suspend fun execute(args: JsonObject): ToolResult {
        val widgetId = args["widget_id"]?.jsonPrimitive?.contentOrNull()
            ?: return ToolResult.error("missing widget_id")
        val html = args["html"]?.jsonPrimitive?.contentOrNull()
        val title = args["title"]?.jsonPrimitive?.contentOrNull()
        if (html == null && title == null) return ToolResult.error("nothing to update")
        canvasRepository.updateWidgetState(widgetId, buildJsonObject {
            html?.let { put("html", it) }
            title?.let { put("title", it) }
        })
        return ToolResult.success(buildJsonObject { put("widget_id", widgetId); put("success", true) })
    }
}

class DeleteHtmlWidgetTool(
    private val canvasRepository: CanvasRepository,
) : Tool {
    override val definition = ToolDefinition(
        name = "delete_html_widget",
        description = "Delete an HTML widget from the canvas.",
        parameters = toolObjectSchema {
            putJsonObject("widget_id") {
                put("type", "string"); put("description", "Widget ID to delete")
            }
            putJsonArray("required") { add("widget_id") }
        },
    )
    override suspend fun execute(args: JsonObject): ToolResult {
        val widgetId = args["widget_id"]?.jsonPrimitive?.contentOrNull()
            ?: return ToolResult.error("missing widget_id")
        canvasRepository.deleteWidget(widgetId)
        return ToolResult.success(buildJsonObject { put("widget_id", widgetId); put("success", true) })
    }
}
```

#### 6.9.5 AskUserTool（弹 Dialog）

```kotlin
class AskUserTool(
    private val askUserDialogState: MutableStateFlow<AskUserRequest?>,  // UI 观察此 flow 显示 Dialog
) : Tool {
    override val definition = ToolDefinition(
        name = "ask_user",
        description = "Ask the user a question with selectable options. Use when AI needs user input.",
        parameters = toolObjectSchema {
            putJsonObject("question") {
                put("type", "string"); put("description", "Question text to ask the user")
            }
            putJsonObject("options") {
                put("type", "array"); put("minItems", 2); put("maxItems", 4)
                put("description", "Selectable options (2-4)")
            }
            putJsonObject("allowMultiple") {
                put("type", "boolean"); put("description", "Allow multiple selection")
            }
            putJsonArray("required") { add("question") }
        },
    )

    override suspend fun execute(args: JsonObject): ToolResult = withTimeoutOrNull(120_000) {
        suspendCancellableCoroutine<JsonObject> { cont ->
            val request = AskUserRequest(
                requestId = UUID.randomUUID().toString(),
                question = args["question"]?.jsonPrimitive?.contentOrNull() ?: "请选择",
                options = args["options"]?.jsonArray?.map { it.jsonObject } ?: emptyList(),
                allowMultiple = args["allowMultiple"]?.jsonPrimitive?.booleanOrNull() ?: false,
                onResponse = { selectedValues -> cont.resume(buildJsonObject {
                    putJsonArray("selectedValues") { selectedValues.forEach { add(it) } }
                }) },
            )
            askUserDialogState.value = request
        }
    } ?: ToolResult.error("ask_user timeout (120s)")
}
```

**UI 集成**：`AskUserDialog.kt` Composable 观察状态 flow，弹 AlertDialog，用户选择后调 `onResponse(selectedValues)`。

#### 6.9.6 BrowserEvalTool / BrowserNavigateTool / BrowserGetUrlTool

```kotlin
class BrowserEvalTool(
    private val webviewProvider: () -> LivingWebView?,  // 当前活跃 WebView
) : Tool {
    override val definition = ToolDefinition(
        name = "browser_eval",
        description = "Evaluate JavaScript in the active WebView and return result.",
        parameters = toolObjectSchema {
            putJsonObject("script") {
                put("type", "string"); put("description", "JavaScript code to evaluate")
            }
            putJsonArray("required") { add("script") }
        },
    )
    override suspend fun execute(args: JsonObject): ToolResult {
        val webView = webviewProvider() ?: return ToolResult.error("no active webview")
        val script = args["script"]?.jsonPrimitive?.contentOrNull() ?: return ToolResult.error("missing script")
        val result = suspendCancellableCoroutine<String?> { cont ->
            webView.post {
                webView.evaluateJavascript(script) { value ->
                    if (cont.isActive) cont.resume(value)
                }
            }
        }
        return ToolResult.success(buildJsonObject { put("result", result ?: "null") })
    }
}

class BrowserNavigateTool(private val webviewProvider: () -> LivingWebView?) : Tool {
    override val definition = ToolDefinition(
        name = "browser_navigate",
        description = "Navigate the active WebView to a URL.",
        parameters = toolObjectSchema {
            putJsonObject("url") {
                put("type", "string"); put("description", "URL to navigate to")
            }
            putJsonArray("required") { add("url") }
        },
    )
    override suspend fun execute(args: JsonObject): ToolResult {
        val webView = webviewProvider() ?: return ToolResult.error("no active webview")
        val url = args["url"]?.jsonPrimitive?.contentOrNull() ?: return ToolResult.error("missing url")
        webView.post { webView.loadUrl(url) }
        return ToolResult.success(buildJsonObject { put("url", url); put("success", true) })
    }
}

class BrowserGetUrlTool(private val webviewProvider: () -> LivingWebView?) : Tool {
    override val definition = ToolDefinition(
        name = "browser_get_url",
        description = "Get the current URL of the active WebView.",
        parameters = toolObjectSchema { /* 无参 */ },
    )
    override suspend fun execute(args: JsonObject): ToolResult {
        val webView = webviewProvider() ?: return ToolResult.error("no active webview")
        val url = webView.url ?: ""
        return ToolResult.success(buildJsonObject { put("url", url) })
    }
}
```

> **注**：`webviewProvider` 由 CanvasHomeViewModel 注入（从 BrowserViewModel 拿当前活跃 WebView 引用）。M8 不实现 browser_click/input/scroll/screenshot（操作复杂，留给 M3）。

---

### 6.10 LocalAgentService.kt（整合）

```kotlin
@Singleton
class LocalAgentService @Inject constructor(
    private val llmClient: LlmClient,
    private val agentLoop: AgentLoop,
    private val toolRegistry: ToolRegistry,
    private val apiKeyStore: ApiKeyStore,
    private val skillLoader: SkillLoader,
    private val runtimeModeManager: RuntimeModeManager,  // 注入运行时模式
    private val okHttpClient: OkHttpClient,  // 注入 OkHttpClient（testConnection 复用，避免每测一次就 new 一个）
) {
    private val sessions = mutableMapOf<String, Session>()  // panelId -> Session
    private val cachedSkills by lazy { skillLoader.loadAll() }
    private val cachedSystemPrompt by lazy { buildSystemPrompt() }

    /** 发送消息到指定面板的本地 agent */
    fun sendMessage(
        panelId: String,
        userMessage: String,
        thinkingLevel: ThinkingLevel = ThinkingLevel.STANDARD,
    ): Flow<AgentEvent> = flow {
        // CLOUD 模式占位：M3 未实现，提示用户切换模式
        val runtimeState = runtimeModeManager.state.value
        if (runtimeState.effectiveMode == AgentMode.CLOUD) {
            emit(AgentEvent.Error("云端 agent 暂未实现（M3 任务），请切换到本地或 AUTO 离线模式", true))
            return@flow
        }
        val activeProvider = apiKeyStore.getActiveProvider()
            ?: run {
                emit(AgentEvent.Error("未配置 active provider，请到设置 → AI 配置中切换", true))
                return@flow
            }
        val config = apiKeyStore.getConfig(activeProvider) ?: run {
            emit(AgentEvent.Error("未配置 API Key，请到设置 → AI 配置中配置", true))
            return@flow
        }
        val session = sessions.getOrPut(panelId) {
            Session(
                panelId = panelId,
                model = config.model,
                systemPrompt = cachedSystemPrompt,
                tools = toolRegistry.listDefinitions(),
            )
        }
        agentLoop.run(
            session, userMessage, thinkingLevel,
            LlmClientConfig(config.endpoint, config.apiKey, config.provider),
        ).collect { emit(it) }
    }

    /** 销毁指定面板的 Session（在 CanvasHomeViewModel.onCleared 或面板删除时调用，参考 piBridge.ts:93-124） */
    fun disposeSession(panelId: String) {
        sessions.remove(panelId)
    }

    /** 测试连接（用配置调 ping，max_tokens=16） */
    suspend fun testConnection(config: LlmProviderConfig): Boolean = withContext(Dispatchers.IO) {
        try {
            llmClient.stream(
                LlmRequest(
                    provider = config.provider,
                    model = config.model,
                    messages = listOf(LlmMessage(role = "user", content = "ping")),
                    maxTokens = 16,
                ),
                LlmClientConfig(config.endpoint, config.apiKey, config.provider),
            ).firstOrNull { it is LlmStreamEvent.TextDelta } != null
        } catch (e: Exception) { false }
    }

    private fun buildSystemPrompt(): String = buildString {
        append(SYSTEM_PROMPT_BASE)
        append(skillLoader.buildSystemPromptAppendix(cachedSkills))
    }

    companion object {
        private const val SYSTEM_PROMPT_BASE = """
            你是 Living Dashboard 移动端的 AI 助手。你可以通过工具操作画布组件、读写本地存储、操作浏览器。
            - 用户在画布主页与你对话
            - 每个面板的对话独立
            - 你可以创建/更新/删除 HTML 组件
            - 你可以操作当前活跃的浏览器（执行 JS、导航）
            - 回答要简洁、专业、友好
        """.trimIndent()
    }
}
```

**双端 Session 隔离**：CLOUD 与 LOCAL 模式各自维护独立 Session Map。当用户在模式间切换时，旧 Session 不迁移（云端走 WS 上下文，本地走 inMemory），切换后从空对话开始。M5（数据同步）落地后再考虑双端 Session 合并。

---

### 6.11 UI 集成

**WebView 引用注入**：Compose 中 WebView 由 AndroidView 持有，通过 `DisposableEffect` 在 `onActiveChanged` 时 `ActiveWebViewHolder.value = webView`，onRelease 时清空。BrowserEvalTool/BrowserNavigateTool/BrowserGetUrlTool 通过 `ActiveWebViewHolder.value` 获取当前 WebView 引用。

#### 6.11.1 AgentModeSwitcher.kt

```kotlin
@Composable
fun AgentModeSwitcher(
    runtimeMode: RuntimeModeState,
    thinkingLevel: ThinkingLevel,
    onModeChange: (AgentMode) -> Unit,
    onThinkingLevelChange: (ThinkingLevel) -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(modifier) {
        // 模式切换（云端/本地/AUTO 三选一）
        AgentModeSegmentedButton(
            selected = runtimeMode.mode,
            options = AgentMode.entries,
            onChange = onModeChange,
        )
        Spacer(Modifier.width(8.dp))
        // 思考等级 1/2/3/4
        ThinkingLevelDropdown(
            selected = thinkingLevel,
            onChange = onThinkingLevelChange,
        )
    }
    // 离线降级提示
    if (runtimeMode.isOfflineDowngraded) {
        Text("⚠ 离线模式", color = MaterialTheme.colorScheme.error)
    }
}
```

#### 6.11.2 CanvasHomeViewModel 改造

```kotlin
// 新增注入
@Inject lateinit var localAgentService: LocalAgentService
@Inject lateinit var runtimeModeManager: RuntimeModeManager

private var currentThinkingLevel = ThinkingLevel.STANDARD
private var agentJob: Job? = null

fun onAiSend() {
    val message = aiInputText.value.trim()
    if (message.isEmpty()) return
    aiInputText.value = ""

    // 追加用户消息到 UI
    _uiMessages.update { it + ChatMessage(role = "user", content = message) }

    // 启动 agent 循环
    agentJob?.cancel()
    agentJob = viewModelScope.launch {
        val panelId = currentPanelId.value ?: return@launch
        localAgentService.sendMessage(panelId, message, currentThinkingLevel).collect { event ->
            when (event) {
                is AgentEvent.TurnStart -> _uiMessages.update { msgs ->
                    // 每轮 LLM 请求开始，重置上一条 assistant 消息的 isComplete=false（用于 UI 显示加载状态）
                    val last = msgs.lastOrNull()
                    if (last?.role == "assistant") msgs.dropLast(1) + last.copy(isComplete = false)
                    else msgs
                }
                is AgentEvent.TextDelta -> _uiMessages.update { msgs ->
                    val last = msgs.lastOrNull()
                    if (last?.role == "assistant" && !last.isComplete) {
                        msgs.dropLast(1) + last.copy(content = last.content + event.text)
                    } else {
                        msgs + ChatMessage(role = "assistant", content = event.text, isComplete = false)
                    }
                }
                is AgentEvent.ThinkingDelta -> _uiMessages.update { msgs ->
                    val last = msgs.lastOrNull()
                    if (last?.role == "assistant_thinking") {
                        msgs.dropLast(1) + last.copy(content = last.content + event.text)
                    } else {
                        msgs + ChatMessage(role = "assistant_thinking", content = event.text, isComplete = false)
                    }
                }
                is AgentEvent.ToolCallStart -> _uiMessages.update {
                    it + ChatMessage(role = "tool_call", content = "🔧 调用工具: ${event.toolName}", isComplete = true)
                }
                is AgentEvent.ToolCallEnd -> _uiMessages.update {
                    it + ChatMessage(role = "tool_result", content = if (event.success) "✅ 完成" else "❌ 失败: ${event.result}", isComplete = true)
                }
                is AgentEvent.TurnEnd -> _uiMessages.update { msgs ->
                    val last = msgs.lastOrNull()
                    if (last?.role == "assistant" && !last.isComplete) msgs.dropLast(1) + last.copy(isComplete = true)
                    else msgs
                }
                is AgentEvent.Error -> _uiMessages.update {
                    it + ChatMessage(role = "error", content = "⚠ ${event.message}", isComplete = true)
                }
            }
        }
    }

    /** 面板删除时调 LocalAgentService.disposeSession 释放资源（参考 piBridge.ts:93-124） */
    fun onPanelDeleted(panelId: String) {
        if (currentPanelId.value == panelId) {
            agentJob?.cancel()
            localAgentService.disposeSession(panelId)
        }
    }

    override fun onCleared() {
        super.onCleared()
        agentJob?.cancel()
        currentPanelId.value?.let { localAgentService.disposeSession(it) }
    }
}
```

#### 6.11.3 AiConfigScreen.kt（设置页）

```kotlin
@Composable
fun AiConfigScreen(
    viewModel: AiConfigViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsState()
    Column {
        // Provider 选择（6 个，含 gemini 可选）
        ProviderSelector(state.provider, onChange = viewModel::setProvider)
        // API Key（密码框）
        OutlinedTextField(
            value = state.apiKey,
            onValueChange = viewModel::setApiKey,
            label = { Text("API Key") },
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
        )
        // Endpoint（可选，默认值）
        OutlinedTextField(value = state.endpoint, onValueChange = viewModel::setEndpoint, label = { Text("Endpoint") })
        // Model（可选，默认值）
        OutlinedTextField(value = state.model, onValueChange = viewModel::setModel, label = { Text("Model") })
        // 测试连接按钮
        Button(onClick = viewModel::testConnection, enabled = state.canTest) {
            if (state.isTesting) CircularProgressIndicator() else Text("测试连接")
        }
        // 测试结果
        state.testResult?.let { Text(if (it) "✅ 连接成功" else "❌ 连接失败", color = if (it) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error) }
        // 保存按钮
        Button(onClick = viewModel::save, enabled = state.canSave) { Text("保存") }
    }
}
```

#### 6.11.4 AskUserDialog.kt

```kotlin
@Composable
fun AskUserDialog(
    state: AskUserRequest?,
    onRespond: (List<String>) -> Unit,
) {
    if (state == null) return
    AlertDialog(
        onDismissRequest = { onRespond(emptyList()) },
        title = { Text(state.question) },
        text = {
            Column {
                state.options.forEach { option ->
                    TextButton(onClick = { onRespond(listOf(option.value)) }) {
                        Column {
                            Text(option.label, style = MaterialTheme.typography.bodyLarge)
                            option.description?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                        }
                    }
                }
            }
        },
        confirmButton = {},  // 选项即按钮
        dismissButton = { TextButton(onClick = { onRespond(emptyList()) }) { Text("取消") } },
    )
}
```

---

## 七、依赖注入（AppModule.kt 新增）

```kotlin
@Module
@InstallIn(SingletonComponent::class)
object AppModule {
    // 现有 @Provides 保留...

    @Singleton @Provides
    fun provideApplicationScope(): CoroutineScope =
        CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    @Provides @Singleton
    fun provideApiKeyStore(@ApplicationContext context: Context): ApiKeyStore = ApiKeyStore(context)

    @Provides @Singleton
    fun provideSkillLoader(@ApplicationContext context: Context): SkillLoader = SkillLoader(context)

    @Provides @Singleton
    fun provideLlmClient(okHttpClient: OkHttpClient): LlmClient = LlmClient(okHttpClient)

    @Provides @Singleton
    fun provideToolRegistry(
        canvasRepository: CanvasRepository,
        kvStorage: KvStorage,
        webviewHolder: ActiveWebViewHolder,  // 新增，持有当前活跃 WebView 引用
        panelIdHolder: ActivePanelIdHolder,  // 新增
        askUserDialogState: MutableStateFlow<AskUserRequest?>,  // 新增
    ): ToolRegistry = ToolRegistry().apply {
        register(ListWidgetsTool(canvasRepository) { panelIdHolder.value })
        register(StorageReadTool(kvStorage))
        register(StorageWriteTool(kvStorage))
        register(CreateHtmlWidgetTool(canvasRepository) { panelIdHolder.value })
        register(UpdateHtmlWidgetTool(canvasRepository))
        register(DeleteHtmlWidgetTool(canvasRepository))
        register(AskUserTool(askUserDialogState))
        register(BrowserEvalTool { webviewHolder.value })
        register(BrowserNavigateTool { webviewHolder.value })
        register(BrowserGetUrlTool { webviewHolder.value })
    }

    @Provides @Singleton
    fun provideAgentLoop(llmClient: LlmClient, toolRegistry: ToolRegistry): AgentLoop = AgentLoop(llmClient, toolRegistry)

    @Provides @Singleton
    fun provideLocalAgentService(
        agentLoop: AgentLoop,
        toolRegistry: ToolRegistry,
        apiKeyStore: ApiKeyStore,
        skillLoader: SkillLoader,
        runtimeModeManager: RuntimeModeManager,
        okHttpClient: OkHttpClient,
        llmClient: LlmClient,
    ): LocalAgentService = LocalAgentService(
        llmClient, agentLoop, toolRegistry, apiKeyStore, skillLoader,
        runtimeModeManager, okHttpClient,
    )

    @Provides @Singleton
    fun provideRuntimeModeManager(
        wsClient: WsClient,
        coroutineScope: CoroutineScope,  // 由 provideApplicationScope 注入
    ): RuntimeModeManager = RuntimeModeManager(wsClient, coroutineScope)

    // 新增：活跃 WebView / 面板 / AskUser 状态
    @Provides @Singleton
    fun provideActiveWebViewHolder(): ActiveWebViewHolder = ActiveWebViewHolder()

    @Provides @Singleton
    fun provideActivePanelIdHolder(): ActivePanelIdHolder = ActivePanelIdHolder()

    @Provides @Singleton
    fun provideAskUserDialogState(): MutableStateFlow<AskUserRequest?> = MutableStateFlow(null)

    @Provides @Singleton
    fun provideKvStorage(dataStore: DataStore<Preferences>): KvStorage = KvStorage(dataStore)
}

class ActiveWebViewHolder { @Volatile var value: LivingWebView? = null }
class ActivePanelIdHolder { @Volatile var value: String? = null }
data class AskUserRequest(val requestId: String, val question: String, val options: List<JsonObject>, val allowMultiple: Boolean, val onResponse: (List<String>) -> Unit)
```

---

## 八、测试计划

### 8.1 单元测试（test/ 目录）

| 测试文件 | 测试内容 | 用例数 |
|---------|---------|--------|
| `ai/LlmClientTest.kt` | SSE 基础解析（data/[DONE]/keep-alive）：3 用例 + 5 OpenAI 兼容 provider URL 构建分支：5 用例（gemini 走相同路径不单测） + 5 OpenAI 兼容 provider Header 差异 + Anthropic 单独 Header：3 用例 + tool_calls 分片累积：3 用例 + reasoning_content（DeepSeek）+ thinking（Qwen）：2 用例 + 错误处理（4xx/5xx/超时/不完整 SSE）：4 用例 + 取消：1 用例 + Anthropic SSE 解析（event+data 双行）：2 用例 | 23 |
| `ai/AgentLoopTest.kt` | 无工具单轮 + 单工具单轮 + 多工具多轮：3 用例 + tool_calls 分片累积：1 用例 + tool_result 拼回 session：1 用例 + 最大轮次限制（第 11 轮 emit Error）：1 用例 + LlmStreamError 传播：1 用例 + 工具执行失败 → ToolResult.error → 继续下一轮：1 用例 + 流被取消时 session 不写脏数据：1 用例 + TurnStart 事件：1 用例 | 10 |
| `ai/ToolRegistryTest.kt` | register/get/listDefinitions/execute：4 用例 + tool.execute 抛异常 → ToolResult.error：1 用例 + listDefinitions 顺序：1 用例 | 6 |
| `ai/SessionTest.kt` | addUserMessage/addAssistantMessage/addToolResultMessage：3 用例 + trim 触发裁剪：1 用例 + trim 不触发裁剪：1 用例 + trim 跳过开头 tool 消息：1 用例 + clear 后只剩 system：1 用例 + systemPrompt 初始化：1 用例 | 8 |
| `ai/SkillLoaderTest.kt` | YAML frontmatter 解析：1 用例 + Markdown 正文：1 用例 + 格式错误跳过：1 用例 + assets 目录不存在/空目录/SKILL.md 文件名缺失：3 用例 | 6 |
| `ai/ApiKeyStoreTest.kt` | 6 provider 写入互不覆盖：1 用例 + 加密读回：1 用例 + 切换 active：1 用例 + clear：1 用例 + hasConfig：1 用例 + clearProvider：1 用例 + 配置不存在返回 null：1 用例 | 7 |
| `ai/ThinkingLevelMapperTest.kt` | 6 provider × 4 等级 = 24 用例 + parseProvider 分支（含/不含 /）：2 用例 | 26 |
| `ai/RuntimeModeManagerTest.kt` | AUTO+在线→CLOUD：1 用例 + AUTO+离线→LOCAL：1 用例 + LOCAL 强制：1 用例 + CLOUD+离线→LOCAL：1 用例 + cooldown 防抖动：1 用例 | 5 |
| `ai/LocalAgentServiceTest.kt` | sendMessage 在 apiKeyStore.getActiveProvider()==null 或 getConfig(activeProvider)==null 时 emit Error：1 用例 + sendMessage 复用 Session：1 用例 + testConnection 成功：1 用例 + testConnection 失败：1 用例 + CLOUD 模式 emit Error：1 用例 | 5 |
| `ai/KvStorageTest.kt` | read 不存在返回 null：1 用例 + write 后 read 一致：1 用例 + listKeys 返回所有 key：1 用例 | 3 |
| `ai/tools/ToolsTest.kt` | 10 工具 × 3 用例（正常/参数错/边界）= 30 用例（含 ListWidgetsTool 无活跃面板、CreateHtmlWidgetTool 默认值、StorageReadTool key 缺失、AskUserTool 120s 超时、BrowserEvalTool 无活跃 WebView 等） | 30 |

**总用例数：23+10+6+8+6+7+26+5+5+3+30 = 129 用例**

**Kover 覆盖率门槛**：行 ≥ 80%，分支 ≥ 70%，由 build.gradle.kts `kover { verify { ... } }` 配置。

**MockWebServer 用法**（LlmClient 测试）：
```kotlin
@Test fun `should_parse_sse_stream`() = runTest {
    val server = MockWebServer()
    server.enqueue(MockResponse().setBody(
        "data: {\"choices\":[{\"delta\":{\"content\":\"Hello\"}}]}\n\n" +
        "data: {\"choices\":[{\"delta\":{\"content\":\" world\"}}]}\n\n" +
        "data: [DONE]\n\n"
    ).setHeader("Content-Type", "text/event-stream"))
    server.start()
    val client = LlmClient(OkHttpClient())
    val events = client.stream(
        LlmRequest(provider = "stepfun", model = "test", messages = listOf(LlmMessage("user", "hi"))),
        LlmClientConfig(server.url("/v1").toString(), "test-key", "stepfun"),
    ).toList()
    assertEquals(3, events.size)  // TextDelta + TextDelta + Done
    assertEquals("Hello", (events[0] as LlmStreamEvent.TextDelta).text)
    assertEquals(" world", (events[1] as LlmStreamEvent.TextDelta).text)
    assertTrue(events[2] is LlmStreamEvent.Done)
    server.shutdown()
}
```

**MockWebServer 错误响应示例**：
```kotlin
// 4xx 错误
server.enqueue(MockResponse().setResponseCode(401).setBody("{\"error\":\"invalid api key\"}"))
// 5xx 错误
server.enqueue(MockResponse().setResponseCode(500))
// 超时
server.enqueue(MockResponse().setBodyDelay(10, TimeUnit.SECONDS).setBody("partial"))
// 不完整 SSE chunk
server.enqueue(MockResponse().setBody("data: {\"choices\":[{\"delta\":"))
// retry-after header
server.enqueue(MockResponse().setResponseCode(429).setHeader("retry-after", "30"))
```

**5 OpenAI 兼容 provider MockWebServer 差异测试**：
- 5 OpenAI 兼容 provider（stepfun/openai/deepseek/qwen/gemini）各跑 URL 构建分支测试（`/chat/completions`、`/v1`、`/v2`、其他、空 endpoint）
- Anthropic 单独测 `/messages` URL + `x-api-key` + `anthropic-version` header
- 通过 `server.takeRequest()` 校验请求体里 reasoning_effort/thinking_budget/reasoning.effort/thinking.type/temperature 是否按 ThinkingLevelMapper 正确注入：
```kotlin
val recordedRequest = server.takeRequest()
val body = recordedRequest.body.readUtf8()
assertTrue(body.contains("\"reasoning_effort\":\"high\""))  // DeepSeek 等级 3
```

**Robolectric + Hilt 集成**：
```kotlin
@HiltAndroidTest
@Config(sdk = [34], application = HiltTestApplication::class)
class ApiKeyStoreTest {
    @get:Rule val hiltRule = HiltAndroidRule(this)
    @Inject lateinit var apiKeyStore: ApiKeyStore

    @Before fun setup() { hiltRule.inject() }
}

@Config(sdk = [34])
class LlmClientTest {
    // 不需要 Hilt（纯 JVM 测试）
}
```

**EncryptedSharedPreferences 在 Robolectric 下**：
Robolectric 4.13 提供 ShadowKeyStore，EncryptedSharedPreferences 可真实加密读写；如遇 Keystore 异常，fallback 到 `@Config(shadows = [ShadowKeyStore::class])` 显式注入。

### 8.2 编译验证

**Debug 构建 + 单元测试**：
```bash
cd client/android
F:\allmylife\gradle-8.2-bin\bin\gradle.bat assembleDebug
F:\allmylife\gradle-8.2-bin\bin\gradle.bat testDebugUnitTest
F:\allmylife\gradle-8.2-bin\bin\gradle.bat testDebugUnitTest koverVerify  # 含覆盖率校验
```

**测试报告输出路径**：
- HTML：`app/build/reports/tests/testDebugUnitTest/index.html`
- XML（CI 用）：`app/build/test-results/testDebugUnitTest/`
- 覆盖率：`app/build/reports/kover/html/index.html`

**签名 release apk 构建**：
```bash
cd client/android
F:\allmylife\gradle-8.2-bin\bin\gradle.bat assembleRelease
# 输出：app/build/outputs/apk/release/app-release.apk
```

签名密钥：
- 路径：`F:\allmylife\keystores\living-dashboard.jks`（不入 git，加入 .gitignore）
- 在 build.gradle.kts 新增 signingConfigs.release：
```kotlin
signingConfigs {
    create("release") {
        storeFile = file("F:/allmylife/keystores/living-dashboard.jks")
        storePassword = System.getenv("LD_KEYSTORE_PASSWORD")
        keyAlias = System.getenv("LD_KEY_ALIAS")
        keyPassword = System.getenv("LD_KEY_PASSWORD")
    }
}
buildTypes {
    getByName("release") {
        isMinifyEnabled = true
        isShrinkResources = true
        proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        signingConfig = signingConfigs.getByName("release")
    }
}
```

ProGuard 规则（proguard-rules.pro）新增：
```
-keep class com.livingdashboard.ai.** { *; }
-keepclassmembers class com.livingdashboard.ai.** { *; }
-keep class kotlinx.serialization.** { *; }
-keepclassmembers class kotlinx.serialization.** { *; }
```

如未提供 keystore，临时用 debug 签名（不推荐生产）。

### 8.3 真机端到端测试（M8 验收 + M0/M1/M2 回归）

详见 [roadmap_mobile_v1.md 十三、AI 接入测试说明](../roadmap_mobile_v1.md)。

**M8 新功能验收用例**（adb 操作 + logcat 观察）：

| 用例 | 步骤 | 预期 |
|------|------|------|
| 配置 API Key | 设置 → AI 配置 → 选 provider → 输入 Key → 测试连接 | Toast"✅ 连接成功" |
| 单轮对话 | 画布主页 AI 输入框 → "你好" | AI 流式回复，TextDelta 增量显示 |
| 思考链显示 | DeepSeek 等级 4 → "解释量子纠缠" | ThinkingDelta 折叠显示思考过程 |
| 工具调用 - create_html_widget | "创建一个显示当前时间的 HTML 组件" | AI 调 create_html_widget，画布出现新组件 |
| 工具调用 - update_html_widget | "创建时间组件" → "改成红色背景" | AI 调 update_html_widget，组件更新 |
| 工具调用 - delete_html_widget | "删除刚才创建的组件" | AI 调 delete_html_widget，组件消失 |
| 工具调用 - list_widgets | "列出当前画布所有组件" | AI 调 list_widgets，返回组件列表 |
| 工具调用 - storage_write/read | "保存键 foo=bar，然后读出来" | AI 调 storage_write + storage_read，返回 bar |
| 工具调用 - ask_user | "你想用哪个颜色？" | 弹 AskUserDialog，用户选择后 AI 继续 |
| 工具调用 - browser_eval | 浏览器打开百度 → "获取页面标题" | AI 调 browser_eval，返回百度标题 |
| 工具调用 - browser_navigate | "浏览器打开 github.com" | AI 调 browser_navigate，WebView 加载 github |
| 工具调用 - browser_get_url | "当前浏览器在哪个页面" | AI 调 browser_get_url，返回当前 URL |
| 思考等级切换 | 等级 1/2/3/4 各发一条消息 | logcat 中 reasoning_effort/thinking_budget/reasoning.effort 参数不同 |
| 离线降级 - 关服务器 | 启动服务器进程 → 切 AUTO 模式 → 关服务器 → 等 30s → 发消息 | WsClient state=DISCONNECTED → effectiveMode=LOCAL → 本地 agent 响应 |
| 模式切换 | 点 LOCAL → 发消息 → 点 CLOUD → 发消息 | LOCAL 走本地 agent，CLOUD 显示"M3 未实现" Toast |
| 多轮工具调用 | "创建待办列表组件，再加一项'买菜'" | AI 调 create_html_widget → update_html_widget，2 轮循环 |

**8 个边界场景用例**：

| 用例 | 步骤 | 预期 |
|------|------|------|
| 边界 - API Key 未配置 | 不配置 API Key 发消息 | UI 显示 "未配置 API Key" 错误 |
| 边界 - API Key 错误（401） | 配置错误 Key 发消息 | UI 显示 "API Key 无效" |
| 边界 - 429 限流 | 重复发消息触发限流 | UI 显示 retry-after 提示 |
| 边界 - AskUserDialog 120s 超时 | ask_user 不回应等待 120s | 工具返回 timeout |
| 边界 - AskUserDialog 旋转屏 | ask_user 时旋转屏 | Dialog 状态保留（rememberSaveable） |
| 边界 - Session.trim 触发 | 发 21+ 条消息 | 上下文裁剪后对话连贯 |
| 边界 - 多轮工具调用达 10 轮上限 | 让 AI 调 11 次工具 | 第 11 次 emit Error "max iterations" |
| 边界 - App 重启后 Session 丢失 | 重启 App | inMemory Session 丢失，从空对话开始 |

**5 provider 真机验证**（M8 必做）：

| Provider | 真机验证内容 |
|----------|------------|
| stepfun | 配置 stepfun key → 发消息 → 验证流式对话 |
| deepseek | 配置 deepseek key → 等级 4 发消息 → logcat 验证 reasoning_effort=high + reasoning_content 流 |
| qwen | 配置 qwen key → 等级 4 → logcat 验证 thinking_budget=16384 |
| anthropic | 配置 anthropic key → 等级 4 → logcat 验证 thinking.type=enabled + budget_tokens=16000 |
| openai | 配置 openai key → 等级 4 → logcat 验证 reasoning.effort=high |

gemini 真机验证为可选（roadmap 第十三章 13.1 节未列入 5 个测试 provider）。

**adb logcat 过滤规则**：
```bash
F:\Android SDK\platform-tools\adb.exe logcat -s LlmClient:* AgentLoop:* ToolRegistry:* Session:* ApiKeyStore:* SkillLoader:* RuntimeModeManager:* LocalAgentService:* CanvasHomeViewModel:* BrowserEvalTool:* AskUserTool:*
# 抓 crash
F:\Android SDK\platform-tools\adb.exe logcat -b crash -d > crash.log
```

**失败诊断流程**：
1. 抓 crash log：`adb logcat -b crash -d > crash.log`
2. 抓 bugreport：`adb bugreport bugreport.zip`
3. 抓 ANR：`adb shell cat /data/anr/traces.txt`
4. 卸载重装：`adb uninstall com.livingdashboard && adb install -r app-release.apk`
5. 强制停止：`adb shell am force-stop com.livingdashboard`

**M0/M1/M2 回归用例**（确保 M8 没破坏已有功能）：

| 用例 | 验证点 | 执行命令 |
|------|------|------|
| M0 启动 | App 能启动，无崩溃 | `adb install -r app-release.apk && adb shell am start -n com.livingdashboard/.MainActivity` |
| M1 浏览器主页 | 搜索框 + Logo + 常用网站正常 | 手动点击浏览器图标 |
| M1 WebView 浏览 | 打开 baidu.com 正常 | 在浏览器内输入 baidu.com |
| M1 标签页管理 | 新建/关闭/切换标签页正常 | 手动操作 |
| M1 书签/历史 | 添加书签、查看历史正常 | 手动操作 |
| M1 默认浏览器 | ACTION_VIEW intent 接收正常 | `adb shell am start -a android.intent.action.VIEW -d https://baidu.com` |
| M2 画布主页 | AI 对话框 + 圆形图标 + 收藏组件图标正常 | 手动切换到画布 |
| M2 Home 键切换 | 浏览器主页 ↔ 画布主页切换正常 | `adb shell input keyevent KEYCODE_HOME` 后重新启动 |
| M2 画布缩放 | 双指缩放 + 卡片摘要↔完整组件 | 手动双指操作 |
| M2 面板管理 | 新建/切换/删除面板正常 | 手动操作 |
| M2 5 个组件 | AIAssistant/WebviewWidget/Calculator/FocusTimer/HtmlCanvasWidget 渲染正常 | 手动添加 |
| M2 收藏组件 | 收藏/取消收藏 + WebOS 页面正常 | 手动操作 |
| M2 聚合面板 | 下滑进聚合面板，收藏组件真实引用正常 | 手动下滑 |

> **注**：断 WiFi 不会立刻让 WsClient.state 变 DISCONNECTED（要等心跳超时 30s+），建议关服务器或改 WS_URL 指向不通端口测试离线降级。

### 8.4 验证流程（手动）

1. 开发者本地执行：
   ```bash
   cd client/android
   F:\allmylife\gradle-8.2-bin\bin\gradle.bat assembleDebug
   F:\allmylife\gradle-8.2-bin\bin\gradle.bat testDebugUnitTest
   F:\allmylife\gradle-8.2-bin\bin\gradle.bat testDebugUnitTest koverVerify
   F:\allmylife\gradle-8.2-bin\bin\gradle.bat assembleRelease
   ```
2. 全绿后真机 adb install + e2e 跑 24 + 13 用例
3. 任一失败：记录 crash log → 修 bug → 重跑全量（不允许跳过）
4. 全绿后 git commit -m "M8: 单机轻 Agent 完成" + git push
5. 向用户报告：附测试报告 HTML 链接 + 真机录屏

---

## 九、风险与缓解

| 风险 | 缓解 |
|------|------|
| OkHttp SSE 解析在低端机卡顿 | 用 `Dispatchers.IO` + 缓冲 `Flow.flowOn(Dispatchers.IO)` |
| EncryptedSharedPreferences 首次初始化慢（Android Keystore） | 异步初始化，UI 显示加载状态 |
| tool_calls 流式分片解析出错（边界情况） | 单元测试覆盖所有 chunk 组合 |
| 真机 WebView evaluateJavascript 回调在主线程 | 用 `webView.post { ... }` + `suspendCancellableCoroutine` |
| AskUserDialog 在 Activity 重启后丢失（旋转屏） | 用 `rememberSaveable` 持久化 requestId，重启后重建 Dialog |
| LLM API 限流（429） | LlmClient 解析 retry-after header，emit Error + 提示用户切换 provider |
| Session 消息超 token 限制 | Session.trim(keepRecent=20) 自动裁剪旧消息 |

---

## 十、验收标准（roadmap M8 对应）

- [ ] LlmClient 能流式调 OpenAI 兼容 API（MockWebServer + 真机 stepfun 验证）
- [ ] AgentLoop 能多轮工具调用（单元测试 + 真机 create_html_widget 验证）
- [ ] 工具注册执行正常（10 个工具全部注册 + 单元测试）
- [ ] Skills 加载 product-guide 正常（assets 打包 + SkillLoader 解析）
- [ ] 用户 API Key 加密存储（EncryptedSharedPreferences，Robolectric 测试）
- [ ] 不同等级推理深度不同（6 provider × 4 档 = 24 组合；其中 Gemini 真机测试在 M8 为可选，但单元测试必须覆盖 24 组合）
- [ ] 云端/本地 agent 可切换（AgentModeSwitcher UI + RuntimeModeManager）
- [ ] 服务器离线时自动切本地 agent，UI 提示"离线模式"
- [ ] **生成签名 apk 并通过干净 Android 安装测试**（魅族 Lucky 08 真机）
- [ ] M0/M1/M2 全部功能回归通过（无回归 bug）
- [ ] git commit + 推送（M8 完成后）
- [ ] `./gradlew assembleDebug` 退出码 0
- [ ] `./gradlew testDebugUnitTest` 所有用例 PASS（0 FAIL，0 SKIP）
- [ ] kover 覆盖率 行 ≥ 80%，分支 ≥ 70%
- [ ] `./gradlew assembleRelease` 退出码 0
- [ ] `adb install -r app-release.apk` 成功
- [ ] M8 真机 e2e 全绿（12 新功能 + 4 工具补全 + 8 边界 = 24 用例）
- [ ] M0/M1/M2 回归 13 用例全绿
- [ ] 5 provider 真机验证全绿（stepfun/deepseek/qwen/anthropic/openai 各 1 轮，gemini 可选）
- [ ] Session 上下文管理正常（addMessage/trim(keepRecent=20)/clear + systemPrompt 初始化，单元测试 8 用例通过）
- [ ] 真机端到端测试通过（8.3 节 24 个 M8 验收用例 + 13 个 M0/M1/M2 回归用例）
- [ ] 点 CLOUD 模式 → 弹 Toast "M3 未实现"（占位验证）

---

## 十一、执行顺序（sub-agent 并行规划）

1. **Phase A（并行）**：核心 6 文件 + 测试（LlmClient/AgentLoop/Tool+ToolRegistry/Session/SkillLoader/AgentEvent）
2. **Phase B（并行）**：ApiKeyStore + ThinkingLevel + RuntimeModeManager + 测试
3. **Phase C（并行）**：10 个工具实现 + KvStorage
4. **Phase D（依赖 A/B/C）**：LocalAgentService + DI 配置
5. **Phase E（依赖 D）**：UI（AgentModeSwitcher + AiConfigScreen + AskUserDialog + CanvasHome 接入）
6. **Phase F**：编译 + 单元测试 + 对抗审查
7. **Phase G**：真机安装 + 端到端测试 + 修 bug
8. **Phase H**：git commit + 向用户报告

---

## 十二、变更历史

| 日期 | 变更 |
|------|------|
| 2026-06-27 | 初版（基于 roadmap M8 + 架构 13 章） |
| 2026-06-27 | v2：按 3 份对抗审查报告修复 32 个 BLOCKER（详见各章节）；新增 Anthropic 协议适配、toolObjectSchema 包装、Session.trim bug 修复、RuntimeModeManager 注入 CoroutineScope + cooldown 防抖、ApiKeyStore 按 provider 分键存储、TurnStart 事件、disposeSession、Kover 覆盖率配置、5 provider 真机验证、Robolectric+Hilt 集成说明、签名 release apk 构建等 |
