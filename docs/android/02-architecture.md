# 02 · 总架构

> 本文是 Android 端与服务端配套改造的技术总纲。模块怎么拆、协议怎么走、代码放哪里，全部在此定义。

## 1. 架构总览

```
┌────────────────────────── Android App（Kotlin，新模块根 client/android/） ──────────────────────────┐
│  Shell（Compose）      对话主页 · 桌面层 · 商店 · 我的 · 包管理 UI · 权限引导                       │
│  Runtime               App Runtime(WebView沙箱) · Overlay Runtime(悬浮窗/桌宠) · ToolPkg(QJS, M2)   │
│  Capability            无障碍 · MediaProjection · 悬浮窗 · 通知 · Shizuku(可选) · proot(按需下载)   │
│  Data                  Room/DataStore 离线缓存 · 文件同步 · 密钥库(Android Keystore, BYOK)          │
├─── Agent Bridge（本地，stdio/JSON-RPC，见 §4）──────────────────────────────────────────────────────┤
│  Agent Harness（端侧 pi 内核：proot Ubuntu + Node ≥22，单进程多会话 SDK 嵌入）                      │
│  对话(SSE 流式) · 工具执行(端侧设备工具本地直接调用 + 服务端数据工具走 HTTPS) · skills/记忆/会话     │
└──────────────────────────────────┬──────────────────────────────────────────────────────────────────┘
                                   │ HTTPS（JWT Cookie）——仅数据/包/商店/同步/计费，不含对话流
┌──────────────────────────────────┴──────────────────────────────────────────────────────────────────┐
│  服务端（server/，Node + Express；Android 端不再承载 AI 对话，服务端 pi 仅服务 PWA/桌面维护模式）     │
│  现有不动：/webos/api/*（bootstrap/apps/storage/商店/计费/邮箱/支付；chat/stream 保留给 PWA）         │
│  新增模块：webosPackages(包流水线) · webosAppApi(App API) · webosRooms(联机) ·                       │
│           filestore(统一文件服务) · webosBackup(备份) · mediaProviders(TTS/ASR 抽象)                 │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

**客户端是"新客户端"而非"新产品"**：App/包/版本/商店/文件元数据继续以服务端为权威源（同步见 09）；**但 AI 对话是端侧自治的**（D15）——模型与密钥归用户（BYOK），平台不托管、不兜底、不介入对话链路。

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
├── core/                # 契约 DTO（kotlinx.serialization）、ApiClient、本地 Agent 桥客户端、错误模型
├── agent/               # ⭐ Agent Harness 宿主（M1）：Node 进程管理（proot 启动/生命周期/重启）、
│                        #   stdio JSON-RPC 桥、BYOK 密钥注入、harness 更新（版本化 Node 运行时包）
├── app-runtime/         # WebView 沙箱：预热池、桥（WebMessagePort）、app-sdk JS shim 注入、URL 拦截白名单
├── overlay-runtime/     # 悬浮窗管理器、pet-layer 引擎（共享 canvas WebView）、点击穿透 hit-test
├── capability/          # AccessibilityService、MediaProjection、通知监听、Shizuku 绑定、capability 采集上报
├── packages/            # 包管理器：安装/版本指针/校验/manifest 解析/缓存目录
├── sync/                # 离线缓存策略、文件同步（manifest diff）、备份导入导出
└── (M2) toolpkg/        # QuickJS JNI 引擎（参考 Operit 方案，自研，不抄代码）
└── (M2) linux/          # proot 运行器（rootfs 按需下载安装器，参考 RikkaHub 方案，自研，不抄代码）
```

**harness 与前端分离开发（D15 配套，2026-08 用户拍板）**：

