# Phase M0 实施 Spec — 移动端项目搭建（v2，对抗审查修订版）

> 生成日期：2026-06-24
> 依据：[roadmap_mobile_v1.md](file:///f:/allmylife/event/docs/roadmap_mobile_v1.md) 第五章 Phase M0
> 工作流：roadmap 第九章（写 Spec → 对抗审查 → 编码 → 对抗审查 → commit）
> 修订记录：v2 修复对抗审查发现的 9 个严重问题 + 8 个中等问题
>
> **产品定位**：移动端 AI 浏览器客户端（形态=浏览器+无限画布+AI，用途=日常 AI 助手）
> **M0 目标**：搭建安卓项目骨架，能编译运行，WS 客户端能连服务器

---

## 一、上下文与约束

### 1.1 项目背景

Living Dashboard 桌面端已推进到 Phase 3（服务器化），移动端是多端互通的关键一环。M0 是移动端的第一个 Phase，只做项目骨架 + WS 连接，不做任何业务功能。

### 1.2 硬约束（来自 roadmap 第四章 + 用户规则）

| 约束 | 说明 |
|------|------|
| 技术栈 | Kotlin + Jetpack Compose + WebView（不用 TS/React） |
| iOS/Mac | 暂不考虑，仅安卓 |
| 服务器 | 与桌面端共享（server/ 目录的 Phase 3 服务器） |
| Gradle | 用 `F:\allmylife\gradle-8.2-bin`（实际 gradle.bat 路径：`F:\allmylife\gradle-8.2-bin\gradle-8.2\bin\gradle.bat`） |
| Java | `D:\Java`（Java 17.0.12，已确认） |
| Android SDK | `F:\Android SDK`（已装 android-36 + build-tools 36.1.0 + platform-tools + system-images/android-36.1） |
| 包体 | < 20MB（M0 不严格验收，但依赖选择要轻量） |
| git | 所有变更走 git commit |
| 图标 | Compose 内置 Material Icons 为主 + VectorDrawable 补充（不用 PNG 位图） |
| 不下载 C 盘 | 所有下载/缓存走 F 盘或其他非 C 盘 |

### 1.3 已确认决策（本次会话用户确认 + 对抗审查修正）

| 决策 | 选择 | 说明 |
|------|------|------|
| compileSdk / targetSdk | 36（主方案） | 用户确认用已装的 API 36。**风险**：AGP 8.2 官方支持最高 compileSdk=34，36 为实验性配置。回退方案：若编译失败，安装 android-34 platform 并降级 compileSdk=34（见第 5.2 节） |
| minSdk | 26（Android 8.0） | roadmap 指定 |
| 运行验收方式 | 编译通过 + 真机运行 | 需要时提示用户接手机（USB 调试） |
| WS 验收方式 | 启动服务器实测 | 移动端连主机局域网 IP（真机不能用 10.0.2.2） |
| 包名 | `com.livingdashboard` | roadmap 11.2 节指定 |
| WS 地址配置 | BuildConfig.WS_URL | 编译时通过 local.properties 注入，真机验收前用 ipconfig 查主机 IP 填入 |

### 1.4 服务器 WS 协议（复用桌面端，来自 server/src/ws.ts）

- **路径**：`/ws`（与 HTTP 同端口，默认 3456）
- **连接参数**：query string `?deviceId=xxx&token=xxx`
  - token：服务器 `SERVER_TOKEN` 环境变量为空时不校验（M0 验收前确认 .env 中 `SERVER_TOKEN=` 为空）
- **心跳**：客户端每 30 秒发 `{ kind: 'ping' }`，服务器回 `{ kind: 'pong' }`；90 秒无活动服务器主动断开
- **客户端 → 服务器消息**（kind 字段为字面量，小写下划线）：
  - `{ kind: 'user_message', sessionId, content }`
  - `{ kind: 'tool_result', requestId, success, data?, error? }`
  - `{ kind: 'error_report', widgetId, message, stack?, source }`
  - `{ kind: 'ping' }`
- **服务器 → 客户端消息**：
  - `{ kind: 'tool_call', requestId, tool, params, targetDeviceId? }`
  - `{ kind: 'pi_event', event, data }`
  - `{ kind: 'session_ready', sessionId }`
  - `{ kind: 'error', message }`
  - `{ kind: 'pong' }`
  - `{ kind: 'change', changeType, data, sourceDeviceId? }`
- **同 deviceId 新连接替换旧连接**（服务器侧处理）
- **关键**：`kind` 字段是字面量（如 `ping` 不是 `Ping`，`user_message` 不是 `UserMessage`），kotlinx-serialization 必须用 `@SerialName` 指定

### 1.5 桌面端 WS 客户端参考（client/desktop/src/stores/useAIStore.ts）

- WS_URL_BASE 默认 `ws://localhost:3456/ws`
- buildWsUrl() 拼接 deviceId + token
- 重连：基础 1 秒，指数退避，上限 30 秒
- ping 间隔 30 秒

---

## 二、M0 任务清单与验收标准

### 2.1 任务清单（来自 roadmap 第五章 Phase M0）

| # | 任务 | 详情 | 验收标准 |
|---|------|------|----------|
| 1 | 项目创建 | Kotlin + Compose 项目，配置 Gradle（用 F:\allmylife\gradle-8.2-bin） | 项目能编译 |
| 2 | 依赖配置 | Compose / Room / OkHttp / Hilt / WebView | 依赖正常引入 |
| 3 | 项目结构 | 按模块划分：ui / browser / canvas / ai / script / data / sync / import | 结构清晰 |
| 4 | 服务器连接 | WS 客户端连服务器（复用协议） | 能连服务器，收发消息 |
| 5 | 首个页面 | 空白 Compose 页面，能运行 | App 能启动 |

### 2.2 验收标准（roadmap 第十章 Phase M0 验收）

- [ ] 安卓项目能编译运行（gradle assembleDebug 通过 + 真机启动显示首页）
- [ ] WS 客户端能连服务器（启动服务器，移动端连接成功，ping/pong 正常，日志可见连接建立）
- [ ] 项目结构清晰（按 roadmap 11.2 节模块划分）

---

## 三、技术方案

### 3.1 项目结构

```
client/android/
├── app/
│   ├── src/
│   │   ├── main/
│   │   │   ├── java/com/livingdashboard/
│   │   │   │   ├── ui/                  # Compose UI
│   │   │   │   │   ├── MainActivity.kt
│   │   │   │   │   ├── home/
│   │   │   │   │   │   └── HomeScreen.kt       # M0 首页（Logo+WS状态+消息列表）
│   │   │   │   │   └── theme/
│   │   │   │   │       ├── Color.kt
│   │   │   │   │       ├── Theme.kt
│   │   │   │   │       └── Type.kt
│   │   │   │   ├── browser/             # WebView 浏览器引擎（M0 占位）
│   │   │   │   │   └── .gitkeep
│   │   │   │   ├── canvas/              # 画布逻辑（M0 占位）
│   │   │   │   │   └── .gitkeep
│   │   │   │   ├── ai/                  # AI 指令执行器（M0 占位）
│   │   │   │   │   └── .gitkeep
│   │   │   │   ├── script/              # 脚本管理器（M0 占位）
│   │   │   │   │   └── .gitkeep
│   │   │   │   ├── data/                # Room 数据层（M0 占位）
│   │   │   │   │   └── .gitkeep
│   │   │   │   ├── sync/                # 服务器同步（M0 放 WS 客户端）
│   │   │   │   │   ├── WsClient.kt              # WS 连接管理（OkHttp WebSocket）
│   │   │   │   │   ├── WsMessage.kt             # 消息类型定义（kotlinx-serialization）
│   │   │   │   │   ├── DeviceAuth.kt            # deviceId 生成 + token 存储
│   │   │   │   │   └── ServerConfig.kt          # 服务器地址配置（BuildConfig.WS_URL）
│   │   │   │   ├── import/              # 数据导入（M0 占位，roadmap 11.2 要求）
│   │   │   │   │   └── .gitkeep
│   │   │   │   └── di/                  # Hilt 依赖注入
│   │   │   │       └── AppModule.kt            # 提供 WsClient 单例
│   │   │   ├── res/                     # 资源
│   │   │   │   ├── drawable/
│   │   │   │   │   ├── ic_logo.webp              # 已有，保留
│   │   │   │   │   └── ic_launcher_background.xml # 新建：自适应图标背景（纯色）
│   │   │   │   ├── mipmap-anydpi-v26/
│   │   │   │   │   └── ic_launcher.xml           # 新建：自适应图标配置
│   │   │   │   ├── mipmap-hdpi/
│   │   │   │   │   └── ic_launcher_foreground.webp # 已有，保留
│   │   │   │   ├── mipmap-mdpi/
│   │   │   │   │   └── ic_launcher_foreground.webp # 已有，保留
│   │   │   │   ├── mipmap-xhdpi/
│   │   │   │   │   └── ic_launcher_foreground.webp # 已有，保留
│   │   │   │   ├── mipmap-xxhdpi/
│   │   │   │   │   └── ic_launcher_foreground.webp # 已有，保留
│   │   │   │   ├── mipmap-xxxhdpi/
│   │   │   │   │   └── ic_launcher_foreground.webp # 已有，保留
│   │   │   │   ├── raw/
│   │   │   │   │   └── logo_original.webp        # 已有，保留
│   │   │   │   ├── values/
│   │   │   │   │   ├── strings.xml               # 新建：app_name 等
│   │   │   │   │   ├── colors.xml                # 新建：主题色
│   │   │   │   │   └── themes.xml                # 新建：Theme.LivingDashboard
│   │   │   │   └── xml/
│   │   │   │       ├── backup_rules.xml          # 新建：备份规则
│   │   │   │       └── data_extraction_rules.xml # 新建：数据提取规则
│   │   │   └── AndroidManifest.xml
│   │   └── test/
│   │       └── java/com/livingdashboard/sync/
│   │           └── WsMessageTest.kt              # WS 消息序列化测试
│   ├── build.gradle.kts                 # app 模块构建脚本
│   └── proguard-rules.pro               # R8 规则（M0 空文件，release 开启）
├── build.gradle.kts                     # 根构建脚本（声明插件版本）
├── settings.gradle.kts                  # 项目设置
├── gradle.properties                    # Gradle 属性
├── local.properties                     # 本地 SDK 路径（gitignore，不入库）
└── gradle/
    └── wrapper/
        └── gradle-wrapper.properties    # 指向本地 Gradle 8.2
```

### 3.2 锁定的依赖版本（对抗审查要求具体版本号）

| 依赖 | 版本 | 用途 |
|------|------|------|
| AGP (Android Gradle Plugin) | 8.2.2 | 与 Gradle 8.2 严格匹配 |
| Kotlin | 1.9.24 | Compose Compiler 1.5.14 兼容 |
| Compose BOM | 2024.06.00 | 统一 Compose 版本（与 Compose Compiler 1.5.14 同期，兼容性确定） |
| Compose Compiler | 1.5.14 | 对应 Kotlin 1.9.24 |
| Hilt | 2.48 | 依赖注入（配合 KAPT） |
| OkHttp | 4.12.0 | WebSocket 客户端 |
| Room | 2.6.1 | 本地缓存（M0 引入，不建表） |
| kotlinx-serialization-json | 1.6.3 | JSON 序列化（WS 消息） |
| material-icons-core | 随 Compose BOM | M0 只用 core，不引入 extended |

### 3.3 Gradle 配置（完整内容）

#### 3.3.1 settings.gradle.kts

```kotlin
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name = "LivingDashboard"
include(":app")
```

#### 3.3.2 根 build.gradle.kts

```kotlin
plugins {
    id("com.android.application") version "8.2.2" apply false
    id("org.jetbrains.kotlin.android") version "1.9.24" apply false
    id("org.jetbrains.kotlin.plugin.serialization") version "1.9.24" apply false
    id("org.jetbrains.kotlin.kapt") version "1.9.24" apply false
    id("com.google.dagger.hilt.android") version "2.48" apply false
}
```

#### 3.3.3 app/build.gradle.kts（完整，含所有必需配置）

```kotlin
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.serialization")
    id("org.jetbrains.kotlin.kapt")
    id("com.google.dagger.hilt.android")
}

// 手动读取 local.properties（project.findProperty 不读 local.properties 的自定义属性）
val localProps = java.util.Properties().apply {
    val f = rootProject.file("local.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
val wsUrl: String = localProps.getProperty("LIVING_DASHBOARD_WS_URL")
    ?: (project.findProperty("LIVING_DASHBOARD_WS_URL") as String?)
    ?: "ws://10.0.2.2:3456/ws"

android {
    namespace = "com.livingdashboard"
    compileSdk = 36  // 实验性：AGP 8.2 官方支持最高 34，用 suppressUnsupportedCompileSdk 压制警告

    defaultConfig {
        applicationId = "com.livingdashboard"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0-m0"

        // WS 地址：优先 local.properties，其次 gradle property，最后默认值
        // 真机验收前在 local.properties 设置 LIVING_DASHBOARD_WS_URL=ws://<主机IP>:3456/ws
        buildConfigField("String", "WS_URL", "\"$wsUrl\"")

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        vectorDrawables { useSupportLibrary = true }
    }

    buildTypes {
        debug {
            isMinifyEnabled = false
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }
    composeOptions {
        kotlinCompilerExtensionVersion = "1.5.14"
    }
    packaging {
        resources { excludes += "/META-INF/{AL2.0,LGPL2.1}" }
    }
}

dependencies {
    // Compose
    val composeBom = platform("androidx.compose:compose-bom:2024.06.00")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-core")
    implementation("androidx.activity:activity-compose:1.9.2")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.6")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.6")
    implementation("androidx.core:core-ktx:1.13.1")

    // Hilt
    implementation("com.google.dagger:hilt-android:2.48")
    kapt("com.google.dagger:hilt-compiler:2.48")
    implementation("androidx.hilt:hilt-navigation-compose:1.2.0")

    // OkHttp (WebSocket)
    implementation("com.squareup.okhttp3:okhttp:4.12.0")

    // kotlinx-serialization
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.3")

    // Room (M0 引入，不建表)
    implementation("androidx.room:room-runtime:2.6.1")
    kapt("androidx.room:room-compiler:2.6.1")

    // 测试
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.3")
}

// 注：suppressUnsupportedCompileSdk 在 gradle.properties 中设置（此处不生效）
```

#### 3.3.4 gradle.properties

```properties
android.useAndroidX=true
android.nonTransitiveRClass=true
org.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8
org.gradle.parallel=true
org.gradle.caching=true
android.suppressUnsupportedCompileSdk=36
```

#### 3.3.5 local.properties（gitignore，不入库）

```properties
sdk.dir=F:\\Android SDK
# 真机验收前用 ipconfig 查主机 IP，替换下面的地址
LIVING_DASHBOARD_WS_URL=ws://192.168.1.100:3456/ws
```

#### 3.3.6 gradle/wrapper/gradle-wrapper.properties

```properties
distributionBase=GRADLE_USER_HOME
distributionPath=wrapper/dists
distributionUrl=https\://services.gradle.org/distributions/gradle-8.2-bin.zip
zipStoreBase=GRADLE_USER_HOME
zipStorePath=wrapper/dists
```

> **说明**：wrapper 的 distributionUrl 指向官方下载地址，首次运行会下载到 `~/.gradle/wrapper/dists`（C 盘用户目录）。若需避免下载，可直接用本地 gradle 命令：`F:\allmylife\gradle-8.2-bin\gradle-8.2\bin\gradle.bat`。M0 验收用本地 gradle 命令，不依赖 wrapper 下载。

### 3.4 WS 客户端设计（sync/ 模块）

#### 3.4.1 消息类型（WsMessage.kt）— 修复 kind 字段问题

用 kotlinx-serialization 密封类，**必须**配置 `classDiscriminator = "kind"` + `@SerialName` 与服务器 kind 字面量一致：

```kotlin
package com.livingdashboard.sync

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

// WS JSON 配置：classDiscriminator = "kind"（与服务器协议一致）
// 服务器 ws.ts 检查 msg.kind，默认 kotlinx 是 "type"，必须改
val WsJson = kotlinx.serialization.json.Json {
    classDiscriminator = "kind"
    ignoreUnknownKeys = true
    encodeDefaults = true
}

@Serializable
sealed class ClientMessage {
    @Serializable @SerialName("user_message")
    data class UserMessage(
        val sessionId: String,
        val content: String
    ) : ClientMessage()

    @Serializable @SerialName("tool_result")
    data class ToolResult(
        val requestId: String,
        val success: Boolean,
        val data: JsonElement? = null,
        val error: String? = null
    ) : ClientMessage()

    @Serializable @SerialName("error_report")
    data class ErrorReport(
        val widgetId: String,
        val message: String,
        val stack: String? = null,
        val source: String
    ) : ClientMessage()

    @Serializable @SerialName("ping")
    object Ping : ClientMessage()
}

@Serializable
sealed class ServerMessage {
    @Serializable @SerialName("tool_call")
    data class ToolCall(
        val requestId: String,
        val tool: String,
        val params: JsonElement,
        val targetDeviceId: String? = null
    ) : ServerMessage()

    @Serializable @SerialName("pi_event")
    data class PiEvent(
        val event: String,
        val data: JsonElement
    ) : ServerMessage()

    @Serializable @SerialName("session_ready")
    data class SessionReady(val sessionId: String) : ServerMessage()

    @Serializable @SerialName("error")
    data class Error(val message: String) : ServerMessage()

    @Serializable @SerialName("pong")
    object Pong : ServerMessage()

    @Serializable @SerialName("change")
    data class Change(
        val changeType: String,
        val data: JsonElement,
        val sourceDeviceId: String? = null
    ) : ServerMessage()
}
```

#### 3.4.2 设备认证（DeviceAuth.kt）

```kotlin
package com.livingdashboard.sync

import android.content.Context
import java.util.UUID

class DeviceAuth(private val context: Context) {
    companion object {
        private const val PREFS_NAME = "living_dashboard_prefs"
        private const val KEY_DEVICE_ID = "living_dashboard_device_id"
        private const val KEY_SERVER_TOKEN = "living_dashboard_server_token"
    }

    fun getDeviceId(): String {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        var id = prefs.getString(KEY_DEVICE_ID, null)
        if (id == null) {
            id = UUID.randomUUID().toString()
            prefs.edit().putString(KEY_DEVICE_ID, id).apply()
        }
        return id
    }

    fun getServerToken(): String? {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getString(KEY_SERVER_TOKEN, null)
    }

    fun setServerToken(token: String?) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        if (token.isNullOrEmpty()) {
            prefs.edit().remove(KEY_SERVER_TOKEN).apply()
        } else {
            prefs.edit().putString(KEY_SERVER_TOKEN, token).apply()
        }
    }
}
```

#### 3.4.3 服务器配置（ServerConfig.kt）— 修复真机地址问题

```kotlin
package com.livingdashboard.sync

import com.livingdashboard.BuildConfig
import java.net.URLEncoder

class ServerConfig(private val deviceAuth: DeviceAuth) {
    /**
     * 构建带 deviceId + token 的完整 WS URL
     * WS_URL 来自 BuildConfig（编译时由 local.properties 注入）
     * 真机验收前在 local.properties 设置 LIVING_DASHBOARD_WS_URL=ws://<主机IP>:3456/ws
     */
    fun buildWsUrl(): String {
        val base = BuildConfig.WS_URL
        val deviceId = deviceAuth.getDeviceId()
        val token = deviceAuth.getServerToken()
        val sb = StringBuilder(base)
        sb.append(if (base.contains("?")) "&" else "?")
        sb.append("deviceId=").append(URLEncoder.encode(deviceId, "UTF-8"))
        if (token != null) {
            sb.append("&token=").append(URLEncoder.encode(token, "UTF-8"))
        }
        return sb.toString()
    }

    fun getDisplayUrl(): String = BuildConfig.WS_URL
}
```

#### 3.4.4 WS 连接管理（WsClient.kt）— 修复生命周期/重连/缓冲问题

```kotlin
package com.livingdashboard.sync

import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.concurrent.TimeUnit

enum class WsState {
    DISCONNECTED, CONNECTING, CONNECTED, RECONNECTING
}

class WsClient(
    private val serverConfig: ServerConfig,
    private val deviceAuth: DeviceAuth
) {
    companion object {
        private const val TAG = "LivingDashboard.WS"
        private const val PING_INTERVAL_MS = 30_000L
        private const val RECONNECT_BASE_MS = 1_000L
        private const val RECONNECT_MAX_MS = 30_000L
        private const val MAX_RECONNECT_ATTEMPTS = 10
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var ws: WebSocket? = null
    private var pingJob: Job? = null
    private var reconnectJob: Job? = null
    private var manuallyClosed = false
    private var reconnectAttempts = 0

    private val httpClient = OkHttpClient.Builder()
        .pingInterval(30, TimeUnit.SECONDS)  // OkHttp 协议层 ping（与应用层 ping 双保险）
        .readTimeout(0, TimeUnit.SECONDS)     // WS 长连接不超时
        .build()

    // 连接状态：StateFlow，UI 订阅
    private val _state = MutableStateFlow(WsState.DISCONNECTED)
    val state: StateFlow<WsState> = _state.asStateFlow()

    // 服务器消息：SharedFlow，UI 订阅。buffer 64，DROP_OLDEST 防背压
    private val _messages = MutableSharedFlow<ServerMessage>(
        extraBufferCapacity = 64,
        onBufferOverflow = kotlinx.coroutines.channels.BufferOverflow.DROP_OLDEST
    )
    val messages: SharedFlow<ServerMessage> = _messages.asSharedFlow()

    /** 建立 WS 连接（Application.onCreate 调用） */
    fun connect() {
        // 用 state 判断而非 ws!=null（ws 在 onClosed/onFailure 后仍可能非 null）
        if (_state.value == WsState.CONNECTED || _state.value == WsState.CONNECTING) return
        manuallyClosed = false
        reconnectAttempts = 0
        doConnect()
    }

    private fun doConnect() {
        if (manuallyClosed) return  // 防止 disconnect 后重连任务仍触发
        val url = serverConfig.buildWsUrl()
        Log.i(TAG, "Connecting to $url")
        _state.value = if (reconnectAttempts > 0) WsState.RECONNECTING else WsState.CONNECTING

        val request = Request.Builder().url(url).build()
        ws = httpClient.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                Log.i(TAG, "WS connected")
                reconnectAttempts = 0
                _state.value = WsState.CONNECTED
                startPing()
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                Log.d(TAG, "WS recv: $text")
                try {
                    val msg = WsJson.decodeFromString(ServerMessage.serializer(), text)
                    _messages.tryEmit(msg)
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to parse server message: $text", e)
                }
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                Log.w(TAG, "WS closed: $code $reason")
                _state.value = WsState.DISCONNECTED
                cleanup()
                if (!manuallyClosed) scheduleReconnect()
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.e(TAG, "WS failure", t)
                _state.value = WsState.DISCONNECTED
                cleanup()
                if (!manuallyClosed) scheduleReconnect()
            }
        })
    }

    /** 发送客户端消息 */
    fun send(msg: ClientMessage): Boolean {
        val w = ws ?: return false
        return try {
            val json = WsJson.encodeToString(ClientMessage.serializer(), msg)
            Log.d(TAG, "WS send: $json")
            w.send(json)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to send message", e)
            false
        }
    }

    /** 主动断开（Application.onTerminate 或不需要时调用） */
    fun disconnect() {
        Log.i(TAG, "WS disconnect (manual)")
        manuallyClosed = true
        pingJob?.cancel()
        reconnectJob?.cancel()  // 取消等待中的重连任务
        ws?.close(1000, "client closed")
        ws = null
        _state.value = WsState.DISCONNECTED
    }

    private fun startPing() {
        pingJob?.cancel()
        pingJob = scope.launch {
            while (true) {
                delay(PING_INTERVAL_MS)
                send(ClientMessage.Ping)
            }
        }
    }

    private fun scheduleReconnect() {
        if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            Log.w(TAG, "Max reconnect attempts reached, giving up")
            _state.value = WsState.DISCONNECTED
            return
        }
        reconnectAttempts++
        val delayMs = minOf(RECONNECT_BASE_MS * (1L shl (reconnectAttempts - 1)), RECONNECT_MAX_MS)
        Log.i(TAG, "Reconnecting in ${delayMs}ms (attempt $reconnectAttempts)")
        _state.value = WsState.RECONNECTING
        reconnectJob?.cancel()
        reconnectJob = scope.launch {
            delay(delayMs)
            if (!manuallyClosed) doConnect()
        }
    }

    private fun cleanup() {
        pingJob?.cancel()
        pingJob = null
    }
}
```

#### 3.4.5 Hilt 集成（di/AppModule.kt）

```kotlin
package com.livingdashboard.di

import android.content.Context
import com.livingdashboard.sync.DeviceAuth
import com.livingdashboard.sync.ServerConfig
import com.livingdashboard.sync.WsClient
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object AppModule {
    @Provides @Singleton
    fun provideDeviceAuth(@ApplicationContext ctx: Context): DeviceAuth = DeviceAuth(ctx)

    @Provides @Singleton
    fun provideServerConfig(deviceAuth: DeviceAuth): ServerConfig = ServerConfig(deviceAuth)

    @Provides @Singleton
    fun provideWsClient(serverConfig: ServerConfig, deviceAuth: DeviceAuth): WsClient =
        WsClient(serverConfig, deviceAuth)
}
```

#### 3.4.6 Application 类（LivingDashboardApp.kt）

```kotlin
package com.livingdashboard

import android.app.Application
import com.livingdashboard.sync.WsClient
import dagger.hilt.android.HiltAndroidApp
import javax.inject.Inject

@HiltAndroidApp
class LivingDashboardApp : Application() {
    @Inject lateinit var wsClient: WsClient

    override fun onCreate() {
        super.onCreate()
        // App 启动即建立 WS 连接（全局单例，生命周期跟随 Application）
        wsClient.connect()
    }
}
```

### 3.5 首页设计（ui/home/HomeScreen.kt）

M0 首页极简，验证 Compose 能运行 + WS 状态可见：

```
┌─────────────────────────────┐
│                             │
│       [Logo 图标]           │  ← 用 res/drawable/ic_logo.webp
│                             │
│   Living Dashboard          │  ← 标题
│   M0 - 项目骨架             │  ← 副标题
│                             │
│   WS 状态: ● 已连接         │  ← 实时显示 WS 连接状态（绿/红/黄）
│   设备 ID: xxxxxxxx         │  ← 显示 deviceId（调试用）
│   服务器: ws://192.168...   │  ← 显示服务器地址
│                             │
│   [最近消息]                │  ← 收到服务器消息时显示（调试用）
│   • pong                    │
│   • session_ready: xxx      │
│                             │
└─────────────────────────────┘
```

- 用 Compose Material3 主题
- WS 状态用绿色（已连接）/红色（断开）/黄色（连接中/重连）圆点
- 订阅 WsClient 的 stateFlow 和 messageFlow，实时更新 UI
- 收到的消息显示在列表里（最多保留 10 条，调试用）

### 3.6 AndroidManifest.xml（完整，修复资源引用）

```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />

    <application
        android:name=".LivingDashboardApp"
        android:label="@string/app_name"
        android:icon="@mipmap/ic_launcher"
        android:roundIcon="@mipmap/ic_launcher"
        android:theme="@style/Theme.LivingDashboard"
        android:usesCleartextTraffic="true"
        android:fullBackupContent="@xml/backup_rules"
        android:dataExtractionRules="@xml/data_extraction_rules">

        <activity
            android:name=".ui.MainActivity"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
```

- `usesCleartextTraffic="true"`：M0 服务器用 ws://（非 wss://），需要允许明文
- `ic_launcher`：引用 `mipmap-anydpi-v26/ic_launcher.xml`（自适应图标，Android 8+）

### 3.7 资源文件（完整内容）

#### 3.7.1 res/mipmap-anydpi-v26/ic_launcher.xml（新建：自适应图标）

```xml
<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
```

#### 3.7.2 res/drawable/ic_launcher_background.xml（新建：纯色背景）

```xml
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="#FFFFFF" />
</shape>
```

#### 3.7.3 res/values/strings.xml（新建）

```xml
<resources>
    <string name="app_name">Living Dashboard</string>
</resources>
```

#### 3.7.4 res/values/colors.xml（新建）

```xml
<resources>
    <color name="purple_200">#FFBB86FC</color>
    <color name="purple_500">#FF6200EE</color>
    <color name="purple_700">#FF3700B3</color>
    <color name="teal_200">#FF03DAC5</color>
    <color name="teal_700">#FF018786</color>
    <color name="black">#FF000000</color>
    <color name="white">#FFFFFFFF</color>
</resources>
```

#### 3.7.5 res/values/themes.xml（新建：修复 Theme.LivingDashboard 未定义）

```xml
<resources>
    <!-- M0 用 Material3，主题继承 Material3.DayNight.NoActionBar（Compose 应用只需空主题） -->
    <style name="Theme.LivingDashboard" parent="android:Theme.Material.Light.NoActionBar" />
</resources>
```

#### 3.7.6 res/xml/backup_rules.xml（新建）

```xml
<?xml version="1.0" encoding="utf-8"?>
<full-backup-content>
    <!-- M0 无需备份的数据 -->
</full-backup-content>
```

#### 3.7.7 res/xml/data_extraction_rules.xml（新建）

```xml
<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
    <cloud-backup>
        <!-- M0 无需云备份的数据 -->
    </cloud-backup>
    <device-transfer>
        <!-- M0 无需设备迁移的数据 -->
    </device-transfer>
</data-extraction-rules>
```

### 3.8 单元测试（WsMessageTest.kt）— 验证 kind 字段

```kotlin
package com.livingdashboard.sync

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class WsMessageTest {
    @Test
    fun ping_serializes_with_kind_ping() {
        val json = WsJson.encodeToString(ClientMessage.serializer(), ClientMessage.Ping)
        // 必须包含 "kind":"ping"（小写），与服务器 ws.ts 期望一致
        assertTrue("Expected kind:ping in $json", json.contains("\"kind\":\"ping\""))
    }

    @Test
    fun pong_deserializes_from_kind_pong() {
        val json = """{"kind":"pong"}"""
        val msg = WsJson.decodeFromString(ServerMessage.serializer(), json)
        assertTrue(msg is ServerMessage.Pong)
    }

    @Test
    fun user_message_serializes_with_correct_kind_and_fields() {
        val msg = ClientMessage.UserMessage(sessionId = "s1", content = "hello")
        val json = WsJson.encodeToString(ClientMessage.serializer(), msg)
        assertTrue(json.contains("\"kind\":\"user_message\""))
        assertTrue(json.contains("\"sessionId\":\"s1\""))
        assertTrue(json.contains("\"content\":\"hello\""))
    }

    @Test
    fun tool_call_deserializes_with_optional_target_device_id() {
        val json = """{"kind":"tool_call","requestId":"r1","tool":"browser_open","params":{},"targetDeviceId":"d1"}"""
        val msg = WsJson.decodeFromString(ServerMessage.serializer(), json)
        assertTrue(msg is ServerMessage.ToolCall)
        val tc = msg as ServerMessage.ToolCall
        assertEquals("r1", tc.requestId)
        assertEquals("d1", tc.targetDeviceId)
    }
}
```

### 3.9 proguard-rules.pro（M0 空文件，release 开启）

```
# M0 阶段无额外 ProGuard 规则
# kotlinx-serialization 和 Hilt 的规则由各自插件自动添加
```

---

## 四、实施步骤

### 步骤 1：更新 .gitignore
1. 在项目根 `f:\allmylife\event\.gitignore` 末尾追加：
   ```
   # Android local config
   client/android/local.properties
   client/android/.gradle/
   client/android/app/build/
   client/android/build/
   ```

### 步骤 2：创建 Gradle 项目骨架
1. 创建 `client/android/settings.gradle.kts`（见 3.3.1）
2. 创建 `client/android/build.gradle.kts`（见 3.3.2）
3. 创建 `client/android/gradle.properties`（见 3.3.4）
4. 创建 `client/android/local.properties`（见 3.3.5，**不入库**）
5. 创建 `client/android/gradle/wrapper/gradle-wrapper.properties`（见 3.3.6）
6. 创建 `client/android/app/build.gradle.kts`（见 3.3.3）
7. 创建 `client/android/app/proguard-rules.pro`（见 3.9）

### 步骤 3：创建源码目录结构与占位文件
1. 创建 `app/src/main/java/com/livingdashboard/` 下各模块目录
2. 各占位模块（browser/canvas/ai/script/data/import）放 `.gitkeep`
3. 创建 `AndroidManifest.xml`（见 3.6）
4. 创建 `res/values/` 资源文件（见 3.7.3-3.7.5）
5. 创建 `res/xml/` 资源文件（见 3.7.6-3.7.7）
6. 创建 `res/mipmap-anydpi-v26/ic_launcher.xml`（见 3.7.1）
7. 创建 `res/drawable/ic_launcher_background.xml`（见 3.7.2）

### 步骤 4：实现 WS 客户端
1. `WsMessage.kt`（见 3.4.1）
2. `DeviceAuth.kt`（见 3.4.2）
3. `ServerConfig.kt`（见 3.4.3）
4. `WsClient.kt`（见 3.4.4）
5. `AppModule.kt`（见 3.4.5）
6. `LivingDashboardApp.kt`（见 3.4.6）

### 步骤 5：实现首页
1. `MainActivity.kt` — `@AndroidEntryPoint`，订阅 WsClient 状态
2. `HomeScreen.kt` — Logo + WS 状态 + 消息列表（见 3.5）
3. `theme/Color.kt` + `Theme.kt` + `Type.kt` — Material3 主题

### 步骤 6：单元测试
1. `WsMessageTest.kt`（见 3.8）
2. 用 gradle 运行 `testDebugUnitTest`

### 步骤 7：编译验收
1. 用本地 gradle 命令：`F:\allmylife\gradle-8.2-bin\gradle-8.2\bin\gradle.bat` 
2. 在 `client/android/` 目录执行 `assembleDebug`
3. 修复编译错误
4. 确认生成 `app/build/outputs/apk/debug/app-debug.apk`

### 步骤 8：真机运行验收
1. 提示用户连接真机（USB 调试）
2. `gradle installDebug` 安装到真机
3. 启动 App，确认首页显示 Logo + 标题 + WS 状态
4. 确认显示 deviceId（非空）和服务器地址

### 步骤 9：WS 连接验收
1. 用 `ipconfig` 查主机局域网 IP
2. 在 `local.properties` 设置 `LIVING_DASHBOARD_WS_URL=ws://<主机IP>:3456/ws`
3. 重新编译安装
4. 启动服务器：在 `f:\allmylife\event` 执行 `docker-up.bat`（或 `cd server && npm run dev`）
5. 确认 `.env` 中 `SERVER_TOKEN=` 为空（不校验 token）
6. App 启动后 WS 状态变为"已连接"（绿色）
7. 服务器日志可见 `[WS] Client connected: deviceId=xxx`
8. 30 秒内可见 ping/pong
9. 关 App 后服务器日志可见 `Client disconnected`

### 步骤 10：对抗审查 + commit
1. 用 adversarial-review skill 审查（含运行时验证）
2. 修复审查发现的问题
3. git commit

---

## 五、风险与缓解

### 5.1 已识别风险

| 风险 | 缓解 |
|------|------|
| **AGP 8.2 与 compileSdk=36 不兼容**（实验性配置） | 见 5.2 节回退方案 |
| Gradle 8.2 与 AGP 版本不匹配 | 用 AGP 8.2.2（与 Gradle 8.2 严格匹配） |
| Compose Compiler 与 Kotlin 版本不匹配 | 用 Kotlin 1.9.24 + Compose Compiler 1.5.14（已验证兼容） |
| 真机访问主机 WS 地址 | 用主机局域网 IP（ipconfig 查），不用 10.0.2.2（仅模拟器有效） |
| 服务器未启动导致 WS 验收失败 | 验收前先启动服务器（docker-up.bat 或 npm run dev） |
| kotlinx-serialization 与服务器 JSON 格式不一致 | 单元测试验证 kind 字段，与 server/src/ws.ts 协议严格对齐 |
| WS 重连耗电 | 最大重试 10 次后停止，OkHttp 内置 pingInterval 双保险 |
| SharedFlow 背压丢消息 | extraBufferCapacity=64 + DROP_OLDEST |
| 包体超标 | M0 不严格验收，不引入 material-icons-extended |

### 5.2 compileSdk=36 回退方案（若编译失败）

**触发条件**：`gradle assembleDebug` 报错与 compileSdk=36 相关（如 `Unknown attribute`、`Resource linking failed`、`SDK 36 not supported`）。

**回退步骤**：
1. 安装 android-34 platform：
   - 方案 A：用 Android Studio 的 SDK Manager 安装（用户操作）
   - 方案 B：手动下载 `https://dl.google.com/android/repository/platform-34_r05.zip`，解压到 `F:\Android SDK\platforms\android-34`
2. 修改 `app/build.gradle.kts`：`compileSdk = 34` + `targetSdk = 34`
3. 删除 `android.suppressUnsupportedCompileSdk = 36`
4. 重新编译

---

## 六、验收检查清单（对抗审查用）

### 6.1 编译验收
- [ ] `gradle assembleDebug` 退出码 0（用 `F:\allmylife\gradle-8.2-bin\gradle-8.2\bin\gradle.bat`）
- [ ] 生成 `app/build/outputs/apk/debug/app-debug.apk`
- [ ] 单元测试通过（`gradle testDebugUnitTest`，WsMessageTest 4 个用例全过）
- [ ] 无编译错误（警告需说明可接受）

### 6.2 运行验收（真机）
- [ ] `gradle installDebug` 安装成功
- [ ] App 启动不崩溃
- [ ] 首页显示 Logo + 标题
- [ ] 显示 deviceId（非空 UUID）
- [ ] 显示服务器地址（ws://192.168.x.x:3456/ws）

### 6.3 WS 连接验收
- [ ] 服务器启动（端口 3456 监听）
- [ ] `.env` 中 `SERVER_TOKEN=` 为空
- [ ] App 启动后 WS 状态变为"已连接"（绿色）
- [ ] 服务器日志可见 `[WS] Client connected: deviceId=xxx`
- [ ] 30 秒内可见 ping/pong（客户端 `adb logcat -s LivingDashboard.WS` 或服务器日志）
- [ ] 主动断开（关 App）后服务器日志可见 `Client disconnected`

### 6.4 项目结构验收
- [ ] 目录结构符合 roadmap 11.2 节（ui/browser/canvas/ai/script/data/sync/import/di）
- [ ] 各模块有 .gitkeep 或实际代码
- [ ] sync/ 模块有完整 WS 客户端实现（WsClient/WsMessage/DeviceAuth/ServerConfig）

### 6.5 代码质量
- [ ] WS 消息类型与 server/src/ws.ts 协议严格一致（kind 字面量小写下划线）
- [ ] kotlinx-serialization 配置 `classDiscriminator = "kind"`
- [ ] 所有子类有 `@SerialName` 与服务器 kind 一致
- [ ] deviceId 持久化（SharedPreferences）
- [ ] WS 重连机制（指数退避，最大 10 次，上限 30 秒）
- [ ] 心跳机制（30 秒应用层 ping + OkHttp 协议层 pingInterval）
- [ ] Hilt 依赖注入正确配置（plugin + kapt + @HiltAndroidApp + @AndroidEntryPoint）
- [ ] kotlinx-serialization 插件配置（plugin + runtime）
- [ ] Java 17 编译配置（compileOptions + kotlinOptions）
- [ ] Compose 构建配置（buildFeatures.compose + composeOptions）
- [ ] SharedFlow 缓冲配置（extraBufferCapacity=64 + DROP_OLDEST）
- [ ] WsClient 生命周期（Application.onCreate 连接，全局单例）
- [ ] local.properties 在 .gitignore 中
- [ ] 单元测试通过（WsMessageTest 4 个用例）

---

## 七、不在 M0 范围内（明确排除）

- 浏览器主页 / WebView 浏览器（M1）
- 画布主页 / 分层画布（M2）
- AI 对话 / AI 指令执行（M3）
- 脚本系统（M4）
- Room 建表 / 数据同步（M5）
- 数据导入（M6）
- 设置面板（M0 服务器地址用 BuildConfig，不做 UI）
- 自适应图标完整配置（M0 用纯色背景 + 现有 foreground，后续优化）
- material-icons-extended（M0 用 core，后续按需引入）
- release 构建优化（M0 用 debug 验收）
- 网络感知重连（M0 不监听 ConnectivityManager，最大重试 10 次后停止）
