# 02 · 总架构

> 本文是 Android 端与服务端配套改造的技术总纲。模块怎么拆、协议怎么走、代码放哪里，全部在此定义。

## 1. 架构总览

```
┌────────────────────────── Android App（Kotlin，新模块根 client/android/） ──────────────────────────┐
│  Shell（Compose）      对话主页 · 桌面层 · 商店 · 我的 · 包管理 UI · 权限引导                       │
│  Runtime               App Runtime(WebView沙箱) · Overlay Runtime(悬浮窗/桌宠) · ToolPkg(QJS, M2)   │
│  Capability            无障碍 · MediaProjection · 悬浮窗 · 通知 · Shizuku(可选) · proot(可选下载)   │
│  Data                  Room/DataStore 离线缓存 · 文件同步 · Agent Bridge(SSE+WS)                    │
└──────────────────────────────────┬──────────────────────────────────────────────────────────────────┘
                                   │ HTTPS（JWT Cookie）/ SSE / WSS
┌──────────────────────────────────┴──────────────────────────────────────────────────────────────────┐
│  服务端（server/，Node + Express + pi agent）                                                        │
│  现有不动：/webos/api/*（bootstrap/chat/apps/storage/商店/计费/邮箱/支付）                            │
│  新增模块：webosPackages(包流水线) · webosAppApi(App API) · webosRooms(联机) ·                       │
│           filestore(统一文件服务) · webosBackup(备份) · mediaProviders(TTS/ASR 抽象)                 │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

**客户端是"新客户端"而非"新产品"**：所有业务数据（聊天/App/版本/计费/商店）继续以服务端为唯一权威源，Android 端与 PWA 端共享全部 `/webos/api/` 端点与契约。

## 2. 技术栈（锁定版本区间，禁止随意更换）

| 层 | 选型 | 说明 |
|---|---|---|
| 语言/UI | Kotlin 2.x + Jetpack Compose（BOM 2025+，Material 3 + Material You 动态取色） | 对标 RikkaHub/Operit 的流畅路径 |
| 异步 | Coroutines + Flow（SSE delta 直接进 StateFlow） | |
| 网络 | OkHttp 5（含 SSE）+ kotlinx.serialization（JSON） | 不用 Retrofit（端点少且多为流式） |
| DI | Koin | RikkaHub 同款，轻 |
| 本地存储 | Room（消息/App 缓存）+ DataStore（设置/会话） | |
| WebView | AndroidX WebKit（`WebViewCompat`/`WebMessageListener`/`WebMessagePort`） | 桥接见 §4 |
| 悬浮层 | WindowManager `TYPE_APPLICATION_OVERLAY` + ComposeView/WebView | 07-permissions |
| 后台 | WorkManager（备份/同步调度）+ ForegroundService（任务保活，类型 dataSync） | |
| 构建 | Gradle KTS + Version Catalog；minSdk 26，targetSdk 35，仅 arm64-v8a | 对齐 Operit 策略（arm64 覆盖绝大多数目标用户） |
| 质量 | Baseline Profiles + Macrobenchmark；Detekt + Android Lint | 性能红线见 11 |

服务端**不变**：Node 22 + Express 5 + TypeScript + pi（@earendil-works/*）+ PG/SQLite。

## 3. Android 工程结构（Gradle 模块）

```
client/android/
├── app/                 # Shell：Activity/导航/四大页面/主题引擎/权限引导/包管理 UI
├── core/                # 契约 DTO（kotlinx.serialization）、ApiClient、SSE 客户端、设备工具 WS 通道、错误模型
├── app-runtime/         # WebView 沙箱：预热池、桥（WebMessagePort）、app-sdk JS shim 注入、URL 拦截白名单
├── overlay-runtime/     # 悬浮窗管理器、pet-layer 引擎（共享 canvas WebView）、点击穿透 hit-test
├── capability/          # AccessibilityService、MediaProjection、通知监听、Shizuku 绑定、capability 采集上报
├── packages/            # 包管理器：安装/版本指针/校验/manifest 解析/缓存目录
├── sync/                # 离线缓存策略、文件同步（manifest diff）、备份导入导出
└── (M2) toolpkg/        # QuickJS JNI 引擎（参考 Operit 方案，自研，不抄代码）
└── (M2) linux/          # proot 运行器（rootfs 按需下载安装器，参考 RikkaHub 方案，自研，不抄代码）
```

**契约同步规则**：`shared/webos-contracts/index.ts` 仍是单一事实源。Android 侧在 `core/` 手写 Kotlin DTO 镜像，并配**契约守卫**：CI 中跑一组录制的服务端响应 JSON fixtures 反序列化测试（字段缺失即红）。新增契约字段时同步更新两侧 + fixtures。

## 4. Agent Bridge 协议（客户端 ↔ pi 内核的唯一通道）

复用现有协议，Android 端实现两个通道：

### 4.1 对话流（SSE，现有）

`POST /webos/api/chat/stream`（`credentials: include` 等价物：OkHttp CookieJar 持久化 `access_token`）。事件序列即 `WebOsChatEvent`（见 shared 契约：start/delta/thinking/tool_start/tool_update/tool_end/app_created/app_updated/interactive_html/busy_waiting/background_progress/done/error/keep_alive/no_task）。客户端职责：
- delta/thinking 增量进 StateFlow 驱动气泡渲染；tool 事件进 chip 列表；
- **断线恢复**：进程回前台或连接断开 → `POST /webos/api/chat/stream` 带 `resume`（沿用现有 resume 语义：服务端补发进行中任务事件；收到 `done.resume=true` 不累加用量）；
- `app_created/app_updated` → 刷新桌面与 App 列表（服务端已推送，客户端只做失效重取）。

### 4.2 设备工具通道（WSS，新增）

服务端 pi 的部分新工具需要在**设备上**执行（无障碍点击、截屏、读取当前屏幕、操作悬浮层等）。协议镜像现有 WS 工具转发：

```jsonc
// 服务端 → 客户端
{ "kind": "tool_call", "requestId": "uuid", "tool": "device_tap", "params": { "x": 540, "y": 1200 } }
// 客户端 → 服务端（30s 超时，同现有纪律）
{ "kind": "tool_result", "requestId": "uuid", "success": true, "data": { } }
```

- 连接：`wss://shadowshub.xyz/webos/ws/device?token=...`（M1 新端点；握手带 JWT，单连接按 userKey 归位）。
- 保活：前台服务 + 心跳 25s；断线指数退避重连；**设备不在线时工具返回明确 `DEVICE_OFFLINE`**，不伪造。
- 每个设备工具在 Permission Broker 登记 `requires` 能力（07-permissions §4），服务端在调用前查 capability matrix。