- **harness 部分**（Node/TS，独立于 Android 工程可单独开发）：端侧 pi 内核 = pi-coding-agent SDK 嵌入 + 端侧工具注册（设备/文件/包/搜索）+ sub-agent 执行器（15）+ skills 加载。契约 = 本地桥 JSON-RPC schema（`shared/` 下新增 `agent-bridge-contract`，单一事实源）。
- **前端部分**（Kotlin，`app/`+`core/`+`agent/`）：Shell UI + 桥客户端 + harness 进程管理。
- **分离方式**：harness 先以 Node 进程在开发机/本机 proot 独立跑（同服务端 piBridge 同源改造，见 15 §6），前端用 mock 桥先行开发；**合并测试**以契约守卫（桥 schema fixtures 反序列化测试，同 §2 契约守卫纪律）为准。

**契约同步规则**：`shared/webos-contracts/index.ts` 仍是单一事实源。Android 侧在 `core/` 手写 Kotlin DTO 镜像，并配**契约守卫**：CI 中跑一组录制的服务端响应 JSON fixtures 反序列化测试（字段缺失即红）。新增契约字段时同步更新两侧 + fixtures。

## 4. Agent Bridge（客户端 ↔ 端侧 pi 内核的唯一通道）

### 4.1 进程模型（D15：本地 AI，无云端兜底）

```
Kotlin Shell（app/）── Agent 桥客户端（core/）── stdio JSON-RPC ──▶ Node 进程（agent/ 启动，proot 内）
                                                                    └── pi-coding-agent SDK（单进程多会话）
                                                                        ├── 会话（按 conversationId 缓存）
                                                                        ├── 端侧工具注册（设备/文件/包/搜索/生成）
                                                                        ├── sub-agent 执行器（15，in-process 默认）
                                                                        └── skills / 记忆 / 会话日志（本地存储）
```

- **单个 Node 进程**承载所有会话（pi SDK 嵌入模式，与服务端 piBridge 同源改造，见 15 §6）；Kotlin 经 stdio JSON-RPC 双向通信（事件流为 JSON-RPC 通知，工具执行为请求-响应）。
- Node 进程由 `agent/` 模块管理生命周期：proot 内启动、崩溃重启（指数退避）、前后台策略（前台保活、后台挂起/冻结）、harness 版本化更新（Node 运行时 + 内核包走包流水线，M2）。
- **BYOK**：模型 provider 与密钥由用户配置（08 §6），密钥存 Android Keystore，启动时经桥注入 Node 进程环境（仅内存，不落盘）。

### 4.2 事件流与工具执行

事件序列对齐现有 `WebOsChatEvent` 词汇（start/delta/thinking/tool_start/tool_update/tool_end/app_created/app_updated/interactive_html/busy_waiting/background_progress/done/error/keep_alive），但**全部在本进程内产生**，经桥转发：

- 对话流：`session.turn`（请求-响应）→ `event`（通知，delta/thinking/tool_*/done）。
- **端侧设备工具本地直接执行**（无障碍点击、截屏、读取当前屏幕、操作悬浮层、本地文件）——不再绕 WSS 转发；每个工具在端侧 Permission Broker 登记 `requires`（07 §4 求交逻辑端侧化）。
- **服务端数据工具**（包列表/商店/版本/文件元数据/联机房间）由 harness 内的 HTTP 客户端经 `core/` 代理（JWT，仅数据面）。
- 超时纪律不变：工具 30s、执行可中止（`session.abort`）；能力不满足只报 `CAPABILITY_UNAVAILABLE`，不伪造。

### 4.3 为什么端侧 pi（本地 AI 是唯一路径）

1. **用户主导**：AI 为用户服务，模型与密钥归用户（BYOK）。服务端托管 = 平台替用户选模型、持密钥，Android 端沦为 WebView 套壳，立项价值崩塌（2026-08 用户明确否决云端兜底）。
2. **离线可用**：对话、记忆、App 生成在无网/弱网下完整可用；数据同步（09）为后台行为。
3. **隐私**：对话内容、文件、屏幕上下文不出设备；服务端只见同步后的元数据。
4. **技术可行（实证）**：pi 是纯 JS 库（Node ≥22，无原生绑定）；proot Ubuntu + Node arm64 在本工作区运行实证（Operit 环境）；SDK 嵌入 = **复用** pi 内核与 piBridge 资产，**不是**重写 agent loop（RikkaHub 自研 Kotlin loop 的双端同步代价仍是反面教材）。
5. **进程占用可控**：单 Node 进程多会话；sub-agent 默认 in-process（15），不复制 pi 官方示例的子进程方式（每任务一进程在手机内存/冷启动上不可行）。
6. 服务端 pi 保留：仅服务现有 PWA/桌面维护模式（根 AGENT.md 维护纪律），Android 端不依赖。

## 5. 渲染分级（与 D10 一致，落地到模块）

| 渲染目标 | 引擎 | 所在模块 | 红线 |
|---|---|---|---|
| Shell 全部界面 | Compose | app/ | 禁止内嵌 WebView |
| Shell 特权内核 | Compose（写死） | app/ | 导航骨架/消息核心/权限 UI/安全回退不可挂载任何包（红线 2） |
| Shell slot 层（M2，03 §5.1） | Compose + slot 挂载点 | app/ + packages/ | slot 包须声明语义锚点 + `ui.extend` 能力；每页 slot ≤4；mount/unmount 指针切换原子、失败回滚 |
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
   ├── capability.ts    # 端侧 capability 上报（REST；设备工具已本地化，无需 WSS 通道）
   ├── files/           # 统一文件服务（09）
   ├── backup.ts        # 备份（09）
   └── media/           # TTS/ASR Provider 抽象（08）
   ```
   挂载方式：`webosRouter.use('/packages', packagesRouter)` 等；**禁止**在 webos.ts 新增 >50 行的代码块。
2. **触及即瘦身**：当必须修改 webos.ts 中某块逻辑时，把该块按域抽出到 `webos/` 模块（一次只抽一个域，行为不变，配回归）。
3. 新增 pi 工具统一进 `piBridge` 的工具注册区，但**实现体放 `webos/` 模块**，piBridge 只做适配（控制 piBridge.ts 不再膨胀）。

## 7. 数据所有权与状态流

- **服务端权威**：包/版本、storage、商店、房间、文件元数据。客户端所有展示数据来自服务端 + Room 缓存（09 同步协议）。
- **端侧权威（D15 扩大）**：AI 会话/记忆/skills（本地存储）、BYOK 密钥（Keystore）、capability 状态、悬浮层运行态、WebView 池、下载的包缓存。端侧状态变化（权限授予/撤销、capability）**主动上报** → 服务端写入 `capabilities`（供 PWA 维护模式与数据面工具使用）。
- **对话记录同步**：本地会话日志按 09 协议加密同步到服务端用户域（换机恢复、管理端 trace 排查），同步为后台行为、可关闭（隐私设置）；**同步 ≠ 对话链路依赖**，离线对话完整可用。
- **冲突处理**：storage key 级 LWW；桌面布局由服务端 system.desktop 版本机制天然解决（版本即快照）。

## 8. 安全架构速览（细节在各分篇）

- App/url-app 在 WebView 沙箱：独立 storage 分区、`WebMessagePort` 双向桥、网络域白名单（05）、无直接 Cookie 访问（桥由 core 代理请求）。
- **能力即包（D3）**：工具/模型/媒体 provider/UI 扩展都是包，替换 = 安装/切指针，永不改代码；系统默认包可覆盖，特权内核（红线 2）例外。
- **UI slot（03 §5.1）**：slot 包挂载须过 `ui.extend` 能力求交 + 语义锚点声明；特权内核拒绝挂载；mount/unmount 原子化 + 失败回滚。
- 设备工具、文件、API 代理、房间全部经 Permission Broker 求交（四交集，红线 5）。
- 所有跨边界调用落审计（本地 execution.log，09 同步后管理端 trace 可查，沿用 08-13 决策标准）。