### 4.3 为什么不把 pi 跑在端上（M1）

服务端托管 pi：零体积成本、密钥不出服务端、会话/skills/记忆/审计全部复用。端侧只依赖 Bridge 协议 → 未来换内核（或 M3 提供 proot 本地 pi 模式）只动 Bridge 实现。**禁止在客户端重写 agent loop**（RikkaHub 的双端同步代价是反面教材）。

## 5. 渲染分级（与 D10 一致，落地到模块）

| 渲染目标 | 引擎 | 所在模块 | 红线 |
|---|---|---|---|
| Shell 全部界面 | Compose | app/ | 禁止内嵌 WebView |
| App 界面 | WebView（预热池 ≤2，LRU） | app-runtime/ | 单 App 内存超 200MB 触发回收策略 |
| pet-layer（2D 桌宠/漂浮物） | **单共享 overlay WebView + 单 canvas** | overlay-runtime/ | 同时存活 pet 窗口 ≤12；后台停 RAF |
| pet-layer（3D，M3） | Filament / Live2D | overlay-runtime/ | 单独评审后引入 |
| 主题/壁纸/布局 | Compose + design tokens | app/ | token 校验失败回退默认主题 |

pet-layer 物理循环：默认在 WebView 内 RAF（AI 产物即 canvas 场景）；当场景声明 `physics: "native"`（M2）时由 overlay-runtime 的 Kotlin 协程驱动，每帧仅把 transform 批量注入 JS（`evaluateJavascript` 批量 diff，不走桥逐条消息）。

## 6. 服务端配套改造与「单体拆分纪律」

### 6.1 现状（实测）

`routes/webos.ts` 409KB、`piBridge.ts` 114KB、`client/shell-web/src/App.tsx` 182KB——单体文件已是变更风险源（改一处全量回归）。

### 6.2 纪律（强制）

1. **webos.ts 冻结**：Android 配套的所有新端点**必须**进新模块，一律放在 `server/src/webos/` 新目录：
   ```
   server/src/webos/
   ├── packages.ts      # 包流水线（03）
   ├── appApi.ts        # App API 代理与工具注册（04）
   ├── externalApps.ts  # url-app 与外部 API 代理（05）
   ├── rooms.ts         # 联机房间 + channel（06）
   ├── deviceWs.ts      # 设备工具 WSS（本文 §4.2）
   ├── files/           # 统一文件服务（09）
   ├── backup.ts        # 备份（09）
   └── media/           # TTS/ASR Provider 抽象（08）
   ```
   挂载方式：`webosRouter.use('/packages', packagesRouter)` 等；**禁止**在 webos.ts 新增 >50 行的代码块。
2. **触及即瘦身**：当必须修改 webos.ts 中某块逻辑时，把该块按域抽出到 `webos/` 模块（一次只抽一个域，行为不变，配回归）。
3. 新增 pi 工具统一进 `piBridge` 的工具注册区，但**实现体放 `webos/` 模块**，piBridge 只做适配（控制 piBridge.ts 不再膨胀）。

## 7. 数据所有权与状态流

- **服务端权威**：聊天、包/版本、storage、房间、文件元数据。客户端所有展示数据来自服务端 + Room 缓存（09 同步协议）。
- **端侧权威**：capability 状态、悬浮层运行态、WebView 池、下载的包缓存。端侧状态变化（权限授予/撤销）**主动上报** → 服务端写入 `capabilities`（bootstrap 下发给 AI 决策）。
- **冲突处理**：storage key 级 LWW；桌面布局由服务端 system.desktop 版本机制天然解决（版本即快照）。

## 8. 安全架构速览（细节在各分篇）

- App/url-app 在 WebView 沙箱：独立 storage 分区、`WebMessagePort` 双向桥、网络域白名单（05）、无直接 Cookie 访问（桥由 core 代理请求）。
- 设备工具、文件、API 代理、房间全部经 Permission Broker 求交（四交集，红线 5）。
- 所有跨边界调用落审计（服务端 execution.log / 管理端 trace 已有体系，新增域沿用）